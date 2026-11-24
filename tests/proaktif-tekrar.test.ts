// 11 Kas analizi #6, #9, #10, #8: kendiliğinden mesaj tekrar bekçisi, yerel şablon özet, sohbet özetinin kesimi ve §6.4 yerel istem — saf parçalar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tekrarMi, govde, gecmiseEkle, gecmisiOku, oncekilerMetni, beklemeli, oncekiyleAyniMi, PROAKTIF_GECMIS_BOYU, PROAKTIF_ARALIK_MS, type ProaktifIz } from '../src/shared/proaktif-tekrar.ts';
import { yerelOzetMetni } from '../src/shared/yerel-ozet.ts';
import { ozetKesimi } from '../src/main/ajan/gecmis.ts';
import { yerelSistemIstemi, ilgiEki, kopulaEki, YEREL_HAFIZA_BUTCESI } from '../src/shared/yerel-istem.ts';
import { VARSAYILAN_KARAKTERLER } from '../src/shared/karakterler.ts';

const BAYAT = 'Bugün senin için öncelikli olanlar: 1) ISO 9001 kontrol listesi (21 Eki), 2) 14:00 Atlas Gıda toplantısı, 3) Q4 bütçesi hazırlığı. Yaklaşan hatırlatıcı: 14:00.';
const iz = (is: string, metin: string, gunOnce = 1): ProaktifIz => ({ is, metin, zaman: new Date(Date.now() - gunOnce * 86_400_000).toISOString() });

test('tekrar: bayat sabah özeti ve aynı merak sorusu yakalanır — listenin TAMAMINDA (yalnız son 10 değil); farklı mesaj geçer', () => {
  const gecmis: ProaktifIz[] = [iz('sabah', BAYAT, 25), ...Array.from({ length: 30 }, (_, i) => iz('merak', `Farklı soru ${i}: ekibin ${['satış', 'finans', 'İK', 'operasyon', 'depo'][i % 5]} tarafında ${i}. konu`, 20 - i / 2))];
  assert.equal(tekrarMi('Bugün senin için öncelikli olanlar: 1) ISO 9001 kontrol listesi (21 Ekim), 2) 14:00 Atlas Gıda toplantısı, 3) Q4 bütçesi hazırlığı.', gecmis), true, '25 gün önceki özet (liste başında) de görülür');
  const merak = [iz('merak', 'Selin, bu yoğunlukta en kritik nokta ISO 9001 denetimi mi, yoksa Q4 bütçesi mi?')];
  assert.equal(tekrarMi('Selin, bu yoğunlukta en kritik nokta ISO denetimi mi yoksa Q4 bütçesi mi?', merak), true);
  assert.equal(tekrarMi('Haftanın hangi günü en verimli olduğunu hissediyorsun?', merak), false);
  // Kalıp ("Günaydın Selin!", "Bugün:") benzerlik sayılmaz; gövde farklıysa tekrar değildir.
  assert.equal(govde('Günaydın Selin!\nBugün:\n- 16:00 Murat ile bütçe toplantısı'), '- 16:00 Murat ile bütçe toplantısı');
  assert.equal(tekrarMi('Günaydın Selin!\nBugün:\n- 16:00 Murat ile bütçe toplantısı', [iz('sabah', 'Günaydın Selin!\nBugün:\n- 14:00 Atlas Gıda toplantısı')]), false);
  assert.equal(tekrarMi('', gecmis), false);
});

test('geçmiş listesi: en çok 60, bozuk meta güvenle boş; talimata eklenen "daha önce sorduğun" bölümü yalnız aynı tür', () => {
  let l: ProaktifIz[] = [];
  for (let i = 0; i < 75; i++) l = gecmiseEkle(l, { is: 'merak', metin: `soru ${i}`, zaman: new Date().toISOString() });
  assert.equal(l.length, PROAKTIF_GECMIS_BOYU);
  assert.equal(l[0].metin, 'soru 15');
  assert.deepEqual(gecmisiOku('{bozuk'), []);
  assert.deepEqual(gecmisiOku(JSON.stringify([{ is: 'merak', metin: 'a', zaman: 'x' }, { yanlis: 1 }])).length, 1);
  const m = oncekilerMetni([iz('sabah', BAYAT), iz('merak', 'Ekibinde en çok kime güveniyorsun?')], 'merak');
  assert.match(m, /SORMA/);
  assert.match(m, /kime güveniyorsun/);
  assert.doesNotMatch(m, /öncelikli/);
  assert.equal(oncekilerMetni([], 'merak'), '');
});

