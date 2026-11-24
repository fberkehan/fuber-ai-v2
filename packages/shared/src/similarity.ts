/**
 * Metin benzerliği (Türkçe kök kümelerinin örtüşmesi). Yinelenen kaydı ve yinelenen yanıtı tanımak için:
 * aynı hatırlatıcının ikinci kez kurulması, hafızaya aynı bilginin yeniden yazılması, modelin önceki yanıtını
 * aynen yinelemesi. Fuber AI 1'in hafıza kuralından uyarlandı (`shared/tr-kok.ts`, `shared/hafiza-kurali.ts`):
 * orada 28 günlük kullanım benzetimiyle ayarlanan ölçü ve eşikler buradadır.
 */

import { foldForSearch } from './search';

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
export const textSimilarity = (a: string, b: string): number => stemSetSimilarity(stemSet(a), stemSet(b));

/** Bu ve üstü: aynı kayıt sayılır, yenisi yazılmaz. */
export const SIMILAR_SKIP = 0.9;
/** Bu ve üstü: aynı konunun yeni söylenişi (kayıt birleştirilir ya da yineleme sayılır). */
export const SIMILAR_MERGE = 0.7;
