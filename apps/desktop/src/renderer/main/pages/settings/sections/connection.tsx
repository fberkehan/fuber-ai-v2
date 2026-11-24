// Ayarlar › Bağlantı: Fuber Yönetim ile bağlantının durumu (birincil kutu), politika ve Yönetim'in belirlediği değerler.
import { useState } from 'react';
import { ArrowClockwise, Gear } from '@phosphor-icons/react';
import { relativeTime, t } from '@fuber/shared';
import { Button, cn, toast } from '@fuber/ui';
import { useShell } from '../../../shell/context';
import { attempt } from '../../../shell/live';
import { Column, Fact, Facts, Group, SectionGrid } from '../kit';

const STATE_DOT: Record<string, string> = { approved: 'bg-success', pending: 'bg-warning', offline: 'bg-warning', unregistered: 'bg-fg-faint', revoked: 'bg-danger' };

export function Connection() {
  const shell = useShell();
  const control = shell.status?.control;
  const policy = shell.policy;
  const [busy, setBusy] = useState(false);
  const connected = control?.state === 'approved';
  const bargeIn = shell.voice?.bargeIn ?? policy?.voice.bargeIn ?? 'voice';
  return (
    <SectionGrid>
      <Group tone="lead" span="lead" title={t('settings.connection.title')} description={t('settings.connection.hint')} keywords={t('settings.kw.connection')}>
        <div className="flex flex-col gap-5 pb-5" data-st-row="" data-testid="settings-control">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-3 text-xl leading-7 font-medium tracking-tight text-fg" data-state={control?.state}>
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', STATE_DOT[control?.state ?? 'offline'] ?? 'bg-fg-faint')} />
              {control ? t(`control.state.${control.state}`) : t('common.loading')}
            </span>
            {/* Bağlantı yokken neden ve ne olacağı açıkça söylenir; bağlıyken yalnız son eşitleme. */}
            {connected || !control ? (
              <p className="text-sm text-fg-muted">{control?.lastSyncAt ? t('settings.connection.synced', { when: relativeTime(control.lastSyncAt) }) : t('settings.connection.neverSynced')}</p>
            ) : (
              <p className="text-sm text-warning" role="status">
                {control.lastError ?? t(`control.state.${control.state}`)}{' '}
                <span className="text-fg-muted">
                  {t('settings.connection.offlineHint')}
                  {control.lastSyncAt ? ` ${t('settings.connection.synced', { when: relativeTime(control.lastSyncAt) })}.` : ''}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={connected ? 'secondary' : 'primary'}
              icon={<ArrowClockwise />}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const next = await attempt(() => (control?.state === 'unregistered' ? window.fuber.invoke('control.connect', {}) : window.fuber.invoke('control.refresh')));
                setBusy(false);
                if (next) (next.state === 'approved' ? toast.success : toast.info)(t(`control.state.${next.state}`));
              }}
              data-testid="settings-control-retry"
            >
              {connected ? t('settings.connection.sync') : t('common.retry')}
            </Button>
            <Button
              icon={<Gear />}
              onClick={async () => {
                const result = await attempt(() => window.fuber.invoke('control.launchAdmin'));
                if (result) (result.ok ? toast.success : toast.info)(result.message);
              }}
              data-testid="settings-open-admin"
            >
              {t('settings.connection.openAdmin')}
            </Button>
          </div>
        </div>
        <Facts min={150} className="pt-4">
          <Fact label={t('settings.connection.revision')}>
            <span className="tabular-nums">{control ? control.policyRevision : '–'}</span>
          </Fact>
          <Fact label={t('settings.connection.sourceLabel')}>{control ? t(`settings.connection.source.${control.policySource}`) : '…'}</Fact>
          <Fact label={t('settings.connection.url')}>
            <span className="font-mono text-sm break-all" data-selectable>
              {control?.url.replace(/^https?:\/\//, '') ?? '…'}
            </span>
          </Fact>
        </Facts>
      </Group>
      <Column span="rest">
        <Group title={t('settings.connection.managed')} description={t('settings.connection.managedHint')}>
          <Facts min={170}>
            <Fact label={t('settings.voice.wakePhrase')}>{shell.wakePhrase}</Fact>
            <Fact label={t('settings.connection.mode')}>{shell.settings?.privacyMode === 'private' ? t('settings.privacy.private') : t('settings.privacy.cloud')}</Fact>
            <Fact label={t('settings.voice.bargeIn')} hint={t(`settings.voice.bargeIn.${bargeIn}`)}>
              {t(`settings.diag.bargeIn.badge.${bargeIn}`)}
            </Fact>
            <Fact label={t('settings.diag.fallback')} hint={policy?.brain.localFallback === 'auto' ? t('settings.diag.fallbackAuto') : t('settings.diag.fallbackOff')}>
              {policy?.brain.localFallback === 'auto' ? t('settings.diag.pc.on') : t('settings.diag.pc.off')}
            </Fact>
          </Facts>
        </Group>
      </Column>
    </SectionGrid>
  );
}
