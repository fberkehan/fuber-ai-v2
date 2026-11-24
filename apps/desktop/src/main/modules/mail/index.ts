// E-posta modülü (demo.2 G4; Fuber AI 1'in `entegrasyon/eposta.ts` karşılığı): IMAP/SMTP hesapları (hazır sağlayıcılar +
// elle), aralıklı eşitleme, kural tabanlı + isteğe bağlı modelli önem puanı, 4+ için tek bildirim, sabah özetine satır,
// araçlar (listele, oku, taslak, gönder, eki kaydet). Hesap eklenmemişse hiçbir şey yapmaz. Parola yalnız işletim sisteminin
// şifreli deposuyla şifrelenmiş olarak bu modülün tablosunda durur (`secrets.ts`).
import nodeFs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { dashboard, defineModule, t, UserError, type ModuleContext, type Unsubscribe } from '@fuber/shared';
import { testing } from '../../testing';
import { createMailRepo, MAIL_MIGRATIONS } from './repo';
import { electronCipher, type SecretCipher } from './secrets';
import { createMailService, type MailService } from './service';
import { createMailImporter, type MailImporter } from './importer';
import { thunderbirdRoots, type ThunderbirdRoot } from './thunderbird';
import { createThunderbirdStore } from './thunderbird-store';
import type { MailLocalStatus } from './types';
import { createMailTools, resolveDraftForApproval, type MailImportEnv, type SendInput } from './tools';
import './types';
import { mailCard, type MailCardData } from './dashboard-card';

/** Kokpit kartının kimliği ve gösterdiği en çok ileti. */
export const MAIL_CARD_ID = 'mail.important';
const MAIL_CARD_ITEMS = 6;
import type { WatchSourceDef } from '../watch/types';
import { mailWatchSource } from './watch-source';

/** Sınamada (vitest) Electron yerine verilenler. */
export interface MailOverrides {
  cipher?: SecretCipher | null;
  downloadsDir?: string;
  timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** Thunderbird kökleri (varsayılan: `FUBER2_THUNDERBIRD_HOME` ya da %APPDATA%; sınama kipinde değişken yoksa hiçbiri). */
  thunderbirdRoots?: () => ThunderbirdRoot[];
}

let overrides: MailOverrides = {};
export function configureMail(next: MailOverrides): void {
  overrides = next;
}

let service: MailService | null = null;
let importer: MailImporter | null = null;
let importEnv: MailImportEnv | null = null;
const subscriptions: Unsubscribe[] = [];

// Yerel Thunderbird klasörünü (mbox) kısık `fs.watch` ile izler: dosya değişince (yeni ileti indi) debounce'la bir okuma yapılır.
// Sınama kipinde izleme kurulmaz (aralıklı okuma ve `mail.syncNow` yeter). Okuma yine `service.syncAll` üzerinden (eşzamanlılık kilidi).
let localWatchers: nodeFs.FSWatcher[] = [];
let localWatchTimer: ReturnType<typeof setTimeout> | null = null;
function closeLocalWatch(): void {
  if (localWatchTimer) clearTimeout(localWatchTimer);
  localWatchTimer = null;
  for (const watcher of localWatchers.splice(0)) {
    try {
      watcher.close();
    } catch {
      // kapalı
    }
  }
}
function refreshLocalWatch(): void {
  closeLocalWatch();
  if (testing.enabled || !service) return;
  if (!service.localStatus().enabled) return;
  const scan = service.localScan();
  if (!scan.profileDir) return;
  const trigger = () => {
    if (localWatchTimer) clearTimeout(localWatchTimer);
    localWatchTimer = setTimeout(() => void service?.syncAll().catch(() => undefined), 4000);
  };
  for (const name of ['ImapMail', 'Mail']) {
    try {
      localWatchers.push(nodeFs.watch(nodePath.join(scan.profileDir, name), { recursive: true }, trigger));
    } catch {
      // Klasör yoksa ya da izlenemiyorsa: aralıklı okuma yine çalışır.
    }
  }
}

/** Otomatik profil bulunamazsa kullanıcı klasör seçer. Sınama kipinde pencere açılmaz. */
async function pickLocalFolder(): Promise<MailLocalStatus> {
  const svc = current();
  if (testing.enabled) return svc.localStatus();
  try {
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const options = { properties: ['openDirectory' as const], title: t('mail.local.pickTitle') };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return svc.localStatus();
    return await svc.setLocalRoot(result.filePaths[0]);
  } catch {
    return svc.localStatus();
  }
}

