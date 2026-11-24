// ENV: hava. Open-Meteo (anahtarsız; koşullar için bkz. `web/weather.ts`). Konum sırası: JARVIS ayarındaki şehir →
// uygulamanın Kokpit hava şehri → IP'den kaba konum (`ipwho.is`) → saat dilimi. Saatlik tahmin gelir, önbellek 10 dk.
// Hata olursa son iyi veri `stale` (3 saate dek), yoksa `off`: sahte sayı ÜRETİLMEZ.
import { fetchJson, type Fetcher } from '../web/net';
import { describeCode, GEOCODE_COUNT, pickPlace, type Place } from '../web/weather';
import { fold, placeCandidates } from '../web/text';
import type { HudEnv } from './types';

export const ENV_TTL_MS = 10 * 60_000;
/** Bu süreden eski son-iyi veri artık "bayat" bile sayılmaz: kaynak `off`. */
export const ENV_MAX_STALE_MS = 3 * 3600_000;

interface IpWho {
  success?: boolean;
  city?: string;
  latitude?: number;
  longitude?: number;
}

interface Forecast {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    relative_humidity_2m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    visibility?: Array<number | null>;
    uv_index?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
  };
}

const DIRS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
export const windDirOf = (deg: number): string => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function emptyEnv(): HudEnv {
  return { status: 'off', place: '', lat: 0, lon: 0, tempC: 0, condition: '', windKmh: 0, windDir: '', humidity: 0, visibilityKm: 0, hourly: [], source: 'none' };
}

/** Open-Meteo yanıtından arayüz verisi. Eksik zorunlu alan (sıcaklık) varsa fırlatır. */
export function buildEnv(place: { name: string; lat: number; lon: number; source: HudEnv['source'] }, json: Forecast, fetchedAt: number): HudEnv {
  const cur = json.current;
  const temp = num(cur?.temperature_2m);
  if (!cur || temp === null) throw new Error('hava yanıtında sıcaklık yok');
  const times = json.hourly?.time ?? [];
  // `current.time` yerel saattir ("2026-11-18T14:15"); saatlik dizi de yerel. Geçerli saatin dizindeki yeri:
  const hourKey = (cur.time ?? '').slice(0, 13);
  let at = times.findIndex((t) => t.startsWith(hourKey));
  if (at < 0) at = 0;
  const hourly: HudEnv['hourly'] = [];
  for (let i = at; i < times.length && hourly.length < 6; i += 2) {
    const v = num(json.hourly?.temperature_2m?.[i]);
    if (v !== null) hourly.push({ time: `${(times[i] ?? '').slice(11, 13)}:00`, tempC: Math.round(v) });
  }
  const vis = num(json.hourly?.visibility?.[at]);
  const uv = num(json.hourly?.uv_index?.[at]);
  const rain = json.hourly?.precipitation_probability?.slice(at, at + 12).filter((x): x is number => typeof x === 'number') ?? [];
  const feels = num(cur.apparent_temperature);
  return {
    status: 'ok',
    place: place.name,
    lat: place.lat,
    lon: place.lon,
    tempC: Math.round(temp * 10) / 10,
    condition: describeCode(num(cur.weather_code)),
    windKmh: Math.round(num(cur.wind_speed_10m) ?? 0),
    windDir: windDirOf(num(cur.wind_direction_10m) ?? 0),
    humidity: Math.round(num(cur.relative_humidity_2m) ?? 0),
    visibilityKm: vis === null ? 0 : Math.round(vis / 100) / 10,
    ...(uv !== null ? { uv: Math.round(uv * 10) / 10 } : {}),
    hourly,
    source: place.source,
    ...(feels !== null ? { feelsC: Math.round(feels) } : {}),
    ...(rain.length ? { rainPct: Math.max(...rain) } : {}),
    fetchedAt,
  };
}

export interface EnvSourceDeps {
  fetcher: Fetcher;
  now?: () => number;
  /** Kokpit'in kayıtlı hava şehri (varsa). */
  appCity?: () => string | null;
  /** Saat dilimine göre varsayılan yer adı (son çare). */
  zonePlace?: () => string | null;
}

export interface EnvSource {
  /** `city`: JARVIS ayarındaki şehir. Önbellek tazeyse ağa gitmez. */
  refresh(city: string | null, force?: boolean): Promise<HudEnv>;
  current(): HudEnv;
}

