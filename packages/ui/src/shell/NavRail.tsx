import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { SidebarSimple } from '@phosphor-icons/react';
import { cn } from '../cn';
import { spring, useMotionTransition } from '../motion';
import { Tooltip } from '../components/Tooltip';

/** tokens.css `--size-rail` / `--size-rail-collapsed` ile aynı (Motion sayıya yaylanır). */
const RAIL = 232;
const RAIL_COLLAPSED = 72;

export interface NavItem<V extends string = string> {
  value: V;
  label: string;
  /** Phosphor ikonu; etkin öğede `weight="fill"` NavRail tarafından verilmez, ikonu siz seçin. */
  icon: ReactNode;
  /** Etkin hâlde gösterilecek ikon (ör. dolu sürüm). */
  activeIcon?: ReactNode;
  /** Sayı rozeti (0 gizler) ya da `true`: yalnız nokta. */
  badge?: number | boolean;
  /** Sayfa kısayolu (`['Ctrl', '1']`): üstüne gelince satırın sağında, daraltılmış rayda ipucunda görünür. */
  shortcut?: string[];
  disabled?: boolean;
}

export interface NavRailProps<V extends string = string> {
  items: NavItem<V>[];
  /** Altta ayrı grup (Ayarlar). */
  footerItems?: NavItem<V>[];
  /** Menü ile alt grup arasında her zaman görünen ek bölüm (ör. Hızlı kontrol); daraltılınca da çizilir. */
  extra?: ReactNode;
  value: V;
  onChange: (value: V) => void;
  collapsed?: boolean;
  /** Verilince daralt/genişlet düğmesi çıkar. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Üst marka satırı: işaret (Core 28 px) her zaman, ad yalnız genişken görünür. */
  brand?: { mark: ReactNode; name: ReactNode };
  /** Özel üst içerik (brand yerine; ör. `FuberLogo`). Çerçevesiz pencerede de pencereyi taşır. */
  header?: ReactNode;
  /** Çerçevesiz pencerede marka satırı pencereyi taşır. */
  draggableHeader?: boolean;
  className?: string;
  'aria-label'?: string;
  collapseLabel?: string;
  expandLabel?: string;
}

/**
 * Sol gezinme rayı: ikon + ad, daraltılabilir. Etkin öğenin zemini yayla bir öğeden ötekine kayar
 * ve solunda mavi "çentik" durur. Daraltılınca adlar ipucuna geçer. Yukarı/aşağı oklar gezinir.
 */
