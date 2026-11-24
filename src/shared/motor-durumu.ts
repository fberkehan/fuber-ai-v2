// ── Motor durumu: TEK kaynak (0.10 Görev 2, Karar D2; Ruling R5/R16; saf, birim testli: tests/motor-durumu.test.ts) ──────────────────
// Eski kural: kimse API anahtarı girmez, herkes kayıt olur. Bu derlemede İş modunun yapay zekâsı Fuber hesabından gelir (E3: masaüstü
// hesabı, src/shared/masaustu-hesap.ts). Motor yokken TEK ve SAKİN bir bildirim gösterilir — dört kırmızı "durdu" değil:
//  · hazir          bulut motoru hazır (Fuber hesabı aktif ya da Geliştirici'nin kendi anahtarı) → bildirim yok
//  · yerel          yalnız bu bilgisayardaki yapay zekâ (gündelik sohbet) → sarı not
//  · bagli-degil    hiç bağlanmamış (P3: motorCalisti false) → NÖTR "Fuber hesabına giriş yap"
//  · durdu          çalışmış bir motor koptu (motorCalisti true VE kurulu bir bağlantı var: hesap kaydı ya da kayıtlı anahtar — kopmaSayilirMi)
//                   → kırmızı; hesabı/anahtarı hiç olmamış kullanıcı 'bagli-degil' görür
//  · hesap-bekliyor Fuber hesabı onay bekliyor (R10) → sakin nötr
//  · hesap-kapali   cihaz kapatıldı / hesap askıda (R10) → kırmızı
//  · kredi-bitti    kullanım hakkı doldu (R10, 402) → kırmızı
//  · hazirlaniyor   Gizli mod açık, bu bilgisayardaki yapay zekâ hazırlanıyor (F1, son inceleme Ö2) → NÖTR, düğmesiz, hap ve ada kartı yok
// Öncelik: Gizli mod açıksa (düzeltme turu 1) yalnız bu bilgisayardaki yapay zekâ sayılır — yanıtlıyorsa "yerel", hazırlanıyorsa (sinyalin
// `hazirlaniyor`u: bekleyen kurulum hatasız ya da indirme sürüyor) "hazirlaniyor", değilse "durdu"; hesabın
// hâline bakılmaz (Gizli modda hesap kullanılmaz). Değilse: bulut motoru hazırsa "hazır"; değilse ve Fuber hesabı bekliyor/kapalı/doldu ise
// o hâl (motor hesaptan gelecekti); değilse eski kural (yerel → yerel, hiç motor yok → motorCalisti'ye göre durdu / bağlı değil). Hesap
// hâllerinin metinleri R10'un birebir metinleri (HESAP_DURUM_METNI). Gönderim ayrı kural: yalnız hiç motor yokken kapalı (gonderimAcikMi) —
// hesap onay beklerken yerel model gündelik sohbeti yine yanıtlar. Kokpit kartı, sohbet şeridi, ada, başlık hapı, kokpit çipleri, Ayarlar →
// Hesap'ın üst satırı ve Etkinlik'in Akıl bölgesi buradan okur (renderer/motor-sinyali.ts gorunum; ana süreçte main.ts beyinBagla).
import { HESAP_DURUM_METNI, type HesapDurumu } from './masaustu-hesap.ts';
import { hazirDurumu } from './kurulum-yerel.ts';
import { YALNIZ_YEREL_NOTU } from './tek-motor.ts';
import type { Mod } from './tipler.ts';
import { BULUT_YZ_KAPALI, BULUT_YZ_KAPALI_KISA } from './gizlilik-metni.ts';

/** Arayüzün motor sinyali (Ruling K) — ANA SÜREÇTEN (main/abonelik.ts motorDurumu; sohbetin kullandığı tekMotorYolu): `bulut` hazır bulut
 *  motoru sayısı (Fuber hesabı ana süreç onun anahtarını kullanabiliyorsa sayılır; Gizli modda 0), `yerel` bu bilgisayardaki yapay zekâ
 *  yanıtlar (tek motor), `gizli` Gizli mod açık (düzeltme turu 1: arayüz bulutu ayarlardan yeniden hesaplamaz), `hazirlaniyor` bu
 *  bilgisayardaki yapay zekâ hazırlanıyor — bekleyen kurulum hatasız ya da indirme sürüyor (F1 Ö2; shared/kurulum-yerel.ts yerelHazirlaniyor),
 *  `yarim` hazırlık DURAKLAMIŞ: kayıt var ama hiçbir şey inmiyor (uygulama indirme sürerken kapanmıştı; F1 düzeltme turu 1, K-1 — satır
 *  "iniyor" demez, "yarıda kaldı; sürdürünce" der). */
