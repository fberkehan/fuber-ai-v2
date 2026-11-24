import { describe, expect, it } from 'vitest';
import { dataSignature, initials, stamp } from './live-update';

describe('canlı kart yardımcıları', () => {
  it('baş harfler: iki sözcükte ilk ve son, tek sözcükte iki harf, numarada #', () => {
    expect(initials('Ayşe Demir')).toBe('AD');
    expect(initials('ismail hakkı yılmaz')).toBe('İY');
    expect(initials('Atlas')).toBe('AT');
    expect(initials('+90 500 000 00 00')).toBe('#');
    expect(initials('  ')).toBe('#');
  });

  it('saat: bugünse HH:MM, değilse gün adı', () => {
    const now = new Date(2026, 10, 17, 15, 0);
    expect(stamp(new Date(2026, 10, 17, 9, 5).toISOString(), now)).toBe('09:05');
    expect(stamp(new Date(2026, 10, 16, 9, 5).toISOString(), now)).not.toMatch(/^\d\d:\d\d$/);
    expect(stamp(null, now)).toBe('');
  });

  it('imza: aynı içerik aynı imza, değişen içerik farklı', () => {
    expect(dataSignature({ a: 1, b: [2] })).toBe(dataSignature({ a: 1, b: [2] }));
    expect(dataSignature({ a: 1 })).not.toBe(dataSignature({ a: 2 }));
  });
});
