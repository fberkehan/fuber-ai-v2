// 0.11 G5 — kokpit kartlarının sığma planı (src/renderer/pano/sigdir.ts; saf kısım). Kartın içinde kaydırma yok: kart en zengin hâlinden
// başlar, taşıyorsa adım adım yalınlaşır. Sıra: önce alt şerit bırakılır; iki satırlık başlık destekleniyorsa kayıtlar iki satırla
// `ikiEnAz`'a dek azalır, sonra başlıklar tek satıra iner ve kayıtlar yeniden azalır; en az bir kayıt kalır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listePlani, satirSayisi, sayiPlani } from '../src/renderer/pano/sigdir.ts';

const yaz = (p: ReturnType<typeof listePlani>) => p.map((a) => `${a.altlik ? 'A' : ''}${a.n}${a.iki ? 'i' : 't'}`).join(' ');

test('listePlani: alt şerit önce, sonra iki satırla en az üç haber, sonra tek satıra iner', () => {
  assert.equal(yaz(listePlani(5, { altlik: true, ikiSatir: true, ikiEnAz: 3 })), 'A5i 5i 4i 3i 5t 4t 3t 2t 1t');
});

test('listePlani: iki satır yoksa yalnız kayıt sayısı azalır; alt şerit yoksa ilk adım tam liste', () => {
  assert.equal(yaz(listePlani(3)), '3t 2t 1t');
  assert.equal(yaz(listePlani(2, { ikiSatir: true, ikiEnAz: 3 })), '2i 2t 1t');
});

test('listePlani: kayıt yokken tek adım (boş hâl), alt şerit varsa o da', () => {
  assert.equal(yaz(listePlani(0)), '0t');
  assert.equal(yaz(listePlani(0, { altlik: true })), 'A0t');
});

/** M = manşet, S = iki sütun; sayı; i/t = iki/tek satırlık başlık. */
const yazS = (p: ReturnType<typeof sayiPlani>) => p.map((a) => `${a.manset ? 'M' : ''}${a.ikiSutun ? 'S' : ''}${a.n}${a.iki ? 'i' : 't'}`).join(' ');

test('sayiPlani (G5 düzeltme turu 1, K5): Haberler kartta en çok 5 başlık; her sayıda önce iki satır, sonra tek satır, sonra bir eksik', () => {
  // 12 haber gelse de kartta en çok 5; fazlası "Tümü"de.
  assert.equal(yazS(sayiPlani({ tek: [5, 4, 3, 2, 1] }, 12)), '5i 5t 4i 4t 3i 3t 2i 2t 1i 1t');
  // Az haberde sayılar toplamla sınırlanır, tekrar etmez; haber yoksa boş hâlin tek sayısı.
  assert.equal(yazS(sayiPlani({ tek: [5, 4, 3, 2, 1] }, 3)), '3i 3t 2i 2t 1i 1t');
  assert.equal(yazS(sayiPlani({ tek: [5, 4, 3, 2, 1] }, 0)), '0i 0t');
});

test('sayiPlani: manşet en zengin adım (≥ 3 kayıtta); geniş kart önce tek sütun, iki sütun (çift sayı) yalnız sonra', () => {
  // Dar kart: manşet + 4, sonra tek sütunda 5 → 1.
  assert.equal(yazS(sayiPlani({ manset: 5, tek: [5, 4, 3, 2, 1] }, 30)), 'M5i 5i 5t 4i 4t 3i 3t 2i 2t 1i 1t');
  // Geniş kart: manşet, tek sütunda 5 ve 4; sığmazsa (geniş ama kısa) iki sütunda 4, 2, 1 — uzun geniş kart yarı boş kalmaz.
  assert.equal(yazS(sayiPlani({ manset: 5, tek: [5, 4], cift: [4, 2, 1] }, 30)), 'M5i 5i 5t 4i 4t S4i S4t S2i S2t S1i S1t');
  assert.equal(yazS(sayiPlani({ manset: 5, tek: [5, 4, 3, 2, 1] }, 4)), 'M4i 4i 4t 3i 3t 2i 2t 1i 1t');
  assert.equal(yazS(sayiPlani({ manset: 5, tek: [5, 4, 3, 2, 1] }, 2)), '2i 2t 1i 1t');
});

test('satirSayisi: önce `once` adım satır bırakmaz, sonra adım başına bir satır; en az enAz', () => {
  assert.equal(satirSayisi(0, 7, 1), 7);
  assert.equal(satirSayisi(1, 7, 1), 7);
  assert.equal(satirSayisi(3, 7, 1), 5);
  assert.equal(satirSayisi(99, 7, 1), 1);
  assert.equal(satirSayisi(99, 5, 1, 0), 0);
  assert.equal(satirSayisi(4, 0), 0);
});
