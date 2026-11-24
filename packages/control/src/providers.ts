/**
 * Sağlayıcı anahtarlarının sınanması ve Yönetim ekranları için model / ses listeleri.
 * Her çağrı sağlayıcının kendi API'sine gider; zaman aşımı 10 sn.
 *
 * Hata gövdesi ATILMAZ: kısaltılıp açıklamaya konur. v1'de sunucu gövdeyi attığı için bir plan
 * sorunu günlerce "401" sanıldı.
 */

import {
  CLOUD_KEY_IDS,
  classifyCloudHttpError,
  compatFor,
  parseCloudModels,
  trimBase,
  type CloudEndpoint,
  type CloudModelInfo,
  type KeyProvider,
  type ProviderModelInfo,
  type ProviderVoiceInfo,
} from '@fuber/shared';
import type { KeyTestStatus } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderCallOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * ElevenLabs sınamasında denenecek ses ve model (politikada seçili olan). Ücretsiz plan hazır sesleri
   * API'den seslendirebilir ama kütüphane seslerinde 402 alır; sınama gerçekte kullanılacak sesle yapılmalı.
   */
  elevenLabs?: { voiceId?: string; model?: string };
  /**
   * OpenAI uyumlu sağlayıcı anahtarında sınanacak kayıt (temel adres, hazır ayar, model). Verilmezse hazır ayarın
   * adresi kullanılır; özel adreste kayıt yoksa sınama "adres yok" der.
   */
  endpoint?: CloudEndpoint | null;
}

export interface ProviderTestResult {
  status: Exclude<KeyTestStatus, 'missing'>;
  /** Kısa Türkçe açıklama; sağlayıcının hata gövdesinin kısaltılmışı dahil, anahtarın kendisi asla. */
  message: string;
  httpStatus: number | null;
  latencyMs: number;
}

export type ProviderModel = ProviderModelInfo;
export type ProviderVoice = ProviderVoiceInfo;

export const PROVIDER_LABELS: Record<KeyProvider, string> = {
  anthropic: 'Anthropic',
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  moonshot: 'Moonshot (Kimi)',
  custom: 'Özel adres',
};

const DEFAULT_TIMEOUT_MS = 10_000;
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const OPENAI_BASE = 'https://api.openai.com';
/**
 * ElevenLabs'in hazır seslerinden Daniel: masaüstünün politikada ses seçilmemişken kullandığı ses
 * (`apps/desktop/src/main/voice/tts-settings.ts`). "Sesi dene" ve anahtar sınaması aynı sesle yapılır.
 */
export const ELEVENLABS_DEFAULT_VOICE = 'onwK4e9ZLuTAKqWW03F9';
export const ELEVENLABS_DEFAULT_MODEL = 'eleven_flash_v2_5';

