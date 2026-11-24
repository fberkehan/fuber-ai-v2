// Meseleler: konuşmalardan çıkan açık işler ve verilen sözler. Kapat, yeniden aç, hatırlatıcıya çevir, sil.
// Birincil kutu iş listesidir (geniş kapta kişi ve günler kendi sütununda hizalanır); bağlam sütununda işlerin kimde
// olduğu (kişiye göre süzer) ve en altta dinleme durumu durur.
import { useEffect, useState } from 'react';
import { BellRinging, CalendarBlank, ListChecks, Prohibit, Trash, User, X } from '@phosphor-icons/react';
import { addDays, formatDay, fromLocal, localDay, relativeDay, t } from '@fuber/shared';
import { Badge, Button, Checkbox, Chip, Dialog, Field, IconButton, Input, Panel, WorkspaceGrid, cn, toast } from '@fuber/ui';
import { attempt, useLive } from '../../../shell/live';
import { ConfirmDialog, ErrorPanel } from '../../../shell/parts';
import { ContextCard, ContextSection } from '../page-parts';
import type { AmbientIssue, AmbientIssueStatus, AmbientStatus } from '../../../../../main/modules/ambient/types';
import { AmbientGate, AmbientSkeleton } from './Gate';
import { AMBIENT_EVENTS, type GateState } from './data';

type Filter = 'open' | 'closed';

const setStatus = async (issue: AmbientIssue, status: AmbientIssueStatus) => {
  const done = await attempt(() => window.fuber.invoke('ambient.updateIssue', { id: issue.id, patch: { status } }));
  if (done) toast.success(t(`ambient.ui.issues.toast.${status}`));
};

function RemindDialog({ issue, onClose }: { issue: AmbientIssue | null; onClose: () => void }) {
  const [day, setDay] = useState('');
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!issue) return;
    const today = localDay();
    // Hedef gün bugün ya da ilerideyse o gün, değilse yarın; saat sabah dokuz.
    setDay(issue.dueDay && issue.dueDay >= today ? issue.dueDay : addDays(today, 1));
    setTime('09:00');
  }, [issue]);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time);
  const past = valid && fromLocal(day, time).getTime() <= Date.now();
  const save = async () => {
    if (!issue || !valid || past) return;
    setBusy(true);
    const done = await attempt(() => window.fuber.invoke('ambient.issueToReminder', { id: issue.id, dueAt: fromLocal(day, time).toISOString() }));
    setBusy(false);
    if (done) {
      toast.success(t('ambient.ui.issues.remind.done'));
      onClose();
    }
  };
  return (
    <Dialog
      open={issue !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('ambient.ui.issues.remind.title')}
      description={t('ambient.ui.issues.remind.body')}
      size="sm"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid || past} onClick={() => void save()} data-testid="ambient-remind-save">
            {t('ambient.ui.issues.remind.save')}
          </Button>
        </>
      }
    >
      {issue && (
        <div className="flex flex-col gap-5">
          <p className="rounded-sm border border-line bg-surface-1 px-4 py-3 text-sm text-fg" data-selectable>
            {issue.title}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('ambient.ui.issues.remind.day')} error={past ? t('ambient.ui.issues.remind.past') : undefined}>
              <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} data-testid="ambient-remind-day" />
            </Field>
            <Field label={t('ambient.ui.issues.remind.time')}>
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} data-testid="ambient-remind-time" />
            </Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Mesele satırı: solda onay kutusu (kapatır; kapalıysa yeniden açar), başlık, kişi, günler (hedef, açılış); sağda
 * hep görünen "Hatırlatıcıya çevir" ve üstüne gelince beliren ikincil eylemler (vazgeç, sil).
 */
