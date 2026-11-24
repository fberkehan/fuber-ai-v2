// Tema çözümü: seçimden etkin tema hesabı. 0.13 T13: Şeffaf (cam) tema geri geldi — yalnız Windows 11 22H2 (derleme ≥ 22621) ve macOS'ta;
// destek yoksa Koyu'ya düşer. Kurulum, Tekrar hoş geldin ve açılış sırasında sistem malzemesi 'none' ve zemin opaktır (0.12 H3a sorunu).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PENCERE_ZEMIN, TEMALAR, camDestekli, etkinTemaBul, pencereMalzemesi, pencereZeminiBul, sunulanTemalar, temaGocu } from '../src/shared/tema-cozum.ts';

test('Windows 11\'de cam etkin: 22H2+ ve macOS evet; Windows 11 21H2 / Windows 10 / Linux / bozuk sürüm hayır', () => {
  assert.equal(camDestekli('win32', '10.0.22631'), true); // 23H2
  assert.equal(camDestekli('win32', '10.0.22621'), true); // 22H2: setBackgroundMaterial'in çalıştığı ilk derleme
  assert.equal(camDestekli('win32', '10.0.22000'), false); // 21H2: pencere malzemesi yok
  assert.equal(camDestekli('darwin', '23.1.0'), true);
  assert.equal(camDestekli('linux', '6.8.0'), false);
  assert.equal(camDestekli('win32', 'bozuk'), false);
  assert.equal(etkinTemaBul('cam', false, camDestekli('win32', '10.0.22631')), 'cam');
  assert.equal(etkinTemaBul('cam', true, true), 'cam', 'sistem rengi camı etkilemez');
});

test('Windows 10\'da koyuya düşer: cam desteği yoksa seçim ne olursa olsun Koyu; Şeffaf sunulmaz', () => {
  const win10 = camDestekli('win32', '10.0.19045');
  assert.equal(win10, false);
  assert.equal(etkinTemaBul('cam', false, win10), 'koyu');
  assert.equal(etkinTemaBul('cam', true, win10), 'koyu');
  assert.deepEqual([...sunulanTemalar(win10)], ['koyu', 'acik', 'sistem']);
  assert.deepEqual([...sunulanTemalar(true)], ['koyu', 'acik', 'sistem', 'cam']);
});

test('etkin tema: Otomatik (sistem) işletim sistemi rengine uyar; açık ve koyu desteğe bakmaz', () => {
  assert.equal(etkinTemaBul('sistem', false, true), 'acik');
  assert.equal(etkinTemaBul('sistem', true, true), 'koyu');
  assert.equal(etkinTemaBul('acik', true, false), 'acik');
  assert.equal(etkinTemaBul('koyu', false, true), 'koyu');
  assert.equal(etkinTemaBul(undefined, false, true), 'koyu');
});

test('tema göçü: cam artık geçerli ve aynen kalır; bilinmeyen → varsayılan', () => {
  assert.equal(temaGocu('cam'), 'cam', 'temaGocu camı koyuya çevirmez');
  for (const t of ['koyu', 'acik', 'sistem', 'cam'] as const) assert.equal(temaGocu(t), t);
  assert.equal(temaGocu('mor'), 'koyu');
  assert.equal(temaGocu(undefined, 'sistem'), 'sistem');
  assert.deepEqual([...TEMALAR], ['koyu', 'acik', 'sistem', 'cam']);
});

test('pencere zemini: koyu ve açık opak (#rrggbb), cam saydam; kurulum görünürken cam da opak', () => {
  assert.deepEqual(Object.keys(PENCERE_ZEMIN).sort(), ['acik', 'cam', 'koyu']);
  for (const t of ['koyu', 'acik'] as const) assert.match(PENCERE_ZEMIN[t], /^#[0-9a-f]{6}$/i);
  assert.equal(PENCERE_ZEMIN.cam, '#00000000');
  assert.equal(pencereZeminiBul('cam', false), '#00000000');
  assert.equal(pencereZeminiBul('cam', true), PENCERE_ZEMIN.koyu, 'kurulumda cam zemini opak koyu');
  assert.equal(pencereZeminiBul('acik', true), PENCERE_ZEMIN.acik);
});

test('kurulum görünürken malzeme \'none\': cam yalnız kurulum yokken acrylic / vibrancy', () => {
  assert.equal(pencereMalzemesi('win32', 'cam', false), 'acrylic');
  assert.equal(pencereMalzemesi('darwin', 'cam', false), 'under-window');
  assert.equal(pencereMalzemesi('win32', 'cam', true), 'none', 'kurulum / Tekrar hoş geldin görünürken');
  assert.equal(pencereMalzemesi('darwin', 'cam', true), 'none');
  assert.equal(pencereMalzemesi('win32', 'koyu', false), 'none');
  assert.equal(pencereMalzemesi('win32', 'acik', false), 'none');
  assert.equal(pencereMalzemesi('linux', 'cam', false), 'none');
});
