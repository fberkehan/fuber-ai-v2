// ── Tek motor kuralı (Görev 21, K10; saf, birim testli: tests/ses-kimligi.test.ts) ─────────────────────────────────────────────
// Her yerde aynı ses ve aynı model; olabildiğince hızlı. Eskiden yerel beyin
// (Bonsai 27B, ekran kartında) her kısa mesajda buluttan ÖNCE çalışıyor ("ön eleme"), başlık/kokpit/eşlikçi işleri de ona gidiyordu:
// hem yavaş hem iki farklı "beyin". Artık:
//  - Gizli mod (bulutsuz) açıkken yerel beyin TEK motordur: sohbet de, arka plan işleri de orada; buluta asla düşülmez. Yerel beyin
//    hazır değilse motor YOK sayılır (gizlilik sözü sessizce bozulmaz).
//  - Gizli mod kapalıyken bulut motoru varsa yerel beyin hiçbir işte kullanılmaz (kurulu kalır, sunucusu açılmaz → ekran kartı boş
//    kalır); arka plan işleri görünmez yardımcı modelde. Hiç bulut motoru yoksa yerel beyin (hazırsa) tek motordur.
//  - Bir konuşmanın ortasında motor değişmez: yol TUR BAŞINDA bir kez seçilir; turun her adımına ve ertelenen işlerine (başlık,
//    özet…) aynen taşınır (sabitYol). Yerel hata verirse buluta düşülmez.
//  - Gizli bölüm (düzeltme 1): Gizli modda yazılan mesajlar işaretlenir; Gizli mod kapandıktan sonra da hiçbir bulut bağlamına (geçmiş,
//    özet, arama, hafıza, arka plan işi) girmez. Geçiş sohbette bir notla görünür ("Gizli mod açıldı/kapandı").
//  - 0.11 G8 (spec §7) "Yalnız bu bilgisayardaki yapay zekâ" (Geliştirici → Yapay zekâ): Gizli KAPALIYKEN, bulut anahtarı olsa da bütün
//    roller yerelde çalışır — ama yalnız Geliştirici'de ve yalnız yerel hazırken. İş modunda tercih yok sayılır (İş'te yerel yol Gizli
//    mod olarak kalır); yerel hazır değilse bugünkü kural sürer (bulut varsa bulut) ve arayüz anahtarı uyarılı gösterir. Gizli'den farkı:
//    ağ özellikleri (kokpit kartları, e-posta eşitleme, hesap) sürer, gizlilik sözü verilmez. F1 değişmezleri ve Gizli davranışı AYNEN:
//    Gizli açıkken tercih hiçbir şeyi değiştirmez (Gizli satırlarının beklentileri tests/tek-motor.test.ts'te sabit).
//  - 0.12 H3c (spec Hedefler §5): ana sistem tamamen yerel modellerle de çalışabilmeli — "Yalnız bu bilgisayar" artık İş modunda da
//    var (kurulumun "Nerede çalışsın" adımı ve Ayarlar → Gizlilik; shared/nerede.ts). Düzeltme turu 1 (Ruling P14, K1): Gizli gibi DEĞİŞMEZ —
//    tercih seçiliyken yol yerel ya da 'yok'; hiçbir durumda (indirme sürerken, hata, kaldırıldı, kapalı; mod bilinmese de) bulut değil.
//    Hazırlanırken sohbet ve yardımcı roller bekler; ne hazır ne hazırlanıyorsa kokpit "hazır değil" kartı iki açık seçim sunar (Yeniden
//    indir · Fuber’le devam et) — kendiliğinden Fuber'e geçilmez. Gizlilik sözü yine verilmez (ağ özellikleri sürer).
import type { Mod } from './tipler.ts';
import { BULUT_YZ_KAPALI } from './gizlilik-metni.ts';

export interface TekMotorGirdisi {
  /** Yerel beyin kurulu ve açık (yerel.etkin). */
  yerelHazir: boolean;
  /** Ayarlar → Gizlilik → Gizli mod. */
  gizliMod: boolean;
  /** En az bir bulut motoru bağlı ve açık. */
  bulutVar: boolean;
  /** 0.11 G8: Ayarlar → Yapay zekâ → "Yalnız bu bilgisayardaki yapay zekâ" (yerel.yalnizYerel). Verilmezse kapalı. */
  yalnizYerel?: boolean;
  /** 0.11 G8: kullanım biçimi. 0.12 H3c: tercih iki modda da etkindir; verilmezse (bilinmiyor, eski çağıran) etkin sayılmaz. */
  mod?: Mod;
}

export type MotorYolu = 'yerel' | 'bulut' | 'yok';

