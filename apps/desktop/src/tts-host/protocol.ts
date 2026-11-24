/**
 * Ses konağının ileti sözleşmeleri. Yalnız tip içerir; ana süreç (`main/voice/tts-host.ts`), ses işçisi
 * (`worker/host-synth.ts`) ve konağın kendisi aynı dosyayı kullanır.
 *
 * Ses konağı, ekran kartında çalışan seslendirme motorlarının (Supertonic 3, EMA Lightning) ayrı sürecidir
 * (`utilityProcess`). Ayrı olmasının iki nedeni: (1) ses işçisi sherpa-onnx'in kendi ONNX Runtime'ını taşır, aynı
 * süreçte ikinci bir `onnxruntime.dll` yüklenemez; (2) ekran kartı sürücüsünde olan bir çökme mikrofonu, VAD'ı ve
 * uyandırma sezicisini düşürmez. Süreç başına TEK cihaz vardır (CUDA, DirectML ya da işlemci): cihaz değişecekse
 * konak yeniden başlatılır.
 *
 * İki yol:
 * 1. Ana süreç ↔ konak: `TtsHostCommand` / `TtsHostEvent` (yaşam döngüsü, motor seçimi, durum).
 * 2. Ses işçisi ↔ konak: MessagePort üzerinden `SynthRequest` / `SynthReply` (metin gider, ses örnekleri gelir).
 *    Sınamada ve ölçüm betiklerinde port yoktur: aynı iletiler ana kanaldan gider gelir.
 */

import type { TtsDevice, TtsHostEngineId } from '@fuber/shared';

export interface TtsHostConfig {
  device: TtsDevice;
  /** `onnxruntime.dll` klasörü (mutlak yol). */
  runtimeDir: string;
  /** Motor başına model klasörü (mutlak yol); dosyaları hazır olmayan motor burada yer almaz. */
  engines: Partial<Record<TtsHostEngineId, { dir: string }>>;
  /** Açılışta yüklenip ısıtılacak motor ve ses. */
  primary: { engine: TtsHostEngineId; voice: string };
  /** Cümleler arasına eklenen sessizlik (sn). */
  sentenceSilence: number;
  /** Yalnız sınamada: listedeki cihaz açılamamış gibi davranılır (düşüş zinciri sınanır). */
  failDevices?: TtsDevice[];
}

export type TtsHostCommand =
  /** İlk ileti. Electron'da ses işçisine giden port bu iletiyle birlikte teslim edilir. */
  | { type: 'init'; config: TtsHostConfig }
  /** Ses işçisi yeniden başladı: yeni port bu iletiyle gelir. */
  | { type: 'port' }
  /** Başka bir motoru / sesi yükle ve ısıt; yüklü öteki motorlar bırakılır (ekran belleği boşalır). */
  | { type: 'select'; engine: TtsHostEngineId; voice: string }
  /**
   * Motorların model klasörleri değişti (dosyalar konak başladıktan SONRA hazır oldu: indirme bitti, açılışta
   * yerleştirme yarışı). Verilen kayıtlar `config.engines` ile birleştirilir; `null` kaydı siler.
   */
  | { type: 'engines'; engines: Partial<Record<TtsHostEngineId, { dir: string } | null>> }
  | { type: 'shutdown' }
  | SynthRequest;

export type SynthRequest =
  /**
   * Cümleyi seslendir. Metin seslendirmeye hazırdır (işaretler ayıklanmış, sayılar okunuşa çevrilmiş). İstenen motor
   * yüklü değilse o an yüklenir ("Dinle" başka bir motoru çalabilir).
   */
  | { type: 'speak'; id: number; engine: TtsHostEngineId; voice: string; text: string; language: 'tr' | 'en' }
  /** Bekleyen ve süren bütün işleri at. */
  | { type: 'cancel' };

export type SynthReply =
  | { type: 'chunk'; id: number; pcm: Int16Array; sampleRate: number }
  | { type: 'done'; id: number; samples: number; firstChunkMs: number | null; cancelled: boolean }
  /**
   * `engine: true`: hata MOTORA özgüdür (model dosyaları yok, model yüklenemedi); konak sağlamdır ve öteki
   * motorla konuşmayı sürdürür. Yoksa üretim sırasında oluşmuş bir hatadır.
   */
  | { type: 'error'; id: number; message: string; engine?: boolean };

export type TtsHostEvent =
  /** Süreç ayağa kalktı; ana süreç `init`'i bunun üzerine yollar. */
  | { type: 'hello' }
  /** Çalışma zamanı yüklendi, birincil motor ekran kartında (ya da işlemcide) ısındı. */
  | {
      type: 'ready';
      engine: TtsHostEngineId;
      voice: string;
      device: TtsDevice;
      /** ONNX Runtime sürümü. */
      runtime: string;
      sampleRate: number;
      /** Kitaplık + modellerin yüklenmesi (ms) ve ısınma cümleleri (ms). */
      loadMs: number;
      warmMs: number;
    }
  /** `select` tamamlandı. */
  | { type: 'selected'; engine: TtsHostEngineId; voice: string; sampleRate: number; loadMs: number; warmMs: number }
  /**
   * Açılış başarısız: bu cihazla çalışılamıyor (kitaplık yüklenemedi, CUDA açılamadı, model okunamadı). Ana süreç
   * zincirdeki sıradaki cihazla yeni bir konak başlatır. `message` Türkçe ve kısa bir nedendir.
   */
  | { type: 'failed'; stage: 'runtime' | 'model' | 'warmup' | 'select'; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | SynthReply;
