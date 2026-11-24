/**
 * OpenAI uyumlu bulut sağlayıcıları (G8): hazır ayarlar, sağlayıcı farkları (uyum katmanı), hata sınıflaması ve
 * model listesinin okunması. Masaüstü (`core/brain/providers/openai-compatible.ts`), kontrol servisi (anahtar sınaması,
 * model listesi) ve Yönetim aynı kuralları buradan okur; fark bir yerde yazılır.
 *
 * Fuber AI 1'den alınanlar: akıl yürüten OpenAI modellerinde `max_completion_tokens` + `reasoning_effort`, OpenRouter
 * başlıkları ve canlı fiyat listesi, kredi/anahtar hata kodları.
 */

import type { CloudEndpoint, CloudPreset, KeyProvider, ModelPrice, ModelRef, Policy } from './policy';

/** İstek biçimi: OpenAI Chat Completions. */
export type CloudDialect = 'openai';

export interface CloudPresetInfo {
  preset: CloudPreset;
  /** Görünen ad. */
  label: string;
  /** Kasadaki anahtarın adı. */
  keyId: KeyProvider;
  /** Hazır temel adres (özel adreste boş). */
  baseUrl: string;
  dialect: CloudDialect;
  /** Anahtar alınacak yer (Yönetim'de bağlantı olarak gösterilir). */
  keyUrl: string | null;
}

export const CLOUD_PRESET_INFO: Record<CloudPreset, CloudPresetInfo> = {
  openai: { preset: 'openai', label: 'OpenAI', keyId: 'openai', baseUrl: 'https://api.openai.com/v1', dialect: 'openai', keyUrl: 'https://platform.openai.com/api-keys' },
  openrouter: { preset: 'openrouter', label: 'OpenRouter', keyId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', dialect: 'openai', keyUrl: 'https://openrouter.ai/keys' },
  moonshot: { preset: 'moonshot', label: 'Moonshot (Kimi)', keyId: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1', dialect: 'openai', keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  custom: { preset: 'custom', label: 'Özel adres', keyId: 'custom', baseUrl: '', dialect: 'openai', keyUrl: null },
};

/** Kasadaki anahtar bir OpenAI uyumlu sağlayıcının mı (Anthropic, ElevenLabs, Gemini değil). */
export const CLOUD_KEY_IDS: readonly KeyProvider[] = ['openai', 'openrouter', 'moonshot', 'custom'];

export const trimBase = (url: string): string => url.trim().replace(/\/+$/, '');

/** Sağlayıcı kaydı; yoksa `null`. */
export function findEndpoint(policy: Pick<Policy, 'providers'>, id: string | undefined): CloudEndpoint | null {
  if (!id) return null;
  return policy.providers.find((endpoint) => endpoint.id === id) ?? null;
}

/** Bir anahtarın sınanacağı/listeleneceği sağlayıcı kaydı: önce o anahtara bağlı ilk kayıt, yoksa hazır ayar. */
export function endpointForKey(policy: Pick<Policy, 'providers'>, keyId: KeyProvider): CloudEndpoint | null {
  const own = policy.providers.find((endpoint) => endpoint.keyId === keyId);
  if (own) return own;
  const preset = (Object.values(CLOUD_PRESET_INFO) as CloudPresetInfo[]).find((info) => info.keyId === keyId);
  if (!preset || !preset.baseUrl) return null;
  return { id: preset.preset, preset: preset.preset, name: preset.label, baseUrl: preset.baseUrl, keyId, model: '-', caps: { tools: true, vision: false, stream: true } };
}

/**
 * Politika bağlarının denetimi (Yönetim kaydederken): `openai-compatible` rol var olan bir kayda bağlı olmalı,
 * kayıt kimlikleri tekil olmalı. Sorun yoksa boş dizi.
 */
export function policyLinkProblems(policy: Pick<Policy, 'models' | 'providers'>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const endpoint of policy.providers) {
    if (seen.has(endpoint.id)) problems.push(`providers: "${endpoint.id}" kimliği iki kez geçiyor`);
    seen.add(endpoint.id);
  }
  for (const [role, ref] of Object.entries(policy.models) as Array<[string, ModelRef | undefined]>) {
    if (!ref || ref.provider !== 'openai-compatible') continue;
    if (!ref.endpoint) problems.push(`models.${role}.endpoint: OpenAI uyumlu rolde sağlayıcı seçilmeli`);
    else if (!seen.has(ref.endpoint)) problems.push(`models.${role}.endpoint: "${ref.endpoint}" adlı sağlayıcı kaydı yok`);
  }
  return problems;
}

// ───────────────────────────── Uyum katmanı ─────────────────────────────

/** Bir sağlayıcı + model için istek ayrıntıları. Hepsi saf veridir; birim testleri kayıtlı örneklerle sınar. */
export interface CloudCompat {
  dialect: CloudDialect;
  /** Temel adrese eklenecek yol. */
  chatPath: string;
  modelsPath: string;
  /** Çıktı sınırının alan adı: OpenAI'nin yeni modelleri `max_completion_tokens` ister, çoğu uyumlu sunucu `max_tokens`. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** Akışta kullanım sayımı için `stream_options.include_usage` gönderilsin mi. */
  streamUsage: boolean;
  /** Akıl yürüten model: düşünme çıktı sınırını yer; sınırın tabanı yükseltilir. */
  reasoning: boolean;
  /** Efor nasıl iletilir: `reasoning_effort` (OpenAI), `reasoning: {effort}` (OpenRouter) ya da hiç. */
  effortField: 'reasoning_effort' | 'reasoning' | null;
  /** Akıl yürüten modelde çıktı sınırının en düşük değeri (düşünme + yanıt toplamı). */
  minMaxTokens: number;
  /** `temperature` gönderilsin mi (akıl yürüten OpenAI modelleri reddeder). */
  temperature: number | null;
  /** Sağlayıcıya özgü başlıklar. */
  headers: Record<string, string>;
  /** İstek başına en çok görsel; sınırsızsa `null`. */
  maxImages: number | null;
  /** OpenRouter: yanıtta gerçek maliyet (`usage.cost`) istenir. */
  usageCost: boolean;
  /** Araç şemasından sağlayıcının tanımadığı anahtarların ayıklanması. */
  schemaMode: 'plain' | 'strict';
}

/** Akıl yürüten bilinen aileler (model kimliğinde sağlayıcı öneki olabilir: `openai/o3`). */
const REASONING_MODEL = /(^|\/)(o\d|gpt-5|gpt-oss|deepseek-r|qwq|kimi-k2-thinking|kimi-k2\.5|grok-[34]|glm-4\.[5-9]|minimax-m)/i;
/** Akıl yürüten OpenAI modelleri sıcaklık kabul etmez. */
const OPENAI_NO_TEMPERATURE = /^(o\d|gpt-5)/i;
/** Gemini arka uçları JSON şemasının bazı anahtarlarını reddeder. */
const STRICT_SCHEMA_MODEL = /(^|\/)(gemini|gemma|google\/)/i;

export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL.test(model);
}

