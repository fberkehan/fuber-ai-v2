/**
 * Kenara kaynaklı gövdenin çizimi (Takımyıldız). İçerik katmanının ölçüsü hedef biçimdir, biçim yaylarla değişir (her
 * geçiş yarıda kesilebilir), ses gövdenin kendisinde görünür:
 *
 *  - Gövde: düz siyah, 12 px içbükey omuzlar; içinde yıldızlardan ışık (`Swarm`).
 *  - Kenar ışığı: gövdenin alt kenarı boyunca ince, renkli bir ışık çizgisi. Renk ve biçim durumu söyler (dinliyor:
 *    beyaz, sesle parlar · düşünüyor: mavi, kenar boyunca gidip gelen tek ışık tanesi · konuşuyor: mavi, sesle parlar ·
 *    onay: kehribar, kalan süreyle ortadan daralan · iş: mavi, dolan · bilgisayar: mavi, yürüyen kesikli · hata: kırmızı ·
 *    mikrofon kapalı: gri, ortadan kopuk). Durum değişince gövdeden bir kez ışık süzülür. Döngü yoktur: ışık yalnız ses ya
 *    da süren iş varken hareket eder; azaltılmış harekette yalnız renk/parlaklık değişir.
 *
 * Motor DOM'u doğrudan yazar (React çizimi olmadan); bileşen (`IslandShell`) yalnız kökleri verir.
 */
import { Signal } from './signal';
import { Spring, clamp, lerp } from './spring';
import { Swarm } from './swarm';
import type { PresenceState } from './types';

export interface ShellTarget {
  /** İçerik katmanının ölçüsü (CSS px). */
  w: number;
  h: number;
  /** Kart: çok satırlı, düğmeli içerik (bildirim, onay). Köşe 26 px. */
  card: boolean;
}

export interface ShellInput {
  signal: Signal;
  reduced: boolean;
  /** Kalan süre ya da ilerleme (0..1). */
  progress: number;
}

export interface ShellRoots {
  /** Gövdenin çizileceği kap (üst orta, 0 × 0). */
  host: HTMLElement;
  /** İçerik kırpma kutusu: motor her karede ölçüsünü ve köşesini yazar. */
  clip: HTMLElement;
}

/**
 * Gövdenin biçim yayı (sertlik, sönüm). BÜYÜRKEN hafif esner (sönüm oranı ≈ 0,78: hedefi yaklaşık %2 aşar ve ~0,25 sn'de
 * oturur; gövde "canlı" durur ama yazıyı peşinde sürüklemez), KÜÇÜLÜRKEN aşmaz (≈ 0,93: çıkış sakin ve kısa).
 * Her ikisi de yarıda kesilebilir: hedef değişince hız korunur.
 */
export function bodySpring(axis: 'w' | 'h', growing: boolean): [number, number] {
  if (axis === 'w') return growing ? [620, 39] : [640, 47];
  return growing ? [680, 41] : [720, 50];
}

export interface ShellEngine {
  /** Durum değişti. */
  enter(state: PresenceState, prev: PresenceState): void;
  /** İçerik ölçüsü değişti; `null`: içeriksiz (boşta, uyanış). */
  layout(target: ShellTarget | null): void;
  /** `layout(target)` çağrılırsa gövdenin alacağı ölçü (uygulamadan): pencere zarfı önce buna göre büyür. */
  plan(target: ShellTarget | null): { w: number; h: number };
  /** Bir kare; dönen değer: hareket sürüyor mu. */
  frame(dt: number, t: number, input: ShellInput): boolean;
  /** Gövdenin o anki hedef ölçüsü (zarf hesabı için): omuzlar dahil değil. */
  targetSize(): { w: number; h: number };
  destroy(): void;
}

/** `island`: ekranın üst kenarındaki ada. `window`: ana pencerenin başlığındaki çentik (aynı gövde, pencere içinde). */
export type ShellVariant = 'island' | 'window';

const SHOULDER = 12;

/** Parçacık tuvali (gövdenin içinde, yatayda ortalı). */
const CV_W = 600;
const CV_H = 240;
/** Kenar ışığı tuvali: en geniş gövdeyi (sahne 720 px) kapsar. */
const RIM_W = 760;
const RIM_H = 360;

type Rgb = [number, number, number];
const WHITE: Rgb = [240, 243, 250];
const BLUE: Rgb = [92, 150, 255];
const AMBER: Rgb = [255, 180, 48];
const RED: Rgb = [255, 96, 96];
const GRAY: Rgb = [150, 150, 160];

