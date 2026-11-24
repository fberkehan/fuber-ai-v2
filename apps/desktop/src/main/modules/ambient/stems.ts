// Türkçe kök kümesi ve metin benzerliği. Fuber AI 1'den alındı (`shared/tr-kok.ts`, `shared/hafiza-kurali.ts` ›
// `benzerlik`): eşikleri orada 28 günlük kullanım benzetimiyle ayarlanan ölçü. Tekrar bekçisi bununla çalışır.
// Aynı ölçü `d2-beyin` dalında `@fuber/shared` › `textSimilarity` olarak da geliyor; o dal birleşince bu dosya
// oradan içe aktarmaya indirilebilir (davranış aynı).
import { foldForSearch } from '@fuber/shared';

/** Atılacak ekler (katlanmış yazım), uzundan kısaya. Birden çok ek üst üste atılabilir ("toplantilarimi" → "toplanti"). */
const SUFFIXES = [
  'iyordum', 'iyordun', 'iyorduk', 'uyordum', 'uyordu', 'iyordu', 'iyoruz', 'iyorum', 'iyorsun', 'uyorum',
  'larimizi', 'lerimizi', 'larimiz', 'lerimiz', 'lariniz', 'leriniz', 'larimi', 'lerimi', 'larina', 'lerine', 'larinda', 'lerinde', 'larindan', 'lerinden',
  'mistim', 'mistik', 'mistin', 'misti', 'mussun', 'misin', 'musun', 'acagim', 'ecegim', 'acak', 'ecek',
  'indan', 'inden', 'undan', 'unden', 'inda', 'inde', 'unda', 'unde', 'ina', 'ine', 'una', 'une',
  'lari', 'leri', 'lar', 'ler', 'imiz', 'iniz', 'umuz', 'unuz',
  'nin', 'nun', 'dan', 'den', 'tan', 'ten', 'yla', 'yle', 'sini', 'sunu', 'sina', 'sine',
  'dim', 'dik', 'din', 'tim', 'tik', 'tin', 'mis', 'mus',
  'imi', 'ini', 'umu', 'unu', 'isi', 'usu', 'si', 'su',
  'da', 'de', 'ta', 'te', 'la', 'le', 'ya', 'ye', 'yi', 'yu', 'di', 'du', 'ti', 'tu',
  'im', 'in', 'um', 'un', 'i', 'u', 'a', 'e',
];
const MIN_STEM = 4;

/** Katlanmış tek sözcüğün kökü: sondan ek atılır, kök en az 4 harf kalır. Rakam içeren sözcük olduğu gibi kalır. */
export function turkishStem(word: string): string {
  let stem = word;
  if (/\d/.test(stem)) return stem;
  for (let round = 0; round < 4; round++) {
    const suffix = SUFFIXES.find((candidate) => stem.endsWith(candidate) && stem.length - candidate.length >= MIN_STEM);
    if (!suffix) break;
    stem = stem.slice(0, -suffix.length);
  }
  return stem;
}

/** Metnin kök kümesi: 3+ harfli sözcüklerin kökleri (büyük/küçük harf ve Türkçe harf farkı gözetilmez). */
export function stemSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of foldForSearch(text).split(/[^\p{L}\p{N}]+/u)) if (word.length >= 3) out.add(turkishStem(word));
  return out;
}

/** İki kök kümesinin benzerliği (0–1): ortak kök / küçük kümenin boyu. */
export function stemSetSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const stem of a) if (b.has(stem)) common++;
  return common / Math.min(a.size, b.size);
}

/** İki metnin benzerliği (0–1). */
export const stemSimilarity = (a: string, b: string): number => stemSetSimilarity(stemSet(a), stemSet(b));

const STOP_WORDS = new Set(
  (
    've veya ile ama fakat ancak ki da de mi mı mu mü bu şu o bir iki için gibi kadar daha çok az en ne nasıl neden niye ' +
    'hangi kim nerede zaman şey şeyi var yok olan olarak olur oldu olsun ise eğer hem her hiç bana beni benim sana seni ' +
    'senin biz bizim siz onu onun ona şimdi sonra önce yine zaten artık lütfen tamam evet hayır acaba bile sadece hep ' +
    'bugün yarın dün böyle şöyle yani işte hadi peki'
  )
    .split(/\s+/)
    .map((word) => foldForSearch(word)),
);

/** Katlanmış, sık sözcükleri atılmış anahtar sözcükler (sırası korunur, tekrar yok). v1 `hafiza/normal.ts` › `anahtarKelimeler`. */
export function keywords(text: string, max = 12): string[] {
  const out: string[] = [];
  for (const word of foldForSearch(text).split(/[^\p{L}\p{N}_]+/u)) {
    if (word.length < 3 || STOP_WORDS.has(word) || out.includes(word)) continue;
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Anahtar sözcüklerden FTS5 sorgusu: sözcükler VEYA ile, 4+ harfli olanlar kök öneki olarak ("toplantılarımı" → "topl"*
 * değil "toplanti"*). Ortak `ftsQuery` sözcükleri VE ile bağlar; "iz arama" için fazla dardır. Aranacak sözcük yoksa `null`.
 */
export function looseFtsQuery(text: string, max = 8): string | null {
  const terms = keywords(text, max).map((word) => {
    const stem = turkishStem(word);
    return stem.length >= 4 ? `"${stem}" *` : `"${word}"`;
  });
  return terms.length ? terms.join(' OR ') : null;
}
