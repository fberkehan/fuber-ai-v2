// ── Ada: üst ortadan inen çentik penceresi (Dynamic Island benzeri) ─────────────────────────────────────────────
// Eski sağ alt asistanın yerini alır; arayüz hâlâ `fuber://app/asistan.html` ve `asistan:*` kanalları. Tek pencere:
// 720×460 × ölçek (0.14 R15: ekran eni < 1700 → 1, < 2400 → 1,12, değilse 1,25), saydam, çerçevesiz, her zaman üstte, ekranın ÜST ORTASINA yapışık
// (imlecin bulunduğu ekran; ekran olayında yeniden kurulur, yakalama düşer: ekranDegisti). Ada bu kutunun
// içinde üst ortada büyür/küçülür (hal ve ölçüler: src/shared/ada.ts); kutunun boş yeri tıklamayı alttaki uygulamaya
// GEÇİRİR, arayüz yalnız imleç adanın şeklinin üstündeyken `ada:fare` ile tıklamayı yakalatır.
// Fuber fareyi/klavyeyi kullanırken (adaKontrol) ada ekran yakalamadan hariç ve tamamen tıklama geçirendir.
// Tam ekran film/sunum/oyunda ada inmez (`insinMi`): inemeyen olay kuyrukta bekler, tam ekran bitince — olayla, yoklamasız (0.14 T22) —
// öncelik sırasıyla (onay > hatırlatma > kullanıcı > Fuber) teslim edilir. Kullanıcının kendi açtığı ada ve hatırlatıcı
// tam ekranda da iner. Konum hesabı saf işlevde (ada-konum.ts, birim testli); tam ekranın son bilinen hâli tam-ekran.ts'te (olay yardımcısı
// fuber-olay.exe; yalnız çentiğin ekranındaki tam ekran sayılır, yardımcı çökünce "tam ekran yok").
// "Ada sessizken görünsün" (Görünüm; varsayılan açık, kurulum bittikten sonra): iş yokken ada ekranın üstünde küçük çentik olarak
// durur; iş bitince pencere gizlenmez, arayüz sessiz hale döner ('ada:sessiz'). Tam ekran film/sunum/oyunda sessiz ada da çekilir
// (tam ekran olayıyla), bitince geri gelir. Kapalıysa ada yalnız bir şey olunca iner, iş bitince pencere gizlenir.
// 0.14 T22 sistem uyarıları: olay yardımcısının olaylarından boştaki çentikte kısa hap (kulaklık, şarj, ses/parlaklık bindirmesi, Caps Lock, dil,
// internet; kurallar shared/sistem-uyarilari.ts). R25: ana pencere öndeyken, çentik kapalı/gizliyken, tam ekranda ve çentik görünmüyorken gösterilmez,
// kuyruğa girmez; hap için pencere açılmaz. Zamanlayıcılar tek atımlıktır (dil birleştirme 400 ms; hapın süresi arayüzde).
// `etkin` (ada bir iş için açık) ekrandakini izler: arayüz gösterecek bir şeyi kalmayınca geri çekilir ('asistan:gizle') ya da en
// azından 'ada:bos' der (ör. onay başka yerde yanıtlandı); yoksa kısayol boştaki adayı "açık" sanıp kapatırdı, boştaki çentik
// de tam ekranda çekilmezdi. Windows'ta ada bir araç penceresidir (type 'toolbar' → WS_EX_TOOLWINDOW): Alt+Tab'e ve Görev
// Görünümü'ne girmez.
// Uygulama önde (K4): ana pencere odaklı ve görünürken ada hiç görünmez — boştaki ada ve Fuber'in gösterdiği ada çekilir;
// o sırada gelen hatırlatıcı/mesaj ana pencerede tost olur (`ana:ada-tost`, main.ts), onay kuyrukta bekler (zaten sohbette).
// Ana pencere arkaya geçince kuyruk ve sessiz ada eski kurallarla döner. Kullanıcının kendi açtığı ada (kısayol, "Hey Fuber",
// raydaki düğme) kalır. Ada kapalı / 1 saat gizli (K5, Görünüm `ada`, `adaGizliBitis`): ada kendiliğinden hiç inmez; hatırlatıcı
// ve onay Windows bildirimi olur. Yol kararı saf işlevde (shared/ada.ts `adaYolu`); tost ve bildirimi main.ts kurar.
// Çentiği yalnız kullanıcının kendi çağrısı, zamanı gelen hatırlatıcı ve onay isteği açar (0.13): Fuber'in kendi sözü pencereyi GÖSTERMEZ (`teslim`), arayüz
// listesine yazılır, sessiz çentikte nokta olur; pencere görünmüyorsa inmez. Hover arayüzde çözülür; ana süreç ona yalnız tam ekranı söyler ('ada:tam-ekran').
import { app, BrowserWindow, nativeImage, screen, powerMonitor, type Display, type Rectangle } from 'electron';
import { AdaKuyrugu, insinMi, olayGecerliMi, adaYolu, adaKapaliMi, adaYasamAdimi, fareYakalansinMi, gorevHapiInsinMi, type AdaKaynak, type AdaOlayi, type AdaKosulu, type AdaYasami, type AdaYasamOlayi } from '../shared/ada.js';
import { adaKonumu, adaCentikli, centikYerlesimi } from './ada-konum.js';
import { ortakTercih, gezinmeKalkani } from './pencere-ortak.js';
import { tamEkranMi, tamEkranDinle, centikHedefEkrani, type CentikEkrani } from './tam-ekran.js';
import { sistemOlayiDinle, centikMedyasiDinle } from './olay-yardimcisi.js';
import { rafSurukleBagla, rafGonderenBagla, surukleSimgeAnahtari } from './raf.js';
import { ayarlar, ayarDinle } from './ayarlar.js';
import { simdi as saat, saatDinle } from './saat.js';
import { DilBirlestirici, odakBittiYolu, uyariAnahtarlari, uyariSuresi, uyariUret, uyariYolu, type OdakBittiYolu, type SistemUyarisi } from '../shared/sistem-uyarilari.js';
import type { SistemDurumu, SistemOlayi } from '../shared/sistem-olay.js';
import type { SayfaKimligi } from '../shared/centik-sayfalar.js';

export { adaKonumu };

/** "1 saat gizle" sürerken bitişin en geç yeniden denetlendiği aralık (duvar saati; uykuda kayan zamanlayıcı bitişi kaçırmasın). Sistem olayı yoklaması değildir. */
const GIZLI_DENETIM_MS = 5000;
/** Arayüzün geri çekilme süresi (şekil üst kenara toplanır): useAsistan.ts CEKILME_MS ve ada.css ile aynı. */
const CEKILME_MS = 240;

