/**
 * Seslendirme öncesi Türkçe okuma düzeltici: model metinde rakam ve simge üretir; ElevenLabs "Daniel" (İngilizce
 * kökenli ses) ve Piper bunları yanlış ya da İngilizce okur. Yalnız SESE giden metin burada sözcüklere çevrilir;
 * ekranda ve dökümde rakam kalır. Saf, ağsız, deterministik; hiçbir girdide fırlatmaz.
 *
 * Kalıpların ÖNCELİK SIRASI (her aşama bir öncekinin bıraktığı metne uygulanır; neden yanında):
 *  1. üç nokta / tırnaklar        — sonraki kalıpların sınırlarını (cümle sonu, sözcük başı) bozmasın diye en başta.
 *  2. e-posta, alan adı           — içlerindeki nokta ve rakamlar sürüm/ondalık sanılmasın.
 *  3. noktalı kısaltmalar         — "No: 5" gibi rakamın ÖNÜNDEKİ kısaltma, rakam sözcüğe dönmeden yakalanmalı.
 *  4. telefon                     — boşluklu/tireli rakam öbekleri aralık ya da düz sayı sanılmasın.
 *  5. sayısal tarih               — 16.11.2026 sürüm, 16-11-2026 aralık sanılmasın (geçerli gg.aa.yyyy kapısı var).
 *  6. aralık tiresi (10-15)       — tarih ve telefondan SONRA; saat/yüzde/para daha bu aşamada rakamdır, "ile" araya girer.
 *  7. eksi işareti, saat          — "20.00'de" ondalık sanılmasın; geçersiz saatte iki nokta boşluğa döner.
 *  8. para, yüzde, birim          — sayıya bağlı simge/kısaltma, sayı düz sayıya düşmeden alınır.
 *  9. sürüm / IP                  — binlik kalıbına ve tarihe uymayan çok noktalı dizi (binlik sayıya dokunmaz).
 * 10. artı/eşittir/çarpı/bölü     — rakam arası simgeler; rakamlar hâlâ yerinde olduğundan "arası" sınırı kesindir.
 * 11. harf-rakam ayrımı, sıra sayısı, düz sayı (ondalık/binlik dahil) — en genel kalıplar en sonda.
 * 12. harf harf kısaltmalar, tek büyük harf, simgeler, noktalama — sayı sözcükleri küçük harfli ve rakamsızdır;
 *     bu aşamalar rakam kuralını bir daha tetikleyemez, çünkü çıktıda rakam kalmaz.
 * Her aşamanın ürettiği metin rakam içermez (istisna: sürüm sonekindeki "demo.1" gibi artıklar bir sonraki aşamada
 * düz sayıya düşer), bu yüzden bir dönüşümü sonraki kural yeniden bozamaz.
 *
 * v1 uyumu: noktalı sayı/saat/ondalık bağlam kuralları, İngilizce binlik, para tutarında nokta ondalığı, sürüm "v"
 * atma, "H.MM'ek" ünlü-uyumu ipucu ve cümle sonu noktalamanın sayıya yapışmaması, beş tur düzeltilmiş
 * Fuber AI v1 `shared/sayi-okuma.ts`'ten uyarlanmıştır (sayiCoz, ondalikMi, saat aralığı, gün.ay, ek ipucu).
 *
 * Bilinçli kararlar:
 * - Köşeli duygu etiketleri ([laughs], [güler]) bölünerek korunur; içlerine hiçbir kural işlemez.
 * - "fps" → "kare bölü saniye" (Daniel "f p s" der; doğal söyleyiş budur).
 * - Tek büyük harf: İngilizce bağlam şüphesinde dokunulmaz (bkz. `englishContext`); "O" zamirdir, "I'm" bozulmaz.
 * - Alan adının yol kısmı ("example.com/research") ve "10,000" gibi İngilizce binlik virgül çevrilmez.
 */

const DIGIT_WORDS = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALES = ['', 'bin', 'milyon', 'milyar', 'trilyon'];
/** 15 haneye kadar (999 trilyon) sözcükle okunur; ötesi basamak basamak: sesli okumada milyarlarca hane anlamsızdır. */
const MAX_WORD_DIGITS = 15;

const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

function digitByDigit(digits: string): string {
  const out: string[] = [];
  for (const ch of digits) {
    const d = ch.charCodeAt(0) - 48;
    if (d >= 0 && d <= 9) out.push(DIGIT_WORDS[d] ?? '');
  }
  return out.join(' ');
}

function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  const parts: string[] = [];
  // "bir yüz" değil "yüz"; "bir bin" değil "bin": Türkçede çarpan 1 söylenmez (milyon ve üstünde söylenir).
  if (h > 0) parts.push(h === 1 ? 'yüz' : `${DIGIT_WORDS[h] ?? ''} yüz`);
  if (t > 0) parts.push(TENS[t] ?? '');
  if (o > 0) parts.push(DIGIT_WORDS[o] ?? '');
  return parts.join(' ');
}

/** `digits`: baştaki sıfırsız, 1–15 haneli ondalık dizgi. Dizgiyle bölünür: büyük sayılarda kayan nokta bölmesine güvenilmez. */
function cardinalFromDigits(digits: string): string {
  if (/^0+$/.test(digits)) return DIGIT_WORDS[0] ?? 'sıfır';
  const groupCount = Math.ceil(digits.length / 3);
  const padded = digits.padStart(groupCount * 3, '0');
  const parts: string[] = [];
  for (let k = 0; k < groupCount; k++) {
    const g = Number(padded.slice(k * 3, k * 3 + 3));
    if (g === 0) continue;
    const scale = groupCount - 1 - k;
    if (scale === 1 && g === 1) parts.push('bin');
    else parts.push(underThousand(g) + (scale > 0 ? ` ${SCALES[scale] ?? ''}` : ''));
  }
  return parts.join(' ');
}

/** Rakam dizgisinin okunuşu: baştaki sıfır ("007") ve çok uzun diziler (kart/hesap numarası gibi) basamak basamak. */
function intWords(digits: string): string {
  if (!/^\d+$/.test(digits)) return digitByDigit(digits);
  if ((digits.length > 1 && digits.startsWith('0')) || digits.length > MAX_WORD_DIGITS) return digitByDigit(digits);
  return cardinalFromDigits(digits);
}

