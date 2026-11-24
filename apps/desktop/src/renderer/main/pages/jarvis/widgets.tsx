// JARVIS MODE ortak parçaları: sahne ölçeği, hareket tercihi, yumuşak sayı, daktilo yazı, canlı grafik, EKG, bölmeli çubuk.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Sahne (1600×900) ölçeği: tuval çözünürlüğü bununla çarpılır ki 4K'da canvas bulanmasın. */
export const StageScale = createContext(1);
export const useStageScale = () => useContext(StageScale);

/** `prefers-reduced-motion` ya da uygulama ayarı ("Hareketi azalt" açık). */
export const ReducedMotion = createContext(false);
export const useReduced = () => useContext(ReducedMotion);

export function useSystemReduced(): boolean {
  const [reduced, setReduced] = useState(() => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Değeri hedefe doğru yumuşakça kaydırır (rAF; yakınsayınca durur). Hareket azaltılmışsa anında. */
export function useSmooth(target: number | null, ms = 700): number | null {
  const reduced = useReduced();
  const [shown, setShown] = useState<number | null>(target);
  const cur = useRef<number | null>(target);
  useEffect(() => {
    if (target === null || reduced || cur.current === null) {
      cur.current = target;
      setShown(target);
      return;
    }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - k) ** 3;
      cur.current = from + (target - from) * e;
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return shown;
}

export function Num({ value, digits = 0, suffix = '', fallback = '—', pad = 0 }: { value: number | null | undefined; digits?: number; suffix?: string; fallback?: string; pad?: number }) {
  const v = useSmooth(value ?? null);
  const reduced = useReduced();
  // "Tik" efekti: hedef değer (gösterilen basamağa yuvarlanmış) değişince kısa bir parlama.
  const target = value === null || value === undefined || !Number.isFinite(value) ? null : value.toFixed(digits);
  const prev = useRef(target);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prev.current !== null && target !== null && target !== prev.current && !reduced) setTick((n) => n + 1);
    prev.current = target;
  }, [target, reduced]);
  if (v === null || v === undefined || !Number.isFinite(v)) return <>{fallback}</>;
  const s = v.toFixed(digits);
  return (
    <span key={tick} className={tick ? 'jv-ticking' : undefined}>
      {pad ? s.padStart(pad, '0') : s}
      {suffix}
    </span>
  );
}

/**
 * Gösterilen nabız: son GERÇEK değerin ±1,5 bpm çevresinde, birkaç sn'de bir yeni hedefe yavaşça kayar (saat sürekli ölçmez;
 * görünüm sürekli ölçümü canlandırır). Değer yoksa ya da `active` değilse null/gerçek değer.
 */
export function Type({ text, delay = 0, speed = 24, className }: { text: string; delay?: number; speed?: number; className?: string }) {
  const reduced = useReduced();
  const [n, setN] = useState(reduced ? text.length : 0);
  const done = useRef(reduced);
  useEffect(() => {
    if (done.current) {
      setN(text.length);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const count = Math.max(0, Math.floor((now - t0) / speed));
      if (count >= text.length) {
        done.current = true;
        setN(text.length);
        return;
      }
      setN(count);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, speed]);
  return (
    <span className={className}>
      {text.slice(0, n)}
      {n < text.length && n > 0 ? <i className="jv-caret" /> : null}
    </span>
  );
}

/** Alan grafiği (SVG): `series` kendi min–maks aralığına oturur. */
export function Spark({ series, width, height, up = true, className }: { series: number[]; width: number; height: number; up?: boolean; className?: string }) {
  const { line, area } = useMemo(() => {
    if (series.length < 2) return { line: '', area: '' };
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const pts = series.map((v, i) => [(i / (series.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 8)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    return { line, area: `${line}L${width} ${height}L0 ${height}Z` };
  }, [series, width, height]);
  if (!line) return <svg className={className} width={width} height={height} />;
  return (
    <svg className={`jv-spark ${up ? '' : 'is-down'} ${className ?? ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`jv-sg-${up ? 'u' : 'd'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#jv-sg-${up ? 'u' : 'd'})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={width} cy={Number(line.split(' ').pop())} r="2.4" fill="currentColor" />
    </svg>
  );
}

/** Çok çizgili geçmiş grafiği (ATÖLYE): 0–100 aralığı sabit. */
export function MultiLine({ lines, width, height }: { lines: Array<{ series: number[]; cls: string }>; width: number; height: number }) {
  return (
    <svg className="jv-multi" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {[0, 25, 50, 75, 100].map((g) => (
        <line key={g} x1="0" x2={width} y1={height - (g / 100) * (height - 6) - 3} y2={height - (g / 100) * (height - 6) - 3} className="jv-gridline" />
      ))}
      {lines.map((l, k) => {
        if (l.series.length < 2) return null;
        const off = 60 - l.series.length;
        const d = l.series.map((v, i) => `${i ? 'L' : 'M'}${(((i + off) / 59) * width).toFixed(1)} ${(height - 3 - (Math.max(0, Math.min(100, v)) / 100) * (height - 6)).toFixed(1)}`).join('');
        return <path key={k} d={d} className={`jv-ml ${l.cls}`} fill="none" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

/** Bölmeli ilerleme çubuğu (referanstaki 10'lu kareler). */
export function Segs({ value, count = 12, tone = '' }: { value: number; count?: number; tone?: string }) {
  const filled = Math.round((Math.max(0, Math.min(1, value)) * count));
  return (
    <span className={`jv-segs ${tone}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : ''} />
      ))}
    </span>
  );
}

// ───────── EKG ─────────

/** Bir kalp atışının şematik dalgası (P-QRS-T), faz 0..1 → -0.35..1. Dalga şekli şematiktir; ritim gerçek nabızdır. */
export interface PanelProps {
  tag: string;
  title: string;
  badge?: ReactNode;
  badgeTone?: 'ok' | 'warn' | 'bad' | 'dim';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Açılış gecikmesi (ms). */
  delay?: number;
  children: ReactNode;
  className?: string;
  testId?: string;
}

const CUT = 12;

export function Panel({ tag, title, badge, badgeTone = 'ok', x, y, w, h, delay = 0, children, className, testId }: PanelProps) {
  const style = { left: x, top: y, width: w, height: h, '--d': `${delay}ms`, '--cut': `${CUT}px` } as CSSProperties;
  const outline = `${CUT},0.5 ${w - 0.5},0.5 ${w - 0.5},${h - CUT} ${w - CUT},${h - 0.5} 0.5,${h - 0.5} 0.5,${CUT}`;
  return (
    <section className={`jv-panel ${className ?? ''}`} style={style} data-testid={testId}>
      <svg className="jv-outline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <polygon points={outline} pathLength={1} />
        <polygon className="jv-runner" points={outline} pathLength={1} style={{ ['--rd' as string]: `${(delay % 7) * -0.9 - 1}s` }} />
        <path className="jv-tick" d={`M${w - 14} 0.5H${w - 0.5}V14`} />
        <path className="jv-tick" d={`M0.5 ${h - 14}V${h - 0.5}H14`} />
      </svg>
      <header className="jv-phead">
        <span className="jv-ptag">{tag}</span>
        <span className="jv-ptitle">
          <Type text={title} delay={delay + 200} speed={18} />
        </span>
        {badge !== undefined && <span className={`jv-badge is-${badgeTone}`}>{badge}</span>}
      </header>
      <div className="jv-pbody">{children}</div>
    </section>
  );
}

/** "BAĞLI DEĞİL" gösterimi: veri yoksa sahte sayı yerine bu. */
export function Off({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="jv-off">
      <strong>{children}</strong>
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}
