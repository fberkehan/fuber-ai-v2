/**
 * Ses sinyali: hattan saniyede ~30 kez gelen düzey (RMS) karede yumuşatılır; hece başlangıcı darbesi ve ~0,55 sn'lik
 * geçmiş buradan türetilir. Varlığın her hareketi bu gerçek sinyale bağlıdır; sentetik dalga üretilmez.
 */
import { clamp } from './spring';

/** Konuşma düzeyi ≈ 0,02–0,2 RMS: yumuşak dizle 0..1'e taşınır. */
export const shapeLevel = (rms: number): number => clamp(Math.pow(Math.max(0, rms - 0.006) * 7.5, 0.72), 0, 1);

const HIST_STEP = 0.0172;

export class Signal {
  /** Hattan gelen son değer (biçimlenmiş, 0..1). */
  raw = 0;
  /** Yumuşatılmış düzey: çıkışta hızlı, inişte yavaş. */
  level = 0;
  /** Hece başlangıcı darbesi (0..1, hızla söner). */
  onset = 0;
  /** `hist[0]` en yeni; 32 örnek ≈ 0,55 sn. Ses dalgası akış boyunca buradan okunur. */
  readonly hist = new Float32Array(32);
  /** Gecikmeli kopyalar: dudağın kipleri için kaba "bant"lar (aynı sinyalin farklı anları). */
  readonly bands = new Float32Array(8);
  private acc = 0;

  /** `input`: o anki RMS (0..1). Sessizken (0) düzey kendiliğinden söner. */
  update(dt: number, input: number): void {
    const raw = shapeLevel(input);
    const rise = raw - this.raw;
    if (rise > 0.16) this.onset = Math.min(1, this.onset + rise * 1.6);
    this.raw = raw;
    const up = 1 - Math.exp(-dt * 42);
    const down = 1 - Math.exp(-dt * 11);
    this.level += (raw - this.level) * (raw > this.level ? up : down);
    if (this.level < 0.0005 && raw === 0) this.level = 0;
    this.onset *= Math.exp(-dt * 9);
    if (this.onset < 0.0005) this.onset = 0;
    this.acc += Math.min(dt, 0.6);
    while (this.acc >= HIST_STEP) {
      this.acc -= HIST_STEP;
      this.hist.copyWithin(1, 0, 31);
      this.hist[0] = this.level;
    }
    for (let b = 0; b < 8; b++) this.bands[b] = this.hist[b * 3] ?? 0;
  }

  /** Sinyal tümüyle söndü mü (döngünün durabilmesi için). */
  get silent(): boolean {
    if (this.level > 0.001 || this.onset > 0.001) return false;
    for (let i = 0; i < 32; i++) if ((this.hist[i] ?? 0) > 0.001) return false;
    return true;
  }

  reset(): void {
    this.raw = this.level = this.onset = 0;
    this.hist.fill(0);
    this.bands.fill(0);
  }
}