type RimMode = 'center' | 'bead' | 'timer' | 'progress' | 'cut' | 'flat' | 'dash';

/** Durumun kenar ışığı: renk, hedef parlaklık ve biçim. */
export function rimOf(state: PresenceState, level: number, variant: ShellVariant): { color: Rgb; alpha: number; mode: RimMode } {
  const lv = Math.min(1, level * 1.5);
  switch (state) {
    case 'wake':
      return { color: WHITE, alpha: 0.9, mode: 'center' };
    case 'listening':
      return { color: WHITE, alpha: 0.24 + 0.76 * lv, mode: 'center' };
    case 'followup':
      return { color: WHITE, alpha: 0.3 + 0.6 * lv, mode: 'center' };
    case 'thinking':
      return { color: BLUE, alpha: 1, mode: 'bead' };
    case 'speaking':
      return { color: BLUE, alpha: 0.42 + 0.58 * Math.min(1, level * 1.4), mode: 'center' };
    case 'muted':
    case 'stopped':
      return { color: GRAY, alpha: 0.5, mode: 'cut' };
    case 'error':
      return { color: RED, alpha: 0.95, mode: 'flat' };
    case 'notice':
      return { color: WHITE, alpha: 0.85, mode: 'timer' };
    case 'approval':
      return { color: AMBER, alpha: 1, mode: 'timer' };
    case 'job':
      return { color: BLUE, alpha: 1, mode: 'progress' };
    case 'computer':
      return { color: BLUE, alpha: 0.72 + 0.28 * Math.min(1, level * 2.4), mode: 'dash' };
    default:
      // Ana pencerenin boştaki çentiği: kıl payı, soluk beyaz bir kenar (adada boşta gövde yoktur).
      return { color: WHITE, alpha: variant === 'window' ? 0.2 : 0, mode: 'flat' };
  }
}

export class ConstellationShell implements ShellEngine {
  private readonly wrap: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly shL: HTMLElement;
  private readonly shR: HTMLElement;
  private readonly glow: HTMLElement;
  private readonly clip: HTMLElement;
  private readonly swarm: Swarm;
  private readonly rim: HTMLCanvasElement;
  private readonly rimCtx: CanvasRenderingContext2D | null;
  private readonly dpr: number;
  private readonly variant: ShellVariant;
  private readonly w = new Spring(52, 440, 34);
  private readonly h = new Spring(0, 520, 36);
  private readonly r = new Spring(0, 520, 40);
  private state: PresenceState = 'idle';
  private card = false;
  private readonly cardK = new Spring(0, 440, 40);
  private hidden = true;
  private lit = 0;
  /** Kenar ışığının o anki rengi ve parlaklığı (yumuşak geçiş). */
  private readonly col: Rgb = [...WHITE];
  private alpha = 0;
  /** Biçim değişirken kısa kararma (yeni biçim bir anda belirmez). */
  private readonly gate = new Spring(1, 300, 30);
  private mode: RimMode = 'flat';
  /** 0..1: durum değişince bir kez süzülen ışık bandı; 1 = yok. */
  private sweep = 1;
  private rimKey = '';

  constructor(roots: ShellRoots, variant: ShellVariant = 'island') {
    this.clip = roots.clip;
    this.variant = variant;
    const make = (tag: string, cls: string) => {
      const node = document.createElement(tag);
      node.className = cls;
      return node;
    };
    this.wrap = make('div', 'pz-wrap') as HTMLDivElement;
    this.shL = make('i', 'pz-shoulder pz-shoulder-l');
    this.shR = make('i', 'pz-shoulder pz-shoulder-r');
    this.body = make('div', 'pz-body') as HTMLDivElement;
    const fx = make('div', 'pz-fx');
    const canvas = document.createElement('canvas');
    canvas.className = 'pz-swarm';
    canvas.style.marginLeft = `${-CV_W / 2}px`;
    this.glow = make('i', 'pz-glow');
    this.rim = document.createElement('canvas');
    this.rim.className = 'pz-rim';
    this.dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    this.rim.width = Math.round(RIM_W * this.dpr);
    this.rim.height = Math.round(RIM_H * this.dpr);
    this.rim.style.width = `${RIM_W}px`;
    this.rim.style.height = `${RIM_H}px`;
    this.rim.style.marginLeft = `${-RIM_W / 2}px`;
    this.rimCtx = this.rim.getContext('2d');
    fx.append(canvas, this.glow, this.rim);
    this.body.append(fx);
    this.wrap.append(this.shL, this.shR, this.body);
    this.wrap.style.visibility = 'hidden';
    roots.host.append(this.wrap);
    this.swarm = new Swarm(canvas, { width: CV_W, height: CV_H, count: 2600, radial: false, idle: 'none' });
    fx.classList.toggle('pz-nogl', !this.swarm.ok);
    this.swarm.onContext = (ok) => fx.classList.toggle('pz-nogl', !ok);
  }

