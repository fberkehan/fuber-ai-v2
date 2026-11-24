// Toplantı: iki kaynaklı canlı yazı ("Siz" / "Karşı taraf"), anlık çeviri, yanıt önerisi, bağlam; bitince özet ve
// yapılacaklar (tek tıkla Planlar'a); geçmiş toplantılar. Çalışma yüzeyi dilinde: canlı yazı birincil kutu, öneri ve
// bağlam yan sütunda; geçmişte liste yan sütunda, seçilen toplantı birincil kutuda.
import { useEffect, useMemo, useState } from 'react';
import { Broadcast, ClockCounterClockwise, FileArrowUp, MicrophoneStage, Record, Stop, Trash, UsersThree } from '@phosphor-icons/react';
import { t, type Id } from '@fuber/shared';
import { Badge, Button, EmptyState, Field, Input, Panel, Select, Switch, TabPanel, Tabs, Textarea, Workspace, WorkspaceGrid, WorkspaceHeader, cn, toast } from '@fuber/ui';
import { attempt, useEvent, useLive } from '../../shell/live';
import { ConfirmDialog, ErrorPanel, SkeletonRows } from '../../shell/parts';
import { ContextCard, ContextSection } from '../memory/page-parts';
import { definePage } from '../page';
import type { Meeting, MeetingContext, MeetingLine, MeetingStatus, MeetingSuggestion } from '../../../../main/modules/meeting/types';
import { ConsentDialog } from './ConsentDialog';
import { LineRow, SuggestionCard, SummaryView, dayTime, duration, targetOptions, theirOptions } from './parts';

type TabId = 'live' | 'history';
const TABS_ID = 'meeting-tabs';
const EVENTS = ['meeting.status', 'meeting.changed'] as const;

interface Detail {
  meeting: Meeting;
  lines: MeetingLine[];
  suggestions: MeetingSuggestion[];
}

/** Bir toplantının dökümü: ilk okuma + olaylarla artımlı güncelleme (uzun toplantıda her olayda bütün döküm okunmaz). */
function useMeetingDetail(id: Id | null): { detail: Detail | null; pending: MeetingLine[]; reload: () => void } {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pending, setPending] = useState<MeetingLine[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setPending([]);
    if (!id) {
      setDetail(null);
      return;
    }
    void window.fuber.invoke('meeting.get', { id }).then(
      (result) => alive && setDetail(result),
      () => alive && setDetail(null),
    );
    return () => {
      alive = false;
    };
  }, [id, tick]);
  useEvent('meeting.changed', (change) => {
    if (!id || (change.meetingId !== id && change.meetingId !== '*')) return;
    if (change.kind === 'meeting') {
      setTick((value) => value + 1);
      return;
    }
    if (change.kind === 'pending') {
      setPending((list) => [...list.filter((line) => line.id !== change.line.id), change.line]);
      return;
    }
    if (change.kind === 'line_removed') {
      setPending((list) => list.filter((line) => line.id !== change.lineId));
      setDetail((current) => (current ? { ...current, lines: current.lines.filter((line) => line.id !== change.lineId) } : current));
      return;
    }
    if (change.kind === 'line') {
      setPending((list) => list.filter((line) => line.id !== change.line.id));
      setDetail((current) => {
        if (!current) return current;
        const exists = current.lines.some((line) => line.id === change.line.id);
        const lines = exists ? current.lines.map((line) => (line.id === change.line.id ? change.line : line)) : [...current.lines, change.line].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
        return { ...current, lines };
      });
      return;
    }
    setDetail((current) => {
      if (!current) return current;
      const exists = current.suggestions.some((item) => item.id === change.suggestion.id);
      return { ...current, suggestions: exists ? current.suggestions.map((item) => (item.id === change.suggestion.id ? change.suggestion : item)) : [...current.suggestions, change.suggestion] };
    });
  });
  return { detail, pending, reload: () => setTick((value) => value + 1) };
}

