// Raporlar: günlük, haftalık, aylık. Her katman bir alttakinin özetinden yazılır; ham döküm rapora girmez.
// Birincil kutu seçili rapordur (belge gibi okunur); bağlam sütununda dinleme durumu ve dönemler durur.
import { useState } from 'react';
import { CaretLeft, CaretRight, FileText, Smiley, Trash } from '@phosphor-icons/react';
import { localDay, t } from '@fuber/shared';
import { Button, Chip, IconButton, Panel, WorkspaceGrid, toast } from '@fuber/ui';
import { attempt, errorText, useLive } from '../../../shell/live';
import { ConfirmDialog, ErrorPanel } from '../../../shell/parts';
import type { AmbientReport, AmbientStatus, ReportKind } from '../../../../../main/modules/ambient/types';
import { ContextCard, ContextSection } from '../page-parts';
import { AmbientGate, AmbientSkeleton } from './Gate';
import { AMBIENT_EVENTS, periodLabel, type GateState } from './data';

const KINDS: ReportKind[] = ['daily', 'weekly', 'monthly'];

function Lines({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold tracking-normal text-fg">{title}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-base text-fg-muted marker:text-fg-faint">
        {items.map((line, index) => (
          <li key={index} className="max-w-[68ch]" data-selectable>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Raporun gövdesi: dönem, başlık, özet (okuma ölçüsünde) ve bölümler. Geniş kutuda iki sütun okunur:
 * solda ne olduğu (önemli, kararlar, gündelik), sağda ne beklediği (bekleyenler, sırada).
 */
function ReportBody({ report, onDelete }: { report: AmbientReport; onDelete: () => void }) {
  const waiting = report.openIssues.length + report.next.length > 0;
  return (
    <article className="flex max-w-[920px] flex-col gap-6 px-5 pt-4 pb-6" data-testid="ambient-report" data-id={report.id} data-kind={report.kind} data-period={report.period}>
      <header className="flex min-w-0 flex-col gap-1">
        {/* Silme raporun kendi başlık satırındadır (neyi sildiği belli). */}
        <div className="flex min-h-7 items-center justify-between gap-3">
          <span className="text-sm text-fg-muted">{periodLabel(report.kind, report.period)}</span>
          <span className="-mr-1.5 flex">
            <IconButton icon={<Trash />} label={t('ambient.ui.reports.delete')} size="sm" onClick={onDelete} data-testid="ambient-report-delete" />
          </span>
        </div>
        <h2 className="text-2xl text-fg" data-selectable data-testid="ambient-report-title">
          {report.title}
        </h2>
        {report.summary && (
          <p className="mt-2 max-w-[68ch] text-lg text-fg" data-selectable>
            {report.summary}
          </p>
        )}
      </header>
      <div className="mem-report-grid">
        <div className="flex flex-col gap-6">
          <Lines title={t('ambient.ui.reports.important')} items={report.important} />
          <Lines title={t('ambient.ui.reports.decisions')} items={report.decisions} />
          <Lines title={t('ambient.ui.reports.casual')} items={report.casual} />
        </div>
        {waiting && (
          <div className="flex flex-col gap-6">
            <Lines title={t('ambient.ui.reports.open')} items={report.openIssues} />
            <Lines title={t('ambient.ui.reports.next')} items={report.next} />
          </div>
        )}
      </div>
      <footer className="flex flex-col gap-2 border-t border-line pt-4">
        {report.joke && (
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <Smiley className="mt-0.5 size-4 shrink-0 text-fg-faint" aria-hidden />
            <span data-selectable>{report.joke}</span>
          </p>
        )}
        <p className="text-xs text-fg-faint">{t('ambient.ui.reports.basis', { count: report.itemCount })}</p>
      </footer>
    </article>
  );
}

export function ReportsTab({ state, status }: { state: GateState; status: AmbientStatus | null }) {
  const [kind, setKind] = useState<ReportKind>('daily');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [removing, setRemoving] = useState<AmbientReport | null>(null);
  const all = useLive<AmbientReport[]>(() => window.fuber.invoke('ambient.reports', { limit: 120 }), AMBIENT_EVENTS);

  // `null` = dönemde not yok (hata değil). `attempt` hatayı da null'a çevirdiği için burada kullanılmaz.
  const buildToday = async () => {
    setBuilding(true);
    try {
      const report = await window.fuber.invoke('ambient.buildReport', { kind: 'daily' });
      if (report) {
        setKind('daily');
        setPickedId(report.id);
        toast.success(t('ambient.ui.reports.built'));
      } else {
        toast.info(t('ambient.ui.reports.noNotes'));
      }
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBuilding(false);
    }
  };

  if (all.state.status === 'loading') return <AmbientSkeleton />;
  if (all.state.status === 'error') return <ErrorPanel message={all.state.message} onRetry={all.reload} />;

  const reports = all.data ?? [];
  if (reports.length === 0) {
    return (
      <div data-testid="ambient-reports">
        <AmbientGate
          state={state}
          status={status}
          variant="full"
          empty={{ icon: <FileText />, title: t('ambient.ui.reports.empty.title'), body: t('ambient.ui.reports.empty.body', { time: status?.prefs.reportTime ?? '21:30' }) }}
          extra={
            state === 'on' || state === 'off' ? (
              <Button loading={building} onClick={() => void buildToday()} data-testid="ambient-report-build">
                {t('ambient.ui.reports.build')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const shown = reports.filter((report) => report.kind === kind);
  const current = shown.find((report) => report.id === pickedId) ?? shown[0] ?? null;
  // Raporlar yeniden eskiye sıralı gelir: "önceki" listede bir sonraki öğedir.
  const position = current ? shown.findIndex((report) => report.id === current.id) : -1;
  const older = position >= 0 ? (shown[position + 1] ?? null) : null;
  const newer = position > 0 ? (shown[position - 1] ?? null) : null;
  const hasToday = reports.some((report) => report.kind === 'daily' && report.period === localDay());
  return (
    <div data-testid="ambient-reports">
      <WorkspaceGrid
        asideWidth={348}
        aside={
          <>
            <ContextCard>
              <ContextSection title={t(`ambient.ui.reports.list.${kind}`)} count={shown.length}>
                {shown.length === 0 ? (
                  <p className="text-sm text-fg-faint">{t(`ambient.ui.reports.none.${kind}`)}</p>
                ) : (
                  <ul className="flex flex-col" data-testid="ambient-report-list">
                    {shown.map((report) => (
                      <li key={report.id}>
                        <button type="button" className="ctx-link flex-col items-stretch gap-0.5" aria-current={report.id === current?.id} onClick={() => setPickedId(report.id)} data-testid="ambient-report-pick">
                          <span className="text-xs text-fg-faint">{periodLabel(report.kind, report.period)}</span>
                          <span className="line-clamp-2 text-sm text-fg">{report.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </ContextSection>
              <AmbientGate state={state} status={status} variant="strip" />
            </ContextCard>
          </>
        }
      >
        <Panel tone="lead" padding="none">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3.5">
            <div className="-ml-2 flex items-center">
              <IconButton icon={<CaretLeft />} label={t('ambient.ui.reports.older')} size="sm" disabled={!older} onClick={() => older && setPickedId(older.id)} data-testid="ambient-report-older" />
              <IconButton icon={<CaretRight />} label={t('ambient.ui.reports.newer')} size="sm" disabled={!newer} onClick={() => newer && setPickedId(newer.id)} data-testid="ambient-report-newer" />
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="group" aria-label={t('ambient.ui.reports.filter')}>
              {KINDS.map((option) => (
                <Chip key={option} selected={kind === option} onClick={() => setKind(option)} data-testid={`ambient-reports-filter-${option}`}>
                  {t(`ambient.ui.reports.kind.${option}`)}
                </Chip>
              ))}
            </div>
            <Button size="sm" loading={building} onClick={() => void buildToday()} data-testid="ambient-report-build">
              {t(hasToday ? 'ambient.ui.reports.rebuild' : 'ambient.ui.reports.build')}
            </Button>
          </div>
          {current ? <ReportBody report={current} onDelete={() => setRemoving(current)} /> : <p className="max-w-[64ch] px-5 py-8 text-base text-fg-muted">{t(`ambient.ui.reports.none.${kind}`)}</p>}
        </Panel>
      </WorkspaceGrid>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('ambient.ui.reports.deleteTitle')}
        body={t('ambient.ui.reports.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (!removing) return;
          const done = await attempt(() => window.fuber.invoke('ambient.deleteReport', { id: removing.id }));
          if (done) toast.success(t('ambient.ui.reports.deleted'));
        }}
      />
    </div>
  );
}
