// VR (Quest köprüsü): gözlükteki Fuber uygulamasını bu bilgisayara QR + 6 haneli PIN ile eşleme, köprü durumu ve
// eşleşmiş gözlükler. Veri ana süreçteki `modules/xr` köprüsünden gelir (`xr.status`); `xr.changed` olayıyla tazelenir.
import { useEffect, useState } from 'react';
import { Cube, QrCode, Trash, X } from '@phosphor-icons/react';
import { relativeTime, t } from '@fuber/shared';
import { Badge, Button, EmptyState, IconButton, Panel, Skeleton, Workspace, WorkspaceGrid, WorkspaceHeader } from '@fuber/ui';
import type { XrStatus } from '../../../../main/modules/xr/types';
import { attempt, useLive } from '../../shell/live';
import { ErrorPanel } from '../../shell/parts';
import { definePage } from '../page';

/** Eşleşme penceresinin kalan saniyesi (her saniye tazelenir). */
function useSecondsLeft(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
}

function PairingCard({ status, onChange }: { status: XrStatus; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  // Yalnız gözlük penceresi burada görünür; saat penceresi Saat sayfasındadır (pencere `forKind` taşır).
  const pairing = status.pairing && status.pairing.forKind !== 'watch' ? status.pairing : null;
  const watchOpen = status.pairing?.forKind === 'watch';
  const seconds = useSecondsLeft(pairing?.expiresAt ?? null);
  const run = async (channel: 'xr.startPairing' | 'xr.cancelPairing') => {
    setBusy(true);
    await attempt(() => (channel === 'xr.startPairing' ? window.fuber.invoke(channel, { kind: 'quest' }) : window.fuber.invoke(channel, {})));
    setBusy(false);
    onChange();
  };

  if (!pairing || seconds === 0) {
    return (
      <Panel tone="lead" title={t('xr.pair.title')}>
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-fg-muted">{t('xr.pair.body')}</p>
          <Button variant="primary" onClick={() => void run('xr.startPairing')} disabled={busy || !status.running} data-testid="xr-start-pairing">
            <QrCode />
            {t('xr.pair.start')}
          </Button>
          {watchOpen && <p className="text-sm text-warning">{t('xr.pair.watchOpen')}</p>}
        </div>
      </Panel>
    );
  }

  return (
    <Panel tone="lead" title={t('xr.pair.title')}>
      <div className="flex flex-wrap items-center gap-8" data-testid="xr-pairing">
        <img src={pairing.qr} alt={t('xr.pair.qrAlt')} className="size-56 rounded-md bg-white p-2" data-testid="xr-qr" />
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-fg-muted" data-testid="xr-pair-body">
            {t('xr.pair.body')}
          </p>
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-fg-muted">{t('xr.pair.pin')}</span>
            <span className="font-mono text-4xl font-semibold tracking-[0.3em] text-fg tabular-nums" data-testid="xr-pin">
              {pairing.pin}
            </span>
          </div>
          <p className="text-xs text-fg-faint tabular-nums">
            {t('xr.pair.expires', { seconds })} · {t('xr.pair.attempts', { count: pairing.attemptsLeft })}
          </p>
          <div>
            <Button variant="ghost" onClick={() => void run('xr.cancelPairing')} disabled={busy} data-testid="xr-cancel-pairing">
              <X />
              {t('xr.pair.cancel')}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function XrPage() {
  const live = useLive(() => window.fuber.invoke('xr.status', {}), ['xr.changed']);
  const status = live.data;

  const aside = status && (
    <Panel tone="base" title={t('xr.page.state')}>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-muted">{t('xr.page.state')}</dt>
          <dd>
            <Badge tone={status.running ? 'success' : 'neutral'} size="sm" dot>
              {status.running ? t('xr.page.running') : t('xr.page.stopped')}
            </Badge>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-muted">{t('xr.page.port')}</dt>
          <dd className="font-mono tabular-nums">{status.port}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-fg-muted">{t('xr.page.hosts')}</dt>
          <dd className="font-mono text-xs" data-testid="xr-hosts">
            {status.hosts.length ? status.hosts.join(', ') : <span className="font-sans text-fg-faint">{t('xr.page.noHosts')}</span>}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-fg-muted">{t('xr.page.fingerprint')}</dt>
          <dd className="font-mono text-lg tracking-widest" data-testid="xr-fp">
            {status.shortFp}
          </dd>
          <dd className="text-xs text-fg-faint">{t('xr.page.fingerprintHint')}</dd>
        </div>
        {status.error && <p className="text-sm text-danger">{status.error}</p>}
      </dl>
      <div className="mt-5 flex flex-col gap-2 text-sm">
        <p className="font-medium text-fg">{t('xr.how.title')}</p>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-fg-muted">
          <li>{t('xr.how.1')}</li>
          <li>{t('xr.how.2')}</li>
          <li>{t('xr.how.3')}</li>
          <li>{t('xr.how.4')}</li>
        </ol>
      </div>
    </Panel>
  );

  const headerStatus = status ? (status.connected ? t('xr.page.connected') : t('xr.page.notConnected')) : undefined;

  return (
    <Workspace data-testid="xr-page">
      <WorkspaceHeader title={t('xr.page.title')} status={headerStatus} />
      <WorkspaceGrid asideWidth={340} aside={aside}>
        {live.state.status === 'loading' ? (
          <Panel tone="lead" aria-busy aria-label={t('common.loading')}>
            <Skeleton className="h-40 w-full rounded-md" />
          </Panel>
        ) : live.state.status === 'error' ? (
          <Panel tone="lead">
            <ErrorPanel message={live.state.message} onRetry={live.reload} />
          </Panel>
        ) : status ? (
          <>
            <PairingCard status={status} onChange={live.reload} />
            <Panel tone="base" padding="none" title={t('xr.devices.title')} count={status.devices.filter((d) => d.kind !== 'watch').length}>
              {status.devices.filter((d) => d.kind !== 'watch').length === 0 ? (
                <EmptyState icon={<Cube />} title={t('xr.devices.empty')} data-testid="xr-devices-empty" />
              ) : (
                <ul className="flex flex-col pb-1" data-testid="xr-devices">
                  {status.devices
                    .filter((d) => d.kind !== 'watch')
                    .map((device) => (
                    <li key={device.deviceId} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-4 text-fg-muted [&_svg]:size-4.5">
                        <Cube />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-base font-medium text-fg">{device.name}</span>
                          {device.connected && (
                            <Badge tone="success" size="sm" dot>
                              {t('xr.devices.online')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-fg-faint">{t('xr.devices.lastSeen', { when: relativeTime(device.lastSeen) })}</p>
                      </div>
                      <IconButton
                        icon={<Trash />}
                        label={t('xr.devices.forget')}
                        variant="ghost"
                        onClick={async () => {
                          await attempt(() => window.fuber.invoke('xr.forget', { deviceId: device.deviceId }));
                          live.reload();
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        ) : null}
      </WorkspaceGrid>
    </Workspace>
  );
}

export default definePage({
  id: 'xr',
  titleKey: 'xr.nav',
  icon: Cube,
  order: 74,
  moduleId: 'xr',
  Component: XrPage,
});
