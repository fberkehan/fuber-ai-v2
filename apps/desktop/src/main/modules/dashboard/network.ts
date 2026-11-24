// Kokpit'in ağdan gelen kartları: hava (Open-Meteo), döviz (TCMB → ECB), haber başlıkları (yayıncı RSS akışları).
// Çözücüler web modülününkilerdir (`modules/web/{weather,facts,news}.ts`); burada yalnız pano kuralları var:
//
//  - Pano okuması ağı BEKLEMEZ: kart son iyi veriden (bellek + `dashboard_cache`) çizilir, veri bayatsa arka planda
//    yenilenir ve bitince pano yeniden yayınlanır.
//  - Tazelik: hava 30 dk, haber 15 dk, döviz 60 dk (v1 `TAZELIK_MS`). Başarısız denemeden sonra 2 dk'dan başlayıp her
//    hatada ikiye katlanan, en çok 30 dk'lık bekleme (v1 `geriCekilmeMs`).
//  - Ağ yokken ya da Gizli kipte (`policy.networkAllowed()`): veri varsa "şu saatte alındı" notuyla (`stale`) gösterilir,
//    hiç yoksa kart ÇİZİLMEZ. Çok eskiyen veri (hava 12 saat, haber 24 saat, döviz 7 gün) hiç gösterilmez.
import type { DashboardFill, FxData, IsoDateTime, Logger, NewsData, WeatherData } from '@fuber/shared';
import { createFx, currencyName } from '../web/facts';
import { activeNews } from '../news/access';
import { createNews } from '../web/news';
import type { Fetcher } from '../web/net';
import { createWeather } from '../web/weather';
import type { DashboardStore } from './store';

export type NetKey = 'weather' | 'fx' | 'news';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const NET_TTL_MS: Record<NetKey, number> = { weather: 30 * MINUTE, fx: 60 * MINUTE, news: 15 * MINUTE };
export const NET_MAX_AGE_MS: Record<NetKey, number> = { weather: 12 * HOUR, fx: 7 * 24 * HOUR, news: 24 * HOUR };

/** Başarısız denemeden sonraki bekleme: 2, 4, 8, 16, 30 dk. */
export function backoffMs(failures: number): number {
  return Math.min(30 * MINUTE, 2 * MINUTE * 2 ** Math.max(0, failures - 1));
}

/** Sistem saat diliminden varsayılan yer ve para (IP adresi hiçbir yere gönderilmez; v1 "Ruling BB"). */
const ZONE_PLACES: Record<string, string> = {
  'Europe/Istanbul': 'İstanbul',
  'Asia/Istanbul': 'İstanbul',
  'Europe/London': 'Londra',
  'Europe/Berlin': 'Berlin',
  'Europe/Paris': 'Paris',
  'Europe/Amsterdam': 'Amsterdam',
  'Europe/Vienna': 'Viyana',
  'Europe/Zurich': 'Zürih',
  'America/New_York': 'New York',
  'America/Los_Angeles': 'Los Angeles',
};

export interface Locale {
  place: string | null;
  /** Yerel para: kurlar bunun karşılığı olarak gösterilir. */
  currency: string;
  /** Haber bölgesi (`NEWS_SOURCES` anahtarı). */
  region: string;
}

export function localeFromZone(zone: string | undefined): Locale {
  const id = zone ?? '';
  const turkey = id === 'Europe/Istanbul' || id === 'Asia/Istanbul' || id === 'Turkey';
  const place = ZONE_PLACES[id] ?? (id.includes('/') ? id.split('/').pop()!.replace(/_/g, ' ') : null);
  if (turkey || !id) return { place: place ?? 'İstanbul', currency: 'TRY', region: 'TR' };
  if (id === 'Europe/London') return { place, currency: 'GBP', region: 'GB' };
  if (id.startsWith('America/')) return { place, currency: 'USD', region: 'US' };
  if (id.startsWith('Europe/')) return { place, currency: 'EUR', region: 'WORLD' };
  return { place, currency: 'USD', region: 'WORLD' };
}

interface SourceState {
  failures: number;
  /** Bu andan önce yeniden denenmez (başarısızlık beklemesi). */
  retryAt: number;
  inflight: Promise<void> | null;
  /** Son deneme başarısız mı (elde veri varsa "bayat" notu için). */
  failed: boolean;
}