function current(): MailService {
  if (!service) throw new UserError(t('mail.error.notReady'));
  return service;
}

function currentImporter(): MailImporter {
  if (!importer) throw new UserError(t('mail.error.notReady'));
  return importer;
}

async function downloadsDir(ctx: ModuleContext): Promise<string> {
  if (overrides.downloadsDir) return overrides.downloadsDir;
  if (testing.enabled) return nodePath.join(testing.documentsHome ?? nodePath.join(ctx.paths.data, 'test-home'), 'Downloads');
  try {
    const { app } = await import('electron');
    return app.getPath('downloads');
  } catch {
    return nodePath.join(os.homedir(), 'Downloads');
  }
}

async function cipherOf(ctx: ModuleContext): Promise<SecretCipher | null> {
  if (overrides.cipher !== undefined) return overrides.cipher;
  try {
    return await electronCipher();
  } catch (error) {
    ctx.log.warn('şifreli depo açılamadı', { error: (error as Error).message });
    return null;
  }
}

export default defineModule({
  id: 'mail',
  version: '1.0.0',
  nameKey: 'module.mail.name',
  descriptionKey: 'module.mail.description',
  permissions: ['net', 'notify', 'fs'],
  migrations: MAIL_MIGRATIONS,
  windowEvents: ['mail.changed'],

  tools: createMailTools(
    () => service,
    () => importEnv,
  ),

  ipc: () => ({
    'mail.presets': () => current().presets(),
    'mail.accounts': () => current().accounts(),
    'mail.testAccount': ({ account }) => current().test(account),
    'mail.saveAccount': ({ account }) => current().save(account),
    'mail.removeAccount': ({ id }) => {
      current().remove(id);
      return { ok: true };
    },
    'mail.syncNow': async ({ accountId }) => {
      await current().syncAll(accountId);
      return current().status();
    },
    'mail.status': () => current().status(),
    'mail.important': ({ limit }) => current().important(limit ?? 5),
    'mail.importScan': () => currentImporter().scan(),
    'mail.importAccounts': async ({ items }) => ({ results: await currentImporter().importAccounts(Array.isArray(items) ? items : []) }),
    'mail.localStatus': () => current().localStatus(),
    'mail.localSetEnabled': async ({ enabled }) => {
      const status = await current().setLocalEnabled(Boolean(enabled));
      refreshLocalWatch();
      return status;
    },
    'mail.localPickFolder': async () => {
      const status = await pickLocalFolder();
      refreshLocalWatch();
      return status;
    },
  }),

  async setup(ctx: ModuleContext) {
    const repo = createMailRepo(ctx.db);
    const downloads = await downloadsDir(ctx);
    // Yerel Thunderbird kaynağı: kullanıcının seçtiği özel kök (varsa) önce, yoksa FUBER2_THUNDERBIRD_HOME / %APPDATA%.
    // Sınama kipinde (ve vitest'te) FUBER2_THUNDERBIRD_HOME yoksa hiçbir profil okunmaz (geliştiricinin gerçek profiline dokunulmaz).
    const localRoots = (): ThunderbirdRoot[] => {
      const custom = repo.localRoot();
      if (custom) return [{ source: 'thunderbird', dir: custom }];
      return overrides.thunderbirdRoots ? overrides.thunderbirdRoots() : thunderbirdRoots(process.env, testing.enabled || process.env.VITEST === 'true');
    };
    // İlk okuma sınırı: üretimde varsayılan sabitler (en yeni ~200 ileti / ~90 gün). Sınama/e2e'de env ile küçültülebilir
    // (sabit tarihli fixture'ın yaş penceresine takılmaması ve sınırın uçtan uca sınanabilmesi için).
    const numEnv = (name: string): number | undefined => {
      const raw = process.env[name];
      if (!raw) return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };
    const initialLimit =
      testing.enabled || process.env.VITEST === 'true' ? { maxMessages: numEnv('FUBER2_MAIL_INITIAL_COUNT'), maxAgeDays: numEnv('FUBER2_MAIL_INITIAL_DAYS') } : undefined;
    const localStore = createThunderbirdStore({ roots: localRoots, initial: initialLimit });
    service = createMailService({
      repo,
      cipher: await cipherOf(ctx),
      bus: ctx.bus,
      attention: ctx.attention,
      brain: ctx.brain,
      policy: ctx.policy,
      voice: ctx.voice,
      settings: ctx.settings,
      log: ctx.log,
      downloadsDir: () => downloads,
      localStore,
      ...(overrides.timers ? { timers: overrides.timers } : {}),
    });
    const mail = service;
    // Thunderbird'den hesap ayarlarını içe aktarma. Sınama kipinde (ve vitest'te) FUBER2_THUNDERBIRD_HOME yoksa hiçbir profil okunmaz.
    const mailImporter = createMailImporter({
      service: () => mail,
      roots: overrides.thunderbirdRoots ?? (() => thunderbirdRoots(process.env, testing.enabled || process.env.VITEST === 'true')),
      log: ctx.log,
    });
    importer = mailImporter;
    importEnv = {
      scan: () => mailImporter.scan(),
      openDialog: () => ctx.bus.emit('app.navigate', { page: 'settings', params: { tab: 'mail', mailImport: 'thunderbird' } }),
    };

    // Gözcü ve başka modüller: zaman uyumlu sorgu (`types.ts` › MailQueryEvent) ve eşitleme isteği.
    subscriptions.push(
      ctx.bus.on('mail.query', (event) => {
        event.result = mail.query(event.query);
      }),
    );
    subscriptions.push(ctx.bus.on('mail.syncRequest', ({ accountId }) => void mail.syncSoon(accountId)));
    // Takip işleri ("Ahmet'ten e-posta gelince söyle"): kaynak İşler modülüne takılır. Bu modül kapanınca dinleyici kalkar,
    // kaynak listeden düşer; İşler modülü kapalıysa olayı toplayan yoktur (kaynak yalnız bellekte gelenleri biriktirir).
    const watchSource = mailWatchSource({
      bus: ctx.bus,
      status: () => mail.query({ limit: 1 }),
      syncSoon: () => void mail.syncSoon().catch(() => undefined),
      now: () => Date.now(),
    });
    subscriptions.push(() => watchSource.dispose());
    subscriptions.push(ctx.bus.on('watch.sources.collect', ({ sources }: { sources: WatchSourceDef[] }) => void sources.push(watchSource)));
    subscriptions.push(
      ctx.bus.on('planner.brief.collect', (brief) => {
        if (brief.kind !== 'morning') return;
        const line = mail.briefLine();
        if (line) brief.lines.push(line);
      }),
    );

    // Gönderim onayı istenirken tam önizleme sahnede (adadaki kart üç satıra sığar): alıcılar, konu, bütün metin.
    const previews = new Map<string, string>();
    subscriptions.push(
      ctx.bus.on('tool.approval.request', (request) => {
        if (request.toolName !== 'mail_send') return;
        const input = request.input as SendInput | null;
        const draft = input && typeof input === 'object' ? resolveDraftForApproval(mail, input) : null;
        const out = draft ? mail.outgoing(draft) : null;
        if (!draft || !out || 'error' in out) return;
        const item = ctx.stage.showCard('mail', {
          title: t('mail.card.sendTitle'),
          subtitle: out.account.address,
          icon: 'EnvelopeSimple',
          body: [
            { type: 'keyValue', rows: [{ label: t('mail.card.to'), value: out.to.join(', ') }, ...(out.cc.length ? [{ label: t('mail.card.cc'), value: out.cc.join(', ') }] : []), { label: t('mail.card.subject'), value: out.subject }] },
            { type: 'text', text: out.body },
          ],
          ttlSeconds: 90,
        });
        previews.set(request.id, item.id);
      }),
    );
    subscriptions.push(
      ctx.bus.on('tool.approval.resolve', ({ id }) => {
        const item = previews.get(id);
        if (!item) return;
        previews.delete(id);
        ctx.stage.close(item);
      }),
    );

    // Kokpit: "E-posta" kartı (`dashboard-card.ts`). Hesap yoksa kart çizilmez.
    subscriptions.push(
      dashboard.registerProvider<MailCardData>({
        id: MAIL_CARD_ID,
        moduleId: 'mail',
        title: t('today.mailCard.title'),
        defaultSize: 'medium',
        priority: 72,
        page: 'settings',
        events: ['mail.changed', 'module.changed'],
        fill() {
          const data = mailCard(mail, MAIL_CARD_ITEMS);
          return data ? { data } : null;
        },
      }),
    );

    mail.start();
    // Yerel kaynak zaten açıksa (önceki oturumdan) dosya izlemesini kur.
    refreshLocalWatch();
    testing.expose({ mail: { service: () => service } });
  },

  teardown() {
    closeLocalWatch();
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    service?.stop();
    service = null;
    importer = null;
    importEnv = null;
  },

  purge(ctx) {
    createMailRepo(ctx.db).purgeAll();
    ctx.attention.forgetModule?.('mail');
  },
});
