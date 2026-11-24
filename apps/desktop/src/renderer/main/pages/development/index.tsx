// Geliştirme: Jarvis'in kendi kaynak kodunu geliştirmesi (Katman 2). Üstte istek kutusu, ortada süren koşunun aşama çizgisi ve
// canlı adım günlüğü, hazır güncelleme için "Kur / Vazgeç", yanda sürümler ve geri alma, altta geçmiş. Geliştirici kipi kapalıysa
// nasıl açılacağını anlatan boş durum. Veri ve cümleler ana süreçtekiyle aynı (`modules/selfdev`); düğmeler araçlarla AYNI
// kapılardan geçer (kurulum ve geri alma ayrıca açık onay kartı ister).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, CaretDown, Check, CircleNotch, Code, DownloadSimple, FolderOpen, Gear, GitBranch, Warning, X } from '@phosphor-icons/react';
import { relativeTime, t } from '@fuber/shared';
import { Badge, Button, EmptyState, Metric, Panel, ProgressBar, Skeleton, Textarea, Workspace, WorkspaceGrid, WorkspaceHeader, toast, type Tone } from '@fuber/ui';
import type { CheckResult, RunStatus, SelfdevEvent, SelfdevRun, SelfdevStatus } from '../../../../main/modules/selfdev/types';
import { stageIndex, STAGES } from '../../../../main/modules/selfdev/pipeline';
import { attempt, useLive } from '../../shell/live';
import { ErrorPanel } from '../../shell/parts';
import { ContextCard, ContextSection } from '../memory/page-parts';
import { definePage } from '../page';

const TONE: Record<RunStatus, Tone> = {
  queued: 'neutral',
  planning: 'accent',
  implementing: 'accent',
  verifying: 'accent',
  fixing: 'warning',
  packaging: 'accent',
  ready: 'success',
  installing: 'accent',
  restarting: 'accent',
  installed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  rolled_back: 'warning',
};

const WORKING = new Set<RunStatus>(['queued', 'planning', 'implementing', 'verifying', 'fixing', 'packaging', 'installing', 'restarting']);
const stageName = (status: RunStatus): string => t(`selfdev.status.${status}` as never);
const clock = (iso: string): string => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const seconds = (ms: number): string => (ms < 1000 ? '<1 sn' : `${Math.round(ms / 1000)} sn`);

// ───────────────────────── aşama çizgisi ─────────────────────────

