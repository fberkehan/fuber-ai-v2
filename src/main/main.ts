// ── Fuber AI — masaüstü giriş noktası ────────────────────────────────────────────────────────────────────────
// Pencereler: ANA (kokpit + sohbet + hafıza + bağlantılar + ayarlar), ADA (üst ortadan inen çentik: sesli asistan,
// hatırlatma ve onaylar; ada.ts), KULAK (görünmez; "Hey Fuber" uyandırma sözcüğünü çevrimdışı dinler). Pencere kapatılınca uygulama sistem
// tepsisinde çalışmayı sürdürür (hatırlatıcılar, sabah özeti, e-posta takibi, uyandırma). Arayüz `fuber://app/`
// özel protokolünden yüklenir (aynı köken: ses modeli, beyin videosu, yazı tipi fetch ile alınabilir).
// 0.12 H6 (Ruling P12): ortam kapısı İLK içe aktarımdır — kurulu uygulamada izin verilmeyen test adreslerini öteki modüller okumadan siler.
import './ortam-kapisi.js';
import { app, BrowserWindow, protocol, net, session, Tray, Menu, nativeImage, nativeTheme, globalShortcut } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { yollar, klasorHazirla } from './yollar.js';
import { veritabani } from './vt.js';
import { ayarlar, ayarlariKaydet, ayarDinle } from './ayarlar.js';
import { ipcKur, bekleyenSilmeleriUygula, silmeleriSurdur } from './ipc.js';
import { yayinla, anaDinle } from './olaylar.js';
import { saatDinle } from './saat.js';
import { motorDurumu } from './abonelik.js';
import { temelAraclariKaydet } from './ajan/araclar/temel.js';
import { gunKaydiAraclariniKaydet } from './ajan/araclar/gunkaydi.js';
import { kartAraciniKaydet } from './ajan/araclar/kart.js';
import { islerAraclariniKaydet } from './ajan/araclar/isler.js';
import { islerBaslat, tumIsleriDurdur, isListesi } from './isler/zamanlayici.js';
import { isIziBaslat, isIziTohumla } from './is-izi.js';
import { tumSurecleriDurdur, surecListesi } from './ajan/surec-yoneticisi.js';
import { claudeCodeAraclariniKaydet } from './claudecode/araclar.js';
import { ccOnbellekYolu, ccTara } from './claudecode/indeks.js';
import { claudeYolu } from './claudecode/baslat.js';
import { ccKapat, ccKapanisGerekli } from './claudecode/yonetim.js';
import { aracBul } from './ajan/araclar/kayit.js';
import { epostaAraclariniKaydet } from './entegrasyon/eposta.js';
// WhatsApp bağlantısı isteğe bağlı bir modülde (bu depoda yok; varsa build-main.mjs ekler); genel kod yalnız kapıyla konuşur.
import { whatsappAraclariniKaydet, whatsappKapisiniBaslat, whatsappBagli } from './entegrasyon/whatsapp-kapisi.js';
import { mcpAraclariniKaydet, mcpSirlariniTasi, mcpSirDurumunuDenetle } from './entegrasyon/mcp.js';
import { katalogYenile as mcpKatalogYenile, mcpKatalogBaglantilariniKapat } from './entegrasyon/mcp-katalog.js';
import { tarayiciAraclariniKaydet } from './tarayici.js';
import { webAraclariniKaydet } from './ajan/araclar/web.js';
import { bilgisayarAraclariniKaydet, bilgisayarKapat, girdiYardimcisiniDurdur } from './bilgisayar.js';
import { imlecKorumaKancasi, kontrolBasla, kontrolBitir } from './imlec.js';
import { beyinBagla, beyinBasla, sinyal } from './beyin.js';
import { hazirMi } from './motor/secici.js';
import { yerelTekMotorMu } from './motor/yerel.js';
import { yerelTaban, yerelDurdur, yerelYenidenBaslat, yerelSunucuBildirici, yerelSunucuDurumu } from './yerel/sunucu.js';
import { yerelKurulumBildirici, bekleyenDenetle, yerelSesiTamamla } from './yerel/kurulum.js';
import { katalogBildirici, katalogYenile } from './yerel/katalog.js';
import { acilistaGizliDenetle, acilistaYalnizYerelGocu } from './yerel/gizli-geri-al.js';
import { piperKapat } from './yerel/piper.js';
import { sesiHerYerdeKes, dikteleriKapat } from './ses.js';
import { yerelDurumu } from './yerel/durum.js';
import { epostaHesaplari } from './entegrasyon/eposta.js';
import { dusunmeBaslat, kulakYenilendi, kulakAyari, gizliKapandi } from './gunkaydi/dusunme.js';
import { gizliKapanisi } from './yerel/gizli-kapanis.js';

