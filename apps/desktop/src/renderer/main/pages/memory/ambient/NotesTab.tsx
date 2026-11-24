// Notlar: ortam dökümünden çıkan kısa notlar, gün gün. Birincil kutu seçili gündür (başlığında önceki/sonraki gün):
// notlar ve (geniş kapta yanında, dar kapta altında) ham döküm. Bağlam sütunu tek yüzeydir: günler, hafızaya öneriler,
// en altta dinleme durumu. Her notun kaynağı (dayandığı döküm satırları) açılabilir.
import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Notepad, Quotes, Trash, User } from '@phosphor-icons/react';
import { formatDayLong, t, type LocalDay } from '@fuber/shared';
import { Badge, Button, IconButton, Panel, WorkspaceGrid, toast } from '@fuber/ui';
import { attempt, useLive } from '../../../shell/live';
import { ConfirmDialog, ErrorPanel, SkeletonRows } from '../../../shell/parts';
import type { AmbientDay, AmbientNote, AmbientSegment, AmbientStatus, AmbientSuggestion } from '../../../../../main/modules/ambient/types';
import { ContextCard, ContextSection, Disclosure, useContainerWide } from '../page-parts';
import { AmbientGate, AmbientSkeleton } from './Gate';
import { AMBIENT_EVENTS, clock, clockRange, dayLabel, type GateState } from './data';

const DAY_PREVIEW = 7;

