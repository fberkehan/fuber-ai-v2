// Beyin + Claude Code (konuşan beyin): yönlendirme ve varsayılan, GERÇEK araç kapısıyla MCP üzerinden araç (onay kartı,
// konuşmacı doğrulama, sunulmamış araç), Gizli kipte sıfır çağrı, sınırda yerele düşüş ve nedenin bir kez söylenmesi,
// iptal, kısa kesin işler, öz-durum ve kullanım kaydı ("fiyat bilinmiyor"). Sahte CLI; ağ yok, kota harcanmaz.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_EFFORT, defineTool, t, type ApprovalRequest, type Bus, type MemoryApi, type ModelRef, type ModuleContext, type ModuleInfo, type Policy, type StageApi, type ToolCallEvent, type ToolRegistry, type UsageApi } from '@fuber/shared';
import { z } from 'zod';
import { createBrain, type BrainService } from './brain';
import { CLAUDE_CODE_NOTE } from './brain/claude-code/turn';
import { createClaudeCodeBrain, type ClaudeCodeBrain } from './brain/providers/claude-code';
import { renderSelfBlock, type SelfVoiceState } from './brain/self';
import { apiError, fakeClient, fakePolicy, fakePresence, silentLog, tempStore, testBus, type ScriptTurn } from './brain/testkit';
import { fakeBrainCli } from './claude-cli/testkit';
import { createMemory } from './memory';
import { createTools, declareModule } from './tools';
import { createUsage } from './usage';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;
let tools: ToolRegistry;
let cc: ClaudeCodeBrain;
let created: string[];
let wiped: string[];
let voiceCalls: string[];
let approvals: ApprovalRequest[];

const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 'v1' };
const chat = { channel: 'chat' as const, speakerVerified: null, sessionId: 'c1' };
const sse = (text: string) =>
  [{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 40, completion_tokens: 8 } }]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
const echo = (text: string) => JSON.parse(text) as { args: string[]; system: string; tools: string[]; turn: number; user: string[]; pid: number };
const argOf = (args: string[], name: string) => args[args.indexOf(name) + 1];
const spawned = () => {
  try {
    return fs.readFileSync(path.join(env.dir, 'cc', 'sahte-pidler.txt'), 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
};

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  created = [];
  wiped = [];
  voiceCalls = [];
  approvals = [];
  bus.on('tool.approval.request', (request) => void approvals.push(request));
});
afterEach(async () => {
  await cc?.dispose();
  env.close();
});

interface Options {
  policy?: Partial<Policy>;
  cliEnv?: Record<string, string>;
  cli?: null;
  local?: string[];
  anthropic?: ScriptTurn[];
  network?: boolean;
  limitDownMs?: number;
  /** Yerel beyin açılamaz (ör. ekran belleği başka uygulamada): `ensure` bu iletiyle reddeder. */
  localDown?: string;
  /** Yetki düzeyi (`Settings.authorityLevel`); verilmezse kapı her şeyi sorar (ayar servisi yok). */
  authority?: 'ask' | 'smart' | 'full';
}

