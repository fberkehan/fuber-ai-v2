/**
 * Portions adapted from supertonic 1.3.1 (Copyright (c) 2025 Supertone Inc., MIT License): the text preprocessing
 * (`_SYMBOL_REPLACEMENTS`, `UnicodeProcessor._preprocess_text`) and the inference pipeline, rewritten in TypeScript.
 * See THIRD-PARTY-NOTICES.md for the copyright notice and the license text.
 *
 * Supertonic 3 (Supertone; ONNX, ~99 M parametre, 44,1 kHz, 31 dil, on hazır ses). Resmî Python paketinin
 * (`supertonic` 1.3.1, MIT) çıkarım yolunun TypeScript karşılığı: metin ön işleme → süre kestirimi → metin kodlayıcı →
 * akış eşleme (vektör kestirici, sabit adım sayısı) → ses kodçözücü. Dört ONNX grafiği `onnx/` altındadır.
 *
 * Akış yoktur: bir cümlenin sesi tek parçada çıkar (ekran kartında 60–250 ms). Uzun metin cümlelere bölünür ve her
 * cümle bitince yollanır; kullanıcı ilk cümleyi beklerken ikinci hazırlanır.
 *
 * İfade etiketleri: model etiketi özel bir simge olarak değil harf harf görür. `<throatclear>` Türkçe cümlede bütün
 * seslerde SÖZCÜK olarak okunur ("trokler"); İngilizce cümlede altı seste söz dışı kısa bir ses olur. `<laugh>` kahkaha
 * üretmez, `<sigh>` Türkçe cümlede bozuk duyulur (ölçüm, 16 Kasım 2026). Hangi etiketin geçeceğine burası karar
 * vermez: `worker/speech-tags.ts` › `tagEngineFor` yalnız ölçülmüş ses + dil çiftinde etiketi bırakır.
 *
 * Lisans: ağırlıklar OpenRAIL-M, proje Eylül 2026'da arşivlendi (bkz. `packages/shared/src/local-models.ts`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TtsDevice } from '@fuber/shared';
import { fadeEdges, gaussian, type EngineFactory, type SynthJob } from '../engine';
import type { Session, Tensor } from '../ort';

/**
 * Akış eşleme adım sayısı. Paketin varsayılanı 8'dir; ekran kartında (CUDA) adım başına ≈13 ms tutar. DirectML'de
 * adım ≈85 ms olduğundan 8 adım cümleyi ≈0,8 sn geciktirir; yedek yolda 5 adım kullanılır (anlaşılırlık ölçümü:
 * `scripts/voice/tts-eval.mjs`).
 */
const STEPS: Record<Exclude<TtsDevice, 'cloud'>, number> = { cuda: 8, directml: 5, cpu: 5 };
/**
 * Girdi boyu kovaları (karakter ve gizil kare). Ölçüm (CUDA, cuDNN 9): bir evrişim grafiği daha önce görmediği bir
 * girdi boyuyla çalışınca cuDNN o boy için yöntem arar; dört grafikte toplam ≈150 ms tutar ve her cümlenin boyu
 * farklı olduğundan HER cümlede ödenir. Boylar kovaya yuvarlanınca (dolgu maskelenir; model toplu üretimde zaten
 * böyle çalışır) az sayıda boy kalır ve boyu daha önce görülmüş cümle ≈100 ms'de üretilir (ölçüm: ilk ses ortancası
 * 235 ms → 118 ms). Kalan boylar konak hazır olduktan sonra arka planda gösterilir (`settle`).
 */
const BUCKET = { text: 32, latent: 32 };
/**
 * Arka plan ısınmasının kapsadığı en uzun metin kovası: `MAX_CHARS` karakter + dil imleri, Türkçe harflerin NFKD
 * açılımıyla (ş → s + sedil) ≈1,3 katına çıkar.
 */
