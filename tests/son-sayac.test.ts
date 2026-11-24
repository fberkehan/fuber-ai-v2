// Tek sayaçlı süre (src/shared/son-sayac.ts; 0.13 son düzeltme 7): yeni süre eskisini iptal eder, eski sayaç yeni iletiyi erken silmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sonSayac } from '../src/shared/son-sayac.ts';

test('yeni süre eskisini iptal eder: ilk uyarının 5 sn\'si ikinci uyarıyı silmez', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = sonSayac();
  const calisan: string[] = [];
  s.kur(() => calisan.push('ilk'), 5000);
  t.mock.timers.tick(4000);
  s.kur(() => calisan.push('ikinci'), 5000);
  t.mock.timers.tick(1000);
  assert.deepEqual(calisan, [], 'ilk sayaç 5. saniyede çalışmaz');
  t.mock.timers.tick(4000);
  assert.deepEqual(calisan, ['ikinci']);
  t.mock.timers.tick(10_000);
  assert.deepEqual(calisan, ['ikinci'], 'bir kez');
});

test('iptal: bekleyen süre çalışmaz; boşken iptal zararsız; iptalden sonra yeniden kurulur', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = sonSayac();
  let n = 0;
  s.iptal();
  s.kur(() => { n++; }, 100);
  s.iptal();
  t.mock.timers.tick(1000);
  assert.equal(n, 0);
  s.kur(() => { n++; }, 100);
  t.mock.timers.tick(100);
  assert.equal(n, 1);
  s.iptal();
});
