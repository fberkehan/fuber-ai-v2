// E-posta servisi: hesaplar, aralıklı eşitleme, önem puanı, bildirim, taslak ve gönderim. Electron'dan bağımsızdır
// (şifreleme, indirme klasörü ve saat dışarıdan verilir) ki birim testleri gerçek sahte sunucuyla koşabilsin.
//
// Eşitleme kuralları: hesap yoksa hiçbir şey yapılmaz (zamanlayıcı da kurulmaz). Aralık `policy.modules.mail.config.syncMinutes`
// (varsayılan 5). Asistan dinlerken, düşünürken ya da konuşurken eşitleme ertelenir (yerel model ve ağ sesli turla yarışmasın).
// Gizli kipte ve acil durdurmada eşitleme yapılmaz. Yeni ileti yoksa model ÇAĞRILMAZ. İlk eşitlemenin eski iletileri bildirim
// üretmez. Önemli (4+) ve okunmamış yeni iletiler TEK bildirimde toplanır; kanalı (ada, ses, sessiz saat) Dikkat Yöneticisi seçer.
import fs from 'node:fs';
import nodePath from 'node:path';
import {
  t,
  UserError,
  type AttentionApi,
  type BrainApi,
  type Bus,
  type Id,
  type IsoDateTime,
  type Logger,
  type PolicyApi,
  type SettingsApi,
  type VoiceApi,
} from '@fuber/shared';
import { accountFormProblem, sameConnection, testResultText, trimAccountInput } from './form';
import { MAIL_PRESETS } from './presets';
import { allRecipients } from './recipients';
import { createMailRepo, queryFilter, toHit, toSummary, type AccountRow, type DraftRow, type ListFilter, type MailRepo, type MessageRow } from './repo';
import { combineScores, modelScores, ruleScore } from './scorer';
import type { SecretCipher } from './secrets';
import { BLOCKED_ATTACHMENT, freshPart, oneLine, safeFileName } from './text';
import type { ThunderbirdStore } from './thunderbird-store';
import * as transport from './transport';
import type { MailAccountInput, MailAccountView, MailImportStatus, MailLocalStatus, MailQuery, MailQueryResult, MailStatus, MailSummary, MailTestResult } from './types';

export const DEFAULT_SYNC_MINUTES = 5;
/** Ses turu sürerken eşitleme bu kadar ertelenir (en çok `MAX_POSTPONE` kez). */
const POSTPONE_MS = 30_000;
const MAX_POSTPONE = 6;
/** Başka modülün (gözcü) ya da aracın istediği eşitleme en çok bu sıklıkta yapılır. */
const ON_DEMAND_MIN_MS = 60_000;
/** Önemli iletinin "yeni" sayıldığı süre: daha eski tarihli ileti (geç eşitlenen) bildirim üretmez. */
const NOTIFY_MAX_AGE_MS = 3 * 86_400_000;
/** Modele bir eşitlemede en çok bu kadar ileti gider. */
const MODEL_MAX = 12;
const KEEP_DAYS = 60;
const KEEP_PER_ACCOUNT = 2000;
/** Yerel ilk okuma (backfill): bir turda en çok bu kadar YENİ (hiç okunmamış) kutu okunur; kalanı sonraki tur. İlerleme görünür olsun diye küçük. */
const INITIAL_BOXES_PER_ROUND = 3;
/** Backfill sürerken zamanlayıcı normal aralık yerine bu kısa gecikmeyle bir sonraki turu kurar (arka arkaya). */
const BACKFILL_GAP_MS = 400;
/** Backfill turları arasında kısa nefes (olay döngüsünü ve sesi boğmamak için). */
const BACKFILL_BREATH_MS = 50;
/** Backfill döngüsünün üst sınırı (güvenlik; bozuk/çok kutuda sonsuz dönmesin). */
const MAX_BACKFILL_ROUNDS = 2000;

export interface MailDeps {
  repo: MailRepo;
  /** `null`: işletim sisteminin şifreli deposu yok (hesap eklenemez). */
  cipher: SecretCipher | null;
  bus: Bus;
  attention: Pick<AttentionApi, 'notify'>;
  brain: Pick<BrainApi, 'extract' | 'availability'>;
  policy: Pick<PolicyApi, 'moduleConfig' | 'networkAllowed' | 'killSwitchActive' | 'get'>;
  voice: Pick<VoiceApi, 'status'>;
  settings: Pick<SettingsApi, 'get'>;
  log: Logger;
  /** Eklerin kaydedileceği klasör (İndirilenler; belgeler modülünün izinli klasörü). */
  downloadsDir: () => string;
  /** Thunderbird'ün yerel klasöründen (mbox) parolasız okuma. Yoksa yerel kaynak özelliği kapalıdır. */
  localStore?: ThunderbirdStore | null;
  now?: () => Date;
  timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
}

export type MailService = ReturnType<typeof createMailService>;

