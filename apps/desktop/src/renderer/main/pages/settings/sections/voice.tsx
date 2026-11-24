// Ayarlar › Ses: mikrofon ve sınaması (birincil kutu), bu bilgisayara alıştırma (uyandırma, yankı, söz kesme sınamaları),
// sessiz saatler, Yönetim'in belirledikleri (uyandırma sözü, söz kesme ve sohbet kipi), Jarvis'in sesi (motor ve ses seçimi).
import { useEffect, useState } from 'react';
import { Microphone, SpeakerHigh, Waveform as WaveformIcon } from '@phosphor-icons/react';
import { relativeTime, t, type MicTestResult, type Settings, type VoiceDiagnosticsReport } from '@fuber/shared';
import { Button, Input, Select, Switch, cn } from '@fuber/ui';
import { useBargeTest, useEchoTest, useWakeCalibration } from '../../../../voice-tests';
import { useShell } from '../../../shell/context';
import { useLive } from '../../../shell/live';
import { formatPercent } from '../../../shell/text';
import { BargeInStatus } from '../BargeInStatus';
import { Column, Group, LiveLevel, ManagedNote, SectionGrid, SettingRow, updateSettings } from '../kit';
import { VoiceEngine } from '../VoiceEngine';

/** Ses tanısı (`voice.diagnostics`): etkin seslendirme, söz kesme kipi, yankı ve alıştırma sonuçları. */
export function useVoiceDiagnostics() {
  return useLive<VoiceDiagnosticsReport>(() => window.fuber.invoke('voice.diagnostics'), ['voice.status', 'voice.turn', 'voice.error', 'policy.changed']);
}

/** Mikrofon: hangi aygıt, şu an ne duyuyor, üç saniyelik sınama ve sonucu. */
function Mic() {
  const shell = useShell();
  const voice = shell.voice;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MicTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = voice?.micMuted ? t('voice.state.mic_off') : voice?.ready ? t('settings.voice.micReady') : (voice?.notReadyReason ?? t('voice.notReady'));
  const test = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await window.fuber.invoke('setup.testMic', { deviceId: shell.settings?.inputDeviceId ?? null, seconds: 3 }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };
  return (
    <Group tone="lead" title={t('settings.voice.mic')} description={status} keywords={t('settings.kw.mic')}>
      <div className="flex flex-col gap-5" data-st-row="" data-testid="settings-mic">
        <div className="flex flex-col gap-2">
          <span className="text-base text-fg">{voice?.inputDeviceLabel ?? t('settings.voice.defaultMic')}</span>
          <LiveLevel />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="primary" icon={<Microphone />} loading={running} disabled={voice?.micMuted} onClick={() => void test()} data-testid="settings-mic-test">
            {running ? t('settings.voice.testing') : t('settings.voice.test')}
          </Button>
          {result || error ? (
            <p className={cn('min-w-0 flex-1 basis-56 text-sm', result?.ok ? 'text-success' : 'text-warning')} role="status" data-testid="settings-mic-result">
              {error
                ? error
                : result!.ok
                  ? result!.transcript
                    ? t('settings.voice.testHeard', { text: result!.transcript })
                    : result!.speechDetected
                      ? t('settings.voice.testSpeech', { peak: formatPercent(result!.peak) })
                      : t('settings.voice.testSilent', { peak: formatPercent(result!.peak) })
                  : (result!.error ?? t('common.unknownError'))}
            </p>
          ) : (
            <p className="min-w-0 flex-1 basis-56 text-sm text-fg-muted">{t('settings.voice.testHint')}</p>
          )}
        </div>
      </div>
    </Group>
  );
}

