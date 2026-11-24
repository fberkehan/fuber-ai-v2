// Pano motoru: kayıtlı doldurucuları çalıştırır, boş kartları eler, kalıcı düzeni uygular ve değişimi yayınlar.
//
// Okuma ucuzdur ve eşzamanlıdır (yerel SQLite + ağ kartlarının önbelleği); ağ hiçbir zaman beklenmez.
// Değişim iki yoldan gelir: (1) bir doldurucunun bildirdiği olay ya da `dashboard.invalidate` → kısa bir bekleme ile
// tek okumaya katlanır, içerik gerçekten değiştiyse `dashboard.changed` yayınlanır; (2) düzen/kart işlemleri
// (kullanıcı ya da araç) → hemen yayınlanır.
import {
  customCardKind,
  dashboard,
  isEmptyCardData,
  localDay,
  orderDashboardCards,
  type BusEvents,
  type DashboardCard,
  type DashboardCardSource,
  type DashboardProvider,
  type DashboardSize,
  type DashboardSnapshot,
  type ModuleContext,
  type Unsubscribe,
} from '@fuber/shared';
import type { DashboardNetwork } from './network';
import { MODULE_ID } from './providers';
import type { CustomCard, DashboardStore } from './store';

/** Özel kartların varsayılan sıradaki yeri (yerleşiklerin ortası). Araçla eklenen kart ayrıca en başa yazılır. */
const CUSTOM_PRIORITY = 50;
/** Art arda gelen olaylar bu kadar beklenip tek okumaya katlanır. */
const COALESCE_MS = 60;

export const DEFAULT_CUSTOM_SIZE: Record<CustomCard['content']['template'], DashboardSize> = {
  text: 'medium',
  keyvalue: 'medium',
  list: 'medium',
  metric: 'small',
  progress: 'small',
  link: 'small',
};

export const foldTitle = (text: string): string =>
  text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Yerleşik kartların konuşmadaki adları (katlanmış): kullanıcı "hava durumu", "kur", "ajanda" der; model de çoğu kez
 * başlığı değil bu sözü verir. Kimlik ve başlık ayrıca eşleşir.
 */
export const CARD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  weather: ['hava', 'hava durumu', 'weather', 'sicaklik', 'meteoroloji'],
  fx: ['doviz', 'doviz kuru', 'kur', 'kurlar', 'dolar', 'euro', 'avro', 'exchange', 'currency'],
  news: ['haber', 'haberler', 'news', 'gundem'],
  agenda: ['sirada', 'hatirlatici', 'hatirlaticilar', 'ajanda', 'takvim', 'agenda', 'reminders'],
  todos: ['yapilacak', 'yapilacaklar', 'yapilacaklar listesi', 'todo', 'todos', 'gorevler'],
  jobs: ['suren isler', 'suren is', 'arka plan isleri', 'isler', 'jobs'],
  notices: ['bildirim', 'bildirimler', 'notifications'],
  suggestions: ['oneri', 'oneriler', 'suggestions'],
  sessions: ['claude code', 'claude', 'oturum', 'oturumlar', 'sessions'],
  activity: ['son olanlar', 'gecmis', 'activity'],
  usage: ['kullanim', 'bugunku kullanim', 'maliyet', 'harcama', 'usage'],
};

/** Kart adından sonra söylenen dolgu sözcükleri: "hava kartı", "döviz kutusunu", "haberler paneli". */
const CARD_FILLER = /\b(kart|karti|kartini|kartin|kartlari|kutu|kutusu|kutusunu|kutucuk|kutucugu|kutucugunu|panel|paneli|panelini|widget|bolumu|bolumunu)\b/g;

/** Kart başvurusunu karşılaştırmaya hazırlar: Türkçe katlama + dolgu sözcüklerini atma. */
export const foldCardName = (text: string): string => foldTitle(text).replace(CARD_FILLER, ' ').replace(/\s+/g, ' ').trim();

export interface EngineDeps {
  ctx: ModuleContext;
  store: DashboardStore;
  network: DashboardNetwork;
  /** Kart bu modülün kendi (yerleşik) doldurucusu mu; değilse başka bir modülün kaydıdır. */
  isBuiltin(id: string): boolean;
  now?: () => number;
}

