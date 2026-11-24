// 11 Kas analizi #9: "Yalnız bu bilgisayar"da hatırlatıcı modelsiz — kural tabanlı Türkçe zaman çözücü (shared/tr-zaman.ts) ve yerel yönlendirme
// (shared/yerel-yonlendirme.ts): hatırlatıcı/yapılacak/tarih/hesap/takvim kodla; geri kalanı yerel modele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zamanCoz, zamanMetni, tarihMetni } from '../src/shared/tr-zaman.ts';
import { yerelIsTuru, hatirlaticiBasligi, gorevBasligi, aritmetik, tarihYaniti } from '../src/shared/yerel-yonlendirme.ts';

// Pazartesi 5 Ekim 2026, 10:20 (yerel saat).
const SIMDI = new Date(2026, 9, 5, 10, 20);
const coz = (m: string) => { const r = zamanCoz(m, SIMDI); return r ? { z: zamanMetni(r.zaman), tekrar: r.tekrar, olay: r.olay ? zamanMetni(r.olay) : undefined, saatVar: r.saatVar } : null; };

test('zaman: yarın/gün adı/tarih + saat; "3’te" iş saati; geçen saat yarına, bugünün gün adı gelecek haftaya kayar', () => {
  assert.equal(coz('Yarın 14:00’te Atlas Gıda toplantısını hatırlat.')!.z, '6 Ekim Salı 14:00');
  assert.equal(coz('Perşembe 16:00’da Murat’la bütçe toplantısı var, hatırlat.')!.z, '8 Ekim Perşembe 16:00');
  assert.equal(coz('cuma 16:00')!.z, '9 Ekim Cuma 16:00');
  assert.equal(coz('24 Ekim 15:00')!.z, '24 Ekim Cumartesi 15:00');
  assert.equal(coz('haftaya salı 3’te')!.z, '13 Ekim Salı 15:00');
  assert.equal(coz('pazartesi 9’a')!.z, '12 Ekim Pazartesi 09:00', 'bugün pazartesi ve 09:00 geçti: gelecek hafta');
  assert.equal(coz('akşam 8’de ara')!.z, '5 Ekim Pazartesi 20:00');
  assert.equal(coz('saat 9')!.z, '6 Ekim Salı 09:00', 'yalnız saat ve geçti: yarın');
  assert.equal(coz('2 saat sonra')!.z, '5 Ekim Pazartesi 12:20');
  assert.equal(coz('yarım saat sonra')!.z, '5 Ekim Pazartesi 10:50');
  const g = coz('yarın')!;
  assert.equal(g.z, '6 Ekim Salı 09:00');
  assert.equal(g.saatVar, false, 'saat verilmedi: 09:00 varsayıldı');
});

test('zaman: tekrar ve "bir gün önce"; geçmiş tarih gelecek yıla; anlaşılmayan metin null (uydurmaz)', () => {
  assert.deepEqual(coz('Her pazartesi 10:30’da haftalık raporu hazırlamamı hatırlat.'), { z: '5 Ekim Pazartesi 10:30', tekrar: 'haftalik', olay: undefined, saatVar: true });
  assert.equal(coz('her gün 9:00')!.tekrar, 'gunluk');
  const ada = coz('Kızım Ada’nın okul gösterisi 24 Ekim cumartesi 15:00’te. O gün öğleden sonrayı boş tut, bir gün önce de hatırlat.')!;
  assert.equal(ada.z, '23 Ekim Cuma 15:00');
  assert.equal(ada.olay, '24 Ekim Cumartesi 15:00');
  assert.equal(coz('3 Ocak')!.z, '3 Ocak Pazar 09:00');
  assert.equal(zamanCoz('3 Ocak', SIMDI)!.zaman.getFullYear(), 2027);
  for (const m of ['merhaba', 'Q4 bütçesi 48 milyon', '5 madde olsun', 'Raporları hatırlıyor musun?']) assert.equal(zamanCoz(m, SIMDI), null, m);
  assert.equal(tarihMetni(new Date(2026, 11, 26)), '26 Aralık 2026 Cumartesi');
});

