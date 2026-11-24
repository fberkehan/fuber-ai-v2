import { describe, expect, it } from 'vitest';
import { ACTION_DURATION, DEFAULT_DURATION, createToastStore } from './store';
import { enter, reducePreset } from '../motion';

describe('toast kuyruğu', () => {
  it('en yeni 3 kart görünür, öndeki en yeni; eskiler silinmez ve geri gelir', () => {
    const store = createToastStore(3);
    const ids = ['a', 'b', 'c', 'd'].map((title) => store.add({ title }));
    expect(store.visible().map((t) => t.title)).toEqual(['d', 'c', 'b']);
    store.dismiss(ids[3]!);
    expect(store.visible().map((t) => t.title)).toEqual(['c', 'b', 'a']);
  });

  it('aynı kimlikle çağrı kartı yerinde günceller ve süreyi yeniler', () => {
    const store = createToastStore(3);
    store.add({ id: 'save', title: 'Kaydediliyor', duration: Infinity });
    store.add({ id: 'save', title: 'Kaydedildi', tone: 'success' });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ title: 'Kaydedildi', tone: 'success', revision: 1, duration: DEFAULT_DURATION });
  });

  it('eylemli kart daha uzun kalır', () => {
    const store = createToastStore(3);
    store.add({ title: 'Silindi', action: { label: 'Geri al', onClick: () => {} } });
    expect(store.list()[0]?.duration).toBe(ACTION_DURATION);
  });

  it('görünür liste değişmedikçe aynı nesnedir (useSyncExternalStore döngüye girmesin)', () => {
    const store = createToastStore(3);
    store.add({ title: 'x' });
    expect(store.visible()).toBe(store.visible());
  });
});

describe('hareket ön ayarları', () => {
  it('azaltılmış harekette konum/ölçek atılır, yalnız saydamlık kalır', () => {
    const reduced = reducePreset(enter.pop);
    expect(reduced.initial).toEqual({ opacity: 0 });
    expect(reduced.animate).toEqual({ opacity: 1 });
    expect(JSON.stringify(reduced)).not.toContain('scale');
  });

  it('hiçbir giriş ölçeği 0\'dan başlamaz', () => {
    for (const preset of Object.values(enter)) {
      const transform = String((preset.initial as { transform?: string }).transform ?? '');
      expect(transform).not.toMatch(/scale\(0(\.0+)?\)/);
    }
  });
});
