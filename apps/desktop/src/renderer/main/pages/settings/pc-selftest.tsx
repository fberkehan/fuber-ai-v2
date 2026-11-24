// Ayarlar › Gizlilik › Bilgisayar kullanımı › "Fare ve klavye sınaması": GERÇEK girdinin kullanıcının başlattığı kanıtı.
// Düğmeye basınca bilgisayar modülü Not Defteri'ni kendi geçici dosyasıyla açar; adımlar `pc.selftest.progress` olayıyla
// tek tek gelir, sonuç kanalın yanıtıdır. Sınama sürerken fareye/klavyeye dokunmak onu durdurur (asıl kural da budur).
import { useState } from 'react';
import { CheckCircle, MinusCircle, Warning, XCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button } from '@fuber/ui';
import { useEvent } from '../../shell/live';
import type { SelftestReport, SelftestStatus, SelftestStep, SelftestStepId } from '../../../../main/modules/pc/types';

/** Adımların sırası (`modules/pc/selftest.ts` › `SELFTEST_STEPS` ile aynı). */
const STEPS: readonly SelftestStepId[] = ['prepare', 'open', 'focus', 'survey', 'wait', 'click', 'type', 'select', 'paste', 'uia', 'move', 'close', 'cleanup'];

/** Adım süresi (0,4 sn): hangi adımın ne kadar sürdüğü sonuç ekranında görünür. */
const seconds = (ms: number): string => (ms / 1000).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Mark({ status }: { status: SelftestStatus | 'pending' | 'running' }) {
  if (status === 'ok') return <CheckCircle weight="fill" className="size-4.5 shrink-0 text-success" aria-hidden />;
  if (status === 'warn') return <Warning weight="fill" className="size-4.5 shrink-0 text-warning" aria-hidden />;
  if (status === 'fail') return <XCircle weight="fill" className="size-4.5 shrink-0 text-danger" aria-hidden />;
  if (status === 'skipped') return <MinusCircle className="size-4.5 shrink-0 text-fg-muted" aria-hidden />;
  return <span className={`size-2 shrink-0 rounded-full ${status === 'running' ? 'bg-accent' : 'bg-line'} mx-[5px]`} aria-hidden />;
}

export function PcSelftest({ enabled }: { enabled: boolean }) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<SelftestStep[]>([]);
  const [report, setReport] = useState<SelftestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEvent('pc.selftest.progress', ({ index, step }) => {
    setSteps((current) => {
      const next = current.slice(0, index);
      next[index] = step;
      return next;
    });
  });

  const start = async () => {
    setRunning(true);
    setSteps([]);
    setReport(null);
    setError(null);
    try {
      const result = await window.fuber.invoke('pc.selftest.run');
      setReport(result);
      if (result.steps.length > 0) setSteps(result.steps);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const shown = running || steps.length > 0;
  const summary = report?.unavailable
    ? report.unavailable
    : report
      ? t(report.ok ? 'pc.selftest.passed' : 'pc.selftest.failed', { seconds: Math.round(report.ms / 1000) }) + (report.stopped ? ` ${t(`pc.selftest.stopped.${report.stopped}`)}` : '')
      : null;

  return (
    // Satır, kutunun çok sütunlu ızgarasında tam genişlik kaplar (adım listesi dar hücreye sığmaz).
    <div className="st-row col-span-full" data-st-row="" data-st-keywords={t('settings.kw.selftest')} data-testid="settings-pc-selftest">
      <div className="st-row-text">
        <span className="st-row-label">{t('pc.selftest.title')}</span>
        <span className="st-row-desc">{t(enabled ? 'pc.selftest.hint' : 'pc.selftest.needPermission')}</span>
      </div>
      <div className="st-row-control">
        <Button size="sm" onClick={() => void start()} disabled={!enabled || running} data-testid="settings-pc-selftest-start">
          {running ? t('pc.selftest.runningLabel') : t('pc.selftest.start')}
        </Button>
      </div>
      {(summary || error) && (
        <p className="st-row-note" data-tone={report?.ok ? 'success' : 'warning'} role="status" data-testid="settings-pc-selftest-summary">
          {error ?? summary}
        </p>
      )}
      {shown && (
        <ol className="flex flex-[1_0_100%] flex-col gap-2" data-testid="settings-pc-selftest-steps">
          {STEPS.map((id, index) => {
            const step = steps[index];
            const status = step?.status ?? (running && index === steps.length ? 'running' : 'pending');
            return (
              <li key={id} className="flex items-start gap-3 text-sm" data-step={id} data-status={status}>
                <span className="mt-0.5 flex w-4.5 justify-center">
                  <Mark status={status} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={step ? 'text-fg' : 'text-fg-muted'}>{t(`pc.selftest.step.${id}`)}</span>
                  {step && <span className="text-fg-muted">{step.detail}</span>}
                </span>
                {step && step.status !== 'skipped' && (
                  <span className="shrink-0 tabular-nums text-fg-muted" data-testid="settings-pc-selftest-ms">
                    {t('pc.selftest.stepTime', { seconds: seconds(step.ms) })}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
