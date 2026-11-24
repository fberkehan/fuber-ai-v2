// ── Ajan döngüsü ─────────────────────────────────────────────────────────────────────────────────────────────
// Bir tur: kullanıcı mesajı → bağlam (saat, ilgili hafıza, bağlı entegrasyonlar) → motor → araçlar → … → yanıt.
// İstem önbelleği için sıra SABİT: [kişilik (sabit)] [çekirdek hafıza + sohbet özeti (yavaş değişir)] [araçlar]
// [geçmiş] [bu turun mesajı + <baglam>]. Değişken her şey yalnız son mesajda. Geçmiş turlar düşünme bloksuz gider;
// yalnız sürmekte olan araç döngüsünde Claude'un kendi içeriği (düşünme dahil) aynen geri gönderilir.
import { cagir, secim, yardimciMetin } from '../motor/secici.js';
import { MotorHatasi, metinBirlestir, type Blok, type Mesaj, type AracTanim } from '../motor/tipler.js';
import { ekMetinleri, ekEtiketiniEtkisizlestir, yerelEkNotu, AZAMI_EK, YEREL_EK_SINIRI, type MetinEki } from '../../shared/ek-kural.js';
import { gorselOkurMu, canliModelAdi } from '../motor/model-listesi.js';
import { modelAdi } from '../../shared/model-bilgisi.js';
import { kisilikMetni } from './kisilik.js';
import { komutNotu } from './kod-isleri.js';
import { sistemSabitKur } from './karakter-istemi.js';
import { yerelSistemIstemi, yerelSistemYari, YEREL_HAFIZA_BUTCESI } from '../../shared/yerel-istem.js';
import { hitapMetni } from '../../shared/hitap.js';
import { type Karakter, type KipKimligi } from '../../shared/karakterler.js';
import { turKarakteri } from '../../shared/karakter-gorunum.js';
import { tumAraclar, aracBul, dogrula, type Arac, type AracBaglami } from './araclar/kayit.js';
import { webEtkinMi } from './araclar/web.js';
import { cekirdekMetni, turBaglami } from '../hafiza/depo.js';
import { tokenTahmini } from '../hafiza/normal.js';
import { araclariOnar, gunEtiketi, ozetKesimi } from './gecmis.js';
import { hafizaYaz } from '../hafiza/yazici.js';
import { mesajEkle, mesajlar, mesajlariSil, gorunume, sohbetBilgisi, sohbetBaslikYaz, sohbetOzetYaz, aracEtiketi, sonGizliDurumu, kayitMetni, kullaniciSozleri, type KayitliMesaj } from '../sohbet.js';
import { sohbetOlayi, onayIste, onaylariReddet, sohbetCalisiyor } from '../olaylar.js';
import { zihinDurumu, kokpitYenile } from '../kokpit/duzen.js';
import { ayarlar } from '../ayarlar.js';
import { olayKaydet } from '../vt.js';
import { epostaHesaplari } from '../entegrasyon/eposta.js';
import { whatsappBagli, whatsappIzinli } from '../entegrasyon/whatsapp-kapisi.js';
import { mcpAraclari, mcpEtkinMi } from '../entegrasyon/mcp.js';
import { katalogAraclariniHazirla } from '../entegrasyon/mcp-katalog.js';
import { hazirlanmaNotu } from '../../shared/mcp-baglanti.js';
import type { GorunenMesaj, GorunenBlok } from '../../shared/tipler.js';
import { MESGUL_MESAJI } from '../../shared/mesgul.js';
import { motorHataMetni, gorunenMotorHatasi, gizliHazirlanmaMetni, YALNIZ_YEREL_SECILDI_DURDU } from '../../shared/abonelik.js';
import { beyinBasla, sinyal } from '../beyin.js';
import { claudeYolu } from '../claudecode/baslat.js';
import { ccSohbetteAcik } from '../../shared/cc-ayar.js';
import { tekMotorYolu, yalnizYerelTurMu, motorYoluGirdisi, yalnizYerelSeciliMi } from '../motor/yerel.js';
import { GIZLI_MOD_HAZIR_DEGIL, GIZLI_MOD_ACILDI_DURDU } from '../motor/secici.js';
import { aracsizTurIstemi, bulutBaglami, gizliGecisNotu, type SabitYol } from '../../shared/tek-motor.js';
import { hafizaYaziminiBekle } from '../hafiza/yazici.js';
import { TurSonrasi } from './tur-sonrasi.js';
import { yerelKodYolu } from './yerel-yol.js';
import { aractanBolge } from '../../shared/beyin.js';
import { aracKartiOzeti } from '../../shared/is-dili.js';
import { hatirlaticilar, gorevler } from '../planlama.js';
import { durdurmaKayitlari, DURDURULDU } from './durdurma.js';
import { SESLI_TUR_TALIMATI } from './anlatim-kurali.js';
import { turunMesajlari, HAZIRLIK_NOTU_KAYNAGI } from '../../shared/sohbet-gorunum.js';
import { icTalimatYankisiMi, PROAKTIF_HAFIZA_ISARETI } from '../../shared/ic-talimat.js';
import { aracCagrisiKarti } from '../../shared/kart.js';
import { gorevOnayAciklamasi } from '../../shared/isler-gorunum.js';
import { yalnizHazirlik, gizliHazirlik } from '../abonelik.js';
import { bulutYasak } from '../../shared/bulut-kapisi.js';
import { komutAraciAcik, KOMUT_ARAC_SURESI_MS } from '../../shared/komut-siniflama.js';
import { ARAC_ISTEK_SINIRI } from '../../shared/sohbet-protokolu.js';
import { TAVAN_NOTU_KAYNAGI } from '../../shared/sohbet-gorunum.js';
import {
  AZAMI_ADIM, GOREV_AZAMI_ADIM, CALISIYOR_ESIGI, calisiyorMu, istekSiniri, zinciriSikistir, araclariSirala, mcpServisi, mcpNotu, aracSiniriNotu, acilisNotu,
  tavanMetni, sonAdimEtiketleri, devamMi, devamBaglami, asilIstekBul, aracSonucuKisalt,
} from './zincir.js';

// 11 Kas analizi #10: ana sohbette bütün geçmiş her tura gidiyordu (29. gün ~18 bin token; "teşekkürler" bile) ve eski bölümün özeti ancak ~78 bin
// token'da tetikleniyordu — 30 günlük kullanımda hiç çalışmadı. Geçmiş penceresi 6 bin token; bulutta özetlenmemiş bölüm 8 bin token'ı aşınca eski
// %60'ı özetlenir (özet sistemin yavaş değişen bölümüne girer). Uzun dönem bilgi zaten hafızada. Araç çağrısı/sonucu çifti hiçbir yerde bölünmez.
const GECMIS_BUTCE = 6_000; // token
/** Bulutta özet eşiği (token; özetlenmemiş kayıt). Yerelde eski eşik kalır: küçük modelin yuvası özet girdisini zaten almaz. */
export const OZET_ESIGI = 8_000;
const OZET_ESIGI_YEREL = 78_000;
// 0.14 T13: tur 100 adıma dek sürer (eskiden 30); tavanda dürüst not ve "Devam et" (ajan/zincir.ts, R24).
export { AZAMI_ADIM };
const aktif = new Map<number, AbortController>();

export function mesgulMu(sohbetId: number): boolean { return aktif.has(sohbetId); }
export function durdur(sohbetId: number): void { aktif.get(sohbetId)?.abort(); onaylariReddet(sohbetId); }
/** Acil durdurma (Alt+Shift+Q; shared/genel-kisayol.ts): bütün sürmekte olan turlar kesilir, bekleyen onaylar reddedilir. */
export function hepsiniDurdur(): number { const n = aktif.size; for (const id of [...aktif.keys()]) durdur(id); return n; }

// 0.14 T13: ilk satır "kendin yap" (model yalnız sohbet ediyor, iş yapmıyordu); web, sayfa ve dosya/belge satırları yeni araçların kullanımını söyler. Bloğun sahibi
// T13 (düzeltme turu 1, denetleyici kararı): HER KONU TEK SATIR, her araç adı en çok bir kez (T17'nin dosya yazma satırı dosya satırına katıldı; web
// satırının son hâli burada, alıntı biçimi [1](adres)). Komut satırı yalnız Developer mode'da (kod-isleri.ts komutNotu), bağlı servisler satırı taşmaya
// göre (zincir.ts mcpNotu) aracNotlari'nda eklenir. Araç listede yoksa (izin kapalı, eski sürüm) satır yalnız bilgi kalır; çağrılan araç kayıtta yoksa
// "Bilinmeyen araç" döner.
const ARAC_NOTLARI = `# ARAÇ NOTLARI
- İşi KENDİN yap: istenen işi araçlarınla adım adım sen yürüt (ara, oku, yaz, çalıştır, sonucu doğrula); yalnız nasıl yapılacağını anlatıp bırakma.
- Web: güncel ya da bilmediğin bilgi için web_ara ile ara; gereken sayfayı sayfa_oku ile oku (uzun sayfanın devamı için parca ile sürdür). Kaynakları metinde [1](adres) biçiminde ver; adres uydurma.
- Dosya ve belge: dosya_listele ile klasöre, dosya_oku ile içeriğe bak. dosya_yaz / dosya_duzenle / belge_uret (Word, Excel, PowerPoint, PDF) yalnız Masaüstü, Belgeler, İndirilenler ve OneDrive'da, TAM yolla çalışır; küçük değişiklikte önce oku, sonra düzenle. Yeni dosya sormadan oluşur; var olanın üzerine yazma ve dosya_sil (Geri Dönüşüm Kutusu) onay ister.
- Hafıza: önce <baglam>'a bak; yetmezse hafiza_ara. Kalıcı bilgi → hafiza_kaydet / hafiza_guncelle.
- Hatırlatıcı/plan: hatirlatici_kur zamanı kesin ISO ister (bağlamdaki şimdiki zamandan hesapla). Kurduğunda kokpitte sol üstte görünür.
- Kokpit: önemli bir durumu kalıcı göstermek için kokpit_kart; yerleşim isteği için kokpit_duzen.
- E-posta/WhatsApp gönderimi kullanıcı onayı ister; önce taslağı göster, onay aracın kendisinde istenir.
- Tarayıcı: tarayici_ac → tarayici_oku (sayfa metni + numaralı öğeler) → tarayici_tikla/tarayici_yaz. Parola alanına yazamazsın.
  Mesajda "Fuber Tarayıcı'da açık sayfa" yazıyorsa sayfa zaten açık: yeniden açma, okuma aracıyla başla (yeniden yükleme yazılanı siler).
  Açılır liste tarayici_sec, tuş tarayici_tus, yükleme bekleme tarayici_bekle, sekmeler tarayici_sekme (en çok 8), dosya tarayici_indir (her seferinde onaylı). Kart alanına da yazamazsın.
  Gönderme (gönder düğmesi, formda Enter, satın alma, ödeme, silme, giriş) sayfadan otomatik algılanır ve HER SEFERİNDE kullanıcıdan onay istenir; amaç yazman gerekmez. "Form gönderimi onay bekliyor" dönerse sayfanın onaysız gönderimi durduruldu (başka giden veri olabilir, kesin konuşma); gerekiyorsa aynı adımı yeniden dene (onay kartı çıkar).
- Bilgisayar: önce bilgisayar_ekran ile bak, koordinatlar o görüntüye göredir; her eylemden sonra tekrar bak. Tehlikeli/geri alınamaz işlem yapma.
- Kart: tablo, karşılaştırma, adım adım yol, özet ya da bağlantı listesi gibi düzenli bilgiyi uzun yazı yerine kart_goster ile göster (düz metin, HTML/Markdown yok); kartı koyunca içeriği tekrar yazma, kısa bir yorum yeter.
- Cevaplarında hafızaya dayandığın yerlerde [H-12] gibi atıf ver.`;

