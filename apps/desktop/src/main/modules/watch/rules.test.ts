// v1 `tests/isler-kurallar.test.ts`ten taşındı (node:test → vitest) ve v2 kurallarına uyarlandı: aralık dizisi aynı
// (×1,5, yukarı yuvarla, en çok max; değişince min), sınırlar katı; koşullar yapay zekâsız değerlendirilir.
// v1'deki WhatsApp/e-posta izin kapsamı ve "İş dili" kuralları v2'de yok (WhatsApp alınmadı, iş kipi kaldırıldı).
import { describe, expect, it } from 'vitest';
import {
  INTERVAL_FACTOR,
  MAX_DURATION_HOURS,
  MAX_INTERVAL_SEC,
  MIN_INTERVAL_SEC,
  addedLines,
  compilePattern,
  containsFolded,
  evaluate,
  firesOnFirstCheck,
  fitInterval,
  nextInterval,
  numberIn,
  parseNumber,
  signatureOf,
  type EvalState,
} from './rules';
import type { WatchCondition } from './types';

const state = (patch: Partial<EvalState> = {}): EvalState => ({
  text: '',
  previousText: null,
  previousValue: null,
  previousMatch: false,
  first: false,
  changed: false,
  ...patch,
});

describe('aralık', () => {
  it('sabitler (v1 ile aynı çarpan; en kısa 10 sn, en uzun 1 saat; iş en çok 7 gün)', () => {
    expect([INTERVAL_FACTOR, MIN_INTERVAL_SEC, MAX_INTERVAL_SEC, MAX_DURATION_HOURS]).toEqual([1.5, 10, 3600, 168]);
  });

  it('değişmedikçe ×1,5 (yukarı yuvarla) max’a dek; değişince min (v1 dizisi birebir)', () => {
    const interval = { minSec: 10, maxSec: 60 };
    const seen: number[] = [];
    let current = 10;
    for (let i = 0; i < 7; i++) {
      current = nextInterval(current, false, interval);
      seen.push(current);
    }
    expect(seen).toEqual([15, 23, 35, 53, 60, 60, 60]);
    expect(nextInterval(53, true, interval)).toBe(10);
  });

  it('plan aralığı kaynağın ve genel sınırların içine oturur', () => {
    const page = { minIntervalSec: 60, maxIntervalSec: 1800 };
    expect(fitInterval({}, page)).toEqual({ minSec: 60, maxSec: 1800 });
    expect(fitInterval({ minSec: 5 }, page)).toEqual({ minSec: 60, maxSec: 1800 });
    expect(fitInterval({ minSec: 120 }, page)).toEqual({ minSec: 120, maxSec: 1800 });
    expect(fitInterval({ minSec: 9999, maxSec: 99_999 }, page)).toEqual({ minSec: 3600, maxSec: 3600 });
    expect(fitInterval({ minSec: 1 }, { minIntervalSec: 1, maxIntervalSec: 30 })).toEqual({ minSec: 10, maxSec: 30 });
  });
});

describe('metin ve sayı', () => {
  it('Türkçe harf ve büyük/küçük harf duyarsız arama', () => {
    expect(containsFolded('ÜRÜN STOKTA VAR', 'stokta')).toBe(true);
    expect(containsFolded('İndirim başladı', 'indirim')).toBe(true);
    expect(containsFolded('Şimdi satışta', 'simdi')).toBe(true);
    expect(containsFolded('tükendi', '   ')).toBe(false);
  });

  it('sayı biçimleri: Türkçe, İngilizce, binlik, ondalık', () => {
    expect(parseNumber('1.299,90')).toBe(1299.9);
    expect(parseNumber('1,299.90')).toBe(1299.9);
    expect(parseNumber('1.299')).toBe(1299);
    expect(parseNumber('12,50')).toBe(12.5);
    expect(parseNumber('2.499.000')).toBe(2_499_000);
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('−3,5')).toBe(-3.5);
  });

  it('sayı yanındaki sözcükle seçilir; sözcük yoksa ilk sayı', () => {
    const page = 'Kargo 49,90 TL\nFiyat: 1.299,90 TL\nStok: 3 adet';
    expect(numberIn(page, 'Fiyat')).toBe(1299.9);
    expect(numberIn(page, 'stok')).toBe(3);
    expect(numberIn(page)).toBe(49.9);
    // Sözcük sayfada yoksa ilk sayı (yerel model "bin" gibi bir sözcük verebiliyor: hiç haber vermemekten iyidir).
    expect(numberIn(page, 'indirim')).toBe(49.9);
    expect(numberIn('Sayfa bakımda', 'Fiyat')).toBeNull();
    expect(numberIn('1.250 TL', 'TL')).toBe(1250);
  });

  it('düzenli ifade: geçersiz ya da çok uzun desen reddedilir', () => {
    expect(compilePattern('stok(ta)? var')).not.toBeNull();
    expect(compilePattern('(')).toBeNull();
    expect(compilePattern('a'.repeat(201))).toBeNull();
    expect(compilePattern('  ')).toBeNull();
  });

  it('yeni satırlar ve imza (boşluk farkı değişiklik sayılmaz)', () => {
    expect(addedLines('a\nb', 'a\nb\nc\nd')).toEqual(['c', 'd']);
    expect(addedLines('a', 'a')).toEqual([]);
    expect(signatureOf('Fiyat  1.299')).toBe(signatureOf('Fiyat 1.299\n'));
    expect(signatureOf('Fiyat 1.299')).not.toBe(signatureOf('Fiyat 1.199'));
  });
});

