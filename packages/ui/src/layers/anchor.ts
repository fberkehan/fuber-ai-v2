import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';
export type Placement = `${Side}` | `${Side}-${Exclude<Align, 'center'>}`;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
  side: Side;
  /** `transform-origin`: yüzen öğe tetikleyicinin olduğu yerden büyür. */
  origin: string;
}

const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function parse(placement: Placement): [Side, Align] {
  const [side, align] = placement.split('-') as [Side, Align | undefined];
  return [side, align ?? 'center'];
}

/**
 * Yüzen öğenin konumu (saf işlev). Sığmazsa karşı tarafa döner, sonra pencere kenarına kenetlenir.
 * `margin`: pencere kenarından en az uzaklık.
 */
export function computePosition(
  anchor: Rect,
  floating: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: Placement,
  offset = 8,
  margin = 8,
): Position {
  const [preferred, align] = parse(placement);

  const fits = (side: Side) => {
    switch (side) {
      case 'top':
        return anchor.y - offset - floating.height >= margin;
      case 'bottom':
        return anchor.y + anchor.height + offset + floating.height <= viewport.height - margin;
      case 'left':
        return anchor.x - offset - floating.width >= margin;
      case 'right':
        return anchor.x + anchor.width + offset + floating.width <= viewport.width - margin;
    }
  };
  const side = fits(preferred) || !fits(opposite[preferred]) ? preferred : opposite[preferred];

  let x: number;
  let y: number;
  const vertical = side === 'top' || side === 'bottom';
  if (vertical) {
    y = side === 'top' ? anchor.y - offset - floating.height : anchor.y + anchor.height + offset;
    x =
      align === 'start'
        ? anchor.x
        : align === 'end'
          ? anchor.x + anchor.width - floating.width
          : anchor.x + anchor.width / 2 - floating.width / 2;
  } else {
    x = side === 'left' ? anchor.x - offset - floating.width : anchor.x + anchor.width + offset;
    y =
      align === 'start'
        ? anchor.y
        : align === 'end'
          ? anchor.y + anchor.height - floating.height
          : anchor.y + anchor.height / 2 - floating.height / 2;
  }

  x = Math.min(Math.max(x, margin), Math.max(margin, viewport.width - margin - floating.width));
  y = Math.min(Math.max(y, margin), Math.max(margin, viewport.height - margin - floating.height));

  // Büyüme noktası: tetikleyicinin merkezine en yakın kenar noktası.
  const ox = vertical ? clamp(anchor.x + anchor.width / 2 - x, 0, floating.width) : side === 'left' ? floating.width : 0;
  const oy = vertical ? (side === 'top' ? floating.height : 0) : clamp(anchor.y + anchor.height / 2 - y, 0, floating.height);
  return { x: Math.round(x), y: Math.round(y), side, origin: `${Math.round(ox)}px ${Math.round(oy)}px` };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Tetikleyiciye bağlı konum; boyut, kaydırma ve pencere değişiminde yeniden hesaplanır. */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement,
  offset = 8,
): Position | null {
  const [position, setPosition] = useState<Position | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const a = anchor.getBoundingClientRect();
    const next = computePosition(
      { x: a.left, y: a.top, width: a.width, height: a.height },
      { width: floating.offsetWidth, height: floating.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
      offset,
    );
    setPosition((prev) =>
      prev && prev.x === next.x && prev.y === next.y && prev.side === next.side && prev.origin === next.origin
        ? prev
        : next,
    );
  }, [anchorRef, floatingRef, placement, offset]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    update();
    const observer = new ResizeObserver(update);
    if (floatingRef.current) observer.observe(floatingRef.current);
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update, anchorRef, floatingRef]);

  return position;
}