test('bekleme: iki kendiliğinden mesaj arası 90 dk; son 3 merak yanıtsızsa 2 gün susar; kullanıcı son 30 dk yazdıysa merak sorulmaz', () => {
  const simdi = Date.now();
  const yakin = [{ is: 'sabah', metin: 'x', zaman: new Date(simdi - PROAKTIF_ARALIK_MS + 60_000).toISOString() }];
  assert.equal(beklemeli('merak', yakin, simdi, { yanitlandi: [] }), true);
  assert.equal(beklemeli('sabah', [{ ...yakin[0], zaman: new Date(simdi - 3 * 3600_000).toISOString() }], simdi, { yanitlandi: [] }), false);
  const uc = [iz('merak', 'a', 3), iz('merak', 'b', 2), iz('merak', 'c', 1)];
  assert.equal(beklemeli('merak', uc, simdi, { yanitlandi: [false, false, false] }), true, 'yanıtsız üç sorudan sonra merak yarı sıklığa iner');
  assert.equal(beklemeli('merak', uc, simdi, { yanitlandi: [false, true, false] }), false);
  assert.equal(beklemeli('sabah', uc, simdi, { yanitlandi: [false, false, false] }), false, 'susma yalnız merak için');
  assert.equal(beklemeli('merak', [], simdi, { yanitlandi: [], sonKullanici: simdi - 10 * 60_000 }), true);
});

test('yerel şablon özet: bugünün hatırlatıcıları ve son tarihi yaklaşan işler; boşsa mesaj yok; dünküyle aynıysa yeniden gönderilmez', () => {
  const s = yerelOzetMetni('sabah', { hitap: 'Selin', hatirlaticilar: [{ zaman: new Date(2026, 9, 6, 14, 0).toISOString(), baslik: 'Atlas Gıda toplantısı' }], acik: [], biten: [] })!;
  assert.match(s, /^Günaydın Selin!\nBugün:\n- 14:00 Atlas Gıda toplantısı$/);
  assert.equal(yerelOzetMetni('sabah', { hitap: 'Selin', hatirlaticilar: [], acik: [], biten: [] }), null);
  const a = yerelOzetMetni('aksam', { hitap: '', hatirlaticilar: [], acik: [], biten: [{ baslik: 'ISO kontrol listesi' }] })!;
  assert.match(a, /Bugün tamamlananlar:\n- ISO kontrol listesi/);
  assert.equal(oncekiyleAyniMi(s, [iz('sabah', s)], 'sabah'), true);
  assert.equal(oncekiyleAyniMi(s, [iz('sabah', 'Günaydın Selin!\nBugün:\n- 10:30 Haftalık rapor')], 'sabah'), false);
});

test('sohbet özeti kesimi: araç çağrısı ile sonucu ayrı bölümlere düşmez; kısa kayıtta kesim yok', () => {
  const m = (id: number, rol: string, tur: string) => ({ id, rol, bloklar: [{ tur }] });
  const l = [m(1, 'user', 'metin'), m(2, 'assistant', 'metin'), m(3, 'user', 'metin'), m(4, 'assistant', 'metin'), m(5, 'user', 'metin'),
    m(6, 'assistant', 'arac_cagri'), m(7, 'user', 'arac_sonuc'), m(8, 'assistant', 'arac_cagri'), m(9, 'user', 'arac_sonuc'), m(10, 'assistant', 'metin')];
  const k = ozetKesimi(l)!; // %60 = 6 (çağrı) → sonucuyla birlikte kalmalı
  assert.ok(![6, 8].includes(k.id), `kesim bir çağrıda değil: ${k.id}`);
  assert.notEqual(l[l.indexOf(k) + 1].bloklar[0].tur, 'arac_sonuc', 'kesimden sonraki ilk ileti yetim sonuç değil');
  assert.equal(ozetKesimi(l.slice(0, 3)), null);
});

test('§6.4 yerel istem: yapabildikleri önce, araçsızlık tek kez, "aracın yok" cümlesi yok; Türkçe ekler ünlü uyumuyla; hafıza bütçesi 600', () => {
  assert.equal(ilgiEki('Selin'), 'Selin’in');
  assert.equal(ilgiEki('Ada'), 'Ada’nın');
  assert.equal(ilgiEki('Deniz Yılmaz'), 'Deniz Yılmaz’ın');
  assert.equal(ilgiEki('Özgür'), 'Özgür’ün');
  assert.equal(kopulaEki('Fuber'), 'Fuber’sin');
  assert.equal(kopulaEki('Ada'), 'Ada’sın');
  const s = yerelSistemIstemi({ asistanAdi: 'Fuber', kullaniciAdi: 'Selin', hitap: 'Selin', karakter: VARSAYILAN_KARAKTERLER.business });
  assert.match(s, /^Sen Fuber’sin: Selin’in kişisel yapay zekâ asistanısın/);
  assert.ok(s.indexOf('Yapabildiklerin:') < s.indexOf('Yapamadıkların:'), 'yapabildikleri önce');
  assert.match(s, /istenmedikçe bundan söz etme/);
  assert.match(s, /Çekirdek hafızadaki tercihlere .* uy/);
  assert.match(s, /"Sonuç:" satırını ver \(taslak ve çeviride değil\)/);
  assert.doesNotMatch(s, /aracın yok|Fuber'sın|nın kişisel/);
  assert.equal(s.match(/Yapamadıkların/g)?.length, 1);
  assert.equal(YEREL_HAFIZA_BUTCESI, 600);
});
