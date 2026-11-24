/**
 * Yay (Motion ile aynı birimler: sertlik, sönüm, kütle = 1). Hedef değişince hızını koruyarak yön değiştirir:
 * her geçiş yarıda kesilebilir. Yarı-örtük Euler, 4 ms'lik alt adımlar (gizli pencerede kare seyrekken de kararlı).
 */
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Spring {
  x: number;
  v = 0;
  t: number;
  k: number;
  c: number;

  constructor(x: number, k = 420, c = 34) {
    this.x = x;
    this.t = x;
    this.k = k;
    this.c = c;
  }

  to(target: number, k?: number, c?: number): this {
    this.t = target;
    if (k !== undefined && c !== undefined) {
      this.k = k;
      this.c = c;
    }
    return this;
  }

  snap(x: number): this {
    this.x = x;
    this.t = x;
    this.v = 0;
    return this;
  }

  kick(v: number): this {
    this.v += v;
    return this;
  }

  /** `reduced`: aşma yok, kısa ve sönümlü yaklaşma. */
  step(dt: number, reduced = false): number {
    if (reduced) {
      this.x += (this.t - this.x) * (1 - Math.exp(-dt * 22));
      this.v = 0;
      if (Math.abs(this.t - this.x) < 0.01) this.x = this.t;
      return this.x;
    }
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.x - this.t) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  /** Yerine oturdu mu (`eps`: konum eşiği; biçimde 0,02 px, 0..1 ağırlıklarda 0,002). */
  rest(eps = 0.02): boolean {
    return Math.abs(this.x - this.t) < eps && Math.abs(this.v) < eps * 2.5;
  }
}

/** Tohumlu rastgele (parçacık öznitelikleri her açılışta aynı olsun). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
