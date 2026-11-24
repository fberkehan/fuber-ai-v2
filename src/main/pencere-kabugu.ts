// ── Pencere kabuğu (Görev 22, K12): kendi başlık düğmelerimiz ───────────────────────────────────────────────────────
// Pencere düğmeleri saydam kalıyor ve Windows'un katmanının arkasında kalıyordu; uygulama kendi düğmelerini çizer.
// Eskiden Windows'un başlık şeridi kaplaması (titleBarOverlay) arayüzün sağ üstüne kendi düğmelerini saydam bir katman olarak
// çiziyordu. Artık Windows'ta başlık gizli ve KAPLAMASIZ (shared/pencere.ts baslikAyari): düğmeleri arayüz çizer
// (renderer/pencere/PencereDugmeleri.tsx), eylemleri buradan geçer. macOS'ta yerel trafik ışıkları kalır.
// Sürükleme ve çift tıkla büyüt/geri al Windows'un kendisidir (arayüzdeki -webkit-app-region: drag alanları başlık sayılır;
// Aero Snap ve sağ tık sistem menüsü de böyle çalışır). Kapat, pencerenin kendi 'close' yolundan geçer: ana pencere tepsiye gizlenir
// (main.ts), Fuber Tarayıcı kapanır — eski düğmenin davranışı aynen.
import { app, BrowserWindow, ipcMain, nativeImage, type NativeImage } from 'electron';
import { baslikAyari, eylemCoz, pencereIkonuAdi, type PencereDurumu } from '../shared/pencere.js';
import { GELISTIRME_ADI, uygulamaKimligi } from '../shared/uygulama-kimligi.js';
import { yollar } from './yollar.js';

/** Kabuğu kurulmuş pencereler: eylem yalnız bunlara uygulanır (ada, kulak gibi pencereler düğme çağrısıyla kapanamaz). */
const kabuklu = new WeakSet<BrowserWindow>();

/** BrowserWindow seçenekleri: başlık (platforma göre) + pencere ikonu + sistem malzemesi BAŞLANGIÇTA YOK. `yukseklik`: arayüzün başlık şeridi;
 *  `solBosluk` (macOS). 0.12 H3a: Windows 11 gizli başlıklı pencereye kendiliğinden Mica verir (DWM SYSTEMBACKDROP 2); bu yüzden malzeme AÇIKÇA
 *  'none'. Şeffaf tema (0.13 T13) malzemeyi sonradan main/tema.ts pencereyeUygula ile verir, yalnız ana pencereye ve Fuber Tarayıcı'ya
 *  (scripts/dev/tema-onizle.mjs DWM'den ölçer). */
export function kabukSecenekleri(yukseklik: number, solBosluk?: number): Pick<Electron.BrowserWindowConstructorOptions, 'titleBarStyle' | 'trafficLightPosition' | 'icon' | 'backgroundMaterial'> {
  return { ...baslikAyari(process.platform, yukseklik, solBosluk), icon: pencereIkonu(), backgroundMaterial: 'none' };
}

let ikon: NativeImage | null = null;
/** Pencere ikonu: Windows'ta çok boylu .ico (görev çubuğu ve Alt+Tab elle çizilmiş 16/24/32'yi alır); diğerlerinde png. Bir kez okunur. */
export function pencereIkonu(): NativeImage {
  if (!ikon || ikon.isEmpty()) ikon = nativeImage.createFromPath(yollar.kaynak('ikon', pencereIkonuAdi(process.platform)));
  return ikon;
}

