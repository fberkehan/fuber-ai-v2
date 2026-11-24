// ── Yerel bağlam bütçesi (0.12 cila düzeltme turu 1, I-1; saf, birim testli: tests/yerel-baglam.test.ts) ─────────────────────────────
// Bu bilgisayardaki yapay zekânın sunucusu `-c 8192 -np 2` ile açılır (main/yerel/sunucu.ts): llama-server'da `-c` TOPLAM bağlamdır ve
// yuvalara bölünür → yuva başına ≈ 4096 token (istem + yanıt). Arka plan işlerinin yükü (e-posta / WhatsApp öbeği, içe aktarılan belge,
// hafıza yazımı) yerel yolda bu yuvaya sığacak biçimde kırpılır ya da öbeklere bölünür; sığmayan istek sunucuda reddedilir (HTTP 400) ve
// iş hiç yapılmazdı. Tahmin TEMKİNLİ: Türkçe metin 2,5 karakter/token sayılır (hafiza/normal.ts tokenTahmini'nin 3,2'sinden çok token) —
// kırpma güvenli yönde yanılır.

/** Yerel sunucunun TOPLAM bağlamı ve yuva sayısı (llama-server `-c`, `-np`; main/yerel/sunucu.ts buradan okur — tek kaynak). Katalogdaki
 *  bütün modeller (Qwen3 tabanlı Bonsai, standart GGUF'lar) ≥ 32K bağlamla eğitilmiştir; ramGB/vramGB gereksinimleri bu değerle ölçüldü. */
export const YEREL_BAGLAM_TOPLAM = 8192;
export const YEREL_YUVA_SAYISI = 2;
/** Yerel sunucunun yuva başına bağlamı (token): istem + yanıt bu yuvaya sığmalı. */
export const YEREL_YUVA_TOKEN = YEREL_BAGLAM_TOPLAM / YEREL_YUVA_SAYISI;
/** Çağıran yanıt payı vermediyse (sohbet turu) yerelde ayrılan yanıt payı (token). */
export const YEREL_SOHBET_YANIT_TOKEN = 1024;
const KARAKTER_PER_TOKEN = 2.5;
/** Sohbet şablonu, rol etiketleri, JSON çıktı cümlesi (secici.ts yardimciJson) için ayrılan pay (token). */
const SABLON_PAYI = 200;
/** Cila düzeltme turu 2 (yeniden inceleme a): girdiye kalan yuvanın ≈ %70'i hedeflenir — 2,5 karakter/token tahminine ek emniyet. Türkçe
 *  düzyazı ≈ 3 karakter/token, ama CSV/log/rakam/kimlik ağırlıklı metin 2'nin altına düşebilir: gerçek oran ≈ 1,75'e dek girdi sığar.
 *  Yine de sığmazsa çağıran girdiyi yarıya indirip BİR kez yeniden dener (yarilayarakDene; belge ve hafıza kendi içinde). */
const HEDEF_ORANI = 0.7;

export const yerelTokenTahmini = (metin: string): number => Math.ceil(metin.length / KARAKTER_PER_TOKEN);

/** Yerel yolda bir çağrının KULLANICI girdisine kalan karakter: (yuva − yanıt payı (`cikisToken`) − sistem istemi − şablon payı) × %70. */
export function yerelGirdiButcesi(sistem: string, cikisToken: number): number {
  return Math.max(0, Math.floor((YEREL_YUVA_TOKEN - cikisToken - yerelTokenTahmini(sistem) - SABLON_PAYI) * HEDEF_ORANI * KARAKTER_PER_TOKEN));
}

export interface YerelIleti { role: string; content: string }

/**
 * 0.14.1 (yerel modelde kısa bir selam bile bağlama sığmıyordu): yerel isteğin GEÇMİŞİNİ yuvaya sığdırır. Sistem ve SON ileti (turun isteği) hep kalır, hiç
 * kırpılmaz (tek iletili arka plan işleri kendi bütçesini yerelGirdiButcesi ile zaten tutar; aşım onlara açık hata olarak döner). Geçmiş en yeniden
 * geriye, yuvanın %90'ı dolana dek alınır (2,5 karakter/token, temkinli); baştaki asistan iletileri atılır (sohbet kullanıcıyla başlar).
 */
export function yerelMesajlariSigdir(sistem: string, iletiler: readonly YerelIleti[], cikisToken: number): YerelIleti[] {
  if (iletiler.length <= 1) return [...iletiler];
  const son = iletiler[iletiler.length - 1];
  let kalan = Math.floor((YEREL_YUVA_TOKEN - cikisToken - SABLON_PAYI) * 0.9) - yerelTokenTahmini(sistem) - yerelTokenTahmini(son.content) - 8;
  const once: YerelIleti[] = [];
  for (let i = iletiler.length - 2; i >= 0; i--) {
    const t = yerelTokenTahmini(iletiler[i].content) + 8; // rol etiketleri
    if (t > kalan) break;
    kalan -= t;
    once.unshift(iletiler[i]);
  }
  while (once.length && once[0].role !== 'user') once.shift();
  return [...once, son];
}

/**
 * Cila düzeltme turu 2 (a): bir öbeği çalıştırır; `asimMi` (yerel bağlam aşımı) ile reddedilirse öbek ikiye bölünür — tek öğeyse öğe
 * `kisalt` ile kısaltılır — ve her parça BİR kez daha denenir (üçüncü deneme yok; reddedilen istek sunucuda bedavadır). Başka hata ya da
 * ikinci aşım `uyar` ile bildirilir (yutulmaz), sonraki parçalar sürer.
 */
export async function yarilayarakDene<T>(obek: readonly T[], calistir: (o: T[]) => Promise<void>, s: { kisalt: (x: T) => T; asimMi: (e: unknown) => boolean; uyar: (sayi: number, e: unknown) => void }): Promise<void> {
  try {
    await calistir([...obek]);
    return;
  } catch (e) {
    if (!s.asimMi(e) || !obek.length) { s.uyar(obek.length, e); return; }
  }
  const yari = Math.ceil(obek.length / 2);
  const parcalar = obek.length > 1 ? [obek.slice(0, yari), obek.slice(yari)] : [[s.kisalt(obek[0])]];
  for (const p of parcalar) {
    try { await calistir([...p]); } catch (e) { s.uyar(p.length, e); }
  }
}

/**
 * Listeyi sırası bozulmadan öbeklere böler: öbekte en çok `enCok` öğe ve öğelerin ölçüsü (varsayılan: JSON uzunluğu) toplamı `butce`yi
 * aşmaz. Tek başına bütçeyi aşan öğe kendi öbeğinde kalır (çağıran onu önceden kırpmalıdır). Boş liste → boş dizi.
 */
export function obekle<T>(liste: readonly T[], enCok: number, butce: number, olc: (x: T) => number = (x) => JSON.stringify(x).length + 1): T[][] {
  const out: T[][] = [];
  let simdiki: T[] = [];
  let toplam = 2; // JSON dizisinin köşeli parantezleri
  for (const x of liste) {
    const o = olc(x);
    if (simdiki.length && (simdiki.length >= enCok || toplam + o > butce)) { out.push(simdiki); simdiki = []; toplam = 2; }
    simdiki.push(x);
    toplam += o;
  }
  if (simdiki.length) out.push(simdiki);
  return out;
}