function setup(options: Options = {}) {
  // Örnek kurulumun politikası: roller `anthropic`, anahtar yok (ya da kredisiz).
  const policy = fakePolicy({ keys: {}, ...options.policy });
  if (options.network === false) policy.networkAllowed = () => false;
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const stage = { showCard: () => ({}) } as unknown as StageApi;
  const authoritySettings = options.authority ? ({ get: () => ({ authorityLevel: options.authority }) } as never) : undefined;
  tools = createTools({ store: env.store, policy, stage, bus, log: silentLog, ...(authoritySettings ? { settings: authoritySettings } : {}) });
  const ctx = (moduleId: string) => ({ moduleId }) as ModuleContext;
  declareModule(tools, 'planner', { permissions: [] });
  declareModule(tools, 'voice-control', { permissions: [] });
  tools.register(ctx('planner'), [
    defineTool({
      name: 'reminder_create',
      description: 'Hatırlatıcı kurar.',
      input: z.object({ text: z.string() }),
      risk: 'write',
      run: async ({ text }) => {
        created.push(text);
        return { ok: true, text: `Hatırlatıcı kuruldu: ${text}` };
      },
    }),
    defineTool({ name: 'weather_get', description: 'Hava durumunu verir.', input: z.object({ city: z.string() }), risk: 'read', run: async ({ city }) => ({ ok: true, text: `${city}: 12 derece, açık.` }) }),
    defineTool({
      name: 'note_wipe',
      description: 'Bütün notları siler.',
      input: z.object({ scope: z.enum(['all', 'old']) }),
      risk: 'danger',
      approvalText: ({ scope }) => `Notları silmek istiyorum (${scope})`,
      run: async ({ scope }) => {
        wiped.push(scope);
        return { ok: true, text: 'Notlar silindi.' };
      },
    }),
  ]);
  tools.register(ctx('voice-control'), [
    defineTool({
      name: 'voice_mute_mic',
      description: 'Mikrofonu kapatır.',
      input: z.object({ minutes: z.number().optional() }),
      risk: 'read',
      run: async () => {
        voiceCalls.push('mute');
        return { ok: true, text: 'Mikrofon kapatıldı. Kullanıcıya yalnız şunu söyle: "Mikrofonu kapattım; Ctrl+Alt+K ile açarsınız."' };
      },
    }),
    defineTool({ name: 'voice_set_quiet', description: 'Sessiz kip.', input: z.object({ on: z.boolean() }), risk: 'read', run: async () => ({ ok: true, text: 'tamam' }) }),
    // demo.3 bütünleştirmesi: veda ve "her şeyi konuşarak" araçları (gerçek tanımların döndürdüğü biçimde sonuç).
    defineTool({
      name: 'voice_end_conversation',
      description: 'Sohbeti bitirir.',
      input: z.object({}),
      risk: 'read',
      run: async () => {
        voiceCalls.push('end');
        return { ok: true, text: 'Sohbet bitiyor.' };
      },
    }),
    defineTool({
      name: 'app_navigate',
      description: 'Ana pencereyi bir sayfada açar.',
      input: z.object({ page: z.string() }),
      risk: 'read',
      run: async ({ page }) => {
        voiceCalls.push(`navigate:${page}`);
        return { ok: true, text: `Ana pencere açıldı. Kullanıcıya yalnız şunu söyle: "${page} sayfasını açtım."` };
      },
    }),
    defineTool({
      name: 'settings_set',
      description: 'Ayar değiştirir.',
      input: z.object({ name: z.string(), value: z.union([z.string(), z.boolean(), z.number()]) }),
      risk: 'write',
      run: async ({ name }) => {
        voiceCalls.push(`set:${name}`);
        return { ok: true, text: 'Ayar değişti. Kullanıcıya yalnız şunu söyle: "Sessiz saatleri açtım."' };
      },
    }),
  ]);
  cc = createClaudeCodeBrain({ log: silentLog }, { cli: options.cli === null ? null : fakeBrainCli(options.cliEnv), workDir: path.join(env.dir, 'cc'), ...(options.limitDownMs ? { limitDownMs: options.limitDownMs } : {}) });
  const local = options.local ?? [];
  const localCalls: number[] = [];
  const localFetch = (async () => {
    localCalls.push(Date.now());
    const text = local.shift();
    if (text === undefined) throw new Error('yerel senaryo bitti');
    return new Response(sse(text), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const server = {
    available: () => ({ ok: true, reason: null }),
    ensure: async () => {
      if (options.localDown) throw new Error(options.localDown);
      return 'http://127.0.0.1:1';
    },
    touch() {},
    status: () => ({ state: 'ready' as const, reason: null, baseUrl: 'http://127.0.0.1:1', modelId: 'qwen' }),
    stop: async () => {},
  };
  const anthropic = fakeClient(options.anthropic ?? []);
  const brain: BrainService = createBrain(
    { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
    { clientFactory: () => anthropic, localServer: server, localFetch, claudeCode: cc },
  );
  return { brain, policy, localCalls, anthropic };
}

describe('yönlendirme ve varsayılan', () => {
  it('kurulu politika (roller anthropic, anahtar yok) + Claude Code hazır → sesli tur Claude Code ile yürür', async () => {
    const h = setup();
    const response = await h.brain.respond({ role: 'voice', text: 'Merhaba Jarvis', origin: voice });
    expect(response).toMatchObject({ stopReason: 'end', error: null, text: 'Sahte Claude: Merhaba Jarvis' });
    expect(h.localCalls).toHaveLength(0);
    expect(h.anthropic.calls).toHaveLength(0);
    const status = h.brain.status();
    expect(status).toMatchObject({ provider: 'cloud', reason: 'ok', cloud: { provider: 'claude-code', name: 'Claude Code', model: 'sonnet' } });
    expect(status.claudeCode).toMatchObject({ state: 'active', use: 'prefer', version: '2.1.325', voiceModel: 'sonnet', chatModel: 'sonnet', warm: 1 });
    expect(status.claudeCode!.lastFirstTextMs).not.toBeNull();
    // Abonelik: dolar karşılığı yok; kullanım "fiyat bilinmiyor" diye kaydedilir.
    const [record] = usage.recent(1);
    expect(record).toMatchObject({ kind: 'voice', provider: 'claude-code', model: 'claude-sonnet-sahte', costUsd: 0, costKnown: false, sessionId: 'v1' });
    expect(response.usage.costUsd).toBe(0);
  });

  it('öz-durum doğru söyler: Claude ile, bu bilgisayardaki Claude Code üzerinden, abonelikle', async () => {
    const h = setup();
    await cc.refresh();
    const self = h.brain.selfState();
    expect(self.brain).toMatchObject({ provider: 'cloud', model: 'sonnet', cloudName: 'Claude Code', claudeCode: true });
    const block = renderSelfBlock(self);
    expect(block).toContain('CLAUDE ile çalışıyor');
    expect(block).toContain('bu bilgisayardaki Claude Code üzerinden');
    expect(block).toContain('aboneliğiyle');
    expect(block).not.toContain('yerel model');
  });

  it('ses ve yazılı sohbet kendi modeli, eforu ve üslubuyla açılır; istem bulut yolunun zengin istemidir', async () => {
    const h = setup();
    const spoken = echo((await h.brain.respond({ role: 'voice', text: 'durum [[sahte:yanki]]', origin: voice })).text);
    expect(argOf(spoken.args, '--model')).toBe('sonnet');
    expect(argOf(spoken.args, '--effort')).toBe('low');
    expect(spoken.system).toContain('Sen Jarvis');
    expect(spoken.system).toContain('## Çalışma kuralları');
    expect(spoken.system).toContain('## Bu tur sesli');
    expect(spoken.system).toContain(CLAUDE_CODE_NOTE);
    expect(spoken.tools).toEqual(['app_navigate', 'note_wipe', 'reminder_create', 'settings_set', 'voice_end_conversation', 'voice_mute_mic', 'voice_set_quiet', 'weather_get']);
    const written = echo((await h.brain.respond({ role: 'deep', effort: CHAT_EFFORT, text: 'durum [[sahte:yanki]]', origin: chat })).text);
    expect(argOf(written.args, '--model')).toBe('sonnet');
    expect(argOf(written.args, '--effort')).toBe('medium');
    expect(written.system).toContain('## Bu sohbet yazılı');
    expect(written.pid).not.toBe(spoken.pid);
  });

  it('bağlam bloğu saat, öz-durum ve hafızayı taşır; öz-durum sonraki turda yinelenmez', async () => {
    const h = setup();
    memory.save({ kind: 'fact', text: 'Kullanıcının muhasebecisi Aylin Hanım.', subject: 'muhasebe', source: 'chat' });
    await h.brain.respond({ role: 'voice', messages: [{ role: 'user', text: 'muhasebecim kimdi' }], origin: voice });
    const second = echo(
      (
        await h.brain.respond({
          role: 'voice',
          messages: [
            { role: 'user', text: 'muhasebecim kimdi' },
            { role: 'assistant', text: 'Sahte Claude: muhasebecim kimdi' },
            { role: 'user', text: 'muhasebe için not [[sahte:yanki]]' },
          ],
          origin: voice,
        })
      ).text,
    );
    expect(second.turn).toBe(2);
    expect(second.user[0]).toContain('<baglam>');
    expect(second.user[0]).toContain('## Şu an');
    expect(second.user[0]).toContain('## ŞU ANKİ DURUMUN');
    expect(second.user[0]).toContain('CLAUDE ile çalışıyor');
    expect(second.user[0]).toContain('Aylin Hanım');
    expect(second.user[1]).toContain('## Şu an');
    expect(second.user[1]).not.toContain('## ŞU ANKİ DURUMUN');
    expect(second.user[1]).not.toContain('Aylin Hanım');
    expect(second.user[1]).not.toContain('<onceki_konusma>');
  });

  it('ısıtma süreci önceden açar; ilk tur aynı süreci kullanır (istem ve araç kimliği birebir aynı)', async () => {
    const h = setup();
    await h.brain.prewarm('voice');
    expect(spawned()).toBe(1);
    const [pid] = cc.pids();
    const seen = echo((await h.brain.respond({ role: 'voice', text: 'x [[sahte:yanki]]', origin: voice })).text);
    expect(seen.pid).toBe(pid);
    expect(spawned()).toBe(1);
    // Yazılı sohbetin süreci de önceden ısıtılabilir (sohbet sayfası açılınca); ilk ileti onu kullanır.
    await h.brain.prewarm('deep');
    expect(spawned()).toBe(2);
    const written = echo((await h.brain.respond({ role: 'deep', effort: CHAT_EFFORT, text: 'y [[sahte:yanki]]', origin: chat })).text);
    expect(cc.pids()).toContain(written.pid);
    expect(spawned()).toBe(2);
  });

  it('kredisiz API anahtarı varken: beyin yine Claude Code; API’nin durumu ücretsiz yoklamayla ayrıca bilinir', async () => {
    const h = setup({ policy: { keys: { anthropic: 'test-key' } }, anthropic: [{ blocks: [], error: apiError(400, 'Your credit balance is too low') }] });
    await h.brain.prewarm('voice');
    await expectEventually(() => h.brain.status().apiIssue === 'billing');
    // Yoklama `max_tokens: 0` ile yapılır (ücretsiz); sesli tur API'ye hiç gitmez.
    expect(h.anthropic.calls).toHaveLength(1);
    expect(h.anthropic.calls[0]!.params.max_tokens).toBe(0);
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', reason: 'ok', cloud: { provider: 'claude-code' }, apiIssue: 'billing' });
    expect((await h.brain.respond({ role: 'voice', text: 'merhaba', origin: voice })).text).toBe('Sahte Claude: merhaba');
    expect(h.anthropic.calls).toHaveLength(1);
  });

  it('rol açıkça claude-code seçilebilir (model ve efor rolden)', async () => {
    const haiku: ModelRef = { provider: 'claude-code', model: 'haiku', effort: 'medium', thinking: 'adaptive', speed: 'standard' };
    const h = setup({ policy: { models: { ...fakePolicy().get().models, voice: haiku } } });
    const seen = echo((await h.brain.respond({ role: 'voice', text: 'x [[sahte:yanki]]', origin: voice })).text);
    expect(argOf(seen.args, '--model')).toBe('haiku');
    expect(argOf(seen.args, '--effort')).toBe('medium');
    expect(h.brain.status().cloud).toMatchObject({ provider: 'claude-code', model: 'haiku' });
  });

  it('kullanım "off": eski davranış (anahtar yoksa yerel model)', async () => {
    const base = fakePolicy().get();
    const h = setup({ policy: { brain: { ...base.brain, claudeCode: { ...base.brain.claudeCode, use: 'off' } } }, local: ['Yerelden yanıt.'] });
    const response = await h.brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(response.text).toContain('Yerelden yanıt.');
    expect(spawned()).toBe(0);
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'no_key', claudeCode: { state: 'off' } });
  });

  it('kullanım "fallback": API çalışırken API; API kredisizse Claude Code', async () => {
    const base = fakePolicy().get();
    const fallback = { brain: { ...base.brain, claudeCode: { ...base.brain.claudeCode, use: 'fallback' as const } }, keys: { anthropic: 'test-key' } };
    const working = setup({ policy: fallback, anthropic: [{ blocks: [{ type: 'text', text: 'API yanıtı.' }] }] });
    expect((await working.brain.respond({ role: 'voice', text: 'merhaba', origin: voice })).text).toBe('API yanıtı.');
    expect(spawned()).toBe(0);
    expect(working.brain.status().claudeCode).toMatchObject({ state: 'standby' });
    await cc.dispose();
    env.close();
    env = tempStore();
    memory = createMemory({ store: env.store, bus, log: silentLog });
    const broke = setup({ policy: fallback, anthropic: [{ blocks: [], error: apiError(400, 'Your credit balance is too low') }] });
    // İlk tur API'de düşer (kredi yok); aynı tur yerelden önce Claude Code ile yeniden denenir.
    const response = await broke.brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(response).toMatchObject({ stopReason: 'end', text: 'Sahte Claude: merhaba' });
    const next = await broke.brain.respond({ role: 'voice', text: 'yeniden', origin: voice });
    expect(next.text).toBe('Sahte Claude: yeniden');
    expect(broke.anthropic.calls).toHaveLength(1);
    expect(broke.brain.status()).toMatchObject({ provider: 'cloud', cloud: { provider: 'claude-code' } });
  });

  it('yapılandırılmış çıkarım (hafıza) Claude Code’a gitmez', async () => {
    const h = setup();
    await cc.refresh();
    const result = await h.brain.extract({ instructions: 'özetle', input: 'metin', schema: z.object({ summary: z.string() }) });
    expect(result).toBeNull();
    expect(spawned()).toBe(0);
  });
});

describe('araçlar: MCP yolu araç kapısını atlayamaz', () => {
  it('hatırlatıcı MCP üzerinden kurulur; çağrı kapıdan geçer ve günlüğe köken ile yazılır', async () => {
    const h = setup();
    const events: ToolCallEvent[] = [];
    const response = await h.brain.respond({ role: 'voice', text: 'KDV’yi hatırlat [[sahte:arac|reminder_create|{"text":"KDV"}]]', origin: voice, onToolCall: (event) => void events.push(event) });
    expect(created).toEqual(['KDV']);
    expect(response.stopReason).toBe('end');
    // Sesli turda araç başlarken kısa bir söz söylenir (yazan iş: "Hemen."), sonra modelin yanıtı.
    expect(response.text).toBe('Hemen. Araç sonucu: Hatırlatıcı kuruldu: KDV');
    expect(response.toolCalls).toMatchObject([{ name: 'reminder_create', ok: true }]);
    expect(events.map((event) => event.phase)).toEqual(['start', 'end']);
    const [logged] = tools.recentCalls(1);
    expect(logged).toMatchObject({ name: 'reminder_create', moduleId: 'planner', risk: 'write', ok: true, origin: { channel: 'voice', sessionId: 'v1' } });
    expect(cc.snapshot().mcpCalls).toBe(1);
  });

  it('yetki düzeyi MCP yolunda da aynı kapıdır: Akıllı’da silme sorulur, Tam yetki’de sorulmadan çalışır', async () => {
    const smart = setup({ authority: 'smart' });
    const asked = smart.brain.respond({ role: 'voice', text: 'notları sil [[sahte:arac|note_wipe|{"scope":"all"}]]', origin: voice });
    await expectEventually(() => approvals.length === 1);
    // Sınıflanmamış `danger` araç kritiktir: kısa soru özet + "Yapayım mı?".
    expect(approvals[0]).toMatchObject({ toolName: 'note_wipe', kind: 'other', ask: 'Notları silmek istiyorum (all). Yapayım mı?' });
    tools.resolveApproval(approvals[0]!.id, 'denied', 'ui');
    expect((await asked).toolCalls).toMatchObject([{ name: 'note_wipe', ok: false }]);
    expect(wiped).toEqual([]);
    await cc.dispose();

    approvals.length = 0;
    const autos: string[] = [];
    const full = setup({ authority: 'full' });
    bus.on('tool.approval.auto', (event) => void autos.push(`${event.toolName}:${event.level}:${event.kind}`));
    const response = await full.brain.respond({ role: 'voice', text: 'notları sil [[sahte:arac|note_wipe|{"scope":"old"}]]', origin: voice });
    expect(approvals).toEqual([]);
    expect(wiped).toEqual(['old']);
    expect(response.toolCalls).toMatchObject([{ name: 'note_wipe', ok: true }]);
    expect(autos).toEqual(['note_wipe:full:other']);
    expect(tools.recentCalls(1)[0]).toMatchObject({ name: 'note_wipe', approval: 'approved', ok: true });
  });

  it('yetki düzeyi beynin ortak araç döngüsünde de aynı kapıdır (Anthropic API yolu; yerel beyin aynı döngüyü kullanır)', async () => {
    const base = fakePolicy().get();
    const api = { brain: { ...base.brain, claudeCode: { ...base.brain.claudeCode, use: 'off' as const } }, keys: { anthropic: 'test-key' } };
    const wipe = (): ScriptTurn[] => [
      { blocks: [{ type: 'tool_use', name: 'note_wipe', input: { scope: 'all' }, id: 'tu_1' }], stop: 'tool_use' },
      { blocks: [{ type: 'text', text: 'Tamam.' }] },
    ];
    const smart = setup({ authority: 'smart', policy: api, anthropic: wipe() });
    const asked = smart.brain.respond({ role: 'voice', text: 'notları sil', origin: voice });
    await expectEventually(() => approvals.length === 1);
    expect(approvals[0]).toMatchObject({ toolName: 'note_wipe', kind: 'other' });
    tools.resolveApproval(approvals[0]!.id, 'denied', 'ui');
    expect((await asked).toolCalls).toMatchObject([{ name: 'note_wipe', ok: false }]);
    expect(wiped).toEqual([]);
    expect(spawned()).toBe(0);

    approvals.length = 0;
    const full = setup({ authority: 'full', policy: api, anthropic: wipe() });
    const response = await full.brain.respond({ role: 'voice', text: 'notları sil', origin: voice });
    expect(approvals).toEqual([]);
    expect(wiped).toEqual(['all']);
    expect(response.toolCalls).toMatchObject([{ name: 'note_wipe', ok: true }]);
  });

  it('onay isteyen (danger) araç: onay kartı çıkar; reddedilirse çalışmaz, onaylanırsa çalışır', async () => {
    const h = setup();
    const denied = h.brain.respond({ role: 'voice', text: 'notları sil [[sahte:arac|note_wipe|{"scope":"all"}]]', origin: voice });
    await expectEventually(() => approvals.length === 1);
    expect(approvals[0]).toMatchObject({ toolName: 'note_wipe', risk: 'danger', summary: 'Notları silmek istiyorum (all)', origin: { channel: 'voice' } });
    expect(wiped).toEqual([]);
    tools.resolveApproval(approvals[0]!.id, 'denied', 'ui');
    const first = await denied;
    expect(wiped).toEqual([]);
    expect(first.toolCalls).toMatchObject([{ name: 'note_wipe', ok: false }]);
    expect(first.text).toContain(t('tool.error.denied'));

    const approved = h.brain.respond({
      role: 'voice',
      messages: [
        { role: 'user', text: 'notları sil' },
        { role: 'assistant', text: first.text },
        { role: 'user', text: 'evet sil [[sahte:arac|note_wipe|{"scope":"old"}]]' },
      ],
      origin: voice,
    });
    await expectEventually(() => approvals.length === 2);
    tools.resolveApproval(approvals[1]!.id, 'approved', 'voice');
    const second = await approved;
    expect(wiped).toEqual(['old']);
    expect(second.text).toBe('Hemen. Araç sonucu: Notlar silindi.');
    expect(tools.recentCalls(2).map((call) => call.approval)).toEqual(['approved', 'denied']);
  });

  it('konuşmacı doğrulanamadıysa yazan araç MCP’den de çalışmaz', async () => {
    const h = setup();
    const response = await h.brain.respond({
      role: 'voice',
      text: 'hatırlat [[sahte:arac|reminder_create|{"text":"x"}]]',
      origin: { ...voice, speakerVerified: false },
    });
    expect(created).toEqual([]);
    expect(response.toolCalls).toMatchObject([{ name: 'reminder_create', ok: false }]);
    expect(response.text).toContain(t('tool.error.speaker'));
  });

  it('bu tura sunulmamış araç, kayıtta olsa bile çalıştırılmaz (onay bile istenmez)', async () => {
    const h = setup();
    const response = await h.brain.respond({ role: 'voice', tools: ['reminder_create'], text: 'sil [[sahte:arac|note_wipe|{"scope":"all"}]]', origin: voice });
    expect(wiped).toEqual([]);
    expect(approvals).toHaveLength(0);
    expect(response.toolCalls).toMatchObject([{ name: 'note_wipe', ok: false }]);
  });

  it('geçersiz girdi kapıda reddedilir', async () => {
    const h = setup();
    const response = await h.brain.respond({ role: 'voice', text: 'x [[sahte:arac|reminder_create|{"text":5}]]', origin: voice });
    expect(created).toEqual([]);
    expect(response.toolCalls).toMatchObject([{ ok: false }]);
  });

  it('acil durdurma etkinken tur Claude Code’a hiç gitmez', async () => {
    const h = setup({ policy: { killSwitch: { active: true } } });
    await cc.refresh();
    const response = await h.brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(response.stopReason).toBe('kill_switch');
    expect(spawned()).toBe(0);
  });
});

describe('gizlilik', () => {
  it('Gizli kipte Claude Code’a hiçbir şey gitmez: süreç bile açılmaz, tur yerel modelle yürür', async () => {
    const h = setup({ network: false, local: ['Gizli kipte yerel yanıt.', 'İkinci yerel yanıt.'] });
    await cc.refresh();
    await h.brain.prewarm('voice');
    const response = await h.brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(response.text).toContain('Gizli kipte yerel yanıt.');
    await h.brain.respond({ role: 'deep', text: 'yazılı', origin: chat });
    expect(spawned()).toBe(0);
    expect(cc.snapshot()).toMatchObject({ processes: 0, mcpCalls: 0 });
    expect(h.localCalls).toHaveLength(2);
    // Durum nedeni "politika yerel" değil Gizli kiptir (durum satırı ve öz-durum öyle söyler).
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'private', claudeCode: { state: 'private' } });
  });
});

