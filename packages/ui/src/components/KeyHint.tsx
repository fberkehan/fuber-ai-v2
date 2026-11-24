import type { ComponentPropsWithRef } from 'react';
import { cn } from '../cn';

export interface KeyHintProps extends Omit<ComponentPropsWithRef<'kbd'>, 'children'> {
  /** Tuşlar sırayla: `['Ctrl', 'Shift', 'K']`. Kısaltmalar olduğu gibi yazılır. */
  keys: string[];
  size?: 'sm' | 'md';
  /** `inverse`: beyaz zemin üstünde (birincil düğmenin içinde). */
  tone?: 'default' | 'inverse';
}

const symbols: Record<string, string> = {
  Enter: '↵',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Shift: '⇧',
};

/** Klavye kısayolu rozeti. Tuşlar ayrı kapaklar; ekran okuyucu "Ctrl artı K" okur. */
export function KeyHint({ keys, size = 'md', tone = 'default', className, ...rest }: KeyHintProps) {
  return (
    <kbd
      aria-label={keys.join(' + ')}
      className={cn('inline-flex shrink-0 items-center gap-1 font-sans', className)}
      {...rest}
    >
      {keys.map((key, index) => (
        <span
          key={`${key}-${index}`}
          aria-hidden
          className={cn(
            'inline-flex items-center justify-center rounded-xs border font-mono font-medium',
            tone === 'inverse'
              ? 'border-on-primary/15 bg-on-primary/6 text-on-primary/75'
              : 'border-line bg-surface-4 text-fg-muted shadow-[inset_0_-1px_0_var(--color-line-strong)]',
            size === 'sm' ? 'h-5 min-w-5 px-1 text-xs' : 'h-6 min-w-6 px-1.5 text-xs',
          )}
        >
          {symbols[key] ?? key}
        </span>
      ))}
    </kbd>
  );
}