function IssueRow({ issue, onRemind, onDelete }: { issue: AmbientIssue; onRemind: () => void; onDelete: () => void }) {
  const open = issue.status === 'open';
  const overdue = open && issue.dueDay !== null && issue.dueDay < localDay();
  return (
    <li data-testid="ambient-issue" data-id={issue.id} data-status={issue.status}>
      <div className="amb-issue">
        <span className="flex pt-px">
          <Checkbox
            checked={!open}
            onCheckedChange={(checked) => void setStatus(issue, checked ? 'done' : 'open')}
            aria-label={open ? t('ambient.ui.issues.done') : t('ambient.ui.issues.reopen')}
            data-testid={open ? 'ambient-issue-done' : 'ambient-issue-reopen'}
          />
        </span>
        <div className="amb-issue-main">
          <p className={cn('flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-base', open ? 'text-fg' : 'text-fg-muted')}>
            <span className={open ? undefined : 'line-through decoration-line-strong'} data-selectable data-testid="ambient-issue-title">
              {issue.title}
            </span>
            {issue.unsure && (
              <Badge size="sm" tone="warning" title={t('ambient.ui.unsureHint')}>
                {t('ambient.ui.unsure')}
              </Badge>
            )}
            {!open && (
              <Badge size="sm" tone={issue.status === 'done' ? 'success' : 'neutral'}>
                {t(`ambient.ui.issues.status.${issue.status}`)}
              </Badge>
            )}
          </p>
          <div className="amb-issue-meta">
            <span className="text-fg-muted">
              {issue.person && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <User className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{issue.person}</span>
                </span>
              )}
            </span>
            <span>
              {issue.dueDay && (
                <span className={cn('inline-flex items-center gap-1.5', overdue ? 'text-warning' : 'text-fg-muted')} title={formatDay(issue.dueDay)}>
                  <CalendarBlank className="size-3.5" aria-hidden />
                  {t(overdue ? 'ambient.ui.issues.overdue' : 'ambient.ui.issues.due', { day: relativeDay(issue.dueDay) })}
                </span>
              )}
            </span>
            <span>
              <span className="inline-flex">{t('ambient.ui.issues.first', { day: formatDay(issue.firstDay) })}</span>
            </span>
          </div>
        </div>
        <div className="amb-actions">
          <span className="amb-quiet">
            {open && <IconButton icon={<Prohibit />} label={t('ambient.ui.issues.drop')} size="sm" onClick={() => void setStatus(issue, 'dropped')} data-testid="ambient-issue-drop" />}
            <IconButton icon={<Trash />} label={t('common.delete')} size="sm" onClick={onDelete} data-testid="ambient-issue-delete" />
          </span>
          {issue.reminderId ? (
            <span className="inline-flex h-7 items-center gap-1.5 px-2 text-sm text-fg-muted" data-testid="ambient-issue-reminded">
              <BellRinging weight="fill" className="size-4" aria-hidden />
              <span className="amb-wide-only">{t('ambient.ui.issues.reminded')}</span>
            </span>
          ) : (
            open && (
              <IconButton icon={<BellRinging />} label={t('ambient.ui.issues.remind.open')} size="sm" onClick={onRemind} data-testid="ambient-issue-remind" />
            )
          )}
        </div>
      </div>
    </li>
  );
}

