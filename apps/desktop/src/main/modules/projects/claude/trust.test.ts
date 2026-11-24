import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkProtectedFolder,
  claudeCodeTrusts,
  clearClaudeTrustCache,
  clearLimitCache,
  createTrustStore,
  defaultFolderLimits,
  FINGERPRINT_UNBOUNDED,
  fingerprintCacheSize,
  folderTrustState,
  guardEditTarget,
  inspectFolderSettings,
  isInsideFolder,
  isNetworkPath,
  loadsFolderSettings,
  realPath,
  realPathInfo,
  settingsSummary,
  suspiciousSpelling,
  trustKey,
  type FolderLimits,
} from './trust';

const WIN = process.platform === 'win32';
// Türkçe harfli kök: yol karşılaştırmaları ve parmak izi bu adlarla da çalışmalı.
const tmp = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-trust-'))), 'Şirket İşleri ğü');
fs.mkdirSync(tmp, { recursive: true });
afterAll(async () => {
  await fs.promises.rm(path.dirname(tmp), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let counter = 0;
const write = (file: string, content: string | Buffer): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
/** Geçici proje klasörü; `files`: göreli yol → içerik. */
function project(files: Record<string, string> = {}, label = 'proje'): string {
  const dir = path.join(tmp, `${label}-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) write(path.join(dir, relative), content);
  return dir;
}
/** Bağlantı (Windows'ta junction; yönetici gerekmez). */
const link = (target: string, at: string): string => {
  fs.symlinkSync(target, at, WIN ? 'junction' : 'dir');
  return at;
};
const linkPath = (label: string): string => path.join(tmp, `${label}-${++counter}`);

const NO_LIMITS: FolderLimits = { home: path.join(tmp, 'ev-yok'), parents: [], sensitive: [], system: [] };
const WITH_SETTINGS = {
  '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo merhaba' }] }] }, permissions: { allow: ['Read'] } }),
};
const guard = (cwd: string, target: string, limits: FolderLimits = NO_LIMITS, extra: Partial<Parameters<typeof guardEditTarget>[0]> = {}) =>
  guardEditTarget({ cwd, limits, tool: 'Write', input: { file_path: target }, ...extra });

beforeEach(() => {
  clearLimitCache();
  clearClaudeTrustCache();
});

describe('klasörün kendi Claude Code ayarları', () => {
  it('proje/yerel ayar, git kökündeki yerel ayar, üst klasördeki .mcp.json ve komutları bulur; kullanıcının ~/.claude’u sayılmaz', () => {
    const parent = project({
      '.mcp.json': JSON.stringify({ mcpServers: { github: {}, 'veri\u202etabani': {} } }),
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Read'] } }),
    });
    const child = path.join(parent, 'paket');
    write(path.join(child, '.claude', 'commands', 'dagit.md'), '# dağıt');
    write(
      path.join(child, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { SessionStart: [], PreToolUse: [] }, permissions: { allow: ['Bash(*)', 'Edit'] }, env: { A: '1' } }),
    );
    const found = inspectFolderSettings(child);
    expect(found.files.map((file) => file.path)).toEqual(['.claude/settings.json', '../.claude/settings.local.json', '.claude/ (komut, beceri, ajan, kanca)', '../.mcp.json']);
    expect(found.required).toBe(true);
    expect(found.mcp).toBe(true);
    expect(found.hooks).toBe(true);
    expect(found.files[0]!.summary).toBe('kancalar: SessionStart, PreToolUse · 2 izin kuralı · 1 ortam değişkeni');
    expect(found.files[2]!.summary).toBe('1 komut');
    // Yön karakteri (U+202E) görünen metinden ayıklanır.
    expect(found.files[3]!.summary).toBe('MCP sunucuları: github, veritabani');

    const empty = inspectFolderSettings(project());
    expect(empty).toMatchObject({ required: false, files: [], hooks: false, mcp: false, fingerprint: '' });

    // cwd ev klasörüyse oradaki .claude/settings.json KULLANICI ayarıdır.
    const home = project({ '.claude/settings.json': '{}' });
    expect(inspectFolderSettings(home, path.join(home, '.claude')).files).toHaveLength(0);
    expect(inspectFolderSettings(home).files).toHaveLength(1);
    expect(inspectFolderSettings(home).hooks).toBe(false);

    expect(settingsSummary({ apiKeyHelper: 'x', enableAllProjectMcpServers: true })).toBe('MCP sunucularını açar · anahtar yardımcısı');
    expect(settingsSummary({})).toBe('ayar dosyası');
    expect(inspectFolderSettings(project({ '.claude/settings.json': '{ bozuk' })).files[0]!.summary).toBe('okunamadı (bozuk JSON)');
    expect(inspectFolderSettings(project({ '.claude/hooks/kontrol.sh': 'echo' })).hooks).toBe(true);
  });

  it('parmak izi ad + içerikten: kararlıdır; kanca, yeni .mcp.json ya da yeni beceri gelince değişir', async () => {
    const dir = project(WITH_SETTINGS);
    const first = inspectFolderSettings(dir);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(inspectFolderSettings(dir).fingerprint).toBe(first.fingerprint);
    const record = { decision: 'trust' as const, fingerprint: first.fingerprint };
    expect(folderTrustState(dir, record)).toMatchObject({ required: true, decision: 'trust', decidedBy: 'user', hooks: true, mcp: false });
    expect(folderTrustState(dir, record).changed).toBeUndefined();

    // `git pull` yeni kanca getirdi: karar yok sayılır.
    write(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'curl kötü' }] }] } }));
    expect(folderTrustState(dir, record)).toMatchObject({ decision: null, decidedBy: null, changed: true });
    // Geri alınca karar yine geçerli.
    write(path.join(dir, '.claude', 'settings.json'), WITH_SETTINGS['.claude/settings.json']);
    expect(folderTrustState(dir, record).decision).toBe('trust');

    write(path.join(dir, '.mcp.json'), '{"mcpServers":{"y":{}}}');
    expect(folderTrustState(dir, record)).toMatchObject({ decision: null, changed: true, mcp: true });
    await fs.promises.rm(path.join(dir, '.mcp.json'));
    write(path.join(dir, '.claude', 'skills', 'b', 'SKILL.md'), '---\nallowed-tools: Bash(*)\n---\n');
    expect(folderTrustState(dir, record).changed).toBe(true);
    // İzsiz kayıt "güven" için geçerli sayılmaz.
    expect(folderTrustState(dir, { decision: 'trust' })).toMatchObject({ decision: null, changed: true });
    // Ayarsız klasörde karar iz aranmadan geçerlidir (yüklenecek bir şey yok).
    expect(folderTrustState(project(), { decision: 'trust' })).toMatchObject({ required: false, decision: 'trust', decidedBy: 'user' });
  });

  it('"güvenme" kararı ayarlar değişse de geçerli kalır; yüklenip yüklenmeyeceği karardan çıkar', () => {
    const dir = project(WITH_SETTINGS);
    const record = { decision: 'distrust' as const, fingerprint: inspectFolderSettings(dir).fingerprint };
    write(path.join(dir, '.mcp.json'), '{}');
    const state = folderTrustState(dir, record, { claudeCodeTrusted: true });
    expect(state).toMatchObject({ decision: 'distrust', decidedBy: 'user' });
    expect(loadsFolderSettings(state)).toBe(false);
    expect(loadsFolderSettings({ required: true, decision: 'trust' })).toBe(true);
    expect(loadsFolderSettings({ required: true, decision: null })).toBe(false);
    expect(loadsFolderSettings({ required: false, decision: null })).toBe(true);
  });

  it('kanca komutlarının çalıştırdığı dosyalar ize girer (.claude içinde ve dışında); proje dışı girmez; önbellek aynı dosyayı yeniden okumaz', () => {
    const settings = JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR"/.claude/betikler/kontrol.sh && node tools/kanca.js --ayar=../disari.json' }] }] },
    });
    const dir = project({ '.claude/settings.json': settings, '.claude/betikler/kontrol.sh': 'echo 1', 'tools/kanca.js': '// 1' });
    write(path.join(dir, '..', 'disari.json'), '{}');
    const first = inspectFolderSettings(dir).fingerprint;
    const cached = fingerprintCacheSize();
    expect(inspectFolderSettings(dir).fingerprint).toBe(first);
    expect(fingerprintCacheSize()).toBe(cached);

    write(path.join(dir, '.claude', 'betikler', 'kontrol.sh'), 'echo 2; curl kötü');
    const second = inspectFolderSettings(dir).fingerprint;
    expect(second).not.toBe(first);
    write(path.join(dir, 'tools', 'kanca.js'), '// 2 değişti');
    const third = inspectFolderSettings(dir).fingerprint;
    expect(third).not.toBe(second);
    // Proje dışındaki dosya klasörün dosyası değildir.
    write(path.join(dir, '..', 'disari.json'), '{"degisti":true}');
    expect(inspectFolderSettings(dir).fingerprint).toBe(third);
  });

  it('bütçe aşılırsa (toplam 400 girdi, tek dosya 512 KB) iz sınırsızdır: güven kabul edilmez, güvenme geçerlidir', () => {
    const many = project(WITH_SETTINGS);
    for (let i = 0; i < 405; i++) write(path.join(many, '.claude', 'commands', `k${i}.md`), 'x');
    const found = inspectFolderSettings(many);
    expect(found.unbounded).toBe(true);
    expect(found.fingerprint).toBe(FINGERPRINT_UNBOUNDED);
    expect(folderTrustState(many, { decision: 'trust', fingerprint: FINGERPRINT_UNBOUNDED })).toMatchObject({ required: true, decision: null, changed: true, unbounded: true });
    expect(folderTrustState(many, { decision: 'distrust' }).decision).toBe('distrust');
    // İz çıkarılamıyorsa Claude Code'un kendi kaydı da kabul edilmez.
    expect(folderTrustState(many, undefined, { claudeCodeTrusted: true }).decision).toBeNull();

    const big = project({ '.claude/settings.json': '{}' });
    write(path.join(big, '.claude', 'skills', 'buyuk', 'veri.bin'), Buffer.alloc(513 * 1024));
    expect(inspectFolderSettings(big).unbounded).toBe(true);
  });

  it('.claude içinde bağlantı varsa iz sınırsızdır (hedefi sessizce değişebilir)', () => {
    const outside = project({ 'x.md': '# x' }, 'disari');
    const dir = project(WITH_SETTINGS);
    fs.mkdirSync(path.join(dir, '.claude', 'commands'), { recursive: true });
    link(outside, path.join(dir, '.claude', 'commands', 'bag'));
    const found = inspectFolderSettings(dir);
    expect(found.unbounded).toBe(true);
    expect(found.required).toBe(true);
  });
});

describe('güven deposu', () => {
  it('klasör başına karar; io ile kalıcı; sondaki ayıraç ve (Windows’ta) harf büyüklüğü aynı klasör; silinir; bozuk depo = karar yok', () => {
    let saved: unknown;
    const io = { read: () => saved, write: (value: unknown) => void (saved = JSON.parse(JSON.stringify(value))) };
    const store = createTrustStore(io);
    const dir = project();
    expect(store.get(dir)).toBeUndefined();
    store.set(dir, 'distrust');
    store.set(dir + path.sep, 'trust', 'a'.repeat(64));
    expect(createTrustStore(io).get(dir)).toEqual({ decision: 'trust', fingerprint: 'a'.repeat(64) });
    if (WIN) expect(store.get(dir.toLocaleUpperCase('en-US'))?.decision).toBe('trust');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ path: path.resolve(dir), decision: 'trust' });
    store.set(dir, null);
    expect(createTrustStore(io).get(dir)).toBeUndefined();

    expect(createTrustStore({ read: () => '{ bozuk', write: () => {} }).get(dir)).toBeUndefined();
    expect(createTrustStore({ read: () => ({ folders: { x: { decision: 'belki', path: 'C:\\x' } } }), write: () => {} }).list()).toHaveLength(0);
    expect(
      createTrustStore({
        read: () => {
          throw new Error('okunamadı');
        },
        write: () => {},
      }).get(dir),
    ).toBeUndefined();
    expect(trustKey(dir + path.sep)).toBe(trustKey(dir));
  });
});

describe('Claude Code’un kendi güven kaydı', () => {
  const fakeHome = (projects: Record<string, unknown>): string => {
    const home = project({}, 'ev');
    write(path.join(home, '.claude.json'), JSON.stringify({ numStartups: 3, projects }));
    return home;
  };

  it('~/.claude.json içindeki hasTrustDialogAccepted okunur: ileri eğik çizgili anahtar, harf büyüklüğü, üst klasör', () => {
    const trusted = project(WITH_SETTINGS);
    const other = project(WITH_SETTINGS);
    const home = fakeHome({
      [trusted.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true, allowedTools: [] },
      [other.replace(/\\/g, '/')]: { hasTrustDialogAccepted: false },
    });
    expect(claudeCodeTrusts(trusted, home)).toBe(true);
    expect(claudeCodeTrusts(trusted + path.sep, home)).toBe(true);
    expect(claudeCodeTrusts(path.join(trusted, 'alt', 'paket'), home)).toBe(true);
    if (WIN) expect(claudeCodeTrusts(trusted.toLocaleUpperCase('en-US'), home)).toBe(true);
    expect(claudeCodeTrusts(other, home)).toBe(false);
    expect(claudeCodeTrusts(project(), home)).toBe(false);
    expect(claudeCodeTrusts('', home)).toBe(false);
    expect(claudeCodeTrusts('goreli/yol', home)).toBe(false);
  });

  it('dosya yoksa ya da bozuksa kimseye güvenilmemiş sayılır; sonuç kısa süre önbellekte kalır', () => {
    const dir = project();
    expect(claudeCodeTrusts(dir, project({}, 'ev-bos'))).toBe(false);
    const broken = project({ '.claude.json': '{ bozuk' }, 'ev-bozuk');
    expect(claudeCodeTrusts(dir, broken)).toBe(false);

    const home = fakeHome({});
    expect(claudeCodeTrusts(dir, home)).toBe(false);
    write(path.join(home, '.claude.json'), JSON.stringify({ projects: { [dir.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } } }));
    expect(claudeCodeTrusts(dir, home)).toBe(false);
    clearClaudeTrustCache();
    expect(claudeCodeTrusts(dir, home)).toBe(true);
  });

  it('kullanıcı karar vermemişse Claude Code’un kaydı geçerlidir; kullanıcının kararı her zaman önce gelir', () => {
    const dir = project(WITH_SETTINGS);
    const fingerprint = inspectFolderSettings(dir).fingerprint;
    expect(folderTrustState(dir, undefined)).toMatchObject({ required: true, decision: null, decidedBy: null });
    const byClaude = folderTrustState(dir, undefined, { claudeCodeTrusted: true });
    expect(byClaude).toMatchObject({ decision: 'trust', decidedBy: 'claude-code' });
    expect(loadsFolderSettings(byClaude)).toBe(true);
    expect(folderTrustState(dir, { decision: 'trust', fingerprint }, { claudeCodeTrusted: true }).decidedBy).toBe('user');
    expect(folderTrustState(dir, { decision: 'distrust', fingerprint }, { claudeCodeTrusted: true })).toMatchObject({ decision: 'distrust', decidedBy: 'user' });
    // Kullanıcının "güven" kararı bayatladıysa (ayarlar değişti) Claude Code'un kaydı devreye girer.
    expect(folderTrustState(dir, { decision: 'trust', fingerprint: 'b'.repeat(64) }, { claudeCodeTrusted: true })).toMatchObject({
      decision: 'trust',
      decidedBy: 'claude-code',
      changed: true,
    });
  });
});

describe('yol yazımları ve korunan klasörler', () => {
  it('gerçek yol: bağlantı çözülür, var olmayan kuyruk korunur; ağ ve aygıt yolları tanınır', () => {
    const target = project({}, 'hedef');
    const via = link(target, linkPath('bag'));
    expect(realPath(via)).toBe(target);
    expect(realPath(path.join(via, 'yok', 'dosya.txt'))).toBe(path.join(target, 'yok', 'dosya.txt'));
    for (const value of ['\\\\?\\C:\\Users', '\\\\.\\C:\\x', '\\\\sunucu\\pay\\a', '//sunucu/pay', '\\??\\C:\\Users', '/??/C:/x']) expect(isNetworkPath(value), value).toBe(true);
    expect(isNetworkPath('C:\\Users')).toBe(false);
    expect(isInsideFolder(target, path.join(target, 'a', 'b'))).toBe(true);
    expect(isInsideFolder(target, target + path.sep)).toBe(true);
    expect(isInsideFolder(target, `${target}-kardes`)).toBe(false);
  });

  it('bağlantı üzerinden ev klasörü ve korunan klasör reddedilir; bağlantı üzerinden sıradan proje gerçek yoluyla açılır', () => {
    const home = project({}, 'ev');
    const sensitive = project({}, 'veri');
    const limits: FolderLimits = { home, parents: [], sensitive: [sensitive], system: [] };
    expect(checkProtectedFolder(link(home, linkPath('evbag')), limits).reason).toMatch(/ev klasörü/);
    expect(checkProtectedFolder(path.join(link(sensitive, linkPath('veribag')), 'alt'), limits).reason).toMatch(/korunan/);
    // Korunan klasörü İÇEREN klasör de açılmaz.
    expect(checkProtectedFolder(path.dirname(sensitive), limits).reason).toBeTruthy();
    const plain = project();
    const result = checkProtectedFolder(link(plain, linkPath('projebag')), limits);
    expect(result).toEqual({ reason: null, path: plain });
    for (const value of ['\\\\?\\C:\\Users\\x', '\\\\.\\C:\\x', '\\\\localhost\\C$\\Users']) expect(checkProtectedFolder(value, limits).reason, value).toMatch(/ağ ya da aygıt yolu/);
  });

  it.skipIf(!WIN)('sürücü kökü, sürücüye göreli yazım, şüpheli adlar ve sistem klasörleri reddedilir', () => {
    const dir = project();
    for (const value of ['C:Users', '\\Users\\x', 'C:\\Users\\x.', 'C:\\Users\\x ', `${dir}::$INDEX_ALLOCATION`, '\\??\\C:\\Users', '']) {
      expect(checkProtectedFolder(value, NO_LIMITS).reason, value).toBeTruthy();
    }
    expect(checkProtectedFolder(dir, NO_LIMITS).reason).toBeNull();
    expect(checkProtectedFolder(path.parse(dir).root, NO_LIMITS).reason).toMatch(/sürücü kökü/);
    expect(suspiciousSpelling('C:dosya.txt')).toBe('sürücüye göreli yol');

    const limits = defaultFolderLimits({ dataDir: path.join(tmp, 'fuber-veri'), claudeDir: path.join(os.homedir(), '.claude') });
    expect(checkProtectedFolder(os.homedir(), limits).reason).toMatch(/ev klasörü/);
    expect(checkProtectedFolder(path.dirname(os.homedir()), limits).reason).toMatch(/ev klasörü/);
    expect(checkProtectedFolder(path.join(os.homedir(), '.claude', 'projects'), limits).reason).toMatch(/korunan/);
    if (process.env.SystemRoot) expect(checkProtectedFolder(path.join(process.env.SystemRoot, 'System32'), limits).reason).toMatch(/sistem klasörü/);
    if (process.env.APPDATA) expect(checkProtectedFolder(process.env.APPDATA, limits).reason).toMatch(/AppData/);
    // AppData'nın İÇİNDEKİ sıradan bir klasör (ör. Temp altı) açılabilir.
    expect(checkProtectedFolder(dir, limits).reason).toBeNull();
  });

  it('gerçek hâli ağ yolu olan sürücü reddedilir (F: → \\\\sunucu\\pay)', () => {
    const toNetwork = (value: string) => ({ path: `\\\\sunucu\\pay${value.slice(2)}` });
    expect(checkProtectedFolder(WIN ? 'F:\\proje' : '/mnt/proje', NO_LIMITS, toNetwork).reason).toMatch(/ağ ya da aygıt yolu/);
    const dir = project();
    expect(guard(dir, 'x.txt', NO_LIMITS, { resolve: () => ({ path: '\\\\sunucu\\pay\\x.txt' }) })).toMatch(/ağ yolu/);
  });

  it('hedefi olmayan bağlantı çözülemeyen sayılır: düzenleme sorulur, altındaki klasör açılmaz', () => {
    const dir = project();
    const outside = project({}, 'disari');
    link(path.join(outside, 'henuz-yok'), path.join(dir, 'dj'));
    expect(realPathInfo(path.join(dir, 'dj', 'x.txt')).unresolved).toBeTruthy();
    expect(guard(dir, 'dj/x.txt')).toMatch(/çözülemeyen/);
    expect(guard(dir, path.join(dir, 'dj'))).toMatch(/çözülemeyen/);
    expect(checkProtectedFolder(path.join(dir, 'dj', 'alt'), NO_LIMITS).reason).toMatch(/çözülemeyen/);
    // Sıradan var olmayan yol çözülemeyen sayılmaz.
    expect(realPathInfo(path.join(dir, 'yok', 'y.txt')).unresolved).toBeUndefined();
    expect(guard(dir, 'yeni/klasor/y.txt')).toBeNull();
  });
});

describe('düzenleme hedefi denetimi (asistanın başlattığı oturum)', () => {
  it('bağlantı dışarı çıkıyorsa, korunan klasöre gidiyorsa ya da yazım şüpheliyse sorulur; olağan yazım sorulmaz', () => {
    const cwd = project({}, 'cwd');
    const outside = project({}, 'disari');
    const sensitive = project({}, 'hassas');
    link(outside, path.join(cwd, 'dis'));
    link(sensitive, path.join(cwd, 'gizli'));
    const inner = path.join(cwd, 'veri');
    fs.mkdirSync(inner);
    const limits: FolderLimits = { home: path.join(tmp, 'ev-yok'), parents: [], sensitive: [sensitive, inner], system: [] };
    const ask = (target: string) => guard(cwd, target, limits);

    expect(ask('dis/x.txt')).toMatch(/dışına/);
    expect(ask(path.join(cwd, 'dis', 'yeni', 'y.txt'))).toMatch(/dışına/);
    expect(ask('gizli/ayarlar.json')).toMatch(/dışına|Korunan/);
    expect(ask('veri/ayarlar.json')).toMatch(/Korunan/);
    expect(ask(path.join(outside, 'z.txt'))).toMatch(/dışına/);
    expect(ask('../kardes.txt')).toMatch(/dışına/);
    for (const target of ['notlar.txt:gizli', `${cwd}\\a.txt:akis:$DATA`, '.claude./settings.json', 'notlar.txt ', 'src /a.ts', 'KLASOR~1/a.txt', 'a~2.txt', '\\\\?\\C:\\x\\y.txt', '\\\\.\\C:\\x', '\\\\sunucu\\pay\\z.txt']) {
      expect(ask(target), target).toMatch(/şüpheli/);
    }
    for (const target of ['.git/config', '.GIT/HOOKS/pre-push', '.Claude/commands/x.md', '.mcp.json', '.MCP.JSON']) expect(ask(target), target).toMatch(/ayarlarına/);
    for (const target of ['src/a.ts', 'README.md', '.gitignore', '.github/workflows/ci.yml', 'a.b.c.txt', 'yol/../b.txt', 'Şirket İşleri/ğüşiöç.md']) expect(ask(target), target).toBeNull();
  });

  it('.git klasörünün tamamı ve iç içe .git/.claude/.mcp.json sorulur; benzer adlar sorulmaz', () => {
    const cwd = project({}, 'cwd');
    for (const target of [
      '.git/modules/m/hooks/pre-commit',
      '.git/modules/a/b/config',
      '.git/config.worktree',
      '.git/worktrees/w/config.worktree',
      '.git',
      '.git/info/exclude',
      'alt/.git/hooks/pre-push',
      'vendor/lib/.claude/settings.json',
      'paket/.mcp.json',
    ]) {
      expect(guard(cwd, target), target).toMatch(/git klasörüne/);
    }
    for (const target of ['.gitignore', '.gitattributes', '.github/workflows/ci.yml', 'src/git/config', 'a.git/x', 'docs/claude/notlar.md']) expect(guard(cwd, target), target).toBeNull();
  });

  it('yalnız düzenleme araçlarına bakar; hedefi olmayan çağrı sorulur; NotebookEdit hedefi notebook_path’tir', () => {
    const cwd = project({}, 'cwd');
    expect(guardEditTarget({ cwd, limits: NO_LIMITS, tool: 'Bash', input: { command: 'del C:\\x' } })).toBeNull();
    expect(guardEditTarget({ cwd, limits: NO_LIMITS, tool: 'Read', input: { file_path: '..\\x' } })).toBeNull();
    expect(guardEditTarget({ cwd, limits: NO_LIMITS, tool: 'Edit', input: {} })).toMatch(/belirsiz/);
    expect(guardEditTarget({ cwd, limits: NO_LIMITS, tool: 'MultiEdit', input: null })).toMatch(/belirsiz/);
    expect(guardEditTarget({ cwd, limits: NO_LIMITS, tool: 'NotebookEdit', input: { notebook_path: 'not.ipynb' } })).toBeNull();
    expect(guardEditTarget({ cwd, limits: NO_LIMITS, tool: 'NotebookEdit', input: { notebook_path: '../not.ipynb' } })).toMatch(/dışına/);
  });

  it('kayda sabitlenen yolla karşılaştırır: klasör sonradan bağlantıyla değiştirilirse yazımlar sorulur', () => {
    const home = project({}, 'ev');
    const limits: FolderLimits = { home, parents: [], sensitive: [], system: [] };
    const victim = project({}, 'kurban');
    const checked = checkProtectedFolder(victim, limits);
    expect(checked).toEqual({ reason: null, path: victim });
    fs.rmdirSync(victim);
    link(home, victim);
    try {
      expect(guard(checked.path, path.join(home, '.gitconfig'), limits)).toMatch(/dışına/);
      expect(guard(checked.path, 'x.txt', limits)).toMatch(/dışına/);
    } finally {
      fs.unlinkSync(victim);
    }
  });

  it.skipIf(!WIN)('başka sürücüdeki hedef çözülmeden sorulur', () => {
    const cwd = project({}, 'cwd');
    const other = cwd[0]!.toLowerCase() === 'z' ? 'Y' : 'Z';
    let resolved = 0;
    const reason = guard(cwd, `${other}:\\baska\\x.txt`, NO_LIMITS, {
      resolve: (value) => {
        resolved++;
        return { path: value };
      },
    });
    expect(reason).toMatch(/dışına/);
    expect(resolved).toBe(0);
  });
});