export function createMailService(deps: MailDeps) {
  const { repo, bus, log } = deps;
  const now = deps.now ?? (() => new Date());
  const timers = deps.timers ?? { set: (run: () => void, ms: number) => setTimeout(run, ms), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  let timer: unknown = null;
  let nextAt: Date | null = null;
  let postponed = 0;
  let running: Promise<number> | null = null;
  let localRunning: Promise<number> | null = null;
  let lastOnDemand = 0;
  let stopped = true;
  /** Bu açılış sırasında ilk okuması HATA veren kutular: backfill'i tıkamasınlar (diğerleri okunur), sonsuz yeniden deneme olmasın. */
  const localFailed = new Set<string>();
  const controller = { current: new AbortController() };

  const config = () => deps.policy.moduleConfig('mail');
  const intervalMinutes = () => {
    const value = Number(config().syncMinutes);
    return Number.isFinite(value) && value >= 1 ? Math.min(Math.round(value), 120) : DEFAULT_SYNC_MINUTES;
  };
  const modelScoring = () => config().modelScoring !== 'off';

  const paused = (): MailStatus['paused'] => {
    if (deps.policy.killSwitchActive()) return 'kill';
    if (!deps.policy.networkAllowed()) return 'private';
    if (!deps.cipher?.available()) return 'noCipher';
    return null;
  };

  const passwordOf = (row: AccountRow): string => {
    if (!row.secret || !deps.cipher) throw new UserError(t('mail.error.noPassword'));
    try {
      return deps.cipher.decrypt(row.secret);
    } catch {
      throw new UserError(t('mail.error.secret'));
    }
  };
  const imapOf = (row: AccountRow, password: string): transport.Endpoint => ({ host: row.imap_host, port: row.imap_port, username: row.username, password });
  const smtpOf = (row: AccountRow, password: string): transport.Endpoint => ({ host: row.smtp_host, port: row.smtp_port, username: row.username, password });

  // ───────────── zamanlayıcı ─────────────

  function schedule(ms: number) {
    if (timer !== null) timers.clear(timer);
    timer = null;
    nextAt = null;
    if (stopped || repo.accounts().length === 0) return;
    nextAt = new Date(now().getTime() + ms);
    timer = timers.set(() => void tick(), ms);
  }

  async function tick() {
    timer = null;
    const state = deps.voice.status().state;
    if ((state === 'listening' || state === 'thinking' || state === 'speaking') && postponed < MAX_POSTPONE) {
      postponed++;
      schedule(POSTPONE_MS);
      return;
    }
    postponed = 0;
    await syncAll().catch((error: unknown) => log.warn('eşitleme', { error: (error as Error).message }));
    // Yerel ilk okuma (backfill) sürüyorsa turları arka arkaya koştur (5 dk bekleme); bitince olağan aralığa dön.
    schedule(localBackfillPending() ? BACKFILL_GAP_MS : intervalMinutes() * 60_000);
  }

  // ───────────── eşitleme ─────────────

  function syncAll(accountId?: Id): Promise<number> {
    if (running) return running;
    running = (async () => {
      let added = 0;
      // IMAP yolu: yalnız ağ + şifreli depo varken (Gizli kip/acil durdurma/şifresiz: koşmaz). Yerel kaynak bunlardan bağımsızdır.
      if (!paused()) {
        for (const row of repo.accounts()) {
          if (accountId && row.id !== accountId) continue;
          if (row.kind === 'thunderbird' || !row.secret) continue;
          added += await syncAccount(row).catch((error: unknown) => {
            log.warn('hesap eşitlenemedi', { account: row.id, error: (error as Error).message });
            return 0;
          });
        }
      }
      // Yerel Thunderbird kaynağı: ağ ve parola gerekmez; yalnız acil durdurmada durur.
      if (!deps.policy.killSwitchActive()) {
        added += await syncLocal(accountId).catch((error: unknown) => {
          log.warn('yerel posta okunamadı', { error: (error as Error).message });
          return 0;
        });
      }
      return added;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  async function syncAccount(row: AccountRow): Promise<number> {
    let password: string;
    try {
      password = passwordOf(row);
    } catch (error) {
      repo.syncState(row.id, { lastError: (error as Error).message });
      bus.emit('mail.changed', { accountId: row.id, reason: 'sync' });
      return 0;
    }
    const endpoint = imapOf(row, password);
    let fetched: transport.FetchResult;
    try {
      fetched = await transport.fetchMailbox(endpoint, { uidValidity: row.uid_validity, lastUid: row.last_uid }, controller.current.signal);
    } catch (error) {
      repo.syncState(row.id, { lastError: transport.friendlyError(error, endpoint, 'imap') });
      bus.emit('mail.changed', { accountId: row.id, reason: 'sync' });
      return 0;
    }
    if (fetched.reset) repo.resetMailbox(row.id, fetched.uidValidity);
    // İlk eşitleme (ya da UIDVALIDITY değişimi): eski iletiler bildirim üretmez, yalnız kuralla puanlanır.
    const initial = fetched.reset || row.initial_done === 0;
    const own = row.address.toLowerCase();
    const inserted = repo.insertMessages(row.id, fetched.messages, (body) => oneLine(freshPart(body), 280));
    if (fetched.seen.size) repo.updateSeen(row.id, fetched.seen);
    repo.syncState(row.id, {
      uidValidity: fetched.uidValidity,
      lastUid: Math.max(fetched.highestUid, fetched.reset ? 0 : row.last_uid),
      initialDone: true,
      lastSyncAt: now().toISOString(),
      lastError: null,
    });

    await scoreAndNotify(row.id, inserted, initial, own);
    bus.emit('mail.changed', { accountId: row.id, reason: 'sync' });
    // Sınır yüzünden kalan yeni ileti varsa hemen bir tur daha (tek seferde en çok BATCH_LIMIT).
    if (fetched.more && !stopped) timers.set(() => void syncAll(row.id), 1000);
    return inserted.length;
  }

  /**
   * Yeni eklenen iletileri kuralla puanlar, belirsiz bandı modelle inceltir, önemli olanları TEK bildirimde toplar ve gözcüler
   * için `mail.received` yayar. IMAP ve yerel (Thunderbird) yollarının ortak son adımı. `initial`: ilk eşitlemenin/okumanın eski
   * iletileri bildirim ÜRETMEZ ve `mail.received` yayılmaz (geçmiş "yeni" sanılmasın). `own`: kullanıcının adresi ("bana mı geldi").
   */
  async function scoreAndNotify(accountId: Id, inserted: MessageRow[], initial: boolean, own: string): Promise<void> {
    if (!inserted.length) return;
    const rules = new Map<Id, ReturnType<typeof ruleScore>>();
    for (const message of inserted) {
      const rule = ruleScore({
        fromAddress: message.from_address,
        fromName: message.from_name,
        subject: message.subject,
        body: message.body,
        bulk: message.bulk === 1,
        direct: !message.to_text || (own ? message.to_text.split(/,\s*/).includes(own) : false),
        knownContact: repo.isContact(message.from_address),
        attachments: JSON.parse(message.attachments).length,
      });
      rules.set(message.id, rule);
      repo.setImportance(message.id, rule.score, rule.reason, 'rules');
    }
    if (!initial) await refineWithModel(inserted, rules);
    if (initial) repo.markNotified(inserted.map((message) => message.id));
    else notifyImportant(inserted.map((message) => repo.message(message.id)!).filter(Boolean));
    if (!initial) bus.emit('mail.received', { accountId, messages: inserted.map((message) => toHit(repo.message(message.id) ?? message)) });
  }

  /** Belirsiz bandı (toplu olmayan, kuralı 2–4) modelle inceltir; beyin yoksa kural puanı kalır. */
  async function refineWithModel(rows: MessageRow[], rules: Map<Id, ReturnType<typeof ruleScore>>) {
    if (!modelScoring() || !deps.brain.availability('memory').ok) return;
    const candidates = rows.filter((row) => row.bulk === 0 && row.seen === 0 && (rules.get(row.id)?.score ?? 0) >= 2).slice(0, MODEL_MAX);
    if (!candidates.length) return;
    const scores = await modelScores(deps.brain, candidates.map((row) => ({ ...row, rule: rules.get(row.id)!.score })), controller.current.signal);
    candidates.forEach((row, index) => {
      const model = scores.get(index + 1);
      const rule = rules.get(row.id)!;
      if (!model) return;
      repo.setImportance(row.id, combineScores(rule, model.score, row.bulk === 1), model.reason || rule.reason, 'model');
    });
  }

  function notifyImportant(rows: MessageRow[]) {
    const cutoff = now().getTime() - NOTIFY_MAX_AGE_MS;
    const important = rows.filter((row) => row.notified === 0 && row.seen === 0 && (row.importance ?? 0) >= 4 && Date.parse(row.date) >= cutoff);
    repo.markNotified(rows.map((row) => row.id));
    if (!important.length) return;
    important.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || b.date.localeCompare(a.date));
    const top = important[0]!;
    const name = (row: MessageRow) => row.from_name || row.from_address;
    const address = deps.settings.get().userAddress?.trim() || deps.policy.get().persona.address;
    const urgent = important.some((row) => (row.importance ?? 0) >= 5);
    const single = important.length === 1;
    deps.attention.notify({
      moduleId: 'mail',
      title: single ? t('mail.notify.one', { from: name(top) }) : t('mail.notify.many', { count: important.length }),
      body: single
        ? `${top.subject || t('mail.noSubject')}\n${top.reason ?? ''}`.trim()
        : important
            .slice(0, 5)
            .map((row) => `${name(row)} — ${row.subject || t('mail.noSubject')}`)
            .join('\n'),
      priority: 'high',
      // Yalnız 5 puanlı (acil) ileti sesle söylenir; 4 puanlı adada sessiz görünür.
      speak: urgent
        ? single
          ? t('mail.notify.spokenOne', { address, from: name(top), subject: top.subject || t('mail.noSubject') })
          : t('mail.notify.spokenMany', { address, count: important.length, from: name(top) })
        : false,
      dedupeKey: `mail.important.${important.map((row) => row.id).join(',')}`,
      data: { messageIds: important.map((row) => row.id) },
    });
  }

  // ───────────── Thunderbird'ün yerel klasörü (parolasız; `thunderbird-store.ts`) ─────────────

  const localSnippet = (body: string) => oneLine(freshPart(body), 280);

  function safeScan(): ReturnType<ThunderbirdStore['scan']> {
    try {
      return deps.localStore ? deps.localStore.scan() : { found: false, profile: null, profileDir: null, boxes: [] };
    } catch (error) {
      log.warn('yerel posta taranamadı', { error: (error as Error).message });
      return { found: false, profile: null, profileDir: null, boxes: [] };
    }
  }

  /** Kutuları okuma sırasına koyar: INBOX'lar önce (kullanıcı en çok geleni görmek ister), sonra kararlı yol sırası. */
  const inboxFirst = (boxes: ReturnType<ThunderbirdStore['scan']>['boxes']) =>
    [...boxes].sort((a, b) => (a.mailbox.toLowerCase() === 'inbox' ? 0 : 1) - (b.mailbox.toLowerCase() === 'inbox' ? 0 : 1) || a.relPath.localeCompare(b.relPath));

  /** Henüz hiç okunmamış (imleci olmayan, hata vermemiş) bir kutu var mı — yani ilk okuma (backfill) sürüyor mu. Taramaz: ucuz. */
  function localBackfillPending(): boolean {
    if (!repo.localAccount()) return false;
    for (const box of safeScan().boxes) {
      if (!localFailed.has(box.relPath) && !repo.localCursor(box.relPath)) return true;
    }
    return false;
  }

  /**
   * Yerel kaynağı bir TUR okur: her mbox'ı imlecinden sonrasını ayrıştırıp yeni iletileri yazar, sonra IMAP yolundaki gibi
   * puanlar/bildirir/`mail.received` yayar. Tur başına en çok `INITIAL_BOXES_PER_ROUND` YENİ kutu okunur (ilerleme görünür,
   * ses turuna yer kalır); kalan yeni kutular sonraki turda. Bir kutunun İLK okuması (imleci yoktu) ya da hesabın ilk
   * okuması bildirim ÜRETMEZ (geçmiş "yeni" sanılmasın). Zaten okunmuş kutular her tur ucuzca (stat) yoklanır; büyümüşse
   * yeni iletiler okunur ve `mail.received` yayılır. Ağ ve parola gerekmez; Thunderbird kapalıyken de son içerik okunur.
   */
  function syncLocal(accountId?: Id): Promise<number> {
    if (localRunning) return localRunning;
    localRunning = runLocalRound(accountId).finally(() => {
      localRunning = null;
    });
    return localRunning;
  }

  async function runLocalRound(accountId?: Id): Promise<number> {
    if (!deps.localStore) return 0;
    const local = repo.localAccount();
    if (!local) return 0;
    if (accountId && accountId !== local.id) return 0;

    const accountInitial = local.initial_done === 0;
    const initialBatch: MessageRow[] = [];
    const freshBatch: MessageRow[] = [];
    let newBoxes = 0;
    for (const box of inboxFirst(safeScan().boxes)) {
      const stored = repo.localCursor(box.relPath);
      const hadCursor = Boolean(stored);
      // Tur başına yeni (hiç okunmamış) kutu sınırı: kalanı sonraki tura bırak (ilerleme görünür kalsın).
      if (!hadCursor) {
        if (newBoxes >= INITIAL_BOXES_PER_ROUND) continue;
        newBoxes++;
      }
      const cursor = stored ? { size: stored.size, mtimeMs: stored.mtime_ms, lastOffset: stored.last_offset, lastMessageId: stored.last_message_id } : null;
      const result = await deps.localStore.readBox(box, cursor).catch((error: unknown) => {
        log.warn('mbox okunamadı', { box: box.relPath, error: (error as Error).message });
        localFailed.add(box.relPath); // bu açılışta bir daha deneme (backfill'i tıkamasın)
        return null;
      });
      if (!result) continue;
      localFailed.delete(box.relPath);
      if (result.messages.length) {
        const inserted = repo.insertMessages(local.id, result.messages, localSnippet);
        // Bir kutunun İLK okuması (imleci yoktu) ya da hesabın ilk okuması "geçmiş"tir: bildirim üretmez.
        (!hadCursor || accountInitial ? initialBatch : freshBatch).push(...inserted);
      }
      if (result.changed) repo.saveLocalCursor(box.relPath, box.account, box.mailbox, result.cursor);
      // Her yeni kutudan sonra ilerleme yay (açılışta sayı artarken görünür olsun).
      if (!hadCursor) bus.emit('mail.changed', { accountId: local.id, reason: 'sync' });
    }
    await scoreAndNotify(local.id, initialBatch, true, '');
    await scoreAndNotify(local.id, freshBatch, false, '');
    repo.syncState(local.id, { initialDone: true, lastSyncAt: now().toISOString(), lastError: null });
    bus.emit('mail.changed', { accountId: local.id, reason: 'sync' });
    return initialBatch.length + freshBatch.length;
  }

  /**
   * İlk okuma (backfill) bitene kadar turları ARKA ARKAYA koşturur (await döngüsü); her tur arasında kısa nefes, sesli tur
   * sürerken erteleme (mevcut kural). Her tur `mail.changed` yaydığı için arayüzde sayı canlı artar. Üretimde `setLocalEnabled`
   * bunu bekler ama olaylar anında gittiğinden arayüz bloklanmaz; sınamada da (enjekte zamanlayıcıdan bağımsız) ilerler.
   */
  async function runBackfill(): Promise<void> {
    for (let round = 0; round < MAX_BACKFILL_ROUNDS; round++) {
      // `stopped`'a bakma: `setLocalEnabled` kullanıcı eylemidir ve onu bekler; kapanış (teardown) için acil durdurma ve hesap varlığı yeter.
      if (deps.policy.killSwitchActive() || !deps.localStore || !repo.localAccount()) return;
      // Sesli tur sürerken ertele (yerel model/ağ sesle yarışmasın).
      for (let wait = 0; wait < MAX_POSTPONE; wait++) {
        const state = deps.voice.status().state;
        if (state !== 'listening' && state !== 'thinking' && state !== 'speaking') break;
        await sleep(POSTPONE_MS);
      }
      await syncLocal().catch((error: unknown) => (log.warn('yerel backfill turu', { error: (error as Error).message }), 0));
      if (!localBackfillPending()) return;
      await sleep(BACKFILL_BREATH_MS);
    }
  }

  function localStatus(): MailLocalStatus {
    const local = repo.localAccount();
    const scan = safeScan();
    const view = local ? repo.accountView(local) : null;
    return {
      found: scan.found,
      profile: scan.profile,
      enabled: Boolean(local),
      boxes: scan.boxes.map((box) => ({ account: box.account, mailbox: box.mailbox, path: box.relPath })),
      accountId: local?.id ?? null,
      messageCount: view?.messageCount ?? 0,
      // İlk okuma (backfill) sürüyor mu: açık ve henüz hiç okunmamış (imleci olmayan, hata vermemiş) kutu var. Aynı taramadan hesaplanır.
      reading: Boolean(local) && scan.boxes.some((box) => !localFailed.has(box.relPath) && !repo.localCursor(box.relPath)),
      lastReadAt: local?.last_sync_at ?? null,
      customRoot: repo.localRoot() !== null,
    };
  }

  /** Yerel kaynağı açar (hesap satırı + ilk okuma) ya da kapatır (hesap, iletileri, imleçleri siler). */
  async function setLocalEnabled(enabled: boolean): Promise<MailLocalStatus> {
    if (enabled) {
      if (!repo.localAccount()) {
        repo.ensureLocalAccount(t('mail.local.accountLabel'));
        log.info('yerel posta kaynağı açıldı');
      }
      localFailed.clear();
      bus.emit('mail.changed', { accountId: null, reason: 'account' });
      // İlk okumayı HIZLI, SINIRLI (en yeni) ve GÖRÜNÜR yap: turları arka arkaya koştur; her tur `mail.changed` yayar.
      await runBackfill();
      schedule(intervalMinutes() * 60_000);
    } else {
      repo.removeLocalAccount();
      localFailed.clear();
      log.info('yerel posta kaynağı kapatıldı');
      bus.emit('mail.changed', { accountId: null, reason: 'account' });
      if (!repo.accounts().length) schedule(0);
    }
    return localStatus();
  }

  /** Özel profil kökünü ayarlar (otomatik bulunamazsa seçilen klasör); açıksa yeni profili baştan okur (backfill). */
  async function setLocalRoot(root: string | null): Promise<MailLocalStatus> {
    repo.setLocalRoot(root);
    if (repo.localAccount()) {
      localFailed.clear();
      await runBackfill();
    }
    return localStatus();
  }

  // ───────────── hesaplar ─────────────

  /** Formu kayıtlı hesapla birleştirir; parola: formdaki, yoksa (bağlantı aynıysa) kayıtlı. */
  function resolveInput(raw: MailAccountInput): { input: MailAccountInput; password: string | null; existing: AccountRow | undefined } {
    const input = trimAccountInput(raw);
    input.address = input.address.toLowerCase();
    const existing = (input.id ? repo.account(input.id) : undefined) ?? repo.accountByAddress(input.address);
    if (existing) input.id = existing.id;
    const username = input.username?.trim() || input.address;
    const connection = { address: input.address, username, imapHost: input.imapHost, imapPort: input.imapPort, smtpHost: input.smtpHost, smtpPort: input.smtpPort };
    const stored = existing
      ? { address: existing.address, username: existing.username, imapHost: existing.imap_host, imapPort: existing.imap_port, smtpHost: existing.smtp_host, smtpPort: existing.smtp_port }
      : null;
    let password: string | null = input.password ? input.password : null;
    // Kayıtlı parola YALNIZ kaydedildiği bağlantıya gider (v1 düzeltme turu 2).
    if (!password && existing?.secret && stored && sameConnection(stored, connection)) password = passwordOf(existing);
    return { input: { ...input, username }, password, existing };
  }

  async function test(raw: MailAccountInput): Promise<MailTestResult> {
    const { input, password, existing } = resolveInput(raw);
    const problem = accountFormProblem(input, !password);
    if (problem) {
      const changed = existing?.secret && !raw.password && problem === t('mail.form.needPassword') ? t('mail.form.passwordAgain') : problem;
      return { imap: false, smtp: false, error: changed, text: testResultText({ imap: false, smtp: false, error: changed }) };
    }
    if (!deps.policy.networkAllowed()) {
      const error = t('mail.paused.private');
      return { imap: false, smtp: false, error, text: testResultText({ imap: false, smtp: false, error }) };
    }
    const endpoint: transport.Endpoint = { host: input.imapHost, port: input.imapPort, username: input.username!, password: password! };
    const smtpEndpoint: transport.Endpoint = { ...endpoint, host: input.smtpHost, port: input.smtpPort };
    const result = { imap: false, smtp: false, error: null as string | null };
    const errors: string[] = [];
    try {
      await transport.verifyImap(endpoint);
      result.imap = true;
    } catch (error) {
      errors.push(`${t('mail.test.read')}: ${transport.friendlyError(error, endpoint, 'imap')}`);
    }
    try {
      await transport.verifySmtp(smtpEndpoint);
      result.smtp = true;
    } catch (error) {
      errors.push(`${t('mail.test.send')}: ${transport.friendlyError(error, smtpEndpoint, 'smtp')}`);
    }
    result.error = errors.length ? errors.join(' ') : null;
    return { ...result, text: testResultText(result) };
  }

  async function save(raw: MailAccountInput): Promise<{ saved: boolean; account: MailAccountView | null; test: MailTestResult }> {
    if (!deps.cipher?.available()) {
      const error = t('mail.error.noCipher');
      return { saved: false, account: null, test: { imap: false, smtp: false, error, text: error } };
    }
    const result = await test(raw);
    if (!result.imap) return { saved: false, account: null, test: result };
    const { input, password } = resolveInput(raw);
    const label = input.label?.trim() || input.address;
    const row = repo.upsertAccount({
      id: input.id,
      provider: input.provider,
      label,
      address: input.address,
      username: input.username!,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      // Yalnız yeni parola verildiyse yeniden şifrelenir; düz metin hiçbir yere yazılmaz.
      secret: raw.password ? deps.cipher.encrypt(password!) : undefined,
    });
    log.info('e-posta hesabı kaydedildi', { account: row.id, provider: row.provider });
    bus.emit('mail.changed', { accountId: row.id, reason: 'account' });
    // İlk eşitleme arka planda; ardından aralıklı eşitleme kurulur.
    void syncAll(row.id).finally(() => schedule(intervalMinutes() * 60_000));
    return { saved: true, account: repo.accountView(repo.account(row.id)!), test: result };
  }

  /**
   * Başka programdan (Thunderbird) gelen hesap ayarlarını ekler. Elle eklemeden farkı: okuma sınanamasa da hesap KAYDEDİLİR
   * (parolasız, "parola bekliyor"); parola yalnız okuma geçtiyse şifreli depoya yazılır. Adres zaten ekliyse dokunulmaz.
   */
  async function importAccount(raw: MailAccountInput, options: { oauth: boolean }): Promise<{ status: MailImportStatus; text: string; accountId: Id | null }> {
    const input = trimAccountInput(raw);
    input.address = input.address.toLowerCase();
    if (repo.accountByAddress(input.address)) return { status: 'exists', text: t('mail.import.status.exists'), accountId: null };
    const username = input.username?.trim() || input.address;
    const password = raw.password || null;
    let secret: string | null = null;
    let status: MailImportStatus;
    let text: string;
    if (!password) {
      status = options.oauth ? 'loginRequired' : 'passwordPending';
      text = t(options.oauth ? 'mail.import.status.loginRequired' : 'mail.import.status.passwordPending');
    } else if (!deps.cipher?.available()) {
      status = 'failed';
      text = t('mail.import.status.noCipher');
    } else if (!deps.policy.networkAllowed() || deps.policy.killSwitchActive()) {
      status = 'passwordPending';
      text = t('mail.import.status.private');
    } else {
      const endpoint: transport.Endpoint = { host: input.imapHost, port: input.imapPort, username, password };
      const smtpEndpoint: transport.Endpoint = { ...endpoint, host: input.smtpHost, port: input.smtpPort };
      let imapError: unknown = null;
      try {
        await transport.verifyImap(endpoint);
      } catch (error) {
        imapError = error;
      }
      if (imapError === null) {
        // Okuma geçti: parola yalnız şimdi, şifreli olarak saklanır.
        secret = deps.cipher.encrypt(password);
        try {
          await transport.verifySmtp(smtpEndpoint);
          status = 'connected';
          text = t('mail.import.status.connected');
        } catch (error) {
          status = 'sendFailed';
          text = t('mail.import.status.sendFailed', { error: transport.friendlyError(error, smtpEndpoint, 'smtp') });
        }
      } else {
        const kind = transport.errorKind(imapError);
        const detail = transport.friendlyError(imapError, endpoint, 'imap');
        if (kind === 'auth') {
          status = options.oauth ? 'loginRequired' : 'wrongPassword';
          text = t(options.oauth ? 'mail.import.status.oauthRejected' : 'mail.import.status.wrongPassword');
        } else if (kind === 'unreachable') {
          status = 'unreachable';
          text = t('mail.import.status.unreachable', { error: detail });
        } else {
          status = 'failed';
          text = detail;
        }
      }
    }
    const row = repo.upsertAccount({
      provider: input.provider,
      label: input.label?.trim() || input.address,
      address: input.address,
      username,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      secret,
    });
    log.info('e-posta hesabı içe aktarıldı', { account: row.id, provider: row.provider, status });
    bus.emit('mail.changed', { accountId: row.id, reason: 'account' });
    if (secret) void syncAll(row.id).finally(() => schedule(intervalMinutes() * 60_000));
    return { status, text, accountId: row.id };
  }

  function remove(id: Id): void {
    repo.removeAccount(id);
    log.info('e-posta hesabı kaldırıldı', { account: id });
    bus.emit('mail.changed', { accountId: id, reason: 'account' });
    if (!repo.accounts().length) schedule(0);
  }

  function status(): MailStatus {
    const rows = repo.accounts();
    const synced = rows.map((row) => row.last_sync_at).filter((value): value is string => Boolean(value));
    return {
      accounts: rows.length,
      syncing: running !== null,
      lastSyncAt: synced.length ? synced.sort()[synced.length - 1]! : null,
      nextSyncAt: nextAt ? nextAt.toISOString() : null,
      paused: paused(),
      intervalMinutes: intervalMinutes(),
    };
  }

  /** Araç ya da başka modül hemen eşitleme isterse: dakikada en çok bir kez; süren eşitleme varsa onu bekler. */
  async function syncSoon(accountId?: Id, waitMs = 20_000): Promise<void> {
    if (!repo.accounts().length) return;
    if (running) {
      await Promise.race([running, sleep(waitMs)]);
      return;
    }
    if (now().getTime() - lastOnDemand < ON_DEMAND_MIN_MS) return;
    lastOnDemand = now().getTime();
    await Promise.race([syncAll(accountId), sleep(waitMs)]);
  }

  // ───────────── sorgu ─────────────

  function query(q: MailQuery): MailQueryResult {
    const rows = repo.accounts();
    if (!rows.length) return { available: false, hits: [], lastSyncAt: null };
    const synced = rows.map((row) => row.last_sync_at);
    const oldest = synced.some((value) => !value) ? null : (synced as string[]).sort()[0]!;
    return { available: paused() === null, hits: repo.list(queryFilter(q)).map(toHit), lastSyncAt: oldest };
  }

  function important(limit = 5): MailSummary[] {
    return repo.important(Math.min(Math.max(1, limit), 20), 3).map(toSummary);
  }

  /** Sabah özeti satırı: dünden bu yana okunmamış önemli iletiler. */
  function briefLine(): string | null {
    const rows = repo.important(5, 1);
    if (!rows.length) return null;
    const list = rows
      .slice(0, 3)
      .map((row) => `${row.from_name || row.from_address}: ${oneLine(row.subject || t('mail.noSubject'), 60)}`)
      .join('; ');
    return t('mail.brief.line', { count: rows.length, list });
  }

  // ───────────── taslak ve gönderim ─────────────

  const accountForSend = (accountId?: Id): AccountRow => {
    const rows = repo.accounts().filter((row) => row.secret);
    const row = accountId ? rows.find((candidate) => candidate.id === accountId) : rows[0];
    if (!row) throw new UserError(t('mail.error.noAccount'));
    return row;
  };

  function draftReply(message: MessageRow, body: string, cc?: string): DraftRow {
    const subject = /^(re|ynt|yanit)\s*:/i.test(message.subject) ? message.subject : `Re: ${message.subject || t('mail.noSubject')}`;
    const existing = repo.recentDraftFor(message.id, 2 * 60_000);
    if (existing) {
      repo.updateDraftBody(existing.id, body);
      return repo.draft(existing.id)!;
    }
    const draft = repo.createDraft({
      account_id: message.account_id,
      to_text: message.reply_to || message.from_address,
      cc_text: cc ?? '',
      subject,
      body,
      in_reply_to: message.message_id,
      refs: message.refs,
      reply_to_message: message.id,
    });
    bus.emit('mail.changed', { accountId: message.account_id, reason: 'draft' });
    return draft;
  }

  function draftNew(fields: { to: string; cc?: string | undefined; subject: string; body: string; accountId?: Id | undefined }): DraftRow {
    const account = accountForSend(fields.accountId);
    const draft = repo.createDraft({ account_id: account.id, to_text: fields.to, cc_text: fields.cc ?? '', subject: fields.subject, body: fields.body, in_reply_to: null, refs: null, reply_to_message: null });
    bus.emit('mail.changed', { accountId: account.id, reason: 'draft' });
    return draft;
  }

  /** Taslağın GERÇEKTEN gideceği hâli (onay kartı ve gönderim aynı işlevi kullanır). */
  function outgoing(draft: DraftRow): { account: AccountRow; to: string[]; cc: string[]; subject: string; body: string } | { error: string } {
    const account = repo.account(draft.account_id);
    if (!account?.secret) return { error: t('mail.error.noAccount') };
    const recipients = allRecipients({ to: draft.to_text, cc: draft.cc_text });
    if (!recipients) return { error: t('mail.error.recipients') };
    return { account, to: recipients.to, cc: recipients.cc, subject: draft.subject, body: draft.body };
  }

  async function sendDraft(draft: DraftRow): Promise<{ messageId: string; to: string[]; cc: string[] }> {
    if (draft.status === 'sent') throw new UserError(t('mail.error.alreadySent'));
    const why = paused();
    if (why === 'private' || why === 'kill') throw new UserError(t(`mail.paused.${why}`));
    const mail = outgoing(draft);
    if ('error' in mail) throw new UserError(mail.error);
    const endpoint = smtpOf(mail.account, passwordOf(mail.account));
    const name = mail.account.label && mail.account.label !== mail.account.address ? mail.account.label : deps.settings.get().userName?.trim() || '';
    try {
      const result = await transport.sendMail(endpoint, {
        from: { name, address: mail.account.address },
        to: mail.to,
        cc: mail.cc,
        subject: mail.subject,
        text: mail.body,
        inReplyTo: draft.in_reply_to,
        references: draft.refs,
      });
      repo.markDraftSent(draft.id, result.messageId);
      repo.addContacts([...mail.to, ...mail.cc]);
      log.info('e-posta gönderildi', { account: mail.account.id, recipients: mail.to.length + mail.cc.length });
      bus.emit('mail.changed', { accountId: mail.account.id, reason: 'sent' });
      return { messageId: result.messageId, to: mail.to, cc: mail.cc };
    } catch (error) {
      throw new UserError(transport.friendlyError(error, endpoint, 'smtp'));
    }
  }

  /** Eki İndirilenler altındaki "Fuber AI e-posta ekleri" klasörüne yazar (belgeler modülü oradan okuyabilir). */
  async function saveAttachment(message: MessageRow, index: number): Promise<{ path: string; name: string; bytes: number }> {
    const account = repo.account(message.account_id);
    if (!account?.secret) throw new UserError(t('mail.error.noAccount'));
    const endpoint = imapOf(account, passwordOf(account));
    let file: Awaited<ReturnType<typeof transport.fetchAttachment>>;
    try {
      file = await transport.fetchAttachment(endpoint, message.uid, index);
    } catch (error) {
      throw new UserError(transport.friendlyError(error, endpoint, 'imap'));
    }
    if (!file) throw new UserError(t('mail.error.noAttachment'));
    const name = safeFileName(file.name);
    if (BLOCKED_ATTACHMENT.test(name)) throw new UserError(t('mail.error.blockedAttachment', { name }));
    const folder = nodePath.join(deps.downloadsDir(), t('mail.attachments.folder'));
    fs.mkdirSync(folder, { recursive: true });
    const ext = nodePath.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let target = nodePath.join(folder, name);
    for (let n = 2; fs.existsSync(target); n++) target = nodePath.join(folder, `${stem} (${n})${ext}`);
    fs.writeFileSync(target, file.data, { flag: 'wx' });
    return { path: target, name: nodePath.basename(target), bytes: file.data.length };
  }

  function list(filter: ListFilter): MessageRow[] {
    return repo.list(filter);
  }

  return {
    repo,
    presets: () => [...MAIL_PRESETS],
    accounts: (): MailAccountView[] => repo.views(),
    hasAccounts: () => repo.accounts().length > 0,
    test,
    save,
    importAccount,
    remove,
    status,
    syncAll,
    syncSoon,
    syncLocal,
    localStatus,
    setLocalEnabled,
    setLocalRoot,
    localScan: safeScan,
    query,
    important,
    briefLine,
    list,
    draftReply,
    draftNew,
    outgoing,
    sendDraft,
    saveAttachment,
    start() {
      stopped = false;
      controller.current = new AbortController();
      const removed = repo.prune(KEEP_DAYS, KEEP_PER_ACCOUNT);
      if (removed) log.info(`${removed} eski e-posta silindi`);
      // Açılışta hemen değil, kısa bir süre sonra (açılış yükü bitsin): yalnız hesap varsa.
      schedule(20_000);
    },
    stop() {
      stopped = true;
      controller.current.abort();
      if (timer !== null) timers.clear(timer);
      timer = null;
      nextAt = null;
    },
    /** Bekleyen eşitleme (sınama ve kapanış için). */
    idle: () => running ?? Promise.resolve(0),
    lastSyncAt: (): IsoDateTime | null => status().lastSyncAt,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export { createMailRepo };
