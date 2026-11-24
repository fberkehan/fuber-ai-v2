// Galerinin fikstürleri (0.11 G3): her bileşen normal ve ZORLAYICI veriyle çizilir (spec §4: çok uzun şehir adı, 200 karakterlik haber
// başlığı, 60+ karakterlik tek sözcük, boş, hata, yükleniyor, 0 ve 7 haneli sayılar). Bütün içerik uydurmadır (gerçek kişi, kurum ya da
// yayın yok). Saf veri: tests/ui-kutuphanesi.test.ts sözleşmeyi (uzunluklar) denetler; scripts/dev/ui-onizle.mjs taşmayı ölçer.
import type { KartVerisi } from '../../shared/kart';

export const ZORLAYICI = {
  /** Tam 200 karakter. */
  haberBasligi:
    'Merkez Bankası Para Politikası Kurulu, yılın son toplantısında politika faizini beklentilerin aksine 250 baz puan indirdi; kararın ardından borsa günü rekorla kapattı, dolar ve euro ise yatay seyretti',
  /** 70 karakterlik tek sözcük (boşluksuz). */
  tekSozcuk: 'Muvaffakiyetsizleştiricileştiriveremeyebileceklerimizdenmişsinizcesine',
  /** Boşluksuz uzun dosya adı (64 karakter). */
  dosyaAdi: 'Yatırımcı_sunumu_2026_son_hali_GERÇEKTEN_SON_v14_düzeltildi.pptx',
  sehir: 'Kahramanmaraş Türkoğlu Şekeroba Organize Sanayi Bölgesi Mahallesi',
  gorev: 'Perşembe sabahı yatırımcılarla yapılacak görüşmeden önce sunum dosyasını, bütçe tablosunu ve ürün yol haritasını son kez gözden geçir',
  hatirlatici: 'Ece ve Mert ile ana sayfa revizyonu, fiyat sayfası ve kayıt akışı üzerine haftalık tasarım değerlendirme toplantısı',
  yer: 'Levent Plaza B Blok 14. kat büyük toplantı salonu (kartla giriş, misafirler resepsiyona kimlik bırakır)',
  yediHane: 1234567,
  yediHaneOndalik: 1234567.8,
  sifir: 0,
} as const;

export interface HavaOrnegi {
  sehir: string; derece: number; durum: string; yuksek: number; dusuk: number;
  saatler: readonly { saat: string; derece: number }[]; kaynak: string;
}
export const HAVA: { normal: HavaOrnegi; zorlayici: HavaOrnegi } = {
  normal: {
    sehir: 'İstanbul', derece: 18, durum: 'Parçalı bulutlu', yuksek: 21, dusuk: 12, kaynak: 'Örnek veri · 10 dk önce',
    saatler: [{ saat: '14:00', derece: 19 }, { saat: '15:00', derece: 19 }, { saat: '16:00', derece: 18 }, { saat: '17:00', derece: 16 }, { saat: '18:00', derece: 15 }],
  },
  zorlayici: {
    sehir: ZORLAYICI.sehir, derece: -12, durum: 'Kuvvetli sağanak ve yer yer dolu; öğleden sonra fırtınaya dönüşebilir, dışarı çıkmadan önce uyarıları izle',
    yuksek: -4, dusuk: -21, kaynak: 'Örnek veri · Gizli modda güncellenmiyor · 3 saat önce',
    saatler: [{ saat: '14:00', derece: -10 }, { saat: '15:00', derece: -11 }, { saat: '16:00', derece: -12 }, { saat: '17:00', derece: -15 }, { saat: '18:00', derece: -18 }],
  },
};

export interface HaberOrnegi { baslik: string; kaynak: string; saat: string }
export const HABERLER: readonly HaberOrnegi[] = [
  { baslik: ZORLAYICI.haberBasligi, kaynak: 'Ekonomi Masası', saat: '09:41' },
  { baslik: 'Kuzey Rüzgârı santrali için çevre raporu yayımlandı', kaynak: 'Günün Haberleri', saat: '08:15' },
  { baslik: ZORLAYICI.tekSozcuk, kaynak: 'Dil ve Edebiyat Ekinde Haftanın En Uzun Sözcüğü Köşesi', saat: 'Dün' },
  { baslik: 'Kış lastiği uygulaması 1 Aralık’ta başlıyor', kaynak: 'Yol Durumu', saat: 'Dün' },
  { baslik: 'Antik kentte yeni mozaikler bulundu', kaynak: 'Kültür', saat: '2 gün önce' },
];