/**
 * 0.10 E1 (K7): HER pencereye Fuber ikonu — kabuklu olmayanlar da (ada, kulak, imleç katmanı, bilgisayar denemesi, giriş açılır
 * penceresi). İkon verilmemiş pencere sınıfın ikonunu, yani exe'ninkini gösterir: geliştirme koşusunda electron.exe'nin Electron
 * ikonu (ada böyleydi). Windows'ta pencereye kimliği de yazılır (süreç kimliğiyle aynı); geliştirme koşusunda ayrıca sabitleme
 * bilgileri: pencere görev çubuğuna sabitlenirse kısayol Electron'un ikonu ve adıyla değil Fuber'in ikonu ve geliştirme adıyla oluşur.
 * main.ts modül düzeyinde, ilk pencereden önce kurar; olay BrowserWindow yapıcısının içinde gelir (pencere gösterilmeden).
 */
export function pencereIkonlariniKur(): void {
  app.on('browser-window-created', (_e, w) => pencereyeIkonVer(w));
}

export function pencereyeIkonVer(w: BrowserWindow): void {
  if (process.platform === 'darwin' || w.isDestroyed()) return; // macOS: pencere ikonu yok (Dock uygulama paketinin ikonunu gösterir)
  const resim = pencereIkonu();
  if (resim.isEmpty()) { console.warn(`[ikon] pencere ikonu okunamadı: ${yollar.kaynak('ikon', pencereIkonuAdi(process.platform))}`); return; }
  w.setIcon(resim);
  if (process.platform !== 'win32') return;
  const appId = uygulamaKimligi(app.isPackaged);
  w.setAppDetails(app.isPackaged ? { appId } : {
    appId,
    appIconPath: yollar.kaynak('ikon', 'fuber.ico'),
    appIconIndex: 0,
    relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
    relaunchDisplayName: GELISTIRME_ADI,
  });
}

export function pencereDurumu(w: BrowserWindow): PencereDurumu {
  return { buyuk: w.isMaximized(), tamEkran: w.isFullScreen(), odak: w.isFocused(), gorunur: w.isVisible() && !w.isMinimized() };
}

/** Pencere oluşturulduktan hemen sonra: büyütme/tam ekran (büyüt ↔ geri al simgesi) ve PENCERENİN odağı (düğmeler odak dışında
 *  söner) değişince arayüze bildirir. Odak belgenin focus/blur'undan okunmaz: Fuber Tarayıcı'da sayfa ayrı bir görünümdür, sayfaya
 *  tıklanınca araç çubuğunun belgesi "blur" alır ama pencere hâlâ öndedir (düğmeler sönmemeli). */
export function kabukBagla(w: BrowserWindow): void {
  kabuklu.add(w);
  // Pencere kapanırken webContents pencereden önce yok edilebilir (Görev 23, G22 küçüğü): ikisi de denetlenir.
  const bildir = () => { if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('pencere:durum', pencereDurumu(w)); };
  // show / hide / minimize: görünürlük (PencereDurumu.gorunur) — tepsiden `--gizli` ile açılıp ilk kez gösterilen pencere de arayüze bildirilir.
  for (const olay of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore', 'focus', 'blur', 'show', 'hide', 'minimize'] as const) w.on(olay as 'maximize', bildir);
}

/** IPC: çağıran pencereye uygulanır — yalnız kabuğu kurulmuş pencerenin KENDİ arayüzü (içindeki bir görünümün, ör. Fuber
 *  Tarayıcı'nın web sayfasının, webContents'i değil). Telefondan kapalı (kopru-protokol.ts UZAKTAN_KAPALI). */
export function pencereKanallariniKur(): void {
  const pencere = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return w && !w.isDestroyed() && kabuklu.has(w) && w.webContents === e.sender ? w : null;
  };
  ipcMain.handle('pencere:durum', (e) => {
    const w = pencere(e);
    return w ? pencereDurumu(w) : { buyuk: false, tamEkran: false, odak: true, gorunur: true };
  });
  ipcMain.handle('pencere:eylem', (e, eylem: unknown) => {
    const w = pencere(e);
    const ne = eylemCoz(eylem);
    if (!w || !ne) return false;
    if (ne === 'kucult') w.minimize();
    else if (ne === 'buyut') { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
    else w.close();
    return true;
  });
}
