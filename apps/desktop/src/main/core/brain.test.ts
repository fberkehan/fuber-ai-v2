import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineTool, type BrainApi, type Bus, type MemoryApi, type Policy, type UsageApi } from '@fuber/shared';
import { z } from 'zod';
import { createBrain } from './brain';
import {
  apiError,
  fakeClient,
  fakePolicy,
  fakePresence,
  miniTools,
  moduleContext,
  silentLog,
  tempStore,
  testBus,
  type ScriptTurn,
} from './brain/testkit';
import { createMemory } from './memory';
import { createUsage } from './usage';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;
let policy: ReturnType<typeof fakePolicy>;
let tools: ReturnType<typeof miniTools>;

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  policy = fakePolicy();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  tools = miniTools();
});
afterEach(() => env.close());

function brainWith(script: ScriptTurn[]): { brain: BrainApi; client: ReturnType<typeof fakeClient> } {
  const client = fakeClient(script);
  const brain = createBrain(
    { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
    { clientFactory: () => client },
  );
  return { brain, client };
}

const voiceOrigin = { channel: 'voice' as const, speakerVerified: null };
const chatOrigin = { channel: 'chat' as const, speakerVerified: null };

describe('beyin: akış ve cümleler', () => {
  it('ilk tam cümleyi yanıt bitmeden yayınlar', async () => {
    const { brain } = brainWith([{ blocks: [{ type: 'text', text: 'Tamam efendim. Hatırlatıcıyı kurdum, yarın saat onda çalacak.' }], delayMs: 5 }]);
    const sentences: Array<{ text: string; at: number }> = [];
    const started = Date.now();
    const response = await brain.respond({
      role: 'voice',
      text: 'merhaba',
      origin: voiceOrigin,
      onSentence: (text) => sentences.push({ text, at: Date.now() - started }),
    });
    const total = Date.now() - started;
    expect(response.stopReason).toBe('end');
    expect(sentences.map((s) => s.text)).toEqual(['Tamam efendim.', 'Hatırlatıcıyı kurdum, yarın saat onda çalacak.']);
    expect(sentences[0]!.at).toBeLessThan(total * 0.6);
  });

  it('veda sözü bulut beyninde de modele gitmez: tek kısa veda (sohbeti bitirme aracı kayıtlıysa kodla çalışır)', async () => {
    const { brain, client } = brainWith([]);
    const response = await brain.respond({ role: 'voice', text: 'Güle güle Jarvis.', origin: voiceOrigin });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe('Görüşürüz efendim.');
    expect(client.calls).toHaveLength(0);
  });

  it('iptalde akışı keser ve o ana kadarki metni döndürür', async () => {
    const { brain } = brainWith([{ blocks: [{ type: 'text', text: 'Birinci cümle burada. İkinci cümle çok uzun sürecek ve bitmeyecek.' }], delayMs: 10 }]);
    const controller = new AbortController();
    const response = await brain.respond({
      role: 'voice',
      text: 'anlat',
      origin: voiceOrigin,
      signal: controller.signal,
      onSentence: () => controller.abort(),
    });
    expect(response.stopReason).toBe('aborted');
    expect(response.text.startsWith('Birinci cümle burada.')).toBe(true);
    expect(response.text).not.toContain('bitmeyecek');
  });
});

describe('beyin: araç döngüsü', () => {
  function registerSlowTools() {
    const ctx = moduleContext('test', { bus });
    const starts: Record<string, number> = {};
    const ends: Record<string, number> = {};
    const slow = (name: string) =>
      defineTool({
        name,
        description: name,
        input: z.object({ x: z.number() }),
        risk: 'read',
        async run({ x }) {
          starts[name] = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 60));
          ends[name] = Date.now();
          return { ok: true, text: `${name}=${x}` };
        },
      });
    tools.bind(ctx, [slow('tool_a'), slow('tool_b')]);
    return { starts, ends };
  }

  it('paralel araç çağrılarını birlikte çalıştırır ve bütün sonuçları tek iletide döndürür', async () => {
    const { starts, ends } = registerSlowTools();
    const { brain, client } = brainWith([
      {
        blocks: [
          { type: 'text', text: 'Bakıyorum.' },
          { type: 'tool_use', name: 'tool_a', input: { x: 1 }, id: 'tu_a' },
          { type: 'tool_use', name: 'tool_b', input: { x: 2 }, id: 'tu_b' },
        ],
      },
      { blocks: [{ type: 'text', text: 'İkisi de tamam.' }] },
    ]);
    const response = await brain.respond({ role: 'voice', text: 'ikisini yap', origin: voiceOrigin });
    expect(response.stopReason).toBe('end');
    expect(response.toolCalls.map((call) => call.name).sort()).toEqual(['tool_a', 'tool_b']);
    // Biri bitmeden öteki başlamış olmalı.
    expect(starts.tool_b!).toBeLessThan(ends.tool_a!);
    const second = client.calls[1]!.params as { messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }> };
    const last = second.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content.map((block) => block.type)).toEqual(['tool_result', 'tool_result']);
    expect(last.content.map((block) => block.tool_use_id)).toEqual(['tu_a', 'tu_b']);
    expect(response.text).toBe('Bakıyorum. İkisi de tamam.');
  });

  it('başarısız araç sonucunu is_error ile geri verir', async () => {
    tools.bind(moduleContext('test', { bus }), [
      defineTool({
        name: 'broken',
        description: 'bozuk',
        input: z.object({}),
        risk: 'write',
        run: async () => ({ ok: false, text: 'disk dolu' }),
      }),
    ]);
    const { brain, client } = brainWith([
      { blocks: [{ type: 'tool_use', name: 'broken', input: {} }] },
      { blocks: [{ type: 'text', text: 'Yapamadım, disk dolu.' }] },
    ]);
    const response = await brain.respond({ role: 'voice', text: 'yap', origin: voiceOrigin });
    const result = (client.calls[1]!.params as { messages: Array<{ content: Array<{ is_error?: boolean; content?: string }> }> })
      .messages.at(-1)!.content[0]!;
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('disk dolu');
    expect(response.toolCalls[0]).toMatchObject({ name: 'broken', ok: false });
  });

  it('çözülemeyen araç girdisinde adımı yeniden ister; nesne olmayan girdiyi hata sonucu yapar', async () => {
    tools.bind(moduleContext('test', { bus }), [
      defineTool({ name: 'echo', description: 'e', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: 'ok' }) }),
    ]);
    const { brain, client } = brainWith([
      { blocks: [{ type: 'tool_use', name: 'echo', input: {} }], finalError: new Anthropic.AnthropicError('Unable to parse tool parameter JSON') },
      { blocks: [{ type: 'tool_use', name: 'echo', input: 'yarım {' }] },
      { blocks: [{ type: 'text', text: 'Bitti.' }] },
    ]);
    const response = await brain.respond({ role: 'voice', text: 'yap', origin: voiceOrigin });
    expect(response.stopReason).toBe('end');
    expect(client.calls).toHaveLength(3);
    const result = (client.calls[2]!.params as { messages: Array<{ content: Array<{ is_error?: boolean; content?: string }> }> })
      .messages.at(-1)!.content[0]!;
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('INVALID_JSON');
  });

  it('adım sınırında durur', async () => {
    tools.bind(moduleContext('test', { bus }), [
      defineTool({ name: 'loop', description: 'l', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: 'ok' }) }),
    ]);
    const forever: ScriptTurn = { blocks: [{ type: 'tool_use', name: 'loop', input: {} }] };
    const { brain, client } = brainWith([forever, forever, forever, forever]);
    const response = await brain.respond({ role: 'voice', text: 'yap', origin: voiceOrigin, maxSteps: 3 });
    expect(response.stopReason).toBe('max_steps');
    expect(response.error).toBeTruthy();
    expect(client.calls).toHaveLength(3);
  });

  it('araç turundan sonra son iletiye önbellek noktası koyar', async () => {
    tools.bind(moduleContext('test', { bus }), [
      defineTool({ name: 'echo', description: 'e', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: 'ok' }) }),
    ]);
    const { brain, client } = brainWith([
      { blocks: [{ type: 'tool_use', name: 'echo', input: {} }] },
      { blocks: [{ type: 'text', text: 'Tamam.' }] },
    ]);
    await brain.respond({ role: 'voice', text: 'yap', origin: voiceOrigin });
    const first = client.calls[0]!.params as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> };
    const second = client.calls[1]!.params as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> };
    expect(first.messages.at(-1)!.content.at(-1)!.cache_control).toBeUndefined();
    expect(second.messages.at(-1)!.content.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('beyin: istem ve model ayarları', () => {
  it('voice: Haiku, düşünme kapalı, efor low, sunucu yedeği yok; kişilik önbellekli, saat ve hafıza kuyrukta', async () => {
    memory.save({ kind: 'fact', text: 'Kullanıcının şirketi Atlas Limited, Ankara’da kurulu.', subject: 'Atlas', source: 'chat' });
    const { brain, client } = brainWith([{ blocks: [{ type: 'text', text: 'Tamam.' }] }]);
    await brain.respond({ role: 'voice', text: 'Atlas nerede kurulu?', origin: voiceOrigin });
    const params = client.calls[0]!.params as {
      model: string;
      thinking?: { type: string };
      output_config?: { effort?: string };
      fallbacks?: unknown;
      system: Array<{ text: string; cache_control?: unknown }>;
    };
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.output_config?.effort).toBe('low');
    expect(params.fallbacks).toBeUndefined();
    expect(params.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.system[0]!.text).toContain('Jarvis');
    expect(params.system[0]!.text).toContain('Bu tur sesli');
    expect(params.system[0]!.text).not.toContain('## Şu an');
    expect(params.system[1]!.cache_control).toBeUndefined();
    expect(params.system[1]!.text).toContain('## Şu an');
    expect(params.system[1]!.text).toContain('Atlas Limited');
  });

  it('yazılı sohbet: Opus, adaptive, efor medium, fallbacks default', async () => {
    const { brain, client } = brainWith([{ blocks: [{ type: 'text', text: 'Tamam.' }] }]);
    await brain.respond({ role: 'deep', effort: 'medium', text: 'merhaba', origin: chatOrigin });
    const params = client.calls[0]!.params as Record<string, unknown> & { system: Array<{ text: string }> };
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.system[0]!.text).toContain('Bu sohbet yazılı');
  });

  it('düşünmesi kapatılamayan modelde off istenirse parametre gönderilmez, efor low olur', async () => {
    const models = { ...fakePolicy().get().models, voice: { provider: 'anthropic' as const, model: 'claude-opus-5-5', effort: 'medium' as const, thinking: 'off' as const, speed: 'standard' as const } };
    policy.set({ models } as Partial<Policy>);
    const { brain, client } = brainWith([{ blocks: [{ type: 'text', text: 'Tamam.' }] }]);
    await brain.respond({ role: 'voice', text: 'merhaba', origin: voiceOrigin });
    const params = client.calls[0]!.params as Record<string, unknown>;
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toEqual({ effort: 'low' });
  });

  it('prewarm aynı öneki max_tokens 0 ile ısıtır', async () => {
    const { brain, client } = brainWith([{ blocks: [] }, { blocks: [{ type: 'text', text: 'Tamam.' }] }]);
    await brain.prewarm('voice');
    await brain.respond({ role: 'voice', text: 'merhaba', origin: voiceOrigin });
    const warm = client.calls[0]!;
    const real = client.calls[1]!;
    expect(warm.kind).toBe('create');
    expect(warm.params.max_tokens).toBe(0);
    expect((warm.params.system as unknown[])[0]).toEqual((real.params.system as unknown[])[0]);
    expect(warm.params.tools).toEqual(real.params.tools);
  });
});

