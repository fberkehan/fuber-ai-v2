// Kokpit modülü: depo, doldurucular (sahte ağ ile), motor (boş kart yok, sıra, olayla yenileme), araçlar ve kart kaydı.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dashboard,
  dashboardGridMode,
  dashboardHoles,
  isEmptyCardData,
  packDashboard,
  type AgendaData,
  type ApprovalRequest,
  type Bus,
  type BusEvents,
  type DashboardCard,
  type DashboardSnapshot,
  type FxData,
  type IpcHandlers,
  type ModuleContext,
  type ModuleDef,
  type NewsData,
  type Notification,
  type SchedulerApi,
  type TodayBandData,
  type TodosData,
  type UsageSummary,
  type WeatherData,
} from '@fuber/shared';
import { loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import { createJobs } from '../../core/jobs';
import { createMemory } from '../../core/memory';
import { createScheduler } from '../../core/scheduler';
import planner from '../planner/index';
import { createPlannerRepo } from '../planner/repo';
import { PROJECTS_MIGRATIONS } from '../projects/repo';
import { fakeFetch, fixture, type FakeRoute } from '../web/fake-fetch';
import { createDashboardModule } from './index';
import { backoffMs, localeFromZone, NET_TTL_MS } from './network';
import { createDashboardStore, DASHBOARD_MIGRATIONS, MAX_CUSTOM_CARDS } from './store';
import { foldCardName } from './engine';
import { buildContent, parseMovePosition } from './tools';

// 16 Kasım 2026 Pazartesi, sabah 09:00 (Türkiye).
const T0 = new Date('2026-11-16T09:00:00+03:00');

const ONLINE: FakeRoute[] = [
  { match: 'geocoding-api.open-meteo.com', body: fixture('om-geocode-ankara.json'), contentType: 'application/json' },
  { match: 'api.open-meteo.com/v1/forecast', body: fixture('om-forecast-ankara.json'), contentType: 'application/json' },
  { match: 'tcmb.gov.tr', body: fixture('tcmb-today.xml'), contentType: 'text/xml' },
  { match: 'trthaber.com', body: fixture('trt.rss'), contentType: 'application/rss+xml' },
];
const OFFLINE: FakeRoute[] = [{ match: /./, fail: 'network' }];

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let scheduler: SchedulerApi;
let tools: ReturnType<typeof miniTools>;
let module: ModuleDef;
let ctx: ModuleContext;
let plannerCtx: ModuleContext;
let ipc: IpcHandlers;
let changes: Array<BusEvents['dashboard.changed']>;
let pending: Notification[];
let approvals: ApprovalRequest[];
let usage: UsageSummary;
let networkAllowed: boolean;
let routes: FakeRoute[];
let fetcher: ReturnType<typeof fakeFetch>;

const ai = { channel: 'chat' as const, speakerVerified: null };
const run = (name: string, input: unknown) => tools.run(name, input, { origin: ai });
const get = () => ipc['dashboard.get']!(undefined as never) as DashboardSnapshot;
const ids = (snapshot: DashboardSnapshot = get()) => snapshot.cards.map((card) => card.id);
const cardOf = <D,>(id: string, snapshot: DashboardSnapshot = get()) => snapshot.cards.find((card) => card.id === id) as DashboardCard<D> | undefined;
/** Bekleyen ağ yanıtlarını ve olay katlamasını akıtır. */
const settle = () => vi.advanceTimersByTimeAsync(200);

async function boot(options: { online?: boolean } = {}) {
  bus = testBus();
  scheduler = createScheduler({ store: env.store, bus, log: silentLog });
  scheduler.start();
  tools = miniTools();
  tools.pendingApprovals = () => approvals;
  const attention: ModuleContext['attention'] = { start() {}, stop() {}, notify: () => ({}) as never, dismiss() {}, act() {}, pending: () => pending, recent: () => [] };
  const services = {
    bus,
    scheduler,
    attention,
    tools,
    memory: createMemory({ store: env.store, bus, log: silentLog }),
    jobs: createJobs({ store: env.store, bus, log: silentLog }),
    usage: { today: () => usage } as ModuleContext['usage'],
  };
  plannerCtx = moduleContext('planner', services, env.store);
  await loadModule(planner, plannerCtx, env.store);
  env.store.migrate('projects', PROJECTS_MIGRATIONS);

  routes = options.online ? ONLINE : OFFLINE;
  fetcher = fakeFetch([]);
  const routed: typeof fetcher = Object.assign((url: string, opts?: Parameters<typeof fetcher>[1]) => fakeFetch(routes)(url, opts).finally(() => fetcher.calls.push(url)), { calls: fetcher.calls });
  module = createDashboardModule({ fetcher: routed, now: () => Date.now(), timeZone: () => 'Europe/Istanbul' });
  ctx = moduleContext('dashboard', services, env.store);
  ctx.policy.networkAllowed = () => networkAllowed;
  changes = [];
  bus.on('dashboard.changed', (event) => changes.push(event));
  await loadModule(module, ctx, env.store, tools);
  ipc = module.ipc!(ctx);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(T0);
  env = tempStore();
  pending = [];
  approvals = [];
  networkAllowed = true;
  usage = { day: '2026-11-16', costUsd: 0, budgetUsd: 10, overBudget: false, calls: 0, byKind: {} };
});
afterEach(async () => {
  await module?.teardown?.();
  await planner.teardown?.();
  scheduler?.stop();
  vi.useRealTimers();
  env.close();
});

