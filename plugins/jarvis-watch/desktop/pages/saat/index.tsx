// Saat (Galaxy Watch): eşleşme (PIN + QR), bağlantı, son nabız, pil, takılı mı, son örneğin zamanı, unut. Köprü VR ile ortaktır
// (`modules/xr`); arayüz ayrıdır: bu sayfadan açılan eşleşme penceresi yalnız SAAT kabul eder, VR sayfasından açılan yalnız
// gözlük (pencere `forKind` taşır; yanlış tür `wrong_kind` ile reddedilir). Nabız/pil `jarvis-watch` modülünden (`saat.bio`).
import { useEffect, useState } from 'react';
import { Heartbeat, QrCode, Trash, Watch, X } from '@phosphor-icons/react';
import { relativeTime, t } from '@fuber/shared';
import { Badge, Button, EmptyState, IconButton, Panel, Skeleton, Workspace, WorkspaceGrid, WorkspaceHeader } from '@fuber/ui';
import type { HudBio } from '../../../../main/modules/jarvis-watch/types';
import type { XrStatus } from '../../../../main/modules/xr/types';
import { attempt, useEvent, useLive } from '../../shell/live';
import { ErrorPanel } from '../../shell/parts';
import { definePage } from '../page';

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
  const pairing = status.pairing && status.pairing.forKind === 'watch' ? status.pairing : null;
  const otherOpen = status.pairing && status.pairing.forKind !== 'watch';
  const seconds = useSecondsLeft(pairing?.expiresAt ?? null);
  const run = async (channel: 'xr.startPairing' | 'xr.cancelPairing') => {
    setBusy(true);
    await attempt(() => (channel === 'xr.startPairing' ? window.fuber.invoke(channel, { kind: 'watch' }) : window.fuber.invoke(channel, {})));
    setBusy(false);
    onChange();
  };
  if (!pairing || seconds === 0) {
    return (
      <Panel tone="lead" title={t('saat.pair.title')}>
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-fg-muted">{t('saat.pair.body')}</p>
          {otherOpen && <p className="text-sm text-warning">{t('saat.pair.otherOpen')}</p>}
          <Button variant="primary" onClick={() => void run('xr.startPairing')} disabled={busy || !status.running} data-testid="saat-start-pairing">
            <QrCode />
            {t('saat.pair.start')}
          </Button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel tone="lead" title={t('saat.pair.title')}>
      <div className="flex flex-wrap items-center gap-8" data-testid="saat-pairing">
        <img src={pairing.qr} alt={t('xr.pair.qrAlt')} className="size-48 rounded-md bg-white p-2" data-testid="saat-qr" />
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-fg-muted">{t('saat.pair.pinBody')}</p>
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-fg-muted">{t('xr.pair.pin')}</span>
            <span className="font-mono text-4xl font-semibold tracking-[0.3em] text-fg tabular-nums" data-testid="saat-pin">
              {pairing.pin}
            </span>
          </div>
          <p className="text-xs text-fg-faint tabular-nums">
            {t('xr.pair.expires', { seconds })} · {t('xr.pair.attempts', { count: pairing.attemptsLeft })}
          </p>
          <div>
            <Button variant="ghost" onClick={() => void run('xr.cancelPairing')} disabled={busy}>
              <X />
              {t('xr.pair.cancel')}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

const ago = (sec: number | null): string => (sec === null ? '—' : sec < 2 ? t('saat.now') : sec < 90 ? t('saat.secondsAgo', { sec }) : relativeTime(new Date(Date.now() - sec * 1000).toISOString()));

const REASON_KEY = { disconnected: 'saat.reason.disconnected', notWorn: 'saat.reason.notWorn', notMeasuring: 'saat.reason.notMeasuring', noData: 'saat.reason.noData', ok: 'saat.reason.ok' } as const;

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line px-4 py-3">
      <dt className="text-xs text-fg-faint">{label}</dt>
      <dd className="text-2xl font-medium tabular-nums text-fg" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function BioCard({ bio }: { bio: HudBio | null }) {
  if (!bio) return <p className="text-sm text-fg-muted">{t('saat.bio.noModule')}</p>;
  const off = bio.status === 'off';
  const tone = bio.status === 'live' ? 'success' : bio.status === 'stale' ? 'warning' : 'neutral';
  const label = bio.status === 'live' ? t('saat.state.live') : bio.status === 'stale' ? t('saat.state.stale') : t(REASON_KEY[bio.reason ?? 'disconnected']);
  return (
    <div className="flex flex-col gap-4" data-testid="saat-bio">
      <div className="flex items-center gap-3">
        <Heartbeat className="size-5 text-fg-muted" />
        <Badge tone={tone} size="sm" dot>
          {label}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('saat.bio.hr')} value={off || bio.hr === null ? '—' : `${bio.hr} ${t('saat.bio.bpm')}`} testId="saat-hr" />
        <Stat label={t('saat.bio.battery')} value={bio.battery === null ? '—' : `%${bio.battery}`} testId="saat-battery" />
        <Stat label={t('saat.bio.worn')} value={bio.source === 'none' ? '—' : bio.worn ? t('saat.yes') : t('saat.no')} testId="saat-worn" />
        <Stat label={t('saat.bio.last')} value={ago(bio.lastSampleAgoSec)} testId="saat-last" />
      </dl>
      {!off && (
        <p className="text-xs text-fg-faint tabular-nums">
          {bio.steps !== null && `${t('saat.bio.steps')} ${bio.steps.toLocaleString('tr-TR')}`}
          {bio.kcal !== null && ` · ${t('saat.bio.kcal')} ${bio.kcal}`}
          {bio.hrAvg != null && ` · ${t('saat.bio.avg')} ${bio.hrAvg}`}
        </p>
      )}
    </div>
  );
}

function SaatPage() {
  const live = useLive(() => window.fuber.invoke('xr.status', {}), ['xr.changed']);
  const [bio, setBio] = useState<HudBio | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => void attempt(() => window.fuber.invoke('saat.bio', {})).then((r) => alive && r && setBio(r));
    read();
    // Durum (canlı → bayat → kapalı) zamanla yaşlanır: örnek gelmese de periyodik tazelenir.
    const timer = setInterval(read, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEvent('saat.bio', ({ bio: next }) => setBio(next));
  const status = live.data;
  const watches = status ? status.devices.filter((d) => d.kind === 'watch') : [];
  const connected = watches.some((d) => d.connected);

  return (
    <Workspace data-testid="saat-page">
      <WorkspaceHeader title={t('saat.page.title')} status={status ? (connected ? t('saat.connected') : t('saat.notConnected')) : undefined} />
      <WorkspaceGrid asideWidth={340} aside={null}>
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
            <Panel tone="base" title={t('saat.bio.title')}>
              <BioCard bio={bio} />
            </Panel>
            <PairingCard status={status} onChange={live.reload} />
            <Panel tone="base" padding="none" title={t('saat.devices.title')} count={watches.length}>
              {watches.length === 0 ? (
                <EmptyState icon={<Watch />} title={t('saat.devices.empty')} data-testid="saat-devices-empty" />
              ) : (
                <ul className="flex flex-col pb-1" data-testid="saat-devices">
                  {watches.map((device) => (
                    <li key={device.deviceId} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-4 text-fg-muted [&_svg]:size-4.5">
                        <Watch />
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
  id: 'saat',
  titleKey: 'saat.nav',
  icon: Watch,
  order: 75,
  moduleId: 'jarvis-watch',
  Component: SaatPage,
});
