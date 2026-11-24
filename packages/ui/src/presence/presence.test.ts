import { describe, expect, it } from 'vitest';
import { Signal, shapeLevel } from './signal';
import { Spring, mulberry } from './spring';
import { PRESENCE_LABELS, PRESENCE_STATES, isLiveState } from './types';

const run = (spring: Spring, seconds: number, reduced = false, dt = 1 / 60) => {
  const trace: number[] = [];
  for (let t = 0; t < seconds; t += dt) trace.push(spring.step(dt, reduced));
  return trace;
};

describe('Spring', () => {
  it('hedefe oturur ve oturduğunu bildirir', () => {
    const spring = new Spring(0, 440, 34).to(300);
    expect(spring.rest()).toBe(false);
    run(spring, 1);
    expect(spring.x).toBeCloseTo(300, 1);
    expect(spring.rest()).toBe(true);
  });

  it('yarıda kesilince sıçramaz: konum sürekli kalır ve hız korunarak yön değişir', () => {
    const spring = new Spring(0, 440, 34).to(300);
    run(spring, 0.12);
    const at = spring.x;
    const speed = spring.v;
    expect(speed).toBeGreaterThan(0);
    spring.to(40);
    const next = spring.step(1 / 60);
    // Bir karede konum en çok hız × süre kadar oynar (ışınlanma yok); hız hemen sıfırlanmaz.
    expect(Math.abs(next - at)).toBeLessThan(Math.abs(speed) / 60 + 2);
    run(spring, 1);
    expect(spring.x).toBeCloseTo(40, 1);
  });

  it('gizli pencerede seyrek gelen büyük adımda da kararlıdır (alt adımlar)', () => {
    const spring = new Spring(0, 520, 36).to(48);
    spring.step(0.75);
    expect(Number.isFinite(spring.x)).toBe(true);
    expect(spring.x).toBeGreaterThan(40);
    expect(spring.x).toBeLessThan(56);
  });

  it('azaltılmış harekette aşma yoktur', () => {
    const spring = new Spring(0, 360, 17).to(34);
    const trace = run(spring, 0.8, true);
    expect(Math.max(...trace)).toBeLessThanOrEqual(34.001);
    expect(spring.x).toBeCloseTo(34, 1);
    // Aynı yay tam harekette hedefi aşar (uyanıştaki damla).
    const bouncy = new Spring(0, 360, 17).to(34);
    expect(Math.max(...run(bouncy, 0.8))).toBeGreaterThan(34.5);
  });

  it('tohumlu rastgele yinelenebilir', () => {
    const a = mulberry(7);
    const b = mulberry(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('Signal', () => {
  it('konuşma düzeyini 0..1 aralığına taşır; sessizlik sıfırdır', () => {
    expect(shapeLevel(0)).toBe(0);
    expect(shapeLevel(0.004)).toBe(0);
    expect(shapeLevel(0.05)).toBeGreaterThan(0.3);
    expect(shapeLevel(0.5)).toBe(1);
  });

  it('çıkışta hızlı, inişte yavaştır ve sessizlikte tümüyle söner', () => {
    const signal = new Signal();
    for (let i = 0; i < 6; i++) signal.update(1 / 60, 0.2);
    const risen = signal.level;
    expect(risen).toBeGreaterThan(0.6);
    for (let i = 0; i < 6; i++) signal.update(1 / 60, 0);
    expect(signal.level).toBeGreaterThan(risen * 0.25);
    expect(signal.silent).toBe(false);
    for (let i = 0; i < 240; i++) signal.update(1 / 60, 0);
    expect(signal.level).toBe(0);
    expect(signal.silent).toBe(true);
  });

  it('hece başlangıcında darbe üretir ve geçmişi en yeniden eskiye tutar', () => {
    const signal = new Signal();
    signal.update(1 / 30, 0.25);
    expect(signal.onset).toBeGreaterThan(0.2);
    for (let i = 0; i < 20; i++) signal.update(1 / 60, 0.25);
    expect(signal.hist[0]).toBeGreaterThan(0.5);
    for (let i = 0; i < 8; i++) signal.update(1 / 60, 0);
    // Yeni örnekler düşerken eski örnekler hâlâ yüksek: dalga akış boyunca yol alır.
    expect(signal.hist[0]!).toBeLessThan(signal.hist[10]!);
  });
});

describe('hâller', () => {
  it('her hâlin ekran okuyucu adı vardır', () => {
    for (const state of PRESENCE_STATES) expect(PRESENCE_LABELS[state].length).toBeGreaterThan(3);
  });

  it('yalnız sinyal izleyen hâller sürekli kare ister; boşta ve durağan hâllerde döngü durur', () => {
    expect(PRESENCE_STATES.filter(isLiveState)).toEqual(['listening', 'followup', 'thinking', 'speaking', 'computer']);
    expect(isLiveState('idle')).toBe(false);
    expect(isLiveState('muted')).toBe(false);
  });
});