let pencere: BrowserWindow | null = null;
let kuruldu = false;      // ekran olayları ve çıkış izleyicisi bir kez bağlanır
let cikiyor = false;
let kontrolde = false;    // Fuber fareyi/klavyeyi kullanıyor
let kontrolAcmisti = false; // ada yalnız kontrol için açıldı (sonra kimse göstermedi/gizlemedi): kontrol bitince kapanır
let fareUzerinde = false; // arayüz bildirdi: imleç adanın şeklinin üstünde
let durdurUzerinde = false; // 0.11 G10: imleç görev hapının Durdur düğmesinin üstünde (fareUzerinde'nin alt durumu)
let gorevde = false;      // 0.11 G10: bir görev adımı çalışıyor (arayüz hapı çizer)
let gorevAcmisti = false; // ada yalnız görev hapı için açıldı: adım bitince kapanır (kontrolAcmisti gibi)
let gorevEkranli = false; // adımı süren görev ekranı tutuyor (ekran izni): sessiz saatte / rahatsız etmede de hap iner (shared/ada.ts gorevHapiInsinMi)
let sonGorevAnahtari = 'null'; // arayüze en son yazılan hap (JSON): aynı hap yeniden yazılmaz
const kuyruk = new AdaKuyrugu();
let etkin = false;        // ada bir iş için açık (gösterildi, henüz gizlenmedi); false: boşta (sessiz ada ya da gizli)
let sessizAcik = false;   // "sessizken görünsün" şu an uygulanıyor (ayar açık ve kurulum bitti)
let sessizTamEkran = false; // boştaki çentik tam ekran yüzünden çekildi (tam ekran var ve "Tam ekranda gizle" açık)
let sonTamEkran = false;    // arayüze en son söylenen tam ekran (hover tam ekranda açılmaz; shared/ada.ts adaHaliBul)
let sonBilinenTam = false;  // 0.14 T22: son değerlendirilen tam ekran (olay yalnız değişince kuyruğu ve boştaki çentiği yeniden değerlendirir)
let sonTamEkrandaGizle = true; // 0.14 T19: son uygulanan "Tam ekranda çentiği gizle" (değişince boştaki çentik hemen yeniden değerlendirilir)
let sonEkran: Display | null = null; // 0.14 T22: çentiğin şu an durduğu ekran (konumla): yalnız buradaki tam ekran sayılır
let sonOdakla = false;    // son gösterim klavye odağıyla mı istendi (yalnız test kancası okur)
let sonGosterim = 0;      // adaGoster'in son çağrıldığı an: daha eski bir 'ada:bos' bayattır (arada yeni iş gösterildi)
let odakBirakma: NodeJS.Timeout | null = null; // kısayolla kapatılan odaklı ada: geri çekilme bitince odak bırakılır
let kullaniciActi = false; // bu iş kullanıcının kendi açtığı ada (kısayol, "Hey Fuber"): uygulama öne gelse ya da ada kapansa da kalır
let hatirlatmaGosterildi = false; // bu işte adaya hatırlatıcı indi (kısayol onu kapatır; yalnız Fuber'in bildirimi soru kutusuna yer açar)
let anaOndeGercek = false; // ana pencerenin odak olaylarından (main.ts): odaklı ve görünür
let sonAnaOnde = false;    // son uygulanan "uygulama önde" (test kancası gerçeğin önüne geçebilir)
let sonKapali = false;     // son uygulanan "ada kapalı / gizli"
let gizliZaman: NodeJS.Timeout | null = null; // "1 saat gizle" sürerken en geç 5 sn'de bir yeniden değerlendirilir
let cekme: NodeJS.Timeout | null = null;      // uygulama öne geldi / ada kapandı: şekil toplanınca pencere gizlenir
let uyariActi = false;                         // 0.14 T22 düzeltme 1: gizli çentik yalnız sistem uyarısı için indi (süre dolunca geri çekilir)
let uyariCekme: NodeJS.Timeout | null = null;  // o inişin tek atımlık geri çekilme zamanlayıcısı
let anaSonOnde = 0;       // ana pencerenin önde olmaktan son çıktığı an (gerçek odak olayı)
let odakAnayaDoner = false; // ada klavye odağını ana pencere öndeyken aldı: ada bırakınca Windows odağı ana pencereye verir
/** Adaya teslim edilmiş onaylar (kimliğe göre): ada uygulama öne geldiği / kapandığı için çekilirse kaybolmasınlar diye. */
const adadakiOnaylar = new Map<string, AdaOlayi>();

/** Tost (uygulama önde) ve Windows bildirimi (ada kapalı) main.ts'te kurulur: pencere ve bildirim orada. `anayaOdak`: odağı ana
 *  pencereden almış ada kapanınca odak ona geri verilir (araç penceresi gizlenince Windows onu kendiliğinden geri vermiyor). `sessiz`: sessiz
 *  saat ya da "Rahatsız etme" sürüyor mu (main/zamanlayici.ts sessizMi; burada içe aktarılmaz — zamanlayici.ts bu modülü içe aktarıyor). */
interface Yonlendirici { tost: (kanal: string, veri: unknown) => void; bildirim: (kanal: string, veri: unknown) => void; anayaOdak?: () => void; sessiz?: () => boolean }
let yonlendirici: Yonlendirici = { tost: () => undefined, bildirim: () => undefined };
export function adaYonlendiriciKur(y: Yonlendirici): void { yonlendirici = y; }

const canli = (): BrowserWindow | null => (pencere && !pencere.isDestroyed() ? pencere : null);

/** Uygulama önde mi (K4). Test kancası, YALNIZ FUBER_DEMO'da: FUBER_TEST_ANA_ONDE '1'/'0' gerçek odağın önüne geçer
 *  (ada:test-ana-onde; Playwright altında pencere odağı işletim sistemine bağlıdır, testler sabitler). */
function anaOnde(): boolean {
  const s = anaOndeSahte();
  return s ?? anaOndeGercek;
}
function anaOndeSahte(): boolean | null {
  const sahte = process.env.FUBER_DEMO ? process.env.FUBER_TEST_ANA_ONDE : undefined;
  return sahte === '1' || sahte === '0' ? sahte === '1' : null;
}
/** Ada kapalı mı: "Adayı tamamen kapat" ya da "1 saat gizle" sürüyor (Görünüm). */
const adaKapali = (): boolean => adaKapaliMi(ayarlar().gorunum, saat());
const kosul = (tamEkran: boolean): AdaKosulu => ({ tamEkran, anaOnde: anaOnde(), kapali: adaKapali() });

/** Ana pencere odaklı ve görünür mü (zamanlayıcı: uygulama öndeyken hatırlatıcı Windows bildirimi değil tost olur). */
export function adaAnaOndeMi(): boolean { return anaOnde(); }

/** main.ts: ana pencerenin odak/görünürlük olayları (focus, blur, show, hide, minimize, restore). */
export function adaAnaOnde(onde: boolean): void {
  if (anaOndeGercek && !onde) anaSonOnde = Date.now();
  anaOndeGercek = onde;
  adaAnaOndeYenile();
}

/** "Uygulama önde" değiştiyse uygular (test kancası da çağırır). Öne geldi: kullanıcının açmadığı ada çekilir (üstündeki onay tost
 *  olur ve kuyrukta bekler). Arkaya geçti: kuyruk hemen boşaltılır, sessiz ada yoklanır, Fuber ekranı kullanıyorsa "ekranda" için açılır. */
export function adaAnaOndeYenile(): void {
  const onde = anaOnde();
  if (onde === sonAnaOnde || cikiyor) return;
  sonAnaOnde = onde;
  if (onde) {
    if (canli()?.isVisible() && !(etkin && kullaniciActi)) { adadakiOnaylariYonlendir(); adayiCek(); }
    return;
  }
  kuyruguBosalt();
  if (sessizAcik) sessizDegerlendir();
  if (kontrolde) kontroldeAc();
  if (gorevde) gorevdeAc();
}

/** Ada kullanıcının açmadığı bir iş (ya da boşta) gösterirken çekilir (uygulama öne geldi, ada kapatıldı) ya da kullanıcı adayı
 *  uygulama öndeyken kapattı: şekil önce üst kenara toplanır ('ada:cekil', ani kaybolma yok), sonra pencere gizlenir; arayüz yarım işi
 *  temizler, görülmemiş bildirim kaldıysa kapıdan yeniden iner (uygulama öndeyse bekler, ada kapalıysa düşer). Beklerken yeni iş
 *  geldiyse gizlenmez. `kesin` değilse ve bu arada odak geri döndüyse (boştaki ada görünmeli) sessize döner; `kesin`: kullanıcı kapattı,
 *  odak ana pencereye dönecek — her durumda gizlenir. */
