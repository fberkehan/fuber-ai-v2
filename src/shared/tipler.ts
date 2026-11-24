// ── Ana süreç ↔ arayüz ortak tipleri ────────────────────────────────────────────────────────────────────────
// Arayüz ana sürece yalnız `window.fuber` (preload) üzerinden ulaşır; sırlar (API anahtarları, parolalar) ARAYÜZE
// HİÇ DÖNMEZ — yalnız "kayıtlı mı" bilgisi döner.
import type { PanoAyari } from './pano.ts';
import type { CcAyari } from './cc-ayar.ts';
import type { HesapAyari } from './masaustu-hesap.ts';
import type { IsProfili } from './kurulum-adimlari.ts';
import type { KartVerisi } from './kart.ts';
import type { KipKimligi } from './karakterler.ts';
import type { UyariAnahtari } from './sistem-uyarilari.ts';
import type { SayfaKimligi } from './centik-sayfalar.ts';
import type { UcuncuTaraf } from './ucuncu-taraf.ts';

export type SaglayiciAdi = 'anthropic' | 'openai' | 'openrouter';
/** 0.14 T6b: karakterler görünsün mü ('goster', varsayılan) ya da Sade mod ('sade'; karakter yok). Ayarlar.gorunum.karakterler. */
export type KarakterGorunumu = 'goster' | 'sade';
/** Fuber'in TEK sesi (Görev 21, K9): ElevenLabs (anahtar varsa) ya da yedek ses (Piper dfki, bu bilgisayarda). Başka ses yok. */
export type SesMotoru = 'elevenlabs' | 'yerel';
export interface SesSecenegi { id: string; ad: string; aciklama?: string; /** 'hesap': ElevenLabs hesabındaki ses; yoksa Fuber'in seçtiği hazır ses. */ kaynak?: 'fuber' | 'hesap' }
/** Konuşmadan yazıya (soru, dikte; 0.13 C): bulutta Fuber hesabı (canlı Scribe, düşerse toplu), Gizli ve "Yalnız bu bilgisayar"da kurulu Whisper;
 *  yol yoksa 'yok' (tek satır söylenir; shared/dikte-yolu.ts). Cihazdaki Vosk dikte için kullanılmaz. */
export type YaziyaMotoru = 'hesap' | 'whisper' | 'yok';
/** `ses:bilgi` (Ayarlar → Ses, kurulum sihirbazının "Ses" adımı, telefon): şu an konuşacak ses ve yedek sesin durumu. Sır dönmez. */
export interface SesBilgisi {
  /** Şu an konuşacak ses; null = ses yok (yalnız yazı: hesabın sesi yok ve yedek ses kurulu değil). */
  motor: SesMotoru | null;
  /** Etkin ses (Fuber hesabının sesi ya da yedek ses). */
  ses: SesSecenegi | null;
  /** 0.10 E3 (K3): Fuber'in sesi Fuber hesabından geliyor (hesap aktif, Gizli mod kapalı). */
  hesapSesi?: boolean;
  yedek: { kurulu: boolean; boyut: number; indirme?: { yuzde: number; adim: string; hata?: string } };
  /** Gizli mod (bulutsuz): ses de bu bilgisayardan çıkmaz → yedek ses. */
  gizliMod: boolean;
  /** 0.12 H3c düzeltme turu 1 (Ö1): "Yalnız bu bilgisayar" (Gizli değil) — ses de bu bilgisayarda; yalnız true iken yazılır. */
  yalnizYerel?: boolean;
  hiz: number;
  yaziya: YaziyaMotoru;
  /** Son konuşmaların ilk ses gecikmesi (akış başlangıcından ilk sese, ms; en yeni başta). */
  sonGecikmeler: { ms: number; motor: SesMotoru; kaynak: string; zaman: string }[];
}
export type ModelRolu = 'ana' | 'yardimci';
export type Efor = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelSecimi { saglayici: SaglayiciAdi; model: string; efor?: Efor }

