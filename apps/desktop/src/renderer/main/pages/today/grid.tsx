// Kutucuklu pano: yerleşimi `packDashboard` verir (deliksiz), kartlar ortak düzen animasyonuyla yer değiştirir.
//
// Sürükleme: kart başlığından tutulur. Hareket doğrudan imlece bağlıdır (dönüşüm satır içi yazılır, React çizimi
// beklemez); imleç başka bir kartın üstüne gelince sıra değişir, ızgara yeniden dizilir ve öteki kartlar yayla
// yerlerine kayar. Bırakınca kart yuvasına yayla oturur; oturmadan yeniden tutulursa bulunduğu yerden devam eder.
// Esc sürüklemeyi iptal eder. Klavyeyle taşımak için kart menüsünde "Bir öne al / Bir sona al" vardır.
//
// Hareketin katmanları ayrıdır (birbirini ezmesin, her biri kesilebilsin): yuvanın yeri düzen animasyonudur (dış
// hücre), imleci izleyen kayma satır içi dönüşümdür (`kokpit-float`), kalkma (büyüme + gölge) kartın kendi CSS
// geçişidir (`today.css`), giriş/çıkış ara katmandadır.
//
// İlk yükleme: kartlar bir kez, kademeli ve hafifçe girer (uygulama açıldığında). Sayfaya sonraki dönüşlerde giriş
// animasyonu yoktur (sık yapılan gezinme beklemez).
//
// Satır birimi: pano pencereden kısa kalıyorsa birim büyür (en çok 1,35 kat) ve kartlar görünür yüksekliği
// paylaşır; kartlar yeni yüksekliklerini bilir ve daha çok satır gösterir. Pano pencereden uzunsa birim sabittir.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CloudSlash, DotsThree, Sparkle, X } from '@phosphor-icons/react';
import {
  DASHBOARD_GAP_PX,
  DASHBOARD_SIZES,
  dashboardGridMode,
  hasMessage,
  localTime,
  packDashboard,
  t,
  type DashboardCard,
  type DashboardGridMode,
  type DashboardPlacement,
  type DashboardSize,
  type MessageKey,
} from '@fuber/shared';
import { Button, IconButton, Menu, cn, durations, easings, fade, spring, stagger, useReducedMotion, type MenuItem } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { shouldSwap, type SwapRect } from './drag-swap';
import { useLivePulse } from './live-update';
import { todayCardEntry, type TodayCardProps, type TodayCardTone } from './registry';

/** Sürükleme, imleç bu kadar oynayınca başlar (başlıktaki düğmeye tıklamak sürükleme sayılmasın). */
const DRAG_START_PX = 5;
/** Bir yer değişiminden sonra yenisi için beklenen süre ve imlecin oynaması gereken yol (iki kart arasında gidip gelmesin). */
const SWAP_COOLDOWN_MS = 180;
const SWAP_MOVE_PX = 14;
/**
 * Kartların kademeli girişi yalnız uygulamanın ilk yüklemesinde oynar; Bugün'e her dönüşte değil. Bu bayrak
 * pencerenin ömrü boyunca bir kez düşer.
 */
let firstVisit = true;
/** Pano pencereden kısaysa birim en çok bu kadar büyür. */
const FILL_MAX = 1.35;

const sizeLabel = (size: DashboardSize) => t(`dashboard.size.${size}` as MessageKey);

interface FrameProps {
  card: DashboardCard;
  tone: TodayCardTone;
  fixed: boolean;
  /** Kartın genişliği (px, ölçeksiz): dar kartta başlık öncelik alır. */
  width: number;
  arrived: boolean;
  count: number | undefined;
  index: number;
  total: number;
  onHandleDown(event: ReactPointerEvent<HTMLElement>): void;
  onResize(size: DashboardSize): void;
  onMove(delta: -1 | 1): void;
  onRemove(): void;
  /** Yapay zekânın az önce eklediği kart: başlığında kısa bir süre "Geri al" durur. */
  onUndo?: (() => void) | undefined;
  children: ReactNode;
}

/**
 * Başlıktaki sayaç: sayı değişince eskisi yukarı kayıp söner, yenisi aşağıdan gelir (azaltılmış harekette yalnız
 * saydamlık). Her sayı kendi anahtarıyla takılır; geçiş bir kez oynar.
 */