/** Adım sınırı satırı (düzeltme turu 2): sohbet turunda 100 ve "Devam et"; arka plan görev adımında 30 ("Devam et" görevde yok). */
const adimNotu = (gorev: boolean): string => (gorev
  ? `- Adım sınırı: bu görev adımında en çok ${GOREV_AZAMI_ADIM} adım atabilirsin.`
  : `- Adım sınırı: bir turda en çok ${AZAMI_ADIM} adım atabilirsin; iş sığmazsa kullanıcı "Devam et" der.`);
/** Turun araç notları: sabit blok + adım sınırı (sohbet ya da görev adımı) + komut satırı (yalnız Developer mode; turun KİLİTLİ kipi) + bağlı servisler
 *  satırı (256 sınırı yüzünden dışarıda kalan servis varsa adları "mcp_kullan ile aç" notuyla; B36). Yalnız kip, tur türü ya da taşma değişince değişir. */
const aracNotlari = (disarida: readonly string[], kip: KipKimligi, gorev: boolean): string => [ARAC_NOTLARI, adimNotu(gorev), komutNotu(kip), mcpNotu(disarida)].filter(Boolean).join('\n');
/** Kullanıcıya "dışarıda kalan servisler" satırı sohbet başına bir kez (aynı küme için); küme değişince yeniden. */
const disaridaBildirilen = new Map<number, string>();
/** 0.14 T16 düzeltme turu 1: "<Ad> hazırlanıyor; araçları bir sonraki mesajda hazır olacak." satırı sohbet başına bir kez (aynı küme için). */
const hazirlanmaBildirilen = new Map<number, string>();

/** 0.14 T13 (R13): "Çalışıyor" eşiğini aşmış süren sohbet turları (görev adımı hariç; onun kendi hapı var). Ada en son başlayanı gösterir; o bitince
 *  öncekine döner, hiçbiri kalmayınca null. Aynı durum yeniden yazılmaz. */
const calisanlar = new Map<number, { sohbetId: number; adim: number; etiket: string }>();
let sonCalisiyor = 'null';
function calisiyorYay(sohbetId: number, d: { adim: number; etiket: string } | null): void {
  if (d) calisanlar.set(sohbetId, { sohbetId, ...d }); else calisanlar.delete(sohbetId);
  const goster = [...calisanlar.values()].at(-1) ?? null;
  const anahtar = JSON.stringify(goster);
  if (anahtar === sonCalisiyor) return;
  sonCalisiyor = anahtar;
  sohbetCalisiyor(goster);
}

function grupEtkin(grup: string): boolean {
  const a = ayarlar();
  if (grup === 'eposta') return epostaHesaplari().length > 0;
  if (grup === 'whatsapp') return whatsappBagli(); // yetki (modül + İş modu + WhatsApp hakkı) VE bağlantı — whatsapp-kapisi.ts
  // 0.14 T15 (P14): Gizli ve "Yalnız bu bilgisayar"da tarayıcı araçları sunulmaz (karar istek anında; tarayici.ts araç sarmalayıcısı da aynı kuralı sorar).
  if (grup === 'tarayici') return a.yetki.tarayici && !bulutYasak({ gizliMod: a.yerel.gizliMod === true, yalnizYerel: yalnizYerelSeciliMi() });
  if (grup === 'bilgisayar') return a.yetki.bilgisayar;
  if (grup === 'dosya') return a.yetki.dosyaOkuma;
  // 0.14 T17: dosya yazma ve belge üretme Ayarlar'daki "Dosyalar" izni açıkken ve bulut yolunda açık; Gizli ve "Yalnız bu bilgisayar"da (P14 bulut kapısı, istek anında) sunulmaz.
  if (grup === 'dosya-yaz') return a.yetki.dosyaOkuma && !bulutYasak({ gizliMod: a.yerel.gizliMod === true, yalnizYerel: yalnizYerelSeciliMi() });
  if (grup === 'web') return webEtkinMi(); // 0.14 T14: Gizli ve Yalnız bu bilgisayar'da web_ara / sayfa_oku hiç sunulmaz (P14)
  // 0.14 T16 (P14): bağlı servisler (katalog ve Developer'ın sunucuları) ve mcp_kullan Gizli ile "Yalnız bu bilgisayar"da hiç sunulmaz; çalıştırma anında da.
  if (grup === 'mcp' || grup === 'temel-mcp') return mcpEtkinMi();
  if (grup === 'claudecode') return ccSohbetteAcik(a.mod, a.claudeCode.etkin, Boolean(claudeYolu())); // Görev 26: yalnız Geliştirici
  // 0.14 T18 (R8): komut_calistir yalnız Developer mode'da (ARAÇ NOTLARI'nın komut satırıyla aynı eşleme: kod-isleri.ts komutNotu) ve Gizli kapalıyken.
  // "Yalnız bu bilgisayar"da araç kalır; ağa çıkan komutu araç kendisi reddeder (ajan/araclar/komut.ts).
  if (grup === 'komut') return komutAraciAcik({ mod: a.mod, gizliMod: a.yerel.gizliMod === true });
  return true;
}

/** Sesli turda araç listesi küçük (Görev 21, K10): ekran/fare-klavye denetimi ve MCP araçları çıkar — daha az giriş, daha hızlı ilk söz.
 *  Liste sabittir (her sesli turda aynı): istem önbelleği sesli turlar arasında da tutar. 0.11 G6: `kart` da dışarıda — kartın içeriği söylenmez (yalnız
 *  metin olayları konuşulur) ve sesli yanıt hep konuşulabilir metin olmalı (kart-yalnız yanıt "yazı yok" sayılırdı; ada da yalnız 3 satır gösterir). */
const SESLI_DISI = new Set(['bilgisayar', 'mcp', 'temel-mcp', 'kart']);
/** 0.11 G9: yalnız görev adımı turunda sunulan araçların grubu (is_adim_bitti; main/isler/adim.ts listeye kendisi ekler). */
export const GOREV_ADIMI_GRUBU = 'is-adim';

/** `mcp` (G9 düzeltme turu 1): görev adımında MCP araçları hiç istenmez (bağlantı açılmaz).
 *  0.14 T13 sırası: çekirdek araçlar, sonra bağlı katalog servisleri (kayıtta `mcp.katalog`; HER turda, ilgililik süzgeci yok), sonra Developer'ın kendi
 *  MCP sunucuları (bugünkü gibi "her sohbete bağla" ya da mesajla ilgili olanlar). 256 sınırı ajan döngüsünde uygulanır (zincir.ts araclariSirala). */
export async function turAraclari(
  metin: string, sesli = false, mcp = !sesli, o: { sinyal?: AbortSignal; hazirlaniyor?: (adlar: string[]) => void } = {},
): Promise<Arac[]> {
  // 0.14 T16 (düzeltme turu 1): bağlı katalog servislerinin araçları diskteki listeden ağsız gelir; listesi hiç olmayan servis için en çok 3 sn beklenir
  // (Durdur keser; bağlantı arka planda sürer, hâlâ hazırlananlar `hazirlaniyor`a). Gizli / "Yalnız bu bilgisayar"da hiç bağlanılmaz (grupEtkin('mcp') false).
  if (mcp && grupEtkin('mcp')) {
    const hazirlanan = await katalogAraclariniHazirla({ sinyal: o.sinyal }).catch(() => [] as string[]);
    if (hazirlanan.length) o.hazirlaniyor?.(hazirlanan);
  }
  const uygun = tumAraclar().filter((a) => a.grup !== GOREV_ADIMI_GRUBU && grupEtkin(a.grup) && !(sesli && SESLI_DISI.has(a.grup)));
  const temel = uygun.filter((a) => a.grup !== 'mcp');
  const katalog = uygun.filter((a) => a.grup === 'mcp' && a.mcp?.katalog);
  return mcp ? [...temel, ...katalog, ...(await mcpAraclari(metin).catch(() => [] as Arac[]))] : temel;
}

/** Tur sonrası işler (hafıza, başlık, özet, kokpit): sesli turdan sonra 6 sn, yazılıdan sonra 1,5 sn sessizlikte; yeni tur erteler. */
const turSonrasi = new TurSonrasi();
const TUR_SONRASI_MS = { sesli: 6000, yazili: 1500 };

/** Çıkışta (main.ts before-quit): bekleyen tur sonrası işler hemen çalışır, en çok `ms` beklenir — son konuşmanın hafızası kaybolmasın.
 *  Kokpit planı atlanır (pencere kapanıyor). Bekleyen iş yoksa hemen döner. */
export async function turSonrasiniBitir(ms = 4000): Promise<void> {
  if (!turSonrasi.bekleyenSayisi) return;
  const sozler = turSonrasi.hepsiniCalistir((anahtar) => anahtar !== 'kokpit');
  await Promise.race([Promise.allSettled([...sozler, hafizaYaziminiBekle()]), new Promise((c) => setTimeout(c, ms))]);
}
export const turSonrasiBekliyor = (): boolean => turSonrasi.bekleyenSayisi > 0;

/** `yerel` (11 Kas analizi #8): yerel turda "Bağlı: … tarayıcı açık …" satırı GİTMEZ — araçsız turda modeli "tarayıcı açık olsa da" diye çelişkiye
 *  düşürüyordu; yerelde bu bağlantıların hiçbiri kullanılamaz. */
function ortamOzeti(yerel = false): string {
  const a = ayarlar();
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ofs = -d.getTimezoneOffset() / 60;
  const satirlar = [
    `Şimdi: ${d.toLocaleString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (${tz}, UTC${ofs >= 0 ? '+' : ''}${ofs}; ISO ${d.toISOString()})`,
    ...(yerel ? [] : [`Bağlı: e-posta ${epostaHesaplari().length ? epostaHesaplari().map((e) => e.adres).join(', ') : 'yok'}; ${whatsappIzinli() ? `WhatsApp ${whatsappBagli() ? 'bağlı' : 'bağlı değil'}; ` : ''}tarayıcı ${a.yetki.tarayici ? 'açık' : 'kapalı'}; fare/klavye ${a.yetki.bilgisayar ? 'izinli' : 'kapalı'}.`]),
  ];
  // Takvim özeti (kısa, her turda): kokpit/proaktif mesajlar sohbete kanıtsız düşer; model önceki sözünü bununla
  // doğrulayabilsin, yoksa doğru bilgiyi "dayanağı yok" diye geri çekiyordu (19 Eki cep testi). ~100-200 belirteç.
  const saat = (iso: string) => new Date(iso).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const hat = hatirlaticilar({ durum: 'bekliyor', sonraki: 48, limit: 8 });
  const gor = gorevler({ limit: 6 });
  if (hat.length) satirlar.push(`Önümüzdeki 48 saatin hatırlatıcıları: ${hat.map((h) => `${saat(h.zaman)} ${h.baslik}`).join(' · ')}`);
  if (gor.length) satirlar.push(`Açık plan: ${gor.map((g) => `${g.baslik}${g.sonTarih ? ` (son ${saat(g.sonTarih)})` : ''}${g.proje ? ` [${g.proje}]` : ''}`).join(' · ')}`);
  return satirlar.join('\n');
}