export interface Ayarlar {
  kurulumTamam: boolean;
  /** Profilin tamamladığı kurulumun sürümü (Görev 23, K11; shared/kurulum-adimlari.ts KURULUM_SURUMU). Bu alandan önce kurulumu bitmiş
   *  profil göçte 1 sayılır → sihirbaz bir kez "yükseltme" kipinde açılır, bitince güncel sürüm yazılır. Yalnız ana süreç yazar
   *  (kurulum:tamamla, kurulum:yukseltme-bitti); `ayarlar:kaydet` bu alanı yok sayar. */
  kurulumSurumu: number;
  /** En son izlenen (ya da geçilen) kokpit tanıtım turunun sürümü; '' = izlenmedi. Tur, kurulum bitmiş ve bu alan TANITIM_SURUMU
   *  değilse açılır — yeni kurulumda kurulumdan sonra, 0.6.0'dan yükselen profilde (alan yok) ilk açılışta, bir kez
   *  (src/shared/tanitim.ts). Ayarlar → Görünüm → "Tanıtımı yeniden izle" bunu '' yapar. */
  tanitimSurumu: string;
  /** 0.10 E1 (K7): Başlat menüsündeki kimlik gaspı temizliğinin en son yapıldığı uygulama sürümü (sürüm başına bir kez;
   *  main/kabuk-kimligi.ts). Yalnız ana süreç yazar; `ayarlar:kaydet` yok sayar (main/ayar-kaydi.ts), telefon yazamaz (uzakAyarSuz). */
  kisayolTemizligiSurumu?: string;
  /** 0.11 G12b (spec §10): sürüm yenilik kartının işareti — en son kapatılan (ya da yeni kurulumun kurulum:tamamla'da yazdığı) kart sürümü.
   *  Alan HİÇ yoksa profil 0.10 ve öncesinden yükselmiştir; 0.12 H6: eski sürümün işareti ('0.11.0') de "0.12’de yeni" kartını açar. Kart
   *  kokpitte bir kez açılır (shared/yenilik.ts yeniKartAcilsinMi). Yalnız ana
   *  süreç yazar (kurulum:tamamla, yenilik:kapat); `ayarlar:kaydet` yok sayar (main/ayar-kaydi.ts), telefon yazamaz (uzakAyarSuz izin listesi). */
  yenilikSurumu?: string;
  /** F1 (son inceleme K5): bu kurulumun cihaz adı son eki (4 onaltılık; ilk Fuber hesabı girişinde bir kez üretilir, çıkış/yeniden girişte
   *  AYNI kalır — main/hesap.ts). Sunucudaki cihaz adı "BİLGİSAYAR-ADI · 3f2a": aynı adı taşıyan iki bilgisayar birbirinin anahtarını
   *  kapatmaz, aynı bilgisayar kendi eski anahtarını kapatır. Yalnız ana süreç yazar; `ayarlar:kaydet` yok sayar (main/ayar-kaydi.ts). */
  cihazSoneki?: string;
  /** Son bütün dal incelemesi K-1: "Yalnız bu bilgisayar" yükseltme göçünün işareti (shared/nerede.ts YALNIZ_YEREL_GOCU). Yeni profilde
   *  bellekte konur (ilk kayıtta dosyaya); işaretsiz var olan profil 0.12 öncesidir → açılışta bir kez eski `yerel.yalnizYerel` kararı
   *  (main/yerel/gizli-geri-al.ts acilistaYalnizYerelGocu). Yalnız ana süreç yazar; `ayarlar:kaydet` yok sayar (main/ayar-kaydi.ts). */
  yalnizYerelGocu?: number;
  /** 0.10 Görev 2 (P3): bir bulut motoru en az bir kez başarıyla yanıt verdi (ilk başarılı bulut çağrısı ya da "Bağlantıyı dene"; Fuber
   *  hesabıyla da). Motor yokken "bağlı değil" (nötr, hiç bağlanmamış) ile "bağlantı koptu" (kırmızı, çalışmıştı) ayrımı buradan
   *  (shared/motor-durumu.ts motorGorunumu). 0.6–0.9 profilinde alan yoksa ve kayıtlı bir anahtar varsa göçte true (motorCalistiGocu).
   *  Yalnız ana süreç yazar; `ayarlar:kaydet` yok sayar (main/ayar-kaydi.ts), telefon yazamaz (uzakAyarSuz izin listesi). */
  motorCalisti: boolean;
  kullaniciAdi: string;
  hitap: string; // "Deniz", "Deniz Bey" — Fuber'in sana nasıl seslendiği
  /** 0.10 E4 (K6): kurulumun "İşin" ve "Günün" sayfaları — rol, şirket (isteğe bağlı), çalışma saatleri. Yoksa sorulmadı (0.6–0.9
   *  profili). Fuber'in sabit hafızasında tek kayıt ("İşi ve günü") olarak da durur; arayüzden gelen değer süzülür
   *  (shared/kurulum-adimlari.ts isProfiliSuz). Telefon yazamaz (uzakAyarSuz izin listesinde yok). */
  isProfili?: IsProfili;
  asistanAdi: string; // varsayılan "Fuber"
  dil: 'tr' | 'en';
  modeller: Record<ModelRolu, ModelSecimi>;
  /** 0.14 (ürün kararı): yapay zekâ sağlayıcısı — 'fuber' (varsayılan, bugünkü davranış) ya da 'anthropic' (kullanıcının kendi
   *  Claude anahtarı). YALNIZ Developer mode'da ve anahtar kayıtlıyken geçerli (shared/motor-secimi.ts claudeSecili); Business'ta yok sayılır.
   *  `modeller`den ayrı tutulur: hesap girişi/çıkışı (main/hesap.ts) `modeller`i yazar, bu seçimi ezmez. Telefon yazamaz (uzakAyarSuz). */
  motorSecimi?: 'fuber' | 'anthropic' | 'openai';
  /** Açık kaynak hazırlığı: kendi OpenAI uyumlu sağlayıcın (taban adresi + model; anahtar 'api:openai' sırrında). shared/motor-secimi.ts. */
  openaiUyumlu?: { tabanUrl: string; model: string; yardimciModel?: string };
  /** 'api:openai' kayıtlı mı — yalnız ana süreç hesaplar; `ayarlar:kaydet` yok sayar. */
  openaiAnahtariVar?: boolean;
  /** Açık kaynak hazırlığı: kurulumda "Hesapsız" seçildi — açılışta Fuber hesabı ekranı yeniden sorulmaz (shared/kurulum-adimlari.ts kurulumYolu). */
  hesapsizTercih?: boolean;
  /** 0.14: Claude seçiliyken rol başına model ve düşünme gücü (varsayılan claude-opus-5-5 / claude-haiku-5-5; shared/motor-secimi.ts). */
  claudeModeller?: Record<ModelRolu, { model: string; efor?: Efor }>;
  /** 0.14: sır deposunda Anthropic anahtarı ('api:anthropic') kayıtlı mı — yalnız ana süreç hesaplar (anahtarın kendisi arayüze gitmez);
   *  `ayarlar:kaydet` yok sayar (main/ayar-kaydi.ts). */
  claudeAnahtariVar?: boolean;
  saglayicilar: {
    anthropic: { etkin: boolean; anahtarVar: boolean; sunucuWebArama: boolean };
    openai: { etkin: boolean; anahtarVar: boolean; tabanUrl: string };
    openrouter: { etkin: boolean; anahtarVar: boolean; tabanUrl: string };
  };
  proaktif: {
    etkin: boolean;
    sabahOzeti: string; // "08:30"
    aksamOzeti: string; // "" = kapalı
    sessizBaslangic: string; // "23:00"
    sessizBitis: string; // "08:00"
    merakSorusuGunluk: number; // 0-3
    epostaTakip: boolean;
    /** Rahatsız etme bitişi (ISO; sol menü hızlı denetimi, 1 saat): o zamana dek sessiz saat gibi — hatırlatıcılar dışında
     *  kendiliğinden mesaj ve bildirim yok. Boş ya da geçmiş = kapalı. */
    rahatsizEtmeBitis?: string;
  };
  ses: {
    uyandirma: boolean; // "Hey Fuber"
    seslendirme: boolean; // yanıtları sesli oku
    kisayol: string; // asistanı açan genel kısayol
    /** Mikrofon tamamen kapalı (sol menü / Ayarlar → Ses): "Hey Fuber", gün kaydı dinlemesi ve sesle sorma kapanır; kulak
     *  penceresi açılmaz, hiçbir pencere mikrofon izni alamaz. Asistan açılınca yazı alanı gelir. */
    mikrofonKapali: boolean;
    /** 0.11 G11 (spec §9): açılışta kısa, yumuşak çan (varsayılan açık). Sessiz saatte, rahatsız etmede ve FUBER_DEMO'da çalmaz. */
    acilisSesi: boolean;
    /** Konuşma hızı (0.85–1.15; 1 = normal). Hem Fuber'in sesinde hem yedek seste. */
    hiz?: number;
    /** @deprecated 0.12: kurulumun "Bu bilgisayarın sesi" kaydı. 0.13 göçü siler; hiçbir yerde okunmaz. */
    bilgisayarSesi?: boolean;
    /** Ses ayarlarının sürümü: 2 = 0.9.0 göçü, 3 = 0.13 göçü yapıldı (shared/ses-kimligi.ts sesGocu). */
    surum?: number;
    /** @deprecated 0.8.0 ve öncesi: sağlayıcı seçimi (windows, google, openai, elevenlabs, azure, google-cloud, yerel). Göçte okunur,
     *  sonra silinir; artık tek ses var. */
    saglayici?: string;
    /** @deprecated 0.8.0 ve öncesi: sağlayıcı başına ses. Göçte silinir. 0.13: kullanıcı ses seçmez (ses kipe bağlı); eski dosyadaki
     *  `elevenSes` de okunmaz (alan bu türde yok; dosyada kalırsa yok sayılır). */
    sesler?: Record<string, string>;
    /** @deprecated */ sesAdi?: string;
    /** @deprecated */ azureBolge?: string;
  };
  yetki: {
    tarayici: boolean;
    bilgisayar: boolean; // fare + klavye + ekran
    dosyaOkuma: boolean;
    /** Tam yetki: fare/klavye, tarayıcı ve dosya açma için görev başına SORMAZ (gönderimler yine onay ister). */
    tamYetki: boolean;
  };
  iceAktarKlasoru: string;
  baslangictaAc: boolean;
  eposta: EpostaAyari[];
  whatsapp: { etkin: boolean; bagli: boolean; numara?: string };
  /** Düşünme motoru: gün boyu dinleme → döküm → not → günlük/haftalık/aylık rapor (bkz. src/main/gunkaydi/). */
  gunKaydi: GunKaydiAyari;
  mcp: McpSunucu[];
  /** Görünüm: koyu, açık ya da Windows'un temasına göre ('sistem' = arayüzde "Otomatik"; 0.12 H3a: yeni kurulumun varsayılanı). 'cam' = Şeffaf (0.13 T13: 0.12'de
   *  kalkmıştı, geri geldi; yalnız Windows 11 22H2+ / macOS — yoksa Koyu çizilir, kayıt değişmez: shared/tema-cozum.ts camDestekli, etkinTemaBul).
   *  adaSessiz: ada iş yokken de ekranın üstünde küçük çentik olarak görünsün (varsayılan evet; tam ekranda yine çekilir);
   *  kapalıysa yalnız bir şey olunca iner, iş bitince gizlenir.
   *  ada: 'kapali' = ada kendiliğinden hiç inmez (hatırlatıcı ve onay Windows bildirimi olur; kısayol ve "Hey Fuber" yine açar).
   *  adaGizliBitis: "Adayı 1 saat gizle" bitişi (ISO); o zamana dek 'kapali' gibi. Uygulama öndeyken ada zaten görünmez (main/ada.ts).
   *  karakterler (0.14 T6b, "Sade mod"): 'goster' = gözler görünür (varsayılan); 'sade' = hiçbir yüzeyde göz çizimi ya da karakter
   *  adı yok, yerine nötr işaret ve "Fuber" (shared/karakter-gorunum.ts karakterGorunurMu; arayüz kancası renderer/karakter-gorunum.ts).
   *  0.14 T19: tamEkrandaGizle: tam ekran film/sunum/oyunda boştaki çentik çekilsin (varsayılan evet; kapalıysa kalır, hover yine açmaz; onay ve Fuber'in
   *  mesajı tam ekranda eskisi gibi bekler). azHareket: "Az hareket" (R16; varsayılan kapalı): Windows'un animasyon tercihine ek; yalnız göz kırpma ve
   *  geçişler kalır.
   *  0.14 T22: uyarilar: "Sistem uyarıları" — yedi anahtar (kulaklık, şarj, ses, parlaklık, Caps Lock, klavye dili, internet); alan ya da anahtar yoksa açık
   *  (shared/sistem-uyarilari.ts uyariAnahtarlari). Caps Lock ve dil ikisi de kapalıysa klavye kancası kurulmaz. */
  gorunum: { tema: Tema; adaSessiz: boolean; ada: 'goster' | 'kapali'; adaGizliBitis?: string; karakterler: KarakterGorunumu; tamEkrandaGizle?: boolean; azHareket?: boolean; uyarilar?: Partial<Record<UyariAnahtari, boolean>>;
    /** 0.14 T23: Görünüm → "Çentik sayfaları" — panelin sayfa sırası ve kapalı sayfalar (shared/centik-sayfalar.ts sayfaAyariDogrula; yoksa dokuzu açık). */
    centikSayfalari?: { sira: SayfaKimligi[]; kapali: SayfaKimligi[] } };
  /** Yerel beyin: bu bilgisayarda çalışan dil modeli (llama.cpp + Bonsai). Gündelik sohbet, espri, sınıflandırma ve
   *  hitap algılama yerelde; önemli işler ve kodlama Claude'da. */
  yerel: YerelAyari;
  /** Claude Code: oturum geçmişi (~/.claude/projects), uygulama içi oturumlar (Agent SDK; Görev 27) ve eski terminal yolu. Fuber
   *  kodu kendisi yazmaz. Varsayılanlar ve 0.6–0.8 göçü: shared/cc-ayar.ts. */
  claudeCode: CcAyari;
  /** Kullanım biçimi (K2; varsayılan 'is'). İş modunda görünmez: API anahtarları, model/efor seçimi, sağlayıcı adları,
   *  Claude Code sayfası, MCP, yerel beynin teknik ayrıntıları (Ayarlar → Yapay zekâ kategorisi dahil). Ayarlar → Genel'den değişir. */
  mod: Mod;
  /** Kokpit doldurucuları (Görev 24, K14; Ayarlar → Pano): hava, haberler, gündemdeki konular, döviz aç/kapa ve şehir (boş = saat
   *  diliminden). Kapalı kaynağa hiç istek gitmez. Bkz. shared/pano.ts. */
  pano: PanoAyari;
  /** 0.11 G7: kokpitin sohbet paneli. `sonSohbet`: panelde en son seçilen sohbetin kimliği (null/yok = ana); kokpit açılırken o sohbet
   *  gösterilir (ana sohbette okunmamış varsa ana öncelikli; sohbet silinmiş/arşivlenmişse ana — shared/kokpit-sohbet.ts). Arayüz yazar
   *  (`ayarlar:kaydet`); telefon yazamaz (kopru-protokol.ts uzakAyarSuz izin listesinde yok). */
  kokpit?: {
    sonSohbet?: number | null;
    /** 0.11 G10: Görevler kartının boş hâli ("Fuber’e bir işi takip ettirebilirsin") bir kez gösterildi — sonra kart boşken görünmez. Arayüz yazar. */
    gorevlerBosGorundu?: boolean;
  };
  /** Masaüstü Fuber hesabı (0.10 E3, K1/R10): yoksa giriş yapılmamış. SIR YOK (cihaz anahtarı sır deposunda kendi yuvasında 'hesap:cihaz';
   *  şifre ve oturum anahtarları hiç saklanmaz; `saglayicilar.fuber` geliştiricinin kendi ağ geçidinindir, hesap ona dokunmaz). Yalnız ana
   *  süreç yazar (main/hesap.ts); `ayarlar:kaydet` (ayar-kaydi.ts) ve telefon (uzakAyarSuz) bu alanı YAZAMAZ, telefon görmez
   *  (telefonaGiden). `durum` R10'un dört hâli: aktif · bekliyor · kapali · kredi-bitti (shared/masaustu-hesap.ts). */
  hesap?: HesapAyari;
}