export interface HatirlaticiOrnegi { saat: string; baslik: string; alt?: string; onem?: 'uyari' | 'hata' }
export const HATIRLATICILAR: readonly HatirlaticiOrnegi[] = [
  { saat: '09:00', baslik: 'Ece ile tasarım görüşmesi', alt: 'Ana sayfa revizyonu' },
  { saat: '13:20', baslik: ZORLAYICI.hatirlatici, alt: ZORLAYICI.yer, onem: 'uyari' },
  { saat: 'Yarın', baslik: 'Faturayı öde' },
  { saat: '23:59', baslik: ZORLAYICI.dosyaAdi, alt: 'Dosyayı Ece’ye gönder', onem: 'hata' },
  { saat: 'Cuma', baslik: 'Annemi ara' },
  { saat: '1 Ara', baslik: 'Kış lastiklerini tak' },
];

export interface YapilacakOrnegi { metin: string; alt?: string; isaretli: boolean }
export const YAPILACAKLAR: readonly YapilacakOrnegi[] = [
  { metin: 'Sunum taslağını bitir', alt: 'Bugün 17:00’ye kadar', isaretli: false },
  { metin: ZORLAYICI.gorev, alt: 'Mavi Kuş · Öncelik 4/5', isaretli: true },
  { metin: ZORLAYICI.tekSozcuk, isaretli: false },
  { metin: 'Süt al', isaretli: true },
];

export interface PiyasaOrnegi { ad: string; alt: string; deger: number; ondalik: number; birim?: string; degisim: number }
export const PIYASA: readonly PiyasaOrnegi[] = [
  { ad: 'Dolar', alt: 'USD/TRY', deger: 41.2345, ondalik: 4, degisim: 0.12 },
  { ad: 'Euro', alt: 'EUR/TRY', deger: 47.8, ondalik: 4, degisim: -0.3 },
  { ad: 'Gram altın (Kapalıçarşı serbest piyasa ortalama satış fiyatı)', alt: 'XAU/TRY · 15 dk gecikmeli', deger: ZORLAYICI.yediHaneOndalik, ondalik: 1, birim: 'TL', degisim: 0 },
];

/** Sayı bölümü: [değer, birim, ondalık, açıklama]. */
export const SAYILAR: readonly [number, string | undefined, number, string][] = [
  [0, undefined, 0, 'Sıfır'],
  [ZORLAYICI.yediHane, undefined, 0, '7 hane'],
  [ZORLAYICI.yediHaneOndalik, 'TL', 1, '7 hane, ondalıklı, birimli'],
  [42, '%', 0, 'Yüzde (önde)'],
  [-0.3, '%', 2, 'Eksi yüzde'],
  [-12.5, '°', 1, 'Eksi derece'],
  [3.4, 'km/sa', 1, 'Ayrı birim'],
];

