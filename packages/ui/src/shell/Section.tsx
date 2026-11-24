import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';

export interface SectionProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  /** Başlık satırının sağı: "Tümü" bağlantısı, küçük düğme. */
  action?: ReactNode;
  /** Başlığın yanında sayı. */
  count?: number;
}

/** Sayfa bölümü: küçük başlık + içerik. Bölümler arası boşluk sayfa düzenindedir (`gap-10`), burada değil. */
export function Section({ title, description, action, count, className, children, ...rest }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-4', className)} {...rest}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {title && (
              <h2 className="flex items-baseline gap-2 text-lg tracking-tight text-fg">
                {title}
                {count !== undefined && <span className="text-sm font-medium tracking-normal text-fg-faint tabular-nums">{count}</span>}
              </h2>
            )}
            {description && <p className="text-sm text-fg-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