export type Mod = 'is' | 'gelistirici';
export type Tema = 'koyu' | 'acik' | 'sistem' | 'cam';
/** Katalog kimliği (0.13 G; main/yerel/katalog.ts): liste sunucudan gelir, doğrulama katalogBul'la yapılır. */
export type YerelModelAdi = string;
export interface YerelAyari {
  /** Yerel beyin açık (kurulu ve çalışmasına izin var). Görev 21 (K10): açık olması onu yanıt yoluna SOKMAZ — yerel beyin yalnız
   *  `gizliMod`da ya da hiç bulut motoru yokken TEK motordur (shared/tek-motor.ts); asla aynı konuşmada bulutla karışmaz. */
  etkin: boolean;
  model: YerelModelAdi;
  gpu: 'otomatik' | 'cpu';
  /** Gizli mod (bulutsuz; Görev 21, K10): açıkken her şey bu bilgisayarda — yanıt, arka plan işleri, ses (yedek ses) ve yazıya çevirme.
   *  Araçlar (hatırlatıcı, e-posta, tarayıcı…) bu kipte kullanılmaz. Varsayılan kapalı; yükseltmede kapalı. */
  gizliMod: boolean;
  /** 0.11 G8 (spec §7): "Yalnız bu bilgisayardaki yapay zekâ" (Ayarlar → Yapay zekâ; yalnız Geliştirici'de görünür ve etkindir): açıkken,
   *  Gizli mod kapalıyken de, bulut anahtarı olsa bile bütün roller yerelde çalışır — araçlar (hatırlatıcı, e-posta, ekran, görevler) yok;
   *  ağ özellikleri (kokpit kartları, e-posta eşitleme, hesap) sürer, gizlilik sözü verilmez. Yerel hazır değilse ya da İş modundaysa yok
   *  sayılır (shared/tek-motor.ts). Varsayılan kapalı; yükseltmede kapalı. Yalnız bilgisayarın başında değişir (telefon yazamaz). */
  yalnizYerel: boolean;
  /** @deprecated Görev 21 (K10): yerel beyin artık iş başına seçilmez (Gizli modda hepsi yerelde, değilse hiçbiri). Okunmaz. */
  gorevler: { gundelik: boolean; eslikci: boolean; notTutucu: boolean; raporcu: boolean; kokpit: boolean; siniflandirma: boolean };
  /** Gün kaydında "ee Fuber nasılsın" gibi seslenmeleri yakala, Fuber'in sesiyle yanıt ver. */
  hitapAlgila: boolean;
  /** @deprecated 0.8.0: ayrı "Hızlı yanıtın sesi" kalktı (tek ses; Görev 21). Göçte silinir. */
  hizliSes?: 'yerel' | 'secili';
  /** Kullanıcının istediği, henüz bitmemiş kurulum (Görev 15 düzeltme 1; YALNIZ ana süreç yazar: main/yerel/kurulum.ts). Doğrulanmış
   *  kurulumda yerel beyin açılır ve silinir; uygulama indirme sürerken kapanırsa kalır → açılışta "yarıda kaldı" bildirimi. */
  bekleyenKurulum?: BekleyenKurulum;
  /** F1 (son inceleme Ö1): Gizli mod kendiliğinden kapandı — bu bilgisayardaki yapay zekâ hazır değilken bekleyen kurulumdan vazgeçildi
   *  ('vazgec'), kurulum kalıcı hatayla bitti ('hata') ya da açılışta Gizli açık ama yerel ne hazır ne hazırlanıyordu ('hazir-degil';
   *  düzeltme turu 1, N-1). Kokpit tek sakin cümleyle söyler ("Tamam" → yerel:gizli-notu-kapat; Gizli
   *  yeniden açılınca silinir). YALNIZ ana süreç yazar (main/yerel/gizli-geri-al.ts; ayar-kaydi.ts arayüzün kopyasından düşürür). */
  gizliGeriAlindi?: 'vazgec' | 'hata' | 'hazir-degil';
}
/** `etkinBaslangic`: istek verildiğinde yerel beyin açık mıydı (açıkken başlayıp sonra elle kapatıldıysa bitince yeniden açılmaz). */
export interface BekleyenKurulum {
  model: YerelModelAdi; zaman: string; etkinBaslangic?: boolean; hata?: string;
  /** Görev 23: kurulum sihirbazının "Ekstra gizlilik"inde "Gizli mod" seçildi — doğrulanmış kurulumdan sonra (yerel beyin açılınca) Gizli
   *  mod da açılır. Yalnız ana süreç yazar (yerel:kur { gizli }, yerel:bekleyen-gizli). */
  gizliMod?: boolean;
}

