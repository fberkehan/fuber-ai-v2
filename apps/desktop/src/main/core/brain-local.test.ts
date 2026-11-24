import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, defineTool, type Bus, type MemoryApi, type Policy, type UsageApi } from '@fuber/shared';
import { z } from 'zod';
import { createBrain, trimToContext } from './brain';
import { createLlmServer, type LlmServer } from './brain/llm-server';
import { repairJson, TagFilter } from './brain/providers/local';
import { apiError, fakeClient, fakePolicy, fakePresence, miniTools, moduleContext, silentLog, tempStore, testBus, type ScriptTurn } from './brain/testkit';
import { createMemory } from './memory';
import { createUsage } from './usage';

// ───────────── sahte llama-server (OpenAI uyumlu SSE) ─────────────

type LocalTurn = { text?: string; tool?: { name: string; args: string } };

function sse(turn: LocalTurn): string {
  const chunks: unknown[] = [];
  for (const piece of (turn.text ?? '').match(/.{1,5}/gs) ?? []) chunks.push({ choices: [{ delta: { content: piece } }] });
  if (turn.tool) {
    chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: turn.tool.name, arguments: '' } }] } }] });
    chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: turn.tool.args } }] } }] });
  }
  chunks.push({ choices: [{ delta: {}, finish_reason: turn.tool ? 'tool_calls' : 'stop' }] });
  chunks.push({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } });
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function fakeLocalFetch(script: LocalTurn[]) {
  const bodies: Array<Record<string, unknown>> = [];
  const fn = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const turn = script.shift();
    if (!turn) throw new Error('senaryo bitti');
    return new Response(sse(turn), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

const readyServer = (): LlmServer & { ensured: number } => {
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
  return server;
};

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;
let tools: ReturnType<typeof miniTools>;
let ran: string[];

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  tools = miniTools();
  ran = [];
  tools.bind(moduleContext('planner', { bus }), [
    defineTool({
      name: 'reminder_create',
      description: 'hatırlatıcı',
      input: z.object({ text: z.string(), due_at: z.string() }),
      risk: 'write',
      run: async ({ text }) => {
        ran.push(text);
        return { ok: true, text: 'Hatırlatıcı kuruldu.' };
      },
    }),
    defineTool({ name: 'stage_show_app', description: 'uygulama', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: 'x' }) }),
  ]);
});
afterEach(() => env.close());

function brainWith(policy: ReturnType<typeof fakePolicy>, local: LocalTurn[], cloud: ScriptTurn[] = [], server: LlmServer | null = readyServer()) {
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const client = fakeClient(cloud);
  const localFetch = fakeLocalFetch(local);
  const brain = createBrain(
    { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
    { clientFactory: () => client, localServer: server, localFetch: localFetch.fn },
  );
  return { brain, client, localFetch };
}

const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 's1' };
const localVoicePolicy = () =>
  fakePolicy({ models: { ...DEFAULT_POLICY.models, voice: { ...DEFAULT_POLICY.models.voice, provider: 'local' } } } as Partial<Policy>);

