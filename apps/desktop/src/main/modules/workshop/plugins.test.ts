// Eklenti platformu uçtan uca (Electron'suz): gerçek Atölye servisi, gerçek konak (Node çocuk süreci), gerçek araç kaydı
// ve iş servisi; Claude Code yerine sahte CLI. Üç örnek eklenti (pano kartı, zamanlanmış iş + sesli duyuru, sayfa)
// gerçekten üretilir, onaylanır ve katkıları çalışır; güncelleme, geri alma ve çekirdek geliştirmeye yükseltme sınanır.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dashboard,
  defineTool,
  type ApprovalRequest,
  type AttentionApi,
  type Bus,
  type DashboardCustomContent,
  type ModuleContext,
  type Notification,
  type NotifyRequest,
  type Paths,
  type StageApi,
  type ToolContext,
  type ToolOrigin,
  type ToolRegistry,
} from '@fuber/shared';
import { z } from 'zod';
import { createBrain } from '../../core/brain';
import { createDeepBrain, type DeepBrainService } from '../../core/brain/deep';
import { matchSpokenRoute } from '../../core/brain/spoken-routes';
import { fakeClient, fakePolicy, fakePresence, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import { fakeCli } from '../../core/claude-cli/testkit';
import { createJobs } from '../../core/jobs';
import { createMemory } from '../../core/memory';
import { checkSelfChange } from '../../core/self-change-guard';
import { createTools } from '../../core/tools';
import { createUsage } from '../../core/usage';
import { createBridge, resolvePluginPath } from './bridge';
import type { HostProcess } from './host';
import { parseManifest } from './manifest';
import { PAGE_CSP } from './page';
import { describeChanges, describeSchedule, widensPermissions } from './preview';
import { dailyDue, nextDaily, sanitizeCardContent } from './runtime';
import { createWorkshop, type Workshop } from './service';
import { createWorkshopStore, WORKSHOP_MIGRATIONS } from './store';
import { diceSkill, forkHost, hostBundle, tempSkills } from './testkit';
import { parsePluginPageRoute, pluginPageRoute, type WorkshopManifest } from './types';

const ui = { channel: 'ui' as const, speakerVerified: null };
let file: string;
const spawned: HostProcess[] = [];

let env: ReturnType<typeof tempStore>;
let skills: ReturnType<typeof tempSkills>;
let folders: string;
let bus: Bus;
let tools: ToolRegistry;
let ctx: ModuleContext;
let notified: NotifyRequest[];
let approvals: ApprovalRequest[];
let reminders: unknown[];
let fetched: string[];
const open: Workshop[] = [];
const deeps: DeepBrainService[] = [];

beforeAll(async () => {
  file = await hostBundle();
}, 30_000);

beforeEach(() => {
  env = tempStore();
  skills = tempSkills();
  folders = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-folders-'));
  bus = testBus();
  const policy = fakePolicy({ keys: {} });
  notified = [];
  approvals = [];
  reminders = [];
  fetched = [];
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
  const brain = createBrain({ policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog }, { clientFactory: () => fakeClient([]), localServer: null });
  env.store.migrate('workshop', WORKSHOP_MIGRATIONS);
  ctx = moduleContext(
    'workshop',
    { bus, tools, policy, brain, attention, stage, usage, jobs: createJobs({ store: env.store, bus, log: silentLog }), paths: { skills: skills.root } as Paths },
    env.store,
  );
  bus.on('tool.approval.request', (request) => approvals.push(request));

  // Eklentilerin çağırdığı Jarvis araçlarının sahteleri (gerçekleri web ve planner modüllerindedir).
  const host = moduleContext('web', { bus, tools, policy }, env.store);
  tools.register(host, [
    defineTool({
      name: 'fx_rate',
      description: 'Sınama: sabit kur.',
      input: z.object({ from: z.string(), to: z.string() }),
      risk: 'read',
      run: async ({ from }) => ({ ok: true, text: 'kur', data: { rate: from === 'USD' ? 41.5 : 48.25 } }),
    }),
    defineTool({
      name: 'reminder_create',
      description: 'Sınama: hatırlatıcı kaydı.',
      input: z.object({ text: z.string(), due_at: z.string().optional(), after_seconds: z.number().optional() }),
      risk: 'write',
      run: async (input) => {
        reminders.push(input);
        return { ok: true, text: 'kuruldu' };
      },
    }),
    defineTool({
      name: 'pc_type',
      description: 'Sınama: klavyeyle yazı yazan araç.',
      input: z.object({ text: z.string().optional() }),
      risk: 'write',
      run: async () => ({ ok: true, text: 'yazıldı' }),
    }),
    defineTool({
      name: 'file_delete',
      description: 'Sınama: onay isteyen araç.',
      input: z.object({}),
      risk: 'danger',
      run: async () => ({ ok: true, text: 'silindi' }),
    }),
  ]);
});

afterEach(async () => {
  for (const workshop of open.splice(0)) await workshop.stop();
  for (const deep of deeps.splice(0)) deep.dispose();
  env.close();
  skills.cleanup();
  await fs.promises.rm(folders, { recursive: true, force: true }).catch(() => {});
});
afterAll(() => {
  for (const process of spawned) process.kill();
});

function workshop(): Workshop {
  const deep = createDeepBrain(ctx, { cli: fakeCli() });
  deeps.push(deep);
  const api = createWorkshop(ctx, {
    spawnHost: () => forkHost(file, spawned),
    timeouts: { callMs: 3000, pingMs: 600, selftestMs: 8000 },
    deep,
    pluginTickMs: 0,
    userFolders: { belgeler: path.join(folders, 'Belgeler'), masaustu: path.join(folders, 'Masaustu'), indirilenler: path.join(folders, 'Indirilenler') },
    lookup: async () => [{ address: '93.184.215.14', family: 4 }],
    transport: async (request) => {
      fetched.push(request.url.toString());
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { base: 'BTC', currency: 'USD', amount: '67250.10' } }), truncated: false };
    },
  });
  open.push(api);
  return api;
}

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, what: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`zaman aşımı: ${what} (son değer: ${JSON.stringify(value)})`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

