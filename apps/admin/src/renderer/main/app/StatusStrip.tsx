/**
 * İnce durum şeridi: servis ve bağlantı noktası, cihazlar, bugünkü harcama, politika sürümü. Bir bakışta "her şey
 * yolunda mı". Yüksekliği sabittir (48 px) ve soldaki ray markasıyla aynı eksendedir: ekran değişince oynamaz.
 * Bağlantı noktası her zaman yazar (üstüne gelmek gerekmez). Kap daralınca ikincil ayrıntılar (son görülme, bütçe
 * çubuğu) çekilir; şerit taşmaz. Acil durdurma açıkken servis hapının yeri uyarıya döner ve tek tıkla kapatılır;
 * cihaz, bütçe ve politika sürümü yerinde kalır. Şeridin içi sayfanın ölçüsüne (`PAGE_MAX`) oturur.
 */
import { ArrowClockwise, Desktop, Play, Warning } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { IconButton, StatusPill, Tooltip, cn } from '@fuber/ui';
import { useState } from 'react';
import { formatUsd, fromNow } from '../lib/format';
import { PAGE_MAX } from '../components/layout';
import { useKillSwitch } from './kill-switch';
import { useLive } from './live-store';
import { usePolicy } from './policy-store';
import type { PageId } from '../pages/types';

export function StatusStrip({ go }: { go: (page: PageId, anchor?: string) => void }) {
  const kill = useKillSwitch();
  return (
    <div className="@container/strip mt-1 mb-4 h-12 shrink-0" data-testid="status-strip" data-kill={kill.active || undefined}>
      {/* Şeridin içi sayfayla aynı ölçüye oturur: sol ucu sayfa başlığıyla, sağ ucu içeriğin sağ kenarıyla aynı hizada. */}
      <div className="mx-auto flex h-full w-full items-center gap-1.5 px-8 @max-[759px]/strip:px-5" style={{ maxWidth: PAGE_MAX }}>
        <NormalStrip go={go} kill={kill} />
      </div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-line" />;
}

function NormalStrip({ go, kill }: { go: (page: PageId, anchor?: string) => void; kill: ReturnType<typeof useKillSwitch> }) {
  const { service, devices, usage, now } = useLive();
  const { base } = usePolicy();
  const [restarting, setRestarting] = useState(false);
  const status = service.data;
  const list = devices.data ?? [];
  const pending = list.filter((d) => d.status === 'pending').length;
  const lastSeen = list.reduce<string | null>((latest, d) => (d.lastSeenAt && (!latest || d.lastSeenAt > latest) ? d.lastSeenAt : latest), null);
  const today = usage.data?.today;
  const ratio = today && today.budgetUsd > 0 ? today.costUsd / today.budgetUsd : 0;

  const restart = async () => {
    setRestarting(true);
    try {
      service.setData(await window.fuber.invoke('service.restart'));
    } finally {
      setRestarting(false);
    }
  };

  // Bağlantı noktası: masaüstünün bağlandığı adres (`127.0.0.1:47820`); pilin içinde her zaman görünür.
  const address = status ? status.url.replace(/^https?:\/\//, '') : '';
  const serviceLabel = !status
    ? t('admin.strip.serviceChecking')
    : status.running
      ? t('admin.strip.serviceRunning')
      : /port/i.test(status.error ?? '')
        ? t('admin.strip.portBusy')
        : t('admin.strip.serviceStopped');

  return (
    <>
      {kill.active ? (
        // Bant yalnız durumu söyler (ayrıntı Güvenlik'teki kutuda): öteki öğeler yerinden oynamaz, metin kesilmez.
        <div className="flex h-8 shrink-0 items-center gap-2.5 rounded-full border border-danger/45 bg-danger-soft pr-1 pl-3" role="alert">
          <Warning aria-hidden weight="fill" className="size-4 shrink-0 text-danger" />
          <p className="text-sm font-semibold whitespace-nowrap text-danger">{t('admin.strip.killTitle')}</p>
          <button
            type="button"
            disabled={kill.busy}
            onClick={() => void kill.set(false)}
            className="flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-primary px-2.5 text-xs font-semibold whitespace-nowrap text-on-primary transition-[background-color,transform] duration-(--duration-fast) hover:bg-primary-hover active:scale-[0.97] disabled:cursor-default disabled:opacity-60"
            data-testid="strip-kill-off"
          >
            <Play aria-hidden weight="fill" className="size-3" />
            {t('admin.kill.turnOff')}
          </button>
        </div>
      ) : (
        <>
        <Tooltip content={status?.error ?? ''} disabled={!status?.error}>
          <StatusPill
            tabIndex={0}
            status={!status ? 'offline' : status.running ? 'online' : 'error'}
            label={serviceLabel}
            detail={status?.running ? address : undefined}
            className="h-8"
            data-testid="strip-service"
          />
        </Tooltip>
        {status && !status.running && (
          <IconButton size="sm" icon={<ArrowClockwise />} label={t('admin.state.restartService')} loading={restarting} onClick={() => void restart()} />
        )}
        </>
      )}
      <Divider />
      <button
        type="button"
        onClick={() => go('security', 'devices')}
        className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-full px-2.5 text-sm whitespace-nowrap text-fg-muted transition-[background-color,color,transform] duration-(--duration-fast) hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
        data-testid="strip-devices"
      >
        <Desktop aria-hidden className="size-4" />
        <span className="text-fg">{t('admin.strip.devices', { count: list.length })}</span>
        {lastSeen && <span className="hidden @min-[900px]/strip:inline">{t('admin.strip.lastSeen', { when: fromNow(lastSeen, now) })}</span>}
        {pending > 0 && <span className="rounded-full bg-warning-soft px-2 text-xs leading-5 font-medium text-warning">{t('admin.strip.pending', { count: pending })}</span>}
      </button>
      <Divider />
      <div className="flex h-8 shrink-0 items-center gap-2.5 px-2.5 text-sm whitespace-nowrap" data-testid="strip-spend">
        <span className="text-fg-muted">{t('admin.strip.today')}</span>
        <span className="text-fg tabular-nums">
          {today ? formatUsd(today.costUsd) : '–'}
          <span className="text-fg-faint"> / {today ? formatUsd(today.budgetUsd) : '–'}</span>
        </span>
        <span aria-hidden className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-5 @min-[760px]/strip:block">
          <span
            className={cn('block h-full origin-left rounded-full transition-transform duration-(--duration-slow) ease-out', ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warning' : 'bg-accent-fg')}
            style={{ transform: `scaleX(${today && today.costUsd > 0 ? Math.min(1, Math.max(0.06, ratio)) : 0})` }}
          />
        </span>
      </div>
      <span className="min-w-2 flex-1" />
      <span className="shrink-0 px-1 text-sm whitespace-nowrap text-fg-muted tabular-nums" data-testid="strip-revision" data-revision={base?.revision}>
        {base ? t('admin.strip.revision', { revision: base.revision }) : ''}
      </span>
    </>
  );
}
