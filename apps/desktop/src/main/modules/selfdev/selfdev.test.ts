import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, DEFAULT_POLICY, isUpdateRequired } from '@fuber/shared';
import { evaluateGate, parseConfig, validateRepo } from './gate';
import * as git from './git';
import { decideStartup, evaluateHealth, failureReason, MAX_SILENT_STARTS } from './health';
import { INSTALL_SCRIPT, jobJson, type InstallJob } from './installer';
import { pruneStorage, packagesDir, rollbackDir, storePackage, storedPackage, isSafeVersion } from './packager';
import { assertTransition, canTransition, IllegalTransition, isBlocking, isTerminal, stageIndex, TRANSITIONS } from './pipeline';
import { parsePlan } from './prompts';
import { riskFlags } from './risk';
import { cleanEnv, nodeCommand, npmCommand } from './runner';
import { chooseRollbackTarget } from './engine';
import { makeFakeRepo, removeDir, tempDir, PLAN_OK } from './testkit';
import { applyVersion, devNumberOf, nextDevVersion, readVersion } from './version';
import type { PendingUpdate, RunStatus, SelfdevState } from './types';

// Gerçek git komutları (Windows'ta ve yük altında saniyeler sürer).
vi.setConfig({ testTimeout: 90_000 });

let dir: string;
beforeEach(() => {
  dir = tempDir('unit');
});
afterEach(() => removeDir(dir));

describe('durum makinesi', () => {
  const all = Object.keys(TRANSITIONS) as RunStatus[];

  it('akış sırası: queued → … → ready → installing → restarting → installed; terminal durumdan çıkış yok', () => {
    const path = ['queued', 'planning', 'implementing', 'verifying', 'packaging', 'ready', 'installing', 'restarting', 'installed'] as const;
    for (let index = 0; index < path.length - 1; index++) expect(canTransition(path[index]!, path[index + 1]!), `${path[index]} → ${path[index + 1]}`).toBe(true);
    for (const terminal of ['failed', 'cancelled', 'rolled_back'] as const) expect(TRANSITIONS[terminal]).toEqual([]);
    expect(canTransition('installed', 'rolled_back')).toBe(true);
    expect(canTransition('restarting', 'rolled_back')).toBe(true);
  });

  it('sınama ⇄ düzeltme döngüsü var, atlamalar yok', () => {
    expect(canTransition('verifying', 'fixing')).toBe(true);
    expect(canTransition('fixing', 'verifying')).toBe(true);
    // Kurulum onayı atlanamaz: sınamadan ya da paketlemeden doğrudan kuruluma geçilemez.
    expect(canTransition('verifying', 'installing')).toBe(false);
    expect(canTransition('packaging', 'installing')).toBe(false);
    expect(canTransition('planning', 'ready')).toBe(false);
    expect(() => assertTransition('queued', 'installed')).toThrow(IllegalTransition);
  });

  it('terminal ve engelleyen durumlar; her çalışan durum iptal edilebilir', () => {
    expect(all.filter(isTerminal).sort()).toEqual(['cancelled', 'failed', 'installed', 'rolled_back']);
    for (const status of ['queued', 'planning', 'implementing', 'verifying', 'fixing', 'packaging', 'ready'] as const) {
      expect(isBlocking(status)).toBe(true);
      expect(canTransition(status, 'cancelled')).toBe(true);
    }
    expect(isBlocking('installed')).toBe(false);
    expect(isBlocking('failed')).toBe(false);
  });

  it('aşama çizgisi: plan → uygulama → sınama → paket → hazır; düzeltme sınama aşamasındadır', () => {
    expect(['planning', 'implementing', 'verifying', 'packaging', 'ready'].map((status) => stageIndex(status as RunStatus))).toEqual([0, 1, 2, 3, 4]);
    expect(stageIndex('fixing')).toBe(2);
    expect(stageIndex('failed')).toBeNull();
  });
});

