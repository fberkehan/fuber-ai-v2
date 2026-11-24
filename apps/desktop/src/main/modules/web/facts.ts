// Hızlı olgular: döviz kuru ve "bugün ne günü / resmî tatil mi".
// Kaynaklar (anahtarsız, 16 Kasım 2026'da gerçek isteklerle denendi):
//   - TCMB gösterge kurları `https://www.tcmb.gov.tr/kurlar/today.xml` (kamuya açık; iş günü 15.30'da yayımlanır,
//     hafta sonu son iş gününün kuru döner — tarih her yanıtta söylenir).
//   - Frankfurter `https://api.frankfurter.dev/v1/latest` (açık kaynak, anahtarsız; Avrupa Merkez Bankası referans
//     kurları): TL dışı çiftler ve TCMB yanıt vermezse yedek.
//   - Nager.Date `https://date.nager.at/api/v3/PublicHolidays/<yıl>/<ülke>` (anahtarsız, açık kaynak): resmî tatiller
//     (Türkiye'de dinî bayramlar dahil; arife yarım günleri listede yok). Ağ yoksa Türkiye'nin sabit tarihli tatilleri.
import { fromLocal, localDay, type LocalDay } from '@fuber/shared';
import { decodeBody, fetchJson, type Fetcher } from './net';
import { fold, TtlCache } from './text';

// ───────── döviz ─────────

const CURRENCY_ALIASES: Array<[RegExp, string]> = [
  [/^(usd|dolar|dolari|amerikan dolari|abd dolari|\$)$/, 'USD'],
  [/^(eur|euro|avro|€)$/, 'EUR'],
  [/^(gbp|sterlin|ingiliz sterlini|pound|£)$/, 'GBP'],
  [/^(chf|isvicre frangi|frank)$/, 'CHF'],
  [/^(jpy|yen|japon yeni)$/, 'JPY'],
  [/^(rub|ruble|rus rublesi)$/, 'RUB'],
  [/^(sar|riyal|suudi riyali)$/, 'SAR'],
  [/^(aed|dirhem|bae dirhemi)$/, 'AED'],
  [/^(cny|yuan|cin yuani)$/, 'CNY'],
  [/^(azn|manat|azerbaycan manati)$/, 'AZN'],
  [/^(cad|kanada dolari)$/, 'CAD'],
  [/^(aud|avustralya dolari)$/, 'AUD'],
  [/^(try|tl|lira|turk lirasi|₺)$/, 'TRY'],
];

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'dolar', EUR: 'euro', GBP: 'sterlin', CHF: 'İsviçre frangı', JPY: 'yen', RUB: 'ruble', SAR: 'riyal', AED: 'dirhem',
  CNY: 'yuan', AZN: 'manat', CAD: 'Kanada doları', AUD: 'Avustralya doları', TRY: 'lira',
};

/** "dolar", "Euro", "usd", "₺" → ISO kodu; tanınmazsa üç harfli büyük yazım (ör. "SEK"), o da değilse `null`. */
export function currencyCode(raw: string): string | null {
  const key = fold(raw).replace(/[^\p{L}$€£₺ ]/gu, '').trim();
  for (const [pattern, code] of CURRENCY_ALIASES) if (pattern.test(key)) return code;
  return /^[a-z]{3}$/.test(key) ? key.toUpperCase() : null;
}

export const currencyName = (code: string) => CURRENCY_NAMES[code] ?? code;

export interface TcmbRate {
  code: string;
  unit: number;
  forexBuying: number | null;
  forexSelling: number | null;
}

export interface TcmbBulletin {
  /** YYYY-MM-DD */
  date: string;
  rates: Map<string, TcmbRate>;
}

