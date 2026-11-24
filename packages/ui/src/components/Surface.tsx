import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';

export interface SurfaceProps extends ComponentPropsWithRef<'div'> {
  /** Yüzey katmanı: 1 kart (#0f0f0f), 3 en açık (#1a1a1a). Sahne ve pano üstünde 1. */
  level?: 1 | 2 | 3;
  radius?: 'sm' | 'md' | 'lg';
  /** İnce çizgi çerçeve. */
  bordered?: boolean;
}

const levels = { 1: 'bg-surface-1', 2: 'bg-surface-2', 3: 'bg-surface-3' } as const;
const radii = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg' } as const;

/**
 * Düz yüzey: zemin katmanı + kıl payı çizgi. Birinci katman karttır ve görünümün ışığını alır (`ui-card`:
 * arkadan, yıldızlı sahnenin ışığı). Gölge yalnız yüzenlerde.
 */
export function Surface({ level = 1, radius = 'md', bordered = true, className, ...rest }: SurfaceProps) {
  return (
    <div
      className={cn(levels[level], radii[radius], bordered && 'border border-line', level === 1 && bordered && 'ui-card', className)}
      {...rest}
    />
  );
}

export interface CardProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  /** Başlığın sağı: IconButton, Menu, Badge. */
  action?: ReactNode;
  /** Başlığın solunda ikon. */
  icon?: ReactNode;
  /** Alt şerit (düğmeler); üstünde çizgi. */
  footer?: ReactNode;
  level?: 1 | 2 | 3;
  /** Tıklanabilir kart: üstüne gelince bir kat açılır, basınca hafif çöker. `onClick` ile birlikte verilir. */
  interactive?: boolean;
  /** İç boşluk: `md` 20 px (varsayılan), `sm` 16 px, `none`. */
  padding?: 'none' | 'sm' | 'md';
  /** Dikkat isteyen kart (bekleyen onay): kehribar kıl payı çerçeve ve üstten hafif ışık. */
  attention?: boolean;
}

const pads = { none: '', sm: 'p-4', md: 'p-5' } as const;

/** Kart: Surface + isteğe bağlı başlık/eylem/alt şerit. Kartlar iç içe konmaz; bölmek için Section ya da List. */
export function Card({
  title,
  description,
  action,
  icon,
  footer,
  level = 1,
  interactive,
  padding = 'md',
  attention,
  className,
  children,
  ...rest
}: CardProps) {
  const hasHeader = title || description || action || icon;
  return (
    <Surface
      level={level}
      radius="md"
      data-attention={attention ? '' : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive && rest.onClick ? 'button' : undefined}
      onKeyDown={
        interactive && rest.onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
              }
            }
          : undefined
      }
      className={cn(
        'flex flex-col',
        interactive &&
          'cursor-pointer transition-[background-color,border-color,transform] duration-(--duration-fast) ease-out hover:border-line-strong hover:bg-surface-2 active:scale-[0.99]',
        className,
      )}
      {...rest}
    >
      {hasHeader && (
        <div className={cn('flex items-start gap-3', pads[padding], children || footer ? 'pb-0' : '')}>
          {icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-4 text-fg-muted [&_svg]:size-4.5">
              {icon}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {title && <h3 className="text-lg text-fg">{title}</h3>}
            {description && <p className="text-sm text-fg-muted">{description}</p>}
          </div>
          {action && <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1">{action}</div>}
        </div>
      )}
      {children && <div className={cn(pads[padding], hasHeader && padding !== 'none' && 'pt-4', 'flex-1')}>{children}</div>}
      {footer && (
        <div className={cn('flex items-center justify-end gap-2 border-t border-line', padding === 'none' ? 'p-4' : 'px-5 py-3')}>
          {footer}
        </div>
      )}
    </Surface>
  );
}
