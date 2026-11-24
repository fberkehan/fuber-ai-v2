// ── WhatsApp kapısı (tests/whatsapp-kapisi.test.ts) ──────────────────────────────────────────────────────────────────
// WhatsApp bağlantısı bu depoda yoktur; kapı modülsüz kapalı kalır. Bağlantının kendisi (WhatsApp istemcisi, oturum, araçlar, önem sınıflaması) ayrı,
// isteğe bağlı bir modüldür (ozel/<modül>/kayit.ts; varsa scripts/build-main.mjs ana paketin girişine ekler).
// Genel kod o modülü HİÇ içe aktarmaz; onunla yalnız buradan konuşur:
//   · kayıt   — modül yüklenince `whatsappModuluKaydet(modul)` çağırır (modül yoksa hiçbir şey kaydedilmez).
//   · yetki   — `whatsappYetkisiSimdi()`: modül var mı, İş modu mu, hesabın WhatsApp hakkı var mı (saf kural: shared/whatsapp-yetki.ts).
// Karar ANA SÜREÇTE uygulanır: yetki yokken IPC başlatmaz, araçlar sunulmaz (ajan/dongu.ts grupEtkin), kokpit ve çentik verisi boş, arayüz satırı çizmez
// (durum yanıtındaki `izinli`). Kapı kapanınca (Developer mode'a geçiş, hak bitti) süren bağlantı DURUR — oturum ve kullanıcının "etkin" kararı korunur;
// kapı yeniden açılınca etkin bağlantı kendiliğinden döner. Modül yokken her şey sessizce "kapalı": satır yok, hata yok.
import { ayarlar, ayarlariKaydet, ayarDinle } from '../ayarlar.js';
import { yayinla } from '../olaylar.js';
import { whatsappYetkisi, type WhatsappEngeli, type WhatsappYetkisi } from '../../shared/whatsapp-yetki.js';
import type { UcuncuTaraf } from '../../shared/ucuncu-taraf.js';

export type WaBaglantiDurumu = 'kapali' | 'qr' | 'baglaniyor' | 'bagli' | 'hata';
export interface WhatsappModulDurumu { durum: WaBaglantiDurumu; qr?: string; numara?: string }
/** Alıcı çözümü: mesajın gideceği jid ve o adı taşıyan farklı özel sohbetler (görev izni yalnız TEK adayda geçerlidir; isler/kisiler.ts). */
export interface WhatsappKisiCozumu { jid: string | null; adaylar: { jid: string; ad: string }[] }

/** Testlerin ağsız kancası (yalnız testler kullanır): sahte gönderici takmak ve sınıflamayı beklemeden çalıştırmak. */
export interface WhatsappTestKancasi {
  soketKur(s: { sendMessage: (jid: string, icerik: { text: string }) => Promise<unknown>; end: (e?: Error) => void; logout: () => Promise<void>; user?: { id: string } } | null): void;
  siniflandir(yeni: { jid: string; ad: string; metin: string }[]): Promise<void>;
}

/** Modülün genel koda sunduğu küçük arayüz. */
export interface WhatsappModulu {
  durum(): WhatsappModulDurumu;
  /** Bağlan (QR ya da kayıtlı oturum). Yetki denetimini kapı yapar; modül çağrıldığında bağlanır. */
  baslat(): Promise<void>;
  /** Kapı kapandı: bağlantıyı keser ve yeniden denemez. Oturum dosyası ve ayardaki "etkin" KORUNUR. */
  durdur(): void;
  /** Kullanıcının çıkışı: oturum silinir, ayar kapanır. */
  cikis(): Promise<void>;
  kisiCoz(kime: string): WhatsappKisiCozumu;
  /** Araçları ajan kaydına ekler (grup 'whatsapp'); sunulup sunulmayacaklarına grupEtkin karar verir. */
  araclariKaydet(): void;
  /** Hakkında'ya eklenecek üçüncü taraf bildirimleri (modülle birlikte pakete girenler). */
  lisanslar?: readonly UcuncuTaraf[];
  /** Testlerin kancası (uygulama kullanmaz). */
  test?: WhatsappTestKancasi;
}
/** Arayüzün gördüğü durum: bağlantı + yetki. Yetki yokken bağlantı her zaman 'kapali' görünür. */
export interface WhatsappDurumu extends WhatsappModulDurumu { izinli: boolean; neden?: WhatsappEngeli }

let modul: WhatsappModulu | null = null;

