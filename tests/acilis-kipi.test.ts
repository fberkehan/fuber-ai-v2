// G2 (0.11 spec §2 "Tekrar hoş geldin") + 0.12 H3a (spec §2 "Yükseltme"): açılış yolu (shared/kurulum-adimlari.ts kurulumYolu). Veri
// klasöründe `.yeniden-kurulum` işareti varsa (kullanıcı Fuber'i kaldırıp "verilerim kalsın" dedi ve yeniden kurdu) kurulum/kokpitten
// önce TEK ekran "Tekrar hoş geldin". "Kaldığın yerden devam et"ten sonra (işaret silindi) hesap yoksa YALNIZ hesap ekranı, varsa kokpit.
// Review Focus: güncelleme "Tekrar hoş geldin" açmaz — kaldırıcı güncellemede işaret yazmaz (tests/kurulum-nsh.test.ts) ve yol YALNIZ
// işaretle 'tekrar-hos-geldin' olur. 0.12 H3a: yükseltme hiçbir sihirbaz ya da özet açmaz; kurulum sürümü kararı etkilemez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kurulumYolu, veriVarMi } from '../src/shared/kurulum-adimlari.ts';

test('işaret + kurulum tamam → "Tekrar hoş geldin" (hesap olsa da olmasa da)', () => {
  for (const hesapVar of [true, false]) {
    assert.equal(kurulumYolu({ veriVar: true, yenidenKurulum: true, kurulumTamam: true, hesapVar }), 'tekrar-hos-geldin');
  }
});

test('işaret var ama karşılanacak veri yok (kurulum hiç bitmemiş, sohbet/hafıza yok) → yeni kurulum', () => {
  assert.equal(kurulumYolu({ veriVar: veriVarMi({ kurulumTamam: false, hesapVar: false }, { sohbet: 0, hafiza: 0 }), yenidenKurulum: true, kurulumTamam: false, hesapVar: false }), 'yeni');
});

test('karşılanacak veri: kurulum bitmiş ya da hesap, sohbet veya hafıza', () => {
  assert.equal(veriVarMi({ kurulumTamam: true, hesapVar: false }), true);
  assert.equal(veriVarMi({ kurulumTamam: false, hesapVar: true }), true);
  assert.equal(veriVarMi({ kurulumTamam: false, hesapVar: false }, { sohbet: 1 }), true);
  assert.equal(veriVarMi({ kurulumTamam: false, hesapVar: false }, { hafiza: 2 }), true);
  assert.equal(veriVarMi({ kurulumTamam: false, hesapVar: false }, null), false);
});
