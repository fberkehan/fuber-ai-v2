import { afterEach, describe, expect, it } from 'vitest';
import {
  DASHBOARD_ROWS,
  DASHBOARD_SIZES,
  dashboard,
  dashboardGridMode,
  dashboardHoles,
  distributeRow,
  isEmptyCardData,
  orderDashboardCards,
  packDashboard,
  type DashboardLayoutItem,
  type DashboardSize,
} from './dashboard';

/** Belirleyici sözde rastgele sayı (sınama her koşuda aynı kümeleri üretir). */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const card = (id: string, size: DashboardSize): DashboardLayoutItem => ({ id, size });
const band: DashboardLayoutItem = { id: 'today', size: 'large', band: true };

const WIDTHS = [400, 600, 640, 666, 757, 900, 1100, 1300, 1700, 2000, 2400, 3200];

describe('ızgara kipi', () => {
  it('kabın genişliğine göre sütun sayısı artar; küçük kart hiçbir kipte yaklaşık 220 pikselin altına inmez', () => {
    expect(dashboardGridMode(400).columns).toBe(1);
    expect(dashboardGridMode(600).columns).toBe(6);
    expect(dashboardGridMode(666).columns).toBe(12);
    expect(dashboardGridMode(772).columns).toBe(12);
    expect(dashboardGridMode(1300).columns).toBe(12);
    expect(dashboardGridMode(1752).columns).toBe(18);
    expect(dashboardGridMode(2552).columns).toBe(24);
    for (const width of [520, 640, 1100, 1600, 2200]) {
      const mode = dashboardGridMode(width);
      const column = (width - (mode.columns - 1) * 16) / mode.columns;
      const small = mode.span.small * column + (mode.span.small - 1) * 16;
      expect(small, `${width} px`).toBeGreaterThanOrEqual(200);
    }
  });

  it('dar 12 sütunda küçük kart 4, geniş 12 sütunda 3 sütun ister', () => {
    expect(dashboardGridMode(800).span).toEqual({ small: 4, medium: 4, wide: 8, large: 8 });
    expect(dashboardGridMode(1200).span).toEqual({ small: 3, medium: 4, wide: 6, large: 8 });
  });
});

describe('satır bölüşümü', () => {
  it('toplam her zaman sütun sayısıdır ve hiçbir hücre istediğinden dar olmaz', () => {
    expect(distributeRow([8, 3], 12)).toEqual([8, 4]);
    expect(distributeRow([4, 4], 12)).toEqual([6, 6]);
    expect(distributeRow([4, 3, 3], 12)).toEqual([4, 4, 4]);
    expect(distributeRow([3, 3, 3, 3], 12)).toEqual([3, 3, 3, 3]);
    expect(distributeRow([6, 3], 12)).toEqual([8, 4]);
    expect(distributeRow([3], 12)).toEqual([12]);
    expect(distributeRow([3, 3], 6)).toEqual([3, 3]);
    expect(distributeRow([3], 6)).toEqual([6]);
    expect(distributeRow([8, 4, 4], 18)).toEqual([8, 5, 5]);
    expect(distributeRow([8, 4, 4, 3, 3], 24)).toEqual([8, 4, 4, 4, 4]);
  });

  it('belirleyicidir', () => {
    expect(distributeRow([4, 3, 3], 12)).toEqual(distributeRow([4, 3, 3], 12));
  });
});