export function compatFor(endpoint: Pick<CloudEndpoint, 'preset'>, model: string): CloudCompat {
  const bare = model.replace(/^[^/]+\//, '');
  const reasoning = isReasoningModel(model);
  const base: CloudCompat = {
    dialect: 'openai',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    maxTokensField: 'max_tokens',
    streamUsage: true,
    reasoning,
    effortField: null,
    minMaxTokens: reasoning ? 8192 : 0,
    temperature: 0.6,
    headers: {},
    maxImages: null,
    usageCost: false,
    schemaMode: STRICT_SCHEMA_MODEL.test(model) ? 'strict' : 'plain',
  };
  switch (endpoint.preset) {
    case 'openai':
      return {
        ...base,
        maxTokensField: 'max_completion_tokens',
        effortField: reasoning ? 'reasoning_effort' : null,
        temperature: OPENAI_NO_TEMPERATURE.test(bare) ? null : 0.6,
      };
    case 'openrouter':
      return {
        ...base,
        effortField: reasoning ? 'reasoning' : null,
        temperature: OPENAI_NO_TEMPERATURE.test(bare) ? null : 0.6,
        headers: { 'X-Title': 'Fuber AI v2' },
        usageCost: true,
      };
    case 'moonshot':
      // Kimi K2 için önerilen sıcaklık 0,6; akışta kullanım sayımı seçimin içinde gelir (ayrıştırıcı iki yeri de okur).
      return { ...base, temperature: 0.6 };
    case 'custom':
      return base;
  }
}

// ───────────────────────────── Hata sınıflaması ─────────────────────────────

/**
 * Sağlayıcı hatasının türü. `auth` anahtar reddedildi · `billing` kredi/kota bitti · `rate_limit` hız sınırı ·
 * `model` model yok / bu anahtara açık değil · `context` istem modelin bağlamını aşıyor · `bad_request` başka 4xx ·
 * `server` 5xx · `timeout` · `network` bağlanılamadı · `stream_cut` akış yarıda koptu.
 */
export type CloudErrorKind = 'auth' | 'billing' | 'rate_limit' | 'model' | 'context' | 'bad_request' | 'server' | 'timeout' | 'network' | 'stream_cut' | 'forbidden';

const BILLING_BODY = /insufficient_quota|exceeded your current quota|exceeded_current_quota|credit balance|insufficient (credits|balance|funds)|requires more credits|KREDI_YETERSIZ|payment required|account (is )?suspended|billing/i;
const MODEL_BODY = /model_not_found|model[^.]{0,40}(does not exist|not found|not available|is not supported)|no endpoints found|invalid model|unknown model|MODEL_NOT_FOUND|MODEL_DISABLED|MODEL_API_ONLY/i;
const CONTEXT_BODY = /context[_ ]length|maximum context|context window|too many tokens|prompt is too long|reduce the length/i;
const AUTH_BODY = /invalid[_ ]api[_ ]key|incorrect api key|unauthori[sz]ed|authentication|UNAUTHORIZED|CIHAZ_KAPATILDI|HESAP_ASKIDA/i;

/** HTTP durumu + gövdeden hata türü. Gövde yalnız sınıflama için okunur; çağıran kısaltıp anahtarı gizler. */
export function classifyCloudHttpError(status: number, body: string): CloudErrorKind {
  if (status === 402 || BILLING_BODY.test(body)) return 'billing';
  if (status === 401 || (status === 403 && AUTH_BODY.test(body))) return 'auth';
  if (status === 404 || MODEL_BODY.test(body)) return 'model';
  // 403 kimlik dışı da olabilir (OpenRouter: içerik denetimi; OpenAI: bölge). Bulutu "düşük" saymaz.
  if (status === 403) return 'bad_request';
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  if (status === 413 || CONTEXT_BODY.test(body)) return 'context';
  return 'bad_request';
}

/** Gövdeyi tek satıra indirip kısaltır; anahtar gövdede yankılanmışsa gizler. */
export function redactBody(body: string, key: string | null | undefined, max = 280): string {
  let text = body.replace(/\s+/g, ' ').trim();
  if (key && key.length >= 8) text = text.split(key).join('***');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ───────────────────────────── Model listesi ─────────────────────────────

/** Sağlayıcının listesindeki bir model (Yönetim seçicisi). Bilinmeyen alan yazılmaz. */
export interface CloudModelInfo {
  id: string;
  displayName: string;
  /** Araç çağrısını destekliyor mu; sağlayıcı söylemiyorsa `null`. */
  tools: boolean | null;
  vision: boolean | null;
  contextTokens: number | null;
  /** $ / milyon token; sağlayıcı fiyat vermiyorsa `null` ("bilinmiyor"). */
  price: ModelPrice | null;
  /** Önerilen model (ad listeden gelir, uydurulmaz). Alan yoksa önerilmez. */
  recommended?: boolean;
}

const asObjects = (value: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(value) ? value : value && typeof value === 'object' ? ((value as { data?: unknown; models?: unknown }).data ?? (value as { models?: unknown }).models) : [];
  return (Array.isArray(list) ? list : []).filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
};
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const positive = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/** OpenRouter fiyatı ($ / token, metin) → $ / milyon token; "-1" (değişken) ve okunamayan değer bilinmiyor. */
export function perMillion(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1e6 * 1e4) / 1e4;
}

/** OpenAI'de sohbet tamamlamayla kullanılmayan modeller (gömme, ses, görsel üretimi…). */
const OPENAI_NON_CHAT = /(embedding|whisper|tts|dall-e|audio|realtime|transcribe|image|moderation|search|instruct|codex|computer-use|sora|davinci|babbage)/i;

/** `GET /models` yanıtı → seçici satırları. Biçimler: OpenAI `{data:[{id}]}`, OpenRouter (fiyat, yetenek). */
export function parseCloudModels(preset: CloudPreset, raw: unknown): CloudModelInfo[] {
  const out: CloudModelInfo[] = [];
  const seen = new Set<string>();
  for (const item of asObjects(raw)) {
    const id = (typeof item.id === 'string' ? item.id : typeof item.key === 'string' ? item.key : '').trim();
    if (!id || seen.has(id)) continue;
    if (preset === 'openai' && OPENAI_NON_CHAT.test(id)) continue;
    const architecture = (item.architecture ?? {}) as Record<string, unknown>;
    const outputs = strings(architecture.output_modalities);
    if (outputs.length && !outputs.includes('text')) continue;
    seen.add(id);
    const inputs = strings(architecture.input_modalities);
    const params = strings(item.supported_parameters);
    const pricing = (item.pricing ?? {}) as Record<string, unknown>;
    const input = perMillion(pricing.prompt);
    const output = perMillion(pricing.completion);
    const cached = perMillion(pricing.input_cache_read);
    const name = [item.name, item.displayName, item.display_name].find((value): value is string => typeof value === 'string' && value.trim() !== '');
    out.push({
      id,
      displayName: name?.trim() ?? id,
      tools: params.length ? params.includes('tools') : typeof item.supportsTools === 'boolean' ? item.supportsTools : null,
      vision: inputs.length ? inputs.includes('image') : typeof item.supportsVision === 'boolean' ? item.supportsVision : null,
      contextTokens: positive(item.context_length) ?? positive(item.contextLength) ?? positive(item.context_window),
      price: input !== null && output !== null ? { input, output, ...(cached !== null ? { cachedInput: cached } : {}) } : null,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Rolün fiyatıyla bir çağrının dolar karşılığı; fiyat bilinmiyorsa `null`. */
export function cloudCost(price: ModelPrice | undefined | null, tokens: { input: number; output: number; cachedInput: number }): number | null {
  if (!price) return null;
  const uncached = Math.max(0, tokens.input - tokens.cachedInput);
  return (uncached * price.input + tokens.cachedInput * (price.cachedInput ?? price.input) + tokens.output * price.output) / 1_000_000;
}
