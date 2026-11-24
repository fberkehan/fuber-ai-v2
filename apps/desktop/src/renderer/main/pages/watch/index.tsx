// İşler: gözcülü arka plan işleri. Süren işler birincil kutuda, biten işler ikincil kutuda; bağlam sütununda
// kaynaklar ve nasıl çalıştığı. Her satırda ne izlendiği, ne olunca haber verileceği, son ve sonraki bakış, bulunan
// değişiklik. Veri ve cümleler ana süreçtekiyle aynı (`modules/watch/describe.ts`).
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowClockwise, Binoculars, DotsThree, Pause, Play, Trash, X } from '@phosphor-icons/react';
import { relativeTime, t } from '@fuber/shared';
import { Badge, EmptyState, IconButton, Menu, Panel, Skeleton, Workspace, WorkspaceGrid, WorkspaceHeader, spring, stagger, toast, useMotionTransition, useReducedMotion, type Tone } from '@fuber/ui';
import { conditionText, everyText, shortId, statusSentence, whenText } from '../../../../main/modules/watch/describe';
import type { WatchJob, WatchSourceInfo } from '../../../../main/modules/watch/types';
import { useShell } from '../../shell/context';
import { attempt, useLive } from '../../shell/live';
import { ConfirmDialog, ErrorPanel } from '../../shell/parts';
import { ContextCard, ContextSection } from '../memory/page-parts';
import { definePage } from '../page';

const TONE: Record<WatchJob['status'], Tone> = { running: 'accent', paused: 'warning', done: 'success', failed: 'danger', cancelled: 'neutral' };

/** Kaynağın kısa adı (liste satırının alt yazısı). */
function targetText(job: WatchJob, sources: WatchSourceInfo[]): string {
  const label = sources.find((source) => source.kind === job.plan.source.kind)?.label ?? job.plan.source.kind;
  if (job.plan.source.kind === 'time') return `${label} · ${whenText(job.plan.source.target)}`;
  const target = job.plan.source.target || '—';
  return `${label} · ${target.length > 80 ? `${target.slice(0, 79)}…` : target}`;
}