import { dosyaAraclariniKaydet, iceAktarmayiBaslat } from './iceaktar.js';
import { dosyaYazAraclariniKaydet } from './ajan/araclar/dosya-yaz.js';
import { komutAraciniKaydet } from './ajan/araclar/komut.js';
import { bosSohbetleriArsivle, proaktifYankilariSupur } from './sohbet-temizlik.js';
import { bekleyenVeriIsleminiUygula } from './veri/temizlik.js';
import { acilDurdurmaKisayolu, tepsiDurdurEtiketi, genelKisayolSorunu, type KisayolDurumu } from '../shared/genel-kisayol.js';
import { acilKisayolAlindi } from './acil-kisayol.js';
import { kisayolOkunur } from '../shared/kisayol.js';
import { zamanlayiciBaslat, bildirimGoster, sessizMi } from './zamanlayici.js';
import { hepsiniDurdur, turSonrasiBekliyor, turSonrasiniBitir } from './ajan/dongu.js';
import { kokpitYenile } from './kokpit/duzen.js';
import { temaKur, pencereZemini } from './tema.js';
import { kabukSecenekleri, kabukBagla, pencereKanallariniKur, pencereIkonu, pencereIkonlariniKur } from './pencere-kabugu.js';
import { kimligiKur, kimlikGaspiniTemizle } from './kabuk-kimligi.js';
import { tepsiIkonuAdi } from '../shared/pencere.js';
import { DAGITIM } from '../shared/dagitim.js';
import { adimdakiGorev } from '../shared/isler-gorunum.js';
import type { IsOzet } from '../shared/isler.js';
import { adaOlustur, adaGoster, adaGizle, adaPencere, adaGonder, adaFare, adaGorevAdimi, adaKontrol, adaAcikMi, adaKisayolDurumu, adayaGonder, adaAnaOnde, adaYonlendiriciKur, adaAcilDurdur } from './ada.js';
import { olayYardimcisiBaslat, olayYardimcisiniKapat, olayYardimcisiniOldur, yardimciyaGonder } from './olay-yardimcisi.js';
import { klavyeGerekli, uyariAnahtarlari } from '../shared/sistem-uyarilari.js';
import { ortakTercih, gezinmeKalkani } from './pencere-ortak.js';
import { kisayolKarari, soyleKaynagi, type AdaKaynak } from '../shared/ada.js';
import { bolgeKapaliNedeni } from '../shared/beyin.js';
import { kulakKarari, UYANDIRMA_DUSTU_METNI, uyandirmaGecisi, type UyandirmaDurumu } from '../shared/uyandirma-ayar.js';
import { adaMotoru, kopmaSayilirMi, motorGorunumu } from '../shared/motor-durumu.js';
import { arkaPlanTestKipiniKur } from './arka-plan-test.js';
import { protokolKaydiSerbestMi } from '../shared/ortam-kapisi.js';
import { acilisKapisi } from './acilis.js';
import { toplantiEkranSesiKur, toplantiEkranSesiIstegiMi, toplantiKapat, toplantiRaporlariniBekle } from './toplanti.js';
import { mediaIzniVerilir } from '../shared/toplanti-kaynak.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'fuber', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// Testler (FUBER_VERI) Electron profilini de (IndexedDB, çerezler, tarayıcı oturumu) kendi klasöründe tutsun.
if (process.env.FUBER_VERI) app.setPath('userData', path.join(process.env.FUBER_VERI, 'electron-profil'));
// A10 (son düzeltme, Ruling E): "--cikis" ikinci örnek işareti — kurulum programı yükseltmede önce bununla ister: çalışan örnek nazikçe çıkar
// (normal çıkış akışı: before-quit → bekleyen silmeler uygulanır). İşaretli örnek kendisi hiçbir şey açmadan çıkar (çalışan örnek
// yoksa da). İkinci örnek (kilidi alamayan) eskisi gibi çıkar; ikisinde de pencere/veritabanı kurulmaz (whenReady erken döner).
const cikisIstegi = process.argv.includes('--cikis');
const ikinciOrnek = !app.requestSingleInstanceLock();
if (ikinciOrnek || cikisIstegi) app.quit();
// 0.11 G2 (spec §2): "Yeni başla" / "Verilerimi sil" uygulamayı yeniden açtı — işlem şimdi, ayarlar ve veritabanı AÇILMADAN (açık dosya
// taşınmaz/silinmez) ve yalnız birinci örnekte (main/veri/temizlik.ts; işlem yoksa hiçbir şeye dokunmaz).
if (!ikinciOrnek && !cikisIstegi) {
  try {
    const r = bekleyenVeriIsleminiUygula(yollar.veri());
    if (r.yapildi) console.info(`[veri] ${r.yapildi} uygulandı${r.yedek ? ` (yedek: ${path.basename(r.yedek)})` : ''}${r.atlanan?.length ? `; atlanan: ${r.atlanan.join(', ')}` : ''}`);
  } catch (e) { console.error('[veri] bekleyen işlem uygulanamadı:', (e as Error).message); }
}
// Kulak (gizli pencere) kullanıcı etkileşimi olmadan mikrofonu/AudioContext'i başlatabilmeli; asistan sesli yanıtı çalabilmeli.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 12 Kas Toplantı modu önizlemesi (YALNIZ FUBER_DEMO; scripts/dev/toplanti-onizle.mjs): Chromium'un sahte ses aygıtı bir WAV dosyasını mikrofon gibi verir —
// gerçek yakalama hattı (AudioWorklet → işçi → VAD → IPC) hoparlör ve mikrofon açılmadan sürülür. Kullanıcının makinesinde bu değişken yoktur.
if (process.env.FUBER_DEMO && process.env.FUBER_TOPLANTI_DENEME_SESI) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.FUBER_TOPLANTI_DENEME_SESI);
}
// 28 Eki: önizleme/test koşuları (FUBER_DEMO) kullanıcının ekranına gelmez, odak çalmaz — ilk pencereden önce (arka-plan-test.ts).
arkaPlanTestKipiniKur();
// 0.10 E1 (K7): Windows kimliği (paketli = NSIS kısayolu; geliştirme koşusu ayrı) ve her pencereye Fuber ikonu — ilk pencereden önce.
kimligiKur();
pencereIkonlariniKur();

let ana: BrowserWindow | null = null;
let kulak: BrowserWindow | null = null;
/** Uyandırma motorunun durumu (0.13 T8): kulak bildirir; 'vazgecti' kulağı gereksiz kılabilir (kulakKur), Ayarlar satırı okur. */
let uyandirmaDurumu: UyandirmaDurumu = 'calisiyor';
let tepsi: Tray | null = null;
let cikiyor = false;

function anaOlustur(goster: boolean): void {
  // Görev 22 (K12): başlık gizli, Windows kaplaması yok — küçült/büyüt/kapat düğmelerini arayüz çizer (renderer/pencere);
  // macOS'ta trafik ışıkları 38 px şeridin ve 68 px rayın ortasında.
  ana = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1080, minHeight: 680, show: false, backgroundColor: pencereZemini(), title: DAGITIM.urunAdi,
    ...kabukSecenekleri(38, 68),
    webPreferences: ortakTercih(),
  });
  ana.setMenu(null);
  kabukBagla(ana);
  gezinmeKalkani(ana);
  void ana.loadURL('fuber://app/index.html');
  ana.once('ready-to-show', () => { if (goster) { ana?.show(); ana?.focus(); } });
  // 0.11 G11: açılış örtüsü ana pencerenin SÜREÇTEKİ ilk gerçek gösteriminde oynar (`--gizli` başlangıçta tepsiden açılana dek beklenir).
  ana.once('show', () => acilisKapisi.gosterildi());
  ana.on('close', (e) => { if (!cikiyor) { e.preventDefault(); ana?.hide(); } });
  // Windows oturumu kapanıyor/yeniden başlıyor: before-quit gelmeyebilir; bekleyen silmeler yine uygulanır.
  ana.on('session-end', () => bekleyenSilmeleriUygula());
  // K4: uygulama öndeyken (ana pencere odaklı ve görünür) ada görünmez; olaylar ada.ts'e iletilir.
  for (const olay of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const) ana.on(olay as 'focus', anaOndeBildir);
  // "Geri al" tostunun duraklatması takılı kalmasın (Görev 20b düzeltme turu 2): pencere odağı kaybedince, gizlenince, küçülünce ya da
  // arayüz yeniden yüklenince/çökünce (fare ayrılma olayı hiç gelmez) bekleyen silmelerin süresi kaldığı yerden sürer.
  for (const olay of ['blur', 'hide', 'minimize'] as const) ana.on(olay as 'blur', silmeleriSurdur);
  ana.webContents.on('did-start-loading', silmeleriSurdur);
  ana.webContents.on('render-process-gone', silmeleriSurdur);
}

/** Ana pencere odaklı, görünür ve simge durumunda değil mi → ada.ts (uygulama önde: ada çekilir, mesajlar tost olur). */
function anaOndeBildir(): void {
  const w = ana && !ana.isDestroyed() ? ana : null;
  adaAnaOnde(Boolean(w && w.isVisible() && !w.isMinimized() && w.isFocused()));
}

/** Ada inmeyecek (K4/K5): mesaj ana pencerede tost olur. Arayüz (renderer/bilesenler/AdaTost.tsx) kanala göre biçimler. */
function anaPencereyeTost(kanal: string, veri: unknown): void {
  if (ana && !ana.isDestroyed()) ana.webContents.send('ana:ada-tost', { kanal, veri });
}

