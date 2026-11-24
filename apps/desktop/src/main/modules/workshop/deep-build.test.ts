// Yetenek yapımının derin beyin köprüsü (Claude Code) üzerinden yürümesi: gerçek Atölye servisi, gerçek konak (Node çocuk
// süreci), gerçek iş servisi; Claude Code yerine sahte CLI (ağ ve kota yok). Gerçek CLI ile kanıt: `scripts/e2e/workshop.mjs --bridge-real`.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalRequest, AttentionApi, Bus, ModuleContext, Notification, NotifyRequest, Paths, StageApi, ToolRegistry } from '@fuber/shared';
import { createBrain } from '../../core/brain';
import { createDeepBrain, type DeepBrain, type DeepBrainOptions, type DeepBrainService } from '../../core/brain/deep';
import { apiError, fakeClient, fakePolicy, fakePresence, moduleContext, silentLog, tempStore, testBus, type ScriptTurn } from '../../core/brain/testkit';
import { isAlive } from '../../core/claude-cli';
import { fakeCli } from '../../core/claude-cli/testkit';
import { createJobs } from '../../core/jobs';
import { createMemory } from '../../core/memory';
import { createTools } from '../../core/tools';
import { createUsage } from '../../core/usage';
import type { HostProcess } from './host';
import { BUILDER_INSTRUCTIONS, buildRepairMessage, CLI_BUILDER_INSTRUCTIONS } from './prompt';
import { createWorkshop, type Workshop } from './service';
import { WORKSHOP_MIGRATIONS } from './store';
import { diceSkill, forkHost, hostBundle, tempSkills } from './testkit';

const ui = { channel: 'ui' as const, speakerVerified: null };
let file: string;
const spawned: HostProcess[] = [];

let env: ReturnType<typeof tempStore>;
let skills: ReturnType<typeof tempSkills>;
let bus: Bus;
let policy: ReturnType<typeof fakePolicy>;
let tools: ToolRegistry;
let ctx: ModuleContext;
let notified: NotifyRequest[];
let approvals: ApprovalRequest[];
let script: ScriptTurn[];
const open: Workshop[] = [];
const deeps: DeepBrainService[] = [];

beforeAll(async () => {
  file = await hostBundle();
}, 30_000);

beforeEach(() => {
  env = tempStore();
  skills = tempSkills();
  bus = testBus();
  // Anahtarsız politika: `auto` seçim Claude Code'a düşer.
  policy = fakePolicy({ keys: {} });
  notified = [];
  approvals = [];
  script = [];
  const stage = { showCard: () => ({ id: 'kart' }), showApp: () => ({ id: 'uygulama' }), close() {}, items: () => [] } as unknown as StageApi;
  const attention = {
    notify(request: NotifyRequest) {
      notified.push(request);
      return { id: `bildirim-${notified.length}` } as Notification;
    },
  } as unknown as AttentionApi;
  tools = createTools({ store: env.store, policy, stage, bus, log: silentLog });
  const memory = createMemory({ store: env.store, bus, log: silentLog });
  const usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  let client: ReturnType<typeof fakeClient> | null = null;
  const brain = createBrain({ policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog }, { clientFactory: () => (client ??= fakeClient(script)), localServer: null });
  env.store.migrate('workshop', WORKSHOP_MIGRATIONS);
  ctx = moduleContext(
    'workshop',
    { bus, tools, policy, brain, attention, stage, usage, jobs: createJobs({ store: env.store, bus, log: silentLog }), paths: { skills: skills.root } as Paths },
    env.store,
  );
  bus.on('tool.approval.request', (request) => approvals.push(request));
});

afterEach(async () => {
  for (const workshop of open.splice(0)) await workshop.stop();
  for (const deep of deeps.splice(0)) deep.dispose();
  env.close();
  skills.cleanup();
});
afterAll(() => {
  for (const process of spawned) process.kill();
});

/** Sahte CLI'ye bağlı derin beyinle Atölye. Derin iş çağrıları türleriyle sayılır. */
function bridged(options: DeepBrainOptions = { cli: fakeCli() }) {
  const deep = createDeepBrain(ctx, options);
  deeps.push(deep);
  const tasks: string[] = [];
  const counting: DeepBrain = { ...deep, runTask: (request) => (tasks.push(request.kind), deep.runTask(request)) };
  const api = createWorkshop(ctx, { spawnHost: () => forkHost(file, spawned), timeouts: { callMs: 700, pingMs: 400, selftestMs: 5000 }, deep: counting });
  open.push(api);
  return { api, tasks, deep };
}

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, what: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`zaman aşımı: ${what} (son değer: ${JSON.stringify(value)})`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

