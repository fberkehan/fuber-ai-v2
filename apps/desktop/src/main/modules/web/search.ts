// Anahtarsız web araması: sağlayıcı arayüzü + sırayla geri düşme. Sıra (16 Kasım 2026'da gerçek isteklerle seçildi):
//   1. DuckDuckGo HTML (html.duckduckgo.com/html): iyi sonuç, ama aynı IP'den birkaç istekten sonra bot sınamasına
//      (HTTP 202, "anomaly") düşüyor (ölçüldü: ~4 istekte; "lite" ucu ilk istekte düştü).
//   2. Yahoo arama sayfası: Bing dizini, sonuçlar iyi, bot sınaması görülmedi.
//   3. Brave arama sayfası: iyi sonuç; sayfada "captcha" betiği var ama sonuçlar geliyor.
//   4. Vikipedi arama API'si (resmî, açık uç): yalnız ansiklopedik konular; son çare.
//   Bing HTML ELENDİ: anahtarsız istemciye ALAKASIZ sonuç veriyor (iki istekte de ölçüldü).
// 1–3 resmî API değildir, sayfa ayrıştırmadır: kullanım koşulları otomatik sorguya izin vermez, düzenleri değişebilir.
// Kişisel, düşük hacimli kullanım içindir; ticari sürümde anahtarlı bir arama API'si gerekir. Her sağlayıcı kendi
// hatasını döndürür; hepsi düşerse kullanıcı dürüst bir "arama hizmeti yanıt vermedi" duyar.
import { stripTags } from './html';
import { BROWSER_UA, FetchBlockedError, FetchFailedError, fetchJson, fetchText, type Fetcher } from './net';
import { clip, fold, terms } from './text';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type ProviderOutcome =
  | { status: 'ok'; results: SearchResult[] }
  | { status: 'empty' }
  | { status: 'blocked'; detail: string }
  | { status: 'error'; detail: string };

export interface SearchProvider {
  id: string;
  /** Kullanıcıya/modele söylenen ad. */
  label: string;
  search(query: string, fetcher: Fetcher, signal?: AbortSignal): Promise<ProviderOutcome>;
}

export const MAX_RESULTS = 5;

/** Türkçe sorgu mu (bölge ve Vikipedi dili seçimi için). */
export function looksTurkish(query: string): boolean {
  if (/[çğıöşüİ]/i.test(query)) return true;
  return /(?<!\p{L})(ne|nedir|nasıl|nasil|kaç|kac|hangi|nerede|fiyat|fiyatı|haber|son|bugün|bugun|yarın|yarin|hava|dolar|kuru|lira|ve|ile|için|icin)(?!\p{L})/iu.test(query);
}

/** İzleme parametrelerini atar (adres kısalsın, aynı sayfa iki kez görünmesin). */
export function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src|at_medium$|at_campaign$|maca$)/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

function failure(error: unknown): ProviderOutcome {
  if (error instanceof FetchFailedError && error.kind === 'aborted') throw error;
  if (error instanceof FetchBlockedError) return { status: 'error', detail: error.message };
  return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
}

// ───────── DuckDuckGo ─────────

/** DuckDuckGo HTML sonuç sayfasını ayrıştırır (reklamlar atlanır; adres `uddg` parametresinden çözülür). */
export function parseDuckDuckGo(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const head = block.slice(0, 200);
    if (/result--ad\b/.test(head)) continue;
    const anchor = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ?? /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    let href = anchor[1]!.replace(/&amp;/g, '&');
    const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
    if (uddg) href = decodeURIComponent(uddg);
    if (href.startsWith('//')) href = `https:${href}`;
    if (!/^https?:\/\//i.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block)?.[1] ?? '';
    results.push({ title: stripTags(anchor[2]!), url: cleanUrl(href), snippet: stripTags(snippet) });
  }
  return results;
}

