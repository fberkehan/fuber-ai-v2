// ── Genel (her uygulamada geçerli) kısayollar ve güvenlik denetimi (saf) ─────────────────────────────────────────────────
// Görev 20b düzeltme turu 1: acil durdurma Ctrl+Alt+Q idi. Windows'ta AltGr = Ctrl+Alt; Türkçe Q klavyede AltGr+Q = "@" (Türkçe F'de
// de AltGr birleşimleri karakter yazar: € { [ ] } \ | ~ …). Genel kısayol tuşu yuttuğu için her "@" yazışta Fuber'in bütün işi
// duruyor, karakter de yazılmıyordu. Yeni acil durdurma Alt+Shift+Q (Ctrl yok; sol Alt birleşimi karakter yazmaz; Windows'ta,
// Office'te ve tarayıcılarda boş). Mac'te Option+tuş karakter yazdığı için ⌘+Shift+Esc.
// `genelKisayolSorunu`: bir genel kısayol yasak kümede mi — (1) Ctrl+Alt + yazı tuşu (AltGr), (2) Mac'te Option + yazı tuşu,
// (3) işletim sistemi ve yaygın uygulama kısayolları. Ayarlar'daki asistan kısayolu bununla denetlenir (ana süreç de reddeder).
// Kayıtlı bir değer yalnız ESKİ VARSAYILANA eşitse taşınır: acil durdurma ayarda tutulmaz (sabit), asistan varsayılanı değişmedi →
// taşınacak kayıtlı değer yok.
import { kisayolGosterimi } from './kisayol.ts';

export const ACIL_DURDURMA = 'Alt+Shift+Q';
export const ACIL_DURDURMA_MAC = 'Command+Shift+Escape';
export const ACIL_DURDURMA_METNI = 'Alt+Shift+Q';
export const ESKI_ACIL_DURDURMA = 'Control+Alt+Q';
export const VARSAYILAN_ASISTAN = 'CommandOrControl+Shift+Space';

export const acilDurdurmaKisayolu = (platform: string = typeof process !== 'undefined' ? process.platform : 'win32') =>
  (platform === 'darwin' ? ACIL_DURDURMA_MAC : ACIL_DURDURMA);

// ── Kısayol gerçekten alındı mı (düzeltme turu 2) ──
// Acil durdurma başka bir uygulamada kayıtlıysa `globalShortcut.register` sessizce false dönüyordu; tepsi ve Ayarlar yine
// "Alt+Shift+Q" diyordu. Artık ana süreç durumu tutar (bir kez bildirim gösterir); alınamayan tuş hiçbir yerde söz verilmez.

/** Genel kısayolların gerçek durumu (ana süreç: main.ts → `kisayol:durum`, değişince `kisayol:degisti`). `asistan.sorun`: alınamadıysa
 *  nedeni (A12: kayıtlı kısayol yasak kümede ya da başka bir uygulamada). */
export interface KisayolDurumu { acil: { tus: string; alindi: boolean }; asistan: { tus: string; alindi: boolean; sorun?: string } }

/**
 * A12 (son düzeltme): Ayarlar → Ses ve ada'daki asistan kısayolu notu — kayıtlı kısayol alınamadıysa (açılışta da denetlenir: yasak
 * kümedeyse hiç alınmaz) nedeni ve "değiştir"; alındıysa ya da durum bilinmiyorsa null.
 */
export function asistanKisayolNotu(a: KisayolDurumu['asistan'] | null | undefined, okunur: string): string | null {
  if (!a || a.alindi) return null;
  return ` Asistan kısayolu (${okunur}) alınamadı: ${a.sorun ?? 'başka bir uygulama kullanıyor ya da geçersiz.'} Değiştirmek için yeni bir kısayol yaz.`;
}

// ── Sabit metinlerdeki acil durdurma tuşu (B8, son düzeltme) ──
// Ayarlar (dizin.ts), Beyin bölge metinleri (beyin.ts) ve telefon sabit "Alt+Shift+Q" diyordu: tuş alınamamışsa da, Mac'te de
// (⌘+Shift+Esc). Artık metinlerde yer tutucu var; gösterilirken gerçek duruma göre doldurulur (tek kaynak).
export const ACIL_YER = '{acil}';
/** Acil durdurma tuşu alınamadıysa söylenecek yer (ada, imleç şeridi, Ayarlar, sihirbaz, Fuber Tarayıcı aynı ifade). */
export const ACIL_YEDEK_METNI = 'tepsideki “Tümünü durdur”';
/** Metindeki yer tutucuyu doldurur. `tus`: okunur tuş (alındı) · null: alınamadı → tepsi · undefined: bu yüzeyde durum bilinmiyor
 *  (telefon) → tuş söz verilmeden genel ad. */
export function acilYerlestir(metin: string, tus: string | null | undefined): string {
  if (!metin.includes(ACIL_YER)) return metin;
  return metin.split(ACIL_YER).join(tus === undefined ? 'bilgisayardaki acil durdurma kısayolu' : tus ?? ACIL_YEDEK_METNI);
}

/** Tepsideki satır: tuş yalnız gerçekten alındıysa yazılır. `okunur`: kisayolOkunur ile okunur hâli. */
export const tepsiDurdurEtiketi = (alindi: boolean, okunur: string) => (alindi ? `Tümünü durdur (${okunur})` : 'Tümünü durdur');

