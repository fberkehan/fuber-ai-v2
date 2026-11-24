// Beyin + OpenAI uyumlu bulut sağlayıcı (G8): rol yönlendirme, araç döngüsü, kullanım kaydı ("fiyat bilinmiyor"),
// kredisiz/anahtarsız/hız sınırı/kopma durumlarında yerele düşüş ve nedenin bir kez söylenmesi, Gizli kip, yazılı
// sohbetin ayrı modeli, öz-durum. Gerçek sağlayıcıya istek yok: `cloudFetch` sahte.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineTool, type Bus, type MemoryApi, type ModelRef, type Policy, type UsageApi } from '@fuber/shared';
import { z } from 'zod';
import { createBrain } from './brain';
import { fakeClient, fakePolicy, fakePresence, miniTools, moduleContext, silentLog, tempStore, testBus, type ScriptTurn } from './brain/testkit';
import { createMemory } from './memory';
import { createUsage } from './usage';

const KEY = 'sk-' + 'or-FAKE-unit-000000000000';
const KIMI: ModelRef = { provider: 'openai-compatible', endpoint: 'openrouter', model: 'moonshotai/kimi-k2', effort: 'low', thinking: 'off', speed: 'standard' };

function sse(chunks: unknown[], done = true): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
}
const textReply = (text: string, usage = { prompt_tokens: 40, completion_tokens: 8 }) =>
  sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage }]);

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;
let tools: ReturnType<typeof miniTools>;
const created: string[] = [];

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  tools = miniTools();
  created.length = 0;
  tools.bind(moduleContext('planner', { bus }), [
    defineTool({
      name: 'reminder_create',
      description: 'Hatırlatıcı kurar.',
      input: z.object({ text: z.string() }),
      risk: 'write',
      run: async ({ text }) => {
        created.push(text);
        return { ok: true, text: `Kuruldu: ${text}` };
      },
    }),
  ]);
});
afterEach(() => env.close());

type Step = { status: number; body: string } | { error: Error };

function setup(cloud: Step[], local: string[], options: { policy?: Partial<Policy>; network?: boolean; anthropic?: ScriptTurn[] } = {}) {
  const policy = fakePolicy({ keys: { openrouter: KEY }, models: { ...fakePolicy().get().models, voice: KIMI }, ...options.policy });
  if (options.network === false) policy.networkAllowed = () => false;
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const cloudCalls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
  const cloudFetch = (async (url: string, init: RequestInit) => {
    cloudCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>, auth: (init.headers as Record<string, string>).authorization ?? '' });
    const step = cloud.shift();
    if (!step) throw new Error('bulut senaryosu bitti');
    if ('error' in step) throw step.error;
    return new Response(step.body, { status: step.status, headers: { 'Content-Type': step.status === 200 ? 'text/event-stream' : 'application/json' } });
  }) as unknown as typeof fetch;
  const localCalls: number[] = [];
  const localFetch = (async () => {
    localCalls.push(Date.now());
    const text = local.shift();
    if (text === undefined) throw new Error('yerel senaryo bitti');
    return new Response(textReply(text), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const server = {
    available: () => ({ ok: true, reason: null }),
    ensure: async () => 'http://127.0.0.1:1',
    touch() {},
    status: () => ({ state: 'ready' as const, reason: null, baseUrl: 'http://127.0.0.1:1', modelId: 'qwen' }),
    stop: async () => {},
  };
  const anthropic = fakeClient(options.anthropic ?? []);
  const brain = createBrain(
    { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
    { clientFactory: () => anthropic, localServer: server, localFetch, cloudFetch },
  );
  return { brain, policy, cloudCalls, localCalls, anthropic };
}

const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 's1' };
const chat = { channel: 'chat' as const, speakerVerified: null, sessionId: 'c1' };

describe('OpenAI uyumlu sağlayıcıyla tur', () => {
  it('araç çağrısı → araç çalışır → son yanıt; anahtar Yönetim kasasından (politika) gelir; kullanım "fiyat bilinmiyor"', async () => {
    const call = sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'reminder_create', arguments: '{"text":"KDV"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 300, completion_tokens: 20 } },
    ]);
    const h = setup([{ status: 200, body: call }, { status: 200, body: textReply('KDV hatırlatıcısını kurdum.') }], []);
    const response = await h.brain.respond({ role: 'voice', text: 'KDV için hatırlatıcı kur', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe('KDV hatırlatıcısını kurdum.');
    expect(created).toEqual(['KDV']);
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.cloudCalls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(h.cloudCalls[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(h.cloudCalls[0]!.body.model).toBe('moonshotai/kimi-k2');
    // İkinci istekte araç sonucu `tool` iletisiyle gider.
    const messages = h.cloudCalls[1]!.body.messages as Array<{ role: string; tool_call_id?: string; content?: string }>;
    expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: expect.stringContaining('Kuruldu: KDV') });
    expect(h.localCalls).toHaveLength(0);
    const records = usage.recent(10);
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.provider === 'openrouter' && record.model === 'moonshotai/kimi-k2' && record.costKnown === false && record.costUsd === 0)).toBe(true);
    expect(usage.today().unpricedCalls).toBe(2);
  });

  it('rolde fiyat verilmişse maliyet hesaplanır (bilinir)', async () => {
    const h = setup([{ status: 200, body: textReply('Tamam.', { prompt_tokens: 1_000_000, completion_tokens: 0 }) }], [], {
      policy: { models: { ...fakePolicy().get().models, voice: { ...KIMI, price: { input: 0.5, output: 2 } } } },
    });
    await h.brain.respond({ role: 'voice', text: 'selam', origin: voice });
    const [record] = usage.recent(1);
    expect(record).toMatchObject({ costUsd: 0.5 });
    expect(record!.costKnown).toBeUndefined();
  });

  it('durum ve öz-durum: hangi sağlayıcı ve modelle çalıştığını doğru söyler', async () => {
    const h = setup([], []);
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok', cloud: { provider: 'openai-compatible', name: 'OpenRouter', model: 'moonshotai/kimi-k2' } });
    const self = h.brain.selfState();
    expect(self.brain).toMatchObject({ provider: 'cloud', model: 'moonshotai/kimi-k2', cloudName: 'OpenRouter' });
  });
});

