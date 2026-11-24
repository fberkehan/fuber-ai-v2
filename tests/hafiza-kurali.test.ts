// 11 Kas analizi (model-hafiza.md) #1–#5, #12: hafıza yazım kuralları ve Türkçe kökleyici — saf parçalar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turkceKok, esAnlamlilar } from '../src/shared/tr-kok.ts';
import { acikTercih, acikOlgu, acikSozler, ozKonusmaMi, modelIddiasiMi, celisirMi, ayniTercihMi, benzerlik } from '../src/shared/hafiza-kurali.ts';
import { ftsSorgusu, aramaOneki } from '../src/main/hafiza/normal.ts';
// @ts-expect-error — düz JS persona verisi (kurgusal)
import { GUNLER } from './yardimci/persona-selin.mjs';

test('kökleyici: uzun çekimli sözcük köke iner (kök en az 4 harf), kısa ve rakamlı sözcük olduğu gibi', () => {
  assert.equal(turkceKok('saatlerden'), 'saat');
  assert.equal(turkceKok('ozetleri'), 'ozet');
  assert.equal(turkceKok('raporlari'), 'rapor');
  assert.equal(turkceKok('tavanimiz'), 'tavan');
  assert.ok('toplantilarimi'.startsWith(turkceKok('toplantilarimi')) && turkceKok('toplantilarimi').length >= 4 && turkceKok('toplantilarimi').length <= 8);
  assert.equal(turkceKok('zam'), 'zam');
  assert.equal(turkceKok('9001'), '9001');
  assert.equal(aramaOneki('toplantilarimi').startsWith('toplan'), true, 'eski önek "toplantilari" idi; artık kök');
});

test('eş anlam: rapor~özet, toplantı~görüşme~randevu, tavan~limit; küçük sözlük dışı sözcükte eş yok', () => {
  assert.deepEqual(esAnlamlilar('ozet').sort(), ['brifing', 'rapor']);
  assert.ok(esAnlamlilar(turkceKok('toplantisi')).includes('gorusme'));
  assert.ok(esAnlamlilar('randevu').includes('toplanti'));
  assert.ok(esAnlamlilar('tavan').includes('limit'));
  assert.deepEqual(esAnlamlilar('kahve'), []);
});

test('FTS sorgusu: raporun başarısız iki sorusu artık doğru terimleri taşır (kök + eş anlam)', () => {
  const t = ftsSorgusu('Toplantılarımı hangi saatlerden sonra istiyordum?')!;
  assert.match(t, /"toplan\w*"\*/);
  assert.match(t, /"saat"\*/);
  assert.match(t, /"gorusme"\*/);
  const o = ftsSorgusu('Özetleri nasıl yazmanı istemiştim?')!;
  assert.match(o, /\("ozet"\* OR "rapor"\*/);
  // VE kipinde eşler parantez içinde gruplanır (belge araması).
  assert.match(ftsSorgusu('rapor bütçe', 've')!, /^\("rapo\w*"\* OR [^)]*\) AND /);
});

test('açık tercih: persona\'nın üç tercihi çekirdek adayı; gürültü, hatırlatma ve soru tercih değil', () => {
  const metinler = (GUNLER as { metin?: string; olgu?: string; k: string }[][]).flat().filter((e) => e.metin && e.k !== 'p');
  const tercih = metinler.filter((e) => acikTercih(e.metin!)).map((e) => e.olgu ?? e.metin!.slice(0, 30));
  assert.deepEqual(tercih, ['F1', 'F2', 'F3', 'F12'], JSON.stringify(tercih));
  const f1 = acikTercih('Bir şey söyleyeyim: raporları bana hep madde madde ver, en fazla 5 madde olsun ve en başta tek cümlelik sonuç yaz. Uzun paragraf sevmiyorum.')!;
  assert.equal(f1.sabit, true);
  assert.equal(f1.tur, 'tercih');
  assert.match(f1.icerik, /madde madde/);
  assert.match(f1.icerik, /Uzun paragraf sevmiyorum/, 'ilgili bütün cümleler aynen');
  assert.doesNotMatch(f1.baslik, /Bir şey söyleyeyim/);
  const f3 = acikTercih('Murat’a yazarken resmi olma lütfen. “Murat Bey” deme, “Murat” de, kısa ve samimi olsun. Yıllardır birlikte çalışıyoruz.')!;
  assert.match(f3.icerik, /“Murat Bey” deme, “Murat” de/, 'kural tam okunur');
  assert.doesNotMatch(f3.icerik, /Yıllardır/, 'tercih olmayan cümle girmez');
  for (const g of ['Kaç saat uyumuşum biliyor musun, 5 saat. Kahve şart.', 'Her pazartesi 10:30’da haftalık raporu hazırlamamı hatırlat.', 'Raporları hep madde madde mi istiyordum?', 'Bugün çok yoruldum.']) {
    assert.equal(acikTercih(g), null, g);
  }
});

