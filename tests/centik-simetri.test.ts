// Çentik simetri bekçisinin denetleyicisi (0.14 T28 düzeltme turu 2, yeniden inceleme Minor A): scripts/dev/simetri.mjs yapay gri karelerle sınanır.
// Ölçüt: her satırda sol + sağ kenar toplamı, toplamların tepe değerinden en çok ±1 aygıt pikseli uzak. Yalnız bir yandaki 2 px'lik basamak düşmeli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simetriOlc } from '../scripts/dev/simetri.mjs';

const EN = 200, BOY = 60, ZEMIN = 90;
/** Satır satır [sol, sag] (dahil) aralığını siyaha boyayan yapay kare; aralık yoksa satır boş. */
function kare(aralik: (y: number) => [number, number] | null): Uint8Array {
  const g = new Uint8Array(EN * BOY).fill(ZEMIN);
  for (let y = 0; y < BOY; y++) { const a = aralik(y); if (a) for (let x = a[0]; x <= a[1]; x++) g[y * EN + x] = 0; }
  return g;
}
// Ortası 99,5 olan simetrik şekil: üstte omuzlu, altta daralan köşe.
const simetrik = (y: number): [number, number] | null => (y < 50 ? [40 - (y < 4 ? 4 - y : 0) + (y > 40 ? y - 40 : 0), 159 + (y < 4 ? 4 - y : 0) - (y > 40 ? y - 40 : 0)] : null);

test('simetri denetleyicisi: simetrik şekil geçer (sapma 0)', () => {
  const r = simetriOlc(kare(simetrik), EN, BOY);
  assert.equal(r.satir, 50);
  assert.equal(r.sapma, 0);
  assert.equal(r.gecti, true);
});
test('simetri denetleyicisi: kenar yumuşatmasının 1 px oynaması geçer', () => {
  const r = simetriOlc(kare((y) => { const a = simetrik(y); return a && y % 7 === 3 ? [a[0], a[1] + 1] : a; }), EN, BOY);
  assert.equal(r.sapma, 1);
  assert.equal(r.gecti, true);
});
test('simetri denetleyicisi: yalnız sağda 2 px basamak (eski omuz kusuru) düşer; 3 px de düşer', () => {
  for (const basamak of [2, 3]) {
    const r = simetriOlc(kare((y) => { const a = simetrik(y); return a && y < 30 ? [a[0], a[1] + basamak] : a; }), EN, BOY);
    assert.equal(r.gecti, false, `${basamak} px`);
    assert.equal(r.sapma, basamak);
  }
});
test('simetri denetleyicisi: saf siyah olmayan dolgu (onay kartının uyarı tonu) da şekil sayılır; şekil yoksa geçmez', () => {
  const g = kare(simetrik);
  for (let y = 0; y < 10; y++) for (let x = 36; x <= 163; x++) if (g[y * EN + x] === 0) g[y * EN + x] = 40;
  assert.equal(simetriOlc(g, EN, BOY).gecti, true);
  assert.equal(simetriOlc(new Uint8Array(EN * BOY).fill(ZEMIN), EN, BOY).gecti, false);
});