export interface MotorSinyali {
  bulut: number; yerel: boolean; gizli?: boolean; hazirlaniyor?: boolean; yarim?: boolean;
  /** 0.11 G8 (K2): yol "Yalnız bu bilgisayardaki yapay zekâ" tercihiyle yerel (Gizli DEĞİL; yerel hazırken; 0.12 H3c: İş'te de; main/abonelik.ts
   *  motorDurumu yalnız true iken yazar). Açıkken bulut hesabının hâli (onay bekliyor / kapalı / kullanım doldu) yerel yolu ezmez ve "bulut motoru
   *  gerekir" notu çıkmaz (kullanılmayan bir bulut hesabı bu yolu ilgilendirmez). Eksik/false: bütün eski satırlar AYNEN. */
  yalnizYerel?: boolean;
  /** 0.12 H3c: "Nerede çalışsın" → "Yalnız bu bilgisayar" SEÇİLİ (Gizli kapalı) — yerel hazır olmasa da (indirme sürüyor). Hiç bulut yokken ve yerel
   *  hazırlanırken görünüm Gizli'nin değil kendi nötr "hazırlanıyor" satırıdır ("Fuber hesabına giriş yap" denmez). Yalnız true iken yazılır. */
  yalnizYerelIstendi?: boolean;
  /** Düzeltme turu 1 (P14 K1): bu bilgisayardaki yapay zekâ iniyorsa yüzdesi ("iniyor · %X"); yoksa yok. */
  yerelYuzde?: number;
}

/** Bildirimin "Yalnız bu bilgisayar" dalı için: tercih seçili mi (yol yerel ya da hazırlanıyor). Çağıranlar sinyalden bununla okur. */
export const yalnizYerelSecili = (s: Pick<MotorSinyali, 'yalnizYerel' | 'yalnizYerelIstendi'> | null | undefined): boolean => s?.yalnizYerel === true || s?.yalnizYerelIstendi === true;

/** 'yerel-hazir-degil' (0.12 H3c düzeltme turu 1, P14 K1): "Yalnız bu bilgisayar" seçili, yerel ne hazır ne hazırlanıyor (indirme hatası,
 *  kaldırıldı, kapalı) — buluta düşülmez; sakin kart iki açık seçim sunar (Yeniden indir · Fuber’le devam et). */
export type MotorGorunumu = 'hazir' | 'yerel' | 'bagli-degil' | 'durdu' | 'hesap-bekliyor' | 'hesap-kapali' | 'kredi-bitti' | 'hazirlaniyor' | 'yerel-hazir-degil';
export const MOTOR_GORUNUMLERI: readonly MotorGorunumu[] = ['hazir', 'yerel', 'bagli-degil', 'durdu', 'hesap-bekliyor', 'hesap-kapali', 'kredi-bitti', 'hazirlaniyor', 'yerel-hazir-degil'];

