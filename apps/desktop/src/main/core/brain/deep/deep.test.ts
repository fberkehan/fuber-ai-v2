// Derin beynin sağlayıcı seçimi ve iki sağlayıcının aynı sözleşmeyle çalışması (sahte beyin + sahte CLI).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type BrainRequest, type BrainTaskRequest, type ModuleContext, type Policy, type ToolResult } from '@fuber/shared';
import { fakePolicy, moduleContext, testBus } from '../testkit';
import { createDeepBrain, DeepBrainError, type DeepBrainService } from './index';
import { deepStatusSnapshot } from './status';
import { brainFail, brainOk, fakeCli, recordingBrain, tempDir } from './testkit';

const open: DeepBrainService[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const deep of open.splice(0)) deep.dispose();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Setting = Policy['brain']['deep']['provider'];

function setup(options: {
  setting?: Setting;
  key?: boolean;
  cli?: ReturnType<typeof fakeCli> | null;
  brain?: Parameters<typeof recordingBrain>[0];
  policy?: Partial<Policy>;
  networkAllowed?: boolean;
  killSwitch?: boolean;
}) {
  const bus = testBus();
  const policy = fakePolicy(
    {
      keys: options.key === false ? {} : { anthropic: 'test-key' },
      brain: { ...DEFAULT_POLICY.brain, deep: { provider: options.setting ?? 'auto', claudeCodeModel: 'haiku' } },
      ...options.policy,
    },
    { killSwitch: options.killSwitch ?? false },
  );
  if (options.networkAllowed === false) policy.networkAllowed = () => false;
  const recorded = recordingBrain(options.brain);
  const usage: unknown[] = [];
  const ctx: ModuleContext = moduleContext('workshop', {
    bus,
    policy,
    brain: recorded.brain,
    usage: { record: (entry: unknown) => (usage.push(entry), { costUsd: 0 }) } as unknown as ModuleContext['usage'],
  });
  const deep = createDeepBrain(ctx, { cli: options.cli === undefined ? fakeCli() : options.cli });
  open.push(deep);
  return { deep, ctx, bus, policy, usage, ...recorded };
}

