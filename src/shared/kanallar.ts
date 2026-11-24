// Arayüzün çağırabildiği (invoke) ve dinleyebildiği (on) kanallar — preload bu beyaz listeyi uygular.
export const CAGRI_KANALLARI = [
  'ayarlar:al', 'ayarlar:kaydet', 'tema:etkin', 'tema:sahne', 'sir:yaz', 'durum:al', 'motor:sina', 'motor:modeller', 'kullanim:ozet',
  'kurulum:tamamla', 'kurulum:yukseltme-bitti', 'kurulum:claude-hafiza-sayisi',
  // 0.11 G12b (0.13: "0.13’te yeni"): kokpitteki sürüm yenilik kartının "Tamam"ı (işareti yalnız ana süreç yazar; telefondan kapalı).
  'yenilik:kapat',
  // Kurulumun sistem kontrolü (işletim sistemi, bellek, disk, ekran kartı). kurulum:test-motor: yalnız FUBER_DEMO'da işleyicisi
  // olan önizleme kancası (anahtarsız demoda motor adımını geçmek için; ana süreçte motor bağlanmaz, ağ isteği olmaz).
  'sistem:kontrol', 'kurulum:test-motor',
  'sohbet:ana', 'sohbet:liste', 'sohbet:mesajlar', 'sohbet:yeni', 'sohbet:arsivle', 'sohbet:baslik', 'sohbet:okundu', 'sohbet:mesgul', 'sohbet:gonder', 'sohbet:durdur', 'onay:yanitla',
  'kokpit:al', 'kokpit:yenile', 'plan:hatirlatici', 'plan:gorev', 'plan:oneri-kapat',
  'hafiza:liste', 'hafiza:ara', 'hafiza:kaydet', 'hafiza:guncelle', 'hafiza:sil', 'hafiza:sayisi',
  // Hafıza → Belgeler (Görev 20b, K3): içe aktarılmış belgeler (arama: ad, içerik, D-kimliği) ve silme (bu belgeden öğrenilenler de).
  'belge:liste', 'belge:sil',
  // Geri alınabilir silme kuyruğu (Görev 20b; ana süreçte, çıkışta uygulanır): ertele, geri al, süreyi durdur/sürdür, durum.
  'silme:ertele', 'silme:geri-al', 'silme:duraklat', 'silme:durum',
  // Genel kısayollar gerçekten alındı mı (acil durdurma ve asistan; Görev 20b düzeltme turu 2): alınamayan tuş söz verilmez.
  'kisayol:durum',
  'eposta:hazir', 'eposta:kaydet', 'eposta:sil', 'eposta:sina', 'eposta:esitle',
  'whatsapp:baslat', 'whatsapp:cikis', 'whatsapp:durum',
  'mcp:kaydet', 'mcp:sil', 'mcp:sina', 'mcp:claude-code',
  // 0.14 T16 (main/entegrasyon/mcp-katalog.ts): Bağlantılar'ın katalog kartları (McpKatalogGorunumu; adres ve belirteç yok), "Bağla" (http: tarayıcıda izin;
  // stdio: önce komutun onay kartı) ve "Bağlantıyı kes". Hepsi telefondan KAPALI (kopru-protokol.ts UZAKTAN_KAPALI).
  'mcp:katalog', 'mcp:bagla', 'mcp:kes',
  'iceaktar:durum', 'iceaktar:klasor-ac', 'iceaktar:dosya-sec',
  // Fuber'in tek sesi (Görev 21, K9; main/ses.ts): ses bilgisi, seçilebilir sesler, telefon önizlemesi (tam WAV), yedek sesi indir;
  // akışlı konuşma (başlat/ekle/bitir/sustur; olaylar çağıran pencereye 'ses:akis') ve ilk çalma ölçümü; konuşmadan yazıya (Scribe /
  // Whisper; ara metin 'ses:dinleme'). Konuşma ve dinleme kanalları pencereye bağlı: telefondan kapalı (kopru-protokol.ts).
  'ses:bilgi', 'ses:sesler', 'ses:dene', 'ses:yedek-kur',
  'ses:konus-baslat', 'ses:konus-ekle', 'ses:konus-bitir', 'ses:sustur', 'ses:olcum',
  'ses:dinleme-baslat', 'ses:dinleme-parca', 'ses:dinleme-bitir', 'ses:dinleme-iptal', 'ses:dikte-yok', 'ses:dikte-yeniden',
  'ses:vosk-adresi', 'asistan:goster', 'asistan:gizle', 'ana:goster',
  // 12 Kas Toplantı modu (main/toplanti.ts): hazırlık, başlat, VAD olayları + 16 kHz parçalar, hedef dil / Robot, durdur, durum, geçmiş, tek kayıt. Telefondan KAPALI.
  'toplanti:hazirlik', 'toplanti:baslat', 'toplanti:basladi', 'toplanti:vazgecildi', 'toplanti:parca', 'toplanti:olay', 'toplanti:ayar', 'toplanti:durdur', 'toplanti:durum', 'toplanti:gecmis', 'toplanti:al', 'toplanti:baglam', 'toplanti:whisper-indir', 'toplanti:ses-yeniden', 'toplanti:kaynak-hatasi', 'toplanti:windows-ayari', 'toplanti:tercih-yaz', 'toplanti:gemini',
  // 0.11 G11 (spec §9; main/acilis.ts): açılış örtüsü — süreçteki ilk gösterim bayrağı (süreç başına BİR kez true) ve FUBER_DEMO açılış
  // günlüğü (uygulama:acilis-olayi yazar, uygulama:test-acilis-olaylari okur; ikisinin işleyicisi yalnız demoda var). Telefondan KAPALI.
  'uygulama:ilk-gosterim', 'uygulama:acilis-olayi', 'uygulama:test-acilis-olaylari',
  // Ada: imleç adanın şeklinin üstünde mi (tıklama yakalansın / alta geçsin); sırada bildirim kaldı, ada yeniden insin (tam
  // ekran kapısından); pencere şu an görünür mü; gösterecek bir şey kalmadı (ana süreç adayı boşta sayar); pencere klavye odağında mı.
  // ada:test-* yalnız FUBER_DEMO'da işleyicisi olan test kancaları.
  // 0.14 T19: ada:olcek-al — açılışta çentik ölçeği (R15).
  'ada:fare', 'ada:goster', 'ada:gorunur-mu', 'ada:bos', 'ada:odakta-mi', 'ada:olcek-al',
  // Görev 28 düzeltme 3 (F2): adada hatırlatıcı var mı (kısayol kararı; hatırlatıcı kalkınca false).
  'ada:hatirlatma',
  'ada:test-tam-ekran', 'raf:test', 'ada:test-gonder', 'ada:test-kontrol', 'ada:test-gorev', 'ada:test-onay', 'ada:test-kisayol', 'ada:test-durum',
  // 0.14 T22 (yalnız FUBER_DEMO + FUBER_OLAY_KOMUT): sahte olay yardımcısına olay yazdırır ya da onu çökertir (scripts/dev/sahte-olay.mjs).
  'ada:test-olay',
  // Ada görünürlüğü test kancaları (yalnız FUBER_DEMO): uygulama önde, süreli durum saati, Windows bildirimi kaydı, gerçek
  // hatırlatıcı yolu, proaktif duyuru yolu.
  'ada:test-ana-onde', 'ada:test-saat', 'ada:test-bildirimler', 'ada:test-hatirlat', 'ada:test-proaktif',
  'kulak:olay', 'kulak:dinle', 'kulak:bekle', 'kulak:devam', 'kulak:uyandirma-durum',
  'tarayici:goster', 'bilgisayar:dene', 'sistem:ac', 'sistem:veri-klasoru', 'chrome:durum', 'ozet:metin',
  'gunkaydi:durum', 'gunkaydi:dokum', 'gunkaydi:maddeler', 'gunkaydi:raporlar', 'gunkaydi:rapor-hazirla', 'gunkaydi:meseleler',
  'gunkaydi:mesele-guncelle', 'gunkaydi:sil', 'gunkaydi:duraklat', 'gunkaydi:not-tut', 'gunkaydi:whisper-indir', 'gunkaydi:whisper-kaldir',
  'gunkaydi:satir', 'gunkaydi:ses', 'gunkaydi:kulak-ayar',
  'beyin:durum',
  'yerel:durum', 'yerel:kur', 'yerel:kaldir', 'yerel:dene', 'yerel:yeniden-baslat',
  'claudecode:liste', 'claudecode:ac', 'claudecode:durum',
  // Claude Code yöneticisi (Görev 27, K17; main/claudecode/oturum-yoneticisi.ts): uygulama içi oturumlar (Agent SDK). Salt okur özet
  // listesi (claudecode:oturumlar) telefondan da okunur; gerisi yalnız bilgisayarın başında (kopru-protokol.ts UZAKTAN_KAPALI).
  'claudecode:oturumlar', 'claudecode:baslat', 'claudecode:gonder', 'claudecode:izin-yanitla', 'claudecode:kes', 'claudecode:mod',
  'claudecode:model', 'claudecode:kapat', 'claudecode:oturum-al', 'claudecode:dokum', 'claudecode:komutlar', 'claudecode:projeler',
  'claudecode:modeller', 'claudecode:hesap',
  // Analiz 11 Kas (bulgu 1, 5): canlı düşünme gücü; işler — Durdur, Arka plana al, çıktı kuyruğu (yalnız bilgisayarın başında).
  'claudecode:efor', 'claudecode:is-durdur', 'claudecode:is-arka-plan', 'claudecode:is-cikti',
  // Analiz 11 Kas (bulgu 4): sohbetin arka plan süreçleri (komut_calistir arka_plan) — liste, çıktı, Durdur (yalnız bilgisayarın başında).
  'surec:liste', 'surec:cikti', 'surec:durdur',
  // İş izi (11 Kas; main/is-izi.ts): bütün işlerin tek listesi (IsKaydi[]). Telefondan kapalı (telefon olayın durum özetini alır).
  'is-izi:liste',
  'claudecode:claude-md-oku', 'claudecode:claude-md-yaz', 'claudecode:auth-durum', 'claudecode:giris', 'claudecode:degisiklikler',
  'claudecode:fark', 'claudecode:baska-yerde', 'claudecode:klasor-sec', 'claudecode:klasor-ac',
  // Düzeltme 1: "Oturumu unut" (kayıt silinir) ve "@" dosya önerisi (.gitignore'a uyar; en çok 50).
  'claudecode:unut', 'claudecode:dosya-oner',
  // Son dalga B (I1): klasör güveni — klasörün kendi Claude Code ayarları ve kullanıcının kararı (yalnız masada; telefondan KAPALI).
  'claudecode:klasor-guveni',
  // Fuber Geliştirici Paketi ve Eklentiler sekmesi (Görev 29, K18; main/claudecode/eklenti-kurucu.ts): durum, listeler (eklenti, beceri, MCP,
  // katalog), paketi arka planda kur, tek eklenti kur, kurulum komutu onayı, aç/kapat/kaldır/güncelle, Claude Code'u kur (resmi yükleyici,
  // görünür pencere), kurulum günlüğü. Hepsi telefondan KAPALI (kopru-protokol.ts UZAKTAN_KAPALI).
  'claudecode:eklenti-durum', 'claudecode:eklenti-liste', 'claudecode:paket-baslat', 'claudecode:eklenti-kur', 'claudecode:eklenti-onay',
  'claudecode:eklenti-islem', 'claudecode:cc-kur', 'claudecode:eklenti-gunluk',
  // Görev 28 düzeltme 1: izin kartının Türkçe cümlesi için "Write bu dosyayı yeni mi oluşturuyor, üzerine mi yazıyor" (yalnız var/yok).
  'claudecode:dosya-var',
  // Model seçici (Görev 13): sağlayıcının ayrıntılı listesi (bağlam, fiyat, yetenek; 'yerel': disk/bellek/ekran kartı gereksinimi).
  // motor:test-model-kaynagi: yalnız FUBER_DEMO'da işleyicisi olan önizleme kancası (kayıtlı örnek yanıt; ağ yok).
  'motor:model-bilgileri', 'motor:test-model-kaynagi',
  // Yerel beyin indirmesini durdur (yarım dosya silinir; Görev 13). yerel:bekleyen-vazgec: yarıda kalan/hatalı istenmiş kurulumun
  // bildiriminde "Vazgeç" (kayıt silinir, hiçbir şey indirilmez; Görev 15). Telefondan kapalı (kopru-protokol.ts).
  'yerel:durdur', 'yerel:bekleyen-vazgec', 'yerel:bekleyen-gizli',
  // F1 (son inceleme Ö1): kokpitteki "Gizli modu kapattım" notunun "Tamam"ı (yerel.gizliGeriAlindi silinir). Telefondan kapalı.
  'yerel:gizli-notu-kapat',
  // Motor sinyali (Ruling K): { bulut, yerel, saatKaymasi } — "motor durdu" = bulut motoru yok VE hazır yerel beyin yok.
  'motor:durum',
  // Fuber Tarayıcı penceresi (src/main/tarayici.ts): durum, adres çubuğu, geri/ileri/yenile/başlangıç, sayfa alanının yeri,
  // "Giriş yaptığım siteler" ve oturum kapatma, "Fuber'e sor" (ana sohbete), ajanı durdurma. tarayici:test-* yalnız FUBER_DEMO'da
  // işleyicisi olan önizleme kancaları. Hepsi telefondan kapalı (kopru-protokol.ts UZAKTAN_KAPALI).
  'tarayici:durum', 'tarayici:git', 'tarayici:gezin', 'tarayici:alan', 'tarayici:sekme', 'tarayici:oturumlar', 'tarayici:oturum-kapat', 'tarayici:sor', 'tarayici:durdur',
  'tarayici:test-calisiyor', 'tarayici:test-arac', 'tarayici:test-notlar', 'tarayici:test-ayril',
  // Kendi pencere düğmeleri (Görev 22, K12; src/main/pencere-kabugu.ts): çağıran pencereyi küçült/büyüt-geri al/kapat ve durumu
  // (büyütülmüş mü, tam ekran mı). Yalnız kabuğu kurulmuş pencerelerde (ana, Fuber Tarayıcı); telefondan kapalı.
  'pencere:eylem', 'pencere:durum',
  // Pano (Görev 24, K14): kokpit doldurucularının verisi (hava, haberler, gündemdeki konular, döviz; önbellekten, ağ arka planda) ve
  // "Şimdi yenile". Salt okur; telefondan da çağrılabilir (kopru-protokol.ts TELEFONA_IZINLI).
  'pano:al', 'pano:yenile',
  // 0.11 G2 (spec §2; main/veri/temizlik.ts): "Tekrar hoş geldin" özeti ve Ayarlar → Veri (yeniden kurulum işareti, hafıza/sohbet sayısı,
  // son kullanım, yedekler, indirilen yapay zekânın boyutu), "Kaldığın yerden devam et", "Yeni başla", "Verilerimi sil ve çıkış yap"
  // ({ yerelDahil }), "Fuber'i bu bilgisayardan kaldır", "Eski yedekleri sil". Hepsi telefondan KAPALI.
  'veri:ozet', 'veri:devam', 'veri:yeni-basla', 'veri:sil', 'veri:kaldir', 'veri:yedekleri-sil',
  // 0.11 G9 (spec §8; main/isler/zamanlayici.ts): Görevler — liste (IsOzet[]), durdur (id), sürdür (id). Telefondan KAPALI.
  'isler:liste', 'isler:durdur', 'isler:surdur',
  // 0.14 T24 (main/centik-veri.ts): çentik panelinin Gündem, Görevler ve Gelenler verisi — sayfa görünür olunca (yoklama yok). Takvim en çok 15 dk'da bir
  // bağlı servisten (Gizli'de bu bilgisayardaki son kopyadan). Telefondan KAPALI (çentiğe ait; bu bilgisayarın servis bağlantısını kullanır).
  'centik:veri',
  // 0.14 T25 (main/olay-yardimcisi.ts, main/soz.ts): Müzik ve Şarkı sözü sayfaları — medya hâli (açılışta; sonrası 'ada:medya' olayı), medya komutu (oynat,
  // duraklat, ileri, geri, konum, ses düzeyi; yalnız olay yardımcısından, medya tuşu yok) ve çalan parçanın sözü (LRCLIB; Gizli ve "Yalnız bu bilgisayar"da
  // istek yok). Telefondan KAPALI (bu bilgisayarın medya oturumu).
  'medya:al', 'medya:komut', 'soz:getir',
  // 0.14 T26 (main/odak.ts, main/planlama.ts): Odak — sayım durumu, adım (başlat, duraklat, sürdür, sıfırla; "bitti" yalnız ana süreçten);
  // Yapılacaklar — kokpitin listesi ve yeni madde (isteğe bağlı saatle hatırlatıcı). Yerel; telefondan KAPALI (çentiğe ait).
  'odak:al', 'odak:adim', 'yapilacak:liste', 'yapilacak:ekle',
  // 0.14 T27 (main/raf.ts): Raf — liste, açma, silme, dışarı sürükleme (hepsi yalnız öğe kimliğiyle ve yalnız çentik penceresinden). Yeni öğe EKLEME bu listede YOK:
  // 'raf:birak' preload'a özeldir (köprüdeki `rafBirak`; yolu preload webUtils ile çözer, arayüz yol dizisi gönderemez). Yerel; telefondan KAPALI.
  'raf:liste', 'raf:ac', 'raf:sil', 'raf:surukle',
] as const;

