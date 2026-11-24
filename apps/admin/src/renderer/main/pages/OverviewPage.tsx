/**
 * Genel bakış (açılış ekranı): v1 Yönetim'in ilk ekranının v2 karşılığı. Dört büyük ölçü (onay bekleyen, bağlı
 * cihaz, bugünkü harcama, politika sürümü), solda onay bekleyenler (hızlı onay, Güvenlik'teki işlemin aynısı) ve
 * kullanım grafiği, sağda "Sistem": her satır ilgili ekrana ve bölüme götürür. Bütün sayılar gerçek veriden.
 */
import {
  ArrowClockwise,
  Brain,
  ChartBar,
  CheckCircle,
  ClockCounterClockwise,
  Cpu,
  Desktop,
  DownloadSimple,
  HardDrives,
  HourglassMedium,
  Key,
  Power,
  SquaresFour,
  TerminalWindow,
  Wallet,
  Waveform,
} from '@phosphor-icons/react';
import { t, type DeviceRecord } from '@fuber/shared';
import { Button, Skeleton } from '@fuber/ui';
import { useDeviceActions } from '../app/device-actions';
import { useKillSwitch } from '../app/kill-switch';
import { useLive } from '../app/live-store';
import { usePolicy } from '../app/policy-store';
import { Block, CalmEmpty, ErrorPanel, IconBox, ListSkeleton, Page, SummaryStrip, SystemList, type DotTone, type StatProps, type SystemItem } from '../components/layout';
import { UsageChart } from '../components/UsageChart';
import { formatUsd, fromNow } from '../lib/format';
import { useResource } from '../lib/ipc';
import { isOnline, keyFailed, keyReady, lastSeen, moduleCounts, ambientOn, roleModelLabel, roleTone, sttLabel, sttTone, ttsLabel, ttsTone } from '../lib/status';
import type { PageProps } from './types';

const DATE = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });

export function OverviewPage({ go }: PageProps) {
  const { service, devices, keys, usage } = useLive();
  const refreshing = service.refreshing || devices.refreshing || keys.refreshing || usage.refreshing;
  return (
    <Page
      title={t('admin.overview.title')}
      description={t('admin.overview.description', { date: DATE.format(new Date()) })}
      actions={
        <Button
          icon={<ArrowClockwise />}
          loading={refreshing}
          onClick={() => {
            void service.reload();
            void devices.reload();
            void keys.reload();
            void usage.reload();
          }}
          data-testid="overview-refresh"
        >
          {t('admin.overview.refresh')}
        </Button>
      }
      summary={<OverviewSummary />}
      asideWidth={500}
      aside={<SystemBlock go={go} />}
    >
      <PendingBlock go={go} />
      <UsageBlock />
    </Page>
  );
}

// ───────────────────────── Bir bakışta ─────────────────────────

function OverviewSummary() {
  const { devices, usage, now } = useLive();
  const { base } = usePolicy();
  const list = devices.data ?? [];
  const pending = list.filter((d) => d.status === 'pending').length;
  const approved = list.filter((d) => d.status === 'approved');
  const online = approved.filter((d) => isOnline(d, now)).length;
  const seen = lastSeen(list);
  const today = usage.data?.today;
  const ratio = today && today.budgetUsd > 0 ? today.costUsd / today.budgetUsd : 0;
  const current = base ? approved.filter((d) => d.policyRevision === base.revision).length : 0;
  const items: StatProps[] = [
    {
      label: t('admin.overview.stat.pending'),
      icon: <HourglassMedium />,
      value: devices.data ? pending : null,
      note: pending > 0 ? t('admin.overview.stat.pendingNote') : t('admin.overview.stat.pendingNone'),
      tone: pending > 0 ? 'warning' : undefined,
      testId: 'stat-pending',
    },
    {
      label: t('admin.overview.stat.devices'),
      icon: <Desktop />,
      value: devices.data ? approved.length : null,
      note: list.length === 0 ? t('admin.overview.stat.devicesNone') : t('admin.overview.stat.devicesNote', { online, when: fromNow(seen, now) }),
      testId: 'stat-devices',
    },
    {
      label: t('admin.overview.stat.spend'),
      icon: <Wallet />,
      value: today ? today.costUsd : null,
      format: formatUsd,
      raw: today ? today.costUsd.toFixed(4) : undefined,
      unit: today ? `/ ${formatUsd(today.budgetUsd)}` : undefined,
      note: today ? t('admin.overview.stat.spendNote', { percent: Math.round(ratio * 100) }) : undefined,
      tone: ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : undefined,
      testId: 'stat-spend',
    },
    {
      label: t('admin.overview.stat.revision'),
      icon: <ClockCounterClockwise />,
      value: base ? base.revision : null,
      note: approved.length === 0 ? t('admin.overview.stat.revisionNone') : t('admin.overview.stat.revisionNote', { current, total: approved.length }),
      testId: 'stat-revision',
    },
  ];
  return <SummaryStrip items={items} testId="overview-summary" />;
}

