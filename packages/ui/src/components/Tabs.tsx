import { useId, useRef, type ComponentPropsWithRef, type KeyboardEvent, type ReactNode } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { cn } from '../cn';
import { spring, useMotionTransition } from '../motion';

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  /** Sağda sayı rozeti; 0 (ya da verilmezse) rozet çizilmez. */
  count?: number;
  disabled?: boolean;
}

/** Sekmenin sayı rozeti çizilir mi: yalnız sıfırdan büyük sayılarda. */
export function tabCountVisible(count: number | undefined): count is number {
  return typeof count === 'number' && count > 0;
}

export interface TabsProps<V extends string = string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** TabPanel ile eşleşmek için ortak kimlik; verilmezse üretilir. */
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * Sekmeler: etkin sekmenin altında kayan çizgi. Oklar sekmeler arasında gezer ve seçer (otomatik etkinleştirme),
 * Home/End uçlara gider. Gösterge yayla kayar; azaltılmış harekette yerine atlar.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  onChange,
  id,
  size = 'md',
  className,
  ...aria
}: TabsProps<V>) {
  const generated = useId();
  const base = id ?? generated;
  const listRef = useRef<HTMLDivElement | null>(null);
  const transition = useMotionTransition(spring.snappy);
  const enabled = items.filter((item) => !item.disabled);

  const focusValue = (next: V) => {
    onChange(next);
    listRef.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = enabled.findIndex((item) => item.value === value);
    let next: TabItem<V> | undefined;
    if (event.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    focusValue(next.value);
  };

  return (
    <LayoutGroup id={base}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={aria['aria-label']}
        onKeyDown={onKeyDown}
        className={cn('relative flex items-stretch gap-6 border-b border-line', className)}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${base}-tab-${item.value}`}
              aria-controls={`${base}-panel-${item.value}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              data-value={item.value}
              onClick={() => onChange(item.value)}
              className={cn(
                'relative -mb-px flex cursor-pointer items-center gap-2 font-medium whitespace-nowrap outline-offset-0',
                'transition-colors duration-(--duration-fast) ease-out [&_svg]:size-4',
                size === 'sm' ? 'h-9 text-sm' : 'h-11 text-base',
                selected ? 'text-fg' : 'text-fg-muted hover:text-fg',
                'disabled:cursor-default disabled:text-fg-faint',
              )}
            >
              {item.icon}
              {item.label}
              {/* 0 iken rozet çizilmez: boş sekmede "0" gürültüdür. */}
              {tabCountVisible(item.count) && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs leading-5 tabular-nums transition-colors duration-(--duration-fast)',
                    selected ? 'bg-surface-5 text-fg' : 'bg-surface-3 text-fg-muted',
                  )}
                >
                  {item.count}
                </span>
              )}
              {selected && (
                <motion.span
                  layoutId="tab-indicator"
                  transition={transition}
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-fg"
                />
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export interface TabPanelProps extends ComponentPropsWithRef<'div'> {
  /** Tabs'a verilen `id`. */
  tabsId: string;
  value: string;
}

/** Sekme içeriği; Tabs ile aynı `id` verilince ARIA bağları kurulur. */
export function TabPanel({ tabsId, value, className, ...rest }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={`${tabsId}-panel-${value}`}
      aria-labelledby={`${tabsId}-tab-${value}`}
      tabIndex={0}
      className={cn('outline-offset-4', className)}
      {...rest}
    />
  );
}
