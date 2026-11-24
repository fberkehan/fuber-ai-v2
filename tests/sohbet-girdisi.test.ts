// Düzeltme 3 (Görev 21): sohbet penceresinde sesle YAZDIRILAN mesaj sesli turun kısıtlarını almaz (tam araçlar, normal düşünme gücü,
// "1-3 cümle" yok); adanın/telefonun sesli sorusu sesli tur kalır. Kayıtta ikisinin de kaynağı 'ses' (🎙).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sohbetGirdisi } from '../src/shared/sohbet-girdisi.ts';

test('dikte (sohbet penceresi) → kaynak ses, sesli DEĞİL; ses (ada) → sesli tur', () => {
  assert.deepEqual(sohbetGirdisi('dikte'), { kaynak: 'ses', sesli: false });
  assert.deepEqual(sohbetGirdisi('ses'), { kaynak: 'ses', sesli: true });
});

test('yazılı, telefon ve bilinmeyen kaynaklar sesli değil; bilinmeyen değer kullanıcı sayılır', () => {
  assert.deepEqual(sohbetGirdisi(undefined), { kaynak: 'kullanici', sesli: false });
  assert.deepEqual(sohbetGirdisi('kullanici'), { kaynak: 'kullanici', sesli: false });
  assert.deepEqual(sohbetGirdisi('mobil'), { kaynak: 'mobil', sesli: false });
  assert.deepEqual(sohbetGirdisi('proaktif'), { kaynak: 'kullanici', sesli: false }); // proaktif tur IPC'den açılamaz
  assert.deepEqual(sohbetGirdisi({ x: 1 }), { kaynak: 'kullanici', sesli: false });
});
