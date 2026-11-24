// Konuşmanın sonu (Görev 21): sessizlik kesimi 1,1 sn → 0,7 sn. Ölçüm: 60 ms'lik seviye örnekleriyle sentetik bir Türkçe soru
// (cümle içi kısa duraklamalar < 0,5 sn) — soru duraklamalarda bölünmez, son sözden ~0,7 sn sonra biter (eskiden ~1,1 sn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vadAdim, vadBaslat, SESSIZLIK_MS, ESKI_SESSIZLIK_MS } from '../src/shared/konusma-sonu.ts';

/** [başlangıç ms, bitiş ms] konuşma aralıkları; geri kalan ortam gürültüsü. Bitiş kararının zamanını döndürür. */
function olc(konusma: [number, number][], sessizlikMs: number): { karar: string; t: number } {
  const d = vadBaslat(0);
  for (let t = 0; t <= 25_000; t += 60) {
    const sesli = konusma.some(([a, b]) => t >= a && t < b);
    const k = vadAdim(d, sesli ? 0.12 : 0.006, t, sessizlikMs);
    if (k !== 'surer') return { karar: k, t };
  }
  return { karar: 'surer', t: -1 };
}

// "Yarın sabah … saat onda … toplantım var mı?" — sözcük grupları arasında 300–480 ms duraklama; son söz 3200 ms'de biter.
const SORU: [number, number][] = [[500, 1300], [1700, 2300], [2780, 3200]];

test('soru cümle içi duraklamalarda bölünmez ve son sözden ~0,7 sn sonra biter (eskiden ~1,1 sn)', () => {
  const yeni = olc(SORU, SESSIZLIK_MS);
  const eski = olc(SORU, ESKI_SESSIZLIK_MS);
  assert.equal(yeni.karar, 'bitti');
  assert.equal(eski.karar, 'bitti');
  const yeniGecikme = yeni.t - 3200, eskiGecikme = eski.t - 3200;
  console.log(`  konuşma sonu → bitiş: yeni ${yeniGecikme} ms, eski ${eskiGecikme} ms (kazanç ${eskiGecikme - yeniGecikme} ms)`);
  assert.ok(yeniGecikme >= 700 && yeniGecikme <= 800, String(yeniGecikme));
  assert.ok(eskiGecikme >= 1100 && eskiGecikme <= 1200, String(eskiGecikme));
});

test('hiç konuşma yoksa 6 sn\'de boş; çok uzun konuşma 20 sn\'de kesilir', () => {
  assert.deepEqual(olc([], SESSIZLIK_MS).karar, 'bos');
  const uzun = olc([[400, 24_000]], SESSIZLIK_MS);
  assert.equal(uzun.karar, 'uzun');
  assert.ok(uzun.t > 20_000 && uzun.t < 20_100);
});

test('ilk 300 ms gürültü öğrenilir: gürültülü odada eşik yükselir, gürültü konuşma sayılmaz', () => {
  const d = vadBaslat(0);
  for (let t = 0; t < 300; t += 60) vadAdim(d, 0.03, t);
  // Gürültü 0,03 → eşik ≈ 0,079: 0,05 konuşma sayılmaz, 0,12 sayılır.
  assert.equal(vadAdim(d, 0.05, 360), 'surer');
  assert.equal(d.konustu, false);
  vadAdim(d, 0.12, 420);
  assert.equal(d.konustu, true);
});