describe('yerele düşüş ve nedenin bir kez söylenmesi', () => {
  it('402 kredi yok: tur yerelde sürer, neden adıyla bir kez söylenir, sonraki tur buluta hiç gitmez', async () => {
    const h = setup([{ status: 402, body: JSON.stringify({ error: { message: 'Insufficient credits' } }) }], ['Birinci.', 'İkinci.']);
    const first = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    const second = await h.brain.respond({ role: 'voice', text: 'iki', origin: voice });
    expect(first.text).toBe('OpenRouter hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum. Birinci.');
    expect(second.text).toBe('İkinci.');
    expect(h.cloudCalls).toHaveLength(1);
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'cloud_down', cause: 'billing', cloud: { name: 'OpenRouter' } });
    // Öz-durum nedeni sağlayıcının adıyla söyler.
    const block = h.brain.selfState();
    expect(block.brain).toMatchObject({ provider: 'local', cause: 'billing', cloudName: 'OpenRouter' });
  });

  it('401 anahtar reddedildi → yerel; Yönetim anahtarı değiştirince bir sonraki tur buluta gider', async () => {
    const h = setup([{ status: 401, body: JSON.stringify({ error: { message: 'No auth credentials found' } }) }, { status: 200, body: textReply('Buluttan yanıt.') }], ['Yerel yanıt.']);
    const first = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    expect(first.text).toContain('OpenRouter anahtarı kabul edilmedi');
    h.policy.set({ keys: { openrouter: 'sk-' + 'or-FAKE-yeni-000000000000' } });
    bus.emit('policy.changed', { revision: 2, source: 'remote', changedKeys: ['keys'] });
    const second = await h.brain.respond({ role: 'voice', text: 'iki', origin: voice });
    expect(second.text).toBe('Buluttan yanıt.');
    expect(h.cloudCalls[1]!.auth).toBe('Bearer sk-' + 'or-FAKE-yeni-000000000000');
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok' });
  });

  it('429 hız sınırı: yalnız bu tur yerelde (bulut "düşük" sayılmaz); sonraki tur yine buluta gider', async () => {
    const h = setup([{ status: 429, body: JSON.stringify({ error: { message: 'Rate limit exceeded' } }) }, { status: 200, body: textReply('Buluttan.') }], ['Yerelden.']);
    const first = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    expect(first.text).toBe('OpenRouter şu an yanıt veremiyor; bu bilgisayardaki modelle yanıtlıyorum. Yerelden.');
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok' });
    const second = await h.brain.respond({ role: 'voice', text: 'iki', origin: voice });
    expect(second.text).toBe('Buluttan.');
  });

  it('5xx ve "model yok" de turu yerele yollar', async () => {
    const h = setup(
      [
        { status: 503, body: JSON.stringify({ error: { message: 'overloaded' } }) },
        { status: 404, body: JSON.stringify({ error: { message: 'model_not_found' } }) },
      ],
      ['Bir.', 'İki.'],
    );
    expect((await h.brain.respond({ role: 'voice', text: 'bir', origin: voice })).text).toBe('OpenRouter şu an yanıt veremiyor; bu bilgisayardaki modelle yanıtlıyorum. Bir.');
    // YENİ bir neden (model bulunamadı) aynı gün de söylenir; aynı neden yinelenmez (duyuru günde bir kez, neden başına).
    const second = await h.brain.respond({ role: 'voice', text: 'iki', origin: { ...voice, sessionId: 's2' } });
    expect(second.text).toBe('OpenRouter seçili modeli bulamadı; bu bilgisayardaki modelle yanıtlıyorum. İki.');
    expect(h.cloudCalls).toHaveLength(2);
    expect(h.localCalls).toHaveLength(2);
  });

  it('aynı neden aynı gün yinelenmez (yeni oturumda da)', async () => {
    const busy = { status: 429, body: JSON.stringify({ error: { message: 'Rate limit exceeded' } }) };
    const h = setup([busy, busy], ['Bir.', 'İki.']);
    expect((await h.brain.respond({ role: 'voice', text: 'bir', origin: voice })).text).toBe('OpenRouter şu an yanıt veremiyor; bu bilgisayardaki modelle yanıtlıyorum. Bir.');
    expect((await h.brain.respond({ role: 'voice', text: 'iki', origin: { ...voice, sessionId: 's2' } })).text).toBe('İki.');
  });

  it('"model yok" bu turda düşerse nedeni adıyla söylenir', async () => {
    const h = setup([{ status: 404, body: JSON.stringify({ error: { message: 'model_not_found' } }) }], ['Bir.']);
    const first = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    expect(first.text).toBe('OpenRouter seçili modeli bulamadı; bu bilgisayardaki modelle yanıtlıyorum. Bir.');
  });

  it('ağ yok → yerel; neden "ulaşamıyorum"', async () => {
    const h = setup([{ error: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) }], ['Yerel.']);
    const response = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    expect(response.text).toBe('OpenRouter sağlayıcısına şu an ulaşamıyorum; bu bilgisayardaki modelle devam ediyorum. Yerel.');
    expect(h.brain.status()).toMatchObject({ cause: 'network' });
  });

  it('akış metin aktıktan sonra koptu: yarım yanıt yerelde YENİDEN söylenmez; kullanıcı kopmayı duyar', async () => {
    const h = setup([{ status: 200, body: sse([{ choices: [{ delta: { content: 'Yarım bir cümle ' } }] }], false) }], ['Yerel.']);
    const response = await h.brain.respond({ role: 'voice', text: 'anlat', origin: voice });
    expect(response.stopReason).toBe('error');
    expect(response.error).toBe('OpenRouter bağlantısı yanıtın ortasında koptu.');
    expect(h.localCalls).toHaveLength(0);
  });

  it('anahtar yok → yerel; kalıcı durum her sohbette duyurulmaz (durum ve öz-durum söyler)', async () => {
    const h = setup([], ['Yerel.'], { policy: { keys: {} } });
    const response = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    // Bulut bu turda DÜŞMEDİ (anahtar hiç yoktu) ve derin beyin isteyen bir iş istenmedi: duyuru yok.
    expect(response.text).toBe('Yerel.');
    expect(h.cloudCalls).toHaveLength(0);
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'no_key', cloud: { name: 'OpenRouter' } });
  });
});