describe('beyin: hatalar kullanıcı diline', () => {
  const cases: Array<[string, Error, RegExp]> = [
    ['401', apiError(401), /anahtarı geçersiz ya da eksik/],
    ['429', apiError(429), /yoğunluk/],
    ['529', apiError(529), /yoğunluk/],
    ['kredi bitti (400)', apiError(400, 'Your credit balance is too low to access the Anthropic API.'), /ödeme sorunu/],
    ['ağ', new Anthropic.APIConnectionError({ message: 'ağ yok' }), /bağlanamıyorum/],
  ];
  for (const [name, error, pattern] of cases) {
    it(`${name} → kısa Türkçe cümle`, async () => {
      const { brain } = brainWith([{ blocks: [], error }]);
      const response = await brain.respond({ role: 'voice', text: 'merhaba', origin: voiceOrigin });
      expect(response.stopReason).toBe('error');
      expect(response.error).toMatch(pattern);
    });
  }

  it('reddedilme', async () => {
    const { brain } = brainWith([{ blocks: [{ type: 'text', text: '' }], stop: 'refusal' }]);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voiceOrigin });
    expect(response.stopReason).toBe('refusal');
    expect(response.error).toMatch(/yardımcı olamıyorum/);
  });

  it('anahtar yoksa çökmeden no_key', async () => {
    policy.set({ keys: {} });
    const { brain } = brainWith([]);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voiceOrigin });
    expect(response.stopReason).toBe('no_key');
    expect(response.error).toMatch(/anahtar/);
    expect(brain.availability('voice').ok).toBe(false);
    await expect(brain.prewarm('voice')).resolves.toBeUndefined();
    await expect(brain.extract({ instructions: 'x', input: 'y', schema: z.object({ a: z.string() }) })).resolves.toBeNull();
  });

  it('bütçe aşılınca yalnız voice çalışır ve bunu bir kez söyler', async () => {
    policy.set({ limits: { dailyBudgetUsd: 0.000001, maxAgentSteps: 10 } });
    usage.record({ kind: 'deep', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 100, durationMs: 1 });
    const { brain, client } = brainWith([{ blocks: [{ type: 'text', text: 'Tamam.' }] }, { blocks: [{ type: 'text', text: 'Tamam.' }] }]);
    const deep = await brain.respond({ role: 'deep', text: 'x', origin: chatOrigin });
    expect(deep.stopReason).toBe('budget');
    const first = await brain.respond({ role: 'voice', text: 'x', origin: voiceOrigin });
    expect(first.stopReason).toBe('end');
    await brain.respond({ role: 'voice', text: 'y', origin: voiceOrigin });
    const tails = client.calls.map((call) => (call.params.system as Array<{ text: string }>)[1]!.text);
    expect(tails[0]).toContain('harcama sınırı aşıldı');
    expect(tails[1]).not.toContain('harcama sınırı aşıldı');
  });
});

describe('beyin: yapılandırılmış çıkarım', () => {
  it('şemaya uyan JSON döndürür, kullanımı kaydeder', async () => {
    const { brain, client } = brainWith([{ blocks: [{ type: 'text', text: '{"summary":"kısa"}' }] }]);
    const result = await brain.extract({ instructions: 'özetle', input: 'metin', schema: z.object({ summary: z.string() }) });
    expect(result).toEqual({ summary: 'kısa' });
    const params = client.calls[0]!.params as { output_config: { format: { type: string; schema: { additionalProperties?: boolean } } } };
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.output_config.format.schema.additionalProperties).toBe(false);
    expect(usage.today().calls).toBe(1);
  });

  it('şemaya uymayan çıktıda null', async () => {
    const { brain } = brainWith([{ blocks: [{ type: 'text', text: '{"x":1}' }] }]);
    expect(await brain.extract({ instructions: 'x', input: 'y', schema: z.object({ summary: z.string() }) })).toBeNull();
  });
});