function adayiCek(kesin = false, odakAnaya = false): void {
  kontrolAcmisti = false;
  gorevAcmisti = false;
  kullaniciActi = false;
  etkin = false;
  if (odakBirakma) { clearTimeout(odakBirakma); odakBirakma = null; }
  fareUzerinde = false;
  durdurUzerinde = false;
  fareyiUygula();
  if (!canli()?.isVisible()) return;
  dogrudan('ada:cekil', {});
  if (cekme) clearTimeout(cekme);
  cekme = setTimeout(() => {
    cekme = null;
    const v = canli();
    if (!v || etkin || cikiyor || !v.isVisible()) return;
    if (!kesin && sessizAcik && !sessizTamEkran && !anaOnde() && !adaKapali()) { sessizeDon(); return; }
    // B2 (son düzeltme): odak ana pencereye yalnız ada HÂLÂ odaktaysa geri verilir. Çağrı anındaki `odakAnaya` 270 ms sonra bayat
    // olabilir: kullanıcı arada başka bir uygulamaya geçtiyse (Outlook'a tıkladı) odak oradan çalınmasın. Gizlemeden ÖNCE okunur.
    const halaOdakta = v.isFocused();
    v.hide();
    if (odakAnaya && halaOdakta) yonlendirici.anayaOdak?.();
  }, CEKILME_MS + 30);
}

/** Adada duran onaylar ada çekilirken kaybolmasın (yanıt bekliyorlarsa): uygulama öndeyse tost olur ve kuyrukta bekler (ana pencere
 *  arkaya geçince ada onları yeniden gösterir), ada kapalıysa Windows bildirimi olur (shared/ada.ts adaYolu). */
function adadakiOnaylariYonlendir(): void {
  for (const o of adadakiOnaylar.values()) {
    if (!olayGecerliMi(o, Date.now())) continue;
    const y = adaYolu('onay', kosul(false));
    if (y.tost) yonlendirici.tost(o.kanal, o.veri);
    if (y.bildirim) yonlendirici.bildirim(o.kanal, o.veri);
    if (y.ada === 'bekle') kuyruk.ekle(o);
  }
  adadakiOnaylar.clear();
}

/** Ada penceresi (yoksa ya da yıkıldıysa null). Doğrudan göndermeler için: kapıdan geçmeyen ses/dinleme olayları. */
export function adaPencere(): BrowserWindow | null { return canli(); }

/** Arayüze olay yollar; sayfa henüz yükleniyorsa yüklenince (gönderim kaybolmasın). Kapıdan geçmez (ör. kısayolun 'asistan:dinle'i). */
export function adayaGonder(kanal: string, veri: unknown): void { dogrudan(kanal, veri); }

function dogrudan(kanal: string, veri: unknown): void {
  const w = canli();
  if (!w) return;
  const yolla = () => { if (!w.isDestroyed()) w.webContents.send(kanal, veri); };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', yolla); else yolla();
}

/** İmlecin ekranı, o ekranın üst ortasındaki kutu ve çentik ölçeği (0.14 T19, R15; saf hesap ada-konum.ts centikYerlesimi). İmleç yalnız bu anlarda okunur
 *  (gösterim ve ekran olayı): yoklama yok. */
function yerlesim(): { ekran: Display; kutu: Rectangle; olcek: number } {
  const ekranlar = screen.getAllDisplays();
  const y = centikYerlesimi(ekranlar, screen.getCursorScreenPoint());
  const ekran = ekranlar.find((e) => e.id === y.ekranId) ?? screen.getPrimaryDisplay();
  return y.ekranId === -1 ? { ekran, kutu: adaKonumu(ekran, process.platform), olcek: 1 } : { ekran, kutu: y.kutu, olcek: y.olcek };
}

/** Arayüze en son söylenen ölçek (yeni pencerede sıfırlanır: ilk konumla yeniden söyler). */
let sonOlcek = 0;
/** Arayüz açılışta sorar (`ada:olcek-al`): ilk `ada:olcek` React dinleyicisi kurulmadan gidebilir (ada:gorunur-mu ile aynı desen). */
export function adaOlcek(): number { return sonOlcek || 1; }

/** Adayı imlecin bulunduğu ekranın üst ortasına, o ekranın ölçeğiyle koyar (her gösterimde ve ekran değişince). Ölçek değiştiyse arayüze `ada:olcek` gider
 *  (kökteki CSS zoom: yazı ve karakter yeniden çizilir, bulanıklaşmaz). */
function konumla(): void {
  const w = canli();
  if (!w) return;
  const { ekran, kutu: hedef, olcek } = yerlesim();
  sonEkran = ekran;
  w.setBounds(hedef);
  // Ölçeği farklı ekrana geçişte ilk setBounds boyutu/konumu kaydırabilir: tutmadıysa bir kez daha.
  const b = w.getBounds();
  if (b.x !== hedef.x || b.y !== hedef.y || b.width !== hedef.width || b.height !== hedef.height) w.setBounds(hedef);
  if (olcek !== sonOlcek) { sonOlcek = olcek; dogrudan('ada:olcek', { olcek }); }
  // Çentikli Mac ekranı: sessiz hal çizilmez (gerçek çentik orada), büyüyen haller çentiğin altından doğar.
  if (process.platform === 'darwin') dogrudan('ada:centik', { var: adaCentikli(ekran, process.platform) });
}

/**
 * Ekran eklendi, söküldü ya da ölçeği/çözünürlüğü değişti (Review Focus 1): çentik imlecin ekranında, o ekranın ölçeğiyle yeniden kurulur; imleç artık şeklin
 * üstünde sayılmaz (kutu yer değiştirdi, `mouseleave` gelmeyebilir): tıklama yakalama ve Durdur bayrağı düşer (shared/ada.ts adaYasamAdimi 'ekran'). Arayüz
 * `ada:olcek` ile ölçeği alır; `ada:ekran` açık paneli kapatır (0.14 T23, B28: shared/ada.ts panelKapanirMi 'ekran').
 */
function ekranDegisti(): void {
  konumla();
  yasamAdimi({ tur: 'ekran' });
  fareyiUygula();
  dogrudan('ada:ekran', {});
  tamEkranOlayi(); // çentik başka ekrana geçti: o ekranın tam ekranı geçerli
}

// ── Tam ekran (0.14 T22): son bilinen hâl, olayla ────────────────────────────────────────────────────────────────────────────────────
/** Bir ekranın fiziksel kutusu: Windows'ta Electron dönüştürür (çok ekran, karışık ölçek), başka yerde DIP kutusu × scaleFactor. */
function centikKutusu(e: Display | null): CentikEkrani | null {
  if (!e) return null;
  if (process.platform === 'win32' && typeof screen.dipToScreenRect === 'function') return { kutu: screen.dipToScreenRect(null, e.bounds), olcek: 1 };
  return { kutu: e.bounds, olcek: e.scaleFactor || 1 };
}
/**
 * Çentiğin İNECEĞİ ekranda şu an tam ekran var mı — soru yok, yardımcının son bildirdiği (düzeltme turu 1, Important 1). Görünür çentik yerinde kalıyorsa
 * durduğu ekran (`sonEkran`); gizliyse ya da `inecek` (teslim ve gösterim çentiği imlecin ekranına taşır) imlecin ekranı — imleç yalnız bu anda bir kez okunur.
 */
const tamEkranSimdi = (inecek = false): boolean => {
  const gorunur = Boolean(canli()?.isVisible());
  const hedef = centikHedefEkrani({ gorunur, inecek, son: sonEkran, imlec: () => yerlesim().ekran });
  return tamEkranMi(centikKutusu(hedef));
};

/**
 * Tam ekran başladı/bitti, yardımcı çöktü (hâl boş: tam ekran yok) ya da çentik başka ekrana geçti. Değiştiyse arayüze söylenir (hover), boştaki çentik
 * çekilir ya da döner; bittiyse kuyruk HEMEN boşalır (yoklama yok) ve tam ekran yüzünden açılmayan kontrol/görev hapı yeniden denenir.
 */
function tamEkranOlayi(): void {
  if (cikiyor) return;
  const tam = tamEkranSimdi();
  if (tam === sonBilinenTam) return;
  sonBilinenTam = tam;
  tamEkranSoyle(tam);
  if (sessizAcik) sessizDegerlendir();
  if (tam) return;
  kuyruguBosalt();
  if (kontrolde) kontroldeAc();
  if (gorevde) gorevdeAc();
  odakBekleyeniCalistir(); // I4: tam ekran yüzünden bekleyen "Odak bitti" hapı ve zili
}

