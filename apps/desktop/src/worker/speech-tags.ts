/**
 * İfade etiketleri (sahne yönergeleri): modelin metne koyduğu `<laugh>`, `[laughs]`, `(gülüyor)`, `*güler*`, `<sigh>`…
 * Bunlar söz değildir. Motor destekliyorsa kendi yazımına çevrilir (gerçekten güler); desteklemiyorsa SESSİZCE atılır.
 * Hiçbir durumda harf harf okunmaz (şikâyet: "`<laugh>` etiketi sesli okunuyor, kahkaha atmıyor").
 *
 * Motor başına "desteklenen etiketler" tablosu yalnız buradadır (`ENGINE_TAGS`). Yeni bir yerel motor eklenince
 * (ör. gülme / iç çekme / nefes destekleyen bir ses) tabloya bir satır eklemek yeter.
 *
 * Saf modül: ses işçisi (seslendirme) ve ana süreç (ekrana giden metin) aynı dosyayı kullanır.
 */

import type { TtsEngineId } from '@fuber/shared';

export type Expression = 'laugh' | 'sigh' | 'breath' | 'gasp' | 'whisper' | 'cough' | 'cry';

/**
 * Etiketleri yorumlayan seslendirme hedefi. `none`: hiçbir etiketi desteklemeyen motor (etiketler atılır).
 * Yeni motor = bu birleşime bir ad + `ENGINE_TAGS`'e bir satır + `tagEngineFor`'da bir koşul.
 */
export type TagEngine = 'eleven_v3' | 'supertonic' | 'none';

/**
 * Motorun desteklediği ifadeler ve o motordaki yazımı. Tabloda olmayan ifade o motorda atılır.
 * - `eleven_v3`: köşeli ses etiketleri (ElevenLabs v3 belgesi: "[laughs]", "[sighs]", "[exhales]", "[whispers]"…).
 * - `supertonic` (Supertonic 3; varsayılan yerel ses): yazımı sivri ayraçlıdır (`<laugh>`, `<sigh>`, `<breath>`,
 *   `<throatclear>`). `<laugh>` sözcük olarak okunmuyor ama kahkaha da üretmiyor (hece benzeri kısa ses), `<sigh>`
 *   Türkçe cümlede bozuk duyuluyor ("Say"): ikisi de atılır. Tabloda yalnız `<throatclear>` vardır ve o da KOŞULLUDUR
 *   (`tagEngineFor` › `SUPERTONIC_TAG_VOICES`): model etiketi özel bir simge olarak değil, harf harf görür. Ölçüm
 *   (16 Kas 2026; uygulamanın kendi yolu, on ses, Whisper dökümü): Türkçe cümlede ON SESİN ONU DA etiketi SÖZCÜK
 *   olarak okudu ("Trokler günaydın efendim"); İngilizce cümlede altı ses (F1, F2, F3, F5, M1, M2) söz dışı kısa bir
 *   ses üretti, dördü (F4, M3, M4, M5; varsayılan M4 dahil) yine sözcük okudu. Bu yüzden etiket yalnız İngilizce
 *   konuşulurken ve o altı sesle geçer; öteki her durumda atılır. `tts-router`'daki işaret temizliği (`>` karakterini
 *   siler) ve okuma düzeltici geçen etiketi korur (`shieldTags`).
 * - `eleven_flash_v2_5`, Piper, EMA ve öteki bütün motorlar etiket desteklemez: `none`.
 * - Gerçek kahkaha bugün yalnız İngilizce Chatterbox Turbo'da var (`[laugh]`, `[chuckle]`); Jarvis'e bağlı değil.
 */
export const ENGINE_TAGS: Record<TagEngine, Partial<Record<Expression, string>>> = {
  eleven_v3: {
    laugh: '[laughs]',
    sigh: '[sighs]',
    breath: '[exhales]',
    gasp: '[gasps]',
    whisper: '[whispers]',
    cough: '[clears throat]',
    cry: '[crying]',
  },
  supertonic: { cough: '<throatclear>' },
  none: {},
};

