/**
 * Fuber AI 2 ana süreç girişi: uygulama kimliği, veri kökü, tek örnek kilidi ve açılış.
 * Servislerin kurulması ve bağlanması `bootstrap.ts` içindedir.
 */

import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION, DATA_DIRS, DESKTOP_APP_ID, DESKTOP_APP_NAME, QUIT_FLAG, QUIT_FLAG_MARKER, t, type WindowKind } from '@fuber/shared';
import { bootstrap, type App } from './bootstrap';
import { applyPendingOperation, assertSafeRoot } from './core/lifecycle-data';
import { runtime } from './runtime';
import { testing } from './testing';
import { launchedHidden } from './windows/autostart';

// Tek örnek kilidi ve Chromium profili userData'ya bağlıdır; ikisinden de önce ayarlanmalı.
// Böylece yalıtılmış sınama örnekleri birbirini ve gerçek kurulumu kilitlemez.
app.setName(DESKTOP_APP_NAME);
fs.mkdirSync(runtime.dataDir, { recursive: true });
app.setPath('userData', runtime.dataDir);

let running: App | null = null;
let closing = false;
/** Kurulum başlatıcısı "Kapat ve kur"da ikinci örneği `--cikis` ile başlatır: çalışan örnek nazikçe çıkar, bu örnek pencere açmaz. */
const quitRequested = process.argv.includes(QUIT_FLAG);

/**
 * Açılışın veri adımları, depo açılmadan: bekleyen veri işlemi (geri yükle, yeni başla, verilerimi sil) uygulanır ve
 * kurulum başlatıcısı için `--cikis` desteği işaretlenir. Hiçbiri açılışı durdurmaz.
 */
function prepareData(): void {
  try {
    assertSafeRoot(runtime.dataDir, { testMode: testing.enabled, realRoot: path.join(app.getPath('appData'), DESKTOP_APP_NAME) });
    const result = applyPendingOperation(runtime.dataDir, DESKTOP_APP_NAME);
    if (result.applied) console.info(`veri işlemi uygulandı: ${result.applied}${result.skipped?.length ? ` (atlanan: ${result.skipped.join(', ')})` : ''}`);
  } catch (error) {
    console.error('bekleyen veri işlemi uygulanamadı', error);
  }
  try {
    fs.writeFileSync(path.join(runtime.dataDir, QUIT_FLAG_MARKER), APP_VERSION);
  } catch {
    // yazılamazsa kurulum başlatıcısı eski yola düşer
  }
}

function failStartup(error: unknown): void {
  const detail = (error as Error)?.message ?? String(error);
  console.error('açılış başarısız', error);
  // Günlük servisi kurulamadan düşülmüş olabilir; hata her durumda diske iner.
  try {
    const logs = path.join(runtime.dataDir, DATA_DIRS.logs);
    fs.mkdirSync(logs, { recursive: true });
    fs.appendFileSync(
      path.join(logs, 'startup-error.log'),
      `${new Date().toISOString()} ${(error as Error)?.stack ?? detail}\n`,
    );
    if (!testing.enabled) dialog.showErrorBox(t('app.startupFailed.title'), t('app.startupFailed.body', { detail, logs }));
  } catch {
    // veri klasörüne yazılamıyor: konsoldaki kayıt yeter
  }
  app.exit(1);
}

async function open(): Promise<void> {
  const built = await bootstrap();
  running = built;
  const { windows, settings, bus, log } = built.services;

  // Oturum açılışında gizli başlayan uygulama yalnız tepside yaşar; pencere istenince açılır.
  const hidden = launchedHidden();
  // Sınama kipi doğrudan ana pencereyle açılır; kurulum akışının sınaması üretimdeki kuralı ister (`firstRunSetup`).
  const skipSetup = testing.enabled && !testing.firstRunSetup;
  const first: WindowKind = settings.get().setupCompletedAt !== null || skipSetup ? 'main' : 'setup';

  bus.on('window.changed', ({ kind, open: isOpen }) => {
    // Kurulum bitince (ya da kullanıcı sihirbazı kapatınca) uygulama ana pencereyle sürer.
    if (kind === 'setup' && !isOpen && !closing) void windows.showMain().catch((error: unknown) => log.error('ana pencere açılamadı', error));
  });

  // İlk pencere servisler başlamadan açılır: kullanıcı ses hattının hazırlanmasını beklemeden arayüzü görür,
  // durumlar servisler ayağa kalktıkça dolar.
  if (!hidden) await windows.show(first);
  const windowMs = Math.round(process.uptime() * 1000);
  await built.start();
  // Süreç başından bu yana: ilk pencere ve bütün servisler. Kontrol servisi kapalıyken de ağ beklenmez.
  const startup = { windowMs, servicesMs: Math.round(process.uptime() * 1000) };
  log.info(`açılış süresi: pencere ${startup.windowMs} ms, servisler ${startup.servicesMs} ms`);
  testing.expose({ startup });
}

if ((testing.singleInstanceLock && !app.requestSingleInstanceLock()) || quitRequested) {
  // İkinci örnek (ya da çalışan örnek yokken `--cikis`): hiçbir şey açmadan çıkar.
  app.quit();
} else {
  app.setAppUserModelId(DESKTOP_APP_ID);
  prepareData();
  // İkinci açılış yeni örnek başlatmaz; çalışan örneğin ana penceresini öne getirir. `--cikis` ile gelirse çalışan
  // örnek sormadan, nazik çıkış yolundan (servisler kapanarak) çıkar.
  app.on('second-instance', (_event, argv) => {
    if (argv.includes(QUIT_FLAG)) {
      console.info('ikinci örnek --cikis istedi; nazikçe çıkılıyor');
      app.quit();
      return;
    }
    void running?.services.windows.showMain();
  });

  // Uygulama tepside yaşar: pencerelerin kapanması çıkış değildir. Çıkış tepsi menüsünden ya da `app.quit` ile olur.
  app.on('window-all-closed', () => {});

  app.on('before-quit', (event) => {
    if (!running || closing) return;
    // Servisler (veritabanı, alt süreçler) kapanmadan çıkılmaz.
    event.preventDefault();
    closing = true;
    void running.shutdown().finally(() => app.quit());
  });

  void app.whenReady().then(open).catch(failStartup);
}
