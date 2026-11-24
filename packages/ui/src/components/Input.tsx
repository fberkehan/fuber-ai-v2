import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';
import { useField } from './Field';

export type ControlSize = 'sm' | 'md' | 'lg';

/** Input, Textarea ve Select'in ortak çerçevesi: tek yerde, üçü aynı görünsün diye. */
export const controlFrame = cn(
  'rounded-sm border border-line bg-surface-2 text-fg shadow-raise',
  'transition-[border-color,box-shadow,background-color] duration-(--duration-fast) ease-out',
  'hover:border-line-strong',
  'focus-within:border-accent-fg focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)] focus-within:hover:border-accent-fg',
  'has-[[aria-invalid=true]]:border-danger has-[[aria-invalid=true]]:focus-within:shadow-[0_0_0_3px_var(--color-danger-soft)]',
  'has-[:disabled]:border-line has-[:disabled]:bg-surface-1 has-[:disabled]:text-fg-faint has-[:disabled]:shadow-none',
);

const heights: Record<ControlSize, string> = {
  sm: 'h-8 text-sm px-2.5 gap-2 [&_svg]:size-4',
  md: 'h-10 text-base px-3 gap-2.5 [&_svg]:size-4.5',
  lg: 'h-12 text-lg px-4 gap-3 [&_svg]:size-5',
};

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  size?: ControlSize;
  /** Soldaki ikon ya da önek. */
  leading?: ReactNode;
  /** Sağdaki ek (birim, KeyHint, temizle düğmesi). */
  trailing?: ReactNode;
  invalid?: boolean;
  /** Dış çerçevenin sınıfı (`className` input'un kendisine gider). */
  frameClassName?: string;
}

export function Input({
  size = 'md',
  leading,
  trailing,
  invalid,
  className,
  frameClassName,
  id,
  ...rest
}: InputProps) {
  const field = useField();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <div className={cn('flex w-full items-center', controlFrame, heights[size], frameClassName)}>
      {leading && <span className="flex shrink-0 items-center text-fg-faint">{leading}</span>}
      <input
        id={id ?? field?.id}
        aria-invalid={isInvalid || undefined}
        aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-inherit outline-none placeholder:text-fg-faint',
          'focus-visible:outline-none disabled:cursor-not-allowed',
          className,
        )}
        {...rest}
      />
      {trailing && <span className="flex shrink-0 items-center text-fg-faint">{trailing}</span>}
    </div>
  );
}
