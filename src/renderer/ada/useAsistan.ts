// ── Ada kancası: asistanın durumu ve olayları (görünümden bağımsız) ──────────────────────────────────────────────
// Eski sağ alt asistanın (asistan.tsx) mantığı buraya taşındı: "Hey Fuber" ya da kısayolla dinler, soruyu ana sohbete yazar
// ve yanıtı akıtır (sesle sorulduysa sesli okur); onay isteyen işler, hatırlatıcılar ve Fuber'in kendiliğinden mesajları da
// buradan geçer. Görünüm (Ada.tsx) hali `adaDurumu`ndan seçer (src/shared/ada.ts adaHaliBul) ve düğmelere buradaki işleri bağlar.
//  - Bildirimler birbirini EZMEZ: geliş sırasıyla listede bekler; baştaki gösterilir, kapatılınca ya da süresi dolunca sıradaki
//    gelir. Konuşma (dinleme, yanıt) ve onay bildirimden önce gelir: bildirim arkada bekler, süresi göründüğünde başlar.
//  - Fuber'in kendi sözü adayı AÇMAZ (0.13; `sessiz` bildirim): sessiz çentikte nokta belirir, imleç üstüne gelince yazısı görünür, çıkınca görülmüş sayılıp kalkar;
//    hapına tıklanırsa olağan bildirim gibi kalır. Hover ASLA ses başlatmaz (imleç geçerken özel bir not okunmasın): sesli söz yalnız tıklanınca çalar, imleç çıkınca sürer, Sustur keser.
//    Adayı yeniden indirmez, geri çekilmeyi tutmaz; 30 dk görülmezse düşer (mesaj sohbette kalır).
//  - Hover (0.13): tıklama yakalama (`ada:fare`) imlecin anlık hâlidir; görünüm (`hover`: selam ya da noktadaki mesaj) HOVER_GECIKME_MS sonra açılır,
//    HOVER_CIKIS_MS sonra kapanır. İmleç bayrağının `mouseleave` gelmeden düştüğü yerde hover da düşer (hoverSifirla): selam takılı kalmaz.
//  - Gizleme süreleri eskisi gibi: bildirim 45 sn, yanıt 30 sn, konuşma bitince 20 sn, Fuber'in sözü 15 sn, meşgul 8 sn, boş
//    dinleme 6 sn. İmleç adanın üstündeyken süre durur, çıkınca yeniden başlar; Fuber ekranı kullanırken süre işlemez.
//  - İş bitince ada önce GERİ ÇEKİLİR (şekil üst kenara toplanır), sonra pencere gizlenir: görünürlük animasyon için açılıp
//    kapanmaz. Pencere gizlenince yarım kalan sohbet ve görülmüş bildirimler temizlenir; bir sonraki gösterimde ada yeniden iner.
//    "Ada sessizken görünsün" açıksa pencere gizlenmez: ana süreç 'ada:sessiz' der, aynı temizlikten sonra ada sessiz hale iner.
//    Dışarıdan gizlendiğinde (kısayol, tepsi) sırada görülmemiş bildirim kaldıysa ada kısa süre sonra onun için yeniden iner.
//  - Soru kutusu kullanıcınındır: süre dolunca kapanmaz (Esc, odak kaybı ya da gönderince kapanır). Tek istisna: hiç odak almamış
//    (Esc ve odak kaybı ona ulaşmaz) BOŞ kutu 30 sn sonra kapanır.
//  - Yalnız adanın başlattığı tur izlenir: ana pencereden ya da telefondan yazılanlar adayı oynatmaz.
//  - Ana süreç adayı ekrandakine göre "açık" ya da "boşta" sayar: gösterecek bir şey kalmayınca ada geri çekilir (onay başka yerde
//    yanıtlandı, süresi doldu, turu bitti; kapıdan gecikmeli yeniden iniş geldiğinde içerik çoktan gitmişti) ve her "doluyken boşaldı"
//    anında 'ada:bos' denir. Boştaki sessiz adayı kendiliğinden geri çekmek YOK (geri çekilme → ada:sessiz → yeniden iniş döngüsü).
//  - Açık panel (0.14 T23; R13): imleç boştaki çentikte (dinlenme, Kapalı) HOVER_GECIKME_MS durunca panel açılır, çıkınca PANEL_KAPANIS_MS sonra kapanır —
//    panelde yazı alanı odaktaysa kapanmaz. Tıklama (`panelTikla`): şapka dönüşü (`sapkaNo` → karakterin `tetik`i), panel Asistan sayfasıyla sabitlenir,
//    yazı alanı klavye odağı alır (asistan:goster odakla). Pencere odağı gidince, ekran olayında ('ada:ekran') ve Alt+Shift+Q'da ('ada:acil') panel kapanır
//    (shared/ada.ts panelKapanirMi; Review Focus 1, B28). Ana süreç paneli bir sayfayla açtırabilir ('ada:sayfa'; T24–T27). Hover ses başlatmaz.
//  - Sistem uyarısı (0.14 T22; ana süreç 'ada:uyari'): boştaki çentikte kısa hap (kulaklık, şarj, ses/parlaklık bindirmesi, Caps Lock, dil, internet). Yeni
//    hap eskisinin yerine geçer; süresi tek atımlık setTimeout (bindirme 1,5 sn, öbürleri 2,2 sn). Boş hâl sayılır: iş (onay, dinleme, yanıt, görev) onu ezer,
//    geri çekilmeyi tutmaz. Pencere gizlenince düşer. Karakter çizmez (Sade modda da aynı).
//  - Fuber'in sesi (Görev 21, K9): sesle sorulan yanıt model YAZARKEN cümle cümle konuşulur (renderer/fuber-sesi.ts; eskiden yanıtın
//    tamamı bitince tek seferde, başka başka seslerle). Tek ses: anahtar varsa ElevenLabs, yoksa yedek ses; tarayıcı sesi yok. Kullanıcı
//    konuşunca ("Hey Fuber", kısayol, mikrofon), Sustur, Esc ya da Durdur'da ses ANINDA susar.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cagir, dinle } from '../api';
import { seviyeOlcer, konusmaYakala, dinlemeAc, dikteYokSatiri, dikteYeniden, ornekAkit } from '../ses-yakala';
import { fuberKonus, fuberSoyle, type FuberKonusmasi } from '../fuber-sesi';
import { SesliYanit } from '../../shared/sesli-yanit';
import { adaHaliBul, bildirimSiraya, durdurSokuldu, hatirlatmaKutuyuKapatirMi, hoverCikinciKalkarMi, panelKapanirMi, sessizMesajTaze, FUBER_OLAYI_OMRU_MS, HOVER_CIKIS_MS, HOVER_GECIKME_MS, PANEL_KAPANIS_MS, PANEL_TIKLAMA, type AdaDurumu, type PanelOlayi } from '../../shared/ada';
import { PANEL_SAYFALARI, acikSayfalar, type SayfaKimligi } from '../../shared/centik-sayfalar';
import { medyaCaliyor, useMedya } from './sayfalar/useMedya';
import { odakZiliCal } from './odak-zil';
import { surukleFareGonder, surukleYakalamayiBirakMi, type SurukleOlayi } from '../../shared/raf';
import { etkinKarakter, type KipKimligi } from '../../shared/karakterler';
import type { CentikKipi } from '../../shared/ada';
import { gorunenKarakterAdi, karakterGorunurMu } from '../../shared/karakter-gorunum';
import type { OnayIstegi, SohbetOlayi, AracBlok, Ayarlar, Mod } from '../../shared/tipler';
import type { KartVerisi } from '../../shared/kart';
import { adimGorunurMu } from '../../shared/arac-satiri';
import { MESGUL_MESAJI } from '../../shared/mesgul';
import { adaMotoru, motorHapiVarMi, yalnizYerelSecili, type MotorGorunumu } from '../../shared/motor-durumu';
import type { HesapDurumu } from '../../shared/masaustu-hesap';
import { useMotorSinyali } from '../motor-sinyali';
import { GOREV_DURDUR_HATASI } from '../../shared/isler-gorunum';
import { tavanKisaMetni } from '../../shared/sohbet-gorunum';
import { uyariSuresi, type SistemUyarisi } from '../../shared/sistem-uyarilari';
import { useIsIzi } from '../is-izi/depo';
import { aktifMi, centikGorunenler } from '../../shared/is-izi';

export type Hal = AdaDurumu['hal'];
/** `yol`: tıklanınca açılacak sayfa (ör. Claude Code bildirimi 'claude#cc-<oturum>'; Görev 28) — "Aç" ana pencereyi oraya götürür.
 *  `acil`: mesaj kullanıcıdan karar bekliyor (Claude Code izni; 0.13): sessiz kalmaz, onay gibi adayı açar. */
export interface Bildirim { tur: 'hatirlatma' | 'mesaj'; baslik: string; metin: string; yol?: string; acil?: boolean }
/** Sırada bekleyen bildirim. `soz`: Fuber'in araya girmesi (asistan:soyle) — tıklanınca kart olur, ayara göre sesli okunur. */
export interface AdaBildirimi extends Bildirim {
  no: number;
  zaman: number;
  soz: boolean;
  /** Kart açık (hap değil). */
  acik: boolean;
  /** Göründükten sonra ne kadar kalır (ms). */
  sure: number;
  sesli: boolean;
  /** Tam ekran kapısındaki kaynağı: hatırlatma film/sunum sırasında da iner, Fuber'in mesajı bekler. */
  kaynak: 'hatirlatma' | 'fuber';
  /** Fuber'in kendi sözü (0.13): adayı açmaz, noktada bekler; hapına tıklanınca olağan bildirim olur. */
  sessiz: boolean;
}

/** Görev hapındaki Durdur hatası hapta bu kadar kalır (ms). */
const GOREV_HATA_MS = 5000;
const SURE = { bildirim: 45_000, yanit: 30_000, konusmaSonu: 20_000, soz: 15_000, mesgul: 8_000, bos: 6_000, odaksizSor: 30_000 };
/** A2: boştaki motorsuz hapın üstünde bu kadar durunca tam kart açılır (üst kenardan geçen imleç kartı açmasın). */
const MOTOR_UZERINE_MS = 400;
/** A2: üstüne gelinerek ya da tıklanarak açılan motor kartı, imleç çıktıktan bu kadar sonra hapa çekilir. */
const MOTOR_CIKIS_MS = 1200;
/** Geri çekilme (şekil üst kenara toplanır) bu kadar sürer; sonra pencere gizlenir. ada.css ile aynı. */
const CEKILME_MS = 240;
/** Dışarıdan gizlenen ada, sırada görülmemiş bildirim varsa bu kadar sonra yeniden iner (gizleme hareketiyle çakışmasın). */
const YENIDEN_INIS_MS = 1500;
/** Ada boş mu (geri çekilebilir): gösterecek iş yok ve kullanıcı soru kutusunu açmamış. Hover iş değildir (selam, hover'la görünen sessiz mesaj): imleç altında
 *  yanıtlanan onaydan sonra sırada sessiz mesaj olsa da ada boştur; yoksa geri çekilmez, boş çentik ekranda kalırdı. */
const bosMu = (d: AdaDurumu) => !d.sorAcik && !d.panelAcik && ['dinlenme', 'sessiz', 'uyari', 'motor-durdu', 'motor-hap'].includes(adaHaliBul({ ...d, hover: false }));
/** Adayı açık tutan bildirimler: Fuber'in sessiz sözü sayılmaz (geri çekilmeyi tutmaz, adayı yeniden indirmez). */
const acikBildirimler = (l: readonly AdaBildirimi[]) => l.filter((b) => !b.sessiz);
/** 0.14 T23: paneldeki yazı alanı (Asistan) şu an klavye odağında mı — pencere odaklı ve odak o alanda. */
const yaziOdaktaMi = (): boolean => typeof document !== 'undefined' && document.hasFocus() && Boolean(document.activeElement?.matches?.('[data-panel-yazi]'));

