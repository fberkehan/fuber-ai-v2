// Düşünme motoru dönem hesapları: hafta/ay anahtarları, çalışma saati, vadesi gelen raporlar, saklama, mesele eşleştirme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoHafta, haftaGunleri, ayHaftalari, calismadaMi, vadeliRaporlar, silinmeTarihi, gunEkle, meseleEslestir, benzerlik, oncekiAy, oncekiHafta } from '../src/main/gunkaydi/donem.ts';

test('ISO hafta ve günleri', () => {
  assert.equal(isoHafta(new Date(2026, 9, 19)), '2026-W43'); // Pzt
  assert.equal(isoHafta(new Date(2026, 9, 25, 23, 59)), '2026-W43'); // Paz
  assert.equal(isoHafta(new Date(2026, 9, 26)), '2026-W44');
  assert.equal(isoHafta(new Date(2027, 0, 1)), '2026-W53'); // 1 Ocak 2027 Cuma → 2026'nın 53. haftası
  assert.deepEqual(haftaGunleri('2026-W43'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.ok(ayHaftalari('2026-10').includes('2026-W40') && ayHaftalari('2026-10').includes('2026-W44'));
  assert.equal(oncekiHafta(new Date(2026, 9, 19)), '2026-W42');
  assert.equal(oncekiAy(new Date(2026, 0, 3)), '2025-12');
  assert.equal(gunEkle('2026-10-31', 1), '2026-11-01');
});

test('çalışma saati (gece yarısını aşan aralık dahil)', () => {
  const c = { bas: '08:00', bit: '23:00', gunler: [1, 2, 3, 4, 5] };
  assert.equal(calismadaMi(new Date(2026, 9, 19, 9, 0), c), true); // Pzt 09:00
  assert.equal(calismadaMi(new Date(2026, 9, 19, 23, 30), c), false);
  assert.equal(calismadaMi(new Date(2026, 9, 18, 12, 0), c), false); // Pazar
  const gece = { bas: '20:00', bit: '02:00', gunler: [5] }; // Cuma gecesi
  assert.equal(calismadaMi(new Date(2026, 9, 23, 21, 0), gece), true); // Cuma 21:00
  assert.equal(calismadaMi(new Date(2026, 9, 24, 1, 0), gece), true); // Cmt 01:00 (Cuma gecesinin devamı)
  assert.equal(calismadaMi(new Date(2026, 9, 24, 21, 0), gece), false); // Cmt 21:00
});

test('vadesi gelen raporlar: kaçırılan günler, rapor saati, biten hafta/ay; var olan ve verisiz atlanır', () => {
  const varOlan = new Set(['gunluk:2026-10-31']);
  const veri = new Set(['gunluk:2026-10-30', 'gunluk:2026-10-31', 'gunluk:2026-11-01', 'haftalik:2026-W43', 'aylik:2026-10']);
  const f = (simdi: Date) => vadeliRaporlar(simdi, '21:30', (t, d) => varOlan.has(`${t}:${d}`), (t, d) => veri.has(`${t}:${d}`));
  // 1 Kasım 2026 Pazar 10:00 → evvelsi gün (30) eksik, dün (31) var, bugün henüz saat gelmedi; W43 bitti; Ekim bitti
  assert.deepEqual(f(new Date(2026, 10, 1, 10, 0)), [{ tur: 'gunluk', donem: '2026-10-30' }, { tur: 'haftalik', donem: '2026-W43' }, { tur: 'aylik', donem: '2026-10' }]);
  // 21:45 → bugünün günlüğü de
  assert.ok(f(new Date(2026, 10, 1, 21, 45)).some((r) => r.tur === 'gunluk' && r.donem === '2026-11-01'));
});

test('saklama: gün sonundan n gün sonra', () => {
  const s = new Date(silinmeTarihi('2026-10-19', 3));
  assert.equal(s.getDate(), 22);
  assert.equal(s.getHours(), 23);
});

test('mesele eşleştirme: aynı konu yeni mesele açmaz, farklı kişi eşleşmez', () => {
  const mevcut = [{ id: 1, baslik: 'Ali kira sözleşmesini gönderecek', kisi: 'Ali' }, { id: 2, baslik: 'Sunucu faturası ödenecek', kisi: null }];
  assert.equal(meseleEslestir('Ali kira sözleşmesini cumartesi gönderecek', 'Ali', mevcut)?.id, 1);
  assert.equal(meseleEslestir('Kira sözleşmesi gönderilecek', 'Mehmet', mevcut), null);
  assert.equal(meseleEslestir('Sunucu faturasını öde', undefined, mevcut)?.id, 2);
  assert.ok(benzerlik('çiğ köfte yemeyeceğiz', 'bir daha çiğ köfte yemeyelim') >= 0.6);
});