const statusOf = (api: Workshop, id: string) => async () => (await api.list()).find((skill) => skill.id === id)?.status ?? null;

/** Sahte CLI ile eklentiyi üretir, onay kartını bekler ve döndürür (henüz onaylanmamış). */
async function build(api: Workshop, goal: string, id: string) {
  const job = await api.build(goal, ui);
  const done = await ctx.jobs.wait(job.id);
  expect(done.status, done.error ?? '').toBe('done');
  await until(statusOf(api, id), (status) => status === 'pending_approval', `${id} onay bekliyor`);
  return until(
    () => approvals.find((request) => request.toolName === 'skill_approve' && (request.input as { id?: string }).id === id),
    (request) => request !== undefined,
    'onay kartı',
  );
}

async function approve(api: Workshop, card: ApprovalRequest | undefined, id: string) {
  expect(tools.resolveApproval(card!.id, 'approved', 'ui')).toBe(true);
  await until(statusOf(api, id), (status) => status === 'enabled', `${id} etkin`);
}

describe('üç örnek eklenti sahte Claude Code ile üretilir ve katkıları çalışır', () => {
  it('pano kartı: BTC fiyatı (ağ izni onayda görünür; kart panoya düşer; aynı araç konuşurken de çağrılır)', async () => {
    const api = workshop();
    await api.start();
    const card = await build(api, 'Bugün panosuna BTC fiyatını gösteren bir kart ekle [[sahte:eklenti|btc_fiyat]]', 'btc_fiyat');
    expect(card!.summary).toContain('Yeni eklenti hazır: BTC fiyatı.');
    expect(card!.summary).toContain('Bugün panosuna "BTC fiyatı" kartı (5 dakikada bir yenilenir)');
    expect(card!.summary).toContain('İnternet: yalnız api.coinbase.com');
    const preview = await api.preview('btc_fiyat');
    expect(preview).toMatchObject({ tools: 1, hosts: ['api.coinbase.com'], staged: false });
    expect(preview.cards).toHaveLength(1);

    // Onaydan önce: araç yok, kart yok, ağa çıkılmadı.
    expect(tools.has('skill_btc_fiyat_getir')).toBe(false);
    expect(dashboard.providers().some((provider) => provider.id === 'plugin.btc_fiyat.fiyat')).toBe(false);
    expect(fetched).toEqual([]);

    await approve(api, card, 'btc_fiyat');
    await api.plugins.tick();
    const provider = dashboard.providers().find((entry) => entry.id === 'plugin.btc_fiyat.fiyat');
    expect(provider).toMatchObject({ kind: 'custom.metric', title: 'BTC fiyatı', defaultSize: 'small' });
    const fill = provider!.fill({ now: new Date(), today: '2026-11-17' as never });
    expect(fill?.data).toEqual({ template: 'metric', value: '67.250', unit: 'USD', label: 'Bitcoin', trend: 'flat' } satisfies DashboardCustomContent);
    expect(fetched).toEqual(['https://api.coinbase.com/v2/prices/BTC-USD/spot']);

    const spoken = await tools.run('skill_btc_fiyat_getir', {}, { origin: ui });
    expect(spoken).toMatchObject({ ok: true, text: 'Bitcoin şu an 67.250 dolar.' });
    const activity = await api.activity('btc_fiyat');
    expect(activity).toEqual([expect.objectContaining({ kind: 'card', id: 'fiyat', lastOk: true, schedule: '5 dakikada bir' })]);
    expect((await api.status(false)).skills.btc_fiyat?.adds).toMatchObject({ tools: 1, cards: 1, jobs: 0, pages: 0 });

    // Kapatınca kart panodan kalkar.
    await api.setEnabled('btc_fiyat', false);
    expect(dashboard.providers().some((entry) => entry.id === 'plugin.btc_fiyat.fiyat')).toBe(false);
  }, 40_000);

  it('zamanlanmış iş + sesli duyuru: her sabah dokuzda döviz (Jarvis aracını çağırır; ayar değişince sonuç değişir)', async () => {
    const api = workshop();
    await api.start();
    const card = await build(api, 'Her sabah dokuzda dolar ve euro kurunu sesli söyle [[sahte:eklenti|sabah_doviz]]', 'sabah_doviz');
    expect(card!.summary).toContain('"Sabah döviz özeti" işi: her gün 09:00, sesli söyler');
    expect(card!.summary).toContain('Şu araçlarımı çağırabilir: fx_rate');
    expect(card!.summary).toContain('Sesli duyuru yapabilir');
    await approve(api, card, 'sabah_doviz');

    // Vakti gelmeden yoklama iş koşturmaz.
    await api.plugins.tick();
    expect(notified.filter((request) => request.moduleId === 'skill:sabah_doviz')).toEqual([]);

    const ran = await api.runNow('sabah_doviz', 'job', 'sabah');
    expect(ran).toMatchObject({ ok: true });
    const spoken = notified.find((request) => request.moduleId === 'skill:sabah_doviz');
    expect(spoken).toMatchObject({ priority: 'high', title: 'Sabah döviz: Sabah döviz özeti' });
    expect(spoken!.speak).toBe('Günaydın. Dolar 41,50 TRY, Euro 48,25 TRY.');

    expect(await api.settings('sabah_doviz')).toEqual([expect.objectContaining({ key: 'hedef', value: 'TRY', options: ['TRY', 'USD', 'EUR'] })]);
    await expect(api.setSetting('sabah_doviz', 'hedef', 'JPY')).rejects.toThrow(/seçeneklerden biri/);
    await api.setSetting('sabah_doviz', 'hedef', 'USD');
    const again = await tools.run('skill_sabah_doviz_ozet', {}, { origin: ui });
    expect(again.text).toBe('Günaydın. Euro 48,25 USD.');
    const [state] = await api.activity('sabah_doviz');
    expect(state).toMatchObject({ kind: 'job', schedule: 'her gün 09:00', announce: 'speak', lastOk: true });
    expect(state!.nextRunAt).not.toBeNull();
  }, 40_000);

  it('sayfa (mini uygulama): pomodoro (güvenli belge, sayfa köprüsü, depo, ayar, sesli kalıp)', async () => {
    const api = workshop();
    await api.start();
    const card = await build(api, 'Pomodoro sayacı sayfası yap [[sahte:eklenti|pomodoro]]', 'pomodoro');
    expect(card!.summary).toContain('Yan menüye "Pomodoro" sayfası (güvenli kutuda çalışır)');
    expect(card!.summary).toContain('Sesli komut: "pomodoro başlat"');
    expect(await api.pages()).toEqual([]);
    expect(matchSpokenRoute('Pomodoro başlat')).toBeNull();
    await approve(api, card, 'pomodoro');

    expect(await api.pages()).toEqual([{ skillId: 'pomodoro', skillName: 'Pomodoro', pageId: 'sayac', title: 'Pomodoro', icon: 'timer' }]);
    const page = await api.page('pomodoro', 'sayac');
    expect(page.title).toBe('Pomodoro');
    expect(page.html).toContain(`content="${PAGE_CSP}"`);
    // Politika ve köprü eklentinin içeriğinden ÖNCE gelir.
    expect(page.html.indexOf('Content-Security-Policy')).toBeLessThan(page.html.indexOf('id="time"'));
    expect(page.html.indexOf("defineProperty(window, 'fuber'")).toBeLessThan(page.html.indexOf('id="time"'));

    // Sayfadaki "Başlat" düğmesi: kendi eklentisinin aracı çağrılır, durum depoya yazılır, hatırlatıcı kurulur.
    const started = await api.pageCall('pomodoro', 'sayac', 'skill_pomodoro_baslat', {});
    expect(started).toMatchObject({ ok: true, text: '25 dakikalık pomodoro başladı.' });
    expect(reminders).toEqual([{ text: 'Pomodoro: Pomodoro bitti, mola zamanı.', after_seconds: 1500 }]);
    expect((await api.pageStorage('pomodoro', 'get', 'sayac')).found).toBe(true);
    await expect(api.pageCall('pomodoro', 'sayac', 'skill_baska_arac', {})).rejects.toThrow(/bilinmeyen bir araç/);
    await expect(api.pageCall('pomodoro', 'sayac', 'skill_pomodoro_baslat', { minutes: 'çok' })).rejects.toThrow(/girdi geçersiz/);
    await expect(api.pageCall('pomodoro', 'yok', 'skill_pomodoro_durum', {})).rejects.toThrow(/bulunamadı/);

    await api.setSetting('pomodoro', 'sure', 10);
    expect(await api.pageCall('pomodoro', 'sayac', 'skill_pomodoro_baslat', {})).toMatchObject({ text: '10 dakikalık pomodoro başladı.' });

    // Sesli kalıp: kesin söz araca gider; benzer ama farklı cümle modele kalır.
    expect(matchSpokenRoute('Jarvis, pomodoroyu başlat lütfen')).toEqual({ name: 'skill_pomodoro_baslat', input: {} });
    expect(matchSpokenRoute('pomodoro başlatmayı unutma')).toBeNull();

    // Kaldırınca sayfa, kalıp ve depo gider.
    await api.remove('pomodoro');
    expect(await api.pages()).toEqual([]);
    expect(matchSpokenRoute('pomodoro başlat')).toBeNull();
  }, 40_000);
});

