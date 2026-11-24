// ── Form gönderimi algılama (0.14 T15; saf → birim testli: tests/form-gonderimi.test.ts, tests/tarayici.test.ts) ──────────────────────────────
// Ürün kararı: gezinme, okuma, arama ve taslak kendiliğinden; gönderme, silme, ödeme, form gönderme her zaman onay ister.
// Form gönderme AJANIN BEYANINA göre değil, sayfadan okunan öğe bilgisine göre algılanır (`amac` gibi alanlar yok sayılır):
//   1. gönder tipi düğme (button/input submit, form içinde tipsiz button) ya da metni geri dönüşsüz sözcük taşıyan düğme (satın al, öde, sil …);
//   2. form içinde Enter (ve Ctrl+Enter gibi gönderen tuşlar);
//   3. 1. ve 2. kaçarsa ağ katmanı — `SekmeKalkani` (sekme başına; düzeltme turu 4, K1–K7): onaysız POST gezinimi ve gerçek bir submit olayından sonraki
//      fetch/XHR gönderimi (src/main/tarayici.ts session.webRequest.onBeforeRequest; submit olayı src/preload/submit-izci.ts).
// Parola ya da kart alanı içeren form her zaman onaylıdır: içindeki her düğme gönderimdir. Parola/kart alanına yazma yasağı sürer
// (aynı desenler `PAROLA_ALAN_DESENI` / `KART_ALAN_DESENI`; sayfa içi yoklama bu desenlerden kurulur).
import { tusAyristir, type TusAdimi } from './tarayici.ts';
import { aramaFormuMu, type SubmitBilgisi } from './submit-bilgisi.ts';

export { submitBilgisi, aramaFormuMu, submitBilgisiAyikla, type SubmitBilgisi } from './submit-bilgisi.ts';

/** Tıklanan/odaktaki öğenin sayfa içi yoklamayla okunan bilgisi. `tip`: "etiket[:tür]" ("button:submit", "button" = tipsiz, "input:text",
 *  "a", "button:rol" = role=button olan başka öğe). */
export interface OgeBilgisi {
  etiket: string;
  tip: string;
  formIcinde: boolean;
  formYontemi: 'get' | 'post' | null;
  metin: string;
  parolaFormu: boolean;
  kartFormu: boolean;
}

/** Onay kartının önizlemesi için formun özeti: alan ADLARI (değerleri değil — yazılan metin kartlara/geçmişe girmez, P10). */
export interface FormOzeti {
  eylem: string;
  yontem: 'get' | 'post' | null;
  alanlar: { ad: string; tur?: 'parola' | 'kart'; dolu: boolean }[];
}

/** Parola ve kart alanı desenleri: ad, kimlik, yer tutucu, etiket ve autocomplete değerine uygulanır. */
export const PAROLA_ALAN_DESENI = /parola|[sş]ifre|password|passwd|pwd/i;
export const KART_ALAN_DESENI = /cvv|cvc|cc-|card.?(?:number|no|num)|cardnumber|credit.?card|kart.?(?:no|numara)|kredi.?kart|banka.?kart|\biban\b|security.?code|güvenlik.?kodu/i;

/** Alan parola mı kart mı: yazma yasağı (tarayici_yaz, tarayici_tus) ve form sınıflaması. Sayfa içi yoklama aynı desenlerle aynı sonucu verir. */
export function hassasAlanTuru(a: { tip: string; ad?: string; autocomplete?: string }): 'parola' | 'kart' | null {
  const ac = (a.autocomplete ?? '').toLowerCase();
  const ad = a.ad ?? '';
  if (String(a.tip ?? '').toLowerCase() === 'input:password' || /password/.test(ac)) return 'parola';
  if (/^cc-|card/.test(ac) || KART_ALAN_DESENI.test(ad)) return 'kart';
  if (PAROLA_ALAN_DESENI.test(ad)) return 'parola';
  return null;
}

/** Parola/kart alanı odaktayken metin yazan ya da yapıştıran tuş basışı yasak (Enter, Tab, Escape, ok tuşları serbest). */
export function tusYasakliMi(a: TusAdimi, odakTuru: 'parola' | 'kart' | null): boolean {
  return odakTuru !== null && (a.yazdirilabilir || a.yapistirma);
}

// ── Geri dönüşsüz sözcükler ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Düğme metninde geçerse düğme gönderim sayılan sözcükler (tr, en, de, fr). Sözcük sınırıyla eşleşir ("silinen" ≠ "sil"); aksansız yazım da yakalanır. */
export const GERI_DONUSSUZ_SOZCUKLER: readonly string[] = [
  // tr
  'gönder', 'satın al', 'satın alın', 'öde', 'ödeme', 'sipariş', 'giriş yap', 'oturum aç', 'kaydol', 'kayıt ol', 'üye ol', 'onayla', 'sil', 'yayınla', 'paylaş', 'abone ol', 'rezervasyon yap',
  // en
  'submit', 'send', 'buy', 'buy now', 'purchase', 'pay', 'payment', 'checkout', 'place order', 'order', 'sign in', 'log in', 'login', 'sign up', 'register', 'confirm', 'delete', 'subscribe', 'publish', 'post', 'book now',
  // de
  'absenden', 'senden', 'kaufen', 'jetzt kaufen', 'bezahlen', 'zahlen', 'bestellen', 'zahlungspflichtig bestellen', 'anmelden', 'einloggen', 'registrieren', 'bestätigen', 'löschen', 'abonnieren',
  // fr
  'envoyer', 'acheter', 'payer', 'commander', 'valider', 'confirmer', 'se connecter', 'connexion', "s'inscrire", 'supprimer', 'réserver', 'publier',
];