export function IssuesTab({ state, status }: { state: GateState; status: AmbientStatus | null }) {
  const [filter, setFilter] = useState<Filter>('open');
  // Kişi süzgeci: bağlam sütunundaki "Kimde" listesinden seçilir (`''` = kişisi belli olmayanlar).
  const [person, setPerson] = useState<string | null>(null);
  const [reminding, setReminding] = useState<AmbientIssue | null>(null);
  const [removing, setRemoving] = useState<AmbientIssue | null>(null);
  const all = useLive<AmbientIssue[]>(() => window.fuber.invoke('ambient.issues', { status: 'all' }), AMBIENT_EVENTS);

  if (all.state.status === 'loading') return <AmbientSkeleton />;
  if (all.state.status === 'error') return <ErrorPanel message={all.state.message} onRetry={all.reload} />;

  const issues = all.data ?? [];
  if (issues.length === 0) {
    return (
      <div data-testid="ambient-issues">
        <AmbientGate state={state} status={status} variant="full" empty={{ icon: <ListChecks />, title: t('ambient.ui.issues.empty.title'), body: t('ambient.ui.issues.empty.body') }} />
      </div>
    );
  }

  const today = localDay();
  const openIssues = issues.filter((issue) => issue.status === 'open');
  const openCount = openIssues.length;
  // Açık işler kimde: kişi başına sayı, çoktan aza (kişisi belli olmayanlar sonda).
  const byPerson = new Map<string, number>();
  for (const issue of openIssues) byPerson.set(issue.person ?? '', (byPerson.get(issue.person ?? '') ?? 0) + 1);
  const people = [...byPerson.entries()].sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || b[1] - a[1] || a[0].localeCompare(b[0], 'tr'));
  const activePerson = filter === 'open' && person !== null && byPerson.has(person) ? person : null;
  const shown = issues
    .filter((issue) => (filter === 'open' ? issue.status === 'open' : issue.status !== 'open'))
    .filter((issue) => activePerson === null || (issue.person ?? '') === activePerson);
  const shownOverdue = shown.filter((issue) => issue.status === 'open' && issue.dueDay !== null && issue.dueDay < today).length;
  const filters: Array<{ value: Filter; label: string; count: number }> = [
    { value: 'open', label: t('ambient.ui.issues.filter.open'), count: activePerson === null ? openCount : shown.length },
    { value: 'closed', label: t('ambient.ui.issues.filter.closed'), count: issues.length - openCount },
  ];
  return (
    <div data-testid="ambient-issues">
      <WorkspaceGrid
        asideWidth={348}
        aside={
          <ContextCard>
            {people.length > 0 && (
              <ContextSection title={t('ambient.ui.issues.people')} data-testid="ambient-issues-people">
                <ul className="flex flex-col">
                  {people.map(([name, count]) => (
                    <li key={name || '-'}>
                      <button
                        type="button"
                        className="ctx-link"
                        aria-current={activePerson === name || undefined}
                        onClick={() => {
                          setFilter('open');
                          setPerson(activePerson === name ? null : name);
                        }}
                        data-testid="ambient-issues-person"
                      >
                        <span className={cn('min-w-0 flex-1 truncate text-sm', name ? 'text-fg' : 'text-fg-muted')}>{name || t('ambient.ui.issues.people.none')}</span>
                        <span className="shrink-0 text-xs text-fg-faint tabular-nums">{count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ContextSection>
            )}
            <AmbientGate state={state} status={status} variant="strip" />
          </ContextCard>
        }
      >
        <Panel tone="lead" padding="none">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('ambient.ui.issues.filter.label')}>
              {filters.map((option) => (
                <Chip key={option.value} selected={filter === option.value} onClick={() => setFilter(option.value)} data-testid={`ambient-issues-filter-${option.value}`}>
                  {option.label}
                  <span className={cn('tabular-nums', filter === option.value ? 'opacity-70' : 'text-fg-faint')}>{option.count}</span>
                </Chip>
              ))}
            </div>
            {activePerson !== null && (
              <Chip selected onClick={() => setPerson(null)} aria-label={t('ambient.ui.issues.people.clearFor', { person: activePerson || t('ambient.ui.issues.people.none') })} data-testid="ambient-issues-person-clear">
                {activePerson || t('ambient.ui.issues.people.none')}
                <X className="size-3.5" aria-hidden />
              </Chip>
            )}
            {/* Yalnız söylenecek bir şey varsa: (süzülmüş listede) hedef günü geçen açık işler. */}
            {filter === 'open' && shownOverdue > 0 && <p className="text-sm text-warning">{t('ambient.ui.issues.overdueCount', { count: shownOverdue })}</p>}
          </div>
          <div className="p-2">
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-base text-fg-muted">{t(filter === 'open' ? 'ambient.ui.issues.noneOpen' : 'ambient.ui.issues.noneClosed')}</p>
            ) : (
              <ul className="flex flex-col" data-testid="ambient-issue-list">
                {shown.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} onRemind={() => setReminding(issue)} onDelete={() => setRemoving(issue)} />
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </WorkspaceGrid>

      <RemindDialog issue={reminding} onClose={() => setReminding(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('ambient.ui.issues.deleteTitle')}
        body={t('ambient.ui.issues.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (!removing) return;
          const done = await attempt(() => window.fuber.invoke('ambient.deleteIssue', { id: removing.id }));
          if (done) toast.success(t('ambient.ui.issues.deleted'));
        }}
      >
        {removing && (
          <p className="rounded-sm border border-line bg-surface-1 px-4 py-3 text-sm text-fg" data-selectable>
            {removing.title}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