describe('sürümleme: güncelleme ("şunu da ekle"), onay, geri alma', () => {
  it('güncelleme onaya dek uygulanmaz; onayla sürüm 2 olur; geri alınca sürüm 1 döner; ileri de alınabilir', async () => {
    const api = workshop();
    await api.start();
    const card = await build(api, 'Zar atan bir yetenek [[sahte:yetenek|zar_surum]]', 'zar_surum');
    await approve(api, card, 'zar_surum');
    expect((await api.versions('zar_surum')).map((entry) => [entry.version, entry.current])).toEqual([[1, true]]);

    const job = await api.update('zar_surum', 'Sürümünü de söyleyebilsin [[sahte:guncelle]]', ui);
    const done = await ctx.jobs.wait(job.id);
    expect(done.status, done.error ?? '').toBe('done');
    expect(done.resultText).toMatch(/güncellemesi hazır \(sürüm 2\)/);

    // Eski sürüm çalışmayı sürdürür; yeni araç henüz yok.
    expect((await api.status(false)).skills.zar_surum).toMatchObject({ update: { version: 2 }, approved: true });
    expect((await tools.run('skill_zar_surum_at', { sides: 6, count: 1 }, { origin: ui })).ok).toBe(true);
    expect(tools.has('skill_zar_surum_surum')).toBe(false);
    expect(fs.existsSync(path.join(skills.root, '.staged', 'zar_surum', 'manifest.json'))).toBe(true);
    const staged = await api.preview('zar_surum', true);
    expect(staged).toMatchObject({ staged: true, version: 2, tools: 2 });
    expect(staged.changes).toEqual(['1 yeni araç']);

    const prompt = await until(
      () => approvals.find((request) => request.toolName === 'skill_update_approve'),
      (request) => request !== undefined,
      'güncelleme onayı',
    );
    expect(prompt!.summary).toMatch(/güncellemesi hazır \(sürüm 2\)\. Değişenler: 1 yeni araç\. Uygulayayım mı\?/);

    await api.approveUpdate('zar_surum', true);
    expect((await api.list()).find((skill) => skill.id === 'zar_surum')).toMatchObject({ version: 2, status: 'enabled' });
    expect((await tools.run('skill_zar_surum_surum', {}, { origin: ui })).text).toBe('Sürüm iki.');
    expect(JSON.parse(fs.readFileSync(path.join(skills.root, 'zar_surum', 'manifest.json'), 'utf8')).version).toBe(2);
    expect(fs.existsSync(path.join(skills.root, '.staged', 'zar_surum'))).toBe(false);
    expect((await api.versions('zar_surum')).map((entry) => [entry.version, entry.current])).toEqual([
      [2, true],
      [1, false],
    ]);

    // Geri alma: önceki sürüm (kullanıcının daha önce onayladığı içerik) yeniden onay istemeden döner.
    const back = await api.rollback('zar_surum');
    expect(back).toMatchObject({ version: 1, status: 'enabled' });
    expect(tools.has('skill_zar_surum_surum')).toBe(false);
    expect((await tools.run('skill_zar_surum_at', {}, { origin: ui })).ok).toBe(true);
    await expect(api.rollback('zar_surum')).rejects.toThrow(/daha eski bir sürüm yok/);

    // Saklanan sürüm kurcalanmışsa geri alınmaz (özet veritabanında durur).
    const forward = await api.rollback('zar_surum', 2);
    expect(forward).toMatchObject({ version: 2 });
    fs.appendFileSync(path.join(skills.root, '.versions', 'zar_surum', '1', 'index.mjs'), '\n// kurcalandı\n');
    await expect(api.rollback('zar_surum', 1)).rejects.toThrow(/onaylandığı andaki içerik değil/);
    expect((await api.list()).find((skill) => skill.id === 'zar_surum')).toMatchObject({ version: 2, status: 'enabled' });
  }, 60_000);

  it('yeni izin isteyen güncelleme onayda ayrıca vurgulanır; reddedilirse eski sürüm kalır', async () => {
    const api = workshop();
    await api.start();
    const card = await build(api, 'Zar atan bir yetenek [[sahte:yetenek|zar_izin]]', 'zar_izin');
    await approve(api, card, 'zar_izin');
    const job = await api.update('zar_izin', 'İnternetten de zar atsın [[sahte:guncelle|izin|api.zar-e2e.example]]', ui);
    expect((await ctx.jobs.wait(job.id)).status).toBe('done');
    const prompt = await until(
      () => approvals.find((request) => request.toolName === 'skill_update_approve'),
      (request) => request !== undefined,
      'güncelleme onayı',
    );
    expect(prompt!.summary).toContain('YENİ İZİN istiyor');
    expect(prompt!.summary).toContain('YENİ İZİN: şu adreslere de bağlanacak: api.zar-e2e.example');
    expect(prompt!.input).toMatchObject({ widensPermissions: true });

    expect(tools.resolveApproval(prompt!.id, 'denied', 'ui')).toBe(true);
    await until(
      async () => (await api.status(false)).skills.zar_izin?.update,
      (update) => update === undefined,
      'güncelleme atıldı',
    );
    expect((await api.list()).find((skill) => skill.id === 'zar_izin')).toMatchObject({ version: 1, status: 'enabled' });
    expect(fs.existsSync(path.join(skills.root, '.staged', 'zar_izin'))).toBe(false);
  }, 60_000);
});

