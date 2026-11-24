/**
 * Seslendirme seçimi ve ayarı: politikadan (`voice.tts`, `keys.elevenlabs`) ve cihaz ayarından (`Settings.ttsEngine`,
 * `Settings.ttsVoices`) ses işçisinin anlayacağı biçime. Geri düşme nedenlerinin kullanıcıya gösterilecek Türkçe
 * karşılıkları da buradadır.
 *
 * Seçim kuralı: cihaz ayarı varsa o (ekran kartına bağlı bir tercihtir; Ayarlar › Ses), yoksa Fuber Yönetim'in
 * varsayılanı (`Policy.voice.tts.provider`). Ses de aynı sırayla çözülür: cihazda o motor için seçilen ses, yoksa
 * politikanın sesi (politika aynı motoru gösteriyorsa), yoksa motorun varsayılanı.
 */

import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_VOICE_ID,
  isGpuDevice,
  isTtsEngineId,
  resolveTtsVoice,
  t,
  TTS_ENGINES,
  type MessageKey,
  type Policy,
  type Settings,
  type TtsDevice,
  type TtsEngineId,
} from '@fuber/shared';
import type { TtsFallbackReason, TtsHostInfo, TtsSettings } from '../../worker/protocol';

/** Politikada ses ya da model yazmıyorsa kullanılan varsayılanlar (kütüphane sesleri ücretsiz planda 402 döner). */
export const ELEVENLABS_DEFAULT_VOICE = DEFAULT_ELEVENLABS_VOICE_ID;
export const ELEVENLABS_DEFAULT_MODEL = DEFAULT_ELEVENLABS_MODEL;
export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
/** İlk ses parçası bu sürede gelmezse cümle yerel sesle okunur (kullanıcı sessizlik yaşamasın). */
export const ELEVENLABS_FIRST_CHUNK_TIMEOUT_MS = 1500;
const ELEVENLABS_STALL_TIMEOUT_MS = 3000;

export interface TtsOverrides {
  /** Sınamada sahte sunucu. */
  elevenLabsBaseUrl?: string;
  /** Sınamada bu süreçte harcanabilecek en çok karakter (geliştiricinin kotasını korur). */
  elevenLabsCharBudget?: number;
  elevenLabsFirstChunkTimeoutMs?: number;
}

type DeviceChoice = Pick<Settings, 'ttsEngine' | 'ttsVoices'>;

export interface TtsSelection {
  engine: TtsEngineId;
  /** Motorun sesi (Supertonic: `M4`; ElevenLabs: ses kimliği; tek sesli motorlarda o ses). */
  voice: string | null;
  /** Seçimin kaynağı: bu cihazın ayarı ya da Fuber Yönetim'in varsayılanı. */
  source: 'device' | 'policy';
}

/** Bir motorda yürürlükteki ses (cihaz → politika → motorun varsayılanı). */
export function voiceFor(engine: TtsEngineId, policy: Policy, device: DeviceChoice | null): string | null {
  const chosen = device?.ttsVoices?.[engine];
  const fromPolicy = policy.voice.tts.provider === engine ? policy.voice.tts.voiceId?.trim() : undefined;
  if (engine === 'elevenlabs') return fromPolicy || ELEVENLABS_DEFAULT_VOICE;
  return resolveTtsVoice(engine, chosen ?? fromPolicy ?? null);
}

/** Yürürlükteki seslendirme seçimi. Cihaz ayarı tanınmayan bir motor taşıyorsa (eski/bozuk kayıt) politika geçerlidir. */
export function resolveTtsSelection(policy: Policy, device: DeviceChoice | null): TtsSelection {
  const chosen = device?.ttsEngine;
  const fromDevice = isTtsEngineId(chosen);
  const engine = fromDevice ? chosen : policy.voice.tts.provider;
  return { engine, voice: voiceFor(engine, policy, device), source: fromDevice ? 'device' : 'policy' };
}

