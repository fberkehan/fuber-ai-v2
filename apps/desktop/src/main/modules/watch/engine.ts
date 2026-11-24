// İşlerin zamanlayıcısı (G5). Fuber AI 1 `main/isler/zamanlayici.ts` düzeninden: TEK zamanlayıcı zinciri en yakın
// denetime kurulur; uyanınca vakti gelen her çalışan iş için:
//   son tarih geçti mi → kaynak var mı, kullanılabilir mi → gözcü (YAPAY ZEKÂSIZ) → koşul (kod) →
//   yalnız koşul `ask` ise VE içerik değiştiyse model (çağrı bütçesiyle) → haber (Dikkat Yöneticisi) → sonraki aralık.
// Değişiklik yoksa model ÇAĞRILMAZ ve aralık ×1,5 büyür (üst sınırla); değişince en kısaya döner.
// Kuşak: her duraklatma/sürdürme/iptal işin kuşağını artırır; süren denetimin geç sonucu (eski kuşak) hiçbir şey yazmaz.
// Uygulama kapanınca işler veritabanında "çalışıyor" kalır; açılışta kaldıkları yerden sürer (son tarihi geçen biter).
// v1'den ayrılan karar: v1 açılışta işleri "kapanış" nedeniyle durdurup "Sürdür" isterdi; v2'de görev tanımı gereği
// kendiliğinden sürer (gözcü yalnız okur; yazma isteyen eylem her seferinde yeniden onay ister).
import { newId, t, UserError, type Channel, type Id, type JsonObject, type Logger, type NotifyRequest, type ToolResult } from '@fuber/shared';
import {
  BASELINE_CHARS,
  DEFAULT_MAX_ACTIVE,
  MAX_ERRORS,
  evaluate,
  nextInterval,
  type EvalResult,
} from './rules';
import { conditionText } from './describe';
import { toJob, type JobPatch, type JobRecord, type WatchRepo } from './repo';
import type { WatchAction, WatchJob, WatchPlan, WatchReason, WatchSourceDef, WatchSourceInfo, WatchStatus } from './types';

export interface JudgeInput {
  question: string;
  /** Kaynağın şimdiki metni (güvenilmez veri). */
  text: string;
  /** Kodun bulduğu değişiklik anlatımı. */
  change: string;
  signal: AbortSignal;
}
/** Model kararı. `null`: model yanıt veremedi (anahtar yok, ağ, ret). */
export type Judge = (input: JudgeInput) => Promise<{ match: boolean; finding: string } | null>;

export interface EngineDeps {
  repo: WatchRepo;
  /** Yerleşik + takılı kaynaklar (her çağrıda yeniden toplanır: modül kapanınca kaynağı düşer). */
  sources(): WatchSourceDef[];
  judge: Judge;
  notify(request: NotifyRequest): void;
  /** İşi başlatan sohbete haber satırı. */
  appendChat?(sessionId: Id, channel: Channel, text: string): void;
  /** Koşul tutunca eylem: okuma aracı doğrudan, öteki her seferinde yeniden onayla (`index.ts`). */
  runAction(action: WatchAction, job: WatchJob, signal: AbortSignal): Promise<ToolResult>;
  killSwitchActive(): boolean;
  maxActive?(): number;
  emit(job: WatchJob | null, op: 'created' | 'updated' | 'deleted', id: Id): void;
  log: Logger;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Tek denetimin en uzun süresi (ms). */
  checkTimeoutMs?: number;
}

export interface CreateInput {
  title: string;
  goal: string;
  plan: WatchPlan;
  sessionId?: Id | null;
  channel?: Channel | null;
}

/** Kullanıcıya olduğu gibi gösterilebilen ret (IPC'de `UserError` olarak geçer). */
export class WatchError extends UserError {
  constructor(message: string) {
    super(message);
    this.name = 'WatchError';
  }
}

