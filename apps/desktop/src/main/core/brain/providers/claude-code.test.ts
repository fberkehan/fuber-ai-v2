// Konuşan beynin Claude Code sağlayıcısı, SAHTE CLI ile (`scripts/e2e/brain/fake-claude-brain.mjs`): yoklama, sıcak
// süreç, akış, oturum bağlamı ve önsöz, MCP üzerinden araç, iptal, çökme sonrası yeniden başlama, sınır ve oturum
// hataları, süre aşımı, yalıtım ve artık süreç kalmaması. Ağ yok, kota harcanmaz.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAlive } from '../../claude-cli';
import { fakeBrainCli, tempDir } from '../../claude-cli/testkit';
import { silentLog } from '../testkit';
import { createClaudeCodeBrain, type ClaudeCodeBrain, type ClaudeCodeBrainOptions, type ClaudeCodeSpec, type ClaudeCodeToolCall, type ClaudeCodeTurnRequest } from './claude-code';
import type { ConvMessage } from './types';

const TOOL = { name: 'reminder_create', description: 'Hatırlatıcı kurar.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } };
const spec = (over: Partial<ClaudeCodeSpec> = {}): ClaudeCodeSpec => ({ kind: 'voice', model: 'sonnet', effort: 'low', system: 'Sen Jarvis adında bir asistansın.', tools: [TOOL], maxTurns: 10, ...over });

let temp: ReturnType<typeof tempDir>;
let brains: ClaudeCodeBrain[];
let toolCalls: ClaudeCodeToolCall[];

const make = (env: Record<string, string> = {}, options: Partial<ClaudeCodeBrainOptions> = {}): ClaudeCodeBrain => {
  const brain = createClaudeCodeBrain({ log: silentLog }, { cli: fakeBrainCli(env), workDir: temp.dir, ...options });
  brains.push(brain);
  return brain;
};

interface TurnOptions extends Partial<ClaudeCodeTurnRequest> {
  history?: ConvMessage[];
}
async function turn(brain: ClaudeCodeBrain, text: string, options: TurnOptions = {}) {
  const chunks: string[] = [];
  const { history = [], ...over } = options;
  const result = await brain.run({
    ...spec(),
    sessionKey: 's1',
    messages: [...history, { role: 'user', text }],
    userKey: text.replace(/\s*\[\[sahte:[^\]]+\]\]/g, '').trim() || text,
    assistantName: 'Jarvis',
    compose: ({ fresh }) => `<baglam>\n${fresh ? 'ilk tur' : 'sonraki tur'}\n</baglam>`,
    async runTool(call) {
      toolCalls.push(call);
      return { text: `Kuruldu: ${JSON.stringify(call.input)}`, isError: false };
    },
    onText: (delta) => void chunks.push(delta),
    firstOutputTimeoutMs: 8000,
    totalTimeoutMs: 20_000,
    ...over,
  });
  return { result, chunks, text: chunks.join('') };
}
const echo = (text: string) =>
  JSON.parse(text) as { args: string[]; env: string[]; system: string; systemInsideCwd: boolean; cwd: string; tools: string[]; mcp: string; mcpUrl: string; mcpAuth: string; turn: number; user: string[]; pid: number };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await sleep(25);
  return check();
};
const spawnedPids = () => {
  try {
    return fs.readFileSync(path.join(temp.dir, 'sahte-pidler.txt'), 'utf8').split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
};

beforeEach(() => {
  temp = tempDir('cc-beyin');
  brains = [];
  toolCalls = [];
});
afterEach(async () => {
  for (const brain of brains) await brain.dispose();
  await temp.cleanup();
});

describe('yoklama', () => {
  it('kurulu, sürümü yeterli ve oturumu açık CLI hazırdır; yoklama model çağırmaz', async () => {
    const brain = make();
    expect(brain.availability()).toMatchObject({ ok: false, state: 'checking' });
    expect(await brain.refresh()).toMatchObject({ ok: true, state: 'ready', version: '2.1.325' });
    expect(spawnedPids()).toEqual([]);
  });

  it('CLI yoksa, oturum kapalıysa ya da sürüm eskiyse nedenini söyler', async () => {
    const none = createClaudeCodeBrain({ log: silentLog }, { cli: null, workDir: temp.dir });
    brains.push(none);
    expect(none.availability()).toMatchObject({ ok: false, state: 'missing', issue: 'missing' });
    expect(await make({ FAKE_CLAUDE_AUTH: 'out' }).refresh()).toMatchObject({ ok: false, state: 'logged_out', issue: 'auth', reason: expect.stringContaining('oturum') });
    expect(await make({ FAKE_CLAUDE_VERSION: '2.0.0' }).refresh()).toMatchObject({ ok: false, state: 'old' });
  });
});

describe('sıcak süreç ve akış', () => {
  it('ısıtma süreci açar ve MCP sunucusuna bağlar; ilk tur aynı süreci kullanır (soğuk açılış yok)', async () => {
    const brain = make();
    await brain.prewarm(spec());
    expect(brain.snapshot().warm).toBe(1);
    const [pid] = brain.pids();
    expect(pid).toBeGreaterThan(0);
    const { result, text } = await turn(brain, 'merhaba [[sahte:yanki]]');
    expect(result).toMatchObject({ stop: 'end', cold: false, failure: null });
    const seen = echo(text);
    expect(seen.pid).toBe(pid);
    expect(seen.mcp).toBe('connected');
    expect(seen.tools).toEqual(['reminder_create']);
    // İkinci ısıtma yeni süreç açmaz.
    await brain.prewarm(spec());
    expect(spawnedPids()).toHaveLength(1);
  });

  it('metin parça parça akar; kullanım ve ilk parça süresi döner', async () => {
    const brain = make();
    const { result, chunks, text } = await turn(brain, 'Türkiye’nin başkenti neresi?');
    expect(text).toBe('Sahte Claude: Türkiye’nin başkenti neresi?');
    expect(chunks.length).toBeGreaterThan(2);
    expect(result).toMatchObject({ stop: 'end', cold: true, model: 'claude-sonnet-sahte' });
    expect(result.usage).toMatchObject({ outputTokens: 20, cacheWriteTokens: 100 });
    expect(result.firstTextMs).not.toBeNull();
    expect(brain.snapshot().lastFirstTextMs).toBe(result.firstTextMs);
  });

  it('oturum sürerken yalnız yeni söz gider; yeni süreçte uygulamanın geçmişi önsöz olur', async () => {
    const brain = make();
    const history: ConvMessage[] = [
      { role: 'user', text: 'Adım Gökay.' },
      { role: 'assistant', text: 'Memnun oldum Gökay Bey.', toolCalls: [] },
    ];
    await turn(brain, 'ilk söz', { history });
    const second = await turn(brain, 'ikinci söz [[sahte:yanki]]', { history: [...history, { role: 'user', text: 'ilk söz' }, { role: 'assistant', text: 'Sahte Claude: ilk söz', toolCalls: [] }] });
    const seen = echo(second.text);
    expect(seen.turn).toBe(2);
    expect(seen.user[0]).toContain('<onceki_konusma>');
    expect(seen.user[0]).toContain('Kullanıcı: Adım Gökay.');
    expect(seen.user[0]).toContain('Jarvis: Memnun oldum Gökay Bey.');
    expect(seen.user[0]).toContain('<baglam>\nilk tur\n</baglam>');
    // İkinci tur: önsöz yok, bağlam "sonraki", yalnız yeni söz.
    expect(seen.user[1]).not.toContain('<onceki_konusma>');
    expect(seen.user[1]).toContain('<baglam>\nsonraki tur\n</baglam>');
    expect(seen.user[1]).toContain('ikinci söz');
    expect(second.result.cold).toBe(false);
    expect(spawnedPids()).toHaveLength(1);
  });

  it('sürecin görmediği aradaki tur bir sonraki sözde aktarılır', async () => {
    const brain = make();
    await turn(brain, 'merhaba');
    const history: ConvMessage[] = [
      { role: 'user', text: 'merhaba' },
      { role: 'assistant', text: 'Sahte Claude: merhaba', toolCalls: [] },
      { role: 'user', text: 'saat kaç' },
      { role: 'assistant', text: 'Saat 14:05.', toolCalls: [] },
    ];
    const next = await turn(brain, 'teşekkürler [[sahte:yanki]]', { history });
    const seen = echo(next.text);
    expect(seen.user[1]).toContain('sen bağlı değilken konuşulanlar');
    expect(seen.user[1]).toContain('Kullanıcı: saat kaç');
    expect(seen.user[1]).toContain('Jarvis: Saat 14:05.');
    expect(seen.user[1]).not.toContain('Kullanıcı: merhaba');
  });

  it('başka oturum, değişen istem ya da araç kümesi yeni süreç açar; eskisi kapanır', async () => {
    const brain = make();
    const first = echo((await turn(brain, 'a [[sahte:yanki]]')).text);
    const other = echo((await turn(brain, 'b [[sahte:yanki]]', { sessionKey: 's2' })).text);
    expect(other.pid).not.toBe(first.pid);
    expect(await until(() => !isAlive(first.pid))).toBe(true);
    const changed = echo((await turn(brain, 'c [[sahte:yanki]]', { sessionKey: 's2', system: 'Değişmiş istem.' })).text);
    expect(changed.pid).not.toBe(other.pid);
    expect(changed.system).toBe('Değişmiş istem.');
    expect(brain.snapshot().warm).toBe(1);
  });

  it('oturumsuz çağrı tek kullanımlık süreçte yürür', async () => {
    const brain = make();
    const { result } = await turn(brain, 'tek seferlik', { sessionKey: null, kind: 'task' });
    expect(result.stop).toBe('end');
    expect(await until(() => brain.snapshot().processes === 0)).toBe(true);
  });
});

describe('yalıtım', () => {
  it('yerleşik araçlar kapalı, yalnız kendi MCP sunucumuz; belirteç komut satırında değil; ortam izin listesinden', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-' + 'ant-SIZMAMALI';
    process.env.FUBER2_GIZLI = 'x';
    try {
      const brain = make();
      const seen = echo((await turn(brain, 'x [[sahte:yanki]]')).text);
      const flags = seen.args;
      const value = (name: string) => flags[flags.indexOf(name) + 1];
      expect(value('--tools')).toBe('');
      expect(value('--allowedTools')).toBe('mcp__fuber');
      expect(value('--permission-mode')).toBe('dontAsk');
      expect(value('--permission-prompts')).toBe('none');
      expect(value('--setting-sources')).toBe('');
      for (const flag of ['--restricted', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--include-partial-messages']) expect(flags).toContain(flag);
      expect(flags).not.toContain('--safe-mode');
      expect(flags).not.toContain('--bare');
      const mcp = JSON.parse(value('--mcp-config')!) as { mcpServers: Record<string, { url: string; headers: { Authorization: string } }> };
      expect(Object.keys(mcp.mcpServers)).toEqual(['fuber']);
      expect(mcp.mcpServers.fuber!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      // Belirteç argümanda yer tutucudur; değeri yalnız sürecin ortamındadır.
      expect(mcp.mcpServers.fuber!.headers.Authorization).toBe('Bearer ${FUBER_MCP_TOKEN}');
      expect(seen.env).toContain('FUBER_MCP_TOKEN');
      expect(seen.env).not.toContain('ANTHROPIC_API_KEY');
      expect(seen.env.some((name) => name.startsWith('FUBER2_') || name === 'CLAUDECODE')).toBe(false);
      expect(seen.env).toEqual(expect.arrayContaining(['CLAUDE_CODE_DISABLE_CLAUDE_MDS', 'ENABLE_CLAUDEAI_MCP_SERVERS', 'ENABLE_TOOL_SEARCH']));
      expect(seen.system).toBe('Sen Jarvis adında bir asistansın.');
      expect(seen.systemInsideCwd).toBe(false);
      expect(seen.cwd.startsWith(temp.dir)).toBe(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.FUBER2_GIZLI;
    }
  });

  it('süreçte yerleşik bir araç görülürse tur başlamadan süreç öldürülür', async () => {
    const brain = make();
    const { result, text } = await turn(brain, 'x [[sahte:yerlesik]]');
    expect(result.stop).toBe('isolation');
    expect(text).toBe('');
    expect(await until(() => brain.snapshot().processes === 0)).toBe(true);
  });
});

describe('araç çağrısı (MCP)', () => {
  it('araç çağrısı çağıranın işleyicisine gider ve sonucu modele döner', async () => {
    const brain = make();
    const { result, text } = await turn(brain, 'KDV’yi hatırlat [[sahte:arac|reminder_create|{"text":"KDV"}]]');
    expect(result.stop).toBe('end');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ name: 'reminder_create', input: { text: 'KDV' } });
    expect(toolCalls[0]!.toolUseId).toMatch(/^toolu_sahte_/);
    expect(text).toBe('Araç sonucu: Kuruldu: {"text":"KDV"}');
    expect(brain.snapshot().mcpCalls).toBe(1);
  });

  it('tur dışında gelen araç çağrısı (geçerli belirteçle bile) çalıştırılmaz; süreç kapanınca belirteç geçersizleşir', async () => {
    const brain = make();
    const seen = echo((await turn(brain, 'x [[sahte:yanki]]')).text);
    expect(seen.mcpAuth).toMatch(/^Bearer .{40,}$/);
    const call = () =>
      fetch(seen.mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: seen.mcpAuth },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'reminder_create', arguments: { text: 'tur dışı' } } }),
      });
    // Tur bitti: süreç yaşıyor, belirteç geçerli, ama süren tur yok.
    const idle = await call();
    expect(idle.status).toBe(200);
    const body = (await idle.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(toolCalls).toHaveLength(0);
    await brain.dispose();
    await expect(call().then((response) => response.status)).rejects.toThrow();
  });
});