/** Bulut sesinin (ElevenLabs) ayarı; anahtar yoksa `null`. Ses ve model politikadan (motor ElevenLabs ise), yoksa varsayılan. */
function elevenLabsSettings(policy: Policy, overrides: TtsOverrides): TtsSettings['elevenlabs'] {
  const apiKey = policy.keys.elevenlabs?.trim() ?? '';
  if (!apiKey) return null;
  const tts = policy.voice.tts;
  const fromPolicy = tts.provider === 'elevenlabs';
  return {
    apiKey,
    voiceId: (fromPolicy && tts.voiceId?.trim()) || ELEVENLABS_DEFAULT_VOICE,
    model: (fromPolicy && tts.model?.trim()) || ELEVENLABS_DEFAULT_MODEL,
    languageCode: policy.persona.language,
    baseUrl: overrides.elevenLabsBaseUrl ?? ELEVENLABS_BASE_URL,
    firstChunkTimeoutMs: overrides.elevenLabsFirstChunkTimeoutMs ?? ELEVENLABS_FIRST_CHUNK_TIMEOUT_MS,
    stallTimeoutMs: ELEVENLABS_STALL_TIMEOUT_MS,
    charBudget: overrides.elevenLabsCharBudget ?? null,
  };
}

/**
 * İşçiye verilecek ayar. Bulut seçili ama anahtar yoksa (Yönetim hiç kurulmamış, kasada anahtar yok) işçi buluttan
 * hiç haberdar edilmez: doğrudan yerel ses konuşur, geri düşme olayı ve bildirim doğmaz; durum yalnız tanıda görünür.
 * `host`: ses konağı hazırsa yüklü motoru (yoksa `null`; cümleler Piper ile okunur).
 */
export function buildTtsSettings(policy: Policy, device: DeviceChoice | null, host: TtsHostInfo | null, overrides: TtsOverrides = {}): TtsSettings {
  const selection = resolveTtsSelection(policy, device);
  return {
    engine: selection.engine,
    language: policy.persona.language,
    host: selection.engine === 'piper-local' ? null : host,
    elevenlabs: elevenLabsSettings(policy, overrides),
  };
}

/** İSTENEN seslendirmenin anahtar dışındaki özeti (tanı için; anahtar yazılmaz). */
export function describeTts(
  policy: Policy,
  device: DeviceChoice | null,
): { provider: TtsEngineId; source: TtsSelection['source']; voice: string | null; voiceId: string | null; model: string | null; hasKey: boolean } {
  const selection = resolveTtsSelection(policy, device);
  const cloud = selection.engine === 'elevenlabs';
  const fromPolicy = policy.voice.tts.provider === 'elevenlabs';
  return {
    provider: selection.engine,
    source: selection.source,
    voice: selection.voice,
    voiceId: cloud ? selection.voice : null,
    model: cloud ? (fromPolicy && policy.voice.tts.model?.trim()) || ELEVENLABS_DEFAULT_MODEL : null,
    hasKey: (policy.keys.elevenlabs?.trim().length ?? 0) > 0,
  };
}

/** Motorun kullanıcıya gösterilen adı ("Supertonic 3"). */
export const engineLabel = (engine: TtsEngineId): string => t(TTS_ENGINES[engine].label);

/** Sesin kullanıcıya gösterilen adı ("Erkek 4 · tok"); listede olmayan ses kimliğiyle görünür. */
export function voiceLabel(engine: TtsEngineId, voice: string | null): string {
  if (engine === 'elevenlabs') return t('tts.voice.elevenlabs.managed');
  const found = TTS_ENGINES[engine].voices.find((item) => item.id === voice);
  return found ? t(found.label) : (voice ?? '');
}

