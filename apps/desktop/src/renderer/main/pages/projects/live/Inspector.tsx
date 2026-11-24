// Denetçi (v1 `Denetci.tsx` + `ArkaIsler.tsx`): değişen dosyalar + git özeti + dosya farkı, yapılacaklar, arka plan işleri,
// kullanım ve oturum bilgisi.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@fuber/shared';
import { Badge, Button, Dialog, IconButton, Skeleton, Spinner, toast, cn } from '@fuber/ui';
import { ArrowLineDown, ArrowsClockwise, CaretRight, CheckCircle, Copy, GitBranch, Prohibit, ShieldWarning, Stop, WarningCircle, XCircle } from '@phosphor-icons/react';
import type { BackgroundTask, GitSummary, LiveSessionDetail } from '../../../../../main/modules/projects/claude/types';
import { errorText, fuber, MiddlePath } from '../shared';
import { SectionTitle } from './controls';
import { parseUnifiedDiff, type DiffFile } from './diff';
import { DiffView } from './DiffView';
import { baseName, dirName, formatCost, formatDuration, formatTokens, relativePath } from './format';
import { TodoList } from './Transcript';

interface FileEntry {
  path: string;
  status: string;
}

/**
 * "Bu oturumda" = motorun saydığı, bu oturumda başarıyla biten düzenlemeler (git durumu varsa onunla, yoksa "M");
 * "Depodaki diğer değişiklikler" = git durumunun geri kalanı.
 */
export function groupFiles(git: GitSummary | null, sessionFiles: readonly string[], cwd: string): { session: FileEntry[]; other: FileEntry[] } {
  const byPath = new Map((git?.git ? git.files : []).map((file) => [file.path.toLowerCase(), file]));
  const seen = new Set<string>();
  const session: FileEntry[] = [];
  for (const file of sessionFiles) {
    const relative = relativePath(file, cwd);
    const key = relative.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const known = byPath.get(key);
    session.push({ path: known?.path ?? relative, status: known?.status ?? 'M' });
  }
  const other = (git?.git ? git.files : []).filter((file) => !seen.has(file.path.toLowerCase())).sort((a, b) => a.path.localeCompare(b.path));
  return { session, other };
}

const statusTone = (status: string) => {
  const code = status.replace(/\s/g, '')[0] ?? 'M';
  return code === 'A' || code === '?' ? 'text-success' : code === 'D' ? 'text-danger' : 'text-fg-muted';
};

