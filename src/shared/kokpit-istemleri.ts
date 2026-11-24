// ── Kokpitin Fuber'e iş veren istemleri: TEK kaynak (F1 düzeltme turu 2, KK-1) ─────────────────────────────────────────────────────
// Gizli turda araç yok (main/ajan/dongu.ts: `araclar = yerelTek ? []`; "hiçbir aracın yok … yapmış gibi konuşma"): Fuber hatırlatıcı ya
// da iş kuramaz, e-posta ve WhatsApp okuyamaz, web'e, ekrana ve hafızaya bakamaz. Küçük yerel model yine de "kurdum" diyebilir; bu yüzden
// kokpit Gizli açıkken (hazırken de hazırlanırken de) araç isteyen bir istemi ÖNERMEZ. 0.11 G8: "Yalnız bu bilgisayardaki yapay zekâ" da aynı
// araçsız yerel turdur — kural ikisi için ortaktır (`aracsizMi`); ama ikisi AYNI ŞEY DEĞİL: yalnız Gizli'nin kendi sözleri ("Gizli modda …")
// yalnız Gizli'de söylenir (istemDugmeleri notu gerçek `gizli`ye göre). Kural burada, tek yerde:
//  · her istem `arac` bayrağıyla burada tanımlı (ISTEM, kayda bağlı üreticiler, yüzeylerin öneri listeleri);
//  · kokpitin `sor`u yalnız `Istem` alır (renderer/sayfalar/Kokpit.tsx; ham metin yok) ve Gizli'de araç isteyeni göndermez (son kapı);
//  · yüzeyler `oneriListesi` (öneri listeleri: araç isteyenler çıkar, yerlerine Gizli turda yapılabilenler gelir), `istemDugmeleri`
//    (tek tek düğmeler: gizlenir; hepsi gizlendiyse yerinde tek nötr cümle) ve `istemOnerilir` (tek düğme / kart satırı) ile süzer.
// Normal modda hiçbir liste değişmez.
import { GIZLI_SOHBET_NOTU, YALNIZ_YEREL_SOHBET_NOTU } from './motor-durumu.ts';
import type { KartTipi } from './tipler.ts';

/** Fuber'e gönderilen istem. `arac`: bir araç ister (hatırlatıcı, iş, plan, e-posta, WhatsApp, web, ekran, hafıza) — Gizli turda yapılamaz. */
export interface Istem { readonly metin: string; readonly arac: boolean }
/** Kokpitte bir öneri (çip, kart satırı ya da düğme): simge, görünen ad, uzun kartta kısa açıklama ve gönderilecek istem. */
export interface IstemOnerisi { readonly simge: string; readonly etiket: string; readonly ipucu?: string; readonly istem: Istem }

const aracli = (metin: string): Istem => ({ metin, arac: true });
const aracsiz = (metin: string): Istem => ({ metin, arac: false });

