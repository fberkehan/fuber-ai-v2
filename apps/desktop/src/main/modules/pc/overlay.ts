// "Jarvis bilgisayarı kullanıyor" ekran katmanının ana süreç mantığı. v1'deki `imlec.ts`'in karşılığı, daha iyisi:
// kenarda yumuşak ışık (bütün ekranlarda), Jarvis'in imleci + ad etiketi + adım rozeti, tıklama dalgası, hedef alan
// vurgusu ve alt ortada "durdurmak için fareyi oynatın" şeridi (yalnız etkin ekranda).
//
// Bu dosya SAF mantıktır (Electron'a dokunmaz; birim sınaması `overlay.test.ts`): `pc.activity` olaylarını alır, durum
// makinesini (görünür → oyalanma → sönme → gizli; kesilme metni 2,6 sn) yürütür, fiziksel pikselleri ekranın DIP
// koordinatına çevirir ve her ekranın penceresine o ekrana göre bir kare (`PcOverlayFrame`) yollar. Pencere ve
// `screen` küçük bir bağlantının (`OverlayHost`) arkasındadır; gerçeği `overlay-host.ts`.
//
// Neden ekran başına bir pencere (v1 gibi) ve tek büyük pencere değil: Windows'ta farklı ölçekli (ör. %100 + %150)
// ekranlara yayılan tek pencere, ortası hangi ekrandaysa onun ölçeğine göre yeniden boyutlanır; diğer ekrandaki kısım
// bulanık ya da kaymış çizilir. Etkin ekrana taşınan tek pencere ise kenar ışığını yalnız o ekranda gösterir ve ekran
// değişiminde (taşıma + yeniden çizim) bir kare boyunca boş görünür. Ekran başına pencere her ekranı kendi DPI'ında,
// titremeden çizer; imleç yalnız hedefin bulunduğu ekranın penceresinde görünür.
import type { PcActivity, PcAction, PcFx, PcOverlayFrame, Point, Rect } from './types';