function LiveCount({ value }: { value: number }) {
  const previous = useRef(value);
  const [shown, setShown] = useState<{ now: number; was: number | null; up: boolean }>({ now: value, was: null, up: true });
  useEffect(() => {
    if (previous.current === value) return;
    setShown({ now: value, was: previous.current, up: value > previous.current });
    previous.current = value;
    const timer = window.setTimeout(() => setShown((current) => ({ ...current, was: null })), 420);
    return () => window.clearTimeout(timer);
  }, [value]);
  return (
    <span className="kokpit-card-count kokpit-roll" data-up={shown.up ? '' : undefined} data-testid="dash-card-count">
      {shown.was !== null ? (
        <span key={`was-${shown.was}`} className="kokpit-roll-out" aria-hidden>
          {shown.was}
        </span>
      ) : null}
      <span key={`now-${shown.now}`} className={shown.was !== null ? 'kokpit-roll-in' : undefined}>
        {shown.now}
      </span>
    </span>
  );
}

/** Kartın çerçevesi: başlık (tutma yeri), sayfa bağlantısı, menü (boyut, taşı, kaldır), bayat veri notu. */
function CardFrame({ card, tone, fixed, width, arrived, count, index, total, onHandleDown, onResize, onMove, onRemove, onUndo, children }: FrameProps) {
  const shell = useShell();
  const [menuOpen, setMenuOpen] = useState(false);
  // Canlı güncelleme: veri değişince kenarda bir kez ışık süpürür (kart türünün rengiyle); sayaç sayıyı geçirir.
  const pulse = useLivePulse(card.data);
  const reduced = useReducedMotion() ?? false;
  const pageKey = card.page ? `nav.${card.page}` : null;
  const pageLabel = pageKey && hasMessage(pageKey) ? t(pageKey as MessageKey) : null;
  const items: MenuItem[] = [
    { type: 'label', id: 'size', label: t('dashboard.menu.size') },
    ...DASHBOARD_SIZES.map(
      (size): MenuItem => ({
        id: `size-${size}`,
        label: sizeLabel(size),
        icon: card.size === size ? <Check weight="bold" /> : <span className="block size-4" />,
        onSelect: () => onResize(size),
      }),
    ),
    { type: 'separator', id: 'sep-move' },
    { id: 'earlier', label: t('dashboard.menu.earlier'), icon: <ArrowLeft />, disabled: index === 0, onSelect: () => onMove(-1) },
    { id: 'later', label: t('dashboard.menu.later'), icon: <ArrowRight />, disabled: index === total - 1, onSelect: () => onMove(1) },
    { type: 'separator', id: 'sep-remove' },
    { id: 'remove', label: t('dashboard.menu.remove'), icon: <X />, danger: true, onSelect: onRemove },
  ];
  return (
    <article
      className={cn('kokpit-card ui-card', arrived && 'ui-sweep')}
      data-tone={tone}
      data-kind={card.kind}
      data-live={pulse > 0 ? pulse : undefined}
      data-reduced={reduced ? '' : undefined}
      aria-label={card.title}
      data-testid="dash-card-surface"
    >
      {arrived && <span className="ui-sweep-band" aria-hidden />}
      {pulse > 0 && (
        <span key={pulse} className="kokpit-live" aria-hidden data-testid="dash-card-live">
          <i className="kokpit-live-glow" />
          <i className="kokpit-live-edge" />
        </span>
      )}
      <header
        className="kokpit-card-head"
        data-handle={fixed ? undefined : ''}
        onPointerDown={fixed ? undefined : onHandleDown}
        title={fixed ? undefined : t('dashboard.drag', { title: card.title })}
        data-testid="dash-card-handle"
      >
        <h2 className="kokpit-card-title">{card.title}</h2>
        {count !== undefined && <LiveCount value={count} />}
        {card.source === 'ai' && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-fg-faint" title={t('dashboard.byAssistant', { name: shell.name })} data-testid="dash-card-ai">
            <Sparkle className="size-3.5 text-accent-fg" weight="fill" aria-hidden />
            {/* Dar kartta başlık kesilmesin: yazı yalnız yer varsa görünür, işaret her zaman durur. */}
            <span className={width >= 300 && !onUndo ? undefined : 'sr-only'}>{t('dashboard.byAssistant', { name: shell.name })}</span>
          </span>
        )}
        {!fixed && (
          <div className="kokpit-card-tools" data-open={menuOpen || undefined}>
            {pageLabel && card.page && (
              <IconButton icon={<ArrowUpRight />} label={pageLabel} size="sm" onClick={() => shell.navigate(card.page!)} data-testid="dash-card-open" />
            )}
            <Menu
              label={t('dashboard.menu.label', { title: card.title })}
              placement="bottom-end"
              open={menuOpen}
              onOpenChange={setMenuOpen}
              trigger={<IconButton icon={<DotsThree weight="bold" />} label={t('dashboard.menu.label', { title: card.title })} size="sm" tooltip={false} data-testid="dash-card-menu" />}
              items={items}
            />
          </div>
        )}
      </header>
      <div className="kokpit-card-body">{children}</div>
      {/* Az önce eklenen kart: kimin eklediği ve tek dokunuşla geri alma, kartın kendi altında (kısa bir süre). */}
      {onUndo && (
        <p className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted" data-testid="dash-card-added">
          <span className="min-w-0 truncate">{t('dashboard.byAssistant', { name: shell.name })}</span>
          <Button size="sm" variant="secondary" className="shrink-0" onClick={onUndo} data-testid="dash-card-undo">
            {t('common.undo')}
          </Button>
        </p>
      )}
      {card.stale && card.updatedAt && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-faint" data-testid="dash-card-stale">
          <CloudSlash className="size-3.5 shrink-0" aria-hidden />
          {t('dashboard.stale', { time: localTime(card.updatedAt) })}
        </p>
      )}
    </article>
  );
}

