/**
 * Sayarak artan rakam (v1 Yönetim'in `useSayac` kalıbı): değer değişince eskisinden yenisine 720 ms'de, sonu
 * yumuşayan eğriyle akar. İlk gerçek değer geldiğinde sıfırdan sayar; azaltılmış harekette anında yerine oturur.
 * Kare döngüsü yalnız sayım sürerken döner (süs için döngü yok).
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@fuber/ui';

export const COUNT_UP_MS = 720;

export function useCountUp(target: number | null | undefined, ms = COUNT_UP_MS): number | null {
  const reduced = useReducedMotion() ?? false;
  const [value, setValue] = useState<number | null>(target ?? null);
  const previous = useRef<number | null>(target ?? null);

  useEffect(() => {
    if (target === null || target === undefined || !Number.isFinite(target)) {
      previous.current = null;
      setValue(null);
      return;
    }
    const from = previous.current ?? 0;
    previous.current = target;
    if (from === target || reduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - progress) ** 3;
      setValue(progress >= 1 ? target : from + (target - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setValue(target);
    };
  }, [target, ms, reduced]);

  return value;
}