describe('depo', () => {
  it('özel kart ekler, günceller, yumuşak siler ve geri getirir; düzen kalıcıdır', () => {
    env.store.migrate('dashboard', DASHBOARD_MIGRATIONS);
    const store = createDashboardStore(env.store.scoped('dashboard'));
    const card = store.addCard({ title: 'Dolar hedefi', content: { template: 'metric', value: '40', unit: 'TL' }, size: 'small', source: 'ai' });
    expect(store.cards()).toHaveLength(1);
    expect(store.updateCard(card.id, { content: { template: 'metric', value: '41', unit: 'TL' } })?.content).toEqual({ template: 'metric', value: '41', unit: 'TL' });
    expect(store.removeCard(card.id)).toBe(true);
    expect(store.cards()).toHaveLength(0);
    expect(store.removeCard(card.id)).toBe(false);
    expect(store.restoreCard(card.id)).toBe(true);
    expect(store.card(card.id)?.title).toBe('Dolar hedefi');

    store.setOrder(['news', 'weather', 'news']);
    store.setSize('news', 'large');
    store.setHidden('fx', true);
    store.setHidden('fx', true);
    // Yeni bir depo nesnesi (yeniden açılış) aynı düzeni okur.
    expect(createDashboardStore(env.store.scoped('dashboard')).layout()).toEqual({ order: ['news', 'weather'], sizes: { news: 'large' }, hidden: ['fx'] });
    store.resetLayout();
    expect(store.layout()).toEqual({ order: [], sizes: {}, hidden: [] });
    expect(store.cards()).toHaveLength(1);
  });

  it('silinen kart bir gün sonra kalıcı olarak atılır; bozuk düzen kaydı varsayılana düşer', () => {
    env.store.migrate('dashboard', DASHBOARD_MIGRATIONS);
    const db = env.store.scoped('dashboard');
    const store = createDashboardStore(db);
    const card = store.addCard({ title: 'Not', content: { template: 'text', text: 'deneme' }, size: 'medium', source: 'user' });
    store.removeCard(card.id);
    store.sweep();
    expect(store.restoreCard(card.id)).toBe(true);
    store.removeCard(card.id);
    vi.setSystemTime(new Date(T0.getTime() + 25 * 3600_000));
    store.sweep();
    expect(store.restoreCard(card.id)).toBe(false);

    db.run('INSERT INTO dashboard_state (key, value) VALUES (?, ?)', ['layout', '{"order":"x","sizes":{"a":"dev"},"hidden":[1,"fx"]}']);
    expect(store.layout()).toEqual({ order: [], sizes: {}, hidden: ['fx'] });
  });

  it('aynı metinli açık öneri yinelenmez; kapatılan öneri listeden çıkar', () => {
    env.store.migrate('dashboard', DASHBOARD_MIGRATIONS);
    const store = createDashboardStore(env.store.scoped('dashboard'));
    const first = store.addSuggestion({ text: 'Toplantı gündemini çıkarayım mı?' });
    expect(store.addSuggestion({ text: 'Toplantı gündemini çıkarayım mı?' }).id).toBe(first.id);
    expect(store.suggestions()).toHaveLength(1);
    expect(store.dismissSuggestion(first.id)).toBe(true);
    expect(store.suggestions()).toHaveLength(0);
  });
});

