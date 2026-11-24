// Web modülünün küçük metin yardımcıları: Türkçe katlama, sözcük kökü, yer adı ekleri, kısaltma, önbellek.

/** Küçük harf + Türkçe harfler sadeleşmiş (karşılaştırma için; gösterilmez). */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
}

const STOPWORDS = new Set(
  (
    've veya ile ama fakat ki de da mi mı mu mü ne nedir nasil neden nerede hangi kac bir bu su o icin gibi kadar daha en cok az olan ' +
    'midir mudur var yok mu acaba lutfen bana beni sen siz biz the a an and or of to in on for is are was what how why when which who ' +
    'does do with by from at as it this that be'
  ).split(' '),
);

/**
 * Sözcükleri katlanmış, durak sözcüksüz ve ilk beş harfe indirilmiş (Türkçe eklere karşı kaba kök) olarak döndürür.
 * "Ekşi maya besleme saatleri" → ["eksi", "maya", "besle", "saatl"].
 */
export function terms(text: string): string[] {
  const words = fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  return [...new Set(words.map((word) => word.slice(0, 5)))];
}

/** Metni sözcük sınırında keser; kesildiyse sona "…" koyar. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

const BACK_VOWELS = 'aıou';
const VOWELS = 'aeıioöuü';
const HARD = 'fstkçşhp';

/** Bulunma eki: "Ankara" → "Ankara'da", "Rize" → "Rize'de", "Paris" → "Paris'te". */
export function locative(name: string): string {
  const lower = name.toLocaleLowerCase('tr');
  const vowel = [...lower].reverse().find((ch) => VOWELS.includes(ch));
  const back = vowel ? BACK_VOWELS.includes(vowel) : false;
  const last = lower.at(-1) ?? '';
  const consonant = HARD.includes(last) ? 't' : 'd';
  return `${name}'${consonant}${back ? 'a' : 'e'}`;
}

// Yer adının sonuna (kesme işaretsiz) eklenmiş olabilecek ekler; uzundan kısaya denenir.
const PLACE_SUFFIXES = [
  'ndaki', 'ndeki', 'daki', 'deki', 'taki', 'teki',
  'nın', 'nin', 'nun', 'nün', 'dan', 'den', 'tan', 'ten', 'nda', 'nde',
  'da', 'de', 'ta', 'te', 'ın', 'in', 'un', 'ün', 'ya', 'ye', 'yı', 'yi', 'yu', 'yü',
];

/**
 * Kullanıcının söylediği yer adından aranabilir adaylar: "Ankara'nın" → ["Ankara"]; "rizede" → ["rizede",
 * "rize"]. İlk aday en olasıdır; coğrafi kodlama sırayla dener.
 */
export function placeCandidates(raw: string): string[] {
  const text = raw
    .replace(/(?<!\p{L})(il|ili|ilinde|şehri|şehrinde|kenti|kentinde|ilçesi|ilçesinde)(?!\p{L})/giu, ' ')
    .replace(/[?!.,;:"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return [];
  const apostrophe = /^(.+?)['’ʼ`´]\p{L}*$/u.exec(text);
  if (apostrophe) return [apostrophe[1]!.trim()];
  const candidates = [text];
  const words = text.split(' ');
  const last = words.at(-1)!;
  for (const suffix of PLACE_SUFFIXES) {
    if (last.length - suffix.length >= 3 && last.toLocaleLowerCase('tr').endsWith(suffix)) {
      candidates.push([...words.slice(0, -1), last.slice(0, -suffix.length)].join(' '));
      break;
    }
  }
  return candidates;
}

/** Süreli, boyutu sınırlı bellek önbelleği. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; until: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.until <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, until: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  clear(): void {
    this.entries.clear();
  }
}