export function NavRail<V extends string = string>({
  items,
  footerItems = [],
  extra,
  value,
  onChange,
  collapsed = false,
  onCollapsedChange,
  brand,
  header,
  draggableHeader = false,
  className,
  collapseLabel = 'Menüyü daralt',
  expandLabel = 'Menüyü genişlet',
  ...aria
}: NavRailProps<V>) {
  const groupId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // Etkin sayfa kaydırılabilir listenin dışında kalırsa (kısa pencere, çok sayfa) görünür alana getirilir: yoksa vurgu
  // satırı boş bir şerit gibi üst kenarda kalır ve sayfanın adı görünmez.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [value, collapsed]);
  // Liste sığmıyorsa altı solar: kaydırılabilir olduğu görünür (kaydırma çubuğu gizli olduğundan satırlar sessizce kesilmesin).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const mark = () => list.toggleAttribute('data-overflow', list.scrollHeight - list.clientHeight > 2 && list.scrollTop + list.clientHeight < list.scrollHeight - 2);
    mark();
    list.addEventListener('scroll', mark, { passive: true });
    const observer = new ResizeObserver(mark);
    observer.observe(list);
    return () => {
      list.removeEventListener('scroll', mark);
      observer.disconnect();
    };
  }, [items.length, collapsed]);
  const slide = useMotionTransition(spring.snappy);
  const resize = useMotionTransition(spring.smooth);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? buttons[0]
        : event.key === 'End'
          ? buttons[buttons.length - 1]
          : buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    event.preventDefault();
    next?.focus();
  };

  const renderItem = (item: NavItem<V>) => {
    const active = item.value === value;
    const badge =
      item.badge === true ? (
        <span aria-hidden className={cn('size-2 rounded-full bg-accent-fg', collapsed && 'absolute top-2 right-2')} />
      ) : typeof item.badge === 'number' && item.badge > 0 ? (
        collapsed ? (
          <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent-fg" />
        ) : (
          <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs leading-5 font-semibold text-fg tabular-nums">
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )
      ) : null;

    const button = (
      <button
        type="button"
        data-nav-item
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        disabled={item.disabled}
        onClick={() => onChange(item.value)}
        className={cn(
          'group/nav relative flex h-10 w-full [@media(max-height:1100px)]:h-9 [@media(max-height:860px)]:h-8 cursor-pointer items-center gap-3 rounded-sm px-3 text-left outline-offset-[-2px]',
          'transition-colors duration-(--duration-fast) ease-out [&_svg]:size-5 [&_svg]:shrink-0',
          active ? 'text-fg' : 'text-fg-muted hover:text-fg',
          !active && 'hover:bg-surface-2',
          'disabled:cursor-default disabled:text-fg-faint',
        )}
      >
        {active && (
          <motion.span
            layoutId="nav-active"
            transition={slide}
            aria-hidden
            className="absolute inset-0 rounded-sm bg-surface-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-fg" />
          </motion.span>
        )}
        <span className="relative flex">{active && item.activeIcon ? item.activeIcon : item.icon}</span>
        <motion.span
          className="relative flex min-w-0 flex-1 items-center justify-between gap-2"
          initial={false}
          animate={{ opacity: collapsed ? 0 : 1 }}
          transition={{ duration: collapsed ? 0.08 : 0.18, delay: collapsed ? 0 : 0.06 }}
          aria-hidden={collapsed || undefined}
        >
          <span className="truncate text-base font-medium">{item.label}</span>
          {!collapsed && badge}
          {/* Kısayol rozeti CSS ile çizilir (`appearance.css`): öğenin metnine karışmaz, yalnız üstüne gelince görünür. */}
          {!collapsed && !badge && item.shortcut && <span aria-hidden className="ui-nav-shortcut" data-shortcut={item.shortcut.join(' ')} />}
        </motion.span>
        {collapsed && badge}
      </button>
    );

    return (
      <li key={item.value}>
        {collapsed ? (
          <Tooltip content={item.label} shortcut={item.shortcut} placement="right">
            {button}
          </Tooltip>
        ) : (
          button
        )}
      </li>
    );
  };

  return (
    <motion.nav
      aria-label={aria['aria-label'] ?? 'Ana gezinme'}
      initial={false}
      animate={{ width: collapsed ? RAIL_COLLAPSED : RAIL }}
      transition={resize}
      onKeyDown={onKeyDown}
      className={cn('flex h-full shrink-0 flex-col overflow-hidden px-3 pt-3 pb-3', className)}
      data-collapsed={collapsed || undefined}
    >
      {brand && (
        <div className={cn('mb-4 flex h-12 shrink-0 items-center gap-3 overflow-hidden px-1.5', draggableHeader && 'ui-drag')}>
          <span className="flex h-7 min-w-7 shrink-0 items-center justify-center">{brand.mark}</span>
          <motion.span
            className="truncate text-lg font-semibold tracking-tight whitespace-nowrap"
            initial={false}
            animate={{ opacity: collapsed ? 0 : 1 }}
            transition={{ duration: collapsed ? 0.08 : 0.18, delay: collapsed ? 0 : 0.06 }}
            aria-hidden={collapsed || undefined}
          >
            {brand.name}
          </motion.span>
        </div>
      )}
      {!brand && header && (
        <div className={cn('mb-4 flex h-12 shrink-0 items-center overflow-hidden px-1.5', draggableHeader && 'ui-drag')}>{header}</div>
      )}
      <LayoutGroup id={groupId}>
        {/* Alçak pencerede menü kendi içinde kayar: alttaki ek bölüm ve Ayarlar her zaman görünür kalır. */}
        <ul ref={listRef} className="flex min-h-0 shrink flex-col gap-0.5 overflow-y-auto [scrollbar-width:none] data-overflow:[mask-image:linear-gradient(to_bottom,#000_calc(100%-28px),transparent)]">{items.map(renderItem)}</ul>
        <div className="min-h-2 flex-1" />
        {extra}
        {footerItems.length > 0 && <ul className="flex flex-col gap-0.5">{footerItems.map(renderItem)}</ul>}
      </LayoutGroup>
      {onCollapsedChange && (
        <div className="mt-2 border-t border-line pt-2">
          <Tooltip content={collapsed ? expandLabel : collapseLabel} placement="right">
            <button
              type="button"
              aria-label={collapsed ? expandLabel : collapseLabel}
              aria-expanded={!collapsed}
              onClick={() => onCollapsedChange(!collapsed)}
              className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-3 text-fg-faint transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-fg [&_svg]:size-5"
            >
              <SidebarSimple />
            </button>
          </Tooltip>
        </div>
      )}
    </motion.nav>
  );
}