export interface DashboardNetworkDeps {
  store: DashboardStore;
  fetcher: Fetcher;
  now?: () => number;
  /** Gizlilik kararı: ağ gerektiren iş yapılabilir mi (`policy.networkAllowed`). */
  networkAllowed(): boolean;
  /** Sistem saat dilimi; sınamada sabitlenir. */
  timeZone?: () => string | undefined;
  /** Bir kaynak yenilendi (ya da silindi): pano yeniden doldurulmalı. */
  onChange(key: NetKey): void;
  log: Logger;
}

export function createDashboardNetwork(deps: DashboardNetworkDeps) {
  const now = deps.now ?? Date.now;
  const weather = createWeather(deps.fetcher, now);
  const fx = createFx(deps.fetcher, now);
  const news = createNews(deps.fetcher, now);
  const state: Record<NetKey, SourceState> = {
    weather: { failures: 0, retryAt: 0, inflight: null, failed: false },
    fx: { failures: 0, retryAt: 0, inflight: null, failed: false },
    news: { failures: 0, retryAt: 0, inflight: null, failed: false },
  };
  let stopped = false;

  const locale = (): Locale => {
    const base = localeFromZone(deps.timeZone ? deps.timeZone() : Intl.DateTimeFormat().resolvedOptions().timeZone);
    const chosen = deps.store.config().weatherPlace;
    return chosen ? { ...base, place: chosen } : base;
  };

  const age = (fetchedAt: IsoDateTime) => now() - Date.parse(fetchedAt);

  async function loadWeather(): Promise<WeatherData> {
    const place = locale().place;
    if (!place) throw new Error('yer bilinmiyor');
    const report = await weather.get(place, 'week');
    const today = report.days[0];
    return {
      place: report.place.name,
      temperature: report.current?.temperature ?? null,
      feelsLike: report.current?.feelsLike ?? null,
      code: report.current?.code ?? today?.code ?? null,
      summary: report.current?.summary ?? today?.summary ?? '',
      min: today?.min ?? null,
      max: today?.max ?? null,
      precipitationChance: today?.precipitationChance ?? null,
      days: report.days.slice(1, 5).map((day) => ({ date: day.date, weekday: day.weekday, code: day.code, summary: day.summary, min: day.min, max: day.max })),
      attribution: report.attribution,
    };
  }

  /** Kurlar; değişim, bir önceki GÜNÜN kuruna (`reference`) göredir: aynı günün yinelenen okuması değişim göstermez. */
  async function loadFx(references: ReadonlyArray<FxData | null | undefined>): Promise<{ value: FxData; reference: FxData | null }> {
    const base = locale().currency;
    const codes = ['USD', 'EUR', 'GBP'].filter((code) => code !== base);
    const quotes = (await Promise.allSettled(codes.map((code) => fx.quote(code, base, 1)))).flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    if (quotes.length === 0) throw new Error('kur alınamadı');
    const date = quotes[0]!.date;
    const reference = references.find((candidate): candidate is FxData => !!candidate && candidate.base === base && candidate.date !== date) ?? null;
    const value: FxData = {
      base,
      date,
      source: quotes[0]!.source === 'TCMB' ? 'TCMB' : 'Avrupa Merkez Bankası',
      rates: quotes.map((quote) => {
        const before = reference?.rates.find((rate) => rate.code === quote.from);
        return {
          code: quote.from,
          name: currencyName(quote.from),
          rate: quote.rate,
          buying: quote.buying,
          selling: quote.selling,
          change: before && before.rate > 0 ? (quote.rate - before.rate) / before.rate : null,
        };
      }),
    };
    return { value, reference };
  }

  async function loadNews(): Promise<NewsData> {
    // Gündem modülü açıksa haber kartı kullanıcının KENDİ kaynaklarından, ilgisine göre dolar (KURGU §10.11). Yeterli
    // başlık yoksa (modül kapalı, ilk okuma bitmedi, sınamada kayıtlı yanıt verilmedi) eski sabit kaynak listesine düşülür.
    try {
      const personal = activeNews()?.stories({ limit: 8 }) ?? [];
      if (personal.length >= 3) return { items: personal.map((story) => ({ title: story.title, url: story.url, source: story.source, at: story.at })) };
    } catch (error) {
      deps.log?.debug?.(`pano: kişisel gündem okunamadı (${error instanceof Error ? error.message : String(error)})`);
    }
    const outcome = await news.get(locale().region, undefined, 8);
    if (outcome.items.length === 0) throw new Error('başlık alınamadı');
    return { items: outcome.items.map((item) => ({ title: item.title, url: item.url, source: item.source, at: item.at })) };
  }

  /** Kaynağı arka planda yeniler; sürmekte olan yenileme varsa onu döndürür. Hiç fırlatmaz. */
  function refresh(key: NetKey): Promise<void> {
    const source = state[key];
    if (source.inflight) return source.inflight;
    source.inflight = (async () => {
      try {
        if (key === 'weather') {
          deps.store.putCache<WeatherData>('weather', await loadWeather(), null);
        } else if (key === 'news') {
          deps.store.putCache<NewsData>('news', await loadNews(), null);
        } else {
          const cached = deps.store.cached<FxData>('fx');
          const next = await loadFx([cached?.value, cached?.previous]);
          deps.store.putCache<FxData>('fx', next.value, next.reference);
        }
        source.failures = 0;
        source.retryAt = 0;
        source.failed = false;
      } catch (error) {
        source.failures += 1;
        source.failed = true;
        source.retryAt = now() + backoffMs(source.failures);
        deps.log.debug(`pano: ${key} yenilenemedi`, error instanceof Error ? error.message : String(error));
      } finally {
        source.inflight = null;
        if (!stopped) deps.onChange(key);
      }
    })();
    return source.inflight;
  }

  /** Kaynağın şu an yenilenmesi gerekiyor mu (bayat ya da hiç yok; bekleme süresi dolmuş; ağ açık). */
  function due(key: NetKey): boolean {
    if (!deps.networkAllowed()) return false;
    const source = state[key];
    if (source.inflight || now() < source.retryAt) return false;
    const cached = deps.store.cached<unknown>(key);
    return !cached || age(cached.fetchedAt) >= NET_TTL_MS[key];
  }

  function read<T>(key: NetKey): DashboardFill<T> | null {
    const cached = deps.store.cached<T>(key);
    if (!cached) return null;
    const old = age(cached.fetchedAt);
    if (old > NET_MAX_AGE_MS[key]) return null;
    const expired = old >= NET_TTL_MS[key];
    // Bayat: süresi dolmuş VE yenilenemiyor (son deneme başarısız ya da ağ kapalı). Yenileme sürerken not gösterilmez.
    const stale = expired && (state[key].failed || !deps.networkAllowed());
    const nextCheck = expired ? Math.max(now() + MINUTE, state[key].retryAt) : Date.parse(cached.fetchedAt) + NET_TTL_MS[key];
    return { data: cached.value, updatedAt: cached.fetchedAt, stale, validUntil: new Date(nextCheck).toISOString() };
  }

  return {
    locale,
    weather: (): DashboardFill<WeatherData> | null => {
      const fill = read<WeatherData>('weather');
      return fill ? { ...fill, title: fill.data.place } : null;
    },
    fx: (): DashboardFill<FxData> | null => read<FxData>('fx'),
    news: (): DashboardFill<NewsData> | null => read<NewsData>('news'),
    /** Bayat kaynakları arka planda yeniler (pano her okunduğunda çağrılır; ağı beklemez). */
    ensureFresh(): void {
      for (const key of ['weather', 'fx', 'news'] as const) if (due(key)) void refresh(key);
    },
    /** Verilen kaynakları şimdi yeniler ve bitmesini bekler (yer değişince, sınamada). */
    async refreshNow(keys: readonly NetKey[] = ['weather', 'fx', 'news']): Promise<void> {
      if (!deps.networkAllowed()) return;
      for (const key of keys) {
        state[key].retryAt = 0;
      }
      await Promise.all(keys.map((key) => refresh(key)));
    },
    /** Yer değişti: eski yerin havası gösterilmez. */
    forgetWeather(): void {
      deps.store.dropCache('weather');
      weather.clear();
      state.weather = { failures: 0, retryAt: 0, inflight: state.weather.inflight, failed: false };
    },
    /** Çözücülerin bellek önbelleğini boşaltır (sınama: kayıtlı yanıt değişince eskisi dönmesin). */
    clearMemory(): void {
      weather.clear();
      fx.clear();
      news.clear();
    },
    stop(): void {
      stopped = true;
      weather.clear();
      fx.clear();
      news.clear();
    },
  };
}

export type DashboardNetwork = ReturnType<typeof createDashboardNetwork>;
