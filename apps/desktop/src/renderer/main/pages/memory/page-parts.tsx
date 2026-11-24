// Sohbet, Hafıza ve Planlar sayfalarının ortak yerel parçaları: bağlam sütununun yüzeyi ve bölümleri, tanım satırı,
// katlanır grup, kap genişliği, kayan rakam.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CaretDown } from '@phosphor-icons/react';
import { Panel, cn, easings, useReducedMotion } from '@fuber/ui';
import './context.css';

/**
 * Kabın (sayfanın `Workspace` kökü) genişliği `min` pikselin üstünde mi. Yerleşim CSS kap sorgusuyla çözülür; bu kanca
 * yalnız DAVRANIŞ kap genişliğine bağlıyken kullanılır (geniş kapta ayrıntı bağlam sütununda, dar kapta diyalogda açılır).
 */
export function useContainerWide(ref: RefObject<HTMLElement | null>, min: number): boolean {
  const [wide, setWide] = useState(true);
  const observed = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  // Öğe veri gelince sonradan bağlanabilir: her çizimden sonra bakılır, değiştiyse gözlem yeniden kurulur.
  useEffect(() => {
    const element = ref.current;
    if (element === observed.current) return;
    observer.current?.disconnect();
    observer.current = null;
    observed.current = element;
    if (!element) return;
    const measure = () => setWide(element.getBoundingClientRect().width >= min);
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(element);
  });
  useEffect(() => () => observer.current?.disconnect(), []);
  return wide;
}

/** Tanım satırı: sabit ad sütunu, değer hemen yanında (`context.css` › `.ctx-fact`). */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="ctx-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Bağlam sütununun tek yüzeyi: bölümler (`ContextSection`) kıl payı çizgiyle ayrılır ve aynı iç kenarda durur.
 * İç içe kutu değildir: yüzey tek `Panel`dir, bölümler çerçevesizdir.
 */
export function ContextCard({ children, ...rest }: { children: ReactNode; 'data-testid'?: string }) {
  return (
    <Panel tone="base" padding="none" {...rest}>
      {children}
    </Panel>
  );
}

export function ContextSection({
  title,
  count,
  action,
  children,
  ...rest
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <section className="ctx-section" {...rest}>
      <div className="ctx-head">
        <h2 className="ctx-title">
          {title}
          {count !== undefined && <span>{count}</span>}
        </h2>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Katlanır ikincil grup: başlık düğmesi + tek satır açıklama; içerik açılınca çizilir (geçersiz kılınanlar, ham döküm). */
export function Disclosure({
  title,
  count,
  hint,
  open,
  onToggle,
  children,
  toggleTestId,
  className,
  ...rest
}: {
  title: ReactNode;
  /** Başlığın yanında soluk sayı (sayfadaki öteki sayılarla aynı biçim). */
  count?: number;
  hint?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  toggleTestId?: string;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-1', className)} {...rest}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-ml-1 flex cursor-pointer items-baseline gap-2 self-start rounded-xs py-1 pr-2 pl-1 text-sm font-semibold text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg"
        data-testid={toggleTestId}
      >
        <CaretDown className={cn('size-3.5 translate-y-0.5 transition-transform duration-(--duration-fast) ease-out', !open && '-rotate-90')} aria-hidden />
        {title}
        {count !== undefined && <span className="text-xs font-medium text-fg-faint tabular-nums">{count}</span>}
      </button>
      {hint && <p className="max-w-[72ch] text-sm text-fg-faint">{hint}</p>}
      {open && children}
    </section>
  );
}

function Digit({ char, direction }: { char: string; direction: 1 | -1 }) {
  return (
    <span className="relative inline-block h-[1.25em] overflow-hidden align-bottom leading-[1.25]">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.span
          key={char}
          custom={direction}
          variants={{
            enter: (dir: 1 | -1) => ({ opacity: 0, transform: `translateY(${dir * 100}%)` }),
            center: { opacity: 1, transform: 'translateY(0%)' },
            exit: (dir: 1 | -1) => ({ opacity: 0, transform: `translateY(${dir * -100}%)` }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.18, ease: easings.out }}
          className="inline-block"
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Sayı değişirken her rakam dikeyde kayar (artarken yukarı, azalırken aşağı). Azaltılmış harekette anında değişir. */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const previous = useRef(value);
  const direction: 1 | -1 = value >= previous.current ? 1 : -1;
  previous.current = value;
  const text = String(value);
  if (reduced) return <span className={cn('tabular-nums', className)}>{text}</span>;
  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {[...text].map((char, index) => (
          <Digit key={text.length - index} char={char} direction={direction} />
        ))}
      </span>
    </span>
  );
}
