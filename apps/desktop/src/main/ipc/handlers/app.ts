// `app.*` ve `hud.*` kanalları: sürüm, toplu durum, pencere denetimi, acil durdur, HUD boyut bildirimi.
// Her işleyici dosyası bir `register(ipc, services)` dışa aktarır; dosyayı `ipc/handlers/` altına koymak
// yeter, dizin kendiliğinden üretilir.
import { app, dialog, shell } from 'electron';
import {
  APP_VERSION,
  compareVersions,
  DESKTOP_APP_ID,
  DESKTOP_APP_NAME,
  nowIso,
  t,
  UserError,
  type AppDiagnostics,
  type AppInfo,
  type AppStatus,
  type BrainStatus,
  type Ok,
  type Services,
  type VoiceStatus,
} from '@fuber/shared';
import { runtime } from '../../runtime';
import { testing } from '../../testing';
import { windowsRuntime } from '../../windows/index';
import type { RegisterHandlers } from '../router';
import { requestClose } from './lifecycle';

const OK: Ok = { ok: true };

function appInfo(): AppInfo {
  return {
    name: DESKTOP_APP_NAME,
    appId: DESKTOP_APP_ID,
    version: APP_VERSION,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    dataDir: runtime.dataDir,
    packaged: app.isPackaged,
    locale: app.getLocale(),
    testMode: testing.enabled,
  };
}

/** Henüz hazır olmayan (taslak ya da başlatılamamış) servisin okuması arayüzü düşürmez; yerine `fallback` döner. */
function safe<T>(read: () => T, fallback: () => T): T {
  try {
    return read();
  } catch {
    return fallback();
  }
}

function appStatus(services: Services): AppStatus {
  const policy = services.policy.get();
  const voiceNotReady = (): VoiceStatus => ({
    state: 'idle',
    ready: false,
    notReadyReason: t('voice.notReady'),
    engine: policy.voice.engine,
    micMuted: false,
    micMutedUntil: null,
    wakePausedUntil: null,
    quiet: false,
    conversation: false,
    bargeIn: policy.voice.bargeIn,
    inputDeviceLabel: null,
    lastError: null,
  });
  const newer = compareVersions(APP_VERSION, policy.release.latestVersion) < 0;
  return {
    voice: safe(() => services.voice.status(), voiceNotReady),
    control: services.policy.status(),
    presence: services.presence.get(),
    killSwitch: { active: policy.killSwitch.active, message: policy.killSwitch.message ?? null },
    updateRequired: services.policy.updateRequired(),
    updateAvailable: newer
      ? { version: policy.release.latestVersion, downloadUrl: policy.release.downloadUrl ?? null, notes: policy.release.notes ?? null }
      : null,
    setupCompleted: services.settings.get().setupCompletedAt !== null,
    hotkeys: services.hotkeys.status(),
    budget: safe(
      () => {
        const today = services.usage.today();
        return { spentUsd: today.costUsd, limitUsd: today.budgetUsd, over: today.overBudget };
      },
      () => ({ spentUsd: 0, limitUsd: policy.limits.dailyBudgetUsd, over: false }),
    ),
    brain: safe(
      () => services.brain.status(),
      (): BrainStatus => ({ provider: 'none', reason: 'no_key', cause: null, localReady: false, localModel: policy.brain.local.modelId, message: t('brain.error.localUnavailable') }),
    ),
  };
}

export const register: RegisterHandlers = (ipc, services) => {
  const { windows, bus } = services;
  const hud = windowsRuntime(windows);

  ipc.handle('app.info', () => appInfo());
  ipc.handle('app.status', () => appStatus(services));

  // Tanı: son ses olayları ana süreçte birikir; ana pencere sonradan açılsa da (tepside başlayan uygulama) görünür.
  const diagnostics: AppDiagnostics = { lastWake: null, lastListen: null, lastTurn: null, lastError: null };
  bus.on('voice.wake', (wake) => {
    diagnostics.lastWake = wake;
  });
  bus.on('voice.state', ({ state, reason, at }) => {
    if (state === 'listening' && (reason === 'wake' || reason === 'hotkey' || reason === 'island' || reason === 'api')) diagnostics.lastListen = { reason, at };
  });
  bus.on('voice.turn', (turn) => {
    diagnostics.lastTurn = { ...turn, at: nowIso() };
  });
  bus.on('voice.error', ({ code, message, level }) => {
    // Bilgi iletisi (bulut ses yerine yerel ses) hata değildir; Tanı onu ses tanısından okur.
    if (level === 'info') return;
    diagnostics.lastError = { code, message, at: nowIso() };
  });
  ipc.handle('app.diagnostics', () => diagnostics);

  ipc.handle('app.window', ({ action }, ctx) => {
    const win = ctx.window;
    const kind = hud.kindOf(win);
    // Yalnız çerçeveli pencereler denetlenir; HUD yüzeyleri küçültülmez, büyütülmez.
    if (!win || (kind !== 'main' && kind !== 'setup')) return { maximized: false };
    if (action === 'minimize') win.minimize();
    else if (action === 'toggleMaximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else win.close();
    return { maximized: !win.isDestroyed() && win.isMaximized() };
  });

  ipc.handle('app.openMain', async ({ page }) => {
    await windows.showMain(page);
    return OK;
  });

  ipc.handle('app.openExternal', async ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new UserError(t('app.openExternal.invalid'));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UserError(t('app.openExternal.invalid'));
    await shell.openExternal(parsed.toString());
    return OK;
  });

  ipc.handle('app.pickFile', async ({ title, extensions, directory }, ctx) => {
    // Sınamada işletim sistemi penceresi açılmaz (ekrana çıkar ve yanıt bekler).
    if (testing.enabled) return { path: null };
    const options: Electron.OpenDialogOptions = {
      title,
      properties: [directory ? 'openDirectory' : 'openFile'],
      filters: extensions?.length ? [{ name: title, extensions }] : undefined,
    };
    const result = ctx.window ? await dialog.showOpenDialog(ctx.window, options) : await dialog.showOpenDialog(options);
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });

  ipc.handle('app.panic', () => {
    bus.emit('app.panic', { at: nowIso(), source: 'ui' });
    return OK;
  });

  ipc.handle('app.quit', () => {
    // Yanıt pencereye ulaştıktan sonra: süren iş varsa kapanış diyaloğu, yoksa veda ve çıkış (`lifecycle.ts`).
    setImmediate(() => requestClose(services, 'app'));
    return OK;
  });

  ipc.handle('hud.resize', ({ surface, width, height }, ctx) => {
    hud.resizeHud(ctx.sender, surface, width, height);
    return OK;
  });

  ipc.handle('hud.focus', ({ surface }, ctx) => {
    hud.focusHud(ctx.sender, surface);
    return OK;
  });

  ipc.handle('hud.passthrough', ({ surface, on }, ctx) => {
    hud.passthroughHud(ctx.sender, surface, on);
    return OK;
  });
};