export interface WatchEngine {
  /** Açılış: çalışan işleri kaldıkları yerden sürdürür; son tarihi geçenleri bitirir. */
  start(): void;
  /** Kapanış ya da modül kapanması: zamanlayıcı, abonelik ve süren denetimler bırakılır; kayıtlar "çalışıyor" kalır. */
  stop(): void;
  create(input: CreateInput): WatchJob;
  get(id: Id): WatchJob | null;
  list(filter?: { status?: WatchStatus[]; limit?: number }): WatchJob[];
  /** Kimlik, kimliğin başı ya da başlıkta geçen sözcükle bulur. */
  find(query: string): WatchJob[];
  pause(id: Id, reason?: WatchReason): WatchJob;
  resume(id: Id): WatchJob;
  cancel(id: Id): WatchJob;
  remove(id: Id): void;
  /** Bütün çalışan işleri duraklatır (acil durdurma); duraklatılan sayısı. */
  pauseAll(reason: 'panic' | 'policy'): number;
  /** Beklemeden şimdi denetler; denetim bitince işin son hâlini döndürür. */
  checkNow(id: Id): Promise<WatchJob>;
  sources(): WatchSourceInfo[];
  /** Kaynak türüne göre tanım (yoksa `null`). */
  source(kind: string): WatchSourceDef | null;
  /** Sınama: süren denetimler bitene dek bekler. */
  idle(): Promise<void>;
}

const MAX_TIMER_MS = 60 * 60_000;
const POKE_DEBOUNCE_MS = 1_000;
/** Açılışta kaynağı henüz kayıtta olmayan (modülü sonra kurulan) işlerin aboneliği bu kadar sonra bir kez daha denenir. */
const START_SUBSCRIBE_RETRY_MS = 15_000;

