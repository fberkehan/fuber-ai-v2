import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bus, MemoryApi } from '@fuber/shared';
import { silentLog, tempStore, testBus } from './brain/testkit';
import { createMemory, memoryFtsQuery } from './memory';
import { applyExtraction } from '../modules/memory/writer';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
});
afterEach(() => env.close());

describe('hafıza: Türkçe arama', () => {
  beforeEach(() => {
    memory.save({ kind: 'commitment', text: 'Her ayın 28’inde KDV beyannamesini vermek gerekiyor.', source: 'voice' });
    memory.save({ kind: 'fact', text: 'Salondaki IŞIK sensörü bozuk.', source: 'chat' });
    memory.save({ kind: 'fact', text: 'Ofis İstanbul, Maslak’ta.', source: 'chat' });
    memory.save({ kind: 'fact', text: 'Kahveyi şekersiz içiyor.', source: 'chat' });
  });

  it('beyanname → "KDV beyannamesini…"', () => {
    const hits = memory.search({ text: 'beyanname' });
    expect(hits[0]?.item.text).toContain('KDV beyannamesini');
    expect(hits[0]?.snippet).toContain('[[');
  });

  it('ışık → "IŞIK"', () => {
    expect(memory.search({ text: 'ışık' })[0]?.item.text).toContain('IŞIK');
  });

  it('istanbul → "İstanbul"', () => {
    expect(memory.search({ text: 'istanbul' })[0]?.item.text).toContain('İstanbul');
  });

  it('doğal cümleden ilgili kaydı bulur (VEYA, ekler kırpılır)', () => {
    const hits = memory.search({ text: 'beyannameleri ne zaman veriyordum?' });
    expect(hits[0]?.item.text).toContain('beyannamesini');
  });

  it('aranabilir sözcük yoksa sorgu çalışmaz', () => {
    expect(memoryFtsQuery('?? !!')).toBeNull();
    expect(memory.search({ text: '?? !!' })).toEqual([]);
  });
});

describe('hafıza: sıralama, çelişki, unutma', () => {
  it('önem sıralamayı etkiler', () => {
    memory.save({ kind: 'fact', text: 'Proje Atlas kütüphaneler için.', source: 'chat', importance: 0.1 });
    memory.save({ kind: 'fact', text: 'Proje Atlas en önemli iş.', source: 'chat', importance: 1 });
    const hits = memory.search({ text: 'atlas' });
    expect(hits[0]?.item.text).toContain('en önemli');
  });

  it('çelişen bilgi eskisini geçersiz işaretler, silmez; aramada yalnız yenisi görünür', () => {
    const old = memory.save({ kind: 'fact', text: 'Atlas Limited’in adresi İzmir Alsancak.', subject: 'Atlas', source: 'chat' });
    const next = memory.supersede(old.id, { kind: 'fact', text: 'Atlas Limited’in adresi İzmir Bornova.', subject: 'Atlas', source: 'chat' });
    expect(memory.get(old.id)).toMatchObject({ status: 'superseded', supersededBy: next.id });
    const hits = memory.search({ text: 'Atlas adres' });
    expect(hits.map((hit) => hit.item.id)).toEqual([next.id]);
    expect(memory.search({ text: 'Alsancak', includeSuperseded: true }).map((hit) => hit.item.id)).toEqual([old.id]);
  });

  it('unut gerçekten siler (kayıt ve dizin)', () => {
    const item = memory.save({ kind: 'fact', text: 'Gizli şifre ipucu: mavi kedi.', source: 'chat' });
    expect(memory.forget(item.id)).toBe(true);
    expect(memory.get(item.id)).toBeNull();
    expect(memory.search({ text: 'mavi kedi' })).toEqual([]);
    const fts = env.store.scoped('memory').get<{ n: number }>('SELECT COUNT(*) AS n FROM memory_fts')!;
    expect(fts.n).toBe(0);
    expect(memory.forget(item.id)).toBe(false);
  });

  it('güncelleme dizini de yeniler', () => {
    const item = memory.save({ kind: 'fact', text: 'Toplantı salı.', source: 'chat' });
    memory.update(item.id, { text: 'Toplantı perşembe.' });
    expect(memory.search({ text: 'salı' })).toEqual([]);
    expect(memory.search({ text: 'perşembe' })[0]?.item.id).toBe(item.id);
  });
});

describe('hafıza yazıcısı: birleştirme', () => {
  it('aynı metni yinelemez, update günceller, supersede eskisini geçersiz yapar', () => {
    const existing = memory.save({ kind: 'fact', text: 'Kullanıcının şirketi Atlas Limited.', subject: 'Atlas', source: 'chat' });
    const written = applyExtraction(
      { memory, log: silentLog },
      {
        items: [
          { action: 'add', target_id: null, kind: 'fact', text: 'Kullanıcının şirketi Atlas Limited.', subject: 'Atlas', importance: 0.8 },
          { action: 'update', target_id: existing.id, kind: 'fact', text: 'Kullanıcının şirketi Atlas Limited, Ankara’da kurulu.', subject: 'Atlas', importance: 0.9 },
          { action: 'add', target_id: null, kind: 'fact', text: 'Kullanıcı kahveyi sütlü içer.', subject: null, importance: 0.3 },
        ],
      },
      { source: 'chat', sessionId: null },
    );
    expect(written).toHaveLength(2);
    expect(memory.get(existing.id)?.text).toContain('Ankara');
    const coffee = written.find((item) => item.text.includes('kahve'))!;
    const replaced = applyExtraction(
      { memory, log: silentLog },
      { items: [{ action: 'supersede', target_id: coffee.id, kind: 'fact', text: 'Kullanıcı kahveyi sade içer.', subject: null, importance: 0.3 }] },
      { source: 'voice', sessionId: null },
    );
    expect(memory.get(coffee.id)?.status).toBe('superseded');
    expect(replaced[0]?.text).toContain('sade');
    expect(memory.stats().facts).toBe(2);
  });
});
