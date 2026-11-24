// Başka modüllerin Kokpit kartları: verisi ana süreçteki doldurucudan gelir (`dashboard.registerProvider`), boşluk
// kuralını doldurucu uygular (veri yoksa kart hiç gelmez). Burada yalnız çizim var.
//
//   mail.important  e-posta modülü: `mail-card.tsx` (hesap başına okunmamış, son iletiler; hesap yoksa kart yok)
//   meeting         toplantı modülü: süren toplantı ya da son toplantının özeti; hiç toplantı yoksa kart yok
//
// Takip işleri ayrı kart DEĞİLDİR: panonun "Süren işler" kartına katılır (`cards.tsx` › JobsCard).
import { ArrowRight, Microphone } from '@phosphor-icons/react';
import { localTime, relativeTime, t } from '@fuber/shared';
import { Badge, Button, cn } from '@fuber/ui';
import type { MeetingDashboardData } from '../../../../main/modules/meeting/types';
import { useShell } from '../../shell/context';
import { fitRows, inner } from './cards';
import { registerTodayCard, type TodayCardProps } from './registry';

// ───────────── toplantı ─────────────

function minutesText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return t('dashboard.jobs.minutes', { count: minutes });
  return t('dashboard.jobs.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function MeetingCard({ card, height, now }: TodayCardProps<MeetingDashboardData>) {
  const shell = useShell();
  const data = card.data;
  const open = () => shell.navigate('meeting');
  if (data.state === 'live') {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-3" data-testid="today-meeting" data-state="live">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            {/* Kayıt işareti durağandır (halkalı nokta): süren toplantı boyunca kare üreten bir döngü yoktur. */}
            <span className="size-2.5 shrink-0 rounded-full bg-danger shadow-[0_0_0_4px_rgb(255_77_77/0.2)]" aria-hidden />
            <span className="truncate text-base font-medium text-fg" title={data.title}>
              {data.title}
            </span>
          </span>
          <span className="truncate text-sm text-fg-muted">{t('today.meeting.since', { time: localTime(data.startedAt), duration: minutesText(now.getTime() - Date.parse(data.startedAt)) })}</span>
          {inner(height) >= 120 ? <span className="truncate text-xs text-fg-faint">{t('today.meeting.liveHint')}</span> : null}
        </div>
        <Button size="sm" variant="secondary" icon={<Microphone />} trailing={<ArrowRight />} className="self-start" onClick={open} data-testid="today-meeting-open">
          {t('today.meeting.open')}
        </Button>
      </div>
    );
  }
  const points = (data.summary?.points ?? []).slice(0, Math.max(1, fitRows(height, 26, 52)));
  return (
    <button type="button" className="kokpit-row min-h-0 flex-1 flex-col items-start gap-1.5 text-left" onClick={open} data-testid="today-meeting" data-state={data.state}>
      <span className="flex max-w-full min-w-0 items-baseline gap-2">
        <span className="truncate text-base font-medium text-fg" title={data.title}>
          {data.title}
        </span>
        <span className="shrink-0 text-xs text-fg-faint">{relativeTime(data.endedAt ?? data.startedAt, now)}</span>
      </span>
      {data.state === 'summarizing' ? (
        <span className="text-sm text-fg-muted">{t('today.meeting.summarizing')}</span>
      ) : points.length > 0 ? (
        <ul className="flex max-w-full min-w-0 flex-col gap-1">
          {points.map((point, index) => (
            <li key={index} className="flex min-w-0 gap-2 text-sm text-fg-muted">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-faint" aria-hidden />
              <span className="line-clamp-1">{point}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-fg-muted">{t('today.meeting.noSummary')}</span>
      )}
      {data.summary && data.summary.decisions + data.summary.actions > 0 ? (
        <span className={cn('mt-auto flex gap-2 pt-1')}>
          <Badge tone="neutral" size="sm">
            {t('today.meeting.counts', { decisions: data.summary.decisions, actions: data.summary.actions })}
          </Badge>
        </span>
      ) : null}
    </button>
  );
}

registerTodayCard('meeting', MeetingCard, { tone: 'base' });
import './mail-card';
import './live-cards.css';