describe('çekirdek geliştirmeye yükseltme', () => {
  it('eklentiyle yapılamayan istek dürüstçe biter ve yalnız kullanıcının isteğinde çekirdek katmanına haber verilir', async () => {
    const api = workshop();
    await api.start();
    const escalated: Array<{ request: string; reason: string; origin: ToolOrigin }> = [];
    bus.on('selfdev.escalate', (event) => escalated.push(event));

    const job = await api.build('Adanın rengini mor yap [[sahte:cekirdek-gerek]]', { channel: 'voice', speakerVerified: null });
    const done = await ctx.jobs.wait(job.id);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('Bu istek eklentiyle yapılamıyor');
    expect(done.error).toContain('çekirdek geliştirme');
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({ request: 'Adanın rengini mor yap [[sahte:cekirdek-gerek]]', origin: { channel: 'voice' } });
    expect(escalated[0]!.reason).toContain('kabuğuna aittir');
    // Taslak iz bırakmaz.
    expect((await api.list()).filter((skill) => skill.status !== 'enabled')).toEqual([]);

    // Arka plan işinden doğan yapım yükseltme yayınlamaz (dış içerik çekirdek değişikliği tetikleyemez).
    const quiet = await api.build('Adanın rengini mor yap [[sahte:cekirdek-gerek]]', { channel: 'job', speakerVerified: null });
    expect((await ctx.jobs.wait(quiet.id)).status).toBe('failed');
    expect(escalated).toHaveLength(1);
  }, 40_000);
});