function JobRow({ job, sources, index, onCancel }: { job: WatchJob; sources: WatchSourceInfo[]; index: number; onCancel: (job: WatchJob) => void }) {
  const reduce = useReducedMotion();
  const transition = useMotionTransition(spring.smooth);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await attempt(action);
    setBusy(false);
  };
  const live = job.status === 'running' || job.status === 'paused';
  const when = job.plan.source.kind === 'time' ? t('watch.plan.whenTime', { at: whenText(job.plan.source.target) }) : conditionText(job.plan.condition);
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: 'translateY(6px)' }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={stagger(index, transition)}
      className="border-b border-line last:border-b-0"
      data-testid="watch-row"
      data-id={job.id}
      data-status={job.status}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-4 text-fg-muted [&_svg]:size-4.5">
          <Binoculars />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-medium text-fg">{job.title}</span>
            <span className="font-mono text-xs text-fg-faint">#{shortId(job.id)}</span>
            <Badge tone={TONE[job.status]} size="sm">
              {t(`watch.state.${job.status}`)}
            </Badge>
          </div>
          <p className="truncate text-sm text-fg-muted">{targetText(job, sources)}</p>
          <p className="text-sm text-fg-muted">
            {when} · <span data-testid="watch-status">{statusSentence(job)}</span>
          </p>
          {job.finding && job.finding !== job.result && (
            <p className="text-sm text-fg" data-testid="watch-finding">
              <span className="text-fg-muted">{t('watch.page.finding')}: </span>
              {job.finding}
            </p>
          )}
          <p className="text-xs text-fg-faint tabular-nums">
            {t('watch.page.lastCheck')}: {job.lastCheckAt ? relativeTime(job.lastCheckAt) : t('watch.page.never')}
            {' · '}
            {t('watch.page.counts', { checks: job.checks, changes: job.changes, calls: job.modelCalls })}
            {job.status === 'running' && job.plan.source.kind !== 'time' ? ` · ${t('watch.page.every', { every: everyText(job.intervalSec) })}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {job.status === 'running' && (
            <IconButton
              icon={<ArrowClockwise />}
              label={t('watch.page.checkNow')}
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const after = await window.fuber.invoke('watch.checkNow', { id: job.id });
                  toast.success(t('watch.page.checked', { status: statusSentence(after) }));
                })
              }
              data-testid="watch-check"
            />
          )}
          {job.status === 'running' && (
            <IconButton icon={<Pause />} label={t('watch.page.pause')} size="sm" disabled={busy} onClick={() => void run(() => window.fuber.invoke('watch.pause', { id: job.id }))} data-testid="watch-pause" />
          )}
          {(job.status === 'paused' || job.status === 'failed') && (
            <IconButton icon={<Play />} label={t('watch.page.resume')} size="sm" disabled={busy} onClick={() => void run(() => window.fuber.invoke('watch.resume', { id: job.id }))} data-testid="watch-resume" />
          )}
          <Menu
            label={t('common.more')}
            placement="bottom-end"
            trigger={<IconButton icon={<DotsThree weight="bold" />} label={t('common.more')} size="sm" data-testid="watch-menu" />}
            items={
              live
                ? [{ id: 'cancel', label: t('watch.page.cancel'), icon: <X />, danger: true, onSelect: () => onCancel(job) }]
                : [{ id: 'remove', label: t('watch.page.remove'), icon: <Trash />, onSelect: () => void attempt(() => window.fuber.invoke('watch.remove', { id: job.id })) }]
            }
          />
        </div>
      </div>
    </motion.li>
  );
}

function WatchPage() {
  const shell = useShell();
  const [cancelling, setCancelling] = useState<WatchJob | null>(null);
  const jobs = useLive(() => window.fuber.invoke('watch.list', { limit: 100 }), ['watch.changed']);
  const sources = useLive(() => window.fuber.invoke('watch.sources'), ['watch.changed', 'settings.changed']);
  const list = jobs.data ?? [];
  const active = list.filter((job) => job.status === 'running' || job.status === 'paused');
  const finished = list.filter((job) => !(job.status === 'running' || job.status === 'paused')).slice(0, 30);
  const known = sources.data ?? [];

  const running = active.filter((job) => job.status === 'running').length;
  const paused = active.length - running;
  const status =
    jobs.state.status !== 'ready'
      ? undefined
      : running > 0
        ? t('watch.page.status.active', { count: running })
        : paused > 0
          ? t('watch.page.status.paused', { count: paused })
          : t('watch.page.status.none');

  const aside = (
    <ContextCard data-testid="watch-aside">
      <ContextSection title={t('watch.page.how')}>
        <p className="text-sm text-fg-muted">{t('watch.page.description')}</p>
        <p className="text-sm text-fg-muted">{t('watch.page.howBody')}</p>
      </ContextSection>
      {known.length > 0 && (
        <ContextSection title={t('watch.page.sources')} count={known.length} data-testid="watch-sources">
          <ul className="flex flex-col gap-2">
            {known.map((source) => (
              <li key={source.kind} className="flex min-w-0 items-center gap-2 text-sm">
                <Badge tone={source.unavailable ? 'neutral' : 'accent'} size="sm" dot>
                  {source.label}
                </Badge>
                {source.unavailable && <span className="min-w-0 truncate text-fg-faint">{t('watch.page.sourceOff', { reason: source.unavailable })}</span>}
              </li>
            ))}
          </ul>
        </ContextSection>
      )}
    </ContextCard>
  );

  return (
    <Workspace data-testid="watch-page">
      <WorkspaceHeader title={t('watch.nav')} status={status} />
      <WorkspaceGrid asideWidth={340} aside={aside}>
        {jobs.state.status === 'loading' ? (
          <Panel tone="lead" aria-busy aria-label={t('common.loading')}>
            <div className="flex flex-col gap-4">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex items-center gap-4">
                  <Skeleton className="size-9 rounded-sm" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-2/5 rounded-full" />
                    <Skeleton className="h-3 w-3/5 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ) : jobs.state.status === 'error' ? (
          <Panel tone="lead">
            <ErrorPanel message={jobs.state.message} onRetry={jobs.reload} />
          </Panel>
        ) : list.length === 0 ? (
          <Panel tone="lead">
            <EmptyState icon={<Binoculars />} title={t('watch.page.empty')} description={t('watch.page.emptyBody', { wake: shell.wakePhrase })} data-testid="watch-empty" />
          </Panel>
        ) : (
          <>
            <Panel tone="lead" padding="none" title={t('watch.page.active')} count={active.length}>
              {active.length === 0 ? (
                <p className="px-6 pt-2 pb-6 text-sm text-fg-muted" data-testid="watch-active-empty">
                  {t('watch.page.activeEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col pb-1" data-testid="watch-active">
                  <AnimatePresence initial={false}>
                    {active.map((job, index) => (
                      <JobRow key={job.id} job={job} sources={known} index={index} onCancel={setCancelling} />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Panel>
            {finished.length > 0 && (
              <Panel tone="base" padding="none" title={t('watch.page.finished')} count={finished.length}>
                <ul className="flex flex-col pb-1" data-testid="watch-finished">
                  <AnimatePresence initial={false}>
                    {finished.map((job, index) => (
                      <JobRow key={job.id} job={job} sources={known} index={index} onCancel={setCancelling} />
                    ))}
                  </AnimatePresence>
                </ul>
              </Panel>
            )}
          </>
        )}
      </WorkspaceGrid>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={t('watch.page.cancelTitle')}
        body={cancelling ? t('watch.page.cancelBody', { title: cancelling.title }) : ''}
        confirmLabel={t('watch.page.cancel')}
        onConfirm={async () => {
          if (cancelling) await attempt(() => window.fuber.invoke('watch.cancel', { id: cancelling.id }));
        }}
      />
    </Workspace>
  );
}

export default definePage({
  id: 'watch',
  titleKey: 'watch.nav',
  icon: Binoculars,
  // Ray: Planlar (40) · Toplantı (44) · İşler (46) · Projeler (60).
  order: 46,
  moduleId: 'watch',
  Component: WatchPage,
});