const SETTLE_MAX_TEXT = 288;
/** Gizil kare ÷ karakter oranının görülen aralığı (ölçüm: 0,75–1,0; ses ve hıza göre pay bırakıldı). */
const FRAMES_PER_CHAR = { min: 0.6, max: 1.1 };
/** Konuşma hızı çarpanı (paketin varsayılanı; 1'in üstü daha hızlı). */
const SPEED = 1.05;
/** Bir üretimde en çok bu kadar karakter: daha uzunu cümle ve virgül sınırlarından bölünür. */
const MAX_CHARS = 220;
/** Bu kadar kısa cümle bir sonrakiyle birlikte üretilir (tek sözcüklük cümlelerde tonlama bozulmasın). */
const MERGE_BELOW = 24;

const EMOJI = /[\u{1f600}-\u{1f64f}\u{1f300}-\u{1f5ff}\u{1f680}-\u{1f6ff}\u{1f700}-\u{1faff}\u{2600}-\u{27bf}\u{1f1e6}-\u{1f1ff}]+/gu;
/**
 * Simge eşlemeleri (paketin `_SYMBOL_REPLACEMENTS` tablosu). Kod noktasıyla yazılır: uzun çizgi, kesilmez tire ve
 * eğik tırnaklar kaynak dosyada birbirinden ayırt edilemez.
 */
