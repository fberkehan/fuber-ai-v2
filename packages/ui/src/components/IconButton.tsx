import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../cn';
import type { Placement } from '../layers/anchor';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: ReactNode;
  /** Zorunlu: ekran okuyucu adı ve ipucu metni. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Basılı/etkin hâl (ör. mikrofon kapalı). `aria-pressed` yazar. */
  pressed?: boolean;
  loading?: boolean;
  /** İpucu: varsayılan açık, `label` gösterilir. `false` kapatır. */
  tooltip?: boolean;
  tooltipPlacement?: Placement;
  shortcut?: string[];
}

const variants: Record<IconButtonVariant, string> = {
  ghost: 'text-fg-muted hover:bg-secondary hover:text-fg aria-pressed:bg-secondary aria-pressed:text-fg',
  secondary: 'bg-secondary text-fg shadow-raise hover:bg-secondary-hover aria-pressed:bg-surface-5',
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  danger: 'bg-danger-soft text-danger hover:bg-danger/25',
};

const sizes: Record<IconButtonSize, string> = {
  sm: 'size-8 [&_svg]:size-4',
  md: 'size-10 [&_svg]:size-5',
  lg: 'size-12 [&_svg]:size-6',
};

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  pressed,
  loading = false,
  tooltip = true,
  tooltipPlacement,
  shortcut,
  className,
  type = 'button',
  disabled,
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      disabled={disabled}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full',
        'transition-[background-color,color,transform] duration-(--duration-fast) ease-out',
        'active:scale-[0.94] active:duration-(--duration-instant)',
        'disabled:cursor-default disabled:bg-transparent disabled:text-fg-faint disabled:active:scale-100',
        loading && 'pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} label={null} /> : icon}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} placement={tooltipPlacement} disabled={disabled}>
      {button}
    </Tooltip>
  );
}
