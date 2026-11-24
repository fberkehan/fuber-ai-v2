// Veda sözü: "güle güle", "bay bay", "görüşürüz", "hoşça kal", "iyi geceler", "kendine iyi bak", "sonra konuşuruz",
// "kapat artık". İstenen davranış: "güle güle", "bay bay" gibi bir söz sesli sohbeti kapatmalı; yani sohbeti
// BİTİRMELİ, devre dışı bırakmamalı. Veda bir BİTİRME sözüdür: sohbet
// kipi ve takip dinlemesi biter, tek kısa veda söylenir; mikrofon kapanmaz, uyandırma sözü dinlenmeye devam eder.
//
// Karar modele bırakılmaz. Bu dosya içe aktarımsızdır: hem ses oturumunun hızlı yolu (`voice/text-match.ts`, model turu
// açılmadan) hem beyin (`local-intents.ts`; yazılı sohbet ve oturumun yakalamadığı sözler) AYNI kalıbı kullanır.
//
// Kural dardır: söz, dolgu sözcükleri ve asistanın adı atıldıktan sonra YALNIZ veda öbeklerinden oluşmalıdır. "Ona güle
// güle dedim", "bay bay demeyi unutma diye hatırlat", "görüşürüz diye bir film var mı" veda değildir.

const DIACRITICS: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Türkçe küçük harf, aksansız Latin, noktalama yerine boşluk. */
const fold = (text: string): string =>
  text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => DIACRITICS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Vedanın yanında anlam taşımayan sözcükler ("tamam o zaman, teşekkürler, görüşürüz"). */
const FILLERS = new Set([
  'tamam', 'peki', 'hadi', 'haydi', 'o', 'zaman', 'e', 'ee', 'ya', 'hey', 'efendim', 'oldu', 'olur', 'simdilik', 'bugunluk', 'ben', 'sen', 'siz', 'sana', 'size', 'de', 'da',
  'tesekkurler', 'tesekkur', 'ederim', 'sagol', 'sag', 'ol', 'cok', 'eyvallah', 'canim', 'dostum', 'bakalim',
]);

/** Asistanın adının Whisper'daki yazımları (ad politikadan da verilir). */
const NAME = /^(jarvis|carvis|cervis|jarvi[sz]|carviz)$/;

const NIGHT = 'iyi geceler|iyi uykular|tatli ruyalar|good night';
const BYE =
  'gule gule|bay bay|baybay|bye bye|bye|goodbye|good bye|see you|gorusuruz|gorusmek uzere|gorusecegiz|sonra gorusuruz|yarin gorusuruz|hosca kal(?:in)?|hoscakal(?:in)?|' +
  'kendine iyi bak|kendinize iyi bakin|sonra konusuruz|yarin konusuruz|kapat artik|artik kapat|allaha ismarladik|allahaismarladik';
const ONLY_FAREWELLS = new RegExp(`^(?:(?:${NIGHT}|${BYE})(?: |$))+$`);
const HAS_NIGHT = new RegExp(`(?:^| )(?:${NIGHT})(?: |$)`);

/** Vedada en çok bu kadar sözcük olur; daha uzunu başka bir şey anlatıyordur. */
const MAX_WORDS = 8;

export type FarewellKind = 'bye' | 'night';

/** Katlanmış söz çekirdeği, dolgular atılınca yalnız veda öbeklerinden mi oluşuyor (`voice/text-match.ts` › `chatCore` çıktısı için de). */
export function farewellKindOfCore(core: string): FarewellKind | null {
  const words = core.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return null;
  const bare = words.filter((word) => !FILLERS.has(word) && !NAME.test(word)).join(' ');
  if (!bare || !ONLY_FAREWELLS.test(bare)) return null;
  return HAS_NIGHT.test(bare) ? 'night' : 'bye';
}

/**
 * Söz bir veda mı: `bye` ("güle güle", "görüşürüz"), `night` ("iyi geceler"); değilse `null`. `names`: asistanın adı
 * (politikadan); söz içinde geçerse atılır ("Görüşürüz Jarvis").
 */
export function farewellKind(text: string, names: readonly string[] = []): FarewellKind | null {
  // Soru veda değildir ("görüşürüz mü?", "iyi geceler mi diyorsun?").
  if (/\?\s*$/.test(text.trim())) return null;
  const own = new Set(names.flatMap((name) => fold(name).split(' ')).filter(Boolean));
  const words = fold(text).split(' ').filter(Boolean);
  if (words.length > MAX_WORDS + 3) return null;
  return farewellKindOfCore(words.filter((word) => !own.has(word)).join(' '));
}