/** Tam sayının Türkçe okunuşu (negatif "eksi …"); güvenli tam sayı aralığı dışında basamak basamak. */
export function numberToTurkish(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const n = Math.trunc(value);
  const abs = Math.abs(n);
  const digits = abs < 1e15 ? String(abs) : abs.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 });
  const words = Number.isSafeInteger(n) ? intWords(digits) : digitByDigit(digits);
  return n < 0 ? `eksi ${words}` : words;
}

/* ------------------------------------------------------------------ ek uyumu */

const VOWELS = 'aeıioöuüâîû';
const FORTIS = 'çfhkpsşt';
const A_OF: Record<string, string> = { a: 'a', ı: 'a', o: 'a', u: 'a', e: 'e', i: 'e', ö: 'e', ü: 'e' };
const I_OF: Record<string, string> = { a: 'ı', ı: 'ı', o: 'u', u: 'u', e: 'i', i: 'i', ö: 'ü', ü: 'ü' };

function lower(s: string): string {
  return s.toLocaleLowerCase('tr');
}

function foldCircumflex(s: string): string {
  return s.replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');
}

function lastVowelOf(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.charAt(i);
    if (VOWELS.includes(c)) return c;
  }
  // Ünlüsüz okunuşta (olmamalı) ön ünlü varsayılır; en az zarar veren seçim.
  return 'e';
}

/** Eki ünlü/ünsüz uyumundan bağımsız soyut kalıba indirir: a/e → A, ı/i/u/ü → I, d/t → D. */
function abstractOf(suffix: string): string {
  let out = '';
  for (const ch of suffix) {
    if (ch === 'a' || ch === 'e') out += 'A';
    else if (ch === 'ı' || ch === 'i' || ch === 'u' || ch === 'ü') out += 'I';
    else if (ch === 'd' || ch === 't') out += 'D';
    else out += ch;
  }
  return out;
}