// ── Düşünme motoru (gün kaydı) ───────────────────────────────────────────────────────────────────────────────
export type Onem = 'onemli' | 'onemsiz';
export type YaziciMotor = 'otomatik' | 'whisper' | 'vosk' | 'openai';
export type WhisperModeli = 'large-v3-turbo-q5_0' | 'large-v3-q5_0' | 'small-q5_1';
export type EslikciKipi = 'kapali' | 'hatirlatma' | 'hatirlatma_espri';

export interface GunKaydiAyari {
  /** Sürekli dinleme (varsayılan KAPALI; açarken rıza uyarısı onaylanır). */
  etkin: boolean;
  rizaTarihi?: string;
  /** Yalnız bu saatlerde/günlerde dinler (gunler: 0 = Pazar … 6 = Cumartesi). */
  calisma: { bas: string; bit: string; gunler: number[] };
  kilitteDuraklat: boolean;
  /** Geçici duraklatma bitişi (ISO); boş = duraklatılmadı. */
  duraklatBitis?: string;
  /** Yazıya döken: otomatik = Whisper kuruluysa Whisper, yoksa cihazdaki Vosk. OpenAI ücretlidir. */
  motor: YaziciMotor;
  whisperModel: WhisperModeli;
  whisperGpu: 'otomatik' | 'cpu' | 'cuda';
  /** Not tutucu, eşlikçi ve raporcu ajanlarının modeli; boş = yardımcı model (ucuz). */
  ajanModeli?: ModelSecimi;
  /** Eşlikçi: konuşmalara araya girer (hatırlatma; isterse espri de yapar). */
  eslikci: EslikciKipi;
  eslikciSesli: boolean;
  /** Saatte en çok kaç kez araya girer. */
  eslikciSaatlik: number;
  gunlukRaporSaati: string; // "21:30"
  /** Saklama (gün): ham döküm, önemsiz/önemli not maddeleri, haftalık raporun önemsiz/önemli kısmı. Aylık rapor kalıcıdır. */
  saklama: { ham: number; onemsiz: number; onemli: number; haftalikOnemsiz: number; haftalikOnemli: number };
  /** Kalıcı bilgileri (tercih, karar, kişi) uzun süreli hafızaya da işle. */
  hafizayaIsle: boolean;
}

