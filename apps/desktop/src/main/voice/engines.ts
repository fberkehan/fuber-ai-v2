/**
 * Ses hattının takılabilir parçaları (KURGU §3: "takılabilir arayüz"). Seslendirme ses işçisinin yönlendiricisinden
 * geçer: Piper ve ElevenLabs işçinin içindedir, ekran kartı motorları (Supertonic 3, EMA Lightning) ses konağındadır
 * (`tts-host/`; yeni motor eklemek için `@fuber/shared` › `tts-engines.ts`). ElevenLabs Scribe ve ikinci bir sezici
 * aynı arayüzlere takılır.
 * Yazıya çevirme arayüzü `stt/types.ts` içindedir (`SttEngine`).
 */

import type { TtsEngineId, WakePath } from '@fuber/shared';
import type { WorkerCommand } from '../../worker/protocol';

/** Metni sese çevirip ses penceresinde çalan motor. Ses örnekleri işçi ↔ pencere portundan akar. */
export interface TtsEngine {
  /** Şu an cümleleri seslendiren motor (seçili motor kullanılamıyorsa zincirde bir alttaki). */
  readonly id: TtsEngineId;
  /** Motor şu an ses üretebilir mi (model yüklü, anahtar geçerli). */
  available(): boolean;
  /** Cümleyi `streamId` akışına ekler; cümleler geliş sırasıyla, boşluksuz çalınır. */
  speak(streamId: string, text: string): void;
  /** Akışa başka cümle gelmeyecek. */
  end(streamId: string): void;
  /** Bekleyen ve süren sentezi atar. */
  cancel(): void;
  /** Kullanıcı uyandı: bulut bağlantısı önceden açılır (yerel seste etkisizdir). */
  prewarm(): void;
}

/** Uyandırma sözünü ses akışından sezen motor. Dökümden sezme (Whisper yolu) oturumun içindedir. */
export interface WakeEngine {
  readonly path: WakePath;
  available(): boolean;
  setEnabled(on: boolean): void;
}

type Send = (command: WorkerCommand) => void;

/**
 * Seslendirme ses işçisinde yönetilir: Piper (alt süreç), ElevenLabs (HTTP akışı) ve ses konağının ucu orada yaşar;
 * cümle sırası, iptal ve düşüş zinciri tek kuyruktadır (`worker/tts-router.ts`). Bu nesne yalnız komut iletir.
 */
export function createWorkerTts(send: Send, available: () => boolean, active: () => TtsEngine['id']): TtsEngine {
  return {
    get id() {
      return active();
    },
    available,
    speak: (streamId, text) => send({ type: 'tts.speak', streamId, text }),
    end: (streamId) => send({ type: 'tts.end', streamId }),
    cancel: () => send({ type: 'tts.cancel' }),
    prewarm: () => send({ type: 'tts.prewarm' }),
  };
}

/** sherpa-onnx anahtar sözcük sezici: ses işçisinde sürekli çalışır. */
export function createKwsWake(send: Send, available: () => boolean): WakeEngine {
  return {
    path: 'kws',
    available,
    setEnabled: (on) => send({ type: 'wake', on }),
  };
}
