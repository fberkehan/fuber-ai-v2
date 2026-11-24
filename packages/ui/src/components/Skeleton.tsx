import type { ComponentPropsWithRef } from 'react';
import { cn } from '../cn';

export interface SkeletonProps extends ComponentPropsWithRef<'div'> {
  /** `text`: satır yüksekliğinde; `block`: verilen boyutta; `circle`: tam yuvarlak. */
  shape?: 'text' | 'block' | 'circle';
  /** `text` için satır sayısı; son satır kısa. */
  lines?: number;
}

/**
 * Yer tutucu. Bilinçli olarak parıltısız: döngüsel animasyon yalnız Core ve Spinner'da (KURGU §12).
 * İçerik gelince yer tutucu kısa bir saydamlık geçişiyle değişsin diye `aria-busy` kabına konur.
 */
export function Skeleton({ shape = 'block', lines = 1, className, ...rest }: SkeletonProps) {
  if (shape === 'text') {
    return (
      <div aria-hidden className={cn('flex flex-col gap-2.5', className)} {...rest}>
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={cn('h-3 rounded-full bg-surface-4', index === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cn('bg-surface-4', shape === 'circle' ? 'rounded-full' : 'rounded-sm', className)}
      {...rest}
    />
  );
}
