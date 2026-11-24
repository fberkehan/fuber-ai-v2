// OpenAI uyumlu bulut sağlayıcı (G8): OpenAI, OpenRouter, Moonshot (Kimi), özel adres (Chat Completions). Akışlı (SSE), araçlı (paralel dahil), görsel girdi (destekleyen modelde), kullanım
// sayımı, iptal, zaman aşımı ve hata türü. Sağlayıcı farkları `@fuber/shared` › `compatFor` içinde; burada uygulanır.
// Bağımlılık yok: `fetch`. Akış ayrıştırması yerel sağlayıcıyla ortak (`openai-stream.ts`).
import {
  classifyCloudHttpError,
  cloudCost,
  compatFor,
  redactBody,
  trimBase,
  type BrainImage,
  type CloudCompat,
  type CloudEndpoint,
  type CloudErrorKind,
  type Effort,
  type ModelPrice,
} from '@fuber/shared';
import { TagFilter } from './local';
import { ChatCompletionAccumulator, sseEvents } from './openai-stream';
import type { BrainProvider, ConvMessage, ProviderStop, ProviderTurnRequest, ProviderTurnResult, ToolSpec } from './types';

/** Sağlayıcı hatası: döngü bunu Türkçe cümleye ve "yerele düş" kararına çevirir (`brain/errors.ts`). */
export class CloudProviderError extends Error {
  /** Sağlayıcının görünen adı ("OpenRouter"); kullanıcı cümlesinde geçer. */
  provider = '';
  constructor(
    readonly kind: CloudErrorKind,
    message: string,
    readonly status: number | null,
    /** Hata gelmeden önce kullanıcıya metin aktı mı (yarıda kopma). */
    readonly partial = false,
  ) {
    super(message);
    this.name = 'CloudProviderError';
  }
}

/** Sağlayıcı hatasına görünen adı ekler. */
function named<T>(name: string, run: () => Promise<T>): Promise<T> {
  return run().catch((error: unknown) => {
    if (error instanceof CloudProviderError) error.provider = name;
    throw error;
  });
}

