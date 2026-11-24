// Ada penceresinin konumu: saf hesap (pencere yok). Ada, imlecin bulunduğu ekranın ÜST ORTASINA yapışır; çentikli Mac ekranı ayrıca bilinir.
// 0.14 T19 (R15): kutu 720×460 × ölçek; ölçek ekranın DIP enine göre (centikOlcegi). Review Focus 1: imlecin ekranı ve o ekranın ölçeği.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADA_PENCERE } from '../src/shared/ada.ts';
import { adaKonumu, adaCentikli, centikYerlesimi } from '../src/main/ada-konum.ts';

/** Sahte ekran: `calismaY` çalışma alanının üst kenarı (görev çubuğu / menü çubuğu ekranın üstündeyse bounds.y'den büyük). */
const ekran = (x: number, y: number, en: number, boy: number, calismaY = y) => ({
  bounds: { x, y, width: en, height: boy },
  workArea: { x, y: calismaY, width: en, height: boy - (calismaY - y) },
});

test('tek ekran 1920×1080, ölçek 1: ada üst ortada', () => {
  assert.deepEqual(adaKonumu(ekran(0, 0, 1920, 1080), 'win32'), { x: 600, y: 0, width: 720, height: 460 });
});

test('ikinci ekran (2560×1440, sol-üst 1920,-200): ekranın kendi üst ortası', () => {
  assert.deepEqual(adaKonumu(ekran(1920, -200, 2560, 1440), 'win32'), { x: 2840, y: -200, width: 720, height: 460 });
});

test('ölçekli kutu yuvarlanır ve yine ortalanır (1,12: 806×515)', () => {
  assert.deepEqual(adaKonumu(ekran(0, 0, 1920, 1080), 'win32', 1.12), { x: 557, y: 0, width: 806, height: 515 });
});

test('1366 genişlikte x = 323', () => {
  assert.equal(adaKonumu(ekran(0, 0, 1366, 768), 'win32').x, 323);
});

test('pencere ölçüsü ADA_PENCERE ile aynı (iki yerde yazılı değil: ada-konum shared/ada.ts\'ten okur)', () => {
  const k = adaKonumu(ekran(0, 0, 1920, 1080), 'win32');
  assert.equal(k.width, ADA_PENCERE.en);
  assert.equal(k.height, ADA_PENCERE.boy);
});

test('görev çubuğu üstte olsa da ada ekranın en üstüne yapışır (workArea değil bounds)', () => {
  assert.equal(adaKonumu(ekran(0, 0, 1920, 1080, 48), 'win32').y, 0);
});

test('macOS: ada menü çubuğunun üstünde (y = bounds.y)', () => {
  assert.equal(adaKonumu(ekran(0, 0, 1440, 900, 25), 'darwin').y, 0);
});

test('çentik: yalnız macOS ve çalışma alanı üst kenardan en az 32 px aşağıdaysa', () => {
  assert.equal(adaCentikli(ekran(0, 0, 1512, 982, 37), 'darwin'), true);
  assert.equal(adaCentikli(ekran(0, 0, 1512, 982, 32), 'darwin'), true);
  assert.equal(adaCentikli(ekran(0, 0, 1512, 982, 31), 'darwin'), false);
  assert.equal(adaCentikli(ekran(0, 0, 1440, 900, 25), 'darwin'), false);
  assert.equal(adaCentikli(ekran(0, 0, 1920, 1080), 'darwin'), false);
});

test('çentik: Windows\'ta üstteki görev çubuğu çentik sayılmaz', () => {
  assert.equal(adaCentikli(ekran(0, 0, 1920, 1080, 48), 'win32'), false);
});

// ── centikYerlesimi (Review Focus 1) ──
const E1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.5 };
const E2 = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, scaleFactor: 1 };

test('Review Focus 1: imlecin ekranı ve o ekranın ölçeği', () => {
  assert.deepEqual(centikYerlesimi([E1, E2], { x: 2500, y: 10 }), { ekranId: 2, kutu: { x: 1920 + 830, y: 0, width: 900, height: 575 }, olcek: 1.25 });
});

test('Review Focus 1: imleç %150 ölçekli ekrana geçince o ekranın kutusu ve ölçeği (DIP eni 1920 → 1,12)', () => {
  assert.deepEqual(centikYerlesimi([E1, E2], { x: 100, y: 500 }), { ekranId: 1, kutu: { x: 557, y: 0, width: 806, height: 515 }, olcek: 1.12 });
});

test('imleç hiçbir ekranda değilse (ekran söküldü) en yakın ekran; ekran listesi boşsa ilk ekrana düşmez, hata vermez', () => {
  assert.equal(centikYerlesimi([E1, E2], { x: 9000, y: 10 }).ekranId, 2);
  assert.equal(centikYerlesimi([E1, E2], { x: -50, y: -50 }).ekranId, 1);
  assert.deepEqual(centikYerlesimi([], { x: 0, y: 0 }), { ekranId: -1, kutu: { x: 0, y: 0, width: 720, height: 460 }, olcek: 1 });
});

test('ekranın sağ ve alt kenarı o ekrana dahil değil (komşu ekranın sol kenarı)', () => {
  assert.equal(centikYerlesimi([E1, E2], { x: 1920, y: 10 }).ekranId, 2);
  assert.equal(centikYerlesimi([E1, E2], { x: 1919, y: 10 }).ekranId, 1);
});