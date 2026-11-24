// Kullanıcı profili isteme HER yolda girer (kanca: `BrainService.attachUserContext`): bulut (Anthropic) yolunda değişken
// kuyruğa, Claude Code yolunda sözün başındaki `<baglam>` bloğuna (özet yalnız değişince), yerel modelde `<baglam>`
// notuna kısa biçimde. Düzeltme ("bundan sonra kısa tut") bir sonraki turda üç yolda da kural olarak görünür.
// Sahte CLI ve sahte istemciler; ağ yok, kota harcanmaz.
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bus, MemoryApi, UsageApi } from '@fuber/shared';
import { createBrain, type BrainService } from './brain';
import { createClaudeCodeBrain, type ClaudeCodeBrain } from './brain/providers/claude-code';
import { fakeClient, fakePolicy, fakePresence, miniTools, silentLog, tempStore, testBus } from './brain/testkit';
import { fakeBrainCli } from './claude-cli/testkit';
import { createMemory } from './memory';
import { createUsage } from './usage';
import { createProfileService, type ProfileService } from '../modules/memory/profile/service';
import { createProfileStore, PROFILE_MIGRATIONS } from '../modules/memory/profile/store';
import { COMPACT_MAX, RICH_MAX } from '../modules/memory/profile/summary';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;
let profile: ProfileService;
let cc: ClaudeCodeBrain | null = null;
let clock: Date;

const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 'v1' };
const sse = (text: string) =>
  [{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 40, completion_tokens: 8 } }]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
const echo = (text: string) => JSON.parse(text) as { system: string; user: string[] };

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  env.store.migrate('memory', PROFILE_MIGRATIONS);
  clock = new Date(2026, 10, 17, 9, 0);
  profile = createProfileService({ store: createProfileStore({ db: env.store.scoped('memory'), now: () => clock }), now: () => clock, log: silentLog });
  // Tanışma bu dosyanın konusu değil (ayrı sınanır); kapalıyken blok yalnız profili taşır.
  profile.setIntro(false);
});
afterEach(async () => {
  await cc?.dispose();
  cc = null;
  env.close();
});

const learn = (text: string, previousReply: string | null = null) =>
  profile.learnFromTurn({ channel: 'voice', sessionId: null, messageId: null, userText: text, previousReply, tools: [] });

function cloudBrain() {
  const policy = fakePolicy();
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const client = fakeClient([{ blocks: [{ type: 'text', text: 'Tamam.' }] }, { blocks: [{ type: 'text', text: 'Tamam.' }] }]);
  const brain = createBrain({ policy, tools: miniTools(), memory, usage, presence: fakePresence(), bus, log: silentLog }, { clientFactory: () => client });
  brain.attachUserContext((input) => profile.context(input));
  const tailOf = (index: number): string => JSON.stringify(client.calls[index]?.params.system ?? '');
  return { brain, client, tailOf };
}

function localBrain() {
  const policy = fakePolicy({ keys: {} });
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const localFetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(sse('Tamam.'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const server = {
    available: () => ({ ok: true, reason: null }),
    ensure: async () => 'http://127.0.0.1:1',
    touch() {},
    status: () => ({ state: 'ready' as const, reason: null, baseUrl: 'http://127.0.0.1:1', modelId: 'qwen' }),
    stop: async () => {},
  };
  const brain = createBrain({ policy, tools: miniTools(), memory, usage, presence: fakePresence(), bus, log: silentLog }, { localServer: server, localFetch });
  brain.attachUserContext((input) => profile.context(input));
  const lastUser = (index: number): string => {
    const user = [...(bodies[index]?.messages ?? [])].reverse().find((message) => message.role === 'user');
    return typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? '');
  };
  return { brain, bodies, lastUser };
}

function claudeCodeBrain(): BrainService {
  const policy = fakePolicy({ keys: {} });
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  cc = createClaudeCodeBrain({ log: silentLog }, { cli: fakeBrainCli(), workDir: path.join(env.dir, 'cc') });
  const server = {
    available: () => ({ ok: false, reason: 'yok' }),
    ensure: async () => {
      throw new Error('yerel yok');
    },
    touch() {},
    status: () => ({ state: 'missing' as const, reason: 'yok', baseUrl: null, modelId: 'qwen' }),
    stop: async () => {},
  };
  const brain = createBrain({ policy, tools: miniTools(), memory, usage, presence: fakePresence(), bus, log: silentLog }, { localServer: server as never, claudeCode: cc });
  brain.attachUserContext((input) => profile.context(input));
  return brain;
}

describe('profil isteme her yolda girer', () => {
  it('profil boşken ve kanca bağlı değilken istem eskisi gibidir', async () => {
    const { brain, tailOf } = cloudBrain();
    await brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(tailOf(0)).not.toContain('## Kullanıcı profili');
    brain.attachUserContext(null);
    learn('Bundan sonra yanıtlarını kısa tut.');
    await brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(tailOf(1)).not.toContain('## Kullanıcı profili');
  });

  it('bulut yolu: düzeltme bir sonraki turda değişken kuyrukta kural olarak durur (hafızadan önce, sınırın altında)', async () => {
    const { brain, tailOf } = cloudBrain();
    learn('Bundan sonra yanıtlarını kısa tut. Eşim Ayşe.');
    await brain.respond({ role: 'voice', text: 'bugün ne yapalım', origin: voice });
    const tail = tailOf(0);
    expect(tail).toContain('## Kullanıcı profili');
    expect(tail).toContain('[yanit-uzunlugu] “Bundan sonra yanıtlarını kısa tut.”');
    expect(tail).toContain('Yakın çevre: Eşi: Ayşe.');
    expect(tail.indexOf('## Kullanıcı profili')).toBeLessThan(tail.indexOf('## Hafızandan'));
    expect(profile.overview().promptChars.rich).toBeLessThanOrEqual(RICH_MAX);
  });

  it('yerel yol: kısa biçim `<baglam>` notunda; kurallar başta', async () => {
    const { brain, lastUser } = localBrain();
    learn('Bundan sonra yanıtlarını kısa tut.');
    learn('Kahveyi sade içerim.');
    await brain.respond({ role: 'voice', text: 'bana bir şey öner', origin: voice });
    const said = lastUser(0);
    expect(said).toContain('<baglam>');
    expect(said).toContain('Kullanıcının kuralları (uygula): “Bundan sonra yanıtlarını kısa tut.”');
    expect(said).toContain('Kullanıcı profili: “Kahveyi sade içerim.”');
    expect(said).not.toContain('## Kullanıcı profili');
    expect(profile.overview().promptChars.compact).toBeLessThanOrEqual(COMPACT_MAX);
  });

  it('Claude Code yolu: özet `<baglam>`da; değişmedikçe yinelenmez, yeni kuralda yeniden gider', async () => {
    const brain = claudeCodeBrain();
    learn('Bundan sonra yanıtlarını kısa tut.');
    const first = echo((await brain.respond({ role: 'voice', text: 'durum [[sahte:yanki]]', origin: voice })).text);
    expect(first.user.at(-1)).toContain('## Kullanıcı profili');
    expect(first.user.at(-1)).toContain('[yanit-uzunlugu] “Bundan sonra yanıtlarını kısa tut.”');
    // Sabit sistem istemi profili taşımaz (ısıtılmış sürecin kimliği değişmesin); kuralın NASIL uygulanacağını söyler.
    expect(first.system).not.toContain('yanit-uzunlugu');
    expect(first.system).toContain('"Davranış kuralları" kullanıcının sana yaptığı düzeltmelerdir');

    const second = echo((await brain.respond({ role: 'voice', messages: [{ role: 'user', text: 'durum [[sahte:yanki]]' }, { role: 'assistant', text: 'tamam' }, { role: 'user', text: 'yine [[sahte:yanki]]' }], origin: voice })).text);
    expect(second.user.at(-1)).not.toContain('## Kullanıcı profili');

    learn('Bir daha bana efendim deme.');
    const third = echo(
      (
        await brain.respond({
          role: 'voice',
          messages: [{ role: 'user', text: 'durum [[sahte:yanki]]' }, { role: 'assistant', text: 'tamam' }, { role: 'user', text: 'yine [[sahte:yanki]]' }, { role: 'assistant', text: 'tamam' }, { role: 'user', text: 'şimdi [[sahte:yanki]]' }],
          origin: voice,
        })
      ).text,
    );
    expect(third.user.at(-1)).toContain('[hitap] “Bir daha bana efendim deme.”');
    expect(third.user.at(-1)).toContain('[yanit-uzunlugu]');
  });

  it('tanışma notu kişilikli sohbet turunda gider, görev turunda gitmez', async () => {
    profile.setIntro(true);
    const { brain, tailOf } = cloudBrain();
    await brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(tailOf(0)).toContain('Tanışma (bu tura özgü)');
    expect(profile.intro().asked).toBe(1);
    clock = new Date(clock.getTime() + 60_000);
    await brain.respond({ role: 'voice', text: 'Atlas adında bir mobilya şirketim var.', origin: voice });
    expect(profile.store.list({ category: 'work' }).map((item) => item.origin)).toContain('intro');
    expect(tailOf(1)).toContain('İşi (kendi anlatımı)');
  });

  it('kanca hata verirse tur bozulmaz', async () => {
    const { brain, tailOf } = cloudBrain();
    brain.attachUserContext(() => {
      throw new Error('profil okunamadı');
    });
    const response = await brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(tailOf(0)).not.toContain('## Kullanıcı profili');
  });
});