describe('sınır ve hata: yerele düşüş', () => {
  it('abonelik sınırı dolunca tur yerel modelle sürer; neden bir kez söylenir; durum doğru', async () => {
    const h = setup({ local: ['Yerel yanıt bir.', 'Yerel yanıt iki.'] });
    const first = await h.brain.respond({ role: 'voice', text: 'merhaba [[sahte:limit]]', origin: voice });
    expect(first.stopReason).toBe('end');
    expect(first.text).toBe(`${t('ccbrain.notice.limit')} Yerel yanıt bir.`);
    // CLI'nin İngilizce sınır iletisi kullanıcıya hiç ulaşmaz.
    expect(first.text).not.toContain('hit your limit');
    const status = h.brain.status();
    expect(status).toMatchObject({ provider: 'local', reason: 'cloud_down', cause: 'limit', cloud: { provider: 'claude-code' } });
    expect(status.claudeCode).toMatchObject({ state: 'limit', reason: expect.stringContaining('kullanım sınırı doldu') });
    expect(status.claudeCode!.resetsAt).not.toBeNull();
    // Sonraki tur: Claude Code denenmez, neden yinelenmez.
    const before = spawned();
    const second = await h.brain.respond({ role: 'voice', text: 'peki', origin: voice });
    expect(second.text).toBe('Yerel yanıt iki.');
    expect(spawned()).toBe(before);
    const self = renderSelfBlock(h.brain.selfState());
    expect(self).toContain('yerel model');
    expect(self).toContain('kullanım sınırı doldu');
  });

  it('sınır dolu VE yerel beyin açılamıyor: asıl neden (sınır) yerelin sorunuyla birlikte söylenir, "devam ediyorum" denmez', async () => {
    const h = setup({ localDown: 'Yerel beyin için yeterli ekran belleği yok.' });
    const first = await h.brain.respond({ role: 'voice', text: 'merhaba [[sahte:limit]]', origin: voice });
    expect(first.stopReason).toBe('error');
    expect(first.error).toBe('Claude aboneliğinin kullanım sınırı doldu; bu bilgisayardaki model de şu an çalışamıyor: Yerel beyin için yeterli ekran belleği yok.');
    expect(`${first.text}${first.error}`).not.toContain('devam ediyorum');
    // Neden günde bir kez: sonraki turda yalnız yerelin sorunu.
    const second = await h.brain.respond({ role: 'voice', text: 'peki', origin: voice });
    expect(second.error).toBe('Yerel beyin için yeterli ekran belleği yok.');
  });

  it('sınır açılınca kendiliğinden Claude’a döner', async () => {
    const h = setup({ local: ['Yerel yanıt.'], limitDownMs: 250, cliEnv: {} });
    // Sahte CLI sınırı 3 saat sonraya bildirir; açılma anı geçmişte kalsın diye süre kısaltılamaz: doğrudan yoklanır.
    await h.brain.respond({ role: 'voice', text: 'merhaba [[sahte:oturum]]', origin: voice });
    expect(h.brain.status()).toMatchObject({ provider: 'local', cause: 'auth', claudeCode: { state: 'logged_out' } });
    // Oturum yeniden açıldı (yoklama tazelendi): Claude Code geri gelir.
    await cc.refresh(true);
    expect(h.brain.status()).toMatchObject({ provider: 'cloud', cloud: { provider: 'claude-code' } });
    expect((await h.brain.respond({ role: 'voice', text: 'döndün mü', origin: voice })).text).toBe('Sahte Claude: döndün mü');
  });

  it('Claude Code kurulu değilse eski zincir aynen sürer (anahtar yok → yerel; kalıcı durum her sohbette duyurulmaz)', async () => {
    const h = setup({ cli: null, local: ['Yerel yanıt.'] });
    const response = await h.brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    // Duyuru günde en çok bir kez ve yalnız bulut O TURDA düştüyse ya da derin iş istenip yapılamıyorsa söylenir.
    expect(response.text).toBe('Yerel yanıt.');
    expect(h.brain.status()).toMatchObject({ provider: 'local', reason: 'no_key', claudeCode: { state: 'missing' } });
  });

  it('çöken süreçten sonra sonraki tur Claude Code ile yeniden yürür', async () => {
    const h = setup({ local: ['Yerel devraldı.'] });
    const crashed = await h.brain.respond({ role: 'voice', text: 'çök [[sahte:cokme]]', origin: voice });
    expect(crashed.text).toBe(`${t('ccbrain.notice.error')} Yerel devraldı.`);
    const next = await h.brain.respond({
      role: 'voice',
      messages: [
        { role: 'user', text: 'çök' },
        { role: 'assistant', text: crashed.text },
        { role: 'user', text: 'şimdi [[sahte:yanki]]' },
      ],
      origin: voice,
    });
    const seen = echo(next.text);
    expect(seen.user[0]).toContain('<onceki_konusma>');
    expect(seen.user[0]).toContain('Yerel devraldı.');
  });
});

