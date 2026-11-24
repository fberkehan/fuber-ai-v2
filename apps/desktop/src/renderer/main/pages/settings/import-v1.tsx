// Ayarlar › Gizlilik ve veri › "Eski Fuber AI'den aktar": durum → önizleme (yalnız sayılar) → tür seçimi → aktarım → sonuç / geri al.
import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, ClockCounterClockwise, DownloadSimple, MagnifyingGlass } from '@phosphor-icons/react';
import { relativeTime, t } from '@fuber/shared';
import { Badge, Button, Checkbox, Dialog, Spinner, toast } from '@fuber/ui';
import type {
  ImportV1Options,
  ImportV1Phase,
  ImportV1Preview,
  ImportV1Result,
  ImportV1RunSummary,
  ImportV1Status,
} from '../../../../main/modules/import-v1/types';
import { attempt, errorText, useEvent } from '../../shell/live';
import { Group, SettingRow as Row, type Span } from './kit';

const DEFAULTS: ImportV1Options = {
  memories: true,
  reminders: true,
  pastRemindersAsNotes: false,
  todos: true,
  doneTodos: false,
  issues: true,
  includePrivate: false,
};

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;

/** "8 hafıza, 5 hatırlatıcı aktarıldı. Atlananlar: 2 gizli kayıt, …" */
export function summaryLines(summary: Pick<ImportV1Result, 'imported' | 'skipped'>): { imported: string; skipped: string | null } {
  const parts = (entries: Array<[number, string]>) => entries.filter(([n]) => n > 0).map(([count, key]) => t(key, { count }));
  const imported = parts([
    [summary.imported.memories, 'importV1.result.memories'],
    [summary.imported.reminders, 'importV1.result.reminders'],
    [summary.imported.todos, 'importV1.result.todos'],
    [summary.imported.issueNotes, 'importV1.result.issueNotes'],
    [summary.imported.pastReminderNotes, 'importV1.result.pastReminderNotes'],
  ]);
  const skipped = parts([
    [summary.skipped.private, 'importV1.result.private'],
    [summary.skipped.secrets, 'importV1.result.secrets'],
    [summary.skipped.duplicates, 'importV1.result.duplicates'],
    [summary.skipped.invalid, 'importV1.result.invalid'],
  ]);
  return {
    imported: imported.length ? t('importV1.result.imported', { list: imported.join(', ') }) : t('importV1.result.none'),
    skipped: skipped.length ? t('importV1.result.skipped', { list: skipped.join(', ') }) : null,
  };
}

interface Choice {
  key: keyof ImportV1Options;
  label: string;
  body: string;
  count: number;
  disabled?: boolean;
}

function choices(preview: ImportV1Preview): Choice[] {
  const noPlanner = !preview.plannerReady;
  const privateCount = preview.memories.private + preview.reminders.private + preview.todos.private + preview.issues.private;
  const list: Choice[] = [
    { key: 'memories', label: t('importV1.type.memories'), body: t('importV1.type.memoriesBody', { count: preview.memories.active }), count: preview.memories.active },
    { key: 'reminders', label: t('importV1.type.reminders'), body: t('importV1.type.remindersBody', { count: preview.reminders.upcoming }), count: preview.reminders.upcoming, disabled: noPlanner },
    { key: 'pastRemindersAsNotes', label: t('importV1.type.pastReminders'), body: t('importV1.type.pastRemindersBody', { count: preview.reminders.past }), count: preview.reminders.past },
    { key: 'todos', label: t('importV1.type.todos'), body: t('importV1.type.todosBody', { count: preview.todos.open }), count: preview.todos.open, disabled: noPlanner },
    { key: 'doneTodos', label: t('importV1.type.doneTodos'), body: t('importV1.type.doneTodosBody', { count: preview.todos.done }), count: preview.todos.done, disabled: noPlanner },
    { key: 'issues', label: t('importV1.type.issues'), body: t('importV1.type.issuesBody', { count: preview.issues.open }), count: preview.issues.open },
    { key: 'includePrivate', label: t('importV1.type.private'), body: t('importV1.type.privateBody', { count: privateCount }), count: privateCount },
  ];
  // Hiç kaydı olmayan tür gösterilmez; gösterilmeyen tür seçili de sayılmaz.
  return list.filter((choice) => choice.count > 0);
}

