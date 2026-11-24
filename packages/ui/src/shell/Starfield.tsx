import { useEffect, useRef } from 'react';
import { mulberry } from '../presence/spring';

export interface StarfieldProps {
  /** Sayfa sırası: değişince gökyüzü birkaç piksel kayar (derinlik). */
  shift?: number;
}

/**
 * Yıldızlı gökyüzü (Takımyıldız sahnesi). Tek tuvale bir kez çizilir; kare döngüsü yoktur. Pencere boyutu değişince
 * yeniden çizilir (aynı tohum: yıldızlar yerinden oynamaz). İçeriğin arkasında yalnız soluk toz; parlaklar üst şeritte.
 */
export function Starfield({ shift = 0 }: StarfieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = parent.clientWidth + 24;
      const height = parent.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const random = mulberry(20261116);
      // Yoğunluk alana göre: 1440 × 900'de yaklaşık 260 yıldız; üst bölge biraz daha dolu.
      const count = Math.round((width * height) / 5200);
      for (let i = 0; i < count; i++) {
        const x = random() * width;
        const y = Math.pow(random(), 1.35) * height;
        // Parlak yıldızlar yalnız üst şeritte (orada yazı hap zeminlerinin üstündedir). İçeriğin arkasında yalnız
        // soluk toz kalır: yazının yanına düşen parlak nokta noktalama gibi okunuyordu.
        const calm = y > 96;
        const bright = Math.pow(random(), 6) * (calm ? 0.16 : 1);
        const radius = 0.35 + bright * 0.95 + random() * (calm ? 0.16 : 0.25);
        const alpha = (0.1 + bright * 0.7 + random() * 0.14) * (calm ? 0.72 : 1);
        const cool = random() > 0.72;
        ctx.fillStyle = cool ? `rgba(170,200,255,${alpha.toFixed(3)})` : `rgba(240,242,250,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (bright > 0.55) {
          // En parlak birkaç yıldızın çevresinde yumuşak hale.
          const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 5);
          halo.addColorStop(0, `rgba(200,220,255,${(alpha * 0.22).toFixed(3)})`);
          halo.addColorStop(1, 'rgba(200,220,255,0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, radius * 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);

  // Sayfa sırasına göre ±6 px: komşu sayfaya geçerken gökyüzü hafifçe kayar.
  const offset = ((shift % 5) - 2) * 3;
  return (
    <div className="ui-sky" aria-hidden data-testid="sky">
      <canvas ref={ref} style={{ transform: `translate3d(${offset}px, 0, 0)` }} />
    </div>
  );
}
