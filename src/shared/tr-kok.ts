// ── Hafif Türkçe kökleyici ve küçük eş anlam sözlüğü (11 Kas analizi #5; saf, birim testli: tests/tr-kok.test.ts) ─────────────────────────────
// Hafıza araması dizine ve sorguya sadeleştirilmiş metin koyar (hafiza/normal.ts sadelestir: tr küçük harf, ı→i, ş→s …) ve 4+ harfli sözcüğü
// ÖNEK olarak arar. Eski önek "sözcük − 2 harf"ti: uzun çekimli sözcük kökü bulamıyordu ("toplantılarımı" → "toplantilari"*, "Toplantı saati"
// kaydını bulmaz). Burada sondan, uzundan kısaya ek atılır (kök en az 4 harf kalır); kök, eski önekten kısaysa önek odur. Ayrıca birkaç sık
// eş anlam ("rapor"~"özet", "toplantı"~"görüşme"~"randevu") aynı terimin VEYA'lı eşleri olur. Girdi ve çıktı SADELEŞTİRİLMİŞ (ASCII) sözcüktür.

/** Atılacak ekler (sadeleştirilmiş yazım), uzundan kısaya. Birden çok ek üst üste atılabilir ("toplantilarimi" → "toplanti"). */
const EKLER = [
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
const EN_KISA_KOK = 4;

/** Sadeleştirilmiş tek sözcüğün kökü: sondan ek atılır, kök en az 4 harf kalır; hiç ek atılamazsa sözcüğün kendisi. Rakam içeren sözcük olduğu gibi. */
export function turkceKok(sozcuk: string): string {
  let k = sozcuk;
  if (/\d/.test(k)) return k;
  for (let tur = 0; tur < 4; tur++) {
    const ek = EKLER.find((e) => k.endsWith(e) && k.length - e.length >= EN_KISA_KOK);
    if (!ek) break;
    k = k.slice(0, -ek.length);
  }
  return k;
}

/** Eş anlam kümeleri (sadeleştirilmiş kökler). Küçük tutulur: yanlış eşleşme bağlamı gürültüyle doldurur. */
const KUMELER: readonly (readonly string[])[] = [
  ['rapor', 'ozet', 'brifing'],
  ['toplanti', 'gorusme', 'randevu', 'bulusma'],
  ['tavan', 'limit', 'sinir'],
  ['zam', 'fiyat', 'artis'],
  ['bicim', 'format', 'duzen'],
  ['hatirlatici', 'hatirlatma'],
  ['firma', 'sirket'],
  ['yazilim', 'program', 'uygulama'],
  ['eposta', 'posta', 'mail'],
];

/** Kökün eşleri (kendisi hariç); yoksa boş. Eşleşme kökün başıyla ("toplant" → toplanti kümesi). */
export function esAnlamlilar(kok: string): string[] {
  if (kok.length < 3) return [];
  for (const k of KUMELER) {
    const bas = k.find((s) => s === kok || (kok.length >= 4 && (s.startsWith(kok) || kok.startsWith(s))));
    if (bas) return k.filter((s) => s !== bas);
  }
  return [];
}

/** Benzerlik ölçüsü için sözcük kümesi: sadeleştirilmiş metindeki 3+ harfli sözcüklerin kökleri. */
export function kokKumesi(sade: string): Set<string> {
  const out = new Set<string>();
  for (const w of sade.split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3) out.add(turkceKok(w));
  return out;
}