// ───────────────────────── Onay bekleyenler ─────────────────────────

function PendingBlock({ go }: PageProps) {
  const { devices, now } = useLive();
  const { act, busy } = useDeviceActions();
  const pending = (devices.data ?? []).filter((d) => d.status === 'pending');
  return (
    <Block
      index={0}
      title={t('admin.overview.pending.title')}
      description={t('admin.overview.pending.description')}
      count={devices.data ? pending.length : undefined}
      alert={pending.length > 0 ? 'warning' : undefined}
      testId="overview-pending"
      action={
        <Button size="sm" variant="ghost" onClick={() => go('security', 'devices')} data-testid="overview-open-devices">
          {t('admin.overview.pending.open')}
        </Button>
      }
    >
      {devices.error ? (
        <ErrorPanel message={devices.error} onRetry={() => void devices.reload()} />
      ) : devices.loading ? (
        <ListSkeleton rows={2} />
      ) : pending.length === 0 ? (
        <CalmEmpty icon={<CheckCircle />} testId="overview-pending-empty">
          {t('admin.overview.pending.empty')}
        </CalmEmpty>
      ) : (
        <div className="ad-rows" data-testid="overview-pending-list">
          {pending.map((device) => (
            <PendingRow key={device.id} device={device} now={now} busy={busy === device.id} onApprove={() => void act(device, 'approve')} />
          ))}
        </div>
      )}
    </Block>
  );
}

