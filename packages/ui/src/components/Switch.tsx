import type { ComponentPropsWithRef, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../cn';
import { spring, useMotionTransition } from '../motion';
import { useField } from './Field';

export interface SwitchProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange' | 'children'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Yanındaki metin; tıklanabilir. */
  label?: ReactNode;
  /** Etiket altında açıklama. */
  description?: ReactNode;
  size?: 'sm' | 'md';
}

/**
 * Anahtar (role="switch"). Topuz yayla kayar; basılı tutunca hafifçe genişler (dokunulduğunu söyler).
 * Açık: Fuber mavisi ray + beyaz topuz. Kapalı: koyu ray + gri topuz.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  size = 'md',
  disabled,
  className,
  id,
  ...rest
}: SwitchProps) {
  const field = useField();
  const transition = useMotionTransition(spring.snappy);
  const dims = size === 'sm' ? { w: 32, h: 20, knob: 14 } : { w: 40, h: 24, knob: 18 };
  const travel = dims.w - dims.knob - 6;

  const control = (
    <button
      type="button"
      role="switch"
      id={id ?? field?.id}
      aria-checked={checked}
      aria-describedby={field?.describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-[3px]',
        'transition-[background-color,box-shadow] duration-(--duration-fast) ease-out',
        checked ? 'bg-accent' : 'bg-surface-5 shadow-[inset_0_0_0_1px_var(--color-line)]',
        'disabled:cursor-default disabled:bg-surface-4 disabled:shadow-[inset_0_0_0_1px_var(--color-line)]',
        className,
      )}
      style={{ width: dims.w, height: dims.h }}
      {...rest}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ transform: `translateX(${checked ? travel : 0}px)` }}
        transition={transition}
        className={cn(
          'block rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-[background-color,scale] duration-(--duration-fast)',
          checked ? 'bg-primary' : 'bg-fg-muted',
          'group-active:scale-x-[1.15] group-disabled:bg-fg-faint',
          checked ? 'origin-right' : 'origin-left',
        )}
        style={{ width: dims.knob, height: dims.knob }}
      />
    </button>
  );

  if (!label) return control;
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4', disabled && 'cursor-default')}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-base font-medium', disabled ? 'text-fg-faint' : 'text-fg')}>{label}</span>
        {description && <span className="text-sm text-fg-muted">{description}</span>}
      </span>
      {control}
    </label>
  );
}