describe('geliştirici kipi kapısı', () => {
  it('üç koşul birlikte gerekir; kapalıysa neden söylenir', () => {
    const repo = makeFakeRepo(dir);
    const base = { policyEnabled: true, moduleAllowed: true, settingEnabled: true, repoPath: repo };
    expect(evaluateGate(base)).toMatchObject({ open: true, reason: null, repoOk: true });
    expect(evaluateGate({ ...base, policyEnabled: false })).toMatchObject({ open: false, policy: false });
    expect(evaluateGate({ ...base, policyEnabled: false }).reason).toMatch(/Yönetim/);
    expect(evaluateGate({ ...base, moduleAllowed: false }).open).toBe(false);
    expect(evaluateGate({ ...base, settingEnabled: false }).reason).toMatch(/Geliştirici kipini aç/);
    expect(evaluateGate({ ...base, repoPath: null }).reason).toMatch(/kaynak/i);
    // Varsayılan politika ve ayar: KAPALI.
    expect(DEFAULT_POLICY.developer.enabled).toBe(false);
  });

  it('depo doğrulaması: mutlak yol, var, .git var, kök package.json adı fuber-ai-v2', async () => {
    const repo = makeFakeRepo(dir);
    expect(validateRepo(repo)).toMatchObject({ ok: true });
    expect(validateRepo('goreli/yol')).toMatchObject({ ok: false });
    expect(validateRepo(null)).toMatchObject({ ok: false });
    expect(validateRepo(path.join(dir, 'yok'))).toMatchObject({ ok: false });
    const plain = path.join(dir, 'duz');
    fs.mkdirSync(plain);
    expect(validateRepo(plain)).toMatchObject({ ok: false });
    // .git var ama yanlış depo.
    const wrong = path.join(dir, 'yanlis');
    fs.mkdirSync(path.join(wrong, '.git'), { recursive: true });
    fs.writeFileSync(path.join(wrong, 'package.json'), JSON.stringify({ name: 'baska-proje' }));
    const result = validateRepo(wrong);
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/baska-proje/);
    // Veri klasörünün içi yasak.
    expect(validateRepo(repo, [dir])).toMatchObject({ ok: false });
    await removeDir(wrong);
  });

  it('yapılandırma: geçersiz alan varsayılana düşer, kapı kapanmaz; e2e yolu ve betik adı doğrulanır', () => {
    expect(parseConfig(undefined)).toMatchObject({ verify: ['typecheck', 'test'], e2e: [], packager: 'dist:desktop', maxFixRounds: 2, install: true });
    expect(parseConfig({ maxFixRounds: 9, verify: ['lint'] })).toMatchObject({ maxFixRounds: 2, verify: ['lint'] });
    expect(parseConfig({ verify: ['rm -rf /'] }).verify).toEqual(['typecheck', 'test']);
    expect(parseConfig({ e2e: ['../disari.mjs'] }).e2e).toEqual([]);
    expect(parseConfig({ e2e: ['scripts/e2e/smoke.mjs'] }).e2e).toEqual(['scripts/e2e/smoke.mjs']);
  });
});

