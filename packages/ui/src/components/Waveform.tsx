import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithRef } from 'react';
import { cn } from '../cn';
import { useReducedMotion } from '../motion';

export interface WaveformProps extends Omit<ComponentPropsWithRef<'canvas'>, 'children'> {
  /** Genlik dizisi 0..1 (en yeni sonda). Her ses karesinde yeni dizi verilebilir; çizim React'ten bağımsızdır. */
  levels: readonly number[];
  /** Görünen çubuk sayısı; dizi daha uzunsa sondan alınır, kısaysa soldan sessizlikle dolar. */
  bars?: number;
  /** CSS pikseli; verilmezse kabın genişliğini doldurur. */
  width?: number;
  height: number;
  /** `fg` beyaz (ada), `accent` Fuber mavisi, `muted` sönük (sessiz). */
  tone?: 'fg' | 'accent' | 'muted';
  /** Ekran okuyucu adı; verilmezse süs sayılır. */
  label?: string;
}

const colors = { fg: '#f5f5f7', accent: '#5b9bff', muted: '#8f8f98' } as const;
const BAR = 3;

interface Config {
  bars: number;
  width: number;
  height: number;
  tone: NonNullable<WaveformProps['tone']>;
  reduced: boolean;
}

/**
 * Canlı dalga: ortadan simetrik yuvarlak uçlu çubuklar, kenarlara doğru sönen. Yeni genlikler geldikçe
 * çubuklar hedefe kısa bir yumuşatmayla yaklaşır (yükselirken hızlı, inerken yavaş); hedefe varınca
 * çizim durur. Sürekli döngü yoktur: genlik gelmezse yerleşir ve bekler.
 */
export function Waveform({ levels, bars = 28, width, height, tone = 'fg', label, className, style, ...rest }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion() ?? false;
  const [measured, setMeasured] = useState(0);
  const resolvedWidth = width ?? measured;
  const config = useRef<Config>({ bars, width: resolvedWidth, height, tone, reduced });
  config.current = { bars, width: resolvedWidth, height, tone, reduced };

  useLayoutEffect(() => {
    if (width !== undefined) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setMeasured(Math.round(canvas.clientWidth)));
    observer.observe(canvas);
    setMeasured(Math.round(canvas.clientWidth));
    return () => observer.disconnect();
  }, [width]);
  const shown = useRef(new Float32Array(bars));
  const target = useRef(new Float32Array(bars));
  const frame = useRef(0);
  const last = useRef(0);

  const draw = useRef((now: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      frame.current = 0;
      return;
    }
    const { bars: n, width: w, height: h, tone: color, reduced: still } = config.current;
    if (w <= 0) {
      frame.current = 0;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const dt = last.current ? Math.min(0.05, (now - last.current) / 1000) : 1 / 60;
    last.current = now;

    const s = shown.current;
    const goalArray = target.current;
    let moving = false;
    for (let i = 0; i < n; i++) {
      const current = s[i] ?? 0;
      const goal = goalArray[i] ?? 0;
      const rate = goal > current ? 30 : 9;
      let next = still ? goal : current + (goal - current) * (1 - Math.exp(-rate * dt));
      if (Math.abs(goal - next) < 0.002) next = goal;
      s[i] = next;
      if (next !== goal) moving = true;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors[color];
    const gap = Math.max(1, (w - n * BAR) / Math.max(1, n - 1));
    const mid = h / 2;
    const half = Math.max(1, (n - 1) / 2);
    for (let i = 0; i < n; i++) {
      const edge = Math.abs(i - half) / half;
      const amplitude = (s[i] ?? 0) * (1 - edge * 0.4);
      const barH = Math.max(BAR, amplitude * (h - 2));
      ctx.globalAlpha = 0.32 + 0.68 * (1 - edge * edge);
      ctx.beginPath();
      ctx.roundRect(i * (BAR + gap), mid - barH / 2, BAR, barH, BAR / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (moving) frame.current = requestAnimationFrame(draw.current);
    else {
      frame.current = 0;
      last.current = 0;
    }
  });

  useEffect(() => {
    if (shown.current.length !== bars) {
      shown.current = new Float32Array(bars);
      target.current = new Float32Array(bars);
    }
    const t = target.current;
    const offset = Math.max(0, levels.length - bars);
    const pad = Math.max(0, bars - levels.length);
    for (let i = 0; i < bars; i++) {
      const v = i < pad ? 0 : (levels[offset + i - pad] ?? 0);
      t[i] = Math.min(1, Math.max(0, v));
    }
    if (!frame.current) frame.current = requestAnimationFrame(draw.current);
  }, [levels, bars, resolvedWidth, height, tone, reduced]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('block', width === undefined ? 'w-full min-w-0 flex-1' : 'shrink-0', className)}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
}
