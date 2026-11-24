import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineDeps } from './engine';
import * as git from './git';
import { healthFile, pendingFile, rollbackDir } from './packager';
import { PLAN_OK, defaultConfig, fakeClaude, fakeInstaller, fakeJobs, fakePackager, fakeRunner, log, makeFakeRepo, makeStore, notices, removeDir, tempDir } from './testkit';
import type { RunStatus } from './types';

// Her koşu onlarca gerçek git komutu çalıştırır (Windows'ta saniyeler sürer).
vi.setConfig({ testTimeout: 90_000 });

let dir: string;
let data: string;
let repo: string;
let closers: Array<() => void> = [];

beforeEach(() => {
  dir = tempDir('engine');
  data = path.join(dir, 'veri');
  fs.mkdirSync(data);
  repo = makeFakeRepo(dir);
});
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await removeDir(dir);
});

const writeFeature = (call: { workDir: string }, content = 'yeni özellik'): void => {
  fs.mkdirSync(path.join(call.workDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(call.workDir, 'src', 'ozellik.txt'), content);
};

function build(over: Partial<EngineDeps> & { running?: string } = {}) {
  const { core, store } = makeStore(dir);
  closers.push(() => core.close());
  const jobs = fakeJobs();
  const notes = notices();
  const installer = (over.installer as ReturnType<typeof fakeInstaller> | undefined) ?? fakeInstaller();
  const emitted: Array<[string | null, RunStatus | null]> = [];
  let quit = 0;
  let running = over.running ?? '2.0.0-demo.3';
  const deps: EngineDeps = {
    store,
    runner: fakeRunner(),
    packager: fakePackager,
    claude: fakeClaude({ implement: (call) => writeFeature(call) }),
    installer,
    jobs: jobs.api,
    config: () => defaultConfig(),
    repoRoot: () => repo,
    dataDir: data,
    runningVersion: () => running,
    env: { pid: 4242, execPath: path.join(dir, 'kurulu', 'Fuber AI 2.exe'), quit: () => void quit++ },
    notify: notes.notify,
    emit: (runId, status) => void emitted.push([runId, status]),
    healthFacts: () => ({ dbOpen: true, settingsReadable: true, brainStatusReadable: true, toolModules: 9, moduleLoadErrors: 0 }),
    log,
    ...over,
  };
  const engine = createEngine(deps);
  closers.push(() => engine.dispose());
  return { engine, store, jobs, notes, installer, emitted, quits: () => quit, setRunning: (version: string) => void (running = version), deps };
}

const startRun = async (ctx: ReturnType<typeof build>) => {
  const outcome = ctx.engine.start({ request: 'Ana pencereye yeni bir bölüm ekle', reason: 'arayüz kabuğu', origin: 'chat' });
  expect(outcome.ok, outcome.text).toBe(true);
  await ctx.jobs.settled();
  return ctx.store.getRun(outcome.run!.id)!;
};

describe('boru hattı: başarılı yol', () => {
  it('plan → uygula → sına → paketle → hazır; ana çalışma kopyası ve dalları hiç değişmez', async () => {
    const headBefore = await git.headCommit(repo);
    const branchesBefore = (await git.git(repo, ['branch', '--format=%(refname:short)'])).stdout;
    const ctx = build();
    const run = await startRun(ctx);

    expect(run.status).toBe('ready');
    expect(run.error).toBeNull();
    expect(run.planSummary).toMatch(/Ana pencereye yeni bir bölüm/);
    expect(run.planFiles).toEqual(['src/ozellik.txt']);
    expect(run.files).toEqual(['src/ozellik.txt']);
    expect(run.version).toBe('2.0.0-demo.3.dev.1');
    expect(run.branch).toMatch(/^selfdev\//);
    expect(run.checks.map((check) => check.name)).toEqual(['typecheck', 'test']);
    expect(run.checks.every((check) => check.ok)).toBe(true);
    expect(run.packagePath).toContain(path.join('selfdev', 'packages', '2.0.0-demo.3.dev.1'));
    expect(fs.existsSync(run.packagePath!)).toBe(true);

    // Worktree'de iki işleme: değişiklik + sürüm; sürüm dosyalarının hepsi artmış.
    const worktree = run.worktree!;
    expect(worktree).toContain('-wt');
    expect(fs.readFileSync(path.join(worktree, 'src', 'ozellik.txt'), 'utf8')).toBe('yeni özellik');
    expect(fs.readFileSync(path.join(worktree, 'packages', 'shared', 'src', 'constants.ts'), 'utf8')).toContain("'2.0.0-demo.3.dev.1'");
    expect((await git.git(worktree, ['log', '--format=%s', `${run.baseCommit}..HEAD`])).stdout.trim().split('\n')).toHaveLength(2);

    // KAYNAK DEPOSUNUN ANA ÇALIŞMA KOPYASI: HEAD aynı, dallar yalnız bir yeni dal, çalışma ağacı temiz, sürüm eski.
    expect(await git.headCommit(repo)).toBe(headBefore);
    expect(await git.status(repo)).toEqual([]);
    const branchesAfter = (await git.git(repo, ['branch', '--format=%(refname:short)'])).stdout;
    expect(branchesAfter.replace(branchesBefore, '').trim()).toBe(run.branch);
    expect(fs.existsSync(path.join(repo, 'src'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).toContain('"2.0.0-demo.3"');

    // Kullanıcıya haber: plan + hazır (sesli, yüksek öncelik, "kurayım mı").
    const ready = ctx.notes.list.find((note) => note.title.startsWith('Güncelleme hazır'));
    expect(ready?.priority).toBe('high');
    expect(String(ready?.speak)).toMatch(/Kurayım mı/);
    expect(ctx.notes.list.some((note) => note.title === 'Plan hazır')).toBe(true);

    // Günlük: durum geçişleri sırayla kayıtlıdır ve olay yayınlanmıştır.
    const statuses = ctx.store.events(run.id).filter((event) => event.kind === 'status').map((event) => event.text);
    expect(statuses).toEqual(['Plan hazırlanıyor', 'Uygulanıyor', 'Sınanıyor', 'Paketleniyor', 'Güncelleme hazır']);
    expect(ctx.emitted.length).toBeGreaterThan(8);
    // Kurulum onaysız tetiklenmedi.
    expect(ctx.installer.jobs).toEqual([]);
    expect(ctx.quits()).toBe(0);
  });

  it('aynı anda tek koşu: sürerken ve hazırken ikinci istek reddedilir; vazgeç hazır güncellemeyi bırakır', async () => {
    const ctx = build();
    const first = ctx.engine.start({ request: 'birinci istek uzun', reason: 'x', origin: 'chat' });
    expect(first.ok).toBe(true);
    expect(ctx.engine.start({ request: 'ikinci istek uzun', reason: 'x', origin: 'chat' })).toMatchObject({ ok: false });
    await ctx.jobs.settled();
    expect(ctx.engine.start({ request: 'üçüncü istek uzun', reason: 'x', origin: 'chat' }).text).toMatch(/Kurulmayı bekleyen/);
    const cancelled = await ctx.engine.cancel();
    expect(cancelled).toMatchObject({ ok: true });
    expect(ctx.store.getRun(first.run!.id)!.status).toBe('cancelled');
    expect(ctx.engine.readyRun()).toBeNull();
    // Paket silindi; artık yeni koşu başlayabilir.
    expect(fs.existsSync(path.join(data, 'selfdev', 'packages', '2.0.0-demo.3.dev.1'))).toBe(false);
    expect(ctx.engine.start({ request: 'dördüncü istek uzun', reason: 'x', origin: 'chat' }).ok).toBe(true);
    await ctx.jobs.settled();
  });

  it('derin beyin hazır değilse başlamaz ve nedenini söyler', () => {
    const ctx = build({ claude: fakeClaude({ available: { ok: false, reason: 'Claude Code kurulu değil.' } }) });
    const outcome = ctx.engine.start({ request: 'bir şey iste', reason: 'x', origin: 'chat' });
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.text).toMatch(/Claude Code kurulu değil/);
    expect(ctx.store.listRuns()).toEqual([]);
  });
});

describe('sınama ⇄ düzeltme', () => {
  it('ilk tur başarısız, düzeltme turu başarılı: fixRounds=1, ikinci tur sonuçları kayıtlı', async () => {
    const claude = fakeClaude({ implement: (call) => writeFeature(call, 'BOZUK'), fix: (call) => writeFeature(call, 'düzgün') });
    const ctx = build({ claude, runner: fakeRunner((spec, count) => spec.label === 'typecheck' && count === 1) });
    const run = await startRun(ctx);
    expect(run.status).toBe('ready');
    expect(run.fixRounds).toBe(1);
    expect(claude.calls).toEqual(['plan', 'implement', 'fix']);
    expect(run.checks.map((check) => `${check.round}:${check.name}:${check.ok}`)).toEqual(['0:typecheck:false', '1:typecheck:true', '1:test:true']);
    // Başarısız çıktı düzeltme istemine gider.
    expect(run.checks[0]!.tail).toMatch(/sahte hata/);
    expect(fs.readFileSync(path.join(run.worktree!, 'src', 'ozellik.txt'), 'utf8')).toBe('düzgün');
    const statuses = ctx.store.events(run.id).filter((event) => event.kind === 'status').map((event) => event.text);
    expect(statuses).toContain('Düzeltiliyor');
  });

  it('düzeltme turu sınırı (2) dolunca DÜRÜSTÇE bırakır: failed, paket yok, hiçbir şey kurulmaz, worktree ve dal yerinde', async () => {
    const claude = fakeClaude({ implement: (call) => writeFeature(call, 'BOZUK') });
    const ctx = build({ claude, runner: fakeRunner((spec) => spec.label === 'test') });
    const run = await startRun(ctx);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/Sınama geçmedi \(test\).*2 düzeltme turundan sonra/);
    expect(run.error).toMatch(/Hiçbir şey kurulmadı/);
    expect(run.fixRounds).toBe(2);
    expect(claude.calls).toEqual(['plan', 'implement', 'fix', 'fix']);
    expect(run.version).toBeNull();
    expect(run.packagePath).toBeNull();
    expect(fs.existsSync(path.join(data, 'selfdev', 'packages'))).toBe(false);
    // İnceleme için bırakıldı.
    expect(fs.existsSync(run.worktree!)).toBe(true);
    expect((await git.git(repo, ['branch', '--list', run.branch!])).stdout).toContain(run.branch!);
    expect(ctx.installer.jobs).toEqual([]);
    expect(ctx.notes.list.some((note) => note.title === 'Çekirdek geliştirme tamamlanamadı')).toBe(true);
    // Yeni koşu başlayabilir (başarısız koşu engellemez).
    expect(ctx.engine.start({ request: 'yeniden dene istek', reason: 'x', origin: 'chat' }).ok).toBe(true);
    await ctx.jobs.settled();
  });

  it('maxFixRounds=0: düzeltme yok', async () => {
    const claude = fakeClaude({ implement: (call) => writeFeature(call) });
    const ctx = build({ claude, config: () => defaultConfig({ maxFixRounds: 0 }), runner: fakeRunner((spec) => spec.label === 'typecheck') });
    const run = await startRun(ctx);
    expect(run.status).toBe('failed');
    expect(claude.calls).toEqual(['plan', 'implement']);
  });

  it('yapılandırılmış e2e: önce build, sonra betikler koşar', async () => {
    const runner = fakeRunner();
    const ctx = build({ runner, config: () => defaultConfig({ e2e: ['scripts/e2e/smoke.mjs'] }) });
    const run = await startRun(ctx);
    expect(run.status).toBe('ready');
    expect(run.checks.map((check) => check.name)).toEqual(['typecheck', 'test', 'build', 'e2e:smoke']);
  });
});

describe('dürüst çıkışlar', () => {
  it('plan "eklentiyle yapılabilir" derse: hiçbir şey değişmez, temiz worktree kaldırılır, nedeni söylenir', async () => {
    const claude = fakeClaude({ plan: () => '## UYGUNLUK\nEKLENTİ — basit bir kart, eklentiyle olur.\n\n## ÖZET\nKart eklenti olarak yapılabilir.' });
    const ctx = build({ claude });
    const run = await startRun(ctx);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/eklentiyle yapılabilir/);
    expect(claude.calls).toEqual(['plan']);
    expect(fs.existsSync(run.worktree!)).toBe(false);
  });

  it('Claude hiçbir dosyayı değiştirmezse başarısız sayılır', async () => {
    const ctx = build({ claude: fakeClaude({}) });
    const run = await startRun(ctx);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/hiçbir dosyayı değiştirmedi/);
  });

  it('sürerken vazgeçmek koşuyu durdurur; hiçbir şey kurulmaz', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const claude = fakeClaude({
      implement: async (call) => {
        await gate;
        writeFeature(call);
      },
    });
    const ctx = build({ claude });
    const started = ctx.engine.start({ request: 'uzun süren istek', reason: 'x', origin: 'chat' });
    // Worktree açılışı yük altında saniyeler sürer: uygulama aşamasına gelinceye dek beklenir.
    for (let index = 0; index < 600 && ctx.store.getRun(started.run!.id)!.status !== 'implementing'; index++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ctx.store.getRun(started.run!.id)!.status).toBe('implementing');
    expect(await ctx.engine.cancel()).toMatchObject({ ok: true });
    release();
    await ctx.jobs.settled();
    const run = ctx.store.getRun(started.run!.id)!;
    expect(run.status).toBe('cancelled');
    expect(run.packagePath).toBeNull();
  });

  it('açılışta yarıda kalmış koşu "yarıda kaldı" ile kapanır', () => {
    const ctx = build();
    const run = ctx.store.insertRun({ id: 'ABCDEFGH12345678', request: 'x', reason: '', origin: 'chat', status: 'implementing', planSummary: null, planText: null, planFiles: [], planRisk: null, branch: null, worktree: null, baseCommit: null, headCommit: null, files: [], riskFlags: [], checks: [], fixRounds: 0, fromVersion: '2.0.0-demo.3', version: null, packagePath: null, error: null, createdAt: new Date().toISOString(), finishedAt: null });
    ctx.engine.onStartup();
    const after = ctx.store.getRun(run.id)!;
    expect(after.status).toBe('failed');
    expect(after.error).toMatch(/yarıda kaldı/);
  });
});

