/**
 * Fuber Yönetim 2 ana süreç girişi: tek örnek kilidi, veri kökü, kontrol servisi, IPC, tepsi, pencere.
 * Kontrol servisi (`@fuber/control`) bu süreçte başlatılır ve yalnız 127.0.0.1'de dinler.
 *
 * Bayraklar: `--hidden` pencere açmadan tepside başlar (Windows açılışı) ·
 * `--seed-key-from-env=<SAĞLAYICI>` ortam değişkenindeki anahtarı kasaya yazar, sınar, tek satır yazıp çıkar
 * (aynı veri kökünde Yönetim açıksa hiçbir şey yazmaz, çıkış kodu 3).
 */

import { randomBytes } from 'node:crypto';
import { app, BrowserWindow, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createControlService, type ControlLogger } from '@fuber/control';
import {
  ADMIN_APP_ID,
  ADMIN_APP_NAME,
  APP_VERSION,
  CONTROL_DB_FILE,
  CONTROL_PORT,
  type AppInfo,
  type ControlServiceStatus,
} from '@fuber/shared';
import { claudeCodeInfo } from './claude-code';
import { createControlHost, type ControlHost } from './control-host';
import { registerHandlers } from './ipc/handlers';
import { createRouter, type IpcRouter } from './ipc/router';
import { parseSeedFlag, SEED_ENV, seedKeyFromEnv } from './key-import';
import { redirectProviderFetch } from './provider-redirect';
import { isAppUrl, rendererUrl, runtime } from './runtime';
import { createAdminSettings } from './settings';
import { testing } from './testing';
import { createAdminTray } from './tray';
import { loadAdminToken, safeStorageSecrets } from './vault';

// Tek örnek kilidi, Chromium profili ve safeStorage anahtarı userData'ya bağlıdır; hepsinden önce ayarlanmalı.
app.setName(ADMIN_APP_NAME);
fs.mkdirSync(runtime.dataDir, { recursive: true });
app.setPath('userData', runtime.dataDir);

const log: ControlLogger = {
  info: (message, data) => console.log(`[admin] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message, data) => console.warn(`[admin] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message, data) => console.error(`[admin] ${message}`, data ? JSON.stringify(data) : ''),
};

const startHidden = process.argv.includes('--hidden');
const seedProvider = parseSeedFlag(process.argv);
/** Sınamada sağlayıcı çağrıları yerel sahte sunucuya gider (`FUBER2_PROVIDER_URL`). */
const providerFetch = testing.providerUrl ? redirectProviderFetch(testing.providerUrl) : undefined;

let mainWindow: BrowserWindow | null = null;
let quitting = false;

function appInfo(): AppInfo {
  return {
    name: ADMIN_APP_NAME,
    appId: ADMIN_APP_ID,
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

/** Sınama kipinde pencere ekrana çıkmaz; gizli pencere yine çizilir ve görüntüsü alınabilir. */
function reveal(win: BrowserWindow): void {
  if (testing.enabled || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function openMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    reveal(mainWindow);
    return;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: ADMIN_APP_NAME,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sınamada pencere gizlidir; kısılan gizli pencere kare üretmez ve görüntüsü alınamaz.
      backgroundThrottling: !testing.enabled,
    },
  });
  mainWindow = win;
  // Kapatma düğmesi uygulamayı kapatmaz: Yönetim tepside yaşar, kontrol servisi çalışmaya devam eder.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  await win.loadURL(rendererUrl());
  reveal(win);
}

function v1DataDir(): string | null {
  if (testing.v1DataDir !== undefined) return testing.v1DataDir;
  return path.join(app.getPath('appData'), 'Fuber AI');
}

/** Windows açılış kaydı yalnız kurulu (paketli) uygulamada ve sınama dışında yazılır. */
const loginItemsAllowed = () => app.isPackaged && !testing.enabled && process.platform === 'win32';

function applyLoginItem(openAtLogin: boolean): void {
  if (!loginItemsAllowed()) return;
  app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: ['--hidden'] });
}