/** Ayarlar'daki acil durdurma notu (asistan kısayolu satırı); durum bilinmiyorsa null (yanlış söz de, yanlış uyarı da yok). */
export function acilDurdurmaNotu(alindi: boolean | null, okunur: string): { metin: string; sorun: boolean } | null {
  if (alindi === null) return null;
  return alindi
    ? { metin: ` Acil durdurma: ${okunur}.`, sorun: false }
    : { metin: ` Acil durdurma kısayolu (${okunur}) alınamadı: başka bir uygulama kullanıyor. Fuber’i durdurmak için tepsideki “Tümünü durdur”u kullan.`, sorun: true };
}

/** Engellemeyen, belgeli çakışmalar: varsayılan kalır (Görev 20b raporu). */
export const BILINEN_CAKISMALAR: Record<string, string> = {
  [VARSAYILAN_ASISTAN]: 'Word: bölünmez boşluk; Excel: bütün sayfayı seç; VS Code: parametre ipuçları',
};

interface Ayrik { ctrl: boolean; alt: boolean; shift: boolean; super: boolean; tus: string }

function ayir(k: string, platform: string): Ayrik | null {
  const p = k.split('+').map((x) => x.trim()).filter(Boolean);
  if (!p.length) return null;
  const a: Ayrik = { ctrl: false, alt: false, shift: false, super: false, tus: '' };
  for (const x of p) {
    const y = x.toLowerCase();
    if (y === 'control' || y === 'ctrl') a.ctrl = true;
    else if (y === 'commandorcontrol' || y === 'cmdorctrl') { if (platform === 'darwin') a.super = true; else a.ctrl = true; }
    else if (y === 'command' || y === 'cmd' || y === 'super' || y === 'meta') a.super = true;
    else if (y === 'alt' || y === 'option' || y === 'altgr') a.alt = true;
    else if (y === 'shift') a.shift = true;
    else a.tus = TUS_ESI[x.toUpperCase()] ?? x.toUpperCase();
  }
  return a.tus ? a : null;
}

const TUS_ESI: Record<string, string> = { ESCAPE: 'ESC', DEL: 'DELETE', INS: 'INSERT', RETURN: 'ENTER' };

/** Karakter yazan (yazı) tuşu: harf (Türkçe dahil), rakam, noktalama. F tuşları, boşluk, oklar, Esc, Tab… değil. */
const yaziTusu = (t: string) => t.length === 1 || /^(PLUS|MINUS|NUM[0-9]|NUMADD|NUMSUB|NUMMULT|NUMDIV|NUMDEC)$/.test(t);

const YAYGIN: string[] = [
  // Pencere ve sistem
  'alt+F4', 'alt+TAB', 'alt+shift+TAB', 'alt+SPACE', 'alt+ESC', 'alt+shift+ESC', 'ctrl+ESC', 'ctrl+shift+ESC', 'ctrl+alt+DELETE',
  // Tarayıcı / düzenleyici
  'ctrl+TAB', 'ctrl+shift+TAB', 'ctrl+shift+T', 'ctrl+shift+N', 'ctrl+shift+W', 'ctrl+shift+Q', 'ctrl+shift+I', 'ctrl+shift+J',
  'ctrl+shift+DELETE', 'ctrl+shift+P', 'ctrl+shift+S', 'ctrl+shift+Z', 'ctrl+shift+V', 'ctrl+shift+C', 'ctrl+shift+F', 'ctrl+shift+R',
  'shift+DELETE', 'shift+INSERT', 'ctrl+INSERT', 'shift+F10',
];

function imza(a: Ayrik): string {
  return [a.super && 'super', a.ctrl && 'ctrl', a.alt && 'alt', a.shift && 'shift'].filter(Boolean).join('+') + `+${a.tus}`;
}

/** Genel kısayolun sorunu (Türkçe, kullanıcıya gösterilir) ya da null. */
export function genelKisayolSorunu(k: string, platform: string = typeof process !== 'undefined' ? process.platform : 'win32'): string | null {
  if (!k.trim()) return 'Kısayol boş.';
  const a = ayir(k, platform);
  // 0.10 Görev 3 düzeltme turu 1: örnek Electron yazımıyla değil, gösterimle (platforma göre).
  if (!a) return `Kısayolda bir tuş olmalı (ör. ${kisayolGosterimi(VARSAYILAN_ASISTAN, platform === 'darwin')}).`;
  if (platform !== 'darwin' && a.ctrl && a.alt && yaziTusu(a.tus)) {
    return 'Ctrl+Alt birleşimi Türkçe klavyede AltGr ile karakter yazar (ör. AltGr+Q = @); her yazışta kısayol tetiklenir. Ctrl+Shift ya da Alt+Shift kullan.';
  }
  if (platform === 'darwin' && a.alt && !a.super && !a.ctrl && yaziTusu(a.tus)) return 'Mac\'te Option + tuş karakter yazar; ⌘ ile birlikte kullan.';
  if (platform !== 'darwin' && a.super) return 'Windows tuşu birleşimleri sisteme ayrılmıştır.';
  if (!a.alt && !a.shift && !a.super && (a.ctrl || platform === 'darwin') && yaziTusu(a.tus)) return 'Tek Ctrl + tuş uygulamaların kendi kısayoludur (kopyala, kaydet…); Shift ya da Alt ekle.';
  if (!a.ctrl && !a.alt && !a.shift && !a.super && /^F([1-9]|1[0-2])$/.test(a.tus)) return 'Tek başına F tuşu uygulamaların kendi kısayoludur; Ctrl+Shift ekle.';
  if (YAYGIN.includes(imza(a))) return 'Bu kısayolu Windows ya da yaygın uygulamalar (tarayıcı, Office) kullanıyor.';
  return null;
}