/** P14 K1: "Yalnız bu bilgisayar" seçili mi (Gizli kapalı; sıkı boolean; moddan bağımsız — güvenli yön yerel). Seçiliyken yol ASLA bulut değil. */
export const yalnizYerelTercihi = (g: Pick<TekMotorGirdisi, 'gizliMod' | 'yalnizYerel'>): boolean => !g.gizliMod && g.yalnizYerel === true;
/** G8: tercih BU çağrıda yolu yerele çeviriyor mu (seçili + yerel hazır). 0.12 H3c: iki modda da. */
export const yalnizYerelEtkin = (g: TekMotorGirdisi): boolean => yalnizYerelTercihi(g) && g.yerelHazir;

/** Bütün model çağrılarının (sohbet ve arka plan) gideceği yol. */
export function motorYolu(g: TekMotorGirdisi): MotorYolu {
  if (g.gizliMod) return g.yerelHazir ? 'yerel' : 'yok';
  // P14 K1: Gizli gibi değişmez — hazır değilse bekler ('yok'), buluta düşmez.
  if (yalnizYerelTercihi(g)) return g.yerelHazir ? 'yerel' : 'yok';
  if (g.bulutVar) return 'bulut';
  return g.yerelHazir ? 'yerel' : 'yok';
}

// ── Yerel tek motor turunun sistem istemi cümlesi (araçsız tur; ajan/dongu.ts yalnız `gizli`ye göre SEÇER) ──
// Gizli turda söz doğru: bulutsuz. "Yalnız yerel" (G8) ve bulutsuz kurulumda (hiç bulut motoru yok) tur gizlilik sözü vermez — model yalnız
// doğruyu bilir: bu turda bu bilgisayardaki yapay zekâyla çalışıyor ve aracı yok (spec §7: "gizlilik sözü verilmez").
// 11 Kas analizi #8 (§6.4): araçsızlık yerel sistem isteminde (shared/yerel-istem.ts) TEK kez ve "yapabildiklerin" listesinden SONRA söylenir.
// Eskiden bu cümle <baglam>'da ikinci kez veriliyordu; küçük model "merhaba"ya bile "aracım yok" paragrafıyla başlıyor, taslak ve yeniden yazmayı
// reddediyordu. Yalnız-yerel turda <baglam>'a cümle eklenmez; Gizli'de yalnız Gizli olduğu (bulutsuz, hafızaya yazılmaz) söylenir.
export const GIZLI_ARACSIZ_ISTEM = 'Şu an GİZLİ MODDASIN (bulutsuz): buluttaki yapay zekâ kapalı, yanıtlar bu bilgisayarda üretilir; bu bölüm hafızaya yazılmaz.';
/** Yalnız-yerel turda <baglam>'a eklenen cümle: yok (yapamadıkları sistem isteminde bir kez). Eski adı korunur. */
export const YEREL_ARACSIZ_ISTEM = '';
/** Araçsız yerel turun <baglam> cümlesi: Gizli açıksa kısa Gizli cümlesi, değilse boş (gizlilik sözü verilmez). */
export const aracsizTurIstemi = (gizli: boolean): string => (gizli ? GIZLI_ARACSIZ_ISTEM : YEREL_ARACSIZ_ISTEM);

// ── "Yalnız bu bilgisayardaki yapay zekâ" anahtarının hâli (Ayarlar → Yapay zekâ; saf, birim testli: tests/tek-motor.test.ts) ──
/** Anahtarın altındaki dürüst not (spec §7; 11 Kas analizi §6.3): yerel mod neye iyi, tek satır, mutlak söz yok. Anahtar açık VE yerel hazırken görünür. */
export const YALNIZ_YEREL_NOTU = 'Bu bilgisayardaki yapay zekâ en iyi yazma, özetleme, çeviri ve hatırlamada çalışır; hatırlatıcılar onayınla kurulur, e-posta ve ekran kullanılamaz.';
/** Yerel kurulu değilken bağın metni (Gizlilik'teki kurulum satırına götürür). */
export const YALNIZ_YEREL_KUR = 'Önce bu bilgisayardaki yapay zekâyı kur';
/** Kurulu ama kapalıyken (yerel.etkin false): kur denmez, aç denir — aynı satır. */
export const YALNIZ_YEREL_AC = 'Önce bu bilgisayardaki yapay zekâyı aç';
/** Seçili ama yerel hazır değil (P14 K1): buluttaki yapay zekâ kapalı — sohbet yerel hazır olunca açılır (indirme yokken de doğru; M5); sessiz kalmaz. */
export const YALNIZ_YEREL_UYARI = `Seçili ama bu bilgisayardaki yapay zekâ hazır değil; ${BULUT_YZ_KAPALI}. Sohbet, kurulum bitince açılır.`;

