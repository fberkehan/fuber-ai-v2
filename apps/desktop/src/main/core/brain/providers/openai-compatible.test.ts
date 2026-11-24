// OpenAI uyumlu sağlayıcı: kayıtlı örnek yanıtlarla (OpenAI, OpenRouter, Moonshot, özel adres) istek
// biçimi, akış ayrıştırması, paralel araç çağrısı, kullanım, hata türleri, 400 uyarlaması, iptal ve kopma.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOUD_ENDPOINTS, type CloudEndpoint } from '@fuber/shared';
import { buildChatRequest, CloudProviderError, openAiCompatibleExtract, openAiCompatibleProvider, sanitizeSchema, toWireMessages } from './openai-compatible';
import type { ConvMessage, ProviderTurnRequest } from './types';

const endpoint = (preset: CloudEndpoint['preset'], patch: Partial<CloudEndpoint> = {}): CloudEndpoint => ({
  ...(DEFAULT_CLOUD_ENDPOINTS.find((item) => item.preset === preset) ?? { id: 'ozel', preset: 'custom', name: 'Özel', baseUrl: 'http://127.0.0.1:9/v1', keyId: 'custom', model: 'm', caps: { tools: true, vision: false, stream: true } }),
  ...patch,
});

const KEY = 'sk-FAKE-unit-0000000000';

/** Parça parça gelen akış (ağdaki gibi; olay sınırları parçaların ortasına düşebilir). */
function streamOf(pieces: string[], options: { endless?: boolean } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < pieces.length) controller.enqueue(encoder.encode(pieces[i++]!));
      else if (!options.endless) controller.close();
    },
  });
}