export function ImportV1Section({ span }: { span?: Span }) {
  const [status, setStatus] = useState<ImportV1Status | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [preview, setPreview] = useState<ImportV1Preview | null>(null);
  const [options, setOptions] = useState<ImportV1Options>(DEFAULTS);
  const [busy, setBusy] = useState<'preview' | 'run' | 'undo' | null>(null);
  const [phase, setPhase] = useState<{ phase: ImportV1Phase; total: number } | null>(null);
  const [result, setResult] = useState<ImportV1Result | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<ImportV1RunSummary | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const loadStatus = async () => {
    try {
      setStatus(await window.fuber.invoke('import-v1.status', {}));
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  };
  useEffect(() => void loadStatus(), []);
  useEvent('import-v1.progress', (payload) => setPhase(payload.phase === 'done' ? null : { phase: payload.phase, total: payload.total }));

  const runPreview = async () => {
    setBusy('preview');
    setResult(null);
    const next = await attempt(() => window.fuber.invoke('import-v1.preview', {}));
    setBusy(null);
    if (!next) return;
    setPreview(next);
    const shown = new Set(choices(next).map((choice) => choice.key));
    setOptions((current) => {
      const narrowed = { ...current };
      for (const key of Object.keys(narrowed) as Array<keyof ImportV1Options>) if (!shown.has(key)) narrowed[key] = false;
      return narrowed;
    });
  };

  const runImport = async () => {
    setBusy('run');
    try {
      const done = await window.fuber.invoke('import-v1.run', { options });
      setResult(done);
      setPreview(null);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
      setPhase(null);
      await loadStatus();
    }
  };

  const runUndo = async (run: ImportV1RunSummary) => {
    setConfirmUndo(null);
    setBusy('undo');
    const undone = await attempt(() => window.fuber.invoke('import-v1.undo', { runId: run.id }));
    setBusy(null);
    if (undone) {
      toast.success(undone.alreadyGone ? t('importV1.undo.doneGone', { removed: undone.removed, gone: undone.alreadyGone }) : t('importV1.undo.done', { removed: undone.removed }));
      setResult(null);
    }
    await loadStatus();
  };

  const list = preview ? choices(preview) : [];
  const anySelected = list.some((choice) => choice.key !== 'includePrivate' && options[choice.key] && !choice.disabled);
  const already = preview ? Object.values(preview.alreadyImported).reduce((a, b) => a + b, 0) : 0;
  const tableProblems = preview?.tables.filter((table) => table.state !== 'ok') ?? [];
  const last = status?.lastRun ?? null;
  const shownResult = result ? summaryLines(result) : null;

  return (
    <>
      <Group span={span} title={t('importV1.title')} description={t('importV1.description')} testId="import-v1">
        {unavailable ? (
          <Row label={t('importV1.status.label')} description={t('importV1.unavailable')} testId="import-v1-unavailable" />
        ) : (
          <Row
            label={t('importV1.status.label')}
            description={
              status === null ? (
                t('common.loading')
              ) : status.found ? (
                <span className="break-all" data-selectable>
                  {t('importV1.status.foundBody', { dir: status.dir ?? '', size: megabytes(status.bytes), when: status.modifiedAt ? relativeTime(status.modifiedAt) : '–' })}
                </span>
              ) : (
                t('importV1.status.notFoundBody')
              )
            }
            testId="import-v1-status"
          >
            {status && (
              <Badge tone={status.found ? 'success' : 'neutral'} dot data-state={status.found ? 'found' : 'missing'}>
                {status.found ? t('importV1.status.found') : t('importV1.status.notFound')}
              </Badge>
            )}
          </Row>
        )}

        {status?.found && !preview && (
          <Row label={t('importV1.preview.title')} description={busy === 'preview' ? t('importV1.preview.running') : t('importV1.preview.hint')}>
            <Button icon={<MagnifyingGlass />} loading={busy === 'preview'} disabled={busy !== null} onClick={() => void runPreview()} data-testid="import-v1-preview">
              {t('importV1.preview.button')}
            </Button>
          </Row>
        )}

        {preview && (
          <div className="flex flex-col py-4" data-st-row="" data-testid="import-v1-choices">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-base font-medium text-fg">{t('importV1.preview.title')}</span>
              {preview.schemaVersion !== null && <span className="text-sm text-fg-muted">{t('importV1.preview.schema', { version: preview.schemaVersion })}</span>}
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {list.map((choice) => (
                <Checkbox
                  key={choice.key}
                  checked={options[choice.key] && !choice.disabled}
                  disabled={choice.disabled || busy !== null}
                  onCheckedChange={(checked) => setOptions((current) => ({ ...current, [choice.key]: checked }))}
                  label={choice.label}
                  description={choice.body}
                  data-testid={`import-v1-opt-${choice.key}`}
                />
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-1 text-sm text-fg-muted">
              {!preview.plannerReady && <span>{t('importV1.type.plannerMissing')}</span>}
              {tableProblems.map((table) => (
                <span key={table.table} data-testid={`import-v1-table-${table.table}`}>
                  {table.state === 'missing'
                    ? t('importV1.table.missing', { table: t(`importV1.table.${table.table}`) })
                    : t('importV1.table.incompatible', { table: t(`importV1.table.${table.table}`), columns: table.missingColumns.join(', ') })}
                </span>
              ))}
              {(preview.issues.closed > 0 || preview.memories.deletedOrArchived > 0) && (
                <span>{t('importV1.type.closedIssues', { count: preview.issues.closed, deleted: preview.memories.deletedOrArchived })}</span>
              )}
              {already > 0 && <span data-testid="import-v1-already">{t('importV1.type.already', { count: already })}</span>}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={<DownloadSimple />} loading={busy === 'run'} disabled={!anySelected || busy !== null} onClick={() => void runImport()} data-testid="import-v1-run">
                {t('importV1.run.button')}
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => void runPreview()}>
                {t('importV1.preview.again')}
              </Button>
              {busy === 'run' && phase && (
                <span className="flex items-center gap-2 text-sm text-fg-muted" role="status" data-testid="import-v1-phase">
                  <Spinner size={14} />
                  {t(`importV1.run.phase.${phase.phase}`, { total: phase.total })}
                </span>
              )}
              {!anySelected && <span className="text-sm text-fg-muted">{t('importV1.run.nothing')}</span>}
            </div>
          </div>
        )}

        {shownResult && result && (
          <div className="flex flex-col gap-1 py-4" role="status" data-testid="import-v1-result">
            <span className="text-base font-medium text-fg">{t('importV1.result.title')}</span>
            <span className="text-lg text-fg" data-testid="import-v1-result-imported">{shownResult.imported}</span>
            {shownResult.skipped && <span className="text-sm text-fg-muted" data-testid="import-v1-result-skipped">{shownResult.skipped}</span>}
            {result.tableErrors.map((error) => (
              <span key={error.table + error.message} className="text-sm text-warning">
                {error.message}
              </span>
            ))}
          </div>
        )}

        {last && last.undoable > 0 && (
          <Row
            label={t('importV1.result.last', { when: relativeTime(last.finishedAt) })}
            description={summaryLines(last).imported}
            testId="import-v1-last"
          >
            <Button icon={busy === 'undo' ? <ClockCounterClockwise /> : <ArrowCounterClockwise />} loading={busy === 'undo'} disabled={busy !== null} onClick={() => setConfirmUndo(last)} data-testid="import-v1-undo">
              {t('importV1.undo.button')}
            </Button>
          </Row>
        )}
      </Group>

      <Dialog
        open={confirmUndo !== null}
        onOpenChange={(open) => !open && setConfirmUndo(null)}
        title={t('importV1.undo.title')}
        description={confirmUndo ? t('importV1.undo.body', { count: confirmUndo.undoable }) : undefined}
        role="alertdialog"
        size="sm"
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setConfirmUndo(null)}>
              {t('importV1.undo.cancel')}
            </Button>
            <Button variant="danger" onClick={() => confirmUndo && void runUndo(confirmUndo)} data-testid="import-v1-undo-confirm">
              {t('importV1.undo.confirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
