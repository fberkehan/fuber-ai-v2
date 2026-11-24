/**
 * Bilgisayar sesi işleyicisi (AudioWorklet; toplantı kipi): 16 kHz bağlamdan gelen blokları 20 ms'lik Int16 çerçevelere
 * toplar. Mikrofon işleyicisinden ayrıdır: yankı giderici ve referans yoktur (bilgisayarın sesi zaten temizdir).
 * Çerçeve boyutu `@fuber/shared` › `AUDIO_FRAME_SAMPLES` ile aynıdır (işleyici ayrı demet olduğu için buraya yazılı).
 */

declare const registerProcessor: (name: string, processor: unknown) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const FRAME_SAMPLES = 320;

class SystemCaptureProcessor extends AudioWorkletProcessor {
  private frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!channels || !first) return true;
    for (let i = 0; i < first.length; i++) {
      // Çok kanallı loopback (stereo) tek kanala indirilir.
      let sum = 0;
      for (const channel of channels) sum += channel[i] ?? 0;
      const sample = Math.max(-1, Math.min(1, sum / channels.length));
      this.frame[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === FRAME_SAMPLES) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('fuber-system-capture', SystemCaptureProcessor);