/** Tek hâl (yukarıdaki öncelik). `motorCalisti`: P3 (Ayarlar.motorCalisti); `hesapDurumu`: masaüstü Fuber hesabının hâli (yoksa hesap yok). */
export function motorGorunumu(s: MotorSinyali, motorCalisti: boolean, hesapDurumu?: HesapDurumu | null): MotorGorunumu {
  // Gizli mod: bulut yolu yok (shared/tek-motor.ts) ve hesap kullanılmaz — yalnız bu bilgisayardaki yapay zekâ. Hazırlanıyorsa nötr
  // "hazirlaniyor" (F1 Ö2: hazırlık bir kopma değildir); hazırlanmıyor ve hazır değilse "durdu" (kullanıcı Gizli modu açtı; "bağlı değil —
  // giriş yap" bir şey açmaz). Bildirimi motorBildirimi(…, gizli) Gizli moda göre söyler.
  if (s.gizli) return s.yerel ? 'yerel' : s.hazirlaniyor ? 'hazirlaniyor' : 'durdu';
  // 0.11 G8 (K2): yalnız-yerel tercihi (Gizli değil): yanıt yolu yerel, bulut hesabının hâli bu yolu ilgilendirmez.
  if (s.yalnizYerel && s.yerel) return 'yerel';
  // 0.12 H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçiliyken bulut HİÇ sayılmaz (bulut sinyali gelse de): hazırsa yerel,
  // hazırlanıyorsa nötr "hazırlanıyor" (sohbet bekler), değilse sakin "hazır değil" kartı. Hesabın hâli bu yolu ilgilendirmez.
  if (s.yalnizYerelIstendi) return s.yerel ? 'yerel' : s.hazirlaniyor ? 'hazirlaniyor' : 'yerel-hazir-degil';
  if (s.bulut > 0) return 'hazir';
  if (hesapDurumu === 'bekliyor') return 'hesap-bekliyor';
  if (hesapDurumu === 'kapali') return 'hesap-kapali';
  if (hesapDurumu === 'kredi-bitti') return 'kredi-bitti';
  if (s.yerel) return 'yerel';
  // Hesap aktif ama ana süreç onun anahtarını kullanamıyor (cihaz anahtarı yok/okunamıyor): giriş yapmış kullanıcıya "giriş yap" denmez —
  // bağlantı koptu + "Yeniden dene" (düzeltme turu 1).
  return motorCalisti || hesapDurumu === 'aktif' ? 'durdu' : 'bagli-degil';
}

/**
 * motorGorunumu'nun `motorCalisti`si (0.12 H3a düzeltme turu 1, kaygı 2): "bağlantı koptu" (kırmızı) YALNIZ gerçekten kurulu bir bağlantı
 * varken — bu bilgisayarda bir Fuber hesabı kaydı ya da kayıtlı bir bulut anahtarı. Hesabı hiç olmamış ve anahtarı olmayan kullanıcı (ör.
 * eski bir sürümden yükseltilmiş, çevrim dışı) eskiden çalışmış bir motor yüzünden kırmızı görmez: sakin "Fuber hesabına giriş yap"
 * ('bagli-degil'). Ana süreç (main.ts) ve arayüz (renderer/motor-sinyali.ts) aynı kuralı buradan okur.
 */
export function kopmaSayilirMi(a: { motorCalisti: boolean; hesap?: unknown; saglayicilar?: Readonly<Record<string, { anahtarVar?: boolean } | undefined>> | null }): boolean {
  return Boolean(a.motorCalisti) && (Boolean(a.hesap) || Object.values(a.saglayicilar ?? {}).some((s) => Boolean(s?.anahtarVar)));
}

/** Sohbetten gönderim açık mı (Ruling K): bulut motoru ya da gündelik sohbeti yanıtlayan yerel model varsa. */
export const gonderimAcikMi = (s: MotorSinyali): boolean => s.bulut > 0 || s.yerel;
/** Bildirim gerektiren (yanıt verilemeyen ya da hesabın beklediği) hâl: kokpit kartı, sohbet şeridi, adanın motor kartı. */
export const motorEngelliMi = (g: MotorGorunumu): boolean => g !== 'hazir' && g !== 'yerel';
/** Ada: soru kutusu yalnız yanıt verilemiyorken motor kartına döner — hesap onay beklerken yerel model yanıtlıyorsa ada "yerel" gibidir. */
export const adaMotoru = (g: MotorGorunumu, s: MotorSinyali): MotorGorunumu => (gonderimAcikMi(s) ? (s.bulut > 0 ? 'hazir' : 'yerel') : g);
/** Boştaki ada küçük hap gösterir mi: yalnız kırmızı hâllerde (gerçekten bir şey koptuğunda). Bağlı değil ve onay bekliyor sessiz kalır. */
export const motorHapiVarMi = (g: MotorGorunumu): boolean => g === 'durdu' || g === 'hesap-kapali' || g === 'kredi-bitti';

/** Bildirimin düğmesi ne yapar: 'hesap' Fuber hesabı penceresini açar (ana:git 'fuber-hesabi'), 'yeniden-dene' hesabın hâlini sunucuya
 *  yeniden sordurur (hesap:durum { denetle: true }). */
/** 'yerel-kur' (P14 K1): bu bilgisayardaki yapay zekâyı yeniden indirir ("Yalnız bu bilgisayar" seçimi korunur); 'fuber-sec': Nerede'yi
 *  Fuber yapar (açık kullanıcı seçimi; kendiliğinden yapılmaz). */
