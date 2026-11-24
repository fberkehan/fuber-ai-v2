import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { cn } from '../cn';
import { spring, useMotionTransition, useReducedMotion } from '../motion';

/** Yükümlülük noktası rengi: süresi geçmiş/yakın/normal/tamamlandı. */
export type DateMarkTone = 'danger' | 'warning' | 'accent' | 'success' | 'neutral';

export interface DateStripProps {
  /** Görünen ilk gün (yerel saatle; saat kısmı yok sayılır). */
  start: Date;
  /** Kaç gün (varsayılan 14). */
  days?: number;
  /** Seçili gün `YYYY-MM-DD`. */
  value: string;
  onChange: (isoDate: string) => void;
  /** Bugün (sınama için verilebilir). */
  today?: Date;
  /** Gün başına en çok 3 nokta gösterilir: `{ '2026-11-18': ['danger', 'accent'] }`. */
  marks?: Record<string, DateMarkTone[]>;
  locale?: string;
  className?: string;
  'aria-label'?: string;
}

const dotClass: Record<DateMarkTone, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  accent: 'bg-accent-fg',
  success: 'bg-success',
  neutral: 'bg-fg-faint',
};

/** Yerel takvim günü `YYYY-MM-DD` (UTC'ye kaymadan). */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `start`'tan başlayan `count` günlük dizi (yaz saati geçişinde kaymaz: takvim aritmetiği). */
export function dayRange(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

/**
 * Yatay gün şeridi. Bugün mavi yazılır, seçili gün beyaz hap olur (hap yayla kayar). Altında o günün
 * yükümlülük noktaları. Oklar gün değiştirir, Home/End uçlara gider; seçili gün görünür alana kaydırılır.
 */
export function DateStrip({
  start,
  days = 14,
  value,
  onChange,
  today = new Date(),
  marks,
  locale = 'tr-TR',
  className,
  ...aria
}: DateStripProps) {
  const groupId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const transition = useMotionTransition(spring.snappy);
  const reduced = useReducedMotion();
  const startKey = toIsoDate(start);
  const list = useMemo(() => dayRange(start, days), [startKey, days]);
  const todayIso = toIsoDate(today);
  const weekday = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short' }), [locale]);
  const full = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }), [locale]);
  const month = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short' }), [locale]);

  // Seçili gün görünmüyorsa YALNIZ şerit yatay kayar (scrollIntoView sayfanın dikey kaydırmasını da oynatıyordu).
  const firstScroll = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    const element = list?.querySelector<HTMLElement>(`[data-date="${value}"]`);
    // Yerleşim henüz oturmadıysa (dar kap) kaydırma: yanlış konuma kilitlenirdi.
    if (!list || !element || list.clientWidth < element.offsetWidth * 4) return;
    const left = element.offsetLeft;
    const right = left + element.offsetWidth;
    // Kenar maskeleri (16 / 40 px) altında kalan gün de görünmüyor sayılır.
    const visible = left >= list.scrollLeft + 16 && right <= list.scrollLeft + list.clientWidth - 40;
    if (!visible) {
      list.scrollTo({
        left: Math.max(0, left - (list.clientWidth - element.offsetWidth) / 2),
        behavior: reduced || firstScroll.current ? 'auto' : 'smooth',
      });
    }
    firstScroll.current = false;
  }, [value, reduced]);

  const onKeyDown = (event: KeyboardEvent) => {
    const index = list.findIndex((day) => toIsoDate(day) === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = Math.min(index + 1, list.length - 1);
    else if (event.key === 'ArrowLeft') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    const day = list[next];
    if (!day) return;
    event.preventDefault();
    const iso = toIsoDate(day);
    onChange(iso);
    listRef.current?.querySelector<HTMLElement>(`[data-date="${iso}"]`)?.focus({ preventScroll: true });
  };

  return (
    <LayoutGroup id={groupId}>
      <div
        ref={listRef}
        role="listbox"
        aria-orientation="horizontal"
        aria-label={aria['aria-label'] ?? 'Gün seçimi'}
        onKeyDown={onKeyDown}
        className={cn(
          'relative flex snap-x gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // Kenarlarda yumuşak kesik: şeridin sürdüğü okunur.
          '[mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-40px),transparent)]',
          className,
        )}
      >
        {list.map((day, index) => {
          const iso = toIsoDate(day);
          const selected = iso === value;
          const isToday = iso === todayIso;
          const dayMarks = marks?.[iso]?.slice(0, 3) ?? [];
          const firstOfMonth = day.getDate() === 1 || index === 0;
          return (
            <button
              key={iso}
              type="button"
              role="option"
              aria-selected={selected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${full.format(day)}${dayMarks.length ? `, ${dayMarks.length} kayıt` : ''}`}
              tabIndex={selected ? 0 : -1}
              data-date={iso}
              onClick={() => onChange(iso)}
              className={cn(
                'relative flex h-19 w-12 shrink-0 snap-start cursor-pointer flex-col items-center justify-center rounded-md',
                'transition-colors duration-(--duration-fast) ease-out active:scale-[0.97]',
                !selected && 'hover:bg-surface-3',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="date-pill"
                  transition={transition}
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-primary"
                />
              )}
              <span
                className={cn(
                  'relative text-xs font-medium transition-colors duration-(--duration-fast)',
                  selected ? 'text-on-primary' : isToday ? 'text-accent-fg' : 'text-fg-faint',
                )}
              >
                {firstOfMonth && !selected ? month.format(day) : weekday.format(day)}
              </span>
              <span
                className={cn(
                  'relative mt-0.5 text-xl leading-7 font-semibold tracking-tight tabular-nums transition-colors duration-(--duration-fast)',
                  selected ? 'text-on-primary' : isToday ? 'text-accent-fg' : 'text-fg',
                )}
              >
                {day.getDate()}
              </span>
              <span aria-hidden className="relative mt-1.5 flex h-1.5 items-center gap-1">
                {dayMarks.map((tone, markIndex) => (
                  <span
                    key={markIndex}
                    className={cn('size-1.5 rounded-full', selected && tone === 'neutral' ? 'bg-on-primary/50' : dotClass[tone])}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
