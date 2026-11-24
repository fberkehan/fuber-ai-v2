import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle, Info, Warning, WarningCircle, X } from '@phosphor-icons/react';
import { cn } from '../cn';
import { LayerPortal, useLayer } from '../layers/Layer';
import { enter, spring, useMotionPreset, useMotionTransition } from '../motion';
import { Button } from '../components/Button';
import { createToastStore, type ToastOptions, type ToastRecord, type ToastTone } from './store';

/** Pencere başına tek kuyruk. */
export const toastStore = createToastStore(3);

type ToastInput = Omit<ToastOptions, 'title'>;

/** `toast({ title })` ya da `toast.success('Kaydedildi')`. Kimliği döndürür; `toast.dismiss(id)` kapatır. */
export const toast = Object.assign((options: ToastOptions) => toastStore.add(options), {
  success: (title: string, options?: ToastInput) => toastStore.add({ ...options, title, tone: 'success' }),
  error: (title: string, options?: ToastInput) => toastStore.add({ ...options, title, tone: 'danger' }),
  warning: (title: string, options?: ToastInput) => toastStore.add({ ...options, title, tone: 'warning' }),
  info: (title: string, options?: ToastInput) => toastStore.add({ ...options, title, tone: 'accent' }),
  dismiss: (id: string) => toastStore.dismiss(id),
  clear: () => toastStore.clear(),
});

const icons: Record<ToastTone, ReactNode> = {
  neutral: null,
  accent: <Info weight="fill" className="text-accent-fg" />,
  success: <CheckCircle weight="fill" className="text-success" />,
  warning: <Warning weight="fill" className="text-warning" />,
  danger: <WarningCircle weight="fill" className="text-danger" />,
};

const GAP = 10;
const PEEK = 10;
const WIDTH = 360;

export interface ToasterProps {
  /** Ekran okuyucu bölge adı. */
  label?: string;
  closeLabel?: string;
  className?: string;
}

/**
 * Toast yığını (sağ alt). Pencereye bir kez konur. Öndeki kart tam görünür, arkadaki iki kart üst
 * kenarlarıyla görünür; fare ya da klavye odağı gelince yığın açılır, süreler durur. Kartlar aşağıdan
 * gelir ve aşağıdan gider; yay tabanlı, art arda gelen kartlarda yarıda kesilip yeni yerine akar.
 */
export function Toaster({ label = 'Bildirimler', closeLabel = 'Kapat', className }: ToasterProps) {
  const visible = useSyncExternalStore(toastStore.subscribe, toastStore.visible, toastStore.visible);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLOListElement | null>(null);
  const transition = useMotionTransition(spring.gentle);
  const preset = useMotionPreset(enter.toast);

  useLayer({ open: visible.length > 0, kind: 'toast', dismissOnEscape: false, dismissOnOutside: false, containerRef });

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (visible.length === 0) setExpanded(false);
  }, [visible.length]);

  const frontHeight = heights[visible[0]?.id ?? ''] ?? 64;
  const offsets: number[] = [];
  let acc = 0;
  for (const record of visible) {
    offsets.push(acc);
    acc += (heights[record.id] ?? 64) + GAP;
  }
  const stackHeight = expanded ? Math.max(0, acc - GAP) : frontHeight + PEEK * Math.max(0, visible.length - 1);

  return (
    <LayerPortal>
      <section aria-label={label} data-layer-free className="pointer-events-none fixed right-4 bottom-4" style={{ zIndex: 'var(--z-toast)' }}>
        <ol
          ref={containerRef}
          className={cn('pointer-events-auto relative', className)}
          style={{ width: WIDTH, height: visible.length ? stackHeight : 0 }}
          onPointerEnter={() => setExpanded(true)}
          onPointerLeave={() => setExpanded(false)}
          onFocus={() => setExpanded(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false);
          }}
        >
          <AnimatePresence initial={false}>
            {visible.map((record, index) => {
              const y = expanded ? -offsets[index]! : -PEEK * index;
              const scale = expanded ? 1 : 1 - index * 0.04;
              return (
                <motion.li
                  key={record.id}
                  initial={preset.initial}
                  animate={{ opacity: 1, transform: `translateY(${y}px) scale(${scale})` }}
                  exit={preset.exit}
                  transition={transition}
                  className="absolute right-0 bottom-0 w-full origin-bottom"
                  style={{ zIndex: visible.length - index }}
                >
                  <ToastCard
                    record={record}
                    front={index === 0}
                    expanded={expanded}
                    collapsedHeight={!expanded && index > 0 ? frontHeight : undefined}
                    paused={expanded || hidden}
                    closeLabel={closeLabel}
                    onHeight={(height) =>
                      setHeights((prev) => (prev[record.id] === height ? prev : { ...prev, [record.id]: height }))
                    }
                  />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      </section>
    </LayerPortal>
  );
}

interface ToastCardProps {
  record: ToastRecord;
  front: boolean;
  expanded: boolean;
  collapsedHeight?: number;
  paused: boolean;
  closeLabel: string;
  onHeight: (height: number) => void;
}

function ToastCard({ record, front, expanded, collapsedHeight, paused, closeLabel, onHeight }: ToastCardProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  const remaining = useRef(record.duration);
  const startedAt = useRef(0);

  // Yerinde güncellenince süre baştan.
  useEffect(() => {
    remaining.current = record.duration;
  }, [record.revision, record.duration]);

  useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) return;
    startedAt.current = performance.now();
    const timer = window.setTimeout(() => toastStore.dismiss(record.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (performance.now() - startedAt.current));
    };
  }, [paused, record.id, record.revision]);

  useLayoutEffect(() => {
    const element = innerRef.current;
    if (!element) return;
    onHeightRef.current(element.offsetHeight);
    const observer = new ResizeObserver(() => onHeightRef.current(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const icon = icons[record.tone];
  const showContent = front || expanded;
  return (
    <div
      role={record.tone === 'danger' ? 'alert' : 'status'}
      aria-atomic="true"
      className="overflow-hidden rounded-md bg-surface-3 shadow-float transition-[height] duration-(--duration-base) ease-out"
      style={{ height: collapsedHeight }}
    >
      <div
        ref={innerRef}
        className={cn(
          'flex items-start gap-3 py-3.5 pr-3 pl-4 transition-opacity duration-(--duration-fast) [&_svg]:size-5',
          showContent ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden={showContent ? undefined : true}
      >
        {icon && <span className="mt-px flex shrink-0">{icon}</span>}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
          <p className="text-sm font-semibold text-fg">{record.title}</p>
          {record.description && <p className="text-sm text-fg-muted">{record.description}</p>}
          {record.action && (
            <div className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  record.action?.onClick();
                  toastStore.dismiss(record.id);
                }}
              >
                {record.action.label}
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => toastStore.dismiss(record.id)}
          className="-mt-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-faint transition-colors duration-(--duration-fast) hover:bg-surface-5 hover:text-fg [&_svg]:size-3.5"
        >
          <X weight="bold" />
        </button>
      </div>
    </div>
  );
}