/** Ada kapalı/gizli ve uygulama arkada (K5): hatırlatma ve onay kaybolmasın, Windows bildirimi olur. */
function adaYerineBildirim(kanal: string, veri: unknown): void {
  if (kanal === 'asistan:onay') {
    const v = veri as { sohbetId: number; istek: { baslik: string; aciklama?: string } };
    bildirimGoster(`Onayın gerekiyor · ${v.istek.baslik}`, v.istek.aciklama || 'Fuber bir işlem için onayını bekliyor.', () => anaGoster(`sohbetler/${v.sohbetId}`));
  } else if (kanal === 'asistan:bildir') {
    // Hatırlatıcı "Hatırlatma ·" önekiyle; Fuber'in öteki mesajları (Claude Code izin/bitti, Görev 27) kendi başlığıyla. `yol`: tıklanınca.
    const v = veri as { tur?: string; baslik: string; metin?: string; yol?: string };
    bildirimGoster(v.tur === 'hatirlatma' ? `Hatırlatma · ${v.baslik}` : v.baslik, v.metin || v.baslik, typeof v.yol === 'string' ? () => anaGoster(v.yol) : undefined);
  }
}

export function anaGoster(yol?: string): void {
  if (!ana || ana.isDestroyed()) anaOlustur(true);
  if (ana!.isMinimized()) ana!.restore();
  ana!.show();
  ana!.focus();
  if (yol) ana!.webContents.send('ana:git', yol);
}

// Asistan = ada (ada.ts): kısayol, tepsi ve mikrofon düğmesi adayı kendisi açar (tam ekran kapısı yok); ses, bildirim ve
// onay olayları `adaGonder` ile tam ekran kapısından geçer. `dinle`: sesle sor (yoksa soru kutusu); `odakla`: pencere klavye odağını
// alsın (varsayılan: dinlerken). Kurulumun "Şimdi dene"si dinlemeden ama odakla açar: Esc ve odak kaybı soru kutusuna ulaşsın.
// 'asistan:dinle' sayfa yükleniyorsa yüklenince gider (eskiden kayboluyordu; ada açık sayılıp boş kalıyordu).
// Mikrofon tamamen kapalıysa (sol menü / Ayarlar → Ses) dinlemeye başlamaz: yazı alanı açılır (odak yine istenir).
function asistanGoster(dinle = false, odakla = dinle): void {
  adaGoster({ odakla, kullanici: true });
  adayaGonder('asistan:dinle', { dinle: dinle && !ayarlar().ses.mikrofonKapali });
}
/** `cekildi`: ada arayüzü şekli çoktan topladı (kendi geri çekilmesi); kısayol/tepsi kapatışında false (ada önce geri çekilir). */
function asistanGizle(cekildi = false): void { adaGizle({ cekildi }); }

/** `asistan:bildir`in kaynağı: zamanı gelen hatırlatıcı tam ekranda da iner; Fuber'in kendi mesajı tam ekranda bekler. `asistan:soyle` için bkz. soyleKaynagi. */
const bildirimKaynagi = (tur: string): AdaKaynak => (tur === 'hatirlatma' ? 'hatirlatma' : 'fuber');

const kulakDurumuYayinla = () => yayinla('kulak:durum', { acik: Boolean(kulak && !kulak.isDestroyed()), uyandirma: uyandirmaDurumu });

/** Motor düştü, düzeldi ya da vazgeçti. Kaynak 'hatirlatma': ada kapalıyken bile kaybolmaz (uygulama önde → tost, ada kapalı → Windows bildirimi;
 *  'fuber' kaynağı ada kapalıyken düşerdi, shared/ada.ts adaYolu). Vazgeçince gün kaydı da kapalıysa kulak kapanır, mikrofon bırakılır. */
function uyandirmaDurumuAl(d: UyandirmaDurumu): void {
  const k = uyandirmaGecisi(uyandirmaDurumu, d);
  uyandirmaDurumu = k.durum;
  if (k.soyle) adaGonder('asistan:bildir', { tur: 'mesaj', baslik: '“Hey Fuber”', metin: UYANDIRMA_DUSTU_METNI }, 'hatirlatma');
  kulakDurumuYayinla();
  if (k.kulakYenile) kulakKur();
}

function kulakOlay(v: { tur: string; [k: string]: unknown }): void {
  if (v.tur === 'uyandirma') {
    if (v.durum === 'calisiyor' || v.durum === 'dustu' || v.durum === 'vazgecti') uyandirmaDurumuAl(v.durum);
    return;
  }
  if (v.tur !== 'uyandi') { adaPencere()?.webContents.send('asistan:ses', v); return; }
  // Söz kesme (düzeltme 5): kullanıcı konuşmaya başladı — Fuber'in sesi yalnız adada değil BÜTÜN pencerelerde anında susar.
  sesiHerYerdeKes();
  sinyal('kulak', 'uyanma', '"Hey Fuber"');
  beyinBasla('uyanma', 'asistan uyandı')(false, 'soruyu dinliyor');
  adaGonder('asistan:ses', v, 'kullanici'); // "Hey Fuber" kullanıcının kendi çağrısı: tam ekranda da iner
}
function kulakKomut(v: { tur: 'dinle' | 'bekle' | 'devam'; ms?: number }): boolean {
  // Sayfası yüklenmemiş kulak komutu dinleyemez; false → asistan kendisi dinler. (Model hazır değilse kulak 'hata' bildirir.)
  if (!kulak || kulak.isDestroyed() || kulak.webContents.isLoading()) return false;
  kulak.webContents.send('kulak:komut', v);
  return true;
}

function kulakKur(): void {
  // Kulak hem "Hey Fuber" hem gün kaydı (düşünme motoru) için açılır; hangisinin çalışacağını kulak kendisi sorar.
  // Gün kaydı yalnız şu an dinlemesi gerekiyorsa (çalışma saati, kilit, duraklatma) mikrofonu tutar. Mikrofon tamamen kapalıysa
  // kulak hiç açılmaz (açıksa kapatılır: mikrofon gerçekten bırakılır).
  const { uyandirma, mikrofonKapali } = ayarlar().ses;
  const k = kulakKarari({ durum: uyandirmaDurumu, mikrofonKapali, uyandirma, gunKaydi: kulakAyari().gunKaydi, kurulumTamam: ayarlar().kurulumTamam });
  const durumDegisti = k.durum !== uyandirmaDurumu;
  uyandirmaDurumu = k.durum;
  if (!k.gerekli) { if (kulak && !kulak.isDestroyed()) { kulak.destroy(); kulak = null; } kulakDurumuYayinla(); return; }
  // Pencere gün kaydı için yaşıyor olabilir: burada yayınlanmasa Ayarlar satırı "çalışmıyor"da kalırdı.
  if (durumDegisti) kulakDurumuYayinla();
  if (kulak && !kulak.isDestroyed()) return;
  kulak = new BrowserWindow({ width: 320, height: 240, show: false, skipTaskbar: true, webPreferences: { ...ortakTercih(), backgroundThrottling: false } });
  gezinmeKalkani(kulak);
  kulak.webContents.on('did-finish-load', () => kulakYenilendi());
  void kulak.loadURL('fuber://app/kulak.html');
}

// Hatırlatıcının Windows bildirimini zamanlayıcı kendisi gösterir (uygulama arkadayken): ada kapalıyken ikincisi olmaz.
function asistanaGonder(v: { tur: 'hatirlatma' | 'mesaj'; baslik: string; metin: string }): void {
  adaGonder('asistan:bildir', v, bildirimKaynagi(v.tur), { bildirildi: v.tur === 'hatirlatma' });
}

