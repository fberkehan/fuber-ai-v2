/// <reference types="node" />
// Jeton dosyası diskten okunur (CSS = işlev eşitliği); bu paketin tür ayarında Node türleri yoktur, burada açıkça istenir.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPRING_CSS, SPRING_CSS_BOUNCY, springCurve, springPosition } from './spring-css';

const tokens = fs.readFileSync(path.join(import.meta.dirname, 'tokens.css'), 'utf8');
const token = (name: string): string => {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
  if (!match) throw new Error(`jeton yok: ${name}`);
  return match[1]!.trim();
};

describe('yayın CSS karşılığı', () => {
  it('kritik sönümlü yay aşmadan oturur; sekmeli yay hedefi biraz aşar', () => {
    const calm = Array.from({ length: 60 }, (_, i) => springPosition((i / 59) * 0.6, 0.42, 1));
    expect(Math.max(...calm)).toBeLessThanOrEqual(1);
    expect(calm.at(-1)).toBeGreaterThan(0.99);
    const bouncy = Array.from({ length: 60 }, (_, i) => springPosition((i / 59) * 0.6, 0.36, 0.82));
    expect(Math.max(...bouncy)).toBeGreaterThan(1);
    expect(Math.max(...bouncy)).toBeLessThan(1.03);
  });

  it('eğri 0 ile başlar, tam 1 ile biter', () => {
    const { curve, durationMs } = springCurve({ response: 0.3 });
    expect(curve.startsWith('linear(0, ')).toBe(true);
    expect(curve.endsWith(', 1)')).toBe(true);
    expect(durationMs).toBe(300);
  });

  it('tokens.css içindeki eğriler ve süreler bu işlevin çıktısıdır (tek kaynak)', () => {
    expect(token('--ease-spring')).toBe(SPRING_CSS.curve);
    expect(token('--ease-spring-bouncy')).toBe(SPRING_CSS_BOUNCY.curve);
    expect(token('--duration-spring')).toBe(`${SPRING_CSS.durationMs}ms`);
    expect(token('--duration-spring-bouncy')).toBe(`${SPRING_CSS_BOUNCY.durationMs}ms`);
  });
});
