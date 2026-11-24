import { describe, expect, it } from 'vitest';
import { currentSentence, tailWords, thinkingLine } from './live-text';

describe('currentSentence', () => {
  it('son cümleyi ve sırasını verir', () => {
    expect(currentSentence('Tabii efendim. Yarın on birde hatırlatacağım.')).toEqual({ index: 1, text: 'Yarın on birde hatırlatacağım.' });
    expect(currentSentence('Tabii efendim.')).toEqual({ index: 0, text: 'Tabii efendim.' });
    expect(currentSentence('')).toEqual({ index: 0, text: '' });
  });

  it('uzun cümlede son sözcükleri gösterir; sözcük ortasından kesmez', () => {
    const long = Array.from({ length: 40 }, (_, i) => `sözcük${i}`).join(' ');
    const { text } = currentSentence(long, 60);
    expect(text.startsWith('… ')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(60);
    expect(text.endsWith('sözcük39')).toBe(true);
    expect(text.slice(2).split(' ').every((word) => /^sözcük\d+$/.test(word))).toBe(true);
  });
});

describe('tailWords', () => {
  it('kısa metne dokunmaz', () => {
    expect(tailWords('Yarın saat onda', 46)).toBe('Yarın saat onda');
  });

  it('uzun metnin sonunu bir sözcüğün başından verir', () => {
    const tail = tailWords('Yarın saat on birde muhasebeciyi aramayı hatırlat', 34);
    expect(tail).toBe('… muhasebeciyi aramayı hatırlat');
    expect(tail.length).toBeLessThanOrEqual(34);
  });
});

describe('thinkingLine', () => {
  it('araç yokken "Düşünüyorum", araç varken modülün cümlesi', () => {
    expect(thinkingLine(null)).toBe('Düşünüyorum');
    expect(thinkingLine('planner')).toBe('Planlara bakıyorum');
    expect(thinkingLine('bilinmeyen-modul')).toBe('Üzerinde çalışıyorum');
  });
});
