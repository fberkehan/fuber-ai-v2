// Ayarlar › Gizlilik: ortam dinleme. Rıza, aç/kapa, şimdi duraklat, sil, araya girme ve saklama süreleri tek yerde.
// Kutu ve satırlar Ayarlar'ın yapı taşlarıdır (`kit.tsx`): kısa ayarlar geniş kutuda yan yana dizilir.
import { useEffect, useState } from 'react';
import { ClockCounterClockwise, LockKey, Pause, Play, Trash } from '@phosphor-icons/react';
import { localDay, localTime, t } from '@fuber/shared';
import { Badge, Button, Input, Switch, toast } from '@fuber/ui';
import { attempt } from '../../shell/live';
import { ConfirmDialog, SkeletonRows } from '../../shell/parts';
import type { AmbientPrefs, AmbientStatus, PausePreset } from '../../../../main/modules/ambient/types';
import { ConsentDialog } from '../memory/ambient/ConsentDialog';
import { RETENTION_DAYS, useAmbientStatus } from '../memory/ambient/data';
import { Group, Rows, SettingRow as Row, type Span } from './kit';

/** Odaktan çıkınca ya da Enter'da kaydeden saat alanı. */
function TimeInput({ value, onCommit, disabled, label, testId }: { value: string; onCommit: (value: string) => void; disabled?: boolean; label: string; testId?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <span className="block w-[104px]">
      <Input
        type="time"
        size="sm"
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => /^\d{2}:\d{2}$/.test(draft) && draft !== value && onCommit(draft)}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        data-testid={testId}
      />
    </span>
  );
}

const setPrefs = (patch: Partial<AmbientPrefs>) => attempt(() => window.fuber.invoke('ambient.setPrefs', { patch }));
const pause = (preset: PausePreset | null) => attempt(() => window.fuber.invoke('ambient.pause', { preset }));

function pausedText(status: AmbientStatus): string {
  if (!status.pausedUntil) return t('ambient.ui.privacy.pause.body');
  const sameDay = localDay(status.pausedUntil) === localDay();
  return sameDay ? t('ambient.ui.privacy.pause.until', { time: localTime(status.pausedUntil) }) : t('ambient.ui.privacy.pause.untilTomorrow');
}

