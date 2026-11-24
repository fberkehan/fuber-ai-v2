// Sayıları yazıyla okuma (Görev 21 düzeltme 7 + düzeltme turu 2): Flash v2.5 sayıları zayıf okuduğu için (ElevenLabs belgesi:
// Normalization) konuşulacak cümledeki saat, tarih, tutar, yüzde, sıra sayısı, sürüm ve sayılar Türkçe yazıya çevrilir; ekler doğru kalır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sayiYazi, siraYazi, sayilariOku, iyelikEki } from '../src/shared/sayi-okuma.ts';

const okut = (ornekler: [string, string][]) => { for (const [g, c] of ornekler) assert.equal(sayilariOku(g), c, g); };

test('tam sayılar: bin/yüz tekliksiz, milyon/milyar birli', () => {
  const beklenen: [number, string][] = [
    [0, 'sıfır'], [7, 'yedi'], [10, 'on'], [11, 'on bir'], [99, 'doksan dokuz'], [100, 'yüz'], [101, 'yüz bir'], [250, 'iki yüz elli'],
    [1000, 'bin'], [1001, 'bin bir'], [2026, 'iki bin yirmi altı'], [15000, 'on beş bin'], [100000, 'yüz bin'], [1_000_000, 'bir milyon'],
    [3_500_000, 'üç milyon beş yüz bin'], [1_000_000_000, 'bir milyar'], [1_234_567, 'bir milyon iki yüz otuz dört bin beş yüz altmış yedi'],
  ];
  for (const [n, y] of beklenen) assert.equal(sayiYazi(n), y, String(n));
});

test('sıra sayıları ünlü uyumuyla; "dört" → "dördüncü"', () => {
  const beklenen: [number, string][] = [[1, 'birinci'], [2, 'ikinci'], [3, 'üçüncü'], [4, 'dördüncü'], [6, 'altıncı'], [9, 'dokuzuncu'],
    [10, 'onuncu'], [25, 'yirmi beşinci'], [40, 'kırkıncı'], [60, 'altmışıncı'], [100, 'yüzüncü'], [1000, 'bininci'], [24, 'yirmi dördüncü']];
  for (const [n, y] of beklenen) assert.equal(siraYazi(n), y, String(n));
});

test('cümlelerde: saat, tarih, tutar, yüzde, sıra, ondalık; ekler korunur', () => {
  okut([
    ['Yarın saat 10:00\'da toplantın var.', 'Yarın saat onda toplantın var.'],
    ['Toplantı 12.30’da, sunum 9:05’te.', 'Toplantı on iki otuzda, sunum dokuz sıfır beşte.'],
    ['Son tarih 25.10.2026.', 'Son tarih yirmi beş Ekim iki bin yirmi altı.'],
    ['Fiyat 3.500.000 TL.', 'Fiyat üç milyon beş yüz bin lira.'],
    ['Kampanya %40 indirimli, ₺250 yerine.', 'Kampanya yüzde kırk indirimli, iki yüz elli lira yerine.'],
    ['Bu 3. kez oluyor ve 25. yılımız.', 'Bu üçüncü kez oluyor ve yirmi beşinci yılımız.'],
    ['Büyüme 3,5 milyon; oran 2.5 kat.', 'Büyüme üç virgül beş milyon; oran iki nokta beş kat.'],
    ['Saat 3\'te ara ver, 2026\'da bitir.', 'Saat üçte ara ver, iki bin yirmi altıda bitir.'],
    ['Numara 0500 123 45 67.', 'Numara sıfır beş yüz yüz yirmi üç kırk beş altmış yedi.'],
    ['3B model ve H2O.', 'üç B model ve H2O.'],
  ]);
});

