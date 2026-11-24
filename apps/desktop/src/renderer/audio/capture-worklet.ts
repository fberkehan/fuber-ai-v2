/**
 * Yakalama işleyicisi (AudioWorklet): 16 kHz bağlamdan gelen 128 örneklik blokları 20 ms'lik Int16
 * çerçevelere toplar. Ses iş parçacığında koşar; ana iş parçacığı takılsa da örnek kaybolmaz.
 * Çerçeve boyutu `@fuber/shared` › `AUDIO_FRAME_SAMPLES` ile aynıdır (işleyici ayrı demet olduğu için buraya yazılı).
 *
 * İki giriş: 0 = mikrofon, 1 = referans (Jarvis'in o an çaldığı ses). Referanslı yankı giderici burada koşar
 * (`echo-canceller.ts`): çerçeve, yankısı çıkarılmış ses ve "kullanıcı konuşuyor mu" özetiyle birlikte gider.
 */

import { EchoCanceller, type EchoFrameInfo } from './echo-canceller';

declare const registerProcessor: (name: string, processor: unknown) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const FRAME_SAMPLES = 320;

/** İşleyicinin ana iş parçacığına yolladığı ileti. */
export interface CaptureFrameMessage {
  pcm: ArrayBuffer;
  echo: EchoFrameInfo;
}

class CaptureProcessor extends AudioWorkletProcessor {
  private frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;
  private readonly canceller = new EchoCanceller();
  private cleaned = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ gate?: number }>) => {
      if (typeof event.data?.gate === 'number') this.canceller.setGate(event.data.gate);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    if (this.cleaned.length !== channel.length) this.cleaned = new Float32Array(channel.length);
    this.canceller.process(channel, inputs[1]?.[0] ?? null, this.cleaned);
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, this.cleaned[i] ?? 0));
      this.frame[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === FRAME_SAMPLES) {
        const message: CaptureFrameMessage = { pcm: this.frame.buffer, echo: this.canceller.takeFrame() };
        // Aynı iş parçacığı ailesinde aktarım güvenlidir; işçiye giderken ayrıca kopyalanır.
        this.port.postMessage(message, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('fuber-capture', CaptureProcessor);
