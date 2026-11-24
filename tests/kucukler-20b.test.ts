// Görev 20b'nin küçük saf yardımcıları: plan önceliği (K16), yerel beyin kaldırma boyutu (K2), reddedilen dosya tostlarının
// gruplanması (G19), durdurulan yanıtın kaydı (K14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oncelikGorunumu } from '../src/shared/oncelik.ts';
import { yerelKaldirmaBoyutu, CALISTIRICI_PAYI, kaldirmaHataMetni } from '../src/shared/yerel-boyut.ts';
import { reddedilenMetni } from '../src/shared/tost-grup.ts';
import { durdurmaKayitlari, DURDURULDU } from '../src/main/ajan/durdurma.ts';

test('plan önceliği tek nokta + sayı: 5 kırmızı, 4 turuncu, altı nötr; 1–5 arasına kırpılır', () => {
  assert.deepEqual(oncelikGorunumu(5), { sayi: 5, nokta: 'kirmizi', etiket: 'Öncelik 5/5' });
  assert.deepEqual(oncelikGorunumu(4), { sayi: 4, nokta: 'turuncu', etiket: 'Öncelik 4/5' });
  assert.equal(oncelikGorunumu(3).nokta, null);
  assert.equal(oncelikGorunumu(9).sayi, 5);
  assert.equal(oncelikGorunumu(0).sayi, 1);
  assert.equal(oncelikGorunumu(Number.NaN).sayi, 3);
});

test('yerel beyin kaldırma boyutu: kurulu modeller + çalıştırıcı payı (kurulu değilse 0)', () => {
  const modeller = [{ boyut: 10e9, kurulu: true }, { boyut: 4e9, kurulu: false }, { boyut: 2e9, kurulu: true }];
  assert.equal(yerelKaldirmaBoyutu({ kurulu: { calistirici: true }, modeller }), 12e9 + CALISTIRICI_PAYI);
  assert.equal(yerelKaldirmaBoyutu({ kurulu: { calistirici: false }, modeller: [{ boyut: 1e9, kurulu: false }] }), 0);
});

// Düzeltme turu 1: kaldırma hatası İş modunda ham yol/kod göstermez; Geliştirici'de ayrıntı kalır (IPC öneki atılır).
test('yerel beyin kaldırma hatası: İş modunda sade, yolsuz; Geliştirici\'de ayrıntılı', () => {
  const ham = "Error invoking remote method 'yerel:kaldir': Error: EBUSY: resource busy or locked, rmdir 'C:\\Kullanicilar\\Deniz\\AppData\\Roaming\\Fuber AI\\yerel\\llama'";
  const is = kaldirmaHataMetni(ham, true);
  assert.ok(!/C:\\|EBUSY|invoking/.test(is), is);
  assert.match(is, /kaldırılamadı/);
  assert.match(kaldirmaHataMetni(ham, false), /^EBUSY: resource busy/);
});

test('reddedilen tek dosya eskisi gibi; birden çoğu tek tost: "N dosya öğretilemedi"', () => {
  assert.equal(reddedilenMetni([{ dosya: 'a.png', mesaj: 'dosya boş.' }]), 'a.png okunamadı: dosya boş.');
  const tur = (u: string) => `bu dosya türü (${u}) öğretilemiyor. Desteklenenler: metin, PDF.`;
  const iki = reddedilenMetni([{ dosya: 'a.png', mesaj: tur('.png') }, { dosya: 'b.exe', mesaj: tur('.exe') }]);
  assert.match(iki, /^2 dosya öğretilemedi: a\.png, b\.exe\./);
  assert.match(iki, /Desteklenenler: metin, PDF\.$/, 'hepsi tür reddiyse desteklenenler bir kez yazılır');
  const bes = reddedilenMetni(['1', '2', '3', '4', '5'].map((n) => ({ dosya: `${n}.zip`, mesaj: 'dosya boş.' })));
  assert.equal(bes, '5 dosya öğretilemedi: 1.zip, 2.zip, 3.zip ve 2 dosya daha. Dosya boş.');
  const karisik = reddedilenMetni([{ dosya: 'a.txt', mesaj: 'dosya boş.' }, { dosya: 'b.pdf', mesaj: 'dosya çok büyük (60 MB üstü).' }]);
  assert.equal(karisik, '2 dosya öğretilemedi: a.txt, b.pdf.');
});

test('durdurulan yanıt: yarım metin kalır, ardından kalıcı "Durduruldu." notu; metin yoksa yalnız not', () => {
  assert.equal(DURDURULDU, 'Durduruldu.');
  assert.deepEqual(durdurmaKayitlari({ yarimMetin: 'Bu yanıt yavaş ', model: 'm1' }), [
    { rol: 'assistant', bloklar: [{ tur: 'metin', metin: 'Bu yanıt yavaş' }], kaynak: 'durduruldu', model: 'm1' },
    { rol: 'not', bloklar: [{ tur: 'metin', metin: 'Durduruldu.' }] },
  ]);
  assert.deepEqual(durdurmaKayitlari({ yarimMetin: '  \n' }), [{ rol: 'not', bloklar: [{ tur: 'metin', metin: 'Durduruldu.' }] }]);
  // Kullanıcının görmediği (kendiliğinden) turda görünür bir şey yoksa iz bırakılmaz; yarım metin göründüyse kalır.
  assert.deepEqual(durdurmaKayitlari({ yarimMetin: '', gizliTetik: true }), []);
  assert.equal(durdurmaKayitlari({ yarimMetin: 'Günaydın', gizliTetik: true }).length, 2);
});
