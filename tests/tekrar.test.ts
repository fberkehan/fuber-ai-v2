// Tekrarlayan hatırlatıcı: aylık tekrar ay sonuna kırpılır ama asıl gün korunur (31 Oca → 28 Şub → 31 Mar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sonrakiZaman } from '../src/main/tekrar.ts';

const GECMIS = 0; // "şimdi" çok geride: kaçan atlama devreye girmesin
const yerel = (iso: string) => { const d = new Date(iso); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]; };

test('aylık: 31 Ocak → 28 Şubat → 31 Mart (asıl gün korunur)', () => {
  const oca = new Date(2027, 0, 31, 10, 0).toISOString();
  const sub = sonrakiZaman(oca, 'aylik', 31, GECMIS)!;
  assert.deepEqual(yerel(sub), [2027, 2, 28, 10, 0]);
  const mar = sonrakiZaman(sub, 'aylik', 31, GECMIS)!;
  assert.deepEqual(yerel(mar), [2027, 3, 31, 10, 0]);
  const nis = sonrakiZaman(mar, 'aylik', 31, GECMIS)!;
  assert.deepEqual(yerel(nis), [2027, 4, 30, 10, 0]);
});

test('aylık: artık yıl 29 Şubat, yıl dönümü ve 30. gün', () => {
  assert.deepEqual(yerel(sonrakiZaman(new Date(2028, 0, 31, 9, 30).toISOString(), 'aylik', 31, GECMIS)!), [2028, 2, 29, 9, 30]);
  assert.deepEqual(yerel(sonrakiZaman(new Date(2027, 11, 31, 8, 0).toISOString(), 'aylik', 31, GECMIS)!), [2028, 1, 31, 8, 0]);
  const sub = sonrakiZaman(new Date(2027, 0, 30, 8, 0).toISOString(), 'aylik', 30, GECMIS)!;
  assert.deepEqual(yerel(sub), [2027, 2, 28, 8, 0]);
  assert.deepEqual(yerel(sonrakiZaman(sub, 'aylik', 30, GECMIS)!), [2027, 3, 30, 8, 0]);
});

test('aylık: asıl gün verilmezse zamanın günü kullanılır (taşma yok)', () => {
  assert.deepEqual(yerel(sonrakiZaman(new Date(2027, 0, 31, 10, 0).toISOString(), 'aylik', null, GECMIS)!), [2027, 2, 28, 10, 0]);
  assert.deepEqual(yerel(sonrakiZaman(new Date(2027, 4, 15, 10, 0).toISOString(), 'aylik', undefined, GECMIS)!), [2027, 6, 15, 10, 0]);
});

test('hafta içi cuma → pazartesi; günlük kaçanları atlar', () => {
  const cuma = new Date(2027, 0, 1, 9, 0); // 1 Oca 2027 Cuma
  assert.equal(cuma.getDay(), 5);
  assert.deepEqual(yerel(sonrakiZaman(cuma.toISOString(), 'hafta_ici', null, GECMIS)!), [2027, 1, 4, 9, 0]);
  const simdi = Date.now();
  const s = new Date(sonrakiZaman(new Date(2020, 0, 1, 7, 45).toISOString(), 'gunluk', null, simdi)!);
  assert.ok(s.getTime() >= simdi && s.getTime() - simdi <= 86_400_000 + 3600_000);
  assert.equal(s.getHours(), 7);
  assert.equal(s.getMinutes(), 45);
});

test('tekrarsız ya da geçersiz zaman → null', () => {
  assert.equal(sonrakiZaman(new Date().toISOString(), 'yok'), null);
  assert.equal(sonrakiZaman('dün akşam', 'gunluk'), null);
});
