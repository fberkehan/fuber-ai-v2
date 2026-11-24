// 0.14 T0 (P14): bulut kapısı — shared/bulut-kapisi.ts. Gizli mod ya da "Yalnız bu bilgisayar" bulutu kapatır; kapalı metinleri yalnız neyin
// kapalı olduğunu söyler (mutlak gizlilik sözü yok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulutYasak, BULUT_KAPALI_METNI } from '../src/shared/bulut-kapisi.ts';

test('bulut kapısı: Gizli ya da Yalnız bu bilgisayar bulutu kapatır', () => {
  assert.equal(bulutYasak({ gizliMod: false, yalnizYerel: false }), false); // ikisi de kapalı: bulut açık
  assert.equal(bulutYasak({ gizliMod: true, yalnizYerel: false }), true); // yalnız Gizli
  assert.equal(bulutYasak({ gizliMod: false, yalnizYerel: true }), true); // yalnız "Yalnız bu bilgisayar"
  assert.equal(bulutYasak({ gizliMod: true, yalnizYerel: true }), true); // ikisi birden
});

test('kapalı metinleri: dört anahtar, kesin metinler (B24 takvim)', () => {
  assert.deepEqual(BULUT_KAPALI_METNI, {
    soz: 'Şarkı sözleri internetten gelir; Gizli modda ve "Yalnız bu bilgisayar" seçiliyken kapalı.',
    web: 'İnternet araması Gizli modda ve "Yalnız bu bilgisayar" seçiliyken kapalı.',
    mcp: 'Bağlı servisler internet üzerinden çalışır; Gizli modda ve "Yalnız bu bilgisayar" seçiliyken kullanılmaz.',
    takvim: 'Gizli modda ve "Yalnız bu bilgisayar" seçiliyken takvim bu bilgisayardaki son kopyadan gösterilir.',
  });
});

test('kapalı metinlerinde mutlak gizlilik sözü yok', () => {
  for (const m of Object.values(BULUT_KAPALI_METNI)) assert.doesNotMatch(m, /hiçbir (şey|veri)|asla .*çıkmaz|tamamen gizli/i);
});