// ── Sistem uyarıları (0.14 T22) ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Dil patlaması (Alt+Shift iki kez A→B→A) tek hapa iner ya da hiç hap vermez (shared/sistem-uyarilari.ts). */
const dilBirlestirici = new DilBirlestirici((u) => uyariGoster(u));

/** Olay yardımcısının her olayı: dil birleştiriciye, öbürleri doğrudan hap kuralına. */
function sistemOlayinda(o: SistemOlayi, onceki: SistemDurumu): void {
  if (cikiyor) return;
  const acik = uyariAnahtarlari(ayarlar().gorunum);
  if (o.t === 'dil') { dilBirlestirici.olay(o, onceki, acik); return; }
  const u = uyariUret(o, onceki, acik);
  if (u) uyariGoster(u);
}

/**
 * Hap çentiğe yazılır — R25 kapısından (uyariYolu): kuyruğa girmez (hap anlık olaydır; geç gösterilen ses düzeyi yanlış olur). Düzeltme turu 1 (Important 3):
 * çentik görünmüyorsa (ör. "Ada sessizken görünsün" kapalı) odak almadan iner, hap süresi dolunca tek atımlık zamanlayıcıyla geri çekilir; arada başka bir iş
 * adayı gösterirse (adaGoster) çekilmez. Ada bir iş için açıkken ya da Fuber ekranı kullanırken iniş yok (pencere zaten görünür).
 */
function uyariGoster(u: SistemUyarisi): boolean {
  const w = canli();
  if (!w) return false;
  const yol = uyariYolu({ anaOnde: anaOnde(), kapali: adaKapali(), tamEkran: tamEkranSimdi(), gorunur: w.isVisible() });
  if (yol === 'yok') return false;
  if (yol === 'in') {
    if (etkin || kontrolde || cikiyor) return false;
    if (cekme) { clearTimeout(cekme); cekme = null; }
    konumla();
    w.showInactive();
    uyariActi = true;
  }
  dogrudan('ada:uyari', u);
  if (!uyariActi) return true;
  if (uyariCekme) clearTimeout(uyariCekme);
  uyariCekme = setTimeout(() => {
    uyariCekme = null;
    if (!uyariActi) return;
    uyariActi = false;
    if (etkin || kontrolde || cikiyor || !canli()?.isVisible()) return;
    adayiCek();
  }, uyariSuresi(u));
  return true;
}

/** Sistem olayı dışı bir kaynağın hapı (0.14 T26: Odak bitti): aynı R25 kapısından, aynı iniş/çekilme yoluyla gösterilir. Dönen değer: hap GERÇEKTEN gösterildi mi
 *  (R25 kapısı, çıkış ya da başka iş yüzünden düştüyse false) — Odak zili yalnız true'da çalar. */
export function adaUyari(u: SistemUyarisi): boolean {
  return cikiyor ? false : uyariGoster(u);
}

// ── 0.14 son inceleme I4: "Odak bitti" (kullanıcının kendi zamanlayıcısı) — yol kararı shared/sistem-uyarilari.ts odakBittiYolu, bağlama main/odak.ts ──
/** Tam ekran yüzünden bekleyen "Odak bitti" (en sonuncusu; onay gibi kuyrukta bekler). Tam ekran bitiş olayında (tamEkranOlayi) yeniden karar verilir. */
let odakBekleyen: (() => void) | null = null;
/** Şimdiki koşullarla "Odak bitti"nin yolu (çıkarken hiçbir şey). */
export function adaOdakYolu(): OdakBittiYolu {
  if (cikiyor) return 'yok';
  return odakBittiYolu({ anaOnde: anaOnde(), kapali: adaKapali(), tamEkran: tamEkranSimdi(), gorunur: Boolean(canli()?.isVisible()) });
}
/** Ana pencere önde: uygulama içi tost (AdaTost.tsx 'ada:odak-bitti'; zili orada çalar). */
export function adaOdakTost(u: SistemUyarisi): void { yonlendirici.tost('ada:odak-bitti', u); }
/** Tam ekran: bekle (yeni bitiş eskisinin yerini alır). */
export function adaOdakBeklet(tekrar: () => void): void { odakBekleyen = tekrar; }
function odakBekleyeniCalistir(): void {
  const f = odakBekleyen;
  odakBekleyen = null;
  f?.();
}

/** Uyarı inişi bitti (başka iş adayı gösterdi ya da pencere gizlendi): geri çekilme zamanlayıcısı düşer. */
function uyariInisiniBirak(): void {
  uyariActi = false;
  if (uyariCekme) { clearTimeout(uyariCekme); uyariCekme = null; }
}

/** Tıklama yakalama: yalnız imleç adanın şeklinin üstündeyken VE Fuber ekranı kullanmıyorken. Gerisi alta geçer. 0.11 G10: tek istisna görev
 *  hapındaki Durdur düğmesidir — imleç ONUN üstündeyken kontrol sürse de tıklama yakalanır (Durdur her zaman tıklanır; düğmenin dışı alta geçer). */
function fareyiUygula(): void {
  canli()?.setIgnoreMouseEvents(!fareYakalansinMi({ fareUzerinde, durdurUzerinde, kontrolde }), { forward: true });
}

/** Fare yakalama ve pencerenin yaşam döngüsü bayrakları (kural ve geçişler saf: shared/ada.ts adaYasamAdimi; tests/ada.test.ts sıralı olay dizisiyle sınar). */
const yasam = (): AdaYasami => ({ fareUzerinde, durdurUzerinde, kontrolde, gorevde, gorevAcmisti, kontrolAcmisti });
/** Olayı saf kurala uygular, bayrakları yazar; `true`: pencere kapanmalı (çağıran adaGizle'yi çağırır). */
function yasamAdimi(o: AdaYasamOlayi): boolean {
  const r = adaYasamAdimi(yasam(), o);
  ({ fareUzerinde, durdurUzerinde, kontrolde, gorevde, gorevAcmisti, kontrolAcmisti } = r.durum);
  return r.gizle;
}

/** Raf'tan dışarı sürüklenen dosyanın imleçteki küçük simgesi (24×24 mavi kare; Windows startDrag boş simge kabul etmez). */
const SURUKLE_SIMGESI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAJ0lEQVR4nGNgGAWkAK6W//+pgUctGLVg1IJRC0YtGLVgYC0YBdgAAMweOV4payjGAAAAAElFTkSuQmCC';
/** 0.14 T27: Raf'taki dosyayı dışarı sürükler (webContents.startDrag; dosya kopyalanmaz, işletim sistemi yolu sürükleme kaynağı sayar). Yol main/raf.ts'te listeden ve
 *  diskten doğrulanmıştır; burada yalnız çentiğin penceresi sürüklemeyi başlatır. */
const dosyaSimgeleri = new Map<string, Electron.NativeImage>();
export async function adaSurukle(yol: string, klasor = false): Promise<boolean> {
  const w = canli();
  if (!w || w.isDestroyed()) return false;
  // Simge BEKLENMEZ (yavaş diskte sürükleme düğme bırakıldıktan sonra başlardı): önbellekteki simgeyle ya da mavi kareyle hemen başlar; simge arkadan önbelleğe alınır.
  // 0.14 T35: anahtar uzantıdan (main/raf.ts surukleSimgeAnahtari): uzantısız dosya ve klasör kendi anahtarını alır.
  const anahtar = surukleSimgeAnahtari(yol, klasor);
  const icon = dosyaSimgeleri.get(anahtar) ?? nativeImage.createFromDataURL(SURUKLE_SIMGESI);
  if (!dosyaSimgeleri.has(anahtar)) void app.getFileIcon(yol, { size: 'normal' }).then((g) => { if (!g.isEmpty()) dosyaSimgeleri.set(anahtar, g); }).catch(() => undefined);
  w.webContents.startDrag({ file: yol, icon });
  return true;
}
rafSurukleBagla(adaSurukle);
/** I1: `raf:*` yalnız çentik penceresinin webContents'inden kabul edilir. */
rafGonderenBagla((g) => { const w = canli(); return Boolean(w) && g === w!.webContents; });

