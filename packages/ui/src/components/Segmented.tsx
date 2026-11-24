import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { cn } from '../cn';
import { spring, useMotionTransition } from '../motion';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string = string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  size?: 'sm' | 'md';
  'aria-label'?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * Segmentli seçim: birkaç seçenekten biri (tema, hareket, görünüm). Seçili segment beyaz haptır ve seçenekler
 * arasında yayla kayar. Oklar gezer ve seçer. İkiden altıya kadar kısa seçenek için; daha uzunu `Select`.
 */
export function Segmented<V extends string = string>({ options, value, onChange, size = 'md', className, ...rest }: SegmentedProps<V>) {
  const group = useId();
  const transition = useMotionTransition(spring.snappy);
  const enabled = options.filter((option) => !option.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((option) => option.value === value);
    let next: SegmentedOption<V> | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = enabled[(index - 1 + enabled.length) % enabled.length];
    if (!next) return;
    event.preventDefault();
    onChange(next.value);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };

  return (
    <LayoutGroup id={group}>
      <div
        role="radiogroup"
        aria-label={rest['aria-label']}
        data-testid={rest['data-testid']}
        onKeyDown={onKeyDown}
        className={cn('inline-flex shrink-0 rounded-full bg-surface-2 p-[3px] shadow-[inset_0_0_0_1px_var(--color-line)]', className)}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={option.disabled}
              data-value={option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap',
                'transition-colors duration-(--duration-fast) ease-out [&_svg]:size-4',
                size === 'sm' ? 'h-7 px-3 text-sm' : 'h-[34px] px-4 text-sm',
                selected ? 'text-on-primary' : 'text-fg-muted hover:text-fg',
                'disabled:cursor-default disabled:text-fg-faint',
              )}
            >
              {selected && (
                <motion.span layoutId="segment" transition={transition} aria-hidden className="absolute inset-0 rounded-full bg-primary" />
              )}
              <span className="relative inline-flex items-center gap-1.5">
                {option.icon}
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
