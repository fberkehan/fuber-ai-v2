// ── "Nerede çalışsın?" — Fuber (önerilen) · Yalnız bu bilgisayar · Gizli (0.12 H3c; saf, birim testli: tests/nerede.test.ts) ──────────────
// Spec §1 adım 5 ve Hedefler §5. Kurulumun Nerede adımı (renderer/kurulum2/NeredeAdimi.tsx) ve Ayarlar → Gizlilik (TEK yer) aynı bileşeni
// (renderer/bilesenler/NeredeSecimi.tsx) ve buradaki kuralları kullanır. Ayar alanları değişmedi: `yerel.gizliMod` (Gizli) ve
// `yerel.yalnizYerel` (Yalnız bu bilgisayar; 0.11 G8'de Geliştirici'ye özeldi — artık İş'te de etkin: shared/tek-motor.ts yalnizYerelEtkin).
//  · Fuber           yanıtlar bulut yapay zekâdan; hafıza bu bilgisayarda.
//  · Yalnız bu bilgisayar  yapay zekâ bu bilgisayarda çalışır; Gizli DEĞİLDİR — hesap, eşitleme ve kokpit kartları internete bağlanmayı sürdürür,
//                    gizlilik sözü verilmez (Review Focus 4). Düzeltme turu 1 (P14): yanıtlar ve ses HİÇ buluta gitmez — yerel hazır
//                    olana dek sohbet bekler (tek-motor.ts); ses Gizli'deki gibi bu bilgisayarda (sesBuBilgisayarda).
//  · Gizli           F1 kuralları AYNEN (tek-motor.ts, yerel/gizli-geri-al.ts): yanıtlar yalnız yerel; hiçbir hesap işlemi ağa çıkmaz (H3b).
// İkisi birbirini dışlar: Gizli seçilince yalnızYerel kapanır (Gizli kapanınca kullanıcı Fuber'e döner), "Yalnız bu bilgisayar" seçilince Gizli.
// Y1 (H3b yeniden incelemesi): kurulumun ön seçimi taslaktan kopyalanmaz — kullanıcının BU kurulumdaki son açık seçimi, yoksa o anki GERÇEK
// hâl (neredeOnSecimi). Hesap adımında "Gizli moddan çık ve devam et" denirse açık "Gizli" seçimi düşer (gizliKapanincaSecim): Nerede
// "Fuber (önerilen)" ile gelir ve "Devam" Gizli'yi yeniden açmaz; kullanıcı Gizli'yi yine açıkça seçebilir.
import type { Mod } from './tipler.ts';
import { BULUT_YZ_KAPALI, GIZLI_KARTI } from './gizlilik-metni.ts';

export type Nerede = 'fuber' | 'yerel' | 'gizli';

export interface NeredeSecenegi {
  deger: Nerede;
  /** Kartın başlığı (önerilen rozeti ayrı: "Önerilen"). */
  baslik: string;
  /** Erişilebilir adı — birebir etiket (Fuber'in "(önerilen)"i dahil). */
  etiket: string;
  simge: string;
}
export const NEREDE_SECENEKLERI: readonly NeredeSecenegi[] = [
  { deger: 'fuber', baslik: 'Bulut', etiket: 'Bulut (önerilen)', simge: 'kure' },
  { deger: 'yerel', baslik: 'Yalnız bu bilgisayar', etiket: 'Yalnız bu bilgisayar', simge: 'ekran' },
  { deger: 'gizli', baslik: 'Gizli', etiket: 'Gizli', simge: 'kilit' },
];

/** Kartın tek cümlesi. "Yalnız bu bilgisayar" ile Gizli'nin farkı burada tek cümleyle: biri hesabı ve eşitlemeyi sürdürür, ötekinde Fuber
 *  hesabı kapalı (T34b: shared/gizlilik-metni.ts GIZLI_KARTI). Mutlak söz yok (F1 K1: e-posta/WhatsApp eşitlemesi Gizli'de de sürer — Gizli'nin kapsamı gizliKapsami'nda). */