/** Kokpitin sabit istemleri — hepsi bir araç ister. */
export const ISTEM = {
  gunuPlanla: aracli('Bugünkü hatırlatıcılarıma, planlarıma ve e-postalarıma bakıp günümü planla.'),
  haftamiPlanla: aracli('Bu haftaki hatırlatıcılarıma ve işlerime bakıp haftamı planla; eksik bir şey varsa sor.'),
  buHafta: aracli('Bu haftaki hatırlatıcılarıma, işlerime ve toplantılarıma bakıp beni neler beklediğini kısaca söyle.'),
  hatirlaticiKur: aracli('Bir hatırlatıcı kurmak istiyorum; ne zaman ve ne için olduğunu sor.'),
  yarinHatirlatici: aracli('Yarın sabah 9’da bana bir hatırlatıcı kur; ne için olduğunu sor.'),
  isEkle: aracli('Planıma yeni bir iş eklemek istiyorum; ne olduğunu ve son tarihini sor.'),
  epostaTara: aracli('Okunmamış e-postalarımı tara; önemli olanları ve yanıt gerekenleri söyle.'),
  gundemiOzetle: aracli('Bugün gündemde neler var? Önemli haberleri kısaca, kaynaklarıyla özetle.'),
  dikkat: aracli('Dikkat etmem gerekenleri önem sırasıyla anlat; her biri için ne yapmalıyım?'),
  oneriler: aracli('Önerilerini önem sırasıyla anlat; hangisiyle başlamalıyım?'),
  webArastir: aracli("Benim için web'de bir şey araştırmanı istiyorum; konuyu sor."),
  ekranaBak: aracli('Ekranıma bak ve şu an ne üzerinde çalıştığımı söyle; yardımcı olabileceğin bir şey var mı?'),
  // Hafızayı arar ve yanıtı hafızaya yazar (Gizli turda ikisi de yok: yazmış gibi konuşabilir).
  hakkimda: aracli('Hakkımda bildiklerini kısaca özetle ve eksik gördüğün bir şeyi sor.'),
  // 0.11 G7: yeni (boş) sohbetin hazır önerileri (SOHBET_BOS_ONERILERI). Metin, düğmenin adıyla aynıdır (eskiden de öyleydi).
  bugunBeniNeBekliyor: aracli('Bugün beni neler bekliyor?'),
  yarinToplanti: aracli('Yarın sabah 10:00’da toplantım var, hatırlat'),
  sonEpostalar: aracli('Son e-postalarımı özetle'),
  beniTani: aracli('Beni tanımak için bana birkaç soru sor'), // cevapları hafızaya yazar (Gizli turda hafıza yok)
} as const satisfies Record<string, Istem>;

/** Kayda bağlı istemler (kart satırları): haberi aramak, e-postayı, yazışmayı ya da projeyi okumak bir araç ister. */
export const konuHaberleri = (ad: string): Istem => aracli(`${ad} hakkında son gelişmeleri kısaca, kaynaklarıyla özetle.`);
export const epostaOzeti = (id: number): Istem => aracli(`#${id} numaralı e-postayı oku ve bana özetle; yanıt gerekiyorsa taslak öner.`);
export const toplantiEpostasi = (id: number): Istem => aracli(`#${id} numaralı e-postayı oku ve bana özetle; toplantı ya da görüşme varsa saatini ve hazırlığını söyle.`);
export const whatsappOzeti = (ad: string): Istem => aracli(`${ad} ile WhatsApp yazışmamı özetle; yanıt vermem gereken bir şey var mı?`);
export const projeDurumu = (ad: string): Istem => aracli(`${ad} projesinin durumunu özetle; açık işler ve riskler neler?`);
/** Fuber'in önerisini konuşmak: konusu istemin içinde, araç gerekmez (Gizli'de de konuşulur). */
export const konuyuKonusalim = (baslik: string, icerik?: string | null): Istem => aracsiz(`Şu konuyu konuşalım: ${baslik}${icerik ? ` — ${icerik}` : ''}`);

/** Gizli turda yapılabilenler (araçsız: yazı, özet, çeviri, birlikte düşünme). Öneri listeleri Gizli'de araç isteyenlerin yerine bunları
 *  önerir; her biri önce kullanıcıdan gereken metni ya da konuyu ister. */
export const GIZLI_ONERILERI: readonly IstemOnerisi[] = [
  { simge: 'kalem', etiket: 'Bir yazı taslağı hazırla', ipucu: 'Konusunu ve kime yazdığını sorar', istem: aracsiz('Bir yazı taslağı hazırlamama yardım et; önce konusunu ve kime yazdığımı sor.') },
  { simge: 'liste', etiket: 'Bir metni özetle', ipucu: 'Yapıştırdığın metni kısaltır', istem: aracsiz('Bir metni özetlemeni istiyorum; önce metni yapıştırmamı iste, sonra kısaca özetle.') },
  { simge: 'kure', etiket: 'Bir metni çevir', ipucu: 'İstediğin dile', istem: aracsiz('Bir metni çevirmeni istiyorum; önce metni ve hangi dile çevireceğini sor.') },
  { simge: 'isik', etiket: 'Bir konuyu birlikte düşünelim', ipucu: 'Artıları ve eksileriyle', istem: aracsiz('Bir konuyu birlikte düşünmek istiyorum; önce ne olduğunu sor, sonra artılarını ve eksilerini birlikte tartalım.') },
];

