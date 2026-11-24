/**
 * Varlığın kare döngüsü. Tek `requestAnimationFrame` zinciri, yalnız iş varken döner: her abone adımında "devam"
 * (true) ya da "durdum" (false) der; hepsi durunca zincir kesilir ve boşta sıfır kare üretilir. Uyandırmak için `wake()`.
 *
 * Gizli pencerede (sınama) kare çok seyrek gelir; adım 1 sn ile sınırlanır ve yaylar alt adımla çözülür, bu yüzden
 * biçim birkaç karede yerine oturur. Sınamalar için elle sürme: `window.__fuberPresence.setManual(true)` sonra `step(ms)`.
 */
type Step = (dt: number, time: number) => boolean;

interface Entry {
  step: Step;
  live: boolean;
}

const entries = new Set<Entry>();
let raf = 0;
let last = 0;
let time = 0;
let manual = false;

/** Ölçüm: boşta kare sayılmadığını ve kare başına işi sınamalar buradan okur. */
export const presenceStats = {
  frames: 0,
  busyMs: 0,
  reset() {
    this.frames = 0;
    this.busyMs = 0;
  },
};

const MAX_DT = 1;

function advance(dt: number): boolean {
  const began = performance.now();
  time += dt;
  let any = false;
  for (const entry of entries) {
    if (!entry.live) continue;
    let keep = false;
    try {
      keep = entry.step(dt, time);
    } catch (error) {
      // Çizim hatası döngüyü düşürmez; abone durur.
      console.error('[presence]', error);
    }
    entry.live = keep;
    any = any || keep;
  }
  presenceStats.frames += 1;
  presenceStats.busyMs += performance.now() - began;
  return any;
}

function frame(now: number): void {
  raf = 0;
  const dt = last ? Math.min(MAX_DT, Math.max(0, (now - last) / 1000)) : 1 / 60;
  last = now;
  if (advance(dt)) schedule();
  else last = 0;
}

function schedule(): void {
  if (manual || raf || typeof requestAnimationFrame === 'undefined') return;
  raf = requestAnimationFrame(frame);
}

export interface Tick {
  /** Döngüyü (yeniden) başlatır; zaten dönüyorsa etkisizdir. */
  wake(): void;
  /** Aboneliği kaldırır. */
  stop(): void;
}

export function createTick(step: Step): Tick {
  const entry: Entry = { step, live: false };
  entries.add(entry);
  return {
    wake() {
      entry.live = true;
      schedule();
    },
    stop() {
      entries.delete(entry);
    },
  };
}

/** Döngünün saati (sn); yalnız kare işlenirken ilerler. */
export const presenceTime = (): number => time;

interface ManualControl {
  setManual(on: boolean): void;
  /** Elle sürmede zamanı `ms` kadar, 1/60 sn'lik adımlarla ilerletir. */
  step(ms: number): void;
  stats: typeof presenceStats;
  /** O an döngü isteyen abone sayısı (boşta 0 olmalı). */
  live(): number;
}

if (typeof window !== 'undefined') {
  const control: ManualControl = {
    setManual(on) {
      manual = on;
      if (on && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      }
      if (!on) schedule();
    },
    step(ms) {
      let left = ms / 1000;
      while (left > 1e-6) {
        const dt = Math.min(1 / 60, left);
        advance(dt);
        left -= dt;
      }
    },
    stats: presenceStats,
    live: () => [...entries].filter((entry) => entry.live).length,
  };
  (window as unknown as { __fuberPresence?: ManualControl }).__fuberPresence = control;
}