// `gizli` (Görev 21 düzeltme turu 2): Gizli mod açıkken oluştu (ya da Gizli içerik ona karıştı) — hiçbir bulut işine (rapor, eşlikçi,
// kokpit planı, not tutucu, sohbet araçları) girmez; yalnız bu bilgisayarda (yerel beyin, arayüz) kullanılır.
export interface DokumSatiri { id: number; zaman: string; metin: string; motor: string; gizli?: boolean }
export interface NotMaddesi {
  id: number; gun: string; zaman: string; metin: string; onem: Onem; konu?: string; kisiler: string[];
  eglenceli: boolean; satirlar: string; silinme: string; gizli?: boolean;
}
export type RaporTuru = 'gunluk' | 'haftalik' | 'aylik';
export interface RaporBolumu { metin: string; silinme?: string }
export interface Rapor {
  id: number; tur: RaporTuru; donem: string; baslik: string; ozet: string;
  onemli: RaporBolumu[]; onemsiz: RaporBolumu[]; kararlar: string[]; acikMeseleler: string[]; ileriye: string[];
  espri?: string; maddeSayisi: number; model?: string; olusturma: string; guncelleme: string; gizli?: boolean;
  /** Yalnız "Şimdi hazırla" yanıtında: bulut yolunda dönemin Gizli (yerel) raporu korundu, yeniden yazılmadı (arayüz tek satırla söyler). */
  yerelKorundu?: boolean;
}
export interface Mesele {
  id: number; baslik: string; ayrinti?: string; kisi?: string; ilkGun: string; hedef?: string;
  durum: 'acik' | 'kapandi' | 'iptal'; kapanis?: string; kaynak?: string; guncelleme: string; gizli?: boolean;
}
/** `not`: kullanıcıya görünen sade yazı (iki modda); `ayrinti`: teknik ayrıntı (yazıcı motoru, ham hata) — yalnız Geliştirici'de. */
export interface AjanDurumu { ad: string; etiket: string; durum: 'bekliyor' | 'calisiyor' | 'hata' | 'kapali'; son?: string; sayac: number; not?: string; ayrinti?: string }
export interface DusunmeDurumu {
  etkin: boolean;
  dinliyor: boolean;
  neden?: string; // neden dinlemiyor: kapalı / çalışma saati dışında / ekran kilitli / duraklatıldı / kulak yok
  yazici: { motor: 'whisper' | 'vosk' | 'openai'; aciklama: string };
  whisper: { kurulu: boolean; calisiyor: boolean; model?: string; gpu?: boolean; indirme?: { yuzde: number; adim: string; hata?: string } };
  bugun: { satir: number; madde: number; onemli: number; eslik: number };
  ajanlar: AjanDurumu[];
  sonEslik?: { zaman: string; metin: string };
  acikMesele: number;
}

