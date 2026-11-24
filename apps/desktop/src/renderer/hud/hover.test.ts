import { describe, expect, it } from 'vitest';
import { expandable, type View } from './IslandView';
import { HOVER_SLACK, insideShape, pointFromClient, shouldPassThrough } from './hover';

const shape = { width: 240, height: 48 };

describe('ada: imleç biçimin üstünde mi', () => {
  it('gövdenin ortasında içeride, yanında ve altında dışarıda', () => {
    expect(insideShape({ x: 0, y: 20 }, shape)).toBe(true);
    expect(insideShape({ x: 119, y: 47 }, shape)).toBe(true);
    expect(insideShape({ x: -119, y: 0 }, shape)).toBe(true);
    expect(insideShape({ x: 120 + HOVER_SLACK + 1, y: 20 }, shape)).toBe(false);
    expect(insideShape({ x: -(120 + HOVER_SLACK + 1), y: 20 }, shape)).toBe(false);
    expect(insideShape({ x: 0, y: 48 + HOVER_SLACK + 1 }, shape)).toBe(false);
  });

  it('ada yokken (0 × 0) ve konum bilinmezken içeride sayılmaz', () => {
    expect(insideShape({ x: 0, y: 0 }, { width: 0, height: 0 })).toBe(false);
    expect(insideShape(null, shape)).toBe(false);
  });

  it('genişleyen gövde eskisini kapsar: üstüne gelince açılan denetimler imleci dışarıda bırakmaz (titreşim yok)', () => {
    const compact = { width: 200, height: 48 };
    const expanded = { width: 350, height: 48 };
    for (const x of [-100, -40, 0, 60, 100]) {
      const point = { x, y: 24 };
      expect(insideShape(point, compact)).toBe(true);
      expect(insideShape(point, expanded)).toBe(true);
    }
    // Genişlemiş gövdeden çıkan imleç dar gövdenin de dışındadır: kapanınca yeniden içeri düşmez.
    const out = { x: 175 + HOVER_SLACK + 1, y: 24 };
    expect(insideShape(out, expanded)).toBe(false);
    expect(insideShape(out, compact)).toBe(false);
  });
});

describe('ada: tıklamanın geçişi', () => {
  it('biçimin dışında tıklama alttaki uygulamaya geçer, içinde ada alır', () => {
    expect(shouldPassThrough({ x: 0, y: 20 }, shape)).toBe(false);
    // Pencerenin içinde ama gövdenin dışında (omuz ve gölge payı): geçer.
    expect(shouldPassThrough({ x: 128, y: 20 }, shape)).toBe(true);
    expect(shouldPassThrough({ x: 0, y: 62 }, shape)).toBe(true);
    expect(shouldPassThrough({ x: 900, y: 500 }, shape)).toBe(true);
  });

  it('konum bilinmiyorsa geçirir: saydam sahne ekranın üst ortasında görünmez engel olmaz', () => {
    expect(shouldPassThrough(null, shape)).toBe(true);
    expect(shouldPassThrough(null, { width: 0, height: 0 })).toBe(true);
  });
});

describe('ada: sayfa içi fare olayından ada koordinatı', () => {
  it('yatayda pencerenin merkezine, dikeyde üst kenara göre', () => {
    expect(pointFromClient(130, 14, 260)).toEqual({ x: 0, y: 14 });
    expect(pointFromClient(0, 0, 260)).toEqual({ x: -130, y: 0 });
  });
});

describe('ada: hangi hâllerde hızlı denetimler açılır', () => {
  const voice = (state: 'listening' | 'thinking' | 'speaking' | 'followup'): View => ({ kind: 'voice', state });
  it('seyredilen satırlarda açılır', () => {
    for (const state of ['listening', 'thinking', 'speaking', 'followup'] as const) expect(expandable(voice(state))).toBe(true);
    expect(expandable({ kind: 'micOff' })).toBe(true);
    expect(expandable({ kind: 'info', message: 'Yerel sesle devam ediyorum.' })).toBe(true);
  });
  it('kartlarda, uyanışta ve boşta açılmaz', () => {
    expect(expandable(null)).toBe(false);
    expect(expandable({ kind: 'wake' })).toBe(false);
    expect(expandable({ kind: 'banner', title: 'a', body: 'b' })).toBe(false);
    expect(expandable({ kind: 'error', message: 'x'.repeat(80) })).toBe(false);
  });
});
