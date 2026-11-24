/**
 * Toplantı kipinin "Karşı taraf" kaynağı: bilgisayarın sesi. `getDisplayMedia` (ana süreç Windows loopback verir:
 * `main/voice/system-audio.ts`) → görüntü izi hemen durur → 16 kHz AudioContext → işleyici → 20 ms Int16 çerçeve →
 * ses işçisine `system_frame`. Çıkış yoktur (işleyicinin çıkışı bağlı değil): yakalanan ses yeniden çalınmaz.
 *
 * Sınama kipinde (`fake`) gerçek ses HİÇ istenmez: kaynak, sınama kancasının verdiği PCM'i çalan bir ses düğümüdür
 * (`playSystem`). Aynı işleyici ve aynı port yolu kullanılır; yalnız `getDisplayMedia` sınanmamış kalır.
 */
import { AUDIO_SAMPLE_RATE, t, type AudioReport } from '@fuber/shared';
import workletUrl from './system-worklet.ts?worker&url';

type SystemError = Extract<AudioReport, { type: 'system.error' }>;

export interface SystemSnapshot {
  capturing: boolean;
  fake: boolean;
  frames: number;
  trackState: MediaStreamTrackState | null;
}

function classify(error: unknown): SystemError {
  const name = error instanceof DOMException ? error.name : (error as { name?: string } | null)?.name ?? '';
  const detail = `${name || 'Error'}: ${String((error as { message?: unknown } | null)?.message ?? error).slice(0, 200)}`;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'AbortError') {
    return { type: 'system.error', code: 'denied', message: t('meeting.system.denied'), detail };
  }
  if (name === 'NoAudioTrack') return { type: 'system.error', code: 'no_audio', message: t('meeting.system.noAudio'), detail };
  return { type: 'system.error', code: 'unknown', message: t('meeting.system.failed'), detail };
}

/** Aygıt listesi değiştikten sonra yerleşme beklemesi (Bluetooth profili değişirken olaylar peş peşe gelir). */
const DEVICE_CHANGE_SETTLE_MS = 600;