describe('boş pano', () => {
  it('veri yokken yalnız bugün bandı çizilir; boş kart yoktur', async () => {
    await boot();
    const snapshot = get();
    expect(ids(snapshot)).toEqual(['today']);
    expect(snapshot.customized).toBe(false);
    const band = cardOf<TodayBandData>('today', snapshot)!;
    expect(band.band).toBe(true);
    expect(band.data).toMatchObject({ day: '2026-11-16', reminders: 0, todos: 0, next: null, approvals: [] });
    expect(band.data.week.map((day) => day.day)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  });
});

describe('yerleşik doldurucular', () => {
  beforeEach(async () => {
    await boot();
  });

  it('hatırlatıcılar "Sırada"da, yapılacaklar kendi kartında; band yalnız sayıları ve haftayı taşır', async () => {
    const planRepo = createPlannerRepo(plannerCtx);
    planRepo.createReminder({ text: 'Yatırımcı görüşmesine hazırlan', dueAt: '2026-11-16T11:00:00+03:00' }, 'user');
    planRepo.createReminder({ text: 'Sabah sporu', dueAt: '2026-11-17T07:30:00+03:00', recurrence: { freq: 'daily', interval: 1 } }, 'user');
    planRepo.createReminder({ text: 'Pasaport randevusu', dueAt: '2026-11-30T14:00:00+03:00' }, 'user');
    planRepo.createTodo({ text: 'Fatura arşivini düzenle', dueDay: '2026-11-14' }, 'user');
    planRepo.createTodo({ text: 'Demo videosunu kaydet' }, 'user');
    await settle();

    const snapshot = get();
    expect(ids(snapshot)).toEqual(['today', 'agenda', 'todos']);
    expect(snapshot.cards.every((card) => card.band || !isEmptyCardData(card.data))).toBe(true);

    const band = cardOf<TodayBandData>('today', snapshot)!.data;
    expect(band).toMatchObject({ reminders: 1, todos: 2 });
    // Hafta şeridi: bugün (hatırlatıcı + gecikmiş yapılacak), yarın (spor).
    expect(band.week[0]).toEqual({ day: '2026-11-16', reminders: 1, todos: 1 });
    expect(band.week[1]).toMatchObject({ reminders: 1 });

    const agenda = cardOf<AgendaData>('agenda', snapshot)!;
    // Otuz Kasım yedi günün dışında: listede yok.
    expect(agenda.data.items.map((item) => item.reminder.text)).toEqual(['Yatırımcı görüşmesine hazırlan', 'Sabah sporu']);
    expect(agenda.data.items[1]!.repeats).toBeTruthy();
    expect(agenda.page).toBe('planner');
    expect(cardOf<TodosData>('todos', snapshot)!.data).toMatchObject({
      total: 2,
      items: [
        { todo: expect.objectContaining({ text: 'Fatura arşivini düzenle' }), late: true },
        { todo: expect.objectContaining({ text: 'Demo videosunu kaydet' }), late: false },
      ],
    });
    // Sıradaki hatırlatıcının vakti gelince görünüm eskir.
    expect(snapshot.validUntil).toBe('2026-11-16T08:00:00.000Z');
  });

  it('veri değişince olayla yeniden yayınlar; art arda olaylar tek yayına katlanır', async () => {
    const planRepo = createPlannerRepo(plannerCtx);
    const before = get().revision;
    planRepo.createTodo({ text: 'Bir' }, 'user');
    planRepo.createTodo({ text: 'İki' }, 'user');
    planRepo.createTodo({ text: 'Üç' }, 'user');
    expect(changes).toHaveLength(0);
    await settle();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ reason: 'data', by: 'system' });
    expect(changes[0]!.revision).toBeGreaterThan(before);
    // İçerik değişmediyse yayın yok.
    bus.emit('planner.changed', { entity: 'todo', op: 'updated', ids: [] });
    await settle();
    expect(changes).toHaveLength(1);
  });

  it('değişimle yayın arasına bir okuma girse de yayın kaçmaz (öteki pencere haberdar olur)', async () => {
    createPlannerRepo(plannerCtx).createTodo({ text: 'Bir' }, 'user');
    // Bekleyen yayından önce biri panoyu okur: sürüm ilerler ama duyuru yapılmamıştır.
    const read = get();
    expect(changes).toHaveLength(0);
    await settle();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.revision).toBe(read.revision);
  });

  it('onay bekleyen iş yalnız bantta; bildirimler kendi kartında; süren iş kartı iş bitince kalkar ve "Son olanlar"a geçer', async () => {
    approvals = [{ id: 'a1', toolName: 'file_delete', moduleId: 'pc', risk: 'danger', summary: 'Dosyayı siliyorum.', input: {}, origin: ai, requestedAt: T0.toISOString(), expiresAt: T0.toISOString() }];
    pending = [{ id: 'n1', moduleId: 'planner', title: 'Akşam özeti', body: 'Yarın üç iş var.', priority: 'low', actions: [], speak: null, dedupeKey: null, data: {}, status: 'shown', channel: 'toast', createdAt: T0.toISOString(), shownAt: T0.toISOString(), resolvedAt: null, actionId: null }];
    let finish: (text: string) => void = () => {};
    const job = ctx.jobs.start({ kind: 'test.run', moduleId: 'projects', title: 'Testleri düzelt', run: () => new Promise<string>((resolve) => (finish = resolve)) });
    bus.emit('tool.approval.request', approvals[0]!);
    await settle();

    let snapshot = get();
    expect(ids(snapshot)).toEqual(['today', 'jobs', 'notices']);
    expect(cardOf<TodayBandData>('today', snapshot)!.data.approvals).toHaveLength(1);
    expect(JSON.stringify(snapshot.cards.filter((card) => card.id !== 'today'))).not.toContain('Şirketi siliyorum');
    expect(cardOf<{ items: Array<{ id: string; title: string; status: string }> }>('jobs', snapshot)!.data.items).toEqual([expect.objectContaining({ id: job.id, title: 'Testleri düzelt', status: 'running' })]);
    // İlerleme pano verisinde taşınmaz: her adımda yeniden yayın olmaz.
    const published = changes.length;
    bus.emit('job.progress', { job: { ...ctx.jobs.get(job.id)!, progress: 0.4, step: 'derleniyor' } });
    await settle();
    expect(changes).toHaveLength(published);

    finish('3 test düzeltildi.');
    await settle();
    snapshot = get();
    expect(ids(snapshot)).toEqual(['today', 'notices', 'activity']);
    expect(cardOf<{ items: Array<{ text: string; detail: string; tone: string; page: string }> }>('activity', snapshot)!.data.items[0]).toMatchObject({
      text: 'Testleri düzelt bitti',
      detail: '3 test düzeltildi.',
      tone: 'done',
      page: 'projects',
    });
  });

  it('kullanım kartı yalnız bütçenin yarısı geçilince çizilir', async () => {
    expect(ids()).not.toContain('usage');
    usage = { ...usage, costUsd: 6, calls: 41 };
    bus.emit('usage.recorded', { record: {} as never, today: usage });
    await settle();
    expect(cardOf('usage')?.data).toEqual({ costUsd: 6, budgetUsd: 10, calls: 41, overBudget: false });
  });

  it('Claude Code oturumları tek kartta ve yalnız son günlerde etkin olanlarla; modül kapalıysa hiç', async () => {
    const db = env.store.scoped('projects');
    const insert = (id: string, title: string, lastAt: string) =>
      db.run(`INSERT INTO projects_sessions (id, cwd, title, started_at, last_at, message_count, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, 'C:/x', title, lastAt, lastAt, 12, `C:/x/${id}.jsonl`]);
    for (let index = 0; index < 6; index++) insert(`s${index}`, `Oturum ${index}`, new Date(T0.getTime() - index * 3600_000).toISOString());
    insert('old', 'Eski oturum', '2026-10-01T10:00:00.000Z');
    bus.emit('projects.changed', { entity: 'session', op: 'updated', ids: [] });
    await settle();
    const snapshot = get();
    expect(snapshot.cards.filter((card) => card.moduleId === 'projects')).toHaveLength(1);
    const sessions = cardOf<{ items: Array<{ title: string }>; total: number }>('sessions', snapshot)!;
    expect(sessions.data.items).toHaveLength(4);
    expect(sessions.data.total).toBe(6);
    expect(JSON.stringify(sessions.data)).not.toContain('Eski oturum');

    ctx.settings.update({ disabledModules: ['projects'] });
    bus.emit('module.changed', { id: 'projects', enabled: false, reason: 'user' });
    await settle();
    expect(ids()).not.toContain('sessions');
  });
});

describe('ağdan gelen kartlar', () => {
  it('ağ yokken hava, döviz ve haber kartı ÇİZİLMEZ; başarısız deneme ikiye katlanarak bekler', async () => {
    await boot({ online: false });
    expect(ids()).toEqual(['today']);
    await settle();
    expect(ids()).toEqual(['today']);
    const first = fetcher.calls.length;
    expect(first).toBeGreaterThan(0);
    // Bekleme süresi dolmadan yeniden denenmez.
    get();
    await settle();
    expect(fetcher.calls.length).toBe(first);
    vi.setSystemTime(new Date(T0.getTime() + backoffMs(1) + 1000));
    get();
    await settle();
    expect(fetcher.calls.length).toBeGreaterThan(first);
    expect([backoffMs(1), backoffMs(2), backoffMs(3), backoffMs(9)]).toEqual([120_000, 240_000, 480_000, 1_800_000]);
  });

  it('ağ varken kartlar okumayı bekletmeden dolar; hava kartının yeri araçla değişir', async () => {
    await boot({ online: true });
    // İlk okuma ağı beklemez: kart yok, yenileme arka planda başlar.
    expect(ids()).toEqual(['today']);
    await settle();
    // Varsayılan sıra: hava ve döviz yan yana (küçük), haber sonra.
    expect(ids()).toEqual(['today', 'weather', 'fx', 'news']);
    expect(changes.some((change) => change.reason === 'data')).toBe(true);

    const fx = cardOf<FxData>('fx')!;
    expect(fx.data).toMatchObject({ base: 'TRY', source: 'TCMB', date: '2026-11-13' });
    expect(fx.data.rates.map((rate) => rate.code)).toEqual(['USD', 'EUR', 'GBP']);
    expect(fx.data.rates[0]!.rate).toBeGreaterThan(1);
    expect(fx.data.rates[0]!.change).toBeNull();
    expect(fx.stale).toBe(false);
    expect(fx.updatedAt).toBe(T0.toISOString());
    const news = cardOf<NewsData>('news')!;
    expect(news.data.items.length).toBeGreaterThan(2);
    expect(news.data.items[0]).toMatchObject({ source: 'TRT Haber' });
    expect(news.data.items[0]!.url).toMatch(/^https:\/\//);

    const result = await run('dashboard_card_update', { card: 'hava', place: 'Ankara' });
    expect(result).toMatchObject({ ok: true, data: { id: 'weather', place: 'Ankara' } });
    const weather = cardOf<WeatherData>('weather')!;
    expect(weather.title).toBe('Ankara');
    expect(typeof weather.data.temperature).toBe('number');
    expect(weather.data.summary).not.toBe('');
    expect(weather.data.days.length).toBeGreaterThan(0);
    expect(ids()).toEqual(['today', 'weather', 'fx', 'news']);
    // Bilinmeyen yer: kart çizilmez, araç bunu söyler ("yaptım" diyemez).
    routes = [{ match: 'geocoding-api', body: '{"results":[]}' }, ...ONLINE.slice(1)];
    const failed = await run('dashboard_card_update', { card: 'weather', place: 'Zzyzx' });
    expect(failed.ok).toBe(false);
    expect(ids()).not.toContain('weather');
  });

  it('tazelik süresi dolunca yeniler; yenilenemezse son iyi veriyi "bayat" notuyla, çok eskiyince hiç göstermez', async () => {
    await boot({ online: true });
    get();
    await settle();
    expect(cardOf('news')!.stale).toBe(false);
    const fresh = fetcher.calls.length;
    // Süre dolmadan ağa gidilmez.
    vi.setSystemTime(new Date(T0.getTime() + NET_TTL_MS.news - 60_000));
    get();
    await settle();
    expect(fetcher.calls.filter((url) => url.includes('trthaber')).length).toBe(fetcher.calls.slice(0, fresh).filter((url) => url.includes('trthaber')).length);

    // Ağ gitti: süre dolunca yenileme başarısız olur, kart son veriyle ve notla kalır.
    routes = OFFLINE;
    vi.setSystemTime(new Date(T0.getTime() + NET_TTL_MS.news + 60_000));
    get();
    await settle();
    const stale = cardOf<NewsData>('news')!;
    expect(stale.stale).toBe(true);
    expect(stale.updatedAt).toBe(T0.toISOString());
    expect(stale.data.items.length).toBeGreaterThan(2);

    // Bir gün sonra haber gösterilmez; kur (yedi gün) notla durur.
    vi.setSystemTime(new Date(T0.getTime() + 25 * 3600_000));
    get();
    await settle();
    expect(ids()).not.toContain('news');
    expect(cardOf('fx')!.stale).toBe(true);
  });

  it('Gizli kipte ağa çıkılmaz: veri yoksa kart yok, varsa son veri notla', async () => {
    networkAllowed = false;
    await boot({ online: true });
    get();
    await settle();
    expect(fetcher.calls).toHaveLength(0);
    expect(ids()).toEqual(['today']);

    networkAllowed = true;
    get();
    await settle();
    expect(ids()).toContain('fx');
    const calls = fetcher.calls.length;
    networkAllowed = false;
    vi.setSystemTime(new Date(T0.getTime() + 2 * 3600_000));
    get();
    await settle();
    expect(fetcher.calls.length).toBe(calls);
    expect(cardOf('fx')!.stale).toBe(true);
  });

  it('kur değişimi bir önceki günün kuruna göre hesaplanır', async () => {
    await boot({ online: true });
    get();
    await settle();
    const first = cardOf<FxData>('fx')!.data.rates[0]!;
    // Ertesi gün yeni bülten: dolar yüzde bir yukarıda.
    const next = fixture('tcmb-today.xml')
      .replace('Tarih="13.11.2026"', 'Tarih="16.11.2026"')
      .replace(/(<Currency[^>]*Kod="USD"[\s\S]*?<ForexSelling>)([\d.]+)/, (_all, head: string, value: string) => `${head}${(Number(value) * 1.01).toFixed(4)}`);
    routes = [{ match: 'tcmb.gov.tr', body: next }, ...ONLINE.filter((route) => route.match !== 'tcmb.gov.tr')];
    vi.setSystemTime(new Date(T0.getTime() + NET_TTL_MS.fx + 60_000));
    get();
    await settle();
    const second = cardOf<FxData>('fx')!.data;
    expect(second.date).toBe('2026-11-16');
    expect(second.rates[0]!.rate).toBeGreaterThan(first.rate);
    expect(second.rates[0]!.change).toBeCloseTo(0.01, 3);
  });

  it('saat diliminden yer, para ve haber bölgesi', () => {
    expect(localeFromZone('Europe/Istanbul')).toEqual({ place: 'İstanbul', currency: 'TRY', region: 'TR' });
    expect(localeFromZone('Europe/London')).toEqual({ place: 'Londra', currency: 'GBP', region: 'GB' });
    expect(localeFromZone('America/New_York')).toEqual({ place: 'New York', currency: 'USD', region: 'US' });
    expect(localeFromZone('Europe/Madrid')).toEqual({ place: 'Madrid', currency: 'EUR', region: 'WORLD' });
    expect(localeFromZone(undefined)).toMatchObject({ currency: 'TRY', region: 'TR' });
  });
});

describe('araçlar', () => {
  beforeEach(async () => {
    await boot();
    createPlannerRepo(plannerCtx).createTodo({ text: 'Demo videosunu kaydet' }, 'user');
    createPlannerRepo(plannerCtx).createReminder({ text: 'Muhasebeciyi ara', dueAt: '2026-11-16T15:00:00+03:00' }, 'user');
    await settle();
    changes.length = 0;
  });

  it('pano sözünde model panoyu görür: taşıma aracı sunulunca bağlama kartlar ve sıraları eklenir', () => {
    const hints = tools.contextHints(['dashboard_card_move', 'dashboard_state', 'yok_boyle_arac']);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/1\. .+2\. /);
    expect(hints[0]).toContain('dashboard_card_move');
    expect(hints[0]).toContain('çağırmadan');
  });

  it('dashboard_card_add: şablona göre kart ekler, öndeki kartın ardına koyar, canlı yayınlar ve yeniden açılışta kalır', async () => {
    const added = await run('dashboard_card_add', { title: 'Lansmana kalan', template: 'metric', value: '12', unit: 'gün', label: '28 Kasım' });
    expect(added.ok).toBe(true);
    expect(added.text).toContain('Lansmana kalan');
    const id = (added.data as { id: string }).id;
    expect(changes.at(-1)).toMatchObject({ reason: 'card', by: 'ai', cardId: id });
    const snapshot = get();
    // Zaman çizgisi (yüksek kart) yerinde kalır; yeni kart hemen ardına gelir.
    expect(ids(snapshot)).toEqual(['today', 'agenda', id, 'todos']);
    expect(cardOf(id, snapshot)).toMatchObject({ kind: 'custom.metric', title: 'Lansmana kalan', size: 'small', source: 'ai', data: { template: 'metric', value: '12', unit: 'gün', label: '28 Kasım' } });
    expect(snapshot.customized).toBe(true);

    // Yeniden açılış: modül kapanır, aynı veritabanıyla yeniden yüklenir.
    await module.teardown?.();
    module = createDashboardModule({ fetcher: fakeFetch(OFFLINE), now: () => Date.now(), timeZone: () => 'Europe/Istanbul' });
    await loadModule(module, ctx, env.store, tools);
    ipc = module.ipc!(ctx);
    expect(ids()).toEqual(['today', 'agenda', id, 'todos']);
    // İstenirse en başa ya da en sona.
    const first = await run('dashboard_card_add', { title: 'Başa', template: 'text', text: 'x', position: 'start' });
    const last = await run('dashboard_card_add', { title: 'Sona', template: 'text', text: 'x', position: 'end' });
    const order = ids();
    expect(order[1]).toBe((first.data as { id: string }).id);
    expect(order.at(-1)).toBe((last.data as { id: string }).id);
  });

  it('dashboard_card_add: her şablon; eksik alanı söyler ve kart eklemez', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ template: 'text', text: 'Yarın ofise geç gideceğim.' }, 'custom.text'],
      [{ template: 'keyvalue', pairs: [{ label: 'Sunucu', value: 'çalışıyor' }] }, 'custom.keyvalue'],
      [{ template: 'list', items: [{ text: 'Süt' }, { text: 'Ekmek', done: true }] }, 'custom.list'],
      [{ template: 'progress', percent: 68, label: 'Demo hazırlığı' }, 'custom.progress'],
      [{ template: 'link', url: 'https://example.com', label: 'Fuber' }, 'custom.link'],
    ];
    for (const [input, kind] of cases) {
      const result = await run('dashboard_card_add', { title: `Kart ${kind}`, position: 'end', ...input });
      expect(result.ok, kind).toBe(true);
      expect(cardOf((result.data as { id: string }).id)!.kind).toBe(kind);
    }
    expect(cardOf<{ value: number }>(ids().at(-2)!)!.data.value).toBeCloseTo(0.68);
    const count = get().cards.length;
    for (const input of [{ template: 'text' }, { template: 'list', items: [] }, { template: 'metric' }, { template: 'progress' }, { template: 'link', url: 'javascript:alert(1)' }, { template: 'keyvalue' }]) {
      const result = await run('dashboard_card_add', { title: 'Eksik', ...input });
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(result.text).toMatch(/gerekli/);
    }
    expect(get().cards.length).toBe(count);
    expect(buildContent('link', { url: 'ftp://x' })).toMatch(/http/);
  });

  it('dashboard_card_add: özel kart sayısı sınırlıdır', async () => {
    for (let index = 0; index < MAX_CUSTOM_CARDS; index++) expect((await run('dashboard_card_add', { title: `Not ${index}`, template: 'text', text: 'x' })).ok).toBe(true);
    const over = await run('dashboard_card_add', { title: 'Fazla', template: 'text', text: 'x' });
    expect(over.ok).toBe(false);
    expect(over.text).toContain(String(MAX_CUSTOM_CARDS));
  });

  it('dashboard_card_update: özel kartın içeriğini ve başlığını günceller; yerleşik kartta yalnız boyut', async () => {
    const added = await run('dashboard_card_add', { title: 'Demo hazırlığı', template: 'progress', percent: 20 });
    const id = (added.data as { id: string }).id;
    expect((await run('dashboard_card_update', { card: 'demo hazirligi', percent: 75, title: 'Demo' })).ok).toBe(true);
    expect(cardOf(id)).toMatchObject({ title: 'Demo', data: { template: 'progress', value: 0.75 } });
    // Kısmi güncelleme: verilmeyen alanlar (etiket) korunur.
    expect((await run('dashboard_card_update', { card: id, label: 'Sunum' })).ok).toBe(true);
    expect((await run('dashboard_card_update', { card: id, percent: 80 })).ok).toBe(true);
    expect(cardOf(id)).toMatchObject({ data: { template: 'progress', value: 0.8, label: 'Sunum' } });
    expect((await run('dashboard_card_update', { card: id, template: 'text', text: 'Bitti.' })).ok).toBe(true);
    expect(cardOf(id)).toMatchObject({ kind: 'custom.text', data: { template: 'text', text: 'Bitti.' } });
    expect((await run('dashboard_card_update', { card: id, size: 'wide' })).ok).toBe(true);
    expect(cardOf(id)!.size).toBe('wide');

    expect((await run('dashboard_card_update', { card: 'Yapılacaklar', text: 'x' })).ok).toBe(false);
    expect((await run('dashboard_card_update', { card: 'Yapılacaklar', size: 'large' })).ok).toBe(true);
    expect(cardOf('todos')!.size).toBe('large');
    expect((await run('dashboard_card_update', { card: 'Yapılacaklar', place: 'Ankara' })).ok).toBe(false);
    expect((await run('dashboard_card_update', { card: 'today', size: 'small' })).ok).toBe(false);
    const missing = await run('dashboard_card_update', { card: 'olmayan kart', size: 'small' });
    expect(missing.ok).toBe(false);
    expect(missing.text).toContain('Yapılacaklar');
  });

  it('dashboard_card_remove: yerleşik kart gizlenir ve geri gelir; özel kart silinir; bant kaldırılamaz', async () => {
    expect((await run('dashboard_card_remove', { card: 'yapılacaklar' })).ok).toBe(true);
    expect(ids()).toEqual(['today', 'agenda']);
    expect(get().layout.hidden).toEqual(['todos']);
    expect(changes.at(-1)).toMatchObject({ reason: 'card', by: 'ai', cardId: 'todos' });
    expect((await run('dashboard_card_remove', { card: 'todos' })).text).toMatch(/zaten/);
    expect((await run('dashboard_card_remove', { card: 'today' })).ok).toBe(false);
    expect((await run('dashboard_card_remove', { card: 'yok' })).ok).toBe(false);

    expect((await run('dashboard_layout', { action: 'restore', card: 'Yapılacaklar' })).ok).toBe(true);
    expect(ids()).toEqual(['today', 'agenda', 'todos']);

    const added = await run('dashboard_card_add', { title: 'Geçici', template: 'text', text: 'x' });
    const id = (added.data as { id: string }).id;
    expect((await run('dashboard_card_remove', { card: 'Geçici' })).ok).toBe(true);
    expect(ids()).not.toContain(id);
    // Kullanıcı "Geri al" derse kart geri gelir.
    expect(ids(ipc['dashboard.restore']!({ id }) as DashboardSnapshot)).toContain(id);
  });

  it('dashboard_layout: listeler, sıralar, boyutlandırır ve sıfırlar; düzen kalıcıdır', async () => {
    await run('dashboard_card_add', { title: 'Not', template: 'text', text: 'x', position: 'end' });
    const listed = await run('dashboard_layout', { action: 'list' });
    expect(listed.ok).toBe(true);
    expect(listed.text).toContain('1. Sırada (kimlik: agenda, büyük, en üst sıra');
    expect(listed.text).toMatch(/verisi olmadığı için çizilmeyenler: .*Hava/);
    expect((listed.data as { shown: Array<{ id: string }> }).shown.map((card) => card.id)).toEqual(['agenda', 'todos', expect.stringMatching(/^kart-/)]);

    const reordered = await run('dashboard_layout', { action: 'reorder', order: ['Not', 'yapılacaklar', 'olmayan'] });
    expect(reordered.ok).toBe(true);
    expect(reordered.text).toContain('Not, Yapılacaklar, Sırada');
    expect(reordered.text).toContain('olmayan');
    expect(ids().slice(1, 3)).toEqual([expect.stringMatching(/^kart-/), 'todos']);
    expect(changes.at(-1)).toMatchObject({ reason: 'layout', by: 'ai' });

    expect((await run('dashboard_layout', { action: 'resize', card: 'agenda', size: 'wide' })).ok).toBe(true);
    expect(cardOf('agenda')!.size).toBe('wide');
    expect((await run('dashboard_layout', { action: 'resize', card: 'agenda' })).ok).toBe(false);
    expect((await run('dashboard_layout', { action: 'reorder' })).ok).toBe(false);

    await run('dashboard_card_remove', { card: 'todos' });
    expect(get().customized).toBe(true);
    expect((await run('dashboard_layout', { action: 'reset' })).ok).toBe(true);
    const reset = get();
    expect(reset.customized).toBe(false);
    expect(reset.layout).toEqual({ order: [], sizes: {}, hidden: [] });
    // Varsayılan sıra ve boyutlar; özel kart silinmez, önceliğine göre yerleşir.
    expect(ids(reset)).toEqual(['today', 'agenda', 'todos', expect.stringMatching(/^kart-/)]);
    expect(cardOf('agenda', reset)!.size).toBe('large');
  });

  it('suggestion_add: öneri kartını doldurur; kapatılınca kart kalkar (boş kart yok)', async () => {
    expect(ids()).not.toContain('suggestions');
    const result = await run('suggestion_add', { text: 'Yarınki görüşme için gündem çıkarayım mı?', detail: 'Takviminizde yatırımcı görüşmesi var.' });
    expect(result.ok).toBe(true);
    const card = cardOf<{ items: Array<{ id: string; text: string; detail: string }> }>('suggestions')!;
    expect(card.data.items).toEqual([expect.objectContaining({ text: 'Yarınki görüşme için gündem çıkarayım mı?', detail: 'Takviminizde yatırımcı görüşmesi var.' })]);
    expect(changes.at(-1)).toMatchObject({ reason: 'card', cardId: 'suggestions' });
    const after = ipc['dashboard.dismissSuggestion']!({ id: card.data.items[0]!.id }) as DashboardSnapshot;
    expect(ids(after)).not.toContain('suggestions');
  });

  // ───── model panoyu görmez: durum, adla bulma, doğal dille taşıma, sonuçta yeni sıra ─────

  const order = () =>
    get()
      .cards.filter((card) => !card.band)
      .map((card) => card.id);
  /** Dört görünür kart: Sırada, Yapılacaklar ve iki özel kart ("Bir", "İki"). */
  async function fourCards(): Promise<{ a: string; b: string }> {
    const a = ((await run('dashboard_card_add', { title: 'Bir', template: 'text', text: 'x', position: 'end' })).data as { id: string }).id;
    const b = ((await run('dashboard_card_add', { title: 'İki', template: 'text', text: 'y', position: 'end' })).data as { id: string }).id;
    expect(order()).toEqual(['agenda', 'todos', a, b]);
    return { a, b };
  }

  it('dashboard_state: panoyu insan diliyle anlatır (kart, kimlik, boyut, yer) ve hiçbir şeyi değiştirmez', async () => {
    const { a } = await fourCards();
    const before = get().revision;
    const state = await run('dashboard_state', {});
    expect(state.ok).toBe(true);
    expect(state.text).toContain('Panoda 4 kart var');
    expect(state.text).toContain('1. Sırada (kimlik: agenda, büyük, en üst sıra solda)');
    expect(state.text).toMatch(/2\. Yapılacaklar \(kimlik: todos, orta, en üst sıra sağda\)/);
    expect(state.text).toMatch(/verisi olmadığı için çizilmeyenler: .*Hava/);
    const data = state.data as { shown: Array<{ id: string; order: number; where: string }>; noData: Array<{ id: string }> };
    expect(data.shown.map((card) => card.id)).toEqual(['agenda', 'todos', a, expect.any(String)]);
    expect(data.shown[0]).toMatchObject({ order: 1, where: 'en üst sıra solda' });
    expect(data.noData.map((card) => card.id)).toContain('weather');
    expect(get().revision).toBe(before);
    // Kaldırılan kart durumda ayrıca sayılır.
    await run('dashboard_card_remove', { card: 'yapılacaklar' });
    expect((await run('dashboard_state', {})).text).toMatch(/Kaldırılmış kartlar \(geri getirilebilir\): Yapılacaklar/);
  });

  it('kart adla bulunur: Türkçe harf farkı, dolgu sözcükleri ve eş anlamlılar', async () => {
    await fourCards();
    for (const name of ['yapılacaklar', 'YAPILACAKLAR', 'yapilacaklar', 'yapılacaklar kartı', 'Yapılacaklar kutusunu', 'todo', 'görevler', 'todos']) {
      await run('dashboard_card_move', { card: 'sırada', position: 'top' });
      const moved = await run('dashboard_card_move', { card: name, position: 'top' });
      expect(moved.ok, name).toBe(true);
      expect(order()[0], name).toBe('todos');
    }
    for (const name of ['sırada', 'hatırlatıcılar', 'ajanda', 'takvim', 'agenda', 'Sırada kartını']) {
      await run('dashboard_card_move', { card: 'todos', position: 'top' });
      expect((await run('dashboard_card_move', { card: name, position: 'top' })).ok, name).toBe(true);
      expect(order()[0], name).toBe('agenda');
    }
    // Özel kart başlığıyla; yerleşik kartlar verisi olmasa da adıyla tanınır (hava, döviz, haber).
    expect((await run('dashboard_card_move', { card: 'iki', position: 'top' })).ok).toBe(true);
    for (const name of ['hava', 'hava durumu', 'hava durumunu', 'weather', 'döviz', 'kur', 'dolar', 'haberler', 'haber', 'news']) {
      const result = await run('dashboard_card_move', { card: name, position: 'top' });
      expect(result.ok, name).toBe(true);
      expect(result.text, name).toMatch(/gösterecek verisi yok/);
    }
    expect(foldCardName('Hava Durumu kartını')).toBe('hava durumu');
    expect(foldCardName('Döviz kutusu')).toBe('doviz');
  });

  it('dashboard_card_move: her yer (top, bottom, left, right, before, after) ve sonuçta yeni sıra', async () => {
    const { a, b } = await fourCards();
    const top = await run('dashboard_card_move', { card: 'İki', position: 'top' });
    expect(order()).toEqual([b, 'agenda', 'todos', a]);
    expect(top.text).toBe('“İki” kartı en üste alındı. Sıra: İki, Sırada, Yapılacaklar, Bir.');
    expect(top.data).toMatchObject({ id: b, order: [b, 'agenda', 'todos', a] });

    const bottom = await run('dashboard_card_move', { card: 'iki', position: 'bottom' });
    expect(order()).toEqual(['agenda', 'todos', a, b]);
    expect(bottom.text).toBe('“İki” kartı en alta alındı. Sıra: Sırada, Yapılacaklar, Bir, İki.');

    expect((await run('dashboard_card_move', { card: 'iki', position: 'left' })).text).toContain('bir öne (sola) alındı');
    expect(order()).toEqual(['agenda', 'todos', b, a]);
    expect((await run('dashboard_card_move', { card: 'iki', position: 'right' })).text).toContain('bir sona (sağa) alındı');
    expect(order()).toEqual(['agenda', 'todos', a, b]);
    // Kenarda kalan kart yerinde durur.
    await run('dashboard_card_move', { card: 'sırada', position: 'left' });
    expect(order()[0]).toBe('agenda');

    const before = await run('dashboard_card_move', { card: 'iki', position: 'before:yapılacaklar' });
    expect(order()).toEqual(['agenda', b, 'todos', a]);
    expect(before.text).toBe('“İki” kartı “Yapılacaklar” kartının önüne alındı. Sıra: Sırada, İki, Yapılacaklar, Bir.');
    const after = await run('dashboard_card_move', { card: 'sırada', position: 'after:bir' });
    expect(order()).toEqual([b, 'todos', a, 'agenda']);
    expect(after.text).toContain('“Sırada” kartı “Bir” kartının yanına (hemen ardına) alındı.');

    // Türkçe ve yakın biçimler.
    expect(parseMovePosition('top')).toEqual({ kind: 'top' });
    expect(parseMovePosition('en üste')).toEqual({ kind: 'top' });
    expect(parseMovePosition('Yukarı')).toEqual({ kind: 'top' });
    expect(parseMovePosition('aşağı')).toEqual({ kind: 'bottom' });
    expect(parseMovePosition('sola')).toEqual({ kind: 'left' });
    expect(parseMovePosition('sağ')).toEqual({ kind: 'right' });
    expect(parseMovePosition('before: Hava Durumu')).toEqual({ kind: 'before', card: 'Hava Durumu' });
    expect(parseMovePosition('yanına:döviz')).toEqual({ kind: 'after', card: 'döviz' });
    expect(parseMovePosition('köşeye')).toBeNull();

    // Sıra kalıcıdır: modül kapanır, aynı veritabanıyla yeniden yüklenir.
    await module.teardown?.();
    module = createDashboardModule({ fetcher: fakeFetch(OFFLINE), now: () => Date.now(), timeZone: () => 'Europe/Istanbul' });
    await loadModule(module, ctx, env.store, tools);
    ipc = module.ipc!(ctx);
    expect(order()).toEqual([b, 'todos', a, 'agenda']);
  });

  it('dashboard_card_move: boyut (bigger, smaller, doğrudan) ve yer birlikte', async () => {
    await fourCards();
    expect(cardOf('todos')?.size).toBe('medium');
    expect((await run('dashboard_card_move', { card: 'yapılacaklar', size: 'bigger' })).text).toContain('“Yapılacaklar” kartı geniş boyuta getirildi.');
    expect(cardOf('todos')?.size).toBe('wide');
    await run('dashboard_card_move', { card: 'yapılacaklar', size: 'bigger' });
    expect(cardOf('todos')?.size).toBe('large');
    expect((await run('dashboard_card_move', { card: 'yapılacaklar', size: 'bigger' })).text).toContain('zaten en büyük boyutta');
    await run('dashboard_card_move', { card: 'yapılacaklar', size: 'smaller' });
    expect(cardOf('todos')?.size).toBe('wide');
    await run('dashboard_card_move', { card: 'yapılacaklar', size: 'small' });
    expect(cardOf('todos')?.size).toBe('small');
    expect((await run('dashboard_card_move', { card: 'yapılacaklar', size: 'smaller' })).text).toContain('zaten en küçük boyutta');
    const both = await run('dashboard_card_move', { card: 'yapılacaklar', position: 'top', size: 'large' });
    expect(both.text).toMatch(/^“Yapılacaklar” kartı en üste alındı\. “Yapılacaklar” kartı büyük boyuta getirildi\. Sıra: Yapılacaklar, /);
    expect(order()[0]).toBe('todos');
  });

  it('dashboard_card_move: bilinmeyen kart panodaki kartları sayar; eksik ya da anlaşılmayan hedef ne gerektiğini söyler', async () => {
    await fourCards();
    const unknown = await run('dashboard_card_move', { card: 'borsa', position: 'top' });
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toMatch(/^Böyle bir kart yok: “borsa”\. Panodaki kartlar: /);
    for (const name of ['Sırada', 'Yapılacaklar', 'Bir', 'İki', 'Hava', 'Döviz', 'Haberler']) expect(unknown.text, name).toContain(name);
    expect((await run('dashboard_card_remove', { card: 'borsa' })).text).toContain('Böyle bir kart yok');
    expect((await run('dashboard_card_move', { card: 'iki', position: 'after:borsa' })).text).toContain('Böyle bir kart yok: “borsa”');
    expect((await run('dashboard_card_move', { card: 'iki' })).text).toContain('position');
    expect((await run('dashboard_card_move', { card: 'iki', position: 'köşeye' })).text).toContain('anlaşılmadı');
    expect((await run('dashboard_card_move', { card: 'bugün', position: 'bottom' })).ok).toBe(false);
    // Kaldırılmış kart taşınmak istenirse geri gelir.
    await run('dashboard_card_remove', { card: 'yapılacaklar' });
    const back = await run('dashboard_card_move', { card: 'yapılacaklar', position: 'top' });
    expect(back.text).toMatch(/^“Yapılacaklar” kartı panoya geri getirildi\. “Yapılacaklar” kartı en üste alındı\./);
    expect(order()[0]).toBe('todos');
    // Ekleme ve kaldırma da yeni sırayı söyler.
    expect((await run('dashboard_card_remove', { card: 'bir' })).text).toMatch(/Sıra: /);
    expect((await run('dashboard_card_add', { title: 'Üç', template: 'text', text: 'z' })).text).toMatch(/“Üç” kartı panoya eklendi\. Sıra: /);
  });

  it('araç açıklamaları Türkçedir, kümesi panodur ve yerel modele tek cümlelik özet kalır', () => {
    const defs = module.tools!;
    expect(defs.map((def) => def.name)).toEqual(['dashboard_state', 'dashboard_card_move', 'dashboard_card_add', 'dashboard_card_update', 'dashboard_card_remove', 'dashboard_layout', 'suggestion_add']);
    // Her araç ne zaman kullanılacağını bir örnek sözle anlatır; şema alanlarının açıklaması doludur (Claude Code yalnız tanımı görür).
    for (const def of defs.filter((item) => item.name !== 'suggestion_add')) expect(def.description, def.name).toMatch(/Örnek/);
    const move = defs.find((def) => def.name === 'dashboard_card_move')!;
    const shape = (move.input as unknown as { shape: Record<string, { description?: string }> }).shape;
    for (const key of ['card', 'position', 'size']) expect(shape[key]?.description?.length ?? 0, key).toBeGreaterThan(20);
    for (const def of defs) {
      expect(def.group, def.name).toBe('dashboard');
      expect(def.description.length, def.name).toBeGreaterThan(40);
      expect(def.description, def.name).not.toMatch(/—/);
    }
  });
});

describe('kullanıcı işlemleri (IPC)', () => {
  beforeEach(async () => {
    await boot();
    const planRepo = createPlannerRepo(plannerCtx);
    planRepo.createTodo({ text: 'Demo videosunu kaydet' }, 'user');
    planRepo.createReminder({ text: 'Muhasebeciyi ara', dueAt: '2026-11-16T15:00:00+03:00' }, 'user');
    pending = [{ id: 'n1', moduleId: 'planner', title: 'Akşam özeti', body: 'Yarın üç iş var.', priority: 'low', actions: [], speak: null, dedupeKey: null, data: {}, status: 'shown', channel: 'toast', createdAt: T0.toISOString(), shownAt: T0.toISOString(), resolvedAt: null, actionId: null }];
    await settle();
    changes.length = 0;
  });

  it('sürükleyip bırakılan sıra kaydedilir; o an çizilmeyen kartlar eski yerini korur', async () => {
    expect(ids()).toEqual(['today', 'agenda', 'notices', 'todos']);
    const moved = ipc['dashboard.reorder']!({ ids: ['notices', 'agenda', 'todos'] }) as DashboardSnapshot;
    expect(ids(moved)).toEqual(['today', 'notices', 'agenda', 'todos']);
    expect(changes.at(-1)).toMatchObject({ reason: 'layout', by: 'user' });
    // Bant ve bilinmeyen kimlik sırayı bozmaz; verilmeyen kart sonda kalır.
    expect(ids(ipc['dashboard.reorder']!({ ids: ['today', 'todos', 'hayalet'] }) as DashboardSnapshot)).toEqual(['today', 'todos', 'notices', 'agenda']);
    // Bilinmeyen kimlik saklanır (arayüzün kendi kartı olabilir) ama çizilmez.
    expect(get().layout.order).toContain('hayalet');

    // Yapılacak kalmayınca kart kalkar (boş kart yok); yeniden gelince kullanıcının verdiği yere döner.
    const planRepo = createPlannerRepo(plannerCtx);
    const todo = planRepo.listTodos()[0]!;
    planRepo.updateTodo(todo.id, { done: true });
    await settle();
    expect(ids()).toEqual(['today', 'notices', 'agenda']);
    ipc['dashboard.reorder']!({ ids: ['agenda', 'notices'] });
    planRepo.updateTodo(todo.id, { done: false });
    await settle();
    expect(ids()).toEqual(['today', 'todos', 'agenda', 'notices']);
  });

  it('boyut ve kaldırma kalıcıdır; "düzeni sıfırla" hepsini geri alır', () => {
    expect(cardOf('todos', ipc['dashboard.resize']!({ id: 'todos', size: 'wide' }) as DashboardSnapshot)!.size).toBe('wide');
    expect(ids(ipc['dashboard.remove']!({ id: 'notices' }) as DashboardSnapshot)).toEqual(['today', 'agenda', 'todos']);
    // Bant kaldırılamaz.
    expect(ids(ipc['dashboard.remove']!({ id: 'today' }) as DashboardSnapshot)).toContain('today');
    expect(ids(ipc['dashboard.restore']!({ id: 'notices' }) as DashboardSnapshot)).toContain('notices');
    ipc['dashboard.remove']!({ id: 'notices' });
    const reset = ipc['dashboard.reset']!(undefined as never) as DashboardSnapshot;
    expect(ids(reset)).toEqual(['today', 'agenda', 'notices', 'todos']);
    expect(cardOf('todos', reset)!.size).toBe('medium');
    expect(reset.customized).toBe(false);
  });

  it('her yerleşim deliksizdir (gerçek kart kümesiyle, her genişlikte)', async () => {
    await run('dashboard_card_add', { title: 'Lansman', template: 'metric', value: '12' });
    await run('suggestion_add', { text: 'Gündem çıkarayım mı?' });
    const snapshot = get();
    for (const width of [400, 640, 772, 932, 1200, 1752, 2552]) {
      const mode = dashboardGridMode(width);
      const placements = packDashboard(snapshot.cards, mode);
      expect(placements).toHaveLength(snapshot.cards.length);
      expect(dashboardHoles(placements, mode.columns), `${width} px`).toBe(0);
    }
  });
});

describe('kart kaydı: başka modülün kartı', () => {
  beforeEach(async () => {
    await boot();
  });

  it('kaydedilen kart panoda çizilir, olayıyla ve `invalidate` ile yenilenir, kayıt kalkınca gider', async () => {
    let unread = 0;
    const off = dashboard.registerProvider({
      id: 'mail.inbox',
      moduleId: 'mail',
      kind: 'mail.inbox',
      title: 'Son e-postalar',
      defaultSize: 'medium',
      priority: 85,
      page: 'mail',
      events: ['memory.changed'],
      fill: () => (unread > 0 ? { data: { items: Array.from({ length: unread }, (_, index) => ({ subject: `Konu ${index}` })) } } : null),
    });
    try {
      await settle();
      // Boş: çizilmez.
      expect(ids()).toEqual(['today']);
      unread = 2;
      dashboard.invalidate('mail.inbox');
      await settle();
      expect(ids()).toEqual(['today', 'mail.inbox']);
      expect(cardOf('mail.inbox')).toMatchObject({ kind: 'mail.inbox', moduleId: 'mail', source: 'module', title: 'Son e-postalar', size: 'medium', page: 'mail' });
      unread = 3;
      bus.emit('memory.changed', { op: 'created', ids: [], kind: 'fact' });
      await settle();
      expect((cardOf<{ items: unknown[] }>('mail.inbox')!.data.items).length).toBe(3);
      // Kullanıcı başka modülün kartını da taşır, boyutlandırır, kaldırır.
      expect(cardOf('mail.inbox', ipc['dashboard.resize']!({ id: 'mail.inbox', size: 'wide' }) as DashboardSnapshot)!.size).toBe('wide');
      expect(ids(ipc['dashboard.remove']!({ id: 'mail.inbox' }) as DashboardSnapshot)).toEqual(['today']);
      expect(ids(ipc['dashboard.restore']!({ id: 'mail.inbox' }) as DashboardSnapshot)).toEqual(['today', 'mail.inbox']);
    } finally {
      off();
    }
    await settle();
    expect(ids()).toEqual(['today']);
  });

  it('pano açıldıktan SONRA kart kaydedilse de `invalidate` duyulur ve değişim yayınlanır (kayıt aboneliği düşmez)', async () => {
    let shown = false;
    const off = dashboard.registerProvider({ id: 'late.card', moduleId: 'late', title: 'Geç', defaultSize: 'small', priority: 50, fill: () => (shown ? { data: { text: 'var' } } : null) });
    try {
      await settle();
      changes.length = 0;
      shown = true;
      dashboard.invalidate('late.card');
      await settle();
      expect(changes.some((change) => change.reason === 'data')).toBe(true);
      // İkinci geç kayıttan sonra da (abonelikler yeniden kurulur) duyulmaya devam eder.
      const second = dashboard.registerProvider({ id: 'late.two', moduleId: 'late', title: 'İki', defaultSize: 'small', priority: 40, fill: () => null });
      await settle();
      changes.length = 0;
      shown = false;
      dashboard.invalidate('late.card');
      await settle();
      expect(changes.length).toBeGreaterThan(0);
      second();
    } finally {
      off();
    }
  });

  it('doldurucusu fırlatan kart çizilmez, öteki kartlar etkilenmez', async () => {
    const off = dashboard.registerProvider({
      id: 'broken.card',
      moduleId: 'broken',
      title: 'Bozuk',
      defaultSize: 'small',
      priority: 99,
      fill: () => {
        throw new Error('patladı');
      },
    });
    try {
      createPlannerRepo(plannerCtx).createTodo({ text: 'Bir' }, 'user');
      await settle();
      expect(ids()).toEqual(['today', 'todos']);
    } finally {
      off();
    }
  });
});