function FileRows({ files, onOpen }: { files: FileEntry[]; onOpen(file: string): void }) {
  return (
    <ul className="flex flex-col">
      {files.map((file) => (
        <li key={file.path}>
          <button
            type="button"
            data-file={file.path}
            onClick={() => onOpen(file.path)}
            className="flex w-full min-w-0 items-baseline gap-2 rounded-xs px-1.5 py-1 text-left text-xs hover:bg-surface-3"
          >
            <span className={cn('w-5 shrink-0 font-mono', statusTone(file.status))}>{file.status.trim() || 'M'}</span>
            <span className="shrink-0 font-mono text-fg">{baseName(file.path)}</span>
            <span className="min-w-0 truncate font-mono text-fg-faint">{dirName(file.path)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DiffDialog({ sessionId, file, onClose }: { sessionId: string; file: string | null; onClose(): void }) {
  const [state, setState] = useState<{ files: DiffFile[]; truncated: boolean } | { error: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setState(null);
    fuber()
      .invoke('projects.claudeDiff', { id: sessionId, file })
      .then((result) => !cancelled && setState({ files: parseUnifiedDiff(result.diff), truncated: result.truncated }))
      .catch((cause) => !cancelled && setState({ error: errorText(cause) }));
    return () => {
      cancelled = true;
    };
  }, [sessionId, file]);
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()} size="lg" title={file ? baseName(file) : ''} description={file ?? ''}>
      {!state ? (
        <Skeleton shape="text" lines={6} />
      ) : 'error' in state ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : state.files.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('projects.live.inspector.noDiff')}</p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="live-diff">
          {state.files.map((entry, index) => (
            <div key={index} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs">
                {entry.created && <Badge size="sm" tone="success">{t('projects.live.inspector.created')}</Badge>}
                {entry.deleted && <Badge size="sm" tone="danger">{t('projects.live.inspector.deleted')}</Badge>}
                <span className="font-mono text-success">+{entry.added}</span>
                <span className="font-mono text-danger">−{entry.removed}</span>
              </div>
              {entry.binary ? (
                <p className="text-sm text-fg-muted">{t('projects.live.inspector.binary')}</p>
              ) : (
                entry.hunks.map((hunk, at) => <DiffView key={at} lines={hunk.lines} limit={400} />)
              )}
            </div>
          ))}
          {state.truncated && <p className="text-xs text-fg-faint">{t('projects.live.inspector.diffTruncated')}</p>}
        </div>
      )}
    </Dialog>
  );
}

function elapsedOf(task: BackgroundTask, now: number): number {
  if (task.status !== 'running') return (task.elapsedSec ?? Math.max(0, Math.round(((task.endedAt ?? now) - task.startedAt) / 1000))) * 1000;
  return Math.max((task.elapsedSec ?? 0) * 1000, now - task.startedAt);
}

function TaskRow({ sessionId, task }: { sessionId: string; task: BackgroundTask }) {
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<{ lines: string[]; bytes: number; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const running = task.status === 'running';

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Çıktı kuyruğu açıkken ve iş sürerken iki saniyede bir tazelenir.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () =>
      void fuber()
        .invoke('projects.claudeTaskOutput', { id: sessionId, taskId: task.id, lines: 40 })
        .then((result) => !cancelled && setOutput(result))
        .catch((cause) => !cancelled && setOutput({ lines: [], bytes: 0, error: errorText(cause) }));
    load();
    if (!running) return () => void (cancelled = true);
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, running, sessionId, task.id]);

  const act = async (channel: 'projects.claudeStopTask' | 'projects.claudeBackgroundTask') => {
    setBusy(true);
    try {
      const result = await fuber().invoke(channel, { id: sessionId, taskId: task.id });
      if (!result.ok && result.error) toast.error(result.error);
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li data-task={task.id} data-status={task.status} className="flex flex-col gap-1.5 rounded-sm bg-surface-2 px-2.5 py-2">
      <div className="flex items-center gap-2 text-xs">
        {running ? (
          <Spinner size={16} />
        ) : task.status === 'done' ? (
          <CheckCircle weight="fill" className="size-4 text-success" aria-hidden />
        ) : task.status === 'failed' ? (
          <XCircle weight="fill" className="size-4 text-danger" aria-hidden />
        ) : (
          <Prohibit className="size-4 text-fg-faint" aria-hidden />
        )}
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <CaretRight aria-hidden weight="bold" className={cn('size-3 shrink-0 text-fg-faint transition-transform duration-(--duration-fast)', open && 'rotate-90')} />
          <span className="min-w-0 truncate text-fg">{task.description}</span>
        </button>
        <span className="shrink-0 text-fg-faint tabular-nums">{formatDuration(elapsedOf(task, now))}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-fg-faint">
        <span>{t(`projects.live.task.kind.${task.kind}`)}</span>
        <span>·</span>
        <span>{running ? (task.backgrounded ? t('projects.live.task.background') : t('projects.live.task.foreground')) : t(`projects.live.task.status.${task.status}`)}</span>
        {task.lastTool && (
          <>
            <span>·</span>
            <span className="truncate">{task.lastTool}</span>
          </>
        )}
        <span className="flex-1" />
        {running && !task.backgrounded && task.toolUseId && (
          <IconButton size="sm" label={t('projects.live.task.toBackground')} icon={<ArrowLineDown />} disabled={busy} onClick={() => void act('projects.claudeBackgroundTask')} />
        )}
        {running && <IconButton size="sm" label={t('projects.live.task.stop')} icon={<Stop weight="fill" />} disabled={busy} onClick={() => void act('projects.claudeStopTask')} />}
      </div>
      {task.summary && <p className="pl-6 text-xs break-words text-fg-muted">{task.summary}</p>}
      {open && (
        <div className="pl-6">
          {!output ? (
            <Skeleton shape="text" lines={2} />
          ) : output.error ? (
            <p className="text-xs text-fg-faint">{output.error}</p>
          ) : output.lines.length === 0 ? (
            <p className="text-xs text-fg-faint">{t('projects.live.task.noOutput')}</p>
          ) : (
            <pre data-selectable className="max-h-56 overflow-auto rounded-sm bg-surface-2 px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-fg-muted">
              {output.lines.join('\n')}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <dt className="w-24 shrink-0 text-fg-faint">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-fg-muted" data-selectable>
        {children}
      </dd>
    </div>
  );
}

export function Inspector({ detail }: { detail: LiveSessionDetail }) {
  const [git, setGit] = useState<GitSummary | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [trusting, setTrusting] = useState(false);
  const request = useRef(0);

  const refreshGit = useCallback(() => {
    const current = ++request.current;
    setGitLoading(true);
    fuber()
      .invoke('projects.claudeGit', { id: detail.id })
      .then((summary) => current === request.current && setGit(summary))
      .catch(() => current === request.current && setGit(null))
      .finally(() => current === request.current && setGitLoading(false));
  }, [detail.id]);

  // Git özeti: oturum açılınca, değişen dosya sayısı değişince ve tur bitince tazelenir.
  useEffect(refreshGit, [refreshGit, detail.changedFiles, detail.status === 'running']);

  const groups = useMemo(() => groupFiles(git, detail.changedFilesList, detail.cwd), [git, detail.changedFilesList, detail.cwd]);
  const tasks = useMemo(() => [...detail.tasks].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt), [detail.tasks]);
  const usage = detail.usage;

  const trust = async () => {
    setTrusting(true);
    try {
      await fuber().invoke('projects.claudeTrust', { cwd: detail.cwd, decision: 'trust' });
      toast.success(t('projects.live.inspector.trusted'));
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setTrusting(false);
    }
  };

  return (
    <aside aria-label={t('projects.live.inspector.label')} data-testid="live-inspector" className="flex w-80 max-w-[45%] shrink-0 flex-col gap-5 overflow-y-auto border-l border-line px-4 py-4">
      <section className="flex flex-col gap-2" data-testid="live-changed-files" data-count={groups.session.length}>
        <SectionTitle
          aside={
            <>
              {git?.branch && (
                <span className="inline-flex items-center gap-1 font-mono text-xs text-fg-faint">
                  <GitBranch className="size-3.5" aria-hidden />
                  {git.branch}
                </span>
              )}
              <IconButton size="sm" label={t('projects.live.inspector.refresh')} icon={<ArrowsClockwise />} loading={gitLoading} onClick={refreshGit} />
            </>
          }
        >
          {t('projects.live.inspector.changed')}
        </SectionTitle>
        {groups.session.length === 0 ? <p className="text-xs text-fg-faint">{t('projects.live.inspector.noChanges')}</p> : <FileRows files={groups.session} onOpen={setDiffFile} />}
        {groups.other.length > 0 && (
          <>
            <span className="pt-1 text-xs text-fg-faint">{t('projects.live.inspector.otherChanges', { n: groups.other.length })}</span>
            <FileRows files={groups.other} onOpen={setDiffFile} />
          </>
        )}
        {git && !git.git && <p className="text-xs text-fg-faint">{t('projects.live.inspector.notGit')}</p>}
      </section>

      {detail.todos.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="live-todos">
          <SectionTitle>{t('projects.live.todo.title')}</SectionTitle>
          <TodoList items={detail.todos} />
        </section>
      )}

      {tasks.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="live-tasks">
          <SectionTitle>{t('projects.live.task.title')}</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {tasks.map((task) => (
              <TaskRow key={task.id} sessionId={detail.id} task={task} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionTitle>{t('projects.live.inspector.usage')}</SectionTitle>
        <dl className="flex flex-col gap-1">
          <Value label={t('projects.live.inspector.turns')}>{detail.turns ?? 0}</Value>
          <Value label={t('projects.live.inspector.duration')}>{formatDuration(detail.durationMs)}</Value>
          {usage && (
            <>
              <Value label={t('projects.live.inspector.tokensIn')}>{formatTokens(usage.input + usage.cacheRead + usage.cacheWrite)}</Value>
              <Value label={t('projects.live.inspector.tokensOut')}>{formatTokens(usage.output)}</Value>
              <Value label={t('projects.live.inspector.cache')}>{t('projects.live.inspector.cacheValue', { read: formatTokens(usage.cacheRead), write: formatTokens(usage.cacheWrite) })}</Value>
            </>
          )}
          {detail.costUsd !== undefined && <Value label={t('projects.live.inspector.cost')}>{formatCost(detail.costUsd)}</Value>}
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>{t('projects.live.inspector.info')}</SectionTitle>
        {detail.untrusted && (
          <div data-testid="live-untrusted" data-attention="" className="ui-card flex flex-col gap-2 rounded-sm border border-line bg-surface-2 px-4 py-3 text-xs text-fg">
            <span className="flex items-start gap-2">
              <ShieldWarning weight="fill" className="mt-px size-4 shrink-0 text-warning" aria-hidden />
              {t('projects.live.inspector.untrusted')}
            </span>
            <Button size="sm" variant="secondary" loading={trusting} className="self-start" onClick={() => void trust()}>
              {t('projects.live.inspector.trustFolder')}
            </Button>
          </div>
        )}
        {detail.error && (
          <p className="flex items-start gap-2 text-xs text-danger" data-selectable>
            <WarningCircle weight="fill" className="mt-px size-3.5 shrink-0" aria-hidden />
            {detail.error}
          </p>
        )}
        <dl className="flex flex-col gap-1">
          <Value label={t('projects.live.inspector.folder')}>
            <MiddlePath path={detail.cwd} />
          </Value>
          {detail.sessionId && (
            <Value label={t('projects.live.inspector.sessionId')}>
              <span className="inline-flex items-center gap-1">
                <span className="font-mono">{detail.sessionId.slice(0, 8)}…</span>
                <IconButton
                  size="sm"
                  label={t('projects.live.inspector.copyId')}
                  icon={<Copy />}
                  onClick={() => void navigator.clipboard.writeText(detail.sessionId ?? '').then(() => toast.success(t('projects.live.inspector.copied')))}
                />
              </span>
            </Value>
          )}
          {detail.activeModel && (
            <Value label={t('projects.live.inspector.model')}>
              <span className="font-mono">{detail.activeModel}</span>
            </Value>
          )}
          {detail.version && <Value label={t('projects.live.inspector.version')}>{detail.version}</Value>}
          <Value label={t('projects.live.inspector.source')}>{t(`projects.live.source.${detail.source}`)}</Value>
        </dl>
      </section>

      <DiffDialog sessionId={detail.id} file={diffFile} onClose={() => setDiffFile(null)} />
    </aside>
  );
}