let kayitliKisayol: string | null = null; // asistan kısayolu olarak GERÇEKTEN alınmış olan
// Acil durdurma GERÇEKTEN alındı mı (Görev 20b düzeltme turu 2): başka bir uygulamada kayıtlıysa register false döner; o zaman tepsi
// ve Ayarlar tuşu söz vermez, kullanıcıya bir kez bildirilir.
let acilAlindi: boolean | null = null;
let acilUyarildi = false;
/** A12: kayıtlı asistan kısayolu neden alınamadı (yasak küme ya da başka uygulama); bildirimi bir kez gösterilen değer. */
let asistanSorunu: string | undefined;
let asistanUyarilan: string | null = null;
/** Genel kısayolların gerçek durumu (Ayarlar okur: `kisayol:durum`; değişince `kisayol:degisti`). */
function kisayolDurumu(): KisayolDurumu {
  const asistan = ayarlar().ses.kisayol;
  const alindi = kayitliKisayol === asistan;
  return { acil: { tus: acilDurdurmaKisayolu(), alindi: acilAlindi === true }, asistan: { tus: asistan, alindi, ...(alindi || !asistanSorunu ? {} : { sorun: asistanSorunu }) } };
}
let tepsiImza = '';
/** Son kurulan tepsi menüsü: Tray menüyü geri vermez; özellik denetimi (scripts/dev/ozellik-denetimi.mjs) yalnız FUBER_DEMO'da okur/tıklar. */
let tepsiMenu: Menu | null = null;
if (process.env.FUBER_DEMO) (globalThis as { __fuberTepsiMenusu?: () => Menu | null }).__fuberTepsiMenusu = () => tepsiMenu;

/** Tepsi menüsü ayardan kurulur; ayar değişince (Ayarlar'dan "Hey Fuber" ya da kısayol) kendiliğinden tazelenir. */
function tepsiMenusu(): void {
  if (!tepsi || tepsi.isDestroyed()) return;
  const uyandirma = ayarlar().ses.uyandirma;
  const mikrofonKapali = ayarlar().ses.mikrofonKapali;
  const g = ayarlar().gunKaydi;
  const duraklatildi = Boolean(g.duraklatBitis && new Date(g.duraklatBitis).getTime() > Date.now());
  const imza = `${kayitliKisayol ?? ''}|${acilAlindi}|${uyandirma}|${mikrofonKapali}|${g.etkin}|${g.duraklatBitis ?? ''}`;
  if (imza === tepsiImza) return;
  tepsiImza = imza;
  tepsi.setContextMenu(tepsiMenu = Menu.buildFromTemplate([
    { label: 'Fuber\'i aç', click: () => anaGoster() },
    { label: 'Fuber\'e sor', accelerator: kayitliKisayol ?? undefined, click: () => asistanGoster(true) },
    mikrofonKapali
      ? { label: '“Hey Fuber” · mikrofon kapalı', enabled: false }
      : { label: uyandirma ? '“Hey Fuber” dinlemesini durdur' : '“Hey Fuber” dinlemesini başlat', click: () => { ayarlariKaydet((a) => { a.ses.uyandirma = !a.ses.uyandirma; }); kulakKur(); } },
    ...(g.etkin ? [
      { type: 'separator' as const },
      { label: duraklatildi ? `Gün kaydı duraklatıldı (${new Date(g.duraklatBitis!).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}'e kadar)` : 'Gün kaydı açık', enabled: false },
      duraklatildi
        ? { label: 'Gün kaydını sürdür', click: () => ayarlariKaydet((a) => { a.gunKaydi.duraklatBitis = undefined; }) }
        : { label: 'Gün kaydını 1 saat duraklat', click: () => ayarlariKaydet((a) => { a.gunKaydi.duraklatBitis = new Date(Date.now() + 3600_000).toISOString(); }) },
    ] : []),
    { type: 'separator' },
    // Tuş yalnız gerçekten alındıysa yazılır (başka bir uygulama kullanıyorsa söz verilmez).
    { label: tepsiDurdurEtiketi(acilAlindi === true, kisayolOkunur(acilDurdurmaKisayolu(), process.platform === 'darwin')), click: acilDurdur },
    { label: 'Çık', click: () => { cikiyor = true; app.quit(); } },
  ]));
}

/** Tepsi ikonu (Görev 22, K13): tek renk ürün işareti — Windows'ta görev çubuğunun temasına göre (koyu çubukta beyaz, açıkta
 *  mürekkep; uygulamanın kendi temasından bağımsız), macOS'ta menü çubuğu şablonu (sistem boyar). */
function tepsiResmi(): Electron.NativeImage {
  const ad = tepsiIkonuAdi(process.platform, nativeTheme.shouldUseDarkColorsForSystemIntegratedUI);
  const r = nativeImage.createFromPath(yollar.kaynak('ikon', ad));
  if (process.platform === 'darwin') r.setTemplateImage(true);
  return r.isEmpty() ? pencereIkonu().resize({ width: 16, height: 16 }) : r;
}

function tepsiKur(): void {
  let ad = tepsiIkonuAdi(process.platform, nativeTheme.shouldUseDarkColorsForSystemIntegratedUI);
  tepsi = new Tray(tepsiResmi());
  // Windows'ta görev çubuğu açık/koyu değişince işaret de değişir.
  nativeTheme.on('updated', () => {
    const yeni = tepsiIkonuAdi(process.platform, nativeTheme.shouldUseDarkColorsForSystemIntegratedUI);
    if (yeni === ad || !tepsi || tepsi.isDestroyed()) return;
    ad = yeni;
    tepsi.setImage(tepsiResmi());
  });
  tepsi.setToolTip(DAGITIM.urunAdi);
  tepsiMenusu();
  ayarDinle(() => tepsiMenusu());
  tepsi.on('click', () => anaGoster());
}

function acilDurdur(): void {
  // Önce bellekteki turlar (veritabanına bağlı değil). 0.11 G9: sonra süren Görevler ('acil'; kendiliğinden sürmez) — bir kayıt hatası acil
  // durdurmanın kalanını (ses, imleç, girdi yardımcısı) engellemez.
  let n = hepsiniDurdur();
  try { n += tumIsleriDurdur('acil'); } catch (e) { console.warn('[görev] acil durdurma:', (e as Error).message); }
  // Fuber'in sesi de anında susar (Görev 21): üretilen konuşmalar kesilir, pencerelerdeki çalar durur.
  sesiHerYerdeKes();
  kontrolBitir();
  // Uzun bir `yaz` komutu yardımcı süreçte sürüyor olabilir: süreci öldür (gerektiğinde yeniden açılır).
  girdiYardimcisiniDurdur();
  // 0.14 T23: çentikte açık panel kapanır, Çalışıyor hapı düşer (tur zaten durdu; olayını beklemeden).
  adaAcilDurdur();
  if (n) bildirimGoster('Fuber durduruldu', 'Sürmekte olan bütün işler kesildi.');
}

// Ada açıksa kapatır, değilse açıp dinler. "Sessizken görünsün"de boştaki ada görünür ama açık sayılmaz (ada.ts adaAcikMi). Görev 28
// düzeltme 2 (b): ada yalnız Fuber'in acil olmayan bildirimi için açıksa kısayol kapatmaz, sormak için açar (shared/ada.ts kisayolKarari).
const asistanKisayolu = () => (kisayolKarari(adaKisayolDurumu()) === 'gizle' ? asistanGizle() : asistanGoster(true));

/** Asistan kısayolunu ayardakiyle eşitler. Önce YENİSİ alınır, sonra eskisi bırakılır: yenisi alınamazsa (geçersiz ya da
 *  başka uygulamada) eskisi çalışmaya devam eder, kullanıcıya bildirilir ve false döner. */