function Controls({ status }: { status: AmbientStatus }) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [confirm, setConfirm] = useState<'deleteAll' | 'revoke' | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const { prefs, limits, today } = status;
  const consented = status.consentAt !== null;
  const on = consented && prefs.enabled;
  const usable = status.allowed && on;

  const toggle = (next: boolean) => {
    if (!next) return void setPrefs({ enabled: false });
    if (!consented) return setConsentOpen(true);
    void setPrefs({ enabled: true });
  };

  const forgetRecent = async () => {
    setForgetting(true);
    const removed = await attempt(() => window.fuber.invoke('ambient.forgetRecent', { minutes: 10 }));
    setForgetting(false);
    if (!removed) return;
    if (removed.segments + removed.notes + removed.issues === 0) toast.info(t('ambient.ui.privacy.forget.none'));
    else toast.success(t('ambient.ui.privacy.forget.done', { segments: removed.segments, notes: removed.notes, issues: removed.issues }));
  };

  return (
    <>
      <Rows columns={400}>
      <Row
        label={
          <span className="flex flex-wrap items-center gap-2.5">
            {t('ambient.ui.privacy.listen')}
            <Badge tone={status.listening ? 'success' : status.allowed && consented ? 'warning' : 'neutral'} dot data-testid="ambient-privacy-state">
              {t(`ambient.reason.${status.reason}`)}
            </Badge>
          </span>
        }
        description={
          !status.allowed
            ? t('ambient.ui.gate.policy.body')
            : !consented
              ? t('ambient.ui.privacy.listenConsent')
              : t('ambient.ui.privacy.today', { segments: today.segments, notes: today.notes, issues: today.openIssues, interjections: today.interjections })
        }
      >
        <Switch checked={on} disabled={!status.allowed} onCheckedChange={toggle} aria-label={t('ambient.ui.privacy.listen')} data-testid="ambient-toggle" />
      </Row>

      <Row label={t('ambient.ui.privacy.pause.title')} description={pausedText(status)}>
        {status.pausedUntil ? (
          <Button size="sm" icon={<Play weight="fill" />} onClick={() => void pause(null)} data-testid="ambient-resume">
            {t('ambient.ui.resume')}
          </Button>
        ) : (
          (['15m', '1h', 'today'] as const).map((preset) => (
            <Button key={preset} size="sm" disabled={!usable} icon={preset === '15m' ? <Pause /> : undefined} onClick={() => void pause(preset)} data-testid={`ambient-pause-${preset}`}>
              {t(`ambient.ui.privacy.pause.${preset}`)}
            </Button>
          ))
        )}
      </Row>

      <Row
        label={t('ambient.ui.privacy.companion.title')}
        description={
          <>
            {t(`ambient.companion.${status.companion.reason}`)}. {t('ambient.ui.privacy.companion.body')}
          </>
        }
        testId="ambient-companion-row"
      >
        <Switch checked={prefs.companion} disabled={!consented} onCheckedChange={(companion) => void setPrefs({ companion })} aria-label={t('ambient.ui.privacy.companion.title')} data-testid="ambient-companion" />
      </Row>
      <Row label={t('ambient.ui.privacy.voice.title')} description={t('ambient.ui.privacy.voice.body')}>
        <Switch
          checked={prefs.companionVoice}
          disabled={!consented || !prefs.companion}
          onCheckedChange={(companionVoice) => void setPrefs({ companionVoice })}
          aria-label={t('ambient.ui.privacy.voice.title')}
          data-testid="ambient-companion-voice"
        />
      </Row>
      <Row
        label={t('ambient.ui.privacy.limits.title')}
        description={t('ambient.ui.privacy.limits.body', {
          perHour: limits.maxInterjectionsPerHour,
          gap: Math.round(limits.minGapSeconds / 60),
          mode: t(`ambient.ui.privacy.mode.${limits.interjections}`),
        })}
      >
        <Badge tone="neutral" icon={<LockKey weight="bold" />}>
          {t('settings.managed')}
        </Badge>
      </Row>

      <Row label={t('ambient.ui.privacy.report.title')} description={t('ambient.ui.privacy.report.body')}>
        <TimeInput value={prefs.reportTime} disabled={!consented} label={t('ambient.ui.privacy.report.title')} onCommit={(reportTime) => void setPrefs({ reportTime })} testId="ambient-report-time" />
      </Row>
      <Row
        label={t('ambient.ui.privacy.hours.title')}
        description={t('ambient.ui.privacy.hours.body')}
        extra={
          prefs.hours.enabled ? (
            <span className="flex flex-wrap items-center gap-2.5">
              <TimeInput value={prefs.hours.from} label={t('ambient.ui.privacy.hours.from')} onCommit={(from) => void setPrefs({ hours: { ...prefs.hours, from } })} testId="ambient-hours-from" />
              <span className="h-px w-3 shrink-0 bg-fg-faint" aria-hidden />
              <TimeInput value={prefs.hours.to} label={t('ambient.ui.privacy.hours.to')} onCommit={(to) => void setPrefs({ hours: { ...prefs.hours, to } })} testId="ambient-hours-to" />
            </span>
          ) : undefined
        }
      >
        <Switch
          checked={prefs.hours.enabled}
          disabled={!consented}
          onCheckedChange={(enabled) => void setPrefs({ hours: { ...prefs.hours, enabled } })}
          aria-label={t('ambient.ui.privacy.hours.title')}
          data-testid="ambient-hours"
        />
      </Row>
      <Row label={t('ambient.ui.privacy.lock.title')} description={t('ambient.ui.privacy.lock.body')}>
        <Switch
          checked={prefs.pauseWhenLocked}
          disabled={!consented}
          onCheckedChange={(pauseWhenLocked) => void setPrefs({ pauseWhenLocked })}
          aria-label={t('ambient.ui.privacy.lock.title')}
          data-testid="ambient-lock"
        />
      </Row>

      <Row
        label={t('ambient.ui.privacy.retention.title')}
        description={t('ambient.ui.privacy.retention.body', {
          days: limits.retentionDays,
          casual: RETENTION_DAYS.casualNote,
          important: RETENTION_DAYS.importantNote,
          daily: RETENTION_DAYS.dailyReport,
          issues: RETENTION_DAYS.closedIssue,
        })}
      />
      </Rows>
      {/* Kayıtları silen ve rızayı geri alan eylemler gündelik ayarlardan ayrı durur. */}
      <Rows columns={400}>
      <Row label={t('ambient.ui.privacy.forget.title')} description={t('ambient.ui.privacy.forget.body')}>
        <Button size="sm" icon={<ClockCounterClockwise />} loading={forgetting} onClick={() => void forgetRecent()} data-testid="ambient-forget-10">
          {t('ambient.ui.privacy.forget.action')}
        </Button>
      </Row>
      <Row label={t('ambient.ui.privacy.deleteAll.title')} description={t('ambient.ui.privacy.deleteAll.body')}>
        <Button size="sm" variant="danger" icon={<Trash />} onClick={() => setConfirm('deleteAll')} data-testid="ambient-delete-all">
          {t('ambient.ui.privacy.deleteAll.action')}
        </Button>
      </Row>
      {consented && (
        <Row label={t('ambient.ui.privacy.revoke.title')} description={t('ambient.ui.privacy.revoke.body')}>
          <Button size="sm" variant="ghost" onClick={() => setConfirm('revoke')} data-testid="ambient-revoke">
            {t('ambient.ui.privacy.revoke.action')}
          </Button>
        </Row>
      )}
      </Rows>

      <ConsentDialog open={consentOpen} status={status} onClose={() => setConsentOpen(false)} />
      <ConfirmDialog
        open={confirm === 'deleteAll'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('ambient.ui.privacy.deleteAll.confirmTitle')}
        body={t('ambient.ui.privacy.deleteAll.confirmBody')}
        confirmLabel={t('ambient.ui.privacy.deleteAll.action')}
        onConfirm={async () => {
          const done = await attempt(() => window.fuber.invoke('ambient.deleteAll'));
          if (done) toast.success(t('ambient.ui.privacy.deleteAll.done'));
        }}
      />
      <ConfirmDialog
        open={confirm === 'revoke'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('ambient.ui.privacy.revoke.confirmTitle')}
        body={t('ambient.ui.privacy.revoke.confirmBody')}
        confirmLabel={t('ambient.ui.privacy.revoke.action')}
        onConfirm={async () => {
          const done = await attempt(() => window.fuber.invoke('ambient.consent', { accept: false }));
          if (done) toast.success(t('ambient.ui.privacy.revoke.done'));
        }}
      />
    </>
  );
}

