// Kurulum önizlemesi — 0.12 H3a: YERİNİ scripts/dev/kurulum2-onizle.mjs ALDI (bu dosya yalnız yönlendirir; aynı bağımsız değişkenler).
// Kurulum sayfaları baştan hazırlandı. Yeni kurulum, Ayarlar → "Kurulumu yeniden aç", yalnız hesap ekranı ve Tekrar hoş
// geldin artık renderer/kurulum2/ ve sayfalar/TekrarHosGeldin.tsx (fintech dili); eski sihirbazın (sayfalar/Kurulum.tsx) yalnız oturum
// ortasındaki "Geliştirici araçları" teklifi kaldı (scripts/dev/eklentiler-onizle.mjs).
// Eski denetimlerin akıbeti (hiçbir hâlâ var olan davranışın denetimi düşmedi):
//   · TAŞINDI (kurulum2-onizle.mjs): hoş geldin, çift tıklama, hesap (boş gönderim, kayıt → sahte sunucu, şifre dosyada yok, ad
//     Tanışma'ya), onay bekleyen hesap (R10 satırı + turun "Bitir"i), hesap ucu 404 / kayıt 404 kaçış yolu, hesapsız İş → Gizli önerisi
//     + arka planda Gizli indirme + Hazırsın ve kokpit nötr satırı, bu bilgisayar yetmiyor (2b), yerel durum yanıtsız (2c), bilgisayar
//     okunamadı (2d), ses "Dinle" → hesabın sesi, izinler anında kaydedilir, "Fuber’i aç" → iş profili + tek hafıza kaydı, tanıtım turu
//     (4 durak, balon yerleşimi, ilk görev yazı alanına), yeniden açılan kurulum (Vazgeç geri alır, "Bitti" yalnız ayarlar, sessiz saat
//     kuralları I1 5b), Tekrar hoş geldin (sayılar, devam → yalnız hesap, sıfırdan başla → yedek), yarıda kalan indirme kartı (3b/3c),
//     her ekranın okunurluk / taşma / kaydırmasızlık ölçüsü (artık + boşluk kuralı).
//   · KALDI, çünkü davranış KALKTI: yükseltme özeti ("Fuber yenilendi", "Böyle devam et / Gözden geçir"; 0.12'de yükseltme sihirbaz
//     açmaz — kurulum2-onizle yükseltme yollarını ölçer), sol sayfa haritası ve özetleri, kurulumdaki Görünüm (tema kartları, buzlu cam),
//     "İşin"de "Geliştiriciyim" (Geliştirici modu kurulumda sorulmaz), kurulumdaki konuşma hızı, Tam yetki ve "Windows açılışında
//     başlat" satırları, Hazırsın'daki "Şimdi dene" ada canlandırması.
// Çalıştır: npm run build && node scripts/dev/kurulum-onizle.mjs [çıktı]   (= node scripts/dev/kurulum2-onizle.mjs [çıktı])
import './kurulum2-onizle.mjs';