export type MotorEylemi = 'hesap' | 'yeniden-dene' | 'yerel-kur' | 'fuber-sec';
export interface MotorBildirimi {
  seviye: 'notr' | 'sari' | 'kirmizi';
  /** Kokpit kartının ve sohbet şeridinin başlığı. */
  baslik: string;
  /** Açıklama (kokpit kartı, sohbet şeridi, ada kartı). */
  metin?: string;
  /** Tek satırlık kısa biçim: dar kokpit sütunu (1080×680), ada hapı. */
  kisa: string;
  /** Tek birincil düğme (yoksa düğme yok: ör. onay beklerken). */
  dugme?: string;
  eylem?: MotorEylemi;
  /** Birincil düğme bir eylem değil Ayarlar'ın bir yerini açıyorsa onun çapası (Gizli mod: 'gizli-mod'). */
  cipa?: string;
  /** Yalnız Geliştirici: ikincil bağlantı (Ayarlar çapası). */
  ikincil?: { etiket: string; cipa?: string; eylem?: MotorEylemi };
  /** Düzeltme turu 2: kısa kartta (1080, ~250 px) başlığın altında görünür TEK satır (açıklama yalnız ipucunda kalmasın; tamamı `metin`). */
  alt?: string;
  /** Motor gerektiren düğmelerin ipucu (kokpit çipleri, araç kiti): ne zaman çalışacağı. */
  ipucu?: string;
}

/** Sohbetler sayfasının yazı alanı, motor yokken (A-37: kısa; dar sütunda kaydırma çubuğu açmaz). */
export const MOTOR_YER_TUTUCU = 'Fuber bağlanınca yazabilirsin';
/** H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçili, yerel hazır değil — beklenen Fuber bağlantısı değil, bu bilgisayardaki yapay zekâ. */
export const YALNIZ_YEREL_YER_TUTUCU = 'Yapay zekâ hazır olunca yazabilirsin';

/** Gizli modda kokpitin yapabildiğini söyleyen tek nötr cümle: motorsuz listenin Gizli satırı (K-6) ve araç isteyen düğmeler gizlenince
 *  yerlerinde kalan cümle (F1 düzeltme turu 2, KK-1: shared/kokpit-istemleri.ts istemDugmeleri). */
export const GIZLI_SOHBET_NOTU = 'Gizli modda gündelik sohbet; yanıtlar bu bilgisayarda';
/** "Yalnız bu bilgisayardaki yapay zekâ" açıkken (Gizli DEĞİL) aynı yerde duran nötr cümle (G8 düzeltme turu 2): "Gizli" ve gizlilik sözü yok — ağ
 *  özellikleri (kokpit kartları, e-posta, hesap) sürer; yalnız araç isteyen işler kapalı. */
export const YALNIZ_YEREL_SOHBET_NOTU = 'Yalnız bu bilgisayardaki yapay zekâ: araç isteyen işler kapalı';

/** Motor yokken kokpitin "Fuber’le neler yapabilirsin" listesi ([simge, metin]; tıklanmaz; A-38). Gizli modda (hazırlanırken ya da hazır
 *  değilken) Gizli'nin yapamayacağı işleri (hatırlatıcı, e-posta, planlama — Gizli turda araç yok) vaat etmez: tek satır (F1 düzeltme turu 1,
 *  K-6). renderer/pano/SohbetBaslangic.tsx çizer. */
export function motorsuzAcilanlar(gizli: boolean, yalnizYerel = false): readonly [string, string][] {
  if (gizli) return [['sohbet', GIZLI_SOHBET_NOTU]];
  // 0.12 H3c: "Yalnız bu bilgisayar" hazırlanırken de araç isteyen işler vaat edilmez (yerelde araç yok) — Gizli demeyen nötr cümle.
  if (yalnizYerel) return [['sohbet', YALNIZ_YEREL_SOHBET_NOTU]];
  return [
    ['sohbet', 'Sohbet ve sesli yanıt'],
    ['zil', 'Hatırlatıcı kurma ve takip'],
    ['posta', 'E-postalarını tarama ve özetleme'],
    ['isik', 'Gününü ve haftanı planlama'],
  ];
}