/** Kayıtlı ileti → motor iletisi (gün etiketi, eski ekran görüntüleri yer tutucuya); boşsa null. */
function kayittanMesaj(m: KayitliMesaj): Mesaj | null {
  // Önceki turların ekran görüntüleri gönderilmez (pahalı ve artık gereksiz); kullanıcının yüklediği görseller kalır.
  const bloklar: Blok[] = m.rol === 'not'
    ? [{ tur: 'metin', metin: `[Sistem notu] ${m.metin}` }]
    : m.bloklar.filter((b) => !(b.tur === 'gorsel' && !b.veri)).map((b) => (b.tur === 'arac_sonuc' && b.gorseller?.length ? { ...b, gorseller: undefined, icerik: `${b.icerik}\n[ekran görüntüsü vardı]` } : b));
  if (!bloklar.length) return null;
  // Önceki günlerin kullanıcı mesajlarına gün etiketi: dün yazılan "yarın" bugüne göre okunmasın.
  const etiket = m.rol === 'user' && m.kaynak !== 'arac' ? gunEtiketi(m.zaman) : null;
  const ilkMetin = etiket ? bloklar.findIndex((b) => b.tur === 'metin') : -1;
  if (ilkMetin >= 0) {
    const b = bloklar[ilkMetin] as Extract<Blok, { tur: 'metin' }>;
    bloklar[ilkMetin] = { ...b, metin: `[${etiket} yazıldı] ${b.metin}` };
  }
  return { rol: m.rol === 'assistant' ? 'assistant' : 'user', bloklar };
}

/** Kayıtlı geçmişi motor mesajlarına çevirir: bütçe içinde en yeniler, araç çağrısı/sonucu çifti bölünmez. `bulut`: buluta gidecek —
 *  Gizli bölümün mesajları çıkar (düzeltme 1; Gizli mod kapandıktan sonra da). `sabitId` (0.14 T13 düzeltme turu 1): "Devam et" zincirinin asıl
 *  isteği — bütçenin dışında kalsa da geçmişin başına girer (ajan zinciri onu sabit tutar: zincir.ts zinciriSikistir `sabitMi`). */
