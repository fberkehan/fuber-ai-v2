/**
 * Bütün pencerelerin geçtiği tek fabrika. Güvenlik ayarları (KURGU §4.3) ve sınama kipindeki
 * görünmezlik burada uygulanır; pencere açan hiçbir kod `new BrowserWindow` ya da `win.show()` çağırmaz.
 */

import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron';
import type { RendererEntry } from '@fuber/shared';
import { isAppUrl, rendererUrl, runtime } from './runtime';
import { testing } from './testing';

export interface CreateWindowOptions {
  entry: RendererEntry;
  /** Adres sorgusu: `{ surface: 'island' }`. */
  query?: Record<string, string>;
  /** `webPreferences` dışındaki pencere seçenekleri. `show` yok sayılır; göstermek için `reveal()` kullanılır. */
  window?: Omit<BrowserWindowConstructorOptions, 'webPreferences' | 'show'>;
}

/** Pencereyi gizli olarak oluşturur ve içeriğini yüklemeye başlar. `loaded` yükleme bitince çözülür. */
export function createWindow(options: CreateWindowOptions): { win: BrowserWindow; loaded: Promise<void> } {
  const win = new BrowserWindow({
    backgroundColor: '#000000',
    ...options.window,
    show: false,
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sahne ve ada arka planda da canlı kalmalı; gizli ses penceresi kısılırsa ses kesilir.
      backgroundThrottling: false,
      // Ses penceresi kullanıcı tıklaması olmadan çalmak zorundadır (gizli pencere).
      autoplayPolicy: options.entry === 'audio' ? 'no-user-gesture-required' : 'document-user-activation-required',
    },
  });

  // Uygulama pencereleri yalnız kendi sayfalarını gösterir; dış bağlantılar tarayıcıya gider.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  const loaded = win.loadURL(rendererUrl(options.entry, options.query));
  return { win, loaded };
}

/**
 * Pencereyi gösterir. `inactive`: odak çalmadan (HUD yüzeyleri); `focus`: öne getirerek (ana pencere).
 * Sınama kipinde hiçbir pencere ekrana çıkmaz; gizli pencere yine çizilir ve görüntüsü alınabilir.
 * Tek istisna: sınama HUD yüzeylerini açıkça istediyse (`testing.showHud`) onlar odak çalmadan gösterilir.
 *
 * Sınamada gösterilen HUD yüzeyi GERÇEK fareye kapalıdır (tıklama alttaki pencereye geçer): ada ekranın üst ortasında,
 * tarayıcı sekmelerinin üstünde durur; bilgisayarın başındaki kişinin o an yaptığı bir tıklama onay kartının düğmesine
 * denk gelip sınamadaki onayı `ui` ile sonuçlandırabiliyordu (k1 "onay" adımının ara sıra kalmasının kök nedeni).
 * Sınama betikleri düğmelere sayfanın içinden / CDP ile basar; bu yol işletim sistemi girdisinden bağımsızdır.
 */
export function reveal(win: BrowserWindow, mode: 'inactive' | 'focus'): void {
  if (win.isDestroyed()) return;
  if (testing.enabled && !(mode === 'inactive' && testing.showHud)) return;
  if (mode === 'inactive') {
    if (testing.enabled) win.setIgnoreMouseEvents(true);
    win.showInactive();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
