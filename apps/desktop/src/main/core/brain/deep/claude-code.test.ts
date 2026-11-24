// Claude Code sağlayıcısı sahte CLI ile (gerçek süreç, gerçek akış; ağ ve kota yok). Gerçek CLI ile doğrulama:
// `scripts/e2e/workshop.mjs --bridge-real`.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isAlive as alive } from '../../claude-cli';
import { silentLog } from '../testkit';
import { createClaudeCodeProvider } from './claude-code';
import { fakeCli, tempDir } from './testkit';
import type { DeepTaskEvent } from './types';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function work(label: string): string {
  const temp = tempDir(label);
  cleanups.push(temp.cleanup);
  return temp.dir;
}

const provider = (env: Record<string, string> = {}, extra: Partial<Parameters<typeof createClaudeCodeProvider>[0]> = {}) =>
  createClaudeCodeProvider({ command: () => fakeCli(env), model: () => 'haiku', log: silentLog, ...extra });

const until = async (check: () => boolean, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
};

describe('Claude Code sağlayıcısı (sahte CLI)', () => {
  it('ask: kendi sistem istemimiz dosyadan ve çalışma klasörünün DIŞINDAN verilir; araç yok, tek tur, temiz ortam', async () => {
    process.env.ANTHROPIC_API_KEY = 'sinama-anahtari-gecmemeli';
    try {
      const run = await provider().ask({ system: 'Sen Jarvis’in derin beynisin. KANIT-7', prompt: 'Merhaba [[sahte:yanki]]' });
      expect(run.ok).toBe(true);
      const seen = JSON.parse(run.text) as { args: string[]; system: string; systemInsideCwd: boolean; cwdFiles: string[]; env: string[] };
      expect(seen.system).toBe('Sen Jarvis’in derin beynisin. KANIT-7');
      expect(seen.systemInsideCwd).toBe(false);
      expect(seen.cwdFiles).toEqual([]);
      expect(seen.args[seen.args.indexOf('--tools') + 1]).toBe('');
      expect(seen.args[seen.args.indexOf('--max-turns') + 1]).toBe('1');
      expect(seen.args[seen.args.indexOf('--model') + 1]).toBe('haiku');
      expect(seen.args).toEqual(expect.arrayContaining(['--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']));
      expect(seen.env).not.toContain('ANTHROPIC_API_KEY');
      expect(seen.env.some((name) => name.startsWith('CLAUDE') || name.startsWith('FUBER2_'))).toBe(false);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 20_000);

  it('ask: görüntü dosyası ileti içinde base64 olarak gider; desteklenmeyen tür dürüstçe reddedilir', async () => {
    const dir = work('goruntu');
    const png = path.join(dir, 'ekran.png');
    fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
    const run = await provider().ask({ system: 'Görüntüyü anlat.', prompt: 'Ne var? [[sahte:goruntu]]', images: [png, { mediaType: 'image/jpeg', data: Buffer.from('abc').toString('base64') }] });
    expect(run.text).toBe('Görüntü: image/png, 16 bayt; image/jpeg, 3 bayt');
    const bad = path.join(dir, 'belge.pdf');
    fs.writeFileSync(bad, 'x');
    await expect(provider().ask({ system: 's', prompt: 'p', images: [bad] })).rejects.toThrow(/desteklenmiyor/);
    await expect(provider().ask({ system: 's', prompt: 'p', images: [path.join(dir, 'yok.png')] })).rejects.toThrow(/okunamadı/);
  }, 20_000);

  it('runTask: dosyalar yalnız çalışma klasörüne yazılır; araç olayları dosya adıyla bildirilir', async () => {
    const dir = work('yetenek');
    const events: DeepTaskEvent[] = [];
    const usage: unknown[] = [];
    const result = await provider({}, { onUsage: (entry) => usage.push(entry) }).runTask({
      kind: 'skill_build',
      system: 'Yetenek yaz.',
      prompt: 'Zar yeteneği [[sahte:yetenek|zar_a]]',
      workDir: dir,
      allowedTools: ['read', 'write'],
      maxSeconds: 30,
      onEvent: (event) => events.push(event),
    });
    expect(result).toMatchObject({ ok: true, stop: 'end', provider: 'claude-code', error: null, denials: 0 });
    expect(result.text).toContain('yetenek yazdım');
    expect(fs.readdirSync(dir).sort()).toEqual(['index.mjs', 'manifest.json', 'selftest.mjs']);
    expect(events[0]).toMatchObject({ type: 'started', provider: 'claude-code' });
    const writes = events.filter((event) => event.type === 'tool' && event.phase === 'start').map((event) => (event as { detail: string }).detail);
    expect(writes).toEqual(['manifest.json', 'index.mjs', 'selftest.mjs']);
    expect(events.filter((event) => event.type === 'tool' && event.phase === 'end' && event.ok)).toHaveLength(3);
    expect(usage).toHaveLength(1);
  }, 20_000);

  it('runTask: yalnız istenen araç grupları verilir (web isteyen işe dosya aracı gitmez)', async () => {
    const dir = work('arac');
    const result = await provider().runTask({ kind: 'research', system: 's', prompt: '[[sahte:yanki]]', workDir: dir, allowedTools: ['web'], maxSeconds: 30 });
    const seen = JSON.parse(result.text) as { args: string[]; cwd: string };
    expect(seen.args[seen.args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    expect(seen.args[seen.args.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch');
    expect(fs.realpathSync(seen.cwd)).toBe(fs.realpathSync(dir));
  }, 20_000);

  it('klasör dışına yazma denemesi izin reddi olarak sayılır ve dışarıda dosya oluşmaz', async () => {
    const root = work('kacak');
    const dir = path.join(root, 'a', 'b');
    fs.mkdirSync(dir, { recursive: true });
    const events: DeepTaskEvent[] = [];
    const result = await provider().runTask({ kind: 'skill_build', system: 's', prompt: '[[sahte:kacak|zar_k]]', workDir: dir, allowedTools: ['write'], maxSeconds: 30, onEvent: (event) => events.push(event) });
    expect(result.ok).toBe(true);
    expect(result.denials).toBe(1);
    expect(events.some((event) => event.type === 'denied' && event.tool === 'Write')).toBe(true);
    expect(fs.existsSync(path.join(root, 'kacak.txt'))).toBe(false);
  }, 20_000);

  it('abonelik sınırı: dürüst ileti, sınır olayı; yanıt uydurulmaz', async () => {
    const events: DeepTaskEvent[] = [];
    const result = await provider().runTask({ kind: 'research', system: 's', prompt: '[[sahte:limit]]', workDir: work('limit'), allowedTools: ['web'], maxSeconds: 30, onEvent: (event) => events.push(event) });
    expect(result).toMatchObject({ ok: false, stop: 'limit' });
    expect(result.error).toContain('kullanım sınırı doldu');
    expect(events.find((event) => event.type === 'limit')).toMatchObject({ status: 'rejected', resetsAt: new Date(1794999600 * 1000).toISOString() });
  }, 20_000);

  it('oturum hatası: "oturum açın" denir ve yoklama önbelleği bozulur', async () => {
    let authFailures = 0;
    const run = await provider({}, { onAuthFailure: () => authFailures++ }).ask({ system: 's', prompt: '[[sahte:oturum]]' });
    expect(run).toMatchObject({ ok: false, stop: 'auth' });
    expect(run.error).toContain('oturum');
    expect(authFailures).toBe(1);
  }, 20_000);

  it('bozuk çıktı: sonuç olayı yoksa hata; çöpün arasındaki geçerli sonuç okunur', async () => {
    const broken = await provider().ask({ system: 's', prompt: '[[sahte:cop]]' });
    expect(broken).toMatchObject({ ok: false, stop: 'error' });
    expect(broken.error).toContain('sonuç vermeden kapandı');
    const mixed = await provider().ask({ system: 's', prompt: '[[sahte:cop-sonuc]]' });
    expect(mixed).toMatchObject({ ok: true, text: 'Çöpün arasından yanıt.' });
  }, 20_000);

  it('CLI çökerse hata çıktısının kuyruğu iletilir; CLI yoksa "kurulu değil" denir', async () => {
    const crashed = await provider().ask({ system: 's', prompt: '[[sahte:cokme]]' });
    expect(crashed).toMatchObject({ ok: false, stop: 'error' });
    expect(crashed.error).toContain('bilerek çöktü');
    const missing = await createClaudeCodeProvider({ command: () => null, model: () => 'haiku', log: silentLog }).ask({ system: 's', prompt: 'p' });
    expect(missing).toMatchObject({ ok: false, stop: 'unavailable' });
    const gone = await createClaudeCodeProvider({ command: () => ({ command: path.join(work('yok'), 'claude.exe'), prefixArgs: [] }), model: () => 'haiku', log: silentLog }).ask({ system: 's', prompt: 'p' });
    expect(gone).toMatchObject({ ok: false, stop: 'error' });
    expect(gone.error).toContain('başlatılamadı');
  }, 20_000);

  it('zaman aşımı: süreç ağacı (torun dahil) öldürülür', async () => {
    const dir = work('asili');
    const pidFile = path.join(dir, 'pid.json');
    const result = await provider().runTask({ kind: 'research', system: 's', prompt: `[[sahte:asili|${pidFile}]]`, workDir: dir, allowedTools: [], maxSeconds: 2 });
    expect(result).toMatchObject({ ok: false, stop: 'timeout' });
    expect(result.error).toContain('2 saniyede bitmedi');
    const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as { pid: number; child: number };
    expect(await until(() => !alive(pids.pid) && !alive(pids.child))).toBe(true);
  }, 30_000);

  it('iptal: sinyal gelince süreç ağacı öldürülür ve sonuç "iptal" olur; önceden iptal edilmiş iş hiç başlamaz', async () => {
    const dir = work('iptal');
    const pidFile = path.join(dir, 'pid.json');
    const controller = new AbortController();
    const cc = provider();
    const pending = cc.runTask({ kind: 'research', system: 's', prompt: `[[sahte:asili|${pidFile}]]`, workDir: dir, allowedTools: [], maxSeconds: 60, signal: controller.signal });
    expect(await until(() => fs.existsSync(pidFile))).toBe(true);
    expect(cc.activeCount()).toBe(1);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, stop: 'aborted' });
    const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as { pid: number; child: number };
    expect(await until(() => !alive(pids.pid) && !alive(pids.child))).toBe(true);
    expect(cc.activeCount()).toBe(0);
    const already = await cc.runTask({ kind: 'research', system: 's', prompt: 'x', workDir: dir, allowedTools: [], maxSeconds: 60, signal: controller.signal });
    expect(already.stop).toBe('aborted');
  }, 30_000);

  it('abortAll koşan bütün işleri keser (uygulama kapanışı, acil durdurma)', async () => {
    const dir = work('toplu');
    const cc = provider();
    const pending = cc.runTask({ kind: 'research', system: 's', prompt: `[[sahte:asili|${path.join(dir, 'pid.json')}]]`, workDir: dir, allowedTools: [], maxSeconds: 60 });
    expect(await until(() => fs.existsSync(path.join(dir, 'pid.json')))).toBe(true);
    cc.abortAll();
    expect((await pending).stop).toBe('aborted');
  }, 30_000);

  it('sistem istemi boşsa ya da çalışma klasörü yoksa iş başlamaz (boş istemle çalıştırma v1’in kök nedeniydi)', async () => {
    expect(await provider().ask({ system: '   ', prompt: 'p' })).toMatchObject({ ok: false, stop: 'error' });
    const result = await provider().runTask({ kind: 'x', system: 's', prompt: 'p', workDir: path.join(work('w'), 'yok'), allowedTools: [], maxSeconds: 5 });
    expect(result).toMatchObject({ ok: false, stop: 'error' });
  });
});
