// ── Preload'lu pencerelerin ortak ayarı ve kalkanı (ana pencere, kulak, ada) ──────────────────────────────────────
// main.ts ve ada.ts aynı kuralı kullansın diye ayrı dosyada (main.ts'ten ada.ts'e geri bağımlılık olmasın).
import { app, BrowserWindow, shell } from 'electron';
import { yollar } from './yollar.js';

/** 0.12 H6 (Ruling P12): geliştirici araçları YALNIZ paketsiz (geliştirme/test) çalıştırmada; kurulu uygulamada FUBER_DEMO bile açmaz
 *  (arka plan test kipi CDP ile sürer — --remote-debugging-port; bu ayar onu etkilemez). */
export const ortakTercih = () => ({ preload: yollar.preload(), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, devTools: !app.isPackaged });

/** Preload'lu pencerelerin kalkanı: yeni pencere açılmaz (http(s) dış tarayıcıda açılır) ve sayfa `fuber://app/`
 *  dışına gidemez — bırakılan dosya/bağlantı ya da sayfadaki bir bağlantı, preload köprüsünü yabancı içeriğe vermesin. */
export function gezinmeKalkani(w: BrowserWindow): void {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('fuber://app/')) e.preventDefault(); });
}
