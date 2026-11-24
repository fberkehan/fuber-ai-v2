// Gündem deposu: kaynaklar, başlıklar, konular, okundu bilgisi ve küçük durum tablosu.
//
// Kural: yayıncıdan yalnız BAŞLIK + adres + zaman saklanır (özet, metin, görsel YOK). Başlıklar 7 gün tutulur, kaynak
// başına en çok 150. Okundu bilgisi başlığın adres ve katlanmış başlık anahtarına bağlıdır: öğe silinip yeniden gelse de
// (saklama süresi, kaynağın kapatılıp açılması) "okundu" kalır. Okundu kayıtları 30 gün sonra silinir.
//
// Saat dışarıdan verilir (`now`): çok günlük benzetim sahte saatle koşar.
import { createHash } from 'node:crypto';
import { foldForSearch, type Migration, type ScopedDb } from '@fuber/shared';
import { NEWS_CATALOG, type CatalogSource } from './catalog';
import type { NewsCategory, NewsSourceView, NewsTopic } from './types';

export const NEWS_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'gündem tabloları',
    up: `CREATE TABLE news_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT NOT NULL,
      lang TEXT NOT NULL,
      builtin INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      added_at TEXT NOT NULL,
      last_ok_at TEXT,
      last_error TEXT,
      fail_count INTEGER NOT NULL DEFAULT 0,
      next_try_at INTEGER NOT NULL DEFAULT 0,
      last_try_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX news_sources_url ON news_sources (url);
    CREATE TABLE news_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      at TEXT,
      first_seen_at TEXT NOT NULL,
      folded TEXT NOT NULL
    );
    CREATE INDEX news_items_source ON news_items (source_id);
    CREATE INDEX news_items_seen ON news_items (first_seen_at);
    CREATE TABLE news_topics (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      folded TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      origin TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE news_read (key TEXT PRIMARY KEY, read_at TEXT NOT NULL);
    CREATE TABLE news_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  },
];

const DAY = 24 * 60 * 60_000;
export const ITEM_RETENTION_MS = 7 * DAY;
export const READ_RETENTION_MS = 30 * DAY;
export const MAX_ITEMS_PER_SOURCE = 150;

export interface SourceRow {
  id: string;
  name: string;
  url: string;
  category: NewsCategory;
  lang: string;
  builtin: number;
  enabled: number;
  added_at: string;
  last_ok_at: string | null;
  last_error: string | null;
  fail_count: number;
  next_try_at: number;
  last_try_at: number;
}

export interface ItemRow {
  id: string;
  source_id: string;
  title: string;
  url: string;
  at: string | null;
  first_seen_at: string;
  folded: string;
}

/** Depoya girecek başlık (ayrıştırılmış besleme öğesi). */
export interface NewItem {
  title: string;
  url: string;
  at: string | null;
}

/** Başlığın kümeleme ve okundu anahtarı için katlanmış biçimi: harf/rakam dışı her şey tek boşluk. */
export function foldTitle(title: string): string {
  return foldForSearch(title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Adresin karşılaştırma biçimi: şema, `www.`, sondaki `/` ve parça atılır. */
export function urlKey(url: string): string {
  return url
    .trim()
    .replace(/#.*$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

const hash = (text: string, length = 16) => createHash('sha1').update(text).digest('hex').slice(0, length);

/** Öğe kimliği belirleyicidir: aynı kaynaktan aynı adres silinip yeniden gelse de kimliği aynıdır. */
export const itemId = (sourceId: string, url: string) => `i${hash(`${sourceId}\n${urlKey(url)}`)}`;
/** Okundu anahtarları: adres ve katlanmış başlık (aynı haber başka adresle yeniden gelse de okundu kalır). */
export const readKeyOfUrl = (url: string) => `u:${hash(urlKey(url), 20)}`;
export const readKeyOfTitle = (folded: string) => `t:${hash(folded, 20)}`;

export function toSourceView(row: SourceRow, itemCount: number): NewsSourceView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    category: row.category,
    lang: row.lang,
    builtin: row.builtin === 1,
    enabled: row.enabled === 1,
    addedAt: row.added_at,
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
    itemCount,
  };
}

interface TopicRow {
  id: string;
  text: string;
  folded: string;
  mode: 'follow' | 'mute';
  origin: 'user' | 'profile';
  created_at: string;
}

export function createNewsStore(db: ScopedDb, now: () => number) {
  const iso = (ms = now()) => new Date(ms).toISOString();

  function stateGet(key: string): string | null {
    return db.get<{ value: string }>('SELECT value FROM news_state WHERE key = ?', [key])?.value ?? null;
  }
  function stateSet(key: string, value: string): void {
    db.run('INSERT INTO news_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  /**
   * Katalogu tohumlar: eksik yerleşikler eklenir (`on` olanlar etkin). Var olan yerleşiğin adı/adresi/konusu katalogdan
   * güncellenir ama `enabled` alanına DOKUNULMAZ: kullanıcının kapattığı yerleşik yeniden açılmaz.
   */
  function seed(catalog: readonly CatalogSource[] = NEWS_CATALOG): { added: number } {
    let added = 0;
    db.transaction(() => {
      for (const entry of catalog) {
        const existing = db.get<SourceRow>('SELECT * FROM news_sources WHERE id = ?', [entry.id]);
        // Aynı adresi kullanıcı kendisi eklemişse yerleşik ikinci kez açılmaz.
        const sameUrl = db.get<{ id: string }>('SELECT id FROM news_sources WHERE url = ? AND id != ?', [entry.url, entry.id]);
        if (existing) {
          if (!sameUrl) db.run('UPDATE news_sources SET name = ?, url = ?, category = ?, lang = ?, builtin = 1 WHERE id = ?', [entry.name, entry.url, entry.category, entry.lang, entry.id]);
          continue;
        }
        if (sameUrl) continue;
        db.run('INSERT INTO news_sources (id, name, url, category, lang, builtin, enabled, added_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', [
          entry.id,
          entry.name,
          entry.url,
          entry.category,
          entry.lang,
          entry.on ? 1 : 0,
          iso(),
        ]);
        added++;
      }
    });
    return { added };
  }

  function counts(): Map<string, number> {
    const rows = db.all<{ source_id: string; n: number }>('SELECT source_id, COUNT(*) AS n FROM news_items GROUP BY source_id');
    return new Map(rows.map((row) => [row.source_id, row.n]));
  }

  function sourceRows(): SourceRow[] {
    return db.all<SourceRow>('SELECT * FROM news_sources ORDER BY builtin DESC, rowid');
  }

  function source(id: string): SourceRow | undefined {
    return db.get<SourceRow>('SELECT * FROM news_sources WHERE id = ?', [id]);
  }

  function sourceByUrl(url: string): SourceRow | undefined {
    const key = urlKey(url);
    return sourceRows().find((row) => urlKey(row.url) === key);
  }

  function addSource(input: { id: string; name: string; url: string; category: NewsCategory; lang: string }): SourceRow {
    db.run('INSERT INTO news_sources (id, name, url, category, lang, builtin, enabled, added_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?)', [
      input.id,
      input.name,
      input.url,
      input.category,
      input.lang,
      iso(),
    ]);
    return source(input.id)!;
  }

  function setEnabled(id: string, enabled: boolean): void {
    // Yeniden açılan kaynak hemen okunabilsin: geri çekilme sıfırlanır.
    db.run('UPDATE news_sources SET enabled = ?, next_try_at = 0, fail_count = CASE WHEN ? = 1 THEN 0 ELSE fail_count END WHERE id = ?', [enabled ? 1 : 0, enabled ? 1 : 0, id]);
  }

  function deleteSource(id: string): void {
    db.transaction(() => {
      db.run('DELETE FROM news_items WHERE source_id = ?', [id]);
      db.run('DELETE FROM news_sources WHERE id = ?', [id]);
    });
  }

  function markTried(id: string, at: number): void {
    db.run('UPDATE news_sources SET last_try_at = ? WHERE id = ?', [at, id]);
  }

  function markOk(id: string): void {
    db.run('UPDATE news_sources SET last_ok_at = ?, last_error = NULL, fail_count = 0, next_try_at = 0 WHERE id = ?', [iso(), id]);
  }

  function markFailed(id: string, error: string, nextTryAt: number): number {
    db.run('UPDATE news_sources SET last_error = ?, fail_count = fail_count + 1, next_try_at = ? WHERE id = ?', [error, nextTryAt, id]);
    return source(id)?.fail_count ?? 0;
  }

  /** Başlıkları ekler; var olanın ilk görülme anı korunur. Eklenen yeni öğe sayısını döndürür. */
  function putItems(sourceId: string, items: readonly NewItem[]): number {
    const current = now();
    const cutoff = current - ITEM_RETENTION_MS;
    let added = 0;
    db.transaction(() => {
      for (const item of items) {
        const atMs = item.at ? Date.parse(item.at) : Number.NaN;
        if (Number.isFinite(atMs) && atMs < cutoff) continue;
        // Gelecek zamanlı öğe (yanlış saat dilimi) "şimdi" sayılır: sıralamayı ele geçirmesin.
        const at = Number.isFinite(atMs) ? iso(Math.min(atMs, current)) : null;
        const result = db.run('INSERT OR IGNORE INTO news_items (id, source_id, title, url, at, first_seen_at, folded) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          itemId(sourceId, item.url),
          sourceId,
          item.title,
          item.url,
          at,
          iso(current),
          foldTitle(item.title),
        ]);
        added += result.changes;
      }
    });
    return added;
  }

  /** Saklama: 7 günden eski başlıklar, kaynak başına 150'yi aşanlar ve 30 günden eski okundu kayıtları silinir. */
  function prune(): void {
    const current = now();
    const cutoff = iso(current - ITEM_RETENTION_MS);
    db.transaction(() => {
      db.run('DELETE FROM news_items WHERE COALESCE(at, first_seen_at) < ? AND first_seen_at < ?', [cutoff, cutoff]);
      db.run(
        `DELETE FROM news_items WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY COALESCE(at, first_seen_at) DESC, first_seen_at DESC) AS rank FROM news_items
          ) WHERE rank > ?
        )`,
        [MAX_ITEMS_PER_SOURCE],
      );
      db.run('DELETE FROM news_items WHERE source_id NOT IN (SELECT id FROM news_sources)');
      db.run('DELETE FROM news_read WHERE read_at < ?', [iso(current - READ_RETENTION_MS)]);
    });
  }

  /** Etkin kaynakların başlıkları, kaynak bilgisiyle. */
  function activeItems(): Array<ItemRow & { source_name: string; category: NewsCategory; lang: string }> {
    return db.all(
      `SELECT i.*, s.name AS source_name, s.category AS category, s.lang AS lang
       FROM news_items i JOIN news_sources s ON s.id = i.source_id
       WHERE s.enabled = 1`,
    );
  }

  function readKeys(): Set<string> {
    return new Set(db.all<{ key: string }>('SELECT key FROM news_read').map((row) => row.key));
  }

  function markRead(keys: readonly string[]): number {
    let changed = 0;
    const at = iso();
    db.transaction(() => {
      for (const key of keys) changed += db.run('INSERT OR IGNORE INTO news_read (key, read_at) VALUES (?, ?)', [key, at]).changes;
    });
    return changed;
  }

  function topics(): NewsTopic[] {
    return db
      .all<TopicRow>('SELECT * FROM news_topics ORDER BY created_at, text')
      .map((row) => ({ id: row.id, text: row.text, mode: row.mode, origin: row.origin, createdAt: row.created_at }));
  }

  /** Konuyu ekler ya da kipini değiştirir (katlanmış metin tekildir). */
  function upsertTopic(text: string, mode: 'follow' | 'mute'): void {
    const folded = foldTitle(text);
    const existing = db.get<TopicRow>('SELECT * FROM news_topics WHERE folded = ?', [folded]);
    if (existing) {
      db.run('UPDATE news_topics SET mode = ?, text = ? WHERE id = ?', [mode, text, existing.id]);
      return;
    }
    db.run('INSERT INTO news_topics (id, text, folded, mode, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)', [`t${hash(folded, 12)}`, text, folded, mode, 'user', iso()]);
  }

  function removeTopic(text: string): boolean {
    return db.run('DELETE FROM news_topics WHERE folded = ?', [foldTitle(text)]).changes > 0;
  }

  function itemCount(): number {
    return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM news_items')?.n ?? 0;
  }

  /** Kullanıcının bütün gündem verisi silinir; yerleşikler katalogdaki ilk hâline döner. */
  function purge(): void {
    db.transaction(() => {
      db.run('DELETE FROM news_items');
      db.run('DELETE FROM news_read');
      db.run('DELETE FROM news_topics');
      db.run('DELETE FROM news_state');
      db.run('DELETE FROM news_sources');
    });
    seed();
  }

  return {
    seed,
    sourceRows,
    source,
    sourceByUrl,
    addSource,
    setEnabled,
    deleteSource,
    markTried,
    markOk,
    markFailed,
    putItems,
    prune,
    activeItems,
    counts,
    readKeys,
    markRead,
    topics,
    upsertTopic,
    removeTopic,
    itemCount,
    stateGet,
    stateSet,
    purge,
  };
}

export type NewsStore = ReturnType<typeof createNewsStore>;
