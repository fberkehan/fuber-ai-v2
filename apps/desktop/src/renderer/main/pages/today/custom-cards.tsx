// Yapay zekânın (ya da kullanıcının) eklediği özel kartlar: altı genel şablon. Tür adı `custom.<şablon>`.
// Şablon gibi durmasın diye her biri içeriğine göre çizilir: sayı kartı büyük rakam, ilerleme yüzde + çubuk,
// bağlantı kartının tamamı tıklanır.
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check } from '@phosphor-icons/react';
import { t, type DashboardCustomContent } from '@fuber/shared';
import { ProgressBar, cn } from '@fuber/ui';
import { attempt } from '../../shell/live';
import { fitRows } from './cards';
import { registerTodayCard, type TodayCardProps } from './registry';

type Content<T extends DashboardCustomContent['template']> = Extract<DashboardCustomContent, { template: T }>;

function TextCard({ card }: TodayCardProps<Content<'text'>>) {
  return <p className="fuber-prose text-base whitespace-pre-line text-fg select-text">{card.data.text}</p>;
}

function KeyValueCard({ card, height }: TodayCardProps<Content<'keyvalue'>>) {
  const pairs = card.data.pairs.slice(0, fitRows(height, 34));
  return (
    <dl className="flex min-h-0 flex-1 flex-col">
      {pairs.map((pair, index) => (
        <div key={index} className="flex min-h-[34px] items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
          <dt className="min-w-0 truncate text-sm text-fg-muted">{pair.label}</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium text-fg tabular-nums">{pair.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ListCard({ card, height }: TodayCardProps<Content<'list'>>) {
  const items = card.data.items.slice(0, fitRows(height, 40));
  const checklist = card.data.items.some((item) => item.done !== undefined);
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1">
      {items.map((item, index) => (
        <li key={index} className="flex min-h-9 items-start gap-2.5 py-1">
          {checklist ? (
            <span
              className={cn(
                'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-xs border',
                item.done ? 'border-transparent bg-surface-5 text-fg' : 'border-line-strong',
              )}
              aria-hidden
            >
              {item.done ? <Check className="size-3" weight="bold" /> : null}
            </span>
          ) : (
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-fg-faint" aria-hidden />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn('truncate text-base', item.done ? 'text-fg-muted line-through decoration-fg-faint' : 'text-fg')}>{item.text}</span>
            {item.detail ? <span className="truncate text-sm text-fg-muted">{item.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Rakamın boyu uzunluğuna göre: kısa değer büyük, uzun değer karta sığacak kadar. */
const figureSize = (value: string): string => (value.length <= 5 ? 'text-4xl' : value.length <= 9 ? 'text-3xl' : 'text-2xl');

function MetricCard({ card }: TodayCardProps<Content<'metric'>>) {
  const { value, unit, label, delta, trend } = card.data;
  const Trend = trend === 'down' ? ArrowDown : trend === 'up' ? ArrowUp : ArrowRight;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1" data-testid="custom-metric">
      <div className="flex items-baseline gap-2">
        <span className={cn('kokpit-figure', figureSize(value))}>{value}</span>
        {unit ? <span className="text-lg font-medium text-fg-muted">{unit}</span> : null}
      </div>
      {(label || delta) && (
        <div className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
          {delta ? (
            <span className="flex shrink-0 items-center gap-1 font-medium text-fg tabular-nums">
              {trend ? <Trend className="size-3.5" weight="bold" aria-hidden /> : null}
              {delta}
            </span>
          ) : null}
          {label ? <span className="truncate">{label}</span> : null}
        </div>
      )}
    </div>
  );
}

function ProgressCard({ card }: TodayCardProps<Content<'progress'>>) {
  const { value, label, detail } = card.data;
  const ratio = Math.min(1, Math.max(0, value));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-1" data-testid="custom-progress">
      <span className="kokpit-figure text-3xl">{t('dashboard.custom.progress', { value: Math.round(ratio * 100) })}</span>
      <div className="flex flex-col gap-2">
        <ProgressBar value={ratio} tone={ratio >= 1 ? 'success' : 'accent'} size="sm" aria-label={card.title} />
        {(label || detail) && <p className="truncate text-sm text-fg-muted">{[label, detail].filter(Boolean).join(', ')}</p>}
      </div>
    </div>
  );
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function LinkCard({ card }: TodayCardProps<Content<'link'>>) {
  const { url, label, description } = card.data;
  return (
    <button
      type="button"
      className="group -m-2 flex min-h-0 flex-1 cursor-pointer flex-col gap-1 rounded-sm p-2 text-left outline-offset-[-2px] transition-colors duration-(--duration-fast) hover:bg-surface-2"
      title={t('dashboard.custom.open')}
      onClick={() => void attempt(() => window.fuber.invoke('app.openExternal', { url }))}
      data-testid="custom-link"
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 truncate text-lg font-medium text-fg">{label || hostOf(url)}</span>
        <ArrowUpRight className="size-4 shrink-0 text-fg-faint transition-[color,transform] duration-(--duration-fast) ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-fg" aria-hidden />
      </span>
      {description ? <span className="line-clamp-2 text-sm text-fg-muted">{description}</span> : null}
      <span className="truncate font-mono text-xs text-fg-faint">{hostOf(url)}</span>
    </button>
  );
}

registerTodayCard('custom.text', TextCard);
registerTodayCard('custom.keyvalue', KeyValueCard);
registerTodayCard('custom.list', ListCard);
registerTodayCard('custom.metric', MetricCard);
registerTodayCard('custom.progress', ProgressCard);
registerTodayCard('custom.link', LinkCard);
