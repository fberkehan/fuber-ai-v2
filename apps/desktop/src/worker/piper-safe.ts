/**
 * Piper'a giden metnin SON süzgeci: metni Piper'ın çökmeden okuyabildiği güvenli karakter kümesine indirir.
 *
 * Neden: `piper.exe` (2023.11.14-2, espeak-ng) bazı simgelerde erişim ihlaliyle (0xC0000005, çıkış kodu
 * 3221225477) çöküyor; süren cümle hiç okunmuyor ve süreç yeniden başlatılıyor. Kanıtlanan: oklar ("A → B").
 * Ölçülmemiş her karakter risk olduğundan kara liste yerine İZİN LİSTESİ kullanılır.
 *
 * Yeri: `Piper.speak` içinde, `speakableText`'ten (dolayısıyla yönlendiricinin `spokenForm` + Türkçe okuma
 * düzelticisinden) SONRA. Okuma düzelticinin kuralları önce çalışır ve ezilmez; burada yalnız ondan arta kalan
 * simgeler okunur ya da duraksamaya çevrilir, gerisi atılır. Öteki motorlar (Supertonic, EMA, ElevenLabs) bu
 * süzgeçten GEÇMEZ.
 *
 * Saf, deterministik, idempotent (`f(f(x)) === f(x)`); hiçbir girdide fırlatmaz. Sonuç boşsa Piper'a hiçbir şey
 * gönderilmez (çağıran sessiz cümle sayar). Bütün kod noktaları kaçışla yazılır: kaynakta görünmez karakter yok.
 */

/**
 * İzin kümesi (tek karakter): ASCII harf ve rakam; Latin-1 ve Latin Genişletilmiş-A harfleri (ğ ı İ ş â é ñ å č ţ …)
 * ÇÖKERTENLER HARİÇ; boşluk; temel noktalama `. , ; : ! ? ' " ( ) - … % & / + = @ #`; tek tırnaklar ‘ ’.
 * Testler bu ifadeyi kullanır.
 *
 * Gerçek `piper.exe` + tr_TR-dfki-medium ile tek tek ölçülüp ÇÖKERTTİĞİ görülen (0xC0000005) ve bu yüzden kümede
 * OLMAYAN karakterler (`TRANSLITERATE` ile yakın karşılığına çevrilir): Æ æ Ð ð Ø ø Þ þ ß Đ đ Ħ ħ Ĳ ĳ ĸ Ł ł ŉ Ŋ ŋ
 * Œ œ Ŧ ŧ ſ Ș ș Ț ț “ ” (çift tipografik tırnak; tekler ‘ ’ çökertmiyor). Ortak yanları: taban harf + işarete
 * ayrışmayan harfler.
 */
