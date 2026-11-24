import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** primary: beyaz hap (ekranda en çok bir tane) · secondary · ghost · danger. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Metnin solundaki ikon (Phosphor). Boyutu düğme belirler. */
  icon?: ReactNode;
  /** Metnin sağındaki ikon ya da KeyHint. */
  trailing?: ReactNode;
  /** Sürüyor: tıklanamaz, genişlik değişmez, metnin yerinde Spinner. */
  loading?: boolean;
  /** Kabın genişliğini doldurur. */
  block?: boolean;
}

/*
 * Devre dışı hâl saydamlıkla soldurulmaz (yazı 4.5:1'in altına düşerdi): düz dolgu + fg-faint yazı.
 * Basınca %97: arayüzün "duydum" demesi. Yalnız transform ve renk geçer; `all` yok.
 */
const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-hover disabled:bg-surface-4 disabled:text-fg-faint',
  secondary:
    'bg-secondary text-fg shadow-raise hover:bg-secondary-hover disabled:bg-surface-3 disabled:text-fg-faint disabled:shadow-none',
  ghost: 'bg-transparent text-fg-muted hover:bg-secondary hover:text-fg disabled:text-fg-faint',
  danger: 'bg-danger-soft text-danger hover:bg-danger/25 disabled:bg-surface-3 disabled:text-fg-faint',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 [&_svg]:size-4',
  md: 'h-10 px-4 text-base gap-2 [&_svg]:size-4.5',
  lg: 'h-12 px-6 text-lg gap-2.5 [&_svg]:size-5',
};

const spinnerSize: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  trailing,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={(event) => {
        // Sürerken klavyeyle de yeniden tetiklenmez; odak düğmede kalır (disabled odağı düşürürdü).
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      data-variant={variant}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-medium whitespace-nowrap select-none',
        'transition-[background-color,color,box-shadow,transform] duration-(--duration-fast) ease-out',
        'active:scale-[0.97] active:duration-(--duration-instant) disabled:cursor-default disabled:active:scale-100',
        variants[variant],
        sizes[size],
        loading && 'pointer-events-none',
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center gap-[inherit] transition-opacity duration-(--duration-fast)',
          loading && 'opacity-0',
        )}
      >
        {icon}
        {children}
        {trailing}
      </span>
      {loading && (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner size={spinnerSize[size]} label={null} />
        </span>
      )}
    </button>
  );
}