  enter(state: PresenceState, prev: PresenceState): void {
    this.state = state;
    this.swarm.target(state);
    if (state === prev) return;
    this.gate.snap(0.2).to(1);
    // Biçim oturduktan sonra tek bir ışık bandı süzülür (boşta ve takipte yok: sakin hâller).
    if (state !== 'idle' && state !== 'followup') this.sweep = -0.3;
  }

  layout(target: ShellTarget | null): void {
    if (target) {
      this.card = target.card;
      this.w.to(target.w, ...bodySpring('w', target.w > this.w.t + 0.5));
      this.h.to(target.h, ...bodySpring('h', target.h > this.h.t + 0.5));
      this.r.to(target.card ? 26 : target.h / 2);
      return;
    }
    // Çıkış ve küçülme aşmaz.
    this.w.to(this.w.t, ...bodySpring('w', false));
    this.h.to(this.h.t, ...bodySpring('h', false));
    this.card = false;
    if (this.state === 'wake') {
      this.w.to(52);
      this.h.to(48);
      this.r.to(24);
    } else {
      this.w.to(52);
      this.h.to(0);
      this.r.to(0);
    }
  }

  plan(target: ShellTarget | null): { w: number; h: number } {
    if (target) return { w: target.w, h: target.h };
    return this.state === 'wake' ? { w: 52, h: 48 } : { w: 52, h: 0 };
  }

  targetSize(): { w: number; h: number } {
    return { w: this.w.t, h: this.h.t };
  }

  frame(dt: number, t: number, input: ShellInput): boolean {
    const { signal, reduced } = input;
    const w = Math.max(0, this.w.step(dt, reduced));
    const h = Math.max(0, this.h.step(dt, reduced));
    const r = Math.max(0, Math.min(this.r.step(dt, reduced), w / 2, h));
    this.gate.step(dt, reduced);
    const settling = !(this.w.rest() && this.h.rest() && this.r.rest() && this.cardK.rest(0.004) && this.gate.rest(0.004));
    // Çıkış: yükseklik sıfıra asimptotik yaklaşır; son piksel beklenmez (üst kenarda kırıntı kalıyordu).
    const hide = (h < 0.3 && this.h.rest()) || (this.h.t === 0 && h < 1.5);
    if (hide !== this.hidden) {
      this.hidden = hide;
      this.wrap.style.visibility = hide ? 'hidden' : 'visible';
      this.clip.style.visibility = hide ? 'hidden' : 'visible';
    }
    if (hide) {
      // Gövde yokken yollarda kalan yaylar hedefine oturtulur ki döngü dursun (boşta sıfır kare).
      this.cardK.snap(this.cardK.t);
      this.gate.snap(this.gate.t);
      this.sweep = 1;
      this.alpha = 0;
      this.rimKey = '';
      return !(this.w.rest() && this.h.rest());
    }

    const bs = this.body.style;
    bs.width = `${w}px`;
    bs.height = `${h}px`;
    bs.marginLeft = `${-w / 2}px`;
    bs.borderRadius = `0 0 ${r}px ${r}px`;
    const k = Math.min(1, h / SHOULDER);
    this.shL.style.transform = `translateX(${-w / 2 - SHOULDER + 0.5}px) scale(${k})`;
    this.shR.style.transform = `translateX(${w / 2 - 0.5}px) scale(${k})`;
    const cs = this.clip.style;
    cs.width = `${w}px`;
    cs.height = `${h}px`;
    cs.marginLeft = `${-w / 2}px`;
    cs.borderRadius = `0 0 ${r}px ${r}px`;

    // Kart ↔ satır: çekirdeğin yeri yayla geçer (kart kalkarken tek karede satır konumuna sıçramasın).
    this.cardK.to(this.card ? 1 : 0);
    const ck = clamp(this.cardK.step(dt, reduced), 0, 1);
    const pad = lerp(h / 2 + 2, 34, ck);
    const cx = CV_W / 2 - w / 2 + pad;
    const cy = lerp(Math.max(8, h / 2), 34, ck);
    const card = this.card;
    this.swarm.setArc(this.state === 'muted' || this.state === 'stopped' ? 0 : input.progress);
    const busy = this.swarm.frame(
      dt,
      t,
      {
        cx,
        cy,
        R: 8.5,
        // Kartta akış yazının üstünden geçmez: çekirdeğin çevresinde kısa kalır.
        L: card ? 12 : Math.max(40, w - pad - 26),
        spread: card ? 2.4 : 4.2,
        orb: 0.74,
        drop: card ? 0 : Math.max(0, h / 2 - 9),
        ringR: card ? 12 : 11,
        frame: [24, 15],
        size: 2.3,
      },
      signal,
      reduced,
    );

    // Alttan vuran ışık: durumun rengini taşır; yalnız saydamlık değişir.
    const n = this.state;
    const lvl = signal.level;
    const lit =
      n === 'speaking' ? 0.25 + 0.75 * lvl : n === 'listening' || n === 'followup' || n === 'wake' ? 0.12 + 0.5 * lvl : n === 'thinking' ? 0.22 : 0.1;
    const shown = lit * Math.min(1, h / 30);
    if (Math.abs(shown - this.lit) > 0.004) {
      this.lit = shown;
      this.glow.style.opacity = shown.toFixed(3);
    }
    const tone = n === 'speaking' || n === 'thinking' || n === 'job' || n === 'computer' ? 'b' : n === 'approval' ? 'a' : n === 'error' ? 'r' : 'w';
    if (this.glow.dataset.c !== tone) this.glow.dataset.c = tone;

    const rimMoving = this.drawRim(dt, t, w, h, r, lvl, input.progress, reduced);
    return settling || busy || rimMoving;
  }

