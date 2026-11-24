// Hafıza türü adları (src/shared/hafiza-tur.ts): kokpitteki "Son öğrendiklerim" kartı ham kimlik ("kullanici", "kisi") gösteriyordu
// (Görev 19 denetimi); hafıza formu boş başlık/bilgiyle "Kaydet"e basınca sessizce hiçbir şey yapmıyordu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAFIZA_TURLERI, hafizaTurAdi, hafizaFormuGecerli } from '../src/shared/hafiza-tur.ts';
import type { HafizaTuru } from '../src/shared/tipler.ts';

const HEPSI: HafizaTuru[] = ['kullanici', 'proje', 'tercih', 'kisi', 'olay', 'bilgi', 'kural', 'gorev'];

test('her hafıza türünün Türkçe tekil ve çoğul adı var; hiçbiri ham kimlik değil', () => {
  assert.deepEqual(HAFIZA_TURLERI.map((t) => t.tur).sort(), [...HEPSI].sort());
  for (const t of HAFIZA_TURLERI) {
    assert.notEqual(t.tekil, t.tur);
    assert.notEqual(t.cogul, t.tur);
    assert.match(t.tekil, /^[A-ZÇĞİÖŞÜ]/);
  }
});

test('hafizaTurAdi: tekil ad; bilinmeyen tür ham kimlik yerine "Bilgi"', () => {
  assert.equal(hafizaTurAdi('kisi'), 'Kişi');
  assert.equal(hafizaTurAdi('kullanici'), 'Sen');
  assert.equal(hafizaTurAdi('gorev'), 'Görev');
  assert.equal(hafizaTurAdi('eski_tur'), 'Bilgi');
});

test('hafizaFormuGecerli: başlık ve bilgi dolu olmalı (boşluk sayılmaz)', () => {
  assert.equal(hafizaFormuGecerli({ baslik: 'Ece', icerik: 'Müşteri' }), true);
  assert.equal(hafizaFormuGecerli({ baslik: 'Ece', icerik: '   ' }), false);
  assert.equal(hafizaFormuGecerli({ baslik: ' ', icerik: 'x' }), false);
  assert.equal(hafizaFormuGecerli({}), false);
  assert.equal(hafizaFormuGecerli(null), false);
});