export interface EpostaAyari {
  id: string;
  ad: string; // "İş", "Kişisel"
  adres: string;
  imapSunucu: string;
  imapPort: number;
  smtpSunucu: string;
  smtpPort: number;
  kullanici: string;
  parolaVar: boolean;
  guvenli: boolean;
}

export interface McpSunucu {
  id: string;
  ad: string;
  aciklama: string;
  tur: 'stdio' | 'http';
  komut?: string;
  argumanlar?: string[];
  ortam?: Record<string, string>;
  url?: string;
  basliklar?: Record<string, string>;
  etkin: boolean;
  her?: boolean; // her sohbete bağla (yoksa ilgili soruda bağlanır)
  /** 0.14 son inceleme tur 2: gizli değerler sır yuvasından çözülemedi (yalnız ana süreç yazar); bağlanılmaz, Bağlantılar satırı açık hata gösterir. */
  sirOkunamadi?: boolean;
}

// ── Sohbet ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface SohbetOzet {
  id: number;
  baslik: string;
  /** 'gorev' (0.11 G9): bir Görev'in kendi sohbeti ("Görev · <başlık>"; main/isler). */
  tur: 'ana' | 'normal' | 'asistan' | 'gorev';
  guncelleme: string;
  sonMesaj?: string;
  okunmamis?: number;
}

export type GorunenBlok =
  | { tur: 'metin'; metin: string }
  | { tur: 'gorsel'; medya: string; veri: string }
  | { tur: 'arac'; id: string; ad: string; etiket: string; girdi: unknown; durum: 'calisiyor' | 'tamam' | 'hata' | 'reddedildi'; ozet?: string; gorsel?: string;
      /** Kartın "aç" hedefi (ör. claude_code_gorev → 'claude#cc-<oturum>': "Oturumu aç"). */
      yol?: string }
  /** 0.11 G6: yapay zekânın `kart_goster` kartı (shared/kart.ts; kayıtta araç çağrısı olarak durur, görünüm onu kart bloğuna çevirir). */
  | { tur: 'kart'; kart: KartVerisi }
  /** Analiz 11 Kas bulgu 8: kullanıcının belge/video eki (kayıtta `<ek>` bloğu; görünüm adını çip olarak gösterir, içeriği değil). */
  | { tur: 'ek'; ad: string; turu: 'belge' | 'video' };
