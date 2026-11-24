import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '../cn';
import type { Placement } from '../layers/anchor';
import { FloatingPanel } from '../layers/FloatingPanel';
import { KeyHint } from './KeyHint';

export interface MenuAction {
  type?: 'item';
  id: string;
  label: ReactNode;
  /** Typeahead için düz metin (label düğüm ise). */
  textValue?: string;
  icon?: ReactNode;
  shortcut?: string[];
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}
export interface MenuSeparator {
  type: 'separator';
  id: string;
}
export interface MenuLabel {
  type: 'label';
  id: string;
  label: ReactNode;
}
export type MenuItem = MenuAction | MenuSeparator | MenuLabel;

export interface MenuProps {
  /** Tek öğe (Button / IconButton). Ref ve olay özelliklerini kabul etmeli. */
  trigger: ReactElement<Record<string, unknown>>;
  items: MenuItem[];
  placement?: Placement;
  /** Denetimli açıklık; verilmezse kendi yönetir. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Ekran okuyucu adı (tetikleyicinin metni yeterli değilse). */
  label?: string;
}

const isAction = (item: MenuItem): item is MenuAction => item.type === undefined || item.type === 'item';

function setRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') (ref as { current: T }).current = value;
}

/**
 * Açılır menü (WAI-ARIA menu düğmesi kalıbı): oklar, Home/End, harfle atlama, Enter/Boşluk seçer,
 * Esc kapatır ve odağı tetikleyiciye döndürür, Tab kapatır. Klavyeyle açılınca ilk öğe odaklanır.
 */
export function Menu({ trigger, items, placement = 'bottom-start', open: controlled, onOpenChange, className, label }: MenuProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const menuId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(-1);
  const typeahead = useRef({ text: '', at: 0 });

  const actions = items.filter(isAction);
  const enabledIndexes = actions.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);

  const setOpen = (next: boolean, focusTrigger = false) => {
    if (controlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
    if (!next && focusTrigger) triggerRef.current?.focus({ preventScroll: true });
  };

  const openWith = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  // Etkin öğe değişince odak ona taşınır (roving focus).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector<HTMLElement>(`[data-index="${active}"]`);
      (target ?? panel).focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, active]);

  const move = (delta: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(active);
    const next =
      position === -1
        ? delta === 1
          ? enabledIndexes[0]
          : enabledIndexes[enabledIndexes.length - 1]
        : enabledIndexes[(position + delta + enabledIndexes.length) % enabledIndexes.length];
    setActive(next ?? -1);
  };

  const select = (item: MenuAction) => {
    if (item.disabled) return;
    setOpen(false, true);
    item.onSelect?.();
  };

  const onPanelKeyDown = (event: KeyboardEvent) => {
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
        setActive(enabledIndexes[0] ?? -1);
        return;
      case 'End':
        event.preventDefault();
        setActive(enabledIndexes[enabledIndexes.length - 1] ?? -1);
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = actions[active];
        if (item) select(item);
        return;
      }
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
          const match = enabledIndexes.find((index) => {
            const item = actions[index];
            const text = item?.textValue ?? (typeof item?.label === 'string' ? item.label : '');
            return text.toLocaleLowerCase('tr').startsWith(query);
          });
          if (match !== undefined) setActive(match);
        }
    }
  };

  if (!isValidElement(trigger)) return null;
  const triggerProps = trigger.props as Record<string, unknown> & { ref?: Ref<HTMLElement> };
  const triggerElement = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      setRef(triggerProps.ref, node);
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: (event: unknown) => {
      if (typeof triggerProps.onClick === 'function') triggerProps.onClick(event);
      if (open) setOpen(false);
      else openWith(-1);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (typeof triggerProps.onKeyDown === 'function') triggerProps.onKeyDown(event);
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openWith(enabledIndexes[0] ?? -1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        openWith(enabledIndexes[enabledIndexes.length - 1] ?? -1);
      }
    },
  });

  let actionIndex = -1;
  return (
    <>
      {triggerElement}
      <FloatingPanel
        open={open}
        onDismiss={() => setOpen(false, true)}
        anchorRef={triggerRef}
        placement={placement}
        panelRef={panelRef}
        id={menuId}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={cn('min-w-52', className)}
      >
        {items.map((item) => {
          if (item.type === 'separator') return <div key={item.id} role="separator" className="mx-2 my-1.5 h-px bg-line" />;
          if (item.type === 'label')
            return (
              <div key={item.id} role="presentation" className="px-2.5 pt-2 pb-1 text-xs font-medium text-fg-faint">
                {item.label}
              </div>
            );
          actionIndex += 1;
          const index = actionIndex;
          return (
            <div
              key={item.id}
              role="menuitem"
              tabIndex={-1}
              data-index={index}
              aria-disabled={item.disabled || undefined}
              data-active={active === index || undefined}
              onPointerMove={() => !item.disabled && active !== index && setActive(index)}
              onClick={() => select(item)}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm font-medium text-fg outline-none',
                '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted',
                'data-active:bg-surface-5',
                item.danger && 'text-danger [&_svg]:text-danger',
                item.disabled && 'cursor-default text-fg-faint [&_svg]:text-fg-faint',
              )}
            >
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && <KeyHint keys={item.shortcut} size="sm" className="ml-4" />}
            </div>
          );
        })}
      </FloatingPanel>
    </>
  );
}
