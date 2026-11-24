import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChartBar, Desktop, DotsThree, DownloadSimple, Footprints, HourglassMedium, ListMagnifyingGlass, Play, Power, ShieldCheck, Wallet, Warning } from '@phosphor-icons/react';
import { APP_VERSION, t, type AuditEntry, type AuthorityLevel, type DeviceRecord } from '@fuber/shared';
import { Badge, Button, Dialog, IconButton, Input, List, Menu, Metric, Panel as Box, ProgressBar, Row, Select, Skeleton, Switch, Textarea, toast, cn, enter, stagger, useMotionPreset, type Tone } from '@fuber/ui';
import { useDeviceActions } from '../app/device-actions';
import { useKillSwitch } from '../app/kill-switch';
import { useLive } from '../app/live-store';
import { usePolicy, useField } from '../app/policy-store';
import { Block, ErrorPanel, Fields, IconBox, InlineEmpty, ListSkeleton, Notice, Page, PanelSkeleton, SettingRow, StatusDot, SummaryStrip, SystemList, type DotTone, type StatProps } from '../components/layout';
import { isOnline, lastSeen } from '../lib/status';
import { UsageChart } from '../components/UsageChart';
import { auditSummaryText } from '../lib/audit-labels';
import { formatDateTime, formatStamp, formatTokens, formatUsd, fromNow } from '../lib/format';
import { errorMessage, useAdminEvent, useResource } from '../lib/ipc';
import { NumberInput } from './VoicePage';
import type { PageProps } from './types';

export function SecurityPage({ go }: PageProps) {
  const { draft, loading } = usePolicy();
  const ready = !loading && !!draft;
  return (
    <Page
      title={t('admin.security.title')}
      description={t('admin.security.description')}
      summary={<SecuritySummary />}
      aside={
        ready ? (
          <>
            <ProtectionBlock go={go} />
            <LimitsBlock />
            <ThisComputerBlock />
          </>
        ) : (
          <PanelSkeleton rows={2} />
        )
      }
      below={
        ready ? (
          <>
            <ReleaseBlock />
            <AuditBlock />
          </>
        ) : undefined
      }
    >
      {ready ? (
        <>
          <KillSwitchBlock />
          <DevicesBlock />
          <UsageBlock />
        </>
      ) : (
        <>
          <Skeleton className="h-36 w-full rounded-lg" />
          <PanelSkeleton rows={2} />
        </>
      )}
    </Page>
  );
}

// ───────────────────────── Bir bakışta ─────────────────────────

function SecuritySummary() {
  const { devices, usage, now } = useLive();
  const { draft } = usePolicy();
  const list = devices.data ?? [];
  const pending = list.filter((d) => d.status === 'pending').length;
  const approved = list.filter((d) => d.status === 'approved');
  const online = approved.filter((d) => isOnline(d, now)).length;
  const today = usage.data?.today;
  const ratio = today && today.budgetUsd > 0 ? today.costUsd / today.budgetUsd : 0;
  const items: StatProps[] = [
    {
      label: t('admin.overview.stat.pending'),
      icon: <HourglassMedium />,
      value: devices.data ? pending : null,
      note: pending > 0 ? t('admin.overview.stat.pendingNote') : t('admin.overview.stat.pendingNone'),
      tone: pending > 0 ? 'warning' : undefined,
    },
    {
      label: t('admin.overview.stat.devices'),
      icon: <Desktop />,
      value: devices.data ? approved.length : null,
      note: list.length === 0 ? t('admin.overview.stat.devicesNone') : t('admin.overview.stat.devicesNote', { online, when: fromNow(lastSeen(list), now) }),
    },
    {
      label: t('admin.overview.stat.spend'),
      icon: <Wallet />,
      value: today ? today.costUsd : null,
      format: formatUsd,
      unit: today ? `/ ${formatUsd(today.budgetUsd)}` : undefined,
      note: today ? t('admin.overview.stat.spendNote', { percent: Math.round(ratio * 100) }) : undefined,
      tone: ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : undefined,
    },
    {
      label: t('admin.limits.steps.label'),
      icon: <Footprints />,
      value: draft ? draft.limits.maxAgentSteps : null,
      unit: t('admin.limits.steps.unit'),
      note: t('admin.security.stat.stepsNote'),
    },
  ];
  return <SummaryStrip items={items} testId="security-summary" />;
}

