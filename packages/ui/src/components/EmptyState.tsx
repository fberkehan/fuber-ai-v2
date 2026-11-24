import type { ComponentPropsWithRef, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../cn';
import { enter, useMotionPreset } from '../motion';

export interface EmptyStateProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> {
  icon?: ReactNode;
  /** Ne yok, düz cümleyle: "Henüz hatırlatıcı yok". */
  title: ReactNode;
  /** Ne yapılabilir: "Jarvis'e 'yarın onda hatırlat' de ya da elle ekle." */
  description?: ReactNode;
  /** Bir ya da iki düğme. */
  actions?: ReactNode;
  size?: 'sm' | 'md';
}

/**
 * Boş durum: bir davet. Süs çizimi yok; ikon ince çerçeveli bir yuvada, metin kısa, bir eylem.
 * Hata ekranı için de kullanılır (ikon + ne oldu + nasıl düzelir).
 */
export function EmptyState({ icon, title, description, actions, size = 'md', className, ...rest }: EmptyStateProps) {
  const preset = useMotionPreset(enter.fadeUp);
  return (
    <motion.div
      {...preset}
      className={cn(
        'flex flex-col items-center text-center',
        size === 'sm' ? 'gap-3 px-6 py-8' : 'gap-4 px-8 py-14',
        className,
      )}
      {...rest}
    >
      {icon && (
        <span
          className={cn(
            'flex items-center justify-center rounded-full bg-surface-2 text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line),0_0_0_6px_var(--color-surface-1),0_0_0_7px_var(--color-line)]',
            size === 'sm' ? 'mb-1 size-10 [&_svg]:size-5' : 'mb-2 size-14 [&_svg]:size-6',
          )}
        >
          {icon}
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className={cn('text-fg', size === 'sm' ? 'text-base' : 'text-xl')}>{title}</h3>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </motion.div>
  );
}