describe('iptal ve hız', () => {
  it('araya girme: tur anında kesilir, o ana kadarki metin döner', async () => {
    const h = setup();
    const controller = new AbortController();
    const sentences: string[] = [];
    let cutAt = 0;
    const response = await h.brain.respond({
      role: 'voice',
      text: 'uzun anlat [[sahte:uzun|60|40]]',
      origin: voice,
      signal: controller.signal,
      onSentence(sentence) {
        sentences.push(sentence);
        if (sentences.length === 2) {
          cutAt = Date.now();
          controller.abort();
        }
      },
    });
    expect(response.stopReason).toBe('aborted');
    expect(Date.now() - cutAt).toBeLessThan(250);
    expect(sentences.slice(0, 2)).toEqual(['Bu 1. cümle.', 'Bu 2. cümle.']);
    expect(response.text.startsWith('Bu 1. cümle. Bu 2. cümle.')).toBe(true);
    expect(response.text).not.toContain('Bu 30. cümle.');
  });

  it('kısa kesin işler modele gitmez: saat sorusu ve mikrofonu kapatma kodla, anında', async () => {
    const h = setup();
    await cc.refresh();
    const now = new Date();
    const time = await h.brain.respond({ role: 'voice', text: 'Saat kaç?', origin: voice });
    expect(time.text).toBe(`Saat ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}.`);
    expect(time.usage.durationMs).toBeLessThan(200);
    const mute = await h.brain.respond({ role: 'voice', text: 'Mikrofonu kapat.', origin: voice });
    expect(voiceCalls).toEqual(['mute']);
    expect(mute.text).toBe('Mikrofonu kapattım; Ctrl+Alt+K ile açarsınız.');
    expect(mute.toolCalls).toMatchObject([{ name: 'voice_mute_mic', ok: true }]);
    const ask = await h.brain.respond({ role: 'voice', text: 'Sesi kapat', origin: voice });
    expect(ask.text).toBe(t('brain.local.voiceAsk'));
    expect(spawned()).toBe(0);
    expect(usage.recent(5)).toHaveLength(0);
    // Yazılı sohbette kısa yol yoktur: soru modele gider.
    const written = await h.brain.respond({ role: 'deep', text: 'Saat kaç?', origin: chat });
    expect(written.text).toBe('Sahte Claude: Saat kaç?');
  });

  it('veda sözü Claude Code yolunda da modele gitmez: sohbet araçla biter, tek kısa veda (sesli ve yazılı)', async () => {
    const h = setup();
    await cc.refresh();
    const spoken = await h.brain.respond({ role: 'voice', text: 'Güle güle Jarvis.', origin: voice });
    expect(spoken.text).toBe('Görüşürüz efendim.');
    expect(spoken.toolCalls).toMatchObject([{ name: 'voice_end_conversation', ok: true }]);
    const written = await h.brain.respond({ role: 'deep', text: 'iyi geceler', origin: chat });
    expect(written.text).toBe('İyi geceler efendim.');
    expect(voiceCalls).toEqual(['end', 'end']);
    // Süreç açılmadı, kota harcanmadı.
    expect(spawned()).toBe(0);
    expect(usage.recent(5)).toHaveLength(0);
    // Veda gibi görünen ama başka bir şey anlatan söz modele gider.
    const other = await h.brain.respond({ role: 'deep', text: 'Ona güle güle dedim, ne cevap verdi?', origin: chat });
    expect(other.text).toContain('Sahte Claude:');
  });

  it('"her şeyi konuşarak": kesin ayar ve gezinme sözü sesli turda kodla araca gider (yerel beyinle aynı eşleme)', async () => {
    const h = setup();
    await cc.refresh();
    const nav = await h.brain.respond({ role: 'voice', text: 'İşler sayfasını aç.', origin: voice });
    expect(nav.text).toBe('watch sayfasını açtım.');
    const set = await h.brain.respond({ role: 'voice', text: 'Sessiz saatleri aç.', origin: voice });
    expect(set.text).toBe('Sessiz saatleri açtım.');
    expect(voiceCalls).toEqual(['navigate:watch', 'set:sessiz_saatler']);
    expect(spawned()).toBe(0);
    // Toplantı KİPİNİ başlatma sözü gezinme değildir: modele gider (aracı o seçer).
    const meeting = await h.brain.respond({ role: 'voice', text: 'Toplantı modunu aç.', origin: voice });
    expect(meeting.text).toContain('Sahte Claude:');
    expect(voiceCalls).toHaveLength(2);
  });

  it('sesli turda yanıt gecikirse kısa bir bekleme sözü söylenir', async () => {
    const h = setup();
    const sentences: string[] = [];
    const response = await h.brain.respond({ role: 'voice', text: 'düşün [[sahte:gec|3000]]', origin: voice, onSentence: (sentence) => void sentences.push(sentence) });
    expect(sentences[0]).toBe(t('ccbrain.filler'));
    expect(response.text).toBe(`${t('ccbrain.filler')} Geç gelen yanıt.`);
  }, 15_000);

  it('araç başlarken bekleme sözü hemen söylenir: okuyan işte "Bakıyorum.", yazan işte "Hemen."; yazılı sohbette ve ses araçlarında yok', async () => {
    const h = setup();
    const sentences: string[] = [];
    const read = await h.brain.respond({ role: 'voice', text: 'hava [[sahte:arac|weather_get|{"city":"Ankara"}]]', origin: voice, onSentence: (sentence) => void sentences.push(sentence) });
    // Söz, araç sonucu beklenmeden (yanıttan önce) gider.
    expect(sentences[0]).toBe(t('ccbrain.filler.read'));
    expect(read.text).toBe('Bakıyorum. Araç sonucu: Ankara: 12 derece, açık.');
    const written = await h.brain.respond({ role: 'deep', text: 'hava [[sahte:arac|weather_get|{"city":"İzmir"}]]', origin: chat });
    expect(written.text).toBe('Araç sonucu: İzmir: 12 derece, açık.');
    const quiet = await h.brain.respond({ role: 'voice', text: 'yazıyla devam et lütfen artık [[sahte:arac|voice_set_quiet|{"on":true}]]', origin: { ...voice, sessionId: 'v2' } });
    expect(quiet.text).toBe('Araç sonucu: tamam');
  });
});