describe('deliksiz ızgara', () => {
  it('her genişlikte ve her kart kümesinde delik ve üst üste binme yoktur; her kart tam bir kez yerleşir', () => {
    const random = rng(20261116);
    for (let round = 0; round < 400; round++) {
      const count = 1 + Math.floor(random() * 14);
      const items: DashboardLayoutItem[] = [band];
      for (let index = 0; index < count; index++) items.push(card(`k${index}`, DASHBOARD_SIZES[Math.floor(random() * DASHBOARD_SIZES.length)]!));
      for (const width of WIDTHS) {
        const mode = dashboardGridMode(width);
        const placements = packDashboard(items, mode);
        expect(placements.map((place) => place.id).sort(), `tur ${round}, ${width} px`).toEqual(items.map((item) => item.id).sort());
        expect(dashboardHoles(placements, mode.columns), `tur ${round}, ${width} px: ${JSON.stringify(items.map((item) => item.size))}`).toBe(0);
        for (const place of placements) {
          expect(place.col).toBeGreaterThanOrEqual(1);
          expect(place.col + place.span - 1).toBeLessThanOrEqual(mode.columns);
        }
      }
    }
  });

  it('bant en üstte, tam genişlikte ve tek başınadır; sıra nerede verilirse verilsin', () => {
    const mode = dashboardGridMode(1200);
    const placements = packDashboard([card('a', 'medium'), band, card('b', 'medium')], mode);
    expect(placements[0]).toEqual({ id: 'today', col: 1, span: 12, row: 1, rows: 1 });
    expect(placements.filter((place) => place.row === 1)).toHaveLength(1);
  });

  it('kartların sırası korunur (satır satır, soldan sağa)', () => {
    const mode = dashboardGridMode(1200);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const placements = packDashboard(
      ids.map((id) => card(id, 'medium')),
      mode,
    );
    const read = [...placements].sort((x, y) => x.row - y.row || x.col - y.col).map((place) => place.id);
    expect(read).toEqual(ids);
  });

  it('yüksek kartın yanındaki iki küçük kart üst üste yığılır ve toplam boyları yüksek kartınkine eşittir', () => {
    const mode = dashboardGridMode(1200);
    const placements = packDashboard([card('agenda', 'large'), card('weather', 'small'), card('fx', 'small')], mode);
    const byId = Object.fromEntries(placements.map((place) => [place.id, place]));
    expect(byId.agenda).toEqual({ id: 'agenda', col: 1, span: 8, row: 1, rows: 4 });
    expect(byId.weather).toEqual({ id: 'weather', col: 9, span: 4, row: 1, rows: 2 });
    expect(byId.fx).toEqual({ id: 'fx', col: 9, span: 4, row: 3, rows: 2 });
    expect(byId.weather!.rows + byId.fx!.rows).toBe(DASHBOARD_ROWS.large);
    expect(dashboardHoles(placements, 12)).toBe(0);
  });

  it('küçük kartlar yüksek karttan ÖNCE gelse de yığılır', () => {
    const placements = packDashboard([card('weather', 'small'), card('fx', 'small'), card('agenda', 'large')], dashboardGridMode(1200));
    const byId = Object.fromEntries(placements.map((place) => [place.id, place]));
    expect(byId.weather!.col).toBe(byId.fx!.col);
    expect(byId.agenda!.rows).toBe(4);
    expect(dashboardHoles(placements, 12)).toBe(0);
  });

  it('yüksek kartın yanında küçük + orta da yığılır; satır bir birim uzar ve yüksek kart ona uyar', () => {
    const placements = packDashboard([card('agenda', 'large'), card('jobs', 'small'), card('todos', 'medium')], dashboardGridMode(1200));
    const byId = Object.fromEntries(placements.map((place) => [place.id, place]));
    expect(byId.agenda).toMatchObject({ rows: 5 });
    expect(byId.jobs).toMatchObject({ row: 1, rows: 2 });
    expect(byId.todos).toMatchObject({ row: 3, rows: 3, col: byId.jobs!.col });
    expect(dashboardHoles(placements, 12)).toBe(0);
  });

  it('araya giren yüksek kart eşleşmeyi bozmaz: başa eklenen küçük kart, yüksek kartın öbür yanındaki küçükle yığılır', () => {
    const placements = packDashboard([card('yeni', 'small'), card('agenda', 'large'), card('weather', 'small'), card('fx', 'small')], dashboardGridMode(800));
    const byId = Object.fromEntries(placements.map((place) => [place.id, place]));
    expect(byId.yeni).toMatchObject({ col: 1, row: 1, rows: 2 });
    expect(byId.weather).toMatchObject({ col: 1, row: 3, rows: 2 });
    expect(byId.agenda).toMatchObject({ col: 5, span: 8, row: 1, rows: 4 });
    // Dördüncü kart bu satıra sığmaz; alt satırda tek başına tam genişliktedir.
    expect(byId.fx).toMatchObject({ col: 1, span: 12, row: 5 });
    expect(dashboardHoles(placements, 12)).toBe(0);
  });

  it('iki orta kart yığılmaz; orta + küçük + küçük dizisinde küçükler birbiriyle yığılır', () => {
    const wide = dashboardGridMode(1800);
    const two = packDashboard([card('agenda', 'large'), card('a', 'medium'), card('b', 'medium')], wide);
    expect(new Set(two.map((place) => place.col)).size).toBe(3);
    const mixed = packDashboard([card('agenda', 'large'), card('m', 'medium'), card('s1', 'small'), card('s2', 'small')], wide);
    const byId = Object.fromEntries(mixed.map((place) => [place.id, place]));
    expect(byId.s1!.col).toBe(byId.s2!.col);
    expect(byId.m!.col).not.toBe(byId.s1!.col);
    expect(byId.m!.rows).toBe(4);
    expect(dashboardHoles(mixed, 18)).toBe(0);
  });

  it('yüksek kart yokken küçük kartlar yan yana durur (yığılmaz)', () => {
    const placements = packDashboard([card('a', 'small'), card('b', 'small'), card('c', 'medium')], dashboardGridMode(1200));
    expect(new Set(placements.map((place) => place.col)).size).toBe(3);
    expect(new Set(placements.map((place) => place.rows))).toEqual(new Set([3]));
  });

  it('satırdaki kartlar aynı boydadır (en yükseğininki)', () => {
    const placements = packDashboard([card('a', 'medium'), card('b', 'small'), card('c', 'small')], dashboardGridMode(1200));
    expect(placements.map((place) => place.rows)).toEqual([3, 3, 3]);
    expect(placements.map((place) => place.row)).toEqual([1, 1, 1]);
  });

  it('boyut değişince yerleşim yeniden kurulur ve deliksiz kalır', () => {
    const mode = dashboardGridMode(1200);
    const base = [card('a', 'medium'), card('b', 'medium'), card('c', 'medium'), card('d', 'small')];
    const before = packDashboard(base, mode);
    for (const size of DASHBOARD_SIZES) {
      const after = packDashboard([{ ...base[0]!, size }, ...base.slice(1)], mode);
      expect(dashboardHoles(after, mode.columns), size).toBe(0);
      // Satır zaten gerilerek dolduğu için küçük bir boyut değişimi yerleşimi değiştirmeyebilir; yüksek boyut her zaman değiştirir.
      if (size === 'large') expect(after).not.toEqual(before);
    }
    const grown = packDashboard([{ ...base[0]!, size: 'large' }, ...base.slice(1)], mode);
    expect(grown.find((place) => place.id === 'a')).toMatchObject({ span: 8, rows: 4 });
  });

  it('son satırda tek başına kalan dar kart, kalabalık üst satırdan komşu alır', () => {
    const mode = dashboardGridMode(1200);
    const placements = packDashboard([card('a', 'medium'), card('b', 'medium'), card('c', 'medium'), card('d', 'small')], mode);
    const last = placements.filter((place) => place.id === 'c' || place.id === 'd');
    expect(new Set(last.map((place) => place.row)).size).toBe(1);
    expect(last.every((place) => place.span < 12)).toBe(true);
  });

  it('tek sütunda her kart kendi satırındadır; altı sütunda küçük kartlar ikişer dizilir', () => {
    const items = [card('a', 'small'), card('b', 'small'), card('c', 'large')];
    expect(packDashboard(items, dashboardGridMode(400)).map((place) => place.span)).toEqual([1, 1, 1]);
    const six = packDashboard(items, dashboardGridMode(600));
    expect(six.map((place) => place.span)).toEqual([3, 3, 6]);
  });

  it('geniş kapta satıra daha çok kart sığar (kartlar uzamaz)', () => {
    const items = Array.from({ length: 6 }, (_, index) => card(`k${index}`, 'medium'));
    const rows = (width: number) => new Set(packDashboard(items, dashboardGridMode(width)).map((place) => place.row)).size;
    expect(rows(1200)).toBe(2);
    expect(rows(1800)).toBe(2);
    expect(rows(2600)).toBe(1);
    const wide = packDashboard(items, dashboardGridMode(2600));
    expect(Math.max(...wide.map((place) => place.span))).toBeLessThanOrEqual(5);
  });

  it('boş girdi boş yerleşim verir', () => {
    expect(packDashboard([], dashboardGridMode(1200))).toEqual([]);
    expect(dashboardHoles([], 12)).toBe(0);
  });
});

