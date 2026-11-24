import { describe, expect, it } from 'vitest';
import {
  classifyCloudHttpError,
  cloudCost,
  compatFor,
  endpointForKey,
  parseCloudModels,
  policyLinkProblems,
} from './cloud-providers';
import { DEFAULT_CLOUD_ENDPOINTS, DEFAULT_POLICY, KEY_PROVIDERS, mergePolicy, parsePolicy, PolicySchema } from './policy';

describe('politika: OpenAI uyumlu sağlayıcı alanları', () => {
  it('eski belge (demo.1/demo.2: providers ve models.chat yok, yeni anahtar alanları yok) bozulmadan açılır', () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_POLICY)) as Record<string, unknown>;
    delete old.providers;
    const models = old.models as Record<string, unknown>;
    delete models.chat;
    old.keys = { anthropic: 'x' };
    const parsed = parsePolicy(old);
    expect(parsed).not.toBeNull();
    expect(parsed!.providers).toEqual(DEFAULT_CLOUD_ENDPOINTS);
    expect(parsed!.models.chat).toBeUndefined();
    expect(parsed!.models.voice.provider).toBe('anthropic');
  });

  it('rol OpenAI uyumlu sağlayıcıya bağlanır (fiyatlı ya da fiyatsız)', () => {
    const next = mergePolicy(DEFAULT_POLICY, {
      models: { voice: { provider: 'openai-compatible', endpoint: 'openrouter', model: 'moonshotai/kimi-k2', price: { input: 0.6, output: 2.5 } } },
    });
    expect(next.models.voice).toMatchObject({ provider: 'openai-compatible', endpoint: 'openrouter', price: { input: 0.6, output: 2.5 } });
    expect(policyLinkProblems(next)).toEqual([]);
  });

  it('yazılı sohbetin ayrı modeli eklenir ve `null` ile kaldırılır', () => {
    const withChat = mergePolicy(DEFAULT_POLICY, { models: { chat: { provider: 'openai-compatible', endpoint: 'moonshot', model: 'kimi-k2-turbo-preview', effort: null } } });
    expect(withChat.models.chat?.endpoint).toBe('moonshot');
    const without = mergePolicy(withChat, { models: { chat: null } });
    expect(without.models.chat).toBeUndefined();
  });

  it('özel adres eklenir; kimlik ve adres doğrulanır', () => {
    const custom = { id: 'lm-studio', preset: 'custom' as const, name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', keyId: 'custom' as const, model: 'qwen', caps: { tools: true, vision: false, stream: true } };
    const next = mergePolicy(DEFAULT_POLICY, { providers: [...DEFAULT_CLOUD_ENDPOINTS, custom] });
    expect(next.providers.at(-1)).toEqual(custom);
    expect(() => mergePolicy(DEFAULT_POLICY, { providers: [{ ...custom, id: 'Büyük Harf' }] })).toThrow();
    expect(() => mergePolicy(DEFAULT_POLICY, { providers: [{ ...custom, baseUrl: 'ftp://x' }] })).toThrow();
  });

  it('bağ sorunları: olmayan kayda bağlı rol ve yinelenen kimlik', () => {
    const dangling = PolicySchema.parse({ ...DEFAULT_POLICY, models: { ...DEFAULT_POLICY.models, voice: { ...DEFAULT_POLICY.models.voice, provider: 'openai-compatible', endpoint: 'yok' } } });
    expect(policyLinkProblems(dangling)).toEqual(['models.voice.endpoint: "yok" adlı sağlayıcı kaydı yok']);
    const noEndpoint = PolicySchema.parse({ ...DEFAULT_POLICY, models: { ...DEFAULT_POLICY.models, deep: { ...DEFAULT_POLICY.models.deep, provider: 'openai-compatible' } } });
    expect(policyLinkProblems(noEndpoint)[0]).toMatch(/models\.deep\.endpoint/);
    const twice = PolicySchema.parse({ ...DEFAULT_POLICY, providers: [DEFAULT_CLOUD_ENDPOINTS[0], DEFAULT_CLOUD_ENDPOINTS[0]] });
    expect(policyLinkProblems(twice)[0]).toMatch(/iki kez/);
  });

  it('anahtar kasası yeni sağlayıcıları tanır', () => {
    expect(KEY_PROVIDERS).toEqual(expect.arrayContaining(['openrouter', 'moonshot', 'custom']));
    const parsed = PolicySchema.parse({ ...DEFAULT_POLICY, keys: { openrouter: 'a', moonshot: 'b', custom: 'd' } });
    expect(parsed.keys).toEqual({ openrouter: 'a', moonshot: 'b', custom: 'd' });
  });

  it('anahtarın sınanacağı kayıt: önce politikadaki, yoksa hazır ayar; özel adreste kayıt yoksa yok', () => {
    expect(endpointForKey(DEFAULT_POLICY, 'openrouter')?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(endpointForKey({ providers: [] }, 'moonshot')?.baseUrl).toBe('https://api.moonshot.ai/v1');
    expect(endpointForKey({ providers: [] }, 'custom')).toBeNull();
  });
});