/** Koruma özeti: korumaların durumu bir bakışta; her satır kendi bölümüne kayar. */
function ProtectionBlock({ go }: { go: PageProps['go'] }) {
  const kill = useKillSwitch();
  const { devices } = useLive();
  const { draft } = usePolicy();
  const pending = (devices.data ?? []).filter((d) => d.status === 'pending').length;
  if (!draft) return null;
  const release = draft.release;
  return (
    <Block index={2} title={t('admin.security.protection.title')} description={t('admin.security.protection.description')} testId="security-protection">
      <SystemList
        testId="protection-list"
        items={[
          {
            id: 'kill',
            icon: <Power />,
            label: t('admin.overview.system.kill'),
            tone: kill.active ? 'danger' : 'success',
            value: kill.active ? t('admin.overview.system.killOn') : t('admin.overview.system.killOff'),
            onOpen: () => go('security', 'kill'),
          },
          {
            id: 'devices',
            icon: <ShieldCheck />,
            label: t('admin.security.protection.approval'),
            tone: pending > 0 ? 'warning' : 'success',
            value: pending > 0 ? t('admin.strip.pending', { count: pending }) : t('admin.security.protection.approvalOk'),
            onOpen: () => go('security', 'devices'),
          },
          {
            id: 'release',
            icon: <DownloadSimple />,
            label: t('admin.overview.system.release'),
            tone: release.force ? 'warning' : 'success',
            value: release.force ? t('admin.overview.system.releaseForce', { version: release.minVersion }) : t('admin.overview.system.releaseMin', { version: release.minVersion }),
            onOpen: () => go('security', 'release'),
          },
          {
            id: 'audit',
            icon: <ListMagnifyingGlass />,
            label: t('admin.audit.title'),
            tone: 'success',
            value: t('admin.security.protection.auditOn'),
            onOpen: () => go('security', 'audit'),
          },
        ]}
      />
    </Block>
  );
}

// ───────────────────────── Acil durdurma ─────────────────────────

function KillSwitchBlock() {
  const kill = useKillSwitch();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const preset = useMotionPreset(enter.fadeUp);

  return (
    <motion.div initial={preset.initial} animate={preset.animate} transition={preset.transition} className="min-w-0 scroll-mt-4" id="kill">
      <Box
        tone="lead"
        aria-labelledby="kill-title"
        className={cn('p-6! transition-[background-color,border-color] duration-(--duration-slow) ease-out', kill.active && 'border-danger/50! bg-danger-soft!')}
        data-testid="kill-panel"
        data-active={kill.active || undefined}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <span
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-full transition-colors duration-(--duration-slow) [&_svg]:size-6',
              kill.active ? 'bg-danger text-on-primary' : 'bg-danger-soft text-danger',
            )}
          >
            <Power weight="bold" />
          </span>
          <div className="flex min-h-[72px] min-w-0 flex-1 basis-72 flex-col justify-center gap-1">
            <h2 id="kill-title" className="text-xl text-fg">
              {kill.active ? t('admin.kill.activeTitle') : t('admin.kill.title')}
            </h2>
            <p className="text-sm text-fg-muted" data-selectable={kill.active || undefined}>
              {kill.active ? (kill.message ? `“${kill.message}”` : t('admin.kill.activeBody')) : t('admin.kill.body')}
            </p>
          </div>
          {kill.active ? (
            <Button variant="primary" size="lg" icon={<Play weight="fill" />} loading={kill.busy} onClick={() => void kill.set(false)} data-testid="kill-off">
              {t('admin.kill.turnOff')}
            </Button>
          ) : (
            <Button variant="danger" size="lg" onClick={() => setConfirm(true)} data-testid="kill-on">
              {t('admin.kill.turnOn')}
            </Button>
          )}
        </div>
      </Box>
      <Dialog
        open={confirm}
        onOpenChange={(open) => !kill.busy && setConfirm(open)}
        role="alertdialog"
        title={t('admin.kill.confirmTitle')}
        description={t('admin.kill.confirmBody')}
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              icon={<Power weight="bold" />}
              loading={kill.busy}
              data-testid="kill-confirm"
              onClick={async () => {
                if (await kill.set(true, message)) {
                  setConfirm(false);
                  setMessage('');
                }
              }}
            >
              {t('admin.kill.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="kill-message" className="text-sm font-medium text-fg">
            {t('admin.kill.messageLabel')}
          </label>
          <Input id="kill-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('admin.kill.messagePlaceholder')} maxLength={140} data-testid="kill-message" />
          <p className="text-sm text-fg-faint">{t('admin.kill.messageHint')}</p>
        </div>
      </Dialog>
    </motion.div>
  );
}

