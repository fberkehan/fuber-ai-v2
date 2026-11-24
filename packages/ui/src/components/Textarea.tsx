import type { ComponentPropsWithRef } from 'react';
import { cn } from '../cn';
import { useField } from './Field';
import { controlFrame } from './Input';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  /** En az görünen satır (varsayılan 3). */
  minRows?: number;
  /** Bu satırdan sonra büyümez, kayar (varsayılan 10). */
  maxRows?: number;
  invalid?: boolean;
}

const LINE = 22;
const PAD_Y = 10;

/**
 * Kendiliğinden büyüyen metin alanı. JS ölçümü yok: `field-sizing: content` içeriğe göre boylanır,
 * sınırları satır sayısından hesaplanan min/max yükseklik koyar. Yükseklik değişimi animasyonsuzdur:
 * yazarken her satırda kayan bir alan dikkat dağıtır.
 */
export function Textarea({ minRows = 3, maxRows = 10, invalid, className, id, style, ...rest }: TextareaProps) {
  const field = useField();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <textarea
      id={id ?? field?.id}
      aria-invalid={isInvalid || undefined}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      className={cn(
        controlFrame,
        'block w-full resize-none px-3 py-2.5 text-base outline-none [field-sizing:content] placeholder:text-fg-faint',
        'focus-visible:outline-none focus:border-accent-fg focus:shadow-[0_0_0_3px_var(--color-accent-soft)]',
        'aria-invalid:border-danger disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-1 disabled:text-fg-faint',
        className,
      )}
      style={{ minHeight: minRows * LINE + PAD_Y * 2 + 2, maxHeight: maxRows * LINE + PAD_Y * 2 + 2, ...style }}
      {...rest}
    />
  );
}
