// Ayarlar › Tanı: ses hattının özeti (son turun ölçüleri, canlı düzey; birincil kutu) ve ayrıntı tabloları.
// Renk yalnız sorun varken kullanılır: yolunda giden satırda rozet yoktur.
import { FolderOpen } from '@phosphor-icons/react';
import { formatDay, localTime, relativeTime, t, type LocalModelProgress, type ToolCallRecord } from '@fuber/shared';
import { Badge, Button, Metric, ProgressBar, Skeleton, cn, type Tone } from '@fuber/ui';
import { useShell } from '../../../shell/context';
import { attempt, useLive } from '../../../shell/live';
import { ErrorPanel } from '../../../shell/parts';
import { formatPercent } from '../../../shell/text';
import { Column, DataRow, DataTable, Fact, Facts, Group, LiveLevel, ManagedNote, SectionGrid } from '../kit';
import { BargeInStatus } from '../BargeInStatus';
import { ttsDiagView } from '../voice-engine-logic';
import { useVoiceDiagnostics } from './voice';

const MODEL_RANK: Record<LocalModelProgress['status'], number> = { failed: 0, missing: 1, queued: 2, downloading: 3, verifying: 4, ready: 5 };

/** Aynı roldeki dosyalar (çalıştırıcı + model) tek satır olur; durum en geride kalanın durumudur. */
function groupModels(models: LocalModelProgress[]) {
  const roles = new Map<string, { role: string; ids: string[]; status: LocalModelProgress['status']; receivedBytes: number; totalBytes: number }>();
  for (const model of models) {
    const current = roles.get(model.role);
    if (!current) {
      roles.set(model.role, { role: model.role, ids: [model.id], status: model.status, receivedBytes: model.receivedBytes, totalBytes: model.totalBytes });
      continue;
    }
    current.ids.push(model.id);
    current.receivedBytes += model.receivedBytes;
    current.totalBytes += model.totalBytes;
    if (model.status === 'downloading' && current.status !== 'failed') current.status = 'downloading';
    else if (MODEL_RANK[model.status] < MODEL_RANK[current.status] && current.status !== 'downloading') current.status = model.status;
  }
  return [...roles.values()];
}

const modelTone: Record<LocalModelProgress['status'], Tone> = {
  ready: 'success',
  missing: 'warning',
  queued: 'accent',
  downloading: 'accent',
  verifying: 'accent',
  failed: 'danger',
};

function TableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4 py-1" aria-busy aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-5">
          <Skeleton className="h-3.5 w-1/4 rounded-full" />
          <Skeleton className="h-3 flex-1 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Ses hattının bu cihazdaki ayarı: kim konuşuyor (bulut / yerel) ve neden, söz kesme kipi, yankı, uyandırma eşiği. */