describe('kurulum, sağlık denetimi ve geri alma', () => {
  async function ready(ctx = build()) {
    const run = await startRun(ctx);
    expect(run.status).toBe('ready');
    return { ctx, run };
  }

  it('kurulum: anlık kopya alınır, bekleyen kayıt yazılır, kurucu görevi doğru, uygulama kapanmaya çağrılır', async () => {
    const { ctx, run } = await ready();
    const outcome = await ctx.engine.install(run.id);
    expect(outcome.ok, outcome.text).toBe(true);
    expect(ctx.store.getRun(run.id)!.status).toBe('restarting');
    // İlk güncelleme: elde paket yok → kurulu klasörün anlık kopyası.
    expect(ctx.installer.snapshots).toEqual([path.join(rollbackDir(data), '2.0.0-demo.3')]);
    const job = ctx.installer.jobs[0]!;
    expect(job).toMatchObject({ mode: 'install', runId: run.id, pid: 4242, version: '2.0.0-demo.3.dev.1', fromVersion: '2.0.0-demo.3', waitHealthSeconds: 120 });
    expect(job.installer).toBe(run.packagePath);
    expect(job.restoreSnapshot).toBe(path.join(rollbackDir(data), '2.0.0-demo.3'));
    expect(job.installDir).toBe(path.join(dir, 'kurulu'));
    const pending = JSON.parse(fs.readFileSync(pendingFile(data), 'utf8'));
    expect(pending).toMatchObject({ runId: run.id, kind: 'install', fromVersion: '2.0.0-demo.3', toVersion: '2.0.0-demo.3.dev.1', attempts: 0 });
    expect(fs.existsSync(healthFile(data))).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 2700));
    expect(ctx.quits()).toBe(1);
  });

  it('anlık kopya alınamazsa kurulum YAPILMAZ (geri dönüş yolu yoksa güncelleme yok)', async () => {
    const { ctx, run } = await ready(build({ installer: fakeInstaller({ snapshotOk: false }) }));
    const outcome = await ctx.engine.install(run.id);
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toMatch(/Geri dönüş yolu hazırlanamadığı için kurulum yapılmadı/);
    expect(ctx.store.getRun(run.id)!.status).toBe('ready');
    expect(ctx.installer.jobs).toEqual([]);
    expect(fs.existsSync(pendingFile(data))).toBe(false);
  });

  it('paketsiz (geliştirme) kipte kurulum yapılmaz ve nedeni söylenir', async () => {
    const { ctx, run } = await ready(build({ installer: fakeInstaller({ available: { ok: false, reason: 'bu kipte kurulum yapılmaz' } }) }));
    const outcome = await ctx.engine.install(run.id);
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.text).toMatch(/bu kipte kurulum yapılmaz/);
    expect(ctx.store.getRun(run.id)!.status).toBe('ready');
  });

  it('hazır olmayan koşu kurulamaz', async () => {
    const ctx = build();
    expect(await ctx.engine.install('yok')).toMatchObject({ ok: false });
  });

  it('yeniden açılış: yeni sürüm çalışıyor → sağlık denetimi geçer → sağlık işareti yazılır → koşu installed', async () => {
    const { ctx, run } = await ready();
    await ctx.engine.install(run.id);
    // Uygulama yeni sürümle yeniden açıldı: aynı veri, yeni motor örneği.
    const next = build({ running: '2.0.0-demo.3.dev.1' });
    next.engine.onStartup();
    expect(next.store.state().pending).toMatchObject({ attempts: 1 }); // bu açılış sayıldı
    await next.engine.verifyNow();
    const mark = JSON.parse(fs.readFileSync(healthFile(data), 'utf8'));
    expect(mark).toMatchObject({ version: '2.0.0-demo.3.dev.1', runId: run.id, ok: true });
    expect(next.store.getRun(run.id)!.status).toBe('installed');
    expect(next.store.state().pending).toBeNull();
    expect(fs.existsSync(pendingFile(data))).toBe(false);
    expect(next.notes.list.some((note) => note.title === 'Güncelleme tamamlandı')).toBe(true);
  });

  it('sağlık denetimi başarısız: geri alma ÖNERİLİR (kendiliğinden geri alınmaz), sağlıksız işaret yazılır', async () => {
    const { ctx, run } = await ready();
    await ctx.engine.install(run.id);
    const next = build({ running: '2.0.0-demo.3.dev.1', healthFacts: () => ({ dbOpen: false, settingsReadable: true, brainStatusReadable: true, toolModules: 9, moduleLoadErrors: 0 }) });
    next.engine.onStartup();
    await next.engine.verifyNow();
    expect(JSON.parse(fs.readFileSync(healthFile(data), 'utf8'))).toMatchObject({ ok: false, reason: expect.stringContaining('veritabanı') });
    expect(next.store.state().healthFailed).toMatchObject({ runId: run.id });
    const note = next.notes.list.find((item) => item.title === 'Yeni sürüm sağlıksız görünüyor');
    expect(note?.priority).toBe('high');
    expect(note?.actions?.map((action) => action.id)).toContain('selfdev.rollback');
    expect(next.installer.jobs).toEqual([]); // hiçbir şey kendiliğinden geri alınmadı
    expect(next.store.getRun(run.id)!.status).toBe('restarting');
    // Geri alma hedefi: anlık kopya.
    expect(next.engine.rollbackTarget()).toMatchObject({ version: '2.0.0-demo.3', via: 'snapshot' });
  });

  it('açılış iki kez sağlık işareti yazamadan bittiyse (çökme döngüsü) geri alma önerilir', async () => {
    const { ctx, run } = await ready();
    await ctx.engine.install(run.id);
    const first = build({ running: '2.0.0-demo.3.dev.1' });
    first.engine.onStartup(); // 1. açılış: sayıldı, sağlık işareti yazılamadan çöktü
    const second = build({ running: '2.0.0-demo.3.dev.1' });
    second.engine.onStartup(); // 2. açılış
    const third = build({ running: '2.0.0-demo.3.dev.1' });
    third.engine.onStartup(); // 3. açılış: iki kez yazılamamış → öneri, denetim beklenmez
    expect(third.store.state().healthFailed?.reason).toMatch(/2 kez açılıp sağlık işareti yazamadan kapandı/);
    expect(third.notes.list.some((item) => item.title === 'Yeni sürüm sağlıksız görünüyor')).toBe(true);
    expect(fs.existsSync(healthFile(data))).toBe(false);
  });

  it('kurulum tutmadı (eski sürüm açıldı): koşu failed, sürüm kaydı geri alınır, bekleyen temizlenir', async () => {
    const { ctx, run } = await ready();
    await ctx.engine.install(run.id);
    const next = build({ running: '2.0.0-demo.3' });
    next.engine.onStartup();
    expect(next.store.getRun(run.id)!.status).toBe('failed');
    expect(next.store.getRun(run.id)!.error).toMatch(/Kurulum tutmadı/);
    expect(next.store.state().pending).toBeNull();
    expect(next.store.state().installed.map((item) => item.version)).toEqual(['2.0.0-demo.3']);
  });

  it('geri alma: hedef önceki sürüm; görev rollback kipinde anlık kopyayı taşır; açılışta doğrulanınca rolled_back', async () => {
    const { ctx, run } = await ready();
    await ctx.engine.install(run.id);
    const installed = build({ running: '2.0.0-demo.3.dev.1' });
    installed.engine.onStartup();
    await installed.engine.verifyNow();
    expect(installed.store.getRun(run.id)!.status).toBe('installed');

    const outcome = await installed.engine.rollback();
    expect(outcome.ok, outcome.text).toBe(true);
    const job = installed.installer.jobs[0]!;
    expect(job).toMatchObject({ mode: 'rollback', version: '2.0.0-demo.3', fromVersion: '2.0.0-demo.3.dev.1', installer: null });
    expect(job.restoreSnapshot).toBe(path.join(rollbackDir(data), '2.0.0-demo.3'));
    expect(JSON.parse(fs.readFileSync(pendingFile(data), 'utf8'))).toMatchObject({ kind: 'rollback', toVersion: '2.0.0-demo.3' });

    const back = build({ running: '2.0.0-demo.3' });
    back.engine.onStartup();
    await back.engine.verifyNow();
    expect(back.store.getRun(run.id)!.status).toBe('rolled_back');
    expect(JSON.parse(fs.readFileSync(healthFile(data), 'utf8'))).toMatchObject({ version: '2.0.0-demo.3', ok: true });
    expect(back.store.state().installed.map((item) => item.version)).toEqual(['2.0.0-demo.3']);
    expect(back.notes.list.some((note) => note.title === 'Önceki sürüme dönüldü')).toBe(true);
    // Artık dönülecek önceki sürüm yok.
    expect(back.engine.rollbackTarget()).toBeNull();
  });

  it('önceki sürüm paketi saklıysa (ikinci güncelleme) geri alma paketle de yapılabilir; sürüm numarası tekrar etmez', async () => {
    const first = await ready();
    await first.ctx.engine.install(first.run.id);
    const afterFirst = build({ running: '2.0.0-demo.3.dev.1' });
    afterFirst.engine.onStartup();
    await afterFirst.engine.verifyNow();
    // İkinci koşu: depo hâlâ demo.3'te, ama dev numarası 2'ye çıkar.
    const second = await ready(afterFirst);
    expect(second.run.version).toBe('2.0.0-demo.3.dev.2');
    const outcome = await afterFirst.engine.install(second.run.id);
    expect(outcome.ok, outcome.text).toBe(true);
    const job = afterFirst.installer.jobs[0]!;
    expect(job.fromVersion).toBe('2.0.0-demo.3.dev.1');
    // Önceki (dev.1) paketi saklı: anlık kopyaya gerek kalmadı, geri yükleme paketle.
    expect(afterFirst.installer.snapshots).toEqual([]);
    expect(job.restoreInstaller).toContain('2.0.0-demo.3.dev.1');
    afterFirst.setRunning('2.0.0-demo.3.dev.2');
    expect(afterFirst.engine.rollbackTarget()).toMatchObject({ version: '2.0.0-demo.3.dev.1', via: 'package' });
  });
});