function SourceBadges({ status }: { status: MeetingStatus }) {
  const system = status.sources.system;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="meeting-sources">
      <Badge tone={status.sources.mic === 'on' ? 'success' : 'warning'} dot data-testid="meeting-source-mic">
        {t(status.sources.mic === 'on' ? 'meeting.source.micOn' : 'meeting.source.micOff')}
      </Badge>
      <Badge tone={system === 'on' ? 'success' : system === 'error' ? 'danger' : 'neutral'} dot data-testid="meeting-source-system" data-state={system}>
        {t(`meeting.source.system.${system}`)}
      </Badge>
      {status.sources.systemError && <span className="text-sm text-danger">{status.sources.systemError}</span>}
      {status.sources.queued > 2 && <span className="text-sm text-fg-muted">{t('meeting.source.queued', { count: status.sources.queued })}</span>}
    </div>
  );
}

function ContextForm({ value, onChange, disabled }: { value: Pick<MeetingContext, 'topic' | 'participants' | 'notes' | 'glossary'>; onChange: (patch: Partial<MeetingContext>) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('meeting.context.topic')}>
        <Input value={value.topic} disabled={disabled} onChange={(event) => onChange({ topic: event.target.value })} data-testid="meeting-context-topic" />
      </Field>
      <Field label={t('meeting.context.participants')} hint={t('meeting.context.participantsHint')}>
        <Input value={value.participants} disabled={disabled} onChange={(event) => onChange({ participants: event.target.value })} />
      </Field>
      <Field label={t('meeting.context.glossary')} hint={t('meeting.context.glossaryHint')}>
        <Input value={value.glossary} disabled={disabled} onChange={(event) => onChange({ glossary: event.target.value })} data-testid="meeting-context-glossary" />
      </Field>
      <Field label={t('meeting.context.notes')}>
        <Textarea value={value.notes} disabled={disabled} rows={3} onChange={(event) => onChange({ notes: event.target.value })} />
      </Field>
    </div>
  );
}

function StartPanel({ status, onNeedConsent }: { status: MeetingStatus; onNeedConsent: () => void }) {
  const [context, setContext] = useState({ topic: '', participants: '', notes: '', glossary: '' });
  const [target, setTarget] = useState<string>('tr');
  const [their, setTheir] = useState('auto');
  const [suggestions, setSuggestions] = useState(true);
  const [system, setSystem] = useState(true);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (!status.consentAt) {
      onNeedConsent();
      return;
    }
    setBusy(true);
    const result = await attempt(() =>
      window.fuber.invoke('meeting.start', { context, target: target === 'off' ? null : target, theirLanguage: their, suggestions, system }),
    );
    setBusy(false);
    if (result?.active) toast.success(t('meeting.started'));
  };
  const aside = (
    <ContextCard data-testid="meeting-start-aside">
      <ContextSection title={t('meeting.start.howTitle')}>
        <p className="text-sm text-fg-muted">{t('meeting.start.body')}</p>
        <p className="text-sm text-fg-muted">{t('meeting.recordingNote')}</p>
      </ContextSection>
      <ContextSection title={t('meeting.start.consentTitle')}>
        <p className="text-sm text-fg-muted" data-testid="meeting-consent-state">
          {status.consentAt ? t('meeting.start.consentGiven') : t('meeting.start.consentMissing')}
        </p>
      </ContextSection>
    </ContextCard>
  );
  return (
    <WorkspaceGrid asideWidth={340} aside={aside}>
    <Panel tone="lead" title={t('meeting.start.title')} className="flex flex-col gap-6" data-testid="meeting-start-panel">
      {!status.available && <p className="text-sm text-warning" data-testid="meeting-unavailable">{status.unavailableReason}</p>}
      <ContextForm value={context} onChange={(patch) => setContext((current) => ({ ...current, ...patch }))} />
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('meeting.options.target')}>
          <Select value={target} onChange={setTarget} options={targetOptions()} />
        </Field>
        <Field label={t('meeting.options.their')}>
          <Select value={their} onChange={setTheir} options={theirOptions()} />
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <Switch checked={system} onCheckedChange={setSystem} label={t('meeting.options.system')} description={t('meeting.options.systemHint')} />
        <Switch checked={suggestions} onCheckedChange={setSuggestions} label={t('meeting.options.suggestions')} description={t('meeting.options.suggestionsHint')} />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={<Record weight="fill" />} loading={busy} disabled={!status.available} onClick={() => void start()} data-testid="meeting-start">
          {t('meeting.start.button')}
        </Button>
        <span className="text-sm text-fg-faint">{t('meeting.start.hotkey')}</span>
      </div>
    </Panel>
    </WorkspaceGrid>
  );
}