export function adaOlustur(): void {
  if (canli() || cikiyor) return; // çıkarken (kuyruk boşaltması, gecikmiş gösterim) pencere yeniden yaratılmaz
  const w = new BrowserWindow({
    ...yerlesim().kutu, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true, focusable: true, show: false, alwaysOnTop: true,
    // macOS pencereyi menü çubuğunun altına iter; ada çubuğun üstünde durmalı.
    ...(process.platform === 'darwin' ? { enableLargerThanScreen: true } : {}),
    // Windows: araç penceresi (WS_EX_TOOLWINDOW). skipTaskbar yalnız görev çubuğu düğmesini gizler; hep görünen sessiz ada Alt+Tab'de
    // ve Görev Görünümü'nde boş bir pencere olarak dururdu. Odak ve saydamlık değişmez (ada-testi.mjs pencere stilini okur).
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    webPreferences: ortakTercih(),
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }); // macOS: tam ekran Space'lerinin üstüne inmez
  w.setIgnoreMouseEvents(true, { forward: true }); // varsayılan: tıklamayı geçir, imleç hareketini arayüze ilet
  gezinmeKalkani(w);
  void w.loadURL('fuber://app/asistan.html');
  w.on('close', (e) => { if (!cikiyor) { e.preventDefault(); adaGizle(); } });
  // Saydam ada penceresinde Page Visibility hep "visible" kalıyor: arayüz gösterilip gizlendiğini buradan öğrenir (gizlenince
  // yarım iş temizlenir, gösterilince şekil üst kenardan yaylanarak iner).
  w.on('show', () => dogrudan('ada:gorunur', { acik: true }));
  // Pencere hangi yoldan gizlenirse gizlensin (kısayol, boştaki çentik tam ekranda, ayar kapandı) imleç artık şeklin üstünde
  // sayılmaz: tıklama yakalama bırakılır. Eskiden yalnız adaGizle sıfırlıyordu — kendiliğinden gizlenen ada, görünmezken üst ortadaki
  // 480×480 kutuda tıklamaları yutabiliyordu (arayüz kendi bayrağını temizler ama ana sürece söylemezdi).
  w.on('hide', () => {
    uyariInisiniBirak();
    fareUzerinde = false;
    durdurUzerinde = false;
    fareyiUygula();
    dogrudan('ada:gorunur', { acik: false });
  });
  // Ada klavye odağını aldığında ana pencere öndeyse (ya da az önce önden çekildiyse: odak ondan geldi) ada bırakınca Windows odağı
  // ana pencereye geri verir — kapanışta boştaki ada sessize dönmez (adaGizle), yoksa ana pencere öne gelince inip hemen çekilirdi.
  w.on('focus', () => { odakAnayaDoner = anaOnde() || (anaOndeSahte() === null && Date.now() - anaSonOnde < 600); });
  w.on('blur', () => { odakAnayaDoner = false; });
  pencere = w;
  if (!kuruldu) {
    kuruldu = true;
    app.on('before-quit', () => {
      cikiyor = true;
      dilBirlestirici.kapat();
      uyariInisiniBirak();
      if (odakBirakma) { clearTimeout(odakBirakma); odakBirakma = null; }
      if (gizliZaman) { clearTimeout(gizliZaman); gizliZaman = null; }
      if (cekme) { clearTimeout(cekme); cekme = null; }
    });
    screen.on('display-metrics-changed', () => ekranDegisti());
    screen.on('display-added', () => ekranDegisti());
    screen.on('display-removed', () => ekranDegisti());
    ayarDinle(() => sessizAyariniUygula());
    saatDinle(() => sessizAyariniUygula()); // yalnız FUBER_DEMO test saati: "1 saat gizle" bitişi beklemeden sınanır
    // Uyku boyunca zamanlayıcılar gecikir: uyanınca "1 saat gizle" hemen yeniden değerlendirilir.
    powerMonitor.on('resume', () => sessizAyariniUygula());
    powerMonitor.on('unlock-screen', () => sessizAyariniUygula());
    // 0.14 T22: tam ekran ve sistem uyarıları olay yardımcısından (yoklama yok).
    tamEkranDinle(() => tamEkranOlayi());
    sistemOlayiDinle((o, onceki) => sistemOlayinda(o, onceki));
    // 0.14 T25: medya oturumu ve ses düzeyi yalnız değişince çentiğe (Kapalı hap, panelin medya çubukları, Müzik, Şarkı sözü). Pencere açmaz.
    centikMedyasiDinle((m) => { if (!cikiyor) dogrudan('ada:medya', m); });
  }
  sessizAcik = false; // yeni pencere: sessiz ada (ayar açıksa) yeniden kurulur
  sonTamEkran = false; // yeni arayüz tam ekran bilmez: aşağıda yeniden söylenir
  sonOlcek = 0;        // yeni arayüz ölçeği bilmez: ilk konumla söyler
  konumla();
  sonBilinenTam = tamEkranSimdi();
  tamEkranSoyle(sonBilinenTam);
  sessizAyariniUygula();
}

/** Adayı gösterir (kapı YOK: kullanıcı kısayol/tepsi/mikrofon düğmesiyle kendisi açıyor). `odakla`: yazı kutusu klavyeyi alsın.
 *  `kullanici`: kullanıcının kendi açtığı ada — uygulama öne gelse de, ada kapatılsa da bu iş bitene dek kalır. */
export function adaGoster(o: { odakla?: boolean; kullanici?: boolean } = {}): void {
  if (cikiyor) return;
  if (odakBirakma) { clearTimeout(odakBirakma); odakBirakma = null; } // kapanırken yeniden açıldı: odak bırakılmaz
  if (cekme) { clearTimeout(cekme); cekme = null; }                  // çekilirken yeni iş: pencere gizlenmez
  uyariInisiniBirak();                                                // uyarı için inmiş çentiği bir iş devraldı: hap süresi onu çekmez
  adaOlustur();
  const w = canli();
  if (!w) return;
  konumla();
  if (o.odakla) { w.show(); w.focus(); } else w.showInactive();
  sonOdakla = Boolean(o.odakla);
  sonGosterim = Date.now();
  if (!etkin) { kullaniciActi = false; hatirlatmaGosterildi = false; } // yeni iş: kimin açtığı baştan
  if (o.kullanici) kullaniciActi = true;
  etkin = true;
  kontrolAcmisti = false; // kullanıcı ya da kapı gösterdi: artık kontrol bitince kapanmaz
  gorevAcmisti = false;   // (aynı kural: görev hapı için açılmışsa gorevdeAc bunu sonradan true yapar)
}

/**
 * İş bitti ya da kullanıcı kapattı. Sessiz ada açıksa (ve tam ekran yoksa) pencere kalır, arayüz sessiz hale döner.
 * `cekildi`: arayüz şekli çoktan üst kenara topladı (kendi geri çekilmesi, 'asistan:gizle' true); kısayol/tepsi kapatışında false.
 */
