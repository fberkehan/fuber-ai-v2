// Gündem modülü: kullanıcının RSS kaynakları, takip/sessize alınan konular ve ilgiye göre puanlanmış, yinelenenleri
// birleştirilmiş haber listesi.
//
//   sözleşme (IPC, olay, tipler)   types.ts
//   yerleşik katalog               catalog.ts
//   depo ve göçler                 store.ts
//   besleme keşfi                  discover.ts
//   kümeleme, puan, eşleşme        rank.ts (saf)
//   servis (okuma, geri çekilme)   service.ts
//   başka modüllere yüz            access.ts (`activeNews`, `setNewsInterestProvider`)
//   araçlar                        tools.ts (feed_add, feed_remove, feed_list, feed_topic, feed_news)
//
// Ağ: bütün istekler web modülünün güvenli kapısından (`safeFetch`) geçer; dışarıya yalnız besleme adresi gider.
// Sınama kipinde ağa HİÇ çıkılmaz: betik `__fuber2Test.news.setNetwork(routes)` ile kayıtlı yanıt, `setNow(ms)` ile
// sahte saat verir.
import { defineModule, t, UserError, type ModuleContext, type ModuleDef } from '@fuber/shared';
import { testing } from '../../testing';
import { FetchFailedError, safeFetch, type Fetcher } from '../web/net';
import { readNewsInterests, setActiveNews } from './access';
import { createNewsService, type NewsService } from './service';
import { createNewsStore, NEWS_MIGRATIONS } from './store';
import { newsTools } from './tools';
import type { NewsStoriesQuery } from './types';

export const MODULE_ID = 'news';

export interface NewsModuleDeps {
  /** Sınamada kayıtlı yanıt döndüren sahte ağ; üretimde `safeFetch`. */
  fetcher?: Fetcher;
  now?: () => number;
}

/** Sınama betiğinin verdiği kayıtlı yanıt: adres `match` içeriyorsa `body` döner. */
export interface NewsTestRoute {
  match: string;
  body: string;
  status?: number;
  contentType?: string;
}

export function createNewsModule(deps: NewsModuleDeps = {}): ModuleDef {
  let service: NewsService | null = null;
  const live = (): NewsService => {
    if (!service) throw new UserError(t('news.error.off'));
    return service;
  };

  // Sınama sınırı: gerçek ağ yerine betiğin verdiği yanıtlar; yanıt verilmediyse ağ "yok"tur.
  let testRoutes: NewsTestRoute[] = [];
  const testFetcher: Fetcher = async (url) => {
    const route = testRoutes.find((candidate) => url.includes(candidate.match));
    if (!route) throw new FetchFailedError('network', 'sınama kipinde ağ yok');
    return { status: route.status ?? 200, url, contentType: route.contentType ?? 'application/rss+xml', charset: 'utf-8', body: Buffer.from(route.body, 'utf8'), truncated: false };
  };
  const fetcher = deps.fetcher ?? (testing.enabled ? testFetcher : safeFetch);
  let testNow: number | null = null;
  const now = (): number => testNow ?? (deps.now ? deps.now() : Date.now());

  return defineModule({
    id: MODULE_ID,
    version: '1.0.0',
    nameKey: 'module.news.name',
    descriptionKey: 'module.news.description',
    permissions: ['net'],
    migrations: NEWS_MIGRATIONS,
    windowEvents: ['news.changed'],

    tools: newsTools({ service: live, now }),

    ipc: () => ({
      'news.sources': () => live().sources(),
      'news.addSource': ({ query }) => live().addSource(query),
      'news.removeSource': ({ id }) => {
        if (!live().removeSource(id)) throw new UserError(t('news.error.unknownSource'));
        return { ok: true as const };
      },
      'news.toggleSource': ({ id, enabled }) => live().toggleSource(id, enabled),
      'news.topics': () => live().topics(),
      'news.setTopic': ({ text, mode }) => live().setTopic(text, mode),
      'news.stories': (query: NewsStoriesQuery) => live().stories(query ?? {}),
      'news.markRead': ({ ids }) => {
        live().markRead(ids);
        return { ok: true as const };
      },
      'news.refresh': () => live().refresh({ force: true }),
      'news.status': () => live().status(),
    }),

    setup(ctx: ModuleContext) {
      const created = createNewsService({
        db: ctx.db,
        fetcher,
        now,
        interests: readNewsInterests,
        log: ctx.log,
        networkAllowed: () => ctx.policy.networkAllowed(),
        onChange: (reason) => ctx.bus.emit('news.changed', { reason }),
      });
      service = created;
      setActiveNews(created);
      created.start();

      testing.expose({
        news: {
          /** Kayıtlı yanıtları verir (boş dizi: ağ yok) ve bütün etkin kaynakları hemen okur. */
          async setNetwork(routes: NewsTestRoute[]) {
            testRoutes = routes;
            return created.refresh({ force: true });
          },
          refresh: () => created.refresh({ force: true }),
          stories: (query: NewsStoriesQuery = {}) => created.stories(query),
          status: () => created.status(),
          /** Sahte saat (ms); `null` gerçek saate döner. */
          setNow(ms: number | null) {
            testNow = ms;
            return now();
          },
        },
      });
    },

    teardown() {
      service?.stop();
      service = null;
      setActiveNews(null);
    },

    purge(ctx: ModuleContext) {
      if (service) service.purge();
      else createNewsStore(ctx.db, now).purge();
    },
  });
}

export default createNewsModule();