/** Araçların ve arayüzün "hangi kart" sorusuna yanıtı: çizilen, gizlenen ve o an boş olan kartların hepsi. */
export interface KnownCard {
  id: string;
  title: string;
  /** Kaydın kendi başlığı ("Hava"); `title` veriden gelen adla ("Ankara") değişmiş olabilir. İkisiyle de bulunur. */
  baseTitle: string;
  /** Şu an panoda çiziliyor mu. */
  visible: boolean;
  hidden: boolean;
  custom: boolean;
  band: boolean;
  size: DashboardSize;
}

export function createDashboardEngine({ ctx, store, network, isBuiltin, now = Date.now }: EngineDeps) {
  let revision = 0;
  /** Pencerelere en son duyurulan sürüm. Araya giren bir okuma (`dashboard.get`) sürümü ilerletse de duyuru kaçmaz. */
  let announced = 0;
  let signature = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let offs: Unsubscribe[] = [];
  let registryOff: Unsubscribe | null = null;
  let started = false;

  const priorityOf = new Map<string, number>();

  function build(): { cards: DashboardCard[]; validUntil: string | null } {
    const at = new Date(now());
    const context = { now: at, today: localDay(at) };
    const layout = store.layout();
    const hidden = new Set(layout.hidden);
    const cards: DashboardCard[] = [];
    const expiries: number[] = [];
    priorityOf.clear();

    for (const provider of dashboard.providers()) {
      priorityOf.set(provider.id, provider.band ? Number.MAX_SAFE_INTEGER : provider.priority);
      if (hidden.has(provider.id) && !provider.band) continue;
      let fill: ReturnType<DashboardProvider['fill']> = null;
      try {
        fill = provider.fill(context);
      } catch (error) {
        ctx.log.warn(`pano: "${provider.id}" kartı doldurulamadı`, error);
      }
      // Boş kart çizilmez (bant hariç: selam her zaman vardır).
      if (!fill || (!provider.band && isEmptyCardData(fill.data))) continue;
      if (fill.validUntil) expiries.push(Date.parse(fill.validUntil));
      cards.push({
        id: provider.id,
        kind: provider.kind ?? provider.id,
        moduleId: provider.moduleId,
        title: fill.title ?? provider.title,
        size: layout.sizes[provider.id] ?? provider.defaultSize,
        defaultSize: provider.defaultSize,
        source: isBuiltin(provider.id) ? 'system' : 'module',
        band: provider.band === true,
        priority: provider.band ? Number.MAX_SAFE_INTEGER : provider.priority,
        page: provider.page ?? null,
        updatedAt: fill.updatedAt ?? null,
        stale: fill.stale === true,
        data: fill.data,
      });
    }

    for (const custom of store.cards()) {
      priorityOf.set(custom.id, CUSTOM_PRIORITY);
      if (isEmptyCardData(custom.content)) continue;
      cards.push({
        id: custom.id,
        kind: customCardKind(custom.content.template),
        moduleId: MODULE_ID,
        title: custom.title,
        size: layout.sizes[custom.id] ?? custom.size,
        defaultSize: custom.size,
        source: custom.source,
        band: false,
        priority: CUSTOM_PRIORITY,
        page: null,
        updatedAt: custom.updatedAt,
        stale: false,
        data: custom.content,
      });
    }

    const ordered = orderDashboardCards(cards, layout.order, (card) => priorityOf.get(card.id) ?? 0);
    const soonest = expiries.filter((value) => Number.isFinite(value) && value > at.getTime());
    return { cards: ordered, validUntil: soonest.length ? new Date(Math.min(...soonest)).toISOString() : null };
  }

  function snapshot(): DashboardSnapshot {
    // Bayat ağ kartları arka planda yenilenir; bitince `network.onChange` panoyu yeniden yayınlatır.
    network.ensureFresh();
    const { cards, validUntil } = build();
    const layout = store.layout();
    const next = JSON.stringify([cards, layout]);
    if (next !== signature) {
      signature = next;
      revision += 1;
    }
    return {
      revision,
      generatedAt: new Date(now()).toISOString(),
      cards,
      layout,
      customized: layout.order.length > 0 || Object.keys(layout.sizes).length > 0 || layout.hidden.length > 0,
      validUntil,
    };
  }

  function publish(reason: BusEvents['dashboard.changed']['reason'], by: DashboardCardSource, cardId: string | null = null, force = false): DashboardSnapshot {
    const snap = snapshot();
    if (force || snap.revision !== announced) {
      announced = snap.revision;
      ctx.bus.emit('dashboard.changed', { revision: snap.revision, reason, by, cardId });
    }
    return snap;
  }

  /** Veri değişmiş olabilir: kısa bir beklemeden sonra okunur, içerik değiştiyse yayınlanır. */
  function schedule(): void {
    if (!started || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (started) publish('data', 'system');
    }, COALESCE_MS);
  }

  function subscribe(): void {
    for (const off of offs) off();
    const events = new Set<keyof BusEvents>();
    for (const provider of dashboard.providers()) for (const event of provider.events ?? []) events.add(event);
    offs = [...events].map((event) => ctx.bus.on(event, schedule));
  }

  function known(): KnownCard[] {
    const layout = store.layout();
    const visible = new Map(build().cards.map((card) => [card.id, card]));
    const out: KnownCard[] = [];
    for (const provider of dashboard.providers()) {
      const card = visible.get(provider.id);
      out.push({
        id: provider.id,
        title: card?.title ?? provider.title,
        baseTitle: provider.title,
        visible: card !== undefined,
        hidden: layout.hidden.includes(provider.id),
        custom: false,
        band: provider.band === true,
        size: layout.sizes[provider.id] ?? provider.defaultSize,
      });
    }
    for (const custom of store.cards()) {
      out.push({ id: custom.id, title: custom.title, baseTitle: custom.title, visible: visible.has(custom.id), hidden: false, custom: true, band: false, size: layout.sizes[custom.id] ?? custom.size });
    }
    return out;
  }

  /** Kimlikle, olmazsa başlıkla (büyük/küçük harf ve Türkçe harf farkı gözetmeden) kart bulur. */
  function find(reference: string): KnownCard | null {
    const all = known();
    const exact = all.find((card) => card.id === reference.trim());
    if (exact) return exact;
    const wanted = foldCardName(reference) || foldTitle(reference);
    if (!wanted) return null;
    const own = (card: KnownCard) => [foldTitle(card.title), foldTitle(card.baseTitle), foldTitle(card.id)];
    const names = (card: KnownCard) => [...own(card), ...(CARD_ALIASES[card.id] ?? [])];
    return (
      // Önce tam eşleşme (başlık, kimlik, eş anlamlı): "kur" → döviz, "hava durumu" → hava.
      all.find((card) => names(card).includes(wanted)) ??
      // Sonra kısmi: başlık sözün içinde ya da söz başlığın içinde geçer ("istanbul havası", "dolar kuru kartı").
      all.find((card) => own(card).some((name) => name.length >= 3 && (name.includes(wanted) || wanted.includes(name)))) ??
      all.find((card) => (CARD_ALIASES[card.id] ?? []).some((name) => name.length >= 4 && wanted.split(' ').includes(name))) ??
      null
    );
  }

  /**
   * Görünen kartların yeni sırasını kalıcı düzene işler: o an çizilmeyen (boş ya da ağ bekleyen) kartlar eski
   * yerlerini korur, görünenler verilen sıraya girer.
   */
  function applyOrder(visibleIds: readonly string[]): void {
    const wanted = [...new Set(visibleIds)];
    const moving = new Set(wanted);
    const old = store.layout().order;
    const queue = [...wanted];
    const merged: string[] = [];
    for (const id of old) {
      if (moving.has(id)) {
        const next = queue.shift();
        if (next !== undefined) merged.push(next);
      } else {
        merged.push(id);
      }
    }
    store.setOrder([...merged, ...queue]);
  }

  return {
    snapshot,
    publish,
    schedule,
    known,
    find,

    start(): void {
      started = true;
      subscribe();
      // Kayıt aboneliği olay aboneliklerinden AYRI tutulur: `subscribe()` olay aboneliklerini yeniden kurarken onu da
      // kaldırıyordu; pano modülünden SONRA kart kaydeden ilk modülde (e-posta, toplantı) `dashboard.invalidate`
      // dinlenmez olur, ağ kartları (hava, döviz, haber) hiç yayınlanmazdı (uçtan uca sınamada bulundu).
      registryOff?.();
      registryOff = dashboard.subscribe((change) => {
        if (change.kind === 'providers') subscribe();
        schedule();
      });
      // İlk imza: açılışta "değişti" yayını yapılmasın.
      announced = snapshot().revision;
    },
    stop(): void {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const off of offs) off();
      offs = [];
      registryOff?.();
      registryOff = null;
    },

    /** Kartları sıralar. Bant ve bilinmeyen kimlikler atlanır; verilmeyen görünür kartlar sonda, kendi sıralarıyla kalır. */
    reorder(ids: readonly string[], by: DashboardCardSource): DashboardSnapshot {
      const current = build()
        .cards.filter((card) => !card.band)
        .map((card) => card.id);
      // Panoda olmayan kimlik de saklanır: arayüzün kendi kaydettiği (ana süreçte doldurucusu olmayan) kartın yeridir.
      const bands = new Set(dashboard.providers().filter((provider) => provider.band).map((provider) => provider.id));
      const head = [...new Set(ids)].filter((id) => !bands.has(id));
      applyOrder([...head, ...current.filter((id) => !head.includes(id))]);
      return publish('layout', by);
    },
    /** Tek kartı, öteki görünür kartların arasında verilen sıraya (0 = en baş) koyar. */
    move(id: string, index: number, by: DashboardCardSource): DashboardSnapshot {
      const others = build()
        .cards.filter((card) => !card.band && card.id !== id)
        .map((card) => card.id);
      const at = Math.max(0, Math.min(others.length, index));
      applyOrder([...others.slice(0, at), id, ...others.slice(at)]);
      return publish('layout', by, id, true);
    },
    /**
     * Yeni eklenen kartın yeri. `lead` (varsayılan): öndeki kartların yerini bozmadan hemen ardına; yani ilk yüksek
     * kartın (zaman çizgisi) ve yanına yığılan küçüklerin sonrasına. Böylece kart ilk bakışta görünür ama kullanıcının
     * alıştığı sol üst köşe yerinden oynamaz. `start`: en başa · `end`: en sona.
     */
    place(id: string, position: 'lead' | 'start' | 'end', by: DashboardCardSource): DashboardSnapshot {
      const cards = build().cards.filter((card) => !card.band && card.id !== id);
      const current = cards.map((card) => card.id);
      let at = position === 'start' ? 0 : current.length;
      if (position === 'lead') {
        const tall = cards.findIndex((card) => card.size === 'large');
        at = tall === -1 ? Math.min(2, cards.length) : tall + 1;
        // Yüksek kartın yanına yığılmış küçük kartlar (en çok iki) yerinde kalır.
        for (let taken = 0; taken < 2 && cards[at]?.size === 'small'; taken++) at += 1;
      }
      applyOrder([...current.slice(0, at), id, ...current.slice(at)]);
      return publish('card', by, id, true);
    },
    resize(id: string, size: DashboardSize, by: DashboardCardSource): DashboardSnapshot {
      store.setSize(id, size);
      return publish('layout', by, id);
    },
    /** Yerleşik kart gizlenir, özel kart (geri alınabilir biçimde) silinir. Bant kaldırılamaz. */
    remove(id: string, by: DashboardCardSource): { ok: boolean; snapshot: DashboardSnapshot } {
      const card = known().find((item) => item.id === id);
      if (card?.band) return { ok: false, snapshot: snapshot() };
      // Kayıtta olmayan kimlik arayüzün kendi kartıdır: o da gizlenir.
      if (card?.custom) store.removeCard(id);
      else store.setHidden(id, true);
      return { ok: true, snapshot: publish('card', by, id, true) };
    },
    restore(id: string, by: DashboardCardSource): { ok: boolean; snapshot: DashboardSnapshot } {
      const wasHidden = store.layout().hidden.includes(id);
      if (wasHidden) store.setHidden(id, false);
      const ok = wasHidden || store.restoreCard(id);
      return { ok, snapshot: publish('card', by, id, ok) };
    },
    reset(by: DashboardCardSource): DashboardSnapshot {
      store.resetLayout();
      return publish('layout', by, null, true);
    },
  };
}

export type DashboardEngine = ReturnType<typeof createDashboardEngine>;
