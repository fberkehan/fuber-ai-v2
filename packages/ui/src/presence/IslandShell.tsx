import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '../cn';
import { useReducedMotion } from '../motion';
import { ConstellationShell, type ShellEngine, type ShellVariant } from './shell-engines';
import { Signal } from './signal';
import { createTick, type Tick } from './ticker';
import { PRESENCE_LABELS, isLiveState, type PresenceState } from './types';

/** Omuz payı: gövdenin iki yanında, üst kenarla kaynaşan içbükey köşeler (CSS px). */
export const ISLAND_SHOULDER = 12;
/**
 * Büyürken önce pencere: ada kendi penceresinde yaşar ve pencere, gövdenin hedef ölçüsüne göre büyütülür (IPC).
 * Yay ilk karelerde hızla açıldığı için gövde, pencere büyümeden eski sınırına dayanıp bir kare kırpılabiliyordu
 * (hud.mjs yakaladı). Büyüyen biçim bu kadar sonra yola çıkar; küçülen hemen.
 */
const GROW_DELAY_MS = 50;
/** `fits` verilmişse gövde, pencere gerçekten büyüyene kadar bekler; pencere hiç büyümezse en çok bu kadar. */
const GROW_WAIT_MAX_MS = 600;

export interface IslandShellHandle {
  /** Kare döngüsünü uyandırır (imleç oynadı, dış veri değişti). */
  wake(): void;
}

export interface IslandShellProps {
  /** `island`: ekranın üst kenarındaki ada (boşta hiçbir şey çizmez). `window`: ana pencerenin çentiği (boşta da durur). */
  variant?: ShellVariant;
  state: PresenceState;
  /** O anki ses düzeyi (RMS 0..1): dinlerken mikrofon, konuşurken ses çıkışı. Her karede okunur. */
  getLevel?: () => number;
  /** Kalan süre ya da ilerleme (0..1): bildirim, onay, arka plan işi. */
  progress?: number;
  /** İçeriğin kimliği; değişince eski içerik sönerken yenisi belirir. `null`: içeriksiz. */
  contentKey: string | null;
  /** İçerik kart mı (çok satır, düğmeler). */
  card?: boolean;
  /** Hedef gövde ölçüsü değişince (omuzlar dahil genişlik); pencere zarfı bunu izler. İçerik yokken 0 × 0. */
  onTarget?: (size: { width: number; height: number }) => void;
  /**
   * Barındıran pencere bu hedef ölçüyü (omuzlar dahil) taşıyacak kadar büyüdü mü. Verilirse gövde büyümeye, pencere
   * hazır olunca başlar (sabit gecikme yüklü makinede yetmeyebilir); verilmezse yalnız kısa sabit gecikme uygulanır.
   */
  fits?: (size: { width: number; height: number }) => boolean;
  /** Ekran okuyucu adı. */
  label?: string;
  /** Gövdenin kutusuna (içerik kırpma kutusu: görünen şekille aynı dikdörtgen) verilecek sınama kimliği ve öznitelikler. */
  bodyTestId?: string;
  bodyProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  className?: string;
  children?: ReactNode;
  ref?: Ref<IslandShellHandle>;
}

/**
 * Kenara kaynaklı, biçim değiştiren gövde: ada ve ana pencere çentiği. İçerik (`children`) doğal ölçüsünde ölçülür;
 * gövde o ölçüye yayla gelir. İçerik değişirken eskisi kısa bir hayalet olarak söner (çıkan katman eski içeriğin
 * kopyasıdır; girişler orada yeniden oynamaz). Çizim React dışında, yalnız hareket sürerken döner.
 */