describe('iptal ve süre', () => {
  it('araya girme turu anında keser; süreç sıcak kalır ve sonraki turu yürütür', async () => {
    const brain = make();
    const first = echo((await turn(brain, 'ısın [[sahte:yanki]]')).text);
    const controller = new AbortController();
    const started = Date.now();
    let cutAt = 0;
    const chunks: string[] = [];
    const long = await turn(brain, 'uzun anlat [[sahte:uzun|60|40]]', {
      signal: controller.signal,
      onText(delta) {
        chunks.push(delta);
        if (chunks.length === 3) {
          cutAt = Date.now();
          controller.abort();
        }
      },
    });
    expect(long.result.stop).toBe('aborted');
    expect(Date.now() - cutAt).toBeLessThan(250);
    expect(Date.now() - started).toBeLessThan(2000);
    const size = chunks.length;
    await sleep(150);
    expect(chunks.length).toBe(size);
    const next = await turn(brain, 'şimdi [[sahte:yanki]]', {
      history: [
        { role: 'user', text: 'ısın' },
        { role: 'assistant', text: 'x', toolCalls: [] },
        { role: 'user', text: 'uzun anlat' },
        { role: 'assistant', text: `${long.result.text} (yanıt burada yarıda kesildi)`, toolCalls: [] },
      ],
    });
    const seen = echo(next.text);
    expect(seen.pid).toBe(first.pid);
    expect(next.result.cold).toBe(false);
    expect(seen.user.at(-1)).not.toContain('<onceki_konusma>');
  });

  it('süre sınırı araç çalışırken (onay beklerken de) işlemez: sınırdan uzun süren araç turu öldürmez', async () => {
    const brain = make();
    const started = Date.now();
    const { result } = await turn(brain, 'Hatırlat [[sahte:arac|reminder_create|{"text":"uzun iş"}]]', {
      // Sınır 600 ms; araç 1500 ms sürüyor (gerçek kullanımda `pc_type` 17 sn, onay beklemesi 60 sn'ye kadar).
      totalTimeoutMs: 600,
      async runTool() {
        await sleep(1500);
        return { text: 'Kuruldu.', isError: false };
      },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(result.stop).toBe('end');
    expect(result.failure).toBeNull();
    expect(result.text).toContain('Kuruldu.');
    expect(brain.snapshot().processes).toBe(1);
  });

  it('ilk çıktı süresinde yanıt gelmezse tur biter ve süreç kapatılır', async () => {
    const brain = make();
    const { result } = await turn(brain, 'x [[sahte:asili]]', { firstOutputTimeoutMs: 300 });
    expect(result).toMatchObject({ stop: 'timeout', failure: { issue: 'network' } });
    expect(await until(() => brain.snapshot().processes === 0)).toBe(true);
    expect(await until(() => spawnedPids().every((pid) => !isAlive(pid)))).toBe(true);
  });
});

describe('hatalar', () => {
  it('çöken süreçten sonra tur yeniden başlar: yeni süreç geçmişi önsözle alır', async () => {
    const brain = make();
    const first = echo((await turn(brain, 'merhaba [[sahte:yanki]]')).text);
    const crashed = await turn(brain, 'çök [[sahte:cokme]]');
    expect(crashed.result).toMatchObject({ stop: 'crash', failure: { issue: 'network' } });
    const again = await turn(brain, 'yeniden [[sahte:yanki]]', {
      history: [
        { role: 'user', text: 'merhaba' },
        { role: 'assistant', text: 'yanıt', toolCalls: [] },
      ],
    });
    const seen = echo(again.text);
    expect(again.result).toMatchObject({ stop: 'end', cold: true });
    expect(seen.pid).not.toBe(first.pid);
    expect(seen.user[0]).toContain('<onceki_konusma>');
    expect(seen.user[0]).toContain('Kullanıcı: merhaba');
  });

  it('turlar arasında çöken süreç de yenilenir', async () => {
    const brain = make();
    await turn(brain, 'a [[sahte:cokme-sonra]]');
    expect(await until(() => brain.snapshot().processes === 0)).toBe(true);
    const next = await turn(brain, 'b');
    expect(next.result).toMatchObject({ stop: 'end', cold: true });
  });

  it('açılışta çöken CLI: ısıtma sessizce düşer, tur nedenini bildirir', async () => {
    const brain = make({ SAHTE_CC_ACILIS: 'cokme' });
    await brain.prewarm(spec());
    expect(brain.snapshot().processes).toBe(0);
    const { result } = await turn(brain, 'merhaba');
    expect(result).toMatchObject({ stop: 'crash', failure: { issue: 'network' } });
  });

  it('abonelik sınırı: CLI’nin iletisi kullanıcıya aktarılmaz; sınır açılana dek kullanılamaz sayılır', async () => {
    const brain = make({}, { limitDownMs: 400 });
    await brain.refresh();
    let changes = 0;
    brain.onChange(() => changes++);
    const { result, text } = await turn(brain, 'x [[sahte:limit]]');
    expect(text).toBe('');
    expect(result.stop).toBe('limit');
    expect(result.failure).toMatchObject({ issue: 'limit', reason: expect.stringContaining('kullanım sınırı doldu') });
    const state = brain.availability();
    expect(state).toMatchObject({ ok: false, state: 'limit', issue: 'limit' });
    expect(state.resetsAt).toBeGreaterThan(Date.now());
    // Düşükken tur hiç süreç açmadan döner.
    const before = spawnedPids().length;
    const blocked = await turn(brain, 'yine');
    expect(blocked.result.failure).toMatchObject({ issue: 'limit' });
    expect(spawnedPids().length).toBe(before);
    await sleep(0);
    expect(changes).toBeGreaterThan(0);
  });

  it('oturum hatası: yoklama "oturum kapalı" olur', async () => {
    const brain = make();
    const { result, text } = await turn(brain, 'x [[sahte:oturum]]');
    expect(text).toBe('');
    expect(result).toMatchObject({ stop: 'auth', failure: { issue: 'auth' } });
    expect(brain.availability()).toMatchObject({ ok: false, state: 'logged_out' });
  });

  it('art arda iki hatadan sonra kısa süre denenmez, sonra kendiliğinden döner', async () => {
    const brain = make({}, { errorDownMs: 300 });
    await turn(brain, 'a [[sahte:cokme]]');
    expect(brain.availability().ok).toBe(true);
    await turn(brain, 'b [[sahte:cokme]]');
    expect(brain.availability()).toMatchObject({ ok: false, state: 'error' });
    await sleep(350);
    expect(brain.availability().ok).toBe(true);
    expect((await turn(brain, 'c')).result.stop).toBe('end');
  });
});

describe('yaşam döngüsü', () => {
  it('boşta kalan süreç kapanır', async () => {
    const brain = make({}, { idleMs: 150 });
    await turn(brain, 'merhaba');
    expect(brain.snapshot().warm).toBe(1);
    expect(await until(() => brain.snapshot().processes === 0, 3000)).toBe(true);
    expect(await until(() => spawnedPids().every((pid) => !isAlive(pid)))).toBe(true);
  });

  it('kapanışta artık süreç kalmaz', async () => {
    const brain = make();
    await brain.prewarm(spec());
    await brain.prewarm(spec({ kind: 'chat' }));
    await turn(brain, 'merhaba');
    const pids = spawnedPids();
    expect(pids.length).toBeGreaterThanOrEqual(2);
    expect(pids.some((pid) => isAlive(pid))).toBe(true);
    await brain.dispose();
    expect(await until(() => pids.every((pid) => !isAlive(pid)))).toBe(true);
    expect(brain.pids()).toEqual([]);
  });
});