describe('yerel sağlayıcı yardımcıları', () => {
  it('düşünme ve metne yazılmış araç çağrısı etiketleri sese sızmaz', () => {
    const filter = new TagFilter();
    const parts = ['<thi', 'nk>iç ses</th', 'ink>Merhaba ', '<tool_call>{"name":"x",', '"arguments":{}}</tool_call> efendim.'];
    const visible = parts.map((part) => filter.push(part)).join('') + filter.flush();
    expect(visible).toBe('Merhaba  efendim.');
    expect(filter.toolCalls).toEqual(['{"name":"x","arguments":{}}']);
  });

  it('bozuk JSON bir kez onarılır; onarılamazsa null', () => {
    expect(repairJson('{"text":"KDV","due_at":"2026-11-17T10:00:00+03:00",}')).toEqual({ text: 'KDV', due_at: '2026-11-17T10:00:00+03:00' });
    expect(repairJson('{"text":"KDV"')).toEqual({ text: 'KDV' });
    expect(repairJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(repairJson('tamamen bozuk')).toBeNull();
  });

  it('bağlam sınırında en eski iletiler atılır, son kullanıcı iletisi kalır', () => {
    const long = 'x'.repeat(3000);
    const messages = [
      { role: 'user' as const, text: long },
      { role: 'assistant' as const, text: long, toolCalls: [] },
      { role: 'user' as const, text: 'son soru' },
    ];
    const trimmed = trimToContext(messages, 500);
    expect(trimmed).toEqual([{ role: 'user', text: 'son soru' }]);
  });
});

describe('yerel beyin döngüsü', () => {
  it('akışlı araç çağrısı: araç çalışır, sonuç modele döner, cümleler akar; yalnız çekirdek araçlar gider', async () => {
    const { brain, localFetch } = brainWith(localVoicePolicy(), [
      { tool: { name: 'reminder_create', args: '{"text":"KDV","due_at":"2026-11-17T10:00:00+03:00"}' } },
      { text: 'Efendim, hatırlatıcı kuruldu.' },
    ]);
    const sentences: string[] = [];
    const response = await brain.respond({ role: 'voice', text: 'yarın onda KDV', origin: voice, onSentence: (s) => sentences.push(s) });
    expect(response.stopReason).toBe('end');
    expect(ran).toEqual(['KDV']);
    expect(sentences).toEqual(['Efendim, hatırlatıcı kuruldu.']);
    const first = localFetch.bodies[0]! as { tools: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }> };
    expect(first.tools.map((tool) => tool.function.name)).toEqual(['reminder_create']);
    // Sistem istemi turdan tura aynıdır (saat içermez); saat son kullanıcı iletisindeki bağlam bloğundadır.
    expect(first.messages[0]!.content).not.toContain('Şimdi:');
    expect(first.messages[0]!.content).toContain('## ŞU ANKİ DURUMUN');
    expect(first.messages.at(-1)!.content).toMatch(/^<baglam>\nŞimdi: .*\n<\/baglam>\nyarın onda KDV$/s);
    const second = localFetch.bodies[1]! as { messages: Array<{ role: string; tool_call_id?: string }> };
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(usage.today().byKind.voice?.costUsd).toBe(0);
  });

  it('bozuk araç JSON onarılamazsa araç çalışmaz, is_error döner', async () => {
    const { brain, localFetch } = brainWith(localVoicePolicy(), [
      { tool: { name: 'reminder_create', args: 'yarın onda' } },
      { text: 'Yapamadım efendim.' },
    ]);
    await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(ran).toEqual([]);
    const second = localFetch.bodies[1]! as { messages: Array<{ role: string; content: string }> };
    expect(second.messages.at(-1)!.content).toContain('INVALID_JSON');
  });

  it('araç çağırmadan "kurdum" derse bir kez uyarılır; yine çağırmazsa dürüst hata döner', async () => {
    const { brain } = brainWith(localVoicePolicy(), [{ text: 'Efendim, hatırlatıcıyı kurdum.' }, { text: 'Tamam, kurdum.' }]);
    const sentences: string[] = [];
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice, onSentence: (s) => sentences.push(s) });
    expect(response.stopReason).toBe('error');
    expect(response.error).toMatch(/yapamadım/i);
    expect(sentences.join(' ')).not.toMatch(/kurdum/);
  });

  // Takip işleri ölçümü (demo.3): "takibi iptal et" sözünde model 3 denemenin 1'inde araç çağırmadan "iptal ettim" dedi.
  it.each([
    ['Takibi iptal ettim.', 'Takip iptal edildi.'],
    ['Takibi iptal ediyorum.', 'Hatırlatıcı silinmiştir.'],
    ['İzlemeyi durduracağım.', 'Takip durduruldu.'],
    ['Listeyi temizledim.', 'Hatırlatıcıyı erteledim.'],
    ['Takibi sonlandırdım.', 'Kayıt kaldırılmıştır.'],
  ])('iptal / silme / durdurma iddiası da araçsız söylenemez: "%s", "%s"', async (first, second) => {
    const { brain } = brainWith(localVoicePolicy(), [{ text: first }, { text: second }]);
    const sentences: string[] = [];
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice, onSentence: (s) => sentences.push(s) });
    expect(response.stopReason).toBe('error');
    expect(response.error).toMatch(/yapamadım/i);
    expect(sentences).toEqual([]);
  });

  it('iddia olmayan cümleler tutulmaz ("iptal etmek ister misiniz?", "silmemi ister misiniz?")', async () => {
    const { brain } = brainWith(localVoicePolicy(), [{ text: 'Hangi takibi iptal etmek istersiniz?' }]);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe('Hangi takibi iptal etmek istersiniz?');
  });

  // Pano ölçümü (demo.3): "dövizin yanına koy" sözünde küçük model araç çağırmadan "koydum / taşıdım" diyordu.
  it('pano iddiası araçsız söylenmez; iki kez yinelenirse panoya özgü dürüst soru söylenir', async () => {
    const { brain } = brainWith(localVoicePolicy(), [{ text: 'Dövizi havanın yanına koydum efendim.' }, { text: 'Hava durumunu en üste taşıdım.' }]);
    const sentences: string[] = [];
    const response = await brain.respond({ role: 'voice', text: 'dövizin yanına koy', origin: voice, onSentence: (s) => sentences.push(s) });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe('Henüz taşımadım efendim; hangi kartı nereye alayım?');
    expect(sentences.join(' ')).not.toMatch(/koydum|taşıdım/);
  });

  it('başka bir aracın başarısı pano iddiasını karşılamaz', async () => {
    const { brain } = brainWith(localVoicePolicy(), [
      { tool: { name: 'reminder_create', args: '{"text":"KDV","due_at":"2026-11-17T10:00:00+03:00"}' } },
      { text: 'Hava kartını en üste taşıdım.' },
      { text: 'Hava kartını en üste aldım.' },
    ]);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(response.text).not.toMatch(/taşıdım|aldım/);
  });

  it('uyarıdan sonra aracı çağırırsa tur düzelir', async () => {
    const { brain } = brainWith(localVoicePolicy(), [
      { text: 'Hatırlatıcıyı kurdum.' },
      { tool: { name: 'reminder_create', args: '{"text":"KDV","due_at":"2026-11-17T10:00:00+03:00"}' } },
      { text: 'Kuruldu efendim.' },
    ]);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(ran).toEqual(['KDV']);
    expect(response.text).toBe('Kuruldu efendim.');
  });

  it('aynı araç aynı girdiyle üst üste çağrılırsa kesilir', async () => {
    const call = { tool: { name: 'reminder_create', args: '{"text":"KDV","due_at":"2026-11-17T10:00:00+03:00"}' } };
    const { brain } = brainWith(localVoicePolicy(), [call, call, call, call]);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice, maxSteps: 10 });
    expect(ran).toEqual(['KDV']);
    expect(['end', 'max_steps']).toContain(response.stopReason);
  });

  it('boş yanıt kullanıcıya kısa hata olur', async () => {
    const { brain } = brainWith(localVoicePolicy(), [{ text: '<think>uzun düşünce</think>' }]);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(response.stopReason).toBe('error');
    expect(response.error).toMatch(/yanıt oluşturamadım/);
  });
});