/** Tanınan ek ailesi için doğru eki üretir; tanımadığında `null` (çağıran ya olduğu gibi yapıştırır ya da dokunmaz). */
function attachKnown(spoken: string, rawSuffix: string): string | null {
  let base = spoken.replace(/\s+$/, '');
  const sfx = lower(rawSuffix.replace(/^['’]+/, ''));
  if (sfx === '') return base;
  const norm = foldCircumflex(lower(base));
  const last = norm.charAt(norm.length - 1);
  const vowelEnd = VOWELS.includes(last);
  const lv = lastVowelOf(norm);
  const a = A_OF[lv] ?? 'e';
  const i = I_OF[lv] ?? 'i';
  const d = FORTIS.includes(last) ? 't' : 'd';
  const y = vowelEnd ? 'y' : '';
  const s = vowelEnd ? 's' : '';
  const key = abstractOf(sfx);

  // Çoğul + devamı ("doksanları", "kırklarda"): çoğulu uydur, kalanı yeni gövdeye yinele.
  if (key.length > 3 && key.startsWith('lAr')) return attachKnown(`${base}l${a}r`, sfx.slice(3));

  let tail: string | null;
  switch (key) {
    case 'DA':
      tail = d + a;
      break;
    case 'DAn':
      tail = `${d}${a}n`;
      break;
    case 'DAkI':
      tail = `${d}${a}ki`;
      break;
    case 'A':
    case 'yA':
      tail = y + a;
      break;
    case 'yI':
      tail = y + i;
      break;
    // Çıplak "-i" sayıya yazıldığında iyelik kastedilir ("payın %50'si"); belirtme "-yi" açıkça yazılır.
    case 'I':
    case 'sI':
      tail = vowelEnd ? `s${i}` : i;
      break;
    case 'In':
    case 'nIn':
      tail = vowelEnd ? `n${i}n` : `${i}n`;
      break;
    case 'lA':
    case 'ylA':
      tail = `${y}l${a}`;
      break;
    case 'DIr':
      tail = `${d}${i}r`;
      break;
    case 'lIk':
      tail = `l${i}k`;
      break;
    case 'lI':
      tail = `l${i}`;
      break;
    case 'sIz':
      tail = `s${i}z`;
      break;
    case 'lAr':
      tail = `l${a}r`;
      break;
    case 'IncI':
    case 'ncI':
    case 'nIncI':
      tail = vowelEnd ? `nc${i}` : `${i}nc${i}`;
      break;
    // İyelik + durum ("sekizinde", "ikisinden"): iyelik ünlüsü ve "n" tamlayıcı kaynaştırması.
    case 'InDA':
    case 'sInDA':
      tail = `${s}${i}nd${a}`;
      break;
    case 'InDAn':
    case 'sInDAn':
      tail = `${s}${i}nd${a}n`;
      break;
    case 'InA':
    case 'sInA':
      tail = `${s}${i}n${a}`;
      break;
    case 'InI':
    case 'sInI':
      tail = `${s}${i}n${i}`;
      break;
    case 'InIn':
    case 'sInIn':
      tail = `${s}${i}n${i}n`;
      break;
    default:
      tail = null;
  }
  if (tail === null) return null;
  // "dört" ünlüyle başlayan ekte yumuşar: dördü, dörde, dördün; ünsüzle başlayanda sert kalır: dörtte, dörtten.
  if (/^[aeıioöuü]/.test(tail) && /dört$/.test(norm)) base = `${base.slice(0, -1)}d`;
  return base + tail;
}

/** Ek, sayının OKUNUŞUNA göre ünlü/ünsüz uyumuna sokulur ("dört" + "de" → "dörtte"). Tanımadığı eki olduğu gibi ekler. */
export function harmonizeSuffix(spoken: string, suffix: string): string {
  try {
    const raw = String(suffix).replace(/^['’]+/, '');
    const text = String(spoken);
    if (raw === '') return text;
    if (text.trim() === '') return raw;
    return attachKnown(text, raw) ?? text + raw;
  } catch {
    return String(spoken);
  }
}

function withSuffix(spoken: string, suffix: string | undefined): string {
  return suffix ? harmonizeSuffix(spoken, suffix) : spoken;
}

/* ------------------------------------------------------------------ sayı ayrıştırma */

interface ParsedNumber {
  int: string;
  frac: string | null;
  /** Ondalık ayırıcının okunuşu: virgülle yazılan "virgül", noktayla yazılan "nokta" (Türkçede ondalık ayırıcı virgüldür). */
  sep: 'virgül' | 'nokta';
}

const THOUSANDS = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const THOUSANDS_COMMA = /^[1-9]\d{0,2}(?:,\d{3})+$/;

/**
 * Binlik/ondalık ayırıcı kararı: iki ayırıcı birden varsa SONUNCUSU ondalıktır (TR "1.250,50", EN "1,000,000.5");
 * yalnız virgül: üçlü gruplar İngilizce binlik, değilse ondalık; yalnız nokta: üçlü gruplar Türkçe binlik, değilse
 * noktalı sayı ("Python 3.12" → "üç nokta on iki"). Baştaki sıfır ("0.250") binliğe girmez. Çözülemezse `null`.
 */
function parseNumber(token: string): ParsedNumber | null {
  const hasDot = token.includes('.');
  const hasComma = token.includes(',');
  if (hasDot && hasComma) {
    const k = Math.max(token.lastIndexOf('.'), token.lastIndexOf(','));
    const group = token.charAt(k) === '.' ? ',' : '.';
    const int = token.slice(0, k);
    const frac = token.slice(k + 1);
    const groupRe = group === ',' ? /^\d{1,3}(?:,\d{3})*$/ : /^\d{1,3}(?:\.\d{3})*$/;
    if (!groupRe.test(int) || !/^\d+$/.test(frac)) return null;
    return { int: int.split(group).join(''), frac, sep: 'virgül' };
  }
  if (hasComma) {
    if (THOUSANDS_COMMA.test(token)) return { int: token.replace(/,/g, ''), frac: null, sep: 'virgül' };
    const p = token.split(',');
    return p.length === 2 && /^\d+$/.test(p[0] ?? '') && /^\d+$/.test(p[1] ?? '')
      ? { int: p[0] ?? '', frac: p[1] ?? '', sep: 'virgül' }
      : null;
  }
  if (hasDot) {
    if (THOUSANDS.test(token)) return { int: token.replace(/\./g, ''), frac: null, sep: 'nokta' };
    const p = token.split('.');
    return p.length === 2 && /^\d+$/.test(p[0] ?? '') && /^\d+$/.test(p[1] ?? '')
      ? { int: p[0] ?? '', frac: p[1] ?? '', sep: 'nokta' }
      : null;
  }
  return /^\d+$/.test(token) ? { int: token, frac: null, sep: 'virgül' } : null;
}

function fracWords(frac: string): string {
  if (frac.length > 2) return digitByDigit(frac);
  const rest = frac.replace(/^0+/, '');
  const zeros = frac.length - rest.length;
  const parts: string[] = Array.from({ length: zeros }, () => 'sıfır');
  if (rest !== '') parts.push(cardinalFromDigits(rest));
  return parts.join(' ');
}

/** `money`: tutarda nokta da ondalıktır ve "virgül" okunur ("$1,000,000.5" → "bir milyon virgül beş dolar"). */
function spokenNumber(token: string, money = false): string {
  const p = parseNumber(token);
  // Çözülemeyen belirteç (1.2.3.4 gibi): her rakam öbeği ayrı okunur; ayırıcılar boşluk olur.
  if (!p) return token.replace(/\d+/g, (d) => ` ${intWords(d)} `).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const int = intWords(p.int);
  return p.frac ? `${int} ${money ? 'virgül' : p.sep} ${fracWords(p.frac)}` : int;
}

/* ------------------------------------------------------------------ kalıplar */

/** Ek: kesme işaretinden sonraki harfler (tek yakalama grubu). */
const SUF = String.raw`(?:['’](\p{L}+))?`;
/** Sayı belirteci: rakamla başlar ve rakamla BİTER, bu yüzden cümle sonu nokta/virgül sayıya yapışmaz; yakalama grubu YOK. */
const NUM = String.raw`\d(?:[\d.,]*\d)?`;
/** Sayı başlangıcı: ayırıcıdan sonra başlamaz; her sayı bir kez ve doğrusal sürede taranır. */
const NUM_START = String.raw`(?<![\p{N}.,])`;
const MAGNITUDE = 'bin|milyon|milyar|trilyon';

function rx(source: string, flags = 'gu'): RegExp {
  return new RegExp(source, flags);
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const RE = {
  tagSplit: /(\[\p{L}[\p{L} '’-]{0,38}\])/u,
  ellipsis: /(?:\.{3,}|…)/gu,
  quotes: /["“”„«»]/gu,
  email: /(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}][\p{L}\p{N}._%+-]*)@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/gu,
  domain: rx(
    String.raw`(?<![\p{L}\p{N}@._/-])(?:https?:\/\/)?(?:[\p{L}\p{N}][\p{L}\p{N}-]*\.)+(?:com|net|org|io|ai|co|app|dev|ltd|tr|edu|gov|info|me|tv|xyz|online|site|tech|store|biz|eu|de|uk|us)(?![\p{L}\p{N}])`,
    'giu',
  ),
  phoneIntl: rx(
    String.raw`(?<![\p{N}.,+-])\+(\d{1,3})[\s-]?\(?(\d{3})\)?[\s-]?(\d{3})[\s-]?(\d{2})[\s-]?(\d{2})(?![\p{N}])${SUF}`,
  ),
  phoneTr: rx(
    String.raw`(?<![\p{N}.,+-])\(?(0\d{3})\)?[\s-]?(\d{3})[\s-]?(\d{2})[\s-]?(\d{2})(?![\p{N}])${SUF}`,
  ),
  // Onaltılık: 0x önekli dizi ya da içinde harf olan #RRGGBB(AA) renk kodu. Rakam kurallarından ÖNCE alınır:
  // "0x1F4A" içindeki x çarpı, "E5" harf-rakam ayrımı sanılmasın.
  hex: rx(String.raw`(?<![\p{L}\p{N}])(?:0[xX]([0-9A-Fa-f]+)|#((?=[0-9A-Fa-f]*[A-Fa-f])(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})))(?![\p{L}\p{N}])${SUF}`),
  // Model/ürün adındaki tire aralık değildir: "Qwen3.5-4B" (sayı harfe bitişik başlar) ve "Llama 3.1-8B" (noktalı sürümden
  // sonra parametre sayısı). "10-15" ve "1.25-1.50" bunlara uymaz.
  modelHyphen: /(?<=\p{L}\d+(?:\.\d+)*)-(?=\d)|(?<=(?<![\d.,])\d+\.\d+)-(?=\d+[BMK](?![\p{L}\p{N}]))/gu,
  dateDmy: rx(String.raw`(?<![\p{N}.,/-])(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?![\p{N}])${SUF}`),
  dateIso: rx(String.raw`(?<![\p{N}.,/-])(\d{4})-(\d{2})-(\d{2})(?![\p{N}])${SUF}`),
  dateRange: /(\d{1,2}[./]\d{1,2}[./]\d{4})\s*[-–]\s*(?=\d{1,2}[./]\d{1,2}[./]\d{4})/g,
  timeRange:
    /(?<![\d.,:])([01]?\d|2[0-3])([.:])([0-5]\d)\s*(-|–|—|ile|ve)\s*([01]?\d|2[0-3])([.:])([0-5]\d)(?!\d)(?![.,:]\d)(?:['’](\p{Ll}+))?/gu,
  decimalPair: /(\d+\.\d+)-(?=\d+\.\d)/g,
  timeGibi: /(?<![\d.,])([01]?\d|2[0-3])\.([0-5]\d)(?=\s+(?:gibi|civarı|civarında|sularında)(?!\p{L}))/gu,
  dayMonth: /(?<![\d.,])(\d{1,2})\.(\d{1,2})(?=\s+(?:tarihinde|tarihli|tarihine|tarihi|günü)(?!\p{L}))/gu,
  dotHint: /(?<![\d.,])(\d{1,2})\.(\d{2})['’](\p{Ll}+)/gu,
  wholeHour: /(?<![\d.,:])([01]?\d|2[0-3])\.00(?!\d)(?![.,]\d)(?!['’]\p{Ll})/gu,
  range: /(?<=\d)\s*–\s*(?=\d)|(?<=\d)-(?=\d)/g,
  negative: /(^|[\s(])[-−](?=\d)/g,
  timeColon: rx(String.raw`(?<![\p{N}.:,])([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?![\p{N}])${SUF}`),
  timeSaat: rx(String.raw`(?<!\p{L})(saat\s+)(\d{1,2})\.(\d{2})(?![\p{N}])${SUF}`, 'giu'),
  strayColon: /(?<=\d):(?=\d)/g,
  moneyAfter: rx(
    String.raw`${NUM_START}(${NUM})(?:\s+(${MAGNITUDE}))?\s?([₺$€£]|(?:TL|tl|TRY|USD|EUR|GBP)(?![\p{L}\p{N}]))${SUF}`,
  ),
  moneyBefore: rx(
    String.raw`(?<![\p{L}\p{N}])([₺$€£]|(?:TL|tl|TRY|USD|EUR|GBP))\s?(${NUM})(?:\s+(${MAGNITUDE})(?!\p{L}))?${SUF}`,
  ),
  percentBefore: rx(String.raw`%\s?(${NUM})${SUF}`),
  percentAfter: rx(String.raw`${NUM_START}(${NUM})\s?%${SUF}`),
  version: rx(
    String.raw`(?<![\p{L}\p{N}.])(?:([vV])(\d+(?:\.\d+)+)|(\d+(?:\.\d+){2,}))((?:-\p{L}[\p{L}\p{N}]*(?:\.\d+)*)?)(?![\p{N}])`,
  ),
  plus: /(?<=\d)\s*\+\s*(?=\d)/g,
  signPlus: /(?<![\p{L}\p{N}+])\+(?=\d)/gu,
  equals: /(?<=\d)\s*=\s*(?=\d)/g,
  times: /(?<=\d)\s*[x×]\s*(?=\d)/g,
  slash: /(?<=\d)\s*\/\s*(?=\d)/g,
  letterHyphenDigit: /(?<=\p{L})-(?=\d)/gu,
  digitHyphenLetter: /(?<=\d)-(?=\p{L})/gu,
  letterDigit: /(\p{L})(\d)/gu,
  digitCapital: /(\d)([A-ZÇĞİÖŞÜ])(?![\p{L}\p{N}])/gu,
  digitLetter: /(\d)(\p{L})/gu,
  ordinal: /(?<![\p{N}.,])(\d{1,9})\.(?=\s+\p{Ll})/gu,
  plain: rx(String.raw`${NUM_START}(${NUM})${SUF}`),
  leftoverDigits: /\d+/g,
  hashNumber: /#(?=\d)/g,
  singleLetter: /(?<![\p{L}\p{N}'’.@/-])([A-ZÇĞİÖŞÜ])(?:['’](\p{L}+))?(?![\p{L}\p{N}]|-\p{L}|\.\p{L})/gu,
};

/* ------------------------------------------------------------------ sözlükler */

const CURRENCY: Record<string, { major: string; minor: string }> = {
  '₺': { major: 'lira', minor: 'kuruş' },
  TL: { major: 'lira', minor: 'kuruş' },
  tl: { major: 'lira', minor: 'kuruş' },
  TRY: { major: 'lira', minor: 'kuruş' },
  $: { major: 'dolar', minor: 'sent' },
  USD: { major: 'dolar', minor: 'sent' },
  '€': { major: 'avro', minor: 'sent' },
  EUR: { major: 'avro', minor: 'sent' },
  '£': { major: 'sterlin', minor: 'peni' },
  GBP: { major: 'sterlin', minor: 'peni' },
};

/** Birimler YALNIZ sayıdan sonra çevrilir: sayısız "m", "g", "sa", "V", "W", "L" sıradan sözcük/harf olabilir. */
const UNITS: Record<string, string> = {
  GB: 'gigabayt',
  gb: 'gigabayt',
  MB: 'megabayt',
  mb: 'megabayt',
  KB: 'kilobayt',
  kb: 'kilobayt',
  TB: 'terabayt',
  tb: 'terabayt',
  // İkili önekler (nvidia-smi, görev yöneticisi çıktıları): okunmazsa ses motoru harf harf ya da İngilizce okur.
  KiB: 'kibibayt',
  MiB: 'mebibayt',
  GiB: 'gibibayt',
  TiB: 'tebibayt',
  km: 'kilometre',
  m: 'metre',
  cm: 'santimetre',
  mm: 'milimetre',
  kg: 'kilogram',
  g: 'gram',
  gr: 'gram',
  mg: 'miligram',
  sn: 'saniye',
  dk: 'dakika',
  sa: 'saat',
  ms: 'milisaniye',
  '°C': 'derece',
  '°F': 'derece fahrenhayt',
  '°': 'derece',
  L: 'litre',
  lt: 'litre',
  ml: 'mililitre',
  mL: 'mililitre',
  'm²': 'metrekare',
  m2: 'metrekare',
  'km²': 'kilometrekare',
  'cm²': 'santimetrekare',
  'm³': 'metreküp',
  'km/s': 'kilometre bölü saat',
  'km/sa': 'kilometre bölü saat',
  'km/h': 'kilometre bölü saat',
  'km/saat': 'kilometre bölü saat',
  'm/s': 'metre bölü saniye',
  Hz: 'hertz',
  kHz: 'kilohertz',
  MHz: 'megahertz',
  GHz: 'gigahertz',
  W: 'vat',
  kW: 'kilovat',
  MW: 'megavat',
  V: 'volt',
  px: 'piksel',
  // "fps" Daniel'de "f p s" okunur; Türkçe söyleyişe yakın "kare bölü saniye".
  fps: 'kare bölü saniye',
  dB: 'desibel',
  mAh: 'miliamper saat',
};

const UNIT_RE = rx(
  String.raw`${NUM_START}(${NUM})\s?(${Object.keys(UNITS)
    .sort((x, y) => y.length - x.length)
    .map(escapeRx)
    .join('|')})(?![\p{L}\p{N}²³])${SUF}`,
);

/** Tek başına büyük harfin Türkçe okunuşu. "O" zamirdir ve burada yoktur. */
const LETTER_NAMES: Record<string, string> = {
  A: 'a',
  B: 'be',
  C: 'ce',
  Ç: 'çe',
  D: 'de',
  E: 'e',
  F: 'fe',
  G: 'ge',
  H: 'he',
  I: 'ı',
  İ: 'i',
  J: 'je',
  K: 'ke',
  L: 'le',
  M: 'me',
  N: 'ne',
  Ö: 'ö',
  P: 'pe',
  R: 're',
  S: 'se',
  Ş: 'şe',
  T: 'te',
  U: 'u',
  Ü: 'ü',
  V: 've',
  Y: 'ye',
  Z: 'ze',
  Q: 'kü',
  W: 'çift ve',
  X: 'iks',
};

/** Kısaltma içinde ve rakama bitişik harflerde (4K, 5G) "K" Türkçe heceleme geleneğiyle "ka" okunur. */
const SPELLING_NAMES: Record<string, string> = { ...LETTER_NAMES, K: 'ka' };

const ACRONYMS: Record<string, string> = {
  KDV: 'ka de ve',
  ÖTV: 'ö te ve',
  SGK: 'se ge ka',
  TC: 'te ce',
  ABD: 'a be de',
  TL: 'te le',
  MTV: 'me te ve',
  KKTC: 'ka ka te ce',
  TBMM: 'te be me me',
  TCKN: 'te ce ka ne',
  SMS: 'se me se',
  PTT: 'pe te te',
  GSM: 'ge se me',
};

const ACRONYM_RE = rx(
  String.raw`(?<![\p{L}\p{N}])(${Object.keys(ACRONYMS)
    .sort((x, y) => y.length - x.length)
    .join('|')})(?![\p{L}\p{N}])${SUF}`,
);

/** Noktalı kısaltmalar: [kalıp, okunuş]. Büyük harfli olanlar harfe duyarlı ("av." avlanma olabilir). */
type AbbrevReplacer = string | ((m: string, offset: number, whole: string) => string);
/** Cümle sonundaki "vb." noktası cümleyi de bitirir: kısaltmanın noktası okunuşa girmese de cümle noktası korunur. */
const sentenceEnd =
  (spoken: string): AbbrevReplacer =>
  (m, offset, whole) =>
    /\S/.test(whole.slice(offset + m.length)) ? spoken : `${spoken}.`;
const ABBREVIATIONS: Array<[RegExp, AbbrevReplacer]> = [
  [rx(String.raw`(?<![\p{L}\p{N}.])A\.Ş\.?`), 'anonim şirketi'],
  [rx(String.raw`(?<![\p{L}\p{N}.])T\.C\.?`), 'te ce'],
  [rx(String.raw`(?<![\p{L}\p{N}.])No[:.]\s*(?=\d)`), 'numara '],
  [rx(String.raw`(?<![\p{L}\p{N}\.])vb\.`, 'giu'), sentenceEnd('ve benzeri')],
  [rx(String.raw`(?<![\p{L}\p{N}\.])vs\.`, 'giu'), sentenceEnd('vesaire')],
  [rx(String.raw`(?<![\p{L}\p{N}.])örn\.`, 'giu'), 'örneğin'],
  [rx(String.raw`(?<![\p{L}\p{N}.])bkz\.`, 'giu'), 'bakınız'],
  [rx(String.raw`(?<![\p{L}\p{N}.])Dr\.`), 'doktor'],
  [rx(String.raw`(?<![\p{L}\p{N}.])Prof\.`), 'profesör'],
  [rx(String.raw`(?<![\p{L}\p{N}.])Doç\.`), 'doçent'],
  [rx(String.raw`(?<![\p{L}\p{N}.])Av\.`), 'avukat'],
  [rx(String.raw`(?<![\p{L}\p{N}.])Ltd\.`), 'limited'],
  [rx(String.raw`(?<![\p{L}\p{N}.])Şti\.`), 'şirketi'],
  // "Sn." yalnız bir addan önce "sayın"dır; sayıdan sonra (saniye) ya da cümle sonunda dokunulmaz.
  [rx(String.raw`(?<![\p{L}\p{N}.])Sn\.(?=\s+\p{Lu})`), 'sayın'],
];

/**
 * "Plan B", "Type C" gibi İngilizce bağlamda tek harf okunmaz. Cümle ortasındaki büyük harfli ASCII sözcük (ürün adı)
 * ya da bilinen İngilizce baş sözcük ("Plan", "Type"…) öncedeyse; ya da hemen ardından büyük harfli ASCII sözcük
 * geliyorsa ("B Plan", "C Sharp") şüphe vardır ve dokunulmaz. Cümle başındaki sıradan Türkçe sözcük ("Sonra B planı")
 * bağlamı bozmaz.
 */
const ENGLISH_HEADS = new Set([
  'plan',
  'type',
  'class',
  'option',
  'model',
  'level',
  'tier',
  'grade',
  'series',
  'version',
  'phase',
  'step',
  'group',
  'team',
  'part',
  'chapter',
  'section',
  'vitamin',
  'category',
]);

function englishContext(whole: string, offset: number, length: number): boolean {
  const windowStart = Math.max(0, offset - 64);
  const before = whole.slice(windowStart, offset);
  const prev = /([A-Za-z][A-Za-z0-9]*)\s+$/.exec(before);
  if (prev && /^[A-Z]/.test(prev[1] ?? '')) {
    const word = prev[1] ?? '';
    const head = before.slice(0, prev.index);
    const charBefore = head.charAt(head.length - 1);
    if (!/[\p{L}\p{N}'’]/u.test(charBefore)) {
      const sentenceStart = (windowStart === 0 && head.trim() === '') || /[.!?:]\s*$/.test(head);
      if (!sentenceStart || ENGLISH_HEADS.has(word.toLowerCase())) return true;
    }
  }
  const after = whole.slice(offset + length, offset + length + 48);
  return /^\s+[A-Z][A-Za-z0-9]*(?![\p{L}])/u.test(after);
}

/* ------------------------------------------------------------------ noktalı H.MM: saat mi ondalık mı (v1) */

// Türkçede ondalık ayırıcı virgüldür; noktalı H.MM (H ≤ 23, MM ≤ 59) varsayılan olarak SAATTİR. Ondalık sayılır yalnız:
// yakın önde oran/ortalama/sürüm/versiyon/yüzde/endeks/katsayı; hemen önde v, x ya da %; hemen arkada birim varsa.
// "Değerli", "Kur toplantısı" gibi sözcükler listeye benzese de saati bozmaz (sözcük sınırı kapısı).
const DECIMAL_BEFORE =
  /(?<!\p{L})(?:oran\p{L}*|ortalama\p{L}*|sürüm\p{L}*|versiyon\p{L}*|yüzde(?:si|sı|lik\p{L}*)?|endeks\p{L}*|katsayı\p{L}*)(?!\p{L})[^]{0,12}$/iu;
const DECIMAL_SIGN_BEFORE = /(?:^|[^\p{L}\d])[vx]$|%$/iu;
const DECIMAL_UNIT_AFTER = /^\s?(?:TL|₺|\$|€|kg|km|m|cm|mm|puan\p{L}*|kat(?:ı|lık)?|x|%)(?!\p{L})/iu;

/**
 * "3.50'ye çıktı", "3.50'den 4.20'ye geriledi": yönelme/ayrılma ekli noktalı sayıdan sonra değişim fiili geliyorsa bu bir
 * değerdir (kur, fiyat, oran), saat değil. "9.30'a alındı", "15.30'da" saat kalır; "indi" bilerek yok ("uçak 3.50'ye indi").
 */
const CHANGE_VERB_AFTER =
  /^\s+(?:\d{1,3}[.,]\d{1,2}['’]\p{Ll}+\s+)?(?:çık(?:tı|ıyor|acak|mış|ar)|düş(?:tü|üyor|ecek|müş|er)|yüksel|geril|ulaş|art(?:tı|ıyor|acak|mış)|azal|tırman|fırla|sark)/iu;
const MOTION_SUFFIX = /^(?:y?[ae]|[dt][ae]n)$/u;

function looksDecimal(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 40), start);
  return DECIMAL_BEFORE.test(before) || DECIMAL_SIGN_BEFORE.test(before) || DECIMAL_UNIT_AFTER.test(text.slice(end, end + 8));
}

/** Sözcüğün son ünlüsü kalın mı (a ı o u)? */
function isBack(s: string): boolean {
  const v = [...lower(s)].reverse().find((c) => 'aıoueiöü'.includes(c));
  return v ? 'aıou'.includes(v) : false;
}

/* ------------------------------------------------------------------ dönüştürücüler */

function timeWords(h: number, m: number, s: number | null): string {
  const parts = [numberToTurkish(h)];
  const sec = s ?? 0;
  if (m > 0 || sec > 0) parts.push((m < 10 ? 'sıfır ' : '') + numberToTurkish(m));
  if (sec > 0) parts.push((sec < 10 ? 'sıfır ' : '') + numberToTurkish(sec));
  return parts.join(' ');
}

function groupWords(group: string): string {
  const rest = group.replace(/^0+/, '');
  const zeros = group.length - rest.length;
  const parts: string[] = Array.from({ length: zeros }, () => 'sıfır');
  if (rest !== '') parts.push(cardinalFromDigits(rest));
  return parts.join(' ');
}

function dateWords(day: number, month: number, year: string, suffix: string | undefined): string | null {
  const monthName = MONTHS[month - 1];
  if (!monthName || day < 1 || day > 31) return null;
  return withSuffix(`${numberToTurkish(day)} ${monthName} ${intWords(year)}`, suffix);
}

function moneyWords(num: string, magnitude: string | undefined, cur: string, suffix: string | undefined): string {
  const c = CURRENCY[cur];
  if (!c) return num;
  const p = parseNumber(num);
  let words: string;
  // Alt birim yalnız tam iki haneli kesirde ("9,99 $"); tek hane ya da daha uzun kesir "virgül" okunur.
  if (p && p.frac !== null && p.frac.length === 2 && !magnitude) {
    const minor = Number(p.frac);
    words = `${intWords(p.int || '0')} ${c.major}`;
    if (minor > 0) words += ` ${numberToTurkish(minor)} ${c.minor}`;
  } else {
    words = `${spokenNumber(num, true)}${magnitude ? ` ${magnitude}` : ''} ${c.major}`;
  }
  return withSuffix(words, suffix);
}

function spellDotted(s: string): string {
  return s.replace(/\./g, ' nokta ').replace(/_/g, ' alt çizgi ').replace(/-/g, ' tire ').replace(/\+/g, ' artı ');
}

function spellHex(digits: string): string {
  return [...digits.toUpperCase()].map((ch) => (ch >= '0' && ch <= '9' ? (DIGIT_WORDS[Number(ch)] ?? ch) : (SPELLING_NAMES[ch] ?? ch))).join(' ');
}

function convertSegment(input: string): string {
  let s = input.replace(/\s+/g, ' ');

  // 1. üç nokta cümle sonundaysa nokta, ortadaysa virgül (ses motoru "…" simgesini yutar ya da takılır).
  s = s.replace(RE.ellipsis, (m: string, offset: number, whole: string) =>
    /\S/.test(whole.slice(offset + m.length)) ? ', ' : '.',
  );
  s = s.replace(RE.quotes, ' ');

  // 2. e-posta, alan adı
  s = s.replace(RE.email, (_m: string, local: string, domain: string) => `${spellDotted(local)} et ${spellDotted(domain)}`);
  s = s.replace(RE.domain, (m: string) => spellDotted(m.replace(/^https?:\/\//i, '')));

  // 3. noktalı kısaltmalar
  for (const [re, spoken] of ABBREVIATIONS) {
    s = typeof spoken === 'string' ? s.replace(re, spoken) : s.replace(re, spoken);
  }

  // Onaltılık dizi basamak basamak okunur (harfler heceleme adıyla); çıktıda rakam kalmadığı için sonraki kurallar dokunmaz.
  s = s.replace(RE.hex, (_m: string, prefixed: string | undefined, color: string | undefined, suf: string | undefined) =>
    withSuffix(`onaltılık ${spellHex(prefixed ?? color ?? '')}`, suf),
  );

  // 4. telefon
  s = s.replace(
    RE.phoneIntl,
    (_m: string, cc: string, g1: string, g2: string, g3: string, g4: string, suf: string | undefined) =>
      withSuffix(`artı ${intWords(cc)}, ${[g1, g2, g3, g4].map(groupWords).join(', ')}`, suf),
  );
  s = s.replace(
    RE.phoneTr,
    (_m: string, g1: string, g2: string, g3: string, g4: string, suf: string | undefined) =>
      withSuffix([g1, g2, g3, g4].map(groupWords).join(', '), suf),
  );

  // 5. sayısal tarih
  // Tarih aralığı, tek tek tarihe çevrilmeden önce bağlanır: sonra tire iki sözcük arasında kalır.
  s = s.replace(RE.dateRange, '$1 ile ');
  s = s.replace(RE.dateDmy, (m: string, d: string, _sep: string, mo: string, y: string, suf: string | undefined) =>
    dateWords(Number(d), Number(mo), y, suf) ?? m,
  );
  s = s.replace(RE.dateIso, (m: string, y: string, mo: string, d: string, suf: string | undefined) =>
    dateWords(Number(d), Number(mo), y, suf) ?? m,
  );

  // 6. aralık, 7. eksi ve saat
  // Saat aralığı kararı aralık başına bir kez verilir; ondalık çiftin ("1.25-1.50") tiresi korunur (v1 davranışı).
  s = s.replace(
    RE.timeRange,
    (t: string, h1: string, c1: string, m1: string, sep: string, h2: string, c2: string, m2: string, suf: string | undefined, ...rest: unknown[]) => {
      const whole = String(rest[1]);
      const offset = Number(rest[0]);
      const before = whole.slice(Math.max(0, offset - 12), offset);
      const hourWord = /(?:^|[^\p{L}])saat\s+$/iu.test(before);
      if (!(hourWord || c1 === ':' || c2 === ':' || !looksDecimal(whole, offset, offset + t.length))) return t;
      const joiner = /^[-–—]$/.test(sep) ? 'ile' : sep;
      return `${timeWords(Number(h1), Number(m1), null)} ${joiner} ${withSuffix(timeWords(Number(h2), Number(m2), null), suf)}`;
    },
  );
  s = s.replace(RE.modelHyphen, ' ');
  s = s.replace(RE.decimalPair, (m: string, left: string) => (THOUSANDS.test(left) ? m : `${left}\uE000`));
  s = s.replace(RE.range, ' ile ');
  s = s.replace(RE.negative, '$1eksi ');
  s = s.replace(RE.timeColon, (m: string, h: string, mi: string, se: string | undefined, suf: string | undefined) =>
    withSuffix(timeWords(Number(h), Number(mi), se === undefined ? null : Number(se)), suf),
  );
  s = s.replace(RE.timeSaat, (m: string, pre: string, h: string, mi: string, suf: string | undefined) =>
    Number(h) <= 23 && Number(mi) <= 59 ? pre + withSuffix(timeWords(Number(h), Number(mi), null), suf) : m,
  );
  s = s.replace(RE.strayColon, ' ');

  // 8. para, yüzde, birim
  s = s.replace(RE.moneyAfter, (_m: string, num: string, mag: string | undefined, cur: string, suf: string | undefined) =>
    moneyWords(num, mag, cur, suf),
  );
  s = s.replace(RE.moneyBefore, (_m: string, cur: string, num: string, mag: string | undefined, suf: string | undefined) =>
    moneyWords(num, mag, cur, suf),
  );
  s = s.replace(RE.percentBefore, (_m: string, num: string, suf: string | undefined) =>
    withSuffix(`yüzde ${spokenNumber(num)}`, suf),
  );
  s = s.replace(RE.percentAfter, (_m: string, num: string, suf: string | undefined) =>
    withSuffix(`yüzde ${spokenNumber(num)}`, suf),
  );
  s = s.replace(UNIT_RE, (_m: string, num: string, unit: string, suf: string | undefined) =>
    withSuffix(`${spokenNumber(num)} ${UNITS[unit] ?? unit}`, suf),
  );

  // Noktalı H.MM yalnız bağlam söylerse saattir (gibi/civarı, kesme+ek ipucu, tam saat); aksi hâlde sayı olarak kalır.
  s = s.replace(RE.timeGibi, (_m: string, h: string, mi: string) => timeWords(Number(h), Number(mi), null));
  s = s.replace(RE.dayMonth, (m: string, g: string, a: string) => {
    const day = Number(g);
    const month = Number(a);
    return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? `${numberToTurkish(day)} ${MONTHS[month - 1] ?? ''}` : m;
  });
  // "12.10'da" (on iki ON-da: saat) ile "12.10'de" (on iki EKİM-de: tarih): ekin ünlü uyumu hangi okunuşun kastedildiğini
  // söyler, bu yüzden ek burada yeniden uyuma sokulmaz, olduğu gibi kalır.
  s = s.replace(RE.dotHint, (m: string, a: string, b: string, suf: string, offset: number, whole: string) => {
    const x = Number(a);
    const y = Number(b);
    // Ek ipucu yalnız saat/tarih arasında seçer; bağlam ondalık diyorsa (oran, yüzde, birim, değişim fiili) sayı okunur.
    const numberEnd = offset + a.length + 1 + b.length;
    const valueChange = MOTION_SUFFIX.test(suf) && CHANGE_VERB_AFTER.test(whole.slice(offset + m.length, offset + m.length + 40));
    if (looksDecimal(whole, offset, numberEnd) || valueChange) return withSuffix(spokenNumber(`${a}.${b}`), suf);
    const hour = x <= 23 && y <= 59 ? timeWords(x, y, null) : null;
    const date = x >= 1 && x <= 31 && y >= 1 && y <= 12 ? `${numberToTurkish(x)} ${MONTHS[y - 1] ?? ''}` : null;
    const sufBack = isBack(/[aıoueiöü]/.exec(suf)?.[0] ?? 'a');
    if (date && (!hour || (isBack(date) === sufBack && isBack(hour) !== sufBack))) return `${date}${suf}`;
    return hour ? `${hour}${suf}` : m;
  });
  s = s.replace(RE.wholeHour, (m: string, h: string, offset: number, whole: string) =>
    looksDecimal(whole, offset, offset + m.length) ? m : numberToTurkish(Number(h)),
  );

  // 9. sürüm / IP
  s = s.replace(
    RE.version,
    (m: string, v: string | undefined, verV: string | undefined, verPlain: string | undefined, tail: string) => {
      const ver = verV ?? verPlain ?? '';
      if (!v && THOUSANDS.test(ver)) return m;
      const spoken = ver.split('.').map(intWords).join(' nokta ');
      const rest = tail ? ` ${tail.slice(1).replace(/\./g, ' ')}` : '';
      return `${spoken}${rest}`;
    },
  );

  // 10. rakam arası simgeler
  s = s.replace(RE.plus, ' artı ');
  s = s.replace(RE.signPlus, 'artı ');
  s = s.replace(RE.equals, ' eşittir ');
  s = s.replace(RE.times, ' çarpı ');
  s = s.replace(RE.slash, ' bölü ');
  s = s.replace(RE.hashNumber, 'numara ');

  // 11. harf-rakam ayrımı, sıra sayısı, düz sayı
  s = s.replace(RE.letterHyphenDigit, ' ');
  s = s.replace(RE.digitHyphenLetter, ' ');
  s = s.replace(RE.letterDigit, '$1 $2');
  s = s.replace(RE.digitCapital, (_m: string, d: string, l: string) => `${d} ${SPELLING_NAMES[l] ?? l}`);
  s = s.replace(RE.digitLetter, '$1 $2');
  s = s.replace(RE.ordinal, (m: string, d: string) =>
    d.length > 1 && d.startsWith('0') ? m : harmonizeSuffix(intWords(d), 'inci'),
  );
  s = s.replace(RE.plain, (_m: string, num: string, suf: string | undefined) => withSuffix(spokenNumber(num), suf));
  s = s.replace(RE.leftoverDigits, (m: string) => digitByDigit(m));

  // 12. harf harf kısaltmalar, tek büyük harf, simgeler
  s = s.replace(ACRONYM_RE, (_m: string, acr: string, suf: string | undefined) =>
    withSuffix(ACRONYMS[acr] ?? acr, suf),
  );
  s = s.replace(
    RE.singleLetter,
    (m: string, letter: string, suf: string | undefined, offset: number, whole: string) => {
      const name = LETTER_NAMES[letter];
      if (!name) return m;
      if (englishContext(whole, offset, m.length)) return m;
      if (suf === undefined) return name;
      // "I'm", "A's" gibi tanınmayan ek İngilizce çekimdir: dokunma.
      const attached = attachKnown(name, suf);
      return attached === null || letter === 'I' ? m : attached;
    },
  );
  s = s.replace(/&/g, ' ve ');
  s = s.replace(/@/g, ' et ');
  s = s.replace(/;/g, ',');
  s = s.replace(/\s*[—–]\s*/g, ', ');
  s = s.replace(/\s-\s/g, ', ');
  s = s.replace(/[()[\]]/g, ', ');
  s = s.replace(/\uE000/g, '-');
  s = s.replace(/%/g, ' yüzde ');
  s = s.replace(/₺/g, ' lira ').replace(/\$/g, ' dolar ').replace(/€/g, ' avro ').replace(/£/g, ' sterlin ');
  return s;
}

/** Boşluk ve noktalama temizliği: ",," ya da " ," kalmasın, baştaki/sondaki virgül ve boşluk atılsın. */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/([.!?:])\s*,+/g, '$1')
    .replace(/,+\s*([.!?])/g, '$1')
    .replace(/^[\s,]+/, '')
    .replace(/[\s,]+$/, '');
}

/** Sese gidecek tek cümleyi/metni Türkçe okunuşa çevirir. Deterministik; hiçbir girdide fırlatmaz. */
export function toSpokenTurkish(text: string): string {
  if (typeof text !== 'string' || text === '') return '';
  try {
    const parts = text.split(RE.tagSplit);
    // Bölme yakalama grubuyla yapıldığı için tek indisler duygu etiketidir; onlara hiçbir kural işlemez.
    const joined = parts.map((part, i) => (i % 2 === 1 ? part : convertSegment(part))).join('');
    return tidy(joined);
  } catch {
    return text.replace(/\s+/g, ' ').trim();
  }
}