/** Yalnız yerel model varken (sarı not): İş'te teknik ad yok, Geliştirici'de ayrıntı. */
export const YEREL_NOTU: Readonly<Record<Mod, string>> = {
  is: 'Şimdilik yalnız gündelik sohbet — zor işler için Fuber’in yapay zekâsı gerekir',
  gelistirici: 'Yalnız yerel model açık — zor işler için bulut motoru gerekir',
};

/** 0.11 G8 (K2): "Yalnız bu bilgisayardaki yapay zekâ" açıkken kokpit/şerit durumu (nötr; 0.12 H3c: iki modda). */
export const YALNIZ_YEREL_BASLIK = 'Yalnız bu bilgisayardaki yapay zekâ açık';
export const YALNIZ_YEREL_KISA = 'Yalnız yerel yapay zekâ';
/** Gizli mod açıkken (düzeltme turu 1): yerel yanıtlıyorsa sakin not, düğmesiz (giriş yapmak ya da anahtar bağlamak Gizli modda bir şey
 *  açmaz); yanıtlamıyorsa kırmızı + "Gizlilik ayarları" (Gizli mod ayarı açılır ve vurgulanır). */
export const GIZLI_MOD_NOTU: Readonly<Record<Mod, string>> = {
  is: `Gizli mod açık — yalnız gündelik sohbet; ${BULUT_YZ_KAPALI}`,
  gelistirici: 'Gizli mod açık — yalnız yerel model; bulut motorları kapalı',
};
/** F1 (Ö2): Gizli mod hazırlanırken TEK nötr satır — metin sihirbazın Hazırsın satırıyla AYNI kaynaktan (shared/kurulum-yerel.ts
 *  hazirDurumu; çift metin yok). Düğme yok (yapılacak bir şey yok; indirmenin kendi kartı kokpitte), ada hapı ve kartı yok (motorHapiVarMi).
 *  Düzeltme turu 1: (A) çapa Gizlilik — motor gerektiren kokpit çipleri Gizlilik satırını açar (Fuber hesabı penceresini değil; Gizli'de
 *  hesap kullanılmaz), düğme yine yok; (K-1) `yarim`: indirme duraklamışsa "yarıda kaldı; sürdürünce" cümlesi; (K-6) ipucu Gizli'nin
 *  yapamayacağı işi vaat etmez (araçlar Gizli'de hazır olunca da yok). */
function hazirlaniyorBildirimi(mod: Mod, yarim: boolean): MotorBildirimi {
  const baslik = hazirDurumu({ mod, gorunum: 'hazirlaniyor', gizliMod: true, yerelHazir: false, yerelIniyor: !yarim, yerelIstendi: true, yerelYarim: yarim }) ?? 'Gizli mod hazırlanıyor';
  return { seviye: 'notr', baslik, kisa: 'Gizli mod hazırlanıyor', cipa: 'gizli-mod', ipucu: 'Gizli mod hazır olunca gündelik sohbet açılır' };
}
/** 0.12 H3c: "Yalnız bu bilgisayar" hazırlanırken (Gizli DEĞİL, bulut yok) TEK nötr satır — metin Hazırsın'la aynı kaynaktan (hazirDurumu,
 *  `yalnizYerel`); gizlilik sözü yok. Çapa Nerede çalışsın satırı (Ayarlar → Gizlilik; kimliği 'gizli-mod'). */