describe('sürüm artırma', () => {
  it('ön sürümlü: ".dev.N" eklenir, N artar; eksizde yama artırılır', () => {
    expect(nextDevVersion('2.0.0-demo.3')).toMatchObject({ version: '2.0.0-demo.3.dev.1', devNumber: 1 });
    expect(nextDevVersion('2.0.0-demo.3.dev.1')).toMatchObject({ version: '2.0.0-demo.3.dev.2', devNumber: 2 });
    expect(nextDevVersion('2.0.0-demo.3', 4).version).toBe('2.0.0-demo.3.dev.5');
    expect(nextDevVersion('2.0.0').version).toBe('2.0.1-dev.1');
    expect(nextDevVersion('2.0.1-dev.1').version).toBe('2.0.1-dev.2');
    expect(devNumberOf('2.0.0-demo.3.dev.7')).toBe(7);
    expect(devNumberOf('2.0.0-demo.3')).toBe(0);
    expect(() => nextDevVersion('abc')).toThrow();
  });

  it('semver sırası ve zorunlu güncelleme kapısı bozulmaz', () => {
    const base = '2.0.0-demo.3';
    const dev1 = nextDevVersion(base).version;
    const dev2 = nextDevVersion(dev1).version;
    expect(compareVersions(dev1, base)).toBe(1);
    expect(compareVersions(dev2, dev1)).toBe(1);
    // Sonraki gerçek yayın dev'den büyüktür (dev sürümü yayından geri bırakmaz).
    expect(compareVersions('2.0.0-demo.4', dev2)).toBe(1);
    expect(compareVersions('2.0.0', dev2)).toBe(1);
    expect(compareVersions(nextDevVersion('2.0.0').version, '2.0.0')).toBe(1);
    expect(compareVersions('2.0.1', nextDevVersion('2.0.0').version)).toBe(1);
    // minVersion = taban sürüm: dev sürümü zorunlu güncellemeye takılmaz.
    const policy = { ...DEFAULT_POLICY, release: { ...DEFAULT_POLICY.release, minVersion: base, force: true } };
    expect(isUpdateRequired(policy, dev1)).toBe(false);
    expect(isUpdateRequired(policy, dev2)).toBe(false);
    // Semver uyumu (electron-builder): sayısal tanımlayıcılarda sıfır başı yok.
    expect(dev2).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/);
  });

  it('bütün sürüm alanları birlikte değişir (package.json dosyaları, APP_VERSION, kilit dosyası); biçim korunur', () => {
    const repo = makeFakeRepo(dir);
    fs.writeFileSync(
      path.join(repo, 'package-lock.json'),
      JSON.stringify({ name: 'fuber-ai-v2', version: '2.0.0-demo.3', lockfileVersion: 3, packages: { '': { name: 'fuber-ai-v2', version: '2.0.0-demo.3' }, 'apps/desktop': { name: '@fuber/desktop', version: '2.0.0-demo.3' }, 'node_modules/x': { version: '1.0.0' } } }, null, 2) + '\r\n',
    );
    const changed = applyVersion(repo, '2.0.0-demo.3.dev.1');
    expect(changed.sort()).toEqual(['apps/desktop/package.json', 'package-lock.json', 'package.json', 'packages/shared/package.json', 'packages/shared/src/constants.ts']);
    expect(readVersion(repo)).toBe('2.0.0-demo.3.dev.1');
    expect(fs.readFileSync(path.join(repo, 'packages', 'shared', 'src', 'constants.ts'), 'utf8')).toBe("export const APP_VERSION = '2.0.0-demo.3.dev.1';\n");
    const lock = fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8');
    expect(lock).toContain('\r\n');
    const parsed = JSON.parse(lock) as { version: string; packages: Record<string, { version: string }> };
    expect(parsed.version).toBe('2.0.0-demo.3.dev.1');
    expect(parsed.packages['apps/desktop']!.version).toBe('2.0.0-demo.3.dev.1');
    expect(parsed.packages['node_modules/x']!.version).toBe('1.0.0');
    // İkinci uygulama değişiklik yapmaz.
    expect(applyVersion(repo, '2.0.0-demo.3.dev.1')).toEqual([]);
  });
});

describe('plan ayrıştırma', () => {
  it('başlıklı plan: uygunluk, özet, dosyalar, risk, sınama', () => {
    const plan = parsePlan(PLAN_OK)!;
    expect(plan.kind).toBe('core');
    expect(plan.summary).toMatch(/Ana pencereye yeni bir bölüm/);
    expect(plan.files).toEqual(['src/ozellik.txt']);
    expect(plan.risk).toMatch(/Düşük/);
    expect(plan.testPlan).toMatch(/typecheck/);
  });

  it('eklenti uygunluğu ve başlıksız metin', () => {
    const plugin = parsePlan('## UYGUNLUK\nEKLENTİ — basit bir kart.\n\n## ÖZET\nKart eklenti olur.')!;
    expect(plugin.kind).toBe('plugin');
    expect(plugin.pluginReason).toMatch(/basit bir kart/);
    const loose = parsePlan('Şunu yapacağım.\n\nİkinci paragraf.')!;
    expect(loose.kind).toBe('unknown');
    expect(loose.summary).toBe('Şunu yapacağım.');
    expect(parsePlan('   ')).toBeNull();
  });

  it('Windows yolları ve kod çiti içindeki satırlar dosya listesine karışmaz', () => {
    const plan = parsePlan('## DOSYALAR\n- `apps\\desktop\\src\\a.ts` — x\n- yalnız açıklama satırı\n* packages/shared/src/b.ts: y')!;
    expect(plan.files).toEqual(['apps/desktop/src/a.ts', 'packages/shared/src/b.ts']);
  });
});

