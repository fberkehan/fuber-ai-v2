// Etkinlik sayfasının saf yardımcıları (src/shared/etkinlik.ts; Görev 1, Karar D1; 0.13 T15: Parçalar listesi kalktı): Akış satırının saniyeli
// saati, Akış'ın düz cümlelerle süzülmüş satırları ve eski "beyin" sayfa adının Etkinlik'e çözülmesi (telefondan ya da kayıtlı bir yerden gelen
// `ana:git('beyin')` boş sayfa açmasın).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { akisSaati, akisSatirlari, sayfaAdiCoz } from '../src/shared/etkinlik.ts';
import type { BeyinOlayi } from '../src/shared/beyin.ts';

const olay = (o: Partial<BeyinOlayi>): BeyinOlayi => ({ id: 1, zaman: '2026-10-31T09:00:00.000Z', tur: 'sinyal', bolge: 'ajan', ...o } as BeyinOlayi);

test('akış saati saniyeli', () => assert.equal(akisSaati(new Date(2026, 9, 27, 9, 5, 7).toISOString()), '09:05:07'));

test('akış saati 24 saat; geçersiz zaman boş', () => {
  assert.equal(akisSaati(new Date(2026, 9, 27, 23, 59, 59).toISOString()), '23:59:59');
  assert.equal(akisSaati(new Date(2026, 9, 28, 0, 0, 0).toISOString()), '00:00:00');
  assert.equal(akisSaati('bozuk'), '');
});

test("akış: en yenisi üstte, düz cümleler; başla/bitti gürültüsü ve İş'te Kod süzülür", () => {
  const l = akisSatirlari([
    olay({ id: 1, tur: 'sinyal', bolge: 'ajan', hedef: 'iletisim', metin: 'E-postalara bakıyor' }),
    olay({ id: 2, tur: 'bitti', bolge: 'ajan' }),
    olay({ id: 3, tur: 'sinyal', bolge: 'ajan', hedef: 'kod', metin: 'kod işi verdi', ayrinti: 'Claude Code' }),
    olay({ id: 4, tur: 'sinyal', bolge: 'iletisim', hedef: 'ajan', metin: '3 e-posta okundu' }),
  ], 'is');
  assert.deepEqual(l.map((x) => x.o.id), [4, 1]);
  assert.equal(l[0].m.ust, '3 e-posta okundu');
  assert.equal(l[1].m.ust, 'E-postalara bakıyor');
});

test('akış: peş peşe aynı satır tek satır olur (araç hem sinyal hem başlangıç olayı yazar); arada başka olay varsa ikisi kalır', () => {
  const l = akisSatirlari([
    olay({ id: 1, tur: 'sinyal', bolge: 'ajan', hedef: 'saat', metin: 'Hatırlatıcı kuruyor' }),
    olay({ id: 2, tur: 'basla', bolge: 'saat', metin: 'Hatırlatıcı kuruyor' }),
    olay({ id: 3, tur: 'sinyal', bolge: 'saat', hedef: 'ajan', metin: 'Hatırlatıcı kuruldu' }),
    olay({ id: 4, tur: 'sinyal', bolge: 'ajan', hedef: 'saat', metin: 'Hatırlatıcı kuruyor' }),
  ], 'is');
  assert.deepEqual(l.map((x) => x.o.id), [4, 3, 1]);
});

test('akış: en çok istenen kadar satır, en yeniler', () => {
  const o = Array.from({ length: 10 }, (_, i) => olay({ id: i + 1, bolge: 'ajan', hedef: 'ses', metin: `adım ${i}` }));
  assert.deepEqual(akisSatirlari(o, 'gelistirici', 3).map((x) => x.o.id), [10, 9, 8]);
});

test('eski sayfa adı', () => {
  assert.equal(sayfaAdiCoz('beyin'), 'etkinlik');
  assert.equal(sayfaAdiCoz('hafiza'), 'hafiza');
  assert.equal(sayfaAdiCoz('etkinlik'), 'etkinlik');
});
