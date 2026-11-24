// Ortadaki çekirdek. Dört kip: YÜK (varsayılan: halkalar sakin döner, merkezde gerçek CPU yükü), DİNLEME (mikrofon
// seviyesiyle atan çubuk halka), DÜŞÜNME (hızlı dönen yörünge deseni), KONUŞMA (halkalar hızlanıp yeniden dizilir, merkezde
// TTS çıkış sesinin gerçek RMS seviyesiyle atan dalga). Kipler arası geçiş ~0,5 sn'lik yumuşak karışımla olur. Seviye
// `shell.level` (voice.level olayı: ses katmanının ölçtüğü RMS) üzerinden gelir; rastgele değer üretilmez, yalnız dalganın
// ŞEKLİ (harmonikler) süstür, GENLİĞİ gerçek seviyedir. Halkalar JS ile döndürülür (hız geçişi sıçramasın diye).
import { useEffect, useRef } from 'react';
import type { HudCore, VoiceHudState } from '../../../../main/modules/jarvis/types';
import { levelFromRms } from '../../../../main/modules/jarvis/voice-level';
import { Num, useReduced, useStageScale } from './widgets';

const TAU = Math.PI * 2;
const C = 250;

/** Merkezden `r` yarıçaplı yay yolu (derece, saat yönü; 0 = tepe). */
function arc(r: number, from: number, to: number): string {
  const a0 = ((from - 90) * Math.PI) / 180;
  const a1 = ((to - 90) * Math.PI) / 180;
  const x0 = C + r * Math.cos(a0);
  const y0 = C + r * Math.sin(a0);
  const x1 = C + r * Math.cos(a1);
  const y1 = C + r * Math.sin(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SEGMENTS: Array<[number, number, number]> = [
  [8, 62, 0.95],
  [74, 128, 0.5],
  [140, 176, 0.75],
  [188, 250, 0.9],
  [262, 300, 0.45],
  [312, 352, 0.7],
];

const text = (core: HudCore): string => {
  const f = (v: number | null | undefined, u = '%') => (v === null || v === undefined ? 'YOK' : `${Math.round(v)}${u}`);
  return `ÇEKİRDEK // İŞLEMCİ ${f(core.cpu)} // EKRAN KARTI ${f(core.gpu)} // BELLEK ${f(core.ram)} // VRAM ${f(core.vram)} // SICAKLIK ${f(core.tempC, '°C')} // ${(core.tempSource ?? 'okunamadı').toUpperCase()} //`;
};

type Mode = 'load' | 'listening' | 'thinking' | 'speaking';
const MODES: Mode[] = ['load', 'listening', 'thinking', 'speaking'];
/** Halka sırası: ticks, text, seg, bright, dash. Hız: derece/sn. */
const SPEED: Record<Mode, number[]> = {
  load: [1.5, -3, 5, -22, 11],
  listening: [0.8, -1.5, -3, 12, -6],
  thinking: [6, -30, 30, -140, 95],
  speaking: [8, -14, 22, -60, 38],
};
const SCALE: Record<Mode, number[]> = {
  load: [1, 1, 1, 1, 1],
  listening: [1, 1, 0.93, 0.9, 0.86],
  thinking: [1, 1, 1.02, 0.96, 1.08],
  speaking: [1, 1, 1.05, 0.94, 1.1],
};

const LABEL: Record<Mode, string> = { load: '', listening: 'DİNLİYORUM', thinking: 'DÜŞÜNÜYORUM', speaking: 'KONUŞUYORUM' };

const modeOf = (s: VoiceHudState | undefined): Mode => (s === 'listening' || s === 'thinking' || s === 'speaking' ? s : 'load');

export function Reactor({ core, beatSec, delay, voice, levelRef }: { core: HudCore; beatSec: number; delay: number; voice: VoiceHudState | undefined; levelRef: { current: number } }) {
  const ticks = 180;
  const circ = TAU * 238;
  const reduced = useReduced();
  const scale = useStageScale();
  const root = useRef<HTMLDivElement>(null);
  const groups = useRef<Array<SVGGElement | null>>([null, null, null, null, null]);
  const disc = useRef<SVGCircleElement>(null);
  const glow = useRef<SVGCircleElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loadText = useRef<HTMLDivElement>(null);
  const beatRef = useRef(beatSec);
  beatRef.current = beatSec;
  const modeRef = useRef<Mode>(modeOf(voice));
  modeRef.current = modeOf(voice);
  const mode = modeOf(voice);

  useEffect(() => {
    const cv = canvas.current;
    const el = root.current;
    if (!cv || !el) return;
    const SIZE = 340;
    const dpr = Math.min(3, window.devicePixelRatio || 1) * scale;
    cv.width = Math.round(SIZE * dpr);
    cv.height = Math.round(SIZE * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(el);
    const mix: Record<Mode, number> = { load: 1, listening: 0, thinking: 0, speaking: 0 };
    const ang = [0, 0, 0, 0, 0];
    let last = performance.now();
    let lv = 0;
    let lastRaw = -1;
    let lastRawAt = 0;
    let prevLv = 0;
    const pulses: Array<{ r: number; a: number }> = [];
    let raf = 0;

    const frame = (now: number) => {
      const raw = (now - last) / 1000;
      const dt = Math.min(0.1, raw);
      last = now;
      const target = modeRef.current;
      // karışım gerçek geçen süreye göre ilerler (gizli/arka plan pencerede kareler seyrek olsa da geçiş tamamlanır)
      const k = 1 - Math.exp(-Math.min(1, raw) / 0.28);
      for (const m of MODES) mix[m] += ((m === target ? 1 : 0) - mix[m]) * (reduced ? 1 : k);

      // gerçek seviye (voice.level → RMS → algısal seviye); değer değişmiyorsa ses kesilmiştir
      let level = 0;
      if (target === 'speaking' || target === 'listening') {
        const rms = levelRef.current;
        if (rms !== lastRaw) {
          lastRaw = rms;
          lastRawAt = now;
        }
        level = now - lastRawAt < 260 ? levelFromRms(rms) : 0;
      }
      lv += (level - lv) * (level > lv ? 1 - Math.exp(-dt / 0.045) : 1 - Math.exp(-dt / 0.16));

      // halkalar: hız ve ölçek karışımı
      for (let i = 0; i < 5; i += 1) {
        let sp = 0;
        let sc = 0;
        for (const m of MODES) {
          sp += mix[m] * SPEED[m][i]!;
          sc += mix[m] * SCALE[m][i]!;
        }
        if (i === 2) sc += 0.03 * lv * (mix.speaking + mix.listening * 0.5);
        if (i === 4) sc += 0.02 * lv * mix.speaking;
        if (!reduced) ang[i] = ((ang[i]! + sp * dt) % 360 + 360) % 360;
        groups.current[i]?.setAttribute('transform', `translate(${C} ${C}) rotate(${ang[i]!.toFixed(2)}) scale(${sc.toFixed(4)}) translate(${-C} ${-C})`);
      }
      // sakin atış (YÜK kipi): nabız süresiyle (saat bağlıysa gerçek BPM) kısa bir kabarma
      const phase = ((now / 1000) % beatRef.current) / beatRef.current;
      const beat = reduced || phase > 0.16 ? 0 : Math.sin((Math.PI * phase) / 0.16);
      const discScale = 1 + 0.035 * beat * mix.load + 0.07 * lv * mix.speaking + 0.04 * lv * mix.listening;
      disc.current?.setAttribute('transform', `translate(${C} ${C}) scale(${discScale.toFixed(4)}) translate(${-C} ${-C})`);
      if (glow.current) glow.current.style.opacity = String(0.6 + 0.4 * Math.min(1, beat * mix.load + lv * 1.2 * (mix.speaking + mix.listening)));
      if (loadText.current) loadText.current.style.opacity = String(mix.load);

      // merkez tuvali
      const accent = style.getPropertyValue('--jv-accent').trim() || '#34d8f4';
      const bright = style.getPropertyValue('--jv-bright').trim() || '#9cf0ff';
      const t = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      const cx = SIZE / 2;
      const cy = SIZE / 2;
      cv.style.opacity = String(1 - mix.load);

      if (mix.speaking > 0.02) {
        ctx.save();
        ctx.globalAlpha = mix.speaking;
        // yükselen seviyede dışa yayılan halka (gerçek seviye eşiği aşınca)
        if (lv - prevLv > 0.07 && lv > 0.25) pulses.push({ r: 70, a: 0.7 });
        for (const p of pulses) {
          p.r += 120 * dt;
          p.a -= 1.1 * dt;
        }
        while (pulses.length && pulses[0]!.a <= 0) pulses.shift();
        for (const p of pulses) {
          ctx.strokeStyle = bright;
          ctx.globalAlpha = Math.max(0, p.a) * mix.speaking;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, p.r, 0, TAU);
          ctx.stroke();
        }
        // radyal dalga: genlik = gerçek seviye; harmonikler yalnız şekil
        const N = 140;
        for (let layer = 0; layer < 3; layer += 1) {
          ctx.beginPath();
          for (let n = 0; n <= N; n += 1) {
            const th = (n / N) * TAU;
            const w = (Math.sin(2 * th + t * 3.1 + layer) + 0.6 * Math.sin(5 * th - t * 4.3 + layer * 2) + 0.35 * Math.sin(9 * th + t * 6.2)) / 1.95;
            const r = 52 + layer * 9 + lv * (26 - layer * 5) * (0.55 + 0.45 * w) + lv * 6;
            const x = cx + r * Math.cos(th);
            const y = cy + r * Math.sin(th);
            if (n === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = layer === 0 ? bright : accent;
          ctx.globalAlpha = mix.speaking * (layer === 0 ? 0.95 : 0.55 - layer * 0.15);
          ctx.lineWidth = layer === 0 ? 2 : 1.2;
          ctx.shadowColor = accent;
          ctx.shadowBlur = layer === 0 ? 10 : 0;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60 + lv * 30);
        g.addColorStop(0, accent);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = mix.speaking * (0.1 + 0.4 * lv);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, 60 + lv * 30, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      if (mix.listening > 0.02) {
        ctx.save();
        const bars = 60;
        for (let n = 0; n < bars; n += 1) {
          const th = (n / bars) * TAU - Math.PI / 2;
          // çubuk uzunluğu gerçek mikrofon seviyesidir; çubuklar arası fark yalnız şekil
          const shape = 0.55 + 0.45 * Math.abs(Math.sin(n * 0.7 + t * 2.4));
          const len = 5 + lv * 46 * shape;
          const r0 = 66;
          ctx.beginPath();
          ctx.moveTo(cx + r0 * Math.cos(th), cy + r0 * Math.sin(th));
          ctx.lineTo(cx + (r0 + len) * Math.cos(th), cy + (r0 + len) * Math.sin(th));
          ctx.strokeStyle = bright;
          ctx.globalAlpha = mix.listening * (0.45 + 0.5 * Math.min(1, lv * 1.6));
          ctx.lineWidth = 2.2;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, 52 + lv * 8, 0, TAU);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = mix.listening * 0.8;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 10 + lv * 18, 0, TAU);
        ctx.fillStyle = accent;
        ctx.globalAlpha = mix.listening * (0.25 + 0.5 * lv);
        ctx.fill();
        ctx.restore();
      }

      if (mix.thinking > 0.02) {
        ctx.save();
        const orbits: Array<[number, number, number]> = [
          [62, 2.4, 1],
          [80, -1.7, 0.75],
          [98, 3.1, 0.55],
        ];
        for (const [r, w, a] of orbits) {
          const head = t * w;
          for (let s = 0; s < 26; s += 1) {
            const th = head - s * 0.075 * Math.sign(w);
            ctx.beginPath();
            ctx.arc(cx + r * Math.cos(th), cy + r * Math.sin(th), 3.4 * (1 - s / 30), 0, TAU);
            ctx.fillStyle = s === 0 ? bright : accent;
            ctx.globalAlpha = mix.thinking * a * (1 - s / 26);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.strokeStyle = accent;
          ctx.globalAlpha = mix.thinking * 0.12;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }
      prevLv = lv;
      if (!reduced || mix[target] < 0.99) raf = requestAnimationFrame(frame);
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced, scale, levelRef]);

  return (
    <div ref={root} className="jv-reactor" style={{ ['--beat' as string]: `${beatSec}s`, ['--d' as string]: `${delay}ms` }} data-testid="jv-reactor" data-mode={mode}>
      <svg viewBox="0 0 500 500" width="500" height="500" aria-hidden>
        <defs>
          <radialGradient id="jv-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--jv-accent)" stopOpacity=".34" />
            <stop offset=".62" stopColor="var(--jv-accent)" stopOpacity=".08" />
            <stop offset="1" stopColor="var(--jv-accent)" stopOpacity="0" />
          </radialGradient>
          <path id="jv-ring-text" d={`M${C} ${C}m-226 0a226 226 0 1 1 452 0a226 226 0 1 1-452 0`} />
        </defs>
        <circle ref={glow} cx={C} cy={C} r="248" fill="url(#jv-core-glow)" className="jv-glow" />
        <g ref={(n) => void (groups.current[0] = n)}>
          <circle cx={C} cy={C} r="238" className="jv-tk" strokeDasharray={`1 ${(circ / ticks - 1).toFixed(3)}`} />
          <circle cx={C} cy={C} r="241" className="jv-tk long" strokeDasharray={`1.6 ${(circ / (ticks / 5) - 1.6).toFixed(3)}`} />
        </g>
        <g ref={(n) => void (groups.current[1] = n)}>
          <text className="jv-ringtext">
            <textPath href="#jv-ring-text" startOffset="0">
              {text(core)}
            </textPath>
          </text>
        </g>
        <circle cx={C} cy={C} r="214" className="jv-hair" />
        <g ref={(n) => void (groups.current[2] = n)}>
          {SEGMENTS.map(([a, b, o], i) => (
            <path key={i} d={arc(196, a, b)} className="jv-seg" style={{ opacity: o }} />
          ))}
        </g>
        <circle cx={C} cy={C} r="166" className="jv-hair" />
        <g ref={(n) => void (groups.current[3] = n)}>
          <path d={arc(166, 20, 96)} className="jv-bright" />
          <path d={arc(166, 200, 232)} className="jv-bright thin" />
          <path d={arc(166, 292, 330)} className="jv-bright" />
        </g>
        <g ref={(n) => void (groups.current[4] = n)}>
          <circle cx={C} cy={C} r="138" className="jv-dash" />
        </g>
        <circle ref={disc} cx={C} cy={C} r="112" className="jv-disc" />
        <circle cx={C} cy={C} r="106" className="jv-hair" />
      </svg>
      <canvas ref={canvas} className="jv-core-canvas" style={{ width: 340, height: 340 }} />
      <div ref={loadText} className="jv-core-text">
        <span className="jv-core-label">{core.label}</span>
        <span className="jv-core-value">
          <Num value={Number(core.value)} />
          <small>{core.unit}</small>
        </span>
        <span className="jv-core-sub">{core.sub}</span>
      </div>
      <div className="jv-core-mode" aria-live="polite" data-testid="jv-core-mode">
        {LABEL[mode]}
      </div>
    </div>
  );
}