function yalnizHazirlaniyorBildirimi(mod: Mod, yarim: boolean, yuzde?: number | null): MotorBildirimi {
  const baslik = hazirDurumu({ mod, gorunum: 'hazirlaniyor', gizliMod: false, yalnizYerel: true, yerelHazir: false, yerelIniyor: !yarim, yerelIstendi: true, yerelYarim: yarim, yerelYuzde: yuzde ?? null }) ?? 'Bu bilgisayardaki yapay zekâ hazırlanıyor';
  const gel = mod === 'gelistirici';
  return { seviye: 'notr', baslik, kisa: gel ? 'Yerel model iniyor' : 'Yapay zekâ iniyor', cipa: 'gizli-mod', ipucu: gel ? 'Yerel model inince çalışır' : 'Bu bilgisayardaki yapay zekâ inince çalışır' };
}
/** P14 K1: "Yalnız bu bilgisayar" seçili ama yerel ne hazır ne hazırlanıyor — sakin (kırmızı değil) tek kart, iki AÇIK seçim; buluta düşülmez. */
function yalnizHazirDegilBildirimi(mod: Mod): MotorBildirimi {
  const gel = mod === 'gelistirici';
  const baslik = gel ? 'Yerel model hazır değil' : 'Bu bilgisayardaki yapay zekâ hazır değil';
  return {
    seviye: 'notr', baslik, metin: `“Yalnız bu bilgisayar” seçili; ${BULUT_YZ_KAPALI}. Yeniden indirebilir ya da bulutla devam edebilirsin.`,
    kisa: gel ? 'Yerel model hazır değil' : 'Yapay zekâ hazır değil', alt: `${BULUT_YZ_KAPALI_KISA}; birini seç.`,
    dugme: 'Yeniden indir', eylem: 'yerel-kur', ikincil: { etiket: 'Bulutla devam et', eylem: 'fuber-sec' },
    cipa: 'gizli-mod', ipucu: '“Yalnız bu bilgisayar” seçili; bu bilgisayardaki yapay zekâ hazır olunca çalışır',
  };
}
function gizliBildirimi(g: MotorGorunumu, mod: Mod, yarim: boolean): MotorBildirimi | null {
  if (g === 'hazir') return null;
  if (g === 'yerel') return { seviye: 'notr', baslik: GIZLI_MOD_NOTU[mod], kisa: 'Gizli mod açık' };
  if (g === 'hazirlaniyor') return hazirlaniyorBildirimi(mod, yarim);
  return {
    seviye: 'kirmizi', baslik: 'Gizli modda yapay zekâ hazır değil',
    metin: mod === 'gelistirici'
      ? 'Gizli modda yalnız yerel model çalışır; yerel model şu an hazır değil. Gizlilik ayarlarından açabilir ya da Gizli modu kapatabilirsin.'
      : 'Gizli modda Fuber yalnız bu bilgisayardaki yapay zekâyla çalışır; o şu an hazır değil. Gizlilik ayarlarından açabilir ya da Gizli modu kapatabilirsin.',
    kisa: 'Gizli mod hazır değil', dugme: 'Gizlilik ayarları', cipa: 'gizli-mod', ipucu: 'Gizli modda bu bilgisayardaki yapay zekâ açılınca çalışır',
  };
}

/**
 * Hâlin bildirimi (`hazir` → null). Düğme her zaman Fuber hesabına götürür (giriş yap / hesabı gör); "durdu"da hesap aktifse "Yeniden dene"
 * (hesabın hâli sunucuya yeniden sorulur — hesap aktif ama ana süreç onun anahtarını kullanamıyorken). 0.13 T15: "Kendi anahtarımla
 * bağla" ikincil yolu kalktı (kimse API anahtarı girmez). `gizli`: Gizli mod açık (sinyalin `gizli`si) — bildirim Gizli moda göre
 * (gizliBildirimi). `yarim`: sinyalin `yarim`ı — hazırlık duraklamış (K-1). `yalnizYerel`: "Yalnız bu bilgisayar" seçili (yalnizYerelSecili:
 * yol yerel ya da hazırlanıyor). Metinler İş dilinde (tests/motor-durumu.test.ts isDiliIhlali); "motor" sözcüğü yalnız Geliştirici'de (P2).
 */