export function parseTcmb(xml: string): TcmbBulletin {
  const dateMatch = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';
  const rates = new Map<string, TcmbRate>();
  for (const match of xml.matchAll(/<Currency[^>]*Kod="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g)) {
    const body = match[2]!;
    const num = (tag: string) => {
      const value = new RegExp(`<${tag}>([\\d.,]+)</${tag}>`).exec(body)?.[1];
      return value ? Number(value.replace(',', '.')) : null;
    };
    rates.set(match[1]!, { code: match[1]!, unit: num('Unit') ?? 1, forexBuying: num('ForexBuying'), forexSelling: num('ForexSelling') });
  }
  return { date, rates };
}

export interface FxQuote {
  from: string;
  to: string;
  amount: number;
  /** 1 birim `from` kaç `to`. */
  rate: number;
  result: number;
  /** TCMB'de TL çiftleri için alış/satış (1 birim döviz kaç TL). */
  buying: number | null;
  selling: number | null;
  date: string;
  source: 'TCMB' | 'Frankfurter (ECB)';
}

export const formatNumber = (value: number, digits = 2) => value.toLocaleString('tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: value >= 100 ? 0 : Math.min(2, digits) });

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export function spokenDate(day: string, withWeekday = false): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]!;
  return `${date} ${MONTHS[month - 1]} ${year}${withWeekday ? ` ${weekday}` : ''}`;
}

export function fxSpeech(quote: FxQuote): string {
  const from = currencyName(quote.from);
  const to = currencyName(quote.to);
  const when = `${quote.source === 'TCMB' ? "TCMB'nin" : 'Avrupa Merkez Bankası'} ${spokenDate(quote.date)} kuruyla`;
  const base = `${when} ${quote.amount.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${from} ${formatNumber(quote.result, quote.result < 1 ? 4 : 2)} ${to}`;
  if (quote.source === 'TCMB' && quote.buying !== null && quote.selling !== null && quote.amount === 1) {
    const subject = quote.to === 'TRY' ? '' : ` (1 ${to}: alış ${formatNumber(quote.buying)}, satış ${formatNumber(quote.selling)} TL)`;
    return quote.to === 'TRY' ? `${base} (döviz satış; alış ${formatNumber(quote.buying)}).` : `${base}${subject}.`;
  }
  return `${base}.`;
}

export interface FxService {
  quote(from: string, to: string, amount: number, signal?: AbortSignal): Promise<FxQuote>;
  clear(): void;
}