function PendingRow({ device, now, busy, onApprove }: { device: DeviceRecord; now: number; busy: boolean; onApprove: () => void }) {
  return (
    <div className="ad-row" data-device={device.id}>
      <IconBox size={36} tone="warning">
        <Desktop />
      </IconBox>
      <div className="ad-row-text">
        <span className="ad-row-title">{device.name}</span>
        <span className="ad-row-sub">
          {t('admin.overview.pending.meta', {
            platform: device.platform === 'win32' ? 'Windows' : device.platform,
            version: device.appVersion,
            when: fromNow(device.registeredAt, now),
          })}
        </span>
      </div>
      <div className="ad-row-end">
        <Button size="sm" variant="primary" loading={busy} onClick={onApprove} data-testid={`overview-approve-${device.id}`}>
          {t('common.approve')}
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Kullanım ─────────────────────────

function UsageBlock() {
  const { usage } = useLive();
  const days = usage.data?.days ?? [];
  const total = days.reduce((sum, d) => sum + d.costUsd, 0);
  const calls = days.reduce((sum, d) => sum + d.calls, 0);
  return (
    <Block
      index={1}
      title={t('admin.overview.usage.title')}
      description={t('admin.overview.usage.description', { days: days.length || 7 })}
      action={calls > 0 ? <span className="text-sm whitespace-nowrap text-fg-muted tabular-nums" data-testid="overview-usage-total">{formatUsd(total)}</span> : undefined}
      testId="overview-usage"
    >
      {usage.error ? (
        <ErrorPanel message={usage.error} onRetry={() => void usage.reload()} />
      ) : usage.loading ? (
        <Skeleton className="h-52 w-full rounded-md" />
      ) : calls === 0 ? (
        <CalmEmpty icon={<ChartBar />} testId="overview-usage-empty">
          {t('admin.overview.usage.empty')}
        </CalmEmpty>
      ) : (
        <UsageChart days={days} />
      )}
    </Block>
  );
}

// ───────────────────────── Sistem ─────────────────────────

function SystemBlock({ go }: PageProps) {
  const { service, keys } = useLive();
  const { base, draft } = usePolicy();
  const kill = useKillSwitch();
  const cli = useResource(() => window.fuber.invoke('deep.claudeCode'));
  const policy = base ?? draft;
  const status = service.data;
  const keyList = keys.data ?? [];

  if (!policy) {
    return (
      <Block index={2} title={t('admin.overview.system.title')}>
        <ListSkeleton rows={6} />
      </Block>
    );
  }

  const voice = policy.models.voice;
  const cliReady = !!cli.data?.installed && cli.data.loggedIn !== false;
  const ccUse = policy.brain.claudeCode.use ?? 'prefer';
  const brainOnCli = ccUse === 'prefer' && cliReady;
  const readyKeys = keyList.filter((k) => keyReady(keyList, k.provider)).length;
  const failedKeys = keyList.filter((k) => keyFailed(keyList, k.provider)).length;
  const { on, total } = moduleCounts(policy);
  const ambient = ambientOn(policy);
  const sttT = sttTone(policy.voice.stt.provider, keyList);
  const ttsT = ttsTone(policy.voice.tts.provider, keyList);
  const locals = policy.localModels.length;
  const worst = (...tones: DotTone[]): DotTone => (tones.includes('danger') ? 'danger' : tones.includes('warning') ? 'warning' : 'success');

  const items: SystemItem[] = [
    {
      id: 'service',
      icon: <HardDrives />,
      label: t('admin.overview.system.service'),
      tone: !status ? 'neutral' : status.running ? 'success' : 'danger',
      value: !status ? t('admin.strip.serviceChecking') : status.running ? status.url.replace(/^https?:\/\//, '') : t('admin.strip.serviceStopped'),
    },
    {
      id: 'brain',
      icon: <Brain />,
      label: t('admin.overview.system.brain'),
      tone: brainOnCli ? 'success' : roleTone(voice, policy, keyList),
      value: brainOnCli ? t('admin.overview.system.brainCli', { model: policy.brain.claudeCode.voice.model }) : roleModelLabel(voice, policy),
      onOpen: () => go('brain', 'brain-models'),
      openLabel: t('admin.overview.system.open', { page: t('admin.nav.brain') }),
    },
    {
      id: 'claude-code',
      icon: <TerminalWindow />,
      label: t('admin.overview.system.claudeCode'),
      tone: cli.loading ? 'neutral' : ccUse === 'off' ? 'neutral' : cliReady ? 'success' : 'warning',
      value: cli.loading
        ? t('admin.overview.system.checking')
        : ccUse === 'off'
          ? t('admin.overview.system.ccOff')
          : !cli.data?.installed
            ? t('admin.overview.system.ccMissing')
            : cli.data.loggedIn === false
              ? t('admin.overview.system.ccLoggedOut')
              : t('admin.overview.system.ccReady', { version: cli.data.version ?? '' }),
      onOpen: () => go('brain', 'claude-code'),
      openLabel: t('admin.overview.system.open', { page: t('admin.nav.brain') }),
    },
    {
      id: 'voice',
      icon: <Waveform />,
      label: t('admin.overview.system.voice'),
      tone: worst(sttT, ttsT),
      value: t('admin.overview.system.voiceValue', { stt: sttLabel(policy.voice.stt.provider), tts: ttsLabel(policy.voice.tts.provider) }),
      onOpen: () => go('voice'),
      openLabel: t('admin.overview.system.open', { page: t('admin.nav.voice') }),
    },
    {
      id: 'keys',
      icon: <Key />,
      label: t('admin.overview.system.keys'),
      tone: keys.loading ? 'neutral' : failedKeys > 0 ? 'warning' : readyKeys > 0 ? 'success' : 'neutral',
      value: keys.loading
        ? t('admin.overview.system.checking')
        : failedKeys > 0
          ? t('admin.overview.system.keysFailed', { ready: readyKeys, failed: failedKeys })
          : readyKeys > 0
            ? t('admin.overview.system.keysReady', { ready: readyKeys })
            : t('admin.overview.system.keysNone'),
      onOpen: () => go('voice', 'keys'),
      openLabel: t('admin.overview.system.open', { page: t('admin.nav.voice') }),
    },
    {
      id: 'local',
      icon: <Cpu />,
      label: t('admin.overview.system.local'),
      tone: policy.brain.localFallback === 'auto' ? 'success' : 'neutral',
      value: t(policy.brain.localFallback === 'auto' ? 'admin.overview.system.localOn' : 'admin.overview.system.localOff', { count: locals }),
      onOpen: () => go('brain', 'local-brain'),
      openLabel: t('admin.overview.system.open', { page: t('admin.nav.brain') }),
    },
    {
      id: 'modules',
      icon: <SquaresFour />,
      label: t('admin.overview.system.modules'),
      tone: ambient ? 'warning' : 'success',
      value: ambient ? t('admin.overview.system.modulesAmbient', { on, total }) : t('admin2.modules.onCount', { on, total }),
      onOpen: () => go('modules'),
      openLabel: t('admin.overview.system.open', { page: t('admin.nav.modules') }),
    },
    {
      id: 'release',
      icon: <DownloadSimple />,
      label: t('admin.overview.system.release'),
      tone: policy.release.force ? 'warning' : 'success',
      value: policy.release.force ? t('admin.overview.system.releaseForce', { version: policy.release.minVersion }) : t('admin.overview.system.releaseMin', { version: policy.release.minVersion }),
      onOpen: () => go('security', 'release'),
      openLabel: t('admin.overview.system.open', { page: t('admin.nav.security') }),
    },
    {
      id: 'kill',
      icon: <Power />,
      label: t('admin.overview.system.kill'),
      tone: kill.active ? 'danger' : 'success',
      value: kill.active ? t('admin.overview.system.killOn') : t('admin.overview.system.killOff'),
      onOpen: () => go('security', 'kill'),
      openLabel: t('admin.overview.system.killOpen'),
    },
  ];

  return (
    <Block index={2} title={t('admin.overview.system.title')} description={t('admin.overview.system.description')} testId="overview-system">
      <SystemList items={items} testId="system-list" />
    </Block>
  );
}