export function adaGizle(o: { cekildi?: boolean } = {}): void {
  kontrolAcmisti = false;
  gorevAcmisti = false;
  kullaniciActi = false;
  hatirlatmaGosterildi = false;
  fareUzerinde = false;
  durdurUzerinde = false;
  fareyiUygula();
  etkin = false;
  if (odakBirakma) { clearTimeout(odakBirakma); odakBirakma = null; }
  const w = canli();
  if (!w) return;
  // Uygulama önde ya da odak ona dönecek (ada odağı ana pencere öndeyken aldı; Windows bırakılan odağı ona verir) — K4: boştaki ada
  // görünmeyecek. Sessize dönüp odağı gizle/göster ile bırakmak yerine şekil üst kenara toplanır, sonra pencere gizlenir (odak ana
  // pencereye kendiliğinden döner). Eskiden sessiz ada inip ana pencere öne gelince yarıda çekiliyordu (titreme).
  const odakliydi = w.isFocused();
  const anayaDoner = anaOnde() || (odakliydi && odakAnayaDoner);
  if (anayaDoner && w.isVisible()) {
    if (!o.cekildi) { adayiCek(true, odakliydi); return; }
    w.hide(); // arayüz şekli çoktan topladı
    if (odakliydi) yonlendirici.anayaOdak?.();
    return;
  }
  if (sessizAcik && !sessizTamEkran && w.isVisible()) {
    // Pencere kalıyor ama klavye odağı adada KALMAMALI: tuşlar görünmez adaya değil, alttaki uygulamaya (Outlook, Word…) gitsin.
    // blur() yetmez: Chromium odağı Z sırasındaki bir sonraki görünür pencereye verir — her zaman üstte olan ada için bu çoğu kez
    // görev çubuğudur. Gizleyip odaksız yeniden göstermek Windows'un etkinleştirme sırasını kullanır (önceki uygulama geri gelir).
    // Gizle/göster yalnız TOPLANMIŞ şekille yapılır: açık şekil bir an kaybolup eski kareyle geri gelirdi (titreme). Kısayolla
    // kapatılan odaklı adada arayüz önce geri çekilir ('ada:cekil', CEKILME_MS), odak ondan sonra bırakılır.
    if (w.isFocused() && process.platform === 'win32') {
      if (o.cekildi) { odagiBirak(w); sessizeDon(); return; }
      dogrudan('ada:cekil', {});
      odakBirakma = setTimeout(() => {
        odakBirakma = null;
        const v = canli();
        // Beklerken ada yeniden açıldıysa (kısayol, yeni iş) ya da kendiliğinden gizlendiyse dokunulmaz.
        if (!v || etkin || cikiyor || !sessizAcik || !v.isVisible()) return;
        odagiBirak(v);
        sessizeDon();
      }, CEKILME_MS + 30);
      return;
    }
    if (w.isFocused()) w.blur(); // macOS: odak bir önceki uygulamaya döner
    sessizeDon();
    return;
  }
  w.hide();
}

/** Windows: odaklı adanın odağını alttaki uygulamaya bırakır (gizle + odaksız göster; şekil toplanmışken çağrılır). */
function odagiBirak(w: BrowserWindow): void {
  if (w.isFocused()) { w.hide(); w.showInactive(); }
}

/** Arayüz sessize döner (sırada iş kaldıysa onu kapıdan yeniden gösterir). Boştaki çentik hemen değerlendirilir (tam ekransa çekilir). */
function sessizeDon(): void {
  dogrudan('ada:sessiz', {});
  sessizDegerlendir();
}

/**
 * Arayüz: gösterecek bir şey kalmadı (ör. onay ana pencerede ya da telefonda yanıtlandı, süresi doldu). `gorulen`: arayüzün bunu
 * gördüğü an. O andan SONRA ada yeniden gösterildiyse (yeni iş yolda) bayattır, yok sayılır. Ada boşta sayılır (kısayol onu kapatmaz,
 * açar) ve boştaki çentik yeniden değerlendirilir (tam ekransa çekilir). Pencereyi gizlemez: geri çekilmeyi arayüz yönetir.
 */
export function adaBos(gorulen: number): void {
  if (!etkin || kontrolde || !(gorulen > sonGosterim)) return;
  etkin = false;
  kontrolAcmisti = false;
  kullaniciActi = false;
  hatirlatmaGosterildi = false;
  adadakiOnaylar.clear(); // arayüz boş: adada onay kalmadı
  if (sessizAcik) sessizDegerlendir();
}

/** Ada penceresi şu an klavye odağında mı (arayüz: odak almamış boş soru kutusu 30 sn sonra kapanır). */
export function adaOdaktaMi(): boolean {
  return Boolean(canli()?.isFocused());
}

/** Arayüz: adada hatırlatıcı var mı (düzeltme 3, F2). Hatırlatıcı kalkınca (başka bir bildirim adayı açık tutsa da) false gelir;
 *  eskiden bayrak iş bitene dek true kalıyor, kısayol soru kutusunu açmak yerine adayı kapatıyordu. */
export function adaHatirlatmaDurumu(var_: boolean): void { hatirlatmaGosterildi = Boolean(var_); }

/** Kısayol kararı için ana sürecin bildiği (shared/ada.ts kisayolKarari): açık mı, kullanıcı mı açtı, adada onay var mı, kontrol sürüyor mu. */
export function adaKisayolDurumu(): { acik: boolean; kullaniciActi: boolean; onayVar: boolean; hatirlatmaVar: boolean; kontrolde: boolean } {
  return { acik: adaAcikMi(), kullaniciActi, onayVar: adadakiOnaylar.size > 0, hatirlatmaVar: hatirlatmaGosterildi, kontrolde };
}

/** Ada bir iş için açık mı (kısayolun "açıksa kapat" kararı)? Sessiz ada görünür ama boştadır: açık sayılmaz. */
export function adaAcikMi(): boolean {
  return Boolean(canli()?.isVisible()) && (etkin || !sessizAcik);
}

/** YALNIZ FUBER_DEMO test kancası (`ada:test-durum`, ipc.ts): ana sürecin ada bayrakları — etkin, odak, fare yakalama, uygulama
 *  önde, ada kapalı, kuyrukta bekleyen, çentiğin ekranında tam ekran (son bilinen hâl). */
export function adaTestDurumu(): Record<string, boolean | number> {
  const w = canli();
  return {
    etkin, sessizAcik, fareUzerinde, durdurUzerinde, gorevde, yakalama: fareYakalansinMi({ fareUzerinde, durdurUzerinde, kontrolde }), kontrolde, gorevAcmisti, kontrolAcmisti, sonOdakla, acik: adaAcikMi(), gorunur: Boolean(w?.isVisible()), odakta: Boolean(w?.isFocused()),
    anaOnde: anaOnde(), anaOndeGercek, kapali: adaKapali(), kullaniciActi, kuyruk: kuyruk.uzunluk, tamEkran: tamEkranSimdi(),
  };
}

// ── Sessiz ada ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Boştayken görünsün: ayar açık, kurulum bitti, ada kapalı/gizli değil (uygulama önde olması sessizDegerlendir'de ayrıca sorulur). */
const sessizGorunsun = (): boolean => { const a = ayarlar(); return a.kurulumTamam && a.gorunum?.adaSessiz !== false && !adaKapali(); };
/** 0.14 T19: Görünüm → "Tam ekranda çentiği gizle" (varsayılan açık; eski ayar alanı yoksa açık sayılır). */
const tamEkrandaGizle = (): boolean => ayarlar().gorunum?.tamEkrandaGizle !== false;

/** "1 saat gizle" sürüyorsa en geç 5 sn'de bir (ve bitişte) ayar yeniden uygulanır: ada kendiliğinden döner. Zamanlayıcılar uykuda
 *  gecikebilir; duvar saatine bakan tek atımlık denetim (ve powerMonitor 'resume') uyanınca bitişi kaçırmaz; yalnız gizleme sürerken kurulur. Test saatiyle
 *  kayınca yeniden kurulur. */
function gizliZamanlayiciKur(): void {
  if (gizliZaman) { clearTimeout(gizliZaman); gizliZaman = null; }
  const kalan = Date.parse(ayarlar().gorunum?.adaGizliBitis ?? '') - saat();
  if (!Number.isFinite(kalan) || kalan <= 0 || cikiyor) return;
  gizliZaman = setTimeout(() => { gizliZaman = null; sessizAyariniUygula(); }, Math.min(kalan + 50, GIZLI_DENETIM_MS));
}

