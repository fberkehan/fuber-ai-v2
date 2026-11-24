import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../cn';
import { LayerPortal, useLayer } from '../layers/Layer';
import { useAnchoredPosition, type Placement } from '../layers/anchor';
import { enter, useMotionPreset } from '../motion';
import { KeyHint } from './KeyHint';

export interface TooltipProps {
  /** Kısa açıklama; tam cümle değil, eylemin adı. */
  content: ReactNode;
  /** Kısayol rozeti: `['Ctrl', 'K']`. */
  shortcut?: string[];
  placement?: Placement;
  /** İlk açılış gecikmesi (ms). Bir ipucu az önce açıktıysa sonraki gecikmesiz ve animasyonsuz açılır. */
  delay?: number;
  disabled?: boolean;
  /** Denetimli açıklık (tanıtım ve sınama için); verilmezse fare/odak yönetir. */
  open?: boolean;
  className?: string;
  /** Tek öğe; ref ve olay özelliklerini kabul etmeli (düğme, bağlantı, IconButton). */
  children: ReactElement<Record<string, unknown>>;
}

/** Araç çubuğunda ipuçları arasında gezerken her biri yeniden beklemesin. */
let warmUntil = 0;
const WARM_WINDOW = 600;

function setRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') (ref as { current: T }).current = value;
}

export function Tooltip({
  content,
  shortcut,
  placement = 'top',
  delay = 450,
  disabled,
  open: forcedOpen,
  className,
  children,
}: TooltipProps) {
  const id = useId();
  const [hoverOpen, setOpen] = useState(false);
  const open = forcedOpen ?? hoverOpen;
  const [instant, setInstant] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const preset = useMotionPreset(enter.pop);

  const show = () => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    if (performance.now() < warmUntil) {
      setInstant(true);
      setOpen(true);
      return;
    }
    setInstant(false);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen((was) => {
      if (was) warmUntil = performance.now() + WARM_WINDOW;
      return false;
    });
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const { zIndex } = useLayer({
    open,
    kind: 'tooltip',
    dismissOnOutside: false,
    onDismiss: hide,
    containerRef: floatingRef,
  });
  const position = useAnchoredPosition(anchorRef, floatingRef, open, placement, 6);

  if (!isValidElement(children)) return children;
  const childProps = children.props as Record<string, unknown> & { ref?: Ref<HTMLElement> };
  const call = (name: string, event: unknown) => {
    const handler = childProps[name];
    if (typeof handler === 'function') handler(event);
  };

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      setRef(childProps.ref, node);
    },
    'aria-describedby': open ? id : (childProps['aria-describedby'] as string | undefined),
    onPointerEnter: (event: PointerEvent) => {
      call('onPointerEnter', event);
      if (event.pointerType === 'mouse') show();
    },
    onPointerLeave: (event: PointerEvent) => {
      call('onPointerLeave', event);
      hide();
    },
    onPointerDown: (event: PointerEvent) => {
      call('onPointerDown', event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      call('onFocus', event);
      if (event.currentTarget.matches(':focus-visible')) show();
    },
    onBlur: (event: FocusEvent) => {
      call('onBlur', event);
      hide();
    },
  });

  return (
    <>
      {trigger}
      <LayerPortal>
        <AnimatePresence>
          {open && (
            <motion.div
              ref={floatingRef}
              id={id}
              role="tooltip"
              data-layer-free
              {...preset}
              transition={instant ? { duration: 0 } : preset.transition}
              exit={instant ? undefined : { opacity: 0, transition: { duration: 0.1 } }}
              style={{
                position: 'fixed',
                left: position?.x ?? -9999,
                top: position?.y ?? -9999,
                zIndex,
                transformOrigin: position?.origin,
              }}
              className={cn(
                'pointer-events-none flex max-w-72 items-center gap-2 rounded-sm bg-surface-5 px-2.5 py-1.5 text-sm font-medium text-fg shadow-float',
                className,
              )}
            >
              <span>{content}</span>
              {shortcut && <KeyHint keys={shortcut} size="sm" />}
            </motion.div>
          )}
        </AnimatePresence>
      </LayerPortal>
    </>
  );
}