/** Uyandırma alıştırması, yankı ve söz kesme sınaması: kurulumdaki adımların aynısı, aynı kanallardan. */
function DeviceTests({ report, onChanged }: { report: VoiceDiagnosticsReport | null; onChanged(): void }) {
  const shell = useShell();
  const wake = useWakeCalibration(3);
  const echo = useEchoTest();
  const barge = useBargeTest();
  const ready = (shell.voice?.ready ?? false) && !shell.voice?.micMuted;
  const busy = wake.phase === 'running' || echo.phase === 'running' || barge.phase === 'running';

  // Sınama bitince kalıcı sonuç (alıştırma anı, yankı ölçümü) tanıdan yeniden okunur.
  useEffect(() => {
    if (wake.phase === 'done' || echo.phase === 'done' || barge.phase === 'done') onChanged();
  }, [wake.phase, echo.phase, barge.phase]);

  const at = wake.samples.findIndex((sample) => sample === 'listening' || sample === 'retry');
  const heard = wake.samples.filter((sample) => sample === 'heard').length;
  const current = Math.min(wake.samples.length, (at >= 0 ? at : heard) + 1);
  const wakeNote =
    wake.phase === 'running'
      ? t(wake.samples[at] === 'retry' ? 'settings.voice.calibrationRetry' : 'settings.voice.calibrationListening', { wake: shell.wakePhrase, n: current, total: wake.samples.length })
      : wake.phase === 'done'
        ? (wake.result?.message ?? null)
        : wake.phase === 'failed'
          ? wake.error
          : null;
  const echoMeasured = echo.phase === 'done' && echo.result?.ok === true;
  const echoNote = echo.phase === 'running' ? t('settings.voice.echoRunning') : echo.phase === 'done' ? (echo.result?.message ?? null) : echo.phase === 'failed' ? echo.error : null;
  const calibratedAt = report?.wake.calibratedAt ?? null;
  const lastEcho = report?.bargeIn.echo ?? null;
  const lastBarge = report?.echoGuard?.bargeTest ?? null;
  const bargeNote = barge.phase === 'running' ? t('voice.bargeTest.running') : barge.phase === 'done' ? (barge.result?.message ?? null) : barge.phase === 'failed' ? barge.error : null;
  const bargeGood = barge.phase === 'done' && barge.result?.ok === true && barge.result.selfInterrupts === 0 && barge.result.stopped >= 2;

  return (
    <Group columns={300} title={t('settings.voice.device')} description={t('settings.voice.deviceHint')}>
      <SettingRow
        layout="stack"
        label={t('settings.voice.calibration')}
        description={calibratedAt ? t('settings.voice.calibrationDone', { when: relativeTime(calibratedAt) }) : t('settings.voice.calibrationNever', { wake: shell.wakePhrase })}
        note={wakeNote}
        noteTone={wake.phase === 'running' ? 'muted' : wake.phase === 'done' && wake.result?.ok ? 'success' : 'warning'}
        testId="settings-calibration"
      >
        <Button size="sm" icon={<WaveformIcon />} loading={wake.phase === 'running'} disabled={!ready || busy} onClick={wake.start} data-testid="settings-calibrate">
          {calibratedAt ? t('settings.voice.calibrationRun') : t('settings.voice.calibrationFirst')}
        </Button>
      </SettingRow>
      <SettingRow
        layout="stack"
        label={t('settings.voice.echo')}
        description={lastEcho ? t(lastEcho.leaked ? 'settings.voice.echoLeaked' : 'settings.voice.echoClean', { when: relativeTime(lastEcho.at) }) : t('settings.voice.echoNever')}
        note={echoNote}
        noteTone={echo.phase === 'running' ? 'muted' : echoMeasured && !echo.result?.leaked ? 'success' : 'warning'}
        testId="settings-echo"
      >
        <Button size="sm" icon={<SpeakerHigh />} loading={echo.phase === 'running'} disabled={!ready || busy} onClick={echo.start} data-testid="settings-echo-test">
          {lastEcho ? t('settings.voice.echoRun') : t('settings.voice.echoFirst')}
        </Button>
      </SettingRow>
      <SettingRow
        layout="stack"
        label={t('voice.bargeTest.title')}
        description={lastBarge ? t('voice.bargeTest.done', { when: relativeTime(lastBarge.at), trials: lastBarge.trials, stopped: lastBarge.stopped }) : t('voice.bargeTest.never')}
        note={bargeNote}
        noteTone={barge.phase === 'running' ? 'muted' : bargeGood ? 'success' : 'warning'}
        testId="settings-barge"
      >
        <Button size="sm" icon={<WaveformIcon />} loading={barge.phase === 'running'} disabled={!ready || busy} onClick={barge.start} data-testid="settings-barge-test">
          {t('voice.bargeTest.run')}
        </Button>
      </SettingRow>
    </Group>
  );
}

/** Hangi bildirimlerin SESLİ okunacağı: düzey + modül başına susturma. Bildirimler yine görünür; bu yalnız sesi kısar. */
const SPOKEN_MUTE_MODULES: Array<{ id: string; key: string }> = [
  { id: 'mail', key: 'settings.voice.spoken.mod.mail' },
  { id: 'news', key: 'settings.voice.spoken.mod.news' },
  { id: 'briefing', key: 'settings.voice.spoken.mod.briefing' },
];