export const OLAY_KANALLARI = [
  'sohbet:olay', 'kokpit:durum', 'kokpit:veri-degisti', 'zihin:durum', 'hafiza:degisti',
  'whatsapp:durum', 'whatsapp:hata', 'eposta:hata', 'iceaktar:islendi', 'iceaktar:hata',
  // Açıkça öğretilen dosya zaten öğrenilmiş ({ dosya }; A4).
  'iceaktar:zaten',
  // 0.12 cila düzeltme turu 3: belge özeti şimdilik çıkarılamadı ({ id, ad }; Bağlantılar sayacı yenilenir) ve "Dosya öğret" yeniden seçtiği
  // belgenin özeti şimdi çıkarılamadı ({ dosya }; sessiz kalınmaz — N-11).
  'iceaktar:ozetsiz', 'iceaktar:ozet-sonra',
  'asistan:onay', 'asistan:bildir', 'asistan:dinle', 'asistan:ses', 'ana:git', 'bildirim', 'kulak:durum', 'kulak:komut', 'imlec:komut', 'gunkaydi:durum', 'gunkaydi:kulak', 'asistan:soyle', 'beyin:olay', 'yerel:durum',
  // Ada: Fuber ekranı kullanıyor ({ acik }); çentikli Mac ekranı ({ var }); pencere gösterildi/gizlendi ({ acik }); iş bitti ama
  // pencere kalıyor ("sessizken görünsün"): arayüz yarım işi temizleyip sessiz hale döner; kısayolla kapatılan odaklı ada odağı
  // bırakmadan önce şekli toplar (ada:cekil); 0.11 G10 ada:gorev: bir görev adımı çalışıyor ({ id, baslik, ekran, sayi }) ya da bitti (null) — "Görev: …" hapı;
  // 0.13 ada:tam-ekran: tam ekran başladı/bitti ({ acik }): hover tam ekranda açılmaz.
  // 0.14 T13 ada:calisiyor: eşiği aşan sohbet turu ({ sohbetId, adim, etiket }) ya da bitti (null) — "Çalışıyor" hapı (Durdur: sohbet:durdur).
  // 0.14 T19 ada:olcek: çentik ölçeği ({ olcek }; R15) değişti; ada:ekran: ekran eklendi/söküldü/ölçeği değişti, imleç bayrakları düşer (Review Focus 1).
  // 0.14 T22 ada:uyari: sistem uyarı hapı ({ tur, metin, duzey?, simge }; shared/sistem-uyarilari.ts) — kulaklık, şarj, ses/parlaklık bindirmesi, Caps Lock, dil, internet.
  // 0.14 T23 ada:sayfa: ana süreç paneli bir sayfayla açtırır ({ id }; T24–T27); ada:acil: Alt+Shift+Q — açık panel kapanır, Çalışıyor düşer.
  // 0.14 T25 ada:medya: medya oturumu ya da ses düzeyi değişti (CentikMedyasi; shared/sistem-olay.ts) — Kapalı hap, panelin medya çubukları, Müzik, Şarkı sözü.
  'ada:kontrol', 'ada:gorev', 'ada:centik', 'ada:gorunur', 'ada:sessiz', 'ada:cekil', 'ada:tam-ekran', 'ada:calisiyor', 'ada:olcek', 'ada:ekran', 'ada:uyari', 'ada:sayfa', 'ada:acil', 'ada:medya',
  // 0.14 T26 odak:durum: Odak sayımı değişti (OdakDurumu; yalnız çentiğin penceresine); ada:odak-zil: sayım bitti, çentiğin arayüzü zili çalar.
  'odak:durum', 'ada:odak-zil',
  // Uygulama öndeyken adaya gidecek hatırlatıcı/mesaj/onay ana pencerede tost olur ({ kanal, veri }; main.ts, K4).
  'ana:ada-tost',
  // Ayar değişti (tam Ayarlar nesnesi; sır yok): tema gibi pencereler arası canlı ayarlar.
  'ayarlar:degisti',
  // Etkin tema değişti ({ tema: 'koyu' | 'acik' | 'cam' }): "Otomatik" ve Şeffaf desteği ana süreçte çözülür.
  'tema:degisti',
  // Motor anahtarı yazıldı/silindi ({ saglayici }): model seçici o sağlayıcının önbellekteki listesini atar (Görev 13).
  'motor:anahtar-degisti',
  // Motor sinyali değişti (ayar, yerel beyin, demo saati): { bulut, yerel, saatKaymasi } (main/abonelik.ts motorDurumu).
  'motor:durum',
  // Fuber Tarayıcı: sayfa durumu (TarayiciDurumu) ve arayüze komut ({ tur: 'adres' } → adres çubuğuna odaklan). Yalnız tarayıcı
  // penceresine gönderilir; telefona gitmez.
  'tarayici:durum', 'tarayici:komut',
  // Silme kuyruğunun aynası ({ bekleyen, gizli, durakli, duraklatilan }) ve uygulanamayan silme ({ anahtar, etiket, mesaj }); yalnız
  // masaüstü.
  'silme:degisti', 'silme:hata',
  // 12 Kas: süren toplantının durumu (döküm, çeviri, öneriler; yalnız toplantıyı başlatan pencereye).
  'toplanti:degisti',
  // Genel kısayolların durumu değişti (KisayolDurumu; shared/genel-kisayol.ts); yalnız masaüstü.
  'kisayol:degisti',
  // Fuber'in sesi (Görev 21): konuşma akışı ({ id, tur: basladi|ses|bitti|hata }; yalnız çağıran pencereye), dinlemenin ara metni
  // ({ id, tur: 'kismi', metin }), acil durdurmada bütün çalarlar susar ('ses:kes'), ses bilgisi değişti (SesBilgisi: anahtar, yedek
  // sesin indirilmesi).
  'ses:akis', 'ses:dinleme', 'ses:kes', 'ses:durum',
  // Pencere büyütüldü / geri alındı / tam ekran (PencereDurumu; shared/pencere.ts): yalnız o pencereye; telefona gitmez.
  'pencere:durum',
  // Pano verisi tazelendi ya da pano ayarı değişti (PanoDurumu; shared/pano.ts).
  'pano:degisti',
  // Claude Code oturum akışı (CcOlayZarfi; shared/cc-olay.ts): metin parçaları, araç kartları, izin istekleri, sonuç, durum. Telefona gitmez.
  'claudecode:olay',
  // Geliştirici paketinin kurulum ilerlemesi (PaketDurumu; shared/cc-eklentiler.ts; Görev 29). Telefona gitmez.
  'claudecode:eklenti',
  // 0.11 G9: Görevler değişti (IsOzet[]; başladı, kontrol etti, adım, durdu, bitti). Telefona gitmez.
  'isler:durum',
  // Analiz 11 Kas (bulgu 4): arka plan süreçlerinin listesi değişti (SurecOzeti[]; başladı, çıktı, bitti). Telefona gitmez.
  'surec:degisti',
  // İş izi (11 Kas): işlerin tek listesi değişti (IsKaydi[]; çentik, sohbet, kokpit, ray). Telefona YALNIZ durum gider (kopru-protokol.ts telefonaGiden).
  'is-izi:degisti',
  // Analiz 11 Kas bulgu 9: video ekinin işlenme ilerlemesi ({ kimlik, adim, yuzde, metin }); yalnız çağıran pencereye. Telefona gitmez.
  'ek:ilerleme',
] as const;

export type CagriKanali = (typeof CAGRI_KANALLARI)[number];
export type OlayKanali = (typeof OLAY_KANALLARI)[number];
