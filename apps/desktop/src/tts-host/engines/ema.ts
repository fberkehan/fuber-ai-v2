/**
 * TypeScript port of the ema-lightning Python package (`frontend.py`, `chunker.py`, `engine.py`;
 * https://github.com/canberk7/ema-lightning) and of `web/tts.js` from ozcancelik/ema-lightning-onnx, both licensed under
 * the Apache License 2.0. Modified: rewritten in TypeScript for ONNX Runtime in this project, and number and time reading
 * (done by normalizer-tr upstream) is left to the voice worker. See THIRD-PARTY-NOTICES.md and LICENSES/Apache-2.0.txt.
 *
 * EMA Lightning (canberkkkkkk; Apache-2.0; 8,6 M parametre, 48 kHz, tek Türkçe ses). Özgün model PyTorch'tur; burada
 * ONNX dönüşümü (`ozcancelik/ema-lightning-onnx`, Apache-2.0) kullanılır: üç grafik (`text`, `sound`, `decoder`) ve
 * `meta.json` (sözlük, adım zamanları). Grafikler yalnız ağı taşır; aradaki hesap (sözcük başına kare planı, harf ve
 * kare konumları, pencereli kodçözme) burada yapılır. Bu dosya özgün paketin `frontend.py`, `chunker.py`, `engine.py`
 * dosyalarının ve dönüşüm deposundaki başvuru uygulamasının (`web/tts.js`) TypeScript karşılığıdır.
 *
 * Akışlıdır: ilk pencere bir saniyelik sestir (ilk ses erken gelsin), sonrakiler dörder saniye.
 *
 * Metin: özgün paket sayıları ve saatleri `normalizer-tr` ile okunuşa çevirir. Burada o iş ses işçisinin okuma
 * düzelticisinde (`worker/tr-speech.ts`) zaten yapılmıştır; motor yalnız kendi alfabesine indirger (küçük harf,
 * Türkçe harfler dışındaki imler atılır, sözlükte olmayan karakter boşluk olur). İfade etiketi desteklemez.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gaussian, type EngineFactory, type SynthJob } from '../engine';
import type { Session, Tensor } from '../ort';

const RATE = 48_000;
/** İlk kodçözme penceresi (kare; 25 kare = 1 sn) ve sonrakiler. */
const FIRST_WINDOW = 25;
const WINDOW = 100;
/** Pencerenin iki yanında kodçözücüye verilen bağlam (kare). */
const CONTEXT = 8;
const MAX_WORD_FRAMES = 250;
const MAX_FRAMES = 3000;

const LETTERS_PER_SECOND = 18;
const MAX_SECONDS = 10;
const MAX_LETTERS = 250;
const SENTENCE_PAUSE = 0.25;
const CLAUSE_PAUSE = 0.12;

const TURKISH = new Set('çğıöşüÇĞİÖŞÜ');
/** Tipografik imler → düz karşılıkları (`frontend.py` › `TYPOGRAPHY`). Kod noktasıyla: eğik tırnaklar ve çizgiler kaynakta ayırt edilemez. */
const TYPOGRAPHY_TABLE: Array<[codePoint: number, replacement: string]> = [
  [0x2019, "'"],
  [0x2018, "'"],
  [0x02bc, "'"],
  [0x00b4, "'"],
  [0x0060, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x201e, '"'],
  [0x00ab, '"'],
  [0x00bb, '"'],
  [0x2013, '-'],
  [0x2014, '-'],
  [0x2212, '-'],
  [0x2026, '...'],
];
const TYPOGRAPHY = new Map(TYPOGRAPHY_TABLE.map(([code, replacement]) => [String.fromCodePoint(code), replacement]));
/** Denetim ve yön imleri (`frontend.py` › `UNSAFE`): boşluğa çevrilir. Aralıklar kod noktasıyla. */
const UNSAFE_RANGES: Array<[from: number, to: number]> = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
const hex = (code: number): string => `\\u${code.toString(16).padStart(4, '0')}`;
const UNSAFE = new RegExp(`[${UNSAFE_RANGES.map(([from, to]) => (from === to ? hex(from) : `${hex(from)}-${hex(to)}`)).join('')}]`, 'g');