export function AmbientPrivacy({ span = 'full' }: { span?: Span }) {
  const { moduleOn, status } = useAmbientStatus();
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <Group
      span={span}
      title={t('ambient.ui.privacy.title')}
      description={t('ambient.ui.privacy.description')}
      testId="ambient-privacy"
      data-listening={status?.listening ?? false}
      data-reason={moduleOn ? (status?.reason ?? 'loading') : 'module_off'}
    >
      {!moduleOn ? (
        <>
          <Row label={t('ambient.ui.gate.moduleOff.title')} description={t('ambient.ui.gate.moduleOff.body')}>
            <Badge tone="neutral" icon={<LockKey weight="bold" />}>
              {t('settings.managed')}
            </Badge>
          </Row>
          <Row label={t('ambient.ui.privacy.offDelete.title')} description={t('ambient.ui.privacy.offDelete.body')} testId="ambient-off-delete">
            <Button size="sm" variant="danger" icon={<Trash />} onClick={() => setConfirmOff(true)} data-testid="ambient-off-delete-action">
              {t('ambient.ui.privacy.deleteAll.action')}
            </Button>
          </Row>
          <ConfirmDialog
            open={confirmOff}
            onOpenChange={(open) => !open && setConfirmOff(false)}
            title={t('ambient.ui.privacy.deleteAll.confirmTitle')}
            body={t('ambient.ui.privacy.deleteAll.confirmBody')}
            confirmLabel={t('ambient.ui.privacy.deleteAll.action')}
            onConfirm={async () => {
              const done = await attempt(() => window.fuber.invoke('modules.purgeData', { id: 'ambient' }));
              if (done) toast.success(t('ambient.ui.privacy.deleteAll.done'));
            }}
          />
        </>
      ) : status === null ? (
        <SkeletonRows count={3} />
      ) : (
        <Controls status={status} />
      )}
    </Group>
  );
}
