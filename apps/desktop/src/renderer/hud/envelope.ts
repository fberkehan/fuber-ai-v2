import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export interface Size {
  width: number;
  height: number;
}

export const ZERO: Size = { width: 0, height: 0 };

const same = (a: Size, b: Size) => a.width === b.width && a.height === b.height;
export const isEmpty = (size: Size) => size.width === 0 || size.height === 0;

/**
 * Bir öğenin düzen boyutunu (dönüşümden etkilenmeyen, kesirli) izler. Ölçüm aynı karede, boyamadan önce
 * React'e işlenir: ilk kare yanlış boyutla çizilmez.
 */
export function useMeasure<T extends HTMLElement>(): [(node: T | null) => void, Size] {
  const [size, setSize] = useState<Size>(ZERO);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) {
      setSize(ZERO);
      return;
    }
    const next = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0];
      const measured = box ? { width: Math.ceil(box.inlineSize), height: Math.ceil(box.blockSize) } : ZERO;
      // Gözlemci düzenden sonra, boyamadan önce çağrılır; eşzamanlı işlenince kap aynı karede doğru boyda çizilir.
      flushSync(() => setSize((previous) => (same(previous, measured) ? previous : measured)));
    });
    next.observe(node, { box: 'border-box' });
    observer.current = next;
  }, []);

  return [ref, size];
}

/**
 * Zarf: görünen şeklin ve süren geçişin kaplayacağı alan. İçerik büyüyünce zarf hemen büyür (pencere önce
 * büyür, geçiş kırpılmaz); küçülünce `settleMs` sonra küçülür (geçiş bitince). İçerik tümüyle kalkınca
 * (`natural` boş) zarf hemen sıfırlanır ve pencere gizlenir. Art arda gelen değişiklikte bekleme yeniden başlar.
 */
export function useEnvelope(natural: Size, settleMs: number): Size {
  const [envelope, setEnvelope] = useState<Size>(natural);

  useLayoutEffect(() => {
    if (isEmpty(natural)) {
      setEnvelope(ZERO);
      return;
    }
    setEnvelope((previous) => {
      const next = isEmpty(previous)
        ? natural
        : { width: Math.max(previous.width, natural.width), height: Math.max(previous.height, natural.height) };
      return same(previous, next) ? previous : next;
    });
    const timer = setTimeout(() => setEnvelope((previous) => (same(previous, natural) ? previous : natural)), settleMs);
    return () => clearTimeout(timer);
  }, [natural.width, natural.height, settleMs]);

  return envelope;
}

/** Süreli kapanan yüzeyler için: üstüne gelince durur, ayrılınca kalan süreden devam eder. */
export function usePausableTimer(active: boolean, durationMs: number, onExpire: () => void, resetKey: unknown) {
  const latest = useRef(onExpire);
  latest.current = onExpire;
  const state = useRef<{ remaining: number; startedAt: number; timer: ReturnType<typeof setTimeout> | null }>({
    remaining: durationMs,
    startedAt: 0,
    timer: null,
  });

  const stop = useCallback(() => {
    const current = state.current;
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
  }, []);

  const start = useCallback(() => {
    const current = state.current;
    stop();
    current.startedAt = Date.now();
    current.timer = setTimeout(() => latest.current(), Math.max(0, current.remaining));
  }, [stop]);

  useLayoutEffect(() => {
    state.current.remaining = durationMs;
    if (active) start();
    else stop();
    return stop;
  }, [active, durationMs, resetKey, start, stop]);

  const pause = useCallback(() => {
    const current = state.current;
    if (!current.timer) return;
    stop();
    current.remaining -= Date.now() - current.startedAt;
  }, [stop]);

  const resume = useCallback(() => {
    if (active && !state.current.timer) start();
  }, [active, start]);

  return { pause, resume };
}