const sse = (chunks: unknown[], done = true) => chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
/** Metni rastgele sınırlardan böler (ayrıştırıcı olay ortasında bölünmeye dayanmalı). */
const split = (text: string, size = 7) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function fakeFetch(responses: Array<(call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call = { url, body: JSON.parse(String(init.body)) as Record<string, unknown>, headers: init.headers as Record<string, string> };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error('senaryo bitti');
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return next(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (body: string | ReadableStream<Uint8Array>, type = 'text/event-stream') => () => new Response(body, { status: 200, headers: { 'Content-Type': type } });
const fail = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function turn(overrides: Partial<ProviderTurnRequest> = {}): ProviderTurnRequest & { text: string } {
  const out = {
    system: { stable: 'Sen Jarvis’sin.', tail: 'Saat 10.00.' },
    messages: [{ role: 'user', text: 'Merhaba' }] as ConvMessage[],
    tools: [{ name: 'reminder_create', description: 'Hatırlatıcı kurar.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
    maxTokens: 1024,
    voice: true,
    cacheLoop: false,
    text: '',
    onText(delta: string) {
      out.text += delta;
    },
    ...overrides,
  };
  return out;
}

function provider(preset: CloudEndpoint['preset'], fetchFn: typeof fetch, patch: Partial<CloudEndpoint> = {}, model?: string, extra: { idleMs?: number; timeoutMs?: number } = {}) {
  const ep = endpoint(preset, patch);
  return openAiCompatibleProvider({ endpoint: ep, apiKey: KEY, model: model ?? ep.model, effort: 'medium', thinking: 'adaptive', fetchFn, ...extra });
}

describe('istek biçimi (hazır ayar farkları)', () => {
  const request = turn();
  it('OpenAI akıl yürüten model: max_completion_tokens, reasoning_effort, sıcaklık yok, taban 8192', () => {
    const wire = buildChatRequest({ endpoint: endpoint('openai'), apiKey: KEY, model: 'gpt-5-mini', effort: 'xhigh', thinking: 'adaptive' }, request, true);
    expect(wire.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(wire.body).toMatchObject({ model: 'gpt-5-mini', max_completion_tokens: 8192, reasoning_effort: 'high', stream: true, stream_options: { include_usage: true }, tool_choice: 'auto' });
    expect(wire.body).not.toHaveProperty('temperature');
    expect(wire.body).not.toHaveProperty('max_tokens');
    expect(wire.headers.authorization).toBe(`Bearer ${KEY}`);
    expect((wire.body.messages as Array<{ role: string; content: string }>)[0]).toEqual({ role: 'system', content: 'Sen Jarvis’sin.\n\nSaat 10.00.' });
  });

  it('OpenAI sıradan model: düşünme alanı yok, sıcaklık var', () => {
    const wire = buildChatRequest({ endpoint: endpoint('openai'), apiKey: KEY, model: 'gpt-4.1-mini', effort: 'low', thinking: 'off' }, request, true);
    expect(wire.body).toMatchObject({ max_completion_tokens: 1024, temperature: 0.6 });
    expect(wire.body).not.toHaveProperty('reasoning_effort');
  });

  it('OpenRouter: başlıklar, gerçek maliyet isteği, reasoning.effort; "düşünme kapalı" en düşük efor', () => {
    const wire = buildChatRequest({ endpoint: endpoint('openrouter'), apiKey: KEY, model: 'moonshotai/kimi-k2-thinking', effort: 'high', thinking: 'off' }, request, true);
    expect(wire.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(wire.headers).toMatchObject({ 'X-Title': 'Fuber AI v2' });
    expect(wire.body).toMatchObject({ usage: { include: true }, reasoning: { effort: 'low' }, max_tokens: 8192 });
  });

  it('Moonshot (Kimi K2): max_tokens, sıcaklık 0,6', () => {
    const wire = buildChatRequest({ endpoint: endpoint('moonshot'), apiKey: KEY, model: 'kimi-k2-turbo-preview', effort: null, thinking: 'adaptive' }, request, true);
    expect(wire.url).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(wire.body).toMatchObject({ max_tokens: 1024, temperature: 0.6 });
  });

  it('araç yeteneği kapalı kayıtta araç gönderilmez; zorunlu adımda tool_choice "required"', () => {
    const off = buildChatRequest({ endpoint: endpoint('custom', { caps: { tools: false, vision: false, stream: true } }), apiKey: KEY, model: 'm', effort: null, thinking: 'adaptive' }, request, true);
    expect(off.body).not.toHaveProperty('tools');
    const forced = buildChatRequest({ endpoint: endpoint('custom'), apiKey: KEY, model: 'm', effort: null, thinking: 'adaptive' }, { ...request, requireTool: true }, true);
    expect(forced.body.tool_choice).toBe('required');
  });

  it('görsel: yeteneği olmayan modele gitmez (not düşülür); sınırlı uçta en yeni görseller', () => {
    const image = (n: number) => ({ mediaType: 'image/png', data: `AAA${n}` });
    const messages: ConvMessage[] = [
      { role: 'user', text: 'eski', images: [image(1), image(2)] },
      { role: 'assistant', text: 'tamam', toolCalls: [] },
      { role: 'user', text: 'yeni', images: [image(3), image(4)] },
    ];
    const blind = toWireMessages(null, messages, { vision: false, maxImages: null, dialect: 'openai' });
    expect(JSON.stringify(blind)).not.toContain('image_url');
    expect((blind[0] as { content: string }).content).toContain('görseli göremiyorsun');
    const fuber = toWireMessages(null, messages, { vision: true, maxImages: 3, dialect: 'openai' });
    const urls = JSON.stringify(fuber).match(/data:image\/png;base64,AAA\d/g);
    expect(urls).toEqual(['data:image/png;base64,AAA2', 'data:image/png;base64,AAA3', 'data:image/png;base64,AAA4']);
    expect(JSON.stringify(fuber)).toContain('[eski görsel]');
  });

  it('şema: sıkı kipte (Gemini) tanınmayan anahtarlar ayıklanır, const tek değerli enum olur', () => {
    const schema = { $schema: 'x', type: 'object', additionalProperties: false, properties: { at: { type: 'string', format: 'date-time' }, kind: { const: 'a' } } };
    expect(sanitizeSchema(schema, 'strict')).toEqual({ type: 'object', properties: { at: { type: 'string' }, kind: { enum: ['a'] } } });
    expect(sanitizeSchema(schema, 'plain')).toEqual({ type: 'object', additionalProperties: false, properties: { at: { type: 'string', format: 'date-time' }, kind: { const: 'a' } } });
  });
});

describe('akış (kayıtlı örnekler)', () => {
  it('OpenAI: metin + PARALEL iki araç çağrısı (parçalar iç içe), önbellekli kullanım', async () => {
    const body = sse([
      { model: 'gpt-5-mini-2026', choices: [{ delta: { role: 'assistant', content: 'Kuruyorum' } }] },
      { choices: [{ delta: { content: '.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'reminder_create', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'todo_add', arguments: '{"text":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"text":"KDV"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"Süt al"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1000 } } },
    ]);
    const { fn } = fakeFetch([ok(streamOf(split(body)))]);
    const request = turn();
    const result = await provider('openai', fn, {}, 'gpt-5-mini').turn(request);
    expect(request.text).toBe('Kuruyorum.');
    expect(result.stop).toBe('tool_use');
    expect(result.toolCalls).toEqual([
      { id: 'call_a', name: 'reminder_create', input: { text: 'KDV' } },
      { id: 'call_b', name: 'todo_add', input: { text: 'Süt al' } },
    ]);
    expect(result.usage).toMatchObject({ provider: 'openai', model: 'gpt-5-mini-2026', inputTokens: 200, cacheReadTokens: 1000, outputTokens: 40, costUsd: null });
  });

  it('Moonshot: kullanım seçimin içinde gelir; düşünme alanı (reasoning_content) kullanıcıya gitmez', async () => {
    const body = sse([
      { choices: [{ delta: { reasoning_content: 'Kullanıcı selam veriyor…' } }] },
      { choices: [{ delta: { content: 'Merhaba efendim.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop', usage: { prompt_tokens: 30, completion_tokens: 5, cached_tokens: 10 } }] },
    ]);
    const { fn } = fakeFetch([ok(streamOf(split(body, 11)))]);
    const request = turn();
    const result = await provider('moonshot', fn).turn(request);
    expect(request.text).toBe('Merhaba efendim.');
    expect(result.usage).toMatchObject({ inputTokens: 20, cacheReadTokens: 10, outputTokens: 5 });
  });

  it('OpenRouter: gerçek maliyet (usage.cost) kayda geçer; fiyat tablosu gerekmez', async () => {
    const body = sse([
      { choices: [{ delta: { content: 'Tamam.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 3, cost: 0.000123 } },
    ]);
    const { fn } = fakeFetch([ok(streamOf([body]))]);
    const result = await provider('openrouter', fn).turn(turn());
    expect(result.usage.costUsd).toBeCloseTo(0.000123, 9);
  });

  it('fiyatı verilen modelde maliyet hesaplanır; verilmeyende "bilinmiyor" (null)', async () => {
    const body = sse([{ choices: [{ delta: { content: 'A' }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } }]);
    const priced = fakeFetch([ok(body)]);
    const ep = endpoint('moonshot');
    const result = await openAiCompatibleProvider({ endpoint: ep, apiKey: KEY, model: ep.model, effort: null, thinking: 'adaptive', price: { input: 0.6, output: 2.5 }, fetchFn: priced.fn }).turn(turn());
    expect(result.usage.costUsd).toBeCloseTo(3.1, 6);
    const unpriced = fakeFetch([ok(body)]);
    expect((await provider('moonshot', unpriced.fn).turn(turn())).usage.costUsd).toBeNull();
  });

  it('`index` vermeyen sunucu: farklı kimlikli iki çağrı ayrı kalır; <think> etiketi ayıklanır', async () => {
    const body = sse([
      { choices: [{ delta: { content: '<think>düşünüyor</think>Tamam.' } }] },
      { choices: [{ delta: { tool_calls: [{ id: 'x1', function: { name: 'a_tool', arguments: '{}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ id: 'x2', function: { name: 'b_tool', arguments: '{"n":1}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const { fn } = fakeFetch([ok(body)]);
    const request = turn();
    const result = await provider('custom', fn).turn(request);
    expect(request.text).toBe('Tamam.');
    expect(result.toolCalls.map((call) => call.name)).toEqual(['a_tool', 'b_tool']);
  });

  it('çıktı sınırına takılan akıl yürüten model: boş metin + length → max_tokens', async () => {
    const body = sse([{ choices: [{ delta: {}, finish_reason: 'length' }] }]);
    const { fn } = fakeFetch([ok(body)]);
    expect((await provider('openrouter', fn).turn(turn())).stop).toBe('max_tokens');
  });
});

describe('hata türleri', () => {
  it.each([
    [401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }, 'auth'],
    [402, { error: { message: 'Insufficient credits' } }, 'billing'],
    [429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }, 'billing'],
    [429, { error: { message: 'Your account exceeded_current_quota_error' } }, 'billing'],
    [429, { error: { message: 'Rate limit reached for requests' } }, 'rate_limit'],
    [404, { error: { message: 'The model `kimi-x` does not exist', code: 'model_not_found' } }, 'model'],
    [400, { error: { message: 'No endpoints found for moonshotai/kimi-x.' } }, 'model'],
    [400, { error: { message: "This model's maximum context length is 8192 tokens" } }, 'context'],
    [500, { error: { message: 'upstream' } }, 'server'],
    [503, { error: { message: 'overloaded' } }, 'server'],
  ] as const)('%i %j → %s', async (status, body, kind) => {
    const { fn } = fakeFetch([fail(status, body)]);
    const error = await provider('openai', fn).turn(turn()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudProviderError);
    expect(error).toMatchObject({ kind, status, provider: 'OpenAI' });
    // Anahtar hata iletisine sızmaz.
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it('bağlantı kurulamadı → ağ hatası', async () => {
    const fn = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    await expect(provider('custom', fn).turn(turn())).rejects.toMatchObject({ kind: 'network' });
  });

  it('akış metin aktıktan sonra koptu → stream_cut, partial', async () => {
    const body = sse([{ choices: [{ delta: { content: 'Yarım cüm' } }] }], false);
    const { fn } = fakeFetch([ok(streamOf([body]))]);
    await expect(provider('custom', fn).turn(turn())).rejects.toMatchObject({ kind: 'stream_cut', partial: true });
  });

  it('akış hiç parça gelmeden sustu → zaman aşımıyla kopma (partial değil)', async () => {
    const { fn } = fakeFetch([ok(streamOf([], { endless: true }))]);
    await expect(provider('custom', fn, {}, undefined, { idleMs: 50 }).turn(turn())).rejects.toMatchObject({ kind: 'stream_cut', partial: false });
  });

  it('OpenRouter akış ortası hata nesnesi (402) → kredi hatası', async () => {
    const body = sse([{ choices: [{ delta: { content: 'Ba' } }] }, { error: { code: 402, message: 'Insufficient credits' } }], false);
    const { fn } = fakeFetch([ok(body)]);
    await expect(provider('openrouter', fn).turn(turn())).rejects.toMatchObject({ kind: 'billing', partial: true });
  });
});

describe('uyum: 400 dönen alan çıkarılıp bir kez yinelenir ve öğrenilir', () => {
  it('stream_options tanınmıyor → çıkarılır; sonraki istekte hiç gönderilmez', async () => {
    const good = sse([{ choices: [{ delta: { content: 'Tamam.' }, finish_reason: 'stop' }] }]);
    const { fn, calls } = fakeFetch([fail(400, { error: { message: "Unrecognized request argument supplied: stream_options" } }), ok(good), ok(good)]);
    const p = provider('custom', fn, { baseUrl: 'http://127.0.0.1:9/uyum-1' });
    await p.turn(turn());
    await p.turn(turn());
    expect(calls.map((call) => 'stream_options' in call.body)).toEqual([true, false, false]);
  });

  it('max_tokens yerine max_completion_tokens isteyen model', async () => {
    const good = sse([{ choices: [{ delta: { content: 'Tamam.' }, finish_reason: 'stop' }] }]);
    const { fn, calls } = fakeFetch([fail(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }), ok(good)]);
    await provider('custom', fn, { baseUrl: 'http://127.0.0.1:9/uyum-2' }).turn(turn());
    expect(calls[1]!.body).toHaveProperty('max_completion_tokens', 1024);
    expect(calls[1]!.body).not.toHaveProperty('max_tokens');
  });
});

describe('iptal', () => {
  it('akış sürerken iptal → AbortError (yarım yanıt "tamamlandı" sayılmaz)', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode(sse([{ choices: [{ delta: { content: 'Uzun bir ' } }] }], false)));
        controller.signal.addEventListener('abort', () => stream.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      },
    });
    const { fn } = fakeFetch([ok(body)]);
    const request = turn({ signal: controller.signal, onText: () => controller.abort() });
    await expect(provider('custom', fn).turn(request)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('yapılandırılmış çıkarım (hafıza rolü)', () => {
  it('json_schema tanınmıyorsa json_object + şema istemde; <think> ve kod çiti ayıklanır', async () => {
    const answer = { choices: [{ message: { content: '<think>x</think>```json\n{"facts":["A"]}\n```' } }], usage: { prompt_tokens: 10, completion_tokens: 4 } };
    const { fn, calls } = fakeFetch([fail(400, { error: { message: 'response_format json_schema is not supported' } }), ok(JSON.stringify(answer), 'application/json')]);
    const ep = endpoint('custom', { baseUrl: 'http://127.0.0.1:9/cikarim' });
    const result = await openAiCompatibleExtract({ endpoint: ep, apiKey: KEY, model: 'm', effort: null, thinking: 'adaptive', system: 'Çıkar.', input: 'metin', schema: { type: 'object' }, maxTokens: 512, fetchFn: fn });
    expect(result.raw).toBe('{"facts":["A"]}');
    expect((calls[0]!.body.response_format as { type: string }).type).toBe('json_schema');
    expect((calls[1]!.body.response_format as { type: string }).type).toBe('json_object');
    expect(JSON.stringify(calls[1]!.body.messages)).toContain('JSON şemasına');
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 4, costUsd: null });
  });
});