async function runSeed(): Promise<void> {
  // Aynı veri kökünde açık bir Yönetim (eski sürüm dahil) varken kasaya ve veritabanına DOKUNULMAZ. Kilit veri
  // köküne bağlıdır; her sürüm onu alır. Alınamazsa iki somut zarar vardı (sınandı):
  // 1) Bu süreç kontrol servisini açınca politika biçimini yükseltir (sürüm 2); açık ESKİ Yönetim o belgeyi okuyamaz,
  //    sessizce varsayılan politikaya düşer ve cihazlara onu dağıtır (acil durdurma kapanır, bütçe/ad/ses sıfırlanır).
  // 2) Açık süreç `Local State`'i henüz diske yazmadıysa bu süreç yeni bir safeStorage anahtarı üretir; açık süreç
  //    kapanırken kendi anahtarını üstüne yazar ve buradan yazılan anahtar bir daha çözülemez.
  // Kilidi istemek açık Yönetim'in penceresini öne getirir: kapatılması gereken süreç kullanıcıya görünür.
  const locked = app.requestSingleInstanceLock();
  await app.whenReady();
  let exitCode: 0 | 1 | 2 | 3 = 1;
  let line: string;
  if (!locked) {
    exitCode = 3;
    line = `seed-key: Fuber Yönetim bu veri klasöründe açık (${runtime.dataDir}); kasaya bir şey yazılmadı. Önce tepsi simgesinden "Çıkış" ile kapatıp yeniden çalıştırın.`;
  } else if (seedProvider === 'invalid' || seedProvider === null) {
    line = `seed-key: bilinmeyen sağlayıcı. Kullanım: --seed-key-from-env=<${Object.keys(SEED_ENV).join('|')}>`;
  } else {
    const service = createControlService({
      dbPath: path.join(runtime.dataDir, CONTROL_DB_FILE),
      secrets: safeStorageSecrets(),
      // HTTP açılmadığı için kalıcı yönetici belirtecine gerek yok.
      adminToken: randomBytes(32).toString('base64url'),
      log,
      ...(providerFetch ? { fetch: providerFetch } : {}),
    });
    try {
      ({ exitCode, line } = await seedKeyFromEnv(service.admin, seedProvider, process.env));
    } finally {
      await service.close();
    }
  }
  console.log(line);
  // Paketli GUI uygulamasının konsol çıktısı görünmeyebilir; aynı satır veri klasörüne de yazılır.
  try {
    fs.writeFileSync(path.join(runtime.dataDir, 'seed-key-result.txt'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // sonuç dosyası en iyi çaba
  }
  app.exit(exitCode);
}

async function runApp(): Promise<void> {
  app.setAppUserModelId(ADMIN_APP_ID);
  app.on('second-instance', () => void openMainWindow());
  // Pencere kapanınca çıkılmaz: tepsi ve kontrol servisi yaşamaya devam eder.
  app.on('window-all-closed', () => {});

  await app.whenReady();
  const settings = createAdminSettings(runtime.dataDir);
  const secrets = safeStorageSecrets();
  const { token } = loadAdminToken(runtime.dataDir, log);
  const router: IpcRouter = createRouter({ onError: (channel, error) => log.error(`ipc ${channel}`, { error: String(error) }) });

  let tray: ReturnType<typeof createAdminTray> | null = null;
  const onStatus = (status: ControlServiceStatus) => {
    router.broadcast('service.status', status);
    tray?.setError(status.error);
  };
  const host: ControlHost = createControlHost({
    dataDir: runtime.dataDir,
    port: testing.controlPort ?? CONTROL_PORT,
    secrets,
    adminToken: token,
    log,
    onStatus,
    ...(providerFetch ? { providerFetch } : {}),
    onChange(change) {
      if (change.type === 'policy') {
        router.broadcast('policy.changed', { revision: change.revision });
        void tray?.rebuild();
      } else if (change.type === 'devices') router.broadcast('devices.changed', { ids: change.ids });
      else if (change.type === 'keys') router.broadcast('keys.changed', { provider: change.provider });
      else if (change.type === 'audit') router.broadcast('audit.added', change.entry);
    },
  });

  const adminSettings = {
    get: () => ({ ...settings.get(), openAtLoginSupported: loginItemsAllowed() }),
    update(patch: { openAtLogin?: boolean }) {
      if (patch.openAtLogin !== undefined) {
        settings.update({ openAtLogin: patch.openAtLogin });
        applyLoginItem(patch.openAtLogin);
        void tray?.rebuild();
      }
      return adminSettings.get();
    },
  };

  registerHandlers(router, {
    host,
    appInfo,
    v1DataDir,
    hideWindow: (win) => win.hide(),
    restartService: () => host.restart(),
    // Sınamada makinenin gerçek durumuna bakılmaz: görüntüler her makinede aynı çıksın.
    claudeCode: async () => (testing.enabled ? { installed: false, version: null, loggedIn: null } : claudeCodeInfo()),
    settings: adminSettings,
  });

  const status = await host.start();
  if (status.running) console.log(`[admin] kontrol servisi: ${status.url}`);

  tray = createAdminTray({
    openWindow: () => void openMainWindow(),
    quit: () => app.quit(),
    async killSwitchActive() {
      try {
        return (await host.admin().getPolicy()).killSwitch.active;
      } catch {
        return null;
      }
    },
    async setKillSwitch(active) {
      await host.admin().setKillSwitch(active);
    },
    openAtLogin: () => settings.get().openAtLogin,
    setOpenAtLogin: loginItemsAllowed() ? (value) => void adminSettings.update({ openAtLogin: value }) : null,
    iconsDir: path.join(runtime.resourcesDir, 'icons'),
  });
  tray.setError(status.error);
  applyLoginItem(settings.get().openAtLogin);

  let closed = false;
  app.on('before-quit', (event) => {
    quitting = true;
    if (closed) return;
    // Veritabanı ve dinleyen port düzgün kapansın diye çıkış bir kez bekletilir.
    event.preventDefault();
    closed = true;
    void host
      .close()
      .catch((error: unknown) => log.error('kapanış', { error: String(error) }))
      .finally(() => {
        tray?.destroy();
        app.quit();
      });
  });

  if (!startHidden) await openMainWindow();
}

if (seedProvider !== null) {
  void runSeed();
} else if (testing.singleInstanceLock && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void runApp();
}
