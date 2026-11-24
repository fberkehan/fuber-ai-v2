// Besleme keşfi: kullanıcının söylediği şey besleme adresi, site adresi ya da site ADI olabilir ("webrazzi",
// "bbc türkçe", "theverge.com", "https://x.com/feed"). Sıra:
//   (a) katalogda ad / öteki ad / ana makine adı eşleşmesi → o yerleşik kaynak (ağa çıkılmaz)
//   (b) adres doğrudan besleme mi (RSS/Atom, en az bir öğe)
//   (c) HTML ise `<link rel="alternate" type="application/rss+xml|atom+xml" href>` (göreli adres çözülür)
//   (d) yaygın yollar: /feed, /rss, /rss.xml, /feed.xml, /atom.xml, /index.xml, /feed/
//   (e) nokta içermeyen ad için alan adı tahmini: www.<ad>.com, <ad>.com, .com.tr, .net, .co, .io
// En çok ~10 istek ve toplam ~15 sn. Her istek `fetcher`dan (üretimde `safeFetch`: özel ağ / SSRF kapısı) geçer.
// Bulunan besleme DOĞRULANIR (ayrıştırılır, en az bir başlık). Dış içerik güvenilmezdir: yalnız başlık/ad/dil okunur.
import { parseFeed, type Headline } from '../web/news';
import { decodeEntities } from '../web/html';
import { decodeBody, FetchBlockedError, type Fetcher } from '../web/net';
import { fold } from '../web/text';
import { NEWS_CATALOG, type CatalogSource } from './catalog';
import { looksTurkish } from './rank';
import type { NewsCategory } from './types';

export const DISCOVER_MAX_REQUESTS = 10;
export const DISCOVER_TOTAL_MS = 15_000;
const PER_REQUEST_MS = 8_000;
const COMMON_PATHS = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/feed/'];
const GUESS_SUFFIXES = ['https://www.{ad}.com', 'https://{ad}.com', 'https://www.{ad}.com.tr', 'https://{ad}.net', 'https://{ad}.co', 'https://{ad}.io'];
const FEED_ACCEPT = 'application/rss+xml,application/atom+xml,application/xml;q=0.9,text/html;q=0.8,*/*;q=0.5';

export type DiscoverOutcome =
  | { kind: 'catalog'; entry: CatalogSource; tried: string[] }
  | { kind: 'feed'; url: string; name: string; category: NewsCategory; lang: string; items: Headline[]; tried: string[] }
  | { kind: 'blocked'; tried: string[] }
  | { kind: 'none'; tried: string[] };