export function motorBildirimi(g: MotorGorunumu, mod: Mod, hesapDurumu?: HesapDurumu | null, gizli = false, yarim = false, yalnizYerel = false, yuzde?: number | null): MotorBildirimi | null {
  // 'hazirlaniyor' Gizli modda ya da (0.12 H3c) "Yalnız bu bilgisayar" seçiliyken doğar: bayrak verilmezse (eski çağıran) Gizli modun nötr satırı.
  if (!gizli && g === 'hazirlaniyor' && yalnizYerel) return yalnizHazirlaniyorBildirimi(mod, yarim, yuzde);
  if (g === 'yerel-hazir-degil') return yalnizHazirDegilBildirimi(mod);
  if (gizli || g === 'hazirlaniyor') return gizliBildirimi(g, mod, yarim);
  const gel = mod === 'gelistirici';
  switch (g) {
    case 'hazir':
      return null;
    case 'yerel':
      // 0.11 G8 (K2): bilinçli seçim — uyarı değil, nötr ve dürüst bir durum (araç yok; bulut motoru gerekir demez).
      if (yalnizYerel) return { seviye: 'notr', baslik: YALNIZ_YEREL_BASLIK, metin: YALNIZ_YEREL_NOTU, kisa: YALNIZ_YEREL_KISA, ipucu: YALNIZ_YEREL_NOTU };
      return {
        seviye: 'sari', baslik: YEREL_NOTU[mod], kisa: YEREL_NOTU[mod], ipucu: YEREL_NOTU[mod],
        // Hesabı yoksa giriş yolu (bağlıysa hesap kendi hâlini zaten söyler; bu dala yalnız hesapsız ya da aktif hesapla gelinir).
        ...(hesapDurumu ? {} : { dugme: 'Yapay zekâ bağla', eylem: 'hesap' as const }),
      };
    case 'bagli-degil':
      return {
        seviye: 'notr', baslik: 'Yapay zekâ bağla', metin: 'Sohbet, sesli yanıt ve hatırlatıcılar bir yapay zekâ bağlayınca açılır. Gündem ve hava şimdiden burada.',
        kisa: gel ? 'Motor bağlı değil' : 'Yapay zekâ bağlı değil', dugme: 'Yapay zekâ bağla', eylem: 'hesap',
        ipucu: 'Bir yapay zekâ bağlanınca çalışır',
      };
    case 'durdu': {
      const aktif = hesapDurumu === 'aktif';
      return {
        seviye: 'kirmizi', baslik: 'Yapay zekâ bağlantısı koptu', metin: 'Verilerin yerinde. Bağlantıyı yenileyince sohbet ve hatırlatıcılar yeniden açılır.',
        kisa: gel ? 'Motor durdu' : 'Bağlantı koptu', dugme: aktif ? 'Yeniden dene' : 'Yapay zekâ bağla', eylem: aktif ? 'yeniden-dene' : 'hesap',
        ipucu: 'Bağlantı yenilenince çalışır',
      };
    }
    case 'hesap-bekliyor':
      return { seviye: 'notr', baslik: 'Hesabın onay bekliyor', metin: HESAP_DURUM_METNI.bekliyor, kisa: 'Hesabın onay bekliyor', ipucu: 'Hesabın onaylanınca çalışır' };
    case 'hesap-kapali':
      return { seviye: 'kirmizi', baslik: 'Fuber erişimi kapalı', metin: HESAP_DURUM_METNI.kapali, kisa: 'Fuber erişimi kapalı', dugme: 'Hesabı gör', eylem: 'hesap', ipucu: 'Fuber erişimi kapalı' };
    case 'kredi-bitti':
      return { seviye: 'kirmizi', baslik: 'Kullanım hakkın doldu', metin: HESAP_DURUM_METNI['kredi-bitti'], kisa: 'Kullanım hakkın doldu', dugme: 'Hesabı gör', eylem: 'hesap', ipucu: 'Kullanım hakkın doldu' };
  }
}

/**
 * 0.11 G2 (spec §2 "Fuber hesabı zorunlu"): hesapsız kalan kullanıcıya kokpitte sakin, kırmızı olmayan TEK satır — "Fuber hesabını aç"
 * (düğme Fuber hesabı penceresini açar). Yalnız hesap yokken, hesap sunucusuna ulaşılabiliyorken (`ulasilabilir`; null = henüz
 * bilinmiyor) ve motor bildirimi (`bildirim`: motorBildirimi'nin o anki sonucu) hesabı zaten önermiyorken — tek kaynak, tek düğme.
 * G2 düzeltme turu 1 (K1): Gizli modda satır YOK ve sunucu yoklanmaz — hesap modülü Gizli'de kendiliğinden ağa çıkmaz (zamanlayıcı,
 * hesap:durum gibi) ve Gizli'nin öteki yüzeyleri de hesap önermez (F1: motor bildirimi, tur son durağı). Gizli kapanınca satır gelir;
 * hesap Ayarlar → Hesap'ta her zaman açılabilir.
 */
export function hesapAcSatiri(g: { hesapVar: boolean; ulasilabilir: boolean | null; bildirim: MotorBildirimi | null; gizli?: boolean }): { metin: string; dugme: string } | null {
  return null; // no account in this build
}