/** Ada kapandı ya da gizlendi (K5): kuyrukta bekleyenler artık adaya inmeyecek — yeniden yönlendirilir (onay Windows bildirimi ya
 *  da uygulama öndeyse tost, Fuber'in sözü düşer); kullanıcının açmadığı ada çekilir. */
function kapaliyaGec(): void {
  for (let o = kuyruk.al(false); o; o = kuyruk.al(false)) {
    if (!olayGecerliMi(o, Date.now())) continue;
    const y = adaYolu(o.kaynak, kosul(false), o.kanal === 'ada:gorunur');
    if (y.tost) yonlendirici.tost(o.kanal, o.veri);
    if (y.bildirim) yonlendirici.bildirim(o.kanal, o.veri);
  }
  if (canli()?.isVisible() && !(etkin && kullaniciActi)) { adadakiOnaylariYonlendir(); adayiCek(); }
}

/** Ayar değişince (ve pencere kurulunca): açıldıysa boştaki ada hemen iner (tam ekran değilse); kapandıysa boştaki ada gizlenir.
 *  Ada kapandı/gizlendiyse kuyruk yeniden yönlendirilir; gizleme bittiyse (zamanlayıcı) bekleyen kuyruk yeniden boşaltılır. */
function sessizAyariniUygula(): void {
  gizliZamanlayiciKur();
  const kapali = adaKapali();
  if (kapali !== sonKapali) {
    sonKapali = kapali;
    if (kapali) kapaliyaGec();
    else kuyruguBosalt();
  }
  const acik = sessizGorunsun();
  // 0.14 T19: "Tam ekranda gizle" değişti: boştaki çentik hemen yeniden değerlendirilir.
  const gizle = tamEkrandaGizle();
  if (gizle !== sonTamEkrandaGizle) { sonTamEkrandaGizle = gizle; if (acik && sessizAcik) sessizDegerlendir(); }
  if (acik === sessizAcik) return;
  sessizAcik = acik;
  if (acik) { sessizDegerlendir(); return; }
  sessizTamEkran = false;
  if (!etkin && !kontrolde) canli()?.hide();
}

/** Tam ekran bilgisi değiştiyse arayüze söylenir: hover tam ekranda açılmaz. */
function tamEkranSoyle(tam: boolean): void {
  if (tam === sonTamEkran) return;
  sonTamEkran = tam;
  dogrudan('ada:tam-ekran', { acik: tam });
}

/** Boştaki ada: tam ekran yoksa görünür (sessiz hal), varsa gizlenir. Ada bir iş için açıkken ya da Fuber ekranı kullanırken
 *  dokunulmaz. Uygulama öndeyken (K4) de gizlenir. Tam ekran son bilinen hâlden (soru yok; 0.14 T22). */
function sessizDegerlendir(): void {
  if (!sessizAcik || cikiyor || etkin || kontrolde) return;
  if (anaOnde()) { if (canli()?.isVisible() && !cekme) adayiCek(); return; }
  const tam = tamEkranSimdi();
  // 0.14 T19: "Tam ekranda gizle" kapalıysa boştaki çentik tam ekranda da kalır (sessizTamEkran "boştaki çentik çekilsin" demektir; hover yine açmaz:
  // ada:tam-ekran gerçeği söyler; onay ve Fuber kuyruğu tam ekranda eski kuralla bekler).
  sessizTamEkran = tam && tamEkrandaGizle();
  tamEkranSoyle(tam);
  const w = canli();
  if (!w) return;
  if (tam && tamEkrandaGizle()) { if (w.isVisible()) w.hide(); }
  else if (anaOnde()) { if (w.isVisible() && !cekme) adayiCek(); }
  else if (!w.isVisible()) { konumla(); w.showInactive(); }
}

/** Arayüz: imleç adanın şeklinin üstüne girdi (true) / çıktı (false). Üstündeyken tıklama adaya, değilken alttaki uygulamaya.
 *  `durdur` (0.11 G10): imleç görev hapındaki Durdur düğmesinin üstünde — Fuber fareyi kullanırken bile bu düğme tıklanır. */
export function adaFare(uzerinde: boolean, durdur = false): void {
  yasamAdimi({ tur: 'fare', uzerinde, durdur, gorunur: Boolean(canli()?.isVisible()) }); // görünür olmayan pencerede "üstünde" bayattır (N1)
  fareyiUygula();
}

/**
 * Bir görev adımı çalışıyor (`g`) / bitti (null) — main.ts `isler:durum` olayından sürer (0.11 G10, spec §8: "ada: görev bir adım çalıştırırken ya da ekranı
 * tutarken küçük hap Görev: <başlık> + Durdur"). Arayüz hapı `ada:gorev` ile çizer (hal kuralı: shared/ada.ts). Ada gösterilmiyorsa hap için açılır —
 * uygulama öndeyken (K4: kokpitteki Görevler kartı zaten görünür), ada kapalıyken (K5) ve tam ekranda açılmaz; adım bitince yalnız hap açtıysa yeniden kapanır.
 */
export function adaGorevAdimi(g: { id: number; baslik: string; ekran: boolean; sayi: number } | null): void {
  const anahtar = JSON.stringify(g);
  if (anahtar === sonGorevAnahtari) return; // durum olayı sık gelir; hap değişmediyse arayüze bir daha yazılmaz
  sonGorevAnahtari = anahtar;
  // Hap kalkarken "Durdur üstünde" bayrağı düşer (mouseleave altından kalkan düğmede hiç gelmez); hap için açılan pencere, ekran kontrolü SÜRÜYORSA
  // kontrol bitince (adaKontrol(false); gerçek sırada kontrol adımdan 1,2–4 sn sonra biter), sürmüyorsa hemen kapanır.
  const kapat = yasamAdimi({ tur: 'gorev', var: g !== null });
  gorevEkranli = Boolean(g?.ekran);
  fareyiUygula();
  dogrudan('ada:gorev', g);
  if (g) gorevdeAc();
  else if (kapat) adaGizle();
}

/**
 * 0.14 T13 (R13): bir sohbet turu "Çalışıyor" eşiğini aştı (`d`: sohbet, adım, süren aracın etiketi) ya da bitti (null) — ajan/dongu.ts sürer (main/olaylar.ts
 * sohbetCalisiyor üzerinden). Arayüz görev hapının yerinde çizer (hal kuralı shared/ada.ts; Durdur → sohbet:durdur). Ada bunun için KENDİLİĞİNDEN açılmaz
 * (0.14 T23 de değiştirmez: tur kullanıcının başlattığı iştir, çentik görünürken — "sessizken görünsün" varsayılan açık — hap çizilir; görev hapı ve ekran
 * kontrolü kendiliğinden açılabilir). T23 çizimi: karakter (şapka düzeltme) + halka + "Adım N" + Durdur. Aynı hap yeniden yazılmaz.
 */
let sonCalisiyorAnahtari = 'null';
export function adaSohbetCalisiyor(d: { sohbetId: number; adim: number; etiket: string } | null): void {
  const anahtar = JSON.stringify(d);
  if (anahtar === sonCalisiyorAnahtari) return;
  sonCalisiyorAnahtari = anahtar;
  dogrudan('ada:calisiyor', d);
}

/**
 * 0.14 T23: Alt+Shift+Q (main.ts acilDurdur). Açık panel kapanır, Çalışıyor hapı hemen düşer (tur durdu; turun kendi `bitti`si beklenmez — hap bir an bile
 * Durdur'la kalmasın). Arayüz 'ada:acil' ile ikisini birden yapar. Pencere kapanmaz (yarım iş arayüzde temizlenir).
 */
export function adaAcilDurdur(): void {
  sonCalisiyorAnahtari = 'null';
  dogrudan('ada:acil', {});
}

/**
 * 0.14 T23: ana süreç paneli bir sayfayla açtırır (`ada:sayfa`; T24–T27: ör. Odak bitti, Raf'a bırakma). Kullanıcının çağrısıdır (kapıdan geçmez): ada
 * gösterilir ve arayüz paneli o sayfada sabitler. `odakla` verilmezse klavye odağı alınmaz.
 */
