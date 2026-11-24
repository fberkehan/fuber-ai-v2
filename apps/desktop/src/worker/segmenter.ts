/**
 * Sürekli VAD ve söz bölütleme. Silero (sherpa-onnx) "söz var mı"yı söyler; bölütün sesi buradaki halka
 * tampondan alınır ki biraz ön ve arka payla (ilk hece kırpılmasın) verilebilsin.
 */

import { AUDIO_SAMPLE_RATE } from '@fuber/shared';
import type { Vad, VadConfig } from 'sherpa-onnx-node';
import type { WorkerConfig, WorkerEvent } from './protocol';

const RING_SECONDS = 45;
/**
 * Bölütün başına eklenen pay. VAD'ın bildirdiği başlangıç ilk hecenin biraz içindedir ve Whisper önünde
 * sessizlik olmayan sözün ilk sözcüğünü atabiliyor. Ölçüm (16 Kas 2026, hattan geçmiş on bölüt, "Carvis, …"):
 * 0–60 ms payla baştaki ad 6/10, 120 ms ile 9/10, 200 ms ve üstüyle 10/10 dökümde kaldı.
 */
const PRE_PAD_MS = 300;
const POST_PAD_MS = 150;
/** Kesme anından sonra en az bu kadar söz kalmadıysa bölüt atılır (kalan, yankının son hecesidir). */
const MIN_AFTER_CUT_MS = 200;
const SILERO_WINDOW = 512;

const msToSamples = (ms: number): number => Math.round((ms * AUDIO_SAMPLE_RATE) / 1000);
const samplesToMs = (samples: number): number => Math.round((samples * 1000) / AUDIO_SAMPLE_RATE);

class Ring {
  private readonly data = new Int16Array(RING_SECONDS * AUDIO_SAMPLE_RATE);
  /** Bugüne kadar yazılan toplam örnek; mutlak konumlar bununla ölçülür. */
  total = 0;

  push(frame: Int16Array): void {
    const size = this.data.length;
    let offset = this.total % size;
    for (let i = 0; i < frame.length; i++) {
      this.data[offset] = frame[i] ?? 0;
      offset = offset + 1 === size ? 0 : offset + 1;
    }
    this.total += frame.length;
  }

  /** `[from, to)` mutlak aralığının kopyası; tampondan taşmış kısım kırpılır. */
  slice(from: number, to: number): Int16Array {
    const size = this.data.length;
    const start = Math.max(from, this.total - size, 0);
    const end = Math.min(to, this.total);
    const out = new Int16Array(Math.max(0, end - start));
    for (let i = 0; i < out.length; i++) out[i] = this.data[(start + i) % size] ?? 0;
    return out;
  }
}

export interface SegmenterModule {
  Vad: new (config: VadConfig, bufferSizeInSeconds: number) => Vad;
}

export class Segmenter {
  private readonly vad: Vad;
  private readonly ring = new Ring();
  private readonly float = new Float32Array(SILERO_WINDOW * 4);
  /** VAD'ın örnek sayacının halka tampondaki karşılığı (sıfırlamada kayar). */
  private vadBase = 0;
  private segmentId = 0;
  private inSpeech = false;
  /** `speech_start` bildiriminin yapıldığı örnek konumu. */
  private detectedAt = 0;
  private lastEnd = 0;
  /** Kısa söz izleyici (yalnız `watch` açıkken beslenir). */
  private readonly blipVad: Vad;
  private blipBase = 0;
  private watching = false;
  /** Asıl VAD'ın en son söz bildirdiği örnek konumu: o söze ait kısa parçalar ayrıca bildirilmez. */
  private lastMainActivity = -1;
  /** Bu konumdan önceki ses teslim edilmez (Jarvis'in kendi sesi; `cut`). */
  private cutAt = 0;

