import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { cn } from '../cn';
import { useReducedMotion } from '../motion';
import { Signal } from './signal';
import { clamp } from './spring';
import { Swarm, type SwarmGeometry } from './swarm';
import { createTick, type Tick } from './ticker';
import { PRESENCE_LABELS, isLiveState, type PresenceState } from './types';

export interface PresenceProps {
  state: PresenceState;
  /** O anki ses düzeyi (RMS 0..1); her karede okunur. */
  getLevel?: () => number;
  /** Tek seferlik düzey (React durumu); `getLevel` varsa yok sayılır. */
  level?: number;
  /** Kutunun boyu (CSS px, kare). */
  size?: number;
  /** Geniş yüzey (Bugün bandı): tuval bu ölçüde, varlık `anchor` noktasında durur; boşta gökyüzü tozu görünür. */
  field?: { width: number; height: number; anchorX: number; anchorY: number };
  /** Kalan süre ya da ilerleme (0..1). */
  progress?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** Sınama işareti; kök öğeye iletilir (`data-state` de aynı öğededir). */
  'data-testid'?: string;
}

function orbGeometry(size: number, cx: number, cy: number): SwarmGeometry {
  // Küçük işaret (ray, sohbet satırı: 20–36 px): çekirdek oransal olarak daha iri ki yıldızlı zeminde kaybolmasın.
  const small = size < 40;
  return {
    cx,
    cy,
    R: size * (small ? 0.19 : 0.12),
    L: size * (small ? 0.4 : 0.35),
    spread: size * (small ? 0.1 : 0.08),
    rays: size < 60 ? 28 : 72,
    orb: 1.3,
    ringR: size * 0.2,
    frame: [size * 0.43, size * 0.27],
    size: clamp(size / 84, small ? 1.3 : 1.1, 2.4),
  };
}

/**
 * Jarvis'in varlığı, tek başına (ray, sohbet, kapılar, kurulum, Bugün'ün başı): yıldızlardan toplanan çekirdek.
 * Dinlerken mikrofon düzeyine, konuşurken ses düzeyine tepki verir; hareketsiz hâllerde kare üretmez. İmleci izlemez
 * (göz/bakış dili yoktur).
 */
export function Presence({
  state,
  getLevel,
  level = 0,
  size = 40,
  field,
  progress: progressProp,
  label,
  className,
  style,
  'data-testid': testId,
}: PresenceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;
  const signal = useRef(new Signal()).current;
  const tickRef = useRef<Tick | null>(null);
  const swarmRef = useRef<Swarm | null>(null);
  const progress = progressProp ?? 1;
  // Sayaç verilmediyse bildirim/onay hâli halka değil çekirdektir (bkz. Swarm.solid).
  const solid = progressProp === undefined;
  const live = useRef({ state, getLevel, level, progress, solid, reduced, size, field });
  live.current.state = state;
  live.current.getLevel = getLevel;
  live.current.level = level;
  live.current.progress = progress;
  live.current.solid = solid;
  live.current.reduced = reduced;
  live.current.size = size;
  live.current.field = field;

  const width = field ? field.width : size;
  const height = field ? field.height : size;
  const fieldKey = field ? `${field.width}x${field.height}` : '';

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const input = () => {
      const now = live.current;
      return isLiveState(now.state) || now.state === 'wake' ? (now.getLevel ? now.getLevel() : now.level) : 0;
    };
    const canvas = document.createElement('canvas');
    canvas.className = 'pz-orb';
    root.replaceChildren(canvas);
    const now = live.current;
    const w = now.field ? now.field.width : now.size;
    const h = now.field ? now.field.height : now.size;
    const count = now.field ? 6000 : now.size <= 40 ? 520 : now.size <= 96 ? 1600 : 3600;
    const swarm = new Swarm(canvas, { width: w, height: h, count, radial: true, idle: now.field ? 'dust' : 'core', seed: 91 });
    swarmRef.current = swarm;
    swarm.solid = now.solid;
    swarm.target(now.state, true);
    let tick: Tick;
    const mark = (ok: boolean) => {
      if (ok) delete root.dataset.nogl;
      else root.dataset.nogl = '';
      canvas.style.display = ok ? '' : 'none';
    };
    mark(swarm.ok);
    swarm.onContext = (ok) => {
      mark(ok);
      tick.wake();
    };
    tick = createTick((dt, t) => {
      const current = live.current;
      signal.update(dt, input());
      const f = current.field;
      const s = f ? Math.min(f.height * 0.75, 200) : current.size;
      const geometry = orbGeometry(s, f ? f.anchorX : current.size / 2, f ? f.anchorY : current.size / 2);
      swarm.setArc(current.state === 'muted' || current.state === 'stopped' ? 0 : current.progress);
      return swarm.frame(dt, t, geometry, signal, current.reduced);
    });
    tickRef.current = tick;
    tick.wake();
    return () => {
      tick.stop();
      swarmRef.current?.destroy();
      swarmRef.current = null;
      tickRef.current = null;
      root.replaceChildren();
    };
    // Boyut değişimi motoru yeniden kurar (ender: pencere eşiği); alan ölçüsü ayrıca izlenir.
  }, [size, fieldKey, signal]);

  useEffect(() => {
    if (swarmRef.current) swarmRef.current.solid = solid;
    swarmRef.current?.target(state);
    tickRef.current?.wake();
  }, [state, solid]);

  useEffect(() => {
    tickRef.current?.wake();
  }, [progress, reduced, level, field?.anchorX, field?.anchorY]);

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label={label ?? PRESENCE_LABELS[state]}
      data-state={state}
      data-presence={field ? 'field' : 'mark'}
      data-testid={testId}
      className={cn('pz-presence', className)}
      style={{ width, height, ...style }}
    />
  );
}
