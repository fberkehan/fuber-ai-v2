/**
 * Mikrofon yakalama: getUserMedia (yankı engelleme, gürültü bastırma, otomatik kazanç açık) → 16 kHz
 * AudioContext → AudioWorklet → 20 ms Int16 çerçeve. Kapatma gerçektir: iz durdurulur ve akış bırakılır;
 * işletim sisteminin mikrofon göstergesi söner. Yeniden açmak yeni bir akış ister.
 *
 * Aygıt değişimi (kulaklık takıldı/çıkarıldı) burada, ana sürece sormadan karşılanır:
 * - Seçili aygıt çıkarıldı (iz bitti) → hemen yeniden bağlanılır; aygıt yoksa sistem varsayılanına düşülür.
 * - Sistem varsayılanı kullanılırken varsayılan değişti → yeni varsayılana geçilir (Chromium kendiliğinden geçmez).
 * - Mikrofon yokken biri takıldı → yakalama kendiliğinden başlar.
 * Her durumda ana süreç `capture.started` (yeni aygıt adı) ya da `capture.error` raporu alır.
 */

import { AUDIO_SAMPLE_RATE, t, type AudioReport, type CaptureProcessing, type EchoCancellationMode } from '@fuber/shared';
import type { CaptureFrameMessage } from './capture-worklet';
import workletUrl from './capture-worklet.ts?worker&url';
import type { EchoFrameInfo } from './echo-canceller';

type CaptureError = Extract<AudioReport, { type: 'capture.error' }>;

export interface CaptureSnapshot {
  capturing: boolean;
  /** Şu anki izin durumu; iz yoksa `null`. */
  trackState: MediaStreamTrackState | null;
  /** En son kapatılan izin durumu (`ended` olmalı); hiç kapatılmadıysa `null`. */
  lastStoppedTrackState: MediaStreamTrackState | null;
  deviceLabel: string | null;
  /** Tarayıcının açık ize uyguladığı ses işleme; iz yoksa `null`. */
  processing: CaptureProcessing | null;
  frames: number;
  /** Aygıt değişimi yüzünden kaç kez yeniden bağlanıldı. */
  reconnects: number;
  /** Seçili aygıt bulunamadığı için sistem varsayılanına düşüldü mü. */
  fellBackToDefault: boolean;
}

/** Aygıt listesi değiştikten sonra işletim sisteminin yerleşmesi için beklenen süre. */
const DEVICE_CHANGE_SETTLE_MS = 400;

function classify(error: unknown): CaptureError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { type: 'capture.error', code: 'permission', message: t('voice.mic.error.permission') };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { type: 'capture.error', code: 'no_device', message: t('voice.mic.error.noDevice') };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return { type: 'capture.error', code: 'in_use', message: t('voice.mic.error.inUse') };
  }
  return { type: 'capture.error', code: 'unknown', message: t('voice.mic.error.unknown') };
}

export class Capture {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private lastStoppedTrack: MediaStreamTrack | null = null;
  private context: AudioContext | null = null;
  private frames = 0;
  /** Art arda gelen başlat/durdur komutlarında yalnız sonuncusu geçerli olsun diye. */
  private generation = 0;
  /** Ana sürecin istediği yakalama; `null` = mikrofon kapalı istendi. */
  private wanted: { deviceId: string | null } | null = null;
  private node: AudioWorkletNode | null = null;
  private reconnects = 0;
  private fellBackToDefault = false;
  private settleTimer: number | null = null;
  /** Sınama: oynatılan sesin mikrofona karıştırılması (yankı benzetimi). */
  private loopback: {
    stream: MediaStream;
    gain: number;
    delayMs: number;
    nodes: AudioNode[];
    cancelledBy: EchoCancellationMode | null;
    shape: 'linear' | 'bluetooth';
  } | null = null;
  /** İstenen yankı engelleme kipi ve tarayıcının açık ize gerçekten uyguladığı işleme. */
  private echoMode: EchoCancellationMode = 'default';
  private processing: CaptureProcessing | null = null;
  /** Jarvis'in çaldığı sesin kopyası: yankı gidericinin referansı (işleyicinin ikinci girişi). */
  private reference: { stream: MediaStream; node: AudioNode | null } | null = null;
  private echoGate: number | null = null;
  private referenceOff = false;