/** Araç adımı bloğu (sohbet, ada ve AracAdimlari bunu kullanır). */
export type AracBlok = Extract<GorunenBlok, { tur: 'arac' }>;

export interface GorunenMesaj {
  id: number;
  rol: 'user' | 'assistant' | 'not';
  bloklar: GorunenBlok[];
  zaman: string;
  kaynak?: string; // kullanici | ses | proaktif | ice_aktarma
  model?: string;
  atiflar?: Atif[];
  /** 0.13: yanıtı yazan karakterin adı (turun başında kilitlenen kip; 11 Kas'tan beri hep "Fuber"). Eski iletide yok: arayüz "Fuber" gösterir. */
  karakter?: string;
  /** 0.14 T30: yanıtı yazan karakterin kipi (sohbet avatarı: gözler, parıltı kipin renginde). Eski iletide yok: arayüz Fuber işaretini gösterir. */
  kip?: KipKimligi;
}

export interface Atif { id: number; baslik: string; tarih: string }

export type SohbetOlayi =
  /** `karakter`/`kip`: bu turun karakteri, tur başında kilitlenir (kip tur sürerken değişse de canlı balon ve ses bununla biter). */
  | { tur: 'basladi'; sohbetId: number; kullaniciMesaji: GorunenMesaj; karakter?: string; kip?: KipKimligi }
  | { tur: 'dusunce'; sohbetId: number; metin: string }
  | { tur: 'metin'; sohbetId: number; parca: string }
  | { tur: 'arac'; sohbetId: number; blok: Extract<GorunenBlok, { tur: 'arac' }> }
  /** 0.11 G6: `kart_goster` başarılı oldu — `aracId` satırının yerine kart gelir (canlı balon). Telefona düz metin olarak gider (kopru.ts). */
  | { tur: 'kart'; sohbetId: number; aracId: string; kart: KartVerisi }
  /** I5: model bu adımda araç bloğuna geçti — adımda o ana dek yazılan metin araçtan ÖNCE yazıldı; ses yolu onu söylemez (shared/sesli-yanit.ts). */
  | { tur: 'arac_oncesi'; sohbetId: number }
  | { tur: 'onay'; sohbetId: number; istek: OnayIstegi }
  /** 0.14 T13 (R24): tur adım sınırına (`adim`, 100) geldi; kayda tavan notu düştü, ardından 'bitti' gelir. Sohbet "Devam et" gösterir; telefona düz
   *  metin olarak gider (shared/telefon-hafif.ts). */
  | { tur: 'tavan'; sohbetId: number; adim: number }
  | { tur: 'bitti'; sohbetId: number; mesaj: GorunenMesaj }
  /** mesgul: sohbette başka yanıt sürerken gelen istek reddedildi; sürmekte olan tur BOZULMAZ (yalnız uyarı). */
  | { tur: 'hata'; sohbetId: number; mesaj: string; mesgul?: boolean }
  /** Bekleyen onay iptal edildi (süre doldu / durduruldu): kart kalkar. */
  | { tur: 'onay_iptal'; sohbetId: number; id: string }
  /** proaktif ya da başka yerden. `bildirimsiz` (0.11 G9): sessiz saat/rahatsız etmede yazılan görev satırı — telefona bildirim olmaz. */
  | { tur: 'yeni_mesaj'; sohbetId: number; mesaj: GorunenMesaj; bildirimsiz?: boolean };

export interface OnayIstegi {
  id: string;
  baslik: string; // "E-posta gönderilsin mi?"
  aciklama: string;
  onizleme?: string; // gönderilecek içerik (aynen)
  tehlike: 'dusuk' | 'orta' | 'yuksek';
  secenekler: ('bir_kez' | 'bu_gorev' | 'reddet')[];
  /** 0.11 G9: Görev başlatma onayı ("Görev: <başlık>"). `gorev`: planın insan dili (shared/isler.ts isPlaniMetni) — G10'un kartı bunu çizer;
   *  o zamana dek genel kart başlık + açıklama (ne yapacak) + önizleme (nasıl, bitiş, izinler, sınır satırları) gösterir. */
  tur?: 'gorev';
  gorev?: { baslik: string; ne: string; nasil: string; bitis: string; izinler: string[]; sinir: string };
}

// ── Kokpit ───────────────────────────────────────────────────────────────────────────────────────────────────
export type KartTipi =
  | 'zihin' | 'hatirlatici' | 'eposta' | 'oneriler' | 'dikkat' | 'plan' | 'sohbetler' | 'projeler'
  | 'arac_kiti' | 'whatsapp' | 'hafiza' | 'ice_aktarma' | 'ozel' | 'dusunme' | 'meseleler'
  // Görev 24 (K14): gündem bandı (zihin bandının altında, her zaman; arayüz ekler) ve doldurucular (veri yokken boşluğu doldurur;
  // planlayıcı da yerleştirebilir — kullanıcı "hava en üstte" derse). Telefon (cep/Bugun.tsx) bunları göstermez.
  | 'gundem' | 'hava' | 'haberler' | 'piyasa' | 'ipuclari'
  // 0.11 G10: Görevler kartı (süren + bugün biten görevler). Planlayıcı yerleştirmez; arayüz (Kokpit.tsx) görev varken gündem bandının altına ekler.
  | 'gorevler';