// ── Yüzeylerin öneri listeleri (Normal mod; Gizli'de oneriListesi / istemDugmeleri süzer) ──

/** Kokpit sohbetinin boş hâlindeki "Sorabileceklerin": bağlama göre, en çok 4 (renderer/pano/SohbetBaslangic.tsx çizer). */
export function sohbetOnerileri(b: { konu?: string; okunmamis: number; takvimBos: boolean }): IstemOnerisi[] {
  const cip = (etiket: string, istem: Istem): IstemOnerisi => ({ simge: 'gonder', etiket, istem });
  const hatirlatici = cip('Yarın sabah için bir hatırlatıcı kur', ISTEM.yarinHatirlatici);
  const l: IstemOnerisi[] = [];
  if (b.konu) l.push(cip(`${b.konu} haberlerini özetle`, konuHaberleri(b.konu)));
  l.push(cip('Günümü planla', ISTEM.gunuPlanla));
  if (b.okunmamis) l.push(cip('Okunmamış e-postalarımı tara', ISTEM.epostaTara));
  else if (b.takvimBos) l.push(hatirlatici);
  l.push(cip('Bu hafta beni neler bekliyor?', ISTEM.buHafta));
  if (!b.okunmamis && !b.takvimBos) l.push(hatirlatici);
  return l.slice(0, 4);
}
/** Boş bir sohbetin hazır önerileri (renderer/bilesenler/Sohbet.tsx: kokpitin yeni sohbet taslağı ve Sohbetler sayfası). Düğmenin adı
 *  gönderilen metnin kendisidir. 0.11 G7 (F1 KK-1 devri): eskiden bileşende ham bir diziydi ve Gizli'de araç isteyenleri de öneriyordu;
 *  artık `oneriListesi` ile süzülür. */
export const SOHBET_BOS_ONERILERI: readonly IstemOnerisi[] = ([ISTEM.bugunBeniNeBekliyor, ISTEM.yarinToplanti, ISTEM.sonEpostalar, ISTEM.beniTani] as const)
  .map((istem) => ({ simge: 'gonder', etiket: istem.metin, istem }));
/** "Fuber’e sorabilirsin" kartının istemleri (renderer/pano/PanoKartlari.tsx IpuclariKarti; sayfaya götüren satırlar orada). */
export const IPUCU_ONERILERI: readonly IstemOnerisi[] = [
  { simge: 'zil', etiket: 'Yarın için hatırlatıcı kur', ipucu: 'Saatini ve konusunu sorar', istem: ISTEM.yarinHatirlatici },
  { simge: 'kure', etiket: 'Gündemi bana özetle', ipucu: 'Takvim, e-posta ve haberler', istem: ISTEM.gundemiOzetle },
  { simge: 'liste', etiket: 'Haftamı planla', ipucu: 'Bu haftanın işleri ve boşlukları', istem: ISTEM.haftamiPlanla },
];
/** Araç kiti (hızlı eylemler; `ipucu` uzun kartta, kutucuk görünümünde). */
export const ARAC_KITI: readonly IstemOnerisi[] = [
  { simge: 'zil', etiket: 'Hatırlatıcı kur', ipucu: 'Ne zaman, ne için', istem: ISTEM.hatirlaticiKur },
  { simge: 'isik', etiket: 'Günümü planla', ipucu: 'Takvim, işler, e-posta', istem: ISTEM.gunuPlanla },
  { simge: 'posta', etiket: 'E-postaları tara', ipucu: 'Önemli ve yanıt bekleyen', istem: ISTEM.epostaTara },
  { simge: 'kure', etiket: 'Web’de araştır', ipucu: 'Kaynaklarıyla özet', istem: ISTEM.webArastir },
  { simge: 'ekran', etiket: 'Ekranıma bak', ipucu: 'Gördüğünü anlatır', istem: ISTEM.ekranaBak },
  { simge: 'hafiza', etiket: 'Hakkımda ne biliyorsun', ipucu: 'Hafızandakiler', istem: ISTEM.hakkimda },
];
/** Takvim boşken gündem bandının çipleri (PanoKartlari.tsx AcikGun). */
export const ACIK_GUN_ONERILERI: readonly IstemOnerisi[] = [
  { simge: 'isik', etiket: 'Günümü planla', istem: ISTEM.gunuPlanla },
  { simge: 'zil', etiket: 'Hatırlatıcı kur', istem: ISTEM.hatirlaticiKur },
  { simge: 'arti', etiket: 'İş ekle', istem: ISTEM.isEkle },
];
/** Liste kartının alt şeridindeki tek eylem (PanoKartlari.tsx KartAltligi); `okunmamis` e-posta kartının düğme adını seçer. */
export function altlikOnerisi(tip: KartTipi, okunmamis = 0): IstemOnerisi | null {
  switch (tip) {
    case 'hatirlatici': return { simge: 'arti', etiket: 'Hatırlatıcı kur', istem: ISTEM.hatirlaticiKur };
    case 'dikkat': return { simge: 'isik', etiket: 'Birlikte bak', istem: ISTEM.dikkat };
    case 'oneriler': return { simge: 'isik', etiket: 'Hangisiyle başlayayım?', istem: ISTEM.oneriler };
    case 'plan': return { simge: 'arti', etiket: 'İş ekle', istem: ISTEM.isEkle };
    case 'eposta': return { simge: 'posta', etiket: okunmamis ? 'Okunmamışları tara' : 'Gelen kutusunu tara', istem: ISTEM.epostaTara };
    default: return null;
  }
}