describe('izin kapıları (köprü)', () => {
  const manifestOf = (extra: Record<string, unknown>): WorkshopManifest => {
    const parsed = parseManifest(JSON.stringify({ ...JSON.parse(diceSkill('kapi')['manifest.json']!), ...extra }), 'kapi');
    if (!parsed.ok) throw new Error(parsed.issues.join('\n'));
    return parsed.manifest;
  };
  const bridgeFor = (manifest: WorkshopManifest) =>
    createBridge({
      ctx,
      store: createWorkshopStore(ctx.db),
      manifestOf: () => manifest,
      userFolders: { belgeler: path.join(folders, 'Belgeler'), masaustu: path.join(folders, 'Masaustu'), indirilenler: path.join(folders, 'Indirilenler') },
    });
  const live = (method: string, params: unknown) => ({ skillId: 'kapi', mode: 'live' as const, method: method as never, params });

  it('dosyalar: yalnız bildirilen kökün içi; kök dışı, üst klasör ve bildirilmemiş kök reddedilir', async () => {
    const manifest = manifestOf({ permissions: ['fs'], fs: { roots: ['{belgeler}/Jarvis'] } });
    const bridge = bridgeFor(manifest);
    await bridge(live('files.write', { path: '{belgeler}/Jarvis/notlar/bugun.txt', text: 'merhaba' }));
    expect(fs.readFileSync(path.join(folders, 'Belgeler', 'Jarvis', 'notlar', 'bugun.txt'), 'utf8')).toBe('merhaba');
    expect(await bridge(live('files.read', { path: '{belgeler}/Jarvis/notlar/bugun.txt' }))).toEqual({ text: 'merhaba' });
    expect(await bridge(live('files.list', { path: '{belgeler}/Jarvis/notlar' }))).toEqual({ entries: [{ name: 'bugun.txt', dir: false }] });
    await expect(bridge(live('files.read', { path: '{belgeler}/Jarvis/../gizli.txt' }))).rejects.toThrow(/dışına çıkamaz/);
    await expect(bridge(live('files.read', { path: '{belgeler}/Baska/x.txt' }))).rejects.toThrow(/bildirilen dosya köklerinin dışında/);
    await expect(bridge(live('files.write', { path: '{masaustu}/Jarvis/x.txt', text: 'x' }))).rejects.toThrow(/köklerinin dışında/);
    await expect(bridge(live('files.read', { path: 'C:/Windows/win.ini' }))).rejects.toThrow(/köklerinin dışında/);
    expect(await bridge(live('files.remove', { path: '{belgeler}/Jarvis/notlar/bugun.txt' }))).toEqual({ removed: true });
    await expect(bridge(live('files.remove', { path: '{belgeler}/Jarvis/notlar' }))).rejects.toThrow(/yalnız dosya/);
    // İzin bildirmeyen eklenti hiç ulaşamaz.
    await expect(bridgeFor(manifestOf({}))(live('files.read', { path: '{belgeler}/Jarvis/a.txt' }))).rejects.toThrow(/"fs" izni gerekli/);
    expect(() => resolvePluginPath(manifest, { belgeler: 'C:/b', masaustu: 'C:/m', indirilenler: 'C:/i' }, '{belgeler}/Jarvis/a/..')).toThrow();
  });

  it('Jarvis araçları: yalnız bildirilen ad; onay isteyen araç ve kendini geliştirme araçları hiçbir koşulda', async () => {
    const bridge = bridgeFor(manifestOf({ uses: { tools: ['fx_rate', 'file_delete', 'pc_type', 'reminder_create'] } }));
    // Bildirilse bile: bilgisayarı kullanan / bir şeyi değiştiren araç eklentiye açılmaz; kısa izinli liste dışında yazma yok.
    await expect(bridge(live('tools.call', { name: 'pc_type', input: { text: 'merhaba' } }))).rejects.toThrow(/bir şeyi değiştiren bir araç/);
    expect(await bridge(live('tools.call', { name: 'reminder_create', input: { text: 'su iç', after_seconds: 60 } }))).toMatchObject({ ok: true });
    expect(await bridge(live('tools.call', { name: 'fx_rate', input: { from: 'USD', to: 'TRY' } }))).toMatchObject({ ok: true, data: { rate: 41.5 } });
    await expect(bridge(live('tools.call', { name: 'todo_add', input: { text: 'x' } }))).rejects.toThrow(/uses\.tools içinde bildirilmemiş/);
    await expect(bridge(live('tools.call', { name: 'file_delete', input: {} }))).rejects.toThrow(/onay isteyen bir araç/);
    await expect(bridge({ ...live('tools.call', { name: 'fx_rate', input: {} }), mode: 'selftest' })).rejects.toThrow(/öz-sınama sırasında Jarvis araçları kapalı/);
    // Manifest düzeyinde: kendini geliştirme zinciri bildirilemez.
    for (const name of ['skill_build', 'skill_update', 'core_develop', 'core_install']) {
      const parsed = parseManifest(JSON.stringify({ ...JSON.parse(diceSkill('kapi')['manifest.json']!), uses: { tools: [name] } }), 'kapi');
      expect(parsed.ok ? [] : parsed.issues.join(' ')).toContain('eklentilere açık değil');
    }
  });

  it('sesli duyuru: yalnız speak bildiren eklenti; kanalı Dikkat Yöneticisi seçer', async () => {
    await expect(bridgeFor(manifestOf({}))(live('speak', { text: 'merhaba' }))).rejects.toThrow(/"speak": true gerekli/);
    await bridgeFor(manifestOf({ speak: true }))(live('speak', { text: 'Toplantı beş dakika sonra.' }));
    expect(notified.at(-1)).toMatchObject({ moduleId: 'skill:kapi', priority: 'high', speak: 'Toplantı beş dakika sonra.' });
  });
});