export interface GridProps {
  /** Çizilecek kartlar, sırayla (bant dahil). */
  cards: DashboardCard[];
  now: Date;
  /** Yapay zekânın az önce eklediği kart (ışık süpürmesi) ve hâlâ geri alınabilen kart. */
  arrived: string | null;
  undoable: string | null;
  onUndo(card: DashboardCard): void;
  /** Izgaranın altında ayrılacak yer (px): "Düzeni sıfırla" satırı varsa. */
  reserve?: number;
  compose(text: string): void;
  /** Bant dışındaki kartların yeni sırası. */
  onReorder(ids: string[]): void;
  onResize(card: DashboardCard, size: DashboardSize): void;
  onRemove(card: DashboardCard): void;
}

interface DragState {
  id: string;
  pointerId: number;
  handle: HTMLElement;
  startX: number;
  startY: number;
  /** İmlecin, kartın görünen sol üst köşesine uzaklığı. */
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  active: boolean;
  origin: string[];
  swapAt: number;
  swapX: number;
  swapY: number;
}

interface Measure {
  /** Izgaranın genişliği (px). */
  width: number;
  /** Sayfa ölçeği (`--kokpit-k`: çok geniş kapta 1'den büyük; bkz. today.css). */
  scale: number;
  /** Kaydırma alanında ızgaraya kalan yükseklik (px); ölçülemediyse 0. */
  room: number;
}

function useMeasure(): [(element: HTMLDivElement | null) => void, Measure, RefObject<HTMLDivElement | null>] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [measure, setMeasure] = useState<Measure>({ width: 0, scale: 1, room: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    ref.current = element;
    if (!element) return;
    const scroller = element.closest<HTMLElement>('.kokpit-main');
    const read = () => {
      const width = Math.round(element.clientWidth);
      const scale = Number.parseFloat(getComputedStyle(element).getPropertyValue('--kokpit-k')) || 1;
      let room = 0;
      if (scroller) {
        const style = getComputedStyle(scroller);
        room = Math.round(scroller.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom));
      }
      setMeasure((current) => (current.width === width && current.scale === scale && current.room === room ? current : { width, scale, room }));
    };
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(element);
    if (scroller) observer.current.observe(scroller);
  }, []);
  return [attach, measure, ref];
}

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
};