function VoiceEngineRows({ voice }: { voice: ReturnType<typeof useVoiceDiagnostics> }) {
  if (voice.state.status === 'loading') return <TableSkeleton rows={5} />;
  if (voice.state.status === 'error') {
    // Ses servisi henüz kurulmadıysa (modeller iniyor) tanı okunamaz; sayfanın kalanı çalışır.
    return (
      <DataTable>
        <DataRow label={t('settings.diag.tts')} detail={t('settings.diag.unavailable')} testId="diag-tts" />
      </DataTable>
    );
  }
  const report = voice.state.data;
  const tts = report.engines.tts;
  // Ses nerede üretiliyor (ekran kartı / işlemci / bulut), seçilen motor değilse neden.
  const ttsView = ttsDiagView(tts);
  const echo = report.bargeIn.echo;
  const narrowed = report.bargeIn.policy !== report.bargeIn.effective;
  const calibratedAt = report.wake.calibratedAt;
  const profile = report.wake.profile ?? null;
  const profileName = profile === 'standard' || profile === 'sensitive' || profile === 'max' ? t(`settings.diag.wakeProfile.${profile}`) : profile;
  const latency = report.wake.latency ?? null;
  const round = (value: number | null) => (value === null ? '–' : String(Math.round(value)));
  const latencyLines = [
    latency?.kws ? t('settings.diag.wakeLatency.kws', { ms: round(latency.kws.sinceSpeechStartMs) }) : null,
    latency?.whisper ? t('settings.diag.wakeLatency.whisper', { ms: round(latency.whisper.sinceSpeechEndMs), stt: round(latency.whisper.sttMs) }) : null,
  ].filter(Boolean);
  const guard = report.echoGuard ?? null;
  // Söz kesme `wake`e indiyse nedeni (yankı sınaması, kendini kesme, söz kesme sınaması); `voice` ise yok.
  const wakeReason = guard?.wakeReason ?? null;
  const canceller = guard?.canceller ?? null;
  const cancellerState = !canceller ? 'idle' : canceller.converged ? 'converged' : canceller.trained ? 'trained' : 'learning';
  const bargeTest = guard?.bargeTest ?? null;
  const bargeTestOk = bargeTest ? bargeTest.trials > 0 && bargeTest.stopped === bargeTest.trials && bargeTest.selfInterrupts === 0 : false;
  const decimal = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');
  return (
    <>
    <div className="mb-4">
      <BargeInStatus onDone={voice.reload} />
    </div>
    <DataTable>
      <DataRow label={ttsView.label} detail={ttsView.body} testId="diag-tts">
        {ttsView.tone === 'warning' ? (
          <Badge
            tone="warning"
            dot
            data-active={tts.active}
            data-provider={tts.provider}
            data-fallback={tts.fallback?.reason}
            data-device={ttsView.device ?? ''}
            data-host={ttsView.hostPhase ?? ''}
          >
            {ttsView.badge}
          </Badge>
        ) : (
          <span data-active={tts.active} data-provider={tts.provider} data-fallback={tts.fallback?.reason} data-device={ttsView.device ?? ''} data-host={ttsView.hostPhase ?? ''}>
            {ttsView.badge}
          </span>
        )}
      </DataRow>
      <DataRow
        label={t('settings.diag.bargeIn')}
        detail={[t(`settings.voice.bargeIn.${report.bargeIn.effective}`), wakeReason ? t(`settings.diag.bargeIn.reason.${wakeReason}`) : narrowed ? t('settings.diag.bargeIn.narrowed') : null]
          .filter(Boolean)
          .join(' ')}
        testId="diag-bargein"
      >
        <span data-mode={report.bargeIn.effective} data-reason={wakeReason ?? undefined}>
          {t(`settings.diag.bargeIn.badge.${report.bargeIn.effective}`)}
        </span>
      </DataRow>
      <DataRow
        label={t('settings.diag.echo')}
        detail={
          echo
            ? `${t(echo.leaked ? 'settings.diag.echoLeaked' : 'settings.diag.echoClean', { when: relativeTime(echo.at) })} ${t('settings.diag.echoLevels', { baseline: formatPercent(echo.baselineRms), playback: formatPercent(echo.playbackRms) })}`
            : t('settings.diag.echoNever')
        }
        testId="diag-echo"
      >
        {echo?.leaked ? (
          <Badge tone="warning" dot data-leaked="true">
            {t('settings.diag.failed')}
          </Badge>
        ) : null}
      </DataRow>
      <DataRow
        label={t('settings.diag.wakeTuning')}
        detail={[
          calibratedAt ? t('settings.diag.wakeCalibrated', { when: relativeTime(calibratedAt) }) : t('settings.diag.wakeDefault'),
          report.wake.learned.length > 0 ? t('settings.diag.wakeLearned', { words: report.wake.learned.join(', ') }) : null,
          profileName ? t('settings.diag.wakeProfile', { profile: profileName }) : null,
        ]
          .filter(Boolean)
          .join(' ')}
        testId="diag-wake-threshold"
      >
        <span className="font-mono tabular-nums" data-calibrated={String(calibratedAt !== null)} data-profile={profile ?? undefined}>
          {report.wake.threshold.toFixed(2).replace('.', ',')}
        </span>
      </DataRow>
      <DataRow label={t('settings.diag.wakeLatency')} detail={latencyLines.length > 0 ? latencyLines.join(' ') : t('settings.diag.wakeLatencyNone')} testId="diag-wake-latency" />
      {guard ? (
        <DataRow
          label={t('settings.diag.echoGuard')}
          detail={[
            t('settings.diag.echoGuardBody', { ms: Math.round(guard.guardMs) }),
            t(`settings.diag.echoGuardAec.${guard.aec.mode}`),
            guard.dropped + guard.trimmed + guard.selfInterrupts > 0 ? t('settings.diag.echoGuardCounts', { dropped: guard.dropped, trimmed: guard.trimmed, self: guard.selfInterrupts }) : null,
          ]
            .filter(Boolean)
            .join(' ')}
          testId="diag-echo-guard"
        />
      ) : null}
      {guard ? (
        <DataRow
          label={t('settings.diag.canceller')}
          detail={
            canceller
              ? [
                  t(`settings.diag.canceller.${cancellerState}`),
                  canceller.trained
                    ? t('settings.diag.cancellerBody', { delay: Math.round(canceller.delayMs), erle: decimal(canceller.erleDb, 1), gate: decimal(canceller.gate, 1) })
                    : t('settings.diag.cancellerGate', { gate: decimal(canceller.gate, 1) }),
                  canceller.trained
                    ? t('bargein.canceller.trained', { delay: Math.round(canceller.delayMs), erle: decimal(canceller.erleDb, 1) })
                    : t('bargein.canceller.untrained', { corr: typeof canceller.corr === 'number' ? decimal(canceller.corr, 2) : '—', max: 1000 }),
                ].join(' ')
              : t('settings.diag.canceller.idle')
          }
          testId="diag-canceller"
        >
          <span data-state={cancellerState}>{t(`settings.diag.canceller.badge.${cancellerState}`)}</span>
        </DataRow>
      ) : null}
      {guard ? (
        <DataRow
          label={t('settings.diag.bargeTest')}
          detail={
            bargeTest
              ? [
                  t('settings.diag.bargeTestBody', { when: relativeTime(bargeTest.at), trials: bargeTest.trials, stopped: bargeTest.stopped }),
                  bargeTest.medianMs !== null ? t('settings.diag.bargeTestMedian', { ms: Math.round(bargeTest.medianMs) }) : null,
                  bargeTest.selfInterrupts > 0 ? t('settings.diag.bargeTestSelf', { self: bargeTest.selfInterrupts }) : null,
                ]
                  .filter(Boolean)
                  .join(' ')
              : t('settings.diag.bargeTestNever')
          }
          testId="diag-barge-test"
        >
          {bargeTest && !bargeTestOk ? (
            <Badge tone="warning" dot data-ok="false">
              {t('settings.diag.failed')}
            </Badge>
          ) : null}
        </DataRow>
      ) : null}
    </DataTable>
    </>
  );
}

