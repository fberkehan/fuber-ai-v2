// ── Sayıları yazıyla okuma (Görev 21 düzeltme 7; saf, birim testli: tests/sayi-okuma.test.ts) ─────────────────────────────────────
// ElevenLabs belgesi (Best practices → Normalization, 25 Eki 2026'da okundu): normalleştirme varsayılan açık, ama Flash v2.5 küçük bir
// model ve sayıları zayıf okur ("$1,000,000" → "one thousand thousand dollars"); öneri: metni seslendirmeden önce düzeltmek. Asistanın
// en sık söylediği şeyler saat, tarih ve tutar olduğu için konuşulacak her cümle burada Türkçe yazıya çevrilir (main/ses/konusma.ts):
//   "10:00'da" → "onda", "12.30’da" → "on iki otuzda", "25.10.2026" → "yirmi beş Ekim iki bin yirmi altı", "3.500.000 TL" → "üç milyon
//   beş yüz bin lira", "$1,000,000" → "bir milyon dolar", "1.250,50 TL" → "bin iki yüz elli lira elli kuruş", "%40" → "yüzde kırk",
//   "3. kez" → "üçüncü kez", "3,5" → "üç virgül beş", "Python 3.12" → "üç nokta on iki", "v0.9.0" → "sıfır nokta dokuz nokta sıfır",
//   "3'te" → "üçte".
// Ek, kesme işaretinden sonra yazıldığı gibi kalır: Türkçede ek söylenişe göre yazıldığından ("10'da" = "onda") doğru okunur.

const BIRLER = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const ONLAR = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const BUYUK: [number, string][] = [[1e9, 'milyar'], [1e6, 'milyon'], [1e3, 'bin']];

function yuzlu(n: number): string {
  const y = Math.floor(n / 100), o = Math.floor((n % 100) / 10), b = n % 10;
  return [y ? (y === 1 ? 'yüz' : `${BIRLER[y]} yüz`) : '', ONLAR[o], BIRLER[b]].filter(Boolean).join(' ');
}

/** 0 ≤ n < 10¹² tam sayının Türkçe okunuşu ("bin", "bir milyon", "iki bin yirmi altı"). Aralık dışı: rakamlar. */
export function sayiYazi(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n);
  if (n === 0) return 'sıfır';
  const parcalar: string[] = [];
  let kalan = n;
  for (const [deger, ad] of BUYUK) {
    const k = Math.floor(kalan / deger);
    if (k) parcalar.push(deger === 1e3 && k === 1 ? 'bin' : `${sayiYazi(k)} ${ad}`);
    kalan %= deger;
  }
  if (kalan) parcalar.push(yuzlu(kalan));
  return parcalar.join(' ');
}

/** Sıra sayısı ("birinci", "dördüncü", "yirmi beşinci"): -(I)ncI, büyük ünlü uyumuyla; "dört" → "dörd-". */
export function siraYazi(n: number): string {
  const yazi = sayiYazi(n);
  const kok = yazi.endsWith('dört') ? `${yazi.slice(0, -4)}dörd` : yazi;
  const unlu = [...kok].reverse().find((c) => 'aıoueiöü'.includes(c)) ?? 'i';
  const u = 'aı'.includes(unlu) ? 'ı' : 'ei'.includes(unlu) ? 'i' : 'ou'.includes(unlu) ? 'u' : 'ü';
  return /[aıoueiöü]$/.test(kok) ? `${kok}nc${u}` : `${kok}${u}nc${u}`;
}

/** Rakamla yazılan sayıya gelen 3. tekil iyelik eki, sayının OKUNUŞUNA göre ("payın %40’ı", "%50’si", "%6’sı", "%100’ü"; G2 düzeltme
 *  turu 1 — eskiden hep "’i"): son sözcüğün son ünlüsü (dört yollu uyum); sözcük ünlüyle bitiyorsa kaynaştırma "s". Kesirli sayı yuvarlanır. */
export function iyelikEki(n: number): string {
  const yazi = sayiYazi(Math.abs(Math.round(n)));
  const unlu = [...yazi].reverse().find((c) => 'aıoueiöü'.includes(c)) ?? 'i';
  const u = 'aı'.includes(unlu) ? 'ı' : 'ei'.includes(unlu) ? 'i' : 'ou'.includes(unlu) ? 'u' : 'ü';
  return /[aıoueiöü]$/.test(yazi) ? `s${u}` : u;
}

/** Rakam dizisi: baştaki sıfır ayrı okunur ("05" → "sıfır beş"); çok uzun diziler rakam rakam. */
function rakamlar(s: string): string {
  if (s.length > 12) return [...s].map((c) => (c === '0' ? 'sıfır' : BIRLER[Number(c)])).join(' ');
  if (s.length > 1 && s.startsWith('0')) return `sıfır ${rakamlar(s.slice(1))}`;
  return sayiYazi(Number(s));
}