export class SystemCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private generation = 0;
  private frames = 0;
  private fake = false;
  /** Sınama: çalınan PCM'in gittiği düğüm ve aynı sesin akışı (mikrofona sızıntı benzetimi için). */
  private fakeInput: { node: GainNode; output: MediaStreamAudioDestinationNode } | null = null;

  /** Yakalama açılırken çıkış aygıtlarının özeti: değişirse (Bluetooth bağlandı/koptu) yakalama yeniden açılır. */
  private outputs: string | null = null;
  private settleTimer: number | null = null;

  constructor(
    private readonly onFrame: (pcm: Int16Array) => void,
    private readonly report: (report: AudioReport) => void,
  ) {
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.onDeviceChange());
  }

  /** Çıkış aygıtlarının (ve varsayılanın) özeti; alınamazsa `null`. */
  private async outputSignature(): Promise<string | null> {
    try {
      const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === 'audiooutput');
      return outputs.map((item) => `${item.deviceId}:${item.label}`).join('|');
    } catch {
      return null;
    }
  }

  /**
   * Windows loopback, yakalama açıldığı andaki varsayılan çıkış aygıtına bağlıdır: Bluetooth hoparlör bağlanınca,
   * koptuğunda ya da eller serbest profiline (16 kHz) geçince eski aygıtı dinlemeye devam eder ve ses gelmez.
   * Çıkış listesi değişince ana sürece "yeniden aç" denir (istek yeniden onaylanır).
   */
  private onDeviceChange(): void {
    if (this.fake || !this.stream) return;
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      void this.outputSignature().then((signature) => {
        if (!this.stream || this.fake || signature === null || signature === this.outputs) return;
        this.outputs = signature;
        this.report({ type: 'system.restart', reason: 'device_changed' });
      });
    }, DEVICE_CHANGE_SETTLE_MS);
  }

  async start(fake: boolean): Promise<void> {
    const generation = ++this.generation;
    this.release();
    this.fake = fake;
    try {
      const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE, latencyHint: 'interactive' });
      await context.audioWorklet.addModule(workletUrl);
      if (generation !== this.generation) {
        void context.close();
        return;
      }
      const node = new AudioWorkletNode(context, 'fuber-system-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCountMode: 'max' });
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        this.frames++;
        this.onFrame(new Int16Array(event.data));
      };
      if (fake) {
        const input = context.createGain();
        const output = context.createMediaStreamDestination();
        input.connect(node);
        input.connect(output);
        this.fakeInput = { node: input, output };
      } else {
        // Chromium görüntüsüz `getDisplayMedia` kabul etmez; görüntü izi alınır alınmaz durdurulur. Ses işleme KAPALI:
        // loopback izinde Chromium varsayılan olarak yankı engelleme, gürültü bastırma ve kazanç denetimi açıyor
        // (ölçüldü: `getSettings()` üçü de true); karşı tarafın temiz sesini bozar ve gecikme ekler.
        const stream = await navigator.mediaDevices.getDisplayMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: { width: 1, height: 1, frameRate: 1 },
        });
        for (const track of stream.getVideoTracks()) {
          track.stop();
          stream.removeTrack(track);
        }
        const track = stream.getAudioTracks()[0];
        if (!track) {
          for (const item of stream.getTracks()) item.stop();
          throw Object.assign(new Error('paylaşımda ses izi yok'), { name: 'NoAudioTrack' });
        }
        if (generation !== this.generation) {
          track.stop();
          void context.close();
          return;
        }
        track.onended = () => {
          if (this.stream !== stream) return;
          this.release();
          // Aygıt koptu: önce bir kez yeniden açmayı dener (ana süreç ikinci kopmada hatayı gösterir).
          this.report({ type: 'system.restart', reason: 'ended' });
        };
        const outputs = await this.outputSignature();
        await context.resume();
        if (generation !== this.generation) {
          track.stop();
          void context.close();
          return;
        }
        context.createMediaStreamSource(stream).connect(node);
        this.stream = stream;
        this.outputs = outputs;
        const settings = track.getSettings();
        this.context = context;
        this.node = node;
        this.report({ type: 'system.started', label: track.label, ...(typeof settings.sampleRate === 'number' ? { trackRate: settings.sampleRate } : {}) });
        return;
      }
      await context.resume();
      this.context = context;
      this.node = node;
      this.report({ type: 'system.started' });
    } catch (error) {
      if (generation !== this.generation) return;
      this.release();
      this.report(classify(error));
    }
  }

  stop(): void {
    this.generation++;
    const was = this.context !== null;
    this.release();
    if (was) this.report({ type: 'system.stopped' });
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    this.node?.disconnect();
    void this.context?.close();
    this.stream = null;
    this.node = null;
    this.context = null;
    this.fakeInput = null;
  }

  /** Sınama kancası: PCM'i (16 kHz mono Int16) gerçek zamanlı olarak "bilgisayarın sesi" diye çalar. Gerçek kipte yok sayılır. */
  play(samples: ArrayLike<number>, sampleRate = AUDIO_SAMPLE_RATE): number {
    const context = this.context;
    const input = this.fakeInput;
    if (!this.fake || !context || !input || samples.length === 0) return 0;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = (samples[i] ?? 0) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(input.node);
    source.start();
    return Math.round((samples.length / sampleRate) * 1000);
  }

  /** Sınama: çalınan "bilgisayar sesi"nin akışı (hoparlörden mikrofona sızıntı benzetimi `Capture.setLoopback` ile). */
  fakeStream(): MediaStream | null {
    return this.fakeInput?.output.stream ?? null;
  }

  /** Sınama yüzeyi: gerçek kipteki ses izi (kopmanın `ended` olayıyla benzetilmesi için). */
  debugTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  snapshot(): SystemSnapshot {
    return {
      capturing: this.context !== null,
      fake: this.fake,
      frames: this.frames,
      trackState: this.stream?.getAudioTracks()[0]?.readyState ?? null,
    };
  }
}