describe('uyum katmanı', () => {
  it.each([
    ['openai', 'gpt-5-mini', { maxTokensField: 'max_completion_tokens', effortField: 'reasoning_effort', temperature: null, reasoning: true }],
    ['openai', 'gpt-4.1', { maxTokensField: 'max_completion_tokens', effortField: null, temperature: 0.6, reasoning: false }],
    ['openrouter', 'openai/o3', { maxTokensField: 'max_tokens', effortField: 'reasoning', temperature: null, usageCost: true }],
    ['openrouter', 'google/gemini-2.5-flash', { schemaMode: 'strict' }],
    ['moonshot', 'kimi-k2-thinking', { reasoning: true, minMaxTokens: 8192, temperature: 0.6 }],
    ['custom', 'qwen3', { dialect: 'openai', maxTokensField: 'max_tokens', streamUsage: true }],
  ] as const)('%s / %s', (preset, model, expected) => {
    expect(compatFor({ preset }, model)).toMatchObject(expected);
  });

  it('maliyet: önbellekli girdi ayrı fiyatlanır; fiyat yoksa null', () => {
    expect(cloudCost({ input: 1, output: 4, cachedInput: 0.1 }, { input: 2_000_000, output: 1_000_000, cachedInput: 1_000_000 })).toBeCloseTo(1 + 0.1 + 4, 6);
    expect(cloudCost(undefined, { input: 1, output: 1, cachedInput: 0 })).toBeNull();
  });
});

describe('hata sınıflaması', () => {
  it.each([
    [401, '', 'auth'],
    [403, '{"error":{"message":"invalid api key"}}', 'auth'],
    [403, '{"error":{"message":"Input was flagged by moderation"}}', 'bad_request'],
    [402, '', 'billing'],
    [429, 'insufficient_quota', 'billing'],
    [429, 'Too many requests', 'rate_limit'],
    [404, '', 'model'],
    [400, 'No endpoints found for x', 'model'],
    [400, 'maximum context length', 'context'],
    [400, 'bad', 'bad_request'],
    [500, '', 'server'],
    [504, '', 'timeout'],
  ] as const)('%i %s → %s', (status, body, kind) => {
    expect(classifyCloudHttpError(status, body)).toBe(kind);
  });
});

describe('model listesi (kayıtlı örnekler)', () => {
  it('OpenRouter: fiyat ($/token → $/milyon), araç ve görsel yeteneği; yalnız görsel üreten model atlanır', () => {
    const raw = {
      data: [
        {
          id: 'moonshotai/kimi-k2',
          name: 'MoonshotAI: Kimi K2',
          context_length: 131072,
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          pricing: { prompt: '0.00000057', completion: '0.0000023', input_cache_read: '0.00000014' },
          supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
        },
        { id: 'openai/gpt-5-image', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { prompt: '0.00001', completion: '0.00004' } },
        { id: 'qwen/qwen3-vl', name: 'Qwen VL', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '-1', completion: '0' }, supported_parameters: ['max_tokens'] },
      ],
    };
    expect(parseCloudModels('openrouter', raw)).toEqual([
      { id: 'moonshotai/kimi-k2', displayName: 'MoonshotAI: Kimi K2', tools: true, vision: false, contextTokens: 131072, price: { input: 0.57, output: 2.3, cachedInput: 0.14 } },
      { id: 'qwen/qwen3-vl', displayName: 'Qwen VL', tools: false, vision: true, contextTokens: null, price: null },
    ]);
  });

  it('OpenAI: yalnız sohbet modelleri; fiyat ve yetenek bilinmiyor (uydurulmaz)', () => {
    const raw = { object: 'list', data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'o3' }] };
    expect(parseCloudModels('openai', raw)).toEqual([
      { id: 'gpt-5-mini', displayName: 'gpt-5-mini', tools: null, vision: null, contextTokens: null, price: null },
      { id: 'o3', displayName: 'o3', tools: null, vision: null, contextTokens: null, price: null },
    ]);
  });

  it('Moonshot biçimi', () => {
    expect(parseCloudModels('moonshot', { data: [{ id: 'kimi-k2-turbo-preview', object: 'model' }] })[0]!.id).toBe('kimi-k2-turbo-preview');
  });
});