describe('kurulum betiği ve görev dosyası', () => {
  const job: InstallJob = {
    mode: 'install',
    runId: 'R1',
    pid: 4242,
    installDir: 'C:\\Users\\Çağrı Şen\\AppData\\Local\\Programs\\@fuberdesktop',
    exe: 'C:\\Users\\Çağrı Şen\\AppData\\Local\\Programs\\@fuberdesktop\\Fuber AI 2.exe',
    version: '2.0.0-demo.3.dev.1',
    fromVersion: '2.0.0-demo.3',
    installer: 'C:\\Users\\Çağrı Şen\\AppData\\Roaming\\Fuber AI 2\\selfdev\\packages\\2.0.0-demo.3.dev.1\\Fuber AI 2 Kurulum 2.0.0-demo.3.dev.1.exe',
    restoreSnapshot: 'C:\\Users\\Çağrı Şen\\AppData\\Roaming\\Fuber AI 2\\selfdev\\rollback\\2.0.0-demo.3',
    restoreInstaller: null,
    healthFile: 'C:\\Users\\Çağrı Şen\\AppData\\Roaming\\Fuber AI 2\\selfdev\\health.json',
    resultFile: 'C:\\Users\\Çağrı Şen\\AppData\\Roaming\\Fuber AI 2\\selfdev\\run\\R1\\result.json',
    waitHealthSeconds: 120,
  };

  it('yollar betiğe GÖMÜLMEZ, UTF-8 JSON görev dosyasından okunur: boşluklu ve Türkçe harfli yollar bozulmaz', () => {
    const parsed = JSON.parse(jobJson(job)) as InstallJob;
    expect(parsed).toEqual(job);
    expect(parsed.installer).toContain('Çağrı Şen');
    // Sabit betik: hiçbir yol ya da kullanıcı adı içermez.
    expect(INSTALL_SCRIPT).not.toContain('Çağrı');
    expect(INSTALL_SCRIPT).not.toContain('C:\\Users');
    expect(INSTALL_SCRIPT).toContain('Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8');
  });

  it('betik adımları: kapanmayı bekle → sessiz kur (/S) → başlat → sağlık işaretini bekle → sor → geri yükle', () => {
    const at = (needle: string): number => INSTALL_SCRIPT.indexOf(needle);
    expect(at('Wait-AppExit')).toBeGreaterThan(-1);
    for (const [a, b] of [
      ['Wait-AppExit\n\nif', "Start-Process -FilePath $job.installer -ArgumentList '/S'"],
      ["Start-Process -FilePath $job.installer -ArgumentList '/S'", 'Start-App\nif (Wait-Health)'],
      ['if (Wait-Health)', 'Önceki sürüme döneyim mi?'],
    ] as const) expect(at(a), `${a} < ${b}`).toBeLessThan(at(b));
    expect(INSTALL_SCRIPT).toContain('robocopy $job.restoreSnapshot $job.installDir /MIR');
    expect(INSTALL_SCRIPT).toContain("$job.mode -eq 'rollback'");
    // Yollar her yerde -LiteralPath ile; kabuk genişletmesi yok.
    expect(INSTALL_SCRIPT).not.toMatch(/Invoke-Expression|iex\s/);
    // Sağlık işareti: yeni sürüm + koşu kimliği + ok.
    expect(INSTALL_SCRIPT).toContain('$health.version -eq $job.version -and $health.runId -eq $job.runId');
  });
});

describe('açılış sağlık mantığı', () => {
  const pending = (patch: Partial<PendingUpdate> = {}): PendingUpdate => ({ runId: 'R', kind: 'install', fromVersion: '2.0.0-demo.3', toVersion: '2.0.0-demo.3.dev.1', attempts: 0, at: 'x', ...patch });

  it('karar: bekleyen yok / beklenen sürüm çalışıyor / eski sürüm açıldı / art arda sağlıksız açılış', () => {
    expect(decideStartup(null, 'x')).toEqual({ action: 'none' });
    expect(decideStartup(pending(), '2.0.0-demo.3.dev.1').action).toBe('verify');
    expect(decideStartup(pending(), '2.0.0-demo.3').action).toBe('install-missed');
    expect(decideStartup(pending({ attempts: MAX_SILENT_STARTS }), '2.0.0-demo.3.dev.1')).toMatchObject({ action: 'recommend-rollback' });
    expect(decideStartup(pending({ attempts: 1 }), '2.0.0-demo.3.dev.1').action).toBe('verify');
  });

  it('yoklamalar: hepsi tamsa sağlıklı; biri kalırsa neden söylenir', () => {
    const good = { dbOpen: true, settingsReadable: true, brainStatusReadable: true, toolModules: 12, moduleLoadErrors: 0 };
    expect(evaluateHealth(good).ok).toBe(true);
    const bad = evaluateHealth({ ...good, dbOpen: false, toolModules: 1 });
    expect(bad.ok).toBe(false);
    expect(failureReason(bad.probes)).toMatch(/veritabanı.*modüller/);
    expect(evaluateHealth({ ...good, moduleLoadErrors: 2 }).ok).toBe(false);
  });
});

