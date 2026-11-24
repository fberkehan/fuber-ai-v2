// Atölye servisi uçtan uca (Electron'suz): gerçek araç kaydı, gerçek beyin döngüsü (sahte Claude akışı),
// gerçek iş servisi ve Node çocuk sürecinde gerçek konak.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApprovalRequest,
  AttentionApi,
  Bus,
  ModuleContext,
  Notification,
  NotifyRequest,
  Paths,
  SkillInfo,
  StageApi,
  ToolRegistry,
} from '@fuber/shared';
import { createBrain } from '../../core/brain';
import {
  apiError,
  fakeClient,
  fakePolicy,
  fakePresence,
  moduleContext,
  silentLog,
  tempStore,
  testBus,
  type ScriptTurn,
} from '../../core/brain/testkit';
import { createJobs } from '../../core/jobs';
import { createMemory } from '../../core/memory';
import { createTools } from '../../core/tools';
import { createUsage } from '../../core/usage';
import type { HostProcess } from './host';
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
let client: ReturnType<typeof fakeClient>;
const open: Workshop[] = [];

beforeAll(async () => {
  file = await hostBundle();
}, 30_000);

beforeEach(() => {
  env = tempStore();
  skills = tempSkills();
  bus = testBus();
  policy = fakePolicy();
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
  // Sahte Claude: senaryo her sınamada `script` dizisine yazılır; istemci ilk istekte kurulur.
  const brain = createBrain(
    { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
    { clientFactory: () => (client ??= fakeClient(script)), localServer: null },
  );
  client = undefined as unknown as ReturnType<typeof fakeClient>;
  env.store.migrate('workshop', WORKSHOP_MIGRATIONS);
  ctx = moduleContext(
    'workshop',
    {
      bus,
      tools,
      policy,
      brain,
      attention,
      stage,
      jobs: createJobs({ store: env.store, bus, log: silentLog }),
      paths: { skills: skills.root } as Paths,
    },
    env.store,
  );
  bus.on('tool.approval.request', (request) => approvals.push(request));
});

afterEach(async () => {
  for (const workshop of open.splice(0)) await workshop.stop();
  env.close();
  skills.cleanup();
});
afterAll(() => {
  for (const process of spawned) process.kill();
});

function workshop(): Workshop {
  const created = createWorkshop(ctx, { spawnHost: () => forkHost(file, spawned), timeouts: { callMs: 700, pingMs: 400, selftestMs: 5000 } });
  open.push(created);
  return created;
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

describe('yetenek yaşam döngüsü (servis)', () => {
  it('klasör → öz-sınama → onay bekler (araç yok) → onay (araç var) → kapat/aç → yeniden başlat → kaldır', async () => {
    const dir = skills.write('zar', diceSkill());
    const api = workshop();
    await api.start();
    await until(statusOf(api, 'zar'), (status) => status === 'pending_approval', 'onay bekliyor');
    expect(tools.has('skill_zar_at')).toBe(false);
    expect(await run('skill_zar_at')).toMatchObject({ ok: false });
    expect(notified.some((request) => request.dedupeKey === 'workshop.found.zar')).toBe(true);
    const detail = await api.detail('zar');
    expect(detail.selftestLog).toMatch(/Öz-sınama geçti/);
    expect(detail.files.map((entry) => entry.path)).toEqual(['manifest.json', 'index.mjs', 'selftest.mjs']);

    // Onaylanmamış yetenek açma/kapama anahtarıyla etkinleştirilemez.
    await expect(api.setEnabled('zar', true)).rejects.toThrow(/henüz onaylanmadı/);
    expect(tools.has('skill_zar_at')).toBe(false);

    expect((await api.approve('zar', true)).status).toBe('enabled');
    expect(tools.list().find((tool) => tool.name === 'skill_zar_at')).toMatchObject({ moduleId: 'skill:zar', risk: 'read' });
    const rolled = await run('skill_zar_at', { sides: 6, count: 2 });
    expect(rolled.ok).toBe(true);
    expect((rolled.data as { rolls: number[] }).rolls).toHaveLength(2);
    // Girdi çekirdeğin kapısında manifest şemasıyla doğrulanır.
    expect((await run('skill_zar_at', { sides: 1 })).ok).toBe(false);

    await api.setEnabled('zar', false);
    expect(tools.has('skill_zar_at')).toBe(false);
    await api.setEnabled('zar', true);
    expect(tools.has('skill_zar_at')).toBe(true);

    await api.stop();
    expect(tools.has('skill_zar_at')).toBe(false);
    const second = workshop();
    await second.start();
    expect(await statusOf(second, 'zar')()).toBe('enabled');
    expect((await run('skill_zar_at')).ok).toBe(true);

    await second.remove('zar');
    expect(fs.existsSync(dir)).toBe(false);
    expect(tools.has('skill_zar_at')).toBe(false);
    expect(await second.list()).toEqual([]);
  }, 30_000);

  it('bozuk manifest, yasak kod ve tutmayan öz-sınama onaya düşmez; sağlam yetenek etkilenmez', async () => {
    skills.write('zar', diceSkill());
    skills.write('bozuk', { 'manifest.json': '{ "id": "bozuk", ', 'index.mjs': 'export const tools = {};', 'selftest.mjs': 'export default async function () {}' });
    const evil = diceSkill('kotu');
    evil['index.mjs'] = `const fs = await import('node:fs');\n${evil['index.mjs']}`;
    skills.write('kotu', evil);
    const flaky = diceSkill('tutmaz');
    flaky['selftest.mjs'] = `export default async function ({ tools, assert }) {\n  const result = await tools.skill_tutmaz_at({});\n  assert.equal(result.data.rolls.length, 99, 'zar sayısı');\n}\n`;
    skills.write('tutmaz', flaky);
    skills.write('eksik', { 'manifest.json': diceSkill('eksik')['manifest.json']! });

    const api = workshop();
    await api.start();
    const list = await until(
      () => api.list(),
      (items) => items.length === 5 && items.every((skill) => skill.status !== 'testing' && skill.status !== 'building'),
      'bütün yetenekler değerlendirildi',
      20_000,
    );
    const by = (id: string) => list.find((skill) => skill.id === id) as SkillInfo;
    expect(by('zar').status).toBe('pending_approval');
    expect(by('bozuk').status).toBe('failed');
    expect(by('bozuk').lastError).toMatch(/geçerli JSON değil/);
    expect(by('kotu').status).toBe('failed');
    expect(by('kotu').lastError).toMatch(/index\.mjs satır 1: Dinamik import\(\) yasak/);
    expect(by('tutmaz').status).toBe('failed');
    expect(by('tutmaz').lastError).toMatch(/Öz-sınama geçmedi: .*zar sayısı/);
    expect(by('eksik').status).toBe('failed');
    expect(by('eksik').lastError).toMatch(/index\.mjs yok/);

    for (const id of ['bozuk', 'kotu', 'tutmaz', 'eksik']) await expect(api.approve(id, true)).rejects.toThrow();
    expect(tools.list().filter((tool) => tool.moduleId.startsWith('skill:'))).toEqual([]);
    await api.approve('zar', true);
    expect((await run('skill_zar_at')).ok).toBe(true);
  }, 40_000);

  it('onaydan sonra dosya değişirse yetenek kapanır ve yeniden onaya düşer', async () => {
    const dir = skills.write('zar', diceSkill());
    const api = workshop();
    await api.start();
    await until(statusOf(api, 'zar'), (status) => status === 'pending_approval', 'onay bekliyor');
    await api.approve('zar', true);
    expect(tools.has('skill_zar_at')).toBe(true);

    fs.appendFileSync(path.join(dir, 'index.mjs'), '\n// sonradan eklenen satır\n');
    await until(statusOf(api, 'zar'), (status) => status === 'pending_approval', 'yeniden onay bekliyor');
    expect(tools.has('skill_zar_at')).toBe(false);
    const status = await api.status(false);
    expect(status.skills.zar).toMatchObject({ approved: false });
  }, 30_000);

  it('sonsuz döngülü araç zaman aşımına düşer; diğer yetenek çalışmayı sürdürür; üç kezde kapatılır', async () => {
    skills.write('zar', diceSkill());
    const loop = diceSkill('dongu');
    loop['index.mjs'] = `export const tools = {\n  async skill_dongu_at(input) {\n    if (input.count === 7) { for (;;) {} }\n    return { ok: true, text: 'tamam', data: { rolls: [1, 2, 3], sides: 6 } };\n  },\n};\n`;
    skills.write('dongu', loop);
    const api = workshop();
    await api.start();
    await until(() => api.list(), (items) => items.length === 2 && items.every((skill) => skill.status === 'pending_approval'), 'ikisi de hazır', 20_000);
    await api.approve('zar', true);
    await api.approve('dongu', true);

    for (let attempt = 1; attempt <= 3; attempt++) {
      const stuck = await run('skill_dongu_at', { count: 7 });
      expect(stuck).toMatchObject({ ok: false });
      expect(stuck.text).toMatch(/zamanında yanıt vermedi/);
      expect((await run('skill_zar_at')).ok).toBe(true);
    }
    await until(statusOf(api, 'dongu'), (status) => status === 'failed', 'üç zaman aşımından sonra kapatıldı');
    expect(tools.has('skill_dongu_at')).toBe(false);
    expect((await api.list()).find((skill) => skill.id === 'dongu')?.lastError).toMatch(/Üç kez zaman aşımına/);
    expect((await run('skill_zar_at')).ok).toBe(true);
  }, 60_000);
});

// ───────────────────────────── yapım ─────────────────────────────

const write = (name: string, content: string) => ({ type: 'tool_use' as const, name: 'ws_write_file', input: { path: name, content } });
const call = (name: string, input: unknown = {}) => ({ type: 'tool_use' as const, name, input });

const unit = (() => {
  const files = diceSkill('birim');
  const manifest = JSON.parse(files['manifest.json']!) as { name: string; description: string; tools: Array<{ description: string }> };
  manifest.name = 'Birim çevirici';
  manifest.description = 'Kilometreyi mile çevirir; ağ gerektirmez.';
  manifest.tools[0]!.description = 'Kilometreyi mile çevirir. Kullanıcı "kaç mil eder" dediğinde kullan.';
  const good = `export const tools = {\n  async skill_birim_at(input) {\n    const km = input.count ?? 1;\n    return { ok: true, text: km + ' km = ' + (km * 0.621371).toFixed(2) + ' mil.', data: { rolls: [km * 0.621371], sides: 6 } };\n  },\n};\n`;
  const selftest = `export default async function ({ tools, assert }) {\n  const result = await tools.skill_birim_at({ count: 10 });\n  assert(Math.abs(result.data.rolls[0] - 6.21371) < 1e-6, 'on kilometre 6,21 mil etmeli');\n}\n`;
  return { manifest: JSON.stringify(manifest), good, bad: good.replace('0.621371).toFixed', '1.609).toFixed').replace('km * 0.621371]', 'km * 1.609]'), selftest };
})();

describe('yetenek yapımı (skill_build)', () => {
  it('sahte modelle: yazar → sınar (tutmaz) → düzeltir → sınar → bitirir → onay kartı → onay → araç çağrılır', async () => {
    script.push(
      { blocks: [{ type: 'text', text: 'tamam' }] }, // bulut yoklaması
      { blocks: [write('manifest.json', unit.manifest), write('index.mjs', unit.bad), write('selftest.mjs', unit.selftest)] },
      { blocks: [call('ws_validate')] },
      { blocks: [call('ws_run_selftest')] },
      { blocks: [write('index.mjs', unit.good)] },
      { blocks: [call('ws_run_selftest')] },
      { blocks: [call('ws_finish', { summary: 'Kilometreyi mile çevirir; hesap yerelde yapılır.' })] },
      { blocks: [{ type: 'text', text: 'Yetenek hazır.' }] },
    );
    const api = workshop();
    await api.start();
    const job = await api.build('Kilometreyi mile çeviren bir yetenek geliştir', ui);
    const building = await api.status(false);
    expect(building.builds).toHaveLength(1);
    expect((await api.list())[0]).toMatchObject({ status: 'building', jobId: job.id });

    const done = await ctx.jobs.wait(job.id);
    expect(done).toMatchObject({ status: 'done' });
    expect(done.resultText).toMatch(/“Birim çevirici” yeteneği hazır; onayınızı bekliyor/);

    // Modele yalnız beş Atölye aracı ve web araması verilir; kayıtlı araçlar verilmez.
    const buildCall = client.calls[1]!.params as { tools: Array<{ name: string }>; system: Array<{ text: string }> };
    expect(buildCall.tools.map((tool) => tool.name).sort()).toEqual(['web_fetch', 'web_search', 'ws_finish', 'ws_read_file', 'ws_run_selftest', 'ws_validate', 'ws_write_file']);
    expect(buildCall.system[0]!.text).toContain('skill_doviz_kuru_cevir');
    // Tutmayan öz-sınamanın çıktısı modele döner.
    const results = JSON.stringify(client.calls.map((entry) => entry.params.messages));
    expect(results).toContain('Öz-sınama GEÇMEDİ');
    expect(results).toContain('on kilometre 6,21 mil etmeli');

    const list = await api.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'birim', status: 'pending_approval', name: 'Birim çevirici' });
    expect(fs.existsSync(path.join(skills.root, 'birim', 'index.mjs'))).toBe(true);
    expect(fs.readdirSync(path.join(skills.root, '.drafts'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(skills.root, 'birim', 'manifest.json'), 'utf8'))).toMatchObject({ createdBy: 'workshop' });
    expect(tools.has('skill_birim_at')).toBe(false);

    // Ada onay kartı: çekirdeğin onay akışından geçer.
    const card = await until(() => approvals.find((request) => request.toolName === 'skill_approve'), (request) => request !== undefined, 'onay kartı');
    expect(card!.summary).toMatch(/Yeni eklenti hazır: Birim çevirici\..*Özel izin istemiyor.*Etkinleştireyim mi\?/);
    expect(tools.resolveApproval(card!.id, 'approved', 'ui')).toBe(true);
    await until(statusOf(api, 'birim'), (status) => status === 'enabled', 'onaydan sonra etkin');
    expect((await run('skill_birim_at', { count: 10 })).text).toBe('10 km = 6.21 mil.');
  }, 40_000);

  it('adadaki onay reddedilirse yetenek kapalı kalır; acil durdurma ret sayılmaz', async () => {
    const finish = [
      { blocks: [write('manifest.json', unit.manifest), write('index.mjs', unit.good), write('selftest.mjs', unit.selftest)] },
      { blocks: [call('ws_finish', { summary: 'Kilometreyi mile çevirir; hesap yerelde yapılır.' })] },
      { blocks: [{ type: 'text' as const, text: 'Bitti.' }] },
    ];
    script.push({ blocks: [{ type: 'text', text: 'tamam' }] }, ...finish);
    const api = workshop();
    await api.start();
    await ctx.jobs.wait((await api.build('Kilometreyi mile çeviren bir yetenek geliştir', ui)).id);
    const card = await until(() => approvals.find((request) => request.toolName === 'skill_approve'), (request) => request !== undefined, 'onay kartı');

    tools.cancelAll(); // acil durdurma bekleyen onayları kapatır
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await statusOf(api, 'birim')()).toBe('pending_approval');

    const asked = api.requestApproval('birim', ui);
    const second = await until(() => approvals.find((request) => request.id !== card!.id), (request) => request !== undefined, 'ikinci onay kartı');
    tools.resolveApproval(second!.id, 'denied', 'voice');
    expect(await asked).toBe('denied');
    expect(await statusOf(api, 'birim')()).toBe('disabled');
    expect(tools.has('skill_birim_at')).toBe(false);
  }, 40_000);

  it('bulut yokken dürüst sonuç verir ve iş başlatmaz', async () => {
    const api = workshop();
    await api.start();
    policy.set({ keys: {} });
    await expect(api.build('Döviz kurunu söyleyen bir yetenek geliştir', ui)).rejects.toThrow(/derin beynim gerekiyor/);
    expect((await api.status(true)).cloud).toMatchObject({ ok: false });

    // Anahtar var ama hesapta kredi yok: yoklama gerçek hatayı görür.
    policy.set({ keys: { anthropic: 'test-key' } });
    script.push({ blocks: [], error: apiError(400, 'Your credit balance is too low to access the Anthropic API.') });
    await expect(api.build('Döviz kurunu söyleyen bir yetenek geliştir', ui)).rejects.toThrow(/derin beynim gerekiyor.*ödeme sorunu/);
    expect(await api.list()).toEqual([]);
    expect(ctx.jobs.list()).toEqual([]);
  }, 20_000);

  it('model teslim etmeden durursa iş başarısız biter ve neden kullanıcıya gider', async () => {
    script.push(
      { blocks: [{ type: 'text', text: 'tamam' }] },
      { blocks: [{ type: 'text', text: 'Bu istek mikrofona erişim gerektiriyor; yetenekler mikrofonu kullanamaz. En yakın seçenek yazılı not almak olurdu.' }] },
    );
    const api = workshop();
    await api.start();
    const job = await ctx.jobs.wait((await api.build('Sesimi kaydedip model eğiten bir yetenek geliştir', ui)).id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Yetenek geliştirilemedi\. Bu istek mikrofona erişim gerektiriyor/);
    expect(await api.list()).toEqual([]);
    expect(notified.at(-1)?.title).toBe('Yetenek geliştirilemedi');
  }, 20_000);

  it('yol kaçışını ve yasak kodu dosya araçlarında reddeder; yarım taslak "hatalı" görünür ve kaldırılabilir', async () => {
    script.push(
      { blocks: [{ type: 'text', text: 'tamam' }] },
      { blocks: [write('../../kacak.txt', 'x'), write('C:\\Windows\\Temp\\x.mjs', 'x'), write('index.js', 'x')] },
      { blocks: [write('manifest.json', unit.manifest), write('index.mjs', `import fs from 'node:fs';\n${unit.good}`), write('selftest.mjs', unit.selftest)] },
      { blocks: [call('ws_finish', { summary: 'Kilometreyi mile çevirir; hesap yerelde yapılır.' })] },
      { blocks: [{ type: 'text', text: 'Olmadı.' }] },
    );
    const api = workshop();
    await api.start();
    const job = await ctx.jobs.wait((await api.build('Kilometreyi mile çeviren bir yetenek geliştir', ui)).id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/Son sorun: .*İçe aktarım yasak/s);
    const results = JSON.stringify(client.calls.map((entry) => entry.params.messages));
    expect(results).toMatch(/Yalnız şu dosyalar yazılabilir/);
    expect(fs.existsSync(path.join(skills.root, '..', 'kacak.txt'))).toBe(false);
    expect(fs.existsSync(path.join(skills.root, 'birim'))).toBe(false);

    const [draft] = await api.list();
    expect(draft).toMatchObject({ status: 'failed' });
    expect((await api.source(draft!.id, 'index.mjs')).content).toContain("import fs from 'node:fs'");
    await expect(api.source(draft!.id, '../../../x')).rejects.toThrow();
    await expect(api.approve(draft!.id, true)).rejects.toThrow();
    await api.remove(draft!.id);
    expect(fs.readdirSync(path.join(skills.root, '.drafts'))).toEqual([]);
  }, 30_000);
});