/** Modülün kaydı (modülün kendi giriş dosyası çağırır; testler sahte modül verebilir). */
export function whatsappModuluKaydet(m: WhatsappModulu): void { modul = m; }
export function whatsappModuluVar(): boolean { return modul !== null; }
/** Testler için: kayıtlı modülün ağsız kancası (modül yoksa null — bu depoda WhatsApp testleri atlanır). */
export function whatsappTestKancasi(): WhatsappTestKancasi | null { return modul?.test ?? null; }

/** Test kancası: yalnız arka plan test kipinde (FUBER_DEMO) "paket var" sayılır — özellik denetimi ve önizlemeler hesap açmadan satırı görebilsin.
 *  Kurulu uygulamada ortam kapısı bu değişkeni her profilde siler (shared/ortam-kapisi.ts KURULUDA_SILINEN_KANCALAR). */
const testPaketi = (): boolean => process.env.FUBER_DEMO === '1' && process.env.FUBER_TEST_WHATSAPP_PAKET === '1';

export function whatsappYetkisiSimdi(): WhatsappYetkisi {
  const a = ayarlar();
  const hesap = testPaketi() ? { durum: 'aktif' as const } : a.hesap;
  return whatsappYetkisi({ modulVar: modul !== null, mod: a.mod, hesap });
}
export const whatsappIzinli = (): boolean => whatsappYetkisiSimdi().izinli;

export function whatsappDurumu(): WhatsappDurumu {
  const y = whatsappYetkisiSimdi();
  if (!y.izinli || !modul) return { durum: 'kapali', izinli: false, ...(y.neden ? { neden: y.neden } : {}) };
  return { ...modul.durum(), izinli: true };
}
/** Modül durum değiştirince çağırır: arayüze bağlantı + yetki birlikte gider. */
export function whatsappDurumYayinla(): void { yayinla('whatsapp:durum', whatsappDurumu()); }

/** Ajan için "bağlı": yetki var VE bağlantı açık. */
export function whatsappBagli(): boolean { return whatsappIzinli() && modul?.durum().durum === 'bagli'; }

/** Arayüzün "Bağla"sı: yetki yoksa hiçbir şey yapmaz (ayar da açılmaz), durumu döner. */
export async function whatsappBaslat(): Promise<WhatsappDurumu> {
  if (!whatsappIzinli() || !modul) return whatsappDurumu();
  ayarlariKaydet((a) => { a.whatsapp.etkin = true; });
  await modul.baslat();
  return whatsappDurumu();
}

/** Çıkış her zaman serbest (yetki kapalıyken de oturum silinebilir). Modül yoksa yalnız ayar kapanır. */
export async function whatsappCikis(): Promise<void> {
  if (modul) { await modul.cikis(); return; }
  ayarlariKaydet((a) => { a.whatsapp.etkin = false; a.whatsapp.bagli = false; a.whatsapp.numara = undefined; });
}

export function whatsappKisiCoz(kime: string): WhatsappKisiCozumu {
  return modul ? modul.kisiCoz(kime) : { jid: null, adaylar: [] };
}

export function whatsappAraclariniKaydet(): void { modul?.araclariKaydet(); }

/** Hakkında için modülün bildirimleri (modül yoksa boş). */
export function whatsappLisanslari(): readonly UcuncuTaraf[] { return modul?.lisanslar ?? []; }

let dinleyici: (() => void) | null = null;
/**
 * Açılışta bir kez (main.ts): yetki varsa ve kullanıcı WhatsApp'ı açık bıraktıysa bağlanır; sonra her ayar değişiminde (mod, hesap, paket) YALNIZ
 * kapının geçişine bakar — kapandıysa durdurur, açıldıysa ve "etkin" ise bağlanır. Geçiş yokken bir şey yapmaz (bugünkü davranış: oturum düşünce
 * kendiliğinden yeniden bağlanmaz).
 */
export function whatsappKapisiniBaslat(): void {
  let onceki = whatsappIzinli();
  if (onceki && ayarlar().whatsapp.etkin) void modul?.baslat();
  dinleyici?.();
  dinleyici = ayarDinle(() => {
    const simdi = whatsappIzinli();
    if (simdi === onceki) return;
    onceki = simdi;
    if (!simdi) modul?.durdur();
    else if (ayarlar().whatsapp.etkin) void modul?.baslat();
    whatsappDurumYayinla();
    yayinla('kokpit:veri-degisti', { neden: 'whatsapp-yetki' }); // kokpit ve çentik WhatsApp kartını hemen kaldırır/geri getirir
  });
}