function Suggestions({ items }: { items: AmbientSuggestion[] }) {
  const resolve = async (id: string, accept: boolean) => {
    const done = await attempt(() => window.fuber.invoke('ambient.resolveSuggestion', { id, accept }));
    if (done) toast.success(accept ? t('ambient.ui.suggest.added') : t('ambient.ui.suggest.dismissed'));
  };
  return (
    <ContextSection title={t('ambient.ui.suggest.title')} count={items.length} data-testid="ambient-suggestions">
      <p className="text-sm text-balance text-fg-muted">{t('ambient.ui.suggest.body')}</p>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2" data-testid="ambient-suggestion" data-id={item.id}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-fg" data-selectable>
                {item.text}
              </span>
              <span className="text-xs text-fg-faint">{[item.subject, dayLabel(item.day)].filter(Boolean).join(', ')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => void resolve(item.id, true)} data-testid="ambient-suggestion-accept">
                {t('ambient.ui.suggest.accept')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void resolve(item.id, false)} data-testid="ambient-suggestion-dismiss">
                {t('ambient.ui.suggest.dismiss')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </ContextSection>
  );
}

/** Notun dayandığı döküm satırları. Döküm süresi dolup silindiyse yalnız zaman aralığı kalır. */
function Sources({ note }: { note: AmbientNote }) {
  const [lines, setLines] = useState<AmbientSegment[] | null>(null);
  useEffect(() => {
    let alive = true;
    void attempt(() => window.fuber.invoke('ambient.noteSources', { id: note.id })).then((result) => alive && setLines(result ?? []));
    return () => {
      alive = false;
    };
  }, [note.id]);
  return (
    <div className="mt-2.5 border-t border-line pt-2.5 pb-1" data-testid="ambient-note-source-list">
      <p className="text-sm font-medium text-fg-muted">{t('ambient.ui.notes.sourceTitle', { range: clockRange(note.sourceFrom, note.sourceTo) })}</p>
      {lines === null ? (
        <p className="mt-2 text-sm text-fg-faint">{t('common.loading')}</p>
      ) : lines.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">{t('ambient.ui.notes.sourceGone')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {lines.map((line) => (
            <li key={line.id} className="text-sm text-fg" data-selectable>
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Not satırı: solda saat, ortada not, künyesi (kişiler, önem, tür) geniş kapta metnin sağında, dar kapta altında.
 * Tür düz yazıdır; yalnız "Önemli" ve "Sanırım" rozettir (ayırt edilsinler). Kaynak düğmesi hep görünür.
 */
function NoteRow({ note, onDelete }: { note: AmbientNote; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-testid="ambient-note" data-id={note.id} data-unsure={note.unsure}>
      <div className="amb-row">
        <time className="w-11 pt-px text-sm text-fg-faint tabular-nums">{clock(note.at)}</time>
        <div className="flex min-w-0 flex-col">
          <div className="amb-note">
            <p className={note.important ? 'text-base font-medium text-fg' : 'text-base text-fg'} data-selectable data-testid="ambient-note-text">
              {note.text}
            </p>
            <div className="amb-note-tags">
              {note.people.map((person) => (
                <span key={person} className="inline-flex items-center gap-1">
                  <User className="size-3.5" aria-hidden />
                  {person}
                </span>
              ))}
              {note.unsure && (
                <Badge size="sm" tone="warning" title={t('ambient.ui.unsureHint')}>
                  {t('ambient.ui.unsure')}
                </Badge>
              )}
              {note.important && (
                <Badge size="sm" tone="neutral" className="bg-surface-5 text-fg">
                  {t('ambient.ui.notes.important')}
                </Badge>
              )}
              <span className="amb-note-kind">{t(`ambient.ui.notes.kind.${note.kind}`)}</span>
            </div>
          </div>
          {open && <Sources note={note} />}
        </div>
        <div className="amb-actions">
          <span className="amb-quiet">
            <IconButton icon={<Trash />} label={t('common.delete')} size="sm" onClick={onDelete} data-testid="ambient-note-delete" />
          </span>
          <IconButton icon={<Quotes />} label={open ? t('ambient.ui.notes.hideSource') : t('ambient.ui.notes.showSource')} size="sm" pressed={open} onClick={() => setOpen((value) => !value)} data-testid="ambient-note-sources" />
        </div>
      </div>
    </li>
  );
}

/** Günün ham dökümü: yazıya çevrilmiş söz satırları. Süresi dolunca kendiliğinden silinir; satır satır da silinebilir. */
function Transcript({ day }: { day: LocalDay }) {
  const lines = useLive<AmbientSegment[]>(() => window.fuber.invoke('ambient.transcript', { day }), AMBIENT_EVENTS, [day]);
  if (lines.state.status === 'loading') return <SkeletonRows count={3} />;
  if (lines.state.status === 'error') return <ErrorPanel message={lines.state.message} onRetry={lines.reload} />;
  const list = lines.data ?? [];
  if (list.length === 0) return <p className="py-2 text-sm text-fg-muted">{t('ambient.ui.transcript.empty')}</p>;
  return (
    <ul className="-mx-3 mt-2 flex flex-col" data-testid="ambient-transcript">
      {list.map((line) => (
        <li key={line.id} className="amb-row py-1.5" data-testid="ambient-segment" data-id={line.id}>
          <time className="w-11 pt-px text-sm text-fg-faint tabular-nums">{clock(line.startedAt)}</time>
          <span className="min-w-0 text-sm text-fg-muted" data-selectable>
            {line.text}
            {!line.noted && <span className="ml-2 text-xs text-fg-faint">{t('ambient.ui.transcript.pending')}</span>}
          </span>
          <div className="amb-actions amb-quiet">
            <IconButton
              icon={<Trash />}
              label={t('common.delete')}
              size="sm"
              onClick={() => void attempt(() => window.fuber.invoke('ambient.deleteSegment', { id: line.id })).then((done) => done && toast.success(t('ambient.ui.transcript.deleted')))}
              data-testid="ambient-segment-delete"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NotesTab({ state, status }: { state: GateState; status: AmbientStatus | null }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Sekmenin kabı sayfa kabından yan boşluk kadar dardır: 1416 px ≈ 1480 px'lik kap (ham döküm notların yanında).
  const split = useContainerWide(rootRef, 1416);
  const [daysOpen, setDaysOpen] = useState(false);
  const days = useLive<AmbientDay[]>(() => window.fuber.invoke('ambient.days', { limit: 60 }), AMBIENT_EVENTS);
  const suggestions = useLive<AmbientSuggestion[]>(() => window.fuber.invoke('ambient.suggestions'), AMBIENT_EVENTS);
  const [picked, setPicked] = useState<LocalDay | null>(null);
  const [removing, setRemoving] = useState<AmbientNote | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState<boolean | null>(null);
  const [taking, setTaking] = useState(false);

  const list = days.data ?? [];
  const day = list.find((entry) => entry.day === picked) ?? list[0] ?? null;
  const notes = useLive<AmbientNote[]>(async () => (day ? window.fuber.invoke('ambient.notes', { day: day.day }) : []), AMBIENT_EVENTS, [day?.day]);
  const pending = suggestions.data ?? [];

  const takeNotes = async () => {
    setTaking(true);
    const result = await attempt(() => window.fuber.invoke('ambient.takeNotes'));
    setTaking(false);
    if (!result) return;
    if (result.notes + result.issues === 0) toast.info(t('ambient.ui.notes.takenNone'));
    else toast.success(t('ambient.ui.notes.taken', { notes: result.notes, issues: result.issues }));
  };

  if (days.state.status === 'loading') return <AmbientSkeleton />;
  if (days.state.status === 'error') return <ErrorPanel message={days.state.message} onRetry={days.reload} />;

  if (!day) {
    return (
      <div className="flex flex-col gap-5" data-testid="ambient-notes">
        <AmbientGate state={state} status={status} variant="full" empty={{ icon: <Notepad />, title: t('ambient.ui.notes.empty.title'), body: t('ambient.ui.notes.empty.body') }} />
        {pending.length > 0 && (
          <div className="max-w-[560px]">
            <ContextCard>
              <Suggestions items={pending} />
            </ContextCard>
          </div>
        )}
      </div>
    );
  }

  const items = notes.data ?? [];
  // Günler yeniden eskiye sıralı gelir: "önceki gün" listede bir sonraki öğedir.
  const index = list.findIndex((entry) => entry.day === day.day);
  const older = list[index + 1] ?? null;
  const newer = index > 0 ? (list[index - 1] ?? null) : null;
  // Geniş kapta ham döküm notların yanında açık durur; dar kapta kutunun altında katlıdır.
  const showTranscript = transcriptOpen ?? split;
  return (
    <div ref={rootRef} data-testid="ambient-notes">
      <WorkspaceGrid
        asideWidth={348}
        aside={
          <ContextCard>
            {/* Gün gezinmesi sütunun başındadır; kalabalıksa ilk yedi gün görünür. */}
            <ContextSection
              title={t('ambient.ui.notes.days')}
              count={list.length}
              action={
                list.length > DAY_PREVIEW ? (
                  <Button size="sm" variant="ghost" aria-expanded={daysOpen} onClick={() => setDaysOpen((value) => !value)}>
                    {daysOpen ? t('ambient.ui.notes.daysLess') : t('ambient.ui.notes.daysAll')}
                  </Button>
                ) : undefined
              }
            >
              <ul className="flex flex-col" role="group" aria-label={t('ambient.ui.notes.dayLabel')}>
                {list.slice(0, daysOpen ? 60 : DAY_PREVIEW).map((entry) => (
                  <li key={entry.day}>
                    <button type="button" className="ctx-link" aria-current={entry.day === day.day} onClick={() => setPicked(entry.day)} data-testid="ambient-day" data-day={entry.day}>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{dayLabel(entry.day)}</span>
                      <span className="shrink-0 text-xs text-fg-faint tabular-nums">{t('ambient.ui.notes.dayCount', { count: entry.notes })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </ContextSection>
            {pending.length > 0 && <Suggestions items={pending} />}
            <AmbientGate state={state} status={status} variant="strip" />
          </ContextCard>
        }
      >
        <Panel tone="lead" padding="none">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3.5">
            {/* Gün değiştirme kutunun başlığındadır: her genişlikte, günler listesine inmeden. */}
            <div className="-ml-2 flex items-center">
              <IconButton icon={<CaretLeft />} label={t('ambient.ui.notes.olderDay')} size="sm" disabled={!older} onClick={() => older && setPicked(older.day)} data-testid="ambient-day-older" />
              <IconButton icon={<CaretRight />} label={t('ambient.ui.notes.newerDay')} size="sm" disabled={!newer} onClick={() => newer && setPicked(newer.day)} data-testid="ambient-day-newer" />
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
              <h2 className="text-lg text-fg">{formatDayLong(day.day)}</h2>
              <span className="text-sm text-fg-muted">{t('ambient.ui.notes.daySummary', { notes: day.notes, segments: day.segments })}</span>
            </div>
            <Button size="sm" loading={taking} onClick={() => void takeNotes()} data-testid="ambient-take-notes">
              {t('ambient.ui.notes.takeNow')}
            </Button>
          </div>
          <div className="amb-split">
            <div className="p-2">
              {notes.state.status === 'loading' ? (
                <SkeletonRows count={4} />
              ) : notes.state.status === 'error' ? (
                <ErrorPanel message={notes.state.message} onRetry={notes.reload} />
              ) : items.length === 0 ? (
                <p className="max-w-[64ch] px-3 py-6 text-base text-fg-muted" data-testid="ambient-notes-none">
                  {day.segments > 0 ? t('ambient.ui.notes.noneYet', { count: day.segments }) : t('ambient.ui.notes.none')}
                </p>
              ) : (
                <ul className="flex flex-col" data-testid="ambient-note-list">
                  {items.map((note) => (
                    <NoteRow key={note.id} note={note} onDelete={() => setRemoving(note)} />
                  ))}
                </ul>
              )}
            </div>
            <Disclosure
              className="px-5 py-3.5"
              title={t('ambient.ui.transcript.title')}
              count={day.segments}
              hint={showTranscript ? t('ambient.ui.transcript.body', { days: status?.limits.retentionDays ?? 7 }) : undefined}
              open={showTranscript}
              onToggle={() => setTranscriptOpen(!showTranscript)}
              data-testid="ambient-transcript-section"
              toggleTestId="ambient-transcript-toggle"
            >
              <Transcript day={day.day} />
            </Disclosure>
          </div>
        </Panel>
      </WorkspaceGrid>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('ambient.ui.notes.deleteTitle')}
        body={t('ambient.ui.notes.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (!removing) return;
          const done = await attempt(() => window.fuber.invoke('ambient.deleteNote', { id: removing.id }));
          if (done) toast.success(t('ambient.ui.notes.deleted'));
        }}
      >
        {removing && (
          <p className="rounded-sm border border-line bg-surface-1 px-4 py-3 text-sm text-fg" data-selectable>
            {removing.text}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
