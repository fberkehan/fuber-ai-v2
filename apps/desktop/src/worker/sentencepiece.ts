/**
 * SentencePiece modelinin (`bpe.model`) bağımlılıksız okuyucusu ve kodlayıcısı.
 * Anahtar sözcük sezici, uyandırma sözünü modelin kendi parçalarına bölünmüş olarak ister
 * ("▁HE Y ▁J AR VI S"). Söz politikadan geldiği için bölme çalışma anında yapılmak zorunda;
 * sentencepiece kitaplığı eklemek yerine dosyanın iki alanı (parçalar ve model türü) okunur.
 */

export interface SentencePieceModel {
  /** `unigram`: en yüksek toplam puanlı bölme (Viterbi) · `bpe`: en yüksek puanlı komşu çifti birleştirerek. */
  type: 'unigram' | 'bpe';
  /** Parça → puan (yalnız normal parçalar; denetim ve bilinmeyen simgeleri girmez). */
  scores: Map<string, number>;
  maxPieceLength: number;
}

const WORD_START = '▁';

interface Cursor {
  buf: Uint8Array;
  pos: number;
}

function readVarint(c: Cursor): number {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = c.buf[c.pos++];
    if (byte === undefined) throw new Error('sentencepiece: beklenmeyen dosya sonu');
    // 32 bitten büyük değerler (bu dosyada yok) için kayan nokta çarpımı: `<<` 32 bitte taşar.
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7;
  }
}

/** Bir iletinin alanlarını gezer: `visit(alan, telTürü, değer)`; uzunluk önekli alanlarda değer alt dilimdir. */
function eachField(buf: Uint8Array, visit: (field: number, wire: number, value: number | Uint8Array) => void): void {
  const c: Cursor = { buf, pos: 0 };
  while (c.pos < buf.length) {
    const tag = readVarint(c);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 0) {
      visit(field, wire, readVarint(c));
    } else if (wire === 1) {
      c.pos += 8;
    } else if (wire === 2) {
      const length = readVarint(c);
      visit(field, wire, buf.subarray(c.pos, c.pos + length));
      c.pos += length;
    } else if (wire === 5) {
      visit(field, wire, buf.subarray(c.pos, c.pos + 4));
      c.pos += 4;
    } else {
      throw new Error(`sentencepiece: desteklenmeyen alan türü ${wire}`);
    }
  }
}

export function parseSentencePieceModel(file: Uint8Array): SentencePieceModel {
  const decoder = new TextDecoder('utf-8');
  const scores = new Map<string, number>();
  let type: SentencePieceModel['type'] = 'unigram';
  let maxPieceLength = 1;

  eachField(file, (field, wire, value) => {
    if (wire !== 2 || !(value instanceof Uint8Array)) return;
    if (field === 1) {
      // SentencePiece { piece = 1; score = 2 (float); type = 3 (1 = NORMAL, varsayılan) }
      let piece = '';
      let score = 0;
      let pieceType = 1;
      eachField(value, (f, w, v) => {
        if (f === 1 && v instanceof Uint8Array) piece = decoder.decode(v);
        else if (f === 2 && w === 5 && v instanceof Uint8Array) {
          score = new DataView(v.buffer, v.byteOffset, 4).getFloat32(0, true);
        } else if (f === 3 && typeof v === 'number') pieceType = v;
      });
      if (pieceType === 1 && piece.length > 0) {
        scores.set(piece, score);
        maxPieceLength = Math.max(maxPieceLength, [...piece].length);
      }
    } else if (field === 2) {
      // TrainerSpec.model_type = 3 (1 = UNIGRAM, 2 = BPE)
      eachField(value, (f, _w, v) => {
        if (f === 3 && v === 2) type = 'bpe';
      });
    }
  });

  if (scores.size === 0) throw new Error('sentencepiece: modelde parça yok');
  return { type, scores, maxPieceLength };
}

function encodeUnigram(model: SentencePieceModel, chars: string[]): string[] | null {
  const n = chars.length;
  const best = new Array<number>(n + 1).fill(Number.NEGATIVE_INFINITY);
  const back = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let end = 1; end <= n; end++) {
    for (let start = Math.max(0, end - model.maxPieceLength); start < end; start++) {
      const from = best[start];
      if (from === undefined || from === Number.NEGATIVE_INFINITY) continue;
      const score = model.scores.get(chars.slice(start, end).join(''));
      if (score === undefined) continue;
      if (from + score > (best[end] ?? Number.NEGATIVE_INFINITY)) {
        best[end] = from + score;
        back[end] = start;
      }
    }
  }
  if (best[n] === Number.NEGATIVE_INFINITY) return null;
  const pieces: string[] = [];
  for (let end = n; end > 0; ) {
    const start = back[end] ?? -1;
    if (start < 0) return null;
    pieces.unshift(chars.slice(start, end).join(''));
    end = start;
  }
  return pieces;
}

function encodeBpe(model: SentencePieceModel, chars: string[]): string[] | null {
  const pieces = [...chars];
  for (;;) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pieces.length - 1; i++) {
      const score = model.scores.get(`${pieces[i]}${pieces[i + 1]}`);
      if (score !== undefined && score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    pieces.splice(bestIndex, 2, `${pieces[bestIndex]}${pieces[bestIndex + 1]}`);
  }
  return pieces.every((piece) => model.scores.has(piece)) ? pieces : null;
}

/**
 * Metni modelin parçalarına böler. Model sözlüğünde karşılığı olmayan bir harf varsa `null` döner
 * (ör. İngilizce modelde "ç"): çağıran o sözü seziciye vermez, yalnız Whisper yolu çalışır.
 * `transform`: modelin eğitildiği yazım (bu modelde büyük harf).
 */
export function encodePieces(
  model: SentencePieceModel,
  text: string,
  transform: (value: string) => string = (value) => value,
): string[] | null {
  const words = transform(text.normalize('NFKC')).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const chars = [...words.map((word) => `${WORD_START}${word}`).join('')];
  return model.type === 'bpe' ? encodeBpe(model, chars) : encodeUnigram(model, chars);
}
