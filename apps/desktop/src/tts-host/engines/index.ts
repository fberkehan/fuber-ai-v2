/**
 * Ses konağındaki motorların kayıt tablosu. Yeni motor: `engines/<ad>.ts` dosyası (`HostEngine` uygular) ve buraya
 * bir satır. Kimlik `@fuber/shared` kataloğundaki (`TTS_HOST_ENGINE_IDS`) kimlikle aynıdır; tablo eksik kalırsa
 * derleme hata verir.
 */

import type { TtsHostEngineId } from '@fuber/shared';
import type { EngineFactory } from '../engine';
import { createEma } from './ema';
import { createSupertonic } from './supertonic';

export const HOST_ENGINES: Record<TtsHostEngineId, EngineFactory> = {
  supertonic: createSupertonic,
  'ema-lightning': createEma,
};