/** Gövdeyi tek satıra indirip kısaltır; anahtar gövdede yankılanmışsa gizler. */
export function summarizeBody(body: string, key: string, max = 280): string {
  let text = body.replace(/\s+/g, ' ').trim();
  if (key.length >= 8) text = text.split(key).join('***');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

class Timeout extends Error {}

async function call(
  url: string,
  init: RequestInit,
  options: ProviderCallOptions,
): Promise<{ response: Response; latencyMs: number }> {
  const doFetch = options.fetch ?? (globalThis.fetch as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Timeout()), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const started = performance.now();
  try {
    const response = await doFetch(url, { ...init, signal: controller.signal });
    return { response, latencyMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function networkFailure(error: unknown, started: number, timeoutMs: number): ProviderTestResult {
  const latencyMs = Math.round(performance.now() - started);
  const reason =
    error instanceof Timeout || (error as { name?: string })?.name === 'AbortError' || latencyMs >= timeoutMs
      ? `${Math.round(timeoutMs / 1000)} sn içinde yanıt gelmedi`
      : describeNetworkError(error);
  return { status: 'unreachable', message: `Sağlayıcıya ulaşılamadı: ${reason}.`, httpStatus: null, latencyMs };
}

function describeNetworkError(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code) return `${cause.code}${cause.message ? ` (${cause.message})` : ''}`;
  return String((error as { message?: unknown })?.message ?? error);
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Ortak HTTP durum yorumu; sağlayıcıya özgü ayrıntılar çağıranda. */
function classify(
  httpStatus: number,
  body: string,
  key: string,
  latencyMs: number,
): ProviderTestResult {
  const snippet = summarizeBody(body, key);
  const detail = snippet ? `: ${snippet}` : '';
  if (httpStatus >= 200 && httpStatus < 300) return { status: 'valid', message: 'Geçerli.', httpStatus, latencyMs };
  // ElevenLabs kota dolunca 401 + `quota_exceeded` döner: anahtar geçerlidir, karakter hakkı bitmiştir.
  if (/quota_exceeded|insufficient_quota/i.test(body)) {
    return { status: 'insufficient_plan', message: `Kota doldu (${httpStatus})${detail}`, httpStatus, latencyMs };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: 'invalid', message: `Anahtar reddedildi (${httpStatus})${detail}`, httpStatus, latencyMs };
  }
  if (httpStatus === 402) {
    return { status: 'insufficient_plan', message: `Plan yetersiz (402)${detail}`, httpStatus, latencyMs };
  }
  if (httpStatus === 429) {
    // Hız sınırı anahtarın tanındığını gösterir; sınama amacıyla geçerli sayılır (kota dolması yukarıda ayrıldı).
    return { status: 'valid', message: `Geçerli; şu an hız sınırında (429)${detail}`, httpStatus, latencyMs };
  }
  if (httpStatus >= 500) {
    return { status: 'unreachable', message: `Sağlayıcı hata verdi (${httpStatus})${detail}`, httpStatus, latencyMs };
  }
  return { status: 'invalid', message: `Beklenmeyen yanıt (${httpStatus})${detail}`, httpStatus, latencyMs };
}

const anthropicHeaders = (key: string) => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION });
const elevenHeaders = (key: string) => ({ 'xi-api-key': key });

/** Anthropic sınamasının sonuç metinleri; Yönetim arayüzü durumu bunlardan tanır. */
export const ANTHROPIC_TEST_MESSAGES = {
  valid: 'Geçerli; hesapta kredi var.',
  noCredit: 'Anahtar geçerli ama hesapta kredi yok.',
  recognized: 'Anahtar tanındı. Kredi durumu ilk konuşmada belli olur.',
} as const;

/** Model listesinden en ucuz deneme modeli: Haiku varsa o, yoksa ilk model. */
function cheapestModel(body: string): string | null {
  try {
    const ids = ((JSON.parse(body) as { data?: Array<{ id?: unknown }> }).data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string');
    return ids.find((id) => /haiku/i.test(id)) ?? ids[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * İki adım: `GET /v1/models` anahtarı tanır (ücretsiz), ama hesapta kredi olmasa da 200 döner. Kredi ancak
 * gerçek bir mesaj isteğiyle görülür: en ucuz modele 1 token'lık istek (kredi yoksa 400 "credit balance is
 * too low"; varsa maliyeti bir kuruşun çok altında). İkinci adım karar veremezse "anahtar tanındı" denir.
 */
async function testAnthropic(key: string, options: ProviderCallOptions): Promise<ProviderTestResult> {
  const list = await call(`${ANTHROPIC_BASE}/v1/models?limit=100`, { headers: anthropicHeaders(key) }, options);
  const listBody = await readBody(list.response);
  if (!list.response.ok) return classify(list.response.status, listBody, key, list.latencyMs);
  const recognized = (latencyMs: number, detail = ''): ProviderTestResult => ({
    status: 'valid',
    message: `${ANTHROPIC_TEST_MESSAGES.recognized}${detail}`,
    httpStatus: 200,
    latencyMs,
  });
  const model = cheapestModel(listBody);
  if (!model) return recognized(list.latencyMs);

  let probe: Awaited<ReturnType<typeof call>>;
  try {
    probe = await call(
      `${ANTHROPIC_BASE}/v1/messages`,
      {
        method: 'POST',
        headers: { ...anthropicHeaders(key), 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Merhaba' }] }),
      },
      options,
    );
  } catch {
    return recognized(list.latencyMs);
  }
  const latencyMs = list.latencyMs + probe.latencyMs;
  const status = probe.response.status;
  if (probe.response.ok) return { status: 'valid', message: ANTHROPIC_TEST_MESSAGES.valid, httpStatus: status, latencyMs };
  const body = await readBody(probe.response);
  if (/credit balance|billing|purchase credits/i.test(body)) {
    return {
      status: 'insufficient_plan',
      message: `${ANTHROPIC_TEST_MESSAGES.noCredit} (${status}): ${summarizeBody(body, key)}`,
      httpStatus: status,
      latencyMs,
    };
  }
  if (status === 401 || status === 403) return classify(status, body, key, latencyMs);
  // Hız sınırı, aşırı yük ya da modele özgü 400: anahtar tanındı, kredi bilinmiyor.
  const snippet = summarizeBody(body, key);
  return recognized(latencyMs, snippet ? ` (${status}): ${snippet}` : '');
}

async function testOpenAi(key: string, options: ProviderCallOptions): Promise<ProviderTestResult> {
  const { response, latencyMs } = await call(
    `${OPENAI_BASE}/v1/models`,
    { headers: { authorization: `Bearer ${key}` } },
    options,
  );
  const body = response.ok ? '' : await readBody(response);
  const result = classify(response.status, body, key, latencyMs);
  if (response.status === 429 && /insufficient_quota/i.test(body)) {
    return { ...result, status: 'insufficient_plan', message: `Kota/plan yetersiz (429): ${summarizeBody(body, key)}` };
  }
  return result;
}

async function testGemini(key: string, options: ProviderCallOptions): Promise<ProviderTestResult> {
  const { response, latencyMs } = await call(
    `${GEMINI_BASE}/v1beta/models?pageSize=1`,
    { headers: { 'x-goog-api-key': key } },
    options,
  );
  const body = response.ok ? '' : await readBody(response);
  // Gemini geçersiz anahtarı 400 + API_KEY_INVALID ile bildirir.
  if (response.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) {
    return { status: 'invalid', message: `Anahtar reddedildi (400): ${summarizeBody(body, key)}`, httpStatus: 400, latencyMs };
  }
  return classify(response.status, body, key, latencyMs);
}

async function testElevenLabs(key: string, options: ProviderCallOptions): Promise<ProviderTestResult> {
  const sub = await call(`${ELEVENLABS_BASE}/v1/user/subscription`, { headers: elevenHeaders(key) }, options);
  const subBody = await readBody(sub.response);
  if (!sub.response.ok) return classify(sub.response.status, subBody, key, sub.latencyMs);
  let tier = '';
  try {
    tier = String((JSON.parse(subBody) as { tier?: unknown }).tier ?? '');
  } catch {
    // abonelik gövdesi okunamasa da seslendirme denemesi asıl kanıttır
  }
  // Abonelik ucu ücretsiz planda da 200 döner; seslendirme yetkisini ancak küçük bir deneme gösterir.
  const voiceId = options.elevenLabs?.voiceId || ELEVENLABS_DEFAULT_VOICE;
  const tts = await synthesizeElevenLabs(key, { text: 'Test.', voiceId, model: options.elevenLabs?.model }, options);
  const latencyMs = sub.latencyMs + tts.latencyMs;
  const plan = tier ? ` (plan: ${tier})` : '';
  const voice = options.elevenLabs?.voiceId ? `seçili ses ${voiceId}` : 'varsayılan ses';
  if (tts.ok) {
    return { status: 'valid', message: `Geçerli${plan}; seslendirme çalışıyor (${voice}).`, httpStatus: 200, latencyMs };
  }
  if (tts.httpStatus === 402) {
    return {
      status: 'insufficient_plan',
      message: `Anahtar geçerli${plan} ama ${voice} için plan yetersiz (402): ${tts.message}`,
      httpStatus: 402,
      latencyMs,
    };
  }
  if (tts.httpStatus === null) return { status: 'unreachable', message: tts.message, httpStatus: null, latencyMs };
  const classified = classify(tts.httpStatus, tts.message, key, latencyMs);
  return { ...classified, message: `Seslendirme denemesi: ${classified.message}` };
}

// ───────────────────────────── OpenAI uyumlu sağlayıcılar (G8) ─────────────────────────────

/** Bulut sınamasının sonuç metinleri; Yönetim arayüzü durumu bunlardan tanır. */
export const CLOUD_TEST_MESSAGES = {
  valid: 'Geçerli; hesapta kredi var.',
  validNoBalanceInfo: 'Geçerli; anahtar kabul edildi.',
  noCredit: 'Anahtar geçerli ama hesapta kredi yok.',
  recognized: 'Anahtar tanındı. Kredi durumu ilk konuşmada belli olur.',
  noBase: 'Sağlayıcının adresi tanımlı değil; Yönetim › Beyin › Bulut sağlayıcıları bölümünden adres girin.',
} as const;

const bearer = (key: string, endpoint: CloudEndpoint) => ({ authorization: `Bearer ${key}`, ...compatFor(endpoint, endpoint.model).headers });

/**
 * Sağlayıcının anahtarı tanıyan ve (biliniyorsa) bakiyeyi gösteren ücretsiz ucu: OpenRouter `/key` (`/models` herkese
 * açık, anahtarı sınamaz), Moonshot `/users/me/balance`; ötekilerde model listesi.
 */
async function testCloud(endpoint: CloudEndpoint, key: string, options: ProviderCallOptions): Promise<ProviderTestResult> {
  const base = trimBase(endpoint.baseUrl);
  if (!base) return { status: 'invalid', message: CLOUD_TEST_MESSAGES.noBase, httpStatus: null, latencyMs: 0 };
  const compat = compatFor(endpoint, endpoint.model);
  const fail = (status: number, body: string, latencyMs: number): ProviderTestResult => {
    const kind = classifyCloudHttpError(status, body);
    const detail = summarizeBody(body, key);
    if (kind === 'billing') return { status: 'no_credit', message: `${CLOUD_TEST_MESSAGES.noCredit} (${status})${detail ? `: ${detail}` : ''}`, httpStatus: status, latencyMs };
    return classify(status, body, key, latencyMs);
  };
  if (endpoint.preset === 'openrouter') {
    const { response, latencyMs } = await call(`${base}/key`, { headers: bearer(key, endpoint) }, options);
    const body = await readBody(response);
    if (!response.ok) return fail(response.status, body, latencyMs);
    const data = (safeJson(body) as { data?: { limit_remaining?: number | null; is_free_tier?: boolean } } | null)?.data;
    if (typeof data?.limit_remaining === 'number' && data.limit_remaining <= 0) {
      return { status: 'no_credit', message: `${CLOUD_TEST_MESSAGES.noCredit} Yalnız ":free" modeller çalışır.`, httpStatus: 200, latencyMs };
    }
    const credits = await call(`${base}/credits`, { headers: bearer(key, endpoint) }, options).catch(() => null);
    if (credits?.response.ok) {
      const total = (safeJson(await readBody(credits.response)) as { data?: { total_credits?: number; total_usage?: number } } | null)?.data;
      if (typeof total?.total_credits === 'number' && typeof total.total_usage === 'number' && total.total_credits - total.total_usage <= 0) {
        return { status: 'no_credit', message: `${CLOUD_TEST_MESSAGES.noCredit} Yalnız ":free" modeller çalışır.`, httpStatus: 200, latencyMs: latencyMs + credits.latencyMs };
      }
      return { status: 'valid', message: CLOUD_TEST_MESSAGES.valid, httpStatus: 200, latencyMs: latencyMs + credits.latencyMs };
    }
    return { status: 'valid', message: CLOUD_TEST_MESSAGES.validNoBalanceInfo, httpStatus: 200, latencyMs };
  }
  if (endpoint.preset === 'moonshot') {
    const { response, latencyMs } = await call(`${base}/users/me/balance`, { headers: bearer(key, endpoint) }, options);
    const body = await readBody(response);
    if (!response.ok) return fail(response.status, body, latencyMs);
    const balance = (safeJson(body) as { data?: { available_balance?: number } } | null)?.data?.available_balance;
    if (typeof balance === 'number' && balance <= 0) return { status: 'no_credit', message: `${CLOUD_TEST_MESSAGES.noCredit} (bakiye ${balance})`, httpStatus: 200, latencyMs };
    return { status: 'valid', message: typeof balance === 'number' ? CLOUD_TEST_MESSAGES.valid : CLOUD_TEST_MESSAGES.validNoBalanceInfo, httpStatus: 200, latencyMs };
  }
  const { response, latencyMs } = await call(`${base}${compat.modelsPath}`, { headers: bearer(key, endpoint) }, options);
  const body = await readBody(response);
  if (!response.ok) {
    // Model listesi olmayan özel sunucu (404): anahtar hakkında bir şey söylenemez; tanındı sayılmaz, açıkça yazılır.
    if (response.status === 404 && endpoint.preset === 'custom') {
      return { status: 'recognized', message: 'Sunucuya ulaşıldı ama model listesi ucu yok (404); anahtar ilk konuşmada sınanır.', httpStatus: 404, latencyMs };
    }
    return fail(response.status, body, latencyMs);
  }
  // OpenAI: liste ücretsizdir ama kota/kredi yalnız üretimde görülür; seçili modele 1 tokenlık istek (bir kuruşun çok altı).
  if (endpoint.preset === 'openai') {
    try {
      const probe = await call(
        `${base}/chat/completions`,
        {
          method: 'POST',
          headers: { ...bearer(key, endpoint), 'content-type': 'application/json' },
          body: JSON.stringify({ model: endpoint.model, messages: [{ role: 'user', content: 'Merhaba' }], [compat.maxTokensField]: 16 }),
        },
        options,
      );
      const probeBody = await readBody(probe.response);
      const total = latencyMs + probe.latencyMs;
      if (probe.response.ok) return { status: 'valid', message: CLOUD_TEST_MESSAGES.valid, httpStatus: 200, latencyMs: total };
      const kind = classifyCloudHttpError(probe.response.status, probeBody);
      if (kind === 'billing') return fail(probe.response.status, probeBody, total);
      if (kind === 'auth') return classify(probe.response.status, probeBody, key, total);
      const detail = summarizeBody(probeBody, key);
      return { status: 'recognized', message: `${CLOUD_TEST_MESSAGES.recognized} (${probe.response.status})${detail ? `: ${detail}` : ''}`, httpStatus: probe.response.status, latencyMs: total };
    } catch {
      return { status: 'recognized', message: CLOUD_TEST_MESSAGES.recognized, httpStatus: 200, latencyMs };
    }
  }
  // Özel adres: kredi/bakiye ucu bilinmiyor.
  return { status: 'recognized', message: CLOUD_TEST_MESSAGES.recognized, httpStatus: 200, latencyMs };
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/** Kasadaki anahtarla OpenAI uyumlu sağlayıcının model listesi (seçici satırları; fiyat ve yetenek biliniyorsa). */
export async function listCloudModels(endpoint: CloudEndpoint, key: string, options: ProviderCallOptions = {}): Promise<CloudModelInfo[]> {
  const base = trimBase(endpoint.baseUrl);
  if (!base) throw new ProviderRequestError(CLOUD_TEST_MESSAGES.noBase, null);
  const raw = await getJson(`${base}${compatFor(endpoint, endpoint.model).modelsPath}`, bearer(key, endpoint), key, options);
  return parseCloudModels(endpoint.preset, raw);
}

/** Anahtarı sağlayıcının en ucuz gerçek çağrısıyla sınar. Hiç fırlatmaz. */
export async function testProviderKey(
  provider: KeyProvider,
  key: string,
  options: ProviderCallOptions = {},
): Promise<ProviderTestResult> {
  const started = performance.now();
  try {
    switch (provider) {
      case 'anthropic':
        return await testAnthropic(key, options);
      case 'elevenlabs':
        return await testElevenLabs(key, options);
      case 'gemini':
        return await testGemini(key, options);
      case 'openai':
        // Eski davranış (OpenAI anahtarı ses motoru içindi) kayıt yoksa sürer; kayıt varsa bulut sınaması.
        return options.endpoint ? await testCloud(options.endpoint, key, options) : await testOpenAi(key, options);
      default:
        if (!CLOUD_KEY_IDS.includes(provider)) throw new Error(`bilinmeyen sağlayıcı: ${provider}`);
        if (!options.endpoint) return { status: 'invalid', message: CLOUD_TEST_MESSAGES.noBase, httpStatus: null, latencyMs: 0 };
        return await testCloud(options.endpoint, key, options);
    }
  } catch (error) {
    return networkFailure(error, started, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

async function getJson(url: string, headers: Record<string, string>, key: string, options: ProviderCallOptions) {
  let result: Awaited<ReturnType<typeof call>>;
  const started = performance.now();
  try {
    result = await call(url, { headers }, options);
  } catch (error) {
    const failure = networkFailure(error, started, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    throw new ProviderRequestError(failure.message, null);
  }
  const body = await readBody(result.response);
  if (!result.response.ok) {
    const failure = classify(result.response.status, body, key, result.latencyMs);
    throw new ProviderRequestError(failure.message, result.response.status);
  }
  return JSON.parse(body) as unknown;
}

/** `GET /v1/models`, bütün sayfalar. */
export async function listAnthropicModels(key: string, options: ProviderCallOptions = {}): Promise<ProviderModel[]> {
  const out: ProviderModel[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url: string = `${ANTHROPIC_BASE}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
    const body = (await getJson(url, anthropicHeaders(key), key, options)) as {
      data?: Array<{ id?: unknown; display_name?: unknown; created_at?: unknown }>;
      has_more?: boolean;
      last_id?: string | null;
    };
    for (const m of body.data ?? []) {
      if (typeof m.id !== 'string') continue;
      out.push({
        id: m.id,
        displayName: typeof m.display_name === 'string' ? m.display_name : m.id,
        createdAt: typeof m.created_at === 'string' ? m.created_at : null,
      });
    }
    if (!body.has_more || !body.last_id) break;
    after = body.last_id;
  }
  return out;
}

/** `GET /v1/voices`. */
export async function listElevenLabsVoices(key: string, options: ProviderCallOptions = {}): Promise<ProviderVoice[]> {
  const body = (await getJson(`${ELEVENLABS_BASE}/v1/voices`, elevenHeaders(key), key, options)) as {
    voices?: Array<{
      voice_id?: unknown;
      name?: unknown;
      category?: unknown;
      preview_url?: unknown;
      labels?: { language?: unknown } | null;
    }>;
  };
  return (body.voices ?? [])
    .filter((v) => typeof v.voice_id === 'string')
    .map((v) => ({
      voiceId: String(v.voice_id),
      name: typeof v.name === 'string' ? v.name : String(v.voice_id),
      category: typeof v.category === 'string' ? v.category : null,
      previewUrl: typeof v.preview_url === 'string' ? v.preview_url : null,
      language: typeof v.labels?.language === 'string' ? v.labels.language : null,
    }));
}

export interface SynthesisResult {
  ok: boolean;
  message: string;
  httpStatus: number | null;
  latencyMs: number;
  audio: Buffer | null;
  mimeType: string | null;
}

/** Kısa bir ElevenLabs seslendirmesi (Yönetim'deki "Dene" ve anahtar sınaması). Hiç fırlatmaz. */
export async function synthesizeElevenLabs(
  key: string,
  request: { text: string; voiceId?: string; model?: string },
  options: ProviderCallOptions = {},
): Promise<SynthesisResult> {
  const voiceId = request.voiceId || ELEVENLABS_DEFAULT_VOICE;
  const started = performance.now();
  try {
    const { response, latencyMs } = await call(
      `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: { ...elevenHeaders(key), 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text: request.text, model_id: request.model || ELEVENLABS_DEFAULT_MODEL }),
      },
      options,
    );
    if (!response.ok) {
      const body = await readBody(response);
      return {
        ok: false,
        message: summarizeBody(body, key) || `HTTP ${response.status}`,
        httpStatus: response.status,
        latencyMs,
        audio: null,
        mimeType: null,
      };
    }
    const audio = Buffer.from(await response.arrayBuffer());
    return { ok: true, message: 'Seslendirildi.', httpStatus: response.status, latencyMs, audio, mimeType: 'audio/mpeg' };
  } catch (error) {
    const failure = networkFailure(error, started, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return { ok: false, message: failure.message, httpStatus: null, latencyMs: failure.latencyMs, audio: null, mimeType: null };
  }
}
