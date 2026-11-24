/**
 * Metin düzeyinde yankı süzgeci: yazıya çevrilen söz, Jarvis'in az önce seslendirdiği metnin aynısı mı.
 *
 * Neden var: hoparlörden çıkan ses mikrofona sızıyorsa (yankı engelleme tutmuyor) Jarvis kendi cümlesini kullanıcı
 * sözü sanar ve yanıtlar (bir sınama oturumunda: "…Umarım işinize yarar." → kullanıcı sözü olarak
 * "Bunun işinize yarar." → üçüncü kez aynı hatırlatıcı). Ses düzeyindeki korumalar (çalma bitene dek söz toplamama,
 * `session.ts`) asıl engeldir; bu süzgeç onların kaçırdığını yakalayan ikinci ağdır ve tek başına da yeterli olmalıdır.
 *
 * Karşılaştırma sözcük düzeyindedir: iki metin de okunuşa çevrilir ("20:00'de" → "yirmide"), katlanır (büyük/küçük,
 * Türkçe harf, noktalama) ve sıralı ortak alt dizi (LCS) aranır. Whisper yankıyı birebir yazmaz ("Umarım" → "Bunun");
 * bu yüzden eşleşme bulanıktır ve karar orana bakar.
 */

import { foldSpeech } from './text-match';

export interface EchoVerdict {
  /**
   * `echo`: sözün tamamı Jarvis'in kendi sesi · `partial`: baştaki kısım yankı, ardından yeni söz var (`rest`) ·
   * `none`: yankı değil (`rest` sözün tamamıdır).
   */
  kind: 'echo' | 'partial' | 'none';
  /** Yankıdan sonra kalan, kullanıcıya ait söz (özgün yazımıyla). */
  rest: string;
  /** Seslendirilen metinle eşleşen sözcük sayısı. */
  matched: number;
  /** Eşleşen sözcüklerin, sözün yankı sayılan kısmına oranı (0–1). */
  coverage: number;
}

export interface EchoOptions {
  /**
   * Gevşek eşik: söz, Jarvis konuşurken ya da çalma biter bitmez başladıysa (yankı olması fiziksel olarak mümkün).
   * Sıkı eşik: söz çalma bittikten sonra başladı ya da konuşmayı kesen sözdü (kullanıcının Jarvis'in sözcüklerini
   * yinelemesi olağandır: "saat ustası mı?").
   */
  lenient: boolean;
  /** Tek-iki sözcüklük sözde "kuyruk" kuralı uygulansın mı (yalnız gevşek eşikte; varsayılan açık). */
  tail?: boolean;
  /** Metni okunuşa çevirir (rakam → sözcük); verilmezse metin olduğu gibi karşılaştırılır. */
  normalize?: (text: string) => string;
}

/** Karşılaştırmaya giren seslendirilmiş metnin son bu kadar sözcüğü (uzun yanıtta LCS pahalı ve gürültülü olmasın). */
const SPOKEN_WINDOW = 220;
/** Tek-iki sözcüklük söz, seslendirilen metnin son bu kadar sözcüğünden biriyse yankının kuyruğudur. */
const TAIL_WORDS = 4;

const LENIENT = { minMatched: 2, minCoverage: 0.5 };
const STRICT = { minMatched: 3, minCoverage: 0.8 };

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * İki katlanmış sözcük aynı söz mü. Kısa sözcükler ("bu", "bir", "mi") yalnız birebir eşleşir; uzunlarda ek farkı
 * ("bilgisayarda" / "bilgisayardaki") ve bir-iki harflik yazım sapması ("çalışıyorum" / "çalışıyoruz") kabul edilir.
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (shorter >= 8) return editDistance(a, b) <= 2;
  if (shorter >= 5) return editDistance(a, b) <= 1;
  return false;
}