// ── Sohbet kartları (0.11 G6): yapay zekânın `kart_goster` kartları ve araç adımları ────────────────────────────────────────────────────
// Her fikstür shared/kart.ts kartDogrula'dan geçer (tests/kart.test.ts); zorlayıcı olanlar sınırlara dayanır (200 karakterlik metin, 80 karakterlik
// başlık, 60+ karakterlik tek sözcük, 6 sütun × çok satır, 3 seçenek, uzun adres).
const uzunBaslik = 'Kuzey Rüzgârı projesinin yatırımcı sunumu için haftalık ilerleme özeti ve açık işler'.slice(0, 80).trim();
export const KART_ORNEKLERI: readonly { ad: string; kart: KartVerisi }[] = [
  { ad: 'ozet', kart: { tur: 'ozet', baslik: 'Bu haftanın özeti', maddeler: ['Sunum cuma teslim; grafikler sadeleşecek', 'Pazarlama bütçesi %15 aştı', 'Emlakçı salı 14:00’te arayacak'] } },
  { ad: 'liste', kart: { tur: 'liste', baslik: 'Yarınki toplantılar', ogeler: [{ baslik: 'Yatırımcı görüşmesi', alt: 'Zoom', sag: '09:30' }, { baslik: 'Ürün gözden geçirme', alt: 'Toplantı odası 2', sag: '14:00' }, { baslik: 'Ece ile tasarım', sag: '16:30' }] } },
  { ad: 'tablo', kart: { tur: 'tablo', baslik: 'Planlar', sutunlar: ['Plan', 'Aylık', 'Kullanıcı'], satirlar: [['Başlangıç', '9 $', '1'], ['Pro', '29 $', '5'], ['Takım', '79 $', '20']] } },
  { ad: 'adimlar', kart: { tur: 'adimlar', baslik: 'Yedek al', adimlar: ['Ayarlar → Veri’yi aç', 'Yedeği seç', 'Klasörü belirle'] } },
  { ad: 'karsilastirma', kart: { tur: 'karsilastirma', baslik: 'Hangi plan?', secenekler: ['Başlangıç', 'Pro', 'Takım'], ozellikler: [{ ad: 'Fiyat', degerler: ['9 $', '29 $', '79 $'] }, { ad: 'Kullanıcı', degerler: ['1', '5', '20'] }, { ad: 'Destek', degerler: ['E-posta', 'E-posta', 'Öncelikli'] }] } },
  { ad: 'baglantilar', kart: { tur: 'baglantilar', baslik: 'Kaynaklar', baglantilar: [{ baslik: 'Node.js', adres: 'https://nodejs.org' }, { baslik: 'Electron', adres: 'https://www.electronjs.org/docs' }] } },
];
export const KART_ZORLAYICI: readonly { ad: string; kart: KartVerisi }[] = [
  { ad: 'ozet-zorlayici', kart: { tur: 'ozet', baslik: uzunBaslik, maddeler: [ZORLAYICI.haberBasligi, ZORLAYICI.tekSozcuk, 'Kısa madde', ZORLAYICI.gorev, '5 < 7 ve 9 > 3 <b>düz metin</b> kalır', 'Altıncı', 'Yedinci', 'Sekizinci'] } },
  { ad: 'liste-zorlayici', kart: { tur: 'liste', baslik: ZORLAYICI.hatirlatici.slice(0, 80).trim(), ogeler: [{ baslik: ZORLAYICI.hatirlatici.slice(0, 80).trim(), alt: ZORLAYICI.yer, sag: ZORLAYICI.haberBasligi }, { baslik: ZORLAYICI.tekSozcuk, alt: ZORLAYICI.dosyaAdi, sag: ZORLAYICI.tekSozcuk }, ...Array.from({ length: 10 }, (_, i) => ({ baslik: `Öğe ${i + 3}`, sag: `${(i + 3) * 1111111}` }))] } },
  { ad: 'tablo-zorlayici', kart: { tur: 'tablo', baslik: uzunBaslik, sutunlar: ['Plan', ZORLAYICI.tekSozcuk, 'Aylık ücret', 'Kullanıcı', 'Destek', ZORLAYICI.hatirlatici], satirlar: [['Başlangıç', ZORLAYICI.haberBasligi, '1.234.567 TL', '1', '', ZORLAYICI.dosyaAdi], ['Pro', '29 $', '−12,5%', '5', 'E-posta', 'Evet'], ...Array.from({ length: 18 }, (_, i) => [`Satır ${i + 3}`, 'a', 'b', 'c', 'd', 'e'])] } },
  { ad: 'adimlar-zorlayici', kart: { tur: 'adimlar', baslik: uzunBaslik, adimlar: [ZORLAYICI.gorev, ZORLAYICI.tekSozcuk, ZORLAYICI.dosyaAdi, ...Array.from({ length: 7 }, (_, i) => `Adım ${i + 4}: kısa bir iş`)] } },
  { ad: 'karsilastirma-zorlayici', kart: { tur: 'karsilastirma', baslik: uzunBaslik, secenekler: [ZORLAYICI.tekSozcuk, 'Pro', ZORLAYICI.hatirlatici], ozellikler: [{ ad: ZORLAYICI.haberBasligi, degerler: [ZORLAYICI.gorev, '29 $', ''] }, { ad: ZORLAYICI.tekSozcuk, degerler: ['1', ZORLAYICI.tekSozcuk, '1234567'] }, ...Array.from({ length: 6 }, (_, i) => ({ ad: `Özellik ${i + 3}`, degerler: ['Evet', 'Hayır', 'Sınırlı'] }))] } },
  { ad: 'baglantilar-zorlayici', kart: { tur: 'baglantilar', baslik: uzunBaslik, baglantilar: [{ baslik: ZORLAYICI.haberBasligi.slice(0, 80).trim(), adres: 'https://ornek-cok-uzun-bir-alan-adi-kuzey-ruzgari-santrali-cevre-raporu.example.com/yol' }, { baslik: ZORLAYICI.tekSozcuk, adres: 'http://localhost:8080/' }, ...Array.from({ length: 6 }, (_, i) => ({ baslik: `Bağlantı ${i + 3}`, adres: `https://ornek.example/${i}` }))] } },
];

