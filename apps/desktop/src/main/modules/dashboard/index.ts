// Kokpit modülü: Bugün sayfasının panosu (KURGU §12; V1-DENKLIK §2.11, §5 madde 2–3).
//
//   kart deposu ve kalıcı düzen      store.ts
//   yerleşik doldurucular            providers.ts (bugün bandı, süren işler, bildirimler, sırada, yapılacaklar,
//                                    Claude Code oturumları, son olanlar, kullanım, öneriler)
//   ağdan gelen kartlar              network.ts (hava, döviz, haber; önbellek + geri çekilme)
//   okuma, sıra, yayın               engine.ts
//   araçlar                          tools.ts (dashboard_card_add/update/remove, dashboard_layout, suggestion_add)
//
// Başka modüller kendi kartını `dashboard.registerProvider({...})` ile kaydeder (`@fuber/shared` › `dashboard.ts`);
// bu modül kayıttaki bütün kartları doldurur. Yerleşik kartlar da aynı kayıttan geçer.
//
// Ağ: bütün istekler web modülünün güvenli kapısından (`safeFetch`) geçer; dışarıya yalnız şehir adı ve para kodu
// gider. Sınama kipinde ağa HİÇ çıkılmaz: betik `__fuber2Test.dashboard.setNetwork(...)` ile kayıtlı yanıt verir.
import { dashboard, defineModule, t, UserError, type DashboardProvider, type DashboardSize, type JobsItem, type ModuleContext, type ModuleDef, type Unsubscribe } from '@fuber/shared';
import type { BrainService } from '../../core/brain';
import { testing } from '../../testing';
import { FetchFailedError, safeFetch, type Fetcher } from '../web/net';
import { createDashboardEngine, type DashboardEngine } from './engine';
import { createDashboardNetwork, type DashboardNetwork, type NetKey } from './network';
import { builtinProviders, MODULE_ID } from './providers';
import { createDashboardStore, DASHBOARD_MIGRATIONS, type DashboardStore } from './store';
import { dashboardTools } from './tools';

export interface DashboardModuleDeps {
  /** Sınamada kayıtlı yanıt döndüren sahte ağ; üretimde `safeFetch`. */
  fetcher?: Fetcher;
  now?: () => number;
  timeZone?: () => string | undefined;
}

/** Sınama betiğinin verdiği kayıtlı yanıt: adres `match` içeriyorsa `body` döner. */
export interface TestRoute {
  match: string;
  body: string;
  status?: number;
  contentType?: string;
}

interface Active {
  store: DashboardStore;
  network: DashboardNetwork;
  engine: DashboardEngine;
  offs: Unsubscribe[];
}

