// Kokpit kartlarının sığdırma ölçümü (0.11 G5). Kartın yüksekliği ızgaradan gelir (satır boyu görünen alana göre uzar); içerik ona
// sığmalıdır — kartın içinde kaydırma çubuğu YOK, fazlası "Tümü" ile (spec §4). Sabit "kaç satır sığar" tahmini yetmez: iki satırlık
// başlık, alt yazı, uzun şehir, yazı tipinin yüklenmesi satır boylarını değiştirir. Bu yüzden kart en zengin hâliyle (adım 0) çizilir,
// her çizimden sonra (boyamadan önce: useLayoutEffect) kart taşıyorsa bir adım iner; kart her adımda neyi bırakacağını kendisi seçer
// (önce alt şerit, sonra alt yazılar, sonra satırlar). Kartın ölçüsü ya da içeriğin anahtarı değişince adım 0'dan yeniden başlar.
// Kullanıcı ara hâlleri görmez (hepsi aynı karede biter); kartın kutusu ızgaradan geldiği için yerleşim kaymaz.
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** Kart taşıyor mu: içerik kutudan 1 px'ten fazla uzun (alt piksel yuvarlaması sayılmaz). Kartın içindeki listeler ve gövdesi de
 *  bakılır — ikisinin taşması kartın kaydırma boyunu büyütmez: satırları kalan yeri paylaşan liste (yüksekliği belirli, küçülebilir)
 *  taşınca altındaki şeridin üstüne biner; gövde taşınca son satır kartın alt iç boşluğuna kayar (odak halkası kartın yuvarlak
 *  köşesinden çıkar). Gövdeye alt iç boşluğun yarısı kadar pay: dipnotun 2–3 px'i boşluğa değince kart bir satır kaybetmez. */
export const kartTasiyor = (k: HTMLElement) => k.scrollHeight > k.clientHeight + 1
  || [...k.querySelectorAll<HTMLElement>('.ui-liste')].some((e) => e.scrollHeight > e.clientHeight + 1)
  || [...k.querySelectorAll<HTMLElement>(':scope > .ui-kart__govde')].some((g) => g.scrollHeight > g.clientHeight + Math.max(1, (parseFloat(getComputedStyle(k).paddingBottom) || 0) / 2));

/**
 * Sığma adımı (0 = en zengin hâl, en çok `enCok`). `ref` kartın içindeki herhangi bir öğe olabilir: ölçülen kutu en yakın .ui-kart'tır.
 * `anahtar`: içerik değişince (yeni kayıt, işaret, tema değil) ölçüm baştan yapılır. `kendisi`: kart değil `ref`'in kendisi ölçülür
 * (yüksekliği sabit bir bölüm — gündem bandının iki yarısı).
 */
export function useSigdir(ref: RefObject<HTMLElement | null>, enCok: number, anahtar: string, kendisi = false): number {
  const [olcu, setOlcu] = useState('');
  // Yazı tipi yüklenince (yazı tipi takası metni genişletir, satır sarılır) ölçüm baştan: kartın kutusu değişmez, ResizeObserver görmez.
  const [yazi, setYazi] = useState(0);
  const tam = `${anahtar}|${olcu}|${yazi}`;
  const [durum, setDurum] = useState({ tam: '', adim: 0 });
  const adim = durum.tam === tam ? durum.adim : 0;
  useLayoutEffect(() => {
    const kart = kendisi ? ref.current : ref.current?.closest<HTMLElement>('.ui-kart') ?? ref.current;
    if (!kart || typeof ResizeObserver !== 'function') return;
    const olc = () => setOlcu(`${Math.round(kart.clientWidth)}x${Math.round(kart.clientHeight)}`);
    olc();
    const ro = new ResizeObserver(olc);
    ro.observe(kart);
    return () => ro.disconnect();
  }, [ref, kendisi]);
  useEffect(() => {
    let canli = true;
    void document.fonts?.ready.then(() => { if (canli) setYazi((y) => y + 1); });
    return () => { canli = false; };
  }, []);
  useLayoutEffect(() => {
    const kart = kendisi ? ref.current : ref.current?.closest<HTMLElement>('.ui-kart') ?? ref.current;
    if (kart && adim < enCok && kartTasiyor(kart)) setDurum({ tam, adim: adim + 1 });
  });
  return Math.min(adim, Math.max(0, enCok));
}

/** Liste kartının adımı → görünen satır sayısı: adım başına bir satır eksilir, en az `enAz` kalır. `once` adım (alt şerit, alt yazı)
 *  satırlardan önce bırakılır. */
export function satirSayisi(adim: number, toplam: number, once = 0, enAz = 1): number {
  return Math.max(Math.min(enAz, toplam), toplam - Math.max(0, adim - once));
}

