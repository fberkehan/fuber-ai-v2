/**
 * Seslendirme motorlarının kataloğu: kimlik, nerede çalıştığı, sesleri ve gereken yerel model kayıtları.
 * Politika (`Policy.voice.tts`), cihaz ayarı (`Settings.ttsEngine`), ses işçisi, ses konağı, Ayarlar › Ses ve Fuber
 * Yönetim aynı listeyi okur; motor adı ya da ses listesi başka hiçbir yerde yinelenmez.
 *
 * YENİ MOTOR EKLEMEK (ONNX ile çalışan yerel motor):
 *   1. Bu dosyada `TTS_ENGINE_IDS`'e kimlik ve `TTS_ENGINES`'e bir kayıt (sesler, cihaz sırası, model kimlikleri).
 *   2. `local-models.ts`'te modelin dosyaları (adres, SHA-256, boyut).
 *   3. `apps/desktop/src/tts-host/engines/<ad>.ts`: `HostEngine` arayüzünü uygulayan TEK dosya; `engines/index.ts`
 *      kayıt tablosuna bir satır.
 *   4. `i18n/tr/tts.ts`'te motorun ve seslerinin adları.
 * Ses işçisi, düşüş zinciri, Ayarlar ve Yönetim listeleri katalogdan kendiliğinden dolar.
 */

import type { MessageKey } from './i18n/index';

export const TTS_ENGINE_IDS = ['supertonic', 'ema-lightning', 'piper-local', 'elevenlabs'] as const;
export type TtsEngineId = (typeof TTS_ENGINE_IDS)[number];

/** Sesin üretildiği yer. `cuda` ve `directml` ekran kartıdır; `cpu` işlemci; `cloud` başka bir bilgisayar. */
export type TtsDevice = 'cuda' | 'directml' | 'cpu' | 'cloud';

/** Ses konağında (ayrı süreç, ONNX Runtime) koşan motorlar. */
export const TTS_HOST_ENGINE_IDS = ['supertonic', 'ema-lightning'] as const;
export type TtsHostEngineId = (typeof TTS_HOST_ENGINE_IDS)[number];

export interface TtsVoiceInfo {
  /** Motorun kendi ses kimliği (`M4`). */
  id: string;
  /** Kullanıcıya gösterilen ad ("Erkek 4 · tok"). */
  label: MessageKey;
}

export interface TtsEngineInfo {
  id: TtsEngineId;
  /**
   * `host`: ses konağında ONNX Runtime ile (ekran kartı) · `piper`: ses işçisinin alt süreci (işlemci) ·
   * `cloud`: internet üzerinden.
   */
  kind: 'host' | 'piper' | 'cloud';
  label: MessageKey;
  /** Seçim listesindeki kısa açıklama ("yerel, ekran kartı"). */
  hint: MessageKey;
  /** Sırayla denenen cihazlar; ilk çalışan kullanılır (düşüş zinciri). */
  devices: readonly TtsDevice[];
  /** Hazır sesler; boşsa motorun tek sesi vardır ya da ses başka yerden seçilir (ElevenLabs: Fuber Yönetim). */
  voices: readonly TtsVoiceInfo[];
  defaultVoice: string | null;
  /** Motorun kendi modeli (`Policy.localModels` kimliği); çalışma zamanı ayrıca `TTS_RUNTIME_MODELS`'ten gelir. */
  model: string | null;
}

const supertonicVoice = (id: string): TtsVoiceInfo => ({ id, label: `tts.voice.supertonic.${id}` as MessageKey });

/** Supertonic 3'ün on hazır sesi. Sıra: ölçümde bugünkü sese (ElevenLabs Daniel) en yakın olanlar önde. */
export const SUPERTONIC_VOICES: readonly TtsVoiceInfo[] = ['M4', 'M5', 'M2', 'M1', 'M3', 'F1', 'F2', 'F3', 'F4', 'F5'].map(supertonicVoice);

export const DEFAULT_TTS_ENGINE: TtsEngineId = 'supertonic';
export const DEFAULT_SUPERTONIC_VOICE = 'M4';

/** Yerel model kayıtlarının kimlikleri (`local-models.ts` ile aynı; sürüm değişince ikisi birlikte değişir). */
export const TTS_MODEL_IDS = {
  supertonic: 'supertonic-3-onnx',
  ema: 'ema-lightning-onnx-1.0',
  runtimeCuda: 'onnxruntime-1.32.0-cuda13',
  runtimeDirectml: 'onnxruntime-1.24.4-directml',
} as const;

/** Cihaz başına ONNX çalışma zamanı kaydı. İşlemci, eldeki çalışma zamanlarından biriyle koşar (ayrı indirme yok). */
export const TTS_RUNTIME_MODELS: Record<Exclude<TtsDevice, 'cloud' | 'cpu'>, string> = {
  cuda: TTS_MODEL_IDS.runtimeCuda,
  directml: TTS_MODEL_IDS.runtimeDirectml,
};

export const TTS_ENGINES: Record<TtsEngineId, TtsEngineInfo> = {
  supertonic: {
    id: 'supertonic',
    kind: 'host',
    label: 'tts.engine.supertonic',
    hint: 'tts.engine.supertonic.hint',
    devices: ['cuda', 'directml'],
    voices: SUPERTONIC_VOICES,
    defaultVoice: DEFAULT_SUPERTONIC_VOICE,
    model: TTS_MODEL_IDS.supertonic,
  },
  'ema-lightning': {
    id: 'ema-lightning',
    kind: 'host',
    label: 'tts.engine.ema-lightning',
    hint: 'tts.engine.ema-lightning.hint',
    // 8,6 M parametre: işlemcide de gerçek zamanın çok altında (ölçüm: ilk ses ≈100 ms).
    devices: ['cuda', 'directml', 'cpu'],
    voices: [{ id: 'ema', label: 'tts.voice.ema-lightning.ema' }],
    defaultVoice: 'ema',
    model: TTS_MODEL_IDS.ema,
  },
  'piper-local': {
    id: 'piper-local',
    kind: 'piper',
    label: 'tts.engine.piper-local',
    hint: 'tts.engine.piper-local.hint',
    devices: ['cpu'],
    voices: [{ id: 'dfki', label: 'tts.voice.piper-local.dfki' }],
    defaultVoice: 'dfki',
    model: null,
  },
  elevenlabs: {
    id: 'elevenlabs',
    kind: 'cloud',
    label: 'tts.engine.elevenlabs',
    hint: 'tts.engine.elevenlabs.hint',
    devices: ['cloud'],
    voices: [],
    defaultVoice: null,
    model: null,
  },
};

export const isTtsEngineId = (value: unknown): value is TtsEngineId =>
  typeof value === 'string' && (TTS_ENGINE_IDS as readonly string[]).includes(value);

export const isTtsHostEngine = (id: TtsEngineId): id is TtsHostEngineId => TTS_ENGINES[id].kind === 'host';

/** Motorda geçerli ses kimliği: istenen ses motorun listesindeyse o, değilse motorun varsayılanı. */
export function resolveTtsVoice(engine: TtsEngineId, wanted: string | null | undefined): string | null {
  const info = TTS_ENGINES[engine];
  if (info.voices.length === 0) return wanted?.trim() || info.defaultVoice;
  return info.voices.some((voice) => voice.id === wanted) ? (wanted as string) : info.defaultVoice;
}

/** Cihaz ekran kartı mı ("sesim ekran kartında üretiliyor" yalnız bunlarda doğrudur). */
export const isGpuDevice = (device: TtsDevice | null | undefined): boolean => device === 'cuda' || device === 'directml';
