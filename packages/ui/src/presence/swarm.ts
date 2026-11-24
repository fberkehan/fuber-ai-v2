/**
 * Takımyıldız: Jarvis yıldızlardan toplanır. Kural tek: akışın yönü, sesin yönüdür. Siz konuşurken beyaz ışık
 * dışarıdan çekirdeğe akar; Jarvis konuşurken mavi ışık çekirdekten dışarı akar ve ses dalgası akışla birlikte yol alır;
 * düşünürken akış durur, yıldızlar iki kollu eğik bir sarmalda döner. Bekleyen karar ve süren iş dolan ya da eriyen bir
 * halkadır; bilgisayarı kullanırken ışık küçük bir ekran çerçevesinin çevresinde dolaşır.
 *
 * WebGL2, tek program, tek çizim çağrısı; konumlar köşe gölgelendiricisinde hesaplanır (CPU'da parçacık döngüsü yok).
 * Biçimler arası geçişte her düzenin ağırlığı ayrı bir yaydır: her geçiş yarıda kesilip başka düzene dönebilir.
 * Tuval saydamdır (ön çarpılmış alfa): yalnız ışığın olduğu yer boyanır.
 */
import { Signal } from './signal';
import { Spring, clamp, mulberry } from './spring';
import type { PresenceState } from './types';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aS;
uniform vec2 uRes; uniform float uDpr, uT;
uniform vec2 uC; uniform float uR, uL, uRadial, uSpread;
uniform float uWv, uWt, uWr, uWf, uWd;
uniform float uFlow, uIn, uLvl, uArc, uSpin, uSize, uOnset, uDim;
uniform float uHist[32];
uniform float uRingR, uDrop, uRays, uOrb; uniform vec2 uFrameS;
uniform vec3 uColIn, uColOut, uTint; uniform float uTintK, uRestCore;
out vec3 vCol;
float hist(float p){ float f = clamp(p,0.,1.)*31.; int i = int(floor(f)); int j = min(31, i+1); return mix(uHist[i], uHist[j], fract(f)); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
void main(){
  float a=aS.x, b=aS.y, c=aS.z, d=aS.w;
  bool isCore = c < 0.34;
  // Çekirdek: dönen küre kabukları; ses düzeyiyle solur.
  float ca = a*6.2831853 + uSpin*(0.6+d);
  float cz = b*2.-1.; float cr = sqrt(max(0.,1.-cz*cz));
  vec3 sp = vec3(cr*cos(ca), cz, cr*sin(ca));
  sp.yz = rot(0.5)*sp.yz;
  float shell = 0.42 + 0.58*fract(d*7.13);
  float pulse = 1. + uLvl*(0.3+0.55*fract(d*3.7)) + uOnset*0.22;
  vec2 cc = uC;
  vec2 coreP = cc + sp.xy*uR*shell*pulse;
  // Akış: çekirdekten dışarı (konuşma) ya da çekirdeğe doğru (dinleme). Ses dalgası akışla birlikte taşınır.
  float p = fract(a + uFlow);
  float hh = mix(hist(p*0.92), hist((1.-p)*0.92), uIn);
  float lat = (b-0.5)*2.; lat = sign(lat)*pow(abs(lat),1.7);
  float taper = mix(0.22, 1.0, smoothstep(0.,.45,p));
  float wav = sin(p*19. - uT*5.*(1.-2.*uIn) + d*1.3);
  float y = lat*uSpread*taper*(0.3+1.5*hh) + wav*hh*uSpread*0.55;
  // Adada akış çekirdekten çıkıp yazının altına iner ve alt kenar boyunca akar (yazının üstünden geçmez).
  vec2 lin = cc + vec2(uR*0.7 + p*uL, y + uDrop*smoothstep(0., 15., p*uL));
  // Geniş yüzeyde akış ışınlara dizilir: ses, ışınlar boyunca dışa (ya da içe) yürür.
  float ang = (floor(d*uRays)+0.5)/uRays*6.2831853 + (c-0.5)*0.03; vec2 dir = vec2(cos(ang), sin(ang));
  vec2 rad = cc + dir*(uR*1.15 + p*uL) + vec2(-dir.y, dir.x)*y*0.16;
  vec2 streamP = mix(lin, rad, uRadial);
  float sA = smoothstep(0.,.1,p)*(1.-smoothstep(.5,1.,p))*(0.16+1.05*hh);
  // Girdap (düşünme): akış durur, yıldızlar iki kollu eğik bir sarmalda döner; içerisi dışarıdan hızlıdır.
  float rr = 0.55 + 2.0*pow(a, 0.75);
  float arm = floor(d*2.)*3.14159265;
  float oa = arm + 2.6*log(rr) + (b-.5)*0.9/rr - uSpin*1.15/sqrt(rr);
  vec3 op = vec3(cos(oa)*rr, sin(oa)*rr*0.42, sin(oa)*rr)*uOrb;
  op.xy = rot(-0.38)*op.xy;
  vec2 orbitP = cc + op.xy*uR;
  // Halka (kalan süre, ilerleme): yay dolu kısımda parlak.
  float ra = -1.5707963 + a*6.2831853;
  vec2 ringP = uC + vec2(cos(ra), sin(ra))*(uRingR + (b-.5)*2.6);
  float ringA = mix(0.1, 0.95, step(a, uArc));
  // Çerçeve (bilgisayarı kullanıyor): ekranın çevresinde dolaşan ışık.
  float q = fract(a + uT*0.06)*4.; float side=floor(q); float f=fract(q);
  vec2 hs = uFrameS*0.5; vec2 fp;
  if(side<1.) fp=vec2(mix(-hs.x,hs.x,f), -hs.y); else if(side<2.) fp=vec2(hs.x, mix(-hs.y,hs.y,f)); else if(side<3.) fp=vec2(mix(hs.x,-hs.x,f), hs.y); else fp=vec2(-hs.x, mix(hs.y,-hs.y,f));
  vec2 frameP = uC + fp + (vec2(b,d)-.5)*1.4;
  float frameA = 0.25 + 0.75*pow(0.5+0.5*sin((a - uT*0.35)*6.2831853), 6.);
  // Toz (boşta, geniş yüzey): gökyüzü.
  vec2 dustP = vec2(a, b)*uRes + vec2(sin(uT*0.1+d*20.), cos(uT*0.13+d*33.))*4.;
  float dustA = (0.03+0.9*pow(fract(d*9.1), 7.))*(0.6+0.4*sin(uT*(0.5+d*2.)+d*50.));
  // Boşta (geniş yüzey): çekirdeğin yıldızları dağılmaz, sakin ve küçük bir küme olarak yerinde durur.
  if (isCore) { dustP = mix(dustP, cc + sp.xy*uR*shell*1.3, uRestCore); dustA = mix(dustA, 0.1+0.06*sp.z, uRestCore); }

  float W = uWv+uWt+uWr+uWf+uWd + 1e-4;
  vec2 voiceP = isCore ? coreP : streamP;
  float voiceA = isCore ? (0.5+0.25*sp.z+0.35*uLvl) : sA;
  vec2 thinkP = isCore ? (cc + sp.xy*uR*shell*0.72) : orbitP;
  float thinkA = isCore ? 0.6 : (0.62 - 0.14*rr + 0.12*sin(oa));
  vec2 pos = (voiceP*uWv + thinkP*uWt + ringP*uWr + frameP*uWf + dustP*uWd)/W;
  float alpha = (voiceA*uWv + thinkA*uWt + ringA*uWr + frameA*uWf + dustA*uWd)/W;
  alpha *= min(1., W) * uDim;
  vec3 flow = mix(uColOut, uColIn, uIn);
  float heat = (isCore ? 0.7 : (1.-p)*0.45) * (uWv+uWt)/W;
  vec3 col = mix(flow, vec3(1.), heat);
  col = mix(col, uTint, uTintK);
  vCol = col*alpha;
  vec2 ndc = pos/uRes*2.-1.;
  gl_Position = vec4(ndc.x, -ndc.y, 0., 1.);
  gl_PointSize = uSize*uDpr*(0.55+0.9*fract(d*11.3))*(isCore ? 1.0+0.25*sp.z : 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vCol; out vec4 o;
void main(){ float r = length(gl_PointCoord-.5)*2.; float a = smoothstep(1.,0.,r); vec3 c = vCol*a*a; o = vec4(c, max(c.r, max(c.g, c.b))); }`;

const UNIFORMS = [
  'uRes', 'uDpr', 'uT', 'uC', 'uR', 'uL', 'uRadial', 'uSpread', 'uWv', 'uWt', 'uWr', 'uWf', 'uWd', 'uFlow', 'uIn', 'uLvl', 'uArc',
  'uSpin', 'uSize', 'uOnset', 'uDim', 'uHist', 'uRingR', 'uDrop', 'uRays', 'uOrb', 'uFrameS', 'uColIn', 'uColOut', 'uTint',
  'uTintK',
  'uRestCore',
] as const;
type UniformName = (typeof UNIFORMS)[number];

const TINT = {
  none: [1, 1, 1],
  gray: [0.6, 0.6, 0.64],
  red: [1, 0.36, 0.36],
  amber: [1, 0.69, 0.13],
} as const;

/** Çizim geometrisi (CSS px, tuval koordinatı). */
export interface SwarmGeometry {
  cx: number;
  cy: number;
  /** Çekirdeğin yarıçapı. */
  R: number;
  /** Akışın boyu. */
  L: number;
  spread: number;
  ringR: number;
  frame: readonly [number, number];
  /** Nokta boyu. */
  size: number;
  drop?: number;
  rays?: number;
  orb?: number;
}

export interface SwarmOptions {
  width: number;
  height: number;
  count: number;
  /** Akış ışınlara dizilir (geniş yüzey ve küçük işaret); kapalıysa tek yöne akar (ada). */
  radial: boolean;
  /** Boştayken ne çizilir: `dust` gökyüzü tozu, `core` sakin çekirdek, `none` hiçbir şey. */
  idle: 'dust' | 'core' | 'none';
  seed?: number;
}

/**
 * Düzenler arası geçiş yayı (ağırlıklar). Gövdenin biçim yayıyla aynı sürede oturur (~0,33 sn) ve aşmaz: parçacıklar
 * yeni düzene gövdeyle birlikte varır. Önceki değer (90, 15) ~0,6 sn sürüyordu; gövde oturduktan sonra parçacıklar hâlâ
 * yoldaydı ve dağılan akış yazının üstünden geçiyordu.
 */
const MORPH_K = 170;
const MORPH_C = 24;

export class Swarm {
  /** WebGL2 var ve bağlam ayakta. Yokken gövde ve yazı çalışır; ışık çizilmez (çağıran yedek gösterir). */
  ok = false;
  /** Bağlam kaybolunca / geri gelince çağrılır (yedek görünümü açıp kapatmak için). */
  onContext: ((ok: boolean) => void) | null = null;
  private readonly cv: HTMLCanvasElement;
  private readonly data: Float32Array;
  private gl: WebGL2RenderingContext | null = null;
  private u = {} as Record<UniformName, WebGLUniformLocation | null>;
  private W: number;
  private H: number;
  private dpr = 1;
  private readonly N: number;
  private readonly radial: number;
  private readonly idleMode: SwarmOptions['idle'];
  private readonly wv = new Spring(0, MORPH_K, MORPH_C);
  private readonly wt = new Spring(0, MORPH_K, MORPH_C);
  private readonly wr = new Spring(0, MORPH_K, MORPH_C);
  private readonly wf = new Spring(0, MORPH_K, MORPH_C);
  private readonly wd = new Spring(0, MORPH_K, MORPH_C);
  private readonly inS = new Spring(1, 70, 14);
  private readonly dim = new Spring(1, 90, 17);
  private readonly tintK = new Spring(0, 90, 17);
  private readonly arc = new Spring(1, 120, 20);
  private tint: number[] = [...TINT.none];
  private flow = 0;
  private spin = 0;
  private burst = 0;
  private state: PresenceState = 'idle';
  private frozen = false;
  private dirty = true;

  constructor(canvas: HTMLCanvasElement, options: SwarmOptions) {
    this.cv = canvas;
    this.W = options.width;
    this.H = options.height;
    this.N = options.count;
    this.radial = options.radial ? 1 : 0;
    this.idleMode = options.idle;
    const rnd = mulberry(options.seed ?? (options.radial ? 91 : 37));
    this.data = new Float32Array(this.N * 4);
    for (let i = 0; i < this.data.length; i++) this.data[i] = rnd();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.init();
    this.resize(options.width, options.height);
    this.target('idle', true);
  }

  private readonly onLost = (event: Event): void => {
    event.preventDefault();
    this.ok = false;
    this.gl = null;
    this.onContext?.(false);
  };

  private readonly onRestored = (): void => {
    this.init();
    this.resize(this.W, this.H);
    this.onContext?.(this.ok);
  };

  private init(): void {
    const gl = this.cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    this.ok = !!gl && !gl.isContextLost();
    if (!gl || !this.ok) return;
    this.gl = gl;
    const data = this.data;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error('[presence] gölgelendirici', gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error('[presence] program', gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(program, name);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);
    this.dirty = true;
  }

  resize(width: number, height: number, dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)): void {
    this.W = width;
    this.H = height;
    this.dpr = dpr;
    const cv = this.cv;
    cv.width = Math.max(1, Math.round(width * dpr));
    cv.height = Math.max(1, Math.round(height * dpr));
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    this.gl?.viewport(0, 0, cv.width, cv.height);
    this.dirty = true;
  }

  /**
   * Halka yalnız SAYAN bir şey varken anlamlıdır (adada kalan süre, iş ilerlemesi). Sayaç yokken (ana penceredeki
   * varlık, ray işareti) bildirim ve onay hâli halka değil, renkli çekirdektir: düz sarı bir çember gibi okunmaz.
   */
  solid = false;

  /** Hâle göre düzen ağırlıkları. `instant`: ilk kurulumda yaysız. */
  target(state: PresenceState, instant = false): void {
    this.state = state;
    // `quick`: akıştan çıkış (düşünmeye geçiş) daha hızlıdır: dağılan parçacıklar yazının üstünden geçerken oyalanmaz.
    const set = (v: number, t: number, r: number, f: number, d: number, quick = false) => {
      const k = quick ? 280 : MORPH_K;
      const c = quick ? 31 : MORPH_C;
      this.wv.to(v, k, c);
      this.wt.to(t, k, c);
      this.wr.to(r, k, c);
      this.wf.to(f, k, c);
      this.wd.to(d, k, c);
    };
    let tint: keyof typeof TINT = 'none';
    let tk = 0;
    let dim = 1;
    let frozen = false;
    switch (state) {
      case 'idle':
        if (this.idleMode === 'dust') set(0, 0, 0, 0, 1);
        else if (this.idleMode === 'core') (set(1, 0, 0, 0, 0), this.inS.to(1), (dim = 0.62), (frozen = true));
        else set(0, 0, 0, 0, 0);
        break;
      case 'wake':
        set(1, 0, 0, 0, 0);
        this.inS.to(1);
        this.burst = 1;
        break;
      case 'listening':
        set(1, 0, 0, 0, 0);
        this.inS.to(1);
        break;
      case 'followup':
        set(1, 0, 0, 0, 0);
        this.inS.to(1);
        dim = 0.6;
        break;
      case 'thinking':
        set(0, 1, 0, 0, 0, true);
        break;
      case 'speaking':
        set(1, 0, 0, 0, 0);
        this.inS.to(0);
        break;
      case 'muted':
        set(0, 0, 1, 0, 0);
        tint = 'gray';
        tk = 1;
        dim = 0.9;
        frozen = true;
        break;
      case 'stopped':
        set(1, 0, 0, 0, 0);
        tint = 'gray';
        tk = 1;
        dim = 0.78;
        frozen = true;
        break;
      case 'error':
        set(1, 0, 0, 0, 0);
        tint = 'red';
        tk = 0.92;
        frozen = true;
        break;
      case 'notice':
        if (this.solid) (set(1, 0, 0, 0, 0), this.inS.to(1));
        else set(0, 0, 1, 0, 0);
        break;
      case 'approval':
        if (this.solid) (set(1, 0, 0, 0, 0), this.inS.to(1));
        else set(0, 0, 1, 0, 0);
        tint = 'amber';
        tk = this.solid ? 0.82 : 1;
        break;
      case 'job':
        set(0, 0, 1, 0, 0);
        this.inS.to(0);
        break;
      case 'computer':
        set(0, 0, 0, 1, 0);
        this.inS.to(0);
        break;
    }
    if (tk > 0) this.tint = [...TINT[tint]];
    this.tintK.to(tk);
    this.dim.to(dim);
    this.frozen = frozen;
    if (instant) for (const s of this.springs()) s.snap(s.t);
    this.dirty = true;
  }

  /** Halkanın dolu kısmı (0..1): kalan süre ya da ilerleme. */
  setArc(value: number): void {
    if (Math.abs(this.arc.t - value) > 0.0005) {
      this.arc.to(clamp(value, 0, 1));
      this.dirty = true;
    }
  }

  private springs(): Spring[] {
    return [this.wv, this.wt, this.wr, this.wf, this.wd, this.inS, this.dim, this.tintK, this.arc];
  }

  /**
   * Bir kare çizer. Dönen değer: hareket sürüyor mu (yaylar oturmadıysa, akış ya da dönüş varsa true). Hareketsiz
   * hâllerde son kare tuvalde kalır ve döngü durur.
   */
  frame(dt: number, t: number, g: SwarmGeometry, signal: Signal, reduced: boolean): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const state = this.state;
    for (const s of this.springs()) s.step(dt, reduced);
    const level = reduced ? signal.level * 0.4 : signal.level;
    const inK = clamp(this.inS.x, 0, 1);
    const voiced = state === 'listening' || state === 'followup' || state === 'speaking' || state === 'wake';
    const moving = !reduced && !this.frozen && (voiced || state === 'thinking' || state === 'computer');
    if (moving) {
      this.flow += dt * 0.5 * (1 - 2 * inK) * (0.55 + 0.9 * signal.level);
      this.spin += dt * (state === 'thinking' ? 2.4 : 0.5 + 2.2 * signal.level);
    }
    this.burst *= Math.exp(-dt * 5);
    if (this.burst < 0.002) this.burst = 0;

    gl.clear(gl.COLOR_BUFFER_BIT);
    const u = this.u;
    const live = this.wv.x + this.wt.x + this.wr.x + this.wf.x + this.wd.x;
    if (live >= 0.004) {
      gl.uniform2f(u.uRes, this.W, this.H);
      gl.uniform1f(u.uDpr, this.dpr);
      // Azaltılmış harekette zaman durur: düzen yerinde kalır, yalnız parlaklık sesi izler.
      gl.uniform1f(u.uT, reduced || this.frozen || state === 'idle' ? 0 : t);
      gl.uniform2f(u.uC, g.cx, g.cy);
      gl.uniform1f(u.uR, g.R);
      gl.uniform1f(u.uL, g.L);
      gl.uniform1f(u.uRadial, this.radial);
      gl.uniform1f(u.uSpread, g.spread);
      gl.uniform1f(u.uWv, Math.max(0, this.wv.x));
      gl.uniform1f(u.uWt, Math.max(0, this.wt.x));
      gl.uniform1f(u.uWr, Math.max(0, this.wr.x));
      gl.uniform1f(u.uWf, Math.max(0, this.wf.x));
      gl.uniform1f(u.uWd, Math.max(0, this.wd.x));
      gl.uniform1f(u.uFlow, this.flow);
      gl.uniform1f(u.uIn, inK);
      gl.uniform1f(u.uLvl, this.frozen ? 0 : level);
      gl.uniform1f(u.uArc, clamp(this.arc.x, 0, 1));
      gl.uniform1f(u.uSpin, this.spin);
      gl.uniform1f(u.uSize, g.size);
      gl.uniform1f(u.uOnset, (this.frozen ? 0 : signal.onset) + this.burst * 2.2);
      gl.uniform1f(u.uDim, clamp(this.dim.x, 0, 1.2));
      gl.uniform1fv(u.uHist, signal.hist);
      gl.uniform1f(u.uRingR, g.ringR);
      gl.uniform1f(u.uDrop, g.drop ?? 0);
      gl.uniform1f(u.uRays, g.rays ?? 64);
      gl.uniform1f(u.uOrb, g.orb ?? 1);
      gl.uniform2f(u.uFrameS, g.frame[0], g.frame[1]);
      gl.uniform3f(u.uColIn, 0.93, 0.94, 0.98);
      gl.uniform3f(u.uColOut, 0.2, 0.47, 1.0);
      gl.uniform3f(u.uTint, this.tint[0] ?? 1, this.tint[1] ?? 1, this.tint[2] ?? 1);
      gl.uniform1f(u.uTintK, clamp(this.tintK.x, 0, 1));
      gl.uniform1f(u.uRestCore, this.idleMode === 'dust' ? 1 : 0);
      gl.drawArrays(gl.POINTS, 0, this.N);
    }
    const settling = this.springs().some((s) => !s.rest(0.002));
    const wasDirty = this.dirty;
    this.dirty = false;
    return wasDirty || settling || moving || this.burst > 0 || (voiced && !signal.silent);
  }

  destroy(): void {
    this.cv.removeEventListener('webglcontextlost', this.onLost);
    this.cv.removeEventListener('webglcontextrestored', this.onRestored);
    this.onContext = null;
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }
}
