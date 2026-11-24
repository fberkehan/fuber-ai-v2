// ── İç talimat: Fuber'in kendine verdiği iş hiçbir yüzeyde görünmez (G1 / F2; saf, birim testli: tests/ic-talimat.test.ts) ────────────
// 27 Eki: MERAK iç talimatı uygulamada birebir, kutudan taşmış göründü — iç talimatlar gizli kalmalı, arka planda kalmalı. Proaktif
// tetik (main/zamanlayici.ts SABAH, AKSAM, MERAK; main/ipc.ts tanışma; `gizliTetik: true` ile giden her metin) kayıtta modelin bağlamı
// için kalır (rol 'not' + kaynak 'proaktif', shared/sohbet-gorunum.ts gizliTetikMi) ama kullanıcıya hiçbir yüzeyde, hiçbir modda, hiçbir
// hata yolunda görünmez. Bu modül kuralın saf parçaları:
//  · icTalimatYankisiMi — yankı bekçisi: model talimatı geri yazdıysa (küçük yerel model araç isteyen talimatı araçsız alınca metni olduğu
//    gibi döndürebiliyor) yanıt gösterilmez, bildirilmez, kayıttan düşer; deneme başarısız sayılır (main/ajan/dongu.ts yanitla).
//  · proaktifIsYerelde / proaktifIsCalisirMi — Gizli/yerel turda araç yok (dongu.ts): araç isteyen proaktif işler (SABAH, AKSAM, MERAK)
//    yalnız bulut yolunda çalışır; tanışma araçsız kısa talimatla yerelde de gider.
//  · tanışma talimatları ve proaktif turun hafıza yazıcısına giden nötr işaret (talimat hafıza notuna girmesin).
import type { MotorYolu } from './tek-motor.ts';

/** Kendiliğinden yapılan işler: sabah ve akşam özeti, merak sorusu (zamanlayıcı), kurulum sonundaki tanışma (ipc.ts). */
export type ProaktifIs = 'sabah' | 'aksam' | 'merak' | 'tanisma';

/** Karşılaştırma için sadeleştirme: Türkçe küçük harf, markdown ve tırnak işaretleri düşer, boşluklar teke iner. */
const sade = (s: string): string => s.toLocaleLowerCase('tr').replace(/[*_#>`"'“”‘’]/g, '').replace(/\s+/g, ' ').trim();

/** Talimatın ilk satırının başlığı ("MERAK SORUSU:", "KURULUM BİTTİ:") — büyük harfli en az 4 karakter ve iki nokta; yoksa null. */
const BASLIK = /^[A-ZÇĞİÖŞÜ ]{4,}:/;
/** Yankı sayılan en kısa ortak parça (sadeleştirilmiş metinde). Kısa ortak sözcükler (araç adı, "TEK bir soru") yankı değildir. */
const PARCA = 40;

/**
 * Yanıt iç talimatı tekrar ediyor mu? Talimatın ilk satırının başlığıyla başlıyorsa ya da talimattan ≥ 40 karakterlik ortak bir parça
 * içeriyorsa evet. Büyük/küçük harf, boşluk, markdown ve tırnak biçimi farkı sayılmaz. Boş yanıt ya da boş talimat yankı değildir.
 * G9 (görev adımları) de kullanır.
 */
export function icTalimatYankisiMi(yanit: string, talimat: string): boolean {
  const y = sade(yanit);
  const t = sade(talimat);
  if (!y || !t) return false;
  const baslik = BASLIK.exec(talimat.trimStart().split('\n')[0] ?? '');
  if (baslik && y.startsWith(sade(baslik[0]))) return true;
  if (t.length < PARCA || y.length < PARCA) return false;
  const parcalar = new Set<string>();
  for (let i = 0; i + PARCA <= y.length; i++) parcalar.add(y.slice(i, i + PARCA));
  for (let i = 0; i + PARCA <= t.length; i++) if (parcalar.has(t.slice(i, i + PARCA))) return true;
  return false;
}

/** Yerel/Gizli turda (araçsız) çalışabilir mi: yalnız tanışma. SABAH/AKSAM/MERAK araç ister (hatırlatıcı, görev, e-posta, hafıza). */
export function proaktifIsYerelde(is: ProaktifIs): boolean {
  return is === 'tanisma';
}

/** 0.12 cila düzeltme turu 1 (I-2): SABAH/AKŞAM/MERAK araç ister → Gizli ya da "Yalnız bu bilgisayar" seçiliyken modelle çalışmaz
 *  (proaktifIsCalisirMi). 11 Kas (analiz #9): "Yalnız bu bilgisayar"da sabah/akşam özeti MODELSİZ gelir — bugünün hatırlatıcıları ve açık
 *  yapılacaklardan şablon liste (main/zamanlayici.ts yerelOzet). Ayarlar'da (Kendiliğinden yazma → Özetler, Gizlilik → "Nerede çalışsın") bu not
 *  görünür. Merak sorusu yerelde sorulmaz. */
export const YEREL_OZET_NOTU = 'Bu bilgisayarda çalışırken özetler hatırlatıcı ve yapılacaklarından kısa bir liste olarak gelir.';
/** Aynı kural, "Seni tanıma soruları" satırında (merak sorusu da araç ister). */
export const YEREL_MERAK_NOTU = 'Bu bilgisayarda çalışırken sorulmaz.';

/** Bu yolda çalışır mı: bulutta hepsi; yerelde (Gizli) yalnız araçsız olanlar; motor yokken (Gizli hazırlanıyor) hiçbiri — çalışsa yalnız
 *  ana sohbete kullanıcının istemediği bir ⚠ notu düşerdi. Atlanan iş gün anahtarı ve deneme yazmaz: Gizli kapanınca aynı gün çalışır. */
export function proaktifIsCalisirMi(is: ProaktifIs, yol: MotorYolu): boolean {
  return yol === 'bulut' || (yol === 'yerel' && proaktifIsYerelde(is));
}

/** Kurulum bitince tanışma turu (Normal / bulut): bugünkü talimat. */
export const TANISMA_TALIMATI = 'KURULUM BİTTİ: Kullanıcıyla ilk kez tanışıyorsun. Kendini kısaca tanıt (ne yapabildiğini 3-4 maddeyle), kurulumda öğrendiklerini doğal bir dille yansıt ve onu tanımak için TEK bir soru sor.';
/** Gizli/yerel tanışma: araçsız ve kısa — yetenek listesi yok (Gizli turda araç yok; yapamayacağı işi saymasın). */
export const TANISMA_TALIMATI_YEREL = 'KURULUM BİTTİ: Kullanıcıyla ilk kez tanışıyorsun. Kısaca merhaba de, kurulumda öğrendiklerini bir cümleyle yansıt ve onu tanımak için TEK bir soru sor.';
export const tanismaTalimati = (yerel: boolean): string => (yerel ? TANISMA_TALIMATI_YEREL : TANISMA_TALIMATI);

/** Proaktif turun tur-sonrası hafıza yazımında kullanıcı satırı: talimat değil bu nötr işaret (talimat hafıza notuna, Hafıza sayfasına
 *  ya da çekirdek hafızaya girmesin; yazıcı Fuber'in yanıtını yine görür). */
export const PROAKTIF_HAFIZA_ISARETI = '(Bu turda kullanıcı bir şey yazmadı; aşağıdaki mesajı Fuber kendiliğinden yazdı.)';