export interface DiscoverOptions {
  catalog?: readonly CatalogSource[];
  now?: () => number;
  maxRequests?: number;
  totalMs?: number;
  signal?: AbortSignal;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** Kullanıcı girdisini katalog karşılaştırması için sadeleştirir: "Webrazzi'yi" → "webrazzi". */
function plainName(query: string): string {
  return fold(query.replace(/['’ʼ`´]\p{L}*$/u, ''))
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .trim();
}

/** (a) Katalog eşleşmesi: tam adres, ad, öteki ad, kimlik, sonra ana makine adı. */
export function matchCatalog(query: string, catalog: readonly CatalogSource[] = NEWS_CATALOG): CatalogSource | null {
  const raw = query.trim();
  if (!raw) return null;
  const asUrl = /^https?:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(raw) ? `https://${raw}` : null;
  if (asUrl) {
    const wanted = asUrl.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase();
    const exact = catalog.find((entry) => entry.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase() === wanted);
    if (exact) return exact;
    const url = new URL(asUrl);
    // Yalnız ana makine adı verildiyse (yol yok) aynı sitenin en genel beslemesi: yolu en kısa (en az kesimli) olan,
    // eşitlikte katalog sırası ("techcrunch.com" → TechCrunch, "TechCrunch AI" değil).
    if (url.pathname === '/' || url.pathname === '') {
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const depth = (entry: CatalogSource) => new URL(entry.url).pathname.split('/').filter(Boolean).length;
      const byHost = catalog
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => hostOf(entry.url) === host || hostOf(entry.url)?.endsWith(`.${host}`))
        .sort((a, b) => depth(a.entry) - depth(b.entry) || a.index - b.index)[0];
      if (byHost) return byHost.entry;
    }
    return null;
  }
  const name = plainName(raw);
  if (!name) return null;
  const compact = name.replace(/\s+/g, '');
  const byName = catalog.find((entry) => plainName(entry.name) === name || entry.id === name || (entry.aliases ?? []).some((alias) => plainName(alias) === name));
  if (byName) return byName;
  // Boşluksuz yazım: "bloomberght", "hackernews".
  return catalog.find((entry) => plainName(entry.name).replace(/\s+/g, '') === compact || (entry.aliases ?? []).some((alias) => plainName(alias).replace(/\s+/g, '') === compact)) ?? null;
}

/** Gövde bir RSS/Atom beslemesi mi (kök öğe). */
function isFeedBody(text: string): boolean {
  const head = text.slice(0, 4000);
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(head) && !/<html[\s>]/i.test(head.slice(0, 600));
}

/** Beslemenin kendi başlığı (ilk öğeden önceki `<title>`). */
export function feedTitle(xml: string): string | null {
  const head = xml.split(/<(?:item|entry)(?=[\s>])/i)[0] ?? '';
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (!match) return null;
  let text = match[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
  if (cdata) text = cdata[1]!;
  const clean = decodeEntities(text.replace(/<[^<>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 80) : null;
}

/** Beslemenin dili: `<language>`, `xml:lang`, yoksa başlıklardaki Türkçe harf oranı. */
export function feedLanguage(xml: string, titles: readonly string[]): string {
  const declared = /<language[^>]*>\s*(?:<!\[CDATA\[)?\s*([a-zA-Z]{2})/i.exec(xml)?.[1] ?? /<feed[^>]*xml:lang\s*=\s*["']([a-zA-Z]{2})/i.exec(xml)?.[1];
  if (declared) return declared.toLowerCase();
  const sample = titles.slice(0, 20);
  const turkish = sample.filter(looksTurkish).length;
  return sample.length > 0 && turkish / sample.length >= 0.3 ? 'tr' : 'en';
}

/** Kaynağın konusu, ad ve adresten sezgisel; bilinmezse `other`. */
export function guessCategory(name: string, url: string): NewsCategory {
  const text = fold(`${name} ${url}`);
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u));
  if (text.includes('yapay zeka') || text.includes('yapay-zeka') || text.includes('artificial') || words.has('ai')) return 'ai';
  if (text.includes('girisim') || text.includes('startup')) return 'startup';
  if (['ekonomi', 'finans', 'borsa', 'economy', 'finance', 'business', 'piyasa'].some((word) => text.includes(word))) return 'economy';
  if (text.includes('teknoloji') || text.includes('tech')) return 'tech';
  return 'other';
}

/** HTML'deki besleme bağlantıları (sırayla, göreli adres çözülmüş). */
export function feedLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const tag of html.slice(0, 500_000).match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    const value = (name: string) => {
      const match = attr(name);
      return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
    };
    if (!/\balternate\b/i.test(value('rel'))) continue;
    if (!/application\/(rss|atom)\+xml/i.test(value('type'))) continue;
    const href = decodeEntities(value('href').trim());
    if (!href) continue;
    try {
      const resolved = new URL(href, base).toString();
      if (/^https?:/i.test(resolved) && !out.includes(resolved)) out.push(resolved);
    } catch {
      // geçersiz adres atlanır
    }
  }
  return out;
}

/** Tek sorgu için besleme bulur. Hiç fırlatmaz (iptal dışında). */
export async function discoverFeed(query: string, fetcher: Fetcher, options: DiscoverOptions = {}): Promise<DiscoverOutcome> {
  const tried: string[] = [];
  const catalog = options.catalog ?? NEWS_CATALOG;
  const entry = matchCatalog(query, catalog);
  if (entry) return { kind: 'catalog', entry, tried };

  const now = options.now ?? Date.now;
  const deadline = now() + (options.totalMs ?? DISCOVER_TOTAL_MS);
  const maxRequests = options.maxRequests ?? DISCOVER_MAX_REQUESTS;
  let blockedFirst = false;

  type Got = { url: string; text: string; contentType: string } | null;
  async function get(url: string): Promise<Got> {
    if (tried.length >= maxRequests || tried.includes(url)) return null;
    const remaining = deadline - now();
    if (remaining <= 300) return null;
    tried.push(url);
    try {
      const response = await fetcher(url, { timeoutMs: Math.min(PER_REQUEST_MS, remaining), maxBytes: 2_000_000, ...(options.signal ? { signal: options.signal } : {}), headers: { Accept: FEED_ACCEPT } });
      if (response.status < 200 || response.status >= 300) return null;
      return { url: response.url || url, text: decodeBody(response), contentType: response.contentType };
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof FetchBlockedError && tried.length === 1) blockedFirst = true;
      return null;
    }
  }

  function asFeed(got: Got): DiscoverOutcome | null {
    if (!got || !isFeedBody(got.text)) return null;
    const items = parseFeed(got.text, { id: 'discover', name: '', url: got.url }, 150);
    if (items.length === 0) return null;
    const name = feedTitle(got.text) ?? hostOf(got.url) ?? got.url;
    return { kind: 'feed', url: got.url, name, category: guessCategory(name, got.url), lang: feedLanguage(got.text, items.map((item) => item.title)), items, tried };
  }

  /** Sayfa ya da besleme olabilecek adres: (b) doğrudan, (c) bağlantı, (d) yaygın yollar. */
  async function explore(url: string, commonPaths: readonly string[]): Promise<DiscoverOutcome | null> {
    const got = await get(url);
    const direct = asFeed(got);
    if (direct) return direct;
    if (got) {
      for (const link of feedLinks(got.text, got.url).slice(0, 3)) {
        const found = asFeed(await get(link));
        if (found) return found;
      }
    }
    let origin: string;
    try {
      origin = new URL(got?.url ?? url).origin;
    } catch {
      return null;
    }
    // Sayfa hiç açılmadıysa (alan adı yok) yaygın yollar denenmez; istek bütçesi öteki tahminlere kalır.
    if (!got) return null;
    for (const path of commonPaths) {
      const found = asFeed(await get(`${origin}${path}`));
      if (found) return found;
    }
    return null;
  }

  const raw = query.trim();
  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(raw);
  if (looksLikeUrl) {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const found = await explore(url, COMMON_PATHS);
    if (found) return found;
    return blockedFirst ? { kind: 'blocked', tried } : { kind: 'none', tried };
  }

  const name = plainName(raw).replace(/[^a-z0-9-]+/g, '');
  if (!name) return { kind: 'none', tried };
  for (const pattern of GUESS_SUFFIXES) {
    if (tried.length >= maxRequests || now() >= deadline) break;
    // Tahmin edilen alan adında yaygın yollardan yalnız ilk ikisi (bütçe).
    const found = await explore(pattern.replace('{ad}', name), COMMON_PATHS.slice(0, 2));
    if (found) return found;
  }
  return { kind: 'none', tried };
}