  constructor(
    private readonly onFrame: (pcm: Int16Array, echo: EchoFrameInfo | null) => void,
    private readonly report: (report: AudioReport) => void,
  ) {
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.onDeviceChange());
  }

  /** Aygıt listesi değişti. Olaylar peş peşe gelir; yerleşince bir kez bakılır. */
  private onDeviceChange(): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      void this.reconcileDevices();
    }, DEVICE_CHANGE_SETTLE_MS);
  }

  private async reconcileDevices(): Promise<void> {
    const wanted = this.wanted;
    if (!wanted) return;
    if (!this.track) {
      // Mikrofon yoktu ya da açılamamıştı: yeni takılan aygıtla yeniden denenir.
      this.reconnects++;
      await this.start(wanted.deviceId);
      return;
    }
    if (wanted.deviceId !== null && !this.fellBackToDefault) return;
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === 'audioinput');
      // Seçili aygıt yokken varsayılana düşülmüştü; aygıt geri geldiyse ona dönülür.
      if (wanted.deviceId !== null) {
        if (inputs.some((item) => item.deviceId === wanted.deviceId)) {
          this.reconnects++;
          await this.start(wanted.deviceId);
        }
        return;
      }
      const current = inputs.find((item) => item.deviceId === 'default') ?? inputs[0];
      if (current && current.label && current.label !== this.track.label) {
        // Sistem varsayılanı başka bir aygıt oldu (kulaklık takıldı): açık iz eski aygıtta kalır, yenisine geçilir.
        this.reconnects++;
        await this.start(null);
      }
    } catch {
      // Liste alınamadıysa açık iz olduğu gibi kalır.
    }
  }

  /**
   * `lost`: açık aygıt koptuğu için yeniden bağlanılıyor; başarısız olursa "bağlantı kesildi" bildirilir.
   * `echoMode` verilmezse son istenen kip sürer.
   */
  async start(deviceId: string | null, lost = false, echoMode?: EchoCancellationMode): Promise<void> {
    if (echoMode) this.echoMode = echoMode;
    this.wanted = { deviceId };
    const generation = ++this.generation;
    this.release();
    try {
      // `all`: sistemde çalan bütün ses bastırılır (Chromium 141+). Kip adı `lib.dom` tiplerinde henüz yok.
      const constraints = (id: string | null, mode: EchoCancellationMode): MediaStreamConstraints => ({
        audio: {
          deviceId: id ? { exact: id } : undefined,
          echoCancellation: mode === 'all' ? ('all' as unknown as boolean) : true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      const open = async (id: string | null): Promise<MediaStream> => {
        if (this.echoMode === 'default') return navigator.mediaDevices.getUserMedia(constraints(id, 'default'));
        try {
          return await navigator.mediaDevices.getUserMedia(constraints(id, this.echoMode));
        } catch (error) {
          // Kip bu aygıtta ya da bu tarayıcıda yoksa olağan kiple açılır; uygulanan kip raporda görünür.
          const name = error instanceof DOMException ? error.name : error instanceof TypeError ? 'TypeError' : '';
          if (name !== 'OverconstrainedError' && name !== 'TypeError') throw error;
          return navigator.mediaDevices.getUserMedia(constraints(id, 'default'));
        }
      };
      let stream: MediaStream;
      this.fellBackToDefault = false;
      try {
        stream = await open(deviceId);
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        if (deviceId === null || (name !== 'NotFoundError' && name !== 'OverconstrainedError')) throw error;
        // Seçili aygıt yok (çıkarılmış): kullanıcı sessiz kalmasın diye sistem varsayılanıyla sürdürülür.
        stream = await open(null);
        this.fellBackToDefault = true;
      }
      const track = stream.getAudioTracks()[0];
      if (generation !== this.generation || !track) {
        for (const item of stream.getTracks()) item.stop();
        if (!track) this.report({ type: 'capture.error', code: 'no_device', message: t('voice.mic.error.noDevice') });
        return;
      }

      // 16 kHz bağlam: yeniden örneklemeyi Chromium yapar; işleyiciye hattın biçimi doğrudan gelir.
      const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE, latencyHint: 'interactive' });
      await context.audioWorklet.addModule(workletUrl);
      if (generation !== this.generation) {
        track.stop();
        void context.close();
        return;
      }
      const node = new AudioWorkletNode(context, 'fuber-capture', { numberOfInputs: 2, numberOfOutputs: 0 });
      node.port.onmessage = (event: MessageEvent<CaptureFrameMessage>) => {
        this.frames++;
        this.onFrame(new Int16Array(event.data.pcm), event.data.echo ?? null);
      };
      if (this.echoGate !== null) node.port.postMessage({ gate: this.echoGate });
      context.createMediaStreamSource(stream).connect(node, 0, 0);
      await context.resume();

      track.onended = () => {
        // Aygıt çıkarıldı ya da işletim sistemi izni geri aldı: hemen yeniden bağlanılır (başka aygıt varsa ona).
        // Yeniden bağlanma tutarsa ana süreç yalnız yeni aygıtın adını görür; tutmazsa "bağlantı kesildi" bildirilir.
        if (this.track !== track) return;
        const wanted = this.wanted;
        this.release();
        if (!wanted) {
          this.report({ type: 'capture.error', code: 'no_device', message: t('voice.mic.error.disconnected') });
          return;
        }
        this.reconnects++;
        void this.start(wanted.deviceId, true);
      };

      const settings = track.getSettings() as MediaTrackSettings & { echoCancellation?: boolean | string };
      this.processing = {
        echoCancellation: String(settings.echoCancellation ?? 'unknown'),
        noiseSuppression: settings.noiseSuppression ?? null,
        autoGainControl: settings.autoGainControl ?? null,
      };
      this.stream = stream;
      this.track = track;
      this.context = context;
      this.node = node;
      this.attachReference();
      this.attachLoopback();
      this.report({ type: 'capture.started', deviceLabel: track.label, sampleRate: context.sampleRate, processing: this.processing });
    } catch (error) {
      if (generation !== this.generation) return;
      this.release();
      const failure = classify(error);
      this.report(lost && failure.code === 'no_device' ? { ...failure, message: t('voice.mic.error.disconnected') } : failure);
    }
  }

  stop(): void {
    this.wanted = null;
    this.generation++;
    const wasCapturing = this.track !== null;
    this.release();
    if (wasCapturing) this.report({ type: 'capture.stopped' });
  }

  private release(): void {
    if (this.track) {
      this.track.onended = null;
      this.track.stop();
      this.lastStoppedTrack = this.track;
    }
    for (const item of this.stream?.getTracks() ?? []) item.stop();
    void this.context?.close();
    this.stream = null;
    this.track = null;
    this.context = null;
    this.node = null;
    if (this.loopback) this.loopback.nodes = [];
    if (this.reference) this.reference.node = null;
  }

  /** Yankı gidericinin referansı: oynatmanın çıkışından alınan akış (ses penceresi açılırken bir kez verilir). */
  setReference(stream: MediaStream): void {
    this.reference?.node?.disconnect();
    this.reference = { stream, node: null };
    this.attachReference();
  }

  private attachReference(): void {
    const reference = this.reference;
    if (!reference || !this.context || !this.node || reference.node || this.referenceOff) return;
    const source = this.context.createMediaStreamSource(reference.stream);
    source.connect(this.node, 0, 1);
    reference.node = source;
  }

  /**
   * Sınama yüzeyi: referansı keser / geri bağlar. Referanssız kalan giderici yankıyı bastıramaz: Jarvis'in sesini
   * ayırt edemediği bir cihazı benzetir (`scripts/e2e/voice.mjs` yankı sınaması).
   */
  setReferenceEnabled(on: boolean): void {
    const reference = this.reference;
    if (!reference) return;
    reference.node?.disconnect();
    reference.node = null;
    this.referenceOff = !on;
    this.attachReference();
  }

  /** Yankı gidericinin düzey kapısı (söz kesme sınaması cihaza göre ayarlar). */
  setEchoGate(gate: number): void {
    this.echoGate = gate;
    this.node?.port.postMessage({ gate });
  }

  /**
   * Sınama yüzeyi: oynatılan sesi `gain` kazancıyla ve `delayMs` gecikmeyle mikrofon yoluna karıştırır; yankı
   * engellemenin hiç çalışmadığı bir hoparlörü benzetir (`scripts/e2e/voice.mjs`: yankı sınamasının "sızıyor" yolu
   * ve "kendi sesini duyma" adımı). Gecikme, hoparlör tamponu ile odanın toplamıdır. `stream: null` kapatır.
   * `cancelledBy`: bu yankı engelleme kipi uygulanmışken sızıntı karıştırılmaz (o kipin sızıntıyı giderdiği cihaz).
   */
  setLoopback(stream: MediaStream | null, gain = 1, delayMs = 0, cancelledBy: EchoCancellationMode | null = null, shape: 'linear' | 'bluetooth' = 'linear'): void {
    for (const item of this.loopback?.nodes ?? []) item.disconnect();
    this.loopback = stream ? { stream, gain, delayMs, nodes: [], cancelledBy, shape } : null;
    this.attachLoopback();
  }

  private attachLoopback(): void {
    const loopback = this.loopback;
    if (!loopback || !this.context || !this.node) return;
    if (loopback.cancelledBy !== null && this.processing?.echoCancellation === loopback.cancelledBy) return;
    const source = this.context.createMediaStreamSource(loopback.stream);
    const gain = this.context.createGain();
    gain.gain.value = loopback.gain;
    if (loopback.shape === 'bluetooth') {
      // Bluetooth hoparlör benzetimi (ölçülen bir cihaz): doğrusal olmayan sürücü (yumuşak kırpma), dar bant ve KAYAN
      // gecikme (±12 ms, 0,4 Hz). Doğrusal yankı giderici bunu yakınsayamaz (gerçek cihazda ölçülen 0–3 dB), zarf
      // ilintisi ise yüksek kalır: tam olarak ölçülen cihazda görülen "ilinti 0,93, giderici öğrenemedi" durumu.
      const context = this.context;
      const shaper = context.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(3 * ((i / (curve.length - 1)) * 2 - 1)) / Math.tanh(3);
      shaper.curve = curve;
      const band = context.createBiquadFilter();
      band.type = 'lowpass';
      band.frequency.value = 3800;
      const delay = context.createDelay(2);
      delay.delayTime.value = Math.max(0.02, loopback.delayMs / 1000);
      const wobble = context.createOscillator();
      wobble.frequency.value = 0.4;
      const depth = context.createGain();
      depth.gain.value = 0.012;
      wobble.connect(depth).connect(delay.delayTime);
      wobble.start();
      source.connect(shaper).connect(band).connect(delay).connect(gain).connect(this.node, 0, 0);
      loopback.nodes = [source, shaper, band, delay, gain, wobble, depth];
      return;
    }
    if (loopback.delayMs > 0) {
      const delay = this.context.createDelay(2);
      delay.delayTime.value = loopback.delayMs / 1000;
      source.connect(delay).connect(gain).connect(this.node, 0, 0);
      loopback.nodes = [source, delay, gain];
      return;
    }
    source.connect(gain).connect(this.node, 0, 0);
    loopback.nodes = [source, gain];
  }

  /** Sınama yüzeyi: açık iz (aygıtın çıkarılması `ended` olayıyla benzetilir). */
  debugTrack(): MediaStreamTrack | null {
    return this.track;
  }

  snapshot(): CaptureSnapshot {
    return {
      capturing: this.track !== null,
      trackState: this.track?.readyState ?? null,
      lastStoppedTrackState: this.lastStoppedTrack?.readyState ?? null,
      deviceLabel: this.track?.label ?? null,
      processing: this.track ? this.processing : null,
      frames: this.frames,
      reconnects: this.reconnects,
      fellBackToDefault: this.fellBackToDefault,
    };
  }
}