export const duckDuckGo: SearchProvider = {
  id: 'duckduckgo',
  label: 'DuckDuckGo',
  async search(query, fetcher, signal) {
    const region = looksTurkish(query) ? 'tr-tr' : 'wt-wt';
    try {
      const { text, response } = await fetchText(fetcher, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${region}`, {
        headers: { 'User-Agent': BROWSER_UA, Referer: 'https://html.duckduckgo.com/' },
        timeoutMs: 8000,
        maxBytes: 600_000,
        signal,
      });
      if (response.status === 202 || /anomaly-modal|challenge-form|bots use DuckDuckGo/i.test(text)) return { status: 'blocked', detail: 'bot sınaması' };
      const results = parseDuckDuckGo(text);
      return results.length ? { status: 'ok', results } : { status: 'empty' };
    } catch (error) {
      if (error instanceof FetchFailedError && error.status === 202) return { status: 'blocked', detail: 'bot sınaması' };
      return failure(error);
    }
  },
};

// ───────── Yahoo ─────────

/** Yahoo yönlendirme adresinden (`r.search.yahoo.com/.../RU=<kodlu adres>/RK=...`) asıl adres. */
export function decodeYahooUrl(href: string): string {
  const clean = href.replace(/&amp;/g, '&');
  const encoded = /\/RU=([^/]+)\//.exec(clean)?.[1];
  if (!encoded) return clean;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return clean;
  }
}

export function parseYahoo(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const block of html.split(/<div class="dd algo\b/i).slice(1)) {
    const href = /<a[^>]+href="([^"]+)"/i.exec(block)?.[1];
    const title = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(block)?.[1];
    if (!href || !title) continue;
    const url = decodeYahooUrl(href);
    if (!/^https?:\/\//i.test(url) || /(^|\.)yahoo\.com$/i.test(new URL(url).hostname)) continue;
    const snippet = /class="compText[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? '';
    results.push({ title: stripTags(title), url: cleanUrl(url), snippet: stripTags(snippet) });
  }
  return results;
}

export const yahoo: SearchProvider = {
  id: 'yahoo',
  label: 'Yahoo',
  async search(query, fetcher, signal) {
    try {
      const { text } = await fetchText(fetcher, `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': BROWSER_UA },
        timeoutMs: 8000,
        maxBytes: 1_200_000,
        signal,
      });
      const results = parseYahoo(text);
      if (results.length === 0 && /captcha|unusual traffic/i.test(text)) return { status: 'blocked', detail: 'bot sınaması' };
      return results.length ? { status: 'ok', results } : { status: 'empty' };
    } catch (error) {
      return failure(error);
    }
  },
};

// ───────── Brave ─────────

export function parseBrave(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const block of html.split(/data-type="web"/).slice(1)) {
    const href = /<a[^>]+href="(https?:\/\/[^"]+)"/i.exec(block)?.[1];
    const titleTag = /class="[^"]*search-snippet-title[^"]*"[^>]*?(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    if (!href || !titleTag) continue;
    const snippet = /class="content [^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? '';
    results.push({ title: stripTags(titleTag[1] ?? titleTag[2] ?? ''), url: cleanUrl(href.replace(/&amp;/g, '&')), snippet: stripTags(snippet) });
  }
  return results;
}

export const brave: SearchProvider = {
  id: 'brave',
  label: 'Brave',
  async search(query, fetcher, signal) {
    try {
      const { text } = await fetchText(fetcher, `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`, {
        headers: { 'User-Agent': BROWSER_UA },
        timeoutMs: 8000,
        maxBytes: 1_500_000,
        signal,
      });
      const results = parseBrave(text);
      if (results.length === 0 && /captcha/i.test(text)) return { status: 'blocked', detail: 'bot sınaması' };
      return results.length ? { status: 'ok', results } : { status: 'empty' };
    } catch (error) {
      return failure(error);
    }
  },
};

// ───────── Vikipedi ─────────

interface WikiSearch {
  query?: { search?: Array<{ title: string; snippet: string }> };
}

export function parseWikipedia(json: WikiSearch, lang: string): SearchResult[] {
  return (json.query?.search ?? []).map((item) => ({
    title: item.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
    snippet: stripTags(item.snippet),
  }));
}