export interface YalnizYerelAnahtari {
  /** Anahtarın gerçek (kayıtlı) hâli. */
  acik: boolean;
  /** Anahtar tıklanamaz mı: yalnız ÇIKMAK her zaman serbest — kapalıyken yerel hazır değilse (ya da hâl bilinmiyorsa) açılamaz. */
  devreDisi: boolean;
  /** Tercih açık mı (P14 K1: seçiliyken yol hiçbir zaman bulut değil): rol seçicileri kilitlenir. */
  etkin: boolean;
  /** Etkinken görünen dürüst not (YALNIZ_YEREL_NOTU); değilse ''. */
  not: string;
  /** Açık ama yerel hazır değilken uyarı (YALNIZ_YEREL_UYARI); değilse ''. */
  uyari: string;
  /** Yerel hazır değilse Gizlilik'teki kurulum satırına bağ metni ("kur"; kurulu ama kapalıysa "aç"); hazırsa null. */
  kurulum: string | null;
}

/** `yerelHazir`: yerel kurulu ve açık (null: hâl henüz bilinmiyor — "kur" denmez, açılamaz). `kurulu`: model ve çalıştırıcı diskte (yalnız bağın
 *  "kur" mu "aç" mı diyeceğini seçer). */
export function yalnizYerelAnahtari(g: { yalnizYerel: boolean; yerelHazir: boolean | null; kurulu?: boolean }): YalnizYerelAnahtari {
  const acik = g.yalnizYerel === true;
  if (g.yerelHazir === null) return { acik, devreDisi: !acik, etkin: acik, not: '', uyari: '', kurulum: null };
  if (g.yerelHazir) return { acik, devreDisi: false, etkin: acik, not: acik ? YALNIZ_YEREL_NOTU : '', uyari: '', kurulum: null };
  return { acik, devreDisi: !acik, etkin: acik, not: '', uyari: acik ? YALNIZ_YEREL_UYARI : '', kurulum: g.kurulu ? YALNIZ_YEREL_AC : YALNIZ_YEREL_KUR };
}

/** Yerel beyin TEK motor mu (yanıt + arka plan işleri yerelde, bulut yok)? */
export const yerelTekMotor = (g: TekMotorGirdisi): boolean => motorYolu(g) === 'yerel';

/** Tur başında seçilip sabitlenen yol (turun adımları ve ertelenen işleri bununla çağırır). */
export type SabitYol = 'yerel' | 'bulut';

/**
 * Sabit yolla çağrının bugünkü yolu. 'yerel' sabitse hep yerel (Gizli bölümün işi Gizli mod kapansa da buluta gitmez). 'bulut' sabitse
 * yalnız bulut hâlâ yolsa bulut; arada Gizli mod açıldıysa ya da bulut düştüyse 'degisti' (çağrı yapılmaz — tur yarıda başka beyne
 * geçmez). Sabit yoksa (turdan bağımsız iş) bugünkü kural.
 */
export function sabitYol(sabit: SabitYol | undefined, simdiki: MotorYolu): MotorYolu | 'degisti' {
  if (!sabit) return simdiki;
  if (sabit === 'yerel') return 'yerel';
  return simdiki === 'bulut' ? 'bulut' : 'degisti';
}

/** Yerele sabitlenmiş iş (Gizli bölümün ertelenen başlığı, çıkıştaki iş) Gizli mod kapandıktan sonra çalışıyor ve yerel sunucu kapalıysa
 *  atlanır: bulut yolunda yerel beyin soğuktan açılmaz (ekran kartı ve saniyeler; düzeltme turu 2). */
export const yerelIsAtlanir = (sabit: SabitYol | undefined, simdiki: MotorYolu, sunucuAcik: boolean): boolean =>
  sabit === 'yerel' && simdiki !== 'yerel' && !sunucuAcik;

/** Buluta gidecek geçmiş: Gizli modda yazılmış mesajlar çıkar (yerel turda hepsi kalır). */
export function bulutBaglami<T extends { gizli?: boolean }>(liste: T[], bulut: boolean): T[] {
  return bulut ? liste.filter((m) => !m.gizli) : liste;
}

/** Sohbette Gizli mod geçişinin notu ("açıldı/kapandı"); geçiş yoksa null. `onceki`: sohbetin son mesajı Gizli bölüm müydü (yoksa null). */
export const GIZLI_NOTU = {
  // T34b (P14): neyin kapalı olduğu ve nasıl çalıştığı (bulutBaglami: gizli bölüm bulut bağlamından süzülür).
  acildi: `Gizli mod açıldı: ${BULUT_YZ_KAPALI}, yanıtlar bu bilgisayarda üretilir.`,
  kapandi: 'Gizli mod kapandı: gizli bölüm bulut yanıtlarının bağlamına eklenmez.',
} as const;
export function gizliGecisNotu(onceki: boolean | null, simdi: boolean): string | null {
  if (simdi && onceki !== true) return GIZLI_NOTU.acildi;
  if (!simdi && onceki === true) return GIZLI_NOTU.kapandi;
  return null;
}