export function useAsistan() {
  const [hal, setHal] = useState<Hal>('bos');
  const [soru, setSoru] = useState('');
  const [yanit, setYanit] = useState('');
  /** Süren yanıtın karakter adı ('basladi' olayından; tur başında kilitlenir). Boşsa ada ad göstermez. */
  const [karakter, setKarakter] = useState('');
  const [araclar, setAraclar] = useState<AracBlok[]>([]);
  const [kartlar, setKartlar] = useState<KartVerisi[]>([]); // 0.11 G6: yapay zekânın kartları (ada kısaltılmış gösterir)
  const [onaylar, setOnaylar] = useState<OnayIstegi[]>([]);
  const [bildirimler, setBildirimler] = useState<AdaBildirimi[]>([]);
  const [seviyeler, setSeviyeler] = useState<number[]>(Array(24).fill(0));
  const [hata, setHata] = useState('');
  /** Dikte satırı düşmüş yerel kurulumu söylüyorsa (İş kipi) o satır: yalnız `hata` hâlâ BU satırsa "Yeniden dene" görünür (başka hata gelince kendiliğinden kalkar). */
  const [yenidenSatiri, setYenidenSatiri] = useState('');
  const [ekranda, setEkranda] = useState(false);
  // 0.11 G10: yapay zekâ adımı şu an süren görev (ana süreç `ada:gorev` ile söyler; shared/ada.ts hal kuralı hapı seçer). Hap: "Görev: <başlık>" + Durdur.
  const [gorev, setGorev] = useState<AdaDurumu['gorev']>(null);
  // 0.14 T13 (R13): 8 sn'yi ya da 3 adımı aşan sohbet turu (ana süreç `ada:calisiyor` ile söyler); görev hapıyla çizilir: "Çalışıyor · N. adım · …" + Durdur.
  const [calisiyor, setCalisiyor] = useState<AdaDurumu['calisiyor']>(null);
  /** 0.14 T22: çentikteki sistem uyarısı (ana süreç 'ada:uyari'); tek atımlık süreyle kalkar. */
  const [uyari, setUyari] = useState<SistemUyarisi | null>(null);
  const uyariZaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Görev hapındaki Durdur IPC'si düştüyse hapta gösterilen tek satır (kısa süre); imleç Durdur'un üstünde mi (hap altından kalkarsa ana sürece haber). */
  const [gorevHatasi, setGorevHatasi] = useState('');
  const gorevHatasiZaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durdurUstunde = useRef(false);
  const [sorAcik, setSorAcik] = useState(false);
  /** 0.14 T23: panel tıklamayla ya da 'ada:sayfa' ile sabitlendi (imleç çıkınca da kalır; kurala bakınız panelKapanirMi). */
  const [panelAcik, setPanelAcik] = useState(false);
  /** Panelin gösterdiği sayfa (açık sayfalardan; kapanınca korunur, pencere gizlenince Asistan'a döner). */
  const [sayfa, setSayfa] = useState<SayfaKimligi>('asistan');
  /** Görünüm → "Çentik sayfaları" (gorunum.centikSayfalari; doğrulama shared/centik-sayfalar.ts). */
  const [sayfaAyari, setSayfaAyari] = useState<unknown>(undefined);
  /** Tıklamanın şapka dönüşü: her tıklamada `no` artar, `an` tıklama anıdır (Asistan taze tıklamayı takıldıktan sonra tetik olarak verir; düzeltme turu 1) —
   *  svg'nin kendi pointerdown'u değil (T3 notu; o dinleyici panelde kapalı: disTiklama). */
  const [sapka, setSapka] = useState({ no: 0, an: 0 });
  /** Son biten yanıt (Asistan sayfasında iki satır): sohbet temizlense de kalır, pencere gizlenince düşmez. */
  const [sonYanit, setSonYanit] = useState('');
  // Motor hâli TEK sinyalden (Ruling K/O; renderer/motor-sinyali.ts): kokpit hapı, sohbet şeridi ve Hesap ekranıyla aynı kural ve aynı
  // ayarlar ('ayarlar:degisti' + ana süreçteki 'motor:durum'). Sinyal gelene dek "durdu" denmez (yanlış bir kare inmesin).
  const sinyal = useMotorSinyali();
  // 0.10 Görev 2: adanın motor hâli (shared/motor-durumu.ts adaMotoru): yerel model yanıtlıyorsa (hesap onay beklerken de) 'yerel'.
  const motor: MotorGorunumu = sinyal.hazir ? adaMotoru(sinyal.gorunum, sinyal.motor) : 'hazir';
  /** Boşta hap gösterilen (kırmızı) hâl: hapa çekilme yalnız bunda (hiç bağlanmamışken ada sessiz). */
  const motorHapi = motorHapiVarMi(motor);
  /** Motor kartının metni ve düğmeleri için (shared/motor-durumu.ts motorBildirimi). */
  // H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçiliyken adanın kartı da kendi cümlesini söyler (Gizli'ninkini değil; yüzdeyle).
  const motorBilgi: { mod: Mod; hesapDurumu: HesapDurumu | null; gizli: boolean; yarim: boolean; yalnizYerel: boolean; yuzde: number | null } = {
    mod: sinyal.mod, hesapDurumu: sinyal.hesapDurumu, gizli: sinyal.gizli, yarim: Boolean(sinyal.motor.yarim), yalnizYerel: yalnizYerelSecili(sinyal.motor), yuzde: sinyal.motor.yerelYuzde ?? null,
  };
  /** Mikrofon tamamen kapalı (sol menü / Ayarlar → Ses): dinlemeye başlanmaz, "Sesle sor" düğmeleri görünmez, yazı alanı açılır. */
  const [mikrofonKapali, setMikrofonKapali] = useState(false);
  const mikrofonKapaliRef = useRef(false);
  mikrofonKapaliRef.current = mikrofonKapali;
  const [centik, setCentik] = useState(false);
  /** 0.14 T19 (R15): çentik ölçeği (ana süreç 'ada:olcek'; ekranın DIP enine göre 1 / 1,12 / 1,25). Ada.tsx kökte CSS zoom olarak uygular. */
  const [olcek, setOlcek] = useState(1);
  /** 0.14 T19 (R16): Görünüm → "Az hareket" (gorunum.azHareket). Windows'un animasyon tercihi Ada.tsx'te ayrıca izlenir. */
  const [azHareketAyar, setAzHareketAyar] = useState(false);
  /** Şekil üst kenara toplanmış: pencere gizliyken ve geri çekilirken. Pencere görünür olunca yaylanarak iner. */
  const [cekik, setCekik] = useState(true);
  const [bildirimKonusuyor, setBildirimKonusuyor] = useState(false);
  /** Fuber'in sesi şu an çalıyor (yanıt): model hâlâ yazarken de — "Sustur" görünür. */
  const [konusuyor, setKonusuyor] = useState(false);
  /** Soru kutusundaki yazı (ada gizlenince silinir: bir sonraki açılışta eski taslak görünmesin). */
  const [taslak, setTaslak] = useState('');
  /** Görev 26: taslak varken "Hatırlatıcı · …" çipine basıldı — hatırlatıcı kartı kapanınca soru kutusu taslakla geri açılır. */
  const taslagaDon = useRef(false);
  /** A2 (son düzeltme; 0.10 Görev 2): boşta + bağlantı koptu ada küçük haptır ("Bağlantı koptu"; hiç bağlanmamışken hap yok, ada sessiz);
   *  tam kart yalnız üstüne gelince, tıklayınca ya da kısayolla (soru kutusu) açılır. 0.13: oturumun ilk kartı kalktı, 440 px kart kendiliğinden hiç inmez. Ada
   *  gizlenince (Alt+Tab, uygulama öne geldi) hapa çekilir. */
  const [motorKart, setMotorKart] = useState(false);
  const motorKartZaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motorUzerineZaman = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gorunur = useRef(false); // pencere ekranda mı (ana süreç 'ada:gorunur' ile söyler; Page Visibility burada işe yaramıyor)
  const gorunurOlayi = useRef(false); // ilk 'ada:gorunur' geldi mi (açılıştaki sorudan daha yeni bilgi)
  const yenidenZaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anaId = useRef<number | null>(null);
  const turBizim = useRef(false); // akan tur adanın başlattığı mı
  const sesliSoruldu = useRef(false);
  const dinlemeIptal = useRef(false); // kullanıcı dinlerken kapattı: bu dinlemenin gerisi (metin) yok sayılır
  /** 0.14 T23 (T22'den devralınan hatanın kökü): her dinleme ve her temizlik nesli artırır. Pencere gizlenip temizlendikten SONRA dönen eski dinlemenin sonucu
   *  (ör. yazıya çevirme yolu yok: "Şu an yazıya çevrilemiyor…") yazılmaz — yazılsaydı gizli adada yanıt hâli kalır, arkasında inen hatırlatıcı hiç görünmez,
   *  görülmemiş sayılıp ada gizlenince yeniden inerdi. (dinlemeIptal yetmez: temizlik anında hâl henüz 'dinliyor' çizilmemiş olabilir.) */
  const dinlemeNesli = useRef(0);
  /** Kulaktan (ana süreç, 'asistan:ses') akan dinlemenin nesli: 'uyandi' ve dinlemeyiBaslat kurar. Temizlikten sonra gelen geç metin/hata/seviye yok sayılır. */
  const sesNesli = useRef(0);
  const uzerinde = useRef(false);
  /** İmleç sessiz çentikte durdu (0.13; görünümün gecikmeli hâli — `uzerinde` anlıktır) ve bekleyen geçiş. */
  const [hover, setHover] = useState(false);
  const hoverZaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tam ekran sürüyor (ana süreç 'ada:tam-ekran'): hover hiçbir şey açmaz. */
  const [tamEkran, setTamEkran] = useState(false);
  const gizleZaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sonSure = useRef(0);
  const bekleyenSure = useRef(0); // imleç üstündeyken duran süre; çıkınca yeniden başlar
  const cekilZaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ana süreç şekli toplattı ('ada:cekil'; ardından pencere gizlenecek ya da odak bırakılacak): bekleyen "yeniden in" (geri çekilme
   *  sonrası 120 ms, gösterim sonrası iki kare) şekli AÇMAZ — yoksa ada inip yarıda gizlenirdi (titreme). Yeni iş ya da gizlenme kaldırır. */
  const cekikKilit = useRef(false);
  /** Süren elle yakalamayı (kendinDinle) bitiren düğme: mikrofon kapatılınca kayıt hemen biter. */
  const yakalama = useRef<{ durdur?: () => void }>({});
  const yanitRef = useRef('');
  const aracSonrasi = useRef(false);
  /** Süren konuşma (yanıt ya da Fuber'in sözü); pencerede tek. */
  const konusmaRef = useRef<FuberKonusmasi | null>(null);
  /** Sesli sorunun yanıtı (I5: araç öncesi metin söylenmez; shared/sesli-yanit.ts). konusmaRef her an onun güncel konuşmasıdır. */
  const yanitSesi = useRef<SesliYanit<FuberKonusmasi> | null>(null);
  /** Süren turun kipi ('basladi' olayından; tur başında kilitlenir): araç sonrası yeniden açılan konuşma da turun karakteriyle söyler. */
  const turKipi = useRef<KipKimligi | undefined>(undefined);
  const konusmaNo = useRef(0); // sesiKes() artırır: geç gelen olaylar eski konuşmaya dokunmasın
  const bildirimNo = useRef(0);
  const gosterilen = useRef(new Set<number>()); // en az bir kez görünmüş bildirimler (pencere gizlenince düşer)
  const konusulan = useRef(new Set<number>()); // sesli okunmuş Fuber sözleri (bir kez okunur)
  const onaySohbeti = useRef(new Map<string, number>());

  const icerikVar = Boolean(yanit || araclar.length || kartlar.length || hata);
  /** 0.14 T25: bilgisayarda medya çalıyor (ana süreç 'ada:medya'; R13 Kapalı hap ve panelin medya çubukları). Duraklamış oturum sayılmaz. */
  const medya = medyaCaliyor(useMedya());
  // İş izi (11 Kas): çentiğin iş hapı ve listesi ana sürecin tek iş listesinden (main/is-izi.ts; olayla, yoklama yok).
  const isListesi = useIsIzi();
  const centikIsleri = centikGorunenler(isListesi);
  const adaDurumu: AdaDurumu = {
    // Akan yanıt: model hâlâ yazarken de ilk sözcükle birlikte yanıt görünür; "Düşünüyorum…" yalnız ilk sözden önce.
    hal: hal === 'dusunuyor' && icerikVar ? 'bos' : hal,
    onaySayisi: onaylar.length,
    bildirimVar: bildirimler.length > 0,
    kartAcik: Boolean(bildirimler[0]?.acik),
    yanitVar: icerikVar,
    sorAcik,
    ekranda,
    gorev,
    calisiyor,
    uyari,
    motor,
    motorKartAcik: motorKart,
    yaziyor: Boolean(taslak.trim()), // B10: yazılan soru kutusunu gelen onay/bildirim örtmez
    hover,
    panelAcik,
    tamEkran,
    medya,
    isler: centikIsleri.length,
    islerAktif: centikIsleri.filter((x) => aktifMi(x.hal)).length,
    // Görev 28 düzeltme 3: baştaki bildirimin türü (hatırlatıcı acil; sırada hep önde — bildirimSiraya). 0.13: Fuber'in sözü noktada bekler.
    ...(bildirimler[0] ? { bildirimTuru: bildirimler[0].kaynak === 'hatirlatma' ? 'hatirlatma' as const : 'bilgi' as const, bildirimSessiz: bildirimler[0].sessiz } : {}),
  };
  const gorunen = adaHaliBul(adaDurumu);
  // Zamanlayıcı ve olay geri çağrıları eski kapanışlardan çalışır: güncel durumu buradan okur.
  const durum = useRef({ adaDurumu, bildirimler, hal, bildirimKonusuyor, onaylar, taslak, mod: motorBilgi.mod });
  durum.current = { adaDurumu, bildirimler, hal, bildirimKonusuyor, onaylar, taslak, mod: motorBilgi.mod };
  // Görev hapı bir onay/bildirim hapının altında kaldı: Durdur düğmesi `mouseleave` olmadan söküldü — "Durdur üstünde" bayrağı düşer, ana süreç haberdar olur
  // (ekran kontrolü sürerken pencere üst ortada Durdur'un yerini yakalamaya devam etmesin). G10 düzeltme turu 2 (kapsam dışı gözlem).
  useEffect(() => {
    if (!durdurSokuldu(gorunen, durdurUstunde.current)) return;
    durdurUstunde.current = false;
    void Promise.resolve(cagir('ada:fare', uzerinde.current, false)).catch(() => undefined);
  }, [gorunen]);

  // ── Ses (Fuber'in tek sesi; renderer/fuber-sesi.ts) ──
  /** Konuşmayı hemen keser (gizli pencerede ses çalmaya devam etmesin; kulak da sağır kalmasın). */
  const sesiKes = () => {
    konusmaNo.current++;
    sesliSoruldu.current = false;
    yanitSesi.current = null; // I5: kesilen yanıtın araç sonrası metni konuşmayı yeniden açmasın
    const k = konusmaRef.current;
    konusmaRef.current = null;
    k?.kes();
    setKonusuyor(false);
    setHal((h) => (h === 'konusuyor' ? 'bos' : h));
    setBildirimKonusuyor(false);
    if (!k) void cagir('kulak:devam');
  };

  /** Konuşmayı adanın durumuna bağlar: ilk ses çıkınca "konuşuyor" (Sustur görünür), bitince `bitince(sonuç)`. Kesilen konuşmanın
   *  sonucu yok sayılır (kesen yönetir). */
  const konusmaBagla = (k: FuberKonusmasi, tur: 'yanit' | 'bildirim', bitince: (s: 'bitti' | 'yok' | 'hata') => void) => {
    const no = konusmaNo.current;
    konusmaRef.current = k;
    void k.basladi.then(() => { if (konusmaRef.current === k) (tur === 'yanit' ? setKonusuyor(true) : setBildirimKonusuyor(true)); });
    void k.sonuc.then((s) => {
      if (konusmaRef.current === k) konusmaRef.current = null;
      if (tur === 'yanit') setKonusuyor(false); else setBildirimKonusuyor(false);
      if (s === 'kesildi' || no !== konusmaNo.current) return;
      bitince(s);
    });
  };

  /** Sessiz düşüş yok (0.13): yanıtın sesi düştü ya da karakterin sesi yerine başka ses çalıyor; tek satır yanıtın altında kalır (dikte uyarısı varsa yanına eklenir). */
  const sesSatiri = (m: string) => setHata((h) => (h && h !== m ? `${h} ${m}` : m));

  /** Fuber'in sözü (eşlikçi, seslenme yanıtı) sesli: söylenir; bitince (ya da ses yoksa) süresi başlar. */
  const bildirimiSoyle = (b: AdaBildirimi) => {
    konusmaRef.current?.kes();
    konusmaBagla(fuberSoyle(b.metin, 'bildirim'), 'bildirim', (s) => gizleSonra(s === 'bitti' ? SURE.konusmaSonu : b.sure));
  };

  // ── Gizleme süresi ve geri çekilme ──
  /** Bekleyen süre (ve imleç üstündeyken duran süre) iptal: görünen iş değişti, eski süre yenisini kapatmasın. */
  const gizleIptal = () => {
    bekleyenSure.current = 0;
    if (gizleZaman.current) { clearTimeout(gizleZaman.current); gizleZaman.current = null; }
  };
  const gizleSonra = (ms: number) => {
    gizleIptal();
    sonSure.current = ms;
    gizleZaman.current = setTimeout(() => zamanDoldu(ms), ms);
  };

  /** Süre doldu: görünen iş kalkar; sırada bildirim varsa o gelir (süresi göründüğünde başlar), yoksa ada geri çekilir. */
  const zamanDoldu = (ms: number) => {
    gizleZaman.current = null;
    if (uzerinde.current) { bekleyenSure.current = ms; return; } // okuyor: imleç çıkınca süre yeniden başlar
    const d = durum.current;
    if (d.adaDurumu.ekranda) { gizleSonra(ms); return; } // Fuber ekranı kullanıyor: ada "ekranda"; süre kontrol bitince işler
    const g = adaHaliBul(d.adaDurumu);
    if (g === 'bildirim' || g === 'kart') { bildirimiKaldir(); return; }
    // Canlı iş sürüyor ya da kullanıcı soru kutusunu açtı (yazıyor olabilir): ada açık kalır.
    if (g === 'onay' || g === 'dinliyor' || g === 'dusunuyor' || g === 'sor') return;
    if (g === 'yanit') sohbetiTemizle();
    setSorAcik(false);
    if (!acikBildirimler(d.bildirimler).length) geriCekil();
  };

  // ── A2: boşta + motorsuz hap ve tam kart ──
  const motorZamanlariniIptal = () => {
    if (motorKartZaman.current) { clearTimeout(motorKartZaman.current); motorKartZaman.current = null; }
    if (motorUzerineZaman.current) { clearTimeout(motorUzerineZaman.current); motorUzerineZaman.current = null; }
  };
  /** Kart hapa çekilir. */
  const motorKartiKapat = () => { motorZamanlariniIptal(); setMotorKart(false); };
  /** `ms` sonra kart hapa çekilir; imleç üstündeyse çekilmez (çıkınca yeniden kurulur: fare). */
  const motorKartiKapatSonra = (ms: number) => {
    if (motorKartZaman.current) clearTimeout(motorKartZaman.current);
    motorKartZaman.current = setTimeout(() => { motorKartZaman.current = null; if (!uzerinde.current) motorKartiKapat(); }, ms);
  };
  /** Hapa tıklandı ya da üstünde durdu: tam kart açılır (imleç çıkınca kısa süre sonra hapa döner). */
  const motorKartiAc = () => { motorZamanlariniIptal(); setMotorKart(true); };

  const cekilmeyiIptal = () => {
    if (cekilZaman.current) { clearTimeout(cekilZaman.current); cekilZaman.current = null; }
    cekikKilit.current = false; // yeni iş: şekil yeniden iner
    if (gorunur.current) setCekik(false);
  };

  /** Şekli üst kenara toplar, sonra pencereyi gizler. Pencere gizlenmezse (ör. ada sessizken de görünür) sessiz hal yeniden iner. */
  const geriCekil = () => {
    gizleIptal();
    if (cekilZaman.current) return;
    setCekik(true);
    cekilZaman.current = setTimeout(() => {
      // true: şekil zaten toplandı — ana süreç odağı bırakmak için beklemeden gizleyip odaksız gösterebilir.
      void cagir('asistan:gizle', true).catch(() => undefined).finally(() => {
        cekilZaman.current = null;
        temizle();
        setTimeout(() => { if (gorunur.current && !cekilZaman.current && !cekikKilit.current) setCekik(false); }, 120);
      });
    }, CEKILME_MS);
  };

  /** Pencere gizlendi ya da ada çekildi: yarım kalan sohbet, soru kutusu ve görülmüş bildirimler kalkar (onaylar kalır). */
  const temizle = () => {
    gizleIptal();
    const h = durum.current.hal;
    if (h === 'dinliyor' || h === 'yaziya') dinlemeIptal.current = true;
    dinlemeNesli.current++; // süren dinlemenin geç gelen sonucu yok sayılır
    yakalama.current.durdur?.(); // süren elle kayıt hemen biter: gizli pencerede mikrofon açık kalmaz (düzeltme turu 1)
    sesiKes();
    sohbetiTemizle();
    setHal('bos');
    setSorAcik(false);
    setPanelAcik(false);
    setSayfa('asistan');
    setTaslak('');
    taslagaDon.current = false;
    setBildirimler((l) => l.filter((b) => !gosterilen.current.has(b.no)));
    // Şekil toplanıyor/pencere gizlendi: imleç artık şeklin (ve Durdur'un) üstünde sayılmaz — ana sürece de SÖYLENİR (G10 düzeltme turu 2, N1). Söylenmezse, hap
    // altından kalkarken giden gecikmiş `ada:fare(true, false)` ana süreçte yakalamayı yeniden kurar ve `mouseleave` bir daha gelmez (yukarıdaki eşitlik koruması).
    // IPC sırası korunur: gecikmiş true'dan SONRA bu false gelir, son durum "yakalama yok".
    const fareVardi = uzerinde.current || durdurUstunde.current;
    uzerinde.current = false;
    durdurUstunde.current = false;
    hoverSifirla();
    if (fareVardi) void Promise.resolve(cagir('ada:fare', false, false)).catch(() => undefined);
    bekleyenSure.current = 0;
    setCekik(true);
    // A2: ada gizlenince (Alt+Tab, uygulama öne geldi, geri çekildi) kart hapa döner: bir sonraki inişte 440 px kart değil küçük hap.
    motorKartiKapat();
    uyariKaldir(); // 0.14 T22: anlık hap gizli pencerede beklemez
  };

  /** Sistem uyarısı kalkar (süresi doldu ya da pencere gizlendi). */
  const uyariKaldir = () => {
    if (uyariZaman.current) { clearTimeout(uyariZaman.current); uyariZaman.current = null; }
    setUyari(null);
  };

  const sohbetiTemizle = () => {
    turBizim.current = false;
    sesliSoruldu.current = false;
    setSoru(''); setYanit(''); setKarakter(''); yanitRef.current = ''; setAraclar([]); setKartlar([]); setHata('');
    setHal((h) => (h === 'dusunuyor' || h === 'yaziya' || h === 'konusuyor' ? 'bos' : h));
  };

  // ── Bildirimler ──
  const bildirimEkle = (b: Omit<AdaBildirimi, 'no' | 'zaman'>) => {
    if (!b.sessiz) cekilmeyiIptal(); // sessiz söz süren geri çekilmeyi durdurmaz: yalnız noktaya yazılır
    // Düzeltme 3: hatırlatıcı acil olmayanların önüne geçer; BOŞ soru kutusu açıkken geldiyse kutu kapanır, hatırlatıcı iner (yazı
    // varken kutu kalır, hatırlatıcı kutuda kendi çipiyle görünür — "Bildirim var"a gömülmez).
    if (b.kaynak === 'hatirlatma' && hatirlatmaKutuyuKapatirMi(durum.current.adaDurumu)) { setSorAcik(false); setPanelAcik(false); }
    setBildirimler((l) => bildirimSiraya(l, { ...b, no: ++bildirimNo.current, zaman: Date.now() }));
  };
  /** Soru kutusundaki "Hatırlatıcı · …" çipi: kutu kapanır, hatırlatıcının kartı açılır (sırada baştadır). Kutuda yazı varsa
   *  (Görev 26) kart kapanınca kutu aynı taslakla geri gelir — eskiden kart kalkınca ada geri çekiliyor, taslak siliniyordu. */
  const hatirlatmayiAc = () => {
    if (durum.current.taslak.trim()) taslagaDon.current = true;
    setSorAcik(false);
    setBildirimler((l) => {
      const i = l.findIndex((x) => x.kaynak === 'hatirlatma');
      return i < 0 ? l : [{ ...l[i], acik: true }, ...l.slice(0, i), ...l.slice(i + 1)];
    });
  };

  /** Baştaki bildirim kalkar; sırada başkası varsa o görünür, kalmadıysa ve başka iş yoksa ada geri çekilir. */
  const bildirimiKaldir = () => {
    const d = durum.current;
    const bas = d.bildirimler[0];
    if (!bas) return;
    if (d.bildirimKonusuyor || bas.sesli) sesiKes(); // `bildirimKonusuyor` ilk sesi bekler: ondan önce kapatılan sesli mesajın sesi ekransız kalmasın
    setBildirimler((l) => l.filter((b) => b.no !== bas.no));
    // Görev 26: kutudaki taslaktan çiple açılan hatırlatıcı kapandı → kutu taslakla geri gelir (ada çekilmez, taslak silinmez).
    if (taslagaDon.current && bas.kaynak === 'hatirlatma') {
      taslagaDon.current = false;
      if (d.taslak.trim()) { sorAc(); return; }
    }
    if (!acikBildirimler(d.bildirimler.slice(1)).length && bosMu({ ...d.adaDurumu, bildirimVar: false, kartAcik: false })) geriCekil();
  };

  // Sessiz mesaj noktada sonsuza dek beklemez: kuyruktaki Fuber olayıyla aynı ömür (süresi dolan nokta kalkar, mesaj sohbette durur).
  useEffect(() => {
    const ilk = bildirimler.find((b) => b.sessiz);
    if (!ilk) return;
    const z = setTimeout(() => setBildirimler((l) => l.filter((b) => !b.sessiz || sessizMesajTaze(b.zaman, Date.now()))), Math.max(0, ilk.zaman + FUBER_OLAYI_OMRU_MS - Date.now()) + 1);
    return () => clearTimeout(z);
  }, [bildirimler]);

  // Düzeltme 3 (F2): adada hatırlatıcı var mı — ana süreç kısayol kararında kullanır (hatırlatıcı acil: kısayol kapatır). Hatırlatıcı
  // kalkınca (başka bildirim adayı açık tutsa da) false bildirilir; eskiden bayrak iş bitene dek true kalıyordu.
  const hatirlatmaVar = bildirimler.some((x) => x.kaynak === 'hatirlatma');
  useEffect(() => { void cagir('ada:hatirlatma', hatirlatmaVar).catch(() => undefined); }, [hatirlatmaVar]);

  const bas = bildirimler[0];
  // Bildirim GÖRÜNDÜĞÜNDE süresi başlar (Fuber sözü sesliyse önce okunur). Konuşma/onay/kontrol bitip bildirim yeniden öne
  // çıkınca süre yeniden kurulur: arkada beklerken süresi dolmaz. Sessiz mesaj hover'la görünürken okunmaz: ses yalnız tıklanınca (kartiAc sessizliği bitirir).
  useEffect(() => {
    if (!bas || cekik || (gorunen !== 'bildirim' && gorunen !== 'kart')) return;
    gosterilen.current.add(bas.no);
    if (bas.sesli && !bas.sessiz && !konusulan.current.has(bas.no)) {
      konusulan.current.add(bas.no);
      gizleIptal();
      sesliSoruldu.current = false;
      bildirimiSoyle(bas);
      return;
    }
    if (!durum.current.bildirimKonusuyor) gizleSonra(bas.sure);
  }, [bas?.no, gorunen, cekik]);

  // A2: araya başka iş girdi (bildirim, onay, dinleme, yanıt): motor kartı kapanır, iş bitince ada hap olarak kalır.
  useEffect(() => {
    if (motorHapi && motorKart && gorunen !== 'motor-durdu' && gorunen !== 'motor-hap') motorKartiKapat();
  }, [gorunen, motorHapi]);

  // Ada doluyken BOŞALDI (gösterecek iş kalmadı): ana süreç adayı boşta saysın (ada.ts adaBos) — kısayol onu kapatmak yerine açar,
  // sessiz ada yoklaması tam ekranda onu çekebilir. Yalnız geçişte ve pencere görünürken; zaman damgası, arada ana süreç adayı yeniden
  // gösterdiyse (yeni iş yolda) bu bildirimi bayat kılar. Pencereyi gizlemez: geri çekilme ayrı (ve boştaki sessiz adayı çekmek YOK).
  const bos = bosMu(adaDurumu);
  const oncekiBos = useRef(true);
  useEffect(() => {
    const once = oncekiBos.current;
    oncekiBos.current = bos;
    if (bos && !once && gorunur.current) void cagir('ada:bos', Date.now()).catch(() => undefined);
  }, [bos]);

  // Soru kutusu kullanıcınındır (süre dolunca kapanmaz) — ama hiç klavye odağı almadan açık kalan BOŞ kutuya Esc ve odak kaybı ulaşmaz:
  // 30 sn sonra pencere hâlâ odakta değilse ve yazı yoksa kutu kapanır (ada geri çekilir). Odak alıp sonra kaybeden kutuyu zaten
  // odak kaybı kapatır (Ada.tsx). Odağı ana süreçten sorar: sayfanın kendi bildiği odak, test aracının odak öykünmesiyle şaşabilir.
  useEffect(() => {
    if (!sorAcik) return;
    const z = setTimeout(() => {
      void cagir<boolean>('ada:odakta-mi').catch(() => false).then((odakta) => {
        const d = durum.current;
        if (odakta || d.taslak.trim() || !d.adaDurumu.sorAcik || !['sor', 'motor-durdu'].includes(adaHaliBul(d.adaDurumu))) return;
        kapat();
      });
    }, SURE.odaksizSor);
    return () => clearTimeout(z);
  }, [sorAcik]);

  // ── Sohbet ──
  const seviyeEkle = (v: number) => setSeviyeler((s) => [...s.slice(1), v]);

  /** Ana sohbetteki bir turu ada üstlenir: soru görünür, yanıt akar; sesliyse model yazdıkça cümle cümle konuşulur. `uyari`: soru
   *  anlaşıldı ama yazıya çevirme motoru düştü (cihazdaki tanımayla; düzeltme 6) — yanıtın altında tek satır kalır. */
  const turuAc = (m: string, sesli: boolean, uyari?: string) => {
    gizleIptal();
    cekilmeyiIptal();
    sesiKes(); // önceki konuşma susar (tek ses)
    setSoru(m); setYanit(''); setKarakter(''); yanitRef.current = ''; setAraclar([]); setKartlar([]); setHata(uyari ?? ''); setSorAcik(false); setPanelAcik(false);
    turKipi.current = undefined; // yeni tur: 'basladi' gelene dek ana süreç şu anki kipe bakar
    sesliSoruldu.current = sesli;
    turBizim.current = true;
    aracSonrasi.current = false;
    setHal('dusunuyor');
    // Sesle soruldu: konuşma ŞİMDİ açılır (ana süreç ElevenLabs bağlantısını ısıtır); model yazdıkça cümle cümle konuşulur. Süre, tur
    // sürerken kurulmaz (yanıt yazılırken ada kapanmasın): tur bittiyse konuşma bitince başlar.
    // I5: araçtan önce yazılan metin söylenmez — model araca geçince o adımın sesi kesilir, konuşma yeniden açılır (shared/sesli-yanit.ts).
    if (sesli) {
      yanitSesi.current = new SesliYanit(() => {
        const k = fuberKonus('yanit', turKipi.current, sesSatiri);
        konusmaBagla(k, 'yanit', (s) => { if (!turBizim.current) gizleSonra(s === 'bitti' ? SURE.konusmaSonu : SURE.yanit); });
        return k;
      }, { tembel: true }); // ilk konuşma 'basladi'da, turun kilitli kipiyle açılır (aşağıda)
    }
  };

  const gonder = async (m: string, sesli: boolean, uyari?: string) => {
    if (!m.trim()) return;
    if (anaId.current == null) anaId.current = await cagir<number>('sohbet:ana');
    turuAc(m, sesli, uyari);
    // false = ana sohbette başka yanıt sürüyor; mesaj alınmadı → "Düşünüyorum…"da takılı kalma.
    const alindi = await cagir<boolean>('sohbet:gonder', anaId.current, m, undefined, sesli ? 'ses' : 'kullanici').catch(() => false);
    if (!alindi) { turBizim.current = false; sesiKes(); setHal('bos'); setHata(MESGUL_MESAJI); gizleSonra(SURE.mesgul); }
  };

  // Kulak yoksa (uyandırma kapalı) elle dinleme: ses konuşurken ana sürece akar (hesabın canlı Scribe'ı ya da Whisper; Görev 21).
  const kendinDinle = async (nesil: number) => {
    // Önce yazıya çevirecek yol (hesap ya da Whisper); yoksa mikrofon hiç açılmaz, tek satır söylenir (0.13: Vosk'a dönülmez; yerel kipte Whisper kurulumu başlar).
    const oturum = await dinlemeAc((m) => setSoru(m)).catch(() => null);
    if (nesil !== dinlemeNesli.current) { oturum?.iptal(); return; } // beklerken pencere gizlendi/temizlendi
    if (!oturum) {
      const d = await dikteYokSatiri();
      if (nesil !== dinlemeNesli.current) return;
      setHal('bos');
      setHata(d.satir);
      setYenidenSatiri(d.yenidenDene ? d.satir : '');
      return;
    }
    let akis: MediaStream;
    try { akis = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { oturum.iptal(); throw e; }
    // İzin beklenirken mikrofon kapatıldı ya da dinleme kapatıldı: kayıt hiç başlamaz.
    // Düzeltme turu 1: izin beklenirken pencere gizlendi (nesil eskidi) — mikrofon hemen kapanır, oturum iptal.
    if (mikrofonKapaliRef.current || dinlemeIptal.current || nesil !== dinlemeNesli.current) { akis.getTracks().forEach((t) => t.stop()); oturum.iptal(); dinlemeIptal.current = false; return; }
    const ctx = new AudioContext();
    const durdurucu: { durdur?: () => void } = {};
    yakalama.current = durdurucu;
    let akitmayiKes = () => undefined as void;
    try {
      const kaynak = ctx.createMediaStreamSource(akis);
      const olc = seviyeOlcer(ctx, kaynak);
      akitmayiKes = ornekAkit(ctx, kaynak, (o, hz) => oturum.besle(o, hz));
      setHal('dinliyor');
      const r = await konusmaYakala(akis, olc, { kaydet: false, seviyeBildir: (v) => seviyeEkle(Math.min(1, v * 9)), durdurucu });
      akitmayiKes();
      if (dinlemeIptal.current || nesil !== dinlemeNesli.current || !r.konustu) { oturum.iptal(); if (dinlemeIptal.current || nesil !== dinlemeNesli.current) dinlemeIptal.current = false; else { setHal('bos'); setSoru(''); } return; }
      setHal('yaziya');
      const s = await oturum.bitir().catch((): { metin: string | null; uyari?: string } => ({ metin: null }));
      if (dinlemeIptal.current || nesil !== dinlemeNesli.current) { dinlemeIptal.current = false; return; }
      // Yazıya çevirme düştü (anahtar/bağlantı; düzeltme 6): "duymadım" diye sessizce kapanmaz — tek satır söylenir.
      if (s.metin) void gonder(s.metin, true, s.uyari);
      else if (s.uyari) { setHal('bos'); setSoru(''); setHata(s.uyari); }
      else { setHal('bos'); setSoru(''); }
    } finally {
      akitmayiKes();
      if (yakalama.current === durdurucu) yakalama.current = {};
      akis.getTracks().forEach((t) => t.stop());
      void ctx.close();
    }
  };

  /** Mikrofon tamamen kapatıldı (sol menü, Ayarlar, telefon): süren dinleme HEMEN biter — elle yakalama durdurulur (izler kapanır,
   *  yazıya çevrilmez, gönderilmez); kulaktaki dinleme zaten kapanan pencereyle gider, ada "Dinliyorum…"da kalmaz. Sakin hal: kısa
   *  açıklama ve "Yazarak sor"; birkaç saniye sonra ada çekilir. */
  const mikrofonuKes = () => {
    const h = durum.current.hal;
    if (h !== 'dinliyor' && h !== 'yaziya') return;
    dinlemeIptal.current = true;
    yakalama.current.durdur?.();
    setSoru('');
    setHal('bos');
    setHata('Mikrofon kapatıldı. Yazarak sorabilirsin.');
    gizleSonra(SURE.bos);
  };

  const dinlemeyiBaslat = async () => {
    // Mikrofon tamamen kapalı: dinleme yok, soru kutusu açılır (ana süreç de izin vermez; bu yalnız arayüzün dürüstlüğü).
    if (mikrofonKapaliRef.current) { sorAc(); return; }
    cekilmeyiIptal();
    gizleIptal();
    dinlemeIptal.current = false;
    sesiKes();
    sohbetiTemizle();
    setSorAcik(false);
    setHal('dinliyor');
    const nesil = ++dinlemeNesli.current;
    sesNesli.current = nesil; // kulak dinlerse olayları bu nesille gelir
    // Mikrofon izni/aygıtı yoksa getUserMedia fırlatır; yakalanmazsa ada "Dinliyorum…"da kalıyordu.
    try {
      const kulakVar = await cagir<boolean>('kulak:dinle');
      if (nesil !== dinlemeNesli.current) return; // beklerken pencere gizlendi
      if (!kulakVar) await kendinDinle(nesil);
    } catch (e) {
      if (mikrofonKapaliRef.current || nesil !== dinlemeNesli.current) return; // izin beklenirken mikrofon kapatıldı: sakin hal zaten kuruldu (mikrofonuKes)
      setHal('bos');
      setHata(`Mikrofon açılamadı: ${(e as Error).message || 'bilinmeyen hata'}`);
    }
  };

  // ── Kullanıcının elindekiler ──
  /** Sustur düğmesi: konuşma kesilir, ada 20 sn sonra çekilir (konuşma kendiliğinden bitmiş gibi). */
  const sustur = () => { sesiKes(); gizleSonra(SURE.konusmaSonu); };

  /**
   * Görüneni kapatır (Esc, "Tamam"): sohbet/dinleme, soru kutusu, onay kartları (ana pencerede yanıtlanabilir kalır) ya da
   * baştaki bildirim. Sırada görünmemiş bildirim varsa o gelir; gösterecek bir şey kalmadıysa ada geri çekilir.
   */
  const kapat = () => {
    const d = durum.current;
    const g = adaHaliBul(d.adaDurumu);
    if (g === 'ekranda') return; // Fuber çalışıyor: durdurmak Alt+Shift+Q'nun işi
    if (g === 'panel') { panelKapat('esc'); return; } // 0.14 T23
    if (g === 'bildirim' || g === 'kart') { bildirimiKaldir(); return; }
    if (g === 'motor-durdu' || g === 'motor-hap') {
      motorKartiKapat(); // A2: kart hapa çekilir
      if (!d.adaDurumu.sorAcik) return; // boştaki kart: ada yerinde hap olarak kalır (kısayolla açılan kart aşağıda geri çekilir)
    }
    let sonraki: AdaDurumu = { ...d.adaDurumu, sorAcik: false };
    if (g === 'onay') { setOnaylar([]); sonraki = { ...sonraki, onaySayisi: 0 }; }
    else if (g === 'dinliyor' || g === 'dusunuyor' || g === 'yanit') {
      if (d.hal === 'dinliyor' || d.hal === 'yaziya') dinlemeIptal.current = true;
      sesiKes();
      sohbetiTemizle();
      setHal('bos');
      sonraki = { ...sonraki, hal: 'bos', yanitVar: false };
    }
    setSorAcik(false);
    if (bosMu(sonraki)) geriCekil();
  };

  const onayla = (id: string, karar: unknown) => {
    void cagir('onay:yanitla', id, karar);
    setOnaylar((x) => x.filter((y) => y.id !== id));
    const d = durum.current.adaDurumu;
    if (bosMu({ ...d, onaySayisi: Math.max(0, d.onaySayisi - 1) })) geriCekil();
  };

  /**
   * Onay kartları dışarıdan kalkar: başka yerde (ana pencere, telefon) yanıtlandı, süresi doldu ya da turu bitti. Kaldırma adayı
   * boşaltırsa ada geri çekilir — onayla()'daki gibi; eskiden kart gidiyor ama ana süreç adayı açık sanıyordu (etkin true kalıyordu).
   * Yalnız gerçekten adadaki bir kart kalktıysa: hiç gösterilmemiş onayın iptali adayı oynatmaz.
   */
  const onaylariKaldir = (kalsin: (o: OnayIstegi) => boolean) => {
    const d = durum.current;
    const kalan = d.onaylar.filter(kalsin).length;
    setOnaylar((x) => x.filter(kalsin));
    if (kalan < d.onaylar.length && bosMu({ ...d.adaDurumu, onaySayisi: kalan })) geriCekil();
  };

  // Soru kutusu açılınca önceki işin süresi (yanıt 30 sn, meşgul 8 sn…) iptal: yazarken ada kapanmasın.
  const sorAc = () => { cekilmeyiIptal(); gizleIptal(); setSorAcik(true); };
  /** Sessiz hale tıklandı: soru kutusu klavye odağıyla açılır (Esc ve odak kaybı çalışsın); ana süreç de adayı açık sayar (kısayol
   *  artık onu kapatır, yeniden açmaz). */
  const sessizdenSor = () => { sorAc(); void cagir('asistan:goster', false, true).catch(() => undefined); };
  /** Yanıttan sonra yeni soru: sohbet temizlenir, soru kutusu açılır. */
  const yeniSoru = () => { gizleIptal(); sesiKes(); sohbetiTemizle(); setHal('bos'); setSorAcik(true); };
  /** Selamın mikrofonu: kısayolla aynı yol (ana süreç adayı kullanıcının işi sayar, sessiz yoklama dinlerken adayı çekmez). */
  const selamdanDinle = () => { void cagir('asistan:goster', true).catch(() => undefined); };
  /** Hapa tıklandı: kullanıcı mesajı açtı — sessiz mesaj da artık olağan bildirimdir: imleç çıkınca kalkmaz (süresi işler), sesliyse şimdi okunur. */
  const kartiAc = () => setBildirimler((l) => (l.length ? [{ ...l[0], acik: true, sessiz: false }, ...l.slice(1)] : l));
  /** Bildirimin "Aç"ı: ana pencere açılır (bildirimin `yol`u varsa o sayfaya/oturuma), bildirim görülmüş sayılıp kalkar. */
  const bildirimiAc = () => { const yol = durum.current.bildirimler[0]?.yol; void cagir('ana:goster', typeof yol === 'string' ? yol : undefined); bildirimiKaldir(); };

  // ── Hover: selam ve noktadaki mesaj (kural: shared/ada.ts adaHaliBul) ──
  const hoverSifirla = () => {
    if (hoverZaman.current) { clearTimeout(hoverZaman.current); hoverZaman.current = null; }
    setHover(false);
  };
  /** İmleç çıktı: hover düşer; hover'la görünmüş sessiz mesaj görülmüş sayılıp kalkar (ada çekilmez: şekil doğrudan sessize döner; sırada başka mesaj varsa nokta kalır).
   *  Kural shared/ada.ts hoverCikinciKalkarMi: imlecin altında başlayan yanıta ve tıklanıp açılan mesaja dokunulmaz. Ses kesilmez: tıklanan söz sürer, Sustur keser. */
  const hoverBitti = () => {
    const d = durum.current;
    const b = d.bildirimler[0];
    const kalkar = hoverCikinciKalkarMi(d.adaDurumu, b) && gosterilen.current.has(b.no);
    setHover(false);
    if (!kalkar) return;
    gizleIptal();
    setBildirimler((l) => l.filter((x) => x.no !== b.no));
  };
  /** Görünüm gecikmeli: girişte HOVER_GECIKME_MS (üst kenardan geçen imleç çentiği oynatmasın), çıkışta noktadaki mesajda HOVER_CIKIS_MS, açık panelde
   *  PANEL_KAPANIS_MS (0.14 T23; yazı alanı odaktaysa panel kalır); geri dönen imleç bekleyen geçişi iptal eder. */
  const hoverKur = (ustunde: boolean) => {
    if (hoverZaman.current) clearTimeout(hoverZaman.current);
    const panelde = adaHaliBul(durum.current.adaDurumu) === 'panel';
    hoverZaman.current = setTimeout(() => {
      hoverZaman.current = null;
      if (ustunde) setHover(true);
      else if (panelde) { if (panelKapanirMi('cikis', { yaziOdakta: yaziOdaktaMi() })) panelKapat('cikis'); }
      else hoverBitti();
    }, ustunde ? HOVER_GECIKME_MS : panelde ? PANEL_KAPANIS_MS : HOVER_CIKIS_MS);
  };

  // ── 0.14 T23: açık panel ──
  /** Panel kapanır (olayın kuralı çağıranda: panelKapanirMi). Hover düşer; tıklamayla sabitlenmiş panel kapanınca gösterecek başka iş yoksa ada geri çekilir
   *  (pencere odağı bırakılır; soru kutusunun kapanışı gibi). Yalnız hover'la açık panel (odaksız) yalnız boşa döner. */
  /** 0.14 T27: sürükleme paneli Raf'a çevirdiyse (surukleHareketi) önceki sayfa panel kapanınca geri gelir; panel hiç açılmadan imleç çıktıysa hemen. */
  const surukleOncesi = useRef<SayfaKimligi | null>(null);
  const surukleSayfasiniBirak = () => { const o = surukleOncesi.current; if (o === null) return; surukleOncesi.current = null; setSayfa(o); };
  const panelKapat = (_o: PanelOlayi) => {
    const d = durum.current;
    const sabit = Boolean(d.adaDurumu.panelAcik);
    if (!sabit && adaHaliBul(d.adaDurumu) !== 'panel') return;
    hoverSifirla();
    surukleSayfasiniBirak();
    setPanelAcik(false);
    if (sabit && bosMu({ ...d.adaDurumu, panelAcik: false, hover: false })) geriCekil();
  };
  /** Paneldeki yazı alanı odağı bıraktı: imleç şeklin dışındaysa panel çıkış kuralıyla kapanır (çıkışta yazı odaktaydı, panel kalmıştı). */
  const panelYaziBirakildi = () => {
    if (uzerinde.current) return;
    setTimeout(() => { if (!uzerinde.current && panelKapanirMi('cikis', { yaziOdakta: yaziOdaktaMi() })) panelKapat('cikis'); }, 0);
  };
  /** Dinlenmeye, Kapalı hapa ya da paneldeki karaktere tıklandı (R13): şapka dönüşü, panel Asistan sayfasıyla sabitlenir, yazı alanı klavye odağı alır (ana süreç
   *  adayı açık sayar: kısayol onu kapatır). */
  const panelTikla = () => {
    cekilmeyiIptal(); gizleIptal();
    setSayfa(PANEL_TIKLAMA.sayfa);
    setSorAcik(false);
    setPanelAcik(true);
    setSapka((s) => ({ no: s.no + 1, an: Date.now() }));
    void cagir('asistan:goster', false, true).catch(() => undefined);
  };
  /** Panelde sayfa değişti (noktalar, oklar, tuşlar, tekerlek) ya da ana süreç açtırdı ('ada:sayfa'): bilinmeyen sayfa yok sayılır. */
  const sayfaSec = (id: SayfaKimligi) => { if (Object.hasOwn(PANEL_SAYFALARI, id)) { surukleOncesi.current = null; setSayfa(id); } };

  /** İmleç adanın şekline girdi/çıktı: ana süreç tıklamayı HEMEN yakalar/geçirir (imleç çıkar çıkmaz alttaki uygulama tıklanır); süre üstündeyken durur. */
  const fare = (ustunde: boolean) => {
    if (ustunde && durum.current.adaDurumu.ekranda) return; // imleci Fuber gezdiriyor: sayılmaz
    if (uzerinde.current === ustunde) return;
    uzerinde.current = ustunde;
    if (!ustunde) surukleYakalama.current = false;
    void cagir('ada:fare', ustunde);
    hoverKur(ustunde);
    if (!ustunde && adaHaliBul(durum.current.adaDurumu) !== 'panel') surukleSayfasiniBirak(); // sürükleme paneli açmadan imleç çıktı (açıksa panel kapanınca döner)
    if (ustunde) {
      if (gizleZaman.current) { gizleIptal(); bekleyenSure.current = sonSure.current; }
    } else if (bekleyenSure.current) {
      const ms = bekleyenSure.current;
      bekleyenSure.current = 0;
      gizleSonra(ms);
    }
    // A2: hapın üstünde kısa süre durunca tam kart açılır; açık kart imleç üstündeyken kapanmaz, çıkınca kısa süre sonra hapa döner.
    const d = durum.current.adaDurumu;
    if (ustunde) {
      if (motorKartZaman.current) { clearTimeout(motorKartZaman.current); motorKartZaman.current = null; }
      if (adaHaliBul(d) === 'motor-hap') {
        motorUzerineZaman.current = setTimeout(() => { motorUzerineZaman.current = null; if (uzerinde.current) motorKartiAc(); }, MOTOR_UZERINE_MS);
      }
    } else {
      if (motorUzerineZaman.current) { clearTimeout(motorUzerineZaman.current); motorUzerineZaman.current = null; }
      if (!d.sorAcik && adaHaliBul(d) === 'motor-durdu') motorKartiKapatSonra(MOTOR_CIKIS_MS);
    }
  };

  /** 0.14 T27 (R21): dışarıdan bir şey (dosya, metin) çentiğe SÜRÜKLENİYOR — Electron'un ilettiği `buttons === 1` fare hareketi şeklin üstüne geldi. Yakalama açılır
   *  (ana süreç `ada:fare(true)`: pencere bırakma hedefi olur), açılan panel Raf sayfasına gider (bırakma alanı). Düğmesi içeride basılmış hareket (yazı seçimi, panelde
   *  sürükleme) sürükleme sayılmaz. Raf kapalıysa yalnız yakalama açılır. */
  const icerdeBasili = useRef(false);
  /** Yakalama BU sürükleme yüzünden mi açıldı (düz hover'ın açtığı yakalamayı `mouseleave` bırakır). Yalnız bu durumda belge düzeyindeki sürükleme olayları yakalamayı bırakır. */
  const surukleYakalama = useRef(false);
  const surukleHareketi = (buttons: number) => {
    if (!buttons) { icerdeBasili.current = false; return; } // düğmesiz hareket: içeride basılı kalmış bayrak (ör. dışarı sürükleme bitti, mouseup gelmedi) düşer
    if (icerdeBasili.current) return;
    if (!surukleFareGonder(buttons, fare)) return;
    // Düğmesi şeklin DIŞINDA basılmış hareket = dışarıdan sürükleme (içeride basılan yukarıda elendi). Gerçek pencerede Chromium önce mouseenter de üretir (yakalamayı o açmış olur):
    // yakalama yine de bu sürüklemeye aittir.
    if (uzerinde.current) surukleYakalama.current = true;
    if (!yaziOdaktaMi() && acikSayfalar(sayfaAyari).includes('raf') && sayfa !== 'raf') { surukleOncesi.current ??= sayfa; setSayfa('raf'); }
  };
  /** I3: sürükleme yüzünden açılan yakalamayı OLAYLA bırakır (şeklin dışında dragover, drop, dragend, pencereden çıkan dragleave; kural shared/raf.ts). `fare(false)` panelin hover'la açıldığı
   *  durumda onu da kapatır (hoverKur → panelKapat; önceki sayfa geri gelir). Zamanlayıcı ve yoklama yok. */
  const surukleBirak = (o: SurukleOlayi) => {
    if (!surukleYakalama.current || !surukleYakalamayiBirakMi(o)) return;
    surukleYakalama.current = false;
    fare(false);
  };
  /** Şeklin içinde fare düğmesi basıldı (bırakılana dek `surukleHareketi` yok sayılır). */
  /** 0.14 çentik cilası: hover 60 ms'ye indi — boştaki çentiğe (dinlenme, Kapalı) basıldıysa bu bir TIKLAMADIR: bekleyen hover paneli açmaz (yoksa düğme basılıyken
   *  katman değişir, bırakınca tıklama hiçbir yere düşmezdi), tıklama panelTikla'ya varır (R13: şapka dönüşü, Asistan sabit). */
  const icerdeBasildi = () => {
    icerdeBasili.current = true;
    const h = adaHaliBul({ ...durum.current.adaDurumu, hover: false });
    if (!durum.current.adaDurumu.hover && (h === 'dinlenme' || h === 'sessiz') && hoverZaman.current) { clearTimeout(hoverZaman.current); hoverZaman.current = null; }
  };

  /** Görev hapındaki Durdur (0.11 G10): görevi durdurur (isler:durdur). Ada çekilmesi adım bitince kendiliğinden olur (ada:gorev null). Güvenlik eylemi
   *  sessiz kalmaz: IPC düşerse hapta tek satır hata (5 sn; ada penceresinde ana pencerenin tost katmanı yok), Durdur yeniden denenebilir kalır. */
  const gorevDurdur = (id: number) => {
    void Promise.resolve(cagir('isler:durdur', id)).catch(() => {
      if (gorevHatasiZaman.current) clearTimeout(gorevHatasiZaman.current);
      setGorevHatasi(GOREV_DURDUR_HATASI);
      gorevHatasiZaman.current = setTimeout(() => { gorevHatasiZaman.current = null; setGorevHatasi(''); }, GOREV_HATA_MS);
    });
  };
  /** Çalışıyor hapındaki Durdur (0.14 T13): sohbetin turunu durdurur (sohbet:durdur; Sohbet'teki Durdur'la aynı). Hap tur bitince kalkar (ada:calisiyor null).
   *  IPC düşerse görev hapıyla aynı tek satır hata. */
  const calisiyorDurdur = (sohbetId: number) => {
    void Promise.resolve(cagir('sohbet:durdur', sohbetId)).catch(() => {
      if (gorevHatasiZaman.current) clearTimeout(gorevHatasiZaman.current);
      setGorevHatasi(GOREV_DURDUR_HATASI);
      gorevHatasiZaman.current = setTimeout(() => { gorevHatasiZaman.current = null; setGorevHatasi(''); }, GOREV_HATA_MS);
    });
  };
  /** İmleç Durdur düğmesinin üstüne girdi/çıktı: ana süreç, Fuber fareyi kullanırken bile BU düğmenin tıklamasını yakalar (Durdur her zaman tıklanır).
   *  Çıkınca şeklin üstündeki genel durum (uzerinde) korunur. */
  const durdurFare = (ustunde: boolean) => {
    durdurUstunde.current = ustunde;
    void Promise.resolve(cagir('ada:fare', ustunde ? true : uzerinde.current, ustunde)).catch(() => undefined);
  };

  useEffect(() => {
    void cagir<number>('sohbet:ana').then((id) => { anaId.current = id; });
    // Motor hâli ve saat kayması useMotorSinyali'nden (yukarıda); burada yalnız mikrofon ayarı izlenir.
    const ayarUygula = (a: Ayarlar | null | undefined) => {
      const kapali = Boolean(a?.ses?.mikrofonKapali);
      const once = mikrofonKapaliRef.current;
      mikrofonKapaliRef.current = kapali;
      setMikrofonKapali(kapali);
      if (kapali && !once) mikrofonuKes();
      setAzHareketAyar(Boolean(a?.gorunum?.azHareket));
      setSayfaAyari(a?.gorunum?.centikSayfalari);
    };
    void cagir<Ayarlar>('ayarlar:al').then(ayarUygula).catch(() => undefined);
    const k: (() => void)[] = [];
    k.push(dinle('ayarlar:degisti', ayarUygula));
    // Kısayol / tepsi / ana penceredeki düğme: dinle (sesle sor) ya da yalnız göster (soru kutusu).
    // 0.14 T23: panel tıklamayla sabitlenmişse yazı alanı zaten orada — "yalnız göster" (asistan:goster odakla; panelTikla da bu yoldan) soru kutusu açmaz.
    k.push(dinle('asistan:dinle', (v: { dinle: boolean }) => { cekilmeyiIptal(); gizleIptal(); if (v.dinle) void dinlemeyiBaslat(); else if (!durum.current.adaDurumu.panelAcik) sorAc(); }));
    k.push(dinle('asistan:ses', (v: { tur: string; v?: number; metin?: string; mesaj?: string; uyari?: string; yenidenDene?: boolean }) => {
      if (v.tur === 'uyandi') {
        sesNesli.current = ++dinlemeNesli.current; // yeni dinleme: önceki dinlemenin geç olayları yok sayılır
        cekilmeyiIptal(); gizleIptal();
        dinlemeIptal.current = false;
        sesiKes(); // kullanıcı konuştu ("Hey Fuber"): Fuber'in sesi anında susar
        sohbetiTemizle(); setSorAcik(false); setHal('dinliyor');
        return;
      }
      // Düzeltme turu 1: çentik bu dinlemeden sonra gizlendi/temizlendi — geç gelen seviye, kısmi, metin ve hata adaya yazılmaz.
      if (sesNesli.current !== dinlemeNesli.current) return;
      // Kullanıcı dinlerken kapattı: bu dinlemenin geri kalanı (seviye, metin) yok sayılır.
      if (dinlemeIptal.current) { if (v.tur === 'metin' || v.tur === 'bos' || v.tur === 'hata') dinlemeIptal.current = false; return; }
      gizleIptal();
      if (v.tur === 'seviye') seviyeEkle(v.v ?? 0);
      else if (v.tur === 'kismi') setSoru(v.metin ?? '');
      else if (v.tur === 'yaziya') setHal('yaziya');
      else if (v.tur === 'metin' && v.metin) void gonder(v.metin, true, v.uyari);
      else if (v.tur === 'bos') { setHal('bos'); setSoru(''); gizleSonra(SURE.bos); }
      else if (v.tur === 'hata') { setHal('bos'); setHata(v.mesaj ?? 'Mikrofon hatası'); setYenidenSatiri(v.yenidenDene && v.mesaj ? v.mesaj : ''); }
    }));
    // Hatırlatıcı / Fuber'in mesajı: hap olarak iner, tıklanınca kart.
    k.push(dinle('asistan:bildir', (b: Bildirim) => bildirimEkle({ ...b, soz: false, acik: false, sure: SURE.bildirim, sesli: false, kaynak: b.tur === 'hatirlatma' ? 'hatirlatma' : 'fuber', sessiz: b.tur !== 'hatirlatma' && !b.acil })));
    // Düşünme motorunun eşlikçisi konuşmaya araya giriyor. 0.13: her türü (`hatirlatma` dahil; shared/ada.ts soyleKaynagi) adayı açmaz, noktada bekler; imleç gelince hapta
    // yazısı görünür, tıklanınca kart olur ve (ayara göre) o zaman söylenir.
    k.push(dinle('asistan:soyle', (v: { metin: string; tur: string; sesli: boolean; sohbetId?: number }) => {
      // Gün içinde Fuber'e seslenildi (düzeltme 7): tur ana süreçte başladı; ada üstlenir — yanıt AKARKEN konuşulur (eskiden tur bitince
      // ilk 600 harf tek seferde okunuyordu). Olaylar bu iletiden sonra gelir (aynı pencere kanalı).
      if (v.tur === 'dinlendi') {
        if (typeof v.sohbetId === 'number') anaId.current = v.sohbetId;
        turuAc(v.metin, true);
        return;
      }
      const baslik = v.tur === 'espri' ? 'Fuber 😄' : v.tur === 'hatirlatma' ? 'Fuber hatırlatıyor' : v.tur === 'sohbet' || v.tur === 'onay' || v.tur === 'yanit' ? 'Fuber' : 'Fuber araya giriyor';
      bildirimEkle({ tur: 'mesaj', baslik, metin: v.metin, soz: true, acik: false, sure: SURE.soz, sesli: Boolean(v.sesli), kaynak: 'fuber', sessiz: true });
    }));
    // Onay: pencereyi ana süreç gösterir (tam ekran kapısından); ada yalnız kartı ekler.
    k.push(dinle('asistan:onay', (v: { sohbetId: number; istek: OnayIstegi }) => {
      cekilmeyiIptal(); gizleIptal();
      onaySohbeti.current.set(v.istek.id, v.sohbetId);
      setOnaylar((o) => (o.some((x) => x.id === v.istek.id) ? o : [...o, v.istek]));
    }));
    k.push(dinle('ada:kontrol', (v: { acik: boolean }) => {
      // Kontrol başlarken imleç şeklin üstündeyse yakalama bırakılır (Fuber'in tıklaması takılmasın) — YALNIZ imleç Durdur'un üstündeyse o yakalama sürer.
      if (v.acik) { cekilmeyiIptal(); if (uzerinde.current) { uzerinde.current = false; hoverSifirla(); void cagir('ada:fare', durdurUstunde.current, durdurUstunde.current); } }
      setEkranda(Boolean(v.acik));
    }));
    k.push(dinle('ada:tam-ekran', (v: { acik: boolean }) => setTamEkran(Boolean(v.acik))));
    // 0.14 T22: sistem uyarısı. Yeni hap eskisinin yerine geçer (art arda ses tuşu: aynı hap yerinde güncellenir), süre yeniden başlar — tek atımlık.
    k.push(dinle('ada:uyari', (v: SistemUyarisi) => {
      if (!v || typeof v.metin !== 'string' || typeof v.simge !== 'string') return;
      const u: SistemUyarisi = { tur: v.tur, metin: v.metin, simge: v.simge, ...(typeof v.duzey === 'number' ? { duzey: Math.min(1, Math.max(0, v.duzey)) } : {}) };
      if (uyariZaman.current) clearTimeout(uyariZaman.current);
      setUyari(u);
      uyariZaman.current = setTimeout(() => { uyariZaman.current = null; setUyari(null); }, uyariSuresi(u));
    }));
    // 0.14 T26: Odak sayımı bitti — zil (ana süreç yalnız hap gerçekten gösterildiyse yollar; R25 kapısı hapı düşürürse zil de çalmaz).
    k.push(dinle('ada:odak-zil', () => { void odakZiliCal(); }));
    // 0.11 G10: görev adımı başladı / bitti. Hap yalnız bu durumdan çizilir; adım bitince (null) ada kendi boşta hâline döner.
    k.push(dinle('ada:gorev', (v: { id: number; baslik: string; ekran: boolean; sayi: number } | null) => {
      if (v) cekilmeyiIptal();
      else {
        // Hap altından kalkıyor (ör. Durdur tıklandı): üstündeki düğme için `mouseleave` hiç gelmez — ana sürece yakalamayı bırakması söylenir (şeklin
        // genel durumu korunur; ekran kontrolü sürerken şekil hover'ı zaten sayılmaz). Eski hata satırı da kalkar.
        if (durdurUstunde.current) { durdurUstunde.current = false; void Promise.resolve(cagir('ada:fare', uzerinde.current, false)).catch(() => undefined); }
        if (gorevHatasiZaman.current) { clearTimeout(gorevHatasiZaman.current); gorevHatasiZaman.current = null; }
        setGorevHatasi('');
      }
      setGorev(v && typeof v.id === 'number' ? { id: v.id, baslik: String(v.baslik ?? ''), ekran: Boolean(v.ekran), sayi: Number(v.sayi) || 1 } : null);
    }));
    // 0.14 T13: sohbet turu "Çalışıyor" eşiğini aştı / bitti. Hap kalkarken Durdur'un üstündeki imleç bayrağı görev hapındaki gibi düşer.
    k.push(dinle('ada:calisiyor', (v: { sohbetId: number; adim: number; etiket: string } | null) => {
      if (v) cekilmeyiIptal();
      else if (durdurUstunde.current) { durdurUstunde.current = false; void Promise.resolve(cagir('ada:fare', uzerinde.current, false)).catch(() => undefined); }
      setCalisiyor(v && typeof v.sohbetId === 'number' ? { sohbetId: v.sohbetId, adim: Number(v.adim) || 1, etiket: String(v.etiket ?? '') } : null);
    }));
    k.push(dinle('ada:centik', (v: { var: boolean }) => setCentik(Boolean(v.var))));
    // 0.14 T19 (R15): ölçek değişti (başka ölçekli ekran ya da ekran ölçeği değişti). Bilinmeyen değer tabana düşer.
    const olcekUygula = (v: unknown) => { const o = Number(v); setOlcek(Number.isFinite(o) && o >= 1 && o <= 2 ? o : 1); };
    k.push(dinle('ada:olcek', (v: { olcek: number }) => olcekUygula(v?.olcek)));
    // İlk ada:olcek bu dinleyiciden önce gitmiş olabilir: açılışta bir kez sorulur (ada:gorunur-mu ile aynı desen).
    void cagir<number>('ada:olcek-al').then(olcekUygula).catch(() => undefined);
    // 0.14 T19 (Review Focus 1): ekran olayı — kutu yer ve ölçü değiştirdi, `mouseleave` gelmeyebilir: imleç bayrakları ve hover düşer (ana süreç yakalamayı zaten
    // bıraktı; imleç yeniden girerse `mouseenter` yakalamayı kurar). Açık panelin kapanması T23'te.
    // 0.14 T23 (B28): açık panel de kapanır (shared/ada.ts panelKapanirMi 'ekran').
    k.push(dinle('ada:ekran', () => { uzerinde.current = false; durdurUstunde.current = false; panelKapat('ekran'); hoverSifirla(); }));
    // 0.14 T23: Alt+Shift+Q (main/ada.ts adaAcilDurdur) — açık panel kapanır, Çalışıyor hapı hemen düşer (Durdur'un üstündeki imleç bayrağı da).
    k.push(dinle('ada:acil', () => {
      panelKapat('acil');
      setCalisiyor(null);
      if (durdurUstunde.current) { durdurUstunde.current = false; void Promise.resolve(cagir('ada:fare', uzerinde.current, false)).catch(() => undefined); }
    }));
    // 0.14 T23: ana süreç paneli bir sayfayla açtırır (T24–T27). Pencereyi ana süreç gösterdi; panel sabitlenir.
    k.push(dinle('ada:sayfa', (v: { id: SayfaKimligi }) => {
      if (!v || !Object.hasOwn(PANEL_SAYFALARI, v.id)) return;
      cekilmeyiIptal(); gizleIptal();
      setSayfa(v.id);
      setPanelAcik(true);
    }));
    // 0.14 T23 (B28): pencere odağı gidince (başka uygulamaya tıklandı) açık panel kapanır.
    const odakGitti = () => panelKapat('odak-kaybi');
    window.addEventListener('blur', odakGitti);
    k.push(() => window.removeEventListener('blur', odakGitti));
    // 0.14 T27: içeride basılan fare düğmesi bırakılınca (ya da başka yerde bırakılınca) sürükleme ayrımı sıfırlanır.
    const butonBirakildi = () => { icerdeBasili.current = false; };
    window.addEventListener('mouseup', butonBirakildi, true);
    window.addEventListener('dragend', butonBirakildi, true);
    // I3: belge düzeyinde sürükleme olayları. İmleç şeklin dikdörtgeninde mi: istemci koordinatıyla (dragleave'in relatedTarget'ı çocuklar arasında boş gelebilir).
    const sekilde = (e: DragEvent): boolean => {
      const r = document.querySelector('.ada__sekil')?.getBoundingClientRect();
      return Boolean(r) && e.clientX >= r!.left && e.clientX <= r!.right && e.clientY >= r!.top && e.clientY <= r!.bottom;
    };
    const surukleOlayi = (tur: SurukleOlayi['tur']) => (e: DragEvent) => surukleBirak({ tur, sekildeMi: sekilde(e), iliskiliHedefVar: e.relatedTarget !== null });
    const surukleDinleyicileri: [string, (e: DragEvent) => void][] = (['dragover', 'dragleave', 'drop', 'dragend'] as const).map((t) => [t, surukleOlayi(t)]);
    for (const [t, f] of surukleDinleyicileri) document.addEventListener(t, f as EventListener);
    k.push(() => { for (const [t, f] of surukleDinleyicileri) document.removeEventListener(t, f as EventListener); });
    k.push(() => { window.removeEventListener('mouseup', butonBirakildi, true); window.removeEventListener('dragend', butonBirakildi, true); });
    k.push(dinle('sohbet:olay', (o: SohbetOlayi) => {
      // Onay kartları her sohbetten gelebilir: iptal edilen/yanıtlanan ya da turu biten sohbetin kartları kalkar (ada boşalırsa çekilir).
      if (o.tur === 'onay_iptal') { onaylariKaldir((y) => y.id !== o.id); return; }
      if (o.tur === 'bitti' || (o.tur === 'hata' && !o.mesgul)) onaylariKaldir((y) => onaySohbeti.current.get(y.id) !== o.sohbetId);
      if (o.sohbetId !== anaId.current || !turBizim.current) return;
      // Başka kaynaktan gelen mesaj meşgule takıldı: sürmekte olan turu bozma, yalnız uyar.
      if (o.tur === 'hata' && o.mesgul) { setHata(o.mesaj); return; }
      if (o.tur === 'basladi') { setHal('dusunuyor'); setKarakter(o.karakter ?? ''); turKipi.current = o.kip; if (sesliSoruldu.current) yanitSesi.current?.baslat(); }
      else if (o.tur === 'metin') {
        // Araç adımından sonra gelen yeni metin yeni paragraf olsun ("…ediyorum.Bugün" yapışmasın) — seste de cümle sınırı.
        let parca = o.parca;
        if (aracSonrasi.current && yanitRef.current && !yanitRef.current.endsWith('\n')) parca = `\n\n${parca}`;
        aracSonrasi.current = false;
        yanitRef.current += parca; setYanit(yanitRef.current);
        if (sesliSoruldu.current) yanitSesi.current?.metin(parca);
      }
      else if (o.tur === 'arac_oncesi') {
        // I5: model bu adımda araca geçti — araçtan önce yazılan metin (G26: "Kullanıcı … istedi" gibi kendi akıl yürütmesi olabiliyordu)
        // söylenmez; yazı ekranda kalır. (G21 düzeltme 4'ün "araç öncesi cümleyi araç sürerken söyle"si kalktı.)
        if (sesliSoruldu.current) yanitSesi.current?.aracOncesi();
      }
      else if (o.tur === 'arac') {
        // Araç adımı başladı: 'arac_oncesi' vermeyen motorda da araç öncesi metin söylenmez (aynı kural, ilk kartta).
        if (!aracSonrasi.current && sesliSoruldu.current) yanitSesi.current?.aracOncesi();
        aracSonrasi.current = true;
        // İş'te başarısız kart_goster satırı hiç gösterilmez (shared/arac-satiri.ts adimGorunurMu); sürerken eklenmişse kalkar.
        const gorunur = adimGorunurMu(o.blok.ad, o.blok.durum, durum.current.mod);
        setAraclar((a) => {
          const i = a.findIndex((x) => x.id === o.blok.id);
          if (!gorunur) return i >= 0 ? a.filter((x) => x.id !== o.blok.id) : a;
          if (i >= 0) { const b = [...a]; b[i] = o.blok; return b; }
          return [...a, o.blok];
        });
      }
      else if (o.tur === 'kart') {
        // 0.11 G6: kart_goster başarılı — araç satırı kalkar, yerine kısaltılmış kart gelir (ada: ilk 3 satır + "Sohbette gör"; tamamı sohbette).
        aracSonrasi.current = true;
        setAraclar((a) => a.filter((x) => x.id !== o.aracId));
        setKartlar((k) => [...k, o.kart].slice(-3));
      }
      else if (o.tur === 'tavan') {
        // 0.14 T13 (R24): tur adım sınırında durdu — yanıtın altında dürüst tek satır (adada "Devam et" düğmesi yok; sohbette var).
        yanitRef.current += `${yanitRef.current ? '\n\n' : ''}${tavanKisaMetni(o.adim)}`;
        setYanit(yanitRef.current);
      }
      else if (o.tur === 'bitti' || o.tur === 'hata') {
        turBizim.current = false;
        setHal('bos');
        if (o.tur === 'bitti' && yanitRef.current.trim()) setSonYanit(yanitRef.current); // 0.14 T23: Asistan sayfasında son yanıtın iki satırı
        // Durduruldu ya da hata: konuşma da susar (yazı kalır).
        if (o.tur === 'hata') { if (konusmaRef.current) sesiKes(); setHata(o.mesaj); return; }
        const k = sesliSoruldu.current ? konusmaRef.current : null;
        // Kalan cümle söylenir; ada konuşma bitince 20 sn sonra çekilir (konusmaBagla). Ses yoksa (açılış "yok" dedi) hemen süre.
        if (k && k.sesVar !== false) k.bitir();
        else gizleSonra(SURE.yanit);
      }
    }));
    // Pencere gizlendi (kısayol, tepsi, kontrol bitişi, ada kendisi çekildi): sus ve temizlen. Gösterildi: şekil üst kenardan
    // insin — önce toplanmış kare çizilir (iki kare beklenir), sonra yaylı iner.
    const gorunurlukDegisti = (acik: boolean) => {
      gorunur.current = acik;
      cekikKilit.current = false; // gizlendi ya da yeniden gösterildi: önceki "toplanık kal" isteği bitti
      if (yenidenZaman.current) { clearTimeout(yenidenZaman.current); yenidenZaman.current = null; }
      if (!acik) {
        if (cekilZaman.current) { clearTimeout(cekilZaman.current); cekilZaman.current = null; }
        temizle(); // görünen bildirim görülmüş sayılıp düşer; görülmemişler sırada kalır
        // Dışarıdan gizlendi (kısayol, tepsi) ama sırada görülmemiş bildirim var: hatırlatıcı kullanıcı adayı yeniden açana
        // kadar beklemesin, ada kısa süre sonra onun için yeniden iner (tam ekran kapısından).
        yenidenZaman.current = setTimeout(() => {
          yenidenZaman.current = null;
          // 0.14 T23 (T22'den devralınan hata): görülmüş bildirim yeniden indirmez. `temizle` onu listeden düşürür, ama bu zamanlayıcı listeyi ondan önceki
          // çizimden okuyabilir (gizli pencerede çizim gecikir): görülmüşler burada da sayılmaz (ada:sessiz yolundaki süzgeçle aynı).
          const kalan = acikBildirimler(durum.current.bildirimler).filter((b) => !gosterilen.current.has(b.no)); // Fuber'in sessiz sözü adayı indirmez
          if (gorunur.current || !kalan.length) return;
          void cagir('ada:goster', kalan.some((b) => b.kaynak === 'hatirlatma') ? 'hatirlatma' : 'onay');
        }, YENIDEN_INIS_MS);
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => { if (gorunur.current && !cekilZaman.current && !cekikKilit.current) setCekik(false); }));
    };
    // Kısayolla kapatılan odaklı ada (sessizken görünsün): ana süreç odağı bırakmak için pencereyi gizleyip odaksız gösterecek —
    // önce şekil üst kenara toplanır (geri çekilme), gizle/göster toplanmış kareyle olur (titreme yok). Temizlik ardından gelen
    // 'ada:sessiz'de; arada yeni iş gelirse (cekilmeyiIptal) şekil yeniden iner.
    k.push(dinle('ada:cekil', () => { gizleIptal(); cekikKilit.current = true; setCekik(true); }));
    k.push(dinle('ada:gorunur', (v: { acik: boolean; yeniden?: boolean }) => {
      gorunurOlayi.current = true;
      gorunurlukDegisti(Boolean(v.acik));
      // Kapıdan YENİDEN iniş (sırada kalan bildirim/onay için; tam ekranda gecikmiş olabilir): o arada içerik gittiyse (bildirim
      // görüldü ve kalktı, onay başka yerde yanıtlandı) ada boş inmez, geri çekilir — ana süreç de adayı yeniden boşta sayar. Ekranda
      // HÂLÂ duran bildirim (görülmüş olsa da: kullanıcı kartı okuyor) içeriktir: hiç bildirim kalmadıysa ve ada boşsa çekilir.
      if (v.acik && v.yeniden) {
        const d = durum.current;
        if (!acikBildirimler(d.bildirimler).length && bosMu(d.adaDurumu)) geriCekil();
      }
    }));
    // İş bitti ya da dışarıdan kapatıldı ama pencere kalıyor ("sessizken görünsün"): gizlenmiş gibi yarım iş temizlenir. Sırada
    // görülmemiş bildirim ya da onay kaldıysa ada onlar için KAPIDAN yeniden iner ('ada:goster': tam ekranda hatırlatma iner, Fuber'in
    // işi bekler; ana süreç adayı yeniden açık sayar — kısayol onu kapatır, sessiz ada yoklaması boşta sanıp gizlemez). Kalmadıysa
    // ada sessiz hale iner.
    k.push(dinle('ada:sessiz', () => {
      const kalan = acikBildirimler(durum.current.bildirimler).filter((b) => !gosterilen.current.has(b.no)); // temizle'den sağ çıkanlar (sessiz söz noktada kalır)
      const onayVar = durum.current.adaDurumu.onaySayisi > 0;
      gorunurlukDegisti(false);
      if (!kalan.length && !onayVar) { gorunurlukDegisti(true); return; }
      if (yenidenZaman.current) { clearTimeout(yenidenZaman.current); yenidenZaman.current = null; }
      // Onay yeniden iniş için kendi kaynağıyla sorar: 0.13'ten beri 'fuber' kapıdan adayı açmaz.
      void cagir('ada:goster', kalan.some((b) => b.kaynak === 'hatirlatma') ? 'hatirlatma' : 'onay');
    }));
    // Arayüz pencere zaten açıkken yüklendiyse (ör. yeniden yükleme) ilk 'ada:gorunur' kaçmıştır: bir kez sorulur.
    void cagir<boolean>('ada:gorunur-mu').then((acik) => { if (!gorunurOlayi.current && acik) gorunurlukDegisti(true); }).catch(() => undefined);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') kapat(); };
    window.addEventListener('keydown', esc);
    return () => {
      k.forEach((f) => f());
      window.removeEventListener('keydown', esc);
      gizleIptal();
      motorZamanlariniIptal();
      if (hoverZaman.current) clearTimeout(hoverZaman.current);
      if (uyariZaman.current) clearTimeout(uyariZaman.current);
      if (cekilZaman.current) clearTimeout(cekilZaman.current);
      if (yenidenZaman.current) clearTimeout(yenidenZaman.current);
    };
  }, []);

  return {
    uyari, hal, soru, yanit, karakter: gorunenKarakterAdi(Boolean(sinyal.a) && karakterGorunurMu(sinyal.a), karakter), araclar, kartlar, onaylar, seviyeler, hata, ekranda, gorev, gorevDurdur, durdurFare, gorevHatasi, calisiyor, calisiyorDurdur,
    /** Görünen bildirim (sıranın başı) ve sıradaki toplam (sessiz mesajlar sayılmaz: sırayla gelmezler, noktada beklerler). */
    bildirim: bas ?? null, bildirimSayisi: acikBildirimler(bildirimler).length, bildirimKonusuyor, konusuyor,
    sorAcik, motor, motorBilgi, mikrofonKapali, centik, cekik, adaDurumu, taslak, setTaslak, olcek, azHareketAyar, centikIsleri,
    /** Düşmüş yerel dikte kurulumu için tek "Yeniden dene" (İş kipi): kurulum bir kez daha başlar, yeni satır gelir. Satır başka bir hatayla değiştiyse yok. */
    dikteYeniden: yenidenSatiri && hata === yenidenSatiri ? () => { void dikteYeniden().then((d) => { setHata(d.satir); setYenidenSatiri(d.yenidenDene ? d.satir : ''); }); } : undefined,
    /** Selamda görünen ad: etkin kipin karakteri (sunucudan, yoksa gömülü varsayılan); Sade modda "Fuber" (0.14 T6b; `karakter` da öyle). */
    karakterAdi: gorunenKarakterAdi(Boolean(sinyal.a) && karakterGorunurMu(sinyal.a), etkinKarakter(sinyal.mod, sinyal.a?.hesap?.karakterler).ad),
    /** Selamın dili: uygulamanın tek dil ayarı. */
    dil: sinyal.a?.dil,
    gonder, dinlemeyiBaslat, selamdanDinle, sustur, kapat, onayla,
    sorAc, sessizdenSor, yeniSoru, kartiAc, hatirlatmayiAc, bildirimiKaldir, bildirimiAc, fare, surukleHareketi, icerdeBasildi, motorKartiAc,
    /** 0.14 T23: açık panel. `sayfalar`: gezilen sayfalar (açık olanlar, ayardaki sırayla); gösterilen sayfa kapatıldıysa Asistan. */
    /** Ayarlar geldi mi (kip gerçek): çentik ilk değerde mod geçişi oynatmaz. */
    modHazir: Boolean(sinyal.a),
    panelAcik, sayfa: acikSayfalar(sayfaAyari).includes(sayfa) ? sayfa : 'asistan' as SayfaKimligi, sayfalar: acikSayfalar(sayfaAyari), sayfaSec, panelTikla, panelYaziBirakildi, sapka, sonYanit,
  };
}

/** 0.14 T23: panelin sayfaları (Asistan; T24–T27 isterse) adanın durumunu bu bağlamdan okur — useAsistan pencerede bir kez çağrılır (Ada.tsx), sayfalar yeniden
 *  çağırmaz (ikinci bir durum olurdu). `kipi`: çentikteki karakterin kipi ve süren mod geçişi (shared/ada.ts centikKipiAdimi); `gecisBitti`: ModGecisi bitti. */
export interface AdaBaglamDegeri { a: ReturnType<typeof useAsistan>; azHareket: boolean; kipi: CentikKipi<KipKimligi>; gecisBitti: () => void }
export const AdaBaglami = createContext<AdaBaglamDegeri | null>(null);
export function useAdaBaglami(): AdaBaglamDegeri {
  const b = useContext(AdaBaglami);
  if (!b) throw new Error('AdaBaglami yok: sayfa Ada.tsx içinde çizilmeli');
  return b;
}