  /** Kenar ışığı. Dönen değer: bir sonraki karede yine çizilmesi gerekiyor mu (geçiş, ses ya da süren hareket). */
  private drawRim(dt: number, t: number, w: number, h: number, r: number, level: number, progress: number, reduced: boolean): boolean {
    const ctx = this.rimCtx;
    if (!ctx) return false;
    const target = rimOf(this.state, level, this.variant);
    this.mode = target.mode;
    const k = 1 - Math.exp(-dt * 12);
    let colorMoving = false;
    for (let i = 0; i < 3; i++) {
      const from = this.col[i] ?? 0;
      const to = target.color[i] ?? 0;
      const next = Math.abs(to - from) < 0.5 ? to : from + (to - from) * k;
      if (next !== from) colorMoving = true;
      this.col[i] = next;
    }
    const aBefore = this.alpha;
    this.alpha += (target.alpha - this.alpha) * (1 - Math.exp(-dt * 22));
    if (Math.abs(target.alpha - this.alpha) < 0.003) this.alpha = target.alpha;
    const fading = Math.abs(this.alpha - aBefore) > 0.0005 || colorMoving;
    const sweeping = this.sweep < 1 && !reduced;
    if (sweeping) this.sweep = Math.min(1, this.sweep + dt / 0.9);
    else this.sweep = 1;
    const animated = !reduced && (this.mode === 'bead' || this.mode === 'dash');
    const al = this.alpha * clamp(this.gate.x, 0, 1);

    // Hiçbir şey değişmiyorsa yeniden çizilmez (boşta kare yok).
    const key = `${w.toFixed(1)}|${h.toFixed(1)}|${r.toFixed(1)}|${al.toFixed(3)}|${this.col.map((c) => c | 0).join(',')}|${this.mode}|${progress.toFixed(3)}`;
    if (!sweeping && !animated && key === this.rimKey) return false;
    this.rimKey = key;

    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, RIM_W, RIM_H);
    if (h < 2) return sweeping || animated || fading;
    const cx = RIM_W / 2;
    const xL = cx - w / 2;
    const xR = cx + w / 2;