export const wikipedia: SearchProvider = {
  id: 'wikipedia',
  label: 'Vikipedi',
  async search(query, fetcher, signal) {
    const langs = looksTurkish(query) ? ['tr', 'en'] : ['en', 'tr'];
    let lastError: ProviderOutcome = { status: 'empty' };
    for (const lang of langs) {
      try {
        const json = await fetchJson<WikiSearch>(
          fetcher,
          `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${MAX_RESULTS}&srprop=snippet&format=json&utf8=1`,
          { timeoutMs: 6000, maxBytes: 300_000, signal },
        );
        const results = parseWikipedia(json, lang);
        if (results.length) return { status: 'ok', results };
      } catch (error) {
        lastError = failure(error);
      }
    }
    return lastError;
  },
};

export const DEFAULT_PROVIDERS: SearchProvider[] = [duckDuckGo, yahoo, brave, wikipedia];

/**
 * Alaka kapısı: sonucun başlığında, özetinde ya da adresinde sorgudaki köklerin yeterincesi geçiyor mu (1–2 kökte biri,
 * daha uzun sorguda en az yarısı). Bot savunmasının döndürdüğü alakasız sonuçları ve Vikipedi'nin tek sözcüğe takılan
 * eşleşmelerini eler. Sorguda kök yoksa (yalnız durak sözcük) her sonuç geçer.
 */
export function relevant(results: SearchResult[], query: string): SearchResult[] {
  const wanted = terms(query);
  if (wanted.length === 0) return results;
  return results.filter((result) => {
    const words = new Set(
      fold(`${result.title} ${result.snippet} ${result.url}`)
        .split(/[^\p{L}\p{N}]+/u)
        .map((word) => word.slice(0, 5)),
    );
    const hits = wanted.filter((term) => words.has(term)).length;
    return hits >= (wanted.length >= 3 ? Math.ceil(wanted.length / 2) : 1);
  });
}

export interface SearchOutcome {
  results: SearchResult[];
  provider: SearchProvider | null;
  /** Denenen her sağlayıcının sonucu (tanı ve dürüst hata metni için). */
  attempts: Array<{ id: string; status: ProviderOutcome['status']; detail?: string }>;
}

export async function searchWeb(query: string, fetcher: Fetcher, options: { providers?: SearchProvider[]; signal?: AbortSignal } = {}): Promise<SearchOutcome> {
  const attempts: SearchOutcome['attempts'] = [];
  for (const provider of options.providers ?? DEFAULT_PROVIDERS) {
    if (options.signal?.aborted) break;
    const outcome = await provider.search(query, fetcher, options.signal);
    if (outcome.status === 'ok') {
      const seen = new Set<string>();
      const results = relevant(outcome.results, query).filter((result) => {
        const key = result.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (results.length > 0) {
        attempts.push({ id: provider.id, status: 'ok' });
        return { results: results.slice(0, MAX_RESULTS), provider, attempts };
      }
      attempts.push({ id: provider.id, status: 'empty', detail: 'alakasız sonuçlar' });
      continue;
    }
    attempts.push({ id: provider.id, status: outcome.status, ...('detail' in outcome ? { detail: outcome.detail } : {}) });
  }
  return { results: [], provider: null, attempts };
}

/**
 * Sonuç satırlarının bütçesi. Çerçeve (başlık, güvenilmez notu, işaretler, yönlendirme) ~350 karakter ekler; toplam
 * ≈1650 karakter ≈ 550 token (≈3 karakter/token) kalır: yerel modelin 8192'lik bağlamında 600 token sınırının altı.
 */
export const SEARCH_TEXT_BUDGET = 1300;

/** Sonuçları küçük bağlamlı modele uygun kısa satırlara çevirir; bütçe aşılırsa sondan sonuç atılır. */
export function formatResults(results: SearchResult[], budget = SEARCH_TEXT_BUDGET): { lines: string[]; used: SearchResult[] } {
  const lines: string[] = [];
  const used: SearchResult[] = [];
  let size = 0;
  for (const [index, result] of results.entries()) {
    const url = result.url.length > 160 ? result.url.slice(0, 160) : result.url;
    const snippet = clip(result.snippet.replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4} · /, ''), 150);
    const line = `${index + 1}. ${clip(result.title, 70)}${snippet ? ` — ${snippet}` : ''} (${url})`;
    if (size + line.length + 1 > budget && used.length > 0) break;
    lines.push(line);
    used.push(result);
    size += line.length + 1;
  }
  return { lines, used };
}