/** Araç adımı fikstürü (GorunenBlok 'arac' biçimi). Zaman göreli ("Yarın 09:00") kurulur: günün saatinden bağımsız. */
export interface AracAdimOrnegi { id: string; ad: string; etiket: string; girdi: Record<string, unknown>; durum: 'calisiyor' | 'tamam' | 'hata' | 'reddedildi'; ozet?: string }
const yarin = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); })();
const adim = (id: string, ad: string, girdi: Record<string, unknown>, durum: AracAdimOrnegi['durum'], ozet?: string): AracAdimOrnegi => ({ id, ad, etiket: ad, girdi, durum, ...(ozet ? { ozet } : {}) });
export const ARAC_ORNEKLERI: readonly { ad: string; adimlar: readonly AracAdimOrnegi[] }[] = [
  { ad: 'tek-tamam', adimlar: [adim('g1', 'hatirlatici_kur', { baslik: 'Yatırımcı görüşmesi', zaman: yarin }, 'tamam', 'Yarın 09:00')] },
  { ad: 'tek-suruyor', adimlar: [adim('g2', 'whatsapp_gonder', { kime: 'Ece Aydın', metin: 'Yarın 10:00 olur mu?' }, 'calisiyor')] },
  { ad: 'tek-hata', adimlar: [adim('g3', 'tarayici_ac', { adres: 'https://ornek.example/fiyat' }, 'hata', 'page.goto: net::ERR_NAME_NOT_RESOLVED')] },
  { ad: 'tek-reddedildi', adimlar: [adim('g4', 'dosya_oku', { yol: 'C:\\Belgeler\\Gizli\\bütçe.xlsx' }, 'reddedildi', 'Kullanıcı onay vermedi (reddedildi)')] },
  { ad: 'grup', adimlar: [adim('g5', 'hafiza_ara', { sorgu: 'ACME fiyat kararı' }, 'tamam', '3 kayıt'), adim('g6', 'hatirlatici_listele', {}, 'tamam', '2 hatırlatıcı'), adim('g7', 'bilgisayar_yaz', { metin: 'Merhaba Ece' }, 'calisiyor')] },
  { ad: 'zorlayici', adimlar: [adim('g8', 'hatirlatici_kur', { baslik: ZORLAYICI.hatirlatici, zaman: yarin }, 'tamam'), adim('g9', 'dosya_oku', { yol: `C:\\Kullanicilar\\Deniz\\Belgeler\\${ZORLAYICI.dosyaAdi}` }, 'tamam'), adim('g10', 'tarayici_ac', { adres: `https://${ZORLAYICI.tekSozcuk}.example.com/yol` }, 'tamam'), adim('g11', 'takvim_oku', {}, 'tamam')] },
];
