import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';

export interface PageHeaderProps extends Omit<ComponentPropsWithRef<'header'>, 'title'> {
  title: ReactNode;
  /** Başlığın altında bir cümle; sayfanın ne işe yaradığını değil, şu anki durumu söyler. */
  description?: ReactNode;
  /** Başlığın solunda: Core (40 px) ya da ikon. */
  leading?: ReactNode;
  /** Sağda düğmeler. Birincil eylem en sağda. */
  actions?: ReactNode;
  /** Başlığın altında tam genişlik (Tabs, DateStrip). */
  children?: ReactNode;
}

/** Sayfa başı: büyük başlık (640, -0.04em) + durum cümlesi + eylemler. Sayfa içeriğiyle aynı yatay boşlukta. */
export function PageHeader({ title, description, leading, actions, children, className, ...rest }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-6 px-10 pt-9 pb-2', className)} {...rest}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
        {leading && <div className="flex shrink-0 self-center">{leading}</div>}
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
          <h1 className="text-3xl text-fg">{title}</h1>
          {description && <p className="text-base text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