export function Diagnostics() {
  const shell = useShell();
  // Son uyandırma ve son tur ana süreçte birikir (`app.diagnostics`): pencere sonradan açılsa da gerçek veri görünür.
  const diagnostics = useLive(() => window.fuber.invoke('app.diagnostics'), ['voice.wake', 'voice.turn', 'voice.state', 'voice.error']);
  const listen = diagnostics.data?.lastListen ?? null;
  const lastWake = diagnostics.data?.lastWake ?? null;
  const turn = diagnostics.data?.lastTurn ?? null;
  // Uyandırma sözüyle başladıysa hangi yoldan algılandığı da söylenir (sezici ya da yazıya çevirme yolu).
  const wakePath =
    listen?.reason === 'wake' && lastWake ? t(`settings.diag.path.${lastWake.path}`, { score: Math.round(lastWake.score * 100) }) : listen ? t(`settings.diag.path.${listen.reason}`) : null;
  const models = useLive(() => window.fuber.invoke('setup.models'), ['setup.modelProgress', 'policy.changed']);
  const voiceDiagnostics = useVoiceDiagnostics();
  const tools = useLive<ToolCallRecord[]>(() => window.fuber.invoke('tools.recent', { limit: 5 }), ['tool.call']);
  const policy = shell.policy;
  const deep = shell.brainStatus?.deep ?? null;
  // Konuşan beyin olarak Claude Code (bu bilgisayardaki CLI, abonelik): durum ana süreçten gelir, tahmin edilmez.
  const claude = shell.brainStatus?.claudeCode ?? null;
  const cloudBrain = shell.brainStatus?.cloud ?? null;
  const viaClaude = cloudBrain?.provider === 'claude-code';
  const claudeReset = claude?.resetsAt ? new Date(claude.resetsAt).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
  const brainCause = shell.brainStatus?.cause ?? null;
  const brainReason = shell.brainStatus?.reason ?? null;

  const voiceReport = voiceDiagnostics.data;
  const modelList = models.data ?? [];
  const modelsPending = modelList.filter((model) => model.status !== 'ready').length;
  const bargeTested = voiceReport?.echoGuard?.bargeTest ?? null;
  const problems = [
    modelsPending > 0 ? t('settings.diag.problem.models', { count: modelsPending }) : null,
    voiceReport?.bargeIn.echo?.leaked ? t('settings.diag.problem.echo') : null,
    voiceReport && !voiceReport.engines.tts.local && voiceReport.engines.tts.active !== 'elevenlabs' ? t('settings.diag.problem.tts') : null,
    bargeTested && bargeTested.stopped < bargeTested.trials ? t('settings.diag.problem.barge') : null,
  ].filter((item): item is string => item !== null);
  const issues = problems.length;
  const summary =
    !diagnostics.data && !voiceReport
      ? t('settings.diag.summaryLoading')
      : issues > 0
        ? t('settings.diag.summaryIssue', { list: problems.join(', ') })
        : turn && turn.endOfSpeechToFirstAudioMs !== null
          ? t('settings.diag.summaryTurn', { sec: (turn.endOfSpeechToFirstAudioMs / 1000).toFixed(2).replace('.', ',') })
          : t('settings.diag.summaryOk');
  const ms = (value: number | null | undefined) => (value === null || value === undefined ? '–' : String(Math.round(value)));
  const stages = [
    ['stt', turn?.sttMs],
    ['brain', turn?.firstSentenceMs],
    ['tts', turn?.ttsFirstAudioMs],
    ['total', turn?.endOfSpeechToFirstAudioMs],
  ] as const;
  const grouped = models.state.status === 'ready' ? groupModels(models.state.data) : [];

  return (
    <SectionGrid>
      <Group
        tone="lead"
        span="full"
        title={t('settings.diag.voice')}
        description={
          <span className={cn(issues > 0 && 'text-warning')} role="status" data-testid="diag-summary" data-issues={issues}>
            {summary}
          </span>
        }
        keywords={t('settings.kw.diag')}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2" data-st-row="" data-testid="diag-turn">
            <span className="text-sm text-fg-muted">{turn ? t('settings.diag.lastTurn') : t('settings.diag.noTurn')}</span>
            <div className="st-metrics">
              {stages.map(([key, value]) => (
                <Metric
                  key={key}
                  label={t(`settings.diag.turn.${key}`)}
                  value={ms(value)}
                  unit={value === null || value === undefined ? undefined : 'ms'}
                  className={cn((value === null || value === undefined) && '[&_.ui-metric-value]:text-fg-faint')}
                />
              ))}
            </div>
          </div>
          <Facts min={280} className="border-t border-line pt-5">
            <Fact label={t('settings.diag.level')} hint={shell.voice?.inputDeviceLabel ?? t('settings.voice.defaultMic')}>
              <LiveLevel testId="diag-level" className="max-w-[420px] py-1.5" />
            </Fact>
            <Fact label={t('settings.diag.lastWake')} testId="diag-wake">
              <span className={cn('text-sm', !(listen && wakePath) && 'text-fg-muted')}>
                {listen && wakePath ? t('settings.diag.wakeBody', { path: wakePath, time: localTime(listen.at) }) : t('settings.diag.noWake')}
              </span>
            </Fact>
          </Facts>
        </div>
      </Group>

      <Column span="main">
        <Group title={t('settings.diag.voiceDetail')}>
          <VoiceEngineRows voice={voiceDiagnostics} />
        </Group>
        <Group title={t('settings.diag.models')} description={t('settings.diag.modelsHint')}>
          {models.state.status === 'loading' ? (
            <TableSkeleton rows={4} />
          ) : models.state.status === 'error' ? (
            <ErrorPanel message={models.state.message} onRetry={models.reload} />
          ) : (
            <DataTable>
              {grouped.map((model) => {
                const fraction = model.totalBytes > 0 ? model.receivedBytes / model.totalBytes : 0;
                return (
                  <DataRow
                    key={model.role}
                    label={t(`settings.diag.role.${model.role}`, { role: model.role })}
                    detail={<span className="font-mono break-all">{model.ids.join(' · ')}</span>}
                    testId="diag-model"
                  >
                    {model.status === 'downloading' && <ProgressBar value={fraction} size="sm" className="w-24" aria-label={model.role} />}
                    {model.status === 'ready' ? (
                      <span data-status="ready" className="text-fg-muted">
                        {t('settings.diag.model.ready')}
                      </span>
                    ) : (
                      <Badge tone={modelTone[model.status]} dot data-status={model.status}>
                        {model.status === 'downloading' ? formatPercent(fraction) : t(`settings.diag.model.${model.status}`)}
                      </Badge>
                    )}
                  </DataRow>
                );
              })}
            </DataTable>
          )}
        </Group>
      </Column>

      <Column span="side">
        <Group title={t('settings.diag.brain')} keywords={t('settings.kw.brain')}>
          <DataTable>
            <DataRow
              label={shell.brain === 'local' ? t('nav.status.brainLocal') : shell.brain === 'none' ? t('nav.status.brainNone') : t(viaClaude ? 'ccbrain.badge' : 'nav.status.brainCloud')}
              detail={
                shell.brain === 'cloud' && viaClaude && claude
                  ? `${t('ccbrain.diag.active', { version: claude.version ?? '?', voice: claude.voiceModel, chat: claude.chatModel })}${claude.lastFirstTextMs !== null ? t('ccbrain.diag.activeTiming', { ms: Math.round(claude.lastFirstTextMs) }) : ''}`
                  : shell.brain === 'local'
                  ? t(
                      shell.brainStatus?.cause === 'billing'
                        ? 'settings.diag.brainLocalBilling'
                        : shell.brainStatus?.cause === 'auth'
                          ? 'settings.diag.brainLocalAuth'
                          : shell.brainStatus?.cause === 'network'
                            ? 'settings.diag.brainLocalNetwork'
                            : 'settings.diag.brainLocal',
                      { model: policy?.brain.local.modelId ?? '' },
                    )
                  : shell.brain === 'none'
                    ? (shell.brainStatus?.message ?? t('nav.status.brainNoneHint'))
                    : t('settings.diag.brainCloud', { voice: policy?.models.voice.model ?? '', deep: policy?.models.deep.model ?? '' })
              }
              testId="diag-brain"
            />
            {cloudBrain ? (
              <DataRow
                label={t('settings.diag.cloud')}
                detail={
                  brainReason === 'private'
                    ? t('settings.diag.cloud.private', { name: cloudBrain.name })
                    : brainReason === 'cloud_down' && brainCause
                      ? t(`settings.diag.cloud.down.${brainCause}`, { name: cloudBrain.name, model: cloudBrain.model })
                      : brainReason === 'no_key'
                        ? t('settings.diag.cloud.noKey', { name: cloudBrain.name })
                        : brainReason === 'policy_local'
                          ? t('settings.diag.cloud.policyLocal', { name: cloudBrain.name })
                          : shell.brain === 'cloud'
                            ? t('settings.diag.cloud.body', { name: cloudBrain.name, model: cloudBrain.model })
                            : t('settings.diag.cloud.standby', { name: cloudBrain.name, model: cloudBrain.model })
                }
                testId="diag-cloud"
              >
                {brainReason === 'cloud_down' || brainReason === 'no_key' ? (
                  <Badge tone="warning" dot data-provider={cloudBrain.provider} data-cause={brainCause ?? undefined}>
                    {t('settings.diag.cloud.badge.down')}
                  </Badge>
                ) : (
                  <span data-provider={cloudBrain.provider} data-name={cloudBrain.name}>
                    {cloudBrain.name}
                  </span>
                )}
              </DataRow>
            ) : null}
            {claude ? (
              <DataRow
                label={t('ccbrain.diag.label')}
                detail={
                  claude.state === 'active'
                    ? t('ccbrain.diag.activeRow', { version: claude.version ?? '?', warm: claude.warm })
                    : claude.state === 'standby'
                      ? t('ccbrain.diag.standby', { version: claude.version ?? '?' })
                      : claude.state === 'limit' && claudeReset
                        ? t('ccbrain.diag.limitUntil', { time: claudeReset })
                        : (claude.reason ?? '')
                }
                testId="diag-claude-code"
              >
                {claude.state === 'active' || claude.state === 'standby' || claude.state === 'off' || claude.state === 'private' || claude.state === 'checking' ? (
                  <span data-state={claude.state} data-use={claude.use}>
                    {t(
                      claude.state === 'active'
                        ? 'ccbrain.diag.badge.active'
                        : claude.state === 'standby'
                          ? 'ccbrain.diag.badge.standby'
                          : claude.state === 'checking'
                            ? 'ccbrain.diag.badge.checking'
                            : 'ccbrain.diag.badge.off',
                    )}
                  </span>
                ) : (
                  <Badge tone="warning" dot data-state={claude.state} data-use={claude.use}>
                    {t('ccbrain.diag.badge.down')}
                  </Badge>
                )}
              </DataRow>
            ) : null}
            <DataRow label={t('settings.diag.fallback')} detail={policy?.brain.localFallback === 'auto' ? t('settings.diag.fallbackAuto') : t('settings.diag.fallbackOff')}>
              <ManagedNote />
            </DataRow>
            <DataRow
              label={t('settings.diag.deep')}
              detail={
                !deep
                  ? t('settings.diag.deep.unknown')
                  : deep.ok
                    ? deep.provider === 'claude-code'
                      ? t('settings.diag.deep.claudeCode', { version: deep.claudeCode.version ?? '?' })
                      : t('settings.diag.deep.anthropic')
                    : (deep.reason ?? t('settings.diag.deep.unavailable'))
              }
              testId="diag-deep"
            >
              {deep && !deep.ok ? (
                <Badge tone="warning" dot data-ok="false" data-provider={deep.provider ?? undefined}>
                  {t('settings.diag.deep.badge.off')}
                </Badge>
              ) : null}
            </DataRow>
          </DataTable>
        </Group>

        <Group title={t('settings.diag.pc')} description={t('settings.diag.pc.hint')}>
          <DataTable>
            {(
              [
                ['read', shell.settings?.pcReadAllowed !== false],
                ['control', shell.settings?.pcControlAllowed !== false],
              ] as const
            ).map(([key, allowed]) => (
              <div key={key} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0.5 last:pb-0.5" data-st-row="" data-testid={`diag-pc-${key}`}>
                <span className="text-sm text-fg">{t(`settings.diag.pc.${key}`)}</span>
                <span className={cn('shrink-0 text-sm', allowed ? 'text-fg' : 'text-fg-muted')}>{allowed ? t('settings.diag.pc.on') : t('settings.diag.pc.off')}</span>
              </div>
            ))}
          </DataTable>
        </Group>

        <Group title={t('settings.diag.tools')}>
          {(tools.data ?? []).length === 0 ? (
            <p className="text-sm text-fg-muted">{t('settings.diag.noTools')}</p>
          ) : (
            <DataTable>
              {(tools.data ?? []).map((call) => (
                <div key={call.callId} className="flex flex-col gap-0.5 py-2.5 first:pt-0.5 last:pb-0.5" data-st-row="">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-sm text-fg">{call.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-fg-faint">
                      {!call.ok && (
                        <Badge tone="warning" dot size="sm">
                          {t('settings.diag.failed')}
                        </Badge>
                      )}
                      {relativeTime(call.startedAt)}
                    </span>
                  </div>
                  {call.text && <span className="line-clamp-2 text-sm text-fg-muted">{call.text}</span>}
                </div>
              ))}
            </DataTable>
          )}
        </Group>

        <Group
          title={t('settings.diag.app')}
          action={
            <Button size="sm" icon={<FolderOpen />} onClick={() => void attempt(() => window.fuber.invoke('settings.openLogsDir'))} data-testid="settings-open-logs">
              {t('settings.diag.openLogs')}
            </Button>
          }
        >
          <div className="flex flex-col gap-0.5" data-st-row="" data-testid="diag-version">
            <span className="text-sm font-medium text-fg">{t('settings.diag.version', { version: shell.info?.version ?? '' })}</span>
            <span className="text-sm text-fg-muted">
              {shell.info ? t('settings.diag.runtime', { electron: shell.info.electron, chrome: shell.info.chrome.split('.')[0] ?? '', date: formatDay(new Date()) }) : '…'}
            </span>
          </div>
        </Group>
      </Column>
    </SectionGrid>
  );
}