export function IslandShell({
  variant = 'island',
  state,
  getLevel,
  progress = 1,
  contentKey,
  card = false,
  onTarget,
  fits,
  label,
  bodyTestId,
  bodyProps,
  className,
  children,
  ref,
}: IslandShellProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ShellEngine | null>(null);
  const tickRef = useRef<Tick | null>(null);
  const signal = useRef(new Signal()).current;
  const reduced = useReducedMotion() ?? false;

  // Karede okunan değerler: React yeniden çizmeden güncel kalır.
  const live = useRef({ state, getLevel, progress, reduced, onTarget, fits });
  live.current.state = state;
  live.current.getLevel = getLevel;
  live.current.progress = progress;
  live.current.reduced = reduced;
  live.current.onTarget = onTarget;
  live.current.fits = fits;

  const prevState = useRef<PresenceState>('idle');
  const lastTarget = useRef('');
  const growTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const growShape = useRef('');
  const lastMeasure = useRef('');
  const snapshot = useRef<{ key: string | null; node: Node | null }>({ key: null, node: null });

  const measure = () => {
    const engine = engineRef.current;
    const content = contentRef.current;
    if (!engine || !content) return;
    const has = contentKey !== null && content.childElementCount > 0;
    const w = has ? content.offsetWidth : 0;
    const h = has ? content.offsetHeight : 0;
    const target = has && w > 0 && h > 0 ? { w, h, card } : null;
    // Değişen bir şey yoksa (aynı içerik ölçüsü, aynı hâl) hiçbir şey yapılmaz: ilgisiz bir yeniden çizim (başka bir
    // olay, üst bileşenin durumu) kare döngüsünü uyandırmasın. Boşta sıfır kare kuralı buna bağlıdır.
    const signature = `${target ? `${w}x${h}` : 'none'}|${card}|${state}|${variant}`;
    if (signature === lastMeasure.current) return;
    lastMeasure.current = signature;
    // Hedef ölçü hemen bildirilir (pencere zarfı önce büyür); gövde, büyüyorsa kısa bir an sonra yola çıkar.
    const size = engine.plan(target);
    const width = size.h > 0.5 ? Math.ceil(size.w) + ISLAND_SHOULDER * 2 : 0;
    const height = size.h > 0.5 ? Math.ceil(size.h) : 0;
    const key = `${width}x${height}`;
    if (key !== lastTarget.current) {
      lastTarget.current = key;
      live.current.onTarget?.({ width, height });
    }
    const current = engine.targetSize();
    const grows = variant === 'island' && current.h > 0.5 && (size.w > current.w + 0.5 || size.h > current.h + 0.5);
    const shape = `${key}|${card}`;
    // Aynı hedef için bekleyen büyüme varsa yeniden başlatılmaz (sık çizimde büyüme ertelenip durmasın).
    if (grows && growTimer.current && growShape.current === shape) {
      tickRef.current?.wake();
      return;
    }
    if (growTimer.current) clearTimeout(growTimer.current);
    growTimer.current = null;
    if (grows) {
      growShape.current = shape;
      const began = performance.now();
      const attempt = () => {
        growTimer.current = null;
        const ready = live.current.fits ? live.current.fits({ width, height }) : true;
        if (!ready && performance.now() - began < GROW_WAIT_MAX_MS) {
          growTimer.current = setTimeout(attempt, 16);
          return;
        }
        engineRef.current?.layout(target);
        tickRef.current?.wake();
      };
      // Pencere zaten yeterince büyükse (sabit sahne) beklenmez: gövde gecikmesiz yola çıkar.
      if (live.current.fits?.({ width, height })) {
        engine.layout(target);
      } else {
        growTimer.current = setTimeout(attempt, GROW_DELAY_MS);
      }
    } else {
      engine.layout(target);
    }
    tickRef.current?.wake();
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // Motor yüzey değişince yeniden kurulur.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const clip = clipRef.current;
    if (!host || !clip) return;
    const engine: ShellEngine = new ConstellationShell({ host, clip }, variant);
    engineRef.current = engine;
    // Boşta kare yok: motor hareket bitince `false` döner, döngü durur; yeni girdi (`wake`) yeniden başlatır.
    const tick = createTick((dt, t) => {
      const now = live.current;
      const input = isLiveState(now.state) || now.state === 'wake' ? (now.getLevel?.() ?? 0) : 0;
      signal.update(dt, input);
      return engine.frame(dt, t, { signal, reduced: now.reduced, progress: now.progress });
    });
    tickRef.current = tick;
    engine.enter(live.current.state, 'idle');
    prevState.current = live.current.state;
    lastTarget.current = '';
    lastMeasure.current = '';
    measureRef.current();
    return () => {
      if (growTimer.current) clearTimeout(growTimer.current);
      growTimer.current = null;
      tick.stop();
      engine.destroy();
      engineRef.current = null;
      tickRef.current = null;
    };
  }, [variant, signal]);

  // Durum değişimi.
  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine || prevState.current === state) return;
    engine.enter(state, prevState.current);
    prevState.current = state;
    measureRef.current();
  }, [state]);

  // İçerik değişimi: eski içeriğin kopyası kısa süre sönerek kalır; ölçü her çizimden sonra yeniden okunur.
  useLayoutEffect(() => {
    const content = contentRef.current;
    const ghosts = ghostRef.current;
    if (!content || !ghosts) return;
    const previous = snapshot.current;
    if (previous.key !== contentKey && previous.node && previous.key !== null) {
      const ghost = previous.node as HTMLElement;
      ghost.classList.add('pz-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.removeAttribute('data-testid');
      for (const node of ghost.querySelectorAll('[data-testid],[id]')) {
        node.removeAttribute('data-testid');
        node.removeAttribute('id');
      }
      ghosts.replaceChildren(ghost);
      // Başlangıç stili ŞİMDİ işlenir (zorunlu ölçüm), sonra sönme başlar. Sınıf, stil hiç hesaplanmadan eklenirse
      // tarayıcı geçişi oynatmaz: eski içerik tek karede kaybolur (içeriksiz hâle geçişlerde böyle oluyordu).
      void ghost.offsetWidth;
      ghost.classList.add('pz-ghost-out');
      setTimeout(() => ghost.remove(), 260);
    }
    snapshot.current = { key: contentKey, node: contentKey !== null ? content.cloneNode(true) : null };
    measureRef.current();
  });

  // Yazı tipi yüklenmesi, satır kırılması gibi React dışı ölçü değişimleri.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    tickRef.current?.wake();
  }, [progress, reduced]);

  useImperativeHandle(ref, () => ({ wake: () => tickRef.current?.wake() }), []);

  return (
    <div
      ref={rootRef}
      className={cn('pz-shell', className)}
      data-variant={variant}
      data-state={state}
      data-card={card ? '' : undefined}
      data-bare={contentKey === null ? '' : undefined}
    >
      <div ref={hostRef} className="pz-host" role="img" aria-label={label ?? PRESENCE_LABELS[state]} />
      <div ref={clipRef} className="pz-clip" data-testid={bodyTestId} {...bodyProps}>
        <div ref={ghostRef} className="pz-ghosts" aria-hidden />
        <div ref={contentRef} className="pz-content" data-key={contentKey ?? undefined}>
          {/* Anahtarlı iç katman: içerik değişince YENİDEN takılır ve giriş geçişini oynar. Aynı öğe yeniden
              kullanılırsa yeni yazı bir anda belirir ve sönen eski yazıyla üst üste biner (çift yazı). */}
          <div key={contentKey ?? 'none'} className="pz-content-in">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