function LivePanel({ status }: { status: MeetingStatus }) {
  const meeting = status.active as Meeting;
  const { detail, pending } = useMeetingDetail(meeting.id);
  const [context, setContext] = useState(meeting.context);
  const [now, setNow] = useState(Date.now());
  // Bağlam başka yoldan (araç, sesli komut) değişirse form da güncellenir.
  const savedContext = JSON.stringify(meeting.context);
  useEffect(() => setContext(meeting.context), [meeting.id, savedContext]);
  useEffect(() => {
    // Süre göstergesi: saniyede bir (yalnız toplantı sürerken).
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const lines = useMemo(() => [...(detail?.lines ?? []), ...pending].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)), [detail, pending]);
  const suggestions = (detail?.suggestions ?? []).filter((item) => item.state !== 'skipped').slice(-3).reverse();
  const save = (patch: Partial<MeetingContext>) => void attempt(() => window.fuber.invoke('meeting.setContext', { context: patch }));
  const stop = () => void attempt(() => window.fuber.invoke('meeting.stop'));
  const live = meeting.state === 'live';
  void now;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3" role="status" data-testid="meeting-recording">
        <Broadcast className="size-5 text-danger" aria-hidden />
        <span className="text-base font-medium text-fg">{live ? t('meeting.recording') : t('meeting.wrapping')}</span>
        <span className="text-sm text-fg-muted tabular-nums">{duration(meeting.startedAt, null)}</span>
        <span className="text-sm text-fg-muted">{t('meeting.recordingNote')}</span>
        <div className="ml-auto">
          {live && (
            <Button variant="danger" icon={<Stop weight="fill" />} onClick={stop} data-testid="meeting-stop">
              {t('meeting.stop')}
            </Button>
          )}
        </div>
      </div>
      <SourceBadges status={status} />
      <WorkspaceGrid
        asideWidth={360}
        aside={
          <>
            <Panel tone="base" title={t('meeting.suggestion.title')} className="flex flex-col gap-3" data-testid="meeting-suggestions">
              {meeting.suggestions ? (
                suggestions.length ? suggestions.map((item) => <SuggestionCard key={item.id} suggestion={item} />) : <p className="text-sm text-fg-faint">{t('meeting.suggestion.none')}</p>
              ) : (
                <p className="text-sm text-fg-faint">{t('meeting.suggestion.off')}</p>
              )}
            </Panel>
            <Panel tone="base" title={t('meeting.context.title')} className="flex flex-col gap-4" data-testid="meeting-context">
              <ContextForm value={context} disabled={!live} onChange={(patch) => setContext((current) => ({ ...current, ...patch }))} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!live} onClick={() => save({ topic: context.topic, participants: context.participants, notes: context.notes, glossary: context.glossary })} data-testid="meeting-context-save">
                  {t('meeting.context.save')}
                </Button>
                <Button size="sm" variant="ghost" icon={<FileArrowUp />} disabled={!live} onClick={() => void attempt(() => window.fuber.invoke('meeting.addDocument', {}))}>
                  {t('meeting.context.addDocument')}
                </Button>
              </div>
              {meeting.context.documents.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-fg-muted" data-testid="meeting-documents">
                  {meeting.context.documents.map((doc) => (
                    <li key={doc.name}>
                      {doc.name}
                      {doc.truncated ? ` · ${t('meeting.context.truncated')}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-1 gap-3">
                <Field label={t('meeting.options.target')}>
                  <Select
                    value={meeting.target ?? 'off'}
                    disabled={!live}
                    onChange={(value) => void attempt(() => window.fuber.invoke('meeting.setOptions', { target: value === 'off' ? null : value }))}
                    options={targetOptions()}
                  />
                </Field>
                <Switch
                  checked={meeting.suggestions}
                  disabled={!live}
                  onCheckedChange={(on) => void attempt(() => window.fuber.invoke('meeting.setOptions', { suggestions: on }))}
                  label={t('meeting.options.suggestions')}
                />
              </div>
              <p className="text-xs text-fg-faint" data-testid="meeting-brain-line">
                {t(`meeting.brain.translate.${status.brain.translate}`)} · {t(`meeting.brain.summary.${status.brain.summary}`)}
              </p>
            </Panel>
          </>
        }
      >
        <Panel tone="lead" title={t('meeting.transcript')} className="flex min-h-80 flex-col">
          {lines.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-faint" data-testid="meeting-empty-live">{t('meeting.transcriptEmpty')}</p>
          ) : (
            <ul className="flex flex-col" data-testid="meeting-lines">
              {lines.map((line) => (
                <LineRow key={line.id} line={line} pending={pending.some((item) => item.id === line.id)} />
              ))}
            </ul>
          )}
        </Panel>
      </WorkspaceGrid>
    </div>
  );
}

function HistoryPanel({ selected, onSelect }: { selected: Id | null; onSelect: (id: Id | null) => void }) {
  const list = useLive(() => window.fuber.invoke('meeting.list', { limit: 100 }), EVENTS);
  const { detail, reload } = useMeetingDetail(selected);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Id | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  if (list.state.status === 'loading') return <SkeletonRows count={4} />;
  if (list.state.status === 'error') return <ErrorPanel message={list.state.message} onRetry={list.reload} />;
  const items = list.state.data.filter((item) => item.state !== 'live');
  if (items.length === 0)
    return (
      <Panel tone="lead">
        <EmptyState icon={<ClockCounterClockwise />} title={t('meeting.history.empty')} description={t('meeting.history.emptyHint')} />
      </Panel>
    );
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    await attempt(task);
    setBusy(false);
    reload();
  };
  const listPanel = (
    <Panel
      tone="base"
      padding="none"
      title={t('meeting.tab.history')}
      count={items.length}
      action={
        <Button size="sm" variant="ghost" icon={<Trash />} onClick={() => setConfirmAll(true)} data-testid="meeting-delete-all">
          {t('meeting.deleteAll')}
        </Button>
      }
    >
      <ul className="flex flex-col gap-0.5 px-2 pb-2" data-testid="meeting-history">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={cn('flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-surface-2', selected === item.id && 'bg-surface-2')}
              onClick={() => onSelect(item.id)}
              data-testid="meeting-history-item"
              data-id={item.id}
            >
              <span className="text-base text-fg">{item.title || t('meeting.untitled')}</span>
              <span className="text-xs text-fg-muted">
                {dayTime(item.startedAt)} · {duration(item.startedAt, item.endedAt)} · {t('meeting.history.lines', { count: item.lineCount })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
  return (
    <WorkspaceGrid asideSide="start" asideWidth={320} asideFirstWhenStacked aside={listPanel}>
      {detail ? (
        <Panel tone="lead" className="flex flex-col gap-6" data-testid="meeting-detail" data-id={detail.meeting.id}>
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="text-lg font-medium text-fg">{detail.meeting.title || t('meeting.untitled')}</h2>
              <span className="text-sm text-fg-muted">
                {dayTime(detail.meeting.startedAt)} · {duration(detail.meeting.startedAt, detail.meeting.endedAt)}
                {detail.meeting.echoDropped > 0 ? ` · ${t('meeting.echoDropped', { count: detail.meeting.echoDropped })}` : ''}
              </span>
            </div>
            <Button size="sm" variant="ghost" icon={<Trash />} onClick={() => setConfirm(detail.meeting.id)} data-testid="meeting-delete">
              {t('meeting.delete')}
            </Button>
          </div>
          <SummaryView
            meeting={detail.meeting}
            lines={detail.lines}
            busy={busy}
            onExport={(index) => void run(() => window.fuber.invoke('meeting.exportActions', { id: detail.meeting.id, index }))}
            onExportAll={() => void run(() => window.fuber.invoke('meeting.exportActions', { id: detail.meeting.id }))}
            onRetry={() => void run(() => window.fuber.invoke('meeting.summarize', { id: detail.meeting.id }))}
          />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-fg-muted">{t('meeting.transcript')}</h3>
            {detail.lines.length === 0 ? (
              <p className="text-sm text-fg-faint">{t('meeting.history.expired')}</p>
            ) : (
              <ul className="flex flex-col" data-testid="meeting-detail-lines">
                {detail.lines.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </ul>
            )}
          </section>
        </Panel>
      ) : (
        <Panel tone="lead">
          <p className="text-sm text-fg-faint" data-testid="meeting-history-pick">
            {t('meeting.history.pick')}
          </p>
        </Panel>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={t('meeting.deleteTitle')}
        body={t('meeting.deleteBody')}
        confirmLabel={t('meeting.delete')}
        onOpenChange={(open) => !open && setConfirm(null)}
        onConfirm={async () => {
          const id = confirm;
          setConfirm(null);
          if (id && (await attempt(() => window.fuber.invoke('meeting.delete', { id })))) onSelect(null);
        }}
      />
      <ConfirmDialog
        open={confirmAll}
        title={t('meeting.deleteAllTitle')}
        body={t('meeting.deleteAllBody')}
        confirmLabel={t('meeting.deleteAll')}
        onOpenChange={(open) => !open && setConfirmAll(false)}
        onConfirm={async () => {
          setConfirmAll(false);
          if (await attempt(() => window.fuber.invoke('meeting.deleteAll'))) onSelect(null);
        }}
      />
    </WorkspaceGrid>
  );
}

function MeetingPage() {
  const status = useLive(() => window.fuber.invoke('meeting.status'), EVENTS);
  const [tab, setTab] = useState<TabId>('live');
  const [consentOpen, setConsentOpen] = useState(false);
  const [selected, setSelected] = useState<Id | null>(null);
  const [lastActive, setLastActive] = useState<Id | null>(null);
  const data = status.data;
  // Toplantı bitince geçmişte o toplantı açılır (özet orada belirir).
  useEffect(() => {
    const id = data?.active?.id ?? null;
    if (id) setLastActive(id);
    else if (lastActive) {
      setSelected(lastActive);
      setTab('history');
      setLastActive(null);
    }
  }, [data?.active?.id]);
  return (
    <Workspace data-testid="meeting-page">
      <WorkspaceHeader
        title={t('meeting.nav')}
        status={data ? (data.active ? t('meeting.header.live') : t('meeting.header.idle')) : undefined}
        actions={
          data && !data.consentAt ? (
            <Button icon={<MicrophoneStage />} onClick={() => setConsentOpen(true)} data-testid="meeting-consent-open">
              {t('meeting.consent.open')}
            </Button>
          ) : undefined
        }
      >
        <Tabs
          id={TABS_ID}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'live', label: t('meeting.tab.live') },
            { value: 'history', label: t('meeting.tab.history') },
          ]}
        />
      </WorkspaceHeader>
      {status.state.status === 'loading' && (
        <Panel tone="lead">
          <SkeletonRows count={3} />
        </Panel>
      )}
      {status.state.status === 'error' && (
        <Panel tone="lead">
          <ErrorPanel message={status.state.message} onRetry={status.reload} />
        </Panel>
      )}
      {data && (
        <>
          <TabPanel tabsId={TABS_ID} value="live" hidden={tab !== 'live'}>
            {data.active ? <LivePanel status={data} /> : <StartPanel status={data} onNeedConsent={() => setConsentOpen(true)} />}
          </TabPanel>
          <TabPanel tabsId={TABS_ID} value="history" hidden={tab !== 'history'}>
            {tab === 'history' && <HistoryPanel selected={selected} onSelect={setSelected} />}
          </TabPanel>
        </>
      )}
      <ConsentDialog open={consentOpen} status={data} onClose={() => setConsentOpen(false)} />
    </Workspace>
  );
}

export default definePage({
  id: 'meeting',
  titleKey: 'meeting.nav',
  icon: UsersThree,
  // Ray: Planlar (40) · Toplantı (44) · İşler (46) · Projeler (60).
  order: 44,
  moduleId: 'meeting',
  Component: MeetingPage,
});