export interface OpenAiCompatibleOptions {
  endpoint: CloudEndpoint;
  apiKey: string;
  model: string;
  effort: Effort | null;
  thinking: 'adaptive' | 'off';
  price?: ModelPrice | undefined;
  fetchFn?: typeof fetch;
  /** İlk yanıt başlıkları için bekleme (ms). */
  timeoutMs?: number;
  /** Akışta iki parça arasında en uzun sessizlik (ms); aşılırsa akış kopmuş sayılır. */
  idleMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_MS = 90_000;
const IMAGE_PLACEHOLDER = '[eski görsel]';
const NO_VISION_NOTE = '(Bu iletiye eklenen görseli göremiyorsun; kullanıcıya bunu söyle.)';

/**
 * 400 dönen isteğin uyarlaması: sağlayıcı bir alanı tanımıyorsa (eski sunucu `stream_options`'ı, yeni OpenAI modeli
 * `max_tokens`'ı reddeder) alan değiştirilip istek bir kez yinelenir; öğrenilen uyarlama aynı adres + model için saklanır.
 */
const learned = new Map<string, Set<string>>();

type Body = Record<string, unknown>;

function adaptFor400(body: Body, detail: string): { body: Body; rule: string } | null {
  const text = detail.toLowerCase();
  const mentions = (field: string) => text.includes(field);
  if ('max_tokens' in body && /max_completion_tokens/.test(text)) {
    const { max_tokens: value, ...rest } = body;
    return { body: { ...rest, max_completion_tokens: value }, rule: 'use_max_completion_tokens' };
  }
  if ('max_completion_tokens' in body && mentions('max_completion_tokens')) {
    const { max_completion_tokens: value, ...rest } = body;
    return { body: { ...rest, max_tokens: value }, rule: 'use_max_tokens' };
  }
  for (const field of ['stream_options', 'reasoning_effort', 'reasoning', 'temperature', 'parallel_tool_calls', 'usage']) {
    if (field in body && mentions(field)) {
      const { [field]: _dropped, ...rest } = body;
      return { body: rest, rule: `drop_${field}` };
    }
  }
  return null;
}

function applyLearned(body: Body, rules: Set<string> | undefined): Body {
  if (!rules) return body;
  let out = body;
  for (const rule of rules) {
    if (rule === 'use_max_completion_tokens' && 'max_tokens' in out) {
      const { max_tokens: value, ...rest } = out;
      out = { ...rest, max_completion_tokens: value };
    } else if (rule === 'use_max_tokens' && 'max_completion_tokens' in out) {
      const { max_completion_tokens: value, ...rest } = out;
      out = { ...rest, max_tokens: value };
    } else if (rule.startsWith('drop_')) {
      const { [rule.slice(5)]: _dropped, ...rest } = out;
      out = rest;
    }
  }
  return out;
}

/** JSON şemasından sağlayıcıların tanımadığı anahtarları ayıklar (`strict`: Gemini arka uçları). */
export function sanitizeSchema(schema: unknown, mode: CloudCompat['schemaMode']): unknown {
  if (Array.isArray(schema)) return schema.map((item) => sanitizeSchema(item, mode));
  if (!schema || typeof schema !== 'object') return schema;
  const drop = mode === 'strict' ? new Set(['$schema', '$id', 'additionalProperties', 'default', 'examples', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'maxItems', 'exclusiveMinimum', 'exclusiveMaximum', 'const']) : new Set(['$schema', '$id']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (drop.has(key)) {
      // `const` sıkı kipte tek değerli `enum` olur (anlam korunur).
      if (key === 'const' && mode === 'strict') out.enum = [value];
      continue;
    }
    out[key] = key === 'properties' && value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, sanitizeSchema(sub, mode)]))
      : sanitizeSchema(value, mode);
  }
  return out;
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Part[] }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Kural: görsel yalnız destekleyen modele gider; en çok `maxImages` görsel (en yeniler), eskileri yer tutucuya döner. */
export function toWireMessages(
  system: ProviderTurnRequest['system'],
  messages: ConvMessage[],
  options: { vision: boolean; maxImages: number | null; dialect: CloudCompat['dialect'] },
): WireMessage[] {
  const out: WireMessage[] = [];
  if (system && options.dialect === 'openai') out.push({ role: 'system', content: system.tail ? `${system.stable}\n\n${system.tail}` : system.stable });
  let budget = options.maxImages ?? Number.POSITIVE_INFINITY;
  const allowed = new Set<BrainImage>();
  if (options.vision) {
    for (let i = messages.length - 1; i >= 0 && budget > 0; i--) {
      const message = messages[i]!;
      if (message.role !== 'user') continue;
      for (const image of [...(message.images ?? [])].reverse()) {
        if (budget <= 0) break;
        allowed.add(image);
        budget--;
      }
    }
  }
  for (const message of messages) {
    if (message.role === 'user') {
      const images = message.images ?? [];
      if (images.length === 0) {
        out.push({ role: 'user', content: message.text });
        continue;
      }
      if (!options.vision) {
        out.push({ role: 'user', content: `${message.text}\n${NO_VISION_NOTE}` });
        continue;
      }
      const parts: Part[] = [{ type: 'text', text: message.text }];
      for (const image of images) {
        parts.push(allowed.has(image) ? { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } } : { type: 'text', text: IMAGE_PLACEHOLDER });
      }
      out.push({ role: 'user', content: parts });
    } else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        // OpenAI araç çağrılı iletide `null` içerik bekler.
        content: message.text || null,
        ...(message.toolCalls.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: typeof call.input === 'string' ? call.input : JSON.stringify(call.input) },
              })),
            }
          : {}),
      });
    } else {
      for (const result of message.results) {
        out.push({ role: 'tool', tool_call_id: result.id, content: result.isError ? `HATA: ${result.content}` : result.content || '(boş)' });
      }
    }
  }
  return out;
}

function mapEffort(effort: Effort | null, thinking: 'adaptive' | 'off'): 'low' | 'medium' | 'high' | null {
  // Akıl yürüten model düşünmeyi kapatamaz: "kapalı" en düşük eforla yaklaşılır.
  if (thinking === 'off') return 'low';
  if (!effort) return null;
  return effort === 'xhigh' || effort === 'max' ? 'high' : effort;
}

export interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: Body;
  compat: CloudCompat;
}

