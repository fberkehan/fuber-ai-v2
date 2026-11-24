// OpenAI uyumlu bulut sağlayıcılarının yönlendirme yardımcıları (G8): rolün model ayarı (yazılı sohbetin ayrı modeli),
// sağlayıcı kaydı + kasadaki anahtar ve sağlayıcı başına "şu an düşük" durumu. Anthropic'in durumu `brain.ts`'te ayrı
// tutulur: biri düştüğünde öteki etkilenmez (ör. Anthropic'te kredi yokken OpenRouter çalışır).
import { findEndpoint, type BrainCloudIssue, type BrainRole, type CloudEndpoint, type ModelRef, type Policy, type ToolOrigin } from '@fuber/shared';

/**
 * Rolün o çağrıdaki model ayarı. Yazılı sohbet `deep` rolündedir; Yönetim ayrı bir sohbet modeli seçtiyse
 * (`models.chat`) o kullanılır, derin işler `deep`'te kalır.
 */
export function modelRefFor(policy: Pick<Policy, 'models'>, role: BrainRole, origin: Pick<ToolOrigin, 'channel'> | null): ModelRef {
  if (role === 'deep' && origin?.channel === 'chat' && policy.models.chat) return policy.models.chat;
  return policy.models[role];
}

export interface CloudTarget {
  endpoint: CloudEndpoint;
  apiKey: string;
  ref: ModelRef;
  /** Rolde model boşsa kaydın varsayılanı. */
  model: string;
}

export type CloudResolution = { ok: true; target: CloudTarget } | { ok: false; why: 'no_endpoint' | 'no_key' };

/** `openai-compatible` rolün sağlayıcı kaydı ve anahtarı. Anahtar yalnız politikadan (Yönetim kasası) gelir. */
export function resolveCloudTarget(policy: Pick<Policy, 'providers' | 'keys'>, ref: ModelRef): CloudResolution {
  const endpoint = findEndpoint(policy, ref.endpoint);
  if (!endpoint) return { ok: false, why: 'no_endpoint' };
  const apiKey = policy.keys[endpoint.keyId]?.trim();
  if (!apiKey) return { ok: false, why: 'no_key' };
  return { ok: true, target: { endpoint, apiKey, ref, model: ref.model.trim() || endpoint.model } };
}

/**
 * Sağlayıcı başına "düşük" durumu: kredi bitti, anahtar reddedildi ya da ağ yok. Süre dolunca bir sonraki tur buluta
 * yeniden gider (ücretsiz yoklama yok: OpenAI uyumlu uçlarda kredi ancak gerçek istekle görülür). Yönetim'den anahtar ya
 * da sağlayıcı kaydı değişince durum hemen silinir.
 */
export function createCloudHealth(now: () => number = Date.now) {
  const down = new Map<string, { until: number; issue: BrainCloudIssue }>();
  const current = (id: string) => {
    const entry = down.get(id);
    if (!entry) return null;
    if (now() >= entry.until) {
      down.delete(id);
      return null;
    }
    return entry;
  };
  return {
    isDown: (id: string) => current(id) !== null,
    issue: (id: string): BrainCloudIssue | null => current(id)?.issue ?? null,
    markDown(id: string, issue: BrainCloudIssue, forMs: number) {
      down.set(id, { until: now() + forMs, issue });
    },
    /** Düzeldi; durum değiştiyse `true`. */
    markUp: (id: string) => down.delete(id),
    clear() {
      const had = down.size > 0;
      down.clear();
      return had;
    },
  };
}
