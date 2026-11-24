// FIN: borsa ve kripto izleme listesi. Kripto: Binance herkese açık uçları (`klines` + `ticker/24hr`); Binance
// ulaşılamazsa (bölge engeli vb.) aynı sembol Yahoo'nun `BTC-USD` ucundan alınır. Hisse/endeks/döviz: Yahoo Finance chart
// ucu (anahtarsız). Her sembol bağımsızdır: biri düşerse diğerleri akar; düşenin son değeri `stale` döner (15 dk'dan
// sonra listeden kalkar). Hiçbiri yoksa `off`.
import { BROWSER_UA, fetchJson, type Fetcher } from '../web/net';
import type { FinWatch, HudFin, HudFinItem } from './types';

export const FIN_TTL_MS = 30_000;
/** Bu süreden eski son değer gösterilmez. */
export const FIN_MAX_STALE_MS = 15 * 60_000;
export const SERIES_POINTS = 48;

/** Diziyi en çok `n` noktaya indirir (eşit aralıkla örnekler; son nokta korunur). */
export function downsample(values: number[], n = SERIES_POINTS): number[] {
  if (values.length <= n) return values;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(values[Math.round((i * (values.length - 1)) / (n - 1))]!);
  return out;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        instrumentType?: string;
        currentTradingPeriod?: { regular?: { start?: number; end?: number } };
      };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

/** Yahoo chart yanıtından öğe. */
export function parseYahoo(watch: FinWatch, json: YahooChart, nowMs: number, source: HudFinItem['source'] = 'yahoo'): HudFinItem {
  const r = json.chart?.result?.[0];
  const meta = r?.meta;
  const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter(finite);
  const price = finite(meta?.regularMarketPrice) ? meta.regularMarketPrice : closes.at(-1);
  if (!finite(price)) throw new Error('fiyat yok');
  const prev = finite(meta?.chartPreviousClose) ? meta.chartPreviousClose : finite(meta?.previousClose) ? meta.previousClose : closes[0];
  const changePct = finite(prev) && prev !== 0 ? ((price - prev) / prev) * 100 : 0;
  const period = meta?.currentTradingPeriod?.regular;
  const nowS = nowMs / 1000;
  const crypto = meta?.instrumentType === 'CRYPTOCURRENCY';
  const open = crypto || (finite(period?.start) && finite(period?.end) ? nowS >= period.start && nowS <= period.end : false);
  return {
    sym: watch.sym,
    name: watch.name,
    price,
    currency: meta?.currency ?? watch.currency,
    changePct: Math.round(changePct * 100) / 100,
    series: downsample(closes.length ? closes : [price]),
    open,
    source,
  };
}

interface BinanceTicker {
  lastPrice?: string;
  priceChangePercent?: string;
}

/** Binance: `klines` (5 dk, 24 saat) + `ticker/24hr`. */
export function parseBinance(watch: FinWatch, ticker: BinanceTicker, klines: unknown[]): HudFinItem {
  const price = Number(ticker.lastPrice);
  const pct = Number(ticker.priceChangePercent);
  if (!finite(price)) throw new Error('fiyat yok');
  const closes = klines.map((k) => (Array.isArray(k) ? Number(k[4]) : NaN)).filter(finite);
  return {
    sym: watch.sym,
    name: watch.name,
    price,
    currency: watch.currency,
    changePct: finite(pct) ? Math.round(pct * 100) / 100 : 0,
    series: downsample(closes.length ? closes : [price]),
    open: true,
    source: 'binance',
  };
}

export interface FinSourceDeps {
  fetcher: Fetcher;
  now?: () => number;
}

export interface FinSource {
  refresh(list: readonly FinWatch[], focus: string, force?: boolean): Promise<HudFin>;
  current(focus?: string): HudFin;
}

export function createFinSource(deps: FinSourceDeps): FinSource {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { item: HudFinItem; at: number }>();
  let lastRun = 0;
  let inflight: Promise<HudFin> | null = null;
  let anyAttempt = false;

  const yahoo = async (watch: FinWatch, ticker: string, source: HudFinItem['source']): Promise<HudFinItem> => {
    const json = await fetchJson<YahooChart>(deps.fetcher, `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m`, {
      timeoutMs: 8000,
      maxBytes: 400_000,
      headers: { 'User-Agent': BROWSER_UA },
    });
    return parseYahoo(watch, json, now(), source);
  };

  async function one(watch: FinWatch): Promise<HudFinItem> {
    if (watch.source === 'binance') {
      try {
        const sym = encodeURIComponent(watch.ticker);
        const [ticker, klines] = await Promise.all([
          fetchJson<BinanceTicker>(deps.fetcher, `https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`, { timeoutMs: 6000, maxBytes: 20_000 }),
          fetchJson<unknown[]>(deps.fetcher, `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=5m&limit=288`, { timeoutMs: 6000, maxBytes: 200_000 }),
        ]);
        return parseBinance(watch, ticker, klines);
      } catch {
        if (!/USDT$/.test(watch.ticker)) throw new Error('Binance ulaşılamadı');
        return yahoo(watch, `${watch.ticker.slice(0, -4)}-USD`, 'yahoo');
      }
    }
    return yahoo(watch, watch.ticker, 'yahoo');
  }

  function view(list: readonly FinWatch[], focus: string): HudFin {
    const t = now();
    const items: HudFinItem[] = [];
    let stale = false;
    for (const w of list) {
      const hit = cache.get(w.sym);
      if (!hit || t - hit.at > FIN_MAX_STALE_MS) continue;
      if (t - hit.at > FIN_TTL_MS * 3) stale = true;
      items.push(hit.item);
    }
    const focusItem = items.find((i) => i.sym === focus) ?? items[0];
    const missing = list.length - items.length;
    const status: HudFin['status'] = items.length === 0 ? 'off' : stale || missing > 0 ? 'stale' : 'ok';
    const latest = Math.max(0, ...[...cache.values()].map((c) => c.at));
    return { status, marketOpen: focusItem?.open ?? false, focus: focusItem?.sym ?? focus, items, ...(latest ? { fetchedAt: latest } : {}) };
  }

  let lastList: readonly FinWatch[] = [];
  let lastFocus = '';
  return {
    current: (focus) => view(lastList, focus ?? lastFocus),
    async refresh(list, focus, force = false) {
      lastList = list;
      lastFocus = focus;
      if (inflight) return inflight;
      if (!force && anyAttempt && now() - lastRun < FIN_TTL_MS) return view(list, focus);
      inflight = (async () => {
        anyAttempt = true;
        lastRun = now();
        const results = await Promise.allSettled(list.map((w) => one(w)));
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') cache.set(list[i]!.sym, { item: r.value, at: now() });
        });
        inflight = null;
        return view(list, focus);
      })();
      return inflight;
    },
  };
}