export function createFx(fetcher: Fetcher, now: () => number = Date.now, options: { tcmbWaitMs?: number } = {}): FxService {
  const tcmb = new TtlCache<TcmbBulletin>(30 * 60_000, 2, now);
  const ecb = new TtlCache<{ date: string; rates: Record<string, number> }>(60 * 60_000, 20, now);

  let tcmbInflight: Promise<TcmbBulletin> | null = null;

  /**
   * TCMB sunucusu yavaş yanıt verebiliyor (ölçüldü: ilk bayt 3–9 sn). İstek kullanıcının turundan bağımsız sürer ve
   * önbelleği doldurur; tur en çok `tcmbWaitMs` bekler, gelmezse ECB kuruyla yanıtlanır.
   */
  function loadTcmb(): Promise<TcmbBulletin> {
    const cached = tcmb.get('today');
    if (cached) return Promise.resolve(cached);
    tcmbInflight ??= (async () => {
      try {
        const response = await fetcher('https://www.tcmb.gov.tr/kurlar/today.xml', { timeoutMs: 15_000, maxBytes: 300_000 });
        if (response.status !== 200) throw new Error(`TCMB HTTP ${response.status}`);
        const bulletin = parseTcmb(decodeBody(response));
        if (bulletin.rates.size === 0) throw new Error('TCMB yanıtı çözülemedi');
        tcmb.set('today', bulletin);
        return bulletin;
      } finally {
        tcmbInflight = null;
      }
    })();
    return tcmbInflight;
  }

  function within<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  async function loadEcb(base: string, signal?: AbortSignal) {
    const cached = ecb.get(base);
    if (cached) return cached;
    const json = await fetchJson<{ date: string; rates: Record<string, number> }>(fetcher, `https://api.frankfurter.dev/v1/latest?base=${base}`, { timeoutMs: 6000, maxBytes: 100_000, signal });
    if (!json.rates || !json.date) throw new Error('Frankfurter yanıtı çözülemedi');
    ecb.set(base, json);
    return json;
  }

  function fromTcmb(bulletin: TcmbBulletin, from: string, to: string, amount: number): FxQuote | null {
    const perTry = (code: string) => {
      if (code === 'TRY') return { mid: 1, buying: 1, selling: 1 };
      const rate = bulletin.rates.get(code);
      if (!rate || rate.forexSelling === null) return null;
      const selling = rate.forexSelling / rate.unit;
      const buying = (rate.forexBuying ?? rate.forexSelling) / rate.unit;
      return { mid: selling, buying, selling };
    };
    const a = perTry(from);
    const b = perTry(to);
    if (!a || !b) return null;
    const rate = a.mid / b.mid;
    const tlPair = from === 'TRY' ? b : a;
    return { from, to, amount, rate, result: amount * rate, buying: tlPair.buying, selling: tlPair.selling, date: bulletin.date, source: 'TCMB' };
  }

  return {
    async quote(from, to, amount, signal) {
      if (from === to) throw new Error('aynı para birimi');
      let tcmbError: unknown = null;
      if (from === 'TRY' || to === 'TRY') {
        try {
          const pending = loadTcmb();
          pending.catch(() => {});
          const bulletin = await within(pending, options.tcmbWaitMs ?? 4500, signal);
          const quote = bulletin ? fromTcmb(bulletin, from, to, amount) : null;
          if (quote) return quote;
        } catch (error) {
          if (signal?.aborted) throw error;
          tcmbError = error;
        }
      }
      try {
        const json = await loadEcb(from, signal);
        const rate = json.rates[to];
        if (rate === undefined) throw new UnknownCurrencyError(to);
        return { from, to, amount, rate, result: amount * rate, buying: null, selling: null, date: json.date, source: 'Frankfurter (ECB)' };
      } catch (error) {
        if (error instanceof UnknownCurrencyError) throw error;
        throw tcmbError ?? error;
      }
    },
    clear() {
      tcmb.clear();
      ecb.clear();
    },
  };
}

export class UnknownCurrencyError extends Error {
  constructor(readonly code: string) {
    super(`bilinmeyen para birimi: ${code}`);
    this.name = 'UnknownCurrencyError';
  }
}

// ───────── gün ve resmî tatil ─────────

export interface Holiday {
  date: LocalDay;
  name: string;
}

/** Ülke adı ve bulunma hâli (ek ünlü uyumu kısaltmalarda kurala uymuyor: ABD'de). */
const COUNTRY_NAMES: Record<string, [string, string]> = {
  TR: ['Türkiye', "Türkiye'de"], GB: ['Birleşik Krallık', "Birleşik Krallık'ta"], US: ['ABD', "ABD'de"], DE: ['Almanya', "Almanya'da"],
  FR: ['Fransa', "Fransa'da"], NL: ['Hollanda', "Hollanda'da"], IT: ['İtalya', "İtalya'da"], ES: ['İspanya', "İspanya'da"],
};

const COUNTRY_ALIASES: Array<[RegExp, string]> = [
  [/^(tr|tur|turkiye|turkey)$/, 'TR'],
  [/^(gb|uk|ingiltere|birlesik krallik|united kingdom|england|britanya)$/, 'GB'],
  [/^(us|usa|abd|amerika|united states)$/, 'US'],
  [/^(de|almanya|germany)$/, 'DE'],
  [/^(fr|fransa|france)$/, 'FR'],
  [/^(nl|hollanda|netherlands)$/, 'NL'],
];

export function countryCode(raw: string | undefined): string {
  if (!raw) return 'TR';
  const key = fold(raw).trim();
  for (const [pattern, code] of COUNTRY_ALIASES) if (pattern.test(key)) return code;
  return /^[a-z]{2}$/.test(key) ? key.toUpperCase() : 'TR';
}

