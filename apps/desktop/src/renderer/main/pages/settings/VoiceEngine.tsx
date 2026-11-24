// Ayarlar › Ses › "Jarvis'in sesi": ses motoru (dört seçenek), seçili motorun sesleri + "Dinle", şu an konuşan.
// Seçim cihaz düzeyindedir (`Settings.ttsEngine`, `Settings.ttsVoices`) ve yeniden başlatmadan uygulanır.
// Kutu ve satırlar `kit.tsx`'in yapı taşlarıdır (`Group`, `SettingRow`, `Rows`): arama bu satırları da bulur.
import { useEffect, useState } from 'react';
import { ArrowClockwise, ArrowCounterClockwise, Check, DownloadSimple, Play, Warning, X } from '@phosphor-icons/react';
import { TTS_ENGINES, t, type Settings, type TtsEngineId, type TtsEngineStatus, type TtsEnginesReport } from '@fuber/shared';
import { Badge, Button, ProgressBar, cn, toast } from '@fuber/ui';
import { attempt, useLive } from '../../shell/live';
import { SkeletonRows } from '../../shell/parts';
import { Group, Rows, SettingRow, type Span } from './kit';
import { activeLine, engineStatusView, nextVoices, pendingNote, reportInFlux, ttsDiagView, type TtsDiag } from './voice-engine-logic';

const REFRESH = ['voice.status', 'setup.modelProgress', 'settings.changed', 'policy.changed', 'voice.error'] as const;

const save = async (patch: Partial<Settings>): Promise<void> => {
  const result = await attempt(() => window.fuber.invoke('settings.update', { patch }));
  if (result) toast.success(t('tts.settings.saved'));
};

/** "İndir" / "Yeniden dene": motorun dosyalarını hazırlar; "Durdur": süren indirmeyi keser. */
const prepare = async (engine: TtsEngineId): Promise<void> => {
  const result = await attempt(() => window.fuber.invoke('voice.ttsPrepare', { engine }));
  if (result) toast.success(t('tts.settings.started'));
};
const cancelPrepare = async (): Promise<void> => {
  const result = await attempt(() => window.fuber.invoke('voice.ttsCancelPrepare'));
  if (result) toast.success(t('tts.settings.cancelled'));
};

/**
 * Motor kartı: üst kısım seçim düğmesidir (radyo); altında gerekiyorsa indirme çubuğu, boyut ve eylem (İndir /
 * Yeniden dene / Durdur). Dosyası olmayan motor da seçilebilir: seçilince indirme başlar, bitince kendiliğinden ona
 * geçilir; o zamana dek rozet "İniyor" der ve "Şu an konuşan" satırı gerçekte konuşan motoru gösterir.
 */