function SpokenNotifications({ settings }: { settings: Settings }) {
  const prefs = settings.spokenNotifications ?? { level: 'high' as const, mutedModules: [] };
  const setMuted = (id: string, muted: boolean) => {
    const next = muted ? [...new Set([...prefs.mutedModules, id])] : prefs.mutedModules.filter((m) => m !== id);
    void updateSettings({ spokenNotifications: { ...prefs, mutedModules: next } });
  };
  return (
    <Group title={t('settings.voice.spoken')} description={t('settings.voice.spokenHint')} keywords={t('settings.kw.spoken')}>
      <SettingRow label={t('settings.voice.spoken.level')} description={t(`settings.voice.spoken.level.${prefs.level}.hint`)}>
        <span className="block w-56" data-testid="settings-spoken-level" data-value={prefs.level}>
          <Select<Settings['spokenNotifications']['level']>
            size="sm"
            value={prefs.level}
            onChange={(level) => void updateSettings({ spokenNotifications: { ...prefs, level } })}
            options={(['high', 'urgent', 'none'] as const).map((level) => ({ value: level, label: t(`settings.voice.spoken.level.${level}`) }))}
            aria-label={t('settings.voice.spoken.level')}
          />
        </span>
      </SettingRow>
      {prefs.level !== 'none' && (
        <SettingRow label={t('settings.voice.spoken.mute')} description={t('settings.voice.spoken.muteHint')}>
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            {SPOKEN_MUTE_MODULES.map((mod) => (
              <label key={mod.id} className="flex items-center gap-2 text-sm text-fg-muted">
                <Switch
                  checked={!prefs.mutedModules.includes(mod.id)}
                  onCheckedChange={(on) => setMuted(mod.id, !on)}
                  aria-label={t(mod.key)}
                  data-testid={`settings-spoken-${mod.id}`}
                />
                {t(mod.key)}
              </label>
            ))}
          </span>
        </SettingRow>
      )}
    </Group>
  );
}

function QuietHours({ settings }: { settings: Settings }) {
  const { quietHours } = settings;
  return (
    <Group title={t('settings.voice.quiet')} description={t('settings.voice.quietHint')} keywords={t('settings.kw.quiet')}>
      <SettingRow label={t('settings.voice.quietEnabled')}>
        <Switch
          checked={quietHours.enabled}
          onCheckedChange={(enabled) => void updateSettings({ quietHours: { ...quietHours, enabled } })}
          aria-label={t('settings.voice.quietEnabled')}
          data-testid="settings-quiet"
        />
      </SettingRow>
      <SettingRow label={t('settings.voice.quietRange')} description={t('settings.voice.quietRangeHint')}>
        <span className="block w-[104px]">
          <Input
            type="time"
            size="sm"
            value={quietHours.from}
            disabled={!quietHours.enabled}
            onChange={(event) => event.target.value && void updateSettings({ quietHours: { ...quietHours, from: event.target.value } }, true)}
            aria-label={t('settings.voice.quietFrom')}
          />
        </span>
        <span className="h-px w-3 shrink-0 bg-fg-faint" aria-hidden />
        <span className="block w-[104px]">
          <Input
            type="time"
            size="sm"
            value={quietHours.to}
            disabled={!quietHours.enabled}
            onChange={(event) => event.target.value && void updateSettings({ quietHours: { ...quietHours, to: event.target.value } }, true)}
            aria-label={t('settings.voice.quietTo')}
          />
        </span>
      </SettingRow>
    </Group>
  );
}

export function Voice({ settings }: { settings: Settings }) {
  const shell = useShell();
  const bargeIn = shell.voice?.bargeIn ?? shell.policy?.voice.bargeIn ?? 'voice';
  const voiceDiagnostics = useVoiceDiagnostics();
  // Sohbet kipi Yönetim'in iznidir (`Policy.voice.conversationMode`); burada yalnız gösterilir.
  const conversation = shell.policy?.voice.conversationMode !== false;
  return (
    <SectionGrid>
      <Column span="main">
        <Mic />
        <Group title={t('settings.voice.bargeIn')}>
          <BargeInStatus onDone={voiceDiagnostics.reload} />
        </Group>
        <DeviceTests report={voiceDiagnostics.data} onChanged={voiceDiagnostics.reload} />
      </Column>
      <Column span="side">
        <SpokenNotifications settings={settings} />
        <QuietHours settings={settings} />
        <Group title={t('settings.voice.wake')} description={t('settings.voice.wakeHint')} action={<ManagedNote />}>
          <SettingRow label={t('settings.voice.wakePhrase')} value={shell.wakePhrase} />
          <SettingRow label={t('settings.voice.bargeIn')} description={t(`settings.voice.bargeIn.${bargeIn}`)} value={t(`settings.diag.bargeIn.badge.${bargeIn}`)} />
          <SettingRow
            label={t('settings.voice.conversation')}
            description={t('settings.voice.conversationHint', { wake: shell.wakePhrase })}
            value={conversation ? t('settings.diag.pc.on') : t('settings.diag.pc.off')}
            testId="settings-conversation"
          />
        </Group>
      </Column>
      <VoiceEngine settings={settings} />
    </SectionGrid>
  );
}
