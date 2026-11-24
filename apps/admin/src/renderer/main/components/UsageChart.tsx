/**
 * Son günlerin harcaması: sade SVG çubuk dizisi (bileşen kitinde grafik yok). Vurgu ölçülü (v1 Yönetim): geçmiş
 * günler nötr gri, yalnız bugünün çubuğu Fuber mavisi. Çubuklar aşağıdan büyür (kademeli). Değer çubuğun üstünde, gün ve token altında yazılır: okumak için
 * üstüne gelmek gerekmez. Ölçek, kabın gerçek genişliğinden (yazı bulanıklaşmasın diye viewBox gerilmez).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { t, type AdminUsageDay } from '@fuber/shared';
import { cn, spring, useMotionTransition } from '@fuber/ui';
import { formatDayMonth, formatTokens, formatUsd, formatWeekday } from '../lib/format';

const PLOT = 132;
const TOP = 26;
const BOTTOM = 46;
const HEIGHT = TOP + PLOT + BOTTOM;

export function UsageChart({ days }: { days: AdminUsageDay[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const transition = useMotionTransition(spring.smooth);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Sunucu yeniden eskiye verir; grafik soldan sağa eskiden yeniye okunur.
  const ordered = [...days].reverse();
  const max = Math.max(...ordered.map((d) => d.costUsd), 0);
  const column = ordered.length > 0 ? width / ordered.length : 0;
  const bar = Math.min(72, Math.max(14, column * 0.46));
  // Dar kapta gün altındaki token satırı birbirine değer: sütun 120 px'ten darsa yazılmaz (üstüne gelince başlıkta).
  const showTokens = column >= 120;
  const baseline = TOP + PLOT;

  return (
    <div ref={ref} className="w-full" data-testid="usage-chart">
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={t('admin.security.usage.chartLabel')} className="block overflow-visible">
          <line x1={0} x2={width} y1={baseline + 0.5} y2={baseline + 0.5} className="stroke-line-strong" strokeWidth={1} />
          {ordered.map((day, index) => {
            const today = index === ordered.length - 1;
            const h = max > 0 ? Math.max(day.costUsd > 0 ? 3 : 0, (day.costUsd / max) * PLOT) : 0;
            const cx = column * index + column / 2;
            const tokens = day.inputTokens + day.outputTokens;
            return (
              <g key={day.day}>
                <title>
                  {t('admin.security.usage.tooltip', {
                    day: formatDayMonth(day.day),
                    cost: formatUsd(day.costUsd),
                    tokens: formatTokens(tokens),
                    calls: day.calls,
                  })}
                </title>
                <motion.rect
                  x={cx - bar / 2}
                  width={bar}
                  rx={6}
                  initial={{ y: baseline, height: 0 }}
                  animate={{ y: baseline - h, height: h }}
                  transition={{ ...transition, delay: index * 0.028 }}
                  className={cn(today ? 'fill-accent-fg' : 'fill-surface-5')}
                />
                <motion.text
                  x={cx}
                  initial={{ y: baseline - 8 }}
                  animate={{ y: baseline - h - 8 }}
                  transition={{ ...transition, delay: index * 0.028 }}
                  textAnchor="middle"
                  className={cn('text-xs tabular-nums', today && day.costUsd > 0 ? 'fill-fg' : day.costUsd > 0 ? 'fill-fg-muted' : 'fill-fg-faint')}
                >
                  {day.costUsd > 0 ? formatUsd(day.costUsd) : '–'}
                </motion.text>
                <text x={cx} y={baseline + 20} textAnchor="middle" className={cn('text-sm', today ? 'fill-fg font-semibold' : 'fill-fg-muted')}>
                  {today ? t('time.today') : formatWeekday(day.day)}
                </text>
                <text x={cx} y={baseline + 38} textAnchor="middle" className="fill-fg-faint text-xs tabular-nums">
                  {showTokens && tokens > 0 ? t('admin.security.usage.tokens', { value: formatTokens(tokens) }) : ''}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