function gecmisMesajlari(tumu: KayitliMesaj[], bulut: boolean, sabitId?: number): Mesaj[] {
  const liste = bulutBaglami(tumu, bulut);
  const out: Mesaj[] = [];
  let toplam = 0;
  let sabitIcinde = false;
  for (let i = liste.length - 1; i >= 0; i--) {
    const m = liste[i];
    const mesaj = kayittanMesaj(m);
    if (!mesaj) continue;
    const t = tokenTahmini(JSON.stringify(mesaj.bloklar).replace(/"veri":"[^"]{200,}"/g, '"veri":"…"')) + mesaj.bloklar.filter((b) => b.tur === 'gorsel').length * 1200;
    // Bütçe dolunca durulur — ama pencerenin başı bir araç SONUCUYSA onun çağrısı da alınır (çift bölünmez; 11 Kas: pencere küçüldü, tek büyük
    // sonuç bütçeyi tek başına doldurabiliyor).
    const basYetim = out.length > 0 && out[0].rol === 'user' && out[0].bloklar.some((b) => b.tur === 'arac_sonuc');
    if (toplam + t > GECMIS_BUTCE && out.length >= 2 && !basYetim) break;
    toplam += t;
    out.unshift(mesaj);
    if (m.id === sabitId) sabitIcinde = true;
  }
  // Asıl istek bütçe dışında kaldıysa pencerenin başına girer: pencere onunla açılır (yalnız baştaki yetim araç sonucu atılır — yoksa aşağıdaki kural,
  // araç zincirinde kullanıcı sözü bulamayıp bütün pencereyi düşürürdü).
  if (sabitId !== undefined && !sabitIcinde) {
    const s = liste.find((m) => m.id === sabitId);
    const mesaj = s ? kayittanMesaj(s) : null;
    if (mesaj) {
      while (out.length && out[0].rol === 'user' && out[0].bloklar.every((b) => b.tur === 'arac_sonuc')) out.shift();
      out.unshift(mesaj);
    }
  }
  // Baştaki yetim araç sonucu (çağrısı bütçe dışında kaldı) ve baştaki asistan mesajları atılır.
  while (out.length && (out[0].rol !== 'user' || out[0].bloklar.every((b) => b.tur === 'arac_sonuc'))) out.shift();
  // Ardışık aynı rol: birleştir (OpenAI ve gateway için temiz sıra).
  const birlesik: Mesaj[] = [];
  for (const m of out) {
    const s = birlesik[birlesik.length - 1];
    if (s && s.rol === m.rol && !m.bloklar.some((b) => b.tur === 'arac_sonuc') && !s.bloklar.some((b) => b.tur === 'arac_cagri')) s.bloklar.push(...m.bloklar);
    else birlesik.push({ rol: m.rol, bloklar: [...m.bloklar] });
  }
  return araclariOnar(birlesik);
}


export interface TurGirdisi {
  metin: string;
  gorseller?: { medya: string; veri: string }[];
  /** Analiz 11 Kas bulgu 8–9: sohbet kutusunun belge ve video ekleri (metne çevrilmiş; video: konuşma yazısı). Kullanıcı mesajına `<ek>` bloğu olarak
   *  girer (görünümde çip). Bu bilgisayardaki modelde ek başına daha küçük sınır (AÇIK notla). */
  ekler?: MetinEki[];
  kaynak?: 'kullanici' | 'ses' | 'proaktif' | 'mobil';
  /** Proaktif turlarda: kullanıcıya görünmeyen tetikleyici ("sabah özeti hazırla"). Kayda 'not' olarak düşer. */
  gizliTetik?: boolean;
  /** Kendiliğinden turda: yanıt önceki bir kendiliğinden mesajın tekrarı mı (true → yanıt gösterilmez, tur null döner; main/zamanlayici.ts). */
  tekrarMi?: (metin: string) => boolean;
  /** Ses asistanı: yanıt kısa ve konuşma diliyle. */
  sesli?: boolean;
  /** Araç gerektiren iş (Fuber Tarayıcı'nın "Fuber'e sor"u: sayfa okunacak): yerel beynin araçsız "gündelik" yanıt yolu atlanır. */
  aracGerekli?: boolean;
  /** Telefondan (Fuber köprüsü) gelen tur (B3): gizlilik araçları yalnız daraltır (gün kaydı yalnız duraklatılır). */
  uzak?: boolean;
  /** 0.11 G9: görev adımı (main/isler/adim.ts; iç talimatla, `gizliTetik`, görevin kendi sohbetinde). */
  gorev?: GorevAdimi;
}

/** 0.11 G9 (spec §8 Adım): görev adımının döngüye en küçük kancası. Bağlam YALNIZ `baglam`dır (amaç, plan, son 3 adımın özeti, gözcünün
 *  bulduğu; <baglam> bloğuna girer, kayda girmez): sohbet geçmişi, sohbet özeti ve hafıza araması gönderilmez, MCP araçları istenmez.
 *  Araçlar görevin izinleriyle daralır; listede olmayan araç bu turda çalışmaz; izin kapsamındaki çağrı onay sormaz, kapsam dışı normal onay
 *  kartına düşer; her aracın sonucu `aracBitti`ye bildirilir (izinle yapılan gönderimlerin izi). is_adim_bitti çağrılınca tur başka model
 *  çağrısı yapmaz. */
export interface GorevAdimi {
  baglam: string;
  /** Görevin başlığı: izin dışı gönderimin onay kartı hangi görevin sorduğunu söyler (son inceleme küçük 4; shared/isler-gorunum.ts gorevOnayAciklamasi). */
  baslik?: string;
  araclar: (liste: Arac[]) => Arac[];
  izinli: (arac: string, girdi: Record<string, unknown>) => boolean;
  bitti: () => boolean;
  /** `geriDonussuz` (0.14 T13 düzeltme turu 2): başarılı çağrı geri alınamaz bir iş yaptı (araçCalistir: kayıttaki onay bayrağı ya da onay kapısı) —
   *  tavanda kalan adım bunlar yüzünden yeniden denenmez (isler/adim.ts). */
  aracBitti?: (arac: string, girdi: Record<string, unknown>, basarili: boolean, geriDonussuz?: boolean) => void;
  /** Araç çalışmadan önce girdisini somutlaştırır (ör. WhatsApp alıcısı çözülmüş hesap; izin ve gönderim aynı hesaba bakar). */
  girdiCoz?: (arac: string, girdi: Record<string, unknown>) => Record<string, unknown>;
  /** 0.14 T13 düzeltme turu 1: adım GOREV_AZAMI_ADIM (30) model çağrısında is_adim_bitti'siz durdu. Tavan notu görev sohbetine yazılmaz; adım
   *  "yarım kaldı" sayılır (isler/adim.ts). */
  tavandaKaldi?: () => void;
}

/** G9: kullanıcının kendi turu şu an ekranı/fareyi kullanıyor mu (bilgisayar grubundan bir araç çalıştırdı): görev adımı ekranı alamaz, bekler;
 *  kullanıcı turu ekranı kullanmaya BAŞLAYINCA dinleyici (main/isler/zamanlayici.ts) ekranı tutan adımı keser. */
const ekranKullanicida = new Set<number>();
export const kullaniciEkranda = (): boolean => ekranKullanicida.size > 0;
let ekranaGecti: () => void = () => undefined;
export function kullaniciEkranaGecinceDinle(f: () => void): void { ekranaGecti = f; }

/** G9 düzeltme turu 1: araç girdisinin metinleri (görev adımında is_adim_bitti'nin özeti gibi girdiler de yankı bekçisinden geçer). */
const girdiMetni = (g: unknown): string => (typeof g === 'string' ? g : Array.isArray(g) ? g.map(girdiMetni).join('\n') : g && typeof g === 'object' ? Object.values(g).map(girdiMetni).join('\n') : '');

export async function yanitla(sohbetId: number, girdi: TurGirdisi): Promise<GorunenMesaj | null> {
  // Fırlatma YOK: çağıranlar `void yanitla(…)` diyor; reddedilen istek sessizce düşüp arayüzü "düşünüyor"da bırakıyordu.
  if (aktif.has(sohbetId)) { sohbetOlayi({ tur: 'hata', sohbetId, mesaj: MESGUL_MESAJI, mesgul: true }); return null; }
  const kontrol = new AbortController();
  aktif.set(sohbetId, kontrol);
  const turBaslangicId: number[] = [];
  // Beyin sayfası: Akıl çalışıyor; soru nereden geldiyse oradan bir sinyal.
  const k = girdi.kaynak;
  if (k === 'ses') sinyal('uyanma', 'ajan', 'sesli soru');
  else if (k === 'proaktif') sinyal('saat', 'ajan', 'zamanı gelen iş');
  const beyinBitir = beyinBasla('ajan', k === 'ses' ? 'sesli soruyu yanıtlıyor' : k === 'proaktif' ? 'kendiliğinden bir iş yapıyor' : k === 'mobil' ? 'telefondan gelen mesajı yanıtlıyor' : 'yanıt hazırlıyor');
  let beyinHata = false;
  let beyinAyrinti: string | undefined; // ham hata iletisi: Beyin'de yalnız Geliştirici'de (Ruling O)
  // Görev 20b (K14): sürmekte olan adımda akmış ama henüz kaydedilmemiş metin. Durdurulursa yarım yanıt olarak kalır.
  let adimMetni = '';
  let model: string | undefined;
  /** Bu turun mesajları Gizli bölüm mü (tur başında bir kez; turun her kaydı ve ertelenen işleri buna uyar). */
  let gizli: boolean | undefined;
  /** Bu turun karakteri (tur başında bir kez; kip tur sürerken değişse de tur ve iletileri bununla biter). Yerel hesap önbelleğinden: ağ yok. */
  let karakter: Karakter | undefined;
  /** Tur, bulutta sürerken Gizli mod açıldığı için durdu (kullanıcı Durdur'a basmadı): not bunu söyler. */
  let gizliyleDurdu = false;
  let yalnizlaDurdu = false;
  /** 0.12 cila: "Yalnız bu bilgisayar" ya da Gizli (düzeltme turu 1) seçili ve yerel HAZIRLANIYOR (iniyor / yarıda) — bu bir hata değil,
   *  bekleme: not sakin yazılır, Beyin hata saymaz. */
  let hazirlanma = false;
  const durdu = () => Object.assign(new Error(DURDURULDU), { name: 'AbortError' });
  /** Bu turun kaydettiği Fuber mesajlarının metni ve sayısı (yankı bekçisi). */
  let sonMetin = '';
  let asistanKaydi = 0;
  /** G9 düzeltme turu 1: bir araç girdisi iç talimatı yankıladı (araçlar çalışmadı); tur yankı sayılır. */
  let girdiYankisi = false;
  /** G1 (F2) yankı bekçisi: iç talimatla (gizliTetik) başlayan turun yanıtı talimatı tekrar ediyorsa (küçük yerel model araç isteyen
   *  talimatı araçsız alınca metni olduğu gibi geri yazabiliyor) turun kayıtları — tetik hariç — kayıttan, arama dizininden ve okunmamış
   *  sayısından düşer: gösterilmez, bildirilmez (çağıran null alır; zamanlayıcı gün anahtarını yazmaz). shared/ic-talimat.ts. */
  /** 11 Kas analizi #6: kendiliğinden turun yanıtı ÖNCEKİ bir kendiliğinden mesajın tekrarıysa (girdi.tekrarMi; main/zamanlayici.ts) aynı yoldan
   *  düşer — yankı gibi; ama bir hata değildir (Beyin "sorun" saymaz). */
  let tekrarOldu = false;
  const yankiyiGeriAl = (): boolean => {
    if (!girdi.gizliTetik) return false;
    const yanki = girdiYankisi || icTalimatYankisiMi(sonMetin, girdi.metin);
    tekrarOldu = !yanki && Boolean(sonMetin.trim()) && Boolean(girdi.tekrarMi?.(sonMetin));
    if (!yanki && !tekrarOldu) return false;
    mesajlariSil(sohbetId, turBaslangicId.slice(1), girdi.kaynak === 'proaktif' ? asistanKaydi : 0);
    console.warn(tekrarOldu ? `[ajan] kendiliğinden mesaj öncekini tekrarladı; gösterilmedi (sohbet ${sohbetId})` : `[ajan] kendiliğinden turun yanıtı iç talimatı tekrarladı; gösterilmedi (sohbet ${sohbetId})`);
    return true;
  };
  // 0.14 T13 (R13): tur 8 sn'yi ya da 3 adımı aşınca ada "Çalışıyor" hapını (adım, süren aracın etiketi, Durdur) gösterir; tur bitince kalkar. Görev
  // adımının kendi hapı var (ada:gorev). Süre tek setTimeout ile tutulur (yoklama yok); finally temizler.
  const turBasi = Date.now();
  let adimNo = 0;
  let calisiyorEtiket = '';
  let calisiyorAcik = false;
  const calisiyorDenetle = (sureDoldu = false) => {
    if (girdi.gorev || (!calisiyorAcik && !sureDoldu && !calisiyorMu(Date.now() - turBasi, adimNo))) return;
    calisiyorAcik = true;
    calisiyorYay(sohbetId, { adim: Math.max(1, adimNo), etiket: calisiyorEtiket });
  };
  const calisiyorSaati = girdi.gorev ? null : setTimeout(() => calisiyorDenetle(true), CALISIYOR_ESIGI.ms);
  turSonrasi.basladi(sohbetId);
  try {
    // Görev 21 (K10): motor yolu tur başında bir kez seçilir ve tur boyunca değişmez (shared/tek-motor.ts). Yerel beyin artık "ön
    // eleme" yapmaz: bulut varsa her şey bulutta; Gizli modda (ya da hiç bulut yokken) her şey yerel beyinde, araçsız.
    // Metinler moda göre (shared/abonelik.ts motorHataMetni): İş modunda "Motorlar"/"yerel beyin" yok; abonelik bir şey açıyormuş gibi
    // yapılmaz (önizleme gerçeği), bugün çalışan yol söylenir (Ayarlar → Genel → Kullanım biçimi). Geliştirici'de Motorlar yolu.
    // Düzeltme 1: yol her model çağrısına ve ertelenen işlere SABİT olarak taşınır (secici.ts cagir `sabit`); Gizli modda yazılan
    // mesajlar işaretlenir ve hiçbir bulut bağlamına girmez (Gizli mod kapandıktan sonra da).
    const yol = tekMotorYolu();
    // H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçili ve yerel hazır değil → kendi cümlesi (buluta gitmez; "giriş yap" denmez).
    // Takip turu: yerel iniyorsa telefon/ada notu hazırlanma cümlesini söyler ("yeniden indirebilir" değil).
    if (yol === 'yok') {
      if (ayarlar().yerel.gizliMod) {
        // Düzeltme turu 1 (inceleme d): Gizli hazırlanırken de not sakin — kokpitin Gizli hazırlanma cümlesi ("hazır değil" değil).
        const gizliHazir = gizliHazirlik();
        hazirlanma = gizliHazir !== null;
        throw new MotorHatasi(gizliHazir ? gizliHazirlanmaMetni(ayarlar().mod, gizliHazir === 'yarim') : GIZLI_MOD_HAZIR_DEGIL, 'anahtar');
      }
      const yalniz = yalnizYerelSeciliMi();
      const hazirlik = yalnizHazirlik();
      hazirlanma = yalniz && hazirlik !== null;
      throw new MotorHatasi(motorHataMetni('yok', ayarlar().mod, ayarlar().hesap?.durum, false, yalniz, true, hazirlik), 'anahtar');
    }
    const yerelTek = yol === 'yerel';
    const sabit: SabitYol = yerelTek ? 'yerel' : 'bulut';
    gizli = yerelTek && ayarlar().yerel.gizliMod === true;
    // 0.13 T4: kip burada kilitlenir — sistem metni, iletilerin karakter adı ve 'basladi' olayı (canlı balon, ses) aynı karakteri kullanır.
    // Son inceleme I5: Sade modda (gorunum.karakterler 'sade') turun karakteri Fuber'dir — istemde karakter adı/tanımı yok (shared/karakter-gorunum.ts).
    karakter = turKarakteri(ayarlar());
    const yalnizYerelTur = yalnizYerelTurMu(); // G8: bilinçli tercih (yoksa bulutsuz kurulum); kural tek yerde (shared/tek-motor.ts yalnizYerelEtkin)
    const bilgi = sohbetBilgisi(sohbetId);
    if (!bilgi) throw new Error('Sohbet bulunamadı');

    // 0) Gizli mod geçişi sohbette görünür: "Gizli mod açıldı" / "kapandı" notu, geçişin olduğu yerde (bu sohbetin son mesajına göre).
    const gecis = gizliGecisNotu(sonGizliDurumu(sohbetId), gizli);
    if (gecis) {
      const not = mesajEkle(sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin: gecis }], gizli: false });
      sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([not])[0] });
    }

    // 1) Kullanıcı mesajı (proaktifte görünmez not). Ekler metne `<ek>` blokları olarak girer (kayıtta da: sonraki turların geçmişi belgeyi bilir).
    const ekler = (girdi.ekler ?? []).slice(0, AZAMI_EK);
    const ekMetni = ekMetinleri(ekler, { yerel: yerelTek });
    // İnceleme M7: kullanıcının yazdığı `<ek …>` metni çip sanılmaz (etiket etkisizleşir).
    const yazilan = ekEtiketiniEtkisizlestir(girdi.metin);
    const turMetni = ekMetni ? `${yazilan}${yazilan.trim() ? '\n\n' : ''}${ekMetni}` : yazilan;
    const kullaniciBloklari: Blok[] = [{ tur: 'metin', metin: turMetni }, ...(girdi.gorseller ?? []).map((g) => ({ tur: 'gorsel' as const, ...g }))];
    const kayitli = mesajEkle(sohbetId, { rol: girdi.gizliTetik ? 'not' : 'user', bloklar: kullaniciBloklari, kaynak: girdi.kaynak ?? 'kullanici', gizli });
    turBaslangicId.push(kayitli.id);
    if (!girdi.gizliTetik) sohbetOlayi({ tur: 'basladi', sohbetId, kullaniciMesaji: gorunume([kayitli])[0], karakter: karakter.ad, kip: karakter.kip });
    zihinDurumu('dusunuyor');

    // Gizli modda araç yok: sayfa okumak gibi araç gerektiren iş (Fuber Tarayıcı'nın "Fuber'e sor"u) yapılamaz — dürüstçe söylenir.
    if (yerelTek && girdi.aracGerekli) throw new MotorHatasi(motorHataMetni('bulut-gerekli', ayarlar().mod, ayarlar().hesap?.durum, gizli, yalnizYerelTur, motorYoluGirdisi().bulutVar), 'anahtar');
    // Analiz 11 Kas bulgu 12: bu bilgisayardaki model görsel okumaz — görsel (ve video karesi) sessizce düşmez, tek satırla söylenir; modele yalnız metin
    // (videoda konuşma yazısı) gider. Ek metni yerel sınırda kısaldıysa o da söylenir.
    // İnceleme I4: bulutta da seçili model görsel okumuyorsa (sağlayıcının bilgisi kesinse) görsel gönderilmez ve aynı kalıpla söylenir.
    let gorselsizModel: string | undefined;
    if (!yerelTek && girdi.gorseller?.length) {
      try {
        const s = secim('ana');
        if ((await gorselOkurMu(s.saglayici, s.model)) === false) gorselsizModel = canliModelAdi(s.saglayici, s.model) ?? modelAdi(s.saglayici, s.model);
      } catch { /* motor yok: aşağıda motor hatası */ }
    }
    const turGorselleri = yerelTek || gorselsizModel ? [] : (girdi.gorseller ?? []);
    if (!girdi.gizliTetik) {
      const not = yerelEkNotu({ yerel: yerelTek, gorselsizModel, gorsel: girdi.gorseller?.length ?? 0, video: ekler.some((e) => e.tur === 'video'), kisaldi: yerelTek && ekler.reduce((n, e) => n + e.metin.length, 0) > YEREL_EK_SINIRI });
      if (not) {
        const n = mesajEkle(sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin: not }], gizli });
        sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([n])[0] });
      }
    }

    // 11 Kas analizi #9, §6.3: "Yalnız bu bilgisayar"da (Gizli değil) hatırlatıcı, yapılacak iş, tarih ve aritmetik KODLA yapılır (onay kartı ya da
    // kesin sonuç; ajan/yerel-yol.ts) — model çağrılmaz. Kodla çözülemeyen hesapta model yanıtlar, ardından dürüst bir not düşer.
    let yerelNot = '';
    if (yerelTek && !gizli && !girdi.gizliTetik && !girdi.gorev) {
      const kod = await yerelKodYolu(sohbetId, girdi.metin, kontrol.signal);
      if (kontrol.signal.aborted) throw durdu();
      if (kod && 'not' in kod) yerelNot = kod.not;
      else if (kod) {
        const m = mesajEkle(sohbetId, { rol: 'assistant', bloklar: [{ tur: 'metin', metin: kod.metin }], gizli, karakter: karakter.ad, kip: karakter.kip });
        turBaslangicId.push(m.id);
        const son = gorunume([m])[0];
        sohbetOlayi({ tur: 'bitti', sohbetId, mesaj: son });
        turSonrasi.bitti(sohbetId, {
          [`hafiza:${turBaslangicId[0]}`]: () => hafizaYaz({ kullanici: girdi.metin, asistan: kod.metin, kaynak: `sohbet:${sohbetId}/mesaj:${turBaslangicId[0]}` }, sabit),
          baslik: () => baslikUret(sohbetId, girdi.metin, kod.metin, sabit),
        }, girdi.sesli ? TUR_SONRASI_MS.sesli : TUR_SONRASI_MS.yazili);
        return son;
      }
    }

    // 2) Bağlam. G9 (spec §8): görev adımı sohbet geçmişi, sohbet özeti ve hafıza araması taşımaz — bağlamı yalnız GorevAdimi.baglam.
    const onceki = girdi.gorev ? [] : bulutBaglami(mesajlar(sohbetId, { sonrasi: bilgi.ozetSonMesaj }).filter((m) => m.id < kayitli.id), !yerelTek);
    // 0.14 T13 (R24): "Devam et" — tavan notundan sonra gelen "Kaldığın yerden devam et." yeni bir turdur (100 adım yeniden); bağlama tavandaki turun son
    // 5 adımının etiketi girer (kayıtta görünmez: <baglam> görünümde atılır). Telefondan elle yazılan aynı cümle de aynı yoldan sürer.
    // Düzeltme turu 1: zincirin ASIL isteği (Devam turları atlanarak bulunan ilk kullanıcı sözü; özetlenmiş bölümde olsa da) bağlama "Asıl istek: …"
    // satırıyla girer — kayıt ne kadar kırpılırsa kırpılsın ve sunucu sürümünden bağımsız. Geçmişte de bütçe dışında kalsa başa girer ve sabit kalır.
    const devam = !girdi.gorev && devamMi(girdi.metin, onceki);
    const asil = devam ? asilIstekBul(kullaniciSozleri(sohbetId, kayitli.id), !yerelTek) : null;
    const asilMetni = asil?.metin.trim() ?? '';
    const asilMi = asilMetni ? (m: Mesaj) => m.rol === 'user' && m.bloklar.some((b) => b.tur === 'metin' && b.metin.trimEnd().endsWith(asilMetni)) : undefined;
    const gecmis = gecmisMesajlari(onceki, !yerelTek, asil?.id);
    const oncekiAtiflar = onceki.filter((m) => m.rol === 'assistant').slice(-4)
      .flatMap((m) => [...m.metin.matchAll(/\[H-(\d+)/g)].map((x) => Number(x[1])));
    const baglam = girdi.gorev ? { metin: '', atiflar: [] } : turBaglami(girdi.metin, sohbetId, yerelTek ? YEREL_HAFIZA_BUTCESI : 1800, oncekiAtiflar);
    const ek = [
      ortamOzeti(yerelTek),
      baglam.metin ? `İlgili hafıza ve geçmiş (atıf ver):\n${baglam.metin}` : girdi.gorev || yerelTek ? '' : 'İlgili hafıza kaydı bulunamadı; gerekiyorsa hafiza_ara kullan.',
      devam ? devamBaglami(sonAdimEtiketleri(onceki, 5, aracEtiketi), asilMetni || null) : '',
      // I5: sesli turda araçtan önce hiçbir şey yazılmaz, kendi akıl yürütmesi asla söylenmez (ajan/anlatim-kurali.ts).
      girdi.sesli ? SESLI_TUR_TALIMATI : '',
      girdi.gorev?.baglam ?? '',
      girdi.gizliTetik ? 'Bu tur senin kendiliğinden başlattığın bir iş (kullanıcı yazmadı). Sonucu kullanıcıya doğrudan hitap eden kısa bir mesaj olarak yaz.' : '',
      yerelTek ? aracsizTurIstemi(gizli) : '', // 0.11 G8: Gizli cümlesi yalnız Gizli'de; "yalnız yerel"de gizlilik sözü yok (shared/tek-motor.ts)
    ].filter(Boolean).join('\n\n');
    const buTur: Mesaj = { rol: 'user', bloklar: [{ tur: 'metin', metin: `<baglam>\n${ek}\n</baglam>\n\n${turMetni}` }, ...turGorselleri.map((g) => ({ tur: 'gorsel' as const, ...g }))] };

    const ozet = bilgi.ozet && !girdi.gorev ? `\n\n# BU SOHBETİN ÖNCEKİ BÖLÜMÜNÜN ÖZETİ\n${bilgi.ozet}` : '';
    const cekirdek = cekirdekMetni();
    // 0.14.1 (yerel modelde kısa bir selam bile bağlama sığmıyordu): yerel yolda çekirdek hafıza ve özet kısaltılır, araç adı geçmez (shared/yerel-istem.ts).
    const sistemYari = yerelTek ? yerelSistemYari(cekirdek, bilgi.ozet && !girdi.gorev ? bilgi.ozet : '')
      : `# ÇEKİRDEK HAFIZA (her zaman geçerli)\n${cekirdek || '(henüz yok — kullanıcıyı tanıdıkça hafiza_kaydet ile sabit:true kayıtlar ekle)'}${ozet}`;

    // G9: görev adımında liste görevin izinleriyle daralır (main/isler/adim.ts) ve MCP istenmez; telefondan gelen turda yalnız masada
    // kullanılan araçlar (görev başlatma) sunulmaz.
    // 0.14 T13 (R4, B36): liste en çok 256 araç — çekirdek araçlar hep gider; sığmayan bağlı servis bütün olarak dışarıda kalır, adı ARAÇ NOTLARI'na
    // "mcp_kullan ile aç" notuyla yazılır ve kullanıcıya bir satırla söylenir. Dışarıdakiler adını bilen model için çağrılabilir kalır.
    const uzakTur = Boolean(girdi.uzak) || girdi.kaynak === 'mobil';
    const suz = girdi.gorev?.araclar ?? ((l: Arac[]) => l);
    // 0.14 T16 düzeltme turu 1: katalog servislerinin hazırlığı turun Durdur sinyaline bağlı (en çok 3 sn); hâlâ hazırlananlar aşağıda bir satırla söylenir.
    let hazirlanan: string[] = [];
    const adaylar = yerelTek ? [] : suz((await turAraclari(girdi.metin, Boolean(girdi.sesli), !girdi.sesli && !girdi.gorev, { sinyal: kontrol.signal, hazirlaniyor: (l) => { hazirlanan = l; } })).filter((a) => !(uzakTur && a.yalnizMasada)));
    const { gidenler, disarida, buyuk } = araclariSirala(adaylar, ARAC_ISTEK_SINIRI.arac);
    const araclar = yerelTek ? [] : gidenler;
    let sunulan: Arac[] = [...araclar];
    const tanimlar: AracTanim[] = araclar.map((a) => a.tanim);
    // Aynı ad iki kez gelirse ilki (araclariSirala'nın sağlayıcıya gönderdiği) çalışır (düzeltme turu 1; Developer sunucusunun öneki ayrıca farklı).
    const aracHaritasi = new Map<string, Arac>();
    for (const a of adaylar) if (!aracHaritasi.has(a.tanim.ad)) aracHaritasi.set(a.tanim.ad, a);
    // 0.14.1: yerel turda (Gizli, "Yalnız bu bilgisayar"; araçsız — P14) bulutun kişilik + araç notları metni GİTMEZ: yuva 4.096 token, o metin
    // ≈ 9.000 karakterdi ve "merhaba"yı bile sığdırmıyordu. Kısa yerel istem aynı karakteri (kısaltılmış) ve temel kuralları taşır.
    const kisa = (k: Karakter) => { const a = ayarlar(); return yerelSistemIstemi({ asistanAdi: a.asistanAdi, kullaniciAdi: a.kullaniciAdi, hitap: hitapMetni(a.kullaniciAdi, a.hitap), karakter: k }); };
    const sistemSabit = yerelTek ? kisa(karakter) : sistemSabitKur(kisilikMetni(), aracNotlari(disarida, karakter.kip, Boolean(girdi.gorev)), karakter);
    if (!girdi.gizliTetik && !girdi.gorev && hazirlanan.length) {
      const anahtar = hazirlanan.join('|');
      if (hazirlanmaBildirilen.get(sohbetId) !== anahtar) {
        hazirlanmaBildirilen.set(sohbetId, anahtar);
        const not = mesajEkle(sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin: hazirlanmaNotu(hazirlanan) }], gizli });
        sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([not])[0] });
      }
    }
    if (!girdi.gizliTetik && !girdi.gorev) {
      const anahtar = disarida.join('|');
      if (!anahtar) disaridaBildirilen.delete(sohbetId);
      else if (disaridaBildirilen.get(sohbetId) !== anahtar) {
        disaridaBildirilen.set(sohbetId, anahtar);
        const not = mesajEkle(sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin: aracSiniriNotu(disarida, ARAC_ISTEK_SINIRI.arac, buyuk) }], gizli });
        sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([not])[0] });
      }
    }
    /** Model bir servisi tur ortasında açtı (`mcp_kullan` → yeniAraclar): açılan servis çekirdekten hemen sonra gelir, liste yine 256'yı aşmaz; yer açmak
     *  için kapanan ya da sığmadığı için açılamayan servis aracın sonucuna yazılır (sessiz düşme yok). */
    const acilan = new Set<string>();
    const araclariAc = (yeni: Arac[]): string => {
      for (const a of yeni) { aracHaritasi.set(a.tanim.ad, a); const sv = mcpServisi(a); if (sv) acilan.add(sv.ad); }
      const once = new Set(sunulan.map((a) => mcpServisi(a)?.ad).filter(Boolean));
      const r = araclariSirala([...sunulan, ...yeni], ARAC_ISTEK_SINIRI.arac, acilan);
      sunulan = r.gidenler;
      tanimlar.splice(0, tanimlar.length, ...sunulan.map((a) => a.tanim));
      return acilisNotu({ kapanan: r.disarida.filter((x) => once.has(x) && !acilan.has(x)), acilamayan: r.disarida.filter((x) => acilan.has(x)), buyuk: r.buyuk });
    };
    const s = yerelTek ? null : secim('ana');
    const webArama = s?.saglayici === 'anthropic' && ayarlar().saglayicilar.anthropic.sunucuWebArama;

    const turMesajlari: Mesaj[] = [buTur];
    const gorevIzinleri = new Set<string>();
    model = s?.model;
    // Sesli turda düşük düşünme gücü (Görev 21, K10): ilk söz daha erken gelir; yanıt zaten 1-3 kısa cümle.
    const efor = girdi.sesli ? 'low' as const : undefined;

    // Bulutta başlayan tur sürerken Gizli mod açıldı: sonraki adım (araç sonuçlarıyla) buluta gitmez — tur temiz biçimde durur. H3c takip turu:
    // "Yalnız bu bilgisayar" seçilince de (süren adımın zaten üretilmiş araç çağrıları — claude_code_gorev, tarayıcı, e-posta — başlamaz).
    const gizliAcildi = () => {
      if (yerelTek) return false;
      if (ayarlar().yerel.gizliMod === true) { gizliyleDurdu = true; return true; }
      if (yalnizYerelSeciliMi()) { yalnizlaDurdu = true; return true; }
      return false;
    };
    // Düzeltme turu 1: arka plan görev adımının tavanı 30 kalır (GOREV_AZAMI_ADIM); sohbetin 100'ü yalnız sohbet turuna.
    const tavan = girdi.gorev ? GOREV_AZAMI_ADIM : AZAMI_ADIM;
    let adim = 0;
    for (; adim < tavan; adim++) {
      if (gizliAcildi()) kontrol.abort();
      if (kontrol.signal.aborted) break;
      adimNo = adim + 1;
      calisiyorEtiket = '';
      calisiyorDenetle();
      adimMetni = '';
      let aracOncesiGitti = false;
      // 0.14 T13 (Review Focus 5): her adımda zincir sunucunun sınırına sığdırılır (zincir.ts zinciriSikistir): eski sonuçlar kısalır, gerekirse en eski
      // birim bütün düşer; çağrı ile sonucu ayrılmaz. Sınır yola göre ve HER adımda (yetenek ya da araç listesi tur ortasında değişebilir).
      const sinir = istekSiniri();
      const y = await cagir('ana', {
        sistemSabit, sistemYari, mesajlar: zinciriSikistir([...gecmis, ...turMesajlari], sinir, undefined, asilMi), araclar: tanimlar, sinyal: kontrol.signal, webArama, ...(efor ? { efor } : {}),
        akis: (o) => {
          // G1 (F2): iç talimatla (gizliTetik) başlayan turun metni ve düşüncesi AKMAZ (sohbet, ada, telefon köprüsü bu olayları alır):
          // yanıt yankı bekçisinden geçtikten sonra 'bitti' ile bütünüyle görünür — yankı bir an bile görünmesin.
          if (o.tur === 'metin') { adimMetni += o.parca; if (!girdi.gizliTetik) sohbetOlayi({ tur: 'metin', sohbetId, parca: o.parca }); }
          else if (o.tur === 'dusunce') { if (!girdi.gizliTetik) sohbetOlayi({ tur: 'dusunce', sohbetId, metin: o.parca }); }
          // I5: model bu adımda bir araç bloğuna geçti — adımın metni araçtan ÖNCE yazıldı: ses yolu onu söylemez (shared/sesli-yanit.ts;
          // akış süzülmez, yapı kuralı). Adım başına bir kez.
          else if (o.tur === 'arac_hazirlaniyor' && adimMetni.trim() && !aracOncesiGitti) { aracOncesiGitti = true; sohbetOlayi({ tur: 'arac_oncesi', sohbetId }); }
        },
      }, girdi.kaynak === 'proaktif' ? 'proaktif' : 'sohbet', sabit);
      adimMetni = ''; // adımın yanıtı aşağıda bütünüyle kaydedilir
      model = y.model;
      const asistan: Mesaj = { rol: 'assistant', bloklar: y.bloklar, ham: y.ham };
      turMesajlari.push(asistan);
      const kaydedilen = mesajEkle(sohbetId, { rol: 'assistant', bloklar: y.bloklar, model: y.model, atiflar: baglam.atiflar.filter((a) => metinBirlestir(y.bloklar).includes(`H-${a.id}`)), okunmamis: girdi.kaynak === 'proaktif', gizli, karakter: karakter.ad, kip: karakter.kip });
      turBaslangicId.push(kaydedilen.id);
      asistanKaydi++;
      // Adımın metni + yapay zekânın kartlarının düz metni (sohbet.ts kayitMetni: kayıt/arama/özet ile aynı kural): hafıza yazıcısı, başlık, yankı bekçisi.
      const adimKaydi = kayitMetni(y.bloklar);
      if (adimKaydi) sonMetin += (sonMetin ? '\n' : '') + adimKaydi;

      if (y.durma === 'ret') { sohbetOlayi({ tur: 'metin', sohbetId, parca: '\n\n_(Bu isteğe yanıt veremiyorum.)_' }); break; }
      if (y.durma === 'duraklat') continue;
      const cagrilar = y.bloklar.filter((b): b is Extract<Blok, { tur: 'arac_cagri' }> => b.tur === 'arac_cagri');
      if (!cagrilar.length) break;
      if (y.durma === 'limit') throw new MotorHatasi('Yanıt uzunluk sınırına takıldı; araç girdisi kesik olduğu için çalıştırılmadı.', 'istek');

      // G1 + G9 düzeltme turu 1: görev adımında bir araç girdisi iç talimatı yankılıyorsa (ör. is_adim_bitti'nin özeti) hiçbir araç
      // çalışmaz, araç olayı yayılmaz; tur yankı sayılır ve kayıtları düşer (Geliştirici "Ayrıntılar"ında da görünmez).
      if (girdi.gorev && girdi.gizliTetik && cagrilar.some((c) => icTalimatYankisiMi(girdiMetni(c.girdi), girdi.metin))) { girdiYankisi = true; break; }

      // 3) Araçlar (sırayla; kullanıcı her birini kartta canlı görür)
      const sonuclar: Blok[] = [];
      for (const ham of cagrilar) {
        // G9 (düzeltme turu 2): görev adımında araca giden girdi somutlaşır (WhatsApp alıcısı ham ad değil, çözülmüş hesap).
        const cozulmus = girdi.gorev?.girdiCoz?.(ham.ad, ham.girdi);
        const c = cozulmus && cozulmus !== ham.girdi ? { ...ham, girdi: cozulmus } : ham;
        if (gizliAcildi()) kontrol.abort();
        if (kontrol.signal.aborted) { sonuclar.push({ tur: 'arac_sonuc', id: c.id, ad: c.ad, icerik: 'Kullanıcı durdurdu.', hata: true }); continue; }
        // G9: görev adımında listede olmayan araç (izin dışı, görev başlatma…) kayıt defterinden de bulunmaz: çalışmaz.
        const arac = aracHaritasi.get(c.ad) ?? (girdi.gorev ? undefined : aracBul(c.ad));
        calisiyorEtiket = aracEtiketi(c.ad, c.girdi);
        calisiyorDenetle();
        const { blok, yeniAraclar, geriDonussuz } = await araciCalistir(c, arac, { sohbetId, sinyal: kontrol.signal, gorevIzinleri, uzak: uzakTur, proaktif: girdi.kaynak === 'proaktif' }, girdi.gorev?.izinli, girdi.gorev?.baslik);
        const acilisNotuMetni = !girdi.gorev && yeniAraclar?.length ? araclariAc(yeniAraclar) : '';
        sonuclar.push(acilisNotuMetni && blok.tur === 'arac_sonuc' ? { ...blok, icerik: `${blok.icerik}\n${acilisNotuMetni}` } : blok);
        girdi.gorev?.aracBitti?.(c.ad, c.girdi, blok.tur === 'arac_sonuc' && !blok.hata, Boolean(geriDonussuz));
      }
      const sonucMesaji: Mesaj = { rol: 'user', bloklar: sonuclar };
      turMesajlari.push(sonucMesaji);
      const k = mesajEkle(sohbetId, { rol: 'user', bloklar: sonuclar, kaynak: 'arac', gizli });
      turBaslangicId.push(k.id);
      // G9: görev adımı is_adim_bitti ile bitti — sonucu okumak için bir model çağrısı daha yapılmaz (token).
      if (girdi.gorev?.bitti()) break;
    }
    // Araçlar çalışırken durdurulduysa döngü sessizce biter; tamamlanmış gibi sayılmasın (hafıza yazılmaz, "Durduruldu." notu).
    if (kontrol.signal.aborted) throw durdu();
    // G1 (F2): yanıt iç talimatın yankısıysa görünmez, bildirilmez, hafızaya işlenmez; tur başarısız sayılır (null). Tur yine biter
    // ('bitti', boş): arayüz "yanıt hazırlanıyor"da kalmaz. Etkinlik'te sade "bir sorun oldu" (ayrıntı yalnız Geliştirici'de).
    if (yankiyiGeriAl()) {
      beyinHata = !tekrarOldu;
      beyinAyrinti = tekrarOldu ? undefined : 'yanıt iç talimatı tekrarladı; gösterilmedi';
      sohbetOlayi({ tur: 'bitti', sohbetId, mesaj: { id: 0, rol: 'assistant', bloklar: [], zaman: new Date().toISOString() } });
      return null;
    }
    // 0.14 T13 (R24): döngü 100 adımı da araçla bitirdi — tur tavanda. Ek model çağrısı YOK: sabit not (son 3 aracın etiketi) kayda düşer, 'tavan' olayı
    // gider (sohbette "Devam et"; telefona düz metin: shared/telefon-hafif.ts), ardından tur olağan 'bitti' ile kapanır. Görev adımında (tavan 30) not
    // görev sohbetine yazılmaz: adım kancaya bildirilir, adım "yarım kaldı" sayılır (isler/adim.ts).
    if (adim >= tavan) {
      if (girdi.gorev) girdi.gorev.tavandaKaldi?.();
      else {
        const not = mesajEkle(sohbetId, { rol: 'not', kaynak: TAVAN_NOTU_KAYNAGI, bloklar: [{ tur: 'metin', metin: tavanMetni(AZAMI_ADIM, sonAdimEtiketleri(turMesajlari, 3, aracEtiketi)) }], gizli });
        turBaslangicId.push(not.id);
        if (!girdi.gizliTetik) sohbetOlayi({ tur: 'tavan', sohbetId, adim: AZAMI_ADIM });
      }
    }

    // Kodla çözülemeyen hesap (yerel): yanıtın ardından dürüst not (shared/yerel-yonlendirme.ts YEREL_HESAP_NOTU).
    if (yerelNot && sonMetin.trim()) {
      const not = mesajEkle(sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin: yerelNot }], gizli });
      sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([not])[0] });
    }

    // G26 küçüğü: balon YALNIZ bu turun kayıtlarından (turBaslangicId) — tur sürerken aynı sohbete düşen eşlikçi sözü ya da Claude Code
    // özeti "son asistan mesajı" sanılıp turun yanıtı yerine gönderilmesin. pause_turn devamı aynı balonda (shared/sohbet-gorunum.ts).
    const yeni = turunMesajlari(mesajlar(sohbetId, { sonrasi: turBaslangicId[0] - 1 }), turBaslangicId);
    const gorunen = gorunume(yeni).filter((m) => m.rol === 'assistant');
    const son = gorunen[gorunen.length - 1] ?? null;
    if (son) sohbetOlayi({ tur: 'bitti', sohbetId, mesaj: son });
    else sohbetOlayi({ tur: 'bitti', sohbetId, mesaj: { id: 0, rol: 'assistant', bloklar: [], zaman: new Date().toISOString() } });

    // 4) Arka plan: hafıza, başlık, özet, kokpit — ertelenir ve birleştirilir (sesli konuşmada yanıtla yarışmasın; tur-sonrasi.ts).
    // Gizli bölüm (düzeltme 1): hafızaya yazılmaz (hafıza sonra bulut bağlamına girer), özet çıkarılmaz; başlık turun yolunda (yerel)
    // kalır — Gizli mod erteleme süresinde kapansa da buluta gitmez. Kokpit planı sohbet içeriği taşımaz (kokpit/duzen.ts durumOzeti).
    // G1 (F2): kendiliğinden turda kullanıcı satırı iç talimat DEĞİL nötr işaret — talimat hafıza notuna, Hafıza sayfasına, çekirdek
    // hafızaya ya da sohbet başlığına girmez (yazıcı Fuber'in yanıtını yine görür; shared/ic-talimat.ts PROAKTIF_HAFIZA_ISARETI).
    const kullaniciMetni = girdi.gizliTetik ? PROAKTIF_HAFIZA_ISARETI : girdi.metin;
    const kaynakAdi = `sohbet:${sohbetId}/mesaj:${turBaslangicId[0]}`;
    // G9: görev adımı (her aralıkta bir tur) hafıza yazıcısını ve kokpit planlayıcısını çağırmaz — adım başına ek yapay zekâ çağrısı olmasın;
    // görevin sonucu ana sohbete ve Görevler kartına gider. Uzayan görev sohbetinin özeti yine çıkarılır.
    turSonrasi.bitti(sohbetId, girdi.gorev ? { ozet: () => ozetGuncelle(sohbetId, sabit) } : gizli ? {
      baslik: () => baslikUret(sohbetId, kullaniciMetni, sonMetin, sabit),
      kokpit: () => kokpitYenile('sohbet'),
    } : {
      // Son bütün dal incelemesi K-5: hafıza da turun yoluna SABİT (başlık ve özet gibi) — bekleme süresinde yol değişse de buluta geçmez.
      // 11 Kas analizi #7: kendiliğinden tur (kullanıcı bir şey yazmadı) hafıza yazıcısına GİTMEZ — sabah özetinin kendi metni ve uydurmaları
      // "kural"/"görev" kaydına, hatta çekirdeğe giriyordu. Kullanıcı bu mesaja yanıt verirse yazım o yanıttan yapılır.
      ...(sonMetin.trim() && !girdi.gizliTetik ? { [`hafiza:${turBaslangicId[0]}`]: () => hafizaYaz({ kullanici: kullaniciMetni, asistan: sonMetin, kaynak: kaynakAdi }, sabit) } : {}),
      baslik: () => baslikUret(sohbetId, kullaniciMetni, sonMetin, sabit),
      ozet: () => ozetGuncelle(sohbetId, sabit),
      kokpit: () => kokpitYenile('sohbet'),
    }, girdi.sesli ? TUR_SONRASI_MS.sesli : TUR_SONRASI_MS.yazili);
    return son;
  } catch (e) {
    // Durdur temiz bir duruştur: SDK'lar kesilen isteği kendi hatalarıyla (APIUserAbortError, adı 'AbortError' değil)
    // fırlatıyor; sinyale bakılmazsa "Claude hatası undefined: Request was aborted." notu yazılıyordu.
    const durduruldu = kontrol.signal.aborted || (e instanceof Error && e.name === 'AbortError');
    const durmaNotu = gizliyleDurdu ? GIZLI_MOD_ACILDI_DURDU : yalnizlaDurdu ? YALNIZ_YEREL_SECILDI_DURDU : DURDURULDU;
    const ham = durduruldu ? durmaNotu : e instanceof Error ? e.message : String(e);
    // A1 (son düzeltme): İş modunda sohbetin geçici hata satırı, kayıtlı ⚠ notu, ada ve telefon sağlayıcı adı/ham ileti göstermez —
    // türün sade cümlesi (shared/abonelik.ts gorunenMotorHatasi). Ham ileti günlükte ve Beyin ayrıntısında (Geliştirici) kalır.
    const mesaj = durduruldu ? ham : gorunenMotorHatasi(e instanceof MotorHatasi ? e.kod : 'bilinmiyor', ham, ayarlar().mod);
    if (!durduruldu) console.warn(`[ajan] tur hatası (sohbet ${sohbetId}):`, ham);
    // G1 (F2): tur yarıda kesildi ama önceki adımlarının kaydı iç talimatı yankılıyorsa o kayıtlar da düşer (yankı bekçisi).
    try { yankiyiGeriAl(); } catch (h) { console.warn('[ajan] yankı kaydı silinemedi:', (h as Error).message); }
    // K14: yarım metin Fuber mesajı olarak kalır (hafızaya işlenmez) ve kalıcı "Durduruldu." notu yazılır — soru cevapsız
    // görünmez, sayfa yenilenince de kaybolmaz. Kayıt olaydan ÖNCE: arayüz 'hata'da mesajları yeniden okur. G1 (F2): kendiliğinden
    // turun yarım metni iç talimatın yankısıysa kayda geçmez (ajan/durdurma.ts).
    // G9 (düzeltme turu 2): kesilen görev adımı (erteleme, durdurma, acil) iz bırakmaz — kayıt yok, 'hata'/"Durduruldu." olayı yok; tur boş
    // 'bitti'yle kapanır (yankı yolundaki gibi: hiçbir yüzey "yanıt hazırlanıyor"da kalmaz).
    const adimKesildi = durduruldu && Boolean(girdi.gorev);
    if (durduruldu && !adimKesildi) {
      try {
        for (const kayit of durdurmaKayitlari({ yarimMetin: adimMetni, model, gizliTetik: girdi.gizliTetik, talimat: girdi.metin })) {
          mesajEkle(sohbetId, { ...kayit, ...(kayit.rol === 'not' ? { bloklar: [{ tur: 'metin', metin: durmaNotu }] } : {}), ...(kayit.rol === 'assistant' && karakter ? { karakter: karakter.ad, kip: karakter.kip } : {}), gizli });
        }
      } catch (h) { console.warn('[ajan] durdurma kaydı yazılamadı:', (h as Error).message); }
    }
    if (adimKesildi) sohbetOlayi({ tur: 'bitti', sohbetId, mesaj: { id: 0, rol: 'assistant', bloklar: [], zaman: new Date().toISOString() } });
    else sohbetOlayi({ tur: 'hata', sohbetId, mesaj });
    // 0.12 cila: yerel hazırlanırken (yalnız) not SAKİN — ⚠ yok, kokpit satırının hazırlanma cümlesi; kaynak 'hazirlik' ile önizlemeyi
    // ("Son sohbetler") işgal etmez (shared/sohbet-gorunum.ts onizlemeDisiMi). Gerçek hata notları ⚠ önekli kalır.
    if (!durduruldu) {
      mesajEkle(sohbetId, hazirlanma
        ? { rol: 'not', bloklar: [{ tur: 'metin', metin: mesaj }], kaynak: HAZIRLIK_NOTU_KAYNAGI, gizli }
        : { rol: 'not', bloklar: [{ tur: 'metin', metin: `⚠ ${mesaj}` }], gizli });
    }
    beyinHata = !durduruldu && !hazirlanma; // düzeltme turu 1: hazırlanma bir bekleme, Beyin'de "bir sorun oldu" değil
    if (beyinHata) beyinAyrinti = ham.slice(0, 120);
    return null;
  } finally {
    if (calisiyorSaati) clearTimeout(calisiyorSaati);
    if (calisiyorAcik) calisiyorYay(sohbetId, null);
    beyinBitir(beyinHata, beyinHata ? 'bir sorun oldu' : hazirlanma ? 'yapay zekâ hazırlanıyor' : 'yanıtladı', beyinAyrinti);
    aktif.delete(sohbetId);
    ekranKullanicida.delete(sohbetId);
    zihinDurumu('bos');
    // Hata/durdurma: bu turun işi yok ama önceki turlardan bekleyenler artık çalışabilir (tur bitti).
    if (turSonrasi.suruyorMu(sohbetId)) turSonrasi.bitti(sohbetId, {}, girdi.sesli ? TUR_SONRASI_MS.sesli : TUR_SONRASI_MS.yazili);
  }
}