export function createDashboardModule(deps: DashboardModuleDeps = {}): ModuleDef {
  let active: Active | null = null;
  let attachedBrain: Partial<BrainService> | null = null;
  /** Sınama örnekleri (`__fuber2Test.dashboard.samples`); üretimde hiç dolmaz. */
  const sampleOffs: Unsubscribe[] = [];
  const live = (): Active => {
    if (!active) throw new UserError(t('dashboard.error.off'));
    return active;
  };

  // Sınama sınırı: gerçek ağ yerine betiğin verdiği yanıtlar; yanıt verilmediyse ağ "yok"tur (kart çizilmez).
  let testRoutes: TestRoute[] = [];
  const testFetcher: Fetcher = async (url) => {
    const route = testRoutes.find((candidate) => url.includes(candidate.match));
    if (!route) throw new FetchFailedError('network', 'sınama kipinde ağ yok');
    return { status: route.status ?? 200, url, contentType: route.contentType ?? 'text/plain', charset: 'utf-8', body: Buffer.from(route.body, 'utf8'), truncated: false };
  };
  const fetcher = deps.fetcher ?? (testing.enabled ? testFetcher : safeFetch);

  return defineModule({
    id: MODULE_ID,
    version: '1.0.0',
    nameKey: 'module.dashboard.name',
    descriptionKey: 'module.dashboard.description',
    permissions: ['net'],
    migrations: DASHBOARD_MIGRATIONS,
    windowEvents: ['dashboard.changed'],

    tools: dashboardTools({ store: () => live().store, engine: () => live().engine, network: () => live().network }),

    ipc: () => ({
      'dashboard.get': () => live().engine.snapshot(),
      'dashboard.reorder': ({ ids }) => live().engine.reorder(ids, 'user'),
      'dashboard.resize': ({ id, size }: { id: string; size: DashboardSize }) => live().engine.resize(id, size, 'user'),
      'dashboard.remove': ({ id }) => live().engine.remove(id, 'user').snapshot,
      'dashboard.restore': ({ id }) => live().engine.restore(id, 'user').snapshot,
      'dashboard.reset': () => live().engine.reset('user'),
      'dashboard.dismissSuggestion': ({ id }) => {
        live().store.dismissSuggestion(id);
        return live().engine.publish('card', 'user', 'suggestions', true);
      },
    }),

    setup(ctx: ModuleContext) {
      const store = createDashboardStore(ctx.db, deps.now);
      store.sweep();
      const network = createDashboardNetwork({
        store,
        fetcher,
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
        networkAllowed: () => ctx.policy.networkAllowed(),
        onChange: (key: NetKey) => dashboard.invalidate(key),
        log: ctx.log,
      });
      const builtins = builtinProviders({ ctx, store, network });
      const builtinIds = new Set(builtins.map((provider) => provider.id));
      const offs = builtins.map((provider) => dashboard.registerProvider(provider));
      const engine = createDashboardEngine({ ctx, store, network, isBuiltin: (id) => builtinIds.has(id), ...(deps.now ? { now: deps.now } : {}) });
      engine.start();
      active = { store, network, engine, offs };
      // Öz-tanım: pano asistanın "değiştirebildiklerim" arasındadır. Metin sabittir (sabit sistem istemine girer; panonun
      // o anki dizilişi değil; o, pano sözünde bağlam notuyla gider).
      const brain = ctx.brain as Partial<BrainService>;
      try {
        brain.attachSelfPart?.(MODULE_ID, () => ({ canChange: [t('dashboard.self.canChange')] }));
        attachedBrain = brain;
      } catch (error) {
        ctx.log.debug(`öz-tanım parçası bağlanamadı: ${error instanceof Error ? error.message : String(error)}`);
      }

      testing.expose({
        dashboard: {
          /** Kayıtlı yanıtları verir (boş dizi: ağ yok) ve ağ kartlarını hemen yeniler. */
          async setNetwork(routes: TestRoute[]) {
            testRoutes = routes;
            network.clearMemory();
            await network.refreshNow();
            return engine.snapshot().cards.map((card) => card.id);
          },
          snapshot: () => engine.snapshot(),
          /**
           * Görüntü sınaması: başka modüllerin kart türleriyle (`mail.important`, `meeting`) örnek kartlar ve "Süren işler"e
           * örnek katkı (takip işi). Gerçek modüllerin doldurucuları kendi uçtan uca sınamalarında denetlenir; bu yalnız
           * çizimi (taşma, boş kart, çift kart) birlikte görmek içindir. `null`: örnekler kalkar.
           */
          samples(input: { cards: Array<Omit<DashboardProvider, 'fill'> & { data: unknown }>; jobs: JobsItem[] } | null) {
            for (const off of sampleOffs.splice(0)) off();
            if (input) {
              for (const card of input.cards) sampleOffs.push(dashboard.registerProvider({ ...card, id: `sample.${card.id}`, fill: () => ({ data: card.data }) }));
              sampleOffs.push(ctx.bus.on('dashboard.jobs.collect', (box) => void box.items.push(...input.jobs)));
            }
            dashboard.invalidate();
            return engine.snapshot().cards.map((card) => card.id);
          },
        },
      });
    },

    teardown() {
      try {
        attachedBrain?.attachSelfPart?.(MODULE_ID, null);
      } catch {
        // Beyin yer tutucusu: bağlanan bir şey yoktu.
      }
      attachedBrain = null;
      for (const off of sampleOffs.splice(0)) off();
      if (!active) return;
      active.engine.stop();
      active.network.stop();
      for (const off of active.offs) off();
      active = null;
    },

    purge(ctx: ModuleContext) {
      createDashboardStore(ctx.db).purge();
      active?.engine.publish('layout', 'user', null, true);
    },
  });
}

export default createDashboardModule();
