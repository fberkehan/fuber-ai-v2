// Hava durumu: Open-Meteo (anahtarsız). Coğrafi kodlama `geocoding-api.open-meteo.com`, tahmin `api.open-meteo.com`.
// Koşullar (open-meteo.com/en/terms, 16 Kasım 2026'da okundu): ücretsiz API yalnız TİCARİ OLMAYAN kullanım içindir;
// günde < 10.000, saatte < 5.000, dakikada < 600 istek; veriler CC BY 4.0 (kaynak gösterilmeli: "Open-Meteo").
// Ticari sürümde abonelik (API anahtarı) gerekir. Dışarıya yalnız yer adı ve o yerin koordinatı gider.
import { fetchJson, type Fetcher } from './net';
import { fold, locative, placeCandidates, TtlCache } from './text';

/** WMO hava kodu → Türkçe betimleme (Open-Meteo belgesindeki tablo). */
export const WMO_TR: Record<number, string> = {
  0: 'açık',
  1: 'çoğunlukla açık',
  2: 'parçalı bulutlu',
  3: 'kapalı',
  45: 'sisli',
  48: 'kırağılı sis',
  51: 'hafif çisenti',
  53: 'çisenti',
  55: 'yoğun çisenti',
  56: 'hafif donan çisenti',
  57: 'donan çisenti',
  61: 'hafif yağmurlu',
  63: 'yağmurlu',
  65: 'şiddetli yağmurlu',
  66: 'hafif dondurucu yağmur',
  67: 'dondurucu yağmur',
  71: 'hafif kar yağışlı',
  73: 'kar yağışlı',
  75: 'yoğun kar yağışlı',
  77: 'kar taneli',
  80: 'hafif sağanak yağışlı',
  81: 'sağanak yağışlı',
  82: 'şiddetli sağanak yağışlı',
  85: 'hafif kar sağanaklı',
  86: 'yoğun kar sağanaklı',
  95: 'gök gürültülü sağanak',
  96: 'dolulu gök gürültülü sağanak',
  99: 'şiddetli dolulu fırtına',
};

export const describeCode = (code: number | null | undefined): string => (code === null || code === undefined ? 'bilinmiyor' : (WMO_TR[code] ?? 'değişken'));

const isWet = (code: number | null | undefined) => code !== null && code !== undefined && code >= 51;

export interface Place {
  name: string;
  admin1: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
  /** Büyük yer (il merkezi, başkent ya da 100 binden kalabalık). */
  major: boolean;
}

interface GeoResponse {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    timezone?: string;
    population?: number;
    feature_code?: string;
    admin2?: string;
  }>;
}

/** Kodlayıcıya sorulan sonuç sayısı: ilçenin kanıtı (aşağıda) ilk onda olmayabiliyor ("Kadıköy Burnu" 20'den sonra). */
export const GEOCODE_COUNT = 50;