test('açık olgu: "aklında olsun / unutma" kullanıcının cümlesi aynen, çekirdek değil', () => {
  const o = acikOlgu('Atlas Gıda sözleşme yenilemesinde zam tavanımız %18. Bunun üstüne çıkmıyoruz, aklında olsun.')!;
  assert.equal(o.sabit, false);
  assert.equal(o.tur, 'bilgi');
  assert.match(o.icerik, /%18/);
  assert.deepEqual(acikSozler('merhaba'), []);
});

test('öz-konuşma süzgeci: "Fuber erişimi yok / yapamaz" kayıt değildir; olağan olgu geçer', () => {
  for (const s of ['Fuber tek başına çalışıyor; tarayıcı, e-posta ve hatırlatma araçlarına erişimi yok.', 'Fuber araç erişimi yok', 'Mevcut Durum: Tarayıcı, e-posta ve araç erişimi mevcut değil', 'Fuber e-posta gönderemez', 'Merak sorusu']) {
    assert.equal(ozKonusmaMi(s), true, s);
  }
  for (const s of ['Atlas Gıda zam tavanı %18', 'İzmir depo açılışı 4 Aralık', 'Murat finans müdürü']) assert.equal(ozKonusmaMi(s), false, s);
});

test('model iddiası: kullanıcının yazmadığı yüzde/para tutarı reddedilir; kullanıcınınki geçer', () => {
  assert.equal(modelIddiasiMi('Kâr marjı %25', 'Gelir 1.250.000, gider 1.000.000; kâr marjı nedir?'), true);
  assert.equal(modelIddiasiMi('Atlas tavanı %18', 'Atlas Gıda zam tavanımız %18.'), false);
  assert.equal(modelIddiasiMi('Yemek kartı 3.200 TL', 'yemek kartı kişi başı aylık 3.200 TL'), false);
  assert.equal(modelIddiasiMi('Toplantı 14:00', 'yarın 14:00 toplantı'), false, 'saat iddia sayılmaz');
});

test('çelişki: aynı konu yeni tarihle gelirse "yeni söz kazanır"; farklı konu çelişki değildir', () => {
  assert.equal(celisirMi({ baslik: 'İzmir depo açılışı', icerik: 'İzmir depo açılışı 20 Kasım' }, { baslik: 'İzmir açılışı', icerik: 'İzmir açılışı 4 Aralık’a kaydı' }), true);
  assert.equal(celisirMi({ baslik: 'Ege Tekstil imzası', icerik: 'İmza 20 Kasım' }, { baslik: 'Ege Tekstil imzası', icerik: 'İmza 27 Kasım’a kaydı' }), true);
  assert.equal(celisirMi({ baslik: 'İzmir depo açılışı', icerik: '20 Kasım' }, { baslik: 'Q4 ciro hedefi', icerik: '48 milyon' }), false);
  assert.ok(benzerlik('Tercih: raporları madde madde ver', 'Tercih: sabah 10’dan önce toplantı koyma') < 0.5, 'kalıp önekleri benzerliği şişirmez');
  // Tercih değişikliği: aynı konu (rapor + madde) yeni sayıyla → yeni söz kazanır; persona'nın dört tercihi birbirine karışmaz.
  const P = [
    'Bir şey söyleyeyim: raporları bana hep madde madde ver, en fazla 5 madde olsun ve en başta tek cümlelik sonuç yaz. Uzun paragraf sevmiyorum.',
    'Bir de sabah 10’dan önce bana toplantı koyma, o saatler derin çalışma saatim.',
    'Murat’a yazarken resmi olma lütfen. “Murat Bey” deme, “Murat” de, kısa ve samimi olsun.',
    'Öğle yemeği önerirken bilmen gereken bir şey var: glütensiz besleniyorum.',
  ].map((m) => acikTercih(m)!);
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P.length; j++) if (i !== j) assert.equal(ayniTercihMi(P[i], P[j]), false, `${i}~${j}`);
  assert.equal(ayniTercihMi(P[0], acikTercih('Raporlarda fikrim değişti: bundan sonra en fazla 3 madde ver, yine madde madde olsun.')!), true);
});