// ── Kural ──

/** Bu turlarda araç var mı (yok)? Gizli mod VE (0.11 G8, K3) "Yalnız bu bilgisayardaki yapay zekâ": ikisinde de yerel tek motor araçsız çalışır —
 *  boş sohbet önerileri, kokpit "Hızlı işler" ve istem düğmeleri araç isteyenleri göstermez (oneriListesi/istemDugmeleri/istemOnerilir'e bu verilir). */
export const aracsizMi = (s: { gizli?: boolean; yalnizYerel?: boolean } | null | undefined): boolean => s?.gizli === true || s?.yalnizYerel === true;

/** Normal modda her istem önerilir; araçsız turda (Gizli — hazır ya da hazırlanırken — ya da yalnız yerel: `aracsizMi`) yalnız araçsız olan. */
export function istemOnerilir(i: Istem, aracsiz: boolean): boolean {
  return !(aracsiz && i.arac);
}
/** Öneri listesinin gösterilecek hâli: Normal'de liste aynen; araçsız turda araç isteyenler çıkar ve yerlerine araçsız turda yapılabilenler gelir
 *  (liste boş kalmaz, kartın düzeni bozulmaz). */
export function oneriListesi(liste: readonly IstemOnerisi[], aracsiz: boolean): IstemOnerisi[] {
  const kalan = liste.filter((o) => istemOnerilir(o.istem, aracsiz));
  if (!aracsiz) return kalan;
  return [...kalan, ...GIZLI_ONERILERI.filter((g) => !kalan.some((k) => k.istem.metin === g.istem.metin))];
}
/** Tek tek düğmeler (takvim boşken gündem çipleri): araçsız turda araç isteyen düğme gizlenir; hepsi gizlendiyse yerinde tek nötr cümle.
 *  G8 düzeltme turu 2: araçsızlık ile Gizli AYRI bilgilerdir — cümle GERÇEK Gizli'ye göre seçilir: Gizli ise K-6'nın Gizli satırı (GIZLI_SOHBET_NOTU,
 *  bayt bayt eskisi), yalnız yerelse "Gizli" demeyen nötr cümle (YALNIZ_YEREL_SOHBET_NOTU; spec §7: gizlilik sözü verilmez). `gizli` bilerek
 *  zorunlu: unutulursa tip hatası verir, yalnız yerel sessizce Gizli cümlesini söylemez. */
export function istemDugmeleri(liste: readonly IstemOnerisi[], aracsiz: boolean, gizli: boolean): { gorunen: IstemOnerisi[]; not: string | null } {
  const gorunen = liste.filter((o) => istemOnerilir(o.istem, aracsiz));
  return { gorunen, not: liste.length > 0 && gorunen.length === 0 ? (gizli ? GIZLI_SOHBET_NOTU : YALNIZ_YEREL_SOHBET_NOTU) : null };
}
