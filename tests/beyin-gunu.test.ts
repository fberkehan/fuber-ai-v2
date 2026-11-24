// Görev 25 düzeltme 1: Beyin sayfasının "bugün"ü (bölge/motor sayaçları, son 50 olay) diskte; yerel gece yarısı sıfırlanır.
// Düzeltme 3: tek yazım yolu eşzamanlı (gunuYazHemen); geçici dosya adı her yazımda ayrı.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUNLUK_OLAY, GUNLUK_SURUM, gunuOku, gunuYazHemen, yerelGun, type BeyinGunu } from '../src/main/beyin-gunu.ts';
import type { BeyinOlayi } from '../src/shared/beyin.ts';

const klasorler: string[] = [];
const klasor = () => { const k = fs.mkdtempSync(path.join(os.tmpdir(), 'beyin-gunu-')); klasorler.push(k); return k; };
after(() => { for (const k of klasorler) fs.rmSync(k, { recursive: true, force: true }); });
const olay = (id: number): BeyinOlayi => ({ id, zaman: new Date(2026, 9, 25, 12, 0, id % 60).toISOString(), tur: 'basla', bolge: 'ajan', metin: `iş ${id}` });

test('yerelGun: yerel takvim günü (gece yarısında döner)', () => {
  assert.equal(yerelGun(new Date(2026, 9, 25, 23, 59, 59)), '2026-10-25');
  assert.equal(yerelGun(new Date(2026, 9, 26, 0, 0, 1)), '2026-10-26');
});

test('Aynı gün: sayaçlar ve son 50 olay yazılıp okunur (atomik; geçici dosya kalmaz)', () => {
  const k = klasor(), yol = path.join(k, 'beyin-gunu.json');
  const gun = yerelGun(new Date(2026, 9, 25, 10));
  const g: BeyinGunu = { surum: GUNLUK_SURUM, gun, bugun: { ajan: 14, hafiza: 9 }, motorBugun: { anthropic: 38 }, sonZaman: { ajan: '2026-10-25T09:00:00.000Z' }, olaylar: Array.from({ length: 70 }, (_, i) => olay(i + 1)) };
  gunuYazHemen(yol, g);
  const o = gunuOku(yol, gun)!;
  assert.deepEqual(o.bugun, { ajan: 14, hafiza: 9 });
  assert.deepEqual(o.motorBugun, { anthropic: 38 });
  assert.equal(o.olaylar.length, GUNLUK_OLAY);
  assert.equal(o.olaylar.at(-1)!.id, 70, 'en yeniler kalır');
  assert.deepEqual(fs.readdirSync(k), ['beyin-gunu.json']);
});

test('Art arda yazımlar: son yazılan kalır, geçici dosya kalmaz', () => {
  const k = klasor(), yol = path.join(k, 'beyin-gunu.json');
  for (let n = 1; n <= 5; n++) gunuYazHemen(yol, { surum: GUNLUK_SURUM, gun: '2026-10-25', bugun: { ajan: n }, motorBugun: {}, sonZaman: {}, olaylar: [] });
  assert.equal(gunuOku(yol, '2026-10-25')!.bugun.ajan, 5);
  assert.deepEqual(fs.readdirSync(k), ['beyin-gunu.json']);
});

test('Başka günün kaydı, bozuk dosya ya da yok: null (yeni gün sıfırdan)', () => {
  const k = klasor(), yol = path.join(k, 'beyin-gunu.json');
  assert.equal(gunuOku(yol, '2026-10-25'), null);
  gunuYazHemen(yol, { surum: GUNLUK_SURUM, gun: '2026-10-24', bugun: { ajan: 3 }, motorBugun: {}, sonZaman: {}, olaylar: [olay(1)] });
  assert.equal(gunuOku(yol, '2026-10-25'), null, 'dünün kaydı bugüne taşınmaz');
  fs.writeFileSync(yol, '{bozuk');
  assert.equal(gunuOku(yol, '2026-10-24'), null);
});

test('Geçersiz alanlar süzülür (eksi/sayı olmayan sayaç, kimliksiz olay)', () => {
  const k = klasor(), yol = path.join(k, 'beyin-gunu.json');
  fs.writeFileSync(yol, JSON.stringify({ surum: GUNLUK_SURUM, gun: '2026-10-25', bugun: { ajan: -2, hafiza: 'x', not: 4.7 }, motorBugun: null, sonZaman: { ajan: 5 }, olaylar: [{ tur: 'basla' }, olay(9)] }));
  const o = gunuOku(yol, '2026-10-25')!;
  assert.deepEqual(o.bugun, { not: 4 });
  assert.deepEqual(o.motorBugun, {});
  assert.deepEqual(o.sonZaman, {});
  assert.deepEqual(o.olaylar.map((x) => x.id), [9]);
});