// ───────────────────────── Cihazlar ─────────────────────────

function deviceState(device: DeviceRecord): { tone: DotTone; label: string } {
  if (device.status === 'approved') return { tone: 'success', label: t('admin.devices.status.approved') };
  if (device.status === 'pending') return { tone: 'warning', label: t('admin.devices.status.pending') };
  return { tone: 'danger', label: t('admin.devices.status.revoked') };
}

/** Bekleyenler üstte (onay sizi bekliyor), sonra onaylılar, en sonda yetkisi alınanlar. */
const DEVICE_ORDER: Record<DeviceRecord['status'], number> = { pending: 0, approved: 1, revoked: 2 };

function DevicesBlock() {
  const { devices, now } = useLive();
  const { base } = usePolicy();
  const { act, busy } = useDeviceActions();
  const [toDelete, setToDelete] = useState<DeviceRecord | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const list = [...(devices.data ?? [])].sort((a, b) => DEVICE_ORDER[a.status] - DEVICE_ORDER[b.status]);
  const pending = list.filter((d) => d.status === 'pending').length;
  const preset = useMotionPreset(enter.fadeUp);

  return (
    <Block
      index={1}
      title={t('admin.devices.title')}
      description={pending > 0 ? t('admin.devices.pendingLead', { count: pending }) : t('admin.devices.description')}
      count={list.length}
      id="devices"
      alert={pending > 0 ? 'warning' : undefined}
      testId="devices-block"
    >
      {devices.error ? (
        <ErrorPanel message={devices.error} onRetry={() => void devices.reload()} />
      ) : devices.loading ? (
        <ListSkeleton rows={1} />
      ) : list.length === 0 ? (
        <InlineEmpty icon={<Desktop />} title={t('admin.devices.emptyTitle')} testId="devices-empty">
          {t('admin.devices.emptyBody')}
        </InlineEmpty>
      ) : (
        <div className="ad-rows" role="list" data-testid="device-list">
          {list.map((device, index) => {
            const state = deviceState(device);
            const online = isOnline(device, now);
            const waiting = device.status === 'pending';
            const behind = device.status === 'approved' && base && device.policyRevision !== null && device.policyRevision < base.revision;
            return (
              <motion.div
                key={device.id}
                role="listitem"
                initial={preset.initial}
                animate={preset.animate}
                transition={stagger(index, preset.transition)}
                className="ad-row"
                data-device={device.id}
                data-status={device.status}
              >
                <IconBox size={36} tone={waiting ? 'warning' : undefined}>
                  <Desktop />
                </IconBox>
                <div className="ad-row-text">
                  <span className="ad-row-title">{device.name}</span>
                  <span className="ad-row-sub">
                    {t('admin.devices.meta', {
                      version: device.appVersion,
                      platform: device.platform === 'win32' ? 'Windows' : device.platform,
                      arch: device.arch,
                      seen: online ? t('admin.devices.online') : t('admin.devices.lastSeen', { when: fromNow(device.lastSeenAt, now) }),
                    })}
                  </span>
                </div>
                <div className="ad-row-end">
                  {behind && <StatusDot tone="accent">{t('admin.devices.syncing', { revision: device.policyRevision ?? 0 })}</StatusDot>}
                  <StatusDot tone={device.status === 'approved' && !online ? 'neutral' : state.tone} testId={`device-status-${device.id}`}>
                    {state.label}
                  </StatusDot>
                  {device.status !== 'approved' && (
                    <Button size="sm" variant={waiting ? 'primary' : 'secondary'} loading={busy === device.id} onClick={() => void act(device, 'approve')} data-testid={`device-approve-${device.id}`}>
                      {t('common.approve')}
                    </Button>
                  )}
                  <Menu
                    label={t('admin.devices.actions', { name: device.name })}
                    placement="bottom-end"
                    trigger={<IconButton size="sm" icon={<DotsThree weight="bold" />} label={t('admin.devices.actions', { name: device.name })} tooltip={false} />}
                    items={[
                      ...(device.status === 'approved' ? [{ id: 'revoke', label: t('admin.devices.revoke'), onSelect: () => void act(device, 'revoke') }] : []),
                      { id: 'delete', label: t('admin.devices.delete'), danger: true, onSelect: () => setToDelete(device) },
                    ]}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && !busy && setToDelete(null)}
        role="alertdialog"
        size="sm"
        title={t('admin.devices.deleteTitle', { name: toDelete?.name ?? '' })}
        description={t('admin.devices.deleteBody')}
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setToDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={!!busy}
              onClick={async () => {
                if (toDelete && (await act(toDelete, 'delete'))) setToDelete(null);
              }}
            >
              {t('admin.devices.delete')}
            </Button>
          </>
        }
      />
    </Block>
  );
}

// ───────────────────────── Kullanım ─────────────────────────

function UsageBlock() {
  const { usage } = useLive();
  const days = usage.data?.days ?? [];
  const total = days.reduce((sum, d) => sum + d.costUsd, 0);
  const tokens = days.reduce((sum, d) => sum + d.inputTokens + d.outputTokens, 0);
  const calls = days.reduce((sum, d) => sum + d.calls, 0);
  // OpenAI uyumlu sağlayıcıların fiyatı bilinmeyen çağrıları toplama 0 diye girmez; ayrıca söylenir (G8).
  const unpriced = days.reduce((sum, d) => sum + (d.unpricedCalls ?? 0), 0);
  return (
    <Block index={2} title={t('admin.security.usage.title')} description={t('admin.security.usage.description')}>
      {usage.error ? (
        <ErrorPanel message={usage.error} onRetry={() => void usage.reload()} />
      ) : usage.loading ? (
        <Skeleton className="h-64 w-full rounded-md" />
      ) : calls === 0 ? (
        // Kullanım yokken dev sıfırlar yerine ne olduğu söylenir.
        <InlineEmpty icon={<ChartBar />} title={t('admin.security.usage.empty')} testId="usage-empty">
          {t('admin2.security.usage.emptyBody')}
        </InlineEmpty>
      ) : (
        <div className="ad-usage">
          <div className="ad-usage-in">
            <div className="ad-usage-metrics">
              <Metric label={t('admin.security.usage.total')} value={<span data-testid="usage-total">{formatUsd(total)}</span>} />
              <Metric label={t('admin.security.usage.tokensLabel')} value={formatTokens(tokens)} />
              <Metric label={t('admin.security.usage.calls')} value={calls.toLocaleString('tr-TR')} />
            </div>
            <UsageChart days={days} />
          </div>
          {unpriced > 0 && (
            <p className="mt-4 flex items-start gap-1.5 text-sm text-warning" data-testid="usage-unpriced">
              <Warning aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
              {t('admin.cloud.usage.unpriced', { count: unpriced.toLocaleString('tr-TR') })}
            </p>
          )}
        </div>
      )}
    </Block>
  );
}

// ───────────────────────── Sınırlar ─────────────────────────

function LimitsBlock() {
  const [budget, setBudget, budgetError] = useField<number>(['limits', 'dailyBudgetUsd']);
  const [steps, setSteps, stepsError] = useField<number>(['limits', 'maxAgentSteps']);
  // Alan politikada isteğe bağlıdır; yoksa sınır yok (Tam yetki).
  const [maxAuthority, setMaxAuthority] = useField<AuthorityLevel | undefined>(['limits', 'maxAuthority']);
  const { usage } = useLive();
  const spent = usage.data?.today.costUsd ?? 0;
  const ratio = Number.isFinite(budget) && budget > 0 ? spent / budget : 0;
  return (
    <Block index={3} title={t('admin.limits.title')} description={t('admin.limits.description')}>
      <Fields min={150}>
        <SettingRow label={t('admin.limits.budget.label')} htmlFor="limit-budget" error={budgetError}>
          <NumberInput id="limit-budget" value={budget} onChange={setBudget} unit="$" min={0} step={1} invalid={!!budgetError} testId="limit-budget" />
        </SettingRow>
        <SettingRow label={t('admin.limits.steps.label')} htmlFor="limit-steps" error={stepsError}>
          <NumberInput id="limit-steps" value={steps} onChange={setSteps} unit={t('admin.limits.steps.unit')} min={1} step={1} invalid={!!stepsError} />
        </SettingRow>
        <SettingRow label={t('admin.limits.authority.label')} description={t('admin.limits.authority.hint')}>
          <Select<AuthorityLevel>
            aria-label={t('admin.limits.authority.label')}
            value={maxAuthority ?? 'full'}
            onChange={setMaxAuthority}
            options={[
              { value: 'full', label: t('admin.limits.authority.full') },
              { value: 'smart', label: t('admin.limits.authority.smart') },
              { value: 'ask', label: t('admin.limits.authority.ask') },
            ]}
          />
        </SettingRow>
        <div className="col-span-full flex flex-col gap-3">
          <ProgressBar
            size="sm"
            value={ratio}
            tone={ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'accent'}
            label={t('admin.limits.budget.today')}
            valueLabel={`${formatUsd(spent)} / ${Number.isFinite(budget) ? formatUsd(budget) : '–'}`}
          />
          <p className="text-sm text-fg-faint">
            {t('admin.limits.budget.hint')} {t('admin.limits.steps.hint')}
          </p>
        </div>
      </Fields>
    </Block>
  );
}

// ───────────────────────── Sürüm kapısı ─────────────────────────

function ReleaseBlock() {
  const [minVersion, setMinVersion, minError] = useField<string>(['release', 'minVersion']);
  const [latest, setLatest, latestError] = useField<string>(['release', 'latestVersion']);
  const [force, setForce] = useField<boolean>(['release', 'force']);
  const [url, setUrl, urlError] = useField<string | undefined>(['release', 'downloadUrl']);
  const [notes, setNotes] = useField<string | undefined>(['release', 'notes']);
  return (
    <Block index={4} id="release" alert={force ? 'warning' : undefined} title={t('admin.release.title')} description={t('admin.release.description', { version: APP_VERSION })}>
      <Fields min={150}>
        <SettingRow label={t('admin.release.min.label')} description={t('admin.release.min.hint')} htmlFor="release-min" error={minError}>
          <Input id="release-min" value={minVersion} onChange={(e) => setMinVersion(e.target.value)} className="font-mono text-sm" spellCheck={false} />
        </SettingRow>
        <SettingRow label={t('admin.release.latest.label')} description={t('admin.release.latest.hint')} htmlFor="release-latest" error={latestError}>
          <Input id="release-latest" value={latest} onChange={(e) => setLatest(e.target.value)} className="font-mono text-sm" spellCheck={false} />
        </SettingRow>
        <SettingRow
          wide
          inline
          label={t('admin.release.force.label')}
          description={
            <>
              {t('admin.release.force.hint')}
              {force && (
                <span className="mt-1 flex items-center gap-1.5 text-warning">
                  <Warning aria-hidden weight="fill" className="size-4 shrink-0" />
                  {t('admin.release.force.on', { version: minVersion })}
                </span>
              )}
            </>
          }
        >
          <Switch checked={force} onCheckedChange={setForce} aria-label={t('admin.release.force.label')} />
        </SettingRow>
        <SettingRow wide label={t('admin.release.url.label')} description={t('admin.release.url.hint')} htmlFor="release-url" error={urlError}>
          <Input id="release-url" value={url ?? ''} onChange={(e) => setUrl(e.target.value)} placeholder="https://" spellCheck={false} invalid={!!urlError} />
        </SettingRow>
        <SettingRow wide label={t('admin.release.notes.label')} description={t('admin.release.notes.hint')} htmlFor="release-notes">
          <Textarea id="release-notes" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} minRows={2} maxRows={6} />
        </SettingRow>
      </Fields>
    </Block>
  );
}

// ───────────────────────── Denetim kaydı ─────────────────────────

const AUDIT_PAGE = 15;

const AUDIT_TONE: Partial<Record<AuditEntry['action'], Tone>> = {
  'killswitch.on': 'danger',
  'killswitch.off': 'success',
  'key.set': 'accent',
  'key.delete': 'warning',
  'device.revoke': 'warning',
  'device.delete': 'warning',
  'policy.rollback': 'accent',
};

function AuditBlock() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [state, setState] = useState<{ loading: boolean; more: boolean; error: string | null; done: boolean }>({ loading: true, more: false, error: null, done: false });
  const preset = useMotionPreset(enter.fadeUp);

  const load = useCallback(async (before?: number) => {
    setState((s) => ({ ...s, more: before !== undefined, error: null }));
    try {
      const page = await window.fuber.invoke('audit.list', before === undefined ? { limit: AUDIT_PAGE } : { limit: AUDIT_PAGE, before });
      setEntries((prev) => (before === undefined ? page : [...prev, ...page.filter((e) => !prev.some((p) => p.id === e.id))]));
      setState({ loading: false, more: false, error: null, done: page.length < AUDIT_PAGE });
    } catch (reason) {
      setState((s) => ({ ...s, loading: false, more: false, error: errorMessage(reason) }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminEvent('audit.added', (entry) => setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [entry, ...prev])));

  const last = entries[entries.length - 1];
  return (
    <Block index={5} id="audit" title={t('admin.audit.title')} description={t('admin.audit.description')}>
      {state.error && entries.length === 0 ? (
        <ErrorPanel message={state.error} onRetry={() => void load()} />
      ) : state.loading ? (
        <ListSkeleton rows={3} />
      ) : entries.length === 0 ? (
        <InlineEmpty icon={<ListMagnifyingGlass />} title={t('admin.audit.empty')} />
      ) : (
        <div className="flex flex-col">
          <ol className="flex flex-col [&>*+*]:border-t [&>*+*]:border-line" data-testid="audit-list">
            {entries.map((entry, index) => (
              <motion.li
                key={entry.id}
                initial={preset.initial}
                animate={preset.animate}
                transition={stagger(index % AUDIT_PAGE, preset.transition)}
                className="grid grid-cols-[56px_132px_minmax(0,1fr)] items-baseline gap-x-3 py-2 first:pt-0.5"
              >
                <time dateTime={entry.at} title={formatDateTime(entry.at)} className="text-xs text-fg-faint">
                  {formatStamp(entry.at)}
                </time>
                <span>
                  <Badge size="sm" tone={AUDIT_TONE[entry.action] ?? 'neutral'}>
                    {t(`admin.audit.action.${entry.action}`)}
                  </Badge>
                </span>
                <span className="text-sm break-words text-fg-muted" data-selectable>
                  {auditSummaryText(entry)}
                </span>
              </motion.li>
            ))}
          </ol>
          {!state.done && last && (
            <div className="flex justify-center border-t border-line pt-2">
              <Button size="sm" variant="ghost" loading={state.more} onClick={() => void load(last.id)} data-testid="audit-more">
                {t('admin.audit.more')}
              </Button>
            </div>
          )}
          {state.error && (
            <div className="pt-3">
              <Notice tone="danger">{state.error}</Notice>
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

// ───────────────────────── Bu bilgisayar ─────────────────────────

function ThisComputerBlock() {
  const settings = useResource(() => window.fuber.invoke('settings.get'));
  const [busy, setBusy] = useState(false);
  const supported = settings.data?.openAtLoginSupported ?? false;
  return (
    <Block index={6} title={t('admin.computer.title')} description={t('admin.computer.description')}>
      {settings.error ? (
        <ErrorPanel message={settings.error} onRetry={() => void settings.reload()} />
      ) : (
        <Fields>
          <SettingRow inline label={t('admin.computer.login.label')} description={supported ? t('admin.computer.login.hint') : t('admin.computer.login.unsupported')}>
            <div className="flex items-center">
              {settings.loading ? (
                <Skeleton className="h-6 w-10 rounded-full" />
              ) : (
                <Switch
                  checked={!!settings.data?.openAtLogin}
                  disabled={busy}
                  aria-label={t('admin.computer.login.label')}
                  data-testid="open-at-login"
                  onCheckedChange={async (on) => {
                    setBusy(true);
                    try {
                      settings.setData(await window.fuber.invoke('settings.update', { patch: { openAtLogin: on } }));
                    } catch (reason) {
                      toast.error(t('admin.computer.failed'), { description: errorMessage(reason) });
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </div>
          </SettingRow>
        </Fields>
      )}
    </Block>
  );
}