/** DIP dikdörtgeni (Electron `Rectangle` biçimi). */
export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bağlı bir ekran: DIP koordinatları (Electron `Display`'in gereken parçası). */
export interface OverlayDisplay {
  id: number;
  bounds: OverlayBounds;
  /** Görev çubuğu hariç alan; şerit bunun alt kenarının üstünde durur. */
  workArea: OverlayBounds;
  scaleFactor: number;
}

/** Bir ekranın katman penceresi. `send` sayfa hazır değilse son kareyi saklar, hazır olunca yollar. */
export interface OverlaySurface {
  send(frame: PcOverlayFrame): void;
  /** Odak çalmadan gösterir (sınama kipinde ekrana çıkmaz ama çizer). */
  show(): void;
  hide(): void;
  setBounds(bounds: OverlayBounds): void;
  destroy(): void;
}

/** Electron'a bağlı parça: ekranlar, koordinat çevirisi, pencere açma. */
export interface OverlayHost {
  displays(): OverlayDisplay[];
  /** Fiziksel ekran pikseli → DIP (`screen.screenToDipPoint`). */
  toDip(point: Point): Point;
  /** DIP noktasına en yakın ekran (`screen.getDisplayNearestPoint`). */
  nearest(point: Point): OverlayDisplay;
  /** Kullanıcının imlecinin bulunduğu ekran: henüz hedef nokta gelmemişken şerit burada görünür. */
  cursorDisplay(): OverlayDisplay;
  open(display: OverlayDisplay): OverlaySurface;
  /** Ekran eklendi/çıkarıldı/değişti. */
  onDisplaysChanged?(listener: () => void): () => void;
}

export interface OverlayTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface OverlayTiming {
  /** Son eylemden kapanışa (v1: 4000 ms). Modül "bitti"yi kendi oyalanmasından (1500 ms) sonra yayınlar; kalanı burada. */
  afterDoneMs: number;
  /** "Kontrol sizde: durdum" / "Durduruldu" metninin ekranda kalma süresi. */
  interruptMs: number;
  /** Sönme geçişi; bitince pencereler gizlenir (v1: 450 ms). */
  fadeMs: number;
  /** "Bitti" hiç gelmezse (yayıncı düştü) bu kadar sessizlikten sonra katman kendiliğinden söner. Onay beklerken işlemez. */
  watchdogMs: number;
}

export const OVERLAY_TIMING: OverlayTiming = { afterDoneMs: 2500, interruptMs: 2600, fadeMs: 450, watchdogMs: 30_000 };

export interface PcOverlayDeps {
  host: OverlayHost;
  /** `true`/`'on'`: hareket yok, yalnız opaklık · `'system'`: Windows'un "animasyonları göster" ayarı (sayfa sorar) · `false`/`'off'`: tam hareket. */
  reducedMotion(): boolean | 'on' | 'off' | 'system';
  /** Asistanın adı (politika › persona). */
  assistantName(): string;
  /** Acil dur kısayolu, okunur biçimde ("Ctrl+Alt+Q"); yoksa boş. */
  stopKeys(): string;
  timing?: Partial<OverlayTiming>;
  timers?: OverlayTimers;
}

export interface PcOverlay {
  handle(activity: PcActivity): void;
  dispose(): void;
}

/** İmleç bu eylemlerde görünür; dosya/komut/sistem/pano araçlarında yalnız kenar ışığı + şerit. */
const POINTER_ACTIONS: ReadonlySet<PcAction> = new Set<PcAction>(['type', 'keys', 'click', 'scroll', 'focus', 'window', 'browser', 'selftest']);

/** `point` alanından türetilen (eski yayıncı) hareketin süresi; gerçek süre `fx.move.ms` ile gelir. */
const FALLBACK_MOVE_MS = 240;

/** Electron hızlandırıcısını okunur kısayola çevirir ("CommandOrControl+Alt+Q" → "Ctrl+Alt+Q"; adadaki `acceleratorKeys` ile aynı adlar). */
export function formatAccelerator(accelerator: string | null | undefined): string {
  if (!accelerator) return '';
  const names: Record<string, string> = { Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Option: 'Alt', Super: 'Win', Meta: 'Win' };
  return accelerator
    .split('+')
    .filter(Boolean)
    .map((key) => names[key] ?? key)
    .join('+');
}

const contains = (bounds: OverlayBounds, point: Point): boolean =>
  point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;

const local = (display: OverlayDisplay, dip: Point): Point => ({ x: dip.x - display.bounds.x, y: dip.y - display.bounds.y });

const localBounds = (display: OverlayDisplay, area: OverlayBounds): OverlayBounds => ({
  x: area.x - display.bounds.x,
  y: area.y - display.bounds.y,
  width: area.width,
  height: area.height,
});

/** Fiziksel nokta → (ekran, o ekranın penceresine göre DIP). Nokta hiçbir ekranda değilse en yakın ekran seçilir. */
export function toOverlayPoint(host: Pick<OverlayHost, 'toDip' | 'nearest'>, physical: Point): { display: OverlayDisplay; point: Point } {
  const dip = host.toDip(physical);
  const display = host.nearest(dip);
  return { display, point: local(display, dip) };
}

/**
 * Fiziksel dikdörtgen → (ekran, DIP dikdörtgen). Ekran merkezden seçilir; köşeler ayrı ayrı çevrilir (iki ekrana
 * taşan pencerede de köşeler doğru yere düşer).
 */
export function toOverlayRect(host: Pick<OverlayHost, 'toDip' | 'nearest'>, rect: Rect): { display: OverlayDisplay; rect: Rect } {
  const center = host.toDip({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
  const display = host.nearest(center);
  const a = local(display, host.toDip({ x: rect.left, y: rect.top }));
  const b = local(display, host.toDip({ x: rect.right, y: rect.bottom }));
  return { display, rect: { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) } };
}

type FrameFx = NonNullable<PcOverlayFrame['fx']>;

/** Bir olayın kareye dönüşmüş görsel parçası ve ait olduğu ekran (`null`: konumsuz; etkin ekrana gider). */
interface PlacedFx {
  displayId: number | null;
  fx: FrameFx;
  /** İmlecin bu olaydan sonraki yeri (ekranına göre DIP). */
  pointer: Point | null;
}

type Mode = PcOverlayFrame['state'];
type Phase = 'hidden' | 'shown' | 'fading';

export function createPcOverlay(deps: PcOverlayDeps): PcOverlay {
  const { host } = deps;
  const timing: OverlayTiming = { ...OVERLAY_TIMING, ...deps.timing };
  const timers: OverlayTimers = deps.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as NodeJS.Timeout) };

  const surfaces = new Map<number, { surface: OverlaySurface; display: OverlayDisplay }>();
  let phase: Phase = 'hidden';
  let mode: Mode = 'working';
  let action: PcAction | null = null;
  let step: string | null = null;
  let progress: PcOverlayFrame['progress'] = null;
  /** Şeridin ve imlecin ekranı. */
  let focusId: number | null = null;
  /** İmlecin bilinen son yeri. */
  let pointer: { displayId: number; at: Point } | null = null;
  /** Eski yayıncıdan gelen hedef nokta (fiziksel); aynı nokta tekrar gelince yeni hareket sayılmaz. */
  let lastPoint: Point | null = null;
  let seq = 0;
  let closeTimer: unknown = null;
  let fadeTimer: unknown = null;
  let watchdog: unknown = null;
  let disposed = false;

  const clear = (handle: unknown) => {
    if (handle !== null) timers.clear(handle);
  };
  const clearAll = () => {
    clear(closeTimer);
    clear(fadeTimer);
    clear(watchdog);
    closeTimer = fadeTimer = watchdog = null;
  };

  /** Ekran listesine göre pencereleri kurar/taşır/kaldırır. */
  const syncSurfaces = () => {
    const displays = host.displays();
    const ids = new Set(displays.map((display) => display.id));
    for (const [id, entry] of surfaces) {
      if (ids.has(id)) continue;
      entry.surface.destroy();
      surfaces.delete(id);
    }
    for (const display of displays) {
      const entry = surfaces.get(display.id);
      if (!entry) {
        surfaces.set(display.id, { surface: host.open(display), display });
        continue;
      }
      entry.surface.setBounds(display.bounds);
      entry.display = display;
    }
    if (focusId !== null && !ids.has(focusId)) focusId = null;
    if (pointer && !ids.has(pointer.displayId)) pointer = null;
  };

  const motion = (): { reducedMotion: boolean; systemMotion: boolean } => {
    const value = deps.reducedMotion();
    return { reducedMotion: value === true || value === 'on', systemMotion: value === 'system' };
  };

  const frameFor = (display: OverlayDisplay, visible: boolean, placed: PlacedFx | null): PcOverlayFrame => {
    const focused = display.id === focusId;
    const pointerHere = pointer !== null && pointer.displayId === display.id && (action === null || POINTER_ACTIONS.has(action));
    const fxHere = placed !== null && (placed.displayId === display.id || (placed.displayId === null && focused));
    return {
      visible,
      state: mode,
      name: deps.assistantName(),
      step,
      progress,
      ...motion(),
      stopKeys: deps.stopKeys(),
      action,
      focus: focused,
      pointer: pointerHere ? pointer!.at : null,
      work: localBounds(display, display.workArea),
      seq,
      fx: fxHere ? placed!.fx : null,
    };
  };

  const broadcast = (visible: boolean, placed: PlacedFx | null) => {
    seq += 1;
    for (const { surface, display } of surfaces.values()) surface.send(frameFor(display, visible, placed));
  };

  const hideAll = () => {
    for (const { surface } of surfaces.values()) surface.hide();
  };

  const reset = () => {
    mode = 'working';
    action = null;
    step = null;
    progress = null;
    focusId = null;
    pointer = null;
    lastPoint = null;
  };

  const fadeOut = () => {
    clearAll();
    if (phase === 'hidden') return;
    phase = 'fading';
    broadcast(false, null);
    fadeTimer = timers.set(() => {
      fadeTimer = null;
      if (phase !== 'fading') return;
      phase = 'hidden';
      hideAll();
      reset();
    }, timing.fadeMs);
  };

  const showAll = () => {
    if (phase === 'shown') return;
    const wasHidden = phase === 'hidden';
    phase = 'shown';
    syncSurfaces();
    if (focusId === null) focusId = host.cursorDisplay().id;
    if (wasHidden) for (const { surface } of surfaces.values()) surface.show();
  };

  const place = (fx: PcFx): PlacedFx => {
    switch (fx.kind) {
      case 'move': {
        const to = toOverlayPoint(host, fx.to);
        const raw = (fx as { from?: Point | null }).from;
        let from: Point | null = null;
        if (raw) {
          const start = toOverlayPoint(host, raw);
          // Başlangıç başka ekrandaysa imleç hedef ekrana "girer": başlangıç noktası yok sayılır.
          if (start.display.id === to.display.id) from = start.point;
        }
        return { displayId: to.display.id, fx: { kind: 'move', to: to.point, ms: Math.max(0, fx.ms), from }, pointer: to.point };
      }
      case 'click': {
        const at = toOverlayPoint(host, fx.at);
        return { displayId: at.display.id, fx: { kind: 'click', at: at.point, button: fx.button, double: fx.double }, pointer: at.point };
      }
      case 'target': {
        const target = toOverlayRect(host, fx.rect);
        return { displayId: target.display.id, fx: { kind: 'target', rect: target.rect, mode: fx.mode }, pointer: null };
      }
      case 'typing':
        return { displayId: null, fx: { kind: 'typing', chars: Math.max(0, fx.chars), total: Math.max(0, fx.total) }, pointer: null };
    }
  };

  /** `fx` yoksa eski `point` alanından hareket türetir (fx yayınlamayan yayıncılar da imleci yürütür). */
  const fxOf = (activity: PcActivity): PcFx | null => {
    if (activity.fx) return activity.fx;
    const point = activity.point;
    if (!point) return null;
    if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) return null;
    return { kind: 'move', to: point, ms: FALLBACK_MOVE_MS };
  };

  const armWatchdog = () => {
    clear(watchdog);
    watchdog = mode === 'waiting' ? null : timers.set(() => {
      watchdog = null;
      fadeOut();
    }, timing.watchdogMs);
  };

  const handle = (activity: PcActivity): void => {
    if (disposed) return;

    if (activity.interrupted) {
      clearAll();
      mode = activity.interrupted === 'user' ? 'interrupted' : 'stopped';
      showAll();
      broadcast(true, null);
      closeTimer = timers.set(() => {
        closeTimer = null;
        fadeOut();
      }, timing.interruptMs);
      return;
    }

    if (!activity.active) {
      if (phase !== 'shown' || mode === 'interrupted' || mode === 'stopped') return;
      clear(closeTimer);
      clear(watchdog);
      watchdog = null;
      closeTimer = timers.set(() => {
        closeTimer = null;
        fadeOut();
      }, timing.afterDoneMs);
      if (mode === 'waiting') {
        // Onay kartı kapandı (reddedildi ya da araç bitti): "bekliyorum" yazısı oyalanma boyunca kalmasın.
        mode = 'working';
        broadcast(true, null);
      }
      return;
    }

    clearAll();
    mode = activity.waiting === 'approval' ? 'waiting' : 'working';
    action = activity.action;
    if (activity.step !== undefined) step = activity.step;
    if (activity.progress !== undefined) progress = activity.progress;
    const fx = fxOf(activity);
    if (activity.point) lastPoint = activity.point;
    showAll();
    const placed = fx ? place(fx) : null;
    if (placed && placed.displayId !== null) {
      focusId = placed.displayId;
      if (placed.pointer) pointer = { displayId: placed.displayId, at: placed.pointer };
      else if (pointer && pointer.displayId !== placed.displayId) pointer = null;
    }
    broadcast(true, placed);
    armWatchdog();
  };

  const offDisplays = host.onDisplaysChanged?.(() => {
    if (disposed || phase === 'hidden') return;
    syncSurfaces();
    for (const { surface } of surfaces.values()) surface.show();
    broadcast(phase === 'shown', null);
  });

  return {
    handle,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearAll();
      offDisplays?.();
      for (const { surface } of surfaces.values()) surface.destroy();
      surfaces.clear();
      phase = 'hidden';
      reset();
    },
  };
}

