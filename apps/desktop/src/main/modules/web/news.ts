// Haber başlıkları: yayıncıların kendi RSS akışları (anahtarsız). Kaynak listesi v1'den (`src/shared/pano.ts` › KATALOG).
// v1 kuralı aynen: yalnız başlık + kaynak adı + zaman alınır; özet, görsel ve haber metni ALINMAZ (yayıncı koşulları;
// ticari yayından önce izin gerekir). Ayrıntı isteyen kullanıcı için model haberin adresini `web_read` ile okuyabilir.
import { decodeEntities } from './html';
import { decodeBody, type Fetcher } from './net';
import { cleanUrl } from './search';
import { clip, fold, terms, TtlCache } from './text';

export interface NewsSource {
  id: string;
  name: string;
  url: string;
}

export const NEWS_SOURCES: Record<string, NewsSource[]> = {
  TR: [
    { id: 'trt', name: 'TRT Haber', url: 'https://www.trthaber.com/sondakika_articles.rss' },
    { id: 'bbc-tr', name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkce/rss.xml' },
    { id: 'dw-tr', name: 'DW Türkçe', url: 'https://rss.dw.com/xml/rss-tur-all' },
    { id: 'ntv', name: 'NTV', url: 'https://www.ntv.com.tr/son-dakika.rss' },
  ],
  GB: [
    { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/uk/rss' },
  ],
  US: [
    { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
    { id: 'bbc-world', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  ],
  WORLD: [
    { id: 'bbc-world', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { id: 'dw-en', name: 'DW', url: 'https://rss.dw.com/xml/rss-en-all' },
    { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  ],
};

export interface Headline {
  title: string;
  url: string;
  source: string;
  /** ISO zaman; akışta yoksa `null`. */
  at: string | null;
}

function tagText(block: string, name: string): string | null {
  const open = block.search(new RegExp(`<${name}(?=[\\s>])`, 'i'));
  if (open === -1) return null;
  const start = block.indexOf('>', open);
  if (start === -1) return null;
  // `toLowerCase()` ile konum aranmaz: "İ" küçülünce iki karakter olur ve konumlar kayar (ölçüldü: DW/TRT akışı).
  const closer = new RegExp(`</${name}>`, 'ig');
  closer.lastIndex = start;
  const end = closer.exec(block)?.index ?? -1;
  if (end === -1) return null;
  let text = block.slice(start + 1, end).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
  if (cdata) text = cdata[1]!;
  return decodeEntities(text.replace(/<[^<>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** RSS 2.0 (`<item>`) ve Atom (`<entry>`) akışından başlıklar. Bağlantısı http(s) olmayan atlanır. */
export function parseFeed(xml: string, source: NewsSource, max = 30): Headline[] {
  const out: Headline[] = [];
  const parts = xml.slice(0, 3_000_000).split(/<(?:item|entry)(?=[\s>])/i).slice(1);
  for (const part of parts) {
    if (out.length >= max) break;
    const block = part.split(/<\/(?:item|entry)>/i)[0]!;
    const title = tagText(block, 'title');
    let url = tagText(block, 'link');
    if (!url) url = /<link[^<>]*href\s*=\s*["']([^"']+)["']/i.exec(block)?.[1] ?? null;
    if (!url) url = tagText(block, 'guid');
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    const when = tagText(block, 'pubDate') ?? tagText(block, 'published') ?? tagText(block, 'updated') ?? tagText(block, 'dc:date');
    const time = when ? new Date(when) : null;
    out.push({ title, url: cleanUrl(url), source: source.name, at: time && !Number.isNaN(time.getTime()) ? time.toISOString() : null });
  }
  return out;
}

/** Akışları örer: aynı başlık bir kez, en yeni önce, bir kaynaktan üst üste en çok iki haber (v1 `haberleriBirlestir`). */
export function mergeHeadlines(feeds: Headline[][], max: number): Headline[] {
  const seen = new Set<string>();
  const all: Headline[] = [];
  for (const item of feeds.flat()) {
    const key = fold(item.title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(key) || seen.has(item.url)) continue;
    seen.add(key);
    seen.add(item.url);
    all.push(item);
  }
  all.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const out: Headline[] = [];
  const rest = [...all];
  while (out.length < max && rest.length) {
    const index = rest.findIndex((item) => !(out.length >= 2 && out.at(-1)!.source === item.source && out.at(-2)!.source === item.source));
    out.push(...rest.splice(index === -1 ? 0 : index, 1));
  }
  return out;
}

/** Konu verilirse başlıkta sorgu köklerinden biri geçenler. */
export function filterByTopic(items: Headline[], topic: string | undefined): Headline[] {
  const wanted = topic ? terms(topic) : [];
  if (!wanted.length) return items;
  return items.filter((item) => {
    // Adres yolu da bakılır: yayıncılar kategoriyi oraya yazar (`/haber/ekonomi/...`).
    const words = new Set(
      fold(`${item.title} ${item.url.replace(/^https?:\/\/[^/]+/, '')}`)
        .split(/[^\p{L}\p{N}]+/u)
        .map((word) => word.slice(0, 5)),
    );
    return wanted.some((term) => words.has(term));
  });
}

export interface NewsOutcome {
  items: Headline[];
  failed: string[];
  sources: string[];
}

export interface NewsService {
  get(region: string, topic: string | undefined, max: number, signal?: AbortSignal): Promise<NewsOutcome>;
  clear(): void;
}

export function createNews(fetcher: Fetcher, now: () => number = Date.now): NewsService {
  const cache = new TtlCache<Headline[]>(10 * 60_000, 20, now);
  return {
    async get(region, topic, max, signal) {
      const sources = NEWS_SOURCES[region] ?? NEWS_SOURCES.WORLD!;
      const failed: string[] = [];
      const feeds = await Promise.all(
        sources.map(async (source) => {
          const cached = cache.get(source.id);
          if (cached) return cached;
          try {
            const response = await fetcher(source.url, { timeoutMs: 6000, maxBytes: 2_000_000, signal, headers: { Accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5' } });
            if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
            const items = parseFeed(decodeBody(response), source);
            cache.set(source.id, items);
            return items;
          } catch {
            if (signal?.aborted) throw signal.reason;
            failed.push(source.name);
            return [];
          }
        }),
      );
      const items = mergeHeadlines(
        feeds.map((feed) => filterByTopic(feed, topic)),
        max,
      ).map((item) => ({ ...item, title: clip(item.title, 140) }));
      return { items, failed, sources: sources.map((source) => source.name) };
    },
    clear() {
      cache.clear();
    },
  };
}