const ek = (e?: string) => e ?? '';

// ── Sayı belirteci: binlik ve ondalık ayırıcıları (düzeltme turu 2) ──
// Sayı belirteci rakamla başlar ve rakamla BİTER (`\d(?:[\d.,]*\d)?`): cümle sonundaki nokta/virgül sayıya yapışmaz ("$50." → "elli
// dolar."; eskiden "ellinci dolar").
//  - İki ayırıcı birden: SONUNCUSU ondalık, öteki binlik — TR "1.250,50" ve EN "1,000,000.5" ikisi de.
//  - Yalnız virgül: üçlü gruplar ("1,000", "1,000,000") EN binlik; değilse ondalık ("3,5", "3,25").
//  - Yalnız nokta: üçlü gruplar ("1.250", "3.500.000") TR binlik; değilse noktalı sayı — "nokta" okunur ("Python 3.12" → "üç nokta on
//    iki", "1.25" → "bir nokta yirmi beş"); saat YALNIZ bağlam söylerse (iki nokta üst üste, "saat 14.30", "14.30'da", "gibi/civarı").
//    Para tutarında nokta ondalıktır ("$3.50" → "üç dolar elli sent").
const SAYI = String.raw`\d(?:[\d.,]*\d)?`;
interface Sayi { tam: string; ondalik?: string; ayrac?: 'virgül' | 'nokta' }

function sayiCoz(s: string, para = false): Sayi | null {
  const n = s.includes('.'), v = s.includes(',');
  if (n && v) {
    const k = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const binlik = s[k] === '.' ? ',' : '.';
    const tam = s.slice(0, k);
    if (!new RegExp(`^\\d{1,3}(\\${binlik}\\d{3})*$`).test(tam) || !/^\d+$/.test(s.slice(k + 1))) return null;
    return { tam: tam.split(binlik).join(''), ondalik: s.slice(k + 1), ayrac: 'virgül' };
  }
  if (v) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) return { tam: s.replace(/,/g, '') };
    const p = s.split(',');
    return p.length === 2 ? { tam: p[0], ondalik: p[1], ayrac: 'virgül' } : null;
  }
  if (n) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return { tam: s.replace(/\./g, '') };
    const p = s.split('.');
    return p.length === 2 ? { tam: p[0], ondalik: p[1], ayrac: para ? 'virgül' : 'nokta' } : null;
  }
  return /^\d+$/.test(s) ? { tam: s } : null;
}
const sayiOku = (x: Sayi) => `${rakamlar(x.tam)}${x.ondalik ? ` ${x.ayrac} ${rakamlar(x.ondalik)}` : ''}`;

const PARA: Record<string, [string, string]> = { '₺': ['lira', 'kuruş'], TL: ['lira', 'kuruş'], $: ['dolar', 'sent'], '€': ['avro', 'sent'], '£': ['sterlin', 'peni'] };
/** Tutar: iki haneli kesir alt birimle ("1.250,50 TL" → "bin iki yüz elli lira elli kuruş"); başka kesir "virgül". */
function paraOku(s: string, isaret: string): string | null {
  const x = sayiCoz(s, true);
  const [birim, alt] = PARA[isaret];
  if (!x) return null;
  if (x.ondalik?.length === 2) { const k = Number(x.ondalik); return `${rakamlar(x.tam)} ${birim}${k ? ` ${sayiYazi(k)} ${alt}` : ''}`; }
  return `${sayiOku(x)} ${birim}`;
}

/** Noktalı H.MM (ya da H.MM–H.MM aralığı) ondalık mı (düzeltme turu 5)? Türkçede ondalık ayırıcı virgüldür; noktalı H.MM (H ≤ 23,
 *  MM ≤ 59) varsayılan olarak SAATTİR. Ondalık sayılır yalnız: (1) bu sözcüklerden biri sayıdan en çok 12 karakter önce biter — oran,
 *  ortalama, sürüm, versiyon, yüzde, endeks, katsayı ("Değerli", "Kur toplantısı", "Puan toplantısı" saat bağlamını bozmaz); (2) hemen
 *  önünde "v", "x" ya da "%"; (3) hemen arkasında birim (TL, ₺, $, €, kg, km, m, cm, mm, puan, kat, x, %). Aralıkta bir kez karar verilir:
 *  `bas` ilk ucun başı, `son` ikinci ucun sonu — iki uç hep aynı okunur. */