export function DashboardGrid({ cards, now, arrived, undoable, reserve = 0, compose, onReorder, onResize, onRemove, onUndo }: GridProps) {
  const reduce = useReducedMotion() ?? false;
  const [attach, { width, scale, room }, gridRef] = useMeasure();
  const gap = Math.round(DASHBOARD_GAP_PX * scale);
  const [dragOrder, setDragOrderState] = useState<string[] | null>(null);
  /** Sürükleme sırasındaki sıranın işleyicilerden okunan kopyası (durum güncelleyicisi içinde yan etki olmasın). */
  const dragOrderRef = useRef<string[] | null>(null);
  const setDragOrder = useCallback((next: string[] | null) => {
    dragOrderRef.current = next;
    setDragOrderState(next);
  }, []);
  const [dragging, setDragging] = useState<string | null>(null);
  const [empties, setEmpties] = useState<ReadonlySet<string>>(() => new Set());
  /** Satır biriminin büyüme oranı (1 = taban). */
  const [fill, setFill] = useState(1);
  const drag = useRef<DragState | null>(null);
  const floats = useRef(new Map<string, HTMLDivElement>());
  const suppressClick = useRef(false);

  const drawn = useMemo(() => cards.filter((card) => !empties.has(card.id) && todayCardEntry(card.kind) !== undefined), [cards, empties]);
  const isFixed = (card: DashboardCard) => todayCardEntry(card.kind)?.options.fixed === true;
  const bands = drawn.filter((card) => card.band);
  const pinned = drawn.filter((card) => !card.band && isFixed(card));
  const free = drawn.filter((card) => !card.band && !isFixed(card));
  const order = dragOrder ?? free.map((card) => card.id);
  const byId = new Map(free.map((card) => [card.id, card]));
  const ordered = order.map((id) => byId.get(id)).filter((card): card is DashboardCard => card !== undefined);
  const laid = [...bands, ...pinned, ...ordered];

  // Sütun sayısı ölçeksiz genişlikten seçilir: büyüyen yazıyla kartlar da aynı oranda geniş kalır.
  const mode: DashboardGridMode = useMemo(() => dashboardGridMode(width / scale), [width, scale]);
  const layoutKey = laid.map((card) => `${card.id}:${card.size}:${card.band ? 1 : 0}`).join('|');
  const placements = useMemo(() => {
    const places = packDashboard(
      laid.map((card) => ({ id: card.id, size: card.size, band: card.band })),
      mode,
    );
    return new Map(places.map((place): [string, DashboardPlacement] => [place.id, place]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, layoutKey]);

  const baseUnit = Math.round((mode.columns >= 24 ? 88 : mode.columns >= 18 ? 80 : 76) * scale);
  const unit = Math.round(baseUnit * fill);
  /** Bant dışındaki satır birimlerinin toplamı. */
  const units = useMemo(() => {
    let last = 0;
    for (const place of placements.values()) last = Math.max(last, place.row + place.rows - 1);
    return Math.max(0, last - bands.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, bands.length]);

  // Pano pencereden kısaysa satırlar görünür yüksekliği paylaşır (bant kendi yüksekliğinde kalır).
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || units === 0 || room === 0 || mode.columns === 1) {
      setFill(1);
      return;
    }
    let bandsHeight = 0;
    for (const cell of grid.querySelectorAll<HTMLElement>('[data-band]')) bandsHeight += cell.offsetHeight + gap;
    const fit = (room - reserve - bandsHeight - (units - 1) * gap) / units;
    const next = Math.min(FILL_MAX, Math.max(1, Math.floor((fit / baseUnit) * 100) / 100));
    setFill((current) => (Math.abs(current - next) < 0.01 ? current : next));
  }, [gridRef, units, room, reserve, gap, baseUnit, mode.columns, width]);

  /** Sürüklenen kartı imlecin altında tutar: dönüşüm, kartın yuvasının O ANKİ yerine göre hesaplanır. */
  const follow = useCallback(() => {
    const state = drag.current;
    if (!state?.active) return;
    const float = floats.current.get(state.id);
    const cell = float?.closest<HTMLElement>('.kokpit-cell');
    const grid = gridRef.current;
    if (!float || !cell || !grid) return;
    const box = cell.getBoundingClientRect();
    const frame = grid.getBoundingClientRect();
    // Kart ızgaranın yan kenarlarından dışarı taşmaz (kaydırma alanı onu kırpardı).
    const x = Math.min(frame.right - box.right, Math.max(frame.left - box.left, state.x - state.grabX - box.left));
    const y = state.y - state.grabY - box.top;
    float.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }, [gridRef]);

  // Sıra değişip ızgara yeniden dizilince yuva yer değiştirir: kart aynı karede yeniden imlecin altına alınır.
  useLayoutEffect(follow, [follow, placements, unit]);

  const settle = useCallback(
    (id: string) => {
      const float = floats.current.get(id);
      if (!float) return;
      const cell = float.closest<HTMLElement>('.kokpit-cell');
      if (reduce) {
        float.style.transform = '';
        if (cell) cell.style.zIndex = '';
        return;
      }
      float.setAttribute('data-settling', '');
      // Geçişin başlangıcı işlensin diye bir kez okunur, sonra hedef yazılır.
      void float.offsetWidth;
      float.style.transform = 'translate(0px, 0px)';
      const done = () => {
        float.removeEventListener('transitionend', done);
        if (drag.current?.id === id && drag.current.active) return;
        float.removeAttribute('data-settling');
        float.style.transform = '';
        if (cell) cell.style.zIndex = '';
      };
      float.addEventListener('transitionend', done);
      // Gizli pencerede kareler seyrek gelir; geçiş olayı kaçarsa yine temizlenir.
      window.setTimeout(done, 700);
    },
    [reduce],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const state = drag.current;
      if (!state) return;
      drag.current = null;
      try {
        state.handle.releasePointerCapture(state.pointerId);
      } catch {
        // İmleç yakalaması zaten bırakılmış olabilir.
      }
      if (!state.active) return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      const final = dragOrderRef.current;
      setDragging(null);
      setDragOrder(null);
      if (commit && final && final.join('|') !== state.origin.join('|')) onReorder(final);
      settle(state.id);
    },
    [onReorder, setDragOrder, settle],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      state.x = event.clientX;
      state.y = event.clientY;
      if (!state.active) {
        if (Math.hypot(state.x - state.startX, state.y - state.startY) < DRAG_START_PX) return;
        const float = floats.current.get(state.id);
        if (!float) return;
        // Oturmakta olan kart yeniden tutuldu: geçiş kesilir, kart göründüğü yerden devam eder.
        const visible = float.getBoundingClientRect();
        float.removeAttribute('data-settling');
        const cell = float.closest<HTMLElement>('.kokpit-cell');
        if (cell) cell.style.zIndex = 'var(--z-raised)';
        state.grabX = state.startX - visible.left;
        state.grabY = state.startY - visible.top;
        state.active = true;
        state.swapX = state.x;
        state.swapY = state.y;
        setDragging(state.id);
        setDragOrder(state.origin);
        follow();
        return;
      }
      follow();
      const grid = gridRef.current;
      if (!grid) return;
      const at = performance.now();
      if (at - state.swapAt < SWAP_COOLDOWN_MS || Math.hypot(state.x - state.swapX, state.y - state.swapY) < SWAP_MOVE_PX) return;
      // Hedef, kartların YERLEŞİM kutularıyla aranır (süren kayma animasyonu hedefi oynatmasın).
      const frame = grid.getBoundingClientRect();
      const cells = [...grid.querySelectorAll<HTMLElement>('[data-card-id]')];
      const box = (cell: HTMLElement): SwapRect => ({ left: frame.left + cell.offsetLeft, top: frame.top + cell.offsetTop, width: cell.offsetWidth, height: cell.offsetHeight });
      const own = cells.find((cell) => cell.dataset.cardId === state.id);
      if (!own) return;
      const slot = box(own);
      for (const cell of cells) {
        const id = cell.dataset.cardId!;
        if (id === state.id || cell.dataset.band !== undefined || cell.dataset.fixed !== undefined) continue;
        // Histerezis: hedefin merkezi yuvadan hedefe doğru belirgin biçimde geçilmeden yer değişmez (titreme olmasın).
        if (!shouldSwap(state.x, state.y, slot, box(cell))) continue;
        const list = dragOrderRef.current ?? state.origin;
        const from = list.indexOf(state.id);
        const to = list.indexOf(id);
        if (from !== -1 && to !== -1 && from !== to) setDragOrder(move(list, from, to));
        state.swapAt = at;
        state.swapX = state.x;
        state.swapY = state.y;
        break;
      }
    };
    const onUp = (event: PointerEvent) => drag.current && event.pointerId === drag.current.pointerId && finish(true);
    const onCancel = (event: PointerEvent) => drag.current && event.pointerId === drag.current.pointerId && finish(false);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && drag.current?.active && finish(false);
    const onClick = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
    };
  }, [finish, follow, gridRef, setDragOrder]);

  const startDrag = (card: DashboardCard) => (event: ReactPointerEvent<HTMLElement>) => {
    // Süren bir sürükleme varken ikinci basış sayılmaz. Yalnız "basıldı ama sürüklenmedi" hâli kalmışsa (bırakma olayı
    // pencereye ulaşmadıysa) yeni basış onun yerini alır; yoksa kartlar bir daha hiç sürüklenemezdi.
    if (event.button !== 0 || drag.current?.active) return;
    // Başlıktaki düğmeler (menü, sayfa bağlantısı) sürükleme başlatmaz.
    if ((event.target as HTMLElement).closest('button, a, input, [role="menu"]')) return;
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Yakalama desteklenmiyorsa pencere dinleyicileri yeter.
    }
    drag.current = {
      id: card.id,
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      grabX: 0,
      grabY: 0,
      x: event.clientX,
      y: event.clientY,
      active: false,
      origin: free.map((item) => item.id),
      swapAt: 0,
      swapX: event.clientX,
      swapY: event.clientY,
    };
  };

  const moveBy = (card: DashboardCard, delta: -1 | 1) => {
    const ids = free.map((item) => item.id);
    const from = ids.indexOf(card.id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    onReorder(move(ids, from, to));
  };

  const setEmpty = useCallback((id: string, empty: boolean) => {
    setEmpties((current) => {
      if (current.has(id) === empty) return current;
      const next = new Set(current);
      if (empty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Pencere boyutlanınca (genişlik, yükseklik, ölçek ya da sütun sayısı değişince) kartlar yaylanmaz, yerlerine anında
  // oturur: düzen animasyonu kart ekleme, kaldırma, boyut ve sıra değişimine aittir. Satır birimi bu anahtarda YOKTUR:
  // kart eklenip kaldırılınca birim de değişir (pano görünür yüksekliği paylaşır) ve o değişim pencere boyutlanması
  // sanılırsa yay yarıda kesilir, kartlar sıçrar. Boyut değişimi bu çizimde fark edilir ki aynı karede geçerli olsun.
  const sizeKey = `${width}:${room}:${scale}:${mode.columns}`;
  const sized = useRef({ key: sizeKey, at: 0 });
  if (sized.current.key !== sizeKey) sized.current = { key: sizeKey, at: performance.now() };
  const resizing = performance.now() - sized.current.at < 400;
  // Yer değişimi hızlı ve sert yayla (zıplamasız): kartlar birbirinin önünden geçerken geçen süre kısa kalır.
  const layoutTransition = reduce || resizing ? { duration: 0 } : spring.snappy;
  // Bant satırları içeriği kadardır (birim büyüse de bant uzamaz); kalan satırlar birimle ölçülür.
  const style = {
    gridTemplateColumns: `repeat(${mode.columns}, minmax(0, 1fr))`,
    gridTemplateRows: bands.length > 0 ? `repeat(${bands.length}, auto)` : undefined,
    '--kokpit-gap': `${gap}px`,
    '--kokpit-unit': `${unit}px`,
  } as CSSProperties;
  const column = (width - (mode.columns - 1) * gap) / mode.columns;

  // İlk yüklemede panoda duran kartlar kademeli girer; sonradan eklenen kart kendi girişini (hafif ölçek) oynar.
  const opening = useRef(firstVisit);
  const openers = useRef<Map<string, number> | null>(null);
  if (opening.current && width > 0 && openers.current === null) openers.current = new Map(laid.map((card, index) => [card.id, index]));
  useEffect(() => {
    if (width > 0) firstVisit = false;
  }, [width]);

  return (
    <div ref={attach} className="kokpit-grid" style={style} role="list" aria-label={t('dashboard.grid.label')} data-testid="dash-grid" data-columns={mode.columns}>
      {/* Genişlik ölçülmeden yerleşim bilinmez; ilk karede boş ızgara çizilir (kartlar yanlış sütunda belirip kaymasın). */}
      {width > 0 && (
        <AnimatePresence initial={opening.current} mode="popLayout">
          {laid.map((card) => {
            const place = placements.get(card.id);
            const entry = todayCardEntry(card.kind);
            if (!place || !entry) return null;
            const Component = entry.Component as ComponentType<TodayCardProps>;
            const fixed = entry.options.fixed === true;
            const props: TodayCardProps = {
              card,
              span: place.span,
              columns: mode.columns,
              rows: place.rows,
              // Ölçeksiz ölçüler: kartların "kaç satır sığar", "iki sütuna böl" eşikleri sayfa ölçeğinden bağımsız kalır.
              width: Math.round((place.span * column + (place.span - 1) * gap) / scale),
              height: Math.round((place.rows * unit + (place.rows - 1) * gap) / scale),
              now,
              compose,
              setEmpty: (empty) => setEmpty(card.id, empty),
            };
            const isDragging = dragging === card.id;
            const opener = openers.current?.get(card.id);
            return (
              <motion.div
                key={card.id}
                role="listitem"
                className="kokpit-cell"
                // Yalnız konum yaylanır: boyut değişimi içeriği germeden anında uygulanır. Sürüklenen kartın yuvası anında yer
                // değiştirir. Bant ve sabit kart hiç yaylanmaz: sıraya girmezler, yerleri ancak sayfa düzeni değişince
                // (karşılamadan panoya geçiş) oynar ve o zaman yerlerine anında otururlar.
                layout={reduce || card.band || fixed ? false : 'position'}
                transition={{ layout: isDragging ? { duration: 0 } : layoutTransition }}
                style={{ gridColumn: `${place.col} / span ${place.span}`, gridRow: `${place.row} / span ${place.rows}` }}
                data-testid="dash-card"
                data-card-id={card.id}
                data-kind={card.kind}
                data-size={card.size}
                data-span={place.span}
                data-band={card.band ? '' : undefined}
                data-fixed={fixed ? '' : undefined}
                data-dragging={isDragging ? '' : undefined}
              >
                <motion.div
                  className="flex min-w-0 flex-1"
                  // Giriş: ilk yüklemede 8 px aşağıdan, kademeli (kart başına 35 ms); sonradan eklenen kart hafif ölçekle.
                  // Çıkış girişten hızlıdır. Azaltılmış harekette yalnız saydamlık.
                  initial={reduce ? { opacity: 0 } : { opacity: 0, transform: opener !== undefined ? 'translateY(8px) scale(1)' : 'translateY(0px) scale(0.96)' }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px) scale(1)' }}
                  exit={reduce ? { opacity: 0, transition: fade } : { opacity: 0, transform: 'translateY(0px) scale(0.97)', transition: { duration: durations.fast, ease: easings.out } }}
                  transition={reduce ? fade : opener !== undefined ? stagger(opener) : spring.gentle}
                >
                  <div
                    className="kokpit-float"
                    ref={(element) => {
                      if (element) floats.current.set(card.id, element);
                      else floats.current.delete(card.id);
                    }}
                  >
                    {entry.options.bare ? (
                      <Component {...props} />
                    ) : (
                      <CardFrame
                        card={card}
                        tone={entry.options.tone ?? 'base'}
                        fixed={fixed}
                        width={props.width}
                        arrived={arrived === card.id}
                        count={entry.options.count?.(card)}
                        index={ordered.indexOf(card)}
                        total={ordered.length}
                        onHandleDown={startDrag(card)}
                        onResize={(size) => onResize(card, size)}
                        onMove={(delta) => moveBy(card, delta)}
                        onRemove={() => onRemove(card)}
                        onUndo={undoable === card.id ? () => onUndo(card) : undefined}
                      >
                        <Component {...props} />
                      </CardFrame>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}
