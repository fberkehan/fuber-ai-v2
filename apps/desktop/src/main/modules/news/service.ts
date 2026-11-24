// Gündem servisi: kaynak okuma (eşzamanlı, tazelik + geri çekilme), birleştirme/puanlama, okundu, konular, kaynak
// ekleme/silme ve arka plan yenilemesi.
//
//   okuma       eşzamanlı en çok 6 kaynak; kaynak başına 8 sn ve 2 MB; tazelik 20 dk
//   geri çekilme  başarısızlıkta 5 dk'dan başlayıp her hatada ikiye katlanan, en çok 2 saat
//   arka plan   20 dk'da bir; ağ kapalıyken ya da Gizli kipte (`networkAllowed()`) ağa ÇIKILMAZ
//
// Saat dışarıdan verilir (`now`); `Date.now()` / `new Date()` (argümansız) burada kullanılmaz.
import { createHash } from 'node:crypto';
import { t, UserError, type Id, type Logger, type ScopedDb } from '@fuber/shared';
import { parseFeed } from '../web/news';
import { decodeBody, FetchBlockedError, FetchFailedError, type Fetcher } from '../web/net';
import { clip, fold } from '../web/text';
import type { NewsAccess, NewsInterests } from './access';
import { discoverFeed } from './discover';
import { clusterItems, diversify, publicStory, rankClusters, sortStories, titleWords, topicMatcher, type Cluster, type RankedStory, type RankItem } from './rank';
import { createNewsStore, foldTitle, readKeyOfTitle, readKeyOfUrl, toSourceView, type SourceRow } from './store';
import type { NewsAddResult, NewsSourceView, NewsStatus, NewsStoriesQuery, NewsStory, NewsTopic } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const FRESH_MS = 20 * MINUTE;
export const REFRESH_EVERY_MS = 20 * MINUTE;
export const CONCURRENCY = 6;
export const SOURCE_TIMEOUT_MS = 8_000;
export const SOURCE_MAX_BYTES = 2_000_000;
/** "Son dakika": en az bu kadar kaynağın verdiği haber. */
export const BREAKING_MIN_SOURCES = 3;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

/** Başarısız okumadan sonraki bekleme: 5, 10, 20, 40, 80, 120 dk. */
export function backoffMs(failures: number): number {
  return Math.min(2 * HOUR, 5 * MINUTE * 2 ** Math.max(0, failures - 1));
}

export type ChangeReason = 'refresh' | 'sources' | 'topics' | 'read';

export interface NewsServiceDeps {
  db: ScopedDb;
  fetcher: Fetcher;
  now: () => number;
  /** Profil katmanının ilgi alanları ve sevmedikleri. */
  interests: () => NewsInterests;
  log: Logger;
  /** Gizlilik kararı (`policy.networkAllowed`): false ise ağa çıkılmaz. */
  networkAllowed: () => boolean;
  onChange: (reason: ChangeReason) => void;
}

export interface NewsService extends NewsAccess {
  toggleSource(id: string, enabled: boolean): NewsSourceView;
  start(): void;
  stop(): void;
  purge(): void;
  /** Kaynak bayat mı (araç: "gerekirse önce yenile"). */
  stale(): boolean;
}

/** Okuma hatasını kısa Türkçe nedene çevirir. */
function errorText(error: unknown): string {
  if (error instanceof FetchBlockedError) return t('news.error.blocked');
  if (error instanceof FetchFailedError) {
    if (error.kind === 'timeout') return t('news.error.timeout');
    if (error.kind === 'status' && error.status) return t('news.error.status', { status: error.status });
    return t('news.error.network');
  }
  if (error instanceof SourceError) return error.message;
  return t('news.error.other');
}

class SourceError extends Error {}

async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  });
  await Promise.all(runners);
}

