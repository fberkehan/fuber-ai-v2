// `lifecycle.*` ve `app.close*` kanalları: kapanış diyaloğu (pencere X, tepsi "Çık", `app.quit`), açılış kapıları
// (tekrar hoş geldiniz, yenilikler) ve veri işlemleri (yedek al, geri yükle, yeni başla, verilerimi sil, kaldır).
// Karar mantığı `core/lifecycle.ts`, dosya işlemleri `core/lifecycle-data.ts`; burada Electron'a bağlanır.
import { app, dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_VERSION,
  DESKTOP_APP_NAME,
  defaultSettings,
  normalizePrefs,
  REINSTALL_MARKER,
  shouldShowWhatsNew,
  t,
  UserError,
  WHATS_NEW,
  WIPE_CONFIRM_WORD,
  type BusyItem,
  type DataSummary,
  type LifecyclePrefs,
  type Ok,
  type RestartResult,
  type Services,
  type UninstallResult,
} from '@fuber/shared';
import { createCloseController, type CloseController } from '../../core/lifecycle';
import {
  assertSafeRoot,
  BACKUPS_DIR,
  changedSettingsCount,
  clearReinstall,
  createBackup,
  dbBytes,
  readBackup,
  reinstallMarked,
  requestOperation,
  uninstallCommand,
  type PendingOperation,
} from '../../core/lifecycle-data';
import { testing } from '../../testing';
import { windowsRuntime } from '../../windows/index';
import type { RegisterHandlers } from '../router';

const OK: Ok = { ok: true };
const controllers = new WeakMap<object, CloseController>();

/** `app.quit` kanalı ve başka çağıranlar kapanışı buradan ister; denetleyici yoksa düz çıkış. */
export function requestClose(services: Services, source: 'app' | 'tray' | 'window'): void {
  const controller = controllers.get(services.windows);
  if (controller) void controller.request(source);
  else app.quit();
}

/** Gerçek (üretim) veri klasörü: sınama kipinde yıkıcı işlem buraya dokunamaz. */
const realDataRoot = () => path.join(app.getPath('appData'), DESKTOP_APP_NAME);

