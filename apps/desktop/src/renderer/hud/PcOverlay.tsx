import { StrictMode, type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '@fuber/shared';
import type { PcOverlayFrame, Point, Rect } from '../../main/modules/pc/types';
import './pc-overlay.css';

/*
 * "Jarvis bilgisayarı kullanıyor" ekran katmanı (`?surface=pc-overlay`): ekran başına bir tam ekran, saydam, tıklamayı
 * geçiren pencere (`main/modules/pc/overlay.ts`). Ana süreç her olayda bu ekrana göre bir kare (`pc.overlay`) yollar;
 * koordinatlar pencereye göre DIP'tir.
 *
 * v1'in görsel dili (kenar ışığı, gümüş imleç + ad etiketi, tıklama halkası, yazma rozeti, şerit) korunur; üstüne:
 * hareket izi, hedef alan vurgusu (köşe işaretli), rozette yazma ilerlemesi, onay beklerken kehribar sakin ışık,
 * yıldızlı sahnenin soğuk mavi vurgusu. İmleç, gerçek imlecin gittiği AYNI eğride aynı sürede gider
 * (`control.ts` › `glidePoint`): orta noktası dik yönde %12 kaymış ikinci derece Bézier, hızlanıp yavaşlayan geçiş.
 */

// ───────────── kare deposu ─────────────

let latest: PcOverlayFrame | null = null;
/**
 * Görsel olaylı kareler sırayla işlenir: art arda gelen kareler (hareket → hedef → yazma) tek çizime toplanabilir;
 * yalnız son kareye bakılsaydı aradaki hedef vurgusu kaybolurdu (ilk e2e koşusunda yazma alanı vurgusu böyle düştü).
 */
const pending: PcOverlayFrame[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => latest;

/**
 * Yüzey bu ise dinleyiciyi HEMEN (betik yüklenirken, sayfa yüklemesi bitmeden) kurar ve çizer; değilse `false`.
 * Ana süreç ilk kareyi yükleme biter bitmez yollar: dinleyici React'in ilk efektini beklerse o kare kaybolabilirdi.
 */
export function startPcOverlay(): boolean {
  if (new URLSearchParams(window.location.search).get('surface') !== 'pc-overlay') return false;
  document.documentElement.dataset.surface = 'pc-overlay';
  window.fuber.on('pc.overlay', (frame) => {
    latest = frame;
    if (frame.fx) pending.push(frame);
    if (pending.length > 64) pending.splice(0, pending.length - 64);
    for (const listener of listeners) listener();
  });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PcOverlay />
    </StrictMode>,
  );
  return true;
}

// ───────────── hareket ─────────────

/** `control.ts` › `glidePoint` ile aynı eğri (yuvarlamasız: katman alt piksel çizer). */
export function glideAt(from: Point, to: Point, progress: number): Point {
  const time = Math.max(0, Math.min(1, progress));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bend = { x: from.x + dx * 0.5 - dy * 0.12, y: from.y + dy * 0.5 + dx * 0.12 };
  const e = time < 0.5 ? 4 * time * time * time : 1 - Math.pow(-2 * time + 2, 3) / 2;
  return {
    x: (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * bend.x + e * e * to.x,
    y: (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * bend.y + e * e * to.y,
  };
}

/** İzin ömrü (ms) ve parça sayısı: imlecin arkasında kısa, inceldikçe sönen kuyruk. */
const TRAIL_MS = 150;
const TRAIL_SEGMENTS = 10;
/** Halka süresi (`pc-overlay.css` › `pco-ring`) + pay. */
const RING_MS = 780;
const DOUBLE_GAP_MS = 160;
/** Hedef vurgusunun kalma süresi; yazma alanı yeni hedef/hareket gelene dek kalır. */
const TARGET_MS = { click: 1400, read: 1800 } as const;
/** Son yazma bildiriminden bu kadar sonra ilerleme rozeti söner. */
const TYPING_IDLE_MS = 2200;

const reduceQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

type Target = { rect: Rect; mode: 'type' | 'click' | 'read' };
type Typing = { chars: number; total: number };

function PcOverlay() {
  const frame = useSyncExternalStore(subscribe, snapshot);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<SVGGElement>(null);
  const pos = useRef<Point | null>(null);
  const trail = useRef<Array<{ x: number; y: number; at: number }>>([]);
  const raf = useRef(0);
  const lastSeq = useRef(-1);
  const [target, setTarget] = useState<Target | null>(null);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [pressed, setPressed] = useState(0);
  // İmleç, etiket ve rozet ekran ölçeğine göre büyür (koordinatör 3840×2160'ta 34×40 imleci çok küçük buldu): katman
  // penceresinin CSS yüksekliği 1300 px'i aştıkça orantılı (4K, %100 ölçekte ≈1,66 → imleç ≈56×66 px; kısa kenar da ≥56). Yüksek DPI'da
  // (4K %150) CSS yüksekliği 1440: ölçek ≈1,1, ekran ölçeğiyle birlikte fiziksel ≈56×66 px.
  const [scale, setScale] = useState(() => overlayScale());
  useEffect(() => {
    const onResize = () => setScale(overlayScale());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [, setSystemReduce] = useState(reduceQuery?.matches ?? false);

  useEffect(() => {
    if (!reduceQuery) return;
    const onChange = () => setSystemReduce(reduceQuery.matches);
    reduceQuery.addEventListener('change', onChange);
    return () => reduceQuery.removeEventListener('change', onChange);
  }, []);

  const reduced = frame ? frame.reducedMotion || (frame.systemMotion && (reduceQuery?.matches ?? false)) : false;

  const place = (point: Point) => {
    pos.current = point;
    const element = cursorRef.current;
    if (element) element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  };

  const drawTrail = (now: number) => {
    const group = trailRef.current;
    if (!group) return false;
    trail.current = trail.current.filter((point) => now - point.at <= TRAIL_MS);
    const points = trail.current;
    const lines = group.children;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as SVGLineElement;
      // En yeni parça en kalın ve en opak; eskiler incelir ve söner.
      const a = points[points.length - 2 - i];
      const b = points[points.length - 1 - i];
      if (!a || !b) {
        line.setAttribute('opacity', '0');
        continue;
      }
      const life = 1 - (now - b.at) / TRAIL_MS;
      const rank = 1 - i / lines.length;
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('opacity', String(Math.max(0, 0.55 * life * rank)));
      line.setAttribute('stroke-width', String(1 + 4 * rank * life));
    }
    return points.length > 1;
  };

  const glide = (from: Point, to: Point, ms: number) => {
    cancelAnimationFrame(raf.current);
    if (reduced || ms <= 0 || (from.x === to.x && from.y === to.y)) {
      trail.current = [];
      drawTrail(performance.now());
      place(to);
      return;
    }
    const started = performance.now();
    trail.current = [{ ...from, at: started }];
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / ms);
      const point = glideAt(from, to, progress);
      place(point);
      if (progress < 1) trail.current.push({ ...point, at: now });
      const tail = drawTrail(now);
      if (progress < 1 || tail) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const ring = (at: Point, button: string, delay: number) => {
    window.setTimeout(() => {
      const host = ringsRef.current;
      if (!host) return;
      const element = document.createElement('div');
      element.className = 'pco-ring';
      element.dataset.button = button === 'right' ? 'right' : 'left';
      element.style.left = `${at.x}px`;
      element.style.top = `${at.y}px`;
      host.appendChild(element);
      window.setTimeout(() => element.remove(), RING_MS);
    }, delay);
  };

  // Kare başına bir kez: hareket, dalga, hedef, yazma. Bekleyen kareler sırayla işlenir; aynı sıra numarası yeniden
  // gelirse (yükleme sonrası) oynatılmaz.
  useEffect(() => {
    if (!frame) return;
    if (!frame.visible) {
      // Sönüyor: sonraki oturum imleci sıfırdan (ilk hedefte) başlatsın.
      pending.length = 0;
      cancelAnimationFrame(raf.current);
      pos.current = null;
      trail.current = [];
      return;
    }
    if (frame.pointer && !pos.current) place(frame.pointer);
    for (const item of pending.splice(0)) {
      if (item.seq <= lastSeq.current || !item.fx) continue;
      lastSeq.current = item.seq;
      play(item.fx);
    }
    lastSeq.current = Math.max(lastSeq.current, frame.seq);
    // `play` her çizimde yeniden kurulur ama yalnız kare değişince çağrılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const play = (fx: NonNullable<PcOverlayFrame['fx']>) => {
    switch (fx.kind) {
      case 'move': {
        const from = fx.from ?? pos.current ?? fx.to;
        glide(from, fx.to, fx.ms);
        setTarget((current) => (current && current.mode === 'type' && !inside(current.rect, fx.to) ? null : current));
        // İmleç yola çıktıysa yazma bitmiştir: "Yazıyor 14/40" rozeti bir sonraki tıklamanın üstünde kalmasın.
        setTyping(null);
        break;
      }
      case 'click': {
        cancelAnimationFrame(raf.current);
        place(fx.at);
        setPressed((value) => value + 1);
        setTyping(null);
        ring(fx.at, fx.button, 0);
        if (fx.double) ring(fx.at, fx.button, DOUBLE_GAP_MS);
        break;
      }
      case 'target':
        setTarget({ rect: fx.rect, mode: fx.mode });
        if (fx.mode !== 'type') setTyping(null);
        break;
      case 'typing':
        setTyping({ chars: fx.chars, total: fx.total });
        break;
    }
  };

  // Tıklanan/okunan alanın vurgusu kısa süre sonra söner; yazılan alan yazı sürdükçe kalır.
  useEffect(() => {
    if (!target || target.mode === 'type') return;
    const timer = window.setTimeout(() => setTarget(null), TARGET_MS[target.mode]);
    return () => window.clearTimeout(timer);
  }, [target]);
  useEffect(() => {
    if (!typing) return;
    const timer = window.setTimeout(() => setTyping(null), TYPING_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [typing]);
  // Katman sönünce geçici vurgular da gider.
  useEffect(() => {
    if (frame && !frame.visible) {
      setTarget(null);
      setTyping(null);
    }
  }, [frame]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  if (!frame) return null;

  const name = frame.name || 'Jarvis';
  const showPointer = frame.visible && frame.pointer !== null;
  const typingText = typing ? t('pc.overlay.typing', { chars: typing.chars, total: typing.total }) : null;
  const typingShare = typing && typing.total > 0 ? Math.min(1, typing.chars / typing.total) : null;
  const message = stateMessage(frame);
  const doing = frame.step || (frame.action ? t(`pc.overlay.action.${frame.action}`) : null);
  /** İmleç rozeti: durum > yazma ilerlemesi > adım. */
  const badge = message ?? typingText ?? doing;
  const flip = frame.pointer ? frame.pointer.x > frame.work.x + frame.work.width - 300 * scale : false;
  const keys = frame.stopKeys ? frame.stopKeys.split('+').filter(Boolean) : [];

  return (
    <div
      className="pco"
      data-testid="pc-overlay"
      data-on={frame.visible ? '' : undefined}
      data-state={frame.state}
      data-reduced={reduced ? '' : undefined}
      data-focus={frame.focus ? '' : undefined}
      data-scale={scale.toFixed(2)}
      style={{ '--pco-s': scale.toFixed(3) } as CSSProperties}
    >
      <div className="pco-edge" data-testid="pc-overlay-edge" />

      <svg className="pco-trail" aria-hidden width="100%" height="100%">
        <g ref={trailRef}>
          {Array.from({ length: TRAIL_SEGMENTS }, (_, index) => (
            <line key={index} opacity="0" strokeLinecap="round" />
          ))}
        </g>
      </svg>

      {target && frame.visible ? (
        <div
          className="pco-target"
          data-testid="pc-overlay-target"
          data-mode={target.mode}
          style={{ left: target.rect.left, top: target.rect.top, width: Math.max(4, target.rect.right - target.rect.left), height: Math.max(4, target.rect.bottom - target.rect.top) }}
        >
          <i data-corner="tl" />
          <i data-corner="tr" />
          <i data-corner="bl" />
          <i data-corner="br" />
          {!showPointer ? (
            <span className="pco-target-label">
              {typingText ?? t(`pc.overlay.mode.${target.mode}`)}
              {typingShare !== null ? <Meter share={typingShare} /> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="pco-rings" ref={ringsRef} data-testid="pc-overlay-rings" />

      <div className="pco-cursor" ref={cursorRef} data-testid="pc-overlay-cursor" data-show={showPointer ? '' : undefined} data-flip={flip ? '' : undefined}>
        <div className="pco-cursor-body">
        <div className="pco-arrow" key={pressed} data-pressed={pressed > 0 ? '' : undefined}>
          <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden>
            <defs>
              <linearGradient id="pco-fill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#c9d1e6" />
              </linearGradient>
            </defs>
            <path d="M3 2 L3 33 L11.5 25.5 L17 38 L22.5 35.6 L17.2 23.4 L29 23.2 Z" fill="url(#pco-fill)" stroke="#0b0b0d" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="pco-tag">
          <span className="pco-tag-dot" />
          {name}
        </div>
        {badge ? (
          <div className="pco-badge" data-testid="pc-overlay-badge" data-tone={frame.state === 'waiting' ? 'amber' : undefined}>
            <span className="pco-badge-text">{badge}</span>
            {!message && typingShare !== null ? <Meter share={typingShare} /> : null}
          </div>
        ) : null}
        </div>
      </div>

      {frame.focus ? (
        <div className="pco-strip" data-testid="pc-overlay-strip" style={{ left: frame.work.x + frame.work.width / 2, top: frame.work.y + frame.work.height - 20 }}>
          <span className="pco-strip-dot" />
          <strong className="pco-strip-title">{message ?? t('pc.overlay.using', { name })}</strong>
          {doing && frame.state !== 'interrupted' && frame.state !== 'stopped' ? (
            <>
              <span className="pco-sep" />
              <span className="pco-strip-step">{doing}</span>
              {frame.progress && frame.progress.total > 1 ? (
                <span className="pco-chip">{t('pc.overlay.progress', { index: frame.progress.index, total: frame.progress.total })}</span>
              ) : null}
            </>
          ) : null}
          <span className="pco-sep" />
          <span className="pco-strip-hint">
            {hintFor(frame, keys.length > 0)}
            {frame.state === 'working' && keys.length > 0 ? (
              <span className="pco-keys">
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Meter({ share }: { share: number }) {
  return (
    <span className="pco-meter" aria-hidden>
      <span style={{ transform: `scaleX(${share})` }} />
    </span>
  );
}

function stateMessage(frame: PcOverlayFrame): string | null {
  if (frame.state === 'waiting') return t('pc.overlay.waiting');
  if (frame.state === 'interrupted') return t('pc.overlay.interrupted');
  if (frame.state === 'stopped') return t('pc.overlay.stopped');
  return null;
}

function hintFor(frame: PcOverlayFrame, hasKeys: boolean): string {
  if (frame.state === 'waiting') return t('pc.overlay.waitingHint');
  if (frame.state === 'interrupted') return t('pc.overlay.interruptedHint');
  if (frame.state === 'stopped') return t('pc.overlay.stoppedHint');
  return hasKeys ? t('pc.overlay.hint') : t('pc.overlay.hintMouse');
}

function inside(rect: Rect, point: Point): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/** İmleç grubunun ölçeği: katman penceresinin CSS yüksekliğine göre, 1 ile 2,2 arası. */
function overlayScale(): number {
  const height = typeof window === 'undefined' ? 0 : window.innerHeight || window.screen?.height || 0;
  return Math.min(2.2, Math.max(1, height / 1300));
}
