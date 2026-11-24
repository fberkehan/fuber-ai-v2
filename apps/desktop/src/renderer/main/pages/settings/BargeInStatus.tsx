// Söz kesme durumu (Ayarlar › Ses ve Tanı): konuşarak kesme açık mı, kapalıysa neden ve nasıl yeniden açılır.
// Kapalıysa uyarı tonunda (kırmızı değil) bir kutu; "sınamayı çalıştır" düğmesi var olan söz kesme sınamasını koşar.
import { useEffect } from 'react';
import { Waveform } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button } from '@fuber/ui';
import { useBargeTest } from '../../../voice-tests';
import { useShell } from '../../shell/context';
import { acceleratorKeys } from '../../shell/live';

export function BargeInStatus({ onDone }: { onDone?: () => void }) {
  const shell = useShell();
  const barge = useBargeTest();
  const policy = shell.policy?.voice.bargeIn ?? shell.voice?.bargeIn ?? 'voice';
  const reason = shell.voice?.bargeInBlockedBy ?? null;
  const talk = shell.hotkeys.find((hotkey) => hotkey.id === 'talk');
  const hotkey = talk ? acceleratorKeys(talk.accelerator).join('+') : '';
  const ready = (shell.voice?.ready ?? false) && !shell.voice?.micMuted;

  const run = () => {
    barge.start();
  };
  // Sınama bitince durum (ve tanı) yeniden okunur.
  useEffect(() => {
    if (barge.phase === 'done') onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barge.phase]);

  if (policy !== 'voice') {
    return (
      <p className="text-sm text-fg-muted" data-st-row="" data-testid="bargein-status" data-state={policy}>
        {t(policy === 'wake' ? 'bargein.policyWake' : 'bargein.policyOff')}
      </p>
    );
  }
  if (!reason) {
    return (
      <p className="text-sm text-fg-muted" data-st-row="" data-testid="bargein-status" data-state="ok">
        {t('bargein.ok')}
      </p>
    );
  }
  const note = barge.phase === 'running' ? t('voice.bargeTest.running') : barge.phase === 'done' ? (barge.result?.message ?? null) : barge.phase === 'failed' ? barge.error : null;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-soft p-4" role="status" data-st-row="" data-testid="bargein-status" data-state="blocked" data-reason={reason}>
      <div className="flex flex-col gap-1">
        <span className="text-base font-medium text-fg">{t('bargein.blocked.title')}</span>
        <span className="text-sm text-fg">{t(`bargein.blocked.${reason}`)}</span>
        <span className="text-sm text-fg-muted">{t('bargein.blocked.how', { name: shell.name, hotkey })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" icon={<Waveform />} loading={barge.phase === 'running'} disabled={!ready} onClick={run} data-testid="bargein-blocked-run">
          {t('bargein.blocked.run')}
        </Button>
        {note ? <span className="min-w-0 flex-1 basis-48 text-sm text-fg-muted">{note}</span> : null}
      </div>
    </div>
  );
}