const statusOf = (api: Workshop, id: string) => async () => (await api.list()).find((skill) => skill.id === id)?.status ?? null;
const run = (name: string, input: unknown = {}) => tools.run(name, input, { origin: ui });

describe('yetenek yapımı: derin beyin köprüsü (sahte Claude Code CLI)', () => {
  it('yazar → Atölye doğrular ve sınar → onay kartı → onay → araç çağrılır; ek dosyalar süpürülür', async () => {
    const { api, tasks } = bridged();
    await api.start();
    expect((await api.status(true)).cloud).toMatchObject({ ok: true, provider: 'claude-code' });
    const steps: string[] = [];
    bus.on('job.progress', ({ job }) => void (steps.includes(job.step) || steps.push(job.step)));
    const job = await api.build('Zar atan bir yetenek geliştir [[sahte:yetenek|zar_kopru|fazla]]', ui);
    expect((await api.status(false)).builds).toHaveLength(1);
    const done = await ctx.jobs.wait(job.id);
    expect(done).toMatchObject({ status: 'done' });
    expect(done.resultText).toMatch(/“Köprü zarı” yeteneği hazır; onayınızı bekliyor/);
    expect(tasks).toEqual(['skill_build']);
    expect(steps).toEqual(expect.arrayContaining(['Planlıyor', 'manifest.json yazılıyor', 'index.mjs yazılıyor', 'selftest.mjs yazılıyor', 'Öz-sınama koşuyor', 'Onay bekliyor']));

    const dir = path.join(skills.root, 'zar_kopru');
    expect(fs.readdirSync(dir).sort()).toEqual(['index.mjs', 'manifest.json', 'selftest.mjs']);
    expect(fs.readdirSync(path.join(skills.root, '.drafts'))).toEqual([]);
    // Köken ve tarih modelin beyanına bırakılmaz.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))).toMatchObject({ id: 'zar_kopru', createdBy: 'workshop', version: 1 });
    const log = (await api.detail('zar_kopru')).selftestLog;
    expect(log).toContain('Öz-sınama geçti');
    expect(log).toContain('Özet: Zar atan, ağ gerektirmeyen bir yetenek yazdım.');

    // Onaydan önce araç yoktur: Claude Code'un yazdığı kod kendiliğinden yüklenmez.
    expect(tools.has('skill_zar_kopru_at')).toBe(false);
    const card = await until(() => approvals.find((request) => request.toolName === 'skill_approve'), (request) => request !== undefined, 'onay kartı');
    expect(card!.summary).toMatch(/Yeni eklenti hazır: Köprü zarı\./);
    expect(tools.resolveApproval(card!.id, 'approved', 'ui')).toBe(true);
    await until(statusOf(api, 'zar_kopru'), (status) => status === 'enabled', 'onaydan sonra etkin');
    const rolled = await run('skill_zar_kopru_at', { count: 2 });
    expect((rolled.data as { rolls: number[] }).rolls).toHaveLength(2);
  }, 40_000);

  it('ilk deneme şemadan geçmezse bir onarım turu açılır ve yetenek onaya düşer', async () => {
    const { api, tasks } = bridged();
    await api.start();
    const done = await ctx.jobs.wait((await api.build('Zar atan bir yetenek geliştir [[sahte:bozuk|zar_onarim]]', ui)).id);
    expect(done).toMatchObject({ status: 'done' });
    expect(tasks).toEqual(['skill_build', 'skill_repair']);
    expect((await api.list()).map((skill) => [skill.id, skill.status])).toEqual([['zar_onarim', 'pending_approval']]);
  }, 40_000);

  it('onarımdan sonra da geçmezse dürüst hata: ne denendiği ve son sorun yazılır, yetenek onaya düşmez', async () => {
    const { api, tasks } = bridged();
    await api.start();
    const job = await ctx.jobs.wait((await api.build('Zar atan bir yetenek geliştir [[sahte:hep-bozuk|zar_bozuk]]', ui)).id);
    expect(job.status).toBe('failed');
    expect(tasks).toEqual(['skill_build', 'skill_repair']);
    expect(job.error).toMatch(/Yetenek geliştirilemedi\. Yazılan yetenek denetimden geçmedi; bir kez düzeltmeyi denedim, yine geçmedi\./);
    expect(job.error).toMatch(/Yazılan dosyalar: .*manifest\.json/);
    expect(job.error).toMatch(/Son sorun: .*geçerli JSON değil/s);
    expect(approvals).toEqual([]);
    expect(fs.existsSync(path.join(skills.root, 'zar_bozuk'))).toBe(false);
    const [draft] = await api.list();
    expect(draft).toMatchObject({ status: 'failed' });
    expect(notified.at(-1)?.title).toBe('Yetenek geliştirilemedi');
    await api.remove(draft!.id);
    expect(fs.readdirSync(path.join(skills.root, '.drafts'))).toEqual([]);
  }, 40_000);

  it('öz-sınaması kalan yetenek onaya düşmez; modelin "yazdım" demesi yetmez', async () => {
    const { api } = bridged();
    await api.start();
    const job = await ctx.jobs.wait((await api.build('Zar atan bir yetenek geliştir [[sahte:sinama-kalir|zar_kalir]]', ui)).id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Son sorun: Öz-sınama geçmedi: .*bilerek kalan sınama/s);
    expect(tools.has('skill_zar_kalir_at')).toBe(false);
    expect(approvals).toEqual([]);
  }, 40_000);

  it('abonelik sınırı dolduysa iş dürüst nedenle biter ve taslak kalmaz', async () => {
    const { api, tasks } = bridged();
    await api.start();
    const job = await ctx.jobs.wait((await api.build('Zar atan bir yetenek geliştir [[sahte:limit]]', ui)).id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Yetenek geliştirilemedi\. Claude aboneliğinin kullanım sınırı doldu/);
    expect(tasks).toEqual(['skill_build']);
    expect(await api.list()).toEqual([]);
    expect(fs.readdirSync(path.join(skills.root, '.drafts'))).toEqual([]);
  }, 30_000);

  it('klasör dışına yazma denemesi yeteneği bozmaz ama dışarıda dosya da oluşmaz', async () => {
    const { api } = bridged();
    await api.start();
    const done = await ctx.jobs.wait((await api.build('Zar atan bir yetenek geliştir [[sahte:kacak|zar_kacak]]', ui)).id);
    expect(done.status).toBe('done');
    expect(fs.existsSync(path.join(skills.root, 'kacak.txt'))).toBe(false);
    expect(fs.existsSync(path.join(skills.root, '..', 'kacak.txt'))).toBe(false);
  }, 40_000);

  it('yapım durdurulursa CLI süreci kesilir ve taslak iz bırakmadan kalkar', async () => {
    const { api, deep } = bridged();
    await api.start();
    const pidFile = path.join(skills.root, 'pid.json');
    const job = await api.build(`Zar atan bir yetenek geliştir [[sahte:asili|${pidFile}]]`, ui);
    await until(() => fs.existsSync(pidFile), (exists) => exists, 'CLI başladı');
    const [draft] = await api.list();
    await api.cancelBuild(draft!.id);
    expect((await ctx.jobs.wait(job.id)).status).toBe('cancelled');
    const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as { pid: number; child: number };
    await until(() => isAlive(pids.pid) || isAlive(pids.child), (alive) => !alive, 'süreç ağacı öldü');
    await until(() => api.list(), (list) => list.length === 0, 'taslak kalktı');
    expect(deep.available().ok).toBe(true);
  }, 40_000);

  it('ne API ne Claude Code varsa iş başlamaz ve iki neden de söylenir', async () => {
    const { api } = bridged({ cli: null });
    await api.start();
    await expect(api.build('Zar atan bir yetenek geliştir', ui)).rejects.toThrow(/derin beynim gerekiyor\. Anthropic anahtarı tanımlı değil\. Claude Code bu bilgisayarda kurulu değil\./);
    expect((await api.status(true)).cloud).toMatchObject({ ok: false, provider: null });
    expect(ctx.jobs.list()).toEqual([]);
  }, 20_000);

  it('API anahtarı var ama hesapta kredi yoksa yoklama bunu görür ve yapım Claude Code ile yürür', async () => {
    policy.set({ keys: { anthropic: 'test-key' } });
    script.push({ blocks: [], error: apiError(400, 'Your credit balance is too low to access the Anthropic API.') });
    const { api, tasks } = bridged();
    await api.start();
    const done = await ctx.jobs.wait((await api.build('Zar atan bir yetenek geliştir [[sahte:yetenek|zar_kredi]]', ui)).id);
    expect(done.status).toBe('done');
    expect(tasks).toEqual(['skill_build']);
    expect((await api.status(false)).cloud).toMatchObject({ ok: true, provider: 'claude-code' });
  }, 40_000);

  it('seçim "anthropic" iken kredi yoksa Claude Code hazır olsa da kullanılmaz', async () => {
    policy.set({ keys: { anthropic: 'test-key' }, brain: { ...policy.get().brain, deep: { provider: 'anthropic', claudeCodeModel: 'sonnet' } } });
    script.push({ blocks: [], error: apiError(400, 'Your credit balance is too low to access the Anthropic API.') });
    const { api, tasks } = bridged();
    await api.start();
    await expect(api.build('Zar atan bir yetenek geliştir [[sahte:yetenek|zar_x]]', ui)).rejects.toThrow(/derin beynim gerekiyor.*ödeme sorunu/);
    expect(tasks).toEqual([]);
  }, 20_000);

  it('yetenek araç adıyla da bulunur; aynı adlı yeteneklerde "kapat" açık olanı kasteder', async () => {
    // Küçük model çoğu kez yeteneğin adını değil aracının adını söyler (ölçüldü: "zar_kopru_at").
    skills.write('zar', diceSkill('zar'));
    skills.write('zar_iki', diceSkill('zar_iki'));
    const { api } = bridged({ cli: null });
    await api.start();
    await until(() => api.list(), (list) => list.length === 2 && list.every((skill) => skill.status === 'pending_approval'), 'iki yetenek değerlendirildi', 20_000);
    expect(api.find('skill_zar_at').id).toBe('zar');
    expect(api.find('zar_at').id).toBe('zar');
    expect(api.find('skill_zar_iki_at').id).toBe('zar_iki');
    expect(api.find('zar_iki').id).toBe('zar_iki');
    // İkisinin de görünen adı "Zar": ad tek başına belirsizdir ve ileti kimlikleri de söyler.
    expect(() => api.find('Zar')).toThrow(/Birden çok yetenek eşleşiyor: Zar \(zar(_iki)?\), Zar \(zar(_iki)?\)/);
    await api.approve('zar', true);
    expect(api.find('Zar', 'enabled').id).toBe('zar');
    // Tercih edilen durumda eşleşen yoksa belirsizlik sürer (rastgele biri seçilmez).
    expect(() => api.find('Zar', 'disabled')).toThrow(/Birden çok yetenek eşleşiyor/);
    await api.setEnabled('zar', false);
    expect(api.find('Zar', 'disabled').id).toBe('zar');
    expect(() => api.find('olmayan_yetenek')).toThrow(/bulamadım/);
  }, 30_000);

  it('Claude Code istemi: aynı sözleşme, kendi araç adları; API istemi değişmedi', () => {
    expect(CLI_BUILDER_INSTRUCTIONS).not.toMatch(/ws_|web_search|web_fetch/);
    expect(CLI_BUILDER_INSTRUCTIONS).toContain('Write aracıyla bulunduğun klasöre');
    expect(CLI_BUILDER_INSTRUCTIONS).toContain('bir kez daha çağrılırsın');
    expect(CLI_BUILDER_INSTRUCTIONS).toContain('skill_doviz_kuru_cevir');
    expect(CLI_BUILDER_INSTRUCTIONS).toContain('## Kodun çalıştığı ortam');
    expect(BUILDER_INSTRUCTIONS).toContain('ws_finish');
    const repair = buildRepairMessage('Zar at', 'manifest.json › tools: gerekli', ['zar']);
    expect(repair).toContain('ONARIM TURU');
    expect(repair).toContain('manifest.json › tools: gerekli');
    expect(repair).toContain('Bu kimlikler dolu, başka bir id seç: zar.');
  });
});
