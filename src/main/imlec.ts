// ── Fuber'in imleci: bilgisayar kontrolü sürerken görünen, ayırt edilir yapay zekâ imleci ────────────────────
// AI ekranı kullanırken faresi görünür olmalı: hareketleri ona aittir ve kullanıcının imlecinden ayırt edilir.
// Her ekranda tıklamaları geçiren (click-through), saydam bir katman: parlayan gümüş "Fuber" imleci, gerçek imleçle
// AYNI kavis ve sürede süzülür (yardımcıdaki "yolla" komutu gerçek imleci de aynı yoldan götürür), tıklamada halka,
// yazarken "yazıyor…" rozeti, kenarda ince ışık + "Alt+Shift+Q" şeridi.
// Katmanlar ve kontrol sürerken ada (üst ortadaki asistan) EKRAN YAKALAMADAN HARİÇ tutulur (setContentProtection →
// WDA_EXCLUDEFROMCAPTURE): ekran görüntüsü için pencereleri gizleyip göstermek gerekmez → eski "kapanıp açılma"
// titremesi yok, model kendi imlecini de görmez.
import { app, BrowserWindow, screen, type Display } from 'electron';
import { yollar } from './yollar.js';

type Katman = { pencere: BrowserWindow; ekran: Display };
const katmanlar = new Map<number, Katman>();
let kontrolAcik = false;
let bitisZamani: NodeJS.Timeout | null = null;
let korumaKancasi: (acik: boolean) => void = () => undefined;

/** main.ts bağlar (adaKontrol): kontrol sürerken ada yakalamadan hariç + tıklamaları geçirir. */
export function imlecKorumaKancasi(f: (acik: boolean) => void): void { korumaKancasi = f; }

function katman(e: Display): Katman {
  const var_ = katmanlar.get(e.id);
  if (var_ && !var_.pencere.isDestroyed()) { var_.pencere.setBounds(e.bounds); var_.ekran = e; return var_; }
  const p = new BrowserWindow({
    ...e.bounds, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false, skipTaskbar: true,
    resizable: false, movable: false, show: false, alwaysOnTop: true, enableLargerThanScreen: true,
    webPreferences: { preload: yollar.preload(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, devTools: !app.isPackaged },
  });
  p.setIgnoreMouseEvents(true);
  p.setAlwaysOnTop(true, 'screen-saver');
  p.setContentProtection(true);
  p.setVisibleOnAllWorkspaces(true);
  void p.loadURL('fuber://app/imlec.html');
  const k = { pencere: p, ekran: e };
  katmanlar.set(e.id, k);
  return k;
}

function gonder(k: Katman, veri: Record<string, unknown>): void {
  const w = k.pencere;
  if (w.isDestroyed()) return;
  const yolla = () => w.webContents.send('imlec:komut', veri);
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', yolla); else yolla();
}

/** Kontrol oturumu: ilk eylemde katmanlar açılır, son eylemden 4 sn sonra kapanır. */
export function kontrolBasla(): void {
  if (bitisZamani) { clearTimeout(bitisZamani); bitisZamani = null; }
  if (kontrolAcik) return;
  kontrolAcik = true;
  korumaKancasi(true);
  for (const e of screen.getAllDisplays()) {
    const k = katman(e);
    k.pencere.showInactive();
    gonder(k, { tur: 'kontrol', acik: true });
  }
}

export function kontrolBitirSonra(ms = 4000): void {
  if (bitisZamani) clearTimeout(bitisZamani);
  bitisZamani = setTimeout(kontrolBitir, ms);
}

export function kontrolBitir(): void {
  if (bitisZamani) { clearTimeout(bitisZamani); bitisZamani = null; }
  if (!kontrolAcik) return;
  kontrolAcik = false;
  korumaKancasi(false);
  for (const k of katmanlar.values()) {
    if (k.pencere.isDestroyed()) continue;
    gonder(k, { tur: 'kontrol', acik: false });
    const p = k.pencere;
    setTimeout(() => { if (!p.isDestroyed() && !kontrolAcik) p.hide(); }, 450);
  }
}

/** Fiziksel pikselden (yardımcının koordinatı) ekran + o ekranın katmanındaki CSS koordinatına. */
function katmanNoktasi(fx: number, fy: number): { k: Katman; x: number; y: number } {
  const dip = screen.screenToDipPoint({ x: fx, y: fy });
  const e = screen.getDisplayNearestPoint(dip);
  const k = katman(e);
  if (!k.pencere.isVisible()) k.pencere.showInactive();
  return { k, x: dip.x - e.bounds.x, y: dip.y - e.bounds.y };
}

/** Kavisli hareket süresi: mesafeye göre 260–750 ms (gerçek imleç de aynı sürede gider). */
export function hareketSuresi(bas: { x: number; y: number } | null, son: { x: number; y: number }): number {
  if (!bas) return 320;
  const d = Math.hypot(son.x - bas.x, son.y - bas.y);
  return Math.round(Math.max(260, Math.min(750, 220 + d * 0.35)));
}

/**
 * Yapay zekâ imlecini başlangıçtan hedefe süzdürür (fiziksel koordinatlar). Diğer ekranlardaki imleç gizlenir.
 * `eylem`: varışta gösterilecek iz ('tikla' | 'cift' | 'sag' | 'bak'). Süre bitince çözülür.
 */
export async function imlecGit(bas: { x: number; y: number } | null, son: { x: number; y: number }, sure: number, eylem: string): Promise<void> {
  if (!kontrolAcik) kontrolBasla();
  const h = katmanNoktasi(son.x, son.y);
  const b = bas ? katmanNoktasi(bas.x, bas.y) : null;
  for (const k of katmanlar.values()) if (k !== h.k) gonder(k, { tur: 'sakla' });
  gonder(h.k, { tur: 'git', x: h.x, y: h.y, bx: b && b.k === h.k ? b.x : null, by: b && b.k === h.k ? b.y : null, sure, eylem });
  await new Promise((c) => setTimeout(c, sure + 30));
}

/** İmlecin yanında kısa durum rozeti: "yazıyor…", "Enter", "kaydırıyor". */
export function imlecRozet(fiziksel: { x: number; y: number } | null, metin: string, ms = 1400): void {
  if (!kontrolAcik) kontrolBasla();
  if (!fiziksel) return;
  const h = katmanNoktasi(fiziksel.x, fiziksel.y);
  gonder(h.k, { tur: 'rozet', x: h.x, y: h.y, metin, ms });
}

export function imlecTiklamaIzi(fiziksel: { x: number; y: number }, eylem: string): void {
  const h = katmanNoktasi(fiziksel.x, fiziksel.y);
  gonder(h.k, { tur: 'iz', x: h.x, y: h.y, eylem });
}

export function imlecKapat(): void {
  kontrolBitir();
  for (const k of katmanlar.values()) if (!k.pencere.isDestroyed()) k.pencere.destroy();
  katmanlar.clear();
}
