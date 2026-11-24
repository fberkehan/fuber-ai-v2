/**
 * Ses servisi (`VoiceApi`): oturumu (durum makinesi) gerçek parçalara bağlar — gizli ses penceresi
 * (mikrofon + oynatma), ses işçisi (VAD, sezici, Piper, ElevenLabs), whisper-server (STT).
 *
 * Kurulum sırası: modeller hazır mı → ses penceresi → işçi (port teslimi) → STT. Hepsi ayaktayken hat
 * "hazır" olur ve mikrofon açılır. Parçalardan biri düşerse yeniden başlatılır; düzelmeyen sorun
 * `VoiceStatus.notReadyReason` ve `voice.error` ile kullanıcıya söylenir, uygulama yazıyla çalışmayı sürdürür.
 *
 * Bu dosyada ayrıca: seslendirme seçimi (cihaz ayarı ya da politika), ses konağı (ekran kartı motorları) ve düşüş
 * zinciri (ekran kartı → Piper; bulut → yerel), "Dinle", uyandırma kalibrasyonu, yankı sınaması ve tanı. Cihaza özgü
 * sonuçlar `device-state.ts` ile kalıcıdır.
 */

import path from 'node:path';
import WebSocket, { type RawData } from 'ws';
import { MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron';
import {
  DEFAULT_TTS_ENGINE,
  effectiveFollowUpSeconds,
  isGpuDevice,
  isTtsHostEngine,
  LOCAL_MODEL_IDS,
  LOCAL_MODEL_PATHS,
  newId,
  nowIso,
  PORT_NAMES,
  t,
  TTS_ENGINE_IDS,
  TTS_ENGINES,
  TTS_HOST_ENGINE_IDS,
  TTS_MODEL_IDS,
  type TtsDevice,
  type TtsEngineId,
  type TtsEnginesReport,
  type TtsEngineStatus,
  type TtsHostEngineId,
  type TtsPreviewResult,
  type AudioCommand,
  type AudioReport,
  type BargeTestResult,
  type CaptureProcessing,
  type EchoCancellationMode,
  type EchoTestResult,
  type IsoDateTime,
  type MicTestResult,
  type ServiceDeps,
  type Unsubscribe,
  type VoiceActivity,
  type VoiceApi,
  type VoiceDiagnosticsReport,
  type WakeCalibrationResult,
  type WakePath,
  type WakeTestResult,
} from '@fuber/shared';
import type { TtsHostCommand, TtsHostEvent } from '../../tts-host/protocol';
import type { TtsFallbackReason, TtsHostInfo, TtsSettings, WorkerCommand, WorkerConfig, WorkerEvent } from '../../worker/protocol';
import { runtime } from '../runtime';
import { testing } from '../testing';
import { audioReports } from './audio-bridge';
import { allowSystemAudioRequest, installSystemAudioHandler } from './system-audio';
import { createDeviceStore, type EchoMeasurement, type WakeCalibration } from './device-state';
import { createKwsWake, createWorkerTts, type TtsEngine, type WakeEngine } from './engines';
import { VoiceSession, type EchoGuardReport, type SessionIo, type TurnStages, type WakeLatency } from './session';
import { SttError, type SttEngine, type SttResult, type SttStatus } from './stt/types';
import { createWhisperLocal } from './stt/whisper-local';
import { createWakeMatcher, learnableSpelling } from './text-match';
import { TtsHost, type HostChild, type HostState, type HostWant } from './tts-host';
import { buildTtsSettings, describeTts, engineLabel, fallbackMessage, hostNoticeAction, resolveTtsSelection, shouldNotifyFallback, voiceFor, voiceLabel, type TtsOverrides, type TtsSelection } from './tts-settings';
import { chooseKwsProfile, tuningForCalibration, type KwsProfile } from '../../worker/kws-profiles';
import { echoGuardFor, VOICE_TUNING } from './tuning';
import { wakeVariants } from './wake-variants';
import { WorkerHost } from './worker-host';
import { RealtimeController } from './realtime-engine';
import type { RealtimeConfig, RealtimeSocket, RealtimeTransport } from './realtime';

const CAPTURE_RETRY_MS = 15_000;
/** Hat hazır olmadan gelen sesli bildirim en çok bu kadar bekletilir; daha eskisi yalnız yazıyla kalır. */
const SPEECH_HOLD_MS = 3 * 60_000;
const SPEECH_HOLD_MAX = 5;
const DIAGNOSTIC_HISTORY = 20;
const PROBE_TIMEOUT_MS = 20_000;

interface SentenceRecord {
  streamId: string;
  index: number;
  audioMs: number;
  /** İsteğin işçiye varışından ilk ses parçasına (sırada bekleme dahil). */
  firstChunkMs: number;
  /** Motorun cümleyi aldığı andan ilk ses parçasına. */
  synthFirstChunkMs: number | null;
  rms: number;
  engine: TtsEngineId;
  /** Cümleyi seslendiren motorun çalıştığı yer (ekran kartı / işlemci / bulut). */
  device: TtsDevice | null;
  chars: number;
  fallback: TtsFallbackReason | null;
}

/** Tanı: Ayarlar › Tanı paneli ve uçtan uca sınamalar hattın gerçek durumunu buradan okur. */
export interface VoiceDiagnostics {
  stt: SttStatus | null;
  worker: { ready: boolean; kws: boolean; tts: boolean; restarts: number; warnings: string[] };
  audio: { ready: boolean; capturing: boolean; captureError: string | null };
  /** Son dökümler, eskiden yeniye. `audioMs`: gönderilen bölütün süresi. */
  transcripts: Array<{
    text: string;
    raw: string;
    dropped: string | null;
    durationMs: number;
    audioMs: number;
    languageConfidence: number | null;
  }>;
  /** Son sentezlenen cümleler, eskiden yeniye. */
  sentences: SentenceRecord[];
  /**
   * Son söz kesme. `vadToStopMs`: VAD'ın sözü bildirdiği an ile ses penceresinin "durdum" raporu arası.
   * `vadConfirmMs`: sözün gerçek başlangıcı ile VAD bildirimi arası (bölüt bitince ölçülür; o zamana kadar tahmin).
   * Hoparlör tamponundaki son birkaç on milisaniye bu ölçümlere girmez.
   */
  lastBargeIn: { vadToStopMs: number; vadConfirmMs: number } | null;
  /** Yazıya çevirmeye verilen özel adlar (şirket, proje, kısaltma). */
  vocabulary: string[];
  /** Uyandırma: son uyanma, yürürlükteki sezici eşiği, kalibrasyonun öğrendikleri. */
  wake: {
    last: { path: WakePath; phrase: string; score: number; at: IsoDateTime } | null;
    /** Sezici şu an dinliyor mu (konuşurken ve uyandırma duraklatılmışken kapalıdır). */
    enabled: boolean;
    threshold: number;
    /** Sezicinin dinlediği ek yazımlar (Türkçe söyleyiş). */
    variants: string[];
    calibration: WakeCalibration | null;
    /** İki uyandırma yolunun son ölçülen gecikmesi. */
    latency: Record<WakePath, WakeLatency | null>;
  };
  /** Kendi sesini duymaya karşı korumalar ve mikrofonun yankı engelleme kipi. */
  echoGuard: EchoGuardReport & {
    aec: { mode: EchoCancellationMode; applied: CaptureProcessing | null; outputLatencyMs: number | null };
    /** Referanslı yankı gidericinin son bildirdiği durum (Jarvis hiç konuşmadıysa `null`) ve düzey kapısı. */
    canceller: { trained: boolean; converged: boolean; delayMs: number; erleDb: number; gate: number; coupled?: boolean; corr?: number | null; corrLagMs?: number | null } | null;
  };
  /** Son sesli turun aşama süreleri. */
  turn: (TurnStages & { ttsFirstChunkMs: number | null; ttsEngine: TtsEngineId | null }) | null;
  /**
   * Seslendirme: seçili motor ve kaynağı, şu an GERÇEKTEN konuşan motor ve çalıştığı yer, ses konağının durumu
   * (düşüş zinciri), buluttan geri düşme. Anahtar hiçbir zaman yer almaz.
   */
  tts: {
    provider: TtsEngineId;
    source: 'device' | 'policy';
    active: TtsEngineId;
    device: TtsDevice | null;
    /** Etkin motorda kullanılan ses. */
    voice: string | null;
    host: HostState | null;
    voiceId: string | null;
    model: string | null;
    hasKey: boolean;
    fallback: { reason: TtsFallbackReason; message: string; status: number | null; until: IsoDateTime | null; at: IsoDateTime } | null;
    /** Bu oturumda bulut sağlayıcının faturaladığı karakter. */
    charsBilled: number;
  };
  /** Söz kesme: politikadaki kip, yürürlükteki kip, yankı sınamasının ölçümü. */
  bargeIn: { policy: 'voice' | 'wake' | 'off'; effective: 'voice' | 'wake' | 'off'; echo: EchoMeasurement | null };
}

export type VoiceService = VoiceApi & {
  /** "Yeniden dene": yanıtı kesilen ya da başarısız olan son sözü yeniden yürütür. Yürütüldüyse `true`. */
  retry(): boolean;
  /** Süren sesli turun canlı adımı (ada "ne yapıyor" satırı). */
  activity(): VoiceActivity;
  diagnostics(): VoiceDiagnostics;
  /** `voice.diagnostics` kanalının yanıtı: arayüzün Tanı paneli için özet. */
  diagnosticsReport(): VoiceDiagnosticsReport;
  /** Söz kesme sınaması (Ayarlar › Ses). Hoparlörden ses çalar; yalnız kullanıcı başlatır. */
  bargeInTest(): Promise<BargeTestResult>;
  /** Seslendirme motorları ve bu cihazdaki durumları (Ayarlar › Ses). */
  ttsEngines(): TtsEnginesReport;
  /** "Dinle": verilen motor ve sesle örnek cümle. Hoparlörden ses çalar; yalnız kullanıcı başlatır. */
  ttsPreview(engine: TtsEngineId, voice?: string): Promise<TtsPreviewResult>;
  /** Motorun eksik dosyalarını indirir / başarısız hazırlığı yeniden dener; güncel raporu döndürür. */
  ttsPrepare(engine: TtsEngineId): TtsEnginesReport;
  /** Süren model indirmelerini durdurur; güncel raporu döndürür. */
  ttsCancelPrepare(): TtsEnginesReport;
  /**
   * Yazıya çevirmede öncelik verilecek özel adlar (şirket ve proje adları, "KDV" gibi kısaltmalar).
   * `VoiceApi` sözleşmesinde karşılığı yok; adları bilen modüller bağlanana kadar bütünleştirme buradan verir.
   */
  setSttVocabulary(words: string[]): void;
};

/** Bütünleştirme `createVoice(deps)` diye çağırır; ikinci parametre yalnız sınamalar içindir. */
export type VoiceOptions = TtsOverrides & {
  /** `false`: ses konağı hiç başlatılmaz (yalnız Piper ve bulut; ekran kartı gerektirmeyen sınamalar). */
  gpuTts?: boolean;
  /** Bu cihazlar açılamamış sayılır (düşüş zinciri sınaması). */
  ttsFailDevices?: TtsDevice[];
};

/** Ses konağını Electron `utilityProcess` olarak başlatır. */
function spawnTtsHost(hostPath: string, debug: (message: string) => void): HostChild<MessagePortMain> {
  const child = utilityProcess.fork(hostPath, [], { serviceName: 'Fuber AI 2 yerel ses', stdio: 'pipe' });
  // ONNX Runtime ve cuDNN uyarılarını stderr'e yazar; okunmazsa boru dolar.
  child.stdout?.on('data', (chunk: Buffer) => debug(chunk.toString('utf8').trim()));
  child.stderr?.on('data', (chunk: Buffer) => debug(chunk.toString('utf8').trim()));
  return {
    postMessage: (message: TtsHostCommand, ports?: MessagePortMain[]) => child.postMessage(message, ports),
    onMessage: (listener) => void child.on('message', (event: TtsHostEvent) => listener(event)),
    onExit: (listener) => void child.on('exit', (code) => listener(code)),
    kill: () => {
      try {
        child.kill();
      } catch {
        // Zaten kapanmış.
      }
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let squares = 0;
  for (let i = 0; i < pcm.length; i++) {
    const value = (pcm[i] ?? 0) / 32768;
    squares += value * value;
  }
  return Math.sqrt(squares / pcm.length);
}

export function createVoice(deps: ServiceDeps['voice'], options: VoiceOptions = {}): VoiceService {
  const log = deps.log.child('voice');
  const modelsDir = deps.paths.models;
  const device = createDeviceStore(deps.paths.data, (message, error) => log.warn(message, error));

  let stt: SttEngine | null = null;
  let sttEverReady = false;
  let workerReady = false;
  /** İşçi modellerini yükleyemedi; yeniden başlatmak aynı sonucu verir, bu yüzden açık hata olarak kalır. */
  let workerFailed = false;
  let workerInfo = { kws: false, tts: false, piper: false, warnings: [] as string[] };
  let audioReady = false;
  let capturing = false;
  let captureError: string | null = null;
  /** Tarayıcının açık mikrofon izine gerçekten uyguladığı ses işleme ve çıkış aygıtının bildirdiği gecikme (tanı). */
  let captureProcessing: CaptureProcessing | null = null;
  let outputLatencyMs: number | null = null;
  /** `capture.started` raporunu bekleyen (yankı sınaması kip değiştirirken). */
  let captureWaiter: (() => void) | null = null;
  let captureRetry: ReturnType<typeof setInterval> | null = null;
  let booted = false;
  let stopped = false;
  /** İşçi yeniden başlarsa son istenen durum yeniden yollanır. */
  let wantListen = false;
  let wantWake = false;
  let wantWatch = false;
  /** Toplantı kipi bilgisayar sesini istiyor (işçi ya da ses penceresi yeniden başlarsa yeniden yollanır). */
  let wantSystem = false;
  /** Bilgisayar sesinin son yeniden açılma anları (aygıt değişimi döngüsünü sezmek için). */
  let systemRestarts: number[] = [];
  let workerPhrases = '';
  let sttVocabulary: string[] = [];
  const subscriptions: Unsubscribe[] = [];
  /**
   * Hat hazır değilken gelen seslendirme istekleri. Açılışta kaçan hatırlatıcıların özeti, yazıya çevirme daha
   * başlamadan yayınlanır; atılırsa kullanıcı onu hiç duymaz. Hat hazır olunca sırayla okunur. `voice.speak`'i
   * doğrudan çağıran kod da aynı korumadan geçer.
   */
  const heldSpeech: Array<{ text: string; at: number; resolve: (result: { spoken: boolean }) => void; timer: ReturnType<typeof setTimeout> }> = [];

  const transcripts: VoiceDiagnostics['transcripts'] = [];
  const sentences: SentenceRecord[] = [];
  let lastBargeIn: VoiceDiagnostics['lastBargeIn'] = null;
  let bargeProbe: { at: number; confirmMs: number } | null = null;
  let bargeSegmentId: number | null = null;
  let lastWake: VoiceDiagnostics['wake']['last'] = null;
  const remember = <T>(list: T[], item: T): void => {
    list.push(item);
    if (list.length > DIAGNOSTIC_HISTORY) list.shift();
  };

  // ── seslendirme: seçim, ses konağı, bulut ──
  /** Ses konağının son bildirdiği durum (hiç istenmediyse `null`). */
  let hostState: HostState | null = null;
  /** Ses işçisine konağın portu teslim edildi mi (işçi yeniden başlayınca yenilenir). */
  let hostPortLive = false;
  /** Açılışta ses konağının ilk sonucu (hazır / açılamadı) bu ana kadar beklenir; sonra hat onsuz da hazır olur. */
  let hostGateUntil = 0;
  let hostGate = true;
  /** "Dinle" süresince istenen motor ve ses (seçili motor yerine). */
  let preview: (HostWant & { engine: TtsHostEngineId }) | null = null;
  let previewOverride: { engine: TtsEngineId; voice?: string } | null = null;
  /** Kullanıcıya en son bildirilen ekran kartı düşüşü (aynı durum yinelenmez). */
  let hostNotified: string | null = null;
  /** Seçilen ekran kartı cihazına KARARLI dönüşü bekleyen zamanlayıcı: dolunca düşüş kilidi açılır (çırpınmada açılmaz). */
  let hostStableTimer: ReturnType<typeof setTimeout> | null = null;
  const selection = (): TtsSelection => resolveTtsSelection(deps.policy.get(), deps.settings.get());
  /**
   * Dosyaları hazır olduğu halde ekran kartına YÜKLENEMEYEN motorlar ve nedeni. Kayıt varken o motor istenmez
   * (çalışan motor konuşmayı sürdürür); "Yeniden dene" ya da dosyaların yeniden hazırlanması kaydı siler.
   */
  const hostIssue = new Map<TtsHostEngineId, string>();
  /** "Dinle" sırasında motorun bildirdiği hata (örnek çalınamadıysa nedeni kullanıcıya gösterilir). */
  let previewError: string | null = null;
  /** Ses işçisinin kullanabildiği konak bilgisi (konak hazır VE portu teslim edilmiş). */
  const hostInfo = (): TtsHostInfo | null => (hostPortLive ? ttsHost.info() : null);
  let ttsSettings: TtsSettings = buildTtsSettings(deps.policy.get(), deps.settings.get(), null, options);
  let ttsFallback: VoiceDiagnostics['tts']['fallback'] = null;
  /** Kullanıcıya en son bildirilen geri düşme nedeni: aynı neden yeniden bildirilmez. */
  let ttsNotified: TtsFallbackReason | null = null;
  let ttsCharsBilled = 0;
  /** Anahtar yokken tanıda gösterilen "geri düşme"nin anı (kullanıcıya bildirilmez). */
  const noKeySince = nowIso();
  /** Bulut şu an konuşabilir mi: anahtar var ve geri düşme yok (ya da bekleme süresi doldu, işçi yeniden deneyecek). */
  const cloudUsable = (): boolean =>
    ttsSettings.elevenlabs !== null && (!ttsFallback || (ttsFallback.until !== null && Date.parse(ttsFallback.until) <= Date.now()));
  /** Bir sonraki cümleyi GERÇEKTEN seslendirecek motor (ses işçisinin yönlendiricisiyle aynı sıra). */
  const ttsActive = (): TtsEngineId => {
    if (ttsSettings.engine === 'elevenlabs' && cloudUsable()) return 'elevenlabs';
    const host = ttsSettings.engine === 'piper-local' ? null : hostInfo();
    return host ? host.engine : 'piper-local';
  };
  /** Etkin motorun çalıştığı yer; hiçbir motor yoksa `null`. */
  const ttsActiveDevice = (): TtsDevice | null => {
    const active = ttsActive();
    if (active === 'elevenlabs') return 'cloud';
    if (isTtsHostEngine(active)) return hostInfo()?.device ?? null;
    return workerReady && workerInfo.piper ? 'cpu' : null;
  };

  // ── sınamalar (mikrofon, kalibrasyon, yankı): aynı anda yalnız biri ──
  let activeTest: 'mic' | 'calibration' | 'echo' | 'barge' | null = null;
  /** Yankı gidericinin son durumu (işçi Jarvis konuşurken saniyede bir bildirir). */
  let echoStats: { trained: boolean; converged: boolean; delayMs: number; erleDb: number; coupled: boolean; corr: number | null; corrLagMs: number | null } | null = null;
  const echoGate = (): number => device.get().barge?.gate ?? VOICE_TUNING.echoGate;
  /** Mikrofon sınaması sürerken genlik ve söz olaylarını toplar. */
  let micTest: { peak: number; squares: number; frames: number; speech: boolean; lastPcm: Int16Array | null } | null =
    null;
  /** Kalibrasyon: sıradaki söz bölütünü bekleyen. */
  let segmentTap: ((segment: { pcm: Int16Array; durationMs: number }) => void) | null = null;
  const probeWaiters = new Map<number, (result: { score: number | null; phrase: string | null; profiles: string[] }) => void>();
  let probeSeq = 0;
  /** Yankı sınaması sürerken ölçüm. */
  let echoProbe: {
    streamId: string;
    phase: 'baseline' | 'playing' | 'tail' | 'done';
    /** Çalma sırasında VAD'ın bildirdiği bütün sözler (ham sızıntı) ve yankı gidericinin "kullanıcı" saydıkları. */
    vad: number;
    sure: number;
    /** Kaba kanıtla başlayan bölütler: kaç "kullanıcı" bildirimi aldı (ikincisi susturur, sayılır). */
    coarse: Map<number, number>;
    wake: number;
    baseline: { squares: number; frames: number };
    playing: { squares: number; frames: number; peak: number };
    playedMs: number;
    /** Çalmanın bittiği an ve ardından mikrofonun son kez "sesli" olduğu an (sızan sesin kuyruğu). */
    endedAt: number;
    lastLoudAt: number;
    loudAbove: number;
    ended: (() => void) | null;
  } | null = null;

  const sendAudio = (command: AudioCommand): void => deps.windows.sendTo('audio', 'audio.command', command);
  const aecMode = (): EchoCancellationMode => device.get().aecMode ?? 'default';
  /** Mikrofonu bu cihazın yankı engelleme kipiyle açar. */
  const startCapture = (deviceId: string | null = deps.settings.get().inputDeviceId, mode: EchoCancellationMode = aecMode()): void =>
    sendAudio({ type: 'capture.start', deviceId, echoMode: mode });

  const worker = new WorkerHost({
    path: runtime.workerPath,
    log,
    onEvent: (event) => onWorkerEvent(event),
    deliverPort: (port: MessagePortMain) => deps.windows.postPort('audio', PORT_NAMES.audio, port),
    onCrash: () => {
      workerReady = false;
      workerFailed = false;
      hostPortLive = false;
      for (const [id, resolve] of [...probeWaiters]) {
        probeWaiters.delete(id);
        resolve({ score: null, phrase: null, profiles: [] });
      }
      updateReadiness();
    },
  });
  const send = (command: WorkerCommand, ports?: MessagePortMain[]): void => worker.send(command, ports);
  // Ses işçisinde Piper yoksa da (modeli inmemiş) ses konağı hazırsa konuşulabilir.
  const tts: TtsEngine = createWorkerTts(send, () => workerReady && (workerInfo.tts || hostInfo() !== null), ttsActive);

  /** Yerel model kaydı hazırsa klasörünün mutlak yolu; değilse `null`. */
  const readyDir = (modelId: string, relative: string): string | null =>
    deps.models.filePath(modelId) !== null ? path.join(modelsDir, ...relative.split('/')) : null;
  const ttsRuntimeDir = (device: TtsDevice): string | null => {
    const cuda = (): string | null => readyDir(TTS_MODEL_IDS.runtimeCuda, LOCAL_MODEL_PATHS.ttsRuntimeCuda);
    const directml = (): string | null => readyDir(TTS_MODEL_IDS.runtimeDirectml, LOCAL_MODEL_PATHS.ttsRuntimeDirectml);
    if (device === 'cuda') return cuda();
    if (device === 'directml') return directml();
    // İşlemci: eldeki çalışma zamanlarından biri, ekran kartı sağlayıcısı eklenmeden.
    return device === 'cpu' ? (directml() ?? cuda()) : null;
  };
  const ttsEngineDir = (engine: TtsHostEngineId): string | null =>
    engine === 'supertonic' ? readyDir(TTS_MODEL_IDS.supertonic, LOCAL_MODEL_PATHS.ttsSupertonic) : readyDir(TTS_MODEL_IDS.ema, LOCAL_MODEL_PATHS.ttsEma);

  const hostLog = log.child('tts-host');
  const ttsHost = new TtsHost<MessagePortMain>({
    log: hostLog,
    runtimeDir: ttsRuntimeDir,
    engineDir: ttsEngineDir,
    sentenceSilence: VOICE_TUNING.sentenceSilence,
    failDevices: options.ttsFailDevices,
    spawn: () => spawnTtsHost(runtime.ttsHostPath, (message) => hostLog.debug(message)),
    channel: () => {
      const { port1, port2 } = new MessageChannelMain();
      return { host: port1, worker: port2 };
    },
    onPort: (port, info) => {
      // İşçi ayakta değilse port bırakılır; işçi hazır olunca yeni bir kanal açılır (`renewPort`).
      if (!workerReady) return;
      send({ type: 'tts.port', host: info }, [port]);
      hostPortLive = true;
      refreshTts();
    },
    onState: (state) => onHostState(state),
    onSelectFailed: (want, message) => onSelectFailed(want, message),
  });

  /** Motor şu an konakta çalışabilir mi: model dosyaları + en az bir cihazın çalışma zamanı hazır, yükleme hatası yok. */
  const hostUsable = (engine: TtsHostEngineId): boolean =>
    ttsEngineDir(engine) !== null && TTS_ENGINES[engine].devices.some((item) => item !== 'cloud' && ttsRuntimeDir(item) !== null) && !hostIssue.has(engine);

  /**
   * İstenen ekran kartı motoru için konaktan ne istenecek. Motor konuşabiliyorsa kendisi; (henüz) konuşamıyorsa
   * (dosyaları iniyor, yüklenemedi) O AN ÇALIŞAN motor sürer, o da yoksa (hazırsa) varsayılan ekran kartı motoru:
   * kullanıcı indirme boyunca sessiz ya da Piper'la kalmaz. Hiçbiri hazır değilse istenen motorun kendisi döner
   * (konak "dosyalar hazır değil" der ve dosyalar gelince başlar: ilk açılış).
   */
  function hostWantFor(engine: TtsHostEngineId): HostWant {
    const want = (id: TtsHostEngineId): HostWant => ({ engine: id, voice: voiceFor(id, deps.policy.get(), deps.settings.get()) ?? '' });
    if (hostUsable(engine)) return want(engine);
    const running = hostState && (hostState.phase === 'ready' || hostState.phase === 'starting') ? hostState.engine : null;
    // Yedek yalnız O AN ÇALIŞAN motor ya da varsayılan motordur; rastgele başka bir motor (ör. ilk açılışta küçük
    // dosyaları önce inen EMA) devreye girmez: o durumda konak bekler ve Piper konuşur.
    const candidates = [running, isTtsHostEngine(DEFAULT_TTS_ENGINE) ? DEFAULT_TTS_ENGINE : null];
    const stand = candidates.find((id): id is TtsHostEngineId => id !== null && id !== engine && hostUsable(id));
    return want(stand ?? engine);
  }

  /** Çalışan konak istenen motora geçemedi: neden kaydedilir, kullanıcıya bir kez söylenir; eski motor sürer. */
  function onSelectFailed(want: HostWant, message: string): void {
    // Dosyalar (henüz) hazır değilse bu bir hata değil, bekleme durumudur: rapor "iniyor / indirilmedi" der.
    if (ttsEngineDir(want.engine) === null) return;
    hostIssue.set(want.engine, message);
    if (!preview && selection().engine === want.engine) {
      session.reportNotice('tts_fallback', t('tts.fallback.engineFailed', { engine: engineLabel(want.engine), reason: message }));
    }
    syncHost();
    refreshTts();
  }

  /** Motorun gerektirdiği yerel model kayıtları: kendi modeli + (hiçbir cihazın çalışma zamanı yoksa) CUDA çalışma zamanı. */
  function hostModelIds(engine: TtsHostEngineId): string[] {
    const info = TTS_ENGINES[engine];
    const runtime = info.devices.some((item) => item !== 'cloud' && ttsRuntimeDir(item) !== null);
    return [...(info.model ? [info.model] : []), ...(runtime ? [] : [TTS_MODEL_IDS.runtimeCuda])];
  }

  /**
   * Motor konuşabilsin diye gerekenleri başlatır: eksik dosyalar indirilir (ilerleme `setup.modelProgress`), yükleme
   * hatası kaydı silinir ve konak yeniden denenir. Seçim değişince, açılışta ve "İndir / Yeniden dene" ile çağrılır.
   */
  function prepareEngine(engine: TtsEngineId, retry = false): void {
    if (!isTtsHostEngine(engine) || options.gpuTts === false) return;
    if (retry) hostIssue.delete(engine);
    const states = new Map(deps.models.status().map((model) => [model.id, model.status]));
    const missing = hostModelIds(engine).filter((id) => states.has(id) && states.get(id) !== 'ready');
    // Süren ya da sırada bekleyen kayıt yeniden istenmez; "eksik" ve "başarısız" olan (yeniden) indirilir.
    const wanted = missing.filter((id) => retry || states.get(id) === 'missing' || states.get(id) === 'failed');
    if (wanted.length > 0) {
      log.info(`ses motoru hazırlanıyor (${engine}): ${wanted.join(', ')}`);
      deps.models.download(wanted);
    }
    if (retry && booted) ttsHost.retry();
    syncHost();
  }
  /** Yürürlükteki seçimin (ve bulut konuşamıyorsa yerel yedeğin) dosyalarını hazırlar. */
  const prepareSelected = (): void => {
    const engine = selection().engine;
    if (isTtsHostEngine(engine)) prepareEngine(engine);
  };

  /**
   * Ses konağından istenen motor. Ekran kartı motoru seçiliyse o; bulut seçiliyken yalnız bulut konuşamıyorsa
   * (anahtar yok, kota doldu) varsayılan yerel motor yedek olarak ayağa kalkar (ekran belleği boşuna dolmasın);
   * Piper seçiliyken konak kapalıdır. "Dinle" süresince dinlenen motor.
   */
  function desiredHost(): HostWant | null {
    if (options.gpuTts === false || !booted || stopped) return null;
    if (preview) return preview;
    const current = selection();
    if (isTtsHostEngine(current.engine)) return hostWantFor(current.engine);
    if (current.engine === 'elevenlabs' && !cloudUsable() && isTtsHostEngine(DEFAULT_TTS_ENGINE)) return hostWantFor(DEFAULT_TTS_ENGINE);
    return null;
  }
  const syncHost = (): void => ttsHost.request(desiredHost());

  function onHostState(state: HostState): void {
    const before = hostState;
    hostState = state;
    if (state.phase !== 'ready' && hostPortLive) {
      // Konak durdu ya da düştü: işçi portu bırakır, cümleler Piper ile okunur.
      hostPortLive = false;
      send({ type: 'tts.port', host: null });
    }
    refreshTts();
    notifyHostOutcome(before, state);
    updateReadiness();
    // Konak (yeniden) hazır: o arada seçim değiştiyse ya da seçili motorun dosyaları geldiyse şimdi istenir.
    if (state.phase === 'ready' && before?.phase !== 'ready') syncHost();
  }

  /**
   * Ekran kartı sesi seçiliyken zincirde aşağı inildiyse kullanıcıya BİR KEZ, bilgi olarak söylenir. Düşüş tanıya her
   * zaman yazılır (`hostState`); yüksek sesle duyuru yalnız bir "düşüş olayının" başında yapılır. Seçilen (ekran kartı)
   * cihaza geçici geri dönüş (ses konağı belleği boşalınca denediğinde) kilidi hemen açmaz: ancak bir süre KARARLI
   * kalınırsa açılır, böylece sıkışma altında aç-kapa çırpınması her seferinde yeniden duyurulmaz.
   */
  function notifyHostOutcome(before: HostState | null, state: HostState): void {
    if (preview || !isTtsHostEngine(selection().engine)) return;
    // Her durum değişiminde kararlılık zamanlayıcısı iptal: yalnız temiz-hazır SÜRERSE yeniden kurulur.
    if (hostStableTimer) {
      clearTimeout(hostStableTimer);
      hostStableTimer = null;
    }
    const action = hostNoticeAction(before, state, hostNotified);
    if (action.kind === 'recover') {
      // Seçilen ekran kartı cihazına temiz dönüş: KARARLI kalırsa düşüş kilidini aç (gelecekteki gerçek düşüş yine bir
      // kez bildirilebilsin). Kısa sürede yeniden düşerse (sıkışma sürüyor) zamanlayıcı iptal olur: yeniden duyurulmaz.
      hostStableTimer = setTimeout(() => {
        hostNotified = null;
        hostStableTimer = null;
      }, VOICE_TUNING.ttsRecoveryMs);
      hostStableTimer.unref?.();
      return;
    }
    if (action.kind === 'notify') {
      hostNotified = action.key;
      session.reportNotice('tts_fallback', t(action.messageKey));
    }
  }
  const kws: WakeEngine = createKwsWake(send, () => workerReady && workerInfo.kws);

  /** Sezicinin yürürlükteki duyarlığı: kalibrasyonun seçtiği profil; kalibrasyon yoksa olağan profil. */
  const kwsTuning = (): KwsProfile => tuningForCalibration(device.get().wake);
  const kwsThreshold = (): number => kwsTuning().threshold;

  const io: SessionIo = {
    setCapture(on) {
      wantListen = on;
      if (on) startCapture();
      // Hat mikrofon hatası yüzünden düştüyse pencereye "durdur" denmez: açık akış zaten yoktur ve pencere,
      // aygıt takılınca / izin gelince kendiliğinden yeniden bağlanabilsin diye isteği hatırlamalıdır.
      else if (!captureError) sendAudio({ type: 'capture.stop' });
      send({ type: 'listen', on });
    },
    setWake(on) {
      wantWake = on;
      kws.setEnabled(on);
    },
    setStopWatch(on) {
      wantWatch = on;
      send({ type: 'watch', on });
    },
    // "Dinle" sürerken cümle, seçili motor yerine dinlenen motor ve sesle okunur.
    speak: (streamId, text) => (previewOverride ? send({ type: 'tts.speak', streamId, text, ...previewOverride }) : tts.speak(streamId, text)),
    endStream: (streamId) => tts.end(streamId),
    stopPlayback() {
      // İki yoldan: pencereye doğrudan (en kısa yol) ve işçiye (sıradaki sentez atılsın, port sırası korunsun).
      sendAudio({ type: 'playback.stop' });
      tts.cancel();
    },
    // Toplantıda uyarı sesi de çalınmaz: hoparlörden toplantıya sızmasın.
    earcon: (kind) => {
      if (!session.status().meeting?.on) send({ type: 'earcon', kind });
    },
    transcribe,
    canSpeak: () => tts.available(),
    prewarmSpeech: () => tts.prewarm(),
    cutSpeech: () => send({ type: 'cut' }),
    selfInterrupted: () => onSelfInterrupt(),
    duck: (on) =>
      sendAudio({ type: 'playback.duck', gain: on ? VOICE_TUNING.duckGain : 1, rampMs: on ? VOICE_TUNING.duckDownMs : VOICE_TUNING.duckUpMs }),
  };

  async function transcribe(pcm: Int16Array, options?: { language?: string; hint?: 'stop' }): Promise<SttResult> {
    if (!stt) throw new SttError('not_ready', t('voice.stt.unavailable'));
    const request = { ...(options?.language ? { language: options.language } : {}), ...(options?.hint ? { hint: options.hint } : {}) };
    const result = await stt.transcribe(pcm, Object.keys(request).length > 0 ? request : undefined);
    const audioMs = Math.round(pcm.length / 16);
    remember(transcripts, {
      text: result.text,
      raw: result.raw,
      dropped: result.dropped,
      durationMs: result.durationMs,
      audioMs,
      languageConfidence: result.languageConfidence,
    });
    if (result.durationMs > 0) {
      try {
        deps.usage.record({
          kind: 'stt',
          provider: 'local',
          model: LOCAL_MODEL_IDS.whisperModel,
          audioSeconds: audioMs / 1000,
          costUsd: 0,
          durationMs: result.durationMs,
        });
      } catch {
        // Kullanım kaydı ses turunu etkilemez.
      }
    }
    return result;
  }

  const session = new VoiceSession({
    policy: deps.policy,
    settings: deps.settings,
    tools: deps.tools,
    brain: deps.brain,
    conversation: deps.conversation,
    bus: deps.bus,
    log,
    io,
  });
  // Cihazda kalıcı olanlar: kalibrasyonun öğrendiği yazımlar ve yankı sınamasının sonucu.
  session.setLearnedWake(device.get().wake?.learned ?? []);
  session.setCoarseBarge(device.get().coarseBarge === true);
  applyEcho(device.get().echo);

  // ───────────────────────────── gerçek zamanlı motor (OpenAI Realtime) ─────────────────────────────
  // `voice.engine === 'openai-realtime'` iken cascade yerine bu çalışır. Mevcut hattı ÖDÜNÇ alır: uyandırma sözü,
  // mikrofon VAD bölütleri ve gizli ses penceresinin oynatması (`playback.pcm`). Cascade koduna EKLEME yapılır,
  // dokunulmaz: `realtime.active()` yalnız motor çalışırken doğrudur, aksi halde bütün yönlendirmeler etkisizdir.
  const realtimeOn = (): boolean => deps.policy.get().voice.engine === 'openai-realtime' && options.gpuTts !== false;
  /** `ws` soketini motorun beklediği sade yüzeye sarar (gerçek ağ yalnız burada; motor ve denetleyici saftır). */
  const realtimeTransport: RealtimeTransport = (url, headers) => {
    const ws = new WebSocket(url, { headers });
    const socket: RealtimeSocket = {
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
      on: (event, cb) => {
        if (event === 'open') ws.on('open', cb as () => void);
        else if (event === 'message') ws.on('message', (raw: RawData) => (cb as (d: string) => void)(raw.toString()));
        else if (event === 'close') ws.on('close', cb as (code: number, reason?: string) => void);
        else ws.on('error', cb as (error: Error) => void);
      },
    };
    return socket;
  };
  /** Persona + politikadan oturum ayarı: model, OpenAI sesi ve "Jarvis" gibi konuşması için sistem istemi. */
  const realtimeInstructions = (): string => {
    const persona = deps.policy.get().persona;
    const address = deps.settings.get().userAddress?.trim() || persona.address;
    const base = persona.systemPrompt.replaceAll('{name}', persona.name).replaceAll('{address}', address);
    const style = persona.voiceStyle?.trim();
    const parts = [base.trim()];
    if (style) parts.push(`Konuşma üslubun: ${style}`);
    parts.push(
      'Sesli ve gerçek zamanlı konuşuyorsun: kısa, doğal, akıcı Türkçe cümleler kur; madde işareti, emoji ve uzun paragraf kullanma.',
    );
    return parts.filter(Boolean).join('\n\n');
  };
  const realtimeConfig = (): RealtimeConfig => {
    const s2s = deps.policy.get().voice.s2s;
    return {
      model: s2s?.model?.trim() || 'gpt-realtime-2.1',
      voice: s2s?.voice?.trim() || 'marin',
      instructions: realtimeInstructions(),
    };
  };
  const realtime = new RealtimeController({
    transport: realtimeTransport,
    getKey: () => deps.policy.get().keys.openai,
    getConfig: realtimeConfig,
    play: (streamId, sampleRate, pcm, end) => sendAudio({ type: 'playback.pcm', streamId, sampleRate, pcm, end }),
    stopPlayback: () => sendAudio({ type: 'playback.stop' }),
    earcon: (kind) => send({ type: 'earcon', kind }),
    emitState: (state, prev, reason) => deps.bus.emit('voice.state', { state, prev, reason, at: nowIso() }),
    emitPartial: (turnId, role, text, final) => deps.bus.emit('voice.partial', { turnId: turnId as never, role, text, final }),
    reportError: (code, message) => session.reportError(code, message),
    followUpSeconds: () => effectiveFollowUpSeconds(deps.settings.get(), deps.policy.get()),
    log: log.child('realtime'),
    inputRate: 16_000,
  });
  /** Gerçek zamanlı motor çalışmalı mı ve çalışıyorsa başlat/durdur (politika, boot ve stop'tan çağrılır). */
  function syncRealtime(): void {
    if (realtimeOn() && booted && !stopped) realtime.start();
    else realtime.stop();
  }

  /** Yankı ölçümünü oturuma uygular: söz kesme kipi ve çalma sonrası koruma süresi. */
  function applyEcho(echo: EchoMeasurement | null): void {
    // Söz kesme yalnız yankı gidericiye RAĞMEN başarılamadıysa `wake`e iner (gidericiyle alınmış ölçüm ya da art arda
    // kendini kesme gözlemi). Eski ölçümdeki ham sızıntı tek başına yetmez: giderici o sızıntıyı bastırmak için var.
    const leaks = echo?.leaked === true && (echo.gated === true || echo.observed === true);
    // Ölçümde giderici Jarvis'in sesini hiç görmediyse (kör) kaba kapı da çalışamaz: o cihazda "sızıyor" `wake`e indirir.
    const blind = echo?.canceller ? !echo.canceller.coupled && !echo.canceller.trained : false;
    session.setEchoLeaks(leaks, leaks ? (echo?.reason ?? (echo?.observed ? 'self_interrupt' : 'echo_test')) : null, blind);
    session.setEchoSuspected(echo?.leaked === true || (echo?.rawVadTriggers ?? 0) > 0);
    session.setEchoGuardMs(echoGuardFor(echo));
  }

  /** Söz kesmenin `wake`e inmesinin nedeni; `voice` ise `null`. */
  // d6: yankı sınamasının "sızıyor" sonucu tek başına `wake`e indirmez; karar oturumdadır (`bargeBlocked`).
  const wakeReason = (): 'echo_test' | 'self_interrupt' | 'barge_test' | null => session.status().bargeInBlockedBy ?? null;

  /**
   * Jarvis, söz kesme `voice` kipindeyken kendi sesini kullanıcı sözü sanıp kendini kesti: yankı engelleme bu cihazda
   * tutmuyor. Yankı sınaması beklenmeden kip `wake`e indirilir (yoksa her yanıt ilk yarım saniyede kesilir) ve kalıcı
   * olur; kullanıcıya bir kez bilgi verilir. Kulaklığa geçince Ayarlar'daki yankı sınaması kipi geri açar.
   */
  function onSelfInterrupt(): void {
    if (wakeReason() !== null) return;
    const measurement: EchoMeasurement = {
      leaked: true,
      vadTriggers: 1,
      wakeTriggers: 0,
      baselineRms: 0,
      playbackRms: 0,
      playbackPeak: 0,
      playedMs: 0,
      at: nowIso(),
      mode: aecMode(),
      observed: true,
      reason: 'self_interrupt',
    };
    device.update({ echo: measurement });
    applyEcho(measurement);
    log.info('Jarvis kendi sesiyle kendini kesti: söz kesme bu cihazda wake kipine indirildi');
    session.reportNotice('echo_observed', t('voice.echo.observed'));
  }

  // ───────────────────────────── hazır olma ─────────────────────────────

  const modelFile = (id: string, relative: string): string | null => deps.models.filePath(id, relative);

  /** Hattın kurulabilmesi için şart olan dosyalar (TTS ve sezici olmadan da kurulur). */
  const coreModelsReady = (): boolean =>
    modelFile(LOCAL_MODEL_IDS.vad, LOCAL_MODEL_PATHS.vad) !== null &&
    modelFile(LOCAL_MODEL_IDS.whisperModel, LOCAL_MODEL_PATHS.whisperModel) !== null &&
    modelFile(LOCAL_MODEL_IDS.whisperServer, LOCAL_MODEL_PATHS.whisperServer) !== null;

  function updateReadiness(): void {
    const sttStatus = stt?.status() ?? null;
    if (sttStatus?.state === 'ready') sttEverReady = true;
    let reason: string | null = null;
    if (!booted) reason = t('voice.notReady.models');
    else if (workerFailed) reason = t('voice.error.boot');
    else if (!workerReady || !audioReady) reason = t('voice.notReady.starting');
    else if (captureError) reason = captureError;
    else if (!sttStatus || sttStatus.state === 'stopped') reason = t('voice.stt.unavailable');
    else if (sttStatus.state === 'failed') reason = sttStatus.reason ?? t('voice.stt.unavailable');
    else if (!sttEverReady) reason = t('voice.notReady.stt');
    // Açılışta ekran kartı sesi yükleniyorsa kısa bir süre beklenir: ilk yanıt Piper'la başlayıp ses değişmesin.
    // Yalnız hat İLK KEZ hazır olana dek: sonradan başlayan konak (seçim değişti, bulut düştü, çöküp yeniden başladı)
    // hattı "hazır değil"e çevirmez; o sırada cümleler zincirde alttaki sesle okunur.
    else if (hostGate && hostState?.phase === 'starting' && Date.now() < hostGateUntil) reason = t('voice.notReady.starting');
    if (reason === null) hostGate = false;
    session.setReady(reason === null, reason);
    if (reason === null && heldSpeech.length > 0) {
      for (const item of heldSpeech.splice(0)) {
        clearTimeout(item.timer);
        void session.speak(item.text).then(item.resolve);
      }
    }
  }

  /**
   * Metni seslendirir; hat henüz hazır değilse (açılış, işçi yeniden başlıyor) kısa bir süre bekletir.
   * Bekleme süresi dolarsa ya da uygulama kapanırsa `spoken: false` ile çözülür: çağıran hiçbir zaman asılı kalmaz.
   */
  function speak(text: string): Promise<{ spoken: boolean }> {
    if (session.status().ready || stopped) return session.speak(text);
    // Kalıcı sorun (işçi açılamadı, mikrofon yok/izin yok, yazıya çevirme kapalı) beklemekle düzelmez: bekletilmez.
    const permanent = booted && (workerFailed || captureError !== null || stt?.status().state === 'failed');
    if (permanent || !/[\p{L}\p{N}]/u.test(text)) return Promise.resolve({ spoken: false });
    return new Promise((resolve) => {
      const item = {
        text,
        at: Date.now(),
        resolve,
        timer: setTimeout(() => {
          const index = heldSpeech.indexOf(item);
          if (index >= 0) heldSpeech.splice(index, 1);
          resolve({ spoken: false });
        }, SPEECH_HOLD_MS),
      };
      item.timer.unref?.();
      heldSpeech.push(item);
      if (heldSpeech.length > SPEECH_HOLD_MAX) {
        const dropped = heldSpeech.shift();
        if (dropped) {
          clearTimeout(dropped.timer);
          dropped.resolve({ spoken: false });
        }
      }
    });
  }

  function workerConfig(): WorkerConfig {
    const persona = deps.policy.get().persona;
    const kwsReady = modelFile(LOCAL_MODEL_IDS.kws, LOCAL_MODEL_PATHS.kwsEncoder) !== null;
    const piperReady =
      modelFile(LOCAL_MODEL_IDS.piper, LOCAL_MODEL_PATHS.piperExe) !== null &&
      modelFile(LOCAL_MODEL_IDS.piperVoice, LOCAL_MODEL_PATHS.piperVoice) !== null;
    workerPhrases = JSON.stringify(persona.wakePhrases);
    return {
      modelsDir,
      vad: {
        model: LOCAL_MODEL_PATHS.vad,
        threshold: VOICE_TUNING.vadThreshold,
        minSpeechMs: VOICE_TUNING.minSpeechMs,
        minSilenceMs: VOICE_TUNING.endSilenceMs,
        maxSpeechSeconds: VOICE_TUNING.maxSpeechSeconds,
        blip: {
          threshold: VOICE_TUNING.blipThreshold,
          minSpeechMs: VOICE_TUNING.blipMinSpeechMs,
          minSilenceMs: VOICE_TUNING.blipMinSilenceMs,
          maxMs: VOICE_TUNING.blipMaxMs,
        },
      },
      kws: kwsReady
        ? {
            encoder: LOCAL_MODEL_PATHS.kwsEncoder,
            decoder: LOCAL_MODEL_PATHS.kwsDecoder,
            joiner: LOCAL_MODEL_PATHS.kwsJoiner,
            tokens: LOCAL_MODEL_PATHS.kwsTokens,
            bpeModel: LOCAL_MODEL_PATHS.kwsBpeModel,
            phrases: persona.wakePhrases,
            variants: wakeVariants(persona.wakePhrases),
            threshold: kwsTuning().threshold,
            boost: kwsTuning().boost,
            paths: kwsTuning().paths,
            // Göreli yol: işçi çalışma dizinini model klasörüne alır.
            keywordsFile: path.relative(modelsDir, path.join(deps.paths.temp, 'kws-keywords.txt')),
          }
        : null,
      piper: piperReady
        ? {
            exe: LOCAL_MODEL_PATHS.piperExe,
            voice: LOCAL_MODEL_PATHS.piperVoice,
            espeakData: LOCAL_MODEL_PATHS.piperEspeakData,
            sentenceSilence: VOICE_TUNING.sentenceSilence,
          }
        : null,
      tts: ttsSettings,
      // Toplantının "Karşı taraf" kaynağı: temiz ses, kısa duraksamada bölünür; uzun konuşma 8 sn'de kesilir ki satır
      // ekrana geç düşmesin (Fuber AI 1 de uzun satırı ~7 sn'de kesiyordu). d6: 450 → 300 ms ve 15 → 8 sn (istek:
      // "toplantıda anlık olmalı"); loopback sesi gürültüsüz olduğu için kısa duraksama söz sonunu güvenle gösterir.
      systemVad: { minSilenceMs: VOICE_TUNING.meetingSystemSilenceMs, maxSpeechSeconds: VOICE_TUNING.meetingSystemMaxSpeechSeconds },
    };
  }

  async function boot(): Promise<void> {
    if (booted || stopped) return;
    if (!coreModelsReady()) {
      updateReadiness();
      return;
    }
    booted = true;
    updateReadiness();
    try {
      await deps.windows.ensure('audio');
      if (stopped) return;
      worker.start(workerConfig());
      // Gerçek zamanlı motor seçiliyse soketi şimdi açar (mikrofon/pencere koşut kurulur).
      syncRealtime();
      // Ses konağı (ekran kartı motoru) işçiyle koşut başlar; hazır olunca portu işçiye teslim edilir.
      hostGateUntil = Date.now() + VOICE_TUNING.ttsHostGateMs;
      setTimeout(() => updateReadiness(), VOICE_TUNING.ttsHostGateMs + 50).unref?.();
      syncHost();
      // Seçili ekran kartı motorunun dosyaları eksikse (isteğe bağlı model; yarım kalmış indirme) şimdi hazırlanır.
      prepareSelected();

      const serverExe = modelFile(LOCAL_MODEL_IDS.whisperServer, LOCAL_MODEL_PATHS.whisperServer);
      const model = modelFile(LOCAL_MODEL_IDS.whisperModel, LOCAL_MODEL_PATHS.whisperModel);
      if (serverExe && model) {
        const persona = deps.policy.get().persona;
        stt = createWhisperLocal({
          serverExe,
          modelFile: model,
          language: persona.language,
          assistantName: persona.name,
          log: log.child('stt'),
          pidFile: path.join(deps.paths.temp, 'whisper-server.pid'),
        });
        stt.setVocabulary(sttVocabulary);
        stt.onStatus((status) => {
          if (status.state === 'failed') session.reportError('stt', status.reason ?? t('voice.stt.unavailable'));
          updateReadiness();
        });
        void stt.start();
      }
    } catch (error) {
      booted = false;
      log.error('ses hattı kurulamadı', error);
      session.reportError('boot', t('voice.error.boot'));
      updateReadiness();
    }
  }

  /**
   * Seçim (politika ya da cihaz ayarı), anahtar ya da ses konağının durumu değişti: işçi yeniden başlatılmadan
   * yenilenir. Buluttan geri düşme kaydı yalnız bulut ayarı ya da "bulut seçili mi" değişince silinir (işçi de
   * bekleme süresini aynı koşulda sıfırlar).
   */
  function refreshTts(): void {
    const next = buildTtsSettings(deps.policy.get(), deps.settings.get(), hostInfo(), options);
    if (JSON.stringify(next) === JSON.stringify(ttsSettings)) return;
    const cloudKey = (settings: TtsSettings): string => JSON.stringify([settings.engine === 'elevenlabs', settings.elevenlabs]);
    if (cloudKey(next) !== cloudKey(ttsSettings)) {
      ttsFallback = null;
      ttsNotified = null;
    }
    ttsSettings = next;
    if (workerReady) send({ type: 'tts.config', settings: next });
  }

  // ───────────────────────────── işçi ve pencere olayları ─────────────────────────────

  function onWorkerEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'ready':
        workerReady = true;
        workerFailed = false;
        workerInfo = { kws: event.kws, tts: event.tts, piper: event.piper ?? event.tts, warnings: event.warnings };
        for (const warning of event.warnings) log.warn(warning);
        // Yeniden başlayan işçi boş durumla gelir: ses konağı çalışıyorsa yeni bir kanal açılır (eski port işçiyle
        // birlikte öldü), ayar o arada değiştiyse güncel hali yollanır.
        hostPortLive = false;
        ttsHost.renewPort();
        ttsSettings = buildTtsSettings(deps.policy.get(), deps.settings.get(), hostInfo(), options);
        send({ type: 'tts.config', settings: ttsSettings });
        send({ type: 'listen', on: wantListen });
        send({ type: 'wake', on: wantWake });
        send({ type: 'watch', on: wantWatch });
        send({ type: 'system', on: wantSystem });
        updateReadiness();
        break;
      case 'fatal':
        log.error(`ses işçisi: ${event.message}`);
        if (!workerReady) {
          workerFailed = true;
          session.reportError('worker', t('voice.error.boot'));
          updateReadiness();
        }
        break;
      case 'wake':
        if (echoProbe && echoProbe.phase !== 'baseline' && echoProbe.phase !== 'done') echoProbe.wake++;
        // Gerçek zamanlı motor açıkken uyandırma onu açar; cascade turu çalışmaz.
        if (realtime.active()) {
          realtime.onWake();
          break;
        }
        session.onWake(event.phrase, event.score);
        break;
      case 'speech_start':
        if (micTest) micTest.speech = true;
        if (echoProbe && (echoProbe.phase === 'playing' || echoProbe.phase === 'tail')) {
          echoProbe.vad++;
          // Yankı giderici bu sözü kullanıcı sayıyor mu (kimse konuşmuyor: sayarsa Jarvis kendini keserdi). Kaba kanıt
          // tek başına susturmaz (önce ses kısılır): ancak kısık seste ikinci kez gelirse sayılır.
          if (event.coarse) echoProbe.coarse.set(event.segmentId, event.near !== undefined && event.near !== null && event.near >= VOICE_TUNING.nearMaybe ? 1 : 0);
          else if (event.near === null || (event.near !== undefined && event.near >= VOICE_TUNING.nearSure)) echoProbe.sure++;
        }
        if (session.status().state === 'speaking') {
          bargeProbe = { at: performance.now(), confirmMs: event.onsetAgoMs };
          bargeSegmentId = event.segmentId;
        }
        // Gerçek zamanlı motor: kullanıcı konuşunca modelin sesi kesilir (araya girme).
        if (realtime.active()) {
          realtime.onUserSpeechStart();
          break;
        }
        session.onSpeechStart(event.segmentId, event.onsetAgoMs, event.near, event.coarse === true);
        break;
      case 'speech_near':
        if (echoProbe && (echoProbe.phase === 'playing' || echoProbe.phase === 'tail')) {
          const coarse = echoProbe.coarse.get(event.segmentId) ?? (event.coarse ? 0 : undefined);
          if (coarse === undefined) echoProbe.sure++;
          else {
            echoProbe.coarse.set(event.segmentId, coarse + 1);
            if (coarse + 1 === 2) echoProbe.sure++;
          }
        }
        session.onSpeechNear(event.segmentId, event.coarse === true);
        break;
      case 'echo':
        echoStats = {
          trained: event.trained,
          converged: event.converged,
          delayMs: event.delayMs,
          // Yankı bastırma: bildirilenlerin en iyisi (anlık değer kullanıcı konuşurken düşer). Sayısal benzetimde
          // (gürültüsüz) anlamsızca büyür; 60 dB'de kırpılır.
          erleDb: Math.min(60, Math.max(echoStats?.delayMs === event.delayMs ? echoStats.erleDb : 0, Number(event.erleDb.toFixed(1)))),
          coupled: event.coupled === true,
          // İlinti: bildirilenlerin en iyisi (kullanıcı konuşurken ve sessizlikte düşer).
          corr: typeof event.corr === 'number' ? Math.max(echoStats?.corr ?? 0, event.corr) : (echoStats?.corr ?? null),
          corrLagMs: typeof event.corr === 'number' && event.corr >= (echoStats?.corr ?? 0) ? (event.corrLagMs ?? null) : (echoStats?.corrLagMs ?? null),
        };
        session.setCancellerTrained(event.trained);
        session.setCancellerCoupled(event.coupled === true);
        break;
      case 'speech_cut':
        session.onSpeechCut(event.segmentId);
        break;
      case 'speech_end':
        if (micTest) micTest.lastPcm = event.pcm;
        if (segmentTap) segmentTap({ pcm: event.pcm, durationMs: event.durationMs });
        if (event.segmentId === bargeSegmentId && lastBargeIn) {
          lastBargeIn = { ...lastBargeIn, vadConfirmMs: event.confirmLagMs };
          bargeSegmentId = null;
        }
        // Gerçek zamanlı motor: söz bölütü (dinleme açıksa) OpenAI'ye gönderilir; cascade STT+beyin+TTS çalışmaz.
        if (realtime.active()) {
          realtime.onUtterance(event.pcm);
          break;
        }
        session.onSpeechEnd(event.segmentId, event.pcm, event.durationMs);
        break;
      case 'speech_blip':
        session.onSpeechBlip(event.pcm, event.durationMs);
        break;
      case 'system_start':
        break;
      case 'system_speech':
        session.onSystemSpeech(event.pcm, event.durationMs);
        break;
      case 'level': {
        if (event.source === 'mic') {
          if (micTest) {
            micTest.peak = Math.max(micTest.peak, event.peak);
            micTest.squares += event.rms * event.rms;
            micTest.frames++;
          }
          if (echoProbe) {
            if (echoProbe.phase === 'baseline') {
              echoProbe.baseline.squares += event.rms * event.rms;
              echoProbe.baseline.frames++;
            } else if (echoProbe.phase === 'playing') {
              echoProbe.playing.squares += event.rms * event.rms;
              echoProbe.playing.frames++;
              echoProbe.playing.peak = Math.max(echoProbe.playing.peak, event.rms);
            } else if (echoProbe.phase === 'tail' && event.rms > echoProbe.loudAbove) {
              echoProbe.lastLoudAt = performance.now();
            }
          }
        }
        // Dalga yalnız ilgili durumda çizilir; boştayken saniyede 25 olay yayınlanmaz.
        const state = session.status().state;
        // Mikrofon sınaması sürerken de yayınlanır: kurulumdaki düzey çubuğu sesle oynar (K2).
        const wanted =
          event.source === 'mic' ? micTest !== null || state === 'listening' || state === 'followup' : state === 'speaking';
        if (wanted) deps.bus.emit('voice.level', { source: event.source, rms: Math.min(1, event.rms) });
        break;
      }
      case 'tts.sentence':
        remember(sentences, {
          streamId: event.streamId,
          index: event.index,
          audioMs: event.audioMs,
          firstChunkMs: event.firstChunkMs,
          synthFirstChunkMs: event.synthFirstChunkMs,
          rms: event.rms,
          engine: event.engine,
          device: event.device ?? null,
          chars: event.chars,
          fallback: event.fallback,
        });
        session.onTtsSentence(event.streamId, event.index, event.audioMs);
        break;
      case 'tts.hostFailed':
        // Konak bir cümleyi üretemedi (cümle Piper ile okundu): süreç asılıysa yeniden başlatılır.
        hostPortLive = false;
        refreshTts();
        ttsHost.reportFailure(event.message);
        break;
      case 'tts.usage':
        ttsCharsBilled += event.chars;
        try {
          // `UsageRecord`'da karakter alanı yok: faturalanan karakter `inputTokens` alanına yazılır (TTS'te belirteç
          // yoktur). Dolar karşılığı için politika ya da sabit yok (ücretsiz plan); 0 yazılır.
          deps.usage.record({
            kind: 'tts',
            provider: 'elevenlabs',
            model: ttsSettings.elevenlabs?.model ?? 'elevenlabs',
            inputTokens: event.chars,
            audioSeconds: event.audioMs / 1000,
            costUsd: 0,
            durationMs: event.durationMs,
          });
        } catch {
          // Kullanım kaydı ses turunu etkilemez.
        }
        break;
      case 'tts.fallback': {
        const message = fallbackMessage(event.reason);
        ttsFallback = {
          reason: event.reason,
          message,
          status: event.status,
          until: event.until === null ? null : (new Date(event.until).toISOString() as IsoDateTime),
          at: nowIso(),
        };
        log.info(`bulut ses yerine yerel ses (${event.reason}): ${event.detail}`);
        // Bulut konuşamıyor: yerel yedek (ekran kartı sesi) ayağa kalkar; o hazır olana dek Piper konuşur.
        syncHost();
        // Kullanıcıya bir kez, hata olarak değil bilgi olarak söylenir; aynı neden her yeniden denemede yinelenmez.
        // Kota aylık dolar: bildirim ayda bir kez (uygulama yeniden başlasa da) gösterilir.
        const month = nowIso().slice(0, 7);
        const notify = shouldNotifyFallback(event.reason, {
          lastNotified: ttsNotified,
          quotaNoticeMonth: device.get().ttsQuotaNoticeMonth,
          month,
        });
        ttsNotified = event.reason;
        if (notify) {
          if (event.reason === 'quota') device.update({ ttsQuotaNoticeMonth: month });
          session.reportNotice('tts_fallback', message);
        }
        break;
      }
      case 'tts.recovered':
        ttsFallback = null;
        ttsNotified = null;
        // Bulut geri geldi: yedek konak bırakılır (ekran belleği boşalır).
        syncHost();
        break;
      case 'tts.error':
        if (previewOverride) previewError = event.message;
        session.onTtsError(event.streamId, event.message);
        break;
      case 'kws.probe.result': {
        const resolve = probeWaiters.get(event.id);
        probeWaiters.delete(event.id);
        resolve?.({ score: event.score, phrase: event.phrase, profiles: event.profiles });
        break;
      }
      case 'log':
        log[event.level](event.message);
        break;
      case 'hello':
        break;
    }
  }

  function onAudioReport(report: AudioReport): void {
    switch (report.type) {
      case 'ready':
        audioReady = true;
        if (wantListen) startCapture();
        sendAudio({ type: 'output.set', deviceId: deps.settings.get().outputDeviceId });
        sendAudio({ type: 'echo.config', gate: echoGate() });
        // Ses penceresi yeniden yüklendiyse süren toplantının bilgisayar sesi yeniden açılır.
        if (wantSystem) startSystem();
        updateReadiness();
        break;
      case 'system.started':
        if (report.label !== undefined) log.info(`bilgisayar sesi açıldı: ${report.label}${report.trackRate ? `, ${report.trackRate} Hz` : ''}`);
        session.setMeetingSystem(wantSystem ? 'on' : 'off');
        break;
      case 'system.stopped':
        if (!wantSystem) session.setMeetingSystem('off');
        break;
      case 'system.restart': {
        // Çıkış aygıtı değişti ya da iz koptu: yeni aygıtla yeniden açılır. Kısa sürede üçten fazla kopma bir döngüdür;
        // o zaman kullanıcıya açıkça söylenir.
        if (!wantSystem) break;
        const now = Date.now();
        systemRestarts = systemRestarts.filter((at) => now - at < 60_000);
        if (systemRestarts.length >= 3) {
          log.warn(`bilgisayar sesi: yeniden açma döngüsü (${report.reason}); bırakıldı`);
          session.setMeetingSystem('error', t('meeting.system.ended'));
          break;
        }
        systemRestarts.push(now);
        log.info(`bilgisayar sesi yeniden açılıyor (${report.reason === 'device_changed' ? 'çıkış aygıtı değişti' : 'iz koptu'})`);
        startSystem();
        break;
      }
      case 'system.error':
        log.warn(`bilgisayar sesi alınamıyor: ${report.code}${report.detail ? ` (${report.detail})` : ''}`);
        session.setMeetingSystem(wantSystem ? 'error' : 'off', report.message);
        break;
      case 'capture.started':
        capturing = true;
        captureError = null;
        captureProcessing = report.processing ?? null;
        captureWaiter?.();
        session.setInputDevice(report.deviceLabel);
        updateReadiness();
        break;
      case 'capture.stopped':
        capturing = false;
        break;
      case 'capture.error':
        capturing = false;
        if (captureError !== report.message) session.reportError(`mic_${report.code}`, report.message);
        captureError = report.message;
        session.setInputDevice(null);
        updateReadiness();
        break;
      case 'playback.started':
        if (echoProbe?.streamId === report.streamId) echoProbe.phase = 'playing';
        session.onPlaybackStarted(report.streamId);
        break;
      case 'playback.ended':
        if (typeof report.outputLatencyMs === 'number') outputLatencyMs = report.outputLatencyMs;
        if (echoProbe?.streamId === report.streamId) {
          const baseline = echoProbe.baseline.frames > 0 ? Math.sqrt(echoProbe.baseline.squares / echoProbe.baseline.frames) : 0;
          echoProbe.playedMs = report.playedMs;
          echoProbe.endedAt = performance.now();
          echoProbe.lastLoudAt = echoProbe.endedAt;
          // "Sesli": oda gürültüsünün belirgin üstü. Kuyruk, çalma bittikten sonra mikrofonun en son sesli olduğu ana kadardır.
          echoProbe.loudAbove = Math.max(baseline * 4, 0.004);
          echoProbe.phase = 'tail';
          echoProbe.ended?.();
        }
        if (report.interrupted && bargeProbe) {
          lastBargeIn = {
            vadToStopMs: Math.round(performance.now() - bargeProbe.at),
            vadConfirmMs: bargeProbe.confirmMs,
          };
          bargeProbe = null;
        }
        // Gerçek zamanlı motorun oynatma akışı: turun bittiğini (takip penceresi) denetleyici bilsin.
        if (report.streamId.startsWith('rt-')) {
          realtime.onPlaybackEnded(report.streamId);
          break;
        }
        session.onPlaybackEnded(report.streamId, report.playedMs, report.interrupted);
        break;
    }
  }

  // ───────────────────────────── sınamalar ─────────────────────────────

  /** Sınama sırasında mikrofon açık ve işçi dinliyor olmalı; bitince önceki durum geri gelir. */
  function openMicForTest(): () => void {
    if (!capturing) startCapture();
    send({ type: 'listen', on: true });
    return () => {
      if (!wantListen) {
        sendAudio({ type: 'capture.stop' });
        send({ type: 'listen', on: false });
      }
      send({ type: 'wake', on: wantWake });
    };
  }

  async function testMic(deviceId: string | null, seconds: number): Promise<MicTestResult> {
    const failed = (error: string): MicTestResult => ({
      ok: false,
      deviceLabel: session.status().inputDeviceLabel ?? '',
      peak: 0,
      rms: 0,
      speechDetected: false,
      transcript: null,
      error,
    });
    if (!workerReady || !audioReady) return failed(t('voice.notReady.starting'));
    if (session.status().micMuted) return failed(t('voice.micTest.muted'));
    if (activeTest) return failed(t('voice.micTest.busy'));
    // Toplantı kipinde sınama yok: sınama dinlemeyi askıya alır, toplantının sözleri yazıya dökülmezdi.
    if (session.status().meeting?.on) return failed(t('voice.test.meeting'));

    const current = deps.settings.get().inputDeviceId;
    const switched = deviceId !== current;
    activeTest = 'mic';
    session.setSuspended(true);
    micTest = { peak: 0, squares: 0, frames: 0, speech: false, lastPcm: null };
    try {
      if (switched || !capturing) startCapture(deviceId);
      send({ type: 'listen', on: true });
      await sleep(Math.max(1, Math.min(seconds, 30)) * 1000);
      const collected = micTest;
      if (captureError) return failed(captureError);
      if (collected.frames === 0) return failed(t('voice.micTest.noAudio'));
      let transcript: string | null = null;
      if (collected.lastPcm && stt?.status().state === 'ready') {
        transcript = (await stt.transcribe(collected.lastPcm).catch(() => null))?.text || null;
      }
      return {
        ok: true,
        deviceLabel: session.status().inputDeviceLabel ?? '',
        peak: Math.min(1, collected.peak),
        rms: Math.min(1, Math.sqrt(collected.squares / collected.frames)),
        speechDetected: collected.speech,
        transcript,
        error: null,
      };
    } finally {
      micTest = null;
      activeTest = null;
      session.setSuspended(false);
      // Sınama başka aygıtla yapıldıysa ya da mikrofon açık değildiyse önceki duruma dönülür.
      if (wantListen) {
        if (switched) startCapture(current);
      } else {
        sendAudio({ type: 'capture.stop' });
        send({ type: 'listen', on: false });
      }
    }
  }

  function testWake(seconds: number): Promise<WakeTestResult> {
    return new Promise((resolve) => {
      const off = deps.bus.once('voice.wake', ({ score }) => {
        clearTimeout(timer);
        resolve({ detected: true, score });
      });
      const timer = setTimeout(() => {
        off();
        resolve({ detected: false, score: 0 });
      }, Math.max(1, Math.min(seconds, 60)) * 1000);
    });
  }

  /**
   * Söz örneğinin sezici ölçümü: tetiklendiği en yüksek eşik (puan) ve örneği yakalayan duyarlık profilleri.
   * Sezici yoksa ya da yanıt gelmezse puan `null`, profil yok.
   */
  function probeKws(pcm: Int16Array): Promise<{ score: number | null; phrase: string | null; profiles: string[] }> {
    if (!workerReady || !workerInfo.kws) return Promise.resolve({ score: null, phrase: null, profiles: [] });
    return new Promise((resolve) => {
      const id = ++probeSeq;
      const timer = setTimeout(() => {
        probeWaiters.delete(id);
        resolve({ score: null, phrase: null, profiles: [] });
      }, PROBE_TIMEOUT_MS);
      probeWaiters.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      send({ type: 'kws.probe', id, pcm });
    });
  }

  function nextSegment(timeoutMs: number): Promise<{ pcm: Int16Array; durationMs: number } | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        segmentTap = null;
        resolve(null);
      }, timeoutMs);
      segmentTap = (segment) => {
        segmentTap = null;
        clearTimeout(timer);
        resolve(segment);
      };
    });
  }

  /**
   * "Üç kez Hey Jarvis deyin" (KURGU §5.2 madde 8). Her örnek için: (a) sezicinin hangi duyarlık profillerinde bu
   * örneği yakaladığı ölçülür ve örneklerin üçte ikisini yakalayan en az duyarlı profil seçilir (sezici kaçırıp Whisper
   * yakaladıysa sezici daha duyarlı yapılır); (b) Whisper'ın örneği nasıl yazdığı kaydedilir, eşleştiricinin tanımadığı
   * ama ada benzeyen yazım öğrenilir. Net olmayan örnek (çok kısa, çok kısık, başka bir söz) yinelenir.
   */
  async function calibrateWake(requested: number): Promise<WakeCalibrationResult> {
    const total = Math.max(1, Math.min(Math.round(requested) || 3, 5));
    const failed = (message: string): WakeCalibrationResult => ({
      ok: false,
      heard: 0,
      total,
      threshold: workerInfo.kws ? kwsThreshold() : null,
      paths: [],
      message,
    });
    if (!session.status().ready || !stt) return failed(t('voice.calibration.notReady'));
    if (session.status().micMuted) return failed(t('voice.micTest.muted'));
    if (activeTest) return failed(t('voice.calibration.busy'));
    if (session.status().meeting?.on) return failed(t('voice.test.meeting'));

    const persona = deps.policy.get().persona;
    // Öğrenilmiş yazımlar olmadan: yazımın yeniden öğrenilmesi gerekip gerekmediği buna göre anlaşılır.
    const matcher = createWakeMatcher(persona.wakePhrases, persona.name);
    const progress = (index: number, phase: 'listening' | 'heard' | 'retry' | 'done', score: number | null = null): void =>
      deps.bus.emit('setup.calibrationProgress', { index, total, phase, score });

    activeTest = 'calibration';
    // Süren yanıt varsa kesilir: kullanıcı kalibrasyon ekranında, Jarvis'in sesi örneklere karışmasın.
    session.cancelTurn();
    session.setSuspended(true);
    const restoreMic = openMicForTest();
    const samples: WakeCalibration['samples'] = [];
    const hits: string[][] = [];
    const learned = new Set<string>();
    try {
      for (let index = 1; index <= total; index++) {
        for (let attempt = 0; attempt <= VOICE_TUNING.calibrationRetries; attempt++) {
          progress(index, 'listening');
          const segment = await nextSegment(VOICE_TUNING.calibrationSampleTimeoutMs);
          if (!segment) break;
          const clear =
            segment.durationMs >= VOICE_TUNING.calibrationMinMs &&
            segment.durationMs <= VOICE_TUNING.calibrationMaxMs &&
            pcmRms(segment.pcm) >= VOICE_TUNING.calibrationMinRms;
          if (!clear) {
            progress(index, 'retry');
            continue;
          }
          const [probe, result] = await Promise.all([
            probeKws(segment.pcm),
            transcribe(segment.pcm).catch((): SttResult | null => null),
          ]);
          const text = result?.text ?? '';
          const paths: WakePath[] = [];
          // Sezici örneği herhangi bir eşikte duyduysa örnek geçerlidir; hangi profilin yakaladığı ayrıca kaydedilir.
          if (probe.score !== null || probe.profiles.length > 0) paths.push('kws');
          const spelling = matcher.match(text).matched ? null : learnableSpelling(text, persona.wakePhrases, persona.name);
          if (matcher.match(text).matched || spelling) paths.push('whisper');
          if (paths.length === 0) {
            // Kullanıcı başka bir şey söyledi (ya da oda gürültüsü söz sanıldı).
            progress(index, 'retry');
            continue;
          }
          if (spelling) learned.add(spelling);
          samples.push({ score: probe.score, transcript: text, paths, durationMs: segment.durationMs, profiles: probe.profiles });
          hits.push(probe.profiles);
          progress(index, 'heard', probe.score);
          break;
        }
      }
      progress(total, 'done');

      const paths = [...new Set(samples.flatMap((sample) => sample.paths))];
      if (samples.length === 0) return failed(t('voice.calibration.failed'));

      // Sezici hiçbir profilde hiçbir örneği yakalamadıysa yine en duyarlı profil seçilir (`chooseKwsProfile`):
      // uyandırma Whisper yoluyla çalışır, sezici en azından yakalayabileceği söyleyişi kaçırmaz.
      const choice = workerInfo.kws ? chooseKwsProfile(hits) : null;
      const threshold = choice && choice.caught > 0 ? choice.profile.threshold : null;
      device.update({
        wake: { threshold, learned: [...learned], samples, at: nowIso(), ...(choice ? { profile: choice.profile.id } : {}) },
      });
      session.setLearnedWake([...learned]);
      if (choice) send({ type: 'kws.update', threshold: choice.profile.threshold, boost: choice.profile.boost, paths: choice.profile.paths });
      const ok = samples.length === total;
      const message = !ok
        ? t('voice.calibration.partial', { heard: samples.length, total })
        : !choice || choice.caught === 0
          ? t('voice.calibration.okWhisperOnly')
          : choice.caught < samples.length
            ? t('voice.calibration.okMixed', { caught: choice.caught, heard: samples.length })
            : choice.profile.id === 'standard'
              ? t('voice.calibration.ok', { heard: samples.length })
              : t('voice.calibration.okTuned', { heard: samples.length });
      log.info(
        `uyandırma kalibrasyonu: ${samples.length}/${total} örnek, sezici profili ${choice?.profile.id ?? 'yok'} ` +
          `(${choice?.caught ?? 0} örneği yakaladı), öğrenilen yazım ${learned.size}`,
      );
      return { ok, heard: samples.length, total, threshold, paths, message };
    } finally {
      segmentTap = null;
      send({ type: 'kws.probe.end' });
      restoreMic();
      activeTest = null;
      session.setSuspended(false);
    }
  }

  /** Test cümlesini bir kez çalar ve mikrofonu ölçer. Çalınamadıysa `null`. Çağıran sınama durumunu kurmuş olmalıdır. */
  async function measureEcho(mode: EchoCancellationMode): Promise<EchoMeasurement | null> {
    const probe: NonNullable<typeof echoProbe> = {
      streamId: `echo-${newId()}`,
      phase: 'baseline',
      vad: 0,
      sure: 0,
      coarse: new Map(),
      wake: 0,
      baseline: { squares: 0, frames: 0 },
      playing: { squares: 0, frames: 0, peak: 0 },
      playedMs: 0,
      endedAt: 0,
      lastLoudAt: 0,
      loudAbove: Number.POSITIVE_INFINITY,
      ended: null,
    };
    echoProbe = probe;
    try {
      // Sezici de dinler: test cümlesinde uyandırma sözü geçer; Jarvis kendi sesiyle uyanıyor mu görülür.
      send({ type: 'wake', on: true });
      await sleep(700);
      const finished = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), VOICE_TUNING.echoTimeoutMs);
        probe.ended = () => {
          clearTimeout(timer);
          resolve(true);
        };
      });
      send({ type: 'tts.speak', streamId: probe.streamId, text: t('voice.echo.sentence'), local: true });
      send({ type: 'tts.end', streamId: probe.streamId });
      const played = await finished;
      // Son hecenin yankısı ve VAD'ın onay gecikmesi için kuyruk; sızan sesin ne kadar sürdüğü de burada ölçülür.
      await sleep(VOICE_TUNING.echoTailMs + VOICE_TUNING.minSpeechMs);
      probe.phase = 'done';
      if (!played || probe.playedMs < 500) {
        sendAudio({ type: 'playback.stop' });
        send({ type: 'tts.cancel' });
        return null;
      }
      const rms = (bucket: { squares: number; frames: number }): number =>
        bucket.frames > 0 ? Number(Math.sqrt(bucket.squares / bucket.frames).toFixed(4)) : 0;
      // Sızıntı artık "yankı gidericiye rağmen Jarvis kendi sesini kullanıcı sanıyor" demektir. Giderici hiç
      // öğrenemediyse (referansla mikrofon arasında ilinti yok ama VAD söz duyuyor) ham sayım geçerlidir.
      // d6: giderici öğrenemedi ama ilintiyi buldu (Bluetooth) → kaba kapının kararı sayılır; eskiden ham VAD sayılıyordu
      // ve tek bir yankı algısı söz kesmeyi `wake`e indiriyordu.
      const gated = echoStats?.trained === true || echoStats?.coupled === true;
      const triggers = gated ? probe.sure : probe.vad;
      const leaked = triggers > 0;
      return {
        leaked,
        gated: true,
        rawVadTriggers: probe.vad,
        ...(leaked ? { reason: 'echo_test' as const } : {}),
        vadTriggers: triggers,
        wakeTriggers: probe.wake,
        baselineRms: rms(probe.baseline),
        playbackRms: rms(probe.playing),
        playbackPeak: Number(probe.playing.peak.toFixed(4)),
        playedMs: probe.playedMs,
        at: nowIso(),
        tailMs: leaked ? Math.max(0, Math.round(probe.lastLoudAt - probe.endedAt)) : 0,
        mode,
        canceller: echoStats
          ? { trained: echoStats.trained, coupled: echoStats.coupled, delayMs: echoStats.delayMs, erleDb: echoStats.erleDb, corr: echoStats.corr, corrLagMs: echoStats.corrLagMs, outputLatencyMs }
          : null,
      };
    } finally {
      echoProbe = null;
    }
  }

  /** Mikrofonu verilen yankı engelleme kipiyle yeniden açar ve tarayıcının ses işlemesi yerleşene dek bekler. */
  async function reopenCapture(mode: EchoCancellationMode): Promise<boolean> {
    const started = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        captureWaiter = null;
        resolve(false);
      }, 5000);
      captureWaiter = () => {
        captureWaiter = null;
        clearTimeout(timer);
        resolve(true);
      };
    });
    startCapture(deps.settings.get().inputDeviceId, mode);
    const ok = await started;
    if (ok) await sleep(VOICE_TUNING.aecSettleMs);
    return ok;
  }

  /**
   * Yankı sınaması (KURGU §5.2 madde 6): test cümlesi hoparlörden çalınır; yankı engellemeden geçen mikrofonda o
   * sırada söz algılanırsa Jarvis'in sesi sızıyor demektir ve söz kesme bu cihazda `wake` kipine iner.
   * Test cümlesi her zaman yerel sesle okunur (bulut kotasından yemez).
   *
   * Olağan yankı engelleme kipi sızdırırsa aynı ölçüm bir kez de "bütün sesleri bastır" kipiyle (`all`) yapılır:
   * o kip bu cihazda sızıntıyı gideriyorsa cihaza uygulanır, gidermiyorsa olağan kipe dönülür. Karar, kullanıcının
   * kendi hoparlörü ve mikrofonuyla yapılan ölçüme dayanır; hangi kipin yürürlükte olduğu tanıda görünür.
   */
  async function echoTest(): Promise<EchoTestResult> {
    const current = (): 'voice' | 'wake' => (session.status().bargeIn === 'wake' ? 'wake' : 'voice');
    const failed = (message: string): EchoTestResult => ({ ok: false, leaked: false, recommendedBargeIn: current(), message });
    if (!session.status().ready || !tts.available()) return failed(t('voice.echo.notReady'));
    if (session.status().micMuted) return failed(t('voice.micTest.muted'));
    if (activeTest) return failed(t('voice.echo.busy'));
    // Toplantıda Jarvis sesli konuşmaz: çalınacak cümle olmadığı için ölçüm de yanıltıcı olurdu.
    if (session.status().meeting?.on) return failed(t('voice.test.meeting'));

    activeTest = 'echo';
    session.cancelTurn();
    session.setSuspended(true);
    const restoreMic = openMicForTest();
    try {
      const startMode = aecMode();
      let measurement = await measureEcho(startMode);
      if (!measurement) return failed(t('voice.echo.noPlayback'));
      let mode = startMode;
      if (measurement.leaked && startMode === 'default') {
        // Olağan kip sızdırdı: sistemde çalan bütün sesi bastıran kip bu cihazda işe yarıyor mu.
        const all = (await reopenCapture('all')) && captureProcessing?.echoCancellation === 'all' ? await measureEcho('all') : null;
        if (all && !all.leaked) {
          measurement = all;
          mode = 'all';
        } else {
          measurement = { ...measurement, allMode: all ? { leaked: all.leaked, playbackRms: all.playbackRms } : null };
          await reopenCapture('default');
        }
      } else if (measurement.leaked && startMode === 'all') {
        // Seçili kip artık tutmuyor (aygıt değişmiş olabilir): olağan kipe dönülür, sonuç "sızıyor" kalır.
        mode = 'default';
        await reopenCapture('default');
      }
      device.update({ echo: measurement, aecMode: mode });
      applyEcho(measurement);
      log.info(
        `yankı sınaması: ${measurement.leaked ? 'SIZIYOR' : 'temiz'} (kip ${mode}, söz algısı ${measurement.vadTriggers}, sezici ${measurement.wakeTriggers}, ` +
          `ham söz algısı ${measurement.rawVadTriggers ?? 0}, giderici ${echoStats ? `${echoStats.trained ? 'öğrendi' : 'ÖĞRENEMEDİ'} ${echoStats.erleDb} dB / ${echoStats.delayMs} ms, ilinti ${echoStats.corr ?? '—'} @ ${echoStats.corrLagMs ?? '—'} ms, çıkış gecikmesi ${outputLatencyMs ?? '—'} ms` : 'hiç çalışmadı'}, ` +
          `mikrofon ${measurement.baselineRms} → ${measurement.playbackRms}, kuyruk ${measurement.tailMs ?? 0} ms` +
          `${measurement.allMode ? `, "all" kipi: ${measurement.allMode.leaked ? 'sızıyor' : 'temiz'} ${measurement.allMode.playbackRms}` : ''})`,
      );
      return {
        ok: true,
        leaked: measurement.leaked,
        recommendedBargeIn: current(),
        message: measurement.leaked ? t(current() === 'wake' ? 'voice.echo.leaked' : 'voice.echo.leakedCoarse') : mode === 'all' && startMode !== 'all' ? t('voice.echo.cleanAll') : t('voice.echo.clean'),
      };
    } finally {
      captureWaiter = null;
      restoreMic();
      activeTest = null;
      session.setSuspended(false);
    }
  }

  /**
   * Söz kesme sınaması (Ayarlar › Ses): üç bölüm okunur, kullanıcı her bölümde araya girer. Ölçülenler: kaçında
   * susuldu, sözün başından susmaya kaç ms geçti, Jarvis kendi sesiyle sustu mu. Sonuca göre yankı gidericinin düzey
   * kapısı cihaza yazılır: kendini kestiyse sıkılaşır, kullanıcıyı kaçırdıysa gevşer; sıkı kapıda bile kendini
   * kesiyorsa söz kesme bu cihazda `wake`e iner. Sınama boyunca oturum olağan çalışır (ölçülen gerçek davranıştır),
   * yalnız konuşmayı kesen söz tur açmaz.
   */
  async function bargeInTest(): Promise<BargeTestResult> {
    const failed = (message: string): BargeTestResult => ({
      ok: false,
      trials: 0,
      stopped: 0,
      selfInterrupts: 0,
      latenciesMs: [],
      medianMs: null,
      bargeIn: session.status().bargeIn,
      message,
    });
    if (!session.status().ready || !tts.available()) return failed(t('voice.bargeTest.notReady'));
    if (session.status().micMuted) return failed(t('voice.micTest.muted'));
    if (activeTest) return failed(t('voice.bargeTest.busy'));
    if (session.status().meeting?.on) return failed(t('voice.test.meeting'));

    activeTest = 'barge';
    session.cancelTurn();
    // Cihaz `wake`e inmişse sınama yine GERÇEK söz kesmeyi dener (geçici `voice` kipi): yoksa `wake`teki cihaz sınamayı
    // hiçbir zaman geçemez ve konuşarak kesme bir daha açılamazdı.
    const wasBlocked = wakeReason();
    if (wasBlocked !== null && deps.policy.get().voice.bargeIn === 'voice') session.setBargeTrial(true);
    const parts = [t('voice.bargeTest.part1'), t('voice.bargeTest.part2'), t('voice.bargeTest.part3')];
    const latencies: number[] = [];
    let stopped = 0;
    let selfInterrupts = 0;
    let verdict: ((info: { self: boolean }) => void) | null = null;
    session.setBargeTest((info) => verdict?.(info));
    try {
      for (const part of parts) {
        let barged = false;
        const off = deps.bus.on('voice.state', ({ state, reason }) => {
          if (state === 'listening' && reason === 'barge_in') barged = true;
        });
        const before = lastBargeIn;
        const heard = new Promise<{ self: boolean } | null>((resolve) => {
          verdict = resolve;
        });
        await session.speak(part);
        off();
        if (barged) {
          // Susmaya yol açan söz bitip yazıya çevrilince kimin konuştuğu bildirilir.
          const info = await Promise.race([heard, sleep(12_000).then(() => null)]);
          if (info?.self) selfInterrupts++;
          else {
            stopped++;
            const probe = lastBargeIn;
            if (probe && probe !== before) latencies.push(probe.vadToStopMs + probe.vadConfirmMs);
          }
        }
        verdict = null;
        await sleep(700);
      }
    } finally {
      session.setBargeTest(null);
      session.setBargeTrial(false);
      activeTest = null;
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const medianMs = sorted.length > 0 ? (sorted[Math.floor(sorted.length / 2)] ?? null) : null;
    // Eşik: kendini kestiyse kapı iki katına (3 dB) çıkar; hiç kendini kesmeden kullanıcıyı kaçırdıysa gevşer.
    let gate = echoGate();
    if (selfInterrupts > 0) gate = Math.min(VOICE_TUNING.echoGateMax, gate * 2);
    else if (stopped < 2) gate = Math.max(VOICE_TUNING.echoGateMin, gate / 1.5);
    const hopeless = selfInterrupts >= 2 && echoGate() >= VOICE_TUNING.echoGateMax;
    device.update({ barge: { gate, stopped, trials: parts.length, selfInterrupts, medianMs, at: nowIso() } });
    sendAudio({ type: 'echo.config', gate });
    if (hopeless) {
      const measurement: EchoMeasurement = {
        ...(device.get().echo ?? { vadTriggers: selfInterrupts, wakeTriggers: 0, baselineRms: 0, playbackRms: 0, playbackPeak: 0, playedMs: 0 }),
        leaked: true,
        gated: true,
        reason: 'barge_test',
        at: nowIso(),
      };
      device.update({ echo: measurement });
      applyEcho(measurement);
    }
    // Sınama geçti (en az iki kez sustu, kendini hiç kesmedi) ve cihaz `wake`e inmişti: konuşarak kesme geri açılır.
    // Ham sızıntı kaydı durur (giderici öğrenene dek aday söz kesmez); yalnız "gidericiye rağmen" damgası kalkar.
    const restored = wasBlocked !== null && !hopeless && selfInterrupts === 0 && stopped >= 2;
    if (restored) {
      const previous = device.get().echo;
      const measurement: EchoMeasurement = {
        ...(previous ?? { vadTriggers: 0, wakeTriggers: 0, baselineRms: 0, playbackRms: 0, playbackPeak: 0, playedMs: 0 }),
        leaked: false,
        gated: true,
        observed: false,
        rawVadTriggers: Math.max(1, previous?.rawVadTriggers ?? 0),
        clearedByBargeTest: true,
        at: nowIso(),
      };
      delete measurement.reason;
      device.update({ echo: measurement });
      applyEcho(measurement);
      log.info('söz kesme sınaması geçti: konuşarak kesme bu cihazda yeniden açıldı');
    }
    log.info(
      `söz kesme sınaması: ${stopped}/${parts.length} sustu, kendini kesme ${selfInterrupts}, ortanca ${medianMs ?? '—'} ms, kapı ${gate}` +
        `, giderici ${echoStats ? `${echoStats.trained ? 'öğrendi' : 'ÖĞRENEMEDİ'} ${echoStats.erleDb} dB / ${echoStats.delayMs} ms, ilinti ${echoStats.corr ?? '—'} @ ${echoStats.corrLagMs ?? '—'} ms` : 'hiç çalışmadı'}` +
        `${wasBlocked ? `, önceki kip wake (${wasBlocked})${restored ? ' → voice' : ''}` : ''}`,
    );
    const message = restored
      ? t('bargein.restored')
      : hopeless
      ? t('voice.bargeTest.failed')
      : selfInterrupts > 0
        ? t('voice.bargeTest.self', { self: selfInterrupts })
        : stopped < 2
          ? t('voice.bargeTest.missed', { trials: parts.length, stopped })
          : t('voice.bargeTest.ok', { trials: parts.length, stopped, ms: medianMs ?? 0 });
    return { ok: true, trials: parts.length, stopped, selfInterrupts, latenciesMs: latencies, medianMs, bargeIn: session.status().bargeIn, message };
  }

  /**
   * Kullanıcı açıkça konuşmak istedi (kısayol, ada). Yazıya çevirme kalıcı hataya düşmüşse bu bir
   * "yeniden dene" isteğidir de: motor yeniden başlatılır; oturum o an hazır değilse nedenini söyler.
   */
  function startListening(trigger: 'hotkey' | 'island' | 'api'): void {
    if (stt?.status().state === 'failed') void stt.start();
    if (!booted) void boot();
    // Gerçek zamanlı motor açıkken "konuş" dinlemeyi doğrudan onda açar.
    if (realtime.active()) {
      realtime.onWake();
      return;
    }
    session.startListening(trigger);
  }

  function diagnostics(): VoiceDiagnostics {
    const stages = session.stages();
    const first = stages?.firstStreamId ? sentences.find((item) => item.streamId === stages.firstStreamId && item.index === 0) : undefined;
    const described = describeTts(deps.policy.get(), deps.settings.get());
    const active = ttsActive();
    const host = hostInfo();
    // Etkin motorda kullanılan ses: konakta yüklü ses, Piper'ın tek sesi ya da bulut sesinin kimliği.
    const activeVoice = active === 'elevenlabs' ? described.voiceId : isTtsHostEngine(active) ? (host?.voice ?? null) : TTS_ENGINES['piper-local'].defaultVoice;
    // Bulut istenmiş ama anahtar yok: işçi buluttan hiç haberdar edilmedi; tanı nedeni yine de söyler.
    const fallback: VoiceDiagnostics['tts']['fallback'] =
      active === 'elevenlabs'
        ? null
        : described.provider === 'elevenlabs' && !described.hasKey
          ? { reason: 'no_key', message: fallbackMessage('no_key'), status: null, until: null, at: noKeySince }
          : ttsFallback;
    return {
      stt: stt?.status() ?? null,
      worker: { ready: workerReady, ...workerInfo, restarts: worker.restarts },
      audio: { ready: audioReady, capturing, captureError },
      transcripts: [...transcripts],
      sentences: [...sentences],
      lastBargeIn,
      vocabulary: [...sttVocabulary],
      wake: {
        last: lastWake,
        enabled: wantWake,
        threshold: kwsThreshold(),
        variants: wakeVariants(deps.policy.get().persona.wakePhrases).map((variant) => variant.spelling),
        calibration: device.get().wake,
        latency: session.wakeLatencies(),
      },
      echoGuard: {
        ...session.echoReport(),
        aec: { mode: aecMode(), applied: captureProcessing, outputLatencyMs },
        canceller: echoStats ? { ...echoStats, gate: echoGate() } : null,
      },
      turn: stages ? { ...stages, ttsFirstChunkMs: first?.synthFirstChunkMs ?? null, ttsEngine: first?.engine ?? null } : null,
      tts: {
        provider: described.provider,
        source: described.source,
        active,
        device: ttsActiveDevice(),
        voice: activeVoice,
        host: hostState && hostState.engine !== null ? hostState : null,
        voiceId: described.voiceId,
        model: described.model,
        hasKey: described.hasKey,
        fallback,
        charsBilled: ttsCharsBilled,
      },
      bargeIn: { policy: deps.policy.get().voice.bargeIn, effective: session.status().bargeIn, echo: device.get().echo },
    };
  }

  function diagnosticsReport(): VoiceDiagnosticsReport {
    const full = diagnostics();
    const sttState = full.stt?.state ?? 'stopped';
    return {
      wake: {
        last: full.wake.last,
        threshold: full.wake.threshold,
        calibratedAt: full.wake.calibration?.at ?? null,
        learned: full.wake.calibration?.learned ?? [],
        latency: full.wake.latency,
        profile: full.wake.calibration?.profile ?? null,
      },
      echoGuard: {
        guardMs: full.echoGuard.guardMs,
        cuts: full.echoGuard.cuts,
        dropped: full.echoGuard.dropped,
        trimmed: full.echoGuard.trimmed,
        selfInterrupts: full.echoGuard.selfInterrupts,
        last: full.echoGuard.last,
        aec: {
          mode: full.echoGuard.aec.mode,
          applied: full.echoGuard.aec.applied?.echoCancellation ?? null,
          outputLatencyMs: full.echoGuard.aec.outputLatencyMs,
          tailMs: full.bargeIn.echo?.tailMs ?? null,
          allMode: full.bargeIn.echo?.allMode ?? null,
          observed: full.bargeIn.echo?.observed === true,
        },
        canceller: full.echoGuard.canceller,
        wakeReason: wakeReason(),
        bargeTest: device.get().barge
          ? {
              stopped: device.get().barge?.stopped ?? 0,
              trials: device.get().barge?.trials ?? 0,
              selfInterrupts: device.get().barge?.selfInterrupts ?? 0,
              medianMs: device.get().barge?.medianMs ?? null,
              at: device.get().barge?.at ?? nowIso(),
            }
          : null,
      },
      turn: full.turn
        ? {
            at: full.turn.at,
            endSilenceMs: full.turn.endSilenceMs,
            sttMs: full.turn.sttMs,
            brainFirstSentenceMs: full.turn.brainFirstSentenceMs,
            ttsFirstChunkMs: full.turn.ttsFirstChunkMs,
            ttsFirstAudioMs: full.turn.ttsFirstAudioMs,
            totalMs: full.turn.totalMs,
            interrupted: full.turn.interrupted,
          }
        : null,
      engines: {
        stt: { id: 'whisper-local', state: sttState, gpu: full.stt?.gpu ?? null, reason: full.stt?.reason ?? null },
        wake: { kws: full.worker.ready && full.worker.kws, whisper: sttState === 'ready' },
        tts: {
          provider: full.tts.provider,
          source: full.tts.source,
          active: full.tts.active,
          device: full.tts.device,
          voice: full.tts.voice,
          local: full.worker.ready && (full.worker.tts || full.tts.device !== null),
          host: full.tts.host
            ? {
                engine: full.tts.host.engine as TtsHostEngineId,
                phase: full.tts.host.phase,
                device: full.tts.host.device,
                reason: full.tts.host.reason,
                attempts: full.tts.host.attempts,
                loadMs: full.tts.host.loadMs,
                warmMs: full.tts.host.warmMs,
                restarts: full.tts.host.restarts,
              }
            : null,
          voiceId: full.tts.voiceId,
          model: full.tts.model,
          hasKey: full.tts.hasKey,
          fallback: full.tts.fallback
            ? { reason: full.tts.fallback.reason, message: full.tts.fallback.message, until: full.tts.fallback.until }
            : null,
          charsBilled: full.tts.charsBilled,
        },
        worker: { ready: full.worker.ready, restarts: full.worker.restarts },
        microphone: { capturing: full.audio.capturing, error: full.audio.captureError },
      },
      bargeIn: {
        policy: full.bargeIn.policy,
        effective: full.bargeIn.effective,
        echo: full.bargeIn.echo
          ? {
              leaked: full.bargeIn.echo.leaked,
              baselineRms: full.bargeIn.echo.baselineRms,
              playbackRms: full.bargeIn.echo.playbackRms,
              at: full.bargeIn.echo.at,
            }
          : null,
      },
    };
  }

  // ───────────────────────────── seslendirme motorları ─────────────────────────────

  /** Model kayıtlarının birleşik dosya durumu ve (hazırlanıyorsa) ilerlemesi. */
  function filesOf(ids: string[]): {
    files: TtsEngineStatus['files'];
    progress: number | null;
    received: number;
    total: number;
    /** Yalnız doğrulama sürüyor (indirme yok). */
    verifying: boolean;
    /** Hazırlama başarısız olduysa nedeni. */
    error: string | null;
  } {
    const rows = deps.models.status().filter((model) => ids.includes(model.id));
    const total = rows.reduce((sum, model) => sum + model.totalBytes, 0);
    const received = rows.reduce((sum, model) => sum + Math.min(model.receivedBytes, model.totalBytes), 0);
    const base = { received, total, verifying: false, error: null };
    if (rows.length < ids.length) return { ...base, files: 'missing', progress: null };
    if (rows.every((model) => model.status === 'ready')) return { ...base, files: 'ready', progress: null, received: total };
    const busy = rows.some((model) => model.status === 'downloading' || model.status === 'verifying' || model.status === 'queued');
    const verifying = busy && rows.every((model) => model.status === 'verifying' || model.status === 'ready');
    const failed = rows.find((model) => model.status === 'failed');
    return {
      ...base,
      files: busy ? 'preparing' : 'missing',
      progress: busy && total > 0 ? received / total : null,
      verifying,
      error: busy ? null : (failed?.error ?? null),
    };
  }

  /** Ayarlar › Ses: her motorun bu cihazda konuşup konuşamayacağı ve nedeni. */
  function ttsEngines(): TtsEnginesReport {
    const policy = deps.policy.get();
    const settings = deps.settings.get();
    const current = selection();
    const active = ttsActive();
    const live = hostInfo();
    const engines = TTS_ENGINE_IDS.map((id): TtsEngineStatus => {
      const info = TTS_ENGINES[id];
      const voice = voiceFor(id, policy, settings);
      const base = {
        id,
        label: t(info.label),
        hint: t(info.hint),
        voices: info.voices.map((item) => ({ id: item.id, label: t(item.label) })),
        voice,
      };
      if (info.kind === 'host') {
        const engineId = id as TtsHostEngineId;
        // İlk çalışacak cihaz: çalışma zamanı hazır olan ilk halka; hiçbiri yoksa zincirin başı (inmesi beklenen).
        const usable = info.devices.filter((device) => ttsRuntimeDir(device) !== null);
        // Model + (hiçbir cihazın çalışma zamanı yoksa) CUDA çalışma zamanı birlikte: tek ilerleme, tek boyut.
        const all = filesOf(hostModelIds(engineId));
        const model = filesOf(info.model ? [info.model] : []);
        const { files, progress } = all;
        const running = live?.engine === engineId;
        const issue = hostIssue.get(engineId) ?? null;
        /** İndirme yapılabilir mi (Gizli kipte ağa çıkılmaz). */
        const online = deps.policy.networkAllowed();
        const failed = hostState?.engine === engineId && hostState.phase === 'failed' && !hostState.missingFiles;
        const starting = hostState?.engine === engineId && hostState.phase === 'starting';
        // Seçili ama konak öteki motorla çalışıyor: dosyalar hazırsa "yükleniyor" (konak birazdan geçer).
        const switching = current.engine === engineId && !running && files === 'ready' && !issue && !failed && live !== null;
        const available = files === 'ready' && workerReady && !failed && !issue && options.gpuTts !== false;
        const reason =
          files === 'preparing'
            ? all.verifying
              ? t('tts.reason.verifying')
              : t('tts.reason.downloading', { pct: Math.round((progress ?? 0) * 100) })
            : files === 'missing'
              ? all.error
                ? t('tts.reason.downloadFailed', { detail: all.error })
                : !online
                  ? t('tts.reason.privateNoDownload')
                  : model.files === 'ready'
                    ? t('tts.reason.noRuntime')
                    : t('tts.reason.missingFiles')
              : issue
                ? t('tts.reason.loadFailed', { detail: issue })
                : failed
                  ? t('tts.reason.hostFailed', { detail: hostState?.reason ?? '' })
                  : !workerReady
                    ? t('tts.reason.workerDown')
                    : starting || switching
                      ? t('tts.reason.starting')
                      : running && hostState && hostState.attempts.length > 0
                        ? isGpuDevice(live?.device)
                          ? t('tts.reason.cudaFailed')
                          : t('tts.reason.gpuFailed')
                        : null;
        const state: TtsEngineStatus['state'] =
          files === 'preparing'
            ? all.verifying
              ? 'verifying'
              : 'downloading'
            : files === 'missing'
              ? all.error
                ? 'failed'
                : 'missing'
              : issue || failed
                ? 'failed'
                : !workerReady || options.gpuTts === false
                  ? 'unavailable'
                  : active === engineId
                    ? 'speaking'
                    : starting || switching
                      ? 'loading'
                      : 'ready';
        return {
          ...base,
          available,
          reason,
          files,
          progress,
          device: running ? (live?.device ?? null) : (usable[0] ?? info.devices[0] ?? null),
          running,
          previewable: available && session.status().ready,
          state,
          bytes: { received: all.received, total: all.total },
          // Gizli kipte indirme yapılmaz: düğme sunulmaz, neden satırda yazar. Yükleme hatası ağ gerektirmez.
          canPrepare: options.gpuTts !== false && (state === 'missing' || state === 'failed') && (online || files === 'ready'),
        };
      }
      if (info.kind === 'piper') {
        const state = filesOf([LOCAL_MODEL_IDS.piper, LOCAL_MODEL_IDS.piperVoice]);
        const available = workerReady && workerInfo.piper;
        return {
          ...base,
          available,
          reason: available ? null : state.files === 'ready' ? t('tts.reason.workerDown') : t('tts.reason.piperMissing'),
          files: state.files,
          progress: state.progress,
          device: 'cpu',
          running: available,
          previewable: available && session.status().ready,
          state: !available ? (state.files === 'preparing' ? 'downloading' : state.files === 'missing' ? 'missing' : 'unavailable') : active === id ? 'speaking' : 'ready',
          bytes: { received: state.received, total: state.total },
          canPrepare: false,
        };
      }
      const hasKey = ttsSettings.elevenlabs !== null;
      const usable = hasKey && cloudUsable();
      return {
        ...base,
        available: usable,
        reason: !hasKey ? t('tts.reason.noKey') : usable ? null : (ttsFallback?.message ?? null),
        files: 'none',
        progress: null,
        device: 'cloud',
        running: usable,
        previewable: usable && workerReady && session.status().ready,
        state: !usable ? 'unavailable' : active === id ? 'speaking' : 'ready',
        bytes: null,
        canPrepare: false,
      };
    });
    const selected = engines.find((engine) => engine.id === current.engine);
    return {
      selected: current.engine,
      source: current.source,
      policy: policy.voice.tts.provider,
      active,
      activeDevice: ttsActiveDevice(),
      note: active === current.engine ? null : (selected?.reason ?? (current.engine === 'elevenlabs' ? fallbackMessage('no_key') : null)),
      engines,
    };
  }

  function ttsPrepare(engine: TtsEngineId): TtsEnginesReport {
    if (isTtsHostEngine(engine)) prepareEngine(engine, true);
    return ttsEngines();
  }

  function ttsCancelPrepare(): TtsEnginesReport {
    deps.models.cancel();
    return ttsEngines();
  }

  /** Ses konağı verilen motorla hazır olana (ya da açılamadığı anlaşılana) dek bekler. */
  async function waitHost(engine: TtsHostEngineId, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = hostInfo();
      if (info) return true;
      if (hostState?.engine === engine && hostState.phase === 'failed') return false;
      await sleep(100);
    }
    return false;
  }

  /**
   * "Dinle": örnek cümleyi verilen motor ve sesle okur. Olağan çalma yolundan geçer (ses penceresi, yankı gidericinin
   * referansı): kullanıcı örneği dinlerken konuşursa söz kesme olağan çalışır. Motor hazır değilse çalmaz, nedenini
   * söyler; başka bir motora düşmez (kullanıcı hangi sesi dinlediğini bilmelidir).
   */
  async function ttsPreview(engine: TtsEngineId, voice?: string): Promise<TtsPreviewResult> {
    const failed = (message: string): TtsPreviewResult => ({ ok: false, engine: null, device: null, message });
    const status = session.status();
    if (!TTS_ENGINE_IDS.includes(engine)) return failed(t('common.unknownError'));
    if (!status.ready || !workerReady) return failed(t('tts.settings.previewNotReady'));
    if (status.quiet) return failed(t('tts.settings.previewQuiet'));
    // Toplantıda hoparlörden örnek çalınmaz (karşı tarafa ve döküme karışır).
    if (status.meeting?.on) return failed(t('tts.settings.previewMeeting'));
    if (activeTest || preview || previewOverride || status.state === 'speaking' || status.state === 'thinking' || status.state === 'listening') {
      return failed(t('tts.settings.previewBusy'));
    }
    const chosen = voice ?? voiceFor(engine, deps.policy.get(), deps.settings.get()) ?? undefined;
    const report = ttsEngines().engines.find((item) => item.id === engine);
    if (report && report.files !== 'ready' && report.files !== 'none') return failed(report.reason ?? t('tts.reason.missingFiles'));
    try {
      if (isTtsHostEngine(engine)) {
        // Konak kapalıysa (Piper ya da bulut seçili) bu motorla açılır; açıksa motor konağın içinde o an yüklenir.
        if (!hostInfo()) {
          preview = { engine, voice: chosen ?? '' };
          syncHost();
          if (!(await waitHost(engine, 30_000))) return failed(hostState?.reason ? t('tts.reason.hostFailed', { detail: hostState.reason }) : t('tts.reason.starting'));
        }
      } else if (engine === 'elevenlabs' && !cloudUsable()) {
        return failed(ttsSettings.elevenlabs === null ? t('tts.reason.noKey') : (ttsFallback?.message ?? t('common.unknownError')));
      } else if (engine === 'piper-local' && !workerInfo.piper) {
        return failed(t('tts.reason.piperMissing'));
      }
      // Konak, dinlenecek motorun klasörünü başlarken almamış olabilir (dosyalar sonradan hazır oldu): şimdi bildirilir.
      if (isTtsHostEngine(engine)) ttsHost.enginesChanged();
      previewOverride = { engine, ...(chosen ? { voice: chosen } : {}) };
      previewError = null;
      const mark = sentences.length > 0 ? sentences[sentences.length - 1] : null;
      const result = await session.speak(t('tts.settings.previewSample'));
      const last = sentences.length > 0 ? sentences[sentences.length - 1] : null;
      if (!result.spoken || !last || last === mark) {
        // Gerçek neden yazılır: motorun hatası, hattın o an hazır olmaması ya da cümlenin hiç üretilmemesi.
        const now = session.status();
        const why = previewError ?? (!now.ready ? (now.notReadyReason ?? t('tts.settings.previewNotReady')) : t('tts.settings.previewSilent', { engine: engineLabel(engine) }));
        log.warn(`"Dinle" çalınamadı (${engine}${chosen ? ` / ${chosen}` : ''}): ${why}`);
        return failed(t('tts.settings.previewFailed', { reason: why }));
      }
      // Örnek başka bir motorla okunduysa (olmamalı) bunu "çalındı" diye sunma.
      if (last.engine !== engine) return failed(t('tts.settings.previewOther', { engine: engineLabel(last.engine) }));
      return { ok: true, engine: last.engine, device: last.device, message: null };
    } finally {
      previewOverride = null;
      if (preview) {
        preview = null;
        syncHost();
      } else if (isTtsHostEngine(engine) && hostState?.phase === 'ready' && hostState.engine && hostState.voice && hostState.engine !== engine) {
        // Dinlenen motor konağa fazladan yüklendi: seçili motor yeniden seçilir, öteki bırakılır (ekran belleği boşalır).
        ttsHost.reselect();
      }
    }
  }

  // ───────────────────────────── toplantı kipi ─────────────────────────────

  /**
   * Bilgisayar sesini ("Karşı taraf") açar. Gerçek kipte ses penceresi `getDisplayMedia` ister ve işleyici yalnız bu
   * istekten sonraki kısa pencerede Windows loopback verir. Sınama kipinde gerçek ses HİÇ yakalanmaz: pencere sınama
   * kancasının verdiği sesi kullanır (`window.fuberAudio.playSystem`).
   */
  function startSystem(): void {
    session.setMeetingSystem('starting');
    send({ type: 'system', on: true });
    if (testing.enabled && !testing.realLoopback) {
      sendAudio({ type: 'system.start', fake: true });
      return;
    }
    void import('electron')
      .then(({ session: electronSession }) => {
        installSystemAudioHandler(electronSession.defaultSession, log);
        allowSystemAudioRequest();
        if (wantSystem) sendAudio({ type: 'system.start' });
      })
      .catch((error: unknown) => {
        log.warn('bilgisayar sesi işleyicisi kurulamadı', error);
        session.setMeetingSystem('error', t('meeting.system.failed'));
      });
  }

  function setMeeting(options: { on: boolean; system?: boolean; systemLanguage?: string }): void {
    session.setMeeting(options.on, options.systemLanguage ? { systemLanguage: options.systemLanguage } : {});
    const nextSystem = options.on && options.system !== false;
    if (nextSystem === wantSystem) return;
    wantSystem = nextSystem;
    if (nextSystem) {
      systemRestarts = [];
      startSystem();
    }
    else {
      send({ type: 'system', on: false });
      sendAudio({ type: 'system.stop' });
      session.setMeetingSystem('off');
    }
  }

  // ───────────────────────────── yaşam döngüsü ─────────────────────────────

  return {
    async start() {
      stopped = false;
      subscriptions.push(
        audioReports.subscribe(onAudioReport),
        deps.bus.on('hotkey.pressed', ({ id }) => {
          if (id === 'talk') startListening('hotkey');
          else if (id === 'mute') {
            if (session.status().micMuted) {
              session.unmuteMic();
              if (realtime.active()) realtime.setMicMuted(false);
            } else {
              session.muteMic();
              if (realtime.active()) realtime.setMicMuted(true);
            }
          }
        }),
        deps.bus.on('app.panic', () => {
          if (realtime.active()) realtime.hush();
          session.cancelTurn('panic');
        }),
        deps.bus.on('policy.changed', () => {
          session.refreshPolicy();
          refreshTts();
          syncHost();
          prepareSelected();
          // Ses motoru değişti (cascade ↔ gerçek zamanlı) ya da persona/model/ses değişti: motoru aç/kapat/yeniden kur.
          if (realtimeOn() && realtime.active()) realtime.reconfigure();
          else syncRealtime();
          const persona = deps.policy.get().persona;
          // Uyandırma sözü değiştiyse sezici yeni sözle yeniden kurulur.
          if (booted && JSON.stringify(persona.wakePhrases) !== workerPhrases) {
            workerReady = false;
            worker.restart(workerConfig());
            updateReadiness();
          }
        }),
        deps.bus.on('settings.changed', ({ changedKeys }) => {
          if (changedKeys.includes('inputDeviceId') && wantListen) startCapture();
          if (changedKeys.includes('outputDeviceId')) {
            sendAudio({ type: 'output.set', deviceId: deps.settings.get().outputDeviceId });
          }
          // Ses motoru ya da sesi bu cihazda değişti (Ayarlar › Ses): yeniden başlatmadan uygulanır.
          if (changedKeys.includes('ttsEngine') || changedKeys.includes('ttsVoices')) {
            refreshTts();
            syncHost();
            // Seçilen motorun dosyaları bu bilgisayarda yoksa indirme başlar; bitince kendiliğinden o motora geçilir.
            // Kullanıcı aynı motoru yeniden seçtiyse bu bir "yeniden dene"dir (yükleme hatası kaydı silinir).
            const chosen = selection().engine;
            if (changedKeys.includes('ttsEngine') && isTtsHostEngine(chosen)) prepareEngine(chosen, hostIssue.has(chosen));
            updateReadiness();
          }
        }),
        deps.bus.on('voice.wake', ({ path: wakePath, phrase, score, at }) => {
          lastWake = { path: wakePath, phrase, score, at };
        }),
        deps.bus.on('attention.notify', ({ notification, channel }) => {
          if (channel === 'voice' && notification.speak) void speak(notification.speak);
        }),
        deps.bus.on('tool.approval.request', (request) => session.onApprovalRequest(request.id, request.summary, request.ask)),
        deps.bus.on('tool.approval.resolve', ({ id }) => session.onApprovalResolved(id)),
        // Modeller sonradan hazırlanırsa (kurulum sihirbazı) hat o zaman kurulur.
        deps.bus.on('setup.modelProgress', (progress) => {
          if (progress.status !== 'ready') return;
          if (!booted) return void boot();
          // Yerel sesin dosyaları sonradan hazır oldu (indirme bitti): açılamayan konak yeniden denenir; CUDA
          // çalışma zamanı geldiyse ve konak daha alt bir cihazda çalışıyorsa zincir baştan kurulur.
          if (progress.role !== 'tts') return;
          // Dosyaları yeniden hazırlanan motorun eski yükleme hatası geçersizdir.
          for (const id of TTS_HOST_ENGINE_IDS) if (TTS_ENGINES[id].model === progress.id) hostIssue.delete(id);
          if (progress.id === TTS_MODEL_IDS.runtimeCuda && hostState?.phase === 'ready' && hostState.device !== 'cuda') ttsHost.restart();
          else ttsHost.retry();
          syncHost();
        }),
        deps.bus.on('window.changed', ({ kind, open }) => {
          if (kind !== 'audio' || open || stopped || !booted) return;
          // Ses penceresi kapandı ya da çöktü: yeniden açılır, işçiye yeni port verilir.
          audioReady = false;
          capturing = false;
          updateReadiness();
          void deps.windows
            .ensure('audio')
            .then(() => worker.renewPort())
            .catch((error: unknown) => log.error('ses penceresi yeniden açılamadı', error));
        }),
      );
      captureRetry = setInterval(() => {
        // Mikrofon takılınca ya da izin verilince hat kendiliğinden geri gelsin.
        if (captureError && audioReady && !session.status().micMuted) startCapture();
      }, CAPTURE_RETRY_MS);
      await boot();
    },

    async stop() {
      stopped = true;
      realtime.stop();
      for (const item of heldSpeech.splice(0)) {
        clearTimeout(item.timer);
        item.resolve({ spoken: false });
      }
      if (captureRetry) clearInterval(captureRetry);
      for (const off of subscriptions.splice(0)) off();
      session.dispose();
      if (wantSystem) sendAudio({ type: 'system.stop' });
      wantSystem = false;
      sendAudio({ type: 'capture.stop' });
      ttsHost.stop();
      worker.stop();
      await stt?.stop();
    },

    status: () => session.status(),
    startListening,
    stopSpeaking: () => {
      if (realtime.active()) realtime.hush();
      session.stopSpeaking();
    },
    hush: () => {
      if (realtime.active()) realtime.hush();
      session.hush();
    },
    retry: () => session.retryLast(),
    activity: () => session.activity(),
    cancelTurn: () => {
      if (realtime.active()) realtime.hush();
      session.cancelTurn('api');
    },
    muteMic: (muteOptions) => {
      session.muteMic(muteOptions);
      if (realtime.active()) realtime.setMicMuted(true);
    },
    unmuteMic: () => {
      session.unmuteMic();
      if (realtime.active()) realtime.setMicMuted(false);
    },
    pauseWake: (minutes) => session.pauseWake(minutes),
    resumeWake: () => session.resumeWake(),
    setQuiet: (on) => session.setQuiet(on),
    setAmbient: (enabled) => session.setAmbient(enabled),
    setMeeting,
    startConversation: () => session.startConversation(),
    endConversation: () => session.endConversation(),
    speak,
    testMic,
    testWake,
    calibrateWake,
    echoTest,

    setSttVocabulary(words) {
      sttVocabulary = words;
      stt?.setVocabulary(words);
    },

    diagnostics,
    diagnosticsReport,
    bargeInTest,
    ttsEngines,
    ttsPreview,
    ttsPrepare,
    ttsCancelPrepare,
  };
}
