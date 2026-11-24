// Claude Code CLI ortak katmanı: bayraklar, ortam, yer bulma, yoklama, süreç ağacı, eşzamanlılık (sahte CLI; ağ ve kota yok).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCliArgs,
  isolatedCliEnv,
  compareCliVersions,
  createLimiter,
  expandEnv,
  findClaudeCli,
  isAlive,
  parseAuthStatus,
  parseRegistryPath,
  probeClaudeCli,
  spawnCli,
  trackedCliPids,
  type SearchEnv,
} from './index';
import { fakeCli, tempDir } from './testkit';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function work(label: string): string {
  const temp = tempDir(label);
  cleanups.push(temp.cleanup);
  return temp.dir;
}

describe('Claude Code CLI: bulma, yoklama, bayraklar', () => {
  it('bayraklar yalıtımı kurar: kendi sistem istemi, dar araç listesi, sormadan ret, kalıcı oturum yok', () => {
    const args = buildCliArgs({ systemPromptFile: 'C:\\gecici\\system.txt', model: 'sonnet', tools: ['Read', 'Write'], maxTurns: 60 });
    for (const flag of ['-p', '--verbose', '--restricted', '--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) {
      expect(args).toContain(flag);
    }
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value('--system-prompt-file')).toBe('C:\\gecici\\system.txt');
    expect(value('--input-format')).toBe('stream-json');
    expect(value('--output-format')).toBe('stream-json');
    expect(value('--tools')).toBe('Read,Write');
    expect(value('--allowedTools')).toBe('Read,Write');
    expect(value('--permission-mode')).toBe('dontAsk');
    expect(value('--permission-prompts')).toBe('none');
    expect(value('--max-turns')).toBe('60');
    expect(args).not.toContain('--dangerously-skip-permissions');
    // Araçsız çağrı: araç listesi boş dizgidir ve hiçbir araca ön izin verilmez.
    const bare = buildCliArgs({ systemPromptFile: 'x', model: 'haiku', tools: [], maxTurns: 1 });
    expect(bare[bare.indexOf('--tools') + 1]).toBe('');
    expect(bare).not.toContain('--allowedTools');
  });

  it('çocuk süreç ortamı izin listesinden kurulur: anahtarlar ve CLAUDE_/FUBER2_ değişkenleri geçmez', () => {
    const env = isolatedCliEnv({}, { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\x', ANTHROPIC_API_KEY: 'gizli', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDECODE: '1', FUBER2_TEST: '1', ELEVENLABS_API_KEY: 'gizli' });
    expect(env).toEqual({ PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\x' });
  });

  // Yer bulma: v1'in (0.18.2 `tests/cc-claude-ara.test.ts`) senaryoları.
  const home = 'C:\\Users\\Deniz';
  const J = (...parts: string[]) => path.win32.join(...parts);
  function search(files: string[], overrides: Partial<SearchEnv> = {}): SearchEnv {
    const set = new Set(files.map((file) => file.toLowerCase()));
    return {
      platform: 'win32',
      env: { APPDATA: `${home}\\AppData\\Roaming`, LOCALAPPDATA: `${home}\\AppData\\Local`, USERPROFILE: home },
      home,
      exists: (file) => set.has(file.toLowerCase()),
      where: () => [],
      registryPath: () => [],
      ...overrides,
    };
  }

  it.runIf(process.platform === 'win32')('yer bulma: PATH, npm kabuğunun gerçek ikilisi, bilinen yerler, kayıt defterindeki güncel PATH', () => {
    const local = J(home, '.local', 'bin', 'claude.exe');
    expect(findClaudeCli(search([local], { where: () => [local] }))).toBe(local);
    // npm -g: `where` yalnız .cmd ve uzantısız kabuğu verir; .cmd kabuksuz başlatılamaz (EINVAL), gerçek ikili bulunur.
    const npm = J(home, 'AppData', 'Roaming', 'npm');
    const real = J(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    const viaShim = findClaudeCli(search([J(npm, 'claude.cmd'), J(npm, 'claude'), real], { where: () => [J(npm, 'claude'), J(npm, 'claude.cmd')] }));
    expect(viaShim).toBe(real);
    // Bayat PATH (Explorer'ın oturum açılışındaki kopyası): `where` boş → bilinen yer.
    expect(findClaudeCli(search([local]))).toBe(local);
    // Bayat PATH + özel klasör: kayıt defterindeki güncel PATH.
    const custom = J('D:\\Araclar', 'claude.exe');
    expect(findClaudeCli(search([custom], { registryPath: () => ['C:\\Windows', 'D:\\Araclar'] }))).toBe(custom);
    // `where` satırı var ama dosya silinmiş: sıradaki yola düşer.
    expect(findClaudeCli(search([local], { where: () => ['D:\\silinmis\\claude.exe'] }))).toBe(local);
  });

  it('yer bulma: hiçbir yerde yoksa ya da yardımcılar çökerse null (arama fırlatmaz)', () => {
    const broken = { where: () => { throw new Error('where yok'); }, registryPath: () => { throw new Error('reg yok'); } };
    expect(findClaudeCli(search([], broken))).toBeNull();
  });

  it('kayıt defteri PATH çıktısı: REG_EXPAND_SZ değişkenleri genişler, tırnaklar atılır', () => {
    const output = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\Araclar;"D:\\Bosluklu Yol"\r\n';
    expect(parseRegistryPath(output, { USERPROFILE: home })).toEqual([`${home}\\.local\\bin`, 'C:\\Araclar', 'D:\\Bosluklu Yol']);
    expect(parseRegistryPath('hata', {})).toEqual([]);
    expect(expandEnv('%yok%\\x', {})).toBe('%yok%\\x');
  });

  it('oturum durumu: çıktıdan yalnız loggedIn okunur; JSON önünde/ardında satır olsa da', () => {
    expect(parseAuthStatus('{"loggedIn":true,"email":"x@y.z"}')).toBe(true);
    expect(parseAuthStatus('uyarı satırı\n{"loggedIn": false}\n')).toBe(false);
    expect(parseAuthStatus('Not logged in')).toBeNull();
    expect(parseAuthStatus('{"loggedIn":"evet"}')).toBeNull();
  });

  it('süreç ağacı: başlatılan süreç izlenir, sinyalle torunuyla birlikte ölür', async () => {
    const dir = work('agac');
    const pidFile = path.join(dir, 'pid.json');
    const controller = new AbortController();
    const child = spawnCli(fakeCli(), ['-p'], { cwd: dir, signal: controller.signal });
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: `[[sahte:asili|${pidFile}]]` }] } })}\n`);
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as { pid: number; child: number };
    expect(trackedCliPids()).toContain(child.pid);
    expect(isAlive(pids.child)).toBe(true);
    controller.abort();
    while ((isAlive(pids.pid) || isAlive(pids.child)) && Date.now() < deadline + 8000) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(isAlive(pids.pid)).toBe(false);
    expect(isAlive(pids.child)).toBe(false);
    expect(trackedCliPids()).not.toContain(child.pid);
  }, 30_000);

  it('yoklama sürümü ve oturumu okur; oturum kapalıysa, sürüm eskiyse ya da CLI yoksa bunu söyler', async () => {
    expect(await probeClaudeCli(fakeCli())).toMatchObject({ installed: true, version: '2.1.325', loggedIn: true, supported: true });
    expect(await probeClaudeCli(fakeCli({ FAKE_CLAUDE_AUTH: 'out' }))).toMatchObject({ installed: true, loggedIn: false });
    expect(await probeClaudeCli(fakeCli({ FAKE_CLAUDE_VERSION: '2.1.100' }))).toMatchObject({ installed: true, version: '2.1.100', supported: false });
    expect(await probeClaudeCli(null)).toMatchObject({ installed: false, version: null, loggedIn: null });
    expect(await probeClaudeCli({ command: path.join(work('yok'), 'claude.exe'), prefixArgs: [] })).toMatchObject({ installed: false });
    expect(compareCliVersions('2.1.325', '2.1.259')).toBe(1);
    expect(compareCliVersions('2.1.259', '2.1.259')).toBe(0);
    expect(compareCliVersions('2.0.900', '2.1.259')).toBe(-1);
  }, 20_000);

  it('eşzamanlılık sınırı: fazlası sırada bekler, iptal edilen sıradan çıkar', async () => {
    const limiter = createLimiter(2);
    const first = await limiter.acquire();
    const second = await limiter.acquire();
    let thirdGranted = false;
    const third = limiter.acquire().then((release) => {
      thirdGranted = true;
      return release;
    });
    const controller = new AbortController();
    const fourth = limiter.acquire(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(thirdGranted).toBe(false);
    expect(limiter.waiting()).toBe(2);
    controller.abort();
    expect(await fourth).toBeNull();
    first!();
    expect(await third).toBeTypeOf('function');
    expect(limiter.running()).toBe(2);
    second!();
    (await third)!();
    expect(limiter.running()).toBe(0);
  });
});
