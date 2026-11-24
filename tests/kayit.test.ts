// Araç girdisi doğrulayıcısı: akışla gelen (yarım olabilen) girdiler çalıştırılmadan önce şemaya göre denetlenir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dogrula, sema, metinKisalt } from '../src/main/ajan/araclar/kayit.ts';

const S = sema({ baslik: { type: 'string' }, zaman: { type: 'string' }, onem: { type: 'integer' } }, ['baslik', 'zaman']) as never;

test('geçerli girdi geçer', () => {
  assert.equal(dogrula(S, { baslik: 'Toplantı', zaman: '2026-10-19T10:00:00+03:00', onem: 4 }), null);
});

test('eksik zorunlu alan ve yanlış tür yakalanır', () => {
  assert.ok(dogrula(S, { baslik: 'Toplantı' }));
  assert.ok(dogrula(S, { baslik: 'Toplantı', zaman: 5 }));
  assert.ok(dogrula(S, 'düz metin'));
});

test('metinKisalt üç nokta ekler', () => {
  assert.equal(metinKisalt('kısa', 10), 'kısa');
  assert.equal(metinKisalt('çok uzun bir metin', 8).length, 8);
});
