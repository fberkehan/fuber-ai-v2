// Toplantı sayfasının ortak parçaları: döküm satırı, özet, yanıt önerisi, dil seçenekleri.
import { CheckCircle, ListChecks, Plus, Quotes, Sparkle } from '@phosphor-icons/react';
import { t, type MessageKey } from '@fuber/shared';
import { Badge, Button, cn, type SelectOption } from '@fuber/ui';
import type { Meeting, MeetingLine, MeetingSuggestion, SummaryItem } from '../../../../main/modules/meeting/types';

export const LANGUAGES = ['tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ar', 'zh', 'ja', 'ko'] as const;

export const languageName = (code: string | null | undefined): string => (code ? t(`meeting.lang.${code}` as MessageKey) : '');

export function targetOptions(): SelectOption[] {
  return [{ value: 'off', label: t('meeting.options.translateOff') }, ...LANGUAGES.map((code) => ({ value: code, label: languageName(code) }))];
}

export function theirOptions(): SelectOption[] {
  return [{ value: 'auto', label: t('meeting.options.theirAuto') }, ...LANGUAGES.map((code) => ({ value: code, label: languageName(code) }))];
}

const CLOCK = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const clock = (iso: string) => CLOCK.format(new Date(iso));
const DAY = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', hour: '2-digit', minute: '2-digit' });
export const dayTime = (iso: string) => DAY.format(new Date(iso));

export function duration(from: string, to: string | null): string {
  const total = Math.max(0, Math.floor(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const two = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${two(minutes)}:${two(total % 60)}` : `${minutes}:${two(total % 60)}`;
}

export function LineRow({ line, pending }: { line: MeetingLine; pending?: boolean }) {
  const mine = line.speaker === 'me';
  return (
    <li
      className={cn('flex gap-3 border-t border-line py-3 first:border-t-0', pending && 'opacity-60')}
      data-testid="meeting-line"
      data-speaker={line.speaker}
      data-final={pending ? 'false' : 'true'}
      data-id={line.id}
    >
      <span className="w-20 shrink-0 pt-0.5 text-xs text-fg-faint tabular-nums">{clock(line.startedAt)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn('text-xs font-medium', mine ? 'text-fg-muted' : 'text-accent-fg')}>{mine ? t('meeting.speaker.me') : t('meeting.speaker.them')}</span>
        <p className="text-base text-fg" data-selectable data-testid="meeting-line-text">
          {line.text}
        </p>
        {line.translationState === 'done' && line.translation && (
          <p className="text-sm text-fg-muted" data-selectable data-testid="meeting-line-translation">
            {line.translation}
          </p>
        )}
        {line.translationState === 'pending' && <p className="text-sm text-fg-faint">{t('meeting.translation.pending')}</p>}
        {line.translationState === 'failed' && <p className="text-sm text-fg-faint">{t('meeting.translation.failed')}</p>}
      </div>
    </li>
  );
}

export function SuggestionCard({ suggestion }: { suggestion: MeetingSuggestion }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 px-4 py-3" data-testid="meeting-suggestion" data-state={suggestion.state}>
      <span className="flex items-center gap-2 text-xs text-fg-muted">
        <Sparkle className="size-3.5 text-accent-fg" aria-hidden />
        {t('meeting.suggestion.for')}
      </span>
      <p className="text-sm text-fg-muted">“{suggestion.question}”</p>
      {suggestion.state === 'working' && <p className="text-sm text-fg-faint">{t('meeting.suggestion.working')}</p>}
      {suggestion.state === 'failed' && <p className="text-sm text-fg-faint">{t('meeting.suggestion.failed')}</p>}
      {suggestion.state === 'ready' && (
        <>
          <p className="text-base text-fg" data-selectable data-testid="meeting-suggestion-reply">
            {suggestion.reply}
          </p>
          {suggestion.translation && <p className="text-sm text-fg-muted">{suggestion.translation}</p>}
        </>
      )}
      <p className="text-xs text-fg-faint">{t('meeting.suggestion.note')}</p>
    </div>
  );
}

function ItemList({ title, items, empty, testId, onExport, lines }: { title: string; items: SummaryItem[]; empty: string; testId: string; onExport?: (index: number) => void; lines: MeetingLine[] }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="text-sm font-medium text-fg-muted">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-fg-faint">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item, index) => {
            const source = lines.find((line) => line.id === item.lineId);
            return (
              <li key={`${item.lineId}-${index}`} className="flex items-start gap-3" data-testid={`${testId}-item`}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-base text-fg" data-selectable>
                    {item.text}
                    {item.owner ? <span className="text-fg-muted"> · {item.owner}</span> : null}
                    {item.due ? <span className="text-fg-muted"> · {item.due}</span> : null}
                  </span>
                  {source && (
                    <span className="flex items-center gap-1 text-xs text-fg-faint" title={t('meeting.summary.source')}>
                      <Quotes className="size-3" aria-hidden />
                      {source.text.slice(0, 140)}
                    </span>
                  )}
                </div>
                {onExport &&
                  (item.todoId ? (
                    <Badge tone="success" icon={<CheckCircle />} data-testid="meeting-action-added">
                      {t('meeting.summary.added')}
                    </Badge>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => onExport(index)} data-testid="meeting-action-add">
                      {t('meeting.summary.addOne')}
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SummaryView({ meeting, lines, onExport, onExportAll, onRetry, busy }: { meeting: Meeting; lines: MeetingLine[]; onExport: (index: number) => void; onExportAll: () => void; onRetry: () => void; busy: boolean }) {
  const summary = meeting.summary;
  if (meeting.state === 'summarizing') return <p className="text-sm text-fg-muted" data-testid="meeting-summarizing">{t('meeting.summary.working')}</p>;
  if (!summary) {
    const problem = meeting.summaryProblem ?? 'failed';
    return (
      <div className="flex flex-col items-start gap-3" data-testid="meeting-summary-problem" data-problem={problem}>
        <p className="text-sm text-fg-muted">
          {t(`meeting.summary.problem.${problem}` as MessageKey)}
          {meeting.summaryDetail ? ` (${meeting.summaryDetail})` : ''}
        </p>
        {problem !== 'empty' && (
          <Button size="sm" onClick={onRetry} loading={busy} data-testid="meeting-summary-retry">
            {t('meeting.summary.retry')}
          </Button>
        )}
      </div>
    );
  }
  const open = summary.actions.filter((item) => !item.todoId).length;
  return (
    <div className="flex flex-col gap-5" data-testid="meeting-summary" data-engine={summary.engine}>
      <p className="text-xs text-fg-faint">
        {t(`meeting.summary.engine.${summary.engine}` as MessageKey)}
        {meeting.summaryDropped > 0 ? ` · ${t('meeting.summary.dropped', { count: meeting.summaryDropped })}` : ''}
      </p>
      <ItemList title={t('meeting.summary.points')} items={summary.points} empty={t('meeting.summary.none')} testId="meeting-points" lines={lines} />
      <ItemList title={t('meeting.summary.decisions')} items={summary.decisions} empty={t('meeting.summary.noDecisions')} testId="meeting-decisions" lines={lines} />
      <ItemList title={t('meeting.summary.actions')} items={summary.actions} empty={t('meeting.summary.noActions')} testId="meeting-actions" onExport={onExport} lines={lines} />
      {open > 0 && (
        <div>
          <Button icon={<ListChecks />} onClick={onExportAll} loading={busy} data-testid="meeting-actions-export">
            {t('meeting.summary.addAll', { count: open })}
          </Button>
        </div>
      )}
    </div>
  );
}