function kisayollariKaydet(): boolean {
  // Acil durdurma (Görev 20b): artık Ctrl+Alt birleşimi değil — Türkçe klavyede AltGr+Q = "@" yazıyordu (shared/genel-kisayol.ts).
  // Alınamadıysa (başka bir uygulamada) her çağrıda yeniden denenir; bildirim oturumda bir kez.
  const acil = acilDurdurmaKisayolu();
  const acilOnce = acilAlindi;
  if (!globalShortcut.isRegistered(acil)) { try { acilAlindi = globalShortcut.register(acil, acilDurdur); } catch { acilAlindi = false; } }
  else acilAlindi = true;
  acilKisayolAlindi(acilAlindi);
  if (!acilAlindi && !acilUyarildi) {
    acilUyarildi = true;
    bildirimGoster('Acil durdurma kısayolu alınamadı', `${kisayolOkunur(acil, process.platform === 'darwin')} başka bir uygulamada. Fuber’i durdurmak için tepsideki “Tümünü durdur”u kullan.`);
  }
  if (acilAlindi !== acilOnce) { tepsiMenusu(); yayinla('kisayol:degisti', kisayolDurumu()); }
  const yeni = ayarlar().ses.kisayol;
  if (yeni === kayitliKisayol) return true;
  const okunur = kisayolOkunur(yeni, process.platform === 'darwin');
  // A12 (son düzeltme): kayıtlı özel kısayol AÇILIŞTA da denetlenir — yasak kümedeyse (Ctrl+Alt+harf = AltGr karakteri, sistem/yaygın
  // uygulama kısayolu; shared/genel-kisayol.ts) hiç alınmaz (eski sürümün kaydettiği değer her "@" yazışta tetiklenmesin), bir kez
  // bildirilir; Ayarlar → Ses ve ada "alınamadı · değiştir" der (kisayol:durum → asistan.sorun).
  const yasak = genelKisayolSorunu(yeni);
  if (yasak) {
    asistanSorunu = yasak;
    if (asistanUyarilan !== yeni) {
      asistanUyarilan = yeni;
      bildirimGoster('Asistan kısayolu alınmadı', `“${okunur}” kullanılamaz: ${yasak} Ayarlar → Ses ve ada’dan değiştir.`);
    }
    tepsiMenusu();
    yayinla('kisayol:degisti', kisayolDurumu());
    return false;
  }
  let alindi = false;
  try { alindi = globalShortcut.register(yeni, asistanKisayolu); } catch { alindi = false; }
  if (!alindi) {
    asistanSorunu = 'başka bir uygulama kullanıyor ya da geçersiz.';
    bildirimGoster('Kısayol alınamadı', `“${okunur}” kullanılamıyor (geçersiz ya da başka bir uygulamada).${kayitliKisayol ? ` “${kisayolOkunur(kayitliKisayol, process.platform === 'darwin')}” geçerli kalıyor.` : ''}`);
    yayinla('kisayol:degisti', kisayolDurumu());
    return false;
  }
  asistanSorunu = undefined;
  if (kayitliKisayol) { try { globalShortcut.unregister(kayitliKisayol); } catch { /* zaten yok */ } }
  kayitliKisayol = yeni;
  tepsiMenusu();
  yayinla('kisayol:degisti', kisayolDurumu());
  return true;
}

function protokolKur(): void {
  const arayuzKok = path.resolve(yollar.arayuz());
  const kaynakKok = path.resolve(yollar.kaynak());
  protocol.handle('fuber', (istek) => {
    const u = new URL(istek.url);
    const yol = decodeURIComponent(u.pathname);
    const [kok, goreli] = yol.startsWith('/kaynak/') ? [kaynakKok, yol.slice('/kaynak/'.length)] : [arayuzKok, yol.replace(/^\//, '') || 'index.html'];
    const dosya = path.resolve(kok, goreli);
    if (dosya !== kok && !dosya.startsWith(kok + path.sep)) return new Response('yasak', { status: 403 });
    return net.fetch(pathToFileURL(dosya).toString());
  });
}

function izinlerKur(): void {
  const bizden = (url: string) => url.startsWith('fuber://');
  // Mikrofon tamamen kapalıyken (ayar) hiçbir pencere mikrofon izni alamaz: "tamamen kapat" arayüzden bağımsız olarak da geçerli.
  // 13 Kas 0.17.3 (paketli ölçüm, scripts/dev/toplanti-paketli.mjs): getDisplayMedia (bilgisayarın sesi) de 'media' izni ister — mediaTypes BOŞ gelir (mikrofonda ['audio']).
  // Eskiden "mikrofonu tamamen kapat" açıkken ikisi de NotAllowedError alıyordu: Toplantı'da "Ne bilgisayarın sesi ne mikrofon alınabildi". Bilgisayarın sesi mikrofon
  // değildir: yalnız Toplantı başlatılınca açılan kısa pencerede (toplantiEkranSesiIstegiMi) mikrofon kapalıyken de geçer; mikrofonun kendisi kapalı kalır.
  const mikrofonSerbest = (izin: string, ayrinti?: { mediaTypes?: readonly string[] }) =>
    izin !== 'media' || mediaIzniVerilir({ mikrofonKapali: ayarlar().ses.mikrofonKapali, ...(ayrinti?.mediaTypes ? { mediaTypes: ayrinti.mediaTypes } : {}), ekranSesiPenceresi: toplantiEkranSesiIstegiMi() });
  session.defaultSession.setPermissionRequestHandler((wc, izin, cevap, ayrinti) => cevap((izin === 'media' || izin === 'notifications' || izin === 'clipboard-sanitized-write') && bizden(wc.getURL()) && mikrofonSerbest(izin, ayrinti as { mediaTypes?: readonly string[] })));
  session.defaultSession.setPermissionCheckHandler((wc, izin) => (izin === 'media' || izin === 'notifications') && bizden(wc?.getURL() ?? ''));
  // 12 Kas Toplantı modu: bilgisayarın sesi (Windows loopback) yalnız toplantı başlatılınca, kısa bir pencerede (main/toplanti.ts).
  toplantiEkranSesiKur(session.defaultSession);
}

/** 0.11 G2: normal çıkış yoluyla (bekleyen silmeler, Claude Code, yerel sunucu kapanır) kapanıp yeniden açılır. Gizli başlatma ve güncelleme
 *  bayrakları taşınmaz (yeniden açılan pencere görünsün). Önizlemede (FUBER_DEMO) yeniden açmayı betik yapar: yetim süreç kalmasın. */
function yenidenAc(): void {
  if (!process.env.FUBER_DEMO) app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--gizli' && a !== '--updated') });
  cikiyor = true;
  app.quit();
}

// İkinci örnek: uygulamayı öne getirir; "--cikis" ile açıldıysa (kurulum programı) bu örnek nazikçe çıkar — tepsideki "Çık" ile aynı yol.
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--cikis')) { console.log('[çıkış] ikinci örnek --cikis istedi; nazikçe çıkılıyor'); cikiyor = true; app.quit(); return; }
  anaGoster();
});
// Normal çıkışta "Geri al" penceresindeki silmeler uygulanır (Görev 20b): "Unut" deyip hemen kapatan kullanıcının kaydı gerçekten gider.
// Ertelenmiş tur sonrası işler (son konuşmanın hafızası, başlığı; Görev 21 düzeltme 7) çıkıştan önce çalışır — en çok 4 sn beklenir.
// Görev 27 (K17): açık Claude Code oturumları önce interrupt() ile durdurulur, en çok 5 sn beklenir, sonra kapatılır; kalan süreç
// ağacıyla öldürülür (yetim claude.exe kalmaz). İkisi BİRLİKTE beklenir (çıkış en uzun olanı kadar ertelenir), bitince çıkış yeniden
// istenir. Claude Code beklenirken pencereler hemen gizlenir (en çok ~7 sn'lik bekleme donma gibi görünmesin).
let cikisIsleriBitti = false;
let cikisIsleriSuruyor = false;
app.on('before-quit', (e) => {
  cikiyor = true;
  try { tumIsleriDurdur('kapanis'); } catch (h) { console.warn('[görev] kapanışta durdurulamadı:', (h as Error).message); } // 0.11 G9
  // Analiz 11 Kas (bulgu 4): sohbetin arka plan süreçleri (dev sunucusu, izleyici) ağaçlarıyla kapanır; process 'exit' kancası da ayrıca kapatır.
  try { tumSurecleriDurdur(); } catch { /* süreç yok */ }
  // 12 Kas: süren toplantı hemen durur; elde kalan döküm özetsiz bu bilgisayarda saklanır (ağ beklenmez).
  try { toplantiKapat(); } catch (h) { console.warn('[toplantı] kapanışta saklanamadı:', (h as Error).message); }
  bekleyenSilmeleriUygula();
  if (cikisIsleriBitti) return;
  const turSonrasi = turSonrasiBekliyor();
  const claudeCode = ccKapanisGerekli();
  // 0.13 T9: süren dikteler kesilir, süre raporu en çok ~3 sn beklenir (rapor gitmezse sunucuda 120 sn'lik rezerv kalır). Dikte yoksa null.
  const dikte = dikteleriKapat();
  // 14 Kas: süren toplantının canlı akışları kapandı; her bağlantının süre raporu en çok ~3 sn beklenir (toplantı yoksa null).
  const toplantiRaporu = toplantiRaporlariniBekle();
  // 0.14 T22 düzeltme 1: olay yardımcısının stdin'i kapanır; çıkması en çok 2 sn beklenir (çıkmazsa öldürülür). Süreç yoksa null: çıkış beklemez.
  const olayKapanisi = olayYardimcisiniKapat();
  if (!turSonrasi && !claudeCode && !toplantiRaporu && !olayKapanisi && !dikte) return;
  e.preventDefault();
  if (cikisIsleriSuruyor) return;
  cikisIsleriSuruyor = true;
  if (claudeCode) for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.hide(); }
  void Promise.allSettled([
    turSonrasi ? turSonrasiniBitir(4000) : Promise.resolve(),
    claudeCode ? ccKapat() : Promise.resolve(),
    dikte ?? Promise.resolve(),
    toplantiRaporu ?? Promise.resolve(),
    olayKapanisi ?? Promise.resolve(),
  ]).finally(() => { cikisIsleriBitti = true; app.quit(); });
});
app.on('window-all-closed', () => { /* tepside çalışmaya devam */ });
// 0.14 T16: katalog servislerinin bağlantıları (stdio girdisinin alt süreci dahil) kapanır; belirteçler sır yuvasında kalır.
app.on('will-quit', () => { globalShortcut.unregisterAll(); bilgisayarKapat(); olayYardimcisiniOldur(); yerelDurdur(); piperKapat(); void mcpKatalogBaglantilariniKapat(); });