describe('derin beyin: sağlayıcı seçimi', () => {
  it('auto: anahtar çalışıyorsa Anthropic API; soru kişiliksiz ve araçsız gider, görüntülü soru vision rolüyle', async () => {
    const { deep, calls } = setup({});
    expect(await deep.refresh()).toEqual({ ok: true, provider: 'anthropic' });
    const answer = await deep.ask({ system: 'Kısa yanıt ver.', prompt: 'Merhaba' });
    expect(answer).toEqual({ text: 'API yanıtı', provider: 'anthropic' });
    expect(calls[0]!.request).toMatchObject({ role: 'deep', tools: 'none', persona: false, instructions: 'Kısa yanıt ver.', origin: { channel: 'job' } });
    await deep.ask({ system: 's', prompt: 'Ne görüyorsun?', images: [{ mediaType: 'image/png', data: 'AAAA' }] });
    const vision = calls[1]!.request as BrainRequest;
    expect(vision.role).toBe('vision');
    expect(vision.messages?.[0]?.images).toEqual([{ mediaType: 'image/png', data: 'AAAA' }]);
  });

  it('auto: anahtar yoksa ve Claude Code hazırsa Claude Code; durum sürümü ve oturumu taşır', async () => {
    const { deep, calls, usage } = setup({ key: false });
    expect(await deep.refresh()).toEqual({ ok: true, provider: 'claude-code' });
    expect(deep.status()).toEqual({ ok: true, provider: 'claude-code', setting: 'auto', reason: null, claudeCode: { installed: true, version: '2.1.325', loggedIn: true } });
    const answer = await deep.ask({ system: 'Kısa yanıt ver.', prompt: 'Merhaba' });
    expect(answer.provider).toBe('claude-code');
    expect(answer.text).toContain('Sahte yanıt: Merhaba');
    expect(calls).toHaveLength(0);
    expect(usage).toEqual([expect.objectContaining({ kind: 'deep', provider: 'claude-code', costUsd: 0 })]);
  }, 20_000);

  it('auto: anahtar var ama beyin bulutun düştüğünü biliyorsa (kredi yok) doğrudan Claude Code', async () => {
    const { deep, calls } = setup({ brain: { status: () => ({ provider: 'local', reason: 'cloud_down', cause: 'billing' }) } });
    expect(await deep.refresh()).toEqual({ ok: true, provider: 'claude-code' });
    expect((await deep.ask({ system: 's', prompt: 'x' })).provider).toBe('claude-code');
    expect(calls).toHaveLength(0);
  }, 20_000);

  it('auto: API çağrı sırasında düşerse aynı iş Claude Code ile sürer ve sonraki işler API’yi yeniden denemez', async () => {
    const { deep, calls } = setup({ brain: { answer: () => brainFail('error', 'Yapay zekâ hesabında ödeme sorunu var.') } });
    const first = await deep.ask({ system: 's', prompt: 'ilk' });
    expect(first.provider).toBe('claude-code');
    expect(calls).toHaveLength(1);
    expect(deep.available()).toEqual({ ok: true, provider: 'claude-code' });
    const dir = tempDir('gecis');
    cleanups.push(dir.cleanup);
    const task = await deep.runTask({ kind: 'research', system: 's', prompt: 'ikinci', workDir: dir.dir, allowedTools: [], maxSeconds: 30 });
    expect(task).toMatchObject({ ok: true, provider: 'claude-code' });
    expect(calls).toHaveLength(1);
  }, 30_000);

  it('auto: API işin ortasında (araç turundan sonra) hata verirse Claude Code’a geçilmez; hata olduğu gibi döner', async () => {
    const { deep } = setup({
      brain: { answer: () => ({ ...brainFail('error', 'Bağlantı koptu.'), toolCalls: [{ callId: '1', name: 'deep_write_file', ok: true, text: 'yazıldı', durationMs: 1 }] }) },
    });
    const dir = tempDir('orta');
    cleanups.push(dir.cleanup);
    const task = await deep.runTask({ kind: 'skill_build', system: 's', prompt: 'p', workDir: dir.dir, allowedTools: ['write'], maxSeconds: 30 });
    expect(task).toMatchObject({ ok: false, provider: 'anthropic', stop: 'error', error: 'Bağlantı koptu.' });
  });

  it('seçim "anthropic": anahtar yoksa Claude Code hazır olsa bile kullanılmaz; neden söylenir', async () => {
    const { deep } = setup({ setting: 'anthropic', key: false });
    const availability = await deep.refresh();
    expect(availability.ok).toBe(false);
    expect(availability.reason).toContain('anahtarı tanımlı değil');
    await expect(deep.ask({ system: 's', prompt: 'x' })).rejects.toBeInstanceOf(DeepBrainError);
  }, 20_000);

  it('seçim "claude-code": anahtar olsa da Claude Code; oturum kapalıysa ya da sürüm eskiyse dürüst neden', async () => {
    const ready = setup({ setting: 'claude-code' });
    expect(await ready.deep.refresh()).toEqual({ ok: true, provider: 'claude-code' });
    const loggedOut = setup({ setting: 'claude-code', cli: fakeCli({ FAKE_CLAUDE_AUTH: 'out' }) });
    expect(await loggedOut.deep.refresh()).toMatchObject({ ok: false, provider: null });
    expect(loggedOut.deep.status().reason).toContain('oturum açık değil');
    const old = setup({ setting: 'claude-code', cli: fakeCli({ FAKE_CLAUDE_VERSION: '2.1.100' }) });
    await old.deep.refresh();
    expect(old.deep.status().reason).toContain('sürümü eski (2.1.100)');
    const task = await old.deep.runTask({ kind: 'x', system: 's', prompt: 'p', workDir: '.', allowedTools: [], maxSeconds: 5 });
    expect(task).toMatchObject({ ok: false, stop: 'unavailable', provider: null });
  }, 30_000);

  it('hiçbiri yoksa "derin beyin yok" iki nedeni de söyler; ask fırlatır, runTask dürüst sonuç döner', async () => {
    const { deep, calls } = setup({ key: false, cli: null });
    const availability = await deep.refresh();
    expect(availability.ok).toBe(false);
    expect(availability.reason).toContain('Anthropic anahtarı tanımlı değil');
    expect(availability.reason).toContain('Claude Code bu bilgisayarda kurulu değil');
    await expect(deep.ask({ system: 's', prompt: 'x' })).rejects.toMatchObject({ stop: 'unavailable' });
    expect(calls).toHaveLength(0);
  });

  it('Gizli kip, acil durdurma ve yerel derin rol: derin iş yapılmaz / API sayılmaz', async () => {
    const privateMode = setup({ networkAllowed: false });
    expect((await privateMode.deep.refresh()).reason).toContain('Gizli kipte');
    const stopped = setup({ killSwitch: true });
    expect((await stopped.deep.refresh()).ok).toBe(false);
    const localRole = setup({ policy: { models: { ...DEFAULT_POLICY.models, deep: { ...DEFAULT_POLICY.models.deep, provider: 'local' } } } });
    expect(await localRole.deep.refresh()).toEqual({ ok: true, provider: 'claude-code' });
  }, 20_000);

  it('durum beyin servisine yayınlatılır ve politika değişince yeniden hesaplanır', async () => {
    const { deep, policy, bus, statusCalls } = setup({ key: false });
    await deep.refresh();
    expect(deepStatusSnapshot()).toMatchObject({ ok: true, provider: 'claude-code', setting: 'auto' });
    const before = statusCalls();
    policy.set({ brain: { ...DEFAULT_POLICY.brain, deep: { provider: 'anthropic', claudeCodeModel: 'haiku' } } });
    bus.emit('policy.changed', { revision: 2, source: 'remote', changedKeys: ['brain'] });
    expect(deepStatusSnapshot()).toMatchObject({ ok: false, provider: null, setting: 'anthropic' });
    expect(statusCalls()).toBeGreaterThan(before);
  }, 20_000);
});