export function adaSayfaAc(id: SayfaKimligi, o: { odakla?: boolean } = {}): void {
  adaGoster({ odakla: o.odakla, kullanici: true });
  dogrudan('ada:sayfa', { id });
}

/** Ada hap için açılır mı — kural shared/ada.ts gorevHapiInsinMi (uygulama önde, ada kapalı, tam ekran; sessiz saat / rahatsız etme yalnız ekranı
 *  tutan adımda geçilir). Sessiz saatte açılmayan ada hap için sonradan da inmez; hap görünür ada için (kullanıcı açtıysa) yine çizilir. */
function gorevdeAc(): void {
  const insin = (tam: boolean): boolean => gorevHapiInsinMi({ anaOnde: anaOnde(), kapali: adaKapali(), tamEkran: tam, sessiz: yonlendirici.sessiz?.() ?? false, ekran: gorevEkranli });
  if (!insin(false) || canli()?.isVisible()) return;
  const tam = tamEkranSimdi(true);
  if (!gorevde || !insin(tam)) return; // tam ekranda açılmaz: tam ekran bitince (tamEkranOlayi) yeniden denenir
  adaGoster();
  gorevAcmisti = true; // adaGoster bayrağı sıfırlar; bu açılış görev hapının
}

/**
 * Fuber bilgisayarı kullanıyor (true) / bıraktı (false) — imlec.ts kancası. Ada ekran görüntüsüne GİRMEZ (içerik koruması;
 * gizle/göster yok → titreme yok, model adayı da görmez) ve tıklamayı hep alta geçirir (Fuber'in tıklaması adaya takılmasın).
 * Arayüz `ada:kontrol` ile "Fuber ekranında çalışıyor" halini çizer; ada kapalıysa (tam ekran dışında) bunun için açılır ve
 * kontrol bitince yeniden KAPANIR — yalnız kontrol açtıysa: kontrol sürerken kullanıcı/kapı (hatırlatma, onay, ses) gösterdiyse
 * ya da ada zaten açıktıysa açık kalır (kısayol "görünürse gizle" mantığı da açık-ama-görünmez pencereye takılmasın).
 */
export function adaKontrol(acik: boolean): void {
  const kapat = yasamAdimi({ tur: 'kontrol', acik });
  const w = canli();
  if (!w) return;
  w.setContentProtection(acik);
  fareyiUygula();
  dogrudan('ada:kontrol', { acik });
  if (acik) kontroldeAc();
  else if (kapat) adaGizle(); // yalnız kontrol için ya da (adım bitmişse) yalnız görev hapı için açılan pencere
}

/** Fuber ekranı kullanıyor ve ada görünmüyor: "ekranda" hali için açılır — tam ekranda, uygulama öndeyken (K4) ve ada kapalıyken
 *  (K5) açılmaz (Fuber'in kendi imleci ve kenar ışığı ekranda kalır). Uygulama arkaya geçince ya da tam ekran bitince yeniden denenir. */
function kontroldeAc(): void {
  if (anaOnde() || adaKapali()) return;
  const tam = tamEkranSimdi(true);
  if (!kontrolde || !insinMi('fuber', tam) || canli()?.isVisible()) return;
  adaGoster();
  kontrolAcmisti = true; // adaGoster bayrağı sıfırlar; bu açılış kontrolün
}

// ── Tam ekran kapısı + kuyruk ───────────────────────────────────────────────────────────────────────────────────
/**
 * Arayüze olay gönderir ve adayı gösterir — tam ekran kuralına uyarak. Kullanıcının kendi açtığı ada ve hatırlatıcı her
 * zaman iner (kapıya sorulmaz, gecikme yok); Fuber'in kendi bildirimi ve onay tam ekranda kuyrukta bekler. Kuyrukta bekleyen
 * olay bayatlayabilir (`olayGecerliMi`): `gecerli` teslim anında sorulur (ör. onay hâlâ yanıt bekliyor mu); 30 dk'dan eski Fuber
 * olayı düşer. `zaman`: olayın oluştuğu an (varsayılan şimdi; yalnız test kancası eskitir).
 * Önce yol (K4, K5; shared/ada.ts `adaYolu`): uygulama öndeyse tost (onay ayrıca bekler), ada kapalı/gizliyse hatırlatma ve onay
 * Windows bildirimi — `bildirildi`: çağıran Windows bildirimini zaten gösterdi (zamanlayıcının hatırlatıcısı), ikincisi olmaz.
 * 'ada:gorunur' (adada bekleyenlerin yeniden inişi) yeni bir mesaj değildir: tost/bildirim olmaz. Fuber'in kendi sözü kapıdan geçse de adayı açmaz (`teslim`).
 */
export function adaGonder(kanal: string, veri: unknown, kaynak: AdaKaynak, o: { gecerli?: () => boolean; zaman?: number; bildirildi?: boolean } = {}): void {
  const olay: AdaOlayi = { kaynak, kanal, veri, zaman: o.zaman ?? Date.now(), gecerli: o.gecerli };
  // Tam ekran "var" sayılır: tam ekranda da inebilenler (kullanıcı, hatırlatıcı) yardımcıya sorulmadan hemen iner; gerisi kuyrukta
  // tam ekran sorulup teslim edilir (eski kural). Uygulama önde / ada kapalı kararları tam ekrandan bağımsızdır.
  const y = adaYolu(kaynak, kosul(true), kanal === 'ada:gorunur');
  if (y.tost) yonlendirici.tost(kanal, veri);
  if (y.bildirim && !o.bildirildi) yonlendirici.bildirim(kanal, veri);
  if (y.ada === 'simdi') { teslim(olay); return; }
  if (y.ada === 'yok') return;
  kuyruk.ekle(olay);
  kuyruguBosalt();
}

function teslim(o: AdaOlayi): void {
  if (cikiyor) return; // çıkış sürerken gelen ya da kuyruktan çıkan olay pencereyi yeniden yaratmasın
  // 0.13: Fuber'in kendi sözü adayı AÇMAZ. Yalnız burada korunur: adaGonder tam ekranı "var" sayarak yol seçtiği için Fuber olayı kuyruktan geçip buraya gelir.
  // Kuyruktan çıkarken uygulama öne geldiyse ya da ada kapandıysa (yol 'nokta' değil) söz düşer: mesaj sohbette. Kapıdan gelen "yeniden iniş" görünmez pencerede "açıldı" demez.
  if (o.kaynak === 'fuber') {
    if (adaYolu('fuber', kosul(false)).ada === 'nokta' && o.kanal !== 'ada:gorunur') dogrudan(o.kanal, o.veri);
    return;
  }
  adaGoster({ kullanici: o.kaynak === 'kullanici' });
  if (o.kaynak === 'hatirlatma') hatirlatmaGosterildi = true;
  dogrudan(o.kanal, o.veri);
  const onayId = o.kanal === 'asistan:onay' ? (o.veri as { istek?: { id?: string } } | null)?.istek?.id : undefined;
  if (onayId) adadakiOnaylar.set(onayId, o);
}

/** Tam ekran değilse kuyruktakileri öncelik sırasıyla teslim eder; tam ekranda inemeyenler kuyrukta kalır ve tam ekran bitince olayla çıkar
 *  (tamEkranOlayi; zamanlayıcı yok). Uygulama öndeyken (K4) ve ada kapalıyken hiçbir şey çıkmaz: ana pencere arkaya geçince (adaAnaOndeYenile) ya da
 *  ada açılınca (sessizAyariniUygula) yeniden boşaltılır. */
function kuyruguBosalt(): void {
  if (cikiyor || anaOnde() || adaKapali()) return;
  const tam = tamEkranSimdi(true); // teslim çentiği imlecin ekranına indirir: karar o ekrana göre
  for (let o = kuyruk.al(tam, anaOnde()); o; o = kuyruk.al(tam, anaOnde())) if (olayGecerliMi(o, Date.now())) teslim(o);
}
