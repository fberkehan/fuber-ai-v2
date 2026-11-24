import { describe, expect, it } from 'vitest';
import { encodePieces, parseSentencePieceModel } from './sentencepiece';
import { speakableText } from './tts-router';

/** Sınama için en küçük SentencePiece model dosyasını (protobuf) kurar. */
function buildModel(pieces: Array<[piece: string, score: number, type?: number]>, modelType: 1 | 2): Uint8Array {
  const bytes: number[] = [];
  const varint = (value: number) => {
    let v = value;
    while (v > 0x7f) {
      bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(v);
  };
  const lengthDelimited = (field: number, body: number[]) => {
    varint(field * 8 + 2);
    varint(body.length);
    bytes.push(...body);
  };
  for (const [piece, score, type] of pieces) {
    const body: number[] = [];
    const text = [...new TextEncoder().encode(piece)];
    body.push(1 * 8 + 2, text.length, ...text);
    const float = new Uint8Array(new Float32Array([score]).buffer);
    body.push(2 * 8 + 5, ...float);
    if (type !== undefined) body.push(3 * 8 + 0, type);
    lengthDelimited(1, body);
  }
  // TrainerSpec { model_type = 3 }
  lengthDelimited(2, [3 * 8 + 0, modelType]);
  return new Uint8Array(bytes);
}

const upper = (text: string) => text.toUpperCase();

describe('SentencePiece okuyucu', () => {
  const unigram = parseSentencePieceModel(
    buildModel(
      [
        ['<blk>', 0, 3],
        ['<unk>', 0, 2],
        ['▁HE', -3],
        ['Y', -4],
        ['▁', -3.5],
        ['▁JA', -6],
        ['R', -4],
        ['VI', -6],
        ['S', -3],
        ['▁J', -7],
        ['A', -4],
        ['I', -4.5],
        ['V', -6],
        ['▁HEY', -9.5],
        ['H', -5],
        ['E', -3.5],
      ],
      1,
    ),
  );

  it('parçaları, puanları ve model türünü okur; denetim simgelerini almaz', () => {
    expect(unigram.type).toBe('unigram');
    expect(unigram.scores.has('<blk>')).toBe(false);
    expect(unigram.scores.get('▁HE')).toBeCloseTo(-3);
    expect(unigram.maxPieceLength).toBe(4);
  });

  it('unigram modelde en yüksek toplam puanlı bölmeyi seçer', () => {
    // "▁HE"+"Y" (−7) tek parça "▁HEY"den (−9,5) iyidir; "▁JA R VI S" (−19) "▁J A R VI S"den (−24) iyidir.
    expect(encodePieces(unigram, 'hey jarvis', upper)).toEqual(['▁HE', 'Y', '▁JA', 'R', 'VI', 'S']);
    expect(encodePieces(unigram, '  Hey   Jarvis ', upper)).toEqual(['▁HE', 'Y', '▁JA', 'R', 'VI', 'S']);
  });

  it('sözlükte olmayan harf varsa null döner', () => {
    expect(encodePieces(unigram, 'çarvis', upper)).toBeNull();
    expect(encodePieces(unigram, '', upper)).toBeNull();
  });

  it('BPE modelde en yüksek puanlı komşu çifti birleştirir', () => {
    const bpe = parseSentencePieceModel(
      buildModel(
        [
          ['▁', -10],
          ['H', -11],
          ['E', -12],
          ['Y', -13],
          ['▁H', -1],
          ['▁HE', -2],
          ['EY', -3],
        ],
        2,
      ),
    );
    expect(bpe.type).toBe('bpe');
    expect(encodePieces(bpe, 'hey', upper)).toEqual(['▁HE', 'Y']);
  });

  it('parça içermeyen ya da bozuk dosyada açık hata verir', () => {
    expect(() => parseSentencePieceModel(new Uint8Array([]))).toThrow(/parça yok/);
    // Uzunluk alanı dosyadan taşan kayıt.
    expect(() => parseSentencePieceModel(new Uint8Array([0x0a, 0x7f, 0x01]))).toThrow();
  });
});

describe('seslendirilecek metin', () => {
  it('biçim işaretlerini ve emojiyi atar; okunacak şey kalmazsa boş döner', () => {
    expect(speakableText('**Tamam** efendim 👍')).toBe('Tamam efendim');
    expect(speakableText('# Başlık\n- madde')).toBe('Başlık - madde');
    expect(speakableText('…')).toBe('');
    expect(speakableText('👍')).toBe('');
    expect(speakableText('Saat 10:30.')).toBe('Saat 10:30.');
  });
});