/** `izinli` (G9, yalnız görev adımı): çağrı görev izninin kapsamındaysa aracın istediği onay sorulmadan verilir; değilse normal onay kartı
 *  görevin adıyla çıkar (`gorevBasligi`; son inceleme küçük 4: kullanıcı hangi arka plan görevinin sorduğunu görür). */
async function araciCalistir(c: Extract<Blok, { tur: 'arac_cagri' }>, arac: Arac | undefined, b: Omit<AracBaglami, 'onay'>, izinli?: GorevAdimi['izinli'], gorevBasligi?: string): Promise<{ blok: Blok; yeniAraclar?: Arac[]; geriDonussuz?: boolean }> {
  // B7: İş modunda başarısız/reddedilen adımın kartı ham hatayı göstermez (shared/is-dili.ts aracKartiOzeti); Geliştirici'de ayrıntı.
  const kart = (durum: Extract<GorunenBlok, { tur: 'arac' }>['durum'], ozet?: string, gorsel?: string, yol?: string) =>
    sohbetOlayi({ tur: 'arac', sohbetId: b.sohbetId, blok: { tur: 'arac', id: c.id, ad: c.ad, etiket: aracEtiketi(c.ad, c.girdi), girdi: c.girdi, durum, ozet: aracKartiOzeti(durum, ozet, ayarlar().mod), gorsel, ...(yol ? { yol } : {}) } });
  if (!arac) { kart('hata', 'Bilinmeyen araç'); return { blok: { tur: 'arac_sonuc', id: c.id, ad: c.ad, icerik: `Bilinmeyen araç: ${c.ad}`, hata: true } }; }
  // Yetki çalıştırma anında da denetlenir: araç listesi tur başında kuruldu (yetki tur ortasında kapanmış olabilir) ve
  // aracBul() listede olmayan adı da bulur.
  if (!grupEtkin(arac.grup)) {
    kart('hata', 'Bu araç şu an kapalı');
    return { blok: { tur: 'arac_sonuc', id: c.id, ad: c.ad, icerik: `${c.ad} şu an kullanılamaz: "${arac.grup}" yetkisi kapalı ya da bağlantısı yok. Kullanıcıya söyle; Ayarlar ya da Bağlantılar'dan açabilir.`, hata: true } };
  }
  const hata = dogrula((arac.dogrulamaSemasi ?? arac.tanim.sema) as Parameters<typeof dogrula>[0], c.girdi); // 0.14 T16: MCP aracında özgün şema (sağlayıcıya düzleşmiş gider)
  if (hata) { kart('hata', hata); return { blok: { tur: 'arac_sonuc', id: c.id, ad: c.ad, icerik: `Girdi geçersiz: ${hata}. Düzeltip tekrar çağır.`, hata: true } }; }
  if (arac.grup === 'bilgisayar' && !izinli) { ekranKullanicida.add(b.sohbetId); ekranaGecti(); } // G9: ekranı tutan görev adımı kesilir
  kart('calisiyor');
  // Beyin sayfası: Akıl → aracın bölgesi (Göz, El, Hafıza, Saat…) ve sonuç geri.
  const bolge = aractanBolge(arac.grup, c.ad);
  const etiket = aracEtiketi(c.ad, c.girdi);
  if (bolge !== 'ajan') sinyal('ajan', bolge, etiket);
  const beyinBitir = bolge !== 'ajan' ? beyinBasla(bolge, etiket) : () => undefined;
  // 0.14 T18: komutun kendi 120 sn sınırı (R8) + kapanış payı — komut önce kapanır ve o ana dek çıktısı modele gider.
  const sure = arac.grup === 'komut' ? KOMUT_ARAC_SURESI_MS : arac.grup === 'bilgisayar' || arac.grup === 'tarayici' || arac.grup === 'mcp' ? 120_000 : 60_000;

  // Süre yalnız aracın kendi işini sayar; onay kartı beklenirken saat DURUR. Eskiden süre kartı beklerken de doluyordu:
  // modele "zaman aşımı" denip yeniden denetince ikinci kart çıkıyor, geç gelen onay e-postayı yine de gönderiyordu.
  // Süre dolunca bekleyen onay iptal edilir; aracın sonradan istediği onaylar da sorulmadan reddedilir.
  let kalan = sure, basla = 0, onayda = 0, bitti = false;
  let saat: NodeJS.Timeout | null = null;
  let asimBildir: (e: Error) => void = () => undefined;
  const asim = new Promise<never>((_, red) => { asimBildir = red; });
  const onayIptal = new AbortController();
  const saatiKur = () => {
    basla = Date.now();
    saat = setTimeout(() => { saat = null; bitti = true; onayIptal.abort(); asimBildir(new Error(`Araç ${sure / 1000} sn içinde yanıt vermedi`)); }, Math.max(0, kalan));
  };
  const saatiDurdur = () => { if (saat) { clearTimeout(saat); saat = null; kalan -= Date.now() - basla; } };
  /** Düzeltme turu 2: çağrı onay kapısından geçti (kart onaylandı ya da görev izni verdi) — başarılıysa geri dönüşsüz sayılır. */
  let onayGecti = false;
  const baglam: AracBaglami = {
    ...b,
    // 0.14 T18: döngü bu aracı bekleMEYİ bırakınca (süre doldu) komutun süreç ağacı da kapanır — sonucu atılan komut arka planda sürmez. Yalnız komut
    // aracında: öbür araçlar sinyali uzun ömürlü işlere bağlayabilir (finally'deki iptal onları kesmesin).
    sinyal: arac.grup === 'komut' ? AbortSignal.any([b.sinyal, onayIptal.signal]) : b.sinyal,
    onay: async ({ gorevBoyu, ...istek }) => {
      if (bitti) return 'reddet';
      // 0.14 T15: tarayıcıda gönderme/silme/ödeme/form gönderme/indirme HER ZAMAN sorulur — görev planındaki alan izni bunu önceden onaylamış sayılmaz.
      if (!c.ad.startsWith('tarayici_') && izinli?.(c.ad, c.girdi)) { onayGecti = true; return 'bir_kez'; } // G9: görevin başında onaylanmış izin (kart görev sohbetinde görünür)
      if (onayda++ === 0) saatiDurdur();
      // Son inceleme küçük 4: görev adımının izin dışı isteği — kart görevi adıyla anar ("Görev: <başlık> · …").
      const aciklama = izinli ? gorevOnayAciklamasi(gorevBasligi ?? '', istek.aciklama, ayarlar().mod) : istek.aciklama;
      try {
        const karar = await onayIste(b.sohbetId, { ...istek, aciklama, secenekler: gorevBoyu ? ['bir_kez', 'bu_gorev', 'reddet'] : ['bir_kez', 'reddet'] }, onayIptal.signal);
        if (karar !== 'reddet') onayGecti = true;
        return karar;
      } finally {
        if (--onayda === 0 && !bitti) saatiKur();
      }
    },
  };
  saatiKur();
  try {
    const sonuc = await Promise.race([arac.calistir(c.girdi, baglam), asim]);
    const gorsel = sonuc.gorseller?.[0];
    const reddedildi = Boolean(sonuc.hata) && /reddedildi|onay verilmedi/i.test(sonuc.icerik);
    // 0.14 T13 (T12 incelemesi): modele giden sonuç 20.000 karakterde kesilir ve sonuna "… (sonuç kısaltıldı: X / Y karakter)" notu düşer (eskiden 60.000'de
    // kaydediliyor, sağlayıcıda sessizce 20.000'e kesiliyordu); kart da kısaltıldığını söyler.
    const icerik = aracSonucuKisalt(sonuc.icerik);
    const kisaltildi = icerik !== sonuc.icerik && !sonuc.hata ? ' · sonuç kısaltıldı' : '';
    kart(sonuc.hata ? (reddedildi ? 'reddedildi' : 'hata') : 'tamam', `${sonuc.ozet ?? sonuc.icerik.slice(0, 200)}${kisaltildi}`, gorsel ? `data:${gorsel.medya};base64,${gorsel.veri}` : undefined, sonuc.yol);
    // 0.11 G6: başarılı kart_goster — canlı balonda araç satırının yerine kart gelir (kayıtlı görünümde aynı kuraldan: main/sohbet.ts gorunume).
    // Kendiliğinden (proaktif) turda canlı akmaz: o turun metni de yankı bekçisinden geçince bütünüyle görünür (G1, F2).
    if (!sonuc.hata && !b.proaktif) { const k = aracCagrisiKarti(c.ad, c.girdi); if (k) sohbetOlayi({ tur: 'kart', sohbetId: b.sohbetId, aracId: c.id, kart: k }); }
    if (arac.risk !== 'serbest') olayKaydet('arac', { ad: c.ad, girdi: c.girdi, hata: sonuc.hata ?? false });
    // Hatada görünen metin sabit ("bir sorun oldu"); aracın kendi özeti (ham hata olabilir) yalnız ayrıntıda, Geliştirici'de. Özet yoksa
    // ayrıntı aracın döndürdüğü içerikten (B7: eskiden boş kalıyordu). Kullanıcının reddettiği onay sorun değildir: "onay verilmedi".
    if (sonuc.hata) {
      const ayrinti = (sonuc.ozet || sonuc.icerik).slice(0, 120);
      const durumMetni = reddedildi ? 'onay verilmedi' : 'bir sorun oldu';
      beyinBitir(!reddedildi, durumMetni, ayrinti);
      if (bolge !== 'ajan') sinyal(bolge, 'ajan', durumMetni, ayrinti);
    } else {
      beyinBitir(false, sonuc.ozet ?? undefined);
      if (bolge !== 'ajan') sinyal(bolge, 'ajan', sonuc.ozet ?? 'sonuç');
    }
    // Düzeltme turu 2: başarılı çağrı geri dönüşsüz mü — kayıttaki bayrak (risk 'onay'/'kontrol': her seferinde ya da görev başına onaylı araçlar —
    // WhatsApp/e-posta gönderimi, dosya yazma/silme, ekran ve tarayıcı eylemi), çalışırken onay kapısından geçmesi ya da (denetleyici kararı) komut
    // çalıştırma. Görev adımı tavanda kalınca bu çağrılar yinelenmesin diye bildirilir (isler/adim.ts).
    const geriDonussuz = !sonuc.hata && (arac.risk !== 'serbest' || onayGecti || arac.grup === 'komut');
    return { blok: { tur: 'arac_sonuc', id: c.id, ad: c.ad, icerik, gorseller: sonuc.gorseller, hata: sonuc.hata, ...(sonuc.yol ? { yol: sonuc.yol } : {}) }, yeniAraclar: sonuc.yeniAraclar, geriDonussuz };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    kart('hata', m);
    beyinBitir(true, 'bir sorun oldu', m.slice(0, 120)); // ham hata (ör. "page.goto: net::ERR_…") yalnız ayrıntıda
    return { blok: { tur: 'arac_sonuc', id: c.id, ad: c.ad, icerik: `Araç hatası: ${m}`, hata: true } };
  } finally {
    bitti = true;
    saatiDurdur();
    onayIptal.abort();
  }
}