export function createNewsService(deps: NewsServiceDeps): NewsService {
  const store = createNewsStore(deps.db, deps.now);
  store.seed();
  store.prune();
  const iso = (ms: number) => new Date(ms).toISOString();

  let inflight: Promise<NewsStatus> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Kümeler veri değişince yeniden kurulur (puan her çağrıda saatle yeniden hesaplanır). */
  let clusterCache: { version: number; clusters: Cluster[] } | null = null;
  let version = 0;
  const bump = () => {
    version++;
  };

  function changed(reason: ChangeReason) {
    bump();
    if (!stopped) {
      try {
        deps.onChange(reason);
      } catch (error) {
        deps.log.debug('gündem: değişiklik bildirimi başarısız', error instanceof Error ? error.message : String(error));
      }
    }
  }

  function status(): NewsStatus {
    const rows = store.sourceRows();
    const enabled = rows.filter((row) => row.enabled === 1);
    const ranked = rankedAll();
    return {
      sources: rows.length,
      enabled: enabled.length,
      failing: enabled.filter((row) => row.last_error !== null).length,
      stories: ranked.length,
      unread: ranked.filter((story) => !story.read).length,
      lastRefreshAt: store.stateGet('lastRefreshAt'),
    };
  }

  function due(row: SourceRow, force: boolean, at: number): boolean {
    if (force) return true;
    if (row.next_try_at > at) return false;
    const lastOk = row.last_ok_at ? Date.parse(row.last_ok_at) : 0;
    return at - lastOk >= FRESH_MS;
  }

  async function readSource(row: SourceRow, signal?: AbortSignal): Promise<number> {
    const response = await deps.fetcher(row.url, {
      timeoutMs: SOURCE_TIMEOUT_MS,
      maxBytes: SOURCE_MAX_BYTES,
      ...(signal ? { signal } : {}),
      headers: { Accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5' },
    });
    if (response.status < 200 || response.status >= 300) throw new FetchFailedError('status', `HTTP ${response.status}`, response.status);
    const text = decodeBody(response);
    const items = parseFeed(text, { id: row.id, name: row.name, url: row.url }, 150);
    if (items.length === 0) throw new SourceError(/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 4000)) ? t('news.error.empty') : t('news.error.notFeed'));
    return store.putItems(
      row.id,
      items.map((item) => ({ title: clip(item.title, 200), url: item.url, at: item.at })),
    );
  }

  async function refresh(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<NewsStatus> {
    if (!deps.networkAllowed()) return status();
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const at = deps.now();
        const rows = store.sourceRows().filter((row) => row.enabled === 1 && due(row, options.force ?? false, at));
        let touched = false;
        await pool(rows, CONCURRENCY, async (row) => {
          if (options.signal?.aborted || stopped) return;
          store.markTried(row.id, at);
          try {
            await readSource(row, options.signal);
            store.markOk(row.id);
          } catch (error) {
            if (options.signal?.aborted) return;
            const failures = row.fail_count + 1;
            store.markFailed(row.id, errorText(error), deps.now() + backoffMs(failures));
            deps.log.debug(`gündem: ${row.name} okunamadı`, error instanceof Error ? error.message : String(error));
          }
          touched = true;
        });
        if (touched) {
          store.prune();
          store.stateSet('lastRefreshAt', iso(deps.now()));
          changed('refresh');
        }
        return status();
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function clusters(): Cluster[] {
    if (clusterCache && clusterCache.version === version) return clusterCache.clusters;
    const items: RankItem[] = store.activeItems().map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      category: row.category,
      lang: row.lang,
      title: row.title,
      url: row.url,
      at: row.at ? Date.parse(row.at) : null,
      firstSeen: Date.parse(row.first_seen_at),
    }));
    const built = clusterItems(items);
    clusterCache = { version, clusters: built };
    return built;
  }

  function topicLists() {
    const stored = store.topics();
    const interests = deps.interests();
    return {
      follow: stored.filter((topic) => topic.mode === 'follow').map((topic) => topic.text),
      mute: stored.filter((topic) => topic.mode === 'mute').map((topic) => topic.text),
      interests: interests.follow,
      dislikes: interests.mute,
    };
  }

  function rankedAll(): RankedStory[] {
    const read = store.readKeys();
    return rankClusters(clusters(), {
      now: deps.now(),
      topics: topicLists(),
      isRead: (items) => items.some((item) => read.has(readKeyOfUrl(item.url)) || read.has(readKeyOfTitle(foldTitle(item.title)))),
    });
  }

  function filtered(query: NewsStoriesQuery): RankedStory[] {
    let list = rankedAll();
    if (query.category) list = list.filter((story) => story.category === query.category);
    if (query.unreadOnly) list = list.filter((story) => !story.read);
    if (query.since) {
      const since = Date.parse(query.since);
      if (Number.isFinite(since)) list = list.filter((story) => story.firstSeen >= since);
    }
    if (query.topic?.trim()) {
      const matcher = topicMatcher(query.topic);
      if (matcher) {
        const titles = new Map(clusters().map((cluster) => [cluster.id, cluster.items.map((item) => titleWords(item.title))]));
        list = list.filter((story) => (titles.get(story.id) ?? [titleWords(story.title)]).some((words) => matcher.matches(words)));
      }
    }
    return list;
  }

  const limitOf = (limit: number | undefined) => Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));

  function stories(query: NewsStoriesQuery = {}): NewsStory[] {
    return diversify(sortStories(filtered(query)))
      .slice(0, limitOf(query.limit))
      .map(publicStory);
  }

  function breaking(sinceIso: string): NewsStory[] {
    const since = Date.parse(sinceIso);
    const list = rankedAll().filter((story) => {
      if (story.read) return false;
      const at = story.at ? Date.parse(story.at) : story.firstSeen;
      if (Number.isFinite(since) && Math.max(at, story.firstSeen) < since) return false;
      return story.sources.length >= BREAKING_MIN_SOURCES || story.followHit;
    });
    return list.sort((a, b) => b.score - a.score).map(publicStory);
  }

  function markRead(ids: Id[]): void {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    const keys: string[] = [];
    for (const cluster of clusters()) {
      if (!wanted.has(cluster.id) && !cluster.items.some((item) => wanted.has(item.id))) continue;
      for (const item of cluster.items) keys.push(readKeyOfUrl(item.url), readKeyOfTitle(foldTitle(item.title)));
    }
    if (keys.length && store.markRead(keys) > 0) changed('read');
  }

  function sources(): NewsSourceView[] {
    const counts = store.counts();
    return store.sourceRows().map((row) => toSourceView(row, counts.get(row.id) ?? 0));
  }

  const viewOf = (id: string): NewsSourceView => {
    const row = store.source(id);
    if (!row) throw new UserError(t('news.error.unknownSource'));
    return toSourceView(row, store.counts().get(id) ?? 0);
  };

  function toggleSource(id: string, enabled: boolean): NewsSourceView {
    if (!store.source(id)) throw new UserError(t('news.error.unknownSource'));
    store.setEnabled(id, enabled);
    changed('sources');
    if (enabled && deps.networkAllowed()) void refresh().catch(() => undefined);
    return viewOf(id);
  }

  function removeSource(id: string): boolean {
    const row = store.source(id);
    if (!row) return false;
    if (row.builtin === 1) store.setEnabled(id, false);
    else store.deleteSource(id);
    changed('sources');
    return true;
  }

  /** Kaynağı hemen okur (ekleme sonrası); başlık sayısını döndürür. */
  async function readNow(id: string): Promise<number> {
    const row = store.source(id);
    if (!row || !deps.networkAllowed()) return store.counts().get(id) ?? 0;
    store.markTried(id, deps.now());
    try {
      await readSource(row);
      store.markOk(id);
    } catch (error) {
      store.markFailed(id, errorText(error), deps.now() + backoffMs(row.fail_count + 1));
    }
    return store.counts().get(id) ?? 0;
  }

  async function addSource(query: string): Promise<NewsAddResult> {
    const text = query.trim();
    if (!text) return { ok: false, source: null, message: t('news.add.empty'), tried: [] };
    if (!deps.networkAllowed()) return { ok: false, source: null, message: t('news.add.offline'), tried: [] };
    const outcome = await discoverFeed(text, deps.fetcher, { now: deps.now });
    if (outcome.kind === 'blocked') return { ok: false, source: null, message: t('news.add.blocked', { query: text }), tried: outcome.tried };
    if (outcome.kind === 'none') {
      const tried = outcome.tried.slice(0, 6).map((url) => url.replace(/^https?:\/\//, '')).join(', ');
      return { ok: false, source: null, message: tried ? t('news.add.notFound', { query: text, tried }) : t('news.add.notFoundShort', { query: text }), tried: outcome.tried };
    }

    const existing = outcome.kind === 'catalog' ? (store.source(outcome.entry.id) ?? store.sourceByUrl(outcome.entry.url)) : store.sourceByUrl(outcome.url);
    if (existing) {
      if (existing.enabled === 1) return { ok: true, source: viewOf(existing.id), message: t('news.add.already', { name: existing.name }), tried: outcome.tried };
      store.setEnabled(existing.id, true);
      if (outcome.kind === 'feed') store.putItems(existing.id, outcome.items.map((item) => ({ title: clip(item.title, 200), url: item.url, at: item.at })));
      const count = outcome.kind === 'feed' ? (store.counts().get(existing.id) ?? 0) : await readNow(existing.id);
      if (outcome.kind === 'feed') store.markOk(existing.id);
      changed('sources');
      return { ok: true, source: viewOf(existing.id), message: t('news.add.added', { name: existing.name, count }), tried: outcome.tried };
    }

    if (outcome.kind === 'catalog') {
      // Katalog kaydı depoda yoksa (ör. kullanıcının aynı adresi silmesi) tohumlama yeniden ekler.
      store.seed([outcome.entry]);
      store.setEnabled(outcome.entry.id, true);
      const count = await readNow(outcome.entry.id);
      changed('sources');
      return { ok: true, source: viewOf(outcome.entry.id), message: t('news.add.added', { name: outcome.entry.name, count }), tried: outcome.tried };
    }

    const id = `u-${createHash('sha1').update(outcome.url).digest('hex').slice(0, 10)}`;
    store.addSource({ id, name: outcome.name, url: outcome.url, category: outcome.category, lang: outcome.lang });
    store.putItems(id, outcome.items.map((item) => ({ title: clip(item.title, 200), url: item.url, at: item.at })));
    store.markTried(id, deps.now());
    store.markOk(id);
    store.prune();
    changed('sources');
    const count = store.counts().get(id) ?? 0;
    return { ok: true, source: viewOf(id), message: t('news.add.added', { name: outcome.name, count }), tried: outcome.tried };
  }

  function topics(): NewsTopic[] {
    const stored = store.topics();
    const known = new Set(stored.map((topic) => fold(topic.text).trim()));
    const createdAt = iso(deps.now());
    const profile = deps
      .interests()
      .follow.filter((text) => text.trim() && !known.has(fold(text).trim()))
      .map<NewsTopic>((text) => ({ id: `profile:${foldTitle(text)}`, text, mode: 'follow', origin: 'profile', createdAt }));
    return [...stored, ...profile];
  }

  function setTopic(text: string, mode: 'follow' | 'mute' | 'remove'): NewsTopic[] {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!clean || !foldTitle(clean)) throw new UserError(t('news.error.emptyTopic'));
    if (mode === 'remove') {
      if (store.removeTopic(clean)) changed('topics');
    } else {
      store.upsertTopic(clean, mode);
      changed('topics');
    }
    return topics();
  }

  function stale(): boolean {
    const at = deps.now();
    return store.sourceRows().some((row) => row.enabled === 1 && due(row, false, at));
  }

  return {
    stories,
    breaking,
    refresh,
    markRead,
    status,
    sources,
    topics,
    setTopic,
    addSource,
    removeSource,
    toggleSource,
    stale,
    start() {
      stopped = false;
      if (timer) return;
      timer = setInterval(() => {
        if (deps.networkAllowed()) void refresh().catch((error) => deps.log.debug('gündem: arka plan yenilemesi başarısız', error instanceof Error ? error.message : String(error)));
      }, REFRESH_EVERY_MS);
      timer.unref?.();
      // İlk okuma açılıştan biraz sonra (açılışı yavaşlatmasın).
      firstTimer = setTimeout(() => {
        firstTimer = null;
        if (!stopped && deps.networkAllowed()) void refresh().catch(() => undefined);
      }, 15_000);
      firstTimer.unref?.();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (firstTimer) clearTimeout(firstTimer);
      timer = null;
      firstTimer = null;
    },
    purge() {
      store.purge();
      changed('sources');
    },
  };
}