test('düzeltme turu 2 — para: cümle sonu noktalama yutulmaz; TR ve EN binlik/ondalık; kesir alt birimle', () => {
  okut([
    ['Toplam $50.', 'Toplam elli dolar.'],
    ['Toplam ₺1.250, KDV dahil.', 'Toplam bin iki yüz elli lira, KDV dahil.'],
    ['Tutar $1,000,000 oldu.', 'Tutar bir milyon dolar oldu.'],
    ['Tutar $1,000,000.5 oldu.', 'Tutar bir milyon virgül beş dolar oldu.'],
    ['Fatura 1.250,50 TL.', 'Fatura bin iki yüz elli lira elli kuruş.'],
    ['Kahve $3.50, çay €2.', 'Kahve üç dolar elli sent, çay iki avro.'],
    ['Bütçe 1.000.000 TL, gelir 2,500,000 kişi başı.', 'Bütçe bir milyon lira, gelir iki milyon beş yüz bin kişi başı.'],
    ['Oran %12,5 arttı.', 'Oran yüzde on iki virgül beş arttı.'],
    ['Toplam 1.250,50 adet.', 'Toplam bin iki yüz elli virgül elli adet.'],
    ['EN 1,000,000.25 değer.', 'EN bir milyon virgül yirmi beş değer.'],
  ]);
});

test('düzeltme turu 2 — saat yalnız bağlam söylerse; noktalı sayı ve sürüm "nokta"; gün.ay tarih', () => {
  okut([
    ['Python 3.12 kurulu.', 'Python üç nokta on iki kurulu.'],
    ['Oran 1.25 kat arttı.', 'Oran bir nokta yirmi beş kat arttı.'],
    ['Saat 14.30 gibi geliyorum.', 'Saat on dört otuz gibi geliyorum.'],
    ['14.30 civarında uğrarım.', 'on dört otuz civarında uğrarım.'],
    ['Fuber 0.9.0 çıktı; v0.9.0 etiketi de var.', 'Fuber sıfır nokta dokuz nokta sıfır çıktı; sıfır nokta dokuz nokta sıfır etiketi de var.'],
    ['Sürüm v2.1 hazır.', 'Sürüm iki nokta bir hazır.'],
    ['Teslim 12.10 tarihinde.', 'Teslim on iki Ekim tarihinde.'],
    ['Görüşme 12.10\'da.', 'Görüşme on iki onda.'],
    ['Görüşme 12.10\'de.', 'Görüşme on iki Ekimde.'],
    ['Rapor 2026-10-25 tarihli.', 'Rapor yirmi beş Ekim iki bin yirmi altı tarihli.'],
    ['Sunucu 192.168.1.10 adresinde.', 'Sunucu yüz doksan iki nokta yüz altmış sekiz nokta bir nokta on adresinde.'],
  ]);
});

test('düzeltme turu 3 — saat aralıkları ve tam saat "HH.00"', () => {
  okut([
    ['Toplantı 14.00-15.00 arası.', 'Toplantı on dört ile on beş arası.'],
    ['20.30 ile 21.00 arasında ararım.', 'yirmi otuz ile yirmi bir arasında ararım.'],
    ['Mesai 9:00–17:30.', 'Mesai dokuz ile on yedi otuz.'],
    ['Yemek 13.00 sonrası.', 'Yemek on üç sonrası.'],
    ['Başlangıç 09.00\'da.', 'Başlangıç dokuzda.'],
    ['Fiyat $1.00 oldu.', 'Fiyat bir dolar oldu.'],
  ]);
});

test('düzeltme turu 4 — ondalık çiftler saat aralığı DEĞİL (gerçek saat bağlamı gerekir); tur 3 olumluları korunur', () => {
  okut([
    ['Oran 1.25 ile 1.50 arasında.', 'Oran bir nokta yirmi beş ile bir nokta elli arasında.'],
    ['Ortalama 2.50-3.50 arası.', 'Ortalama iki nokta elli-üç nokta elli arası.'],
    ['Sürüm 1.10 ve 1.20 çıktı.', 'Sürüm bir nokta on ve bir nokta yirmi çıktı.'],
    // Tur 3'ün olumluları:
    ['Toplantı 14.00-15.00 arası.', 'Toplantı on dört ile on beş arası.'],
    ['20.30 ile 21.00 arasında ararım.', 'yirmi otuz ile yirmi bir arasında ararım.'],
    ['Randevu saat 13.00.', 'Randevu saat on üç.'],
    ['Mesai 9:00–17:30.', 'Mesai dokuz ile on yedi otuz.'],
    ['Saat 10.10 ile 10.40 arası.', 'Saat on on ile on kırk arası.'],
  ]);
});