export function neredeAciklamasi(n: Nerede, mod: Mod): string {
  // Kısa tutulur: kurulumun 520 px sütununda tek satır (1080×680'de de; boşluk kuralı).
  const gel = mod === 'gelistirici';
  // 0.13.1: "hafızan bu bilgisayarda kalır" güvencesi kartlardan kalktı — ekranda yalnız NEREDE_FUBER_CUMLESI söyler (bir kez, gerçeğiyle).
  if (n === 'fuber') return gel ? 'Yanıtlar bulut motorundan.' : 'En iyi ve en hızlı yanıtlar.';
  if (n === 'yerel') return 'Yanıtlar ve ses bu bilgisayarda üretilir; hesap ve eşitleme açık kalır.';
  return GIZLI_KARTI;
}

/** Fuber seçiliyken verinin nereye gittiği (kurulumun Nerede adımı, tanıtım sitesi — Nerede ve Gizlilik bölümleri dört dilde aynı söz).
 *  GERÇEĞE UYAR (0.13.1 incelemesi): bulut yolunda ajan döngüsü (main/ajan/dongu.ts) sohbet geçmişi ve sorunun yanında hafızadan ilgili notları
 *  (hafiza/depo.ts turBaglami: arama sonucu kayıtlar) ve çekirdek hafıza kayıtlarını (cekirdekMetni) sistem metnine koyar; bu metin
 *  seçtiğin bulut sağlayıcısına gider. Yani sorduğun şey VE ilgili notlar o sağlayıcıya gider; hafıza ve sohbetlerin kendisi bu bilgisayardaki veritabanında kalır.
 *  Mutlak söz yok: "hiçbir şey çıkmaz" denmez. */
export const NEREDE_FUBER_CUMLESI = 'Sorduğun şey ve ilgili notların yanıt için bağladığın bulut yapay zekâya gider; hafızan ve sohbetlerin bu bilgisayarda saklanır.';
/** Aynı söz resmî hitapta (kurulum Adım 6; shared/kurulum-metin.ts KM.neredeFuber çifti). */
export const NEREDE_FUBER_CUMLESI_SIZ = 'Sorduğunuz şey ve ilgili notlarınız yanıt için bağladığınız bulut yapay zekâya gider; hafızanız ve sohbetleriniz bu bilgisayarda saklanır.';

/** Ö1 (düzeltme turu 1): ses bu bilgisayarda mı üretilsin — Gizli ya da "Yalnız bu bilgisayar" (sıkı boolean). Ana süreç (ses.ts bulutsuz,
 *  ses-uyum.ts) ve kurulumun Ses adımı aynı kuralı okur: Fuber'in sesi kullanılmaz, konuşma tanıma yerel yoksa sesli giriş kapalı. */
export function sesBuBilgisayarda(y: { gizliMod?: boolean; yalnizYerel?: boolean } | null | undefined): boolean {
  return neredeYerelMi(y);
}

/** Düzeltme turu 2: "Nerede çalışsın" bu bilgisayarda mı (Gizli ya da "Yalnız bu bilgisayar"; sıkı boolean) — buluta istek gitmez:
 *  sesin yanında Geliştirici'nin "Bağlantıyı dene"si de (ipc.ts motor:sina, Formlar.tsx MotorKarti) ve tek kurulum yolu (Gizlilik). */
export function neredeYerelMi(y: { gizliMod?: boolean; yalnizYerel?: boolean } | null | undefined): boolean {
  return y?.gizliMod === true || y?.yalnizYerel === true;
}
/** "Bağlantıyı dene"nin yalnız/Gizli'deki kısa nedeni (düğme kapalı; ana süreç de reddeder). */
export const BAGLANTI_DENENMEZ = `Gizli ya da “Yalnız bu bilgisayar” seçiliyken bağlantı denenmez; ${BULUT_YZ_KAPALI}.`;
/** Son bütün dal incelemesi Ö-2: Gizli / "Yalnız bu bilgisayar" seçiliyken sağlayıcı listeleri (ipc.ts motor:modeller; ses listesi 0.13'te hiç alınmaz)
 *  istenmez — liste isteği kayıtlı anahtarı buluta taşır (kardeş uç main/motor/model-listesi.ts, e57ad80). Arayüzün sakin notu. */
export const LISTE_ALINMAZ = `Gizli ya da “Yalnız bu bilgisayar” seçiliyken liste sağlayıcıdan alınmaz; ${BULUT_YZ_KAPALI}.`;

