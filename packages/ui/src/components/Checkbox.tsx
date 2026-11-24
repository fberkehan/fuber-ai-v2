import type { ComponentPropsWithRef, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../cn';
import { durations, easings, useReducedMotion } from '../motion';

export type CheckedState = boolean | 'mixed';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange' | 'children'> {
  checked: CheckedState;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
}

/**
 * Onay kutusu (role="checkbox", üç hâl). İşaret çizilerek gelir: kutunun "anladım" demesi.
 * 20 px; yarıçap `xs` (küçük denetimlerde 12 px yuvarlağa dönerdi).
 */
export function Checkbox({ checked, onCheckedChange, label, description, disabled, className, ...rest }: CheckboxProps) {
  const reduced = useReducedMotion();
  const on = checked === true || checked === 'mixed';
  const draw = reduced ? { duration: 0 } : { duration: durations.fast, ease: easings.out };

  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'mixed' ? 'mixed' : checked}
      disabled={disabled}
      onClick={() => onCheckedChange(checked !== true)}
      className={cn(
        'relative inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs',
        'transition-[background-color,box-shadow,transform] duration-(--duration-fast) ease-out active:scale-[0.92]',
        on ? 'bg-accent' : 'bg-surface-2 shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--color-fg-faint)]',
        'disabled:cursor-default disabled:bg-surface-4 disabled:shadow-none disabled:active:scale-100',
        className,
      )}
      {...rest}
    >
      <svg viewBox="0 0 20 20" className="size-5" aria-hidden fill="none">
        {checked === 'mixed' ? (
          <motion.path
            d="M6 10h8"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            className={disabled ? 'text-fg-faint' : 'text-fg'}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={draw}
          />
        ) : (
          <motion.path
            d="M5.5 10.4l3 3 6-6.6"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={disabled ? 'text-fg-faint' : 'text-fg'}
            initial={false}
            animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
            transition={draw}
          />
        )}
      </svg>
    </button>
  );

  if (!label) return box;
  return (
    <label className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-default')}>
      <span className="flex h-6 items-center">{box}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-base', disabled ? 'text-fg-faint' : 'text-fg')}>{label}</span>
        {description && <span className="text-sm text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}