export const register: RegisterHandlers = (ipc, services) => {
  const { settings, store, windows, bus, log: rootLog, paths } = services;
  const log = rootLog.child('lifecycle');
  const kv = store.kv('lifecycle');
  const root = paths.data;
  const guard = () => assertSafeRoot(root, { testMode: testing.enabled, realRoot: realDataRoot() });

  // ── tercihler ──
  const prefs = (): LifecyclePrefs => normalizePrefs(kv.get('prefs'));
  const setPrefs = (patch: Partial<LifecyclePrefs>): LifecyclePrefs => {
    const next = normalizePrefs({ ...prefs(), ...patch });
    kv.set('prefs', next as never);
    return next;
  };

  // ── açılış: sürüm ve yeniden kurulum ──
  const lastRunVersion = kv.get<string>('lastRunVersion') ?? null;
  if (shouldShowWhatsNew({ lastRunVersion, currentVersion: APP_VERSION, setupCompleted: settings.get().setupCompletedAt !== null })) {
    kv.set('whatsNewPending', APP_VERSION);
  }
  kv.set('lastRunVersion', APP_VERSION);
  const reinstall = reinstallMarked(root, REINSTALL_MARKER);
  if (reinstall) log.info('yeniden kurulum işareti bulundu: "Tekrar hoş geldiniz" gösterilecek');

  // ── süren işler ──
  let pcActive = false;
  bus.onAny((type, payload) => {
    if (type === 'pc.activity') pcActive = (payload as { active?: boolean } | null)?.active === true;
  });
  const busy = async (): Promise<BusyItem[]> => {
    const items: BusyItem[] = [];
    try {
      const activity = services.jobs.activity?.();
      const count = (activity?.running ?? 0) + (activity?.queued ?? 0);
      if (count > 0) items.push({ kind: 'jobs', count, title: activity?.current?.title ?? null });
    } catch {
      // iş servisi hazır değil
    }
    try {
      const meeting = services.voice.status().meeting;
      if (meeting?.on) items.push({ kind: 'meeting', count: 1, title: null });
    } catch {
      // ses hazır değil
    }
    try {
      const sessions = (await ipc.local('projects.claudeSessions' as never, undefined as never)) as Array<{ status: string; title?: string }> | null;
      const live = (sessions ?? []).filter((session) => session.status === 'running' || session.status === 'queued' || session.status === 'permission');
      if (live.length > 0) items.push({ kind: 'claude', count: live.length, title: live[0]?.title ?? null });
    } catch {
      // projeler modülü kapalı
    }
    try {
      const downloads = services.models.status().filter((model) => model.status === 'queued' || model.status === 'downloading' || model.status === 'verifying');
      if (downloads.length > 0) items.push({ kind: 'models', count: downloads.length, title: null });
    } catch {
      // model yöneticisi hazır değil
    }
    if (pcActive) items.push({ kind: 'pc', count: 1, title: null });
    return items;
  };

  // ── kapanış denetleyicisi ──
  const runtime = windowsRuntime(windows);
  const controller = createCloseController({
    prefs,
    setPrefs: (patch) => void setPrefs(patch),
    busy,
    mainVisible: () => windows.isOpen('main'),
    showMain: () => windows.showMain(),
    hideMain: () => windows.hide('main'),
    send: (event, payload) => windows.sendTo('main', event, payload),
    quit: () => app.quit(),
    testMode: testing.enabled,
    askInTest: testing.closeAsk,
    log,
  });
  controllers.set(windows, controller);
  runtime.setCloseHandler((source) => void controller.request(source));

  ipc.handle('lifecycle.prefs', () => prefs());
  ipc.handle('lifecycle.setPrefs', ({ patch }) => setPrefs(patch ?? {}));
  ipc.handle('app.closeAck', ({ id }) => {
    controller.ack(id);
    return OK;
  });
  ipc.handle('app.closeDecision', ({ id, choice, remember }) => {
    controller.decide(id, choice, remember === true);
    return OK;
  });

  // ── özet ve kapılar ──
  const summary = (): DataSummary => {
    let memory = 0;
    let chats = 0;
    let lastUsedAt: string | null = null;
    try {
      const stats = services.memory.stats();
      memory = stats.facts + stats.episodes + stats.commitments;
    } catch {
      // hafıza hazır değil
    }
    try {
      const sessions = services.conversation.sessions({ limit: 100_000 }).filter((session) => session.messageCount > 0);
      chats = sessions.length;
      for (const session of sessions) if (!lastUsedAt || session.lastAt > lastUsedAt) lastUsedAt = session.lastAt;
    } catch {
      // sohbet hazır değil
    }
    const changed = changedSettingsCount(settings.get() as never, defaultSettings(settings.get().projectsRoot) as never);
    return { memory, chats, settings: changed, lastUsedAt, dbBytes: dbBytes(root) };
  };

  ipc.handle('lifecycle.summary', () => ({ ...summary(), dataDir: root }));
  ipc.handle('lifecycle.welcome', () => {
    const pending = kv.get<string>('whatsNewPending') ?? null;
    const items = pending ? WHATS_NEW[pending] : undefined;
    return {
      reinstall: reinstallMarked(root, REINSTALL_MARKER) ? summary() : null,
      whatsNew: pending && items ? { version: pending, items: [...items] } : null,
    };
  });
  ipc.handle('lifecycle.welcomeContinue', () => {
    clearReinstall(root, REINSTALL_MARKER);
    return OK;
  });
  ipc.handle('lifecycle.whatsNewSeen', () => {
    kv.delete('whatsNewPending');
    return OK;
  });

  // ── veri işlemleri ──
  const pickDir = async (title: string, defaultPath?: string): Promise<string | null> => {
    // Sınamada işletim sistemi penceresi açılmaz: yol parametreyle gelmeli.
    if (testing.enabled) throw new UserError(t('lifecycle.data.needPath'));
    const result = await dialog.showOpenDialog({ title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  };
  let busyOp = false;
  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busyOp) throw new UserError(t('lifecycle.data.busy'));
    busyOp = true;
    try {
      return await work();
    } finally {
      busyOp = false;
    }
  };
  const backupTo = (parent: string) =>
    createBackup({ root, parent, appName: DESKTOP_APP_NAME, version: APP_VERSION, summary: (({ memory, chats, settings: count }) => ({ memory, chats, settings: count }))(summary()) });

  /** İşaret yazılır ve uygulama yeniden açılır; sınamada yalnız işaret (betik uygulamayı kendisi yeniden açar). */
  const restartWith = (operation: PendingOperation, backup: string | null): RestartResult => {
    guard();
    requestOperation(root, operation);
    log.info(`veri işlemi istendi: ${operation.op}; ${testing.enabled ? 'sınama: yeniden açılış betikte' : 'yeniden açılıyor'}`);
    if (testing.enabled) return { ok: true, restart: 'manual', backup };
    setTimeout(() => {
      app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== '--hidden' && arg !== '--gizli') });
      app.quit();
    }, 400);
    return { ok: true, restart: 'auto', backup };
  };
  const wrap = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof UserError) throw error;
      log.warn('veri işlemi başarısız', error);
      throw new UserError((error as Error)?.message || t('lifecycle.data.failed'));
    }
  };

  ipc.handle('lifecycle.backup', ({ dir }) =>
    exclusive(async () => {
      const parent = dir ?? (await pickDir(t('lifecycle.data.backup.pick'), app.getPath('documents')));
      if (!parent) return null;
      const result = wrap(() => backupTo(parent));
      log.info(`yedek alındı: ${result.path} (${result.bytes} bayt)`);
      return result;
    }),
  );

  ipc.handle('lifecycle.restore', ({ dir }) =>
    exclusive(async () => {
      const source = dir ?? (await pickDir(t('lifecycle.data.restore.pick'), app.getPath('documents')));
      if (!source) return null;
      wrap(() => readBackup(source, DESKTOP_APP_NAME));
      return wrap(() => restartWith({ op: 'restore', source: path.resolve(source) }, null));
    }),
  );

  ipc.handle('lifecycle.startOver', () =>
    exclusive(async () => {
      guard();
      const backup = wrap(() => backupTo(path.join(root, BACKUPS_DIR)));
      return wrap(() => restartWith({ op: 'start-over' }, backup.path));
    }),
  );

  ipc.handle('lifecycle.wipe', ({ confirm, includeModels }) =>
    exclusive(async () => {
      if (String(confirm ?? '').trim().toLocaleUpperCase('tr-TR') !== WIPE_CONFIRM_WORD) throw new UserError(t('lifecycle.wipe.confirmWrong'));
      return wrap(() => restartWith({ op: 'wipe', includeModels: includeModels === true }, null));
    }),
  );

  const uninstallLog: UninstallResult[] = [];
  testing.expose({ lifecycle: { controller, uninstallLog, busy } });
  ipc.handle('lifecycle.uninstall', ({ keepData }) =>
    exclusive(async (): Promise<UninstallResult> => {
      const { command, args } = uninstallCommand(keepData !== false, app.getPath('exe'));
      // Sınamada ve geliştirmede kaldırıcı ASLA çalıştırılmaz: yalnız komut döner ve kaydedilir.
      if (testing.enabled || !app.isPackaged) {
        const result: UninstallResult = { ok: true, command, args, executed: false };
        uninstallLog.push(result);
        log.info(`kaldırma (çalıştırılmadı): ${command} ${args.join(' ')}`);
        return result;
      }
      if (!fs.existsSync(command)) throw new UserError(t('lifecycle.uninstall.missing'));
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
        child.once('error', reject);
      }).catch((error: unknown) => {
        log.warn('kaldırıcı başlatılamadı', error);
        throw new UserError(t('lifecycle.uninstall.failed'));
      });
      log.info('kaldırıcı başladı; uygulama kapanıyor');
      // Veda ekranı arayüzde; kaldırıcı uygulamanın kapanmasını bekler.
      setTimeout(() => app.quit(), 1200);
      return { ok: true, command, args, executed: true };
    }),
  );
};
