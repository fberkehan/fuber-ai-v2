import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';

export type StatusKind = 'online' | 'listening' | 'busy' | 'offline' | 'error' | 'muted';

export interface StatusPillProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  status: StatusKind;
  /** Görünen metin; verilmezse varsayılan Türkçe ad. */
  label?: ReactNode;
  /** Sağda ikinci bilgi (ör. "12 ms", "v2.0.0"). */
  detail?: ReactNode;
}

const meta: Record<StatusKind, { dot: string; label: string }> = {
  online: { dot: 'bg-success', label: 'Bağlı' },
  listening: { dot: 'bg-accent-fg', label: 'Dinliyor' },
  busy: { dot: 'bg-warning', label: 'Meşgul' },
  offline: { dot: 'bg-fg-faint', label: 'Bağlı değil' },
  error: { dot: 'bg-danger', label: 'Hata' },
  muted: { dot: 'bg-fg-faint', label: 'Mikrofon kapalı' },
};

/**
 * Durum hapı: nokta + ad. Nokta yanıp sönmez (süs döngüsü yok); durum değişince renk geçişi anlatır,
 * noktanın çevresindeki hale yalnız "canlı" durumlarda (bağlı, dinliyor) durur.
 */
export function StatusPill({ status, label, detail, className, ...rest }: StatusPillProps) {
  const item = meta[status];
  const live = status === 'online' || status === 'listening';
  return (
    <span
      role="status"
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-2 rounded-full bg-surface-2 pr-3 pl-2.5 text-sm font-medium text-fg shadow-[inset_0_0_0_1px_var(--color-line)]',
        className,
      )}
      {...rest}
    >
      <span className="relative flex size-2 items-center justify-center">
        {live && <span aria-hidden className={cn('absolute size-3.5 rounded-full opacity-25', item.dot)} />}
        <span aria-hidden className={cn('relative size-2 rounded-full transition-colors duration-(--duration-base)', item.dot)} />
      </span>
      {label ?? item.label}
      {detail && <span className="font-mono text-xs text-fg-faint">{detail}</span>}
    </span>
  );
}