/** İsteğin tamamı (saf; kayıtlı örneklerle sınanır). */
export function buildChatRequest(options: Pick<OpenAiCompatibleOptions, 'endpoint' | 'apiKey' | 'model' | 'effort' | 'thinking'>, request: Pick<ProviderTurnRequest, 'system' | 'messages' | 'tools' | 'maxTokens' | 'requireTool'>, stream: boolean): WireRequest {
  const compat = compatFor(options.endpoint, options.model);
  const caps = options.endpoint.caps;
  const tools: ToolSpec[] = caps.tools ? request.tools : [];
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.apiKey}`,
    'content-type': 'application/json',
    accept: stream ? 'text/event-stream' : 'application/json',
    ...compat.headers,
  };
  const url = `${trimBase(options.endpoint.baseUrl)}${compat.chatPath}`;
  const messages = toWireMessages(request.system, request.messages, { vision: caps.vision, maxImages: compat.maxImages, dialect: compat.dialect });
  const effort = compat.effortField ? mapEffort(options.effort, options.thinking) : null;
  const maxTokens = Math.max(request.maxTokens, compat.minMaxTokens);
  const body: Body = {
    model: options.model,
    messages,
    stream,
    ...(stream && compat.streamUsage ? { stream_options: { include_usage: true } } : {}),
    [compat.maxTokensField]: maxTokens,
    ...(compat.temperature !== null ? { temperature: compat.temperature } : {}),
    ...(effort && compat.effortField === 'reasoning_effort' ? { reasoning_effort: effort } : {}),
    ...(effort && compat.effortField === 'reasoning' ? { reasoning: { effort } } : {}),
    ...(compat.usageCost ? { usage: { include: true } } : {}),
    ...(tools.length
      ? {
          tools: tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: sanitizeSchema(tool.inputSchema, compat.schemaMode) },
          })),
          tool_choice: request.requireTool ? 'required' : 'auto',
        }
      : {}),
  };
  return { url, headers, body, compat };
}

const learnKey = (options: Pick<OpenAiCompatibleOptions, 'endpoint' | 'model'>) => `${trimBase(options.endpoint.baseUrl)}|${options.model}`;

/** İstek gönderir; 400'de bir kez uyarlayıp yineler. Başarısız yanıt `CloudProviderError` olur. */
async function send(
  options: OpenAiCompatibleOptions,
  wire: WireRequest,
  signal: AbortSignal | undefined,
): Promise<{ response: Response; abort: AbortController; clear: () => void }> {
  const doFetch = options.fetchFn ?? fetch;
  let body = applyLearned(wire.body, learned.get(learnKey(options)));
  for (let attempt = 0; ; attempt++) {
    const abort = new AbortController();
    const onAbort = () => abort.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort(new Error('timeout'));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const clear = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    let response: Response;
    try {
      response = await doFetch(wire.url, { method: 'POST', headers: wire.headers, body: JSON.stringify(body), signal: abort.signal });
    } catch (error) {
      clear();
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new CloudProviderError('timeout', `${options.endpoint.name}: yanıt ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} sn içinde gelmedi`, null);
      throw new CloudProviderError('network', `${options.endpoint.name}: bağlanılamadı (${describeNetwork(error)})`, null);
    }
    clearTimeout(timer);
    if (response.ok) return { response, abort, clear };
    const detail = await response.text().catch(() => '');
    clear();
    if (response.status === 400 && attempt === 0) {
      const adapted = adaptFor400(body, detail);
      if (adapted) {
        const rules = learned.get(learnKey(options)) ?? new Set<string>();
        rules.add(adapted.rule);
        learned.set(learnKey(options), rules);
        body = adapted.body;
        continue;
      }
    }
    const kind = classifyCloudHttpError(response.status, detail);
    throw new CloudProviderError(kind, `${options.endpoint.name} ${response.status}: ${redactBody(detail, options.apiKey)}`, response.status);
  }
}

function describeNetwork(error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code ?? (error instanceof Error ? error.message : String(error));
}

function abortError(): Error {
  return Object.assign(new Error('İstek iptal edildi.'), { name: 'AbortError' });
}

/** Akışı parça parça okur; iki parça arası `idleMs`'i aşarsa kopmuş sayar. */
async function* withIdle<T>(source: AsyncGenerator<T>, idleMs: number, abort: AbortController): AsyncGenerator<T> {
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<'idle'>((resolve) => {
      timer = setTimeout(() => resolve('idle'), idleMs);
    });
    const next = await Promise.race([source.next(), idle]).finally(() => clearTimeout(timer));
    if (next === 'idle') {
      abort.abort(new Error('idle'));
      throw new CloudProviderError('stream_cut', `akış ${Math.round(idleMs / 1000)} sn sessiz kaldı`, null);
    }
    if (next.done) return;
    yield next.value;
  }
}

export function openAiCompatibleProvider(options: OpenAiCompatibleOptions): BrainProvider {
  return {
    id: 'openai-compatible',
    turn: (request) => named(options.endpoint.name, () => cloudTurn(options, request)),
  };
}

async function cloudTurn(options: OpenAiCompatibleOptions, request: ProviderTurnRequest): Promise<ProviderTurnResult> {
  const stream = options.endpoint.caps.stream;
  const wire = buildChatRequest(options, request, stream);
  const { response, abort, clear } = await send(options, wire, request.signal);
  const filter = new TagFilter();
  let text = '';
  const emit = (piece: string) => {
    if (!piece) return;
    text += piece;
    request.onText(piece);
  };
  const acc = new ChatCompletionAccumulator((piece) => emit(filter.push(piece)));
  let sawEnd = false;
  try {
    const isJson = /application\/json/i.test(response.headers.get('content-type') ?? '');
    if (!stream || isJson || !response.body) {
      // Akışsız yanıt (yetenek kapalı ya da sunucu akışı desteklemiyor): tek gövde.
      const raw = await response.text();
      const parsed = parseJson(raw);
      {
        const choice = (parsed?.choices as Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }> | undefined)?.[0];
        if (!choice) throw new CloudProviderError('bad_request', `${options.endpoint.name}: yanıtta seçim yok (${redactBody(raw, options.apiKey, 160)})`, response.status);
        emit(filter.push(choice.message?.content ?? ''));
        for (const call of choice.message?.tool_calls ?? []) acc.addToolCall({ id: call.id, name: call.function.name, arguments: call.function.arguments });
        acc.finish = choice.finish_reason ?? 'stop';
        acc.push(JSON.stringify({ usage: parsed?.usage, model: parsed?.model }));
      }
      sawEnd = true;
    } else {
      for await (const event of withIdle(sseEvents(response.body), options.idleMs ?? DEFAULT_IDLE_MS, abort)) {
        if (event.data.trim() === '[DONE]') {
          sawEnd = true;
          continue;
        }
        acc.push(event.data.trim());
        if (acc.error) {
          const status = Number(acc.error.code);
          const kind = Number.isFinite(status) && status >= 400 ? classifyCloudHttpError(status, acc.error.message) : classifyCloudHttpError(500, `${acc.error.code} ${acc.error.message}`);
          throw new CloudProviderError(kind, `${options.endpoint.name}: ${redactBody(acc.error.message || acc.error.code, options.apiKey)}`, Number.isFinite(status) ? status : null, text.length > 0);
        }
      }
    }
  } catch (error) {
    abort.abort();
    if (request.signal?.aborted) throw abortError();
    if (error instanceof CloudProviderError) throw error.partial || !text ? error : new CloudProviderError(error.kind, error.message, error.status, true);
    throw new CloudProviderError('stream_cut', `${options.endpoint.name}: akış koptu (${describeNetwork(error)})`, null, text.length > 0);
  } finally {
    clear();
  }
  // Kesilen akış SDK'larda hata vermeden biter (Fuber AI 1, Görev 19): iptal açıkça bildirilir.
  if (request.signal?.aborted) throw abortError();
  emit(filter.flush());
  if (!sawEnd && !acc.finish) {
    throw new CloudProviderError('stream_cut', `${options.endpoint.name}: akış bitmeden kapandı`, null, text.length > 0);
  }

  const toolCalls = acc.toolCalls();
  for (const raw of filter.toolCalls) {
    const value = parseJson(raw) as { name?: string; arguments?: unknown } | null;
    if (value?.name) toolCalls.push({ id: `call_text_${toolCalls.length}`, name: value.name, input: value.arguments ?? {} });
  }
  let stop: ProviderStop = 'end';
  if (toolCalls.length) stop = 'tool_use';
  else if (acc.finish === 'length') stop = 'max_tokens';
  else if (acc.finish === 'content_filter') stop = 'refusal';

  const usage = acc.usage ?? { input: 0, output: 0, cachedInput: 0, costUsd: null };
  // OpenRouter gerçek maliyeti verir; ötekilerde rolün fiyatından hesaplanır (yoksa "bilinmiyor").
  const cost = usage.costUsd ?? cloudCost(options.price, { input: usage.input, output: usage.output, cachedInput: usage.cachedInput });
  return {
    text,
    toolCalls,
    stop,
    usage: {
      provider: options.endpoint.id,
      model: acc.model ?? options.model,
      inputTokens: Math.max(0, usage.input - usage.cachedInput),
      outputTokens: usage.output,
      cacheReadTokens: usage.cachedInput,
      cacheWriteTokens: 0,
      costUsd: cost,
    },
  };
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Yapılandırılmış çıkarım (hafıza rolü): akışsız istek, `response_format: json_schema`; sağlayıcı tanımıyorsa
 * `json_object` + şemayı istemde vererek bir kez yinelenir.
 */
export type ExtractOptions = OpenAiCompatibleOptions & { system: string; input: string; schema: Record<string, unknown>; images?: BrainImage[]; maxTokens: number; signal?: AbortSignal };

export function openAiCompatibleExtract(options: ExtractOptions): Promise<{ raw: string; usage: ProviderTurnResult['usage'] }> {
  return named(options.endpoint.name, () => extractOnce(options));
}

async function extractOnce(options: ExtractOptions): Promise<{ raw: string; usage: ProviderTurnResult['usage'] }> {
  const schemaNote = `\n\nYanıtın YALNIZ şu JSON şemasına uyan tek bir JSON nesnesi olsun, başka metin yazma:\n${JSON.stringify(options.schema)}`;
  const messages: ConvMessage[] = [{ role: 'user', text: options.input, ...(options.images?.length ? { images: options.images } : {}) }];
  const compat = compatFor(options.endpoint, options.model);
  const base = buildChatRequest(options, { system: { stable: options.system, tail: '' }, messages, tools: [], maxTokens: options.maxTokens }, false);
  const wire: WireRequest = { ...base, body: { ...base.body, response_format: { type: 'json_schema', json_schema: { name: 'output', schema: options.schema, strict: false } } } };
  let result: Awaited<ReturnType<typeof send>>;
  try {
    result = await send(options, wire, options.signal);
  } catch (error) {
    if (!(error instanceof CloudProviderError) || error.kind !== 'bad_request') throw error;
    // `json_schema` tanınmıyor: `json_object` ve şema istemde.
    const fallback = buildChatRequest(options, { system: { stable: options.system + schemaNote, tail: '' }, messages, tools: [], maxTokens: options.maxTokens }, false);
    result = await send(options, { ...fallback, body: { ...fallback.body, response_format: { type: 'json_object' } } }, options.signal);
  }
  try {
    const parsed = parseJson(await result.response.text());
    let raw = '';
    let input = 0;
    let output = 0;
    let cached = 0;
    let reported: number | null = null;
    {
      const choice = (parsed?.choices as Array<{ message?: { content?: string | null } }> | undefined)?.[0];
      raw = choice?.message?.content ?? '';
      const usage = parsed?.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number } | undefined;
      input = usage?.prompt_tokens ?? 0;
      output = usage?.completion_tokens ?? 0;
      cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
      reported = typeof usage?.cost === 'number' ? usage.cost : null;
    }
    // Akıl yürüten modelin `<think>` bloğu ve kod çiti JSON'dan ayıklanır.
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    return {
      raw,
      usage: {
        provider: options.endpoint.id,
        model: options.model,
        inputTokens: Math.max(0, input - cached),
        outputTokens: output,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        costUsd: reported ?? cloudCost(options.price, { input, output, cachedInput: cached }),
      },
    };
  } finally {
    result.clear();
  }
}
