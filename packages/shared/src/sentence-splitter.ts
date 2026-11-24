/**
 * Akışlı metinden Türkçe cümle ayırma. Beyin metni parça parça üretir; TTS ilk tam cümleyi
 * beklemeden almalıdır (KURGU §5.2). Yanlış yerde bölmek (tuhaf duraklama) yanlış birleştirmekten
 * (biraz gecikme) daha kötüdür; kararsız durumlarda bölünmez.
 *
 * Bölünmeyen yerler: kısaltmalar (Dr., vb., A.Ş.), baş harfler (M. Kemal), ondalık ve saat
 * (3.5, 10.30), alan adları (example.com), sıra sayıları (3. kat) ve küçük harfle devam eden üç nokta.
 */

const TERMINATORS = new Set(['.', '!', '?', '…']);
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);
const OPENERS = /^[("'“‘[«]+/;

/**
 * Noktayla biten ama cümle bitirmeyen kısaltmalar (küçük harf, noktasız).
 * Aynı zamanda sık cümle sonu olan sözcükler (tl, km, ara, yak, gör…) bilerek yoktur.
 */
const ABBREVIATIONS = new Set([
  'dr', 'prof', 'doç', 'yrd', 'uzm', 'av', 'müh', 'öğr', 'arş',
  'sn', 'bkz', 'bknz', 'örn', 'vb', 'vs', 'vd', 'krş',
  'no', 'nu', 'tel', 'cad', 'sok', 'mah', 'apt', 'blv',
  'ltd', 'şti', 'inc', 'co', 'corp', 'tic',
  'mr', 'mrs', 'ms', 'st', 'jr', 'sr',
  'çev', 'ed', 'ss', 'md', 'mö',
]);

const SINGLE_LETTER = /^\p{L}$/u;
/** `A.Ş`, `T.C`, `Ltd.Şti` gibi iç noktalı kısaltmalar (son nokta hariç). */
const DOTTED_ABBREVIATION = /^(\p{L}{1,4}\.)+\p{L}{1,4}$/u;
const HAS_CONTENT = /[\p{L}\p{N}]/u;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === ' ';
}

function isLowercaseLetter(ch: string): boolean {
  return ch.toLocaleLowerCase('tr') === ch && ch.toLocaleUpperCase('tr') !== ch;
}

export interface SentenceSplitterOptions {
  /**
   * Bu uzunluğu (karakter) aşan ve hâlâ bitmeyen cümle, son virgül/noktalı virgülden
   * (yoksa son boşluktan) bölünür ki TTS uzun cümlede beklemesin. Varsayılan 220.
   */
  maxChars?: number;
}

export class SentenceSplitter {
  private buffer = '';
  /** Buraya kadar olan kısımda bölme yeri olmadığı kesin; tarama buradan sürer. */
  private scan = 0;
  private readonly maxChars: number;

  constructor(options: SentenceSplitterOptions = {}) {
    this.maxChars = options.maxChars ?? 220;
  }

  /** Yeni metin parçasını ekler; bu parçayla tamamlanan cümleleri (sırayla, kırpılmış) döndürür. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let i = this.scan;

    while (i < this.buffer.length) {
      const ch = this.buffer[i]!;
      if (ch === '\n') {
        this.cut(out, i + 1);
        i = 0;
        continue;
      }
      if (!TERMINATORS.has(ch)) {
        i++;
        continue;
      }

      let runEnd = i;
      while (runEnd < this.buffer.length && TERMINATORS.has(this.buffer[runEnd]!)) runEnd++;
      let afterClosers = runEnd;
      while (afterClosers < this.buffer.length && CLOSERS.has(this.buffer[afterClosers]!)) afterClosers++;

      // Noktadan sonrası henüz gelmedi: "3." mü "3.5" mi bilinemez.
      if (afterClosers >= this.buffer.length) break;
      if (!isSpace(this.buffer[afterClosers]!)) {
        i = afterClosers;
        continue;
      }

      let next = afterClosers;
      let sawNewline = false;
      while (next < this.buffer.length && isSpace(this.buffer[next]!)) {
        if (this.buffer[next] === '\n') sawNewline = true;
        next++;
      }
      const nextChar = next < this.buffer.length ? this.buffer[next]! : null;

      const decision = this.decide(i, runEnd, nextChar, sawNewline, afterClosers > runEnd);
      if (decision === 'wait') break;
      if (decision === 'skip') {
        i = afterClosers;
        continue;
      }
      this.cut(out, afterClosers);
      i = 0;
    }
    this.scan = i;

    while (this.buffer.length > this.maxChars) {
      const at = this.softBreak();
      if (at <= 0) break;
      this.cut(out, at);
      this.scan = 0;
    }
    return out;
  }

  /** Akış bitti: kalan metni son cümle olarak döndürür ve durumu sıfırlar. */
  flush(): string[] {
    const out: string[] = [];
    this.cut(out, this.buffer.length);
    this.reset();
    return out;
  }

  /** Bekleyen metni atar (söz kesme). */
  reset(): void {
    this.buffer = '';
    this.scan = 0;
  }

  /** Henüz cümle olarak verilmemiş metin. */
  get pending(): string {
    return this.buffer;
  }

  private decide(
    runStart: number,
    runEnd: number,
    nextChar: string | null,
    sawNewline: boolean,
    hasClosers: boolean,
  ): 'split' | 'skip' | 'wait' {
    const run = this.buffer.slice(runStart, runEnd);
    if (sawNewline) return 'split';
    // “Hazırım.” dedi: tırnak kapandıktan sonra küçük harfle süren cümle bitmemiştir.
    if (hasClosers) {
      if (nextChar === null) return 'wait';
      if (isLowercaseLetter(nextChar)) return 'skip';
    }
    if (run.includes('!') || run.includes('?')) return 'split';

    const ellipsis = run.includes('…') || run.length >= 2;
    if (ellipsis) {
      if (nextChar === null) return 'wait';
      return isLowercaseLetter(nextChar) ? 'skip' : 'split';
    }

    const word = this.wordBefore(runStart);
    if (ABBREVIATIONS.has(word.toLocaleLowerCase('tr'))) return 'skip';
    if (SINGLE_LETTER.test(word)) return 'skip';
    if (DOTTED_ABBREVIATION.test(word)) return 'skip';
    // "3. kat", "2. Dünya Savaşı": bir-iki haneli sayıdan sonraki nokta büyük olasılıkla sıra sayısıdır.
    if (/^\d{1,2}$/.test(word)) return 'skip';
    if (/^\d+$/.test(word)) {
      if (nextChar === null) return 'wait';
      return isLowercaseLetter(nextChar) ? 'skip' : 'split';
    }
    return 'split';
  }

  private wordBefore(index: number): string {
    let start = index;
    while (start > 0 && !isSpace(this.buffer[start - 1]!)) start--;
    return this.buffer.slice(start, index).replace(OPENERS, '');
  }

  /** `maxChars` içindeki en iyi yumuşak bölme yeri; yoksa 0. */
  private softBreak(): number {
    const region = this.buffer.slice(0, this.maxChars);
    let best = -1;
    for (let i = region.length - 2; i >= 0; i--) {
      const ch = region[i]!;
      if ((ch === ',' || ch === ';' || ch === ':') && isSpace(region[i + 1]!)) {
        best = i + 1;
        break;
      }
    }
    if (best >= this.maxChars * 0.3) return best;
    return region.lastIndexOf(' ');
  }

  private cut(out: string[], end: number): void {
    const sentence = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end).trimStart();
    if (HAS_CONTENT.test(sentence)) out.push(sentence);
  }
}

/** Tam bir metni cümlelere böler (akış gerekmiyorsa). */
export function splitSentences(text: string, options?: SentenceSplitterOptions): string[] {
  const splitter = new SentenceSplitter(options);
  return [...splitter.push(text), ...splitter.flush()];
}