describe('derin beyin: Anthropic sağlayıcısında çok adımlı iş', () => {
  it('yalnız çalışma klasörüne yazan dosya araçları ve istenirse web araçları verilir; kayıtlı araç verilmez', async () => {
    const dir = tempDir('api');
    cleanups.push(dir.cleanup);
    let captured: BrainTaskRequest | null = null;
    const { deep } = setup({
      setting: 'anthropic',
      brain: {
        answer: (request) => {
          captured = request as BrainTaskRequest;
          return brainOk('Yazdım.');
        },
      },
    });
    const result = await deep.runTask({ kind: 'skill_build', system: 'Yaz.', prompt: 'Dosyayı yaz', workDir: dir.dir, allowedTools: ['read', 'write', 'web'], maxSeconds: 30 });
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', stop: 'end', text: 'Yazdım.' });
    const request = captured! as BrainTaskRequest;
    expect(request).toMatchObject({ role: 'deep', tools: 'none', persona: false, instructions: 'Yaz.', goal: 'Dosyayı yaz', serverTools: ['web_search', 'web_fetch'] });
    const tools = request.extraTools!.tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(['deep_list_files', 'deep_read_file', 'deep_write_file']);
    const run = (name: string, input: unknown) => tools.find((tool) => tool.name === name)!.run(input as never, {} as never) as Promise<ToolResult>;
    expect((await run('deep_write_file', { path: 'not.txt', content: 'içerik' })).ok).toBe(true);
    expect(fs.readFileSync(path.join(dir.dir, 'not.txt'), 'utf8')).toBe('içerik');
    for (const escape of ['../kacak.txt', '..\\kacak.txt', 'C:\\Windows\\kacak.txt', '/etc/kacak', 'alt/../../kacak.txt']) {
      expect((await run('deep_write_file', { path: escape, content: 'x' })).ok).toBe(false);
      expect((await run('deep_read_file', { path: escape })).ok).toBe(false);
    }
    expect(fs.existsSync(path.join(path.dirname(dir.dir), 'kacak.txt'))).toBe(false);
    expect((await run('deep_list_files', {})).text).toBe('not.txt');
    expect((await run('deep_read_file', { path: 'not.txt' })).text).toBe('içerik');
  });

  it('yalnız okuma istenirse yazma aracı, web istenmezse sunucu aracı verilmez; süre dolarsa "zaman aşımı"', async () => {
    const dir = tempDir('api2');
    cleanups.push(dir.cleanup);
    let captured: BrainTaskRequest | null = null;
    const { deep } = setup({
      setting: 'anthropic',
      brain: {
        answer: (request) =>
          new Promise((resolve) => {
            captured = request as BrainTaskRequest;
            request.signal?.addEventListener('abort', () => resolve(brainFail('aborted', '')));
          }),
      },
    });
    const result = await deep.runTask({ kind: 'x', system: 's', prompt: 'p', workDir: dir.dir, allowedTools: ['read'], maxSeconds: 0.2 });
    expect(result).toMatchObject({ ok: false, stop: 'timeout' });
    const request = captured! as BrainTaskRequest;
    expect(request.extraTools!.tools.map((tool) => tool.name).sort()).toEqual(['deep_list_files', 'deep_read_file']);
    expect(request.serverTools).toBeUndefined();
  });
});