/** Türkiye'nin sabit tarihli resmî tatilleri: ağ yokken yedek (dinî bayramlar hesaplanmaz). */
export function fixedTurkishHolidays(year: number): Holiday[] {
  return [
    ['01-01', 'Yılbaşı'],
    ['04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'],
    ['05-01', 'Emek ve Dayanışma Günü'],
    ['05-19', "Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
    ['07-15', 'Demokrasi ve Millî Birlik Günü'],
    ['08-30', 'Zafer Bayramı'],
    ['10-29', 'Cumhuriyet Bayramı'],
  ].map(([md, name]) => ({ date: `${year}-${md}` as LocalDay, name: name! }));
}

export interface DayInfo {
  date: LocalDay;
  weekday: string;
  country: string;
  countryName: string;
  holiday: Holiday | null;
  next: Holiday | null;
  daysUntilNext: number | null;
  /** `false`: tatil listesi ağdan alınamadı, yalnız sabit tarihli tatillere bakıldı. */
  complete: boolean;
  speech: string;
}

export interface DayService {
  info(day: LocalDay, country: string, signal?: AbortSignal): Promise<DayInfo>;
  clear(): void;
}

const daysBetween = (a: LocalDay, b: LocalDay) => Math.round((fromLocal(b).getTime() - fromLocal(a).getTime()) / 86_400_000);

export function describeDay(day: LocalDay, today: LocalDay, country: string, holidays: Holiday[], complete: boolean): DayInfo {
  const [countryName, inCountry] = COUNTRY_NAMES[country] ?? [country, `${country}'de`];
  const holiday = holidays.find((entry) => entry.date === day) ?? null;
  const next = holidays.filter((entry) => entry.date > day).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const weekday = WEEKDAYS[fromLocal(day).getDay()]!;
  const offset = daysBetween(today, day);
  const label = offset === 0 ? 'Bugün' : offset === 1 ? 'Yarın' : offset === -1 ? 'Dün' : spokenDate(day, false);
  const parts = [`${label}${offset >= -1 && offset <= 1 ? ` ${spokenDate(day)},` : ''} ${weekday}.`];
  if (holiday) parts.push(`${inCountry} resmî tatil: ${holiday.name}.`);
  else parts.push(`${inCountry} resmî tatil değil${complete ? '' : ' (dinî bayramlar denetlenemedi, liste alınamadı)'}.`);
  const until = next ? daysBetween(day, next.date) : null;
  if (next) parts.push(`Sıradaki resmî tatil ${spokenDate(next.date, true)}, ${next.name} (${until} gün sonra).`);
  return { date: day, weekday, country, countryName, holiday, next, daysUntilNext: until, complete, speech: parts.join(' ').replace(/\s+,/g, ',') };
}

export function createDays(fetcher: Fetcher, now: () => number = Date.now): DayService {
  const cache = new TtlCache<Holiday[]>(7 * 24 * 3600_000, 20, now);

  async function holidays(year: number, country: string, signal?: AbortSignal): Promise<Holiday[]> {
    const key = `${country}:${year}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const json = await fetchJson<Array<{ date: string; localName: string; name: string; global?: boolean; types?: string[] }>>(
      fetcher,
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`,
      { timeoutMs: 6000, maxBytes: 200_000, signal },
    );
    // Yalnız ülke geneli resmî tatiller (eyalete/bölgeye özgü olanlar değil).
    const list = json
      .filter((entry) => entry.global !== false && (!entry.types || entry.types.includes('Public')))
      .map((entry) => ({ date: entry.date as LocalDay, name: country === 'TR' ? entry.localName : entry.localName || entry.name }));
    cache.set(key, list);
    return list;
  }

  return {
    async info(day, country, signal) {
      const year = Number(day.slice(0, 4));
      let list: Holiday[] = [];
      let complete = true;
      try {
        list = [...(await holidays(year, country, signal)), ...(await holidays(year + 1, country, signal).catch(() => []))];
      } catch {
        complete = false;
        list = country === 'TR' ? [...fixedTurkishHolidays(year), ...fixedTurkishHolidays(year + 1)] : [];
      }
      return describeDay(day, localDay(new Date(now())), country, list, complete);
    },
    clear() {
      cache.clear();
    },
  };
}