const ONDALIK_ONCE = /(?<!\p{L})(?:oran\p{L}*|ortalama\p{L}*|sürüm\p{L}*|versiyon\p{L}*|yüzde(?:si|sı|lik\p{L}*)?|endeks\p{L}*|katsayı\p{L}*)(?!\p{L})[^]{0,12}$/iu;
const ONDALIK_ON_ISARET = /(?:^|[^\p{L}\d])[vx]$|%$/iu;
const ONDALIK_BIRIM = /^\s?(?:TL|₺|\$|€|kg|km|m|cm|mm|puan\p{L}*|kat(?:ı|lık)?|x|%)(?!\p{L})/iu;
function ondalikMi(metin: string, bas: number, son: number): boolean {
  const once = metin.slice(Math.max(0, bas - 40), bas);
  return ONDALIK_ONCE.test(once) || ONDALIK_ON_ISARET.test(once) || ONDALIK_BIRIM.test(metin.slice(son, son + 8));
}

/** Sözcüğün son ünlüsü kalın mı (a ı o u)? */
const kalin = (s: string) => { const u = [...s.toLocaleLowerCase('tr')].reverse().find((c) => 'aıoueiöü'.includes(c)); return u ? 'aıou'.includes(u) : false; };
const saatYazi = (s: number, d: string) => `${sayiYazi(s)}${d === '00' ? '' : ` ${rakamlar(d)}`}`;