describe('Gizli kip', () => {
  it('buluta HİÇBİR istek gitmez (OpenAI uyumlu ve Anthropic); yerel model yanıtlar', async () => {
    const h = setup([], ['Gizli yanıt.', 'Gizli yanıt 2.'], { network: false });
    const response = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    // Gizli kipi kullanıcı kendisi açtı: her yanıtın başında duyurulmaz (durum satırı ve öz-durum söyler).
    expect(response.text).toBe('Gizli yanıt.');
    const deepChat = await h.brain.respond({ role: 'deep', text: 'yazılı soru', origin: chat });
    expect(deepChat.text).toContain('Gizli yanıt 2.');
    expect(h.cloudCalls).toHaveLength(0);
    expect(h.anthropic.calls).toHaveLength(0);
    // Durum "politika yerel" değil "Gizli kip" der; öz-durum da nedenini öyle söyler.
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'private' });
    expect(h.brain.selfState().brain).toMatchObject({ provider: 'local', reason: 'private' });
  });
});

describe('yazılı sohbetin ayrı modeli (models.chat)', () => {
  it('sohbet Kimi’ye gider, derin iş (iş kanalı) Anthropic’te kalır', async () => {
    const base = fakePolicy().get().models;
    const h = setup([{ status: 200, body: textReply('Sohbetten.') }], [], {
      policy: { keys: { openrouter: KEY, anthropic: 'test-key' }, models: { ...base, chat: { ...KIMI, model: 'moonshotai/kimi-k2.5' } } },
      anthropic: [{ blocks: [{ type: 'text', text: 'Claude’dan.' }] }],
    });
    const viaChat = await h.brain.respond({ role: 'deep', text: 'merhaba', origin: chat });
    expect(viaChat.text).toBe('Sohbetten.');
    expect(h.cloudCalls[0]!.body.model).toBe('moonshotai/kimi-k2.5');
    const viaJob = await h.brain.respond({ role: 'deep', text: 'araştır', origin: { channel: 'job', speakerVerified: null } });
    expect(viaJob.text).toBe('Claude’dan.');
    expect(h.anthropic.calls).toHaveLength(1);
  });
});