const iso = (ms: number) => new Date(ms).toISOString();
const clip = (text: string, n: number) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export function createWatchEngine(deps: EngineDeps): WatchEngine {
  const { repo, log } = deps;
  const checkTimeoutMs = deps.checkTimeoutMs ?? 45_000;
  let timer: unknown = null;
  let stopped = true;
  const inflight = new Map<Id, { controller: AbortController; done: Promise<void> }>();
  const generation = new Map<Id, number>();
  const subscriptions = new Map<Id, () => void>();
  const pokeTimers = new Map<Id, unknown>();

  const gen = (id: Id) => generation.get(id) ?? 0;
  const bump = (id: Id) => generation.set(id, gen(id) + 1);
  const findSource = (kind: string) => deps.sources().find((source) => source.kind === kind) ?? null;
  const maxActive = () => Math.max(1, Math.min(10, Math.round(deps.maxActive?.() ?? DEFAULT_MAX_ACTIVE)));

  const save = (id: Id, patch: JobPatch, op: 'updated' | 'created' = 'updated'): JobRecord | null => {
    const record = repo.update(id, { ...patch, updatedAt: iso(deps.now()) });
    if (record) deps.emit(toJob(record), op, id);
    return record;
  };

  const unsubscribe = (id: Id) => {
    subscriptions.get(id)?.();
    subscriptions.delete(id);
    const poke = pokeTimers.get(id);
    if (poke !== undefined) deps.clearTimer(poke);
    pokeTimers.delete(id);
  };

  /** Olay kaynağı yeni olay bildirince iş beklemeden denetlenir (art arda gelenler tek denetime katlanır). */
  const subscribe = (record: JobRecord, source: WatchSourceDef) => {
    if (!source.subscribe || subscriptions.has(record.id)) return;
    const id = record.id;
    subscriptions.set(
      id,
      source.subscribe(record.plan.source.target, () => {
        if (stopped || pokeTimers.has(id)) return;
        pokeTimers.set(
          id,
          deps.setTimer(() => {
            pokeTimers.delete(id);
            const current = repo.get(id);
            if (!current || current.status !== 'running') return;
            repo.update(id, { nextCheckAt: iso(deps.now()) });
            plan();
          }, POKE_DEBOUNCE_MS),
        );
      }),
    );
  };

  // ───────────── zincir ─────────────

  function plan(): void {
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
    if (stopped) return;
    let running: JobRecord[];
    try {
      running = repo.list({ status: ['running'], limit: 500 }).filter((record) => !inflight.has(record.id));
    } catch (error) {
      log.warn('işler okunamadı; 30 sn sonra yeniden', error);
      timer = deps.setTimer(() => {
        timer = null;
        plan();
      }, 30_000);
      return;
    }
    if (!running.length) return;
    const due = Math.min(...running.map((record) => (record.nextCheckAt ? Date.parse(record.nextCheckAt) : deps.now())));
    timer = deps.setTimer(
      () => {
        timer = null;
        tick();
      },
      Math.min(MAX_TIMER_MS, Math.max(0, due - deps.now())),
    );
  }

  function tick(): void {
    if (stopped) return;
    if (deps.killSwitchActive()) {
      pauseAll('policy');
      return;
    }
    const now = deps.now();
    let running: JobRecord[] = [];
    try {
      running = repo.list({ status: ['running'], limit: 500 });
    } catch (error) {
      log.warn('işler okunamadı', error);
    }
    for (const record of running) {
      if (inflight.has(record.id)) continue;
      if (record.nextCheckAt && Date.parse(record.nextCheckAt) > now) continue;
      launch(record.id);
    }
    plan();
  }

  function launch(id: Id): Promise<void> {
    const existing = inflight.get(id);
    if (existing) return existing.done;
    const controller = new AbortController();
    const mine = gen(id);
    const done = check(id, mine, controller.signal)
      .catch((error: unknown) => {
        log.warn(`iş denetlenemedi: ${id}`, error);
        if (gen(id) !== mine) return;
        const record = repo.get(id);
        if (record?.status === 'running') failCheck(record, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        inflight.delete(id);
        plan();
      });
    inflight.set(id, { controller, done });
    return done;
  }

  const stale = (id: Id, mine: number) => gen(id) !== mine || stopped;

  /** Bu kadar sonra yeniden (son tarihten sonraya kurulmaz: bitiş zamanında denetlenip biter). */
  const nextAt = (record: JobRecord, seconds: number, wakeAt?: number) => {
    const until = Date.parse(record.plan.untilAt);
    const want = wakeAt ?? deps.now() + seconds * 1000;
    return iso(Math.min(until, Math.max(deps.now(), want)));
  };

  /** Başarısız denetim: değişmedi sayılır (aralık büyür); üst üste `MAX_ERRORS`'ta iş duraklar. */
  function failCheck(record: JobRecord, message: string): void {
    const errors = record.errors + 1;
    const interval = nextInterval(record.intervalSec, false, record.plan.interval);
    if (errors >= MAX_ERRORS) {
      bump(record.id);
      unsubscribe(record.id);
      save(record.id, { status: 'paused', reason: 'errors', errors, lastError: clip(message, 300), lastCheckAt: iso(deps.now()), checks: record.checks + 1, nextCheckAt: null });
      deps.notify({
        moduleId: 'watch',
        title: t('watch.notify.errorsTitle', { title: record.title }),
        body: t('watch.notify.errorsBody', { error: clip(message, 200) }),
        priority: 'normal',
        speak: false,
        actions: [{ id: 'watch.open', label: t('watch.notify.open'), kind: 'primary' }],
        dedupeKey: `watch.${record.id}.errors`,
        data: { jobId: record.id },
      });
      return;
    }
    save(record.id, { errors, lastError: clip(message, 300), lastCheckAt: iso(deps.now()), checks: record.checks + 1, intervalSec: interval, nextCheckAt: nextAt(record, interval) });
  }

  /** Denetlenemeyen (kaynak yok ya da kullanılamaz) iş: hata sayılmaz, aralık büyür, neden görünür. */
  function skip(record: JobRecord, message: string): void {
    const interval = nextInterval(record.intervalSec, false, record.plan.interval);
    save(record.id, { lastError: clip(message, 300), intervalSec: interval, nextCheckAt: nextAt(record, interval) });
  }

  async function check(id: Id, mine: number, signal: AbortSignal): Promise<void> {
    let record = repo.get(id);
    if (!record || record.status !== 'running' || stale(id, mine)) return;
    if (deps.killSwitchActive()) {
      pauseAll('policy');
      return;
    }
    const now = deps.now();
    if (now >= Date.parse(record.plan.untilAt)) {
      finish(record, 'expired');
      return;
    }
    const source = findSource(record.plan.source.kind);
    if (!source) return skip(record, t('watch.error.sourceGone', { kind: record.plan.source.kind }));
    // Abonelik kaynak o an kullanılamasa da kurulur (d6): açılışta WhatsApp henüz bağlanırken ilk denetim "kullanılamıyor"
    // diye atlanınca abonelik bir sonraki denetime (10–15 dk) kalıyor, "Ahmet yazınca haber ver" hemen tetiklenmiyordu.
    subscribe(record, source);
    const unavailable = source.available?.() ?? null;
    if (unavailable) return skip(record, unavailable);

    const timeout = new AbortController();
    const onAbort = () => timeout.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const limit = deps.setTimer(() => timeout.abort(), checkTimeoutMs);
    let probe;
    try {
      probe = await Promise.race([
        source.check({ target: record.plan.source.target, previous: record.signature, since: Date.parse(record.createdAt), signal: timeout.signal }),
        new Promise<never>((_resolve, reject) => timeout.signal.addEventListener('abort', () => reject(new Error(t('watch.error.timeout'))), { once: true })),
      ]);
    } catch (error) {
      if (stale(id, mine)) return;
      const fresh = repo.get(id);
      if (fresh?.status === 'running') failCheck(fresh, error instanceof Error ? error.message : String(error));
      return;
    } finally {
      deps.clearTimer(limit);
      signal.removeEventListener('abort', onAbort);
    }
    if (stale(id, mine)) return;
    record = repo.get(id);
    if (!record || record.status !== 'running') return;

    const first = record.signature === null;
    const changed = source.mode === 'events' ? probe.text.trim().length > 0 : !first && probe.signature !== record.signature;
    let result: EvalResult = probe.fire
      ? { holds: true, fire: true, value: null, finding: probe.finding ?? t('watch.finding.time'), needsModel: false }
      : evaluate(
          record.plan.condition,
          {
            text: probe.text,
            previousText: source.mode === 'state' ? record.baseline : null,
            previousValue: record.lastValue,
            previousMatch: record.lastMatch,
            first,
            changed,
            ...(probe.finding ? { sourceFinding: probe.finding } : {}),
          },
          source.mode,
        );

    let modelCalls = record.modelCalls;
    let lastError: string | null = null;
    if (result.needsModel && record.plan.condition.type === 'ask') {
      if (modelCalls >= record.plan.maxModelCalls) {
        // İmza kaydedilir ki aynı değişiklik yeniden sayılmasın; iş bütçe dolduğu için biter.
        save(id, { signature: probe.signature, baseline: source.mode === 'state' ? probe.text.slice(0, BASELINE_CHARS) : null, checks: record.checks + 1, lastCheckAt: iso(now) });
        finish(repo.get(id)!, 'budget');
        return;
      }
      modelCalls += 1;
      // Çağrı ÖNCE sayılır: model yanıt vermese de bütçeden düşer (sonsuz yeniden deneme olmasın).
      repo.update(id, { modelCalls });
      const verdict = await deps.judge({ question: record.plan.condition.question, text: probe.text, change: result.finding, signal });
      if (stale(id, mine)) return;
      if (verdict) result = { ...result, holds: verdict.match, fire: verdict.match, finding: verdict.match ? clip(verdict.finding || result.finding, 300) : '' };
      else {
        result = { ...result, fire: false };
        lastError = t('watch.error.judge');
      }
    }

    record = repo.get(id);
    if (!record || record.status !== 'running') return;
    const interval = probe.wakeAt ? record.intervalSec : nextInterval(record.intervalSec, changed, record.plan.interval);
    const patch: JobPatch = {
      checks: record.checks + 1,
      lastCheckAt: iso(now),
      signature: probe.signature,
      baseline: source.mode === 'state' ? probe.text.slice(0, BASELINE_CHARS) : null,
      lastValue: result.value ?? record.lastValue,
      lastMatch: result.holds,
      errors: 0,
      lastError,
      modelCalls,
      intervalSec: interval,
      nextCheckAt: nextAt(record, interval, probe.wakeAt),
      ...(changed ? { changes: record.changes + 1, lastChangeAt: iso(now) } : {}),
      ...(result.fire ? { matches: record.matches + 1, finding: result.finding } : {}),
    };
    const saved = save(id, patch);
    if (!saved || !result.fire) return;
    await fire(saved, result.finding, signal, probe.announcedElsewhere);
    if (stale(id, mine)) return;
    const after = repo.get(id);
    if (after?.status === 'running' && (!after.plan.repeat || probe.fire)) finish(after, 'matched', result.finding);
  }

  /**
   * Koşul tuttu: (varsa) okuma eylemi → TEK haber (Dikkat Yöneticisi) + işi başlatan sohbete satır. `announcedElsewhere`:
   * bulguyu kaynağın sahibi modül kendisi duyurduysa (ör. projeler modülünün "Claude bitti" bildirimi) iş ayrıca bildirim
   * göndermez; eylem sonucu varsa (yeni bilgi) gönderir.
   */
  async function fire(record: JobRecord, finding: string, signal: AbortSignal, announcedElsewhere: boolean | Promise<boolean> = false): Promise<void> {
    let extra = '';
    if (record.plan.action) {
      try {
        const outcome = await deps.runAction(record.plan.action, toJob(record), signal);
        extra = outcome.ok ? clip(outcome.text, 400) : t('watch.action.failed', { error: clip(outcome.text, 200) });
      } catch (error) {
        extra = t('watch.action.failed', { error: clip(error instanceof Error ? error.message : String(error), 200) });
      }
    }
    const body = extra ? `${finding}\n${extra}` : finding;
    const speak = record.plan.speak;
    let elsewhere = false;
    if (!record.plan.action) {
      try {
        elsewhere = (await announcedElsewhere) === true;
      } catch {
        elsewhere = false;
      }
    }
    if (elsewhere) {
      log.debug(`iş ${record.id}: bulguyu kaynağın sahibi duyurdu; ikinci bildirim gönderilmedi`);
    } else {
      deps.notify({
        moduleId: 'watch',
        title: t('watch.notify.title', { title: record.title }),
        body,
        priority: speak ? 'high' : 'normal',
        speak: speak ? t('watch.notify.speak', { title: record.title, finding: clip(finding, 200) }) : false,
        actions: [{ id: 'watch.open', label: t('watch.notify.open'), kind: 'primary' }],
        dedupeKey: `watch.${record.id}.${record.matches}`,
        data: { jobId: record.id } as JsonObject,
      });
    }
    if (record.sessionId && record.channel && deps.appendChat) {
      try {
        deps.appendChat(record.sessionId, record.channel, t('watch.chat.line', { title: record.title, body }));
      } catch (error) {
        log.warn('iş haberi sohbete yazılamadı', error);
      }
    }
  }

  function finish(record: JobRecord, reason: 'matched' | 'expired' | 'budget', finding?: string): void {
    bump(record.id);
    unsubscribe(record.id);
    const result =
      reason === 'matched'
        ? clip(finding ?? record.finding ?? '', 300)
        : reason === 'expired'
          ? record.matches > 0
            ? t('watch.result.expiredAfter', { count: record.matches })
            : t('watch.result.expired', { condition: conditionText(record.plan.condition) })
          : t('watch.result.budget', { calls: record.plan.maxModelCalls });
    save(record.id, { status: 'done', reason, result, nextCheckAt: null, finishedAt: iso(deps.now()) });
    // Koşul tuttuğunda haber zaten verildi; süre ve bütçe bitişi sakin bir bildirimle söylenir.
    if (reason !== 'matched' && !(reason === 'expired' && record.plan.repeat && record.matches > 0)) {
      deps.notify({
        moduleId: 'watch',
        title: t(reason === 'expired' ? 'watch.notify.expiredTitle' : 'watch.notify.budgetTitle', { title: record.title }),
        body: result,
        priority: 'normal',
        speak: false,
        actions: [{ id: 'watch.open', label: t('watch.notify.open'), kind: 'primary' }],
        dedupeKey: `watch.${record.id}.end`,
        data: { jobId: record.id },
      });
    }
  }

  function stopInflight(id: Id): void {
    inflight.get(id)?.controller.abort();
  }

  // ───────────── dışa açık ─────────────

  const required = (id: Id): JobRecord => {
    const record = repo.get(id);
    if (!record) throw new WatchError(t('watch.error.notFound'));
    return record;
  };

  function pause(id: Id, reason: WatchReason = 'user'): WatchJob {
    const record = required(id);
    if (record.status !== 'running') return toJob(record);
    bump(id);
    stopInflight(id);
    unsubscribe(id);
    const saved = save(id, { status: 'paused', reason, nextCheckAt: null })!;
    plan();
    return toJob(saved);
  }

  function pauseAll(reason: 'panic' | 'policy'): number {
    let running: JobRecord[] = [];
    try {
      running = repo.list({ status: ['running'], limit: 500 });
    } catch (error) {
      log.warn('acil durdurmada işler okunamadı', error);
    }
    for (const record of running) {
      // Her iş ayrı denenir: birinin kaydı yazılamasa da öteki gözcüler durur (bellekte kuşak zaten arttı).
      bump(record.id);
      stopInflight(record.id);
      unsubscribe(record.id);
      try {
        save(record.id, { status: 'paused', reason, nextCheckAt: null });
      } catch (error) {
        log.warn(`iş duraklatılamadı: ${record.id}`, error);
      }
    }
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
    plan();
    return running.length;
  }

  const activeCount = () => repo.list({ status: ['running'], limit: 500 }).length;

  const api: WatchEngine = {
    start() {
      stopped = false;
      const now = deps.now();
      let index = 0;
      for (const record of repo.list({ status: ['running'], limit: 500 })) {
        if (now >= Date.parse(record.plan.untilAt)) {
          finish(record, 'expired');
          continue;
        }
        // Kapalıyken vakti geçen denetim hemen yapılır; aynı anda yığılmasın diye ikişer saniye arayla.
        const due = record.nextCheckAt ? Date.parse(record.nextCheckAt) : now;
        if (due < now) repo.update(record.id, { nextCheckAt: iso(now + index++ * 2_000) });
      }
      // Olay kaynaklı işler açılışta, vakti gelmemiş olsalar da aboneliklerini kurar: yeni olay (ör. WhatsApp iletisi) gelince
      // aralığı beklemeden denetlenirler. Kaynaklar modüllerle birlikte kayda girer; şimdi ve kısa bir süre sonra bir kez daha.
      const subscribeRunning = () => {
        if (stopped) return;
        try {
          for (const record of repo.list({ status: ['running'], limit: 500 })) {
            const source = findSource(record.plan.source.kind);
            if (source) subscribe(record, source);
          }
        } catch (error) {
          log.debug(`abonelikler kurulamadı: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      subscribeRunning();
      deps.setTimer(subscribeRunning, START_SUBSCRIBE_RETRY_MS);
      plan();
    },

    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      for (const id of [...subscriptions.keys()]) unsubscribe(id);
      for (const [id, entry] of inflight) {
        bump(id);
        entry.controller.abort();
      }
    },

    create(input) {
      if (deps.killSwitchActive()) throw new WatchError(t('watch.error.killSwitch'));
      if (activeCount() >= maxActive()) throw new WatchError(t('watch.error.tooMany', { max: maxActive() }));
      const now = deps.now();
      const id = newId();
      const record = repo.insert({
        id,
        title: clip(input.title, 80) || t('watch.untitled'),
        goal: input.goal.trim().slice(0, 1000),
        plan: input.plan,
        status: 'running',
        reason: null,
        createdAt: iso(now),
        updatedAt: iso(now),
        lastCheckAt: null,
        nextCheckAt: iso(now),
        intervalSec: input.plan.interval.minSec,
        checks: 0,
        changes: 0,
        modelCalls: 0,
        matches: 0,
        errors: 0,
        lastError: null,
        lastChangeAt: null,
        finding: null,
        result: null,
        finishedAt: null,
        sessionId: input.sessionId ?? null,
        channel: input.channel ?? null,
        signature: null,
        baseline: null,
        lastValue: null,
        lastMatch: false,
      });
      bump(id);
      deps.emit(toJob(record), 'created', id);
      plan();
      return toJob(record);
    },

    get(id) {
      const record = repo.get(id);
      return record ? toJob(record) : null;
    },

    list(filter) {
      return repo.list(filter).map(toJob);
    },

    find(query) {
      const text = query.trim().toLocaleLowerCase('tr');
      const all = repo.list({ limit: 200 });
      if (!text) return all.map(toJob);
      // Kısa kimlik ULID'in son dört harfidir (`describe.ts` › shortId); "#" ile ya da küçük harfle söylenebilir.
      const key = query.trim().replace(/^#/, '').toUpperCase();
      const exact = all.filter((record) => record.id === key || (key.length >= 4 && record.id.endsWith(key)));
      if (exact.length) return exact.map(toJob);
      return all.filter((record) => `${record.title} ${record.goal}`.toLocaleLowerCase('tr').includes(text)).map(toJob);
    },

    pause,
    pauseAll,

    resume(id) {
      const record = required(id);
      if (record.status === 'running') return toJob(record);
      if (record.status === 'done' || record.status === 'cancelled') throw new WatchError(t('watch.error.finished'));
      if (deps.killSwitchActive()) throw new WatchError(t('watch.error.killSwitch'));
      if (deps.now() >= Date.parse(record.plan.untilAt)) throw new WatchError(t('watch.error.expired'));
      if (activeCount() >= maxActive()) throw new WatchError(t('watch.error.tooMany', { max: maxActive() }));
      bump(id);
      const saved = save(id, { status: 'running', reason: null, errors: 0, lastError: null, intervalSec: record.plan.interval.minSec, nextCheckAt: iso(deps.now()) })!;
      plan();
      return toJob(saved);
    },

    cancel(id) {
      const record = required(id);
      if (record.status === 'done' || record.status === 'cancelled') return toJob(record);
      bump(id);
      stopInflight(id);
      unsubscribe(id);
      const saved = save(id, { status: 'cancelled', reason: 'user', nextCheckAt: null, finishedAt: iso(deps.now()), result: t('watch.result.cancelled') })!;
      plan();
      return toJob(saved);
    },

    remove(id) {
      const record = required(id);
      if (record.status === 'running' || record.status === 'paused') api.cancel(id);
      bump(id);
      repo.remove(id);
      deps.emit(null, 'deleted', id);
    },

    async checkNow(id) {
      const record = required(id);
      if (record.status !== 'running') throw new WatchError(t('watch.error.notRunning'));
      if (stopped) throw new WatchError(t('watch.error.off'));
      repo.update(id, { nextCheckAt: iso(deps.now()) });
      await launch(id);
      return toJob(required(id));
    },

    sources() {
      return deps.sources().map((source) => ({
        kind: source.kind,
        label: source.label,
        unavailable: source.available?.() ?? null,
        builtin: source.moduleId === 'watch',
      }));
    },

    source: findSource,

    async idle() {
      while (inflight.size) await Promise.allSettled([...inflight.values()].map((entry) => entry.done));
    },
  };
  return api;
}