const FALLBACK_MESSAGES: Record<TtsFallbackReason, MessageKey> = {
  no_key: 'voice.tts.fallback.noKey',
  unauthorized: 'voice.tts.fallback.unauthorized',
  payment: 'voice.tts.fallback.payment',
  rate_limit: 'voice.tts.fallback.rateLimit',
  quota: 'voice.tts.fallback.quota',
  network: 'voice.tts.fallback.network',
  timeout: 'voice.tts.fallback.timeout',
  interrupted: 'voice.tts.fallback.interrupted',
  server: 'voice.tts.fallback.server',
  budget: 'voice.tts.fallback.budget',
};

/**
 * Geri düşme kullanıcıya bildirilsin mi. Kural: aynı neden art arda yinelenmez (`lastNotified`); anahtar yokluğu hiç
 * bildirilmez (kullanıcının yapabileceği bir şey yok, yerel ses zaten konuşuyor); kota aylık dolduğu için "kotası
 * doldu" bilgisi ayda bir kez gösterilir (`quotaNoticeMonth`: en son gösterildiği ay, `YYYY-AA`).
 */
export function shouldNotifyFallback(
  reason: TtsFallbackReason,
  state: { lastNotified: TtsFallbackReason | null; quotaNoticeMonth: string | null; month: string },
): boolean {
  if (reason === 'no_key' || reason === state.lastNotified) return false;
  if (reason === 'quota') return state.quotaNoticeMonth !== state.month;
  return true;
}

/** Geri düşmenin kullanıcıya gösterilecek kısa Türkçe açıklaması (ada / ana pencere). */
export const fallbackMessage = (reason: TtsFallbackReason): string => t(FALLBACK_MESSAGES[reason]);

type HostPhase = 'off' | 'starting' | 'ready' | 'failed';
/** Ses konağının (ekran kartı sesi) düşüşünün kullanıcıya bildirimi için karar. */
export type HostNotice =
  /** Kullanıcıya bir kez bildir (düşüş olayının başı); `key` aynı düşüşün yinelenmemesi için. */
  | { kind: 'notify'; key: string; messageKey: MessageKey }
  /** Seçilen ekran kartı cihazına temiz dönüş: KARARLI kalırsa düşüş kilidini açmak için say (çırpınmada açma). */
  | { kind: 'recover' }
  /** Bir şey yapma (durum ilgisiz ya da aynı düşüş zaten bildirildi). */
  | { kind: 'none' };

/**
 * Ses konağının yeni durumuna göre kullanıcıya ne bildirileceğine karar verir (saf; zamanlayıcıyı çağıran kurar). Kural:
 * ekran kartı cihazından alta inince ya da hiç açılamayınca BİR KEZ bilgi verilir; aynı düşüş yinelenmez (`lastKey`).
 * Seçilen ekran kartı cihazına temiz dönüş ise duyurulmaz: yalnız bir süre KARARLI kalınırsa kilit açılır (`recover`),
 * böylece geçici sıkışmada aç-kapa çırpınması her seferinde "işlemciye düşüldü" diye duyurulmaz (düşüşler tanıda görünür).
 */
export function hostNoticeAction(
  before: { phase: HostPhase } | null,
  state: { phase: HostPhase; device: TtsDevice | null; attempts: ReadonlyArray<unknown>; missingFiles: boolean },
  lastKey: string | null,
): HostNotice {
  if (state.phase === 'failed' && !state.missingFiles) {
    return lastKey === 'failed' ? { kind: 'none' } : { kind: 'notify', key: 'failed', messageKey: 'tts.fallback.toPiper' };
  }
  if (state.phase === 'ready' && before?.phase !== 'ready' && state.attempts.length > 0 && state.device) {
    if (state.device === lastKey) return { kind: 'none' };
    return { kind: 'notify', key: state.device, messageKey: isGpuDevice(state.device) ? 'tts.fallback.toDirectml' : 'tts.fallback.toCpu' };
  }
  if (state.phase === 'ready' && state.attempts.length === 0 && state.device && isGpuDevice(state.device)) {
    return lastKey !== null ? { kind: 'recover' } : { kind: 'none' };
  }
  return { kind: 'none' };
}
