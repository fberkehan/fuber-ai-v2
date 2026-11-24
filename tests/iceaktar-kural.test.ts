// Öğretme klasörü kuralı (src/shared/iceaktar-kural.ts): Görev 19 denetiminde desteklenmeyen/boş/çok büyük dosya sessizce yok
// sayılıyordu. Geçici ve sistem dosyaları ise bildirim üretmemeli (kopyalama sürerken klasör izleyicisi onları da görür).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iceAktarimKarari, geciciDosyaMi, ICE_AKTAR_AZAMI_BOYUT } from '../src/shared/iceaktar-kural.ts';

test('desteklenen türler alınır (büyük/küçük harf fark etmez)', () => {
  for (const ad of ['not.md', 'conversations.json', 'oturum.jsonl', 'Sozlesme.PDF', 'teklif.docx', 'ileti.eml', 'liste.csv']) {
    assert.deepEqual(iceAktarimKarari(ad, 1200), { tur: 'al' }, ad);
  }
});

test('desteklenmeyen tür, boş ve çok büyük dosya nedeniyle reddedilir', () => {
  const png = iceAktarimKarari('ekran.png', 2048);
  assert.equal(png.tur, 'red');
  assert.match(png.tur === 'red' ? png.neden : '', /\(\.png\) öğretilemiyor.*PDF/);
  assert.match((iceAktarimKarari('README', 10) as { neden: string }).neden, /uzantısız/);
  assert.deepEqual(iceAktarimKarari('bos.txt', 0), { tur: 'red', neden: 'dosya boş.' });
  assert.deepEqual(iceAktarimKarari('arsiv.pdf', ICE_AKTAR_AZAMI_BOYUT + 1), { tur: 'red', neden: 'dosya çok büyük (60 MB üstü).' });
  assert.deepEqual(iceAktarimKarari('sinirda.pdf', ICE_AKTAR_AZAMI_BOYUT), { tur: 'al' });
});

test('geçici ve sistem dosyaları sessiz geçilir (bildirim yok)', () => {
  for (const ad of ['~$teklif.docx', '.DS_Store', 'rapor.pdf.crdownload', 'film.part', 'x.tmp', 'desktop.ini', 'Thumbs.db', 'BENİ OKU.txt', 'kısayol.lnk']) {
    assert.ok(geciciDosyaMi(ad), ad);
    assert.deepEqual(iceAktarimKarari(ad, 100), { tur: 'sessiz' }, ad);
  }
  assert.equal(geciciDosyaMi('toplanti-notu.md'), false);
});
