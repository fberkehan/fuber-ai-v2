// Ortam dinleme rıza ekranı: ne dinlenir, ne saklanır, ne kadar süre, kim görür, nasıl kapatılır; odadakiler için uyarı.
// Süs yok: her madde kullanıcının karar vermek için bilmesi gereken bir olgudur. Onay kutusu işaretlenmeden açılmaz.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChatCircleDots, Clock, Eye, FileText, Microphone, Power, UsersThree, type Icon } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, Checkbox, Dialog, toast } from '@fuber/ui';
import { useShell } from '../../../shell/context';
import { attempt } from '../../../shell/live';
import type { AmbientStatus } from '../../../../../main/modules/ambient/types';
import { RETENTION_DAYS } from './data';

function Point({ icon: IconComponent, title, children }: { icon: Icon; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-4 text-fg-muted">
        <IconComponent className="size-4.5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-base font-medium text-fg">{title}</h3>
        <div className="flex flex-col gap-1 text-sm text-fg-muted">{children}</div>
      </div>
    </div>
  );
}

export function ConsentDialog({ open, status, onClose }: { open: boolean; status: AmbientStatus | null; onClose: () => void }) {
  const shell = useShell();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);

  const days = status?.limits.retentionDays ?? 7;
  const brainLine =
    shell.brain === 'cloud' ? t('ambient.consent.who.cloud') : shell.brain === 'local' ? t('ambient.consent.who.local') : t('ambient.consent.who.none');

  const accept = async () => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('ambient.consent', { accept: true }));
    setBusy(false);
    if (!result) return;
    if (result.listening) toast.success(t('ambient.consent.done'));
    else toast.info(t('ambient.consent.doneNotListening', { reason: t(`ambient.reason.${result.reason}`) }));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('ambient.consent.title')}
      description={t('ambient.consent.lead', { name: shell.name })}
      size="lg"
      initialFocusRef={cancelRef}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} data-testid="ambient-consent-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!checked} loading={busy} onClick={() => void accept()} data-testid="ambient-consent-accept">
            {t('ambient.consent.accept')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5" data-testid="ambient-consent-dialog">
        <Point icon={Microphone} title={t('ambient.consent.what.title')}>
          <p>{t('ambient.consent.what.body')}</p>
        </Point>
        <Point icon={FileText} title={t('ambient.consent.stored.title')}>
          <p>{t('ambient.consent.stored.body')}</p>
        </Point>
        <Point icon={Clock} title={t('ambient.consent.duration.title')}>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            <li>{t('ambient.consent.duration.transcript', { days })}</li>
            <li>{t('ambient.consent.duration.notes', { casual: RETENTION_DAYS.casualNote, important: RETENTION_DAYS.importantNote })}</li>
            <li>{t('ambient.consent.duration.reports', { daily: RETENTION_DAYS.dailyReport })}</li>
            <li>{t('ambient.consent.duration.issues', { days: RETENTION_DAYS.closedIssue })}</li>
          </ul>
          <p>{t('ambient.consent.duration.delete')}</p>
        </Point>
        <Point icon={Eye} title={t('ambient.consent.who.title')}>
          <p>{t('ambient.consent.who.body')}</p>
          <p className="text-fg" data-testid="ambient-consent-brain">
            {brainLine}
          </p>
        </Point>
        <Point icon={ChatCircleDots} title={t('ambient.consent.interject.title')}>
          <p>{t('ambient.consent.interject.body', { name: shell.name })}</p>
        </Point>
        <Point icon={Power} title={t('ambient.consent.stop.title')}>
          <p>{t('ambient.consent.stop.body')}</p>
        </Point>

        <div className="flex gap-3.5 rounded-sm border border-warning/30 bg-warning-soft px-4 py-3.5">
          <UsersThree className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-base font-medium text-fg">{t('ambient.consent.others.title')}</h3>
            <p className="text-sm text-fg-muted">{t('ambient.consent.others.body')}</p>
          </div>
        </div>

        <Checkbox
          checked={checked}
          onCheckedChange={setChecked}
          label={t('ambient.consent.check')}
          description={t('ambient.consent.checkHint')}
          data-testid="ambient-consent-check"
        />
      </div>
    </Dialog>
  );
}