describe('kart sırası', () => {
  const cards = [
    { id: 'today', band: true },
    { id: 'jobs', band: false },
    { id: 'agenda', band: false },
    { id: 'weather', band: false },
    { id: 'news', band: false },
  ];
  const priority = (item: { id: string }) => ({ today: 1000, jobs: 95, agenda: 90, weather: 88, news: 60, custom: 50 })[item.id] ?? 0;

  it('kayıtlı düzen yokken öncelik sırası geçerlidir; bant her zaman başta', () => {
    expect(orderDashboardCards([...cards].reverse(), [], priority).map((item) => item.id)).toEqual(['today', 'jobs', 'agenda', 'weather', 'news']);
  });

  it('kayıtlı sıra korunur; düzende olmayan yeni kart önceliğine göre araya girer', () => {
    const ordered = orderDashboardCards([...cards, { id: 'custom', band: false }], ['news', 'weather', 'agenda'], priority);
    // news, weather, agenda kullanıcının sırası; jobs (95) hepsinden öncelikli → başa; custom (50) kendinden düşük öncelikli yok → sona.
    expect(ordered.map((item) => item.id)).toEqual(['today', 'jobs', 'news', 'weather', 'agenda', 'custom']);
  });

  it('düzendeki artık çizilmeyen kimlikler yok sayılır', () => {
    expect(orderDashboardCards(cards, ['ghost', 'news', 'jobs', 'agenda', 'weather'], priority).map((item) => item.id)).toEqual(['today', 'news', 'jobs', 'agenda', 'weather']);
  });
});

