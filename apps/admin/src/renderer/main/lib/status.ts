/**
 * Ekranların "bir bakışta" okuduğu durumlar: tek yerden hesaplanır ki Genel bakış, özet şeritleri ve bağlam
 * sütunları aynı şeyi söylesin. Hepsi gerçek veriden (politika taslağı, anahtar kasası, cihazlar); saf işlevler.
 */
import { BUILTIN_MODULE_IDS, TTS_ENGINES, t, type DeviceRecord, type KeyProvider, type KeyStatus, type ModelRef, type Policy } from '@fuber/shared';
import type { DotTone } from '../components/layout';

/** Cihaz son üç dakikada yoklama ya da kalp atışı gönderdiyse "bağlı" sayılır. */
export const ONLINE_MS = 3 * 60_000;

export function isOnline(device: DeviceRecord, now: number): boolean {
  return !!device.lastSeenAt && now - Date.parse(device.lastSeenAt) < ONLINE_MS;
}

export function lastSeen(devices: DeviceRecord[]): string | null {
  return devices.reduce<string | null>((latest, d) => (d.lastSeenAt && (!latest || d.lastSeenAt > latest) ? d.lastSeenAt : latest), null);
}

/** Anahtar kullanılabilir mi: kasada var ve son sınama başarısız değil (sınanmamış anahtar hazır sayılır). */
export function keyReady(keys: KeyStatus[] | null | undefined, provider: KeyProvider | string | undefined): boolean {
  if (!provider) return false;
  const key = keys?.find((k) => k.provider === provider);
  return !!key?.present && (key.lastTest === null || key.lastTest.ok || key.lastTest.status === 'recognized');
}

export function keyFailed(keys: KeyStatus[] | null | undefined, provider: KeyProvider): boolean {
  const key = keys?.find((k) => k.provider === provider);
  return !!key?.present && key.lastTest !== null && !key.lastTest.ok && key.lastTest.status !== 'recognized';
}

/** Rolün modeli okunur adla: "claude-haiku-5-5", "Claude Code · sonnet", "Yerel · qwen3.5-4b". */
export function roleModelLabel(ref: ModelRef, policy: Policy): string {
  if (ref.provider === 'local') return policy.brain.local.modelId;
  return ref.model;
}

/** Rolün sağlayıcısının kısa adı (rozet yerine noktalı durumun metni). */
export function roleProviderLabel(ref: ModelRef, policy: Policy): string {
  if (ref.provider === 'anthropic') return t('admin.status.provider.anthropic');
  if (ref.provider === 'claude-code') return t('admin.status.provider.claudeCode');
  if (ref.provider === 'local') return t('admin.status.provider.local');
  const endpoint = policy.providers.find((p) => p.id === ref.endpoint);
  return endpoint?.name ?? t('admin.status.provider.cloud');
}

/** Rolün çalışabilirliği: Claude'da Anthropic anahtarı, OpenAI uyumluda uç anahtarı; yerel ve Claude Code bu bilgisayarda. */
export function roleTone(ref: ModelRef, policy: Policy, keys: KeyStatus[] | null | undefined): DotTone {
  if (ref.provider === 'anthropic') return keyReady(keys, 'anthropic') ? 'success' : 'warning';
  if (ref.provider === 'openai-compatible') {
    const endpoint = policy.providers.find((p) => p.id === ref.endpoint);
    return endpoint && (!endpoint.keyId || keyReady(keys, endpoint.keyId)) ? 'success' : 'warning';
  }
  return 'success';
}

export function sttLabel(provider: Policy['voice']['stt']['provider']): string {
  return provider === 'whisper-local' ? t('admin.status.stt.local') : t('admin.status.stt.scribe');
}

export function sttTone(provider: Policy['voice']['stt']['provider'], keys: KeyStatus[] | null | undefined): DotTone {
  return provider === 'whisper-local' || keyReady(keys, 'elevenlabs') ? 'success' : 'warning';
}

export function ttsLabel(provider: Policy['voice']['tts']['provider']): string {
  return t(TTS_ENGINES[provider].label);
}

export function ttsTone(provider: Policy['voice']['tts']['provider'], keys: KeyStatus[] | null | undefined): DotTone {
  return TTS_ENGINES[provider].kind !== 'cloud' || keyReady(keys, 'elevenlabs') ? 'success' : 'warning';
}

/** Modüller: yerleşik ve fazladan modüllerden kaçı açık (ortam dinleme ayrı sayılır). */
export function moduleIds(modules: Policy['modules']): string[] {
  // Yerleşikler sabit sırayla; politikada fazladan modül varsa (ileride Atölye'den) sona eklenir.
  const builtin = BUILTIN_MODULE_IDS as readonly string[];
  return [...builtin.filter((id) => id !== 'ambient'), ...Object.keys(modules).filter((id) => id !== 'ambient' && !builtin.includes(id))];
}

export function moduleCounts(policy: Policy): { on: number; total: number } {
  const ids = moduleIds(policy.modules);
  return { on: ids.filter((id) => policy.modules[id]?.enabled).length, total: ids.length };
}

export function ambientOn(policy: Policy): boolean {
  return !!policy.ambient.allowed && !!policy.modules.ambient?.enabled;
}
