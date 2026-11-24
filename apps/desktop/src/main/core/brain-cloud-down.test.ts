// Kasada bulut anahtarı VAR ama bulut kullanılamıyor (hesapta kredi yok, anahtar geçersiz, ağ yok): beyin yerel modele
// düşer, her turda yeniden buluta gidip gecikme ödemez, nedenini bir kez sade bir cümleyle söyler ve bulut düzelince
// kendiliğinden geri döner.
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineTool, type Bus, type MemoryApi, type UsageApi } from '@fuber/shared';
import { z } from 'zod';
import { createBrain } from './brain';
import { mapBrainError } from './brain/errors';
import type { LlmServer } from './brain/llm-server';
import { apiError, fakeClient, fakePolicy, fakePresence, miniTools, moduleContext, silentLog, tempStore, testBus, type ScriptTurn } from './brain/testkit';
import { createMemory } from './memory';
import { createUsage } from './usage';

const CREDIT = () => apiError(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
const BILLING_NOTICE = 'Bulut hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum.';

function sse(text: string): string {
  const chunks: unknown[] = (text.match(/.{1,5}/gs) ?? []).map((piece) => ({ choices: [{ delta: { content: piece } }] }));
  chunks.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  chunks.push({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } });
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;
let tools: ReturnType<typeof miniTools>;

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  tools = miniTools();
  tools.bind(moduleContext('planner', { bus }), [
    defineTool({ name: 'reminder_create', description: 'hatırlatıcı', input: z.object({ text: z.string() }), risk: 'write', run: async () => ({ ok: true, text: 'Kuruldu.' }) }),
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  env.close();
});

function setup(cloud: ScriptTurn[], local: string[], options: { cloudProbeMs?: number; server?: LlmServer | null } = {}) {
  const policy = fakePolicy();
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const client = fakeClient(cloud);
  const server = {
    ensured: 0,
    available: () => ({ ok: true, reason: null }),
    ensure: async () => {
      server.ensured++;
      return 'http://127.0.0.1:1';
    },
    touch() {},
    status: () => ({ state: 'ready' as const, reason: null, baseUrl: 'http://127.0.0.1:1', modelId: 'qwen' }),
    stop: async () => {},
  };
  const localCalls: number[] = [];
  const localFetch = (async () => {
    localCalls.push(Date.now());
    const text = local.shift();
    if (text === undefined) throw new Error('yerel senaryo bitti');
    return new Response(sse(text), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const seen: string[] = [];
  bus.on('brain.status', (status) => seen.push(`${status.provider}:${status.reason}${status.cause ? `:${status.cause}` : ''}`));
  const brain = createBrain(
    { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
    {
      clientFactory: () => client,
      localServer: options.server === undefined ? server : options.server,
      localFetch,
      ...(options.cloudProbeMs ? { cloudProbeMs: options.cloudProbeMs } : {}),
    },
  );
  return { brain, client, server, localCalls, seen };
}

const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 's1' };

describe('hata çevirisi: bulutun kullanılamama nedeni', () => {
  it.each([
    ['kredi (400)', CREDIT(), 'billing'],
    ['ödeme (402)', apiError(402), 'billing'],
    ['anahtar (401)', apiError(401), 'auth'],
    ['ağ', new Anthropic.APIConnectionError({ message: 'ağ yok' }), 'network'],
    ['zaman aşımı', new Anthropic.APIConnectionTimeoutError(), 'network'],
  ] as const)('%s → bulut düşük, neden %s', (_name, error, issue) => {
    expect(mapBrainError(error, false)).toMatchObject({ cloudDown: true, cloudIssue: issue });
  });

  it.each([
    ['yoğunluk (429)', apiError(429)],
    ['sunucu (529)', apiError(529)],
    ['geçersiz istek (400)', apiError(400, 'messages: at least one message is required')],
  ] as const)('%s → bulut düşük sayılmaz', (_name, error) => {
    expect(mapBrainError(error, false)).toMatchObject({ cloudDown: false, cloudIssue: null });
  });

  it('kullanıcıya giden cümle Türkçedir; ham hata metni ya da JSON içermez', () => {
    const mapped = mapBrainError(CREDIT(), false);
    expect(mapped.message).toBe('Yapay zekâ hesabında ödeme sorunu var. Fuber Yönetim’den kontrol edin.');
    expect(mapped.message).not.toMatch(/credit|balance|\{|"/i);
  });
});

describe('kredisiz bulut anahtarı', () => {
  it('art arda üç tur: buluta yalnız BİR kez gidilir, neden bir kez ve sade söylenir', async () => {
    const h = setup([{ blocks: [], error: CREDIT() }], ['Birinci yanıt.', 'İkinci yanıt.', 'Üçüncü yanıt.']);
    const first = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    const second = await h.brain.respond({ role: 'voice', text: 'iki', origin: voice });
    const third = await h.brain.respond({ role: 'voice', text: 'üç', origin: voice });

    expect([first.stopReason, second.stopReason, third.stopReason]).toEqual(['end', 'end', 'end']);
    expect(first.text).toBe(`${BILLING_NOTICE} Birinci yanıt.`);
    expect(second.text).toBe('İkinci yanıt.');
    expect(third.text).toBe('Üçüncü yanıt.');
    // Gecikme yalnız ilk turda ödenir: sonraki turlar buluta hiç gitmez.
    expect(h.client.calls).toHaveLength(1);
    expect(h.localCalls).toHaveLength(3);
    // Kullanıcıya hiçbir yerde ham hata gitmez.
    for (const response of [first, second, third]) {
      expect(response.error).toBeNull();
      expect(response.text).not.toMatch(/credit|balance|400|\{/i);
    }
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'cloud_down', cause: 'billing', message: null });
    expect(h.seen).toEqual(['local:cloud_down:billing']);
  });

  it('ısıtma (uyanma / açılış) kredisizliği turdan ÖNCE görür: ilk tur buluta hiç gitmez, yerel model ısıtılır', async () => {
    const h = setup([{ blocks: [], error: CREDIT() }], ['Yerelden yanıt.']);
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok', cause: null });
    await h.brain.prewarm('voice');
    expect(h.client.calls.map((call) => call.kind)).toEqual(['create']);
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'cloud_down', cause: 'billing' });
    expect(h.server.ensured).toBe(1);

    const response = await h.brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    // Kredisizlik turdan ÖNCE biliniyordu (durum arayüzde ve öz-durumda yazar): gündelik söze duyuru eklenmez. Duyuru
    // yalnız bulut tur sırasında düşerse ya da bulut isteyen bir iş istenirse söylenir (demo.3).
    expect(response.text).toBe('Yerelden yanıt.');
    // Tur için buluta yeni istek atılmadı.
    expect(h.client.calls).toHaveLength(1);
    // Sonraki uyanmada ısıtma da buluta gitmez (yerel sunucu ısıtılır).
    await h.brain.prewarm('voice');
    expect(h.client.calls).toHaveLength(1);
  });

  it('kredi gelince kendiliğinden buluta döner (arka plan yoklaması) ve yeni düşüş yeniden söylenir', async () => {
    vi.useFakeTimers();
    const h = setup(
      [
        { blocks: [], error: CREDIT() }, // 1. tur
        { blocks: [], error: CREDIT() }, // 1. yoklama: hâlâ kredi yok
        { blocks: [] }, // 2. yoklama: kredi geldi
        { blocks: [{ type: 'text', text: 'Buluttan yanıt.' }] }, // 2. tur
      ],
      ['Yerelden yanıt.'],
      { cloudProbeMs: 1000 },
    );
    const first = await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    expect(first.text).toContain(BILLING_NOTICE);

    await vi.advanceTimersByTimeAsync(1000);
    expect(h.brain.status()).toMatchObject({ provider: 'local', cause: 'billing' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok', cause: null });
    expect(h.seen).toEqual(['local:cloud_down:billing', 'cloud:ok']);

    const second = await h.brain.respond({ role: 'voice', text: 'iki', origin: voice });
    expect(second.text).toBe('Buluttan yanıt.');
    expect(h.localCalls).toHaveLength(1);
    // Yoklama bulut dönünce durur: başka istek atılmaz.
    const calls = h.client.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.client.calls).toHaveLength(calls);
  });

  it('yoklama isteği ücretsizdir: çıktı üretmez (max_tokens 0) ve yeniden denemez', async () => {
    vi.useFakeTimers();
    const h = setup([{ blocks: [], error: CREDIT() }, { blocks: [], error: CREDIT() }], ['Yerelden yanıt.'], { cloudProbeMs: 1000 });
    await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    await vi.advanceTimersByTimeAsync(1000);
    const probe = h.client.calls.at(-1)!;
    expect(probe.kind).toBe('create');
    expect(probe.params.max_tokens).toBe(0);
    expect(probe.options).toMatchObject({ maxRetries: 0 });
  });

  it('neden değişirse (kredi → anahtar iptal) durum güncellenir', async () => {
    vi.useFakeTimers();
    const h = setup([{ blocks: [], error: CREDIT() }, { blocks: [], error: apiError(401) }], ['Yerelden yanıt.'], { cloudProbeMs: 1000 });
    await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'cloud_down', cause: 'auth' });
    expect(h.seen).toEqual(['local:cloud_down:billing', 'local:cloud_down:auth']);
  });

  it('Yönetim’den yeni anahtar gelince yoklama beklenmez: bulut hemen sınanır ve geri dönülür', async () => {
    const h = setup([{ blocks: [], error: apiError(401) }, { blocks: [] }], ['Yerelden yanıt.']);
    await h.brain.respond({ role: 'voice', text: 'bir', origin: voice });
    expect(h.brain.status()).toMatchObject({ provider: 'local', cause: 'auth' });
    bus.emit('policy.changed', { revision: 2, source: 'remote', changedKeys: ['keys'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok', cause: null });
    // Bulut sağlıklıyken anahtar değişimi boşuna istek atmaz.
    const calls = h.client.calls.length;
    bus.emit('policy.changed', { revision: 3, source: 'remote', changedKeys: ['keys'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.client.calls).toHaveLength(calls);
  });

  it('anahtar geçersizse ve ağ yoksa cümle nedenine göre değişir', async () => {
    const auth = setup([{ blocks: [], error: apiError(401) }], ['Yanıt.']);
    expect((await auth.brain.respond({ role: 'voice', text: 'x', origin: voice })).text).toBe(
      'Bulut anahtarı kabul edilmedi; bu bilgisayardaki modelle çalışıyorum. Yanıt.',
    );
    expect(auth.brain.status().cause).toBe('auth');

    const network = setup([{ blocks: [], error: new Anthropic.APIConnectionError({ message: 'ağ yok' }) }], ['Yanıt.']);
    expect((await network.brain.respond({ role: 'voice', text: 'x', origin: voice })).text).toBe(
      'Bulut beynime şu an ulaşamıyorum; bu bilgisayardaki modelle devam ediyorum. Yanıt.',
    );
    expect(network.brain.status().cause).toBe('network');
  });

  it('yerel model yoksa kredisizlik sade bir hata cümlesiyle söylenir (ham metin yok)', async () => {
    const h = setup([{ blocks: [], error: CREDIT() }], [], { server: null });
    const response = await h.brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(response.stopReason).toBe('error');
    expect(response.error).toBe('Yapay zekâ hesabında ödeme sorunu var. Fuber Yönetim’den kontrol edin.');
    expect(h.brain.status()).toMatchObject({ provider: 'none', reason: 'cloud_down', cause: 'billing' });
  });

  it('derin görev (araştırma, Atölye) yerele düşmez: sade ödeme cümlesi döner', async () => {
    const h = setup([{ blocks: [], error: CREDIT() }], []);
    const response = await h.brain.respond({ role: 'deep', text: 'araştır', origin: { channel: 'job', speakerVerified: null } });
    expect(response.stopReason).toBe('error');
    expect(response.error).toBe('Yapay zekâ hesabında ödeme sorunu var. Fuber Yönetim’den kontrol edin.');
    expect(h.localCalls).toHaveLength(0);
  });
});