describe('geri alma hedefi', () => {
  it('kurulu sürümden bir önceki kayıt: anlık kopya varsa o, yoksa paket, ikisi de yoksa yok', async () => {
    const snapshot = path.join(rollbackDir(dir), '2.0.0-demo.3');
    fs.mkdirSync(snapshot, { recursive: true });
    const state: SelfdevState = {
      installed: [
        { version: '2.0.0-demo.3', at: 'a', runId: null, packagePath: null, snapshotPath: snapshot },
        { version: '2.0.0-demo.3.dev.1', at: 'b', runId: 'R1', packagePath: null, snapshotPath: null },
      ],
      pending: null,
      healthFailed: null,
      lastDevNumber: 1,
    };
    expect(chooseRollbackTarget(state, '2.0.0-demo.3.dev.1', dir)).toMatchObject({ version: '2.0.0-demo.3', via: 'snapshot', snapshot });
    // Anlık kopya yok, paket var.
    const pkg = path.join(dir, 'paket.exe');
    fs.writeFileSync(pkg, 'x');
    state.installed[0] = { ...state.installed[0]!, snapshotPath: null, packagePath: pkg };
    expect(chooseRollbackTarget(state, '2.0.0-demo.3.dev.1', dir)).toMatchObject({ via: 'package', installer: pkg, snapshot: null });
    // Hiçbiri yok.
    state.installed[0] = { ...state.installed[0]!, packagePath: null };
    expect(chooseRollbackTarget(state, '2.0.0-demo.3.dev.1', dir)).toBeNull();
    // Önceki kayıt yoksa (tek kayıt) dönülecek yer yok.
    expect(chooseRollbackTarget({ ...state, installed: [state.installed[1]!] }, '2.0.0-demo.3.dev.1', dir)).toBeNull();
  });

  it('paket saklama: sürüm başına klasör, en çok 3 paket; kurulu ve önceki asla silinmez', async () => {
    const file = path.join(dir, 'Fuber AI 2 Kurulum x.exe');
    fs.writeFileSync(file, 'x');
    for (const version of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      const stored = await storePackage(dir, version, file);
      expect(stored).toContain(path.join('selfdev', 'packages', version));
      const time = new Date(Date.now() + Number(version.slice(1)) * 1000);
      fs.utimesSync(path.join(packagesDir(dir), version), time, time);
    }
    expect(storedPackage(dir, 'v2')).toContain('.exe');
    const removed = await pruneStorage(dir, new Set(['v1']));
    expect(removed).toBe(2);
    const left = fs.readdirSync(packagesDir(dir)).sort();
    expect(left).toEqual(['v1', 'v4', 'v5']);
    expect(isSafeVersion('../x')).toBe(false);
    await expect(storePackage(dir, '..\\kacis', file)).rejects.toThrow(/güvensiz/);
  });
});

