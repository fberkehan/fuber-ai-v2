// Seslenme algılama: eksiz ad + ikinci kişi = seslenme; ekli ad = söz etme; fiber internet ≠ Fuber.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seslenmeAnaliz, adBicimi, devamMi } from '../src/shared/seslenme.ts';

const karar = (s: string) => seslenmeAnaliz(s).karar;

test('ad biçimi: eksiz / ekli', () => {
  assert.equal(adBicimi('fuber'), 'eksiz');
  assert.equal(adBicimi('fiber'), 'eksiz');
  assert.equal(adBicimi("fuber'e"), 'ekli');
  assert.equal(adBicimi('fuber’in'), 'ekli');
  assert.equal(adBicimi('fuberden'), 'ekli');
  assert.equal(adBicimi('fiberin'), 'ekli');
  assert.equal(adBicimi('fabrika'), null);
});

test('seslenmeler yakalanır', () => {
  for (const s of [
    'ee fiber nasılsın nasıl gidiyor',
    'Fuber buralarda mısın?',
    'füber orda mısın',
    'fuber yarın sabah dokuzda toplantım var hatırlat bana',
    'fuber şu ödeme projesindeki hatayı düzeltir misin, stripe webhook patlıyor',
    'hey fuber bugün hava nasıl',
    'bugün ne yapıyoruz fuber',
    'fuber kira sözleşmesini imzalayalım mı sence',
    'hadi fuber bir şaka yap',
  ]) assert.equal(karar(s), 'seslenme', s);
});

test('söz etmeler ve alakasızlar seslenme sayılmaz', () => {
  for (const s of [
    'dün Fuber’e sordum, güzel cevap verdi',
    'fuberden çıkan raporu okudun mu',
    'Fuber’in sesi güzelmiş bu arada',
    'fiber internet yine kesildi',
    'evde fiber optik kablo var mı',
    'hadi kalk gidelim artık geç oldu',
  ]) assert.notEqual(karar(s), 'seslenme', s);
  assert.equal(karar('Fuber çok iyi cevap verdi dün'), 'belirsiz');
});

test('devam penceresi: Fuber konuştuktan sonra adsız yanıt', () => {
  const t = 1_000_000;
  assert.equal(devamMi('evet olur, sekiz buçukta hatırlat', t - 5000, t), true);
  assert.equal(devamMi('tamam teşekkürler', t - 3000, t), true);
  assert.equal(devamMi('evet olur', t - 30_000, t), false); // pencere geçti
  assert.equal(devamMi('Fuber’e söyledim zaten', t - 3000, t), false);
  // Yandakine söylenen ikinci kişi / soru Fuber'e sayılmaz
  assert.equal(devamMi('Şu pencereyi biraz açar mısın hava aldı', t - 4000, t), false);
  assert.equal(devamMi('sen ne dersin?', t - 5000, t), false);
});
