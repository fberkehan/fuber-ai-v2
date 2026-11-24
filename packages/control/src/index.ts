/**
 * `@fuber/control`: kontrol servisi (Hono + `node:sqlite`) ve istemcisi. Node'da koşar;
 * Fuber Yönetim 2'nin ana sürecine gömülür ve yalnız 127.0.0.1'de dinler.
 * HTTP sözleşmesi `@fuber/shared` içindeki `control-api.ts` dosyasındadır.
 *
 * Masaüstü yalnız istemciyi istiyorsa `@fuber/control/client` yolunu kullanır (SQLite/Hono çekmez).
 */

import { APP_VERSION } from '@fuber/shared';

/** Servisin `GET /v1/health` yanıtında bildirdiği sürüm. */
export const CONTROL_SERVICE_VERSION = APP_VERSION;

export * from './types';
export * from './client';
export {
  createControlService,
  changedPaths,
  isLoopbackAddress,
  CONTROL_SERVICE_NAME,
  type ControlAdmin,
  type ControlChange,
  type ControlHealth,
  type ControlService,
  type ControlServiceOptions,
  type DevicePolicyEnvelope,
  type AdminUsageDetail,
  type AdminUsageDayDetail,
} from './service';
export {
  testProviderKey,
  listAnthropicModels,
  listCloudModels,
  CLOUD_TEST_MESSAGES,
  listElevenLabsVoices,
  synthesizeElevenLabs,
  summarizeBody,
  PROVIDER_LABELS,
  ProviderRequestError,
  type FetchLike,
  type ProviderModel,
  type ProviderVoice,
  type ProviderTestResult,
  type SynthesisResult,
} from './providers';
export type { ControlStore } from './store';
