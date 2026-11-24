/**
 * Ses konağındaki motorların ortak arayüzü. YENİ MOTOR = bu arayüzü uygulayan TEK dosya (`engines/<ad>.ts`) +
 * `engines/index.ts` tablosuna bir satır (ve `@fuber/shared` kataloğuna kayıt; bkz. `tts-engines.ts`).
 *
 * Motor yalnız şunu bilir: model klasörü, ONNX oturumu açma, metinden ses üretme. Süreç yönetimi, sıra, iptal,
 * ses işçisiyle konuşma ve cihaz seçimi konağın işidir (`index.ts`).
 */

import type { TtsDevice, TtsHostEngineId } from '@fuber/shared';
import type { Ort } from './ort';

export interface EngineContext {
  ort: Ort;
  device: TtsDevice;
  /** Modelin klasörü (mutlak yol). */
  dir: string;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface SynthJob {
  /** Seslendirmeye hazır metin (tek cümle ya da kısa paragraf). */
  text: string;
  voice: string;
  language: 'tr' | 'en';
  /** İş iptal edildi mi; motor her adımdan önce bakar ve iptal edildiyse sessizce döner. */
  cancelled(): boolean;
  /** Olay döngüsüne nefes verir (iptal iletisi işlensin); uzun hesap adımları arasında çağrılır. */
  breathe(): Promise<void>;
  /** Üretilen ses parçası (−1…1, motorun örnekleme hızında). Sırayla çağrılır. */
  emit(samples: Float32Array): void;
}

export interface HostEngine {
  readonly id: TtsHostEngineId;
  /** Çıkışın örnekleme hızı (Hz); `load()` sonrasında geçerlidir. */
  readonly sampleRate: number;
  /** Modelleri yükler (oturumları açar). Hata fırlatırsa motor bu cihazda kullanılamaz. */
  load(): Promise<void>;
  /**
   * Isınma: ilk gerçek cümle beklemesin diye birkaç deneme cümlesi üretilir (ses atılır). Ekran kartında her yeni
   * girdi boyu ilk kez görüldüğünde bir kereliğine daha yavaştır; ısınma sık görülen boyları önceden gösterir.
   */
  warm(voice: string): Promise<void>;
  synth(job: SynthJob): Promise<void>;
  /**
   * Isınmanın devamı (isteğe bağlı): `ready` bildirildikten SONRA, sıra boşken küçük adımlarla koşar. Her adımdan
   * önce `pause()` beklenir: sırada bekleyen cümleler öne geçer; `false` dönerse (motor bırakıldı) iş kesilir.
   * Bir adım en çok ~0,1 sn sürmelidir (o sırada gelen cümle o kadar bekler).
   */
  settle?(voice: string, pause: () => Promise<boolean>): Promise<void>;
  /** Oturumları bırakır (ekran belleği boşalır). */
  dispose(): void;
}

export type EngineFactory = (context: EngineContext) => HostEngine;

/** Ortalaması 0, sapması 1 olan rastgele sayılar (Box–Muller). `seed` verilirse yinelenebilir (sınama). */
export function gaussian(seed?: number): (count: number) => Float32Array {
  let state = (seed ?? Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;
  const uniform = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return (count) => {
    const values = new Float32Array(count);
    for (let i = 0; i < count; i += 2) {
      const radius = Math.sqrt(-2 * Math.log(1 - uniform()));
      const angle = 2 * Math.PI * uniform();
      values[i] = radius * Math.cos(angle);
      if (i + 1 < count) values[i + 1] = radius * Math.sin(angle);
    }
    return values;
  };
}

/** Parçanın başına ve sonuna kısa yumuşatma (tıkırtı olmasın). Yerinde değiştirir. */
export function fadeEdges(samples: Float32Array, sampleRate: number, ms = 4): Float32Array {
  const n = Math.min(Math.floor((sampleRate * ms) / 1000), Math.floor(samples.length / 2));
  for (let i = 0; i < n; i++) {
    const gain = i / n;
    samples[i] = (samples[i] ?? 0) * gain;
    samples[samples.length - 1 - i] = (samples[samples.length - 1 - i] ?? 0) * gain;
  }
  return samples;
}
