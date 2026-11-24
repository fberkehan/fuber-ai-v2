import type { ComponentPropsWithRef, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../cn';
import { spring, useMotionTransition } from '../motion';
import type { Tone } from './Badge';

const fills: Record<Tone, string> = {
  neutral: 'bg-fg',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};
const strokes: Record<Tone, string> = {
  neutral: 'text-fg',
  accent: 'text-accent-fg',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export interface ProgressBarProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** 0..1 */
  value: number;
  tone?: Tone;
  /** Üstte sol etiket. */
  label?: ReactNode;
  /** Üstte sağda değer metni; `true` verilirse yüzde yazılır. */
  valueLabel?: ReactNode | true;
  size?: 'sm' | 'md';
}

/** Çizgi ilerleme. Dolgu `scaleX` ile yaylanır (yerleşim hesaplanmaz); süresi belirsiz iş için Spinner kullanın. */
export function ProgressBar({ value, tone = 'accent', label, valueLabel, size = 'md', className, ...rest }: ProgressBarProps) {
  const v = clamp01(value);
  const transition = useMotionTransition(spring.smooth);
  const text = valueLabel === true ? `%${Math.round(v * 100)}` : valueLabel;
  return (
    <div className={cn('flex flex-col gap-2', className)} {...rest}>
      {(label || text) && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-fg-muted">{label}</span>
          {text && <span className="font-medium text-fg tabular-nums">{text}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
        aria-label={typeof label === 'string' ? label : undefined}
        className={cn('overflow-hidden rounded-full bg-surface-4', size === 'sm' ? 'h-1' : 'h-1.5')}
      >
        <motion.div
          className={cn('h-full w-full origin-left rounded-full', fills[tone])}
          initial={false}
          animate={{ transform: `scaleX(${v})` }}
          transition={transition}
        />
      </div>
    </div>
  );
}

export interface ProgressRingProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  value: number;
  size?: number;
  /** Çizgi kalınlığı (px). */
  thickness?: number;
  tone?: Tone;
  /** Ortadaki içerik; verilmezse büyük halkada yüzde yazılır. */
  children?: ReactNode;
  label?: string;
}

/** Halka ilerleme. Uç yuvarlak; 0'da görünmez, değer değişince yayla akar. */
export function ProgressRing({
  value,
  size = 48,
  thickness,
  tone = 'accent',
  children,
  label,
  className,
  style,
  ...rest
}: ProgressRingProps) {
  const v = clamp01(value);
  const stroke = thickness ?? Math.max(3, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const transition = useMotionTransition(spring.smooth);
  const content = children ?? (size >= 44 ? <span className="text-sm font-medium tabular-nums">%{Math.round(v * 100)}</span> : null);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
      className={cn('relative inline-flex shrink-0 items-center justify-center text-fg', className)}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-4" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={strokes[tone]}
          initial={false}
          animate={{ pathLength: v, opacity: v > 0 ? 1 : 0 }}
          transition={transition}
        />
      </svg>
      {content}
    </div>
  );
}