describe('manifest: katkılar', () => {
  const base = () => JSON.parse(diceSkill('kat')['manifest.json']!) as Record<string, unknown>;
  const issues = (extra: Record<string, unknown>) => {
    const parsed = parseManifest(JSON.stringify({ ...base(), ...extra }), 'kat');
    return parsed.ok ? '' : parsed.issues.join('\n');
  };

  it('katkının aracı manifestte olmalı; kart ve takip yalnız okur; duyuru izni bildirilmeli', () => {
    expect(issues({ cards: [{ id: 'k', title: 'Kart', template: 'metric', tool: 'skill_kat_yok' }] })).toContain('manifestteki tools içinde yok');
    expect(issues({ cards: [{ id: 'k', title: 'Kart', template: 'metric', tool: 'skill_kat_at' }] })).toBe('');
    expect(issues({ jobs: [{ id: 'j', title: 'İş başlığı', tool: 'skill_kat_at', schedule: { daily: '9:00' } }] })).toContain('"SS:DD" biçiminde');
    expect(issues({ jobs: [{ id: 'j', title: 'İş başlığı', tool: 'skill_kat_at', schedule: { daily: '09:00' }, announce: 'speak' }] })).toContain('"speak": true gerekli');
    expect(issues({ jobs: [{ id: 'j', title: 'İş başlığı', tool: 'skill_kat_at', schedule: { daily: '09:00' } }] })).toContain('permissions içinde "notify" gerekli');
    expect(issues({ jobs: [{ id: 'j', title: 'İş başlığı', tool: 'skill_kat_at', schedule: { on: 'disk.full' }, announce: 'silent' }] })).toContain('bilinmiyor');
    expect(issues({ jobs: [{ id: 'j', title: 'İş başlığı', tool: 'skill_kat_at', schedule: { everyMinutes: 0 }, announce: 'silent' }] })).toContain('dakika arasında');
    expect(issues({ speak: true, jobs: [{ id: 'j', title: 'İş başlığı', tool: 'skill_kat_at', schedule: { everyMinutes: 10 }, announce: 'speak' }] })).toBe('');
    expect(issues({ pages: [{ id: 's', title: 'Sayfa', file: '../page.html' }] })).toContain('"page.html" ya da "page_<ad>.html"');
    expect(issues({ fs: { roots: ['{belgeler}'] }, permissions: ['fs'] })).toContain('fs.roots');
    expect(issues({ fs: { roots: ['C:/Users'] }, permissions: ['fs'] })).toContain('fs.roots');
    expect(issues({ fs: { roots: ['{belgeler}/Jarvis'] }, permissions: ['fs'] })).toBe('');
    expect(issues({ settings: [{ key: 'sure', label: 'Süre', type: 'number', default: 'yirmi' }] })).toContain('türü "number" ile uyuşmuyor');
    expect(issues({ voice: [{ phrases: ['zar at'], tool: 'skill_kat_at' }] })).toBe('');
  });

  it('gizli araç beyne sunulmaz ama öz-sınamada çağrılmak zorundadır; sesli kalıp gizli araca bağlanamaz', () => {
    const hidden = { ...base(), tools: [{ ...(base().tools as Array<Record<string, unknown>>)[0], hidden: true }] };
    const parsed = parseManifest(JSON.stringify({ ...hidden, voice: [{ phrases: ['zar at'], tool: 'skill_kat_at' }] }), 'kat');
    expect(parsed.ok ? '' : parsed.issues.join(' ')).toContain('gizli (hidden) olamaz');
  });
});

