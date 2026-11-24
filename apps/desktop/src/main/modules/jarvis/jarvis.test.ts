import { describe, expect, it, vi } from 'vitest';
import type { Reminder, Todo } from '@fuber/shared';
import { buildCal, overdueCount, CAL_HINT } from './cal';
import { createCoreSource, parseNvidiaSmi } from './core';
import { createEnvSource, windDirOf } from './env';
import { createFinSource, downsample, parseBinance, parseYahoo } from './fin';
import { buildLinks, createLinksSource, qualityOf } from './links';
import { HUD_VOICE_MIN_GAP_MS, VoiceHudTracker, hudStateOf, levelFromRms, rmsOfPcm16 } from './voice-level';
import { AutoPalette, computeLoad, HYSTERESIS, LEVEL_MIN, MIN_DWELL_MS, PALETTE_OF, levelOfScore, type LoadInputs } from './load';
import { LogRing } from './log';
import { JarvisService, defaultConfig, sanitizeConfig, type JarvisDeps } from './service';
import { greetingFor, summaryFor } from './snapshot';
import { DEFAULT_WATCHLIST, type HudSnapshot } from './types';
import type { Fetcher } from '../web/net';

/** Sahte `fetch`: adres `match` içeriyorsa gövde döner; `Error` verilirse ağ hatası. */
function fakeFetch(routes: Array<{ match: string; body: unknown | Error; status?: number }>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route || route.body instanceof Error) throw route?.body ?? new Error('rota yok');
    return { status: route.status ?? 200, url, contentType: 'application/json', charset: 'utf-8', body: Buffer.from(JSON.stringify(route.body)), truncated: false };
  }) as Fetcher & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const GEO = { results: [{ name: 'İstanbul', latitude: 41.01, longitude: 28.97, country_code: 'TR', country: 'Türkiye', admin1: 'İstanbul', population: 15_000_000, feature_code: 'PPLA' }] };
