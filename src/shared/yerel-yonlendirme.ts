// ── "Yalnız bu bilgisayar"da işe göre yönlendirme (11 Kas analizi §5, §6.3; saf, birim testli: tests/yerel-yonlendirme.test.ts) ────────────
// Ölçüm (Bonsai 2 · 9B, 20 yönetici görevi): selamlama, özet, taslak, çeviri ve hafızadan olgu getirme iyi; hesap, tarih ve takvim 2/10.
// Kural: yerel model yazar, özetler, çevirir, hatırlar; hatırlatıcı, yapılacak iş, tarih ve aritmetik KODLA yapılır (onay kartı ya da kesin
// sonuç); kodla çözülemeyen hesap ve takvim sorusunda yanıtın sonuna dürüst bir satır eklenir. Sınıflama temkinlidir: emin değilse 'genel'.
import { zamanCoz, tarihMetni, type ZamanCozumu } from './tr-zaman.ts';

const HARITA: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };
const sade = (s: string): string => s.toLocaleLowerCase('tr-TR').replace(/[ışğüöçâîû]/g, (h) => HARITA[h] ?? h).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`´]/g, ' ').replace(/\s+/g, ' ').trim();

export type YerelIs = 'hatirlatici' | 'gorev' | 'tarih' | 'hesap' | 'takvim' | 'genel';

const HATIRLAT = /\bhatirlat(?!ici(lar)?(im|imi|i)? (neler|ne|listesi))(ir misin|irsin|sana|ma(yi|m)? unutma|abilir misin|)?\b|\bhatirlatici (kur|ekle)/;
const GOREV = /\b(yapilacaklar(a|ima|imiza)|yapilacak (is|isler)(e|ime)?|listeme|gorevlerime|gorev olarak) (ekle|yaz|koy)|\b(gorev|yapilacak) ekle\b/;
const TARIH = /\b(hangi gun(e|u)?|hangi tarih|ne zaman (olur|eder|duser|denk gelir)|gunlerden ne|ayin kaci|tarih ne|bugun ne gun)\b/;
const TAKVIM = /\b(takvim\w*|program(im|imda)|ajanda\w*|bos (zaman|saat|vakt)\w*|musait\w*|bugun (neler|ne) var|yarin (neler|ne) var|kacta toplanti\w* var|toplanti(m|larim) var mi|hatirlaticilar(im)? (neler|ne))\b/;
const HESAP_IZI = /(%|\byuzde\b|\bhesapla|\bkac eder\b|\btoplam\w*\b|\bortalama\w*\b|\bmarj\w*\b|\bcarp|\bbol\b|\bbolu\b|\bkarli\w*\b|\bkar orani)/;

/** Mesajın işi. Hatırlatma ve yapılacak iş isteği önce; tarih, aritmetik, takvim sonra; geri kalan 'genel' (model). */
export function yerelIsTuru(metin: string): YerelIs {
  const s = sade(metin);
  if (/\bhatirliyor (mu|musun)\b/.test(s) && !HATIRLAT.test(s)) return 'genel';
  if (HATIRLAT.test(s)) return 'hatirlatici';
  if (GOREV.test(s)) return 'gorev';
  if (TARIH.test(s) && zamanCoz(metin)) return 'tarih';
  if (aritmetik(metin)) return 'hesap';
  if (TAKVIM.test(s)) return 'takvim';
  // Yüzde geçen her cümle hesap değildir ("zam tavanımız %18"): soru ya da hesap fiili de gerekir.
  if (HESAP_IZI.test(s) && /\d/.test(s) && (/\?/.test(metin) || /\b(hesapla\w*|kac|ne kadar|nedir|bul)\b/.test(s))) return 'hesap';
  return 'genel';
}

const ilkBuyuk = (s: string) => (s ? s[0].toLocaleUpperCase('tr-TR') + s.slice(1) : s);

/** Hatırlatıcı başlığı: zaman parçaları, "hatırlat" fiili ve dolgu sözcükleri çıkar; son sözcüğün belirtme eki ("toplantısını" → "toplantısı"). */
export function hatirlaticiBasligi(metin: string, z: ZamanCozumu | null): string {
  let t = ` ${metin.replace(/[’'`´]/g, '’')} `;
  // Olayın kendisi ("… 24 Ekim cumartesi 15:00’te. O gün … bir gün önce de hatırlat"): ilk cümle başlıktır.
  if (z?.olay) t = ` ${metin.split(/(?<=[.!?])\s+/)[0]} `;
  const kaldir = [
    /\b(bana |lütfen |bir )?hatırlat(ır mısın|abilir misin|ırsın|mayı unutma|ma|ıcı kur|ıcı ekle)?\b[.!?]?/giu,
    /\b(her )?(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)( günü)?(’?(ye|ya|e|a|de|da|te|ta))?\b/giu,
    /\b(yarın|bugün|öbür gün|ertesi gün|haftaya|gelecek hafta|her gün|her ay|sabah|öğleden sonra|öğlen|öğle|akşam|gece)\b/giu,
    /\b\d{1,2}[:.]\d{2}(’?\s?[a-zçğıöşü]{1,3})?\b/giu,
    /\bsaat \d{1,2}( buçuk)?\b/giu,
    /\b\d{1,2} (ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)( \d{4})?(’?[a-zçğıöşü]{1,3})?\b/giu,
    /\b(\d{1,3}|bir|iki|üç|yarım) (dakika|saat|gün|hafta) (sonra|önce)( de| da)?\b/giu,
    /\b(kızım|oğlum) /giu,
  ];
  for (const re of kaldir) t = t.replace(re, ' ');
  t = t.replace(/\b(var|de|da|ki|için|olarak|lütfen)\b(?=[\s,.!?]*$)/giu, ' ').replace(/[,.;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/(s[ıiuü])n[ıiuü]$/u, '$1').replace(/’(y?[ıiuü]|n[ıiuü])$/u, '');
  return ilkBuyuk(t).slice(0, 120) || 'Hatırlatma';
}

/** Yapılacak iş başlığı ve son tarih ("21 Ekim’e kadar"). */
export function gorevBasligi(metin: string, simdi: Date = new Date()): { baslik: string; sonTarih?: Date } {
  const z = /\bkadar\b/i.test(metin) ? zamanCoz(metin, simdi) : null;
  let t = metin
    .replace(/\b(yapılacaklar(a|ıma|ımıza)|yapılacak (iş|işler)(e|ime)?|listeme|görevlerime|görev olarak)\s+(ekle|yaz|koy)\w*/giu, ' ')
    .replace(/\b(görev|yapılacak) ekle\w*/giu, ' ')
    .replace(/[,;]?\s*\d{1,2} (ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\S*\s+kadar\b\s*(bitmeli|bitsin|tamamlanmalı)?/giu, ' ')
    .replace(/[,;]?\s*(yarın|cuma|haftaya)\S*\s+kadar\b/giu, ' ')
    .replace(/[.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/(s[ıiuü])n[ıiuü]$/u, '$1').replace(/’?(y?[ıiuü])$/u, (x) => (x.startsWith('’') ? '' : x));
  return { baslik: ilkBuyuk(t).slice(0, 160) || 'Yapılacak iş', ...(z ? { sonTarih: z.zaman } : {}) };
}

// ── Aritmetik: yalnız rakam ve işlem işaretlerinden oluşan ifade (eval yok; küçük ayrıştırıcı) ──
type Simge = { t: 'say'; v: number } | { t: 'op'; v: string };
function simgeler(ifade: string): Simge[] | null {
  const out: Simge[] = [];
  const re = /\s*(\d+(?:[.,]\d+)?|[-+*/()^])/y;
  let i = 0;
  while (i < ifade.length) {
    re.lastIndex = i;
    const m = re.exec(ifade);
    if (!m) return /^\s*$/.test(ifade.slice(i)) ? out : null;
    out.push(/\d/.test(m[1]) ? { t: 'say', v: Number(m[1].replace(',', '.')) } : { t: 'op', v: m[1] });
    i = re.lastIndex;
  }
  return out;
}
function hesapEt(s: Simge[]): number | null {
  let i = 0;
  const birincil = (): number | null => {
    const x = s[i++];
    if (!x) return null;
    if (x.t === 'say') return x.v;
    if (x.v === '-') { const v = birincil(); return v === null ? null : -v; }
    if (x.v === '(') { const v = toplam(); if (s[i]?.v !== ')') return null; i++; return v; }
    return null;
  };
  const us = (): number | null => { const a = birincil(); if (a === null) return null; if (s[i]?.v === '^') { i++; const b = us(); return b === null ? null : a ** b; } return a; };
  const carpim = (): number | null => {
    let a = us();
    while (a !== null && (s[i]?.v === '*' || s[i]?.v === '/')) { const op = s[i++].v; const b = us(); if (b === null) return null; a = op === '*' ? a * b : b === 0 ? null : a / b; }
    return a;
  };
  const toplam = (): number | null => {
    let a = carpim();
    while (a !== null && (s[i]?.v === '+' || s[i]?.v === '-')) { const op = s[i++].v; const b = carpim(); if (b === null) return null; a = op === '+' ? a + b : a - b; }
    return a;
  };
  const v = toplam();
  return v !== null && i === s.length && Number.isFinite(v) ? v : null;
}

/** Sayıyı Türkçe biçimde yazar (binlik nokta, ondalık virgül; en çok 4 basamak). */
export const sayiMetni = (n: number): string => n.toLocaleString('tr-TR', { maximumFractionDigits: 4 });

/** Kodla çözülebilen hesap: "12*(3+4)", "1250 + 380 kaç eder", "1.500’ün %40’ı", "2.400’ün yüzde 15’i". Sonuç metni ya da null. */
export function aritmetik(metin: string): { ifade: string; sonuc: number } | null {
  const s = sade(metin).replace(/\b(kac eder|kactir|nedir|hesapla|sonuc|esittir|=|\?)\b/g, ' ').replace(/[=?]/g, ' ').trim();
  const sayiOku = (x: string) => Number(x.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  let m = s.match(/^(\d[\d.,]*)\s*(?:un|in|nin|nun|un)?\s*(?:%|yuzde)\s*(\d[\d.,]*)\s*(?:i|si|u|su|ı|si)?\s*(fazlasi|eksigi)?$/);
  if (m) {
    const a = sayiOku(m[1]), p = sayiOku(m[2]);
    const v = m[3] === 'fazlasi' ? a * (1 + p / 100) : m[3] === 'eksigi' ? a * (1 - p / 100) : (a * p) / 100;
    return { ifade: `${sayiMetni(a)} × %${sayiMetni(p)}${m[3] ? ` (${m[3] === 'fazlasi' ? 'fazlası' : 'eksiği'})` : ''}`, sonuc: v };
  }
  const ifade = s.replace(/\bx\b|×/g, '*').replace(/÷/g, '/').replace(/(\d)\.(?=\d{3}\b)/g, '$1');
  if (!/[-+*/^]/.test(ifade) || /[a-z]/.test(ifade)) return null;
  const t = simgeler(ifade);
  if (!t || t.filter((x) => x.t === 'say').length < 2) return null;
  const v = hesapEt(t);
  return v === null ? null : { ifade: ifade.replace(/\s+/g, ' '), sonuc: v };
}

/** Kodla verilen tarih yanıtı ("45 gün sonra hangi gün", "haftaya salı ne zaman denk gelir", "bugün ayın kaçı"); çözülemezse null. */
export function tarihYaniti(metin: string, simdi: Date = new Date()): string | null {
  const s = sade(metin);
  if (/\b(bugun ne gun|ayin kaci|gunlerden ne|bugun hangi gun)\b/.test(s) && !/sonra|once|haftaya/.test(s)) return `Bugün ${tarihMetni(simdi)}.`;
  const z = zamanCoz(metin, simdi);
  if (!z) return null;
  const hedef = z.olay ?? z.zaman;
  const saat = z.saatVar ? `, saat ${String(hedef.getHours()).padStart(2, '0')}:${String(hedef.getMinutes()).padStart(2, '0')}` : '';
  return `Sonuç: ${tarihMetni(hedef)}${saat}.`;
}

/** Kodla çözülemeyen hesap sorusunda yerel yanıtın sonuna eklenen dürüst satır. */
export const YEREL_HESAP_NOTU = 'Not: Bu hesabı bu bilgisayardaki yapay zekâ yaptı; önemliyse sonucu doğrula.';
/** Takvim sorusunda: yalnız Fuber'deki hatırlatıcı ve yapılacaklar görülür. */
export const YEREL_TAKVIM_NOTU = 'Takvim uygulamana buradan bakamıyorum; bu liste yalnız Fuber’deki hatırlatıcı ve yapılacaklardan.';