/**
 * İki noktalı yaklaşık fiziksel → DIP çevirisi (Windows'un `PhysicalToLogicalPointForPerMonitorDPI` mantığı): nokta
 * hangi ekranın fiziksel dikdörtgenindeyse o ekranın ölçeğiyle küçültülür. Yalnız sınama sahte bağlantısı ve
 * Electron'un çeviremediği (ekran dışı) noktalar için.
 */
export function physicalToDip(displays: Array<OverlayDisplay & { physical: OverlayBounds }>, point: Point): Point {
  const display =
    displays.find((candidate) => contains(candidate.physical, point)) ??
    displays.reduce((best, candidate) => (distanceTo(candidate.physical, point) < distanceTo(best.physical, point) ? candidate : best));
  return {
    x: display.bounds.x + (point.x - display.physical.x) / display.scaleFactor,
    y: display.bounds.y + (point.y - display.physical.y) / display.scaleFactor,
  };
}

/** DIP noktasına en yakın ekran (içindeyse kendisi). */
export function nearestDisplay<T extends OverlayDisplay>(displays: T[], point: Point): T {
  return displays.find((candidate) => contains(candidate.bounds, point)) ?? displays.reduce((best, candidate) => (distanceTo(candidate.bounds, point) < distanceTo(best.bounds, point) ? candidate : best));
}

function distanceTo(bounds: OverlayBounds, point: Point): number {
  const dx = Math.max(bounds.x - point.x, 0, point.x - (bounds.x + bounds.width));
  const dy = Math.max(bounds.y - point.y, 0, point.y - (bounds.y + bounds.height));
  return Math.hypot(dx, dy);
}