describe('saf yardımcılar', () => {
  it('kart verisi şablona indirgenir; uymayan veri kart çizdirmez', () => {
    expect(sanitizeCardContent('metric', { value: 42, unit: 'USD', trend: 'yukarı', extra: '<b>' })).toEqual({ template: 'metric', value: '42', unit: 'USD' });
    expect(sanitizeCardContent('metric', { value: '' })).toBeNull();
    expect(sanitizeCardContent('list', { items: [{ text: 'a' }, { title: 'b', done: true }, { text: '' }] })).toEqual({
      template: 'list',
      items: [{ text: 'a' }, { text: 'b', done: true }],
    });
    expect(sanitizeCardContent('progress', { value: 3 })).toEqual({ template: 'progress', value: 1 });
    expect(sanitizeCardContent('keyvalue', 'metin')).toBeNull();
  });

  it('günlük iş: vaktinde bir kez, en çok bir saat geç; kurulmadan önceki an telafi edilmez; gün süzgeci', () => {
    const at = (text: string) => new Date(text);
    const nine = { daily: '09:00' };
    expect(dailyDue(nine, null, null, at('2026-11-17T08:59:00'))).toBe(false);
    expect(dailyDue(nine, null, null, at('2026-11-17T09:00:20'))).toBe(true);
    expect(dailyDue(nine, at('2026-11-17T09:00:25').toISOString(), null, at('2026-11-17T09:01:00'))).toBe(false);
    expect(dailyDue(nine, at('2026-11-16T09:00:25').toISOString(), null, at('2026-11-17T09:40:00'))).toBe(true);
    expect(dailyDue(nine, null, null, at('2026-11-17T15:00:00'))).toBe(false);
    expect(dailyDue(nine, null, at('2026-11-17T09:30:00').toISOString(), at('2026-11-17T09:31:00'))).toBe(false);
    // 17 Kasım 2026 Salı (2): yalnız Pazartesi çalışan iş bugün çalışmaz, bir sonraki Pazartesi 23 Kasım.
    expect(dailyDue({ daily: '09:00', days: [1] }, null, null, at('2026-11-17T09:00:20'))).toBe(false);
    expect(nextDaily({ daily: '09:00', days: [1] }, at('2026-11-17T09:00:20')).getDate()).toBe(23);
    expect(describeSchedule({ daily: '09:00', days: [1, 5] })).toBe('Pazartesi, Cuma günleri 09:00');
    expect(describeSchedule({ on: 'mail.received' })).toBe('yeni e-posta gelince');
  });

  it('güncelleme farkları: yeni izin her zaman açıkça yazılır', () => {
    const before = parseManifest(diceSkill('fark')['manifest.json']!, 'fark');
    const after = parseManifest(JSON.stringify({ ...JSON.parse(diceSkill('fark')['manifest.json']!), permissions: ['net'], net: { hosts: ['api.ornek.com'] }, speak: true }), 'fark');
    if (!before.ok || !after.ok) throw new Error('manifest');
    expect(widensPermissions(after.manifest, before.manifest)).toBe(true);
    expect(widensPermissions(before.manifest, after.manifest)).toBe(false);
    expect(describeChanges(after.manifest, before.manifest)).toEqual(['YENİ İZİN: şu adreslere de bağlanacak: api.ornek.com', 'YENİ İZİN: sesli duyuru yapacak']);
    expect(describeChanges(before.manifest, before.manifest)).toEqual(['Yeni izin ya da katkı yok; yalnız davranış değişiyor']);
  });

  it('sayfa rotası', () => {
    expect(pluginPageRoute('pomodoro', 'sayac')).toBe('plugin:pomodoro:sayac');
    expect(parsePluginPageRoute('plugin:pomodoro:sayac')).toEqual({ skillId: 'pomodoro', pageId: 'sayac' });
    expect(parsePluginPageRoute('skills')).toBeNull();
    expect(parsePluginPageRoute('plugin:../x:y')).toBeNull();
  });
});

describe('kendini değiştirme kapısı', () => {
  const calls: Array<{ callId: string; name: string; moduleId: string; startedAt: string; origin: ToolOrigin }> = [];
  const context = (origin: ToolOrigin): ToolContext =>
    ({
      callId: 'bu-cagri',
      origin,
      tools: { recentCalls: () => calls },
      conversation: { messages: () => [{ role: 'user', at: new Date(Date.now() - 5000).toISOString() }] },
    }) as unknown as ToolContext;
  beforeEach(() => void calls.splice(0));

  it('arka plan işi ve eklenti kökenli istek reddedilir; tanınmayan ses reddedilir', () => {
    expect(checkSelfChange(context({ channel: 'job', speakerVerified: null }))).toMatchObject({ allow: false });
    expect(checkSelfChange(context({ channel: 'skill', speakerVerified: null }))).toMatchObject({ allow: false });
    expect(checkSelfChange(context({ channel: 'voice', speakerVerified: false }))).toMatchObject({ allow: false });
    expect(checkSelfChange(context({ channel: 'voice', speakerVerified: null }))).toEqual({ allow: true, confirm: false, why: null });
    expect(checkSelfChange(context({ channel: 'ui', speakerVerified: null }))).toEqual({ allow: true, confirm: false, why: null });
  });

  it('aynı turda dış içerik okunduysa (web, e-posta, eklenti) açık onay ister; önceki turun okuması sayılmaz', () => {
    const origin: ToolOrigin = { channel: 'voice', sessionId: 'oturum', speakerVerified: null };
    calls.push({ callId: 'a', name: 'web_read', moduleId: 'web', startedAt: new Date().toISOString(), origin });
    expect(checkSelfChange(context(origin))).toMatchObject({ allow: true, confirm: true });
    calls.splice(0);
    calls.push({ callId: 'b', name: 'skill_haber_getir', moduleId: 'skill:haber', startedAt: new Date().toISOString(), origin });
    expect(checkSelfChange(context(origin))).toMatchObject({ allow: true, confirm: true });
    calls.splice(0);
    calls.push({ callId: 'c', name: 'mail_read', moduleId: 'mail', startedAt: new Date(Date.now() - 60_000).toISOString(), origin });
    expect(checkSelfChange(context(origin))).toMatchObject({ allow: true, confirm: false });
    calls.splice(0);
    calls.push({ callId: 'd', name: 'reminder_create', moduleId: 'planner', startedAt: new Date().toISOString(), origin });
    expect(checkSelfChange(context(origin))).toMatchObject({ allow: true, confirm: false });
  });
});

