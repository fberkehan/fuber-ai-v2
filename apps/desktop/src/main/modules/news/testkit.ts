// Yalnız birim sınamaları için: kayıtlı RSS/Atom/HTML gövdeleri ve sahte saat. Uygulama demetine girmez.
import { silentLog, tempStore } from '../../core/brain/testkit';
import { NEWS_MIGRATIONS } from './store';

export interface FeedEntry {
  title: string;
  url: string;
  /** ISO an; verilmezse `pubDate` yazılmaz. */
  at?: string;
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function rss(title: string, entries: readonly FeedEntry[], options: { language?: string } = {}): string {
  const items = entries
    .map((entry) => `<item><title>${esc(entry.title)}</title><link>${esc(entry.url)}</link>${entry.at ? `<pubDate>${new Date(entry.at).toUTCString()}</pubDate>` : ''}<description>ÖZET SAKLANMAZ</description></item>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title>${options.language ? `<language>${options.language}</language>` : ''}<link>https://example.com</link>\n${items}</channel></rss>`;
}

export function atom(title: string, entries: readonly FeedEntry[]): string {
  const items = entries.map((entry) => `<entry><title>${esc(entry.title)}</title><link href="${esc(entry.url)}"/>${entry.at ? `<updated>${entry.at}</updated>` : ''}</entry>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(title)}</title>\n${items}</feed>`;
}

export function html(head: string, body = '<p>Merhaba</p>'): string {
  return `<!doctype html><html><head><title>Site</title>${head}</head><body>${body}</body></html>`;
}

/** Ayarlanabilir sahte saat. */
export function clock(start: string | number) {
  let current = typeof start === 'number' ? start : Date.parse(start);
  return {
    now: () => current,
    set(value: string | number) {
      current = typeof value === 'number' ? value : Date.parse(value);
    },
    advance(ms: number) {
      current += ms;
    },
  };
}

/** Gündem tablolarıyla geçici gerçek SQLite. */
export function newsDb() {
  const env = tempStore();
  env.store.migrate('news', NEWS_MIGRATIONS);
  return { db: env.store.scoped('news'), store: env.store, close: () => env.close() };
}

export { silentLog };