/** Kartın önemi: kenar rengi (dikkat = kehribar, acil = kırmızı, olumlu = yeşil) ve önemi artınca kısa bir parıltı. */
export type KartOnemi = 'normal' | 'dikkat' | 'acil' | 'olumlu';

export interface KartYerlesimi {
  id: string;
  tip: KartTipi;
  kolon: number; // 1-12 başlangıç (12 sütunda; daha dar ızgarada arayüz yeniden dizer, bkz. shared/izgara.ts)
  genislik: number; // 3, 4, 6, 8, 9, 12 sütun
  yukseklik: 'k' | 'o' | 'b'; // küçük / orta / büyük
  /** Eski alan (mobil Fuber Cep okur): önem dikkat/acil iken true. */
  vurgu?: boolean;
  onem?: KartOnemi;
  baslik?: string;
  /** Görev 24: kart planlayıcının kararı değil, kuralla eklendi (ör. her yerleşimde bulunan araç kiti): arayüz yerini ekranın doluluğuna
   *  göre kendisi seçer. Planlayıcının yerleştirdiği kart (işaretsiz) yerinde kalır. */
  yedek?: boolean;
}

export interface KokpitDurumu {
  selamlama: string;
  odak: string; // günün tek cümlelik odağı
  kartlar: KartYerlesimi[];
  gerekce?: string;
  guncelleme: string;
  veri: KokpitVerisi;
}

export interface KokpitVerisi {
  hatirlaticilar: Hatirlatici[];
  /** Açık yapılacaklar (gündem bandı, gün özeti, kart sınırı ve planlayıcı özeti bunu okur: işaretlenmiş madde burada YOKTUR). */
  gorevler: Gorev[];
  /** 0.11 G4: Yapılacaklar kartının listesi — açıklar, ardından yerel bugünün başından beri tamamlananlar (üstü çizili kalır; ertesi gün
   *  kalkar ve hafızaya "Tamamlananlar" olarak geçer). Eski/boş veride yok: kart `gorevler`e düşer (shared/yapilacaklar.ts kartGorevleri). */
  yapilacaklar?: Gorev[];
  oneriler: Oneri[];
  epostalar: EpostaOzet[];
  whatsapp: WaOzet[];
  sohbetler: SohbetOzet[];
  projeler: { id: number; baslik: string; icerik: string; guncelleme: string }[];
  hafiza: { id: number; baslik: string; tur: string; guncelleme: string }[];
  /** `ozetsiz` (cila düzeltme turu 2, N-3): parçaları aranabilir, özeti sonra — kendi kovasında ("bekliyor" sayılmaz). */
  iceAktarma: { bekleyen: number; islenen: number; hata: number; ozetsiz?: number; son?: string };
  ozelKartlar: OzelKart[];
  zihin: { durum: 'bos' | 'dusunuyor' | 'dinliyor' | 'konusuyor'; hafizaSayisi: number; bagliMotorlar: string[] };
  /** Düşünme motoru: bugünün önemli notları, son rapor, açık meseleler, ajan durumları. */
  dusunme: { durum: DusunmeDurumu; bugunOnemli: NotMaddesi[]; sonRapor?: Rapor; meseleler: Mesele[] };
}

export interface Hatirlatici { id: number; baslik: string; aciklama?: string; zaman: string; tekrar: string; durum: string; onem: number }
/** `tamamlanma`: yalnız durum "tamam" iken (ISO). */
export interface Gorev { id: number; baslik: string; aciklama?: string; durum: string; sonTarih?: string; proje?: string; oncelik: number; tamamlanma?: string }
export interface Oneri { id: number; tur: 'oneri' | 'dikkat' | 'soru'; baslik: string; icerik: string; durum: string; olusturma: string }
export interface EpostaOzet { id: number; hesap: string; kimden: string; konu: string; tarih: string; ozet: string; okundu: boolean; onem: number }
export interface WaOzet { jid: string; ad: string; sonMesaj: string; zaman: string; okunmamis: number }
export interface OzelKart { id: string; baslik: string; icerik?: string; liste?: string[]; metrikler?: { ad: string; deger: string }[]; oncelik: number; guncelleme: string }

// ── Hafıza ───────────────────────────────────────────────────────────────────────────────────────────────────
export type HafizaTuru = 'kullanici' | 'proje' | 'tercih' | 'kisi' | 'olay' | 'bilgi' | 'kural' | 'gorev';
export interface HafizaKaydi {
  id: number;
  tur: HafizaTuru;
  baslik: string;
  icerik: string;
  etiketler: string[];
  onem: number;
  sabit: boolean;
  kaynak: string;
  olayTarihi?: string;
  olusturma: string;
  guncelleme: string;
}

export interface Durum {
  surum: string;
  kurulumTamam: boolean;
  motorlar: { ad: SaglayiciAdi; hazir: boolean }[];
  whatsapp: 'kapali' | 'qr' | 'bagli' | 'baglaniyor' | 'hata';
  bilgisayarKontrolu: boolean;
  /** 0.12 H6 (P12): kurulu uygulamanın bu açılışta yok saydığı ortam değişkenlerinin ADLARI (değer yok; shared/ortam-kapisi.ts). Paketsizde boş. */
  ortamUyarilari?: string[];
  /** İsteğe bağlı modüllerle (WhatsApp) pakete giren bileşenlerin bildirimleri — Hakkında listenin sonuna ekler. Modülsüz derlemede yok. */
  ozelLisanslar?: UcuncuTaraf[];
}