describe('takip katkısı ve takip işleri için kaynak', () => {
  const newsSkill = (): Record<string, string> => ({
    'manifest.json': JSON.stringify({
      id: 'haber',
      name: 'Haberler',
      description: 'Sınama: depodaki başlıkları listeler ve yenisini haber verir.',
      version: 1,
      permissions: ['notify'],
      tools: [
        {
          name: 'skill_haber_liste',
          description: 'Başlıkları listeler. Kullanıcı "haberlerde ne var" dediğinde kullan.',
          risk: 'read',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'skill_haber_ekle',
          description: 'Sınama için bir başlık ekler. Kullanıcı "şu başlığı ekle" dediğinde kullan.',
          risk: 'write',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        },
      ],
      watches: [{ id: 'yeni', title: 'Yeni haberler', tool: 'skill_haber_liste', everyMinutes: 5, announce: 'notify' }],
    }),
    'index.mjs': `export const tools = {
  async skill_haber_liste(input, ctx) {
    const titles = (await ctx.storage.get('basliklar')) || ['Birinci haber'];
    return { ok: true, text: titles.length + ' başlık var.', data: { items: titles.map((title) => ({ key: title, title })) } };
  },
  async skill_haber_ekle(input, ctx) {
    const titles = (await ctx.storage.get('basliklar')) || ['Birinci haber'];
    titles.push(input.title);
    await ctx.storage.set('basliklar', titles);
    return { ok: true, text: 'Eklendi.' };
  },
};
`,
    'selftest.mjs': `export default async function ({ tools, assert }) {
  const first = await tools.skill_haber_liste({});
  assert.equal(first.data.items.length, 1);
  await tools.skill_haber_ekle({ title: 'İkinci haber' });
  const second = await tools.skill_haber_liste({});
  assert.equal(second.data.items[1].key, 'İkinci haber');
}
`,
  });

  it('ilk koşu tohumlar; yeni başlık duyurulur; takip İşler modülüne kaynak olarak takılır', async () => {
    skills.write('haber', newsSkill());
    const api = workshop();
    await api.start();
    await until(statusOf(api, 'haber'), (status) => status === 'pending_approval', 'onay bekliyor');
    await api.approve('haber', true);
    await until(statusOf(api, 'haber'), (status) => status === 'enabled', 'etkin');

    await api.plugins.tick();
    const seeded = (await api.activity('haber')).find((item) => item.kind === 'watch');
    expect(seeded).toMatchObject({ lastOk: true, lastText: 'İlk bakış: 1 kayıt görüldü; bundan sonra yeni olanları haber vereceğim.' });
    expect(notified.filter((request) => request.moduleId === 'skill:haber')).toEqual([]);

    await tools.run('skill_haber_ekle', { title: 'Deprem tatbikatı yapıldı' }, { origin: ui });
    const ran = await api.runNow('haber', 'watch', 'yeni');
    expect(ran).toEqual({ ok: true, text: '1 yeni: Deprem tatbikatı yapıldı' });
    expect(notified.filter((request) => request.moduleId === 'skill:haber')).toEqual([
      expect.objectContaining({ title: 'Haberler: Yeni haberler', body: '1 yeni: Deprem tatbikatı yapıldı', priority: 'normal', speak: false }),
    ]);
    // Aynı başlık ikinci kez duyurulmaz.
    expect(await api.runNow('haber', 'watch', 'yeni')).toEqual({ ok: true, text: 'Yeni bir şey yok.' });

    // Takip işleri kaynağı: "haberlerde 'deprem' geçince haber ver" gibi bir iş bu kaynağı kullanabilir.
    const box: { sources: Array<{ kind: string; normalize?(target: string): { target: string } | { error: string }; check(input: unknown): Promise<{ signature: string; text: string }> }> } = { sources: [] };
    (bus as unknown as { emit(type: string, payload: unknown): void }).emit('watch.sources.collect', box);
    const source = box.sources.find((entry) => entry.kind === 'plugin');
    expect(source).toBeDefined();
    expect(source!.normalize!('yeni haberler')).toEqual({ target: 'haber:yeni' });
    expect(source!.normalize!('olmayan takip')).toMatchObject({ error: expect.stringContaining('Yeni haberler (haber:yeni)') });
    const probe = await source!.check({ target: 'haber:yeni', previous: null, since: 0, signal: new AbortController().signal });
    expect(probe.text).toBe('Birinci haber\nDeprem tatbikatı yapıldı');
    expect(probe.signature).toMatch(/^[0-9a-f]{40}$/);

    // Kapatınca kaynak listeden düşer.
    await api.setEnabled('haber', false);
    const after: { sources: unknown[] } = { sources: [] };
    (bus as unknown as { emit(type: string, payload: unknown): void }).emit('watch.sources.collect', after);
    expect(after.sources).toEqual([]);
  }, 40_000);
});