/**
 * Supertonic 3'te `<throatclear>` etiketini SÖZCÜK OLARAK OKUMAYAN sesler (yalnız İngilizce cümlede; ölçüm yukarıda).
 * Yeni bir ses ya da dil eklenecekse önce ölçün: `node scripts/voice/tts-eval.mjs` › "etiket" satırı.
 */
export const SUPERTONIC_TAG_VOICES: ReadonlySet<string> = new Set(['F1', 'F2', 'F3', 'F5', 'M1', 'M2']);

/**
 * Seslendirme motoru ve (ElevenLabs'te) modeli için etiket hedefi. `context`: cümlenin sesi ve dili; Supertonic'te
 * etiket yalnız ölçülmüş ses + dil çiftinde geçer (bağlam verilmezse atılır: yanlışlıkla sözcük okunmasın).
 */
export function tagEngineFor(engine: TtsEngineId, model = '', context: { voice?: string | null; language?: string | null } = {}): TagEngine {
  if (engine === 'elevenlabs') return /^eleven_v3/.test(model) ? 'eleven_v3' : 'none';
  if (engine !== 'supertonic') return 'none';
  return context.language === 'en' && SUPERTONIC_TAG_VOICES.has(context.voice ?? '') ? 'supertonic' : 'none';
}

/** Yönergenin (katlanmış) sözcükleri → ifade. Türkçe ve İngilizce, sık görülen çekimleriyle. */
const WORDS: Array<[pattern: RegExp, expression: Expression]> = [
  [/^(laugh(s|ing|ter)?|chuckl(e|es|ing)|giggl(e|es|ing)|haha+|lol|gul(er|uyor|erek|me|us|umser|umsuyor)?|kahkaha( atar| atiyor| atarak)?|kikird(ar|iyor))$/, 'laugh'],
  [/^(sigh(s|ing)?|ic cek(er|iyor|erek|is)?|of+|oflar|ofluyor)$/, 'sigh'],
  [/^(breath(e|es|ing)?|inhale(s)?|exhale(s)?|nefes( alir| aliyor| verir| veriyor)?|soluk(lanir)?)$/, 'breath'],
  [/^(gasp(s|ing)?|saskinlik|irkilir)$/, 'gasp'],
  [/^(whisper(s|ing)?|fisild(ar|iyor|ayarak))$/, 'whisper'],
  [/^(cough(s|ing)?|clears? throat|throat ?clear(s|ing)?|oksur(ur|uyor)|bogazini temizler)$/, 'cough'],
  [/^(cr(y|ies|ying)|sob(s|bing)?|agl(ar|iyor))$/, 'cry'],
];

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

function expressionOf(inner: string): Expression | null {
  const folded = inner
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => FOLD[ch] ?? ch)
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!folded) return null;
  for (const [pattern, expression] of WORDS) if (pattern.test(folded)) return expression;
  return null;
}

// Sivri ayraç: her zaman yönergedir (`<laugh>`, `</laugh>`, `<break time="1s"/>`); söz hiçbir zaman böyle yazılmaz.
const ANGLE = /<\/?[\p{L}][^<>\n]{0,40}>/gu;
// Köşeli ayraç: kısa içerik yönergedir (`[laughs]`, `[iç çeker]`); uzun içerik açıklamadır ve metinde kalır.
const SQUARE = /\[([^[\]\n]{1,40})\]/g;
// Yıldız ve yuvarlak ayraç: yalnız içi bilinen bir ifadeyse yönergedir (`*güler*`, `(gülüyor)`); yoksa vurgu ya da
// olağan parantezdir ve içeriği söylenir.
const STAR = /\*{1,2}([^*\n]{1,30})\*{1,2}/g;
const ROUND = /\(([^()\n]{1,30})\)/g;