test('yönlendirme: hatırlatıcı/yapılacak/tarih/hesap/takvim kodla; selam, özet, taslak, hatırlama ve olgu bildirimi modele', () => {
  const tur = (m: string) => yerelIsTuru(m);
  assert.equal(tur('Yarın 14:00’te Atlas Gıda toplantısını hatırlat.'), 'hatirlatici');
  assert.equal(tur('ISO 9001 kontrol listesini yapılacaklara ekle, 21 Ekim’e kadar bitmeli.'), 'gorev');
  assert.equal(tur('Bugünden 45 gün sonra hangi gün?'), 'tarih');
  assert.equal(tur('1.500’ün %40’ı'), 'hesap');
  assert.equal(tur('Kâr marjı nedir: gelir 1.250.000 TL, maliyet 1.000.000 TL'), 'hesap');
  assert.equal(tur('Bugün kaçta toplantım var?'), 'takvim');
  for (const m of ['merhaba', 'Raporları hangi biçimde istediğimi hatırlıyor musun?', 'Şu cümleyi İngilizceye çevir: “Teslimat süremiz iki iş günüdür.”',
    'Atlas Gıda sözleşme yenilemesinde zam tavanımız %18. Bunun üstüne çıkmıyoruz, aklında olsun.', 'Kemal Bey’le görüştük, %15 zam teklif ettik, düşünecekler.',
    'Murat’a bütçe revizyonunu görüşmek için kısa bir e-posta taslağı yazar mısın?']) assert.equal(tur(m), 'genel', m);
});

test('başlıklar: zaman ve "hatırlat" çıkar, belirtme eki düşer; yapılacak işin son tarihi ayrılır', () => {
  const b = (m: string) => hatirlaticiBasligi(m, zamanCoz(m, SIMDI));
  assert.equal(b('Yarın 14:00’te Atlas Gıda toplantısını hatırlat.'), 'Atlas Gıda toplantısı');
  assert.equal(b('Perşembe 16:00’da Murat’la bütçe toplantısı var, hatırlat.'), 'Murat’la bütçe toplantısı');
  assert.equal(b('Kızım Ada’nın okul gösterisi 24 Ekim cumartesi 15:00’te. O gün öğleden sonrayı boş tut, bir gün önce de hatırlat.'), 'Ada’nın okul gösterisi');
  const g = gorevBasligi('WMS teklif karşılaştırmasını yapılacaklara ekle, 16 Ekim’e kadar.', SIMDI);
  assert.equal(g.baslik, 'WMS teklif karşılaştırması');
  assert.equal(g.sonTarih && tarihMetni(g.sonTarih), '16 Ekim 2026 Cuma');
});

test('aritmetik ve tarih: kesin sonuç (eval yok); çözülemeyen null', () => {
  assert.equal(aritmetik('12*(3+4)')!.sonuc, 84);
  assert.equal(aritmetik('1250 + 380 kaç eder?')!.sonuc, 1630);
  assert.equal(aritmetik('1.500’ün %40’ı')!.sonuc, 600);
  assert.equal(aritmetik('2.400’ün yüzde 15’i')!.sonuc, 360);
  assert.equal(aritmetik('10 / 0'), null);
  assert.equal(aritmetik('process.exit(1)'), null);
  assert.equal(tarihYaniti('Bugünden 45 gün sonra hangi gün?', new Date(2026, 10, 11, 10)), 'Sonuç: 26 Aralık 2026 Cumartesi.', 'analizin #10 görevi (doğrusu 26 Aralık Cumartesi)');
  assert.equal(tarihYaniti('Bugün ayın kaçı?', SIMDI), 'Bugün 5 Ekim 2026 Pazartesi.');
});