/** plan → uygulama → sınama → paket → hazır. Geçilenler dolu, süren nefes alır (azaltılmış harekette durur). */
function StageLine({ status }: { status: RunStatus }) {
  const at = stageIndex(status);
  const failed = status === 'failed' || status === 'cancelled';
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label={t('selfdev.page.stages')} data-testid="dev-stages">
      {STAGES.map((stage, index) => {
        const done = at !== null && index < at;
        const current = at === index && !failed;
        return (
          <li key={stage} className="flex min-w-0 flex-col gap-2" data-state={done ? 'done' : current ? 'current' : 'todo'}>
            <span className={`h-1 rounded-full transition-colors duration-200 ease-out ${done ? 'bg-accent' : current ? 'bg-accent/60 motion-safe:animate-pulse' : 'bg-surface-4'}`} />
            <span className={`flex items-center gap-1.5 truncate text-sm ${current ? 'font-medium text-fg' : done ? 'text-fg-muted' : 'text-fg-faint'}`}>
              {done ? <Check weight="bold" className="size-3.5 shrink-0" /> : current && WORKING.has(status) ? <CircleNotch className="size-3.5 shrink-0 motion-safe:animate-spin" /> : null}
              <span className="truncate">{t(`selfdev.stage.${stage}` as never)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────── günlük, sınama, dosyalar ─────────────────────────

function EventLog({ events, live }: { events: SelfdevEvent[]; live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (live && el) el.scrollTop = el.scrollHeight;
  }, [events.length, live]);
  if (events.length === 0) return <p className="text-sm text-fg-faint">{t('selfdev.page.noEvents')}</p>;
  return (
    <div ref={box} className="max-h-72 overflow-y-auto rounded-sm bg-surface-1 px-3 py-2 font-mono text-xs leading-relaxed" data-testid="dev-log" role="log" aria-live="off">
      {events.map((event) => (
        <div key={event.id} className={`flex gap-3 py-0.5 ${event.kind === 'error' ? 'text-danger' : event.kind === 'status' ? 'font-medium text-fg' : event.kind === 'tool' ? 'text-fg-muted' : event.kind === 'check' ? 'text-accent' : 'text-fg-muted'}`}>
          <span className="shrink-0 text-fg-faint tabular-nums">{clock(event.at)}</span>
          <span className="min-w-0 break-words">{event.kind === 'tool' ? `› ${event.text}` : event.text}</span>
        </div>
      ))}
    </div>
  );
}

function Checks({ checks }: { checks: CheckResult[] }) {
  if (checks.length === 0) return <p className="text-sm text-fg-faint">{t('selfdev.page.noChecks')}</p>;
  return (
    <ul className="flex flex-col gap-1.5" data-testid="dev-checks">
      {checks.map((check, index) => (
        <li key={`${check.name}-${check.round}-${index}`} className="flex items-center gap-2 text-sm">
          <Badge tone={check.ok ? 'success' : 'danger'} size="sm" dot>
            {check.ok ? t('selfdev.page.passed') : t('selfdev.page.failedCheck')}
          </Badge>
          <span className="font-mono text-fg">{check.name}</span>
          <span className="text-fg-faint tabular-nums">
            {seconds(check.durationMs)}
            {check.round > 0 ? ` · ${t('selfdev.page.round', { round: check.round })}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Files({ run }: { run: SelfdevRun }) {
  const files = run.files.length > 0 ? run.files : run.planFiles;
  if (files.length === 0) return <p className="text-sm text-fg-faint">{t('selfdev.page.noFiles')}</p>;
  return (
    <ul className="flex flex-col gap-1" data-testid="dev-files">
      {files.slice(0, 40).map((file) => (
        <li key={file} className="truncate font-mono text-xs text-fg-muted" title={file}>
          {file}
        </li>
      ))}
      {files.length > 40 && <li className="text-xs text-fg-faint">{t('selfdev.page.moreFiles', { count: files.length - 40 })}</li>}
    </ul>
  );
}

function Flags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-sm bg-warning/10 px-3 py-2 text-sm text-fg" data-testid="dev-flags">
      <Warning className="mt-0.5 size-4 shrink-0 text-warning" />
      <ul className="flex flex-col gap-0.5">
        {flags.map((flag) => (
          <li key={flag}>{flag}</li>
        ))}
      </ul>
    </div>
  );
}

/** Koşunun ayrıntısı: plan, dosyalar, sınamalar, günlük. */
function RunDetail({ id, live }: { id: string; live: boolean }) {
  const detail = useLive(() => window.fuber.invoke('selfdev.run', { id }), ['selfdev.changed'], [id]);
  if (detail.state.status !== 'ready' || !detail.data) return <Skeleton className="h-24 w-full" />;
  const { run, events } = detail.data;
  return (
    <div className="flex flex-col gap-5" data-testid="dev-detail">
      {run.planSummary && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium text-fg">{t('selfdev.page.plan')}</h4>
          <p className="text-sm text-fg-muted" data-testid="dev-plan">
            {run.planSummary}
          </p>
          {run.planRisk && <p className="text-xs whitespace-pre-line text-fg-faint">{run.planRisk}</p>}
        </section>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-fg">
            {t('selfdev.page.files')} <span className="text-fg-faint tabular-nums">{run.files.length || run.planFiles.length}</span>
          </h4>
          <Files run={run} />
        </section>
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-fg">{t('selfdev.page.checks')}</h4>
          <Checks checks={run.checks} />
        </section>
      </div>
      <Flags flags={run.riskFlags} />
      {run.error && <p className="text-sm text-danger" data-testid="dev-error">{run.error}</p>}
      {run.worktree && (
        <p className="flex items-center gap-2 text-xs text-fg-faint">
          <GitBranch className="size-3.5" /> <span className="font-mono">{run.branch}</span> · <span className="truncate font-mono">{run.worktree}</span>
        </p>
      )}
      <section className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-fg">{t('selfdev.page.log')}</h4>
        <EventLog events={events} live={live} />
      </section>
    </div>
  );
}

// ───────────────────────── paneller ─────────────────────────

/** Kapalı durumdan tek tıkla kurulum: kipi açar; kaynak klasörü geçerli değilse klasör seçtirir. */
async function enableHere(status: SelfdevStatus): Promise<void> {
  if (!status.gate.setting && (await attempt(() => window.fuber.invoke('settings.update', { patch: { developerMode: true } }))) === null) return;
  // Klasör daha önce gösterildiyse yeniden sorulmaz (kapı, kip açılınca depoyu yeniden doğrular).
  const next = await attempt(() => window.fuber.invoke('selfdev.status', {}));
  if (next?.gate.repoOk) return;
  const picked = await attempt(() => window.fuber.invoke('app.pickFile', { title: t('selfdev.settings.pickTitle'), directory: true }));
  if (picked?.path) await attempt(() => window.fuber.invoke('settings.update', { patch: { developerRepoPath: picked.path } }));
}

function ClosedState({ status }: { status: SelfdevStatus }) {
  const steps = [
    { done: status.gate.policy, text: t('selfdev.page.closed.policy') },
    { done: status.gate.setting, text: t('selfdev.page.closed.setting') },
    { done: status.gate.repoOk, text: t('selfdev.page.closed.repo') },
  ];
  return (
    <Panel tone="lead">
      <EmptyState
        icon={<Code />}
        title={t('selfdev.page.closed.title')}
        description={status.gate.reason ?? t('selfdev.page.closed.body')}
        data-testid="dev-closed"
        actions={
          // Yönetim izin veriyorsa kip buradan tek tıkla açılır (kipi aç → kaynak klasörünü seç); Ayarlar'a gitmek gerekmez.
          status.gate.policy ? (
            <Button variant="primary" icon={status.gate.setting ? <FolderOpen /> : <Code />} onClick={() => void enableHere(status)} data-testid="dev-enable">
              {t(status.gate.setting ? 'selfdev.page.closed.pick' : 'selfdev.page.closed.enable')}
            </Button>
          ) : (
            <Button variant="primary" icon={<Gear />} onClick={() => window.fuber.invoke('app.openMain', { page: 'settings' }).catch(() => undefined)}>
              {t('selfdev.page.closed.settings')}
            </Button>
          )
        }
      />
      <ol className="mx-auto mt-2 flex max-w-lg flex-col gap-2" data-testid="dev-closed-steps">
        {steps.map((step) => (
          <li key={step.text} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full ${step.done ? 'bg-success/20 text-success' : 'bg-surface-4 text-fg-faint'}`}>{step.done ? <Check weight="bold" className="size-3" /> : <X weight="bold" className="size-3" />}</span>
            <span className={step.done ? 'text-fg-muted' : 'text-fg'}>{step.text}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function RequestBox({ status }: { status: SelfdevStatus }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = status.active !== null || status.ready !== null || status.pending !== null;
  const send = async () => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('selfdev.start', { request: text.trim() }));
    setBusy(false);
    if (!result) return;
    if (result.ok) {
      setText('');
      toast.success(t('selfdev.page.started'));
    } else toast.error(result.text);
  };
  return (
    <Panel tone="lead" title={t('selfdev.page.ask.title')} data-testid="dev-ask">
      <div className="flex flex-col gap-3">
        <Textarea value={text} onChange={(event) => setText(event.target.value)} minRows={3} maxRows={8} placeholder={t('selfdev.page.ask.placeholder')} aria-label={t('selfdev.page.ask.title')} disabled={blocked} data-testid="dev-request" />
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-fg-faint">{!status.deep.ok ? t('selfdev.page.ask.noDeep', { reason: status.deep.reason ?? '' }) : blocked ? t('selfdev.page.ask.blocked') : t('selfdev.page.ask.hint')}</p>
          <Button variant="primary" icon={<Code />} loading={busy} disabled={blocked || text.trim().length < 8 || !status.deep.ok} onClick={() => void send()} data-testid="dev-start">
            {t('selfdev.page.ask.start')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function ActiveRun({ run }: { run: SelfdevRun }) {
  const progress = useMemo(() => ({ queued: 0.02, planning: 0.12, implementing: 0.38, verifying: 0.62, fixing: 0.58, packaging: 0.86, installing: 0.95, restarting: 0.98 })[run.status as 'queued'] ?? 1, [run.status]);
  return (
    <Panel tone="lead" title={t('selfdev.page.active')} data-testid="dev-active" action={<Badge tone={TONE[run.status]}>{stageName(run.status)}</Badge>}>
      <div className="flex flex-col gap-5">
        <p className="text-base text-fg">{run.request}</p>
        <StageLine status={run.status} />
        <ProgressBar value={progress} size="sm" label={stageName(run.status)} />
        <RunDetail id={run.id} live />
        <div className="flex justify-end">
          <Button variant="secondary" icon={<X />} onClick={() => void attempt(() => window.fuber.invoke('selfdev.cancel', {}))} data-testid="dev-cancel">
            {t('selfdev.page.cancel')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function ReadyCard({ run, status }: { run: SelfdevRun; status: SelfdevStatus }) {
  const [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('selfdev.install', { run: run.id }));
    setBusy(false);
    if (result && !result.ok) toast.error(result.text);
  };
  return (
    <Panel tone="lead" title={t('selfdev.page.ready.title')} data-testid="dev-ready" action={<Badge tone="success">{run.version}</Badge>}>
      <div className="flex flex-col gap-5">
        <p className="text-base text-fg">{run.planSummary ?? run.request}</p>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Metric label={t('selfdev.page.ready.from')} value={run.fromVersion} />
          <Metric label={t('selfdev.page.ready.to')} value={run.version ?? '?'} tone="success" />
          <Metric label={t('selfdev.page.files')} value={run.files.length} />
          <Metric label={t('selfdev.page.ready.fixes')} value={run.fixRounds} />
        </div>
        <Flags flags={run.riskFlags} />
        {!status.install.ok && <p className="text-sm text-fg-faint">{t('selfdev.page.ready.noInstall', { reason: status.install.reason ?? '' })}</p>}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" icon={<X />} onClick={() => void attempt(() => window.fuber.invoke('selfdev.cancel', {}))} data-testid="dev-discard">
            {t('selfdev.page.ready.discard')}
          </Button>
          <Button variant="primary" icon={<DownloadSimple />} loading={busy} disabled={!status.install.ok} onClick={() => void install()} data-testid="dev-install">
            {t('selfdev.page.ready.install')}
          </Button>
        </div>
        <RunDetail id={run.id} live={false} />
      </div>
    </Panel>
  );
}

function HealthBanner({ status }: { status: SelfdevStatus }) {
  if (!status.healthFailed) return null;
  return (
    <Panel tone="base" data-testid="dev-health">
      <div className="flex items-start gap-3">
        <Warning className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-base font-medium text-fg">{t('selfdev.page.health.title')}</p>
          <p className="text-sm text-fg-muted">{t('selfdev.page.health.body', { reason: status.healthFailed.reason })}</p>
        </div>
        {status.versions.previous && (
          <Button variant="danger" icon={<ArrowCounterClockwise />} onClick={() => void attempt(() => window.fuber.invoke('selfdev.rollback', {}))} data-testid="dev-health-rollback">
            {t('selfdev.page.rollback')}
          </Button>
        )}
      </div>
    </Panel>
  );
}

function History({ runs, openId, setOpenId }: { runs: SelfdevRun[]; openId: string | null; setOpenId: (id: string | null) => void }) {
  if (runs.length === 0) return null;
  return (
    <Panel tone="base" padding="none" title={t('selfdev.page.history')} count={runs.length} data-testid="dev-history">
      <ul className="flex flex-col pb-1">
        {runs.map((run) => {
          const open = openId === run.id;
          return (
            <li key={run.id} className="border-b border-line last:border-b-0" data-testid="dev-history-row" data-status={run.status}>
              <button type="button" className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-surface-3 active:bg-surface-3" aria-expanded={open} onClick={() => setOpenId(open ? null : run.id)}>
                <Badge tone={TONE[run.status]} size="sm">
                  {stageName(run.status)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{run.request}</span>
                <span className="shrink-0 font-mono text-xs text-fg-faint">{run.version ?? ''}</span>
                <span className="w-24 shrink-0 text-right text-xs text-fg-faint tabular-nums">{relativeTime(run.createdAt)}</span>
                <CaretDown className={`size-4 shrink-0 text-fg-faint transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="px-5 pb-5">
                  <RunDetail id={run.id} live={false} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Versions({ status }: { status: SelfdevStatus }) {
  const [busy, setBusy] = useState(false);
  const { versions } = status;
  return (
    <ContextCard data-testid="dev-versions">
      <ContextSection title={t('selfdev.page.versions')}>
        <div className="flex flex-col gap-3">
          <Metric label={t('selfdev.page.current')} value={<span className="font-mono text-lg">{versions.current}</span>} />
          <Metric label={t('selfdev.page.previous')} value={<span className="font-mono text-lg">{versions.previous ?? t('selfdev.tool.none')}</span>} hint={versions.rollbackVia ? t(`selfdev.page.via.${versions.rollbackVia}` as never) : undefined} />
          <Button
            variant="secondary"
            icon={<ArrowCounterClockwise />}
            loading={busy}
            disabled={!versions.previous || !status.install.ok}
            onClick={() => {
              setBusy(true);
              void attempt(() => window.fuber.invoke('selfdev.rollback', {})).then((result) => {
                setBusy(false);
                if (result && !result.ok) toast.error(result.text);
              });
            }}
            data-testid="dev-rollback"
          >
            {t('selfdev.page.rollback')}
          </Button>
          {!status.install.ok && <p className="text-xs text-fg-faint">{status.install.reason}</p>}
        </div>
      </ContextSection>
      {versions.history.length > 0 && (
        <ContextSection title={t('selfdev.page.installedList')} count={versions.history.length}>
          <ul className="flex flex-col gap-1.5">
            {versions.history.slice(0, 6).map((item) => (
              <li key={`${item.version}-${item.at}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-mono text-fg-muted">{item.version}</span>
                <span className="shrink-0 text-xs text-fg-faint">{relativeTime(item.at)}</span>
              </li>
            ))}
          </ul>
        </ContextSection>
      )}
      <ContextSection title={t('selfdev.page.how')}>
        <p className="text-sm text-fg-muted">{t('selfdev.page.howBody')}</p>
      </ContextSection>
    </ContextCard>
  );
}

// ───────────────────────── sayfa ─────────────────────────

function DevelopmentPage() {
  const status = useLive(() => window.fuber.invoke('selfdev.status', {}), ['selfdev.changed', 'settings.changed', 'policy.changed']);
  const runs = useLive(() => window.fuber.invoke('selfdev.runs', { limit: 30 }), ['selfdev.changed']);
  const [openId, setOpenId] = useState<string | null>(null);
  const data = status.data;
  const shown = new Set([data?.active?.id, data?.ready?.id]);
  const history = (runs.data ?? []).filter((run) => !shown.has(run.id));

  const header =
    status.state.status !== 'ready' || !data
      ? undefined
      : data.active
        ? stageName(data.active.status)
        : data.ready
          ? t('selfdev.page.status.ready', { version: data.ready.version ?? '' })
          : data.gate.open
            ? t('selfdev.page.status.open')
            : t('selfdev.page.status.closed');

  return (
    <Workspace data-testid="development-page">
      <WorkspaceHeader title={t('selfdev.nav')} status={header} />
      <WorkspaceGrid asideWidth={340} aside={data ? <Versions status={data} /> : undefined}>
        {status.state.status === 'loading' ? (
          <Panel tone="lead" aria-busy aria-label={t('common.loading')}>
            <Skeleton className="h-28 w-full" />
          </Panel>
        ) : status.state.status === 'error' || !data ? (
          <Panel tone="lead">
            <ErrorPanel message={status.state.status === 'error' ? status.state.message : ''} onRetry={status.reload} />
          </Panel>
        ) : (
          <>
            <HealthBanner status={data} />
            {!data.gate.open ? <ClosedState status={data} /> : null}
            {data.gate.open && data.ready && <ReadyCard run={data.ready} status={data} />}
            {data.gate.open && data.active && <ActiveRun run={data.active} />}
            {data.gate.open && !data.ready && !data.active && <RequestBox status={data} />}
            <History runs={history} openId={openId} setOpenId={setOpenId} />
          </>
        )}
      </WorkspaceGrid>
    </Workspace>
  );
}

export default definePage({
  id: 'development',
  titleKey: 'selfdev.nav',
  icon: Code,
  // Ray: Projeler (60) · Yetenekler (70) · Geliştirme (72).
  order: 72,
  moduleId: 'selfdev',
  Component: DevelopmentPage,
});