describe('boş kart kuralı', () => {
  it('veri yoksa ya da bütün listeler boşsa kart boştur', () => {
    expect(isEmptyCardData(null)).toBe(true);
    expect(isEmptyCardData(undefined)).toBe(true);
    expect(isEmptyCardData('  ')).toBe(true);
    expect(isEmptyCardData([])).toBe(true);
    expect(isEmptyCardData({ items: [] })).toBe(true);
    expect(isEmptyCardData({ items: [], total: 0 })).toBe(true);
    expect(isEmptyCardData({ template: 'text', text: '' })).toBe(true);
    expect(isEmptyCardData({ template: 'list', items: [] })).toBe(true);
    expect(isEmptyCardData({})).toBe(true);
  });

  it('içeriği olan veri boş değildir', () => {
    expect(isEmptyCardData({ items: [{ id: 1 }], total: 1 })).toBe(false);
    expect(isEmptyCardData({ template: 'metric', value: '0' })).toBe(false);
    expect(isEmptyCardData({ costUsd: 0, budgetUsd: 10 })).toBe(false);
    expect(isEmptyCardData({ template: 'progress', value: 0 })).toBe(false);
    expect(isEmptyCardData(0)).toBe(false);
    expect(isEmptyCardData('metin')).toBe(false);
  });
});

describe('kart kaydı', () => {
  const offs: Array<() => void> = [];
  afterEach(() => {
    for (const off of offs.splice(0)) off();
  });

  it('kaydeder, kaldırır ve değişimi bildirir; aynı kimlik iki kez kaydedilemez', () => {
    const seen: string[] = [];
    offs.push(dashboard.subscribe((change) => seen.push(change.kind === 'invalidate' ? `invalidate:${change.id}` : change.kind)));
    const provider = { id: 'test.card', moduleId: 'test', title: 'Sınama', defaultSize: 'small' as const, priority: 10, fill: () => ({ data: { value: 1 } }) };
    const off = dashboard.registerProvider(provider);
    offs.push(off);
    expect(dashboard.providers().map((item) => item.id)).toContain('test.card');
    expect(() => dashboard.registerProvider({ ...provider })).toThrow(/iki kez/);
    dashboard.invalidate('test.card');
    dashboard.invalidate();
    off();
    off();
    expect(dashboard.providers().map((item) => item.id)).not.toContain('test.card');
    expect(seen).toEqual(['providers', 'invalidate:test.card', 'invalidate:null', 'providers']);
  });
});