/**
 * Metindeki ifade etiketlerini `engine` için çevirir: desteklenen ifade motorun yazımına, desteklenmeyen boşluğa.
 * `eleven_v3` kendi serbest köşeli etiketlerini de anlar; tanınmayan köşeli etiket orada olduğu gibi kalır.
 */
export function renderExpressionTags(text: string, engine: TagEngine): string {
  const table = ENGINE_TAGS[engine];
  const render = (expression: Expression | null): string => (expression && table[expression] ? ` ${table[expression]} ` : ' ');
  return text
    // Kapanış etiketi (`</laugh>`) yalnız atılır: ifade açılışta bir kez verilir.
    .replace(ANGLE, (tag) => (tag.startsWith('</') ? ' ' : render(expressionOf(tag.replace(/[<>/]/g, ' ').trim().split(/\s+/)[0] ?? ''))))
    .replace(SQUARE, (tag, inner: string) => {
      const expression = expressionOf(inner);
      if (expression) return render(expression);
      return engine === 'eleven_v3' ? tag : ' ';
    })
    .replace(STAR, (whole, inner: string) => (expressionOf(inner) ? render(expressionOf(inner)) : whole))
    .replace(ROUND, (whole, inner: string) => (expressionOf(inner) ? render(expressionOf(inner)) : whole))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .trim();
}

/** Ekrana ve döküme giden metin: ifade etiketleri görünmez (hiçbir motor yazımı kalmaz). */
export function stripExpressionTags(text: string): string {
  return renderExpressionTags(text, 'none');
}

/**
 * Yazılı sohbet metni için dar ayıklama: yalnız TANINAN ifadeler (`<laugh>`, `[laughs]`, `(gülüyor)`, `*güler*`) atılır.
 * Yazılı yanıt Markdown'dur; bağlantı (`[metin](adres)`), işaret kutusu (`[ ]`), kaynak numarası (`[1]`), kod içindeki
 * sivri ayraç (`List<string>`) yönerge değildir ve kalır. Satır sonları korunur (liste, paragraf).
 */
export function stripKnownExpressionTags(text: string): string {
  const known = (inner: string) => expressionOf(inner) !== null;
  // Atılan yönergenin yeri işaretlenir; boşluk yalnız O yerde düzeltilir (girinti, tablo ve kod boşlukları bozulmaz).
  const GONE = '\uE001';
  return text
    .replace(ANGLE, (tag) => (known(tag.replace(/[<>/]/g, ' ').trim().split(/\s+/)[0] ?? '') ? GONE : tag))
    .replace(SQUARE, (tag, inner: string) => (known(inner) ? GONE : tag))
    .replace(STAR, (whole, inner: string) => (known(inner) ? GONE : whole))
    .replace(ROUND, (whole, inner: string) => (known(inner) ? GONE : whole))
    .replace(/(^|\n)[ \t]*\uE001[ \t]*/g, '$1')
    .replace(/[ \t]*\uE001[ \t]*(?=[.,!?;:]|\n|$)/g, '')
    .replace(/[ \t]*\uE001[ \t]*/g, ' ');
}

/** Henüz kapanmamış bir yönerge başlangıcı (akışta parça parça gelen metnin sonunda) nerede başlıyor; yoksa -1. */
export function openTagStart(text: string): number {
  const tail = Math.max(0, text.length - 44);
  for (const [open, close] of [['<', '>'], ['[', ']'], ['(', ')']] as const) {
    const at = text.lastIndexOf(open);
    if (at >= tail && text.indexOf(close, at) === -1 && !text.slice(at).includes('\n')) return at;
  }
  // Yıldız: son satırda tek sayıda yıldız öbeği varsa sonuncusu açık kalmıştır.
  const line = text.slice(text.lastIndexOf('\n') + 1);
  const stars = [...line.matchAll(/\*{1,2}/g)];
  if (stars.length % 2 === 1) {
    const at = text.length - line.length + (stars.at(-1)?.index ?? 0);
    if (at >= tail) return at;
  }
  return -1;
}