describe('risk işaretleri ve komutlar', () => {
  it('güvenlik kapısı, bağımlılık ve paketleme dosyaları işaretlenir', () => {
    expect(riskFlags(['apps/desktop/src/main/core/self-change-guard.ts', 'package-lock.json', 'apps/desktop/electron-builder.yml', 'apps/desktop/src/main/x.ts'])).toHaveLength(3);
    expect(riskFlags(['apps/desktop/src/main/modules/selfdev/engine.ts'])[0]).toMatch(/çekirdek geliştirme motoru/);
    expect(riskFlags(['apps/desktop/src/renderer/a.tsx'])).toEqual([]);
  });

  it('npm/node komutları kabuk meta karakterini reddeder; Windows ta ComSpec ile kabuksuz npm.cmd', () => {
    expect(() => npmCommand('x', ['run', 'a; rm -rf /'], dir, 1000)).toThrow(/güvensiz/);
    expect(() => nodeCommand('x', '../kacis.mjs', dir, 1000)).toThrow(/güvensiz/);
    expect(() => nodeCommand('x', '/mutlak.mjs', dir, 1000)).toThrow(/güvensiz/);
    const spec = npmCommand('typecheck', ['run', 'typecheck'], dir, 1000);
    if (process.platform === 'win32') expect(spec.args.slice(0, 4)).toEqual(['/d', '/s', '/c', 'npm']);
    else expect(spec.file).toBe('npm');
  });

  it('çocuk sürecin ortamı temizdir: anahtarlar ve FUBER2_* geçmez', () => {
    const env = cleanEnv({
      PATH: 'p',
      ANTHROPIC_API_KEY: 'sk-gizli',
      OPENAI_API_KEY: 'sk-baska',
      GITHUB_TOKEN: 'gh',
      FUBER2_DATA: 'x',
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'c',
      APPDATA: 'a',
    } as NodeJS.ProcessEnv);
    expect(env.PATH).toBe('p');
    expect(env.APPDATA).toBe('a');
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'FUBER2_DATA', 'ELECTRON_RUN_AS_NODE', 'CLAUDE_CODE_OAUTH_TOKEN']) expect(env[key], key).toBeUndefined();
  });
});

describe('git yardımcıları (geçici depoda)', () => {
  it('worktree + dal açar, işler, değişenleri bulur; ana çalışma kopyası ve dalları değişmez', async () => {
    const repo = makeFakeRepo(dir);
    const head = (await git.headCommit(repo))!;
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    const layout = git.worktreeLayout(repo, 'abc12345');
    expect(layout.dir).toBe(path.join(dir, 'FUBER AI 2 ÇEKİRDEK-wt', 'selfdev-abc12345'));
    expect(layout.branch).toBe('selfdev/abc12345');
    expect(await git.worktreeAdd(repo, layout.dir, layout.branch, head)).toEqual({ ok: true });
    // Aynı klasör ikinci kez açılmaz.
    expect((await git.worktreeAdd(repo, layout.dir, 'selfdev/baska', head)).ok).toBe(false);
    expect((await git.worktreeAdd(repo, path.join(dir, 'x'), '../kotu dal', head)).ok).toBe(false);

    fs.mkdirSync(path.join(layout.dir, 'src'));
    fs.writeFileSync(path.join(layout.dir, 'src', 'yeni dosya çğ.txt'), 'merhaba');
    fs.appendFileSync(path.join(layout.dir, 'README.md'), 'ek\n');
    expect((await git.changedFiles(layout.dir, head)).sort()).toEqual(['README.md', 'src/yeni dosya çğ.txt']);
    const commit = await git.commitAll(layout.dir, 'selfdev: deneme');
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.commitAll(layout.dir, 'boş')).toBeNull();
    expect((await git.changedFiles(layout.dir, head)).sort()).toEqual(['README.md', 'src/yeni dosya çğ.txt']);
    expect(await git.diffStat(layout.dir, head)).toMatch(/2 files changed/);

    // Ana çalışma kopyası: aynı HEAD, aynı dal, temiz.
    expect(await git.headCommit(repo)).toBe(head);
    expect(await git.status(repo)).toEqual([]);
    expect(await git.git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).then((r) => r.stdout.trim())).toBe('main');
    expect(fs.existsSync(path.join(repo, 'src'))).toBe(false);
  });

  it('worktreeRemoveIfClean: kirliyse ASLA kaldırmaz; temizse kaldırır', async () => {
    const repo = makeFakeRepo(dir);
    const head = (await git.headCommit(repo))!;
    const a = git.worktreeLayout(repo, 'temiz001');
    const b = git.worktreeLayout(repo, 'kirli002');
    await git.worktreeAdd(repo, a.dir, a.branch, head);
    await git.worktreeAdd(repo, b.dir, b.branch, head);
    fs.writeFileSync(path.join(b.dir, 'islenmemis.txt'), 'önemli');
    const dirty = await git.worktreeRemoveIfClean(repo, b.dir);
    expect(dirty.removed).toBe(false);
    expect(fs.existsSync(path.join(b.dir, 'islenmemis.txt'))).toBe(true);
    const clean = await git.worktreeRemoveIfClean(repo, a.dir);
    expect(clean.removed).toBe(true);
    expect(fs.existsSync(a.dir)).toBe(false);
  });
});