/** Öğenin iç genişliği (ResizeObserver; px). Sütun sayısı CSS'te tahmin edilmez, buradan yazılır (Haberler: iki sütun eşiği). */
export function useGenislik(ref: RefObject<HTMLElement | null>): number {
  const [g, setG] = useState(0);
  useLayoutEffect(() => {
    const e = ref.current;
    if (!e || typeof ResizeObserver !== 'function') return;
    const olc = () => setG(Math.round(e.clientWidth));
    olc();
    const ro = new ResizeObserver(olc);
    ro.observe(e);
    return () => ro.disconnect();
  }, [ref]);
  return g;
}

/** Liste kartının bir sığma adımı: kaç kayıt, başlıklar iki satır mı, alt şerit var mı; `manset`: ilk kayıt büyük yazıyla (Haberler'in
 *  uzun kartı); `ikiSutun`: kayıtlar iki sütunda (geniş ama kısa kart). */
export interface ListeAdimi { n: number; iki: boolean; altlik: boolean; manset?: boolean; ikiSutun?: boolean }
/**
 * Liste kartının sığma planı (en zenginden en yalına; useSigdir'in adımı bu dizinin sırasıdır). Önce alt şerit bırakılır; iki satırlık
 * başlık destekleniyorsa kayıtlar iki satırla `ikiEnAz` kayda dek azalır (haber gibi: üç başlık iki satırda okunur), o da sığmazsa
 * başlıklar tek satıra iner ve kayıtlar yeniden azalır. En az bir kayıt kalır (kayıt yoksa boş hâl).
 */
/** "Tümü"nün gösterdiği, kartta görünmeyen şeylerin sayısı (0.14 T31 düzeltme turu 1, I2): sığmayan satırlar + plan ayrıntıyı (ikinci satırı)
 *  bıraktıysa ayrıntısı olup kartta görünen satırlar. 0'dan büyükse kartta "Tümü" olur — bırakılan özet ve rozet levhadan okunur, kaybolmaz. */
export function gizliSayisi<T>(kayitlar: readonly T[], adim: ListeAdimi, o: { ikiSatir?: boolean; ayrintiVar?: (k: T) => boolean } = {}): number {
  const gizliSatir = Math.max(0, kayitlar.length - adim.n);
  const ayrinti = o.ikiSatir && !adim.iki && o.ayrintiVar ? kayitlar.slice(0, adim.n).filter(o.ayrintiVar).length : 0;
  return gizliSatir + ayrinti;
}

export function listePlani(toplam: number, o: { altlik?: boolean; ikiSatir?: boolean; ikiEnAz?: number } = {}): ListeAdimi[] {
  const plan: ListeAdimi[] = [];
  const iki = Boolean(o.ikiSatir);
  if (o.altlik) plan.push({ n: toplam, iki, altlik: true });
  if (toplam <= 0) return plan.length ? plan : [{ n: 0, iki, altlik: false }];
  if (iki) for (let n = toplam; n >= Math.min(toplam, o.ikiEnAz ?? 3); n--) plan.push({ n, iki: true, altlik: false });
  for (let n = toplam; n >= 1; n--) plan.push({ n, iki: false, altlik: false });
  return plan;
}

/**
 * Sayıyı koruyan sığma planı (Haberler). Her sayıda önce iki satırlık, sonra tek satırlık başlık denenir; ikisi de sığmazsa sıradaki
 * sayıya inilir. Sayılar toplamla sınırlanır, tekrar etmez; alt şerit yok.
 *  - `manset` (≥ 3 kayıtta): planın en zengin adımı — ilk kayıt büyük yazıyla, kalanı altında; yalnız TAMAMI sığarsa seçilir.
 *  - `tek`: tek sütunda denenecek sayılar; `cift`: tek sütun sığmazsa iki sütunda denenecekler (geniş ama kısa kart: satır sayısı yarıya
 *    iner). Geniş kart önce tek sütunu dener — iki sütun kısa kartın çaresidir, uzun kartı yarı boş bırakmasın.
 */
export function sayiPlani(o: { tek: readonly number[]; cift?: readonly number[]; manset?: number }, toplam: number): ListeAdimi[] {
  const sinirli = (l: readonly number[]) => [...new Set(l.map((n) => Math.max(0, Math.min(n, toplam))))];
  const m = Math.min(o.manset ?? 0, toplam);
  const adimlar = (l: readonly number[], ikiSutun: boolean) => sinirli(l).flatMap((n) => [
    { n, iki: true, altlik: false, ...(ikiSutun ? { ikiSutun } : {}) },
    { n, iki: false, altlik: false, ...(ikiSutun ? { ikiSutun } : {}) },
  ]);
  return [...(m >= 3 ? [{ n: m, iki: true, altlik: false, manset: true }] : []), ...adimlar(o.tek, false), ...adimlar(o.cift ?? [], true)];
}
