import { describe, expect, it } from 'vitest';
import { testBus } from '../../core/brain/testkit';
import { createActivityEmitter } from './activity';
import type { PcActivity } from './types';

const using = (action: PcActivity['action'] = 'type') => ({ active: true, action, app: 'Not Defteri', interrupted: null, point: null });
const done = { active: false, action: null, app: null, interrupted: null, point: null };

function setup() {
  const bus = testBus();
  const seen: Array<Pick<PcActivity, 'active' | 'interrupted' | 'source'>> = [];
  bus.on('pc.activity', (event) => void seen.push({ active: event.active, interrupted: event.interrupted, source: event.source }));
  return { bus, seen, pc: createActivityEmitter(bus, 'pc'), browser: createActivityEmitter(bus, 'browser') };
}

describe('ada etkinlik kanalı: iki yayıncı (bilgisayar, tarayıcı) birbirinin satırını kaldırmaz', () => {
  it('tek yayıncı: sürüyor → bitti olağan yayınlanır', () => {
    const { pc, seen } = setup();
    expect(pc.emit(using())).toBe(true);
    expect(pc.emit(done)).toBe(true);
    expect(seen).toEqual([
      { active: true, interrupted: null, source: 'pc' },
      { active: false, interrupted: null, source: 'pc' },
    ]);
  });

  it('bilgisayarın GEÇ gelen "bitti"si tarayıcının süren satırını kaldırmaz; tarayıcı kendi bitişini söyler', () => {
    const { pc, browser, seen } = setup();
    pc.emit(using());
    // Bilgisayar eylemi bitti, oyalanma süresi işliyor; o arada tarayıcı başladı.
    browser.emit(using('browser'));
    expect(pc.emit(done)).toBe(false);
    expect(seen.at(-1)).toEqual({ active: true, interrupted: null, source: 'browser' });
    expect(browser.emit(done)).toBe(true);
    expect(seen.at(-1)).toEqual({ active: false, interrupted: null, source: 'browser' });
    // Satır kalktıktan sonra gelen ikinci "bitti" zararsızdır.
    expect(pc.emit(done)).toBe(true);
  });

  it('adsız yayın (uçtan uca sınamanın elle yayını) da korunur: `pc.mjs`teki "Durdur" kaybolması', () => {
    const { bus, pc, seen } = setup();
    pc.emit(using());
    bus.emit('pc.activity', { ...using(), at: new Date().toISOString() });
    expect(pc.emit(done)).toBe(false);
    expect(seen.at(-1)).toMatchObject({ active: true });
  });

  it('kesilme ("durduruldu") her zaman yayınlanır: durdurma bütün yayıncıları durdurur', () => {
    const { pc, browser, seen } = setup();
    browser.emit(using('browser'));
    expect(pc.emit({ ...done, interrupted: 'panic' })).toBe(true);
    expect(seen.at(-1)).toEqual({ active: false, interrupted: 'panic', source: 'pc' });
  });

  it('bırakılan yayıncı kanalı dinlemez', () => {
    const { bus, pc } = setup();
    pc.dispose();
    bus.emit('pc.activity', { ...using(), source: 'browser', at: new Date().toISOString() });
    // Dinlemediği için sahibi bilmez; kendi "bitti"sini yayınlar (modül kapanırken yayın zaten yapılmaz).
    expect(pc.emit(done)).toBe(true);
  });
});