/** Konuşulacak cümledeki sayıları, saatleri, tarihleri, yüzdeleri, tutarları ve sürüm numaralarını Türkçe yazıya çevirir. */
export function sayilariOku(metin: string): string {
  let m = metin;
  // Para: ₺/$/€/£ önde ya da TL/₺ arkada.
  m = m.replace(new RegExp(String.raw`([₺$€£])\s?(${SAYI})`, 'g'), (t, p: string, s: string) => paraOku(s, p) ?? t);
  m = m.replace(new RegExp(String.raw`(?<![\d.,])(${SAYI})\s?(TL|₺)(?!\p{L})`, 'gu'), (t, s: string, p: string) => paraOku(s, p) ?? t);
  // Tarih: 25.10.2026, 25/10/2026, 2026-10-25.
  m = m.replace(/(?<![\d.])(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)(?![./]\d)(?:['’](\p{Ll}+))?/gu, (t, g: string, a: string, y: string, e?: string) => {
    const gun = Number(g), ay = Number(a);
    if (gun < 1 || gun > 31 || ay < 1 || ay > 12) return t;
    return `${sayiYazi(gun)} ${AYLAR[ay - 1]} ${sayiYazi(Number(y))}${ek(e)}`;
  });
  m = m.replace(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])(?:['’](\p{Ll}+))?/gu, (t, y: string, a: string, g: string, e?: string) => {
    const gun = Number(g), ay = Number(a);
    if (gun < 1 || gun > 31 || ay < 1 || ay > 12) return t;
    return `${sayiYazi(gun)} ${AYLAR[ay - 1]} ${sayiYazi(Number(y))}${ek(e)}`;
  });
  // Sürüm: "0.9.0", "v0.9.0", "v2.1" → "sıfır nokta dokuz nokta sıfır" (binlik "3.500.000" sürüm değildir).
  m = m.replace(/(?<![\p{L}\d.,])([vV])?(\d+(?:\.\d+)+)(?![.,]?\d)/gu, (t, v: string | undefined, s: string) => {
    const parca = s.split('.');
    if (!v && (parca.length < 3 || /^\d{1,3}(\.\d{3})+$/.test(s))) return t;
    return parca.map((x) => rakamlar(x)).join(' nokta ');
  });
  // Yüzde: %40, % 12,5, 40%
  m = m.replace(new RegExp(String.raw`%\s?(${SAYI})`, 'g'), (t, s: string) => { const x = sayiCoz(s); return x ? `yüzde ${sayiOku(x)}` : t; });
  m = m.replace(new RegExp(String.raw`(?<![\d.,])(${SAYI})\s?%`, 'g'), (t, s: string) => { const x = sayiCoz(s); return x ? `yüzde ${sayiOku(x)}` : t; });
  // Saat aralığı (düzeltme turu 3-5): H.MM–H.MM varsayılan olarak saattir ("14.00-15.00 arası", "20.30 ile 21.00", "Değerli müşterimiz,
  // randevunuz 10.00 ile 11.00"); önünde "saat" ya da iki nokta üst üste ("9:00–10:30") hep saattir; ondalık yalnız `ondalikMi` söylerse
  // ("Oran 1.25 ile 1.50", "Ortalama 2.50-3.50", "Sürüm 1.10 ve 1.20" → noktalı sayı). Karar aralık başına bir kez. Tire "ile" okunur.
  m = m.replace(/(?<![\d.,:])([01]?\d|2[0-3])([.:])([0-5]\d)\s*(-|–|—|ile|ve)\s*([01]?\d|2[0-3])([.:])([0-5]\d)(?!\d)(?![.,:]\d)(?:['’](\p{Ll}+))?/gu,
    (t, s1: string, a1: string, d1: string, ara: string, s2: string, a2: string, d2: string, e: string | undefined, yer: number, tum: string) => {
      const saatOnde = /(?:^|[^\p{L}])saat\s+$/iu.test(tum.slice(Math.max(0, yer - 12), yer));
      const saatMi = saatOnde || a1 === ':' || a2 === ':' || !ondalikMi(tum, yer, yer + t.length);
      return saatMi ? `${saatYazi(Number(s1), d1)} ${/^[-–—]$/.test(ara) ? 'ile' : ara} ${saatYazi(Number(s2), d2)}${ek(e)}` : t;
    });
  // "HH.00" tek başına saattir (tam saat; ondalık "14.00" yazılmaz): "14.00'te" ek kuralına, "14.00" buraya — `ondalikMi` değilse.
  m = m.replace(/(?<![\d.,:])([01]?\d|2[0-3])\.00(?!\d)(?![.,]\d)(?!['’]\p{Ll})/gu, (t, s: string, yer: number, tum: string) =>
    (ondalikMi(tum, yer, yer + t.length) ? t : sayiYazi(Number(s))));
  // Saat (bağlam söylediğinde): "10:00" (iki nokta üst üste), "saat 14.30", "14.30 gibi/civarı/sularında".
  m = m.replace(/(?<![\d.,:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])(?:['’](\p{Ll}+))?/gu, (_t, s: string, d: string, e?: string) => `${saatYazi(Number(s), d)}${ek(e)}`);
  m = m.replace(/((?:^|[^\p{L}])[Ss]aat\s+)([01]?\d|2[0-3])\.([0-5]\d)(?!\d)(?![.,]\d)(?:['’](\p{Ll}+))?/gu, (_t, on: string, s: string, d: string, e?: string) => `${on}${saatYazi(Number(s), d)}${ek(e)}`);
  m = m.replace(/(?<![\d.,])([01]?\d|2[0-3])\.([0-5]\d)(?=\s+(?:gibi|civarı|civarında|sularında)(?!\p{L}))/gu, (_t, s: string, d: string) => saatYazi(Number(s), d));
  // Gün.ay (bağlam söylediğinde): "12.10 tarihinde" → "on iki Ekim tarihinde".
  m = m.replace(/(?<![\d.,])(\d{1,2})\.(\d{1,2})(?=\s+(?:tarihinde|tarihli|tarihine|tarihi|günü)(?!\p{L}))/gu, (t, g: string, a: string) => {
    const gun = Number(g), ay = Number(a);
    return gun >= 1 && gun <= 31 && ay >= 1 && ay <= 12 ? `${sayiYazi(gun)} ${AYLAR[ay - 1]}` : t;
  });
  // "X.YY'ek": ek ünlü uyumuyla hangi okunuşa yazıldığını söyler — "12.10'da" (on iki ON-da: saat) / "12.10'de" (on iki EKİM-de: tarih).
  m = m.replace(/(?<![\d.,])(\d{1,2})\.(\d{2})['’](\p{Ll}+)/gu, (t, a: string, b: string, e: string) => {
    const x = Number(a), y = Number(b);
    const saat = x <= 23 && y <= 59 ? saatYazi(x, b) : null;
    const tarih = x >= 1 && x <= 31 && y >= 1 && y <= 12 ? `${sayiYazi(x)} ${AYLAR[y - 1]}` : null;
    const ekKalin = kalin(e.match(/[aıoueiöü]/)?.[0] ?? 'a');
    if (tarih && (!saat || (kalin(tarih) === ekKalin && kalin(saat) !== ekKalin))) return `${tarih}${e}`;
    return saat ? `${saat}${e}` : t;
  });
  // Sıra sayısı: "3. kez", "25. yıl" (noktadan sonra küçük harfle başlayan sözcük).
  m = m.replace(/(?<![\d.,])(\d{1,6})\.(?=\s+\p{Ll})/gu, (_t, a: string) => siraYazi(Number(a)));
  // Kalan sayılar (binlik/ondalık ayırıcılarıyla; ek dahil: "3'te" → "üçte"); bitişik harften ayrılır ("3B" → "üç B").
  m = m.replace(new RegExp(String.raw`(?<![\p{L}\d.,])(${SAYI})(?:['’](\p{Ll}+))?(\p{L})?`, 'gu'), (t, s: string, e?: string, harf?: string) => {
    const x = sayiCoz(s);
    return x ? `${sayiOku(x)}${ek(e)}${harf ? ` ${harf}` : ''}` : t.replace(/\d+/g, (d) => ` ${rakamlar(d)} `).replace(/\s+/g, ' ').trim();
  });
  return m;
}
