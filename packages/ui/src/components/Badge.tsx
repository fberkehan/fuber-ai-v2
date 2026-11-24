import type { ComponentPropsWithRef, ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from '../cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-4 text-fg-muted',
  accent: 'bg-accent-soft text-accent-fg',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

const dots: Record<Tone, string> = {
  neutral: 'bg-fg-faint',
  accent: 'bg-accent-fg',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  tone?: Tone;
  /** Başta renkli nokta (durum). */
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

/** Durum ya da sayı etiketi; etkileşimsiz. Yazı 12 px, renk tonla gelir; zemin aynı tonun %14'ü. */
export function Badge({ tone = 'neutral', dot, icon, size = 'md', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap [&_svg]:size-3.5',
        size === 'sm' ? 'h-5 px-2 text-xs' : 'h-6 px-2.5 text-xs',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span aria-hidden className={cn('size-1.5 rounded-full', dots[tone])} />}
      {icon}
      {children}
    </span>
  );
}

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange'> {
  /** Seçilebilir süzgeç çipi: `aria-pressed`. */
  selected?: boolean;
  icon?: ReactNode;
  /** Verilince sağda kaldır düğmesi çıkar. */
  onRemove?: () => void;
  removeLabel?: string;
}

/**
 * Etkileşimli çip: süzgeç (seçilebilir) ya da kaldırılabilir etiket. Seçili çip beyaz hap olur:
 * birincil düğmeyle aynı dil, "bu açık" demenin en açık yolu.
 */
export function Chip({ selected, icon, onRemove, removeLabel = 'Kaldır', className, children, disabled, ...rest }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-8 shrink-0 items-center rounded-full text-sm font-medium transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-out',
        selected ? 'bg-primary text-on-primary' : 'bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--color-line)]',
        disabled && 'bg-surface-3 text-fg-faint shadow-none',
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={onRemove ? undefined : selected}
        disabled={disabled}
        className={cn(
          'inline-flex h-full cursor-pointer items-center gap-1.5 rounded-full pl-3 outline-offset-1 [&_svg]:size-4 active:scale-[0.97]',
          'transition-transform duration-(--duration-instant) disabled:cursor-default disabled:active:scale-100',
          onRemove ? 'pr-1' : 'pr-3',
          !selected && !disabled && 'hover:text-fg',
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
          className={cn(
            'mr-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-full',
            'transition-colors duration-(--duration-fast)',
            selected ? 'hover:bg-on-primary/10' : 'text-fg-muted hover:bg-surface-5 hover:text-fg',
          )}
        >
          <X aria-hidden weight="bold" className="size-3" />
        </button>
      )}
    </span>
  );
}