/** Motor gerektiren kokpit çipinin (bant çipleri, ipuçları, kart altlıkları, araç kiti) tıklaması motor yokken bildirimin kendi yolunu
 *  izler: Geliştirici'de kendi motorunu bağlayacağı yer (Motorlar; ipucu "Bir motor bağlanınca çalışır"), Gizli modda Gizlilik, İş'te
 *  bildirimin birincil eylemi; düğmesiz hâlde (onay bekliyor) hesabın hâlini gösteren Fuber hesabı penceresi. */
export function motorCipEylemi(b: MotorBildirimi, mod: Mod): { eylem?: MotorEylemi; cipa?: string } {
  if (mod === 'gelistirici' && b.ikincil?.cipa) return { cipa: b.ikincil.cipa };
  // Çip tıklaması indirme başlatmaz ya da seçim değiştirmez (P14 K1): yalnız hesap eylemleri; öteki hâllerde bildirimin çapası.
  if (b.eylem === 'hesap' || b.eylem === 'yeniden-dene') return { eylem: b.eylem };
  if (b.cipa) return { cipa: b.cipa };
  return { eylem: 'hesap' };
}

/**
 * Ayarlar → Hesap ve kullanım'ın üst satırı (düzeltme turu 1, madde 2): "Fuber’in yapay zekâsı · <durum>" + bildirimin düğmesi. Hesabın
 * gerçek hâli söylenir — giriş yapmış kullanıcıya "bağlı değil · Fuber hesabına giriş yap" denmez (onay bekliyor: düğme yok; erişim kapalı /
 * hak doldu: "Hesabı gör"; hesap aktif ama motor kullanılamıyor: "Yeniden dene"; Gizli mod: kendi hâli).
 */
export interface YapayZekaSatiri { durum: string; dugme?: { etiket: string; eylem?: MotorEylemi; cipa?: string } }
export function yapayZekaSatiri(g: MotorGorunumu, mod: Mod, hesapDurumu?: HesapDurumu | null, gizli = false, yalnizYerel = false): YapayZekaSatiri {
  const durum = !gizli && yalnizYerel && g === 'yerel' ? 'yalnız bu bilgisayarda · araçsız' : !gizli && yalnizYerel && g === 'hazirlaniyor' ? 'yalnız bu bilgisayarda · hazırlanıyor'
    : g === 'yerel-hazir-degil' ? 'yalnız bu bilgisayarda · hazır değil' : gizli
    ? (g === 'yerel' ? 'Gizli mod açık · yalnız bu bilgisayarda' : g === 'hazir' ? 'bağlı' : g === 'hazirlaniyor' ? 'Gizli mod hazırlanıyor' : 'Gizli modda hazır değil')
    : ({
      hazir: 'bağlı', yerel: mod === 'gelistirici' ? 'yalnız yerel model' : 'yalnız gündelik sohbet', 'bagli-degil': 'bağlı değil', durdu: 'bağlantı koptu',
      'hesap-bekliyor': 'hesabın onay bekliyor', 'hesap-kapali': 'erişim kapalı', 'kredi-bitti': 'kullanım hakkın doldu', hazirlaniyor: 'Gizli mod hazırlanıyor',
      'yerel-hazir-degil': 'yalnız bu bilgisayarda · hazır değil',
    } as const)[g];
  const b = motorBildirimi(g, mod, hesapDurumu, gizli, false, yalnizYerel);
  // Takip turu: "hazır değil"in "Yeniden indir"i buradan indirmez (tek onaylı yol: Nerede çalışsın) — düğme gerçek eylemi söyler.
  if (b?.eylem === 'yerel-kur') return { durum, dugme: { etiket: 'Nerede çalışsın’ı aç', cipa: 'gizli-mod' } };
  if (!b?.dugme || (!b.eylem && !b.cipa)) return { durum };
  return { durum, dugme: { etiket: b.dugme, ...(b.eylem ? { eylem: b.eylem } : { cipa: b.cipa }) } };
}

/**
 * P3 göçü (Review Focus 1; main/ayarlar.ts): `motorCalisti` ham dosyada boolean ise o; yoksa (0.6–0.9 profili) kayıtlı bir anahtar varsa
 * true — anahtarı olan kullanıcı "bağlı değil" değil kendi gerçek hâlini görür (motor yoksa "durdu").
 */
export function motorCalistiGocu(hamDeger: unknown, anahtarVar: boolean): boolean {
  return typeof hamDeger === 'boolean' ? hamDeger : anahtarVar;
}
