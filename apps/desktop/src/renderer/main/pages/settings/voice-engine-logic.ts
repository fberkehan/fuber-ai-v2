// Ayarlar › Ses motoru: saf yardımcılar (durum metni, "şu an konuşan" satırı, Tanı satırı). Arayüz VoiceEngine.tsx'te.
import { TTS_ENGINES, isGpuDevice, relativeTime, t, type MessageKey, type TtsDevice, type TtsEngineId, type TtsEngineStatus, type TtsEnginesReport, type VoiceDiagnosticsReport } from '@fuber/shared';
import type { Tone } from '@fuber/ui';

export type TtsDiag = VoiceDiagnosticsReport['engines']['tts'];

export interface EngineStatusView {
  /** Raporun durumu (`TtsEngineStatus.state`): rozet, eylem ve çubuk bundan türer. */
  kind: TtsEngineStatus['state'];
  tone: Tone;
  label: string;
  /** Satırın altında görünen neden (hazır ve konuşuyorsa boş). */
  detail: string | null;
  /** Dosya boyutu: inerken "13 / 33 MB", indirilmemişken "33 MB"; gösterilmeyecekse `null`. */
  size: string | null;
  /** İlerleme çubuğu (0–1); yalnız inerken ve doğrulanırken. */
  progress: number | null;
  /** Satırdaki eylem: indir · yeniden dene · indirmeyi durdur. */
  action: 'download' | 'retry' | 'cancel' | null;
}

const MB = 1024 * 1024;
const megabytes = (bytes: number): string => String(bytes >= 10 * MB ? Math.round(bytes / MB) : Math.round((bytes / MB) * 10) / 10).replace('.', ',');

/** Motor satırının durumu. Seçili görünen motor konuşmuyorsa rozet bunu söyler (iniyor / yükleniyor / hazırlanamadı). */
export function engineStatusView(engine: TtsEngineStatus): EngineStatusView {
  const bytes = engine.bytes && engine.bytes.total > 0 ? engine.bytes : null;
  const base = { detail: engine.reason, size: null, progress: null, action: null };
  switch (engine.state) {
    case 'speaking':
      return { ...base, kind: 'speaking', tone: 'success', label: t('tts.status.speaking') };
    case 'ready':
      return { ...base, kind: 'ready', tone: 'neutral', label: t('tts.status.ready') };
    case 'downloading': {
      const fraction = engine.progress === null ? null : Math.min(1, Math.max(0, engine.progress));
      return {
        ...base,
        kind: 'downloading',
        tone: 'accent',
        label: fraction === null ? t('tts.status.downloading') : `${t('tts.status.downloading')} %${Math.round(fraction * 100)}`,
        // Yüzde rozette ve çubukta; alt satırda yinelenmez.
        detail: null,
        size: bytes ? t('tts.settings.size', { received: megabytes(bytes.received), total: megabytes(bytes.total) }) : null,
        progress: fraction ?? 0,
        action: 'cancel',
      };
    }
    case 'verifying':
      return { ...base, kind: 'verifying', tone: 'accent', label: t('tts.status.verifying'), progress: engine.progress };
    case 'loading':
      return { ...base, kind: 'loading', tone: 'accent', label: t('tts.status.loading') };
    case 'missing':
      return {
        ...base,
        kind: 'missing',
        tone: 'warning',
        label: t('tts.status.missing'),
        size: bytes ? t('tts.settings.sizeTotal', { total: megabytes(bytes.total) }) : null,
        action: engine.canPrepare ? 'download' : null,
      };
    case 'failed':
      return { ...base, kind: 'failed', tone: 'danger', label: t('tts.status.failed'), action: engine.canPrepare ? 'retry' : null };
    default:
      return { ...base, kind: 'unavailable', tone: 'warning', label: t('tts.status.unavailable') };
  }
}

/** Rapor geçiş halinde mi (iniyor, doğrulanıyor, yükleniyor ya da seçili motor henüz konuşmuyor): arayüz sık yeniler. */
export const reportInFlux = (report: TtsEnginesReport): boolean =>
  report.selected !== report.active || report.engines.some((engine) => engine.state === 'downloading' || engine.state === 'verifying' || engine.state === 'loading');

/**
 * "Şu an konuşan" satırının notu: seçili motor konuşmuyorsa NEDEN ve ne olacağı. Seçili görünen = konuşan değilse
 * arayüz bunu burada açıkça söyler.
 */