describe('koşul (yapay zekâsız)', () => {
  it('changed: ilk denetim yalnız taban kaydeder; sonra değişiklik haber verir, yeni satırı anlatır', () => {
    const changed: WatchCondition = { type: 'changed' };
    expect(evaluate(changed, state({ text: 'a', first: true })).fire).toBe(false);
    expect(evaluate(changed, state({ text: 'a', previousText: 'a' })).fire).toBe(false);
    const hit = evaluate(changed, state({ text: 'a\nyeni ilan', previousText: 'a', changed: true }));
    expect(hit.fire).toBe(true);
    expect(hit.finding).toContain('yeni ilan');
    expect(hit.needsModel).toBe(false);
  });

  it('appears: kenar tetikleme — tutmuyorken tutunca haber, tutmaya devam ederken yeniden haber yok; ilk denetimde de', () => {
    const cond: WatchCondition = { type: 'appears', text: 'Stokta' };
    expect(evaluate(cond, state({ text: 'Tükendi', first: true })).fire).toBe(false);
    expect(evaluate(cond, state({ text: 'STOKTA var', changed: true })).fire).toBe(true);
    expect(evaluate(cond, state({ text: 'STOKTA var', previousMatch: true })).fire).toBe(false);
    expect(evaluate(cond, state({ text: 'Stokta', first: true })).fire).toBe(true);
    expect(firesOnFirstCheck(cond)).toBe(true);
    expect(firesOnFirstCheck({ type: 'changed' })).toBe(false);
  });

  it('disappears ve matches', () => {
    expect(evaluate({ type: 'disappears', text: 'tükendi' }, state({ text: 'Satışta' })).fire).toBe(true);
    expect(evaluate({ type: 'disappears', text: 'tükendi' }, state({ text: 'Tükendi' })).fire).toBe(false);
    const regex = evaluate({ type: 'matches', pattern: 'sipariş\\s+#\\d+' }, state({ text: 'Yeni sipariş  #4412 geldi' }));
    expect(regex.fire).toBe(true);
    expect(regex.finding).toContain('#4412');
  });

  it('below/above eşik; drops/rises bir önceki sayıya göre (taban ister)', () => {
    const below = evaluate({ type: 'below', value: 1000, near: 'Fiyat' }, state({ text: 'Fiyat: 999,90 TL' }));
    expect(below).toMatchObject({ fire: true, holds: true, value: 999.9 });
    expect(evaluate({ type: 'below', value: 1000, near: 'Fiyat' }, state({ text: 'Fiyat: 1.299,90 TL' })).fire).toBe(false);
    expect(evaluate({ type: 'above', value: 30, near: 'USD' }, state({ text: 'USD 34,12' })).fire).toBe(true);
    // Sayı bulunmazsa koşul tutmaz (yanlış alarm yok).
    expect(evaluate({ type: 'below', value: 1000, near: 'Fiyat' }, state({ text: 'Sayfa bakımda' })).fire).toBe(false);
    const drop: WatchCondition = { type: 'drops', near: 'Fiyat' };
    expect(evaluate(drop, state({ text: 'Fiyat 1.299', first: true }))).toMatchObject({ fire: false, value: 1299 });
    const fell = evaluate(drop, state({ text: 'Fiyat 1.199', previousValue: 1299, changed: true }));
    expect(fell).toMatchObject({ fire: true, value: 1199 });
    expect(fell.finding).toMatch(/1\.299 → 1\.199/);
    expect(evaluate(drop, state({ text: 'Fiyat 1.399', previousValue: 1299, changed: true })).fire).toBe(false);
    expect(evaluate({ type: 'rises' }, state({ text: '12', previousValue: 10, changed: true })).fire).toBe(true);
  });

  it('ask: yalnız DEĞİŞİKLİKTE modele gider; ilk denetimde ve değişmeyende gitmez', () => {
    const ask: WatchCondition = { type: 'ask', question: 'ilan yayımlandı mı' };
    expect(evaluate(ask, state({ text: 'a', first: true })).needsModel).toBe(false);
    expect(evaluate(ask, state({ text: 'a', previousText: 'a' })).needsModel).toBe(false);
    const changed = evaluate(ask, state({ text: 'a\nb', previousText: 'a', changed: true }));
    expect(changed).toMatchObject({ needsModel: true, fire: false });
  });

  it('olay kaynağı: metin yalnız yeni olaylardır; boşsa hiçbir koşul tutmaz, doluysa ilk denetimde de tutar', () => {
    expect(evaluate({ type: 'changed' }, state({ text: '' }), 'events').fire).toBe(false);
    expect(evaluate({ type: 'changed' }, state({ text: 'atlas: işini bitirdi', first: true, changed: true }), 'events').fire).toBe(true);
    expect(evaluate({ type: 'appears', text: 'muhasebe' }, state({ text: 'muhasebe@x.com — Fatura', previousMatch: true, changed: true }), 'events').fire).toBe(true);
  });
});
