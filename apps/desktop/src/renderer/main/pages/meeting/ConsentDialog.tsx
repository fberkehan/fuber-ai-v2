// Toplantı modunun ilk kullanım rızası: ne yazılır, ne saklanır, ne kadar, kim görür; karşı taraf için uyarı.
// Ortam dinlemenin rıza ekranıyla aynı düzen; onay kutusu işaretlenmeden açılmaz.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Clock, Eye, FileText, Microphone, SpeakerHigh, UsersThree, type Icon } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, Checkbox, Dialog } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt } from '../../shell/live';
import { MEETING_RETENTION } from '../../../../main/modules/meeting/retention';
import type { MeetingStatus } from '../../../../main/modules/meeting/types';

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

export function ConsentDialog({ open, status, onClose, onAccepted }: { open: boolean; status: MeetingStatus | null; onClose: () => void; onAccepted?: () => void }) {
  const shell = useShell();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);
  const days = status?.retentionDays ?? 7;
  const brainLine = shell.brain === 'cloud' ? t('meeting.consent.who.cloud') : shell.brain === 'local' ? t('meeting.consent.who.local') : t('meeting.consent.who.none');

  const accept = async () => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('meeting.consent', { accept: true }));
    setBusy(false);
    if (!result) return;
    onClose();
    onAccepted?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('meeting.consent.title')}
      description={t('meeting.consent.lead', { name: shell.name })}
      size="lg"
      initialFocusRef={cancelRef}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} data-testid="meeting-consent-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!checked} loading={busy} onClick={() => void accept()} data-testid="meeting-consent-accept">
            {t('meeting.consent.accept')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5" data-testid="meeting-consent-dialog">
        <Point icon={Microphone} title={t('meeting.consent.what.title')}>
          <p>{t('meeting.consent.what.body')}</p>
        </Point>
        <Point icon={FileText} title={t('meeting.consent.stored.title')}>
          <p>{t('meeting.consent.stored.body')}</p>
        </Point>
        <Point icon={Clock} title={t('meeting.consent.duration.title')}>
          <p>{t('meeting.consent.duration.body', { days, summaryDays: MEETING_RETENTION.summaryDays })}</p>
        </Point>
        <Point icon={Eye} title={t('meeting.consent.who.title')}>
          <p>{t('meeting.consent.who.body')}</p>
          <p className="text-fg" data-testid="meeting-consent-brain">
            {brainLine}
          </p>
        </Point>
        <Point icon={SpeakerHigh} title={t('meeting.consent.silent.title')}>
          <p>{t('meeting.consent.silent.body', { name: shell.name })}</p>
        </Point>
        <div className="flex gap-3.5 rounded-sm border border-warning/30 bg-warning-soft px-4 py-3.5">
          <UsersThree className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-base font-medium text-fg">{t('meeting.consent.others.title')}</h3>
            <p className="text-sm text-fg-muted">{t('meeting.consent.others.body')}</p>
          </div>
        </div>
        <Checkbox checked={checked} onCheckedChange={setChecked} label={t('meeting.consent.check')} data-testid="meeting-consent-check" />
      </div>
    </Dialog>
  );
}