/** K-1 (son bütün dal incelemesi): "Yalnız bu bilgisayar" yükseltme göçünün işareti (`Ayarlar.yalnizYerelGocu`). Yeni profilde ayarlar()
 *  bellekte koyar (ilk kayıtta dosyaya); işaretsiz VAR OLAN profil 0.12'nin bu düzeltmesinden öncedir → açılışta bir kez karar
 *  (main/yerel/gizli-geri-al.ts acilistaYalnizYerelGocu). */
export const YALNIZ_YEREL_GOCU = 1;

/**
 * K-1: işaretsiz (0.12 öncesi) profilde eski `yalnizYerel` kalsın mı. 0.11 G8'de tercih YALNIZ Geliştirici'de ve YALNIZ yerel hazırken etkindi
 * (İş'te yok sayılırdı; hazır değilken bulut sürerdi) ve mod değişince sıfırlanmazdı. 0.12'de iki modda da etkin ve hazır değilken sohbet bekler
 * (P14) — kullanıcı 0.12'de bilerek seçmediyse sessizce yerel kipe düşmesin: İş'te (değer Geliştirici döneminden kalma) ya da yerel hazır
 * değilken temizlenir. Geliştirici'de yerel hazırken 0.11'de de etkindi: korunur. Dönüş: yalnizYerel'in yeni değeri.
 */
export function yalnizYerelGocu(g: { yalnizYerel: boolean; mod: Mod; yerelHazir: boolean }): boolean {
  return g.yalnizYerel === true && g.mod === 'gelistirici' && g.yerelHazir === true;
}

/** Kayıtlı ayardan bugünkü hâl (Ayarlar'ın seçimi): Gizli önce. */
export function neredeHali(y: { gizliMod?: boolean; yalnizYerel?: boolean } | null | undefined): Nerede {
  if (y?.gizliMod === true) return 'gizli';
  if (y?.yalnizYerel === true) return 'yerel';
  return 'fuber';
}

/** Y1: kurulumun Nerede ön seçimi. `secim`: bu kurulumdaki son açık seçim (yoksa null). Yoksa gerçek hâl; o da Fuber'se ve hesapsız
 *  geçildiyse (yapay zekâ bu bilgisayarda olmalı) "Yalnız bu bilgisayar". */
export function neredeOnSecimi(g: { secim: Nerede | null; gizliMod: boolean; yalnizYerel: boolean; hesapsiz: boolean }): Nerede {
  if (g.secim) return g.secim;
  const h = neredeHali(g);
  return h === 'fuber' && g.hesapsiz ? 'yerel' : h;
}

/** Y1: gerçek Gizli hâli AÇIKTAN KAPALIYA döndüyse (hesap adımında "Gizli moddan çık", ya da Gizli kendiliğinden geri alındı) açık "Gizli"
 *  seçimi düşer; öteki seçimler ve Gizli'nin açılması hiçbir şeyi düşürmez. */
export function gizliKapanincaSecim(secim: Nerede | null, once: boolean, simdi: boolean): Nerede | null {
  return secim === 'gizli' && once && !simdi ? null : secim;
}

/** Seçimin yerel ayar yaması — yalnız değişen alanlar (değişiklik yoksa null). `kurulu`: bu bilgisayardaki yapay zekâ kurulu (çalıştırıcı +
 *  model) — yerel ya da Gizli seçilince açılır (yoksa yol "hazır değil" kalırdı; indirme bitince ana süreç açar: yerel/kurulum.ts
 *  bekleyenTamamla). Fuber seçilince yerelin açık/kapalısı korunur (bulut yolunda zaten kullanılmaz). */
export function neredeYamasi(secim: Nerede, y: { gizliMod?: boolean; yalnizYerel?: boolean; etkin?: boolean }, kurulu: boolean): { gizliMod?: boolean; yalnizYerel?: boolean; etkin?: boolean } | null {
  const hedef = { gizliMod: secim === 'gizli', yalnizYerel: secim === 'yerel' };
  const yama: { gizliMod?: boolean; yalnizYerel?: boolean; etkin?: boolean } = {};
  if (Boolean(y.gizliMod) !== hedef.gizliMod) yama.gizliMod = hedef.gizliMod;
  if (Boolean(y.yalnizYerel) !== hedef.yalnizYerel) yama.yalnizYerel = hedef.yalnizYerel;
  if (secim !== 'fuber' && kurulu && !y.etkin) yama.etkin = true;
  return Object.keys(yama).length ? yama : null;
}