/** Metni modelin alfabesine indirger (`frontend.py` › `alphabet`). */
export function toAlphabet(text: string, vocab: ReadonlySet<string>): string {
  let out = '';
  const lowered = [...text.replace(UNSAFE, ' ')]
    .map((ch) => TYPOGRAPHY.get(ch) ?? ch)
    .join('')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLocaleLowerCase('tr');
  for (let ch of lowered) {
    if (!TURKISH.has(ch)) ch = ch.normalize('NFKD').replace(/\p{M}/gu, '');
    out += ch && [...ch].every((part) => vocab.has(part)) ? ch : ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

const finish = (piece: string): string => (/[.!?]$/.test(piece.replace(/["')]+$/, '')) ? piece : `${piece.replace(/[,;:\- ]+$/, '')}.`);

/**
 * Metni modelin tek geçişte okuyabileceği parçalara böler (`chunker.py`): yaklaşık on saniyeye sığan metin tek
 * parçadır; uzunu cümle sonundan, yoksa virgülden, o da yoksa boşluktan kesilir. Dönen çiftler: parça ve ardından
 * gelecek sessizlik (sn).
 */
export function chunkText(text: string, speed = 1): Array<[piece: string, pause: number]> {
  const limit = Math.floor(Math.min(MAX_LETTERS, LETTERS_PER_SECOND * MAX_SECONDS * speed));
  const cuts: Array<[RegExp, number]> = [
    [/[.!?]+["')]*(?= )/g, SENTENCE_PAUSE],
    [/[,;:](?= )/g, CLAUSE_PAUSE],
    [/\S(?= )/g, CLAUSE_PAUSE],
  ];
  const pieces: Array<[string, number]> = [];
  let rest = text.trim();
  while (rest) {
    let cut = rest.length;
    let pause = 0;
    if (rest.length > limit) {
      cut = limit;
      const head = rest.slice(0, limit + 1);
      for (const [pattern, gap] of cuts) {
        const ends = [...head.matchAll(pattern)].map((match) => (match.index ?? 0) + match[0].length);
        if (ends.length > 0) {
          cut = ends[ends.length - 1]!;
          pause = gap;
          break;
        }
      }
    }
    const piece = rest.slice(0, cut).trim();
    rest = rest.slice(cut).trim();
    if (/\p{L}/u.test(piece)) pieces.push([finish(piece), pause]);
  }
  const last = pieces[pieces.length - 1];
  if (last) last[1] = 0;
  return pieces;
}

/** Her harfin sözcük sırası ve o sözcüğün ilk harfi (boşluk bir sonraki sözcüğe aittir). */
function wordsOf(text: string): { cw: number[]; wstart: number[] } {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] !== ' ' && (i === 0 || text[i - 1] === ' ')) starts.push(i);
  if (starts.length === 0) starts.push(0);
  const bounds = [0, ...starts.slice(1), text.length];
  const cw: number[] = [];
  const wstart: number[] = [];
  for (let word = 0; word + 1 < bounds.length; word++) {
    for (let i = bounds[word]!; i < bounds[word + 1]!; i++) {
      cw.push(word);
      wstart.push(bounds[word]!);
    }
  }
  return { cw, wstart };
}

/**
 * Kare planı (`engine.py` › `plan` ve `model.py` › `sound_stage` başı): harf sürelerinden sözcük başına kare sayısı,
 * her karenin sözcüğü (`fw`) ve harflerle karelerin "harf cinsinden" konumları (`cg`, `fg`).
 */
export function planFrames(cw: number[], wstart: number[], durations: ArrayLike<number>, speed = 1): { frames: number; fw: Int32Array; cg: Float32Array; fg: Float32Array } {
  const letters = cw.length;
  const wordCount = (cw[letters - 1] ?? 0) + 1;
  const d = Float32Array.from({ length: letters }, (_, i) => (durations[i] ?? 0) / speed);
  const sums = new Float64Array(wordCount);
  for (let i = 0; i < letters; i++) sums[cw[i]!]! += d[i]!;
  const counts = Array.from(sums, (sum) => Math.min(MAX_WORD_FRAMES, Math.max(1, Math.round(sum))));
  const frames = Math.min(counts.reduce((a, b) => a + b, 0), MAX_FRAMES);
  const fw = new Int32Array(frames);
  const fp = new Float32Array(frames);
  for (let word = 0, frame = 0; word < wordCount; word++) {
    for (let j = 0; j < counts[word]! && frame < frames; j++, frame++) {
      fw[frame] = word;
      fp[frame] = j / counts[word]!;
    }
  }
  const c = Float32Array.from(d, (value) => Math.max(value, 1e-4));
  const done = new Float32Array(letters);
  const total = new Float32Array(wordCount);
  for (let i = 0, acc = 0; i < letters; i++) {
    acc += c[i]!;
    done[i] = acc;
    total[cw[i]!]! += c[i]!;
  }
  const before = (i: number): number => done[i]! - c[i]!;
  const wlen = new Float32Array(wordCount);
  for (const word of cw) wlen[word]! += 1;
  const woff = new Float32Array(wordCount);
  for (let word = 1; word < wordCount; word++) woff[word] = woff[word - 1]! + Math.max(wlen[word - 1]!, 1);
  const cg = new Float32Array(letters);
  const fg = new Float32Array(frames);
  for (let i = 0; i < letters; i++) {
    const cp = Math.min(1, Math.max(0, (done[i]! - before(wstart[i]!) - 0.5 * c[i]!) / Math.max(total[cw[i]!]!, 1e-8)));
    cg[i] = woff[cw[i]!]! + cp * Math.max(wlen[cw[i]!]!, 1);
  }
  for (let frame = 0; frame < frames; frame++) fg[frame] = woff[fw[frame]!]! + fp[frame]! * Math.max(wlen[fw[frame]!]!, 1);
  return { frames, fw, cg, fg };
}

function windowsOf(frames: number, first: number): Array<[start: number, end: number]> {
  const spans: Array<[number, number]> = [];
  for (let start = 0; start < frames; ) {
    const end = Math.min(frames, start + (start === 0 ? first : WINDOW));
    spans.push([start, end]);
    start = end;
  }
  return spans;
}

const int64 = (values: ArrayLike<number>): Tensor => ({ type: 'int64', dims: [1, values.length], data: BigInt64Array.from(values as ArrayLike<number>, (value) => BigInt(value)) });
const float = (dims: number[], data: Float32Array): Tensor => ({ type: 'float32', dims, data });

export const createEma: EngineFactory = ({ ort, device, dir, log }) => {
  let sessions: { text: Session; sound: Session; decoder: Session } | null = null;
  let vocab: Map<string, number> = new Map();
  let alphabet: Set<string> = new Set();
  let steps = 4;
  let latentDim = 64;
  let hop = 1920;
  let sampleRate = RATE;
  const noise = gaussian();

  async function synthText(text: string, job: Pick<SynthJob, 'cancelled' | 'breathe' | 'emit'>): Promise<void> {
    if (!sessions) throw new Error('model yüklenmedi');
    const pieces = chunkText(toAlphabet(text, alphabet));
    for (const [index, [piece, pause]] of pieces.entries()) {
      if (job.cancelled()) return;
      const ids = [...piece].map((ch) => vocab.get(ch) ?? 1);
      const { cw, wstart } = wordsOf(piece);
      const textOut = sessions.text.run({ ids: int64(ids) });
      const plan = planFrames(cw, wstart, textOut.dur!.data);
      await job.breathe();
      if (job.cancelled()) return;
      const latents = sessions.sound.run({
        h: float(textOut.h!.dims, textOut.h!.data),
        cg: float([1, plan.cg.length], plan.cg),
        fg: float([1, plan.frames], plan.fg),
        cw: int64(cw),
        fw: int64(plan.fw),
        noise: float([1, steps, plan.frames, latentDim], noise(steps * plan.frames * latentDim)),
      }).latents!.data;
      for (const [start, end] of windowsOf(plan.frames, index === 0 ? FIRST_WINDOW : WINDOW)) {
        await job.breathe();
        if (job.cancelled()) return;
        const from = Math.max(0, start - CONTEXT);
        const to = Math.min(plan.frames, end + CONTEXT);
        const count = to - from;
        // [kare, boyut] → [1, boyut, kare]
        const z = new Float32Array(latentDim * count);
        for (let frame = 0; frame < count; frame++) for (let dim = 0; dim < latentDim; dim++) z[dim * count + frame] = latents[(from + frame) * latentDim + dim] ?? 0;
        const audio = sessions.decoder.run({ z: float([1, latentDim, count], z) }).audio!.data;
        job.emit(audio.slice((start - from) * hop, (end - from) * hop));
      }
      if (pause > 0) job.emit(new Float32Array(Math.round(pause * sampleRate)));
    }
  }

  return {
    id: 'ema-lightning',
    get sampleRate() {
      return sampleRate;
    },

    async load() {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { vocab: string[]; times: number[]; latent_dim: number; hop: number; sample_rate: number };
      vocab = new Map(meta.vocab.map((ch, index) => [ch, index]));
      alphabet = new Set(meta.vocab.filter((ch) => ch.length === 1));
      steps = meta.times.length;
      latentDim = meta.latent_dim;
      hop = meta.hop;
      sampleRate = meta.sample_rate;
      sessions = {
        text: ort.createSession(path.join(dir, 'text.onnx')),
        sound: ort.createSession(path.join(dir, 'sound.onnx')),
        decoder: ort.createSession(path.join(dir, 'decoder.onnx')),
      };
      log('info', `EMA Lightning yüklendi (${device}, ${sampleRate} Hz)`);
    },

    async warm() {
      const quiet = { cancelled: () => false, breathe: async () => {}, emit: () => {} };
      for (const text of ['Tamam efendim.', 'Bir dakika, hemen bakıyorum.', 'Yarınki toplantı sabah onda başlıyor ve yaklaşık bir saat sürecek.']) await synthText(text, quiet);
    },

    synth: (job) => synthText(job.text, job),

    dispose() {
      if (!sessions) return;
      for (const session of Object.values(sessions)) session.release();
      sessions = null;
    },
  };
};