/** Büyükşehirler: aynı adlı iki ilçeden büyük ilinki yeğlenir. */
const BIG_PROVINCES = new Set(['istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'adana', 'konya', 'gaziantep', 'kocaeli', 'mersin'].map((name) => fold(name)));

const districtOf = (item: { admin2?: string }): string => fold((item.admin2 ?? '').replace(/\s+İlçesi$/u, '')).trim();

/**
 * En olası yeri seçer: nüfus (logaritmik) + başkent/il merkezi artısı + Türkiye artısı + ilçe artısı. Konum GÖNDERİLMEDEN
 * yapılan tek yerel tercih: kullanıcı Türkiye'de yaşıyor, aynı adlı köy ile şehirden şehri seçeriz.
 *
 * İlçe artısı: kodlayıcı (GeoNames) İstanbul'un "Kadıköy"ünü yerleşim olarak tanımıyor, aynı adlı köyleri sıralıyor
 * (en kalabalığı Yalova'da, 2.741 kişi). Sorulan ad bir Türkiye ilçesinin adıysa sonuçlardan biri o ilçenin içindedir
 * (`admin2` = sorulan ad: "Beşiktaş | İstanbul | Beşiktaş", "Kadıköy Burnu | İstanbul | Kadıköy"). O sonuç köylerin önüne
 * geçer; yerleşim olmayan kanıt (burun, park) yalnız koordinat verir ve yer ilçenin adıyla anılır.
 */
export function pickPlace(json: GeoResponse, qualifier?: string, query?: string): Place | null {
  const asked = query ? fold(query).trim() : '';
  const inAskedDistrict = (item: { admin2?: string; country_code?: string }) => !!asked && item.country_code === 'TR' && districtOf(item) === asked;
  // Yerleşim olmayan sonuç (baraj, dağ, park) hava sorusunun yeri değildir; tek istisna ilçe kanıtıdır.
  let items = (json.results ?? []).filter((item) => !item.feature_code || item.feature_code.startsWith('PPL') || item.feature_code.startsWith('ADM') || inAskedDistrict(item));
  // "Kadıköy, İstanbul": niteleyici il/ilçe/ülke adıyla eşleşen sonuçlara daraltır (eşleşen yoksa daraltmaz).
  const wanted = qualifier ? fold(qualifier).trim() : '';
  if (wanted) {
    const narrowed = items.filter((item) => [item.admin1, item.admin2, item.country, item.country_code].some((field) => field && fold(field).includes(wanted)));
    if (narrowed.length) items = narrowed;
  }
  const scored = items.map((item) => {
    const featureBoost = item.feature_code === 'PPLC' ? 2 : item.feature_code?.startsWith('PPLA') ? 1.5 : 0;
    const district = inAskedDistrict(item);
    const districtBoost = district ? 3 + (BIG_PROVINCES.has(fold(item.admin1 ?? '')) ? 0.5 : 0) + (item.feature_code?.startsWith('PPL') ? 0.25 : 0) : 0;
    const score = Math.log10((item.population ?? 0) + 10) + featureBoost + (item.country_code === 'TR' ? 1 : 0) + districtBoost;
    return { item, score, district };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const best = top?.item;
  if (!best) return null;
  return {
    // İlçe kanıtı yerleşim değilse ("Kadıköy Burnu") yer ilçenin kendi adıyla anılır.
    name: top.district && !best.feature_code?.startsWith('PPL') ? (best.admin2 ?? best.name).replace(/\s+İlçesi$/u, '') : best.name,
    admin1: best.admin1 ?? null,
    country: best.country ?? null,
    countryCode: best.country_code ?? null,
    latitude: best.latitude,
    longitude: best.longitude,
    timezone: best.timezone ?? null,
    major: best.feature_code === 'PPLC' || !!best.feature_code?.startsWith('PPLA') || (best.population ?? 0) >= 100_000,
  };
}

export type WeatherDay = 'today' | 'tomorrow' | 'week';

export interface DailyWeather {
  date: string;
  weekday: string;
  code: number | null;
  summary: string;
  min: number | null;
  max: number | null;
  precipitationChance: number | null;
  precipitationMm: number | null;
  windMaxKmh: number | null;
}

export interface WeatherReport {
  place: Place;
  day: WeatherDay;
  current: { temperature: number | null; feelsLike: number | null; code: number | null; summary: string; windKmh: number | null; humidity: number | null; time: string | null } | null;
  days: DailyWeather[];
  /** Sesle söylenecek kısa metin. */
  speech: string;
  attribution: string;
}

interface ForecastResponse {
  current?: { time?: string; temperature_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number; relative_humidity_2m?: number };
  daily?: {
    time?: string[];
    weather_code?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
  };
}

const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const round = (value: number | null | undefined) => (value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value));
const weekdayOf = (isoDay: string) => WEEKDAYS[new Date(`${isoDay}T12:00:00Z`).getUTCDay()]!;

/** Söylenecek yer adı. Küçük yerleşimde il de söylenir ("Kadıköy (Yalova)"): aynı adlı yer karışmasın. */
export function placeLabel(place: Place): string {
  return place.name;
}

function placeNote(place: Place): string {
  if (place.admin1 && fold(place.admin1) !== fold(place.name) && !place.major) return ` (${place.admin1}${place.countryCode && place.countryCode !== 'TR' && place.country ? `, ${place.country}` : ''})`;
  if (place.countryCode && place.countryCode !== 'TR' && place.country) return ` (${place.country})`;
  return '';
}

function dayPhrase(day: DailyWeather, label: string): string {
  const parts = [`${label} ${day.summary}`];
  if (day.min !== null && day.max !== null) parts.push(`en düşük ${day.min}, en yüksek ${day.max} derece`);
  if (day.precipitationChance !== null) {
    const mm = day.precipitationMm !== null && day.precipitationMm >= 0.5 ? ` (yaklaşık ${String(Math.round(day.precipitationMm * 10) / 10).replace('.', ',')} mm)` : '';
    parts.push(`yağış olasılığı yüzde ${day.precipitationChance}${mm}`);
  }
  return parts.join('; ');
}

/** Yağış olasılığını kısa bir yargıya çevirir ("yağmur var mı?" sorusunun yanıtı). */
export function rainVerdict(day: DailyWeather): string {
  const chance = day.precipitationChance ?? 0;
  const snow = day.code !== null && ((day.code >= 71 && day.code <= 77) || day.code === 85 || day.code === 86);
  const what = snow ? 'kar' : 'yağmur';
  if (chance >= 60 || (isWet(day.code) && chance >= 40)) return `${what} bekleniyor`;
  if (chance >= 30) return `${what} ihtimali var`;
  return `${what} beklenmiyor`;
}

export function buildReport(place: Place, json: ForecastResponse, day: WeatherDay): WeatherReport {
  const daily = json.daily ?? {};
  const days: DailyWeather[] = (daily.time ?? []).map((date, index) => {
    const code = daily.weather_code?.[index] ?? null;
    return {
      date,
      weekday: weekdayOf(date),
      code,
      summary: describeCode(code),
      min: round(daily.temperature_2m_min?.[index]),
      max: round(daily.temperature_2m_max?.[index]),
      precipitationChance: round(daily.precipitation_probability_max?.[index]),
      precipitationMm: daily.precipitation_sum?.[index] ?? null,
      windMaxKmh: round(daily.wind_speed_10m_max?.[index]),
    };
  });
  const c = json.current;
  const current = c
    ? {
        temperature: round(c.temperature_2m),
        feelsLike: round(c.apparent_temperature),
        code: c.weather_code ?? null,
        summary: describeCode(c.weather_code),
        windKmh: round(c.wind_speed_10m),
        humidity: round(c.relative_humidity_2m),
        time: c.time ?? null,
      }
    : null;
  const where = `${locative(placeLabel(place))}${placeNote(place)}`;
  let speech: string;
  if (day === 'today') {
    const today = days[0];
    const now =
      current && current.temperature !== null
        ? `${where} şu an ${current.temperature} derece, ${current.summary}` +
          (current.feelsLike !== null && Math.abs(current.feelsLike - current.temperature) >= 2 ? `; hissedilen ${current.feelsLike}` : '') +
          (current.windKmh !== null ? `; rüzgâr saatte ${current.windKmh} km` : '') +
          '.'
        : `${where} bugün:`;
    speech = today ? `${now} ${dayPhrase(today, 'Bugün')}.` : now;
  } else if (day === 'tomorrow') {
    const tomorrow = days[1];
    speech = tomorrow
      ? `${where} yarın (${tomorrow.weekday}) ${dayPhrase(tomorrow, '').trim()}; ${rainVerdict(tomorrow)}` +
        (tomorrow.windMaxKmh !== null ? `, rüzgâr en çok saatte ${tomorrow.windMaxKmh} km` : '') +
        '.'
      : `${where} yarın için tahmin alınamadı.`;
  } else {
    const lines = days.slice(0, 7).map((entry, index) => {
      const label = index === 0 ? 'Bugün' : index === 1 ? 'Yarın' : entry.weekday;
      const temps = entry.min !== null && entry.max !== null ? ` ${entry.min}–${entry.max}°` : '';
      const rain = entry.precipitationChance !== null && entry.precipitationChance >= 30 ? `, yağış %${entry.precipitationChance}` : '';
      return `${label}${temps}, ${entry.summary}${rain}`;
    });
    const rainy = days
      .slice(0, 7)
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => (entry.precipitationChance ?? 0) >= 50)
      .map(({ entry, index }) => (index === 0 ? 'bugün' : index === 1 ? 'yarın' : entry.weekday.toLocaleLowerCase('tr')));
    const head = rainy.length ? `${where} bu hafta yağışlı günler: ${rainy.join(', ')}.` : `${where} bu hafta belirgin yağış beklenmiyor.`;
    speech = `${head} ${lines.join('; ')}.`;
  }
  return { place, day, current, days, speech, attribution: 'Open-Meteo (CC BY 4.0)' };
}

export class PlaceNotFoundError extends Error {
  constructor(readonly place: string) {
    super(`yer bulunamadı: ${place}`);
    this.name = 'PlaceNotFoundError';
  }
}

export interface WeatherService {
  get(placeText: string, day: WeatherDay, signal?: AbortSignal): Promise<WeatherReport>;
  clear(): void;
}

export function createWeather(fetcher: Fetcher, now: () => number = Date.now): WeatherService {
  const places = new TtlCache<Place | null>(24 * 3600_000, 200, now);
  const forecasts = new TtlCache<ForecastResponse>(15 * 60_000, 50, now);

  async function geocode(placeText: string, signal?: AbortSignal): Promise<Place> {
    const [head, ...rest] = placeText.split(',');
    const qualifier = rest.join(' ').trim() ? placeCandidates(rest.join(' '))[0] : undefined;
    const candidates = placeCandidates(head!);
    for (const candidate of candidates.slice(0, 3)) {
      const key = `${candidate.toLocaleLowerCase('tr')}|${qualifier ? fold(qualifier) : ''}`;
      let place = places.get(key);
      if (place === undefined) {
        const json = await fetchJson<GeoResponse>(
          fetcher,
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=${GEOCODE_COUNT}&language=tr&format=json`,
          { timeoutMs: 6000, maxBytes: 200_000, signal },
        );
        place = pickPlace(json, qualifier, candidate);
        places.set(key, place, place ? undefined : 10 * 60_000);
      }
      if (place) return place;
    }
    throw new PlaceNotFoundError(candidates[0] ?? placeText);
  }

  return {
    async get(placeText, day, signal) {
      const place = await geocode(placeText, signal);
      const key = `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`;
      let json = forecasts.get(key);
      if (!json) {
        const query = new URLSearchParams({
          latitude: place.latitude.toFixed(4),
          longitude: place.longitude.toFixed(4),
          current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
          timezone: 'auto',
          forecast_days: '7',
          wind_speed_unit: 'kmh',
        });
        json = await fetchJson<ForecastResponse>(fetcher, `https://api.open-meteo.com/v1/forecast?${query.toString().replace(/%2C/g, ',')}`, { timeoutMs: 6000, maxBytes: 200_000, signal });
        forecasts.set(key, json);
      }
      return buildReport(place, json, day);
    },
    clear() {
      places.clear();
      forecasts.clear();
    },
  };
}