const hours = Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? '18' : '19'}T${String(i % 24).padStart(2, '0')}:00`);
const FORECAST = {
  current: { time: '2026-11-18T14:15', temperature_2m: 12.46, apparent_temperature: 10.2, weather_code: 3, wind_speed_10m: 18.4, wind_direction_10m: 200, relative_humidity_2m: 71 },
  hourly: {
    time: hours,
    temperature_2m: hours.map((_, i) => i),
    visibility: hours.map(() => 24140),
    uv_index: hours.map(() => 1.2),
    precipitation_probability: hours.map((_, i) => (i === 15 ? 40 : 5)),
  },
};

describe('env (Open-Meteo)', () => {
  it('şehri çözer, saatlik tahmini ve alanları üretir', async () => {
    const f = fakeFetch([{ match: 'geocoding-api', body: GEO }, { match: 'api.open-meteo.com', body: FORECAST }]);
    const env = createEnvSource({ fetcher: f, now: () => 1000 });
    const r = await env.refresh('İstanbul');
    expect(r.status).toBe('ok');
    expect(r.place).toBe('İstanbul');
    expect(r.source).toBe('settings');
    expect(r.tempC).toBe(12.5);
    expect(r.condition).toBe('kapalı');
    expect(r.windKmh).toBe(18);
    expect(r.windDir).toBe('G');
    expect(r.humidity).toBe(71);
    expect(r.visibilityKm).toBe(24.1);
    expect(r.hourly.map((h) => h.time)).toEqual(['14:00', '16:00', '18:00', '20:00', '22:00', '00:00']);
    expect(r.hourly[0]!.tempC).toBe(14);
    expect(r.rainPct).toBe(40);
    expect(f.calls.some((u) => u.includes('hourly='))).toBe(true);
  });

  it('10 dk önbellek: ikinci çağrı ağa gitmez; süre dolunca gider', async () => {
    let t = 0;
    const f = fakeFetch([{ match: 'geocoding-api', body: GEO }, { match: 'api.open-meteo.com', body: FORECAST }]);
    const env = createEnvSource({ fetcher: f, now: () => t });
    await env.refresh('İstanbul');
    const n = f.calls.length;
    await env.refresh('İstanbul');
    expect(f.calls.length).toBe(n);
    t += 10 * 60_000 + 1;
    await env.refresh('İstanbul');
    expect(f.calls.length).toBeGreaterThan(n);
  });

  it('ayar yoksa IP konumuna düşer', async () => {
    const f = fakeFetch([{ match: 'ipwho.is', body: { success: true, city: 'Ankara', latitude: 39.9, longitude: 32.8 } }, { match: 'api.open-meteo.com', body: FORECAST }]);
    const r = await createEnvSource({ fetcher: f }).refresh(null);
    expect(r.source).toBe('ip');
    expect(r.place).toBe('Ankara');
    expect(r.lat).toBe(39.9);
  });

  it('hata olunca son iyi veri stale, çok eskiyse/hiç yoksa off', async () => {
    let t = 0;
    const routes: Array<{ match: string; body: unknown | Error }> = [{ match: 'geocoding-api', body: GEO }, { match: 'api.open-meteo.com', body: FORECAST }];
    const f = ((url: string, o?: unknown) => fakeFetch(routes)(url, o as never)) as Fetcher;
    const env = createEnvSource({ fetcher: f, now: () => t });
    await env.refresh('İstanbul');
    routes[1]!.body = new Error('ağ yok');
    t += 11 * 60_000;
    expect((await env.refresh('İstanbul')).status).toBe('stale');
    t += 4 * 3600_000;
    const off = await env.refresh('İstanbul');
    expect(off.status).toBe('off');
    expect(off.place).toBe('');
  });

  it('hiç yer bulunamazsa off (sahte sayı yok)', async () => {
    const f = fakeFetch([]);
    const r = await createEnvSource({ fetcher: f }).refresh(null);
    expect(r.status).toBe('off');
    expect(r.tempC).toBe(0);
  });

  it('rüzgâr yönü sekiz yönlü', () => {
    expect([0, 45, 90, 180, 270, 359].map(windDirOf)).toEqual(['K', 'KD', 'D', 'G', 'B', 'K']);
  });
});

describe('fin (Binance + Yahoo)', () => {
  const yahooBody = (price: number, prev: number, start = 0, end = 4e9) => ({
    chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: price, chartPreviousClose: prev, currentTradingPeriod: { regular: { start, end } } }, indicators: { quote: [{ close: [prev, null, price - 1, price] }] } }] },
  });

  it('Yahoo: yüzde değişim, seri, piyasa açık', () => {
    const w = DEFAULT_WATCHLIST[5]!;
    const item = parseYahoo(w, yahooBody(110, 100), 1_000_000);
    expect(item.changePct).toBe(10);
    expect(item.series).toEqual([100, 109, 110]);
    expect(item.open).toBe(true);
    expect(parseYahoo(w, yahooBody(110, 100, 5e9, 6e9), 1_000_000).open).toBe(false);
  });

  it('Binance: fiyat, yüzde ve kline kapanışları', () => {
    const item = parseBinance(DEFAULT_WATCHLIST[0]!, { lastPrice: '65000.5', priceChangePercent: '-1.234' }, [[0, '1', '1', '1', '64000'], [0, '1', '1', '1', '65000']]);
    expect(item).toMatchObject({ sym: 'BTC', price: 65000.5, changePct: -1.23, series: [64000, 65000], open: true, source: 'binance' });
  });

  it('seri azaltma son noktayı korur', () => {
    const out = downsample(Array.from({ length: 300 }, (_, i) => i), 48);
    expect(out.length).toBe(48);
    expect(out.at(-1)).toBe(299);
    expect(out[0]).toBe(0);
  });

  it('bir sembol düşerse diğerleri akar (stale); hepsi düşerse off', async () => {
    let now = 0;
    const routes: Array<{ match: string; body: unknown | Error }> = [
      { match: 'ticker/24hr', body: { lastPrice: '100', priceChangePercent: '1' } },
      { match: 'klines', body: [[0, 0, 0, 0, '99'], [0, 0, 0, 0, '100']] },
      { match: 'chart/AAPL', body: yahooBody(200, 190) },
      { match: 'chart/NVDA', body: new Error('429') },
    ];
    const f = ((url: string, o?: unknown) => fakeFetch(routes)(url, o as never)) as Fetcher;
    const src = createFinSource({ fetcher: f, now: () => now });
    const list = [DEFAULT_WATCHLIST[0]!, DEFAULT_WATCHLIST[5]!, DEFAULT_WATCHLIST[6]!];
    const r = await src.refresh(list, 'BTC');
    expect(r.items.map((i) => i.sym)).toEqual(['BTC', 'AAPL']);
    expect(r.status).toBe('stale');
    expect(r.focus).toBe('BTC');
    expect(r.marketOpen).toBe(true);
    for (const x of routes) x.body = new Error('çöktü');
    now += 16 * 60_000;
    const off = await src.refresh(list, 'BTC', true);
    expect(off.status).toBe('off');
    expect(off.items).toEqual([]);
  });

  it('Binance engelliyse aynı sembol Yahoo BTC-USD ucundan gelir', async () => {
    const f = fakeFetch([{ match: 'binance.com', body: new Error('451') }, { match: 'chart/BTC-USD', body: yahooBody(65000, 64000) }]);
    const r = await createFinSource({ fetcher: f }).refresh([DEFAULT_WATCHLIST[0]!], 'BTC');
    expect(r.items[0]).toMatchObject({ sym: 'BTC', price: 65000, source: 'yahoo' });
    expect(r.status).toBe('ok');
  });
});

describe('core (CPU/RAM/GPU)', () => {
  it('nvidia-smi satırını ayrıştırır', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4080 SUPER, 37, 3968, 16376, 61\n')).toEqual({ name: 'NVIDIA GeForce RTX 4080 SUPER', util: 37, vramUsedMb: 3968, vramTotalMb: 16376, tempC: 61 });
    expect(parseNvidiaSmi('')).toBeNull();
    expect(parseNvidiaSmi('hata')).toBeNull();
  });

  it('CPU iki okuma arasındaki farktan, RAM os değerlerinden; GPU okunursa dolar', async () => {
    let step = 0;
    const cpus = () => {
      step += 1;
      // her çekirdek: 100 birimlik pencerede 40 boşta → %60 yük
      return [{ idle: 40 * step, total: 100 * step }, { idle: 40 * step, total: 100 * step }];
    };
    const core = createCoreSource({
      cpus,
      totalmem: () => 16 * 2 ** 30,
      freemem: () => 8 * 2 ** 30,
      run: async () => 'RTX, 50, 4096, 16384, 55',
      now: () => 1000,
    });
    await core.pollGpu();
    const s = core.sample();
    expect(s.cpu).toBe(60);
    expect(s.ram).toBe(50);
    expect(s.gpu).toBe(50);
    expect(s.vram).toBe(25);
    expect(s.tempC).toBe(55);
    expect(s.tempSource).toBe('gpu');
    expect(s.value).toBe('60');
    expect(s.sub).toBe('GPU 50% · RAM 50%');
    expect(s.cpuSeries!.length).toBe(1);
  });

  it('nvidia-smi yoksa GPU/VRAM/sıcaklık null (sahte sayı yok)', async () => {
    const core = createCoreSource({ cpus: () => [{ idle: 1, total: 2 }], run: () => Promise.reject(new Error('ENOENT')), now: () => 1 });
    await core.pollGpu();
    const s = core.sample();
    expect(s.gpu).toBeNull();
    expect(s.vram).toBeNull();
    expect(s.tempC).toBeNull();
    expect(s.sub).toContain('GPU YOK');
  });
});

describe('links (TCP 443)', () => {
  it('gecikmeden kalite; ölçüm yoksa 0', () => {
    expect(qualityOf(30)).toBe(1);
    expect(qualityOf(600)).toBe(0);
    expect(qualityOf(null)).toBe(0);
    expect(qualityOf(315)).toBeCloseTo(0.5, 1);
  });

  it('ölçümler tek blokta; bağlı sayısı doğru', async () => {
    const probe = vi.fn(async (host: string) => (host === 'sunucu.example' ? null : 40));
    const src = createLinksSource({
      probe,
      targets: () => [
        { id: 'net', name: 'İNTERNET', kind: 'service', host: '1.1.1.1', detail: 'x' },
        { id: 'srv', name: 'SUNUCU', kind: 'server', host: 'sunucu.example', detail: 'y' },
      ],
    });
    await src.refresh(true);
    const links = buildLinks(src.results());
    expect(links.total).toBe(2);
    expect(links.linked).toBe(1);
    expect(links.items.find((i) => i.id === 'srv')).toMatchObject({ up: false, latencyMs: null, quality: 0 });
    expect(links.items.find((i) => i.id === 'net')).toMatchObject({ up: true, latencyMs: 40 });
    expect(probe).toHaveBeenCalledWith('1.1.1.1', 443, 2500);
  });

});

describe('cal (planner)', () => {
  const NOW = new Date(2026, 10, 18, 9, 0, 0).getTime();
  const rem = (id: string, h: number, m: number, extra: Partial<Reminder> = {}): Reminder => ({
    id,
    text: `Olay ${id}`,
    dueAt: new Date(2026, 10, 18, h, m).toISOString(),
    recurrence: null,
    status: 'scheduled',
    priority: 'normal',
    source: 'user',
    createdAt: '2026-11-01T00:00:00.000Z',
    firedAt: null,
    memoryId: null,
    ...extra,
  } as Reminder);

  it('bugünü saat sırasıyla verir, sıradakini işaretler ve geri sayar', () => {
    const cal = buildCal([rem('c', 15, 0), rem('a', 9, 30, { priority: 'high' }), rem('b', 11, 0)], NOW);
    expect(cal.status).toBe('ok');
    expect(cal.items.map((i) => i.time)).toEqual(['09:30', '11:00', '15:00']);
    expect(cal.items.map((i) => i.current)).toEqual([true, false, false]);
    expect(cal.items[0]!.place).toBe('ÖNEMLİ');
    expect(cal.nextInSec).toBe(30 * 60);
  });

  it('görevler takvimle birleşir; saatli olaylar önde', () => {
    const todo = { id: 't1', text: 'Fatura öde', notes: '', done: false, dueDay: '2026-11-18', priority: 'normal', source: 'user', order: 1, createdAt: '', doneAt: null } as unknown as Todo;
    const late = { ...todo, id: 't2', text: 'Rapor gönder', dueDay: '2026-11-16' } as Todo;
    const cal = buildCal({ reminders: [rem('a', 9, 30)], todos: [todo, late, { ...todo, id: 't3', done: true }] }, NOW);
    expect(cal.items.map((i) => [i.kind, i.title, i.place])).toEqual([
      ['event', 'Olay a', ''],
      ['todo', 'Fatura öde', 'GÖREV'],
      ['todo', 'Rapor gönder', 'GECİKMİŞ'],
    ]);
    expect(cal.eventCount).toBe(1);
    expect(cal.hint).toBeUndefined();
  });

  it('bugün hiç olay yoksa boş kutu değil: ipucu + açık görevler; hiçbir kaynak yoksa off', () => {
    const open = { id: 't9', text: 'Yarın aranacak', notes: '', done: false, dueDay: null, priority: 'normal', source: 'user', order: 1, createdAt: '', doneAt: null } as unknown as Todo;
    const cal = buildCal({ reminders: [], todos: [open] }, NOW);
    expect(cal).toMatchObject({ status: 'ok', eventCount: 0, hint: CAL_HINT });
    expect(cal.items.map((i) => i.title)).toEqual(['Yarın aranacak']);
    expect(buildCal({ reminders: [], todos: [] }, NOW).items).toEqual([]);
    expect(buildCal({ reminders: null, todos: null }, NOW).status).toBe('off');
  });

  it('modül kapalıysa off; tamamlananlar listede yok', () => {
    expect(buildCal(null, NOW)).toEqual({ status: 'off', nextInSec: null, items: [] });
    expect(buildCal([rem('d', 10, 0, { status: 'done' })], NOW).items).toEqual([]);
  });

  it('geçmişte kalan ve çalıp tamamlanmayanlar dikkat bekler', () => {
    expect(overdueCount([rem('x', 8, 0), rem('y', 10, 0), rem('z', 9, 0, { status: 'fired' })], NOW)).toBe(2);
    expect(overdueCount(null, NOW)).toBe(0);
  });
});

describe('log halka tamponu', () => {
  it('en yeni önde; kapasiteyi aşınca eskiyi atar; yineleneni atlar', () => {
    let t = new Date(2026, 10, 18, 7, 44, 5).getTime();
    const added: string[] = [];
    const ring = new LogRing(() => t, (e) => added.push(e.text), 3);
    ring.add('MSG', 'bir');
    expect(ring.add('MSG', 'bir')).toBeNull();
    t += 6000;
    ring.add('SYS', 'iki');
    ring.add('CAL', 'üç', 'ref:1');
    ring.add('FIN', 'dört');
    expect(ring.size()).toBe(3);
    expect(ring.recent().map((e) => e.text)).toEqual(['dört', 'üç', 'iki']);
    expect(ring.recent()[1]).toMatchObject({ tag: 'CAL', ref: 'ref:1', ts: '07:44:11' });
    expect(added).toEqual(['bir', 'iki', 'üç', 'dört']);
    expect(ring.add('X', '   ')).toBeNull();
  });
});

describe('log: tekilleştirilmiş sessiz satır', () => {
  it('upsert aynı anahtarı günceller (yeni satır açmaz) ve en üste alır; quiet satır Quest’e gitmez', () => {
    let t = new Date(2026, 10, 18, 19, 0, 0).getTime();
    const sent: string[] = [];
    const ring = new LogRing(() => t, (e) => sent.push(e.text));
    ring.upsert('conn:watch', 'BIO', 'SAAT · bağlı 19:00', { quiet: true });
    ring.add('MSG', 'başka bir olay');
    t += 60_000;
    ring.upsert('conn:watch', 'BIO', 'SAAT · bağlantı koptu 19:01', { quiet: true });
    ring.upsert('conn:watch', 'BIO', 'SAAT · bağlı 19:01', { quiet: true });
    expect(ring.size()).toBe(2);
    expect(ring.recent().map((e) => e.text)).toEqual(['SAAT · bağlı 19:01', 'başka bir olay']);
    expect(sent).toEqual(['başka bir olay']); // sessiz satırlar hud.log olmadı
    ring.upsert('x', 'SYS', 'sesli satır');
    expect(sent.at(-1)).toBe('sesli satır');
  });
});

describe('selam ve özet', () => {
  it('saate göre selam; hitap yoksa efendim', () => {
    expect(greetingFor(8, null)).toBe('Günaydın, efendim.');
    expect(greetingFor(14, 'hocam')).toBe('İyi günler, hocam.');
    expect(greetingFor(20, '')).toBe('İyi akşamlar, efendim.');
    expect(greetingFor(2, null)).toBe('İyi geceler, efendim.');
  });

  it('özet gerçek madde sayısını söyler', () => {
    expect(summaryFor(0, 0)).toBe('Bütün sistemler normal. Dikkatinizi bekleyen konu yok.');
    expect(summaryFor(3, 0)).toBe('Bütün sistemler normal. Dikkatinizi bekleyen 3 konu var.');
    expect(summaryFor(1, 2)).toBe('Bir bağlantıda sorun var. Dikkatinizi bekleyen 1 konu var.');
  });
});

describe('ayar', () => {
  it('bozuk ayar varsayılana döner; izleme listesi doğrulanır', () => {
    expect(sanitizeConfig(null)).toEqual(defaultConfig());
    const c = sanitizeConfig({ palette: 'pembe', tab: 'x', city: '  Bursa ', watchlist: [{ sym: 'tsla', ticker: 'TSLA' }, { sym: 'kötü', ticker: 'a b;c' }], focus: '' });
    expect(c.palette).toBe('cyan');
    expect(c.tab).toBe('overview');
    expect(c.city).toBe('Bursa');
    expect(c.watchlist).toEqual([{ sym: 'TSLA', name: 'TSLA', source: 'yahoo', ticker: 'TSLA', currency: 'USD' }]);
  });

  it('varsayılan izleme listesi istenen yedi sembol', () => {
    expect(defaultConfig().watchlist.map((w) => w.sym)).toEqual(['BTC', 'ETH', 'USD/TRY', 'BIST100', 'NASDAQ', 'AAPL', 'NVDA']);
  });
});

// ───────── servis: birleştirme + köprü eylemleri ─────────

function makeService(over: Partial<JarvisDeps> = {}) {
  let t = new Date(2026, 10, 18, 9, 0, 0).getTime();
  const emitted: HudSnapshot[] = [];
  const sent: Array<{ msg: Record<string, unknown> }> = [];
  const panic = vi.fn();
  const navigate = vi.fn();
  let saved = defaultConfig();
  const deps: JarvisDeps = {
    now: () => t,
    env: { refresh: async () => ({ status: 'off', place: '', lat: 0, lon: 0, tempC: 0, condition: '', windKmh: 0, windDir: '', humidity: 0, visibilityKm: 0, hourly: [] }), current: () => ({ status: 'ok', place: 'İstanbul', lat: 41, lon: 29, tempC: 12, condition: 'açık', windKmh: 5, windDir: 'K', humidity: 50, visibilityKm: 10, hourly: [] }) },
    fin: { refresh: async () => ({ status: 'off', marketOpen: false, focus: 'BTC', items: [] }), current: () => ({ status: 'off', marketOpen: false, focus: 'BTC', items: [] }) },
    core: createCoreSource({ cpus: () => [{ idle: 1, total: 2 }], run: () => Promise.reject(new Error('yok')), now: () => t }),
    links: { refresh: async () => undefined, results: () => [] },
    config: { load: () => saved, save: (c) => void (saved = c) },
    reads: {
      cal: () => ({ reminders: [], todos: [] }),
      notices: () => [{ ref: 'notice:1', ts: '2026-11-18T08:00:00Z', title: 'Bildirim', body: '', moduleId: 'mail', pending: true }],
      jobs: () => [],
      address: () => null,
      approvals: () => 0,
    },
    targets: () => [],
    emit: (s) => void emitted.push(s),
    publish: (msg) => void sent.push({ msg }),
    panic,
    navigate,
    node: 'TEST-PC',
    timeZone: 'Europe/Istanbul',
    live: false,
    ...over,
  };
  const svc = new JarvisService(deps);
  return { svc, emitted, sent, panic, navigate, advance: (ms: number) => void (t += ms), getSaved: () => saved };
}

describe('JarvisService', () => {
  it('kaynakları tek anlık görüntüde birleştirir (sözleşme alanları dolu)', async () => {
    const { svc, emitted } = makeService();
    const s = await svc.tick(true);
    expect(emitted).toHaveLength(1);
    expect(s.greeting).toBe('Günaydın, efendim.');
    expect(s.paletteMode).toBe('auto');
    expect(s.palette).toBe('ice'); // yalnız 1 normal bildirim bekliyor → sakin → BUZ
    expect(s.load).toMatchObject({ level: 'calm' });
    expect(s.voice).toEqual({ state: 'idle' });
    expect(s.tab).toBe('overview');
    expect(s.env.place).toBe('İstanbul');
    expect(s.core.label).toBe('ÇEKİRDEK YÜKÜ');
    expect(s.links.items).toEqual([]);
    expect(s).not.toHaveProperty('bio');
    expect(s.summary).toContain('1 konu');
    expect(s.notices![0]!.pending).toBe(true);
    expect(s.seq).toBe(1);
    expect(s.node).toBe('TEST-PC');
    expect(s.clock.time).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(s.log).toEqual([]);
  });

  it('hud.action: sekme ve palet değişir, kalıcı yazılır; geçersiz sekme yok sayılır', () => {
    const { svc, getSaved } = makeService();
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'tab', tab: 'workshop' });
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'palette', palette: 'ember' });
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'tab', tab: 'yok' }); // geçersiz: yok sayılır
    expect(svc.getConfig()).toMatchObject({ tab: 'workshop', palette: 'ember' });
    expect(getSaved()).toMatchObject({ tab: 'workshop', palette: 'ember' });
    expect(svc.build()).toMatchObject({ tab: 'workshop', palette: 'ember' });
  });

  it('hud.action open: takvim olayı planlayıcıyı açar; stop acil durdurmaya bağlanır; hud.action dışı iletiler yok sayılır', () => {
    const { svc, panic, navigate } = makeService();
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'open', ref: 'cal:abc' });
    expect(navigate).toHaveBeenCalledWith('planner');
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'open', ref: 'bilinmeyen' });
    svc.onDeviceMessage('watch', { t: 'bio.sample', hr: 70 });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(panic).not.toHaveBeenCalled();
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'stop' });
    expect(panic).toHaveBeenCalledTimes(1);
    expect(svc.log.recent()[0]).toMatchObject({ tag: 'SYS' });
  });

  it('yeni log satırı cihaz eklentilerine hud.log olarak anında yayımlanır', () => {
    const { svc, sent } = makeService();
    svc.log.add('MSG', 'Yeni bildirim', 'notice:9');
    expect(sent).toEqual([{ msg: { t: 'hud.log', entry: expect.objectContaining({ tag: 'MSG', text: 'Yeni bildirim', ref: 'notice:9' }) } }]);
  });

  it('ayar: şehir ve izleme listesi değişir, odak listede yoksa ilkine döner', () => {
    const { svc } = makeService();
    svc.setConfig({ city: 'Bursa', watchlist: [{ sym: 'tsla', ticker: 'TSLA', source: 'yahoo' }], focus: 'YOK' });
    expect(svc.getConfig().city).toBe('Bursa');
    expect(svc.getConfig().watchlist.map((w) => w.sym)).toEqual(['TSLA']);
    expect(svc.getConfig().focus).toBe('TSLA');
  });
});

// ───────── demo.16: ses seviyesi, yoğunluk/otomatik palet ─────────

/** Sentetik 16 bit PCM: `amp` tepe genlikli sinüs (tam ölçek 32767). */
const sine = (amp: number, n = 1600, hz = 220, rate = 16000) => Int16Array.from({ length: n }, (_, i) => Math.round(amp * 32767 * Math.sin((2 * Math.PI * hz * i) / rate)));

describe('ses seviyesi (RMS → level)', () => {
  it('sinüsün RMS’i genlik/√2; sessizlik 0', () => {
    expect(rmsOfPcm16(sine(1, 16000))).toBeCloseTo(Math.SQRT1_2, 2);
    expect(rmsOfPcm16(sine(0.1, 16000))).toBeCloseTo(0.0707, 3);
    expect(rmsOfPcm16(new Int16Array(800))).toBe(0);
    expect(rmsOfPcm16([])).toBe(0);
  });

  it('seviye sessizlikte 0, sesle monoton artar, 0..1 içinde kalır', () => {
    const lv = [0, 0.001, 0.01, 0.05, 0.2, 0.7, 1].map(levelFromRms);
    expect(lv[0]).toBe(0);
    expect(lv[1]).toBe(0); // -60 dBFS: sessiz sayılır
    for (let i = 1; i < lv.length; i += 1) expect(lv[i]!).toBeGreaterThanOrEqual(lv[i - 1]!);
    expect(lv.at(-1)).toBe(1);
    expect(levelFromRms(rmsOfPcm16(sine(0.1)))).toBeGreaterThan(0.4); // olağan konuşma sesi orta-üst
    expect(levelFromRms(rmsOfPcm16(sine(0.005)))).toBeLessThan(0.1);
    expect(levelFromRms(Number.NaN)).toBe(0);
  });

  it('ses katmanı durumları HUD durumuna eşlenir', () => {
    expect(['listening', 'followup', 'thinking', 'speaking', 'idle', 'mic_off'].map(hudStateOf)).toEqual(['listening', 'listening', 'thinking', 'speaking', 'idle', 'idle']);
  });

  it('izleyici: ≈15 Hz’e seyreltir, yalnız duruma uyan kaynağı sayar, geçişte bir ileti verir', () => {
    const t = new VoiceHudTracker();
    expect(t.setState('speaking', 1000)).toEqual({ t: 'hud.voice', state: 'speaking', level: 0 });
    expect(t.setState('speaking', 1001)).toBeNull();
    const rms = rmsOfPcm16(sine(0.2));
    expect(t.onRms('mic', rms, 1100)).toBeNull(); // konuşurken mikrofon sayılmaz
    const first = t.onRms('speaker', rms, 1100)!;
    expect(first).toMatchObject({ t: 'hud.voice', state: 'speaking' });
    expect(first.level).toBeGreaterThan(0.3);
    expect(t.onRms('speaker', rms, 1100 + HUD_VOICE_MIN_GAP_MS - 1)).toBeNull();
    expect(t.onRms('speaker', rms, 1100 + HUD_VOICE_MIN_GAP_MS)).not.toBeNull();
    // 15 Hz: 1 sn’de en çok 16 ileti
    let n = 0;
    for (let ms = 5000; ms < 6000; ms += 10) if (t.onRms('speaker', rms, ms)) n += 1;
    expect(n).toBeLessThanOrEqual(16);
    expect(n).toBeGreaterThanOrEqual(14);
    // sessizleşince seviye düşer, boşta ileti yok
    t.setState('listening', 7000);
    expect(t.onRms('speaker', rms, 7100)).toBeNull();
    expect(t.onRms('mic', 0, 7100)!.level).toBe(0);
    expect(t.setState('idle', 8000)).toMatchObject({ state: 'idle', level: 0 });
    expect(t.onRms('mic', rms, 8200)).toBeNull();
  });
});

describe('yoğunluk puanı', () => {
  const calm: LoadInputs = { remainingToday: 0, overdue: 0, approvals: 0, pending: { low: 0, normal: 0, high: 0, urgent: 0 }, nextInSec: null, jobs: 0 };

  it('boş gün 0 → sakin; sınır değerleri düzeyleri verir', () => {
    expect(computeLoad(calm)).toMatchObject({ score: 0, rawLevel: 'calm', reasons: [] });
    expect([0, 14, 15, 39, 40, 64, 65, 100].map(levelOfScore)).toEqual(['calm', 'calm', 'normal', 'normal', 'busy', 'busy', 'critical', 'critical']);
  });

  it('her girdi puana gerçek ağırlıkla girer ve nedeni yazılır', () => {
    const l = computeLoad({ ...calm, remainingToday: 3, approvals: 1, jobs: 2, nextInSec: 30 * 60, pending: { low: 0, normal: 2, high: 1, urgent: 0 } });
    // 12 (3 hatırlatıcı) + 10 (1 onay) + 10 (2 iş) + 12 (olaya 30 dk) + 10 (2 normal + 1 önemli: 4+6)
    expect(l.score).toBe(54);
    expect(l.rawLevel).toBe('busy');
    expect(l.reasons).toEqual(expect.arrayContaining(['bugün 3 hatırlatıcı kaldı', '1 onay bekliyor', '2 iş sürüyor', 'sıradaki olaya 30 dk', '3 bekleyen bildirim']));
  });

  it('olaya kalan süre yaklaştıkça artar', () => {
    const s = (sec: number | null) => computeLoad({ ...calm, nextInSec: sec }).score;
    expect([s(null), s(4 * 3600), s(2 * 3600), s(40 * 60), s(5 * 60)]).toEqual([0, 0, 5, 12, 20]);
  });

  it('iki gecikmiş ya da acil bildirim puandan bağımsız KOR (kritik) yapar', () => {
    expect(computeLoad({ ...calm, overdue: 2 })).toMatchObject({ rawLevel: 'critical', forceCritical: true, score: 30 });
    expect(computeLoad({ ...calm, overdue: 1 }).forceCritical).toBe(false);
    expect(computeLoad({ ...calm, pending: { low: 0, normal: 0, high: 0, urgent: 1 } })).toMatchObject({ rawLevel: 'critical', forceCritical: true });
  });

  it('düzey → palet eşlemesi: sakin BUZ, normal CAMGÖBEĞİ, yoğun MAVİ, kritik KOR', () => {
    expect(PALETTE_OF).toEqual({ calm: 'ice', normal: 'cyan', busy: 'blue', critical: 'ember' });
  });
});

describe('otomatik palet: histerezis + 2 dk bekleme', () => {
  const at = (score: number, extra: Partial<ReturnType<typeof computeLoad>> = {}) => ({ score, rawLevel: levelOfScore(score), forceCritical: false, reasons: [], ...extra });

  it('ilk ölçüm bekletilmez; sonraki değişim 2 dk dolmadan olmaz', () => {
    const a = new AutoPalette();
    let t = 0;
    expect(a.update(at(20), t)).toBe('normal');
    t += 30_000;
    expect(a.update(at(50), t)).toBe('normal'); // yoğun ama 2 dk dolmadı
    t += MIN_DWELL_MS;
    expect(a.update(at(50), t)).toBe('busy');
  });

  it('eşik civarında salınan puan paleti titretmez (histerezis)', () => {
    const a = new AutoPalette();
    let t = 0;
    a.update(at(LEVEL_MIN.busy + 2), t);
    expect(a.level).toBe('busy');
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      t += MIN_DWELL_MS + 1000;
      // busy eşiğinin hemen altı ile üstü arasında gidip gelir: 5 puanlık pay içinde inmez
      seen.add(a.update(at(LEVEL_MIN.busy + (i % 2 ? -(HYSTERESIS - 1) : 3)), t));
    }
    expect([...seen]).toEqual(['busy']);
    // pay aşılınca iner
    t += MIN_DWELL_MS + 1000;
    expect(a.update(at(LEVEL_MIN.busy - HYSTERESIS - 1), t)).toBe('normal');
  });

  it('kritik düzeye çıkış beklemez; kritikten inişte 2 dk beklenir', () => {
    const a = new AutoPalette();
    let t = 0;
    a.update(at(10), t);
    t += 5000;
    expect(a.update(computeLoad({ remainingToday: 0, overdue: 2, approvals: 0, pending: { low: 0, normal: 0, high: 0, urgent: 0 }, nextInSec: null, jobs: 0 }), t)).toBe('critical');
    t += 5000;
    expect(a.update(at(10), t)).toBe('critical');
    t += MIN_DWELL_MS;
    expect(a.update(at(10), t)).toBe('calm');
  });
});

describe('hud.voice ve otomatik palet (servis)', () => {
  it('konuşma durumu: snapshot.voice anında, hud.voice cihaz eklentilerine yayımlanır; seviye gerçek RMS’ten', () => {
    const { svc, sent, emitted, advance } = makeService();
    svc.onVoiceText('Günaydın efendim, bugün üç işiniz var.');
    svc.onVoiceState('speaking');
    expect(sent.find((m) => m.msg.t === 'hud.voice')).toEqual({ msg: { t: 'hud.voice', state: 'speaking', level: 0 } });
    expect(emitted.at(-1)!.voice).toEqual({ state: 'speaking', text: 'Günaydın efendim, bugün üç işiniz var.' });
    advance(100);
    svc.onVoiceLevel('speaker', rmsOfPcm16(sine(0.2)));
    const lvl = sent.filter((m) => m.msg.t === 'hud.voice').at(-1)!.msg as { level: number };
    expect(lvl.level).toBeGreaterThan(0.3);
    svc.onVoiceState('thinking');
    expect(emitted.at(-1)!.voice).toMatchObject({ state: 'thinking' });
    svc.onVoiceState('idle');
    expect(emitted.at(-1)!.voice).toEqual({ state: 'idle' });
    expect(sent.filter((m) => m.msg.t === 'hud.voice').at(-1)!.msg).toMatchObject({ state: 'idle', level: 0 });
  });

  it('palet: varsayılan otomatik; elle seçim otomatiği kapatır; "auto" geri açar', () => {
    const { svc, getSaved } = makeService();
    expect(svc.build()).toMatchObject({ paletteMode: 'auto', palette: 'ice' });
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'palette', palette: 'ember' });
    expect(svc.build()).toMatchObject({ paletteMode: 'manual', palette: 'ember' });
    expect(getSaved()).toMatchObject({ paletteMode: 'manual', palette: 'ember' });
    svc.onDeviceMessage('quest', { t: 'hud.action', action: 'palette', palette: 'auto' });
    expect(svc.build()).toMatchObject({ paletteMode: 'auto', palette: 'ice' });
    svc.setPalette('blue');
    expect(svc.getConfig()).toMatchObject({ paletteMode: 'manual', palette: 'blue' });
  });

  it('yoğunluk gerçek girdilerden: bekleyen onay + olay yaklaşınca puan artar ve palet yoğunlaşır', () => {
    let approvals = 0;
    const soon = Date.now() + 10 * 60_000;
    const reminders = [{ id: 'r1', text: 'x', dueAt: new Date(soon).toISOString(), recurrence: null, status: 'scheduled', priority: 'normal', source: 'user', createdAt: '', firedAt: null, memoryId: null }] as unknown as Reminder[];
    const { svc, advance } = makeService({ now: () => Date.now(), reads: { cal: () => ({ reminders, todos: [] }), notices: () => [], jobs: () => [], address: () => null, approvals: () => approvals } });
    void advance;
    const a = svc.build();
    expect(a.load!.reasons.some((r) => r.startsWith('sıradaki olaya'))).toBe(true);
    approvals = 2;
    const b = svc.build();
    expect(b.load!.score).toBeGreaterThan(a.load!.score);
    expect(b.load!.reasons).toContain('2 onay bekliyor');
  });
});