describe('kendini bilme: kayıttan öz-tanım sabit istemde, anlık durum <baglam>da', () => {
  const selfVoice = (micMuted: boolean): SelfVoiceState => ({
    ready: true,
    stt: { provider: 'whisper-local', gpu: true },
    tts: { provider: 'supertonic', active: 'supertonic', device: 'cuda', fallbackReason: null },
    micMuted,
    quiet: false,
    bargeIn: 'wake',
    wakePaused: false,
    conversation: false,
  });
  const moduleInfo = (id: string, enabled: boolean, allowed = true): ModuleInfo => ({
    id,
    version: '1.0.0',
    kind: 'builtin',
    nameKey: `module.${id}.name`,
    descriptionKey: `module.${id}.description`,
    permissions: [],
    allowed,
    enabled,
    tools: [],
    page: null,
    error: null,
  });

  it('sistem isteminde öz-tanım (sayfalar, modüller, araç kümeleri) ve araç ilkeleri; mikrofon değişince istem AYNI kalır (aynı süreç), değişiklik <baglam>a girer', async () => {
    const h = setup();
    let muted = false;
    h.brain.attachSelfState(() => ({ voice: selfVoice(muted), admin: null, hotkeys: null, work: ['Araştırma: elektrikli araç pazarı (koşuyor)'] }));
    h.brain.attachModuleCatalog(() => [moduleInfo('planner', true), moduleInfo('voice-control', true), moduleInfo('meeting', false, false)]);
    await h.brain.prewarm('voice');
    const [warm] = cc.pids();
    const first = echo((await h.brain.respond({ role: 'voice', text: 'neler yapabilirsin [[sahte:yanki]]', origin: voice })).text);
    expect(first.pid).toBe(warm);
    expect(first.system).toContain('## KENDİN (uygulamanın kayıtlarından üretildi)');
    expect(first.system).toContain('kişilik adın Jarvis');
    expect(first.system).toContain('## Araç kullanım ilkeleri');
    expect(first.system).toContain('→ reminder_create');
    expect(first.system).toContain('KAPALI: Toplantı (Fuber Yönetim’de kapalı)');
    // Kapalı modülün sayfası yok; açık modülünkü var.
    expect(first.system).toMatch(/sayfalar \(app_navigate ile açarsın\): [^\n]*Planlar/);
    expect(first.system).not.toMatch(/sayfalar \(app_navigate ile açarsın\): [^\n]*Toplantı/);
    // Turdan tura değişen durum sabit istemde YOK; <baglam>dadır.
    expect(first.system).not.toContain('Mikrofon');
    expect(first.system).not.toContain('Araştırma: elektrikli araç');
    expect(first.user[0]).toContain('Mikrofon açık');
    expect(first.user[0]).toContain('Süren işler (1): Araştırma: elektrikli araç pazarı (koşuyor).');
    // Zengin yolda araç kümeleri <baglam>da yinelenmez (sabit istemde).
    expect(first.user[0]).not.toContain('Şu an yapabildiklerin');
    muted = true;
    const second = echo(
      (
        await h.brain.respond({
          role: 'voice',
          messages: [
            { role: 'user', text: 'neler yapabilirsin [[sahte:yanki]]' },
            { role: 'assistant', text: 'Sahte Claude' },
            { role: 'user', text: 'peki [[sahte:yanki]]' },
          ],
          origin: voice,
        })
      ).text,
    );
    expect(second.pid).toBe(warm);
    expect(second.system).toBe(first.system);
    expect(second.user.at(-1)).toContain('Mikrofon KAPALI');
  });

  it('modül kapanınca öz-tanım değişir: ısıtılmış yedek bayatlar (yenilenir), yeni süreç yeni istemle; aracı ve sayfası düşer', async () => {
    const h = setup();
    let plannerOn = true;
    h.brain.attachModuleCatalog(() => [moduleInfo('planner', plannerOn, plannerOn), moduleInfo('voice-control', true)]);
    await h.brain.prewarm('voice');
    const [warm] = cc.pids();
    const before = h.brain.selfKnowledge();
    expect(before).toContain('AÇIK: Planlar, Ses denetimi');
    // Modül kapandı: kayıt araçlarını kaldırır, `module.changed` yayınlanır.
    plannerOn = false;
    tools.unregisterModule('planner');
    bus.emit('module.changed', { id: 'planner', enabled: false, reason: 'policy' });
    await expectEventually(() => !cc.pids().includes(warm!));
    const after = h.brain.selfKnowledge();
    expect(after).not.toBe(before);
    expect(after).toContain('KAPALI: Planlar (Fuber Yönetim’de kapalı)');
    expect(after).not.toContain('reminder_create');
    expect(after).not.toMatch(/sayfalar \(app_navigate ile açarsın\): [^\n]*Planlar/);
    const seen = echo((await h.brain.respond({ role: 'voice', text: 'x [[sahte:yanki]]', origin: voice })).text);
    expect(seen.pid).not.toBe(warm);
    expect(seen.system).toContain('KAPALI: Planlar');
    expect(seen.tools).not.toContain('reminder_create');
  });

  it('self_status ile aynı kaynak: durum + öz-tanım; ısıtma ve tur aynı öz-tanımı kullanır', async () => {
    const h = setup();
    h.brain.attachModuleCatalog(() => [moduleInfo('planner', true), moduleInfo('voice-control', true)]);
    const knowledge = h.brain.selfKnowledge();
    expect(h.brain.selfKnowledge()).toBe(knowledge);
    const state = h.brain.selfState();
    // Durumdaki yetenekler de aynı kümelerden üretilir.
    expect(state.capabilities.map((item) => item.id)).toContain('group:planner');
    expect(knowledge).toContain('Hatırlatıcı ve yapılacaklar:');
  });
});

async function expectEventually(check: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(check()).toBe(true);
}