export function pendingNote(report: TtsEnginesReport): string | null {
  if (report.selected === report.active) return null;
  const selected = report.engines.find((engine) => engine.id === report.selected);
  const active = report.engines.find((engine) => engine.id === report.active);
  const names = { selected: selected?.label ?? t(TTS_ENGINES[report.selected].label), active: active?.label ?? t(TTS_ENGINES[report.active].label) };
  switch (selected?.state) {
    case 'downloading':
    case 'verifying':
    case 'loading':
      return t('tts.settings.pendingNote', names);
    case 'missing':
      return t('tts.settings.pendingMissing', names);
    case 'failed':
      return [t('tts.settings.pendingFailed', names), selected.reason].filter(Boolean).join(' ');
    default:
      return report.note ?? t('tts.settings.pendingFailed', names);
  }
}

export const deviceName = (device: TtsDevice | null | undefined): string => (device ? t(`tts.device.${device}` as MessageKey) : '');

/** Motorun bir sesinin görünen adı (rapordan; yoksa kimliğin kendisi). */
export function voiceLabel(engine: TtsEngineStatus | undefined, voiceId: string | null | undefined): string | null {
  if (!voiceId) return null;
  return engine?.voices.find((voice) => voice.id === voiceId)?.label ?? voiceId;
}

/** "Şu an konuşan": "Supertonic 3 · Erkek 4 · tok · Ekran kartı (CUDA)". */
export function activeLine(report: TtsEnginesReport): string {
  const engine = report.engines.find((item) => item.id === report.active);
  const name = engine?.label ?? t(TTS_ENGINES[report.active].label);
  const voice = voiceLabel(engine, engine?.voice);
  const device = deviceName(report.activeDevice);
  if (!device) return name;
  return voice ? t('tts.settings.nowVoice', { engine: name, voice, device }) : t('tts.settings.nowBody', { engine: name, device });
}

export type DiagKind = 'gpu' | 'cpu' | 'cloud' | 'none';

export interface TtsDiagView {
  label: string;
  body: string;
  badge: string;
  kind: DiagKind;
  tone: Tone;
  device: TtsDevice | null;
  hostPhase: string | null;
}

/** Tanı › seslendirme satırı: etkin motor, nerede üretildiği ve seçili motordan farklıysa nedeni. */
export function ttsDiagView(tts: TtsDiag): TtsDiagView {
  const device: TtsDevice | null = tts.device ?? (tts.active === 'elevenlabs' ? 'cloud' : tts.active === 'piper-local' && tts.local ? 'cpu' : null);
  const kind: DiagKind = isGpuDevice(device) ? 'gpu' : device === 'cpu' ? 'cpu' : device === 'cloud' ? 'cloud' : 'none';
  const info = TTS_ENGINES[tts.active];
  const voice = info.voices.find((item) => item.id === tts.voice);
  const voiceText = voice ? t(voice.label) : (tts.voice ?? tts.voiceId ?? '');
  const body =
    kind === 'gpu'
      ? t('tts.diag.body.gpu', { device: deviceName(device), voice: voiceText })
      : kind === 'cpu'
        ? t('tts.diag.body.cpu')
        : kind === 'cloud'
          ? t('tts.diag.body.cloud', { voice: tts.voiceId ?? '', model: tts.model ?? '' })
          : t('tts.diag.body.none');

  const parts = [body];
  if (tts.provider !== tts.active) {
    parts.push(t('tts.diag.selected', { engine: t(TTS_ENGINES[tts.provider].label) }));
    if (tts.fallback) {
      parts.push(tts.fallback.message);
      if (tts.fallback.until) parts.push(t('settings.diag.tts.retryAt', { time: relativeTime(tts.fallback.until) }));
    } else if (tts.host && TTS_ENGINES[tts.provider].kind === 'host') {
      // `reason` denenen cihazların hepsini zaten anlatır; boşsa denemeler tek tek yazılır.
      if (tts.host.reason) parts.push(tts.host.reason);
      else for (const attempt of tts.host.attempts) parts.push(t('tts.diag.attempt', { device: deviceName(attempt.device), error: attempt.error }));
    }
  }
  const text = parts.map((part) => (/[.!?…]$/.test(part.trim()) ? part.trim() : `${part.trim()}.`)).join(' ');
  return {
    label: t('tts.diag.active', { engine: t(info.label) }),
    body: text,
    badge: t(`tts.diag.badge.${kind}` as MessageKey),
    kind,
    tone: kind === 'gpu' ? 'success' : kind === 'cloud' ? 'accent' : kind === 'cpu' ? 'neutral' : 'warning',
    device,
    hostPhase: tts.host?.phase ?? null,
  };
}

/** Yeni bir ses seçimi için `ttsVoices` yaması (öteki motorların seçimi korunur). */
export const nextVoices = (current: Partial<Record<TtsEngineId, string>> | undefined, engine: TtsEngineId, voice: string): Partial<Record<TtsEngineId, string>> => ({
  ...(current ?? {}),
  [engine]: voice,
});
