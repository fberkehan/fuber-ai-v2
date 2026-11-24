import type { ComponentPropsWithRef, KeyboardEvent, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../cn';
import { enter, stagger, useMotionPreset } from '../motion';

export interface ListProps extends ComponentPropsWithRef<'div'> {
  /** Satırlar arası ince çizgi. */
  divided?: boolean;
}

/**
 * Satır listesi. Yukarı/aşağı oklar tıklanabilir satırlar arasında gezer; Home/End uçlara gider.
 * Seçim durumu satırda tutulur (`selected`); liste yalnız klavye gezintisini sağlar.
 */
export function List({ divided, className, onKeyDown, children, ...rest }: ListProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-row-action]:not(:disabled)'));
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row === document.activeElement);
    const next =
      event.key === 'Home'
        ? rows[0]
        : event.key === 'End'
          ? rows[rows.length - 1]
          : rows[Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1)];
    event.preventDefault();
    next?.focus();
  };
  return (
    <div
      role="list"
      onKeyDown={handleKeyDown}
      className={cn('flex flex-col', divided ? '[&>*+*]:border-t [&>*+*]:border-line' : 'gap-0.5', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface RowProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> {
  /** Soldaki ikon (kutucuk içinde) ya da özel öğe (avatar, Core). */
  icon?: ReactNode;
  /** İkon kutucuğunun rengi; varsayılan nötr. */
  iconTone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  title: ReactNode;
  subtitle?: ReactNode;
  /** Sağ yuva: saat, Badge, KeyHint, IconButton. */
  trailing?: ReactNode;
  selected?: boolean;
  /** Verilince satır düğme olur (klavyeyle odaklanır, Enter tetikler). */
  onPress?: () => void;
  disabled?: boolean;
  /** Kademeli giriş sırası: satır ilk kez eklendiğinde `index` × 35 ms gecikir. */
  index?: number;
  density?: 'compact' | 'regular';
}

const toneClasses = {
  neutral: 'bg-surface-4 text-fg-muted',
  accent: 'bg-accent-soft text-accent-fg',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

/**
 * Liste satırı: ikon · başlık/alt metin · sağ yuva. Seçili satırın solunda ince "çentik" çizgisi,
 * zemin bir kat açılır. Satırın tamamı tek tıklama hedefidir; sağ yuvadaki düğmeler kendi olayını durdurur.
 */
export function Row({
  icon,
  iconTone = 'neutral',
  title,
  subtitle,
  trailing,
  selected,
  onPress,
  disabled,
  index = 0,
  density = 'regular',
  className,
  ...rest
}: RowProps) {
  const preset = useMotionPreset(enter.fadeUp);
  const interactive = !!onPress;
  return (
    <motion.div
      role="listitem"
      initial={preset.initial}
      animate={preset.animate}
      transition={stagger(index, preset.transition)}
      className={cn('group relative', className)}
      {...rest}
    >
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive && !disabled ? 0 : undefined}
        aria-pressed={interactive && selected !== undefined ? selected : undefined}
        aria-disabled={disabled || undefined}
        data-row-action={interactive && !disabled ? '' : undefined}
        data-selected={selected || undefined}
        onClick={interactive && !disabled ? onPress : undefined}
        onKeyDown={
          interactive && !disabled
            ? (event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPress?.();
                }
              }
            : undefined
        }
        className={cn(
          'relative flex items-center gap-3 rounded-sm px-3 outline-offset-[-2px]',
          density === 'compact' ? 'min-h-11 py-1.5' : 'min-h-14 py-2.5',
          interactive && !disabled && 'cursor-pointer transition-colors duration-(--duration-fast) ease-out hover:bg-surface-3',
          selected && 'bg-surface-3',
          disabled && 'text-fg-faint',
        )}
      >
        {selected && (
          <span aria-hidden className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent-fg" />
        )}
        {icon && (
          <span
            className={cn(
              'flex shrink-0 items-center justify-center rounded-sm [&_svg]:size-4.5',
              density === 'compact' ? 'size-8' : 'size-9',
              disabled ? 'bg-surface-3 text-fg-faint' : toneClasses[iconTone],
            )}
          >
            {icon}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-base font-medium', disabled ? 'text-fg-faint' : 'text-fg')}>{title}</span>
          {subtitle && <span className="truncate text-sm text-fg-muted">{subtitle}</span>}
        </span>
        {trailing && (
          <span
            className="flex shrink-0 items-center gap-2 text-sm text-fg-muted"
            onClick={(event) => {
              // Sağ yuvadaki düğme satırı da tetiklemesin; düz metne basmak satırı tetikler.
              if (event.target instanceof Element && event.target.closest('button,a,input,[role=switch],[role=checkbox]'))
                event.stopPropagation();
            }}
          >
            {trailing}
          </span>
        )}
      </div>
    </motion.div>
  );
}
