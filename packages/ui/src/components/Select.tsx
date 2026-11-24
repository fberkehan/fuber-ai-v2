import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';
import { cn } from '../cn';
import { FloatingPanel } from '../layers/FloatingPanel';
import { useField } from './Field';
import { controlFrame, type ControlSize } from './Input';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Seçenek altında ikinci satır. */
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  value: V | null;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  size?: ControlSize;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Ekran okuyucu adı (Field içinde değilse). */
  'aria-label'?: string;
  /** Denetimli açıklık (tanıtım/sınama için). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const heights: Record<ControlSize, string> = {
  sm: 'h-8 px-2.5 text-sm gap-2',
  md: 'h-10 px-3 text-base gap-2.5',
  lg: 'h-12 px-4 text-lg gap-3',
};

/**
 * Seçim kutusu (WAI-ARIA select-only combobox). Yerel `<select>` açılır listesi Windows'ta temaya
 * uymadığı için özel liste; davranış aynı: oklar, Home/End, harfle atlama, Enter/Boşluk seçer, Esc kapatır.
 */
export function Select<V extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Seçin',
  size = 'md',
  invalid,
  disabled,
  id,
  className,
  open: controlled,
  onOpenChange,
  ...aria
}: SelectProps<V>) {
  const field = useField();
  const listId = useId();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [active, setActive] = useState(selectedIndex);
  const typeahead = useRef({ text: '', at: 0 });
  const selected = options[selectedIndex];
  const isInvalid = invalid ?? field?.invalid ?? false;

  const setOpen = (next: boolean) => {
    if (controlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.focus({ preventScroll: true });
      listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, active]);

  const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
  const move = (delta: 1 | -1) => {
    const position = enabled.indexOf(active);
    const next = position === -1 ? enabled[0] : enabled[Math.min(Math.max(position + delta, 0), enabled.length - 1)];
    if (next !== undefined) setActive(next);
  };

  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const openList = () => {
    setActive(selectedIndex >= 0 ? selectedIndex : (enabled[0] ?? -1));
    setOpen(true);
  };

  const onListKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'Home':
        event.preventDefault();
        setActive(enabled[0] ?? -1);
        return;
      case 'End':
        event.preventDefault();
        setActive(enabled[enabled.length - 1] ?? -1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(active);
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = performance.now();
          const state = typeahead.current;
          state.text = now - state.at > 700 ? event.key : state.text + event.key;
          state.at = now;
          const query = state.text.toLocaleLowerCase('tr');
          const match = enabled.find((index) => options[index]?.label.toLocaleLowerCase('tr').startsWith(query));
          if (match !== undefined) setActive(match);
        }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id ?? field?.id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={isInvalid || undefined}
        aria-describedby={field?.describedBy}
        aria-label={aria['aria-label']}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openList();
          }
        }}
        className={cn(
          controlFrame,
          'flex w-full cursor-pointer items-center text-left outline-none focus-visible:outline-none',
          'focus-visible:border-accent-fg focus-visible:shadow-[0_0_0_3px_var(--color-accent-soft)]',
          'aria-expanded:border-accent-fg aria-invalid:border-danger',
          'disabled:cursor-default disabled:border-line disabled:bg-surface-1 disabled:text-fg-faint disabled:shadow-none',
          heights[size],
          className,
        )}
      >
        {selected?.icon && <span className="flex shrink-0 text-fg-muted [&_svg]:size-4.5">{selected.icon}</span>}
        <span className={cn('flex-1 truncate', !selected && 'text-fg-faint')}>{selected?.label ?? placeholder}</span>
        <CaretDown
          aria-hidden
          weight="bold"
          className={cn(
            'size-3.5 shrink-0 text-fg-faint transition-transform duration-(--duration-fast) ease-out',
            open && 'rotate-180',
          )}
        />
      </button>
      <FloatingPanel
        open={open}
        onDismiss={() => {
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        }}
        anchorRef={triggerRef}
        placement="bottom-start"
        matchAnchorWidth
        panelRef={listRef}
        id={listId}
        role="listbox"
        tabIndex={-1}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onKeyDown={onListKeyDown}
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${listId}-${index}`}
            role="option"
            data-index={index}
            aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined}
            data-active={active === index || undefined}
            onPointerMove={() => !option.disabled && active !== index && setActive(index)}
            onClick={() => commit(index)}
            className={cn(
              'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-fg',
              '[&_svg]:size-4 [&_svg]:shrink-0',
              'data-active:bg-surface-5',
              option.disabled && 'cursor-default text-fg-faint',
            )}
          >
            {option.icon && <span className="flex text-fg-muted">{option.icon}</span>}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{option.label}</span>
              {option.description && <span className="truncate text-xs text-fg-faint">{option.description}</span>}
            </span>
            <Check
              aria-hidden
              weight="bold"
              className={cn('text-accent-fg', option.value === value ? 'opacity-100' : 'opacity-0')}
            />
          </div>
        ))}
      </FloatingPanel>
    </>
  );
}