const fold = (text: string): string[] =>
  foldSpeech(text)
    .replace(/['’]/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];

interface HeardToken {
  word: string;
  /** Özgün metinde bu sözcüğü taşıyan parçanın bittiği konum. */
  end: number;
}

/** Sözü boşluklardan parçalar, her parçayı okunuşa çevirip katlar; her sözcük özgün metindeki yerini bilir. */
function heardTokens(text: string, normalize: (text: string) => string): HeardToken[] {
  const tokens: HeardToken[] = [];
  for (const chunk of text.matchAll(/\S+/g)) {
    const end = chunk.index + chunk[0].length;
    for (const word of fold(normalize(chunk[0]))) tokens.push({ word, end });
  }
  return tokens;
}

/**
 * `heard`: yazıya çevrilen söz · `spoken`: Jarvis'in az önce seslendirdiği metin (birden çok cümle olabilir).
 * Karar yalnız metne bakar; sözün ne zaman başladığını bilen çağıran eşiği (`lenient`) seçer.
 */
export function detectEcho(heard: string, spoken: string, options: EchoOptions): EchoVerdict {
  const normalize = options.normalize ?? ((text: string) => text);
  const none: EchoVerdict = { kind: 'none', rest: heard.trim(), matched: 0, coverage: 0 };
  const h = heardTokens(heard, normalize);
  const s = fold(normalize(spoken)).slice(-SPOKEN_WINDOW);
  if (h.length === 0 || s.length === 0) return none;

  // dp[i][j]: sözün ilk i sözcüğü ile seslendirilen metnin ilk j sözcüğünün en uzun sıralı ortak alt dizisi.
  const dp: number[][] = Array.from({ length: h.length + 1 }, () => new Array<number>(s.length + 1).fill(0));
  for (let i = 1; i <= h.length; i++) {
    const row = dp[i] ?? [];
    const above = dp[i - 1] ?? [];
    const word = h[i - 1]?.word ?? '';
    for (let j = 1; j <= s.length; j++) {
      row[j] = sameWord(word, s[j - 1] ?? '') ? (above[j - 1] ?? 0) + 1 : Math.max(above[j] ?? 0, row[j - 1] ?? 0);
    }
  }
  const matched = dp[h.length]?.[s.length] ?? 0;
  if (matched === 0) return none;

  // Yankı sözün BAŞINDADIR (kullanıcı ardından konuşmuş olabilir): aynı eşleşme sayısına ulaşan en kısa baş kısım.
  let echoLength = h.length;
  while (echoLength > 1 && (dp[echoLength - 1]?.[s.length] ?? 0) === matched) echoLength--;
  // Baş kısmın son sözcüğü seslendirilen metinde nereye düşüyor (kuyruk kuralı için): o satırda değerin ilk arttığı sütun.
  const lastRow = dp[echoLength] ?? [];
  let lastSpoken = s.length;
  while (lastSpoken > 1 && (lastRow[lastSpoken - 1] ?? 0) === matched) lastSpoken--;

  const coverage = matched / echoLength;
  const rule = options.lenient ? LENIENT : STRICT;
  const byRatio = matched >= rule.minMatched && coverage >= rule.minCoverage;
  // "…işinize yarar." çalınırken kapanan bölütten yalnız son sözcük kalmış olabilir ("Yarar."). Tek sözcükte bulanık
  // eşleşme yanıltır ("Onaylıyor musunuz?" → kullanıcı: "Onaylıyorum"): sözcük birebir aynı olmalıdır.
  const tailWord = s[lastSpoken - 1] ?? '';
  const exactTail = h.slice(0, echoLength).some((token) => token.word === tailWord);
  const byTail = options.lenient && options.tail !== false && echoLength <= 2 && lastSpoken > s.length - TAIL_WORDS && exactTail;
  if (!byRatio && !byTail) return none;

  const rest = heard.slice(h[echoLength - 1]?.end ?? heard.length).replace(/^[\s,.;:!?…'’"-]+/u, '').trim();
  const restHasWords = /[\p{L}\p{N}]/u.test(rest);
  return { kind: restHasWords ? 'partial' : 'echo', rest: restHasWords ? rest : '', matched, coverage };
}

/**
 * Konuşmayı KESEN söz, kesilen cümlenin kendi başı mı. Yankı engelleme tutmuyorsa (ve söz kesme `voice` kipindeyse)
 * Jarvis ilk yarım saniyede kendi sesini duyup kendini keser; bölütte cümlenin ilk bir-iki sözcüğü vardır ve sonuncusu
 * yarım kalmıştır ("Yarın güneşli olacak" → "Yarın güneşin"). Kural dardır: en çok beş sözcük, sondan öncekilerin hepsi
 * cümlenin aynı sıradaki sözcüğüyle eşleşir, sonuncu en azından aynı sesle başlar.
 */
export function isOwnSentenceStart(heard: string, sentences: string[], normalize: (text: string) => string = (text) => text): boolean {
  const h = fold(normalize(heard));
  if (h.length === 0 || h.length > 5) return false;
  return sentences.some((sentence) => {
    const s = fold(normalize(sentence));
    if (s.length < h.length) return false;
    for (let i = 0; i < h.length; i++) {
      const word = h[i] ?? '';
      const expected = s[i] ?? '';
      if (sameWord(word, expected)) continue;
      const last = i === h.length - 1;
      // Yarım kalan son sözcük: tek sözcüklük sözde en az üç harf ortak olmalı; öncesi eşleştiyse ilk ses yeter.
      if (last && commonPrefix(word, expected) >= (i === 0 ? 3 : 1)) continue;
      return false;
    }
    return true;
  });
}