  constructor(
    sherpa: SegmenterModule,
    private readonly config: WorkerConfig,
    private readonly emit: (event: WorkerEvent) => void,
  ) {
    this.vad = new sherpa.Vad(
      {
        sileroVad: {
          model: config.vad.model,
          threshold: config.vad.threshold,
          minSpeechDuration: config.vad.minSpeechMs / 1000,
          minSilenceDuration: config.vad.minSilenceMs / 1000,
          windowSize: SILERO_WINDOW,
          maxSpeechDuration: config.vad.maxSpeechSeconds,
        },
        sampleRate: AUDIO_SAMPLE_RATE,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
      RING_SECONDS,
    );
    this.blipVad = new sherpa.Vad(
      {
        sileroVad: {
          model: config.vad.model,
          threshold: config.vad.blip.threshold,
          minSpeechDuration: config.vad.blip.minSpeechMs / 1000,
          minSilenceDuration: config.vad.blip.minSilenceMs / 1000,
          windowSize: SILERO_WINDOW,
          maxSpeechDuration: config.vad.maxSpeechSeconds,
        },
        sampleRate: AUDIO_SAMPLE_RATE,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
      RING_SECONDS,
    );
  }

  /** Kısa söz izleyiciyi açar/kapatır; açılırken temiz durumla başlar. */
  setWatch(on: boolean): void {
    if (on === this.watching) return;
    this.watching = on;
    if (on) {
      this.blipVad.reset();
      this.blipBase = this.ring.total;
    }
  }

  /** Şu an söz var mı (VAD söz bildirdi ve bölüt henüz kapanmadı). */
  get active(): boolean {
    return this.inSpeech || this.vad.isDetected();
  }

  /** Dinleme kapanıp açıldığında yarım kalan söz ve VAD durumu atılır. */
  reset(): void {
    this.vad.reset();
    this.vadBase = this.ring.total;
    this.inSpeech = false;
    this.lastEnd = this.ring.total;
    this.blipVad.reset();
    this.blipBase = this.ring.total;
  }

  /**
   * Bu andan önceki ses artık teslim edilmez (Jarvis'in kendi sesi). VAD'a dokunulmaz: o sırada başlamış bir kullanıcı
   * sözü bölünmeden sürer; bölüt bittiğinde yalnız bu andan sonraki kısmı verilir.
   */
  cut(): void {
    this.cutAt = this.ring.total;
    this.lastEnd = Math.max(this.lastEnd, this.cutAt);
  }

  accept(frame: Int16Array): void {
    this.ring.push(frame);
    const float = frame.length <= this.float.length ? this.float.subarray(0, frame.length) : new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) float[i] = (frame[i] ?? 0) / 32768;
    this.vad.acceptWaveform(float);

    const now = this.ring.total;
    if (this.watching) this.acceptBlip(float, now);
    if (this.inSpeech || this.vad.isDetected()) this.lastMainActivity = now;
    if (!this.inSpeech && this.vad.isDetected()) {
      this.inSpeech = true;
      this.segmentId++;
      this.detectedAt = now;
      // Gerçek başlangıç bölüt bitince VAD'dan öğrenilir; burada algı gecikmesi kadar geride olduğu varsayılır.
      const lag = msToSamples(this.config.vad.minSpeechMs) + SILERO_WINDOW * 2;
      this.emit({ type: 'speech_start', segmentId: this.segmentId, onsetAgoMs: samplesToMs(lag) });
    }

    while (!this.vad.isEmpty()) {
      const segment = this.vad.front(false);
      this.vad.pop();
      const start = this.vadBase + segment.start;
      const end = start + segment.samples.length;
      // Kesme anından sonra söz kalmadıysa bölüt Jarvis'in kendi sesidir: verilmez.
      const cutAway = start < this.cutAt && end - this.cutAt < msToSamples(MIN_AFTER_CUT_MS);
      if (!this.inSpeech && !cutAway) {
        // Algı kenarı görülmeden tamamlanan kısa bölüt: olay sırası bozulmasın diye başlangıcı da bildirilir.
        this.segmentId++;
        this.detectedAt = now;
        this.emit({ type: 'speech_start', segmentId: this.segmentId, onsetAgoMs: samplesToMs(now - start) });
      }
      if (cutAway) {
        if (this.inSpeech) this.emit({ type: 'speech_cut', segmentId: this.segmentId });
      } else {
        const from = Math.max(start, this.cutAt);
        this.emit({
          type: 'speech_end',
          segmentId: this.segmentId,
          pcm: this.ring.slice(Math.max(this.lastEnd, from - msToSamples(PRE_PAD_MS)), end + msToSamples(POST_PAD_MS)),
          durationMs: samplesToMs(end - from),
          confirmLagMs: samplesToMs(Math.max(0, this.detectedAt - start)),
        });
      }
      this.inSpeech = false;
      this.lastEnd = Math.min(end, now);
      this.lastMainActivity = now;
    }
  }

  /**
   * Kısa söz izleyici: asıl VAD'ın (en az 250 ms kesintisiz söz ister) kaçırdığı kısa sesleri bildirir.
   * Asıl VAD aynı sesi söz saydıysa (şu an söz içinde ya da az önce bölüt verdi) parça ayrıca bildirilmez.
   */
  private acceptBlip(float: Float32Array, now: number): void {
    this.blipVad.acceptWaveform(float);
    while (!this.blipVad.isEmpty()) {
      const segment = this.blipVad.front(false);
      this.blipVad.pop();
      const start = this.blipBase + segment.start;
      const end = start + segment.samples.length;
      const durationMs = samplesToMs(segment.samples.length);
      if (durationMs > this.config.vad.blip.maxMs) continue;
      if (this.inSpeech || this.vad.isDetected() || this.lastMainActivity >= start) continue;
      this.emit({
        type: 'speech_blip',
        pcm: this.ring.slice(start - msToSamples(PRE_PAD_MS), Math.min(now, end + msToSamples(POST_PAD_MS))),
        durationMs,
      });
    }
  }
}
