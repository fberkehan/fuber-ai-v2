// 0.14 T25 — LRC ayrıştırma ve etkin satır (src/shared/lrc.ts; saf). Şarkı sözü sayfası (Soz.tsx) satır vurgusunu bu iki işlevle ve satır başına TEK
// setTimeout zinciriyle kurar (B33): sonraki satırın başına kalan süre `sonrakiSatirSn`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etkinSatir, lrcAyristir, sonrakiSatirSn, sozAnahtari, sozDurumMetni, SOZ_METNI, type LrcSatiri } from '../src/shared/lrc.ts';
import { BULUT_KAPALI_METNI } from '../src/shared/bulut-kapisi.ts';

test('lrcAyristir: çok damgalı satır, offset, boş satır', () => {
  const lrc = [
    '[ar:Sezen Aksu]',
    '[ti:Firuze]',
    '[offset:+500]',
    '',
    '[00:12.00][01:02.50]Nakarat satırı',
    '[00:05.20]İlk satır\r',
    '[00:20.00]',
    '   ',
    '[00:30.123]<00:30.20>Sözcük <00:31.00>sözcük',
    'damgasız satır düşer',
  ].join('\n');
  const s = lrcAyristir(lrc);
  // offset +500 ms: sözler yarım saniye ÖNCE gösterilir (LRC: artı değer zamanı öne alır).
  assert.deepEqual(s, [
    { sn: 4.7, metin: 'İlk satır' },
    { sn: 11.5, metin: 'Nakarat satırı' },
    { sn: 19.5, metin: '' },
    { sn: 29.623, metin: 'Sözcük sözcük' },
    { sn: 62, metin: 'Nakarat satırı' },
  ]);
});

test('lrcAyristir: eksi offset, iki haneli/üç haneli kesir, [mm:ss] ve bozuk girdi', () => {
  assert.deepEqual(lrcAyristir('[offset:-1000]\n[00:01.5]a\n[00:02]b\n[00:03:25]c'), [
    { sn: 2.5, metin: 'a' }, { sn: 3, metin: 'b' }, { sn: 4.25, metin: 'c' },
  ]);
  // Offset sıfırın altına itemez.
  assert.deepEqual(lrcAyristir('[offset:3000]\n[00:01.00]x'), [{ sn: 0, metin: 'x' }]);
  assert.deepEqual(lrcAyristir(''), []);
  assert.deepEqual(lrcAyristir(undefined as unknown as string), []);
  assert.deepEqual(lrcAyristir('[aa:bb]x\n[00:99.00]y'), [], 'saniye 59\'u aşamaz, harf damga değildir');
});

test('etkinSatir sınırlarda doğru', () => {
  const s: LrcSatiri[] = [{ sn: 5, metin: 'a' }, { sn: 10, metin: 'b' }, { sn: 10, metin: 'b2' }, { sn: 20, metin: 'c' }];
  assert.equal(etkinSatir([], 3), -1);
  assert.equal(etkinSatir(s, 0), -1, 'ilk satırdan önce hiçbiri');
  assert.equal(etkinSatir(s, 4.999), -1);
  assert.equal(etkinSatir(s, 5), 0, 'tam başında o satır');
  assert.equal(etkinSatir(s, 9.999), 0);
  assert.equal(etkinSatir(s, 10), 2, 'aynı anda iki satır: sonuncusu');
  assert.equal(etkinSatir(s, 19.99), 2);
  assert.equal(etkinSatir(s, 20), 3);
  assert.equal(etkinSatir(s, 9999), 3, 'son satırdan sonra son satır');
  assert.equal(etkinSatir(s, Number.NaN), -1);
});

test('sonrakiSatirSn: zincirin bir sonraki adımı; sonda null', () => {
  const s: LrcSatiri[] = [{ sn: 5, metin: 'a' }, { sn: 10, metin: 'b' }, { sn: 20, metin: 'c' }];
  assert.equal(sonrakiSatirSn(s, 0), 5);
  assert.equal(sonrakiSatirSn(s, 5), 10, 'tam başında: bir sonraki');
  assert.equal(sonrakiSatirSn(s, 12), 20);
  assert.equal(sonrakiSatirSn(s, 20), null);
  assert.equal(sonrakiSatirSn([], 1), null);
});

test('sozAnahtari parçayı büyük/küçük harf ve boşluktan bağımsız tanır, süreyi saniyeye yuvarlar', () => {
  assert.equal(sozAnahtari({ baslik: ' Firuze ', sanatci: 'SEZEN AKSU', album: 'Firuze', sure: 241.4 }), sozAnahtari({ baslik: 'firuze', sanatci: 'sezen aksu', album: 'firuze', sure: 241 }));
  assert.notEqual(sozAnahtari({ baslik: 'a', sanatci: 'b', sure: 100 }), sozAnahtari({ baslik: 'a', sanatci: 'b', sure: 140 }));
});

test('sonuç metinleri: 404 cümlesi, Gizli satırı BULUT_KAPALI_METNI.soz', () => {
  assert.equal(SOZ_METNI.bulunamadi, 'Bu şarkının sözleri bulunamadı.');
  assert.equal(SOZ_METNI.yok, 'Şu an çalan bir şey yok.');
  assert.equal(sozDurumMetni({ tur: 'bulunamadi' }), 'Bu şarkının sözleri bulunamadı.');
  assert.equal(sozDurumMetni({ tur: 'kapali' }), BULUT_KAPALI_METNI.soz);
  assert.equal(sozDurumMetni({ tur: 'hata' }), SOZ_METNI.hata);
  assert.equal(sozDurumMetni(null), SOZ_METNI.araniyor);
  assert.equal(sozDurumMetni({ tur: 'esli', satirlar: [{ sn: 1, metin: 'x' }] }), null);
  assert.equal(sozDurumMetni({ tur: 'duz', metin: 'x' }), null);
});