function EngineRow({ engine, selected, onSelect }: { engine: TtsEngineStatus; selected: boolean; onSelect: () => void }) {
  const view = engineStatusView(engine);
  const extra = view.progress !== null || view.size !== null || view.action !== null || view.detail !== null;
  return (
    <div
      data-st-row=""
      data-testid={`tts-engine-row-${engine.id}`}
      data-state={engine.state}
      className={cn('flex min-w-0 flex-col gap-2 rounded-lg border px-3.5 py-2.5 transition-colors', selected ? 'border-accent bg-accent-soft' : 'border-line')}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        data-testid={`tts-engine-${engine.id}`}
        data-selected={selected ? 'true' : 'false'}
        data-available={engine.available ? 'true' : 'false'}
        data-files={engine.files}
        data-state={engine.state}
        className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md text-left"
      >
        <span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-base text-fg">
            {engine.label}
            {selected && <Check weight="bold" className="size-4 text-accent-fg" aria-hidden />}
          </span>
          <span className="text-sm text-fg-muted">{engine.hint}</span>
        </span>
        <Badge tone={view.tone} dot data-status={view.kind} data-testid={`tts-badge-${engine.id}`}>
          {view.label}
        </Badge>
      </button>
      {extra && (
        <div className="flex flex-col gap-2">
          {view.progress !== null && <ProgressBar value={view.progress} size="sm" aria-label={view.label} data-testid={`tts-progress-${engine.id}`} />}
          {view.detail && (
            <span className={cn('text-sm', view.tone === 'warning' || view.tone === 'danger' ? 'text-warning' : 'text-fg-muted')} data-testid={`tts-reason-${engine.id}`}>
              {view.detail}
            </span>
          )}
          {(view.size !== null || view.action !== null) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm tabular-nums text-fg-muted" data-testid={`tts-size-${engine.id}`}>
                {view.size ?? ''}
              </span>
              {view.action === 'download' && (
                <Button size="sm" variant="secondary" icon={<DownloadSimple />} onClick={() => void prepare(engine.id)} data-testid={`tts-download-${engine.id}`}>
                  {t('tts.settings.download')}
                </Button>
              )}
              {view.action === 'retry' && (
                <Button size="sm" variant="secondary" icon={<ArrowClockwise />} onClick={() => void prepare(engine.id)} data-testid={`tts-retry-${engine.id}`}>
                  {t('tts.settings.retry')}
                </Button>
              )}
              {view.action === 'cancel' && (
                <Button size="sm" variant="ghost" icon={<X />} onClick={() => void cancelPrepare()} data-testid={`tts-cancel-${engine.id}`}>
                  {t('tts.settings.cancelDownload')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Ses satırı: ad, "Dinle" ve "Seç". Dinle yalnız tıklayınca ses çalar. */
function VoiceRow({
  id,
  label,
  selected,
  selectable,
  previewable,
  listening,
  message,
  onListen,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  selectable: boolean;
  previewable: boolean;
  listening: boolean;
  message: string | null;
  onListen: () => void;
  onSelect: () => void;
}) {
  return (
    <div className="st-row" data-st-row="" data-testid={`tts-voice-${id}`} data-selected={selected ? 'true' : 'false'}>
      <div className="st-row-text">
        <span className="st-row-label flex flex-wrap items-center gap-2">
          {label}
          {selected && (
            <Badge tone="accent" size="sm" icon={<Check weight="bold" />}>
              {t('tts.settings.selected')}
            </Badge>
          )}
        </span>
      </div>
      <div className="st-row-control">
        <Button
          size="sm"
          variant="secondary"
          icon={<Play weight="fill" />}
          loading={listening}
          disabled={!previewable}
          onClick={onListen}
          aria-label={t('tts.settings.listenLabel', { voice: label })}
          data-testid={`tts-listen-${id}`}
        >
          {listening ? t('tts.settings.listening') : t('tts.settings.listen')}
        </Button>
        {selectable && !selected && (
          <Button size="sm" variant="ghost" onClick={onSelect} aria-label={`${t('tts.settings.select')}: ${label}`} data-testid={`tts-select-${id}`}>
            {t('tts.settings.select')}
          </Button>
        )}
      </div>
      {message && (
        <p className="st-row-note" data-tone="warning" role="status" data-testid="tts-preview-result">
          {message}
        </p>
      )}
    </div>
  );
}

function Voices({ report, settings }: { report: TtsEnginesReport; settings: Settings }) {
  const engine = report.engines.find((item) => item.id === report.selected);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; message: string } | null>(null);
  if (!engine) return null;
  const cloud = TTS_ENGINES[engine.id].kind === 'cloud';

  const listen = async (key: string, voice?: string) => {
    if (busy) return;
    setBusy(key);
    setResult(null);
    const outcome = await attempt(() => window.fuber.invoke('voice.ttsPreview', { engine: engine.id, voice }));
    setBusy(null);
    if (outcome && !outcome.ok) setResult({ key, message: outcome.message ?? t('tts.settings.previewFailed', { reason: '' }) });
  };

  // ElevenLabs: ses listesi yok; ses Fuber Yönetim'den seçilir.
  const rows = cloud ? [{ id: engine.id, label: engine.label }] : engine.voices;
  return (
    <div className="flex flex-col gap-1 py-3" data-testid="tts-voices">
      {/* `st-row-text` değil: onun 200 px esnek tabanı sütun düzeninde yüksekliğe dönüşüp boşluk açar. */}
      <div className="flex flex-col gap-0.5">
        <span className="st-row-label">{t('tts.settings.voice')}</span>
        <span className="st-row-desc">{cloud ? t('tts.settings.voiceManaged') : t('tts.settings.voiceHint')}</span>
        {!engine.previewable && (
          <span className="text-sm text-warning" data-testid="tts-listen-disabled">
            {t('tts.settings.listenDisabled', { reason: engine.reason ?? t('tts.settings.previewNotReady') })}
          </span>
        )}
      </div>
      <Rows columns={rows.length > 2 ? 280 : undefined}>
        {rows.map((voice) => {
          const key = cloud ? engine.id : voice.id;
          return (
            <VoiceRow
              key={key}
              id={key}
              label={voice.label}
              selected={!cloud && engine.voice === voice.id}
              selectable={!cloud && engine.voices.length > 1}
              previewable={engine.previewable}
              listening={busy === key}
              message={result?.key === key ? result.message : null}
              onListen={() => void listen(key, cloud ? undefined : voice.id)}
              onSelect={() => void save({ ttsVoices: nextVoices(settings.ttsVoices, engine.id, voice.id) })}
            />
          );
        })}
      </Rows>
      {cloud && <p className="text-sm text-fg-muted">{t('tts.settings.cloudNote')}</p>}
    </div>
  );
}

export function VoiceEngine({ settings, span = 'full' }: { settings: Settings; span?: Span }) {
  const live = useLive<TtsEnginesReport>(() => window.fuber.invoke('voice.ttsEngines'), REFRESH);
  // Geçiş sürerken (iniyor, yükleniyor, seçili motor henüz konuşmuyor) durum saniyede bir yenilenir: konağın motor
  // değiştirmesi bir olay yaymaz; rozet ve "şu an konuşan" satırı gerçeğin gerisinde kalmasın.
  const flux = live.state.status === 'ready' && reportInFlux(live.state.data);
  const reload = live.reload;
  useEffect(() => {
    if (!flux) return undefined;
    const timer = window.setInterval(reload, 1000);
    return () => window.clearInterval(timer);
  }, [flux, reload]);
  return (
    <Group span={span} title={t('tts.settings.title')} description={t('tts.settings.hint')} keywords={t('settings.kw.tts')} testId="settings-tts">
      {live.state.status === 'loading' && <SkeletonRows count={3} />}
      {live.state.status === 'error' && <SettingRow label={t('tts.settings.engine')} description={live.state.message} testId="tts-error" />}
      {live.state.status === 'ready' && <Body report={live.state.data} settings={settings} />}
    </Group>
  );
}

function Body({ report, settings }: { report: TtsEnginesReport; settings: Settings }) {
  const device = report.source === 'device';
  const note = pendingNote(report);
  return (
    <>
      <SettingRow
        label={t('tts.settings.engine')}
        description={
          <>
            {t('tts.settings.engineHint')} {device ? t('tts.settings.sourceDevice') : t('tts.settings.sourcePolicy')}
          </>
        }
        testId="tts-engine"
      >
        {device && (
          <Button size="sm" variant="ghost" icon={<ArrowCounterClockwise />} onClick={() => void save({ ttsEngine: null })} data-testid="tts-use-policy">
            {t('tts.settings.usePolicy')}
          </Button>
        )}
      </SettingRow>
      <div
        role="radiogroup"
        aria-label={t('tts.settings.engine')}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-2 py-3"
        data-source={report.source}
      >
        {report.engines.map((engine) => (
          <EngineRow key={engine.id} engine={engine} selected={report.selected === engine.id} onSelect={() => void save({ ttsEngine: engine.id as TtsEngineId })} />
        ))}
      </div>
      <Voices key={report.selected} report={report} settings={settings} />
      <div className="st-row" data-st-row="" data-testid="tts-active" data-active={report.active} data-selected={report.selected} data-device={report.activeDevice ?? ''} data-source={report.source}>
        <div className="st-row-text">
          <span className="st-row-label">{t('tts.settings.now')}</span>
          {note && (
            <span className="flex items-start gap-1.5 text-sm text-warning" data-testid="tts-note">
              <Warning weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
              {note}
            </span>
          )}
        </div>
        <span className="st-row-value text-base!" data-testid="tts-active-text">
          {activeLine(report)}
        </span>
      </div>
    </>
  );
}

/** Tanı › seslendirme satırı gövdesi için dışa açılan görünüm (sections/diagnostics.tsx'teki `diag-tts` satırı kullanır). */
export { ttsDiagView };
export type { TtsDiag };