/** `sabit`: başlığı isteyen turun yolu — Gizli bölümün başlığı yerel beyinde kalır (Gizli mod arada kapansa da). */
async function baslikUret(sohbetId: number, kullanici: string, asistan: string, sabit?: SabitYol): Promise<void> {
  const b = sohbetBilgisi(sohbetId);
  if (!b || b.tur !== 'normal' || b.baslik !== 'Yeni sohbet') return;
  try {
    const t = await yardimciMetin('Bu konuşmaya 2-5 kelimelik Türkçe bir başlık ver. Yalnız başlığı yaz, tırnak ve nokta koyma.', `Kullanıcı: ${kullanici.slice(0, 800)}\nYanıt: ${asistan.slice(0, 600)}`, 'baslik', 200, false, sabit);
    if (t) { sohbetBaslikYaz(sohbetId, t.replace(/["“”.]/g, '').slice(0, 60)); sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: { id: 0, rol: 'not', bloklar: [], zaman: new Date().toISOString() } }); }
  } catch { /* başlık en iyi çaba */ }
}

/** Uzun sohbetlerde eski bölümü özetler; özet sistemin yavaş değişen bölümüne girer (önbellek dostu, seyrek güncellenir). Özet buluta
 *  giden sistem bölümüne girdiği için Gizli bölüm ÖZETE GİRMEZ (düzeltme 1). */
async function ozetGuncelle(sohbetId: number, sabit?: SabitYol): Promise<void> {
  const b = sohbetBilgisi(sohbetId);
  if (!b) return;
  const liste = mesajlar(sohbetId, { sonrasi: b.ozetSonMesaj, limit: 2000 });
  // 0.14 T13 düzeltme turu 1: tetik kaydın GERÇEK boyutunu sayar — araç çağrılarının girdisi ve araç sonuçları dahil. Eskiden yalnız metin sayılıyordu:
  // araç ağırlıklı uzun zincirde özet hiç tetiklenmiyor, eski bölüm (asıl istek dahil) geçmiş bütçesinin dışına sessizce düşüyordu.
  const toplam = liste.reduce((n, m) => n + tokenTahmini(m.metin) + m.bloklar.reduce((k, x) => k + (x.tur === 'arac_sonuc' ? tokenTahmini(x.icerik) : x.tur === 'arac_cagri' ? tokenTahmini(JSON.stringify(x.girdi ?? {})) : 0), 0), 0);
  if (toplam < (sabit === 'yerel' ? OZET_ESIGI_YEREL : OZET_ESIGI)) return;
  const kesim = ozetKesimi(liste);
  if (!kesim) return;
  const eski = bulutBaglami(liste.filter((m) => m.id <= kesim.id), true);
  const metin = eski.map((m) => `${m.rol === 'user' ? 'Kullanıcı' : m.rol === 'assistant' ? 'Fuber' : 'Not'}: ${m.metin}`).join('\n').slice(0, 120_000);
  try {
    const o = await yardimciMetin('Bu konuşma bölümünü, sonradan devam edebilmek için yoğun bir özet hâline getir: kararlar, açık işler, önemli bilgiler, tarihler. En çok 400 kelime, Türkçe.', `${b.ozet ? `Önceki özet:\n${b.ozet}\n\n` : ''}Yeni bölüm:\n${metin}`, 'ozet', 1800, false, sabit);
    if (o) sohbetOzetYaz(sohbetId, o, kesim.id);
  } catch { /* özet en iyi çaba */ }
}