/** Küçük harf (Türkçe), aksansız, tek boşluk: "GİRİŞ YAP" ve "giris yap" aynı. */
function sadelestir(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/[’‘`´]/g, "'").normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ').trim();
}
const kacis = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SOZCUK_DESENI = new RegExp(`(?:^|[^a-z0-9])(?:${GERI_DONUSSUZ_SOZCUKLER.map((s) => kacis(sadelestir(s))).join('|')})(?=[^a-z0-9]|$)`);

/** Metin geri dönüşsüz bir eylem sözcüğü taşıyor mu. */
export function geriDonussuzMu(metin: string): boolean {
  const s = sadelestir(metin ?? '');
  return Boolean(s) && SOZCUK_DESENI.test(s);
}

// ── Öğe sınıflaması ve gönderim kararı ───────────────────────────────────────────────────────────────────────────────────────────────────
interface Tip { ad: string; tur: string }
const tipAyir = (tip: string): Tip => { const [ad = '', tur = ''] = String(tip ?? '').toLowerCase().split(':'); return { ad, tur }; };
const baglantiMi = (t: Tip) => t.ad === 'a' || t.ad === 'area';
const dugmeMi = (t: Tip) => t.ad === 'button' || (t.ad === 'input' && ['submit', 'button', 'image', 'reset'].includes(t.tur));
/** Form içinde göndere basılırsa formu gönderen düğme: tipsiz/`submit` button, `submit`/`image` input. (`button:rol` ve `button:button` değil.) */
const gonderDugmesiMi = (t: Tip) => (t.ad === 'button' && (t.tur === '' || t.tur === 'submit')) || (t.ad === 'input' && (t.tur === 'submit' || t.tur === 'image'));

/**
 * Formun yöntemi — sayfa içi yoklama bu işlevi `toString()` ile sayfaya götürür (tek kaynak; birim testli, kendi içinde bağımsız olmalı).
 * YALNIZ açıkça `method`/`formmethod` = get ya da `role=search` GET sayılır (arama). Yöntemi yazılmamış form (`action`'ı olsa da: aşamalı
 * geliştirilmiş formlar `onsubmit` ile fetch POST yapar), `method="dialog"` ve bilinmeyen değer `null` = bilinmiyor → güvenli tarafta gönderim.
 */
export function formYontemiBul(method: string | null | undefined, formmethod: string | null | undefined, rol: string | null | undefined): 'get' | 'post' | null {
  const m = String(formmethod || method || '').trim().toLowerCase();
  if (m === 'post') return 'post';
  if (m === 'get') return 'get';
  if (String(rol || '').trim().toLowerCase() === 'search') return 'get';
  return null;
}

/**
 * Bu iframe bir ödeme/kart çerçevesi mi (içindeki kart alanları ayrı kökenden görünmez): sağlayıcı kökeni (stripe, adyen, braintree, paypal,
 * checkout.com, iyzico, paytr) ya da adı/başlığında card, kart, payment, ödeme geçer. Sayfa içi yoklama `toString()` ile kullanır (bağımsız).
 */
export function odemeCercevesiMi(src: string | null | undefined, ad: string | null | undefined, baslik: string | null | undefined): boolean {
  let host = '';
  try { host = new URL(String(src || ''), 'http://x.invalid/').hostname; } catch { host = ''; }
  if (/stripe|adyen|braintree|paypal|checkout\.com|iyzico|iyzipay|paytr/i.test(host)) return true;
  return /card|kart|payment|ödeme|odeme/i.test(`${ad || ''} ${baslik || ''}`);
}

/**
 * Bu eylem geri dönüşsüz bir gönderim mi (onay gerekir)?
 *  - `tikla`: bağlantı ve düğme için ADI (metin/etiket) gönderme-silme-satın alma sözcüğü taşıyorsa (bağlantı, role=button, role=menuitem, [onclick] dahil);
 *    düğme parola/kart formunda her zaman; form içinde gönder düğmesi (açık GET arama formu hariç: yalnız sözcük taşıyorsa).
 *  - `enter` (ajanın Enter'ı: gonder=true ya da tuş): her zaman gönderim — textarea, contenteditable ve formsuz kutu dahil; tek istisna açık GET formu
 *    (arama) ve parola/kart yoksa. Odaktaki düğme/bağlantıda Enter, tıklama gibi değerlendirilir.
 */
export function gonderimMi(o: OgeBilgisi, eylem: 'tikla' | 'enter'): boolean {
  const t = tipAyir(o.tip);
  const hassas = o.parolaFormu || o.kartFormu;
  const sozcuk = geriDonussuzMu(o.metin) || geriDonussuzMu(o.etiket);
  if (eylem === 'enter') {
    if (baglantiMi(t)) return sozcuk;
    if (dugmeMi(t)) return gonderimMi(o, 'tikla');
    if (hassas) return true;
    return !(o.formIcinde && o.formYontemi === 'get');
  }
  if (baglantiMi(t)) return sozcuk;
  if (!dugmeMi(t)) return false;
  if (hassas) return true;
  if (o.formIcinde && gonderDugmesiMi(t)) return o.formYontemi === 'get' ? sozcuk : true;
  return sozcuk;
}

// ── Gönderim kalkanı: SEKME BAŞINA durum (düzeltme turu 4, denetleyici kararı K1–K7) ──────────────────────────────────────────────────────
// Süreç genelinde tekil durum YOK: her sekmenin kendi kalkanı vardır (ana süreç: Map<webContentsId, SekmeKalkani>; sekme kapanınca silinir). Pencereler araç
// sayısına ya da tur sınırına değil olayın kendisine bağlıdır ve hiçbiri uzatılmaz: submit penceresi eylemin BAŞINDAN, bekletme penceresi SUBMIT ANINDAN,
// gezinim izni ONAY ANINDAN, kilit RET ANINDAN sayılır. Saat, P14 kapısı ve tur durumu dışarıdan verilir (testte sahte saat).
//  - Gezinim kalkanı (ana/alt çerçeve POST gezinimi: form.submit(), requestSubmit, enctype=text/plain): ajanın dokunduğu sekmede tur boyunca ve son ajan
//    eyleminden 30 sn sonrasına dek açık; kullanıcının kendi girdisi 3 sn pencere açar; onaylı eylemin TEK KULLANIMLIK 10 sn izni (K5) bir POST gezinimini
//    geçirir (Stripe / reCAPTCHA'nın gecikmeli form.submit()'i).
//  - Ağ kalkanı (K4: xhr türündeki — fetch dahil — POST/PUT/PATCH/DELETE): ölçüt gerçek DOM submit olayıdır (K3, src/preload/submit-izci.ts). Onaysız
//    etkileşimli eylemin başından en çok 10 sn içinde görülen submit'ten sonraki 10 sn'de gelen istek: eylemin aracı sürerken TEK kartla sorulur (araç kartın
//    yanıtını bekler), araç dönmüşse kartsız iptal + tek satır not. Arama formunun (açık GET, role=search, arama alanı) submit'i sayılmaz. Tur 5 (denetleyici
//    kararı 2): kart AÇIKKEN sekmenin bütün bu türden istekleri — 10 sn dolmuş ya da yeni bir etkileşimli eylem başlamış olsa da — aynı karta bağlanır.
//  - Ret (K6) sekmeyi 60 sn kilitler: sayfanın yinelediği gönderim (axios-retry, gönderim kuyruğu) de geçemez; aynı sekmede yeni etkileşimli eylem ya da
//    kullanıcının kendi gezinimi kilidi kaldırır.
/** K3/K4: submit penceresi (eylemin başından) ve bekletme penceresi (submit anından). */
export const GONDERIM_PENCERESI_MS = 10_000;
/** K5: onaylı eylemin gezinim izninin ömrü (onay anından; uzatılmaz). */
export const GEZINIM_IZNI_MS = 10_000;
/** K6: ret kilidinin ömrü (ret anından). */
export const KILIT_MS = 60_000;
/** K7: onaydan sonra ağın sakinleşmesi için en uzun bekleme. */
export const AG_SAKIN_MS = 1500;
/** Gezinim kalkanı: son ajan eyleminden sonra (tur çoktan bitmiş olsa da) ajanın dokunduğu sekmede açık kaldığı kuyruk (geç gelen betik POST'u). */
export const KALKAN_KUYRUK_MS = 30_000;
/** Kullanıcının kendi girdisinden sonra gezinme POST'unun serbest kaldığı süre (kullanıcı kendi formunu gönderebilsin). */
export const KULLANICI_PENCERESI_MS = 3000;
/** Ajanın kendi `sendInputEvent`'inin yankı olayını kullanıcı girdisinden ayırma payı. */
const AJAN_GIRDI_PAYI_MS = 600;
/** Engellenen gönderimden sonra o sekmede bir sonraki etkileşimli eylemin onaya zorlandığı süre (algılama kaçırdıysa ikinci şans). */
const ZORLA_MS = 60_000;
/** K4.3: araç dönmüşken gelen istek kartsız iptal edilince sohbete düşen tek satır (sonuna isteğin sekmesi eklenir: sekmeNotu). */
export const ONAYSIZ_FORM_NOTU = 'Sayfa, onay almadan bir form göndermeye çalıştı; durdurdum.';
/** K6: kilitli sekmenin ilk iptalinde düşen tek satır (sonuna isteğin sekmesi eklenir). */
export const KILIT_NOTU = 'Reddettiğin gönderimden sonra sayfa yeniden bir şey göndermeye çalıştı; durdurdum.';
/** Araç sonucunda ajana söylenen durum (başlık). */
export const FORM_ONAY_BEKLIYOR = 'Form gönderimi onay bekliyor';
/** K7: onaylanan isteğin bırakıldığını söyleyen satır (aracın kendi sonucunun altına). */
export const ONAY_SATIRI = 'Kullanıcı onayladı; istek gönderildi.';
/** K7: onay geldi ama P14 kapısı isteği bırakmadı. */
export const ONAY_P14_SATIRI = 'Kullanıcı onayladı ama Gizli mod ya da “Yalnız bu bilgisayar” açık olduğu için istek gönderilmedi.';
/** Tur 5 (Minor 1): onay geldi ama P14 bıraktırmadı; o sekmenin kilidinin ilk iptalinde düşen satır (ret notu yalnız rette). */
export const P14_KILIT_NOTU = 'Onayladın ama Gizli mod ya da “Yalnız bu bilgisayar” açık olduğu için bu sekmeden gönderim durduruldu.';
/** Tur 5 (Minor 4): kart açıkken sekme kapandı, sonra onaylandı. */
export const ONAY_KAPALI_SATIRI = 'Kullanıcı onayladı ama sekme kapandığı için istek gönderilmedi.';
/** Bir sekmenin son araç sonucundan beri durdurulan istekleri (ajana araç sonucunda sayıyla söylenir; tur 5 Minor 3/5). */
export interface EngelKaydi { no: number; etkin: boolean; sayi: number; sayfaDegisti: boolean }
/**
 * Ajana araç sonucunda söylenen engel notu: bütün sekmelerin sayıları birleşir ("N istek durduruldu"; etkin olmayan sekme numarasıyla anılır). Kilit sürerken
 * başka bir kökene geçilmişse "aynı adımı yeniden dene" denmez: sayfa değişti (kapsam dışı 7). Kesin söz yok: durdurulamayan istek gitmiş olabilir.
 */
export function engelNotu(liste: readonly EngelKaydi[]): string {
  const toplam = liste.reduce((t, x) => t + x.sayi, 0);
  const diger = liste.filter((x) => !x.etkin && x.sayi > 0).map((x) => `[${x.no}] numaralı sekmede ${x.sayi}`);
  const sayac = toplam > 0 ? ` ${toplam} istek durduruldu${diger.length ? ` (${diger.join(', ')})` : ''}.` : '';
  const son = liste.some((x) => x.sayfaDegisti) ? 'Sayfa değişti; gerekiyorsa yeniden başla.' : 'Gönderilmesi gerekiyorsa aynı adımı yeniden dene: bu sefer kullanıcıdan onay istenecek.';
  return `${FORM_ONAY_BEKLIYOR}: sayfa onaysız bir gönderim başlattı (form gezinmesi ya da arka plan isteği) ve ben durdurdum.${sayac} Durdurulamayan başka istekler (ör. sayfanın kendi yolladığı veri) gitmiş olabilir; kesin konuşma. ${son}`;
}
const ONAY_SONRASI_BASLIGI = 'ONAYDAN SONRA SAYFA (yeniden okundu):';
const KISALTMA_NOTU = '\n… (onaydan önceki okuma kısaltıldı)';

/** Sekmenin şu anki sayfası (kart ve notlar isteğin KENDİ sekmesini gösterir: K1). */
export interface SekmeSayfasi { adres: string; baslik: string }
/** Kalkanın dışarıdan aldıkları: saat, P14 kapısı (istek anında: bulutYasak), tur sürüyor mu ("Fuber bu sayfada çalışıyor"). */
export interface KalkanOrtami { saat: () => number; bulutKapali: () => boolean; turSuruyor: () => boolean }
/** Kartın sonucu: onay; ret (Durdur dahil); onay geldi ama P14 bıraktırmadı; onay geldi ama sekme kapanmıştı (tur 5 Minor 4). */
export type KartSonucu = 'onay' | 'red' | 'p14' | 'kapali';
/** Kartı soran: eylemi başlatan araç çağrısının onayı (ajan/dongu.ts; kart beklenirken aracın saati durur, sınır onayIste'nin 10 dk'sı). */
export type KartSorusu = (kart: GonderimOnayi) => Promise<string>;

/** K2: bir etkileşimli eylemin (tık, yazma, tuş, seçim) kaydı. `sahip`: eylemi başlatan araç çağrısı (kart ve not onun sohbetine). */
export interface EylemKaydi<S = unknown> {
  no: number;
  /** Eylem düzeyinde kartla onaylandı ya da bekletilen isteğinin kartı onaylandı. */
  onayli: boolean;
  baslangic: number;
  /** K3: sayılan son submit olayının anı. */
  submitAni: number | null;
  /** K4: eylem başına tek kart (bekletilen bütün istekler paylaşır); sonuç: istek bırakılsın mı. */
  kartSoz: Promise<boolean> | null;
  /** Eylem başına tek not (K4.3 ya da K6'nın ilk iptali). */
  notDusuldu: boolean;
  /** Eylemin araç çağrısı döndü (K4.3: bundan sonra bekletme yerine kartsız iptal). */
  aracDondu: boolean;
  /** Kartın sonucu (K7'nin satırı). */
  kartSonucu: KartSonucu | null;
  sahip: S;
  sor: KartSorusu;
}

export type IstekKarari<S> = { karar: 'gec' } | { karar: 'bekle'; soz: Promise<boolean> } | { karar: 'iptal'; not?: string; sahip?: S };
export type GezinimKarari<S> = { karar: 'gec' } | { karar: 'iptal'; not?: string; sahip?: S };

const DEGISTIRICI = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GEC = Object.freeze({ karar: 'gec' as const });

/** Bir sekmenin gönderim kalkanı (K1). Bütün kararlar yalnız bu sekmenin durumuna bakar; başka sekmeye dokunmaz. */
export class SekmeKalkani<S = unknown> {
  /** Ajan bu sekmeye dokundu (araç çağrısı): kalkanlar yalnız bu sekmede işler. */
  ajan = false;
  private sonEylem: EylemKaydi<S> | null = null;
  private gezinimIzni: { bitis: number; kalan: number } | null = null;
  /** K6 kilidi: neden (ret ya da P14; not ona göre) ve konduğu köken (başka kökene geçildiyse ajana "sayfa değişti" denir). */
  private retKilidi: { bitis: number; neden: 'red' | 'p14'; koken: string } | null = null;
  /** Tur 5 (denetleyici kararı 2): sekmenin açık kartı. Açıkken sekmenin BÜTÜN K4 istekleri, pencereden ve son eylemden bağımsız, bu karta bağlanır;
   *  yeni etkileşimli eylem onu silmez. Yanıtlanınca temizlenir. `bekleyen`: karta bağlanan istek sayısı (ret olursa ajana sayıyla söylenir). */
  private acikKart: { soz: Promise<boolean>; bekleyen: number } | null = null;
  /** Sekmenin webContents'i yok oldu (açık kart onaylansa da istek gönderilemez). */
  private kapali = false;
  private sayac = 0;
  /** Bu sekmede süren ajan eylemi (her tür: aç, oku, bekle, tık …). */
  private derinlik = 0;
  private sonAjanBitis = 0;
  private kullaniciBitis = 0;
  private ajanGirdiBitis = 0;
  /** Son araç sonucundan beri durdurulan istek sayısı ve kilit sürerken sayfanın kökeni değişti mi (bir kez okunur). */
  private engel = { sayi: 0, sayfaDegisti: false };
  private zorlaBitis = 0;
  private readonly ortam: KalkanOrtami;
  /** Sekmenin şu anki sayfası (kart ve not için). */
  private readonly sayfa: () => SekmeSayfasi;

  constructor(ortam: KalkanOrtami, sayfa: () => SekmeSayfasi) { this.ortam = ortam; this.sayfa = sayfa; }

  private simdi(): number { return this.ortam.saat(); }
  /** Son etkileşimli eylemin kaydı (K2). */
  get eylem(): EylemKaydi<S> | null { return this.sonEylem; }
  /** Geçerli gezinim izni (K5; süresi dolan ya da kullanılan izin yok sayılır, dirilmez). */
  get izin(): { bitis: number; kalan: number } | null {
    const i = this.gezinimIzni;
    if (i && (this.simdi() > i.bitis || i.kalan <= 0)) this.gezinimIzni = null;
    return this.gezinimIzni ? { ...this.gezinimIzni } : null;
  }
  /** Etkin ret kilidi (K6; 60 sn dolunca kendiliğinden kalkar). */
  get kilit(): { bitis: number; neden: 'red' | 'p14' } | null {
    if (this.retKilidi && this.simdi() > this.retKilidi.bitis) this.retKilidi = null;
    return this.retKilidi ? { bitis: this.retKilidi.bitis, neden: this.retKilidi.neden } : null;
  }

  // ── Ajan eylemi (gezinim kalkanının silahı; kaydı, izni ve kilidi DEĞİŞTİRMEZ) ──
  /** Bu sekmede bir ajan eylemi başlıyor (her tür): kullanıcı penceresi kapanır. */
  ajanEylemiBasla(): void { this.derinlik++; this.kullaniciBitis = 0; }
  /** Ajan eylemi bitti: kuyruk buradan sayılır; ajanın girdi olaylarının yankısı kısa bir süre daha kullanıcı sayılmaz. */
  ajanEylemiBitti(): void {
    this.derinlik = Math.max(0, this.derinlik - 1);
    const t = this.simdi();
    this.sonAjanBitis = t;
    this.ajanGirdiBitis = t + AJAN_GIRDI_PAYI_MS;
  }
  /** Sayfaya gerçek bir girdi olayı geldi: ajan eyleminin ve yankısının dışındaysa kullanıcınındır (3 sn pencere). */
  girdi(): void {
    const t = this.simdi();
    if (this.derinlik > 0 || t < this.ajanGirdiBitis) return;
    this.kullaniciBitis = t + KULLANICI_PENCERESI_MS;
  }
  private kullaniciPenceresi(): boolean { return this.simdi() < this.kullaniciBitis; }
  private silahli(): boolean {
    const t = this.simdi();
    if (t < this.kullaniciBitis) return false;
    return this.derinlik > 0 || this.ortam.turSuruyor() || t < this.sonAjanBitis + KALKAN_KUYRUK_MS;
  }

  // ── K2: etkileşimli eylem ──
  /** Etkileşimli eylem (tık, yazma, tuş, seçim) başlıyor: yeni kayıt; bu sekmenin önceki izni ve kilidi silinir. Eylem düzeyinde onaylıysa sekmeye
   *  onay anından 10 sn'lik tek kullanımlık gezinim izni verilir (K5). */
  etkilesimBasla(a: { onayli: boolean; onayAni?: number; sahip: S; sor: KartSorusu }): EylemKaydi<S> {
    const t = this.simdi();
    this.gezinimIzni = null;
    this.retKilidi = null;
    const e: EylemKaydi<S> = { no: ++this.sayac, onayli: a.onayli, baslangic: t, submitAni: null, kartSoz: null, notDusuldu: false, aracDondu: false, kartSonucu: null, sahip: a.sahip, sor: a.sor };
    this.sonEylem = e;
    if (a.onayli) this.gezinimIzni = { bitis: (a.onayAni ?? t) + GEZINIM_IZNI_MS, kalan: 1 };
    return e;
  }

  // ── K3: submit izcisinin bildirimi ──
  /** Bu sekmenin (ana ya da alt) çerçevesinde submit oldu. Sayılırsa (true) `submitAni` yazılır: ajan sekmesi, arama formu değil, son etkileşimli eylem
   *  onaysız ve eylemin başından en çok 10 sn geçmiş. */
  submitGoruldu(b: SubmitBilgisi): boolean {
    const e = this.sonEylem;
    if (!this.ajan || aramaFormuMu(b) || !e || e.onayli) return false;
    const t = this.simdi();
    if (t - e.baslangic > GONDERIM_PENCERESI_MS) return false;
    e.submitAni = t;
    return true;
  }

  // ── K4: ağ kararı (bu sekmenin xhr isteği) ──
  istekKarari(i: { method: string; resourceType: string; url?: string }): IstekKarari<S> {
    if (!DEGISTIRICI.has(String(i.method).toUpperCase()) || i.resourceType !== 'xhr') return GEC; // ping, cspReport ve öbür türler kalkan dışı
    if (this.kilit) return this.kilitIptali(); // 1. kilit
    const acik = this.acikKart;
    if (acik) { acik.bekleyen++; return { karar: 'bekle', soz: acik.soz }; } // 1b. açık kart: pencereden ve son eylemden bağımsız, o karta bağlanır (tur 5)
    const e = this.sonEylem;
    if (!e || e.onayli) return GEC; // 2. onaylı eylem / onaylanmış kart
    if (e.submitAni === null || this.simdi() - e.submitAni > GONDERIM_PENCERESI_MS) return GEC; // 4. pencere submit anına bağlı
    if (!e.aracDondu) { // 3a. eylemin aracı sürüyor: eylem başına tek kart
      if (e.kartSoz) return { karar: 'bekle', soz: e.kartSoz }; // yanıtlanmış kart (yeniden açılmaz)
      e.kartSoz = this.kartAc(e, istekOnayIstegi(i.method, i.url ?? '', this.sayfa()));
      if (this.acikKart) this.acikKart.bekleyen++;
      return { karar: 'bekle', soz: e.kartSoz };
    }
    this.engelBildir(); // 3b. araç döndü: kartsız iptal, tek not
    const not = this.notAl(e, ONAYSIZ_FORM_NOTU);
    return { karar: 'iptal', sahip: e.sahip, ...(not ? { not } : {}) };
  }

  // ── Gezinim kalkanı (bu sekmenin ana/alt çerçeve POST gezinimi) ──
  gezinimKarari(i: { method: string; resourceType: string }): GezinimKarari<S> {
    if (String(i.method).toUpperCase() !== 'POST' || (i.resourceType !== 'mainFrame' && i.resourceType !== 'subFrame') || !this.ajan) return GEC;
    if (this.kilit) return this.kilitIptali(); // K6
    if (!this.silahli()) return GEC;
    const iz = this.izin;
    if (iz && this.gezinimIzni) { // K5: tek kullanımlık
      this.gezinimIzni.kalan--;
      if (this.gezinimIzni.kalan <= 0) this.gezinimIzni = null;
      return GEC;
    }
    this.engelBildir();
    return { karar: 'iptal' };
  }

  // ── K6: kilit ──
  /** Kullanıcının kendi gezinimi (adres çubuğu, araç çubuğu, sağ tık "Bağlantıyı aç"): kilit kalkar. */
  kullaniciGezinimi(): void { this.retKilidi = null; }
  /** Sekmenin webContents'i yok oldu: açık kart onaylansa da istek gönderilmez (tur 5 Minor 4). */
  kapandi(): void { this.kapali = true; }
  /** Sayfada bir gezinim başladı: ajan eylemi sürmüyorsa ve kullanıcının kendi girdisinin penceresindeyse kullanıcının gezinimidir (kilit kalkar). */
  gezinimBasladi(): void { if (this.derinlik === 0 && this.kullaniciPenceresi()) this.retKilidi = null; }
  private kilitIptali(): { karar: 'iptal'; not?: string; sahip?: S } {
    const k = this.retKilidi;
    const koken = kokenAl(this.sayfa().adres);
    this.engelBildir(1, Boolean(k && k.koken && koken && koken !== k.koken)); // kilit sürerken başka kökene geçildi: ajana "sayfa değişti"
    const e = this.sonEylem;
    const not = e ? this.notAl(e, k?.neden === 'p14' ? P14_KILIT_NOTU : KILIT_NOTU) : undefined; // ret notu yalnız rette (tur 5 Minor 1)
    return { karar: 'iptal', ...(e ? { sahip: e.sahip } : {}), ...(not ? { not } : {}) };
  }

  // ── K5/K6: kart ──
  /** Bekletilen isteklerin kartı (sekmenin AÇIK kartı olur; yanıtlanana dek sekmenin bütün K4 istekleri buna bağlanır): onay → eylem onaylı, sekmeye
   *  gezinim izni, istekler P14 kapısı YENİDEN sorulduktan sonra bırakılır; ret (Durdur dahil) → hepsi iptal, sekmeye 60 sn kilit; onay geldi ama P14 kapalı →
   *  bırakılmaz, sekme kilitlenir (gönderilmeyeni sayfa yineleyemesin); onay geldi ama sekme kapanmıştı → gönderilmez. */
  private kartAc(e: EylemKaydi<S>, kart: GonderimOnayi): Promise<boolean> {
    const acik = { soz: Promise.resolve(false), bekleyen: 0 };
    this.acikKart = acik; // soru açılmadan önce: soran eşzamanlı hata verse de kart temizlenir
    acik.soz = this.kartiBekle(e, kart, acik);
    return acik.soz;
  }
  private async kartiBekle(e: EylemKaydi<S>, kart: GonderimOnayi, acik: { bekleyen: number }): Promise<boolean> {
    let yanit = 'reddet';
    try { yanit = await e.sor(kart); } catch { yanit = 'reddet'; }
    if (this.acikKart === acik) this.acikKart = null; // yanıtlandı: açık kart yok (karar ile temizlik aynı adımda)
    try {
      if (yanit !== 'bir_kez' && yanit !== 'bu_gorev') {
        e.kartSonucu = 'red';
        this.kilitle('red');
        this.engelBildir(Math.max(1, acik.bekleyen));
        return false;
      }
      if (this.ortam.bulutKapali()) {
        e.kartSonucu = 'p14';
        this.kilitle('p14');
        return false;
      }
      if (this.kapali) { e.kartSonucu = 'kapali'; return false; }
      e.kartSonucu = 'onay';
      e.onayli = true;
      this.gezinimIzni = { bitis: this.simdi() + GEZINIM_IZNI_MS, kalan: 1 };
      return true;
    } catch {
      e.kartSonucu = 'red';
      return false;
    }
  }
  private kilitle(neden: 'red' | 'p14'): void { this.retKilidi = { bitis: this.simdi() + KILIT_MS, neden, koken: kokenAl(this.sayfa().adres) }; }

  // ── Engel bildirimi ve ikinci şans ──
  private engelBildir(n = 1, sayfaDegisti = false): void {
    this.engel.sayi += n;
    if (sayfaDegisti) this.engel.sayfaDegisti = true;
    this.zorlaBitis = this.simdi() + ZORLA_MS;
  }
  private notAl(e: EylemKaydi<S>, temel: string): string | undefined {
    if (e.notDusuldu) return undefined;
    e.notDusuldu = true;
    return sekmeNotu(temel, this.sayfa());
  }
  /** Bu sekmede son okumadan beri durdurulan istek sayısı (bir kez okunur; gecikmeli engel sonraki aracın sonucunda, sayıyla bildirilir; tur 5 Minor 5). */
  engellenenAl(): { sayi: number; sayfaDegisti: boolean } { const e = this.engel; this.engel = { sayi: 0, sayfaDegisti: false }; return e; }
  /** Bu sekmede bir gönderim engellendi: sıradaki etkileşimli eylem öğe ne olursa olsun onay ister. */
  zorlaMi(): boolean { return this.simdi() < this.zorlaBitis; }
  zorlaTuket(): void { this.zorlaBitis = 0; }
}

/**
 * Aracın dönüşü (K4.3 / K7): bu çağrının eylemlerinde açık kart varsa yanıtı beklenir (araç kart yanıtlanmadan DÖNMEZ); açık kart kalmayınca eylemler
 * "döndü" işaretlenir — denetim ve işaret aynı adımda, araya istek giremez; bundan sonra gelen istek kartsız iptal edilir. Kartların özeti döner (ret önce).
 */
export async function aracDonusu(eylemler: readonly EylemKaydi<unknown>[]): Promise<KartSonucu | null> {
  const beklenen = new Set<Promise<boolean>>();
  for (;;) {
    const acik = eylemler.filter((e) => e.kartSoz !== null && e.kartSonucu === null && !beklenen.has(e.kartSoz)).map((e) => e.kartSoz as Promise<boolean>);
    if (!acik.length) break;
    for (const s of acik) beklenen.add(s);
    await Promise.allSettled(acik); // yanıt beklenirken açılan başka kart (tuş dizisinin sonraki adımı) döngüde yakalanır
  }
  for (const e of eylemler) e.aracDondu = true;
  const s = eylemler.map((e) => e.kartSonucu);
  return s.includes('red') ? 'red' : s.includes('p14') ? 'p14' : s.includes('kapali') ? 'kapali' : s.includes('onay') ? 'onay' : null;
}

/** K7: kartın sonucuna göre aracın sonucuna eklenecek satır (kart yoksa ya da reddedildiyse null). */
export const kartSatiri = (s: KartSonucu | null): string | null => (s === 'onay' ? ONAY_SATIRI : s === 'p14' ? ONAY_P14_SATIRI : s === 'kapali' ? ONAY_KAPALI_SATIRI : null);

/** K7: aracın kendi sonucu korunur; satır altına, onaydan sonra yeniden okunan sayfa onun altına. `sinir` aşılırsa (araç sonucu modele 20.000 karakterle
 *  gider) önce kendi sonucu kısaltılır: satır ve güncel sayfa kesilmez. */
export function onayliSonuc(kendi: string, satir: string, taze?: string, sinir = Number.POSITIVE_INFINITY): string {
  const ek = `\n\n${satir}${taze ? `\n\n${ONAY_SONRASI_BASLIGI}\n${taze}` : ''}`;
  if (kendi.length + ek.length <= sinir) return `${kendi}${ek}`;
  const yer = Math.max(0, sinir - ek.length - KISALTMA_NOTU.length);
  return `${kendi.slice(0, yer)}${KISALTMA_NOTU}${ek}`;
}

/** Not ya da kart için isteğin sekmesi: ana makine + yol (sorgu dizgesi sır olabilir: yok) ve başlık; tek satır. */
export function sekmeNotu(temel: string, sayfa: SekmeSayfasi): string {
  const ek = [adresYolu(sayfa.adres), kisalt(sayfa.baslik, 80) ? `“${kisalt(sayfa.baslik, 80)}”` : ''].filter(Boolean).join(' · ');
  return ek ? `${temel} (${ek})` : temel;
}

// ── Onay kuralı ve kartlar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Ana sürecin `b.onay(...)`ına verilen istek (gorevBoyu YOK: gönderim "bu görev için izin ver" seçeneği sunmaz). */
export interface GonderimOnayi { baslik: string; aciklama: string; onizleme?: string; tehlike: 'dusuk' | 'orta' | 'yuksek' }

export interface OnayBaglami {
  sayfa: { adres: string; baslik?: string };
  /** `no` ile hedeflenen öğe (tikla/yaz/sec); okunamadıysa null. */
  oge?: OgeBilgisi | null;
  /** Odaktaki öğe (tuş). */
  odak?: OgeBilgisi | null;
  form?: FormOzeti | null;
  /** Bir önceki eylemde POST engellendi: bu eylem onay ister. */
  zorla?: boolean;
  /** tarayici_indir: indirilecek adres. */
  indirmeAdresi?: string;
}

const kisalt = (s: string, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const anaMakine = (adres: string) => { try { return new URL(adres).host; } catch { return ''; } };
/** Web adresinin kökeni (şema + ana makine + kapı); değilse boş. */
const kokenAl = (adres: string): string => { try { const u = new URL(adres); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } };
/** Ana makine + yol; sorgu dizgesi ve parça yok (sır olabilir). Web adresi değilse boş. */
const adresYolu = (adres: string): string => { try { const u = new URL(adres); return /^https?:$/.test(u.protocol) ? kisalt(`${u.host}${u.pathname}`, 120) : ''; } catch { return ''; } };

/** Bir tarayıcı aracı çağrısı onay ister mi, ister de kartı nedir. Ajanın girdisindeki `amac` gibi beyanlar HİÇ okunmaz. */
export function tarayiciAraciOnayi(arac: string, girdi: Record<string, unknown>, b: OnayBaglami): { gerekli: boolean; istek?: GonderimOnayi } {
  const evet = (o: OgeBilgisi | null | undefined, eylem: 'tikla' | 'enter', tus?: string) => ({ gerekli: true as const, istek: gonderimOnayIstegi(o ?? null, eylem, b.sayfa, b.form ?? null, tus) });
  const hayir = { gerekli: false as const };
  switch (arac) {
    case 'tarayici_tikla':
      return (b.oge && gonderimMi(b.oge, 'tikla')) || b.zorla ? evet(b.oge, 'tikla') : hayir;
    case 'tarayici_yaz':
      if (girdi.gonder !== true) return hayir;
      return (b.oge && gonderimMi(b.oge, 'enter')) || b.zorla ? evet(b.oge, 'enter') : hayir;
    case 'tarayici_sec':
      return b.zorla ? evet(b.oge, 'tikla') : hayir;
    case 'tarayici_tus': {
      const ayr = tusAyristir(girdi.tuslar);
      if ('hata' in ayr) return hayir;
      for (const a of ayr.adimlar) {
        if (tusGonderirMi(a, b.odak ?? null)) return evet(b.odak, 'enter', a.ad);
      }
      return b.zorla ? evet(b.odak, 'enter', String(girdi.tuslar)) : hayir;
    }
    case 'tarayici_indir':
      return { gerekli: true, istek: indirmeOnayIstegi(b.indirmeAdresi ?? '') };
    default:
      return hayir;
  }
}

/** Tek bir tuş basışı gönderim mi: Ctrl/Meta+Enter (e-posta/mesaj gönderir) her zaman; Enter odaktaki öğeye göre; Boşluk odaktaki düğmeye. */
export function tusGonderirMi(a: TusAdimi, odak: OgeBilgisi | null): boolean {
  if (a.enter && (a.degistiriciler.includes('control') || a.degistiriciler.includes('meta'))) return true;
  if (!odak) return false;
  if (a.enter && a.degistiriciler.every((d) => d === 'shift')) return gonderimMi(odak, 'enter');
  if (a.bosluk && a.degistiriciler.length === 0) { const t = tipAyir(odak.tip); return dugmeMi(t) && gonderimMi(odak, 'tikla'); }
  return false;
}

/** Gönderim onay kartı: yüksek tehlike, düğme metni ve alan adları (değerler değil), parola/kart formunda ek uyarı. */
export function gonderimOnayIstegi(o: OgeBilgisi | null, eylem: 'tikla' | 'enter', sayfa: { adres: string; baslik?: string }, form: FormOzeti | null, tus?: string): GonderimOnayi {
  const host = anaMakine(sayfa.adres) || 'bu sayfa';
  const dugme = kisalt(o?.metin || o?.etiket || '', 60);
  const formMu = Boolean(o && (o.formIcinde || o.parolaFormu || o.kartFormu)) || Boolean(form);
  const hassas = Boolean(o && (o.parolaFormu || o.kartFormu));
  const yontem = (form?.yontem ?? o?.formYontemi ?? null)?.toUpperCase();
  const baslik = formMu ? 'Fuber bu formu göndersin mi?'
    : tus ? `Fuber ${kisalt(tus, 30)} tuşuna bassın mı?`
    : dugme ? `Fuber “${dugme}” düğmesine bassın mı?` : 'Fuber bu düğmeye bassın mı?';
  let aciklama = formMu
    ? `${host} sayfasında bir form gönderilecek${yontem ? ` (${yontem})` : ''}. Gönderilen bilgiler geri alınamayabilir; onaylamazsan gönderilmez.`
    : `${host} sayfasında bu işlem bir şeyi gönderebilir, satın alabilir ya da silebilir; onaylamazsan yapılmaz.`;
  if (hassas) aciklama += ' Formda parola ya da kart alanı var; bu alanları Fuber yazmaz, bilgileri senin girmiş olman gerekir.';
  const satirlar: string[] = [];
  if (dugme) satirlar.push(`${eylem === 'enter' && !tus ? 'Enter ile' : 'Düğme'}: “${dugme}”`);
  else if (tus) satirlar.push(`Tuş: ${kisalt(tus, 30)}`);
  if (form?.eylem) satirlar.push(`Gittiği yer: ${yontem ? `${yontem} ` : ''}${form.eylem.replace(/^https?:\/\//i, '').slice(0, 120)}`);
  if (form?.alanlar.length) {
    const ad = (a: FormOzeti['alanlar'][number]) => `${kisalt(a.ad, 30) || 'adsız'}${a.tur ? ` (${a.tur === 'parola' ? 'parola alanı' : 'kart alanı'})` : ''}`;
    const ilk = form.alanlar.slice(0, 12).map(ad).join(', ');
    satirlar.push(`Alanlar: ${ilk}${form.alanlar.length > 12 ? ` · +${form.alanlar.length - 12} alan daha` : ''}`);
  }
  return { baslik, aciklama, ...(satirlar.length ? { onizleme: satirlar.join('\n') } : {}), tehlike: 'yuksek' };
}

/** Ajanın eyleminden sonra sayfanın arka planda (fetch/XHR) göndermek istediği değiştirici istek için kart (yüksek tehlike; aynı eylemin istekleri tek kart).
 *  `sayfa`: isteğin KENDİ sekmesi (K1: etkin sekme değil) — açıklamada adresi (sorgusuz) ve başlığı. */
export function istekOnayIstegi(yontem: string, adres: string, sayfa: SekmeSayfasi): GonderimOnayi {
  const host = anaMakine(sayfa.adres) || anaMakine(adres) || 'bu sayfa';
  let yol = adres;
  try { const u = new URL(adres); yol = `${u.host}${u.pathname}`; } catch { /* ham adres */ }
  const y = String(yontem || 'POST').toUpperCase();
  const sekme = adresYolu(sayfa.adres);
  const baslik = kisalt(sayfa.baslik, 60);
  const nerede = sekme ? `${sekme}${baslik ? ` (“${baslik}”)` : ''} sayfası` : `${host} sayfası`;
  return {
    baslik: 'Sayfa bir şey göndermek istiyor',
    aciklama: `${nerede}, Fuber’in son adımından hemen sonra arka planda veri göndermek (${y}) istiyor; bir form, mesaj, satın alma ya da silme olabilir. Onaylamazsan gönderilmez.`,
    onizleme: `${y} ${kisalt(yol, 160)}`,
    tehlike: 'yuksek',
  };
}

/** İndirme onay kartı: her indirme ayrı sorulur. */
export function indirmeOnayIstegi(adres: string): GonderimOnayi {
  const host = anaMakine(adres) || 'bilinmeyen site';
  let yol = adres;
  try { const u = new URL(adres); yol = `${u.host}${u.pathname}${u.search}`; } catch { /* ham adres */ }
  return {
    baslik: 'Fuber bu dosyayı indirsin mi?',
    aciklama: `${host} sitesinden bir dosya İndirilenler klasörüne indirilecek; onaylamazsan indirilmez.`,
    onizleme: kisalt(yol, 200),
    tehlike: 'orta',
  };
}
