// Fuber imleci katmanı (her ekranda bir tane). Ana süreç 'imlec:komut' gönderir; hareket, yardımcının gerçek imleci
// götürdüğü AYNI kavis ve kolaylaştırma eğrisiyle çizilir (native/fuber-girdi/Program.cs → Yolla).
import { dinle } from './api';
import { ACIL_YEDEK, acilDurdurmaDinle } from './acil-kisayol';

// Şeritteki acil durdurma: tuş yalnız gerçekten alındıysa yazılır, alınamadıysa tepsiye yönlendirir (Görev 20b düzeltme turu 2).
const acil = document.getElementById('acil');
acilDurdurmaDinle((tus) => { if (acil) acil.textContent = tus ?? ACIL_YEDEK; });

const imlec = document.getElementById('imlec') as HTMLDivElement;
const rozet = document.getElementById('rozet') as HTMLDivElement;
let konum: { x: number; y: number } | null = null;
let anim = 0;
let rozetZaman: ReturnType<typeof setTimeout> | null = null;

const kolay = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const yerlestir = (x: number, y: number) => { imlec.style.transform = `translate(${x}px, ${y}px)`; konum = { x, y }; };

function iz(x: number, y: number, eylem: string): void {
  const adet = eylem === 'cift' ? 2 : 1;
  for (let i = 0; i < adet; i++) {
    setTimeout(() => {
      const h = document.createElement('div');
      h.className = `halka${eylem === 'sag' ? ' sag' : ''}`;
      h.style.left = `${x}px`; h.style.top = `${y}px`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 650);
    }, i * 160);
  }
}

function git(v: { x: number; y: number; bx: number | null; by: number | null; sure: number; eylem: string }): void {
  cancelAnimationFrame(anim);
  const bas = v.bx !== null && v.by !== null ? { x: v.bx, y: v.by } : konum ?? { x: v.x, y: v.y };
  imlec.classList.add('gorunur');
  // Hafif kavis (Program.cs Yolla ile aynı kontrol noktası): insan eli gibi düz değil, yumuşak.
  const dx = v.x - bas.x, dy = v.y - bas.y;
  const kx = bas.x + dx * 0.5 - dy * 0.12, ky = bas.y + dy * 0.5 + dx * 0.12;
  const t0 = performance.now();
  const adim = (s: number) => {
    const t = Math.min(1, (s - t0) / Math.max(1, v.sure));
    const e = kolay(t);
    const x = (1 - e) * (1 - e) * bas.x + 2 * (1 - e) * e * kx + e * e * v.x;
    const y = (1 - e) * (1 - e) * bas.y + 2 * (1 - e) * e * ky + e * e * v.y;
    yerlestir(x, y);
    if (t < 1) anim = requestAnimationFrame(adim);
    else if (v.eylem && v.eylem !== 'bak') iz(v.x, v.y, v.eylem);
  };
  anim = requestAnimationFrame(adim);
}

dinle('imlec:komut', (v: { tur: string; [k: string]: any }) => {
  if (v.tur === 'kontrol') {
    document.body.classList.toggle('acik', Boolean(v.acik));
    if (!v.acik) { imlec.classList.remove('gorunur'); rozet.classList.remove('gorunur'); }
  } else if (v.tur === 'git') git(v as never);
  else if (v.tur === 'iz') iz(v.x, v.y, v.eylem);
  else if (v.tur === 'sakla') imlec.classList.remove('gorunur');
  else if (v.tur === 'rozet') {
    if (!konum) yerlestir(v.x, v.y);
    imlec.classList.add('gorunur');
    rozet.textContent = v.metin;
    rozet.style.left = `${(konum?.x ?? v.x) + 26}px`;
    rozet.style.top = `${(konum?.y ?? v.y) + 58}px`;
    rozet.classList.add('gorunur');
    if (rozetZaman) clearTimeout(rozetZaman);
    rozetZaman = setTimeout(() => rozet.classList.remove('gorunur'), v.ms ?? 1400);
  }
});
