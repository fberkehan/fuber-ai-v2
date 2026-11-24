// ── İkon denetimi yardımcısı (0.10 E1, K7) ─────────────────────────────────────────────────────────────────────────────────────
// scripts/dev/ikon-denetle.ps1'i (YALNIZ OKUR) çağırır: Windows'un gösterdiği ikonlar Fuber'in .ico'suyla piksel piksel aynı mı, Electron'un
// kendi ikonundan ayrı mı. Kullananlar: kurulu-duman.mjs (paketlenmiş exe + açık pencereler), ikon-onizle.mjs (geliştirme koşusu).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PS1 = path.join(import.meta.dirname, 'ikon-denetle.ps1');
/** Farklı piksel oranı bu eşiğin altındaysa ikon "aynı" (Windows'un kendi yükleyicisi aynı katmanı açar: beklenen 0). */
export const AYNI_ESIGI = 0.01;
/** Karşı örnek (Electron'un ikonu) en az bu kadar farklı olmalı: ölçüm iki ikonu gerçekten ayırıyor. */
export const AYRI_ESIGI = 0.3;

/** Geliştirme koşusunun çalıştırdığı Electron (karşı örnek): projenin node_modules'u. */
export const electronExe = (kok) => path.join(kok, 'node_modules', 'electron', 'dist', 'electron.exe');

/**
 * Windows PowerShell 5.1 BOM'suz .ps1'i sistemin ANSI kod sayfasıyla okur (Türkçe metinler bozulur); depodaki dosya ise BOM taşıyamaz
 * (tests/kaynak-gorunmez.test.ts: U+FEFF yasak). Bu yüzden her çağrıda geçici bir kopyası UTF-8 BOM'la yazılır ve o çalıştırılır.
 */
function calistir(arg) {
  const kl = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-ikon-denetle-'));
  const kopya = path.join(kl, 'ikon-denetle.ps1');
  try {
    fs.writeFileSync(kopya, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(PS1)]));
    const cikti = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', kopya, ...arg],
      { encoding: 'utf8', timeout: 90000, windowsHide: true });
    return JSON.parse(cikti.trim());
  } finally {
    fs.rmSync(kl, { recursive: true, force: true });
  }
}

/** exe'nin kaynak ikonu: [{ Ad: 'iliskili' | 'kaynak256' | 'kaynak32', Boy, Fark, KarsiFark, Hata }]. */
export const exeIkonlari = ({ exe, ico, karsi }) => calistir(['-Kip', 'exe', '-Exe', exe, '-Ico', ico, ...(karsi ? ['-Karsi', karsi] : [])]);

/** Pencerelerin görev çubuğu/Alt+Tab ikonu: [{ Hwnd, Var, Gorunur, AracPenceresi, Baslik, Kimlik, BuyukVerilmis, KucukVerilmis, Buyuk, Kucuk }]. */
export const pencereIkonlari = ({ hwnd, ico, karsi }) => (hwnd.length === 0 ? []
  : calistir(['-Kip', 'pencere', '-Hwnd', hwnd.join(','), '-Ico', ico, ...(karsi ? ['-Karsi', karsi] : [])]));

/** Bir ölçüm Fuber'in ikonu mu: .ico ile aynı, Electron'unkinden ayrı. */
export const fuberIkonuMu = (o) => Boolean(o && !o.Hata && o.Fark <= AYNI_ESIGI && o.KarsiFark >= AYRI_ESIGI);

/** Ana süreçteki bütün BrowserWindow'lar ve yerel tutamaçları (Playwright ElectronApplication). */
export const acikPencereler = (u) => u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
  const b = w.getNativeWindowHandle();
  return {
    id: w.id, baslik: w.getTitle(), adres: w.webContents.getURL().split('?')[0], gorunur: w.isVisible(),
    hwnd: (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString(),
  };
}));

/** Pencere listesi + ikon ölçümü birleşik: [{ ...pencere, olcum }]. Pencerenin adı: sayfa dosyası (index.html, asistan.html…). */
export async function pencereleriOlc(u, { ico, karsi }) {
  const p = await acikPencereler(u);
  const o = pencereIkonlari({ hwnd: p.map((x) => x.hwnd), ico, karsi });
  return p.map((x) => ({ ...x, ad: path.posix.basename(x.adres) || x.baslik || `pencere ${x.id}`, olcum: o.find((y) => y.Hwnd === x.hwnd) }));
}

/** Bir pencerenin ikonu (büyük: görev çubuğu/Alt+Tab, küçük: sistem menüsü) Fuber'in ve AÇIKÇA verilmiş mi (sınıf ikonuna düşmeden). */
export const pencereIkonuTamam = (x) => Boolean(x.olcum?.Var && x.olcum.BuyukVerilmis && x.olcum.KucukVerilmis && fuberIkonuMu(x.olcum.Buyuk) && fuberIkonuMu(x.olcum.Kucuk));

/** Kısa özet (denetim ayrıntısı için). */
export const pencereOzeti = (x) => `${x.ad}: büyük ${x.olcum?.Buyuk?.Boy ?? '?'} px fark ${x.olcum?.Buyuk?.Fark ?? '?'} (Electron ${x.olcum?.Buyuk?.KarsiFark ?? '?'})${x.olcum?.BuyukVerilmis ? '' : ' [verilmemiş]'}, küçük ${x.olcum?.Kucuk?.Boy ?? '?'} px fark ${x.olcum?.Kucuk?.Fark ?? '?'}${x.olcum?.KucukVerilmis ? '' : ' [verilmemiş]'}, kimlik ${x.olcum?.Kimlik || '—'}`;