    // Durum değişince bir kez süzülen ışık bandı (gövdenin tamamında, çok hafif).
    const sw = this.sweep;
    if (sw > 0 && sw < 1 && h > 14) {
      const bw = Math.max(80, w * 0.42);
      const bx = xL - bw + (w + bw) * sw;
      const lg = ctx.createLinearGradient(bx, 0, bx + bw, bw * 0.18);
      const sa = 0.12 * Math.sin(Math.PI * Math.min(1, sw * 1.15));
      const c = this.col;
      lg.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
      lg.addColorStop(0.5, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, sa).toFixed(3)})`);
      lg.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
      ctx.fillStyle = lg;
      ctx.fillRect(bx, 0, bw, h);
    }

    if (al < 0.01) return sweeping || animated || fading;
    // Alt kenarın yolu: sol köşe yayı, düz alt kenar, sağ köşe yayı (gövdenin içinde, yarım piksel içeride).
    const y = h - 0.75;
    const rr = Math.max(0, Math.min(r, h) - 0.75);
    ctx.beginPath();
    ctx.moveTo(xL + 0.75, Math.max(0, y - rr));
    ctx.arc(xL + 0.75 + rr, y - rr, rr, Math.PI, Math.PI / 2, true);
    ctx.lineTo(xR - 0.75 - rr, y);
    ctx.arc(xR - 0.75 - rr, y - rr, rr, Math.PI / 2, 0, true);

    const c = this.col;
    const rgb = (a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
    const g = ctx.createLinearGradient(xL, 0, xR, 0);
    const mode = this.mode;
    if (mode === 'center') {
      g.addColorStop(0, rgb(0));
      g.addColorStop(0.18, rgb(al * 0.32));
      g.addColorStop(0.5, rgb(al));
      g.addColorStop(0.82, rgb(al * 0.32));
      g.addColorStop(1, rgb(0));
    } else if (mode === 'bead') {
      // Düşünme: kenar boyunca gidip gelen tek ışık tanesi.
      const pb = reduced ? 0.5 : 0.5 + 0.4 * Math.sin(t * 2.6);
      const hw = 0.16;
      g.addColorStop(0, rgb(0));
      g.addColorStop(clamp(pb - hw, 0.001, 0.997), rgb(al * 0.1));
      g.addColorStop(clamp(pb, 0.002, 0.998), rgb(al));
      g.addColorStop(clamp(pb + hw, 0.003, 0.999), rgb(al * 0.1));
      g.addColorStop(1, rgb(0));
    } else if (mode === 'timer' || mode === 'progress') {
      const f = clamp(progress, 0, 1);
      let a0 = mode === 'timer' ? 0.5 - 0.43 * f : 0.07;
      let a1 = mode === 'timer' ? 0.5 + 0.43 * f : 0.07 + 0.86 * f;
      const e = 0.004;
      a0 = clamp(a0, 0.07, 0.93);
      a1 = clamp(a1, a0, 0.93);
      g.addColorStop(0, rgb(0));
      g.addColorStop(0.05, rgb(al * 0.14));
      g.addColorStop(Math.max(0.051, a0 - e), rgb(al * 0.14));
      g.addColorStop(a0, rgb(al));
      g.addColorStop(a1, rgb(al));
      g.addColorStop(Math.min(0.949, a1 + e), rgb(al * 0.14));
      g.addColorStop(0.95, rgb(al * 0.14));
      g.addColorStop(1, rgb(0));
    } else if (mode === 'cut') {
      // Mikrofon kapalı: ışık ortadan kopuk, tepkisiz.
      g.addColorStop(0, rgb(0));
      g.addColorStop(0.12, rgb(al));
      g.addColorStop(0.44, rgb(al));
      g.addColorStop(0.441, rgb(0));
      g.addColorStop(0.559, rgb(0));
      g.addColorStop(0.56, rgb(al));
      g.addColorStop(0.88, rgb(al));
      g.addColorStop(1, rgb(0));
    } else {
      g.addColorStop(0, rgb(0));
      g.addColorStop(0.14, rgb(al));
      g.addColorStop(0.86, rgb(al));
      g.addColorStop(1, rgb(0));
    }
    ctx.strokeStyle = g;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (mode === 'dash') {
      ctx.setLineDash([7, 8]);
      ctx.lineDashOffset = reduced ? 0 : -t * 34;
    } else {
      // Işığın yumuşak hâlesi: geniş ve soluk iki geçiş (kenar gövdenin içine doğru parlar; dışı kırpılır).
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    return sweeping || animated || fading;
  }

  destroy(): void {
    this.swarm.destroy();
    this.wrap.remove();
  }
}