describe('iptal', () => {
  it('kullanıcı keserse tur "aborted" biter, yerele düşülmez', async () => {
    const controller = new AbortController();
    const h = setup([{ status: 200, body: sse([{ choices: [{ delta: { content: 'Uzun ' } }] }], false) }], ['Yerel.']);
    const pending = h.brain.respond({ role: 'voice', text: 'anlat', origin: voice, signal: controller.signal, onText: () => controller.abort() });
    const response = await pending;
    expect(response.stopReason).toBe('aborted');
    expect(h.localCalls).toHaveLength(0);
  });
});

describe('çıkarım (hafıza rolü)', () => {
  it('hafıza rolü OpenAI uyumluysa yapılandırılmış çıktı buradan gelir; kredisizse yerele düşer', async () => {
    const base = fakePolicy().get().models;
    const answer = JSON.stringify({ choices: [{ message: { content: '{"n":3}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    const h = setup([{ status: 200, body: answer }], [], { policy: { models: { ...base, voice: KIMI, memory: KIMI } } });
    const result = await h.brain.extract({ role: 'memory', instructions: 'say', input: 'üç', schema: z.object({ n: z.number() }) });
    expect(result).toEqual({ n: 3 });
    expect(h.cloudCalls[0]!.body.stream).toBe(false);
  });
});

describe('fiyatı bilinmeyen modelde günlük bütçe kapısı (çağrı sayısı üzerinden üst sınır)', () => {
  const unpriced = (count: number) => {
    for (let i = 0; i < count; i++) usage.record({ kind: 'voice', provider: 'openrouter', model: 'moonshotai/kimi-k2', inputTokens: 100, outputTokens: 10, costUsd: null, durationMs: 1 });
  };

  it('fiyatsız çağrılar harcamaya girmez ama kapıda sayılır: sınır = bütçe / 0,02', () => {
    setup([], [], { policy: { limits: { dailyBudgetUsd: 1, maxAgentSteps: 40 } } });
    unpriced(49);
    expect(usage.today()).toMatchObject({ costUsd: 0, unpricedCalls: 49, unpricedGuardUsd: 0.98, overBudget: false });
    unpriced(1);
    // 50 × 0,02 = 1 $: bilinen harcama 0 iken de sınır dolar.
    expect(usage.today()).toMatchObject({ costUsd: 0, unpricedCalls: 50, unpricedGuardUsd: 1, overBudget: true });
    expect(usage.overBudget()).toBe(true);
  });

  it('bilinen harcama ile fiyatsız çağrıların payı birlikte sayılır; bütçe 0 ise kapı kapalıdır', () => {
    setup([], [], { policy: { limits: { dailyBudgetUsd: 1, maxAgentSteps: 40 } } });
    usage.record({ kind: 'deep', provider: 'anthropic', model: 'claude-x', costUsd: 0.9, durationMs: 1 });
    unpriced(4);
    expect(usage.today().overBudget).toBe(false);
    unpriced(1);
    expect(usage.today()).toMatchObject({ costUsd: 0.9, overBudget: true });
    setup([], [], { policy: { limits: { dailyBudgetUsd: 0, maxAgentSteps: 40 } } });
    unpriced(10);
    expect(usage.today().overBudget).toBe(false);
  });

  it('sınır fiyatsız çağrılarla dolduysa derin iş durur ve nedeni AÇIKÇA söylenir; sesli tur sürer', async () => {
    const h = setup([{ status: 200, body: textReply('Sesli yanıt.') }], [], {
      policy: { limits: { dailyBudgetUsd: 1, maxAgentSteps: 40 }, models: { ...fakePolicy().get().models, voice: KIMI, deep: KIMI } },
    });
    unpriced(50);
    const job = await h.brain.respond({ role: 'deep', text: 'araştır', origin: { channel: 'job', speakerVerified: null } });
    expect(job.stopReason).toBe('budget');
    expect(job.error).toContain('fiyatı bilinmeyen modelle 50 çağrı yapıldı');
    expect(job.error).toContain('çağrı başına 0,02 dolar');
    expect(h.cloudCalls).toHaveLength(0);
    // Sesli tur bütçe dolunca da çalışır (KURGU: yalnız `voice` rolü).
    const spoken = await h.brain.respond({ role: 'voice', text: 'selam', origin: voice });
    expect(spoken.text).toContain('Sesli yanıt.');
  });
});