const SYMBOL_TABLE: Array<[codePoint: number, replacement: string]> = [
  [0x2013, '-'], // kısa çizgi
  [0x2011, '-'], // kesilmez tire
  [0x2014, '-'], // uzun çizgi
  [0x00af, ' '], // üst çizgi
  [0x005f, ' '], // alt çizgi
  [0x201c, '"'],
  [0x201d, '"'],
  [0x2018, "'"],
  [0x2019, "'"],
  [0x00b4, "'"], // kesme imi (akut)
  [0x0060, "'"], // ters kesme
  [0x005b, ' '], // [
  [0x005d, ' '], // ]
  [0x007c, ' '], // |
  [0x002f, ' '], // /
  [0x0023, ' '], // #
  [0x2192, ' '], // sağ ok
  [0x2190, ' '], // sol ok
];
const SYMBOLS = new Map(SYMBOL_TABLE.map(([code, replacement]) => [String.fromCodePoint(code), replacement]));
const SYMBOL_PATTERN = new RegExp(`[${SYMBOL_TABLE.map(([code]) => `\\u{${code.toString(16)}}`).join('')}]`, 'gu');
const ENDS_WITH_PUNCTUATION = /[.!?;:,'")\]}…。」』】〉》›»]$/;

/**
 * Paketin `UnicodeProcessor._preprocess_text` adımları, aynı sırayla. Sonuç dil imiyle sarılır (`<tr>…</tr>`).
 * `@` → " at " ve "e.g.," açılımları paketin davranışıdır; Türkçe metinde `@` okuma düzelticide zaten çevrilmiştir.
 */
export function preprocessText(text: string, language: string): string {
  let out = text.normalize('NFKD');
  out = out.replace(EMOJI, '');
  out = out.replace(SYMBOL_PATTERN, (ch) => SYMBOLS.get(ch) ?? ch);
  out = out.replace(/[♥☆♡©\\]/g, '');
  out = out.replaceAll('@', ' at ').replaceAll('e.g.,', 'for example, ').replaceAll('i.e.,', 'that is, ');
  out = out.replace(/ ([,.!?;:'])/g, '$1');
  out = out.replace(/(["'`])\1+/g, '$1');
  out = out.replace(/\s+/g, ' ').trim();
  if (!ENDS_WITH_PUNCTUATION.test(out)) out += '.';
  return `<${language}>${out}</${language}>`;
}

/** Uzun metni üretim parçalarına böler: önce cümle sonlarından, sığmayan cümleyi virgülden, o da yoksa boşluktan. */
export function splitForSynthesis(text: string, max = MAX_CHARS): string[] {
  const sentences = text
    .trim()
    .split(/(?<=[.!?;…])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > max) {
      const head = rest.slice(0, max + 1);
      const comma = Math.max(head.lastIndexOf(', '), head.lastIndexOf(': '));
      const cut = comma > max * 0.4 ? comma + 1 : head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : max;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
  }
  // Çok kısa parça ("Tamam.") bir sonrakiyle birleşir.
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.length < MERGE_BELOW && last.length + piece.length + 1 <= max) merged[merged.length - 1] = `${last} ${piece}`;
    else merged.push(piece);
  }
  return merged;
}

interface StyleFile {
  style_ttl: { dims: number[]; data: unknown };
  style_dp: { dims: number[]; data: unknown };
}

interface Style {
  ttl: Tensor;
  dp: Tensor;
}

const float = (dims: number[], data: Float32Array): Tensor => ({ type: 'float32', dims, data });

/** `value`'yu `step`'in katına yukarı yuvarlar; `step` 0 ise dokunmaz. */
const bucket = (value: number, step: number): number => (step > 0 ? Math.ceil(value / step) * step : value);
/** İlk `real` öğesi 1, kalanı 0 olan maske. */
const mask = (real: number, total: number): Float32Array => {
  const out = new Float32Array(total);
  out.fill(1, 0, real);
  return out;
};

export const createSupertonic: EngineFactory = ({ ort, device, dir, log }) => {
  const steps = STEPS[device === 'cloud' ? 'cpu' : device];
  const textBucket = Number(process.env.FUBER2_TTS_BUCKET_L ?? BUCKET.text);
  const latentBucket = Number(process.env.FUBER2_TTS_BUCKET_T ?? BUCKET.latent);
  let sampleRate = 44_100;
  let baseChunk = 512;
  let compress = 6;
  let latentDim = 24;
  let indexer: number[] = [];
  let sessions: { duration: Session; text: Session; vector: Session; vocoder: Session } | null = null;
  const styles = new Map<string, Style>();
  const noise = gaussian();

  function style(voice: string): Style {
    const cached = styles.get(voice);
    if (cached) return cached;
    // Ses kimliği dosya adına girer: yalnız harf ve rakam (yol kaçışı olmasın).
    if (!/^[A-Za-z0-9]{1,16}$/.test(voice)) throw new Error(`geçersiz ses: ${voice}`);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'voice_styles', `${voice}.json`), 'utf8')) as StyleFile;
    const tensor = (part: StyleFile['style_ttl']): Tensor => float(part.dims, Float32Array.from((part.data as number[][][]).flat(2)));
    const loaded = { ttl: tensor(raw.style_ttl), dp: tensor(raw.style_dp) };
    styles.set(voice, loaded);
    return loaded;
  }

  /** Tek parçayı üretir; iptal edildiyse `null`. */
  async function synthPiece(text: string, voiceStyle: Style, language: string, job: Pick<SynthJob, 'cancelled' | 'breathe'>): Promise<Float32Array | null> {
    if (!sessions) throw new Error('model yüklenmedi');
    const prepared = preprocessText(text, language);
    // Modelin tanımadığı karakter atılır (paket hata verirdi; konuşma ortasında susmak yerine o harf geçilir).
    const ids: bigint[] = [];
    for (const ch of prepared) {
      const index = indexer[ch.codePointAt(0) ?? 0];
      if (index !== undefined && index >= 0) ids.push(BigInt(index));
    }
    if (ids.length === 0) return new Float32Array(0);
    const length = ids.length;
    // Girdi boyları kovalara yuvarlanır (maskeyle doldurulur): bkz. `BUCKET` açıklaması.
    const paddedLength = bucket(length, textBucket);
    const padded = new BigInt64Array(paddedLength);
    padded.set(ids);
    const textIds: Tensor = { type: 'int64', dims: [1, paddedLength], data: padded };
    const textMask = float([1, 1, paddedLength], mask(length, paddedLength));

    const trace = process.env.FUBER2_TTS_TRACE === '1' ? [performance.now()] : null;
    const duration = (sessions.duration.run({ text_ids: textIds, style_dp: voiceStyle.dp, text_mask: textMask })[sessions.duration.outputs[0]!]!.data[0] ?? 0) / SPEED;
    if (!(duration > 0)) return new Float32Array(0);
    trace?.push(performance.now());
    await job.breathe();
    if (job.cancelled()) return null;
    trace?.push(performance.now());

    const embedding = sessions.text.run({ text_ids: textIds, style_ttl: voiceStyle.ttl, text_mask: textMask })[sessions.text.outputs[0]!]!;
    const textEmb = float(embedding.dims, embedding.data);

    const chunk = baseChunk * compress;
    const wavLength = Math.floor(duration * sampleRate);
    const realLatent = Math.max(1, Math.floor((duration * sampleRate + chunk - 1) / chunk));
    const latentLength = bucket(realLatent, latentBucket);
    const channels = latentDim * compress;
    const latentMask = float([1, 1, latentLength], mask(realLatent, latentLength));
    const totalStep = float([1], Float32Array.from([steps]));
    trace?.push(performance.now());
    // Gürültü yalnız gerçek uzunlukta; dolgu sıfırdır (paketin toplu üretimindeki `noisy_latent * latent_mask`).
    const start = noise(channels * realLatent);
    const noisy = new Float32Array(channels * latentLength);
    for (let channel = 0; channel < channels; channel++) noisy.set(start.subarray(channel * realLatent, (channel + 1) * realLatent), channel * latentLength);
    let latent = float([1, channels, latentLength], noisy);
    for (let step = 0; step < steps; step++) {
      await job.breathe();
      if (job.cancelled()) return null;
      const next = sessions.vector.run({
        noisy_latent: latent,
        text_emb: textEmb,
        style_ttl: voiceStyle.ttl,
        latent_mask: latentMask,
        text_mask: textMask,
        current_step: float([1], Float32Array.from([step])),
        total_step: totalStep,
      })[sessions.vector.outputs[0]!]!;
      latent = float(next.dims, next.data);
    }
    trace?.push(performance.now());
    await job.breathe();
    if (job.cancelled()) return null;
    const wav = sessions.vocoder.run({ latent })[sessions.vocoder.outputs[0]!]!.data;
    if (trace) {
      trace.push(performance.now());
      // Aşama süreleri: süre kestirimi, nefes, metin kodlayıcı, akış adımları, kodçözücü (ms).
      log('info', `iz L=${length}→${paddedLength} T=${realLatent}→${latentLength}: ${trace.slice(1).map((at, index) => Math.round(at - trace[index]!)).join(' ')}`);
    }
    return fadeEdges(wav.slice(0, Math.min(wav.length, wavLength)), sampleRate);
  }

  return {
    id: 'supertonic',
    get sampleRate() {
      return sampleRate;
    },

    async load() {
      const onnx = (name: string): string => path.join(dir, 'onnx', name);
      const config = JSON.parse(fs.readFileSync(onnx('tts.json'), 'utf8')) as {
        ae: { sample_rate: number; base_chunk_size: number };
        ttl: { chunk_compress_factor: number; latent_dim: number };
      };
      sampleRate = config.ae.sample_rate;
      baseChunk = config.ae.base_chunk_size;
      compress = config.ttl.chunk_compress_factor;
      latentDim = config.ttl.latent_dim;
      indexer = JSON.parse(fs.readFileSync(onnx('unicode_indexer.json'), 'utf8')) as number[];
      // Küçük grafik önce: ekran kartı açılamıyorsa (CUDA yok) 250 MB'lık dosya okunmadan anlaşılır.
      const duration = ort.createSession(onnx('duration_predictor.onnx'));
      const text = ort.createSession(onnx('text_encoder.onnx'));
      const vector = ort.createSession(onnx('vector_estimator.onnx'));
      const vocoder = ort.createSession(onnx('vocoder.onnx'));
      sessions = { duration, text, vector, vocoder };
      log('info', `Supertonic 3 yüklendi (${device}, ${steps} adım, ${sampleRate} Hz)`);
    },

    async warm(voice) {
      const voiceStyle = style(voice);
      const quiet = { cancelled: () => false, breathe: async () => {} };
      // Kısa, orta ve uzun: sık görülen girdi boyları ekran kartına bir kez gösterilir.
      for (const text of ['Tamam efendim.', 'Bir dakika, hemen bakıyorum.', 'Yarınki toplantı sabah onda başlıyor ve yaklaşık bir saat sürecek.']) {
        await synthPiece(text, voiceStyle, 'tr', quiet);
      }
    },

    /**
     * Kalan girdi boylarını ekran kartına gösterir: her metin kovası için süre kestirici ve metin kodlayıcı, o kovaya
     * denk gelebilecek gizil kovaları için akış adımı (tek adım yeter: yöntem seçimi boya bağlıdır) ve kodçözücü.
     * Yalnız CUDA'da anlamlıdır (boy başına yöntem arayan cuDNN'dir).
     */
    async settle(voice, pause) {
      if (device !== 'cuda' || !sessions || textBucket <= 0 || latentBucket <= 0) return;
      const voiceStyle = style(voice);
      const channels = latentDim * compress;
      const decoded = new Set<number>();
      const started = performance.now();
      let shapes = 0;
      for (let text = textBucket; text <= SETTLE_MAX_TEXT; text += textBucket) {
        if (!(await pause()) || !sessions) return;
        const textIds: Tensor = { type: 'int64', dims: [1, text], data: new BigInt64Array(text) };
        const textMask = float([1, 1, text], mask(text, text));
        sessions.duration.run({ text_ids: textIds, style_dp: voiceStyle.dp, text_mask: textMask });
        if (!(await pause()) || !sessions) return;
        const embedding = sessions.text.run({ text_ids: textIds, style_ttl: voiceStyle.ttl, text_mask: textMask })[sessions.text.outputs[0]!]!;
        const textEmb = float(embedding.dims, embedding.data);
        const from = bucket(Math.max(1, Math.floor(FRAMES_PER_CHAR.min * (text - textBucket + 1))), latentBucket);
        const to = bucket(Math.ceil(FRAMES_PER_CHAR.max * text), latentBucket);
        for (let latent = from; latent <= to; latent += latentBucket) {
          if (!(await pause()) || !sessions) return;
          const noisy = float([1, channels, latent], new Float32Array(channels * latent));
          const next = sessions.vector.run({
            noisy_latent: noisy,
            text_emb: textEmb,
            style_ttl: voiceStyle.ttl,
            latent_mask: float([1, 1, latent], mask(latent, latent)),
            text_mask: textMask,
            current_step: float([1], Float32Array.from([0])),
            total_step: float([1], Float32Array.from([steps])),
          })[sessions.vector.outputs[0]!]!;
          shapes++;
          if (decoded.has(latent)) continue;
          decoded.add(latent);
          if (!(await pause()) || !sessions) return;
          sessions.vocoder.run({ latent: float(next.dims, next.data) });
        }
      }
      log('info', `Supertonic 3: ${shapes} girdi boyu arka planda ısıtıldı (${Math.round(performance.now() - started)} ms)`);
    },

    async synth(job) {
      const voiceStyle = style(job.voice);
      for (const piece of splitForSynthesis(job.text)) {
        if (job.cancelled()) return;
        const samples = await synthPiece(piece, voiceStyle, job.language, job);
        if (samples === null) return;
        if (samples.length > 0) job.emit(samples);
      }
    },

    dispose() {
      if (!sessions) return;
      for (const session of Object.values(sessions)) session.release();
      sessions = null;
      styles.clear();
    },
  };
};
