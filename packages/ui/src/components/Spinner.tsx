import type { ComponentPropsWithRef } from 'react';
import { cn } from '../cn';

export interface SpinnerProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Piksel; 16 / 20 / 24 önerilir. */
  size?: number;
  /** Ekran okuyucu metni. `null` verilirse süs sayılır (düğme içinde, düğme zaten `aria-busy`). */
  label?: string | null;
}

/**
 * Yükleniyor göstergesi: sabit bir halka üstünde dönen yay. Sonsuz döngüsü olan iki öğeden biridir
 * (diğeri Core); azaltılmış harekette yavaşlar ama durmaz, çünkü "sürüyor" bilgisini taşır.
 */
export function Spinner({ size = 16, label = 'Yükleniyor', className, ...rest }: SpinnerProps) {
  const stroke = size <= 16 ? 2 : 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      role={label === null ? undefined : 'status'}
      aria-label={label ?? undefined}
      aria-hidden={label === null ? true : undefined}
      className={cn('inline-flex shrink-0 items-center justify-center text-current', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="animate-spin" data-keep-motion>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * 0.28} ${c}`}
        />
      </svg>
    </span>
  );
}
