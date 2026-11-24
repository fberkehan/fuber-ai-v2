import { describe, expect, it } from 'vitest';
import { HUD_EDGE, ISLAND_TOP, islandPointer, passthroughGate, placeHud } from './hud';

describe('passthroughGate (ada tıklama geçirme)', () => {
  it('yalnız durum değişince uygular; durum pencere başınadır', () => {
    const calls: Array<[string, boolean]> = [];
    const gate = passthroughGate<{ name: string }>((win, on) => calls.push([win.name, on]));
    const first = { name: 'ilk' };
    // Varsayılan: tıklamayı alır; "almaya devam" çağrısı Electron'a gitmez.
    expect(gate.set(first, false)).toBe(false);
    expect(gate.set(first, true)).toBe(true);
    // Aynı istek tekrarlanınca (her yoklamada) yeniden çağrılmaz.
    expect(gate.set(first, true)).toBe(false);
    // Çöküşten sonra yeni pencere: eski pencerenin "geçiriyor" durumu taşınmaz, ilk "geçir" isteği uygulanır.
    const second = { name: 'yeni' };
    expect(gate.set(second, true)).toBe(true);
    expect(gate.set(first, false)).toBe(true);
    expect(calls).toEqual([
      ['ilk', true],
      ['yeni', true],
      ['ilk', false],
    ]);
  });
});

const primary = { x: 0, y: 0, width: 2560, height: 1392 };
const second = { x: 2560, y: 120, width: 1920, height: 1032 };

describe('placeHud', () => {
  it('ada üst kenara kaynaklıdır: çalışma alanının tepesinden boşluksuz başlar', () => {
    expect(ISLAND_TOP).toBe(0);
    expect(placeHud('island', { width: 360, height: 52 }, second).y).toBe(second.y);
  });

  it('ada çalışma alanının üst ortasındadır ve tam içerik boyutundadır', () => {
    expect(placeHud('island', { width: 360, height: 52 }, primary)).toEqual({ x: 1100, y: ISLAND_TOP, width: 360, height: 52 });
    expect(placeHud('island', { width: 361, height: 52 }, second)).toEqual({ x: 2560 + 780, y: 120 + ISLAND_TOP, width: 361, height: 52 });
  });

  it('toast yığını sağ alttadır, görev çubuğunun üstünde', () => {
    const rect = placeHud('toasts', { width: 340, height: 200 }, primary);
    expect(rect).toEqual({ x: 2560 - 340 - HUD_EDGE, y: 1392 - 200 - HUD_EDGE, width: 340, height: 200 });
    expect(rect.y + rect.height).toBeLessThanOrEqual(primary.height);
  });

  it('sahne sağ kenarda dikey ortadadır', () => {
    expect(placeHud('stage', { width: 400, height: 500 }, second)).toEqual({
      x: 2560 + 1920 - 400 - HUD_EDGE,
      y: 120 + 266,
      width: 400,
      height: 500,
    });
  });

  it('kesirli boyut yukarı yuvarlanır; çalışma alanından büyük içerik kırpılır', () => {
    expect(placeHud('island', { width: 283.2, height: 47.6 }, primary)).toMatchObject({ width: 284, height: 48 });
    const huge = placeHud('stage', { width: 5000, height: 5000 }, second);
    expect(huge).toEqual({ x: 2560 + HUD_EDGE, y: 120 + HUD_EDGE, width: 1920 - 32, height: 1032 - 32 });
  });
});

describe('islandPointer', () => {
  it('imleci pencerenin yatay merkezine ve üst kenarına göre verir', () => {
    const bounds = { x: 1160, y: 0, width: 240, height: 70 };
    expect(islandPointer({ x: 1280, y: 14 }, bounds)).toEqual({ x: 0, y: 14 });
    expect(islandPointer({ x: 1160, y: 0 }, bounds)).toEqual({ x: -120, y: 0 });
    expect(islandPointer({ x: 2000, y: 600 }, bounds)).toEqual({ x: 720, y: 600 });
  });

  it('ikinci ekranda (kaydırılmış köken) da doğru', () => {
    const bounds = { x: 3400, y: 120, width: 240, height: 70 };
    expect(islandPointer({ x: 3520, y: 140 }, bounds)).toEqual({ x: 0, y: 20 });
  });
});