export function createEnvSource(deps: EnvSourceDeps): EnvSource {
  const now = deps.now ?? Date.now;
  let last: HudEnv = emptyEnv();
  let lastKey = '';
  let inflight: Promise<HudEnv> | null = null;
  const placeCache = new Map<string, { place: { name: string; lat: number; lon: number }; at: number }>();
  let ipPlace: { name: string; lat: number; lon: number } | null | undefined;

  async function geocode(text: string): Promise<{ name: string; lat: number; lon: number } | null> {
    const key = fold(text);
    const hit = placeCache.get(key);
    if (hit) return hit.place;
    const [head, ...rest] = text.split(',');
    const qualifier = rest.join(' ').trim() ? placeCandidates(rest.join(' '))[0] : undefined;
    for (const candidate of placeCandidates(head ?? text).slice(0, 3)) {
      const json = await fetchJson<{ results?: unknown[] }>(
        deps.fetcher,
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=${GEOCODE_COUNT}&language=tr&format=json`,
        { timeoutMs: 6000, maxBytes: 300_000 },
      );
      const p: Place | null = pickPlace(json as Parameters<typeof pickPlace>[0], qualifier, candidate);
      if (p) {
        const place = { name: p.name, lat: p.latitude, lon: p.longitude };
        placeCache.set(key, { place, at: now() });
        return place;
      }
    }
    return null;
  }

  async function ipLocate(): Promise<{ name: string; lat: number; lon: number } | null> {
    if (ipPlace !== undefined) return ipPlace;
    try {
      const j = await fetchJson<IpWho>(deps.fetcher, 'https://ipwho.is/?fields=success,city,latitude,longitude', { timeoutMs: 5000, maxBytes: 20_000 });
      ipPlace = j.success !== false && typeof j.latitude === 'number' && typeof j.longitude === 'number' ? { name: j.city || 'Konumum', lat: j.latitude, lon: j.longitude } : null;
    } catch {
      return null; // bir dahaki turda yeniden denenir
    }
    return ipPlace;
  }

  async function resolve(city: string | null): Promise<{ name: string; lat: number; lon: number; source: NonNullable<HudEnv['source']> } | null> {
    const chosen = city?.trim() || null;
    if (chosen) {
      const p = await geocode(chosen);
      if (p) return { ...p, source: 'settings' };
    }
    const app = deps.appCity?.()?.trim();
    if (app) {
      const p = await geocode(app);
      if (p) return { ...p, source: 'settings' };
    }
    const ip = await ipLocate();
    if (ip) return { ...ip, source: 'ip' };
    const zone = deps.zonePlace?.();
    if (zone) {
      const p = await geocode(zone);
      if (p) return { ...p, source: 'timezone' };
    }
    return null;
  }

  async function load(city: string | null): Promise<HudEnv> {
    const place = await resolve(city);
    if (!place) throw new Error('konum bulunamadı');
    const query = new URLSearchParams({
      latitude: place.lat.toFixed(4),
      longitude: place.lon.toFixed(4),
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m',
      hourly: 'temperature_2m,visibility,uv_index,precipitation_probability',
      timezone: 'auto',
      forecast_days: '2',
      wind_speed_unit: 'kmh',
    });
    const json = await fetchJson<Forecast>(deps.fetcher, `https://api.open-meteo.com/v1/forecast?${query.toString().replace(/%2C/g, ',')}`, { timeoutMs: 8000, maxBytes: 300_000 });
    return buildEnv(place, json, now());
  }

  return {
    current: () => last,
    async refresh(city, force = false) {
      const key = city?.trim().toLowerCase() ?? '';
      const fresh = last.status === 'ok' && last.fetchedAt !== undefined && now() - last.fetchedAt < ENV_TTL_MS && key === lastKey;
      if (fresh && !force) return last;
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          last = await load(city);
          lastKey = key;
        } catch {
          const age = last.fetchedAt === undefined ? Infinity : now() - last.fetchedAt;
          // Şehir değiştiyse eski şehrin verisi yanıltır: yeni şehir okunamadıysa `off`.
          if (key !== lastKey && lastKey !== '') last = emptyEnv();
          else last = age < ENV_MAX_STALE_MS && last.fetchedAt !== undefined ? { ...last, status: 'stale' } : emptyEnv();
        } finally {
          inflight = null;
        }
        return last;
      })();
      return inflight;
    },
  };
}