export const PIPER_SAFE_CHAR =
  /[A-Za-z0-9À-ÅÇ-ÏÑ-ÖÙ-Ýà-åç-ïñ-öù-ýÿĀ-ďĒ-ĥĨ-ıĴ-ķĹ-ŀŃ-ňŌ-őŔ-ťŨ-ž .,;:!?'"()\-…%&/+=@#‘’]/u;

/** Piper'ı çökerten harfler ve tırnaklar: yakın okunuşlu güvenli karşılıkları. */
const TRANSLITERATE: Record<string, string> = {
  'Æ': 'Ae', // Æ
  'æ': 'ae', // æ
  'Ð': 'D', // Ð
  'ð': 'd', // ð
  'Ø': 'O', // Ø
  'ø': 'o', // ø
  'Þ': 'Th', // Þ
  'þ': 'th', // þ
  'ß': 'ss', // ß
  'Đ': 'D', // Đ
  'đ': 'd', // đ
  'Ħ': 'H', // Ħ
  'ħ': 'h', // ħ
  'Ĳ': 'IJ', // Ĳ
  'ĳ': 'ij', // ĳ
  'ĸ': 'k', // ĸ
  'Ł': 'L', // Ł
  'ł': 'l', // ł
  'ŉ': "'n", // ŉ
  'Ŋ': 'N', // Ŋ
  'ŋ': 'n', // ŋ
  'Œ': 'Oe', // Œ
  'œ': 'oe', // œ
  'Ŧ': 'T', // Ŧ
  'ŧ': 't', // ŧ
  'ſ': 's', // ſ
  'Ș': 'Ş', // Ș → Ş
  'ș': 'ş', // ș → ş
  'Ț': 'Ţ', // Ț → Ţ
  'ț': 'ţ', // ț → ţ
  '“': '"', // “
  '”': '"', // ”
};

/** Bütün dizenin izin kümesinden oluştuğunu sınar. */
export const PIPER_SAFE_TEXT = new RegExp(`^${PIPER_SAFE_CHAR.source}*$`, 'u');

const UNSAFE_RUN = new RegExp(`[^${PIPER_SAFE_CHAR.source.slice(1, -1)}]+`, 'gu');

/** Duraksama (virgül) yerine geçer; temizlikte komşu virgüllerle birleşir. */
const PAUSE = ' , ';

/** Anlamı olan tek simgeler: okunuşu. Okuma düzeltici bunların çoğunu zaten çevirir; burası ondan kalanlar içindir. */
const SPOKEN: Record<string, string> = {
  '×': ' çarpı ', // ×
  '÷': ' bölü ', // ÷
  '≈': ' yaklaşık ', // ≈
  '≤': ' en çok ', // ≤
  '≥': ' en az ', // ≥
  '≠': ' eşit değil ', // ≠
  '±': ' artı eksi ', // ±
  '−': '-', // − (eksi işareti)
  '∞': ' sonsuz ', // ∞
  '°': ' derece ', // °
  '‰': ' binde ', // ‰
  '№': ' numara ', // №
  ...TRANSLITERATE,
  '€': ' avro ', // €
  $: ' dolar ',
  '₺': ' lira ', // ₺
  '£': ' sterlin ', // £
  '¥': ' yen ', // ¥
  // Tırnak ve kesme işareti benzerleri izinli karşılıklarına.
  '«': '"', // «
  '»': '"', // »
  '„': '"', // „
  '‟': '"', // ‟
  '″': '"', // ″
  '‚': "'", // ‚
  '‛': "'", // ‛
  '′': "'", // ′
  '´': "'", // ´
  'ʼ': "'", // ʼ
  '`': "'",
  // Tire benzerleri: kısa olanlar tire, uzun olanlar duraksama.
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': PAUSE,
  '—': PAUSE,
  '―': PAUSE,
  // Madde imleri ve ara noktalar: duraksama.
  '•': PAUSE, // •
  '‣': PAUSE, // ‣
  '⁃': PAUSE, // ⁃
  '∙': PAUSE, // ∙
  '·': PAUSE, // ·
  '§': PAUSE, // §
  '¶': PAUSE, // ¶
};
const SPOKEN_RE = new RegExp(`[${Object.keys(SPOKEN).map((key) => `\\u{${key.codePointAt(0)!.toString(16)}}`).join('')}]`, 'gu');

/**
 * Duraksamaya çevrilen bloklar: oklar (2190–21FF, 27F0–27FF, 2900–297F, 2B00–2BFF), geometrik şekiller
 * (25A0–25FF: ■ ● ◦ madde imi olarak kullanılır), süslü madde imleri (2794–27BF).
 */
const PAUSE_BLOCKS = /[←-⇿■-◿➔-➿⟰-⟿⤀-⥿⬀-⯿]+/gu;

/**
 * Hiç iz bırakmadan silinenler (sözcüğün ortasında olabilirler): biçim karakterleri (sıfır genişlikli boşluk,
 * ZWJ/ZWNJ, yön işaretleri, yumuşak tire, emoji etiket karakterleri; \p{Cf}), birleştirici işaretler ve değişken
 * seçiciler (\p{M}; NFC'den sonra başıboş kalanlar), emoji ten rengi değiştiricileri.
 */
const INVISIBLE = /[\p{Cf}\p{M}\u{1F3FB}-\u{1F3FF}]+/gu;

/** Eşleşmemiş vekil birimleri (tek başına yüksek ya da alçak vekil). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Denetim karakterleri ve satır/paragraf ayraçları, her tür boşluk: tek boşluk. */
const SPACE_LIKE = /[\p{Cc}\p{Zs}\p{Zl}\p{Zp}]+/gu;

/** Tam genişlikli ASCII (！ → !, Ａ → A). */
const FULLWIDTH = /[！-～]/g;

function tidy(text: string): string {
  let current = text;
  // Kurallar birbirini besleyebilir; sabit noktaya kadar (en çok birkaç tur) uygulanır: idempotentlik garantisi.
  for (let round = 0; round < 8; round++) {
    const next = current
      .replace(/ {2,}/g, ' ')
      .replace(/ ([,.;:!?…])/g, '$1')
      .replace(/,(?: ?,)+/g, ',')
      .replace(/([.;:!?…]) ?,/g, '$1')
      .replace(/^[ ,]+/, '')
      .replace(/[ ,]+$/, '');
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Piper'a gidecek metni güvenli kümeye indirir. Okunacak harf ya da rakam kalmazsa boş dize döner.
 */
export function piperSafeText(text: string): string {
  if (typeof text !== 'string' || text === '') return '';
  try {
    let s = text.replace(LONE_SURROGATE, ' ');
    // Ayrışık yazılmış harfler ("c" + U+0327) tek harfe birleşsin; birleşemeyen işaretler aşağıda silinir.
    s = s.normalize('NFC');
    s = s.replace(FULLWIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    s = s.replace(INVISIBLE, '');
    s = s.replace(SPACE_LIKE, ' ');
    s = s.replace(SPOKEN_RE, (ch) => SPOKEN[ch] ?? ' ');
    s = s.replace(PAUSE_BLOCKS, PAUSE);
    // Kalan her şey (emoji, piktogram, kutu çizgileri, Braille, özel kullanım alanı, Latin dışı yazılar…): boşluk.
    s = s.replace(UNSAFE_RUN, ' ');
    s = tidy(s);
    return /[A-Za-z0-9À-ÖØ-öø-ÿĀ-ſ]/.test(s) ? s : '';
  } catch {
    return '';
  }
}
