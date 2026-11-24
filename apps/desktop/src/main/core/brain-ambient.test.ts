// Ortam dinleme ve beyin (proje kararı, 17 Kasım 2026): sürekli dinlemenin ham dökümü gören bütün çağrıları YALNIZ
// yerel modele gider (`extract` + `localOnly`); Anthropic anahtarı, OpenAI uyumlu sağlayıcı ve politikada
// buluta çevrilmiş `memory` rolü yok sayılır. Söze girme sorusu ise konuşan beyin yolundan, yerele düşmeden
// (`respond` + `cloudOnly`) gider. Gerçek sağlayıcıya istek yok: bütün uç noktalar sahte ve sayılır.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type Bus, type MemoryApi, type ModelRef, type Policy, type UsageApi } from '@fuber/shared';
import { createBrain } from './brain';
import type { LlmServer } from './brain/llm-server';
import { fakeClient, fakePolicy, fakePresence, miniTools, silentLog, tempStore, testBus, type ScriptTurn } from './brain/testkit';
import { createMemory } from './memory';
import { createUsage } from './usage';

const OR_KEY = 'sk-' + 'or-FAKE-unit-000000000000';
const KIMI: ModelRef = { provider: 'openai-compatible', endpoint: 'openrouter', model: 'moonshotai/kimi-k2', effort: 'low', thinking: 'off', speed: 'standard' };
const Out = z.object({ ok: z.boolean() });

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
});
afterEach(() => env.close());

interface Options {
  /** Varsayılan: Anthropic + OpenRouter anahtarları ve `memory` rolü OpenRouter'da (buluta çevrilmiş). */
  policy?: Partial<Policy>;
  localReady?: boolean;
  anthropic?: ScriptTurn[];
  cloud?: Array<{ status: number; body: unknown }>;
}

function setup(options: Options = {}) {
  const base = fakePolicy().get();
  const policy = fakePolicy({ keys: { anthropic: 'test-key', openrouter: OR_KEY }, models: { ...base.models, memory: KIMI }, ...options.policy });
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const cloudCalls: Array<{ url: string; body: string }> = [];
  const cloud = [...(options.cloud ?? [])];
  const cloudFetch = (async (url: string, init: RequestInit) => {
    cloudCalls.push({ url, body: String(init.body) });
    const step = cloud.shift();
    if (!step) throw new Error('bulut senaryosu bitti');
    return new Response(JSON.stringify(step.body), { status: step.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const localCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const localFetch = (async (url: string, init: RequestInit) => {
    localCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 30, completion_tokens: 4 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const ready = options.localReady ?? true;
  const server: LlmServer = {
    available: () => (ready ? { ok: true, reason: null } : { ok: false, reason: 'yerel model yok' }),
    ensure: async () => 'http://127.0.0.1:1',
    touch() {},
    status: () => ({ state: ready ? ('ready' as const) : ('stopped' as const), reason: null, baseUrl: 'http://127.0.0.1:1', modelId: 'qwen' }),
    stop: async () => {},
  };
  const anthropic = fakeClient(options.anthropic ?? []);
  const brain = createBrain({ policy, tools: miniTools(), memory, usage, presence: fakePresence(), bus, log: silentLog }, { clientFactory: () => anthropic, localServer: server, localFetch, cloudFetch });
  /** Buluta giden bütün istekler: OpenAI uyumlu sağlayıcı ve Anthropic. */
  const cloudRequests = () => cloudCalls.length + anthropic.calls.length;
  return { brain, policy, cloudCalls, localCalls, anthropic, cloudRequests };
}

const RAW = 'Ahmet yarın saat onda teklifi gönderecek, fiyatı yüzde on düşürdük';

describe('ortam dinleme: yalnız yerel çıkarım (localOnly)', () => {
  it('Anthropic anahtarı + OpenAI uyumlu sağlayıcı tanımlı ve memory rolü buluttayken bile yalnız yerel uç noktaya gider', async () => {
    const h = setup();
    const result = await h.brain.extract({ role: 'memory', localOnly: true, instructions: 'Not çıkar.', input: RAW, schema: Out });
    expect(result).toEqual({ ok: true });
    expect(h.localCalls).toHaveLength(1);
    expect(h.localCalls[0]!.url).toBe('http://127.0.0.1:1/v1/chat/completions');
    expect(JSON.stringify(h.localCalls[0]!.body)).toContain('Ahmet yarın saat onda');
    expect(h.cloudRequests()).toBe(0);
    expect(usage.recent(5).every((record) => record.provider === 'local')).toBe(true);
  });

  it('karşılaştırma: localOnly olmadan aynı istek politikadaki bulut sağlayıcısına gider (ayarın etkisiz kılındığı yer burası)', async () => {
    const h = setup({ cloud: [{ status: 200, body: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 30, completion_tokens: 4 } } }] });
    await h.brain.extract({ role: 'memory', instructions: 'Not çıkar.', input: RAW, schema: Out });
    expect(h.cloudCalls.length).toBeGreaterThan(0);
  });

  it('yerel model hazır değilse null döner ve buluta DÜŞMEZ (bulut isteği 0)', async () => {
    const h = setup({ localReady: false });
    expect(await h.brain.extract({ role: 'memory', localOnly: true, instructions: 'Not çıkar.', input: RAW, schema: Out })).toBeNull();
    expect(h.localCalls).toHaveLength(0);
    expect(h.cloudRequests()).toBe(0);
  });

  it('acil durdurma ve zorunlu güncelleme kapısı yerel çıkarımı da durdurur', async () => {
    const h = setup();
    h.policy.killSwitchActive = () => true;
    expect(await h.brain.extract({ role: 'memory', localOnly: true, instructions: 'x', input: RAW, schema: Out })).toBeNull();
    h.policy.killSwitchActive = () => false;
    h.policy.updateRequired = () => true;
    expect(await h.brain.extract({ role: 'memory', localOnly: true, instructions: 'x', input: RAW, schema: Out })).toBeNull();
    expect(h.localCalls).toHaveLength(0);
    expect(h.cloudRequests()).toBe(0);
  });
});

describe('ortam dinleme: söze girme sorusu yalnız bulut beyninde (cloudOnly)', () => {
  const ask = { role: 'voice' as const, origin: { channel: 'voice' as const, speakerVerified: null }, persona: false, tools: 'none' as const, cloudOnly: true, maxSteps: 1, instructions: 'Söze girmeye değer mi?', text: 'Yeni notlar:\n- Teklif gönderilecek.' };

  it('Anthropic API ile yanıtlanır; yerel model çağrılmaz', async () => {
    const h = setup({ policy: { keys: { anthropic: 'test-key' } }, anthropic: [{ blocks: [{ type: 'text', text: '{"speak":false,"kind":"info","text":"","confidence":0,"source":0}' }] }] });
    const response = await h.brain.respond(ask);
    expect(response.stopReason).toBe('end');
    expect(response.text).toContain('"speak":false');
    expect(h.anthropic.calls).toHaveLength(1);
    expect(h.localCalls).toHaveLength(0);
  });
});