// Düzeltme turu 5: Türkçede ondalık ayırıcı virgüldür — noktalı H.MM varsayılan olarak saattir; ondalık yalnız yakın önde oran/ortalama/
// sürüm/versiyon/yüzde/endeks/katsayı, hemen önde v/x/%, hemen arkada birim varsa. "Değerli", "Kur/Fiyat/Puan/Kat toplantısı" saati bozmaz.
test('düzeltme turu 5 — iki yönlü matris: saat olarak', () => {
  okut([
    ['Değerli müşterimiz, randevunuz 10.00 ile 11.00 arası.', 'Değerli müşterimiz, randevunuz on ile on bir arası.'],
    ['Değerlendirme toplantısı yarın 15.00.', 'Değerlendirme toplantısı yarın on beş.'],
    ['Kur toplantısı 14.00-15.00 arası.', 'Kur toplantısı on dört ile on beş arası.'],
    ['Fiyat toplantısı 14.00-15.00 arası.', 'Fiyat toplantısı on dört ile on beş arası.'],
    ['Puan toplantısı 14.00-15.00 arası.', 'Puan toplantısı on dört ile on beş arası.'],
    ['Bu yüzden toplantı 14.00-15.00 arası.', 'Bu yüzden toplantı on dört ile on beş arası.'],
    ["Toplantı 14.30'da.", 'Toplantı on dört otuzda.'],
    ['14.00-15.00 arası.', 'on dört ile on beş arası.'],
    ['20.30 ile 21.00 arasında ararım.', 'yirmi otuz ile yirmi bir arasında ararım.'],
    ['Randevu saat 13.00.', 'Randevu saat on üç.'],
  ]);
});

test('düzeltme turu 5 — iki yönlü matris: ondalık ya da değişmeden', () => {
  okut([
    ['Oran 1.25 ile 1.50 arasında.', 'Oran bir nokta yirmi beş ile bir nokta elli arasında.'],
    ['Ortalama 2.50-3.50 arası.', 'Ortalama iki nokta elli-üç nokta elli arası.'],
    ['Sürüm 1.10 ve 1.20 çıktı.', 'Sürüm bir nokta on ve bir nokta yirmi çıktı.'],
    ['Etiket v1.10 hazır.', 'Etiket bir nokta on hazır.'],
    ['Artış %2.5 oldu.', 'Artış yüzde iki nokta beş oldu.'],
    ['Tutar 1.250 TL.', 'Tutar bin iki yüz elli lira.'],
    ['Fuber 0.9.0 çıktı.', 'Fuber sıfır nokta dokuz nokta sıfır çıktı.'],
    ['Tarih 25.10.2026.', 'Tarih yirmi beş Ekim iki bin yirmi altı.'],
    ['Bilet 2.50 TL.', 'Bilet iki lira elli kuruş.'],
    ['Ağırlık 1.25-1.50 kg arası.', 'Ağırlık bir nokta yirmi beş-bir nokta elli kg arası.'],
  ]);
});

test('sayısız metin değişmez', () => {
  const m = 'Tamam, takvimine hemen bakıyorum. Ahmet’in sunumu yarın.';
  assert.equal(sayilariOku(m), m);
});

// G2 düzeltme turu 1: "payın %40’ı" — ek sayının okunuşuna göre (yüzde kırk-ı, elli-si, altı-sı, yüz-ü); eskiden hep "’i".
test('iyelik eki sayının okunuşuna göre (payın %N’i)', () => {
  const beklenen: [number, string][] = [
    [0, 'ı'], [1, 'i'], [2, 'si'], [3, 'ü'], [4, 'ü'], [5, 'i'], [6, 'sı'], [7, 'si'], [8, 'i'], [9, 'u'], [10, 'u'], [12, 'si'],
    [20, 'si'], [30, 'u'], [40, 'ı'], [50, 'si'], [60, 'ı'], [70, 'i'], [80, 'i'], [90, 'ı'], [100, 'ü'], [125, 'i'], [200, 'ü'],
    [1000, 'i'], [1_000_000, 'u'],
  ];
  for (const [n, e] of beklenen) assert.equal(iyelikEki(n), e, `%${n}’${e}`);
});
