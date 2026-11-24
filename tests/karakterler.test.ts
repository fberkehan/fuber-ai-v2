// Kip sözleşmesi (0.13 T0) — src/shared/karakterler.ts: kip adları, gömülü karakterler, sunucu kaydı doğrulaması, etkin karakter seçimi;
// durum yanıtında `karakterler` isteğe bağlı (eski sunucu bozulmaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIP_ADI, modKip, VARSAYILAN_KARAKTERLER, karakterlerDogrula, etkinKarakter } from '../src/shared/karakterler.ts';
import { hesapAyariDuzelt } from '../src/shared/masaustu-hesap.ts';

test('kip adları çevrilmez', () => { assert.equal(KIP_ADI.is, 'Business mode'); assert.equal(KIP_ADI.gelistirici, 'Developer mode'); });
test('sunucu karakter vermezse gömülü varsayılan; ad iki modda da Fuber', () => { assert.equal(etkinKarakter('is', undefined).ad, 'Fuber'); assert.equal(etkinKarakter('gelistirici', undefined).ad, 'Fuber'); assert.equal(etkinKarakter('is', undefined).sistemIstemi, VARSAYILAN_KARAKTERLER.business.sistemIstemi); });
test('bozuk kayıt reddedilir', () => { assert.equal(karakterlerDogrula({ business: { ad: 1 } }), null); });

test('iç kip değeri karakter kimliğine eşlenir', () => { assert.equal(modKip('is'), 'business'); assert.equal(modKip('gelistirici'), 'developer'); });

test('gömülü istemler dolu, kısa ve onay kurallarını gevşetmez', () => {
  for (const k of Object.values(VARSAYILAN_KARAKTERLER)) {
    assert.ok(k.sistemIstemi.length > 200 && k.sistemIstemi.length < 900, `${k.ad}: ${k.sistemIstemi.length}`);
    assert.match(k.sistemIstemi, /onay/i);
    assert.equal(k.gorsel, null);
  }
  assert.equal(VARSAYILAN_KARAKTERLER.business.kip, 'business');
  assert.equal(VARSAYILAN_KARAKTERLER.developer.kip, 'developer');
});

test('geçerli sunucu kaydı kabul edilir; ses kimliği karaktere girmez', () => {
  const k = karakterlerDogrula({
    business: { ad: 'Tilki', tanim: 'İş ortağı', sistemIstemi: 'Açık sözlü ol.', sesId: 'abc', gorsel: null },
    developer: { ad: 'Bukalemun', tanim: 'Temkinli', sistemIstemi: 'Sınırı söyle.' },
  });
  assert.ok(k);
  assert.equal(k!.business.kip, 'business');
  assert.equal(k!.developer.gorsel, null);
  assert.equal('sesId' in k!.business, false);
});

test('iki kipten biri eksik ya da istemi boşsa tümü reddedilir', () => {
  const iyi = { ad: 'X', tanim: '', sistemIstemi: 'y' };
  assert.equal(karakterlerDogrula({ business: iyi }), null);
  assert.equal(karakterlerDogrula({ business: iyi, developer: { ...iyi, sistemIstemi: '  ' } }), null);
  assert.equal(karakterlerDogrula(null), null);
  assert.equal(karakterlerDogrula('x'), null);
});

test('etkinKarakter sunucudaki kaydı seçer (ad yine Fuber, istem sunucudan)', () => {
  const k = karakterlerDogrula({
    business: { ad: 'Bir', tanim: '', sistemIstemi: 'a' }, developer: { ad: 'İki', tanim: '', sistemIstemi: 'b' },
  })!;
  assert.equal(etkinKarakter('is', k).ad, 'Fuber');
  assert.equal(etkinKarakter('is', k).sistemIstemi, 'a');
  assert.equal(etkinKarakter('gelistirici', k).sistemIstemi, 'b');
});
