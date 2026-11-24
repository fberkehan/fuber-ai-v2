// Gizli mod yalıtımı (Görev 21 düzeltme 1): yol tur başında seçilir ve turun her adımına + ertelenen işlerine SABİT taşınır; Gizli
// bölüm (Gizli modda yazılan mesajlar) Gizli mod kapandıktan sonra da bulut bağlamına girmez; geçiş sohbette bir notla görünür.
// Uçtan uca kanıt (sahte bulut sunucusu yükleri denetler): scripts/dev/sohbet-durdurma-testi.mjs bölüm 4b.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sabitYol, bulutBaglami, gizliGecisNotu, yerelIsAtlanir, GIZLI_NOTU } from '../src/shared/tek-motor.ts';

test('sabit yol: Gizli bölümün işi Gizli mod kapansa da yerelde; bulut turu arada Gizli mod açılırsa sürmez; sabitsiz iş bugünkü kural', () => {
  // Gizli turun ertelenen başlık işi, kullanıcı Gizli modu kapattıktan sonra çalışıyor: yine yerel.
  assert.equal(sabitYol('yerel', 'bulut'), 'yerel');
  assert.equal(sabitYol('yerel', 'yerel'), 'yerel');
  // Bulutta başlayan tur: bulut hâlâ yolsa bulut; Gizli mod açıldıysa (yol 'yerel') ya da bulut düştüyse ('yok') çağrı YAPILMAZ.
  assert.equal(sabitYol('bulut', 'bulut'), 'bulut');
  assert.equal(sabitYol('bulut', 'yerel'), 'degisti');
  assert.equal(sabitYol('bulut', 'yok'), 'degisti');
  // Turdan bağımsız iş (düşünme motoru ajanları): o anki kural.
  for (const y of ['yerel', 'bulut', 'yok'] as const) assert.equal(sabitYol(undefined, y), y);
});

test('yerele sabit iş Gizli mod kapandıktan sonra yerel sunucu kapalıysa atlanır (soğuk açılış yok); açıksa ya da hâlâ Gizli modsa yapılır', () => {
  assert.equal(yerelIsAtlanir('yerel', 'bulut', false), true);
  assert.equal(yerelIsAtlanir('yerel', 'bulut', true), false);
  assert.equal(yerelIsAtlanir('yerel', 'yerel', false), false); // Gizli mod sürüyor: yerel beyin tek motor, açılabilir
  assert.equal(yerelIsAtlanir('bulut', 'bulut', false), false);
  assert.equal(yerelIsAtlanir(undefined, 'bulut', false), false);
});

test('bulut bağlamı: Gizli bölüm çıkar (sıra korunur); yerel turda her şey kalır', () => {
  const l = [{ id: 1 }, { id: 2, gizli: true }, { id: 3, gizli: true }, { id: 4 }, { id: 5, gizli: false }];
  assert.deepEqual(bulutBaglami(l, true).map((m) => m.id), [1, 4, 5]);
  assert.deepEqual(bulutBaglami(l, false).map((m) => m.id), [1, 2, 3, 4, 5]);
});

test('geçiş notu: açıldı (yeni sohbette de), kapandı; geçiş yoksa not yok', () => {
  assert.equal(gizliGecisNotu(null, true), GIZLI_NOTU.acildi);
  assert.equal(gizliGecisNotu(false, true), GIZLI_NOTU.acildi);
  assert.equal(gizliGecisNotu(true, false), GIZLI_NOTU.kapandi);
  assert.equal(gizliGecisNotu(true, true), null);
  assert.equal(gizliGecisNotu(false, false), null);
  assert.equal(gizliGecisNotu(null, false), null);
  assert.match(GIZLI_NOTU.acildi, /^Gizli mod açıldı/);
  assert.match(GIZLI_NOTU.kapandi, /^Gizli mod kapandı/);
});