describe('geri düşme kuralı', () => {
  it('anahtar yoksa voice yerelde koşar; bunu her sohbetin başında söylemez (demo.3)', async () => {
    const policy = fakePolicy({ keys: {} });
    const { brain } = brainWith(policy, [{ text: 'Merhaba efendim.' }, { text: 'Yine buradayım.' }]);
    const first = await brain.respond({ role: 'voice', text: 'selam', origin: voice });
    const second = await brain.respond({ role: 'voice', text: 'selam', origin: voice });
    // Anahtarsız kurulum kalıcı bir durumdur: "bulut beynim bağlı değil" cümlesi gündelik söze eklenmez. Günde en çok
    // bir kez ve yalnız bulut isteyen bir iş istendiğinde söylenir (`brain-demo3.test.ts`).
    expect(first.text).toBe('Merhaba efendim.');
    expect(second.text).toBe('Yine buradayım.');
    expect(brain.status()).toMatchObject({ provider: 'local', reason: 'no_key' });
  });

  it('kredi hatasında tur yerelde yeniden yürür; sonraki tur doğrudan yerelden başlar', async () => {
    const policy = fakePolicy();
    const { brain, client } = brainWith(
      policy,
      [{ text: 'Yerelden yanıt.' }, { text: 'Yine yerel.' }],
      [{ blocks: [], error: apiError(400, 'Your credit balance is too low to access the Anthropic API.') }],
    );
    const first = await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(first.stopReason).toBe('end');
    // Anahtar var ama hesapta kredi yok: neden neyse o söylenir.
    expect(first.text).toBe('Bulut hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum. Yerelden yanıt.');
    const second = await brain.respond({ role: 'voice', text: 'y', origin: voice });
    expect(second.text).toBe('Yine yerel.');
    expect(client.calls).toHaveLength(1);
  });

  it('localFallback off ise geri düşülmez', async () => {
    const policy = fakePolicy({ keys: {}, brain: { ...DEFAULT_POLICY.brain, localFallback: 'off' } } as Partial<Policy>);
    const { brain } = brainWith(policy, []);
    const response = await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(response.stopReason).toBe('no_key');
  });

  it('derin görev yerelde koşmaz; yazılı sohbet koşar', async () => {
    const policy = fakePolicy({ keys: {} });
    const { brain } = brainWith(policy, [{ text: 'Sohbet yerelde.' }]);
    const job = await brain.respond({ role: 'deep', text: 'araştır', origin: { channel: 'job', speakerVerified: null } });
    expect(job.error).toMatch(/bulut beyni istiyor/);
    const chat = await brain.respond({ role: 'deep', text: 'merhaba', origin: { channel: 'chat', speakerVerified: null, sessionId: 'c' } });
    expect(chat.text).toContain('Sohbet yerelde.');
  });

  it('etkin yeteneğin aracı yerel modele sunulur ve çağrılabilir; yetenek dışı ek araç sunulmaz', async () => {
    const rolled: number[] = [];
    tools.bind(moduleContext('skill:zar', { bus }), [
      defineTool({
        name: 'zar_at',
        description: 'Zar atar.',
        input: z.object({ yuz: z.number().optional() }),
        risk: 'read',
        run: async ({ yuz }) => {
          rolled.push(yuz ?? 6);
          return { ok: true, text: 'Zar: 4' };
        },
      }),
    ]);
    const { brain, localFetch } = brainWith(localVoicePolicy(), [{ tool: { name: 'zar_at', args: '{"yuz":6}' } }, { text: 'Dört geldi efendim.' }]);
    const response = await brain.respond({ role: 'voice', text: 'zar at', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(rolled).toEqual([6]);
    const first = localFetch.bodies[0]! as { tools: Array<{ function: { name: string } }> };
    expect(first.tools.map((tool) => tool.function.name).sort()).toEqual(['reminder_create', 'zar_at']);
  });

  it('durum: anahtar yokken yerel (no_key); yerel de yoksa hiçbiri; politika yerelse policy_local', async () => {
    const seen: string[] = [];
    bus.on('brain.status', (status) => seen.push(`${status.provider}:${status.reason}`));
    const noKey = brainWith(fakePolicy({ keys: {} }), []);
    expect(noKey.brain.status()).toMatchObject({ provider: 'local', reason: 'no_key', localReady: true, message: null });
    const nothing = brainWith(fakePolicy({ keys: {} }), [], [], null);
    const none = nothing.brain.status();
    expect(none).toMatchObject({ provider: 'none', reason: 'no_key', localReady: false });
    expect(none.message).toMatch(/bağlı değil/);
    expect(brainWith(localVoicePolicy(), []).brain.status()).toMatchObject({ provider: 'local', reason: 'policy_local' });
    expect(brainWith(fakePolicy(), []).brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok' });
    expect(brainWith(fakePolicy({}, { killSwitch: true }), []).brain.status()).toMatchObject({ provider: 'none', reason: 'kill_switch' });
    expect(seen).toEqual(['local:no_key', 'none:no_key', 'local:policy_local', 'cloud:ok', 'none:kill_switch']);
  });

  it('durum: kredi hatasında buluttan yerele geçiş olayla duyurulur', async () => {
    const seen: string[] = [];
    bus.on('brain.status', (status) => seen.push(`${status.provider}:${status.reason}`));
    const { brain } = brainWith(fakePolicy(), [{ text: 'Yerelden yanıt.' }], [{ blocks: [], error: apiError(400, 'Your credit balance is too low to access the Anthropic API.') }]);
    expect(brain.status().provider).toBe('cloud');
    await brain.respond({ role: 'voice', text: 'x', origin: voice });
    expect(brain.status()).toMatchObject({ provider: 'local', reason: 'cloud_down' });
    expect(seen).toEqual(['cloud:ok', 'local:cloud_down']);
    expect(brain.status().cause).toBe('billing');
  });

  it('yerel beyin yoksa anahtarsız durum eskisi gibi no_key', async () => {
    const policy = fakePolicy({ keys: {} });
    const { brain } = brainWith(policy, [], [], null);
    expect((await brain.respond({ role: 'voice', text: 'x', origin: voice })).stopReason).toBe('no_key');
  });
});

describe('llama-server süreç yöneticisi', () => {
  function fakeSpawn(behaviour: { crash?: boolean }) {
    const spawned: EventEmitter[] = [];
    const fn = ((..._args: unknown[]) => {
      const proc = Object.assign(new EventEmitter(), { pid: 4242, exitCode: null as number | null, stderr: new EventEmitter(), kill() {
        proc.exitCode = 0;
        proc.emit('exit', 0);
      } });
      spawned.push(proc);
      if (behaviour.crash) setTimeout(() => {
        proc.exitCode = 1;
        proc.emit('exit', 1);
      }, 5);
      return proc;
    }) as never;
    return { fn, spawned };
  }

  const files = () => {
    const file = path.join(env.dir, 'model.gguf');
    fs.writeFileSync(file, Buffer.alloc(1024));
    return { serverExe: 'llama-server.exe', modelFile: file, modelId: 'm' };
  };
  const healthy = (async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) as unknown as typeof fetch;

  it('VRAM yetmezse süreç başlatmaz ve açık neden verir', async () => {
    const spawn = fakeSpawn({});
    const server = createLlmServer({
      log: silentLog,
      policy: fakePolicy(),
      resolve: files,
      gpu: { freeMiB: async () => 100, usesGpu: async () => true },
      spawnFn: spawn.fn,
      fetchFn: healthy,
    });
    await expect(server.ensure()).rejects.toThrow(/yeterli ekran belleği yok/);
    expect(spawn.spawned).toHaveLength(0);
  });

  it('GPU kullanılmıyorsa (işlemciye düşüş) kalıcı olarak kullanılamaz der', async () => {
    const spawn = fakeSpawn({});
    const server = createLlmServer({
      log: silentLog,
      policy: fakePolicy(),
      resolve: files,
      gpu: { freeMiB: async () => 10_000, usesGpu: async () => false },
      spawnFn: spawn.fn,
      fetchFn: healthy,
    });
    await expect(server.ensure()).rejects.toThrow(/ekran kartına yüklenemedi/);
    expect(server.available().ok).toBe(false);
  });

  it('hazır olunca adres verir, boşta kapanır', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const spawn = fakeSpawn({});
      const server = createLlmServer({
        log: silentLog,
        policy: fakePolicy(),
        resolve: files,
        gpu: { freeMiB: async () => 10_000, usesGpu: async () => true },
        spawnFn: spawn.fn,
        fetchFn: healthy,
        idleMs: 1000,
      });
      const url = await server.ensure();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.status().state).toBe('ready');
      await vi.advanceTimersByTimeAsync(1500);
      expect(server.status().state).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('art arda üç çöküşten sonra vazgeçer', async () => {
    const spawn = fakeSpawn({ crash: true });
    const server = createLlmServer({
      log: silentLog,
      policy: fakePolicy(),
      resolve: files,
      gpu: { freeMiB: async () => 10_000, usesGpu: async () => true },
      spawnFn: spawn.fn,
      fetchFn: (async () => {
        throw new Error('yükleniyor');
      }) as unknown as typeof fetch,
    });
    for (let i = 0; i < 3; i++) await expect(server.ensure()).rejects.toThrow();
    await expect(server.ensure()).rejects.toThrow(/art arda kapandı/);
    expect(spawn.spawned).toHaveLength(3);
  }, 20_000);
});
