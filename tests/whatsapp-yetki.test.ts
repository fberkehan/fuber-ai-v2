// WhatsApp yetkisi: YALNIZ modül varken (bu depoda yok), YALNIZ İş modunda ve YALNIZ WhatsApp hakkı olan hesapta. Kararın saf kuralı
// (shared/whatsapp-yetki.ts) ve hesap kaydındaki `paket` alanının okunuşu; alan yoksa hesabın var olan hâli ('aktif') karar verir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHATSAPP_OZELLIGI, paketOku, paketHakkiVar, whatsappYetkisi } from '../src/shared/whatsapp-yetki.ts';
import { hesapAyariDuzelt, type HesapAyari } from '../src/shared/masaustu-hesap.ts';

const hesap = (h: Partial<HesapAyari> = {}): HesapAyari => ({ eposta: 'deniz@ornek.com', cihazAdi: 'DENIZ-PC', durum: 'aktif', ...h });

test('modül yoksa (bu depo) WhatsApp hiçbir koşulda yok', () => {
  assert.deepEqual(whatsappYetkisi({ modulVar: false, mod: 'is', hesap: hesap() }), { izinli: false, neden: 'modul-yok' });
  assert.deepEqual(whatsappYetkisi({ modulVar: false, mod: 'gelistirici', hesap: undefined }), { izinli: false, neden: 'modul-yok' });
});

test('modül varken: yalnız İş modunda; Developer mode WhatsApp göstermez', () => {
  assert.deepEqual(whatsappYetkisi({ modulVar: true, mod: 'is', hesap: hesap() }), { izinli: true });
  assert.deepEqual(whatsappYetkisi({ modulVar: true, mod: 'gelistirici', hesap: hesap() }), { izinli: false, neden: 'mod' });
});

test('paket: alan yokken hesabın "aktif" hâli; hesapsız, onay bekleyen, kapalı ve kullanım hakkı dolan hesap paketli sayılmaz', () => {
  assert.equal(paketHakkiVar(hesap()), true);
  assert.equal(paketHakkiVar(undefined), false);
  for (const durum of ['bekliyor', 'kapali', 'kredi-bitti'] as const) {
    assert.equal(paketHakkiVar(hesap({ durum })), false, durum);
    assert.deepEqual(whatsappYetkisi({ modulVar: true, mod: 'is', hesap: hesap({ durum }) }), { izinli: false, neden: 'paket' }, durum);
  }
  assert.deepEqual(whatsappYetkisi({ modulVar: true, mod: 'is', hesap: undefined }), { izinli: false, neden: 'paket' });
});

test('paket: hesap kaydında `paket` varsa o karar verir (aktif ve özellik listesinde whatsapp); hesap aktif değilse yine yok', () => {
  assert.equal(paketHakkiVar(hesap({ paket: { aktif: true } })), true, 'özellik listesi yoksa paketin tamamı');
  assert.equal(paketHakkiVar(hesap({ paket: { aktif: true, ozellikler: [WHATSAPP_OZELLIGI, 'ses'] } })), true);
  assert.equal(paketHakkiVar(hesap({ paket: { aktif: true, ozellikler: ['ses'] } })), false, 'pakette WhatsApp yok');
  assert.equal(paketHakkiVar(hesap({ paket: { aktif: false, ozellikler: [WHATSAPP_OZELLIGI] } })), false, 'paket bitmiş');
  assert.equal(paketHakkiVar(hesap({ durum: 'kapali', paket: { aktif: true } })), false, 'erişimi kapalı cihaz');
});

test('paketOku: yalnız beklenen biçim; bozuk alan "alan yok" sayılır (hesabın hâline düşer)', () => {
  assert.deepEqual(paketOku({ aktif: true, ozellikler: ['whatsapp', 'x'] }), { aktif: true, ozellikler: ['whatsapp', 'x'] });
  assert.deepEqual(paketOku({ aktif: false }), { aktif: false });
  assert.deepEqual(paketOku({ aktif: true, ozellikler: ['whatsapp', 3, '', 'ç'.repeat(200)] }), { aktif: true, ozellikler: ['whatsapp'] });
  for (const x of [undefined, null, 'evet', 1, [], { aktif: 'true' }, { ozellikler: ['whatsapp'] }]) assert.equal(paketOku(x), undefined, JSON.stringify(x));
});