app.whenReady().then(() => {
  if (ikinciOrnek || cikisIstegi) return; // çıkıyor (yukarıda app.quit): pencere, veritabanı, kısayol kurulmaz
  klasorHazirla();
  veritabani();
  // Görev 20b (K11): telefondan açılıp hiç yazılmamış ya da eski sürümden kalan boş "Yeni sohbet"ler arşive (silinmez).
  try { bosSohbetleriArsivle(veritabani()); } catch (e) { console.warn('[sohbet] boş sohbet temizliği olmadı:', (e as Error).message); }
  // 0.11 G2 (G1 incelemesi K3): 0.10.0'dan kalan proaktif yankı balonları bir kez süpürülür (meta bayrağı; sohbet-temizlik.ts).
  try { const n = proaktifYankilariSupur(veritabani()); if (n) console.info(`[sohbet] ${n} eski iç talimat yankısı kaldırıldı`); } catch (e) { console.warn('[sohbet] yankı süpürmesi olmadı:', (e as Error).message); }
  protokolKur();
  izinlerKur();
  temelAraclariKaydet();
  gunKaydiAraclariniKaydet();
  kartAraciniKaydet();
  islerAraclariniKaydet(); // 0.11 G9: Görevler
  claudeCodeAraclariniKaydet();
  if (process.env.FUBER_DEMO) {
    // Önizleme kancası (scripts/dev/cc-motor-onizle.mjs; YALNIZ FUBER_DEMO, IPC kanalı değil): kayıtlı bir sohbet aracını GERÇEK yolundan
    // çalıştırır — model çağrılmaz, onay "bir kez" sayılır.
    // `kaydet`: araç çağrısı ve sonucu sohbete turdaki gibi yazılır (Görev 28: sohbetteki kartın "Oturumu aç"ı önizlemede sınanır).
    (globalThis as { __fuberAracDene?: unknown }).__fuberAracDene = async (ad: string, girdi: Record<string, unknown>, sohbetId: number, kaydet?: boolean) => {
      const a = aracBul(String(ad));
      if (!a) throw new Error(`Araç yok: ${ad}`);
      const r = await a.calistir(girdi ?? {}, { sohbetId: Number(sohbetId), sinyal: new AbortController().signal, onay: async () => 'bir_kez', gorevIzinleri: new Set() });
      if (kaydet) {
        const { mesajEkle } = await import('./sohbet.js');
        const id = `onizleme-${Date.now()}`;
        mesajEkle(Number(sohbetId), { rol: 'assistant', bloklar: [{ tur: 'arac_cagri', id, ad: String(ad), girdi: girdi ?? {} }] });
        mesajEkle(Number(sohbetId), { rol: 'user', kaynak: 'arac', bloklar: [{ tur: 'arac_sonuc', id, ad: String(ad), icerik: r.icerik, hata: r.hata, ...(r.yol ? { yol: r.yol } : {}) }] });
      }
      return r;
    };
    // Önizleme kancası (scripts/dev/ikon-onizle.mjs; YALNIZ FUBER_DEMO, IPC kanalı değil): Fuber imleci katmanını gerçek fare/klavye
    // olmadan açar/kapatır (kontrol oturumu) — katman penceresinin ikonu ölçülsün.
    (globalThis as { __fuberImlecKatmani?: unknown }).__fuberImlecKatmani = (acik: boolean) => { if (acik) kontrolBasla(); else kontrolBitir(); };
  }
  ccOnbellekYolu(path.join(yollar.veri(), 'claude-oturumlar.json'));
  setTimeout(() => void ccTara().catch(() => undefined), 15_000); // açılışı yavaşlatmasın
  epostaAraclariniKaydet();
  whatsappAraclariniKaydet();
  mcpAraclariniKaydet();
  // 0.14 son inceleme I7: eski düz MCP başlık/ortam değerleri sır yuvasına (pencereler açılmadan; düz değer yalnız sır yazımı başarılıysa silinir).
  try { mcpSirlariniTasi(); } catch (e) { console.warn('[mcp] gizli değer göçü atlandı:', (e as Error)?.message ?? e); }
  // Tur 2: gizli değerleri çözülemeyen sunucunun satırı açık hata gösterir (bağlanılmaz).
  try { mcpSirDurumunuDenetle(); } catch (e) { console.warn('[mcp] gizli değer denetimi atlandı:', (e as Error)?.message ?? e); }
  tarayiciAraclariniKaydet();
  webAraclariniKaydet(); // 0.14 T14: web_ara + sayfa_oku (Fuber'in kendi araçları; Gizli'de dongu.ts grupEtkin('web') kapatır)
  bilgisayarAraclariniKaydet();
  dosyaAraclariniKaydet();
  dosyaYazAraclariniKaydet(); // 0.14 T17: dosya yazma, düzenleme, silme, belge üretme
  komutAraciniKaydet(); // 0.14 T18: komut çalıştırma (yalnız Developer mode; dongu.ts grupEtkin)
  ipcKur({ asistanGoster, asistanGizle, anaGoster, kulakYenile: kulakKur, kisayollariKaydet, kisayolDurumu, kulakOlay, uyandirmaDurumu: () => uyandirmaDurumu, kulakKomut, adaFare, asistanKisayolu, acilDurdur, yenidenAc, kapat: () => { cikiyor = true; app.quit(); } });
  pencereKanallariniKur();
  // Bilgisayar kontrolü sürerken ada: ekran görüntüsüne GİRMEZ (içerik koruması; gizle/göster yok → titreme yok) ve
  // tıklamaları alttaki uygulamaya geçirir (Fuber'in tıklaması adaya takılmasın).
  imlecKorumaKancasi(adaKontrol);

  // Tema pencerelerden ÖNCE (ilk kare doğru renkte); her ayar değişikliği pencerelere yayınlanır (tema canlı değişsin).
  temaKur(() => ana);
  ayarDinle((a) => yayinla('ayarlar:degisti', a));
  // Motor sinyali (Ruling K, tek kaynak): ayar, yerel beyin (aşağıda yerelBildir) ya da demo saati değişince pencerelere.
  const motorBildir = () => yayinla('motor:durum', motorDurumu());
  ayarDinle(motorBildir);
  saatDinle(motorBildir);
  adaYonlendiriciKur({
    tost: anaPencereyeTost, bildirim: adaYerineBildirim,
    // Odağı ana pencereden almış ada kapandı: odak ana pencereye döner (simge durumunda ya da gizliyse dokunulmaz).
    anayaOdak: () => { if (ana && !ana.isDestroyed() && ana.isVisible() && !ana.isMinimized()) ana.focus(); },
    // Son inceleme küçük 1: sessiz saatte ve "Rahatsız etme"de görev hapı adayı indirmez (ekranı tutan adım hariç; shared/ada.ts gorevHapiInsinMi).
    sessiz: () => sessizMi(),
  });
  // 0.10 E1 (K7): Başlat menüsünde Fuber'in kimliğini taşıyan geliştirme kısayolu varsa pencerelerden ÖNCE Geri Dönüşüm Kutusu'na
  // taşınır (kabuk-kimligi.ts). Kendisi fırlatmaz; yine de hiçbir hatası ana pencerenin açılmasını engellemesin diye ayrıca sarılı.
  try { kimlikGaspiniTemizle(); } catch (e) { console.warn('[kimlik] kısayol temizliği atlandı:', (e as Error)?.message ?? e); }
  const gizli = process.argv.includes('--gizli');
  anaOlustur(!gizli);
  // 0.14 T22: olay yardımcısı (fuber-olay.exe; tam ekran, sistem uyarıları, medya durumu) — olay güdümlü, yoklama yok. Klavye kancası (Caps Lock, dil) yalnız
  // bu iki uyarıdan biri açıkken kurulur; açılışta ve ayar değişikliğinde değer değiştiyse söylenir (yardımcı yeniden açılınca son istek yinelenir).
  // Düzeltme turu 1 (Minor 1): yalnız değer değişince gider (yardımcı yeniden açılınca son istek zaten yinelenir).
  let sonKlavye: boolean | null = null;
  const klavyeyiUygula = () => {
    const acik = klavyeGerekli(uyariAnahtarlari(ayarlar().gorunum));
    if (acik === sonKlavye) return;
    sonKlavye = acik;
    yardimciyaGonder({ k: 'klavye', acik });
  };
  klavyeyiUygula();
  ayarDinle(klavyeyiUygula);
  olayYardimcisiBaslat();
  adaOlustur();
  tepsiKur();
  kisayollariKaydet();
  kulakKur();
  iceAktarmayiBaslat();
  zamanlayiciBaslat({ pencereyiAc: () => anaGoster(), asistanaGonder });
  // 0.11 G9: önceki oturumdan süren kalmış Görevler "Fuber kapandığı için durdu" olur; kendiliğinden sürmez.
  try { islerBaslat(); } catch (e) { console.warn('[görev] açılış:', (e as Error).message); }
  // İş izi (11 Kas): bütün işlerin tek listesi — sohbet turu, görev, Claude Code oturumu/alt ajanı/işi, arka plan süreci; olayla yayılır (main/is-izi.ts).
  try { isIziBaslat(); isIziTohumla({ gorevler: isListesi(), surecler: surecListesi() }); } catch (e) { console.warn('[iş izi] açılış:', (e as Error).message); }
  // 0.11 G10: bir görev adımı çalışırken ada küçük hap "Görev: <başlık>" + Durdur gösterir (kural: shared/ada.ts; Durdur: isler:durdur).
  anaDinle<IsOzet[]>('isler:durum', (liste) => { try { adaGorevAdimi(adimdakiGorev(liste)); } catch (e) { console.warn('[görev] ada hapı:', (e as Error).message); } });
  // Beyin sayfası: hangi bölge kapalı, hangisi sürekli dinliyor, hangi motor bağlı; bugünün sayaçları ve son olaylar diskte.
  beyinBagla({
    gunlukYolu: path.join(yollar.veri(), 'beyin-gunu.json'),
    motorHazir: (m) => (m === 'yerel' ? yerelTekMotorMu() : hazirMi(m)),
    dinliyor: (b) => {
      const acik = Boolean(kulak && !kulak.isDestroyed());
      if (b === 'kulak') return acik;
      if (b === 'uyanma') return acik && ayarlar().ses.uyandirma;
      return false;
    },
    // Nedenler ve yolları shared/beyin.ts'te (saf, testli; moda göre "Motorlar" / "Hesap ve kullanım").
    // R28c (G2 düzeltme turu 1): Akıl bölgesinin motoru arayüzle AYNI kuraldan (shared/motor-durumu.ts: hesap hâlleri, Gizli mod) — yanıt
    // verilebilir hâl (adaMotoru: yerel yanıtlıyorsa 'yerel').
    kapali: (b) => {
      const a = ayarlar(), g = a.gunKaydi;
      const s = motorDurumu();
      return bolgeKapaliNedeni(b, {
        mod: a.mod, mikrofonKapali: a.ses.mikrofonKapali, uyandirma: a.ses.uyandirma, uyandirmaDurumu, seslendirme: a.ses.seslendirme, gunKaydi: g.etkin,
        eslikciKapali: g.eslikci === 'kapali', bilgisayar: a.yetki.bilgisayar, tarayici: a.yetki.tarayici,
        iletisimVar: Boolean(epostaHesaplari().length || whatsappBagli()),
        motor: adaMotoru(motorGorunumu(s, kopmaSayilirMi(a), a.hesap?.durum), s), gizli: s.gizli, yarim: s.yarim,
        claudeCodeEtkin: a.claudeCode.etkin, claudeBulundu: Boolean(b === 'kod' && a.claudeCode.etkin && claudeYolu()),
      });
    },
  });
  // Yerel beyin: açıksa sıcak tut (ilk yanıt ~0,5 sn); model/GPU/aç-kapa değişince yeniden başlat.
  const yerelBildir = () => { yayinla('yerel:durum', yerelDurumu()); motorBildir(); };
  yerelKurulumBildirici(yerelBildir);
  yerelSunucuBildirici(yerelBildir);
  // 0.13 G: katalog açılışta, hesap açılınca ya da durumu değişince (kurulumun "Nerede çalışsın"ı hesaptan sonra gelir) ve 6 saatte bir tazelenir. Gizli ve "Yalnız bu bilgisayar"da,
  // hesapsız ve anahtarsız ağa çıkmaz (yerel/katalog.ts); başarısız yenileme elde olanı silmez.
  katalogBildirici(yerelBildir);
  void katalogYenile();
  setInterval(() => void katalogYenile(), 6 * 3_600_000).unref();
  // 0.14 T16: MCP kataloğu açılışta, hesap kaydı değişince (giriş, durum, sunucunun yetenekleri) ve saatte bir (hesap durumu denetimiyle aynı aralık)
  // tazelenir. Gizli ve "Yalnız bu bilgisayar"da, hesapsız ve eski sunucuda ağa çıkmaz; arıza önbelleği silmez (entegrasyon/mcp-katalog.ts).
  void mcpKatalogYenile();
  setInterval(() => void mcpKatalogYenile(), 3_600_000).unref();
  // İstenen kurulumun kaydı kaldıysa: model doğrulanmış inmişse tamamlanır (yerel beyin açılır); değilse arayüz "yarıda kaldı" der.
  bekleyenDenetle();
  // Son bütün dal incelemesi K-1: 0.12 öncesinden kalan "Yalnız bu bilgisayar" değeri (0.11'de yalnız Geliştirici'de ve yerel hazırken etkindi)
  // bilerek seçilmediyse sessizce yerel kipe düşürmez — bir kez, işaretle (yerel/gizli-geri-al.ts). Ayar yazılamazsa açılış sürer (işaret
  // yazılmadığı için sonraki açılışta yeniden denenir).
  try { acilistaYalnizYerelGocu(); } catch (e) { console.warn(`[yerel] 0.12 göçü bu açılışta yapılamadı: ${(e as Error)?.message ?? e}`); }
  // F1 düzeltme turu 1 (N-1): açılışta bir kez değişmez kural — Gizli açık ama bu bilgisayardaki yapay zekâ ne hazır ne hazırlanıyorsa
  // (düzeltme öncesi 0.10.0'da kalmış hâl, sihirbaz içi kenar durum) Gizli kapanır, kokpit nötr tek cümleyle söyler (yerel/gizli-geri-al.ts).
  acilistaGizliDenetle();
  // 0.14.1: bulutsuz kipte yerel beyin kurulu ama ses parçası (yazıya çevirme / ses) eksikse ya da yarıda kaldıysa kaldığı yerden tamamlanır;
  // bulutsuz kipe GEÇİLİNCE de (Ayarlar'dan Gizli ya da "Yalnız bu bilgisayar") — Gizli "indirmen lazım" demesin.
  yerelSesiTamamla();
  const bulutsuzHazir = () => { const y = ayarlar().yerel; return (y.gizliMod === true || y.yalnizYerel === true) && y.etkin === true; };
  let oncekiBulutsuz = bulutsuzHazir();
  ayarDinle(() => { const b = bulutsuzHazir(); if (b && !oncekiBulutsuz) yerelSesiTamamla(); oncekiBulutsuz = b; });
  // Görev 21 (K10): yerel beyin yalnız TEK motorken (Gizli mod ya da hiç bulut yokken) sıcak tutulur; bulut varken sunucusu açılmaz
  // (ekran kartı boş kalır). Yedek ses (Piper) yerel beyinden bağımsız: burada kapatılmaz.
  if (yerelTekMotorMu()) void yerelTaban();
  const yerelImzasi = () => { const y = ayarlar().yerel; return JSON.stringify([y.etkin, y.model, y.gpu, yerelTekMotorMu()]); };
  let yerelImza = yerelImzasi();
  // Gizli mod kapanınca (Görev 21 düzeltme turu 3) bekleyen Gizli gün kaydı satırları yerel beyin KAPANMADAN yerelde notlanır; sunucu
  // ondan sonra kapanır (soğuk açılış yok, notlar kaybolmaz).
  let oncekiGizli = ayarlar().yerel.gizliMod === true;
  let gizliNotlaniyor = false;
  ayarDinle(() => {
    const gizli = ayarlar().yerel.gizliMod === true;
    const gizliKapandiMi = oncekiGizli && !gizli;
    oncekiGizli = gizli;
    const imza = yerelImzasi();
    if (imza === yerelImza) return;
    yerelImza = imza;
    if (yerelTekMotorMu()) yerelYenidenBaslat(true);
    else if (gizliKapandiMi) {
      gizliNotlaniyor = true;
      void gizliKapanisi({ notla: gizliKapandi, tekMotor: yerelTekMotorMu, durdur: yerelDurdur, bildir: yerelBildir }).finally(() => { gizliNotlaniyor = false; });
    } else yerelDurdur();
    yerelBildir();
  });
  // Bulut yolundayken yerel beyin hiçbir işte kullanılmaz: sunucusu bir nedenle açık kaldıysa boşta kapatılır (ekran kartı boşalsın;
  // düzeltme 7). "Dene" ve "Yeniden başlat" bulut yolunda sunucuyu zaten açmaz (ipc.ts).
  setInterval(() => { if (!process.env.FUBER_YEREL_TABAN && !gizliNotlaniyor && !yerelTekMotorMu() && yerelSunucuDurumu().calisiyor) { yerelDurdur(); yerelBildir(); } }, 60_000).unref();
  dusunmeBaslat({
    kulakaGonder: (v) => { if (kulak && !kulak.isDestroyed() && !kulak.webContents.isLoading()) kulak.webContents.send('gunkaydi:kulak', v); },
    kulakYenile: () => kulakKur(),
    // Eşlikçi araya giriyor: 0.13'ten beri her türü (`hatirlatma` dahil: modelin seçtiği sınıf, zamanı gelen hatırlatıcı değil) adayı açmaz, sessiz çentikte nokta olur;
    // imleç gelince yazısı görünür, tıklanınca (ayara göre) söyler; tam ekranda bekler. Mesaj sohbette de durur.
    // 'dinlendi' (gün içinde Fuber'e seslenildi; düzeltme 7): kullanıcının kendi sözü — "Hey Fuber" gibi hemen iner, ada turu üstlenir.
    asistanaSoyle: (v) => adaGonder('asistan:soyle', v, soyleKaynagi(v.tur)),
    asistanaGonder,
  });
  // Yetki (modül + İş modu + WhatsApp hakkı) varsa ve açık bırakıldıysa bağlanır; kapı geçişlerini (mod, hesap) ana süreç izler.
  whatsappKapisiniBaslat();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: ayarlar().baslangictaAc, args: ['--gizli'] });
  void kokpitYenile('açılış');
  kulakDurumuYayinla();
});
