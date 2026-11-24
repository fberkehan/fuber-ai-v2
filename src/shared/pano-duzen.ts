// ── Dolu pano düzeni (Görev 24, K14): "boş kutu yok, büyük boş alan yok" ─────────────────────────────────────────────────────
// Boş kutucuk kalmaz; arayüz dolu ve profesyonel bir panoya dönüşür. İki kural:
//  1. Boş kart yok: verisi olmayan kullanıcı kartı (sohbet yokken "Geçmiş sohbetler", hatırlatıcı yokken "Hatırlatıcılar") hiç
//     gösterilmez (kartDoluMu; ana süreçteki planlayıcı/yedek yerleşim de aynı kuralı uygular).
//  2. Büyük boş alan yok: kullanıcı kartlarından sonra görünen alanda kalan satırlar doldurucularla (hava, haberler, araç kiti, döviz,
//     öneriler) tam doldurulur. Görünen alanın kaç ızgara satırı tuttuğunu arayüz ölçer (hedefSatir); burada birkaç aday denenir
//     (kaç doldurucu, kullanıcının son satırına katılsın mı), satır boyları büyütülerek boşluk kapatılır, en iyi aday seçilir.
//     Kullanıcının verisi ekranı doldurursa doldurucular küçülüp aşağı iner (en altta tek sıra: hava, haberler, araç kiti).
// Saf işlev (DOM yok): tests/pano-duzen.test.ts.
import { izgaraDiz, bantMi, boyOku, kartGenisligi, BANT_TIPLERI, SATIR, type Boy, type Hucre, type SutunSayisi } from './izgara.ts';
import { kartGorevleri } from './yapilacaklar.ts';
import type { KartTipi, KartYerlesimi, KokpitVerisi } from './tipler.ts';

/** Doldurucular, öncelik sırasıyla (arayüz yalnız kullanılabilenleri — kaynağı açık ve verisi olan/gelecek — verir). */
export const DOLGU_TIPLERI: readonly KartTipi[] = ['hava', 'haberler', 'arac_kiti', 'piyasa', 'ipuclari'];
export const dolguMu = (tip: KartTipi) => DOLGU_TIPLERI.includes(tip);
/** Ekran dolu olsa da (aşağıda) her zaman bulunanlar. */
export const CEKIRDEK_DOLGU: readonly KartTipi[] = ['hava', 'haberler', 'arac_kiti'];
/** 12 sütunda önerilen genişlik (haberler geniş: başlıklar iki satıra sığsın; araç kitinin yedi düğmesi üç sütunda kaydırmasız). */
const TERCIH: Partial<Record<KartTipi, number>> = { hava: 4, haberler: 8, arac_kiti: 8, piyasa: 4, ipuclari: 4 };
/** Ekran doluyken aşağıdaki sıra: hava + haberler bir satır, araç kiti tam genişlik (iki satır düğme). */
const KUYRUK_GENISLIK: Partial<Record<KartTipi, number>> = { hava: 4, haberler: 8, arac_kiti: 12 };

/** Kartın gösterilecek verisi var mı (kural 1). Bantlar ve doldurucular kendi içeriklerini taşır. */
export function kartDoluMu(tip: KartTipi, v: KokpitVerisi, ozelId?: string): boolean {
  switch (tip) {
    case 'hatirlatici': return v.hatirlaticilar.length > 0;
    case 'plan': return kartGorevleri(v).length > 0; // 0.11 G4: son açık madde işaretlense de kart kalır (işaretli bugün görünür)
    case 'eposta': return v.epostalar.length > 0;
    case 'whatsapp': return v.whatsapp.length > 0;
    case 'dikkat': return v.oneriler.some((o) => o.tur === 'dikkat');
    case 'oneriler': return v.oneriler.some((o) => o.tur !== 'dikkat');
    case 'sohbetler': return v.sohbetler.some((s) => s.tur !== 'ana');
    case 'projeler': return v.projeler.length > 0;
    case 'hafiza': return v.hafiza.length > 0;
    case 'ice_aktarma': return v.iceAktarma.bekleyen > 0 || v.iceAktarma.hata > 0;
    case 'dusunme': return Boolean(v.dusunme?.durum?.etkin);
    case 'meseleler': return (v.dusunme?.meseleler ?? []).some((m) => m.durum === 'acik');
    case 'ozel': return ozelId ? v.ozelKartlar.some((k) => `ozel:${k.id}` === ozelId) : v.ozelKartlar.length > 0;
    default: return true;
  }
}

/**
 * Kartın içeriğine yeten en kısa boy (liste kartları): bir hatırlatıcılı kart "orta" boyda yarısı boş durmasın. Satır başına yaklaşık
 * yükseklik (px; başlık + ikincil satır) × kayıt sayısı, kartın gövdesine (k ≈ 130, o ≈ 236 px) sığana dek küçük boy. Planlayıcının
 * boyundan BÜYÜK önerilmez (arayüz yalnız küçültür); liste kartı olmayanlarda undefined.
 */
// Hatırlatıcı satırı sağda zaman + ✓ düğmesi taşır, başlık dar sütunda iki satıra kırılır (Görev 23, G24 küçüğü: 1440'ta iki
// hatırlatıcılı küçük kart ~10 px taşıyordu) → 66 px: iki hatırlatıcı orta boya çıkar.
const SATIR_YUK: Partial<Record<KartTipi, number>> = { hatirlatici: 66, plan: 52, eposta: 52, whatsapp: 52, dikkat: 66, oneriler: 66, sohbetler: 52, projeler: 52, hafiza: 42 };
function kayitSayisi(tip: KartTipi, v: KokpitVerisi): number {
  return tip === 'hatirlatici' ? v.hatirlaticilar.length : tip === 'plan' ? kartGorevleri(v).length : tip === 'eposta' ? v.epostalar.length
    : tip === 'whatsapp' ? v.whatsapp.length : tip === 'dikkat' ? v.oneriler.filter((o) => o.tur === 'dikkat').length
    : tip === 'oneriler' ? v.oneriler.filter((o) => o.tur !== 'dikkat').length : tip === 'sohbetler' ? v.sohbetler.filter((s) => s.tur !== 'ana').length
    : tip === 'projeler' ? v.projeler.length : v.hafiza.length;
}
export function icerikBoyu(tip: KartTipi, v: KokpitVerisi): Boy | undefined {
  const h = SATIR_YUK[tip];
  if (!h) return undefined;
  const gerek = kayitSayisi(tip, v) * h;
  return gerek <= 130 ? 'k' : gerek <= 236 ? 'o' : 'b';
}
/** Az kayıtlı liste kartının 12 sütundaki en çok genişliği (1–2 kayıt: 4, 3–4: 6): yanına doldurucu girebilsin, tek satır koca kutu olmasın. */
export function icerikGenisligi(tip: KartTipi, v: KokpitVerisi): number | undefined {
  if (!SATIR_YUK[tip]) return undefined;
  const n = kayitSayisi(tip, v);
  return n <= 2 ? 4 : n <= 4 ? 6 : undefined;
}
/** Kartların boyunu ve genişliğini içeriklerine göre kısaltır (büyütmez). */
export function boylariIcerigeGore<T extends KartYerlesimi>(kartlar: T[], v: KokpitVerisi): T[] {
  return kartlar.map((k) => {
    const c = icerikBoyu(k.tip, v);
    const g = icerikGenisligi(k.tip, v);
    const simdiki: Boy = k.yukseklik === 'k' || k.yukseklik === 'b' ? k.yukseklik : 'o';
    const boy = c && SATIR[c] < SATIR[simdiki] ? c : k.yukseklik;
    const genislik = g && Number(k.genislik) > g ? g : k.genislik;
    return boy === k.yukseklik && genislik === k.genislik ? k : { ...k, yukseklik: boy, genislik };
  });
}

export interface PanoDuzeniGirdisi {
  /** Planlayıcının (ya da yedek yerleşimin) sırası: bantlar + kullanıcı kartları (+ planlayıcının yerleştirdiği doldurucular). */
  kartlar: KartYerlesimi[];
  /** Kullanılabilir doldurucular, öncelik sırasıyla. */
  dolgular: readonly KartTipi[];
  sutun: SutunSayisi;
  /** Görünen alanda bantların altına kaç ızgara satırı sığıyor (en az 2). */
  hedefSatir: number;
}
export interface PanoDuzeni {
  kartlar: (KartYerlesimi & { yeniSatir?: boolean })[];
  hucreler: Hucre[];
  /** Bantlar hariç toplam satır (aşağıdaki doldurucular dahil). */
  toplamSatir: number;
  /** Görünen alanda doldurulamayan satır (arayüz satırları bu kadar uzatır). */
  bosSatir: number;
}

const BOY_SATIR: Record<number, Boy> = { 2: 'k', 3: 'o', 4: 'b' };
const olcekli = (g: number, sutun: SutunSayisi) => (sutun === 12 ? g : sutun === 6 ? Math.max(3, g / 2) : 1);
type Kart = KartYerlesimi & { yeniSatir?: boolean };

/** Bant olmayan kartların satırları: [ilk satır no, boy, o satırdaki kart kimlikleri]. */
function satirlar(h: Hucre[], bantSatiri: number): { satir: number; boy: number; idler: string[] }[] {
  const m = new Map<number, { satir: number; boy: number; idler: string[] }>();
  for (const x of h) {
    if (x.satir <= bantSatiri) continue;
    const r = m.get(x.satir) ?? { satir: x.satir, boy: x.boy, idler: [] };
    r.idler.push(x.id);
    m.set(x.satir, r);
  }
  return [...m.values()].sort((a, b) => a.satir - b.satir);
}

/**
 * I7 (son inceleme): bir satır yalnız AYNI boydaki kullanıcı kartlarından kurulur. Satırdaki kartlar en uzununun boyunu alır (izgara.ts
 * kural 4): iki kayıtlı "Hatırlatıcılar" (orta) yanında tek kayıtlı "Planlar" (küçük) ortası boş, uzun bir kutu oluyordu. Boyu farklı
 * kart yeni satır başlatır; satırda kalan genişliğe o boya gerilebilen bir doldurucu girer (hava, haberler, araç kiti uzadıkça zenginleşir;
 * döviz ve ipuçları en çok orta boy). Sığan doldurucu yoksa satırdaki kartlar genişler (dikey boşluk değil).
 */
function satirlariKur(kullanici: Kart[], havuz: KartTipi[], sutun: SutunSayisi): Kart[] {
  const E = 1e-9;
  type Satir = { kartlar: Kart[]; boy: number; dolu: number; doluOneri: number; doluEn: number };
  const satirlarK: Satir[] = [];
  for (const k0 of kullanici) {
    const k = { ...k0 };
    const boy = SATIR[boyOku(k, sutun)];
    const g = kartGenisligi(k, sutun);
    const s = satirlarK[satirlarK.length - 1];
    const sigar = s && (s.dolu + g.ham <= sutun + E || (s.doluOneri + g.oneri <= sutun + E && s.doluEn + g.en <= sutun + E));
    if (s && sigar && s.boy === boy) { s.kartlar.push(k); s.dolu += g.ham; s.doluOneri += g.oneri; s.doluEn += g.en; }
    else satirlarK.push({ kartlar: [k], boy, dolu: g.ham, doluOneri: g.oneri, doluEn: g.en });
  }
  const olcek = 12 / sutun;
  for (const s of satirlarK) {
    let bos = sutun - s.dolu;
    while (bos > E && havuz.length) {
      // En iyi oturan: kendi önerilen genişliğiyle (kısaltmadan) en geniş sığan; eşitlikte öncelik sırası. Satırın boyuna gerilebilmeli.
      const uygun = havuz.filter((t) => dolguEnCok(t) >= s.boy && kartGenisligi({ tip: t, genislik: TERCIH[t] ?? 4 }, sutun).en <= bos + E);
      if (!uygun.length) break;
      const sig = (t: KartTipi) => Math.min(kartGenisligi({ tip: t, genislik: TERCIH[t] ?? 4 }, sutun).ham, bos);
      const t = uygun.reduce((a, b) => (sig(b) > sig(a) + E ? b : a));
      havuz.splice(havuz.indexOf(t), 1);
      const g12 = Math.min(TERCIH[t] ?? 4, bos * olcek);
      const kart: Kart = { id: t, tip: t, kolon: 1, genislik: g12, yukseklik: 'k' };
      s.kartlar.push(kart);
      const ham = kartGenisligi(kart, sutun).ham;
      s.dolu += ham; bos -= ham;
    }
  }
  return satirlarK.flatMap((s) => s.kartlar.map((k, j) => (j === 0 ? { ...k, yeniSatir: true } : k)));
}

/** Doldurucunun gerilebileceği en büyük boy (ızgara satırı; I7): hava, haberler ve araç kiti içerikleri uzadıkça zenginleşir; döviz ve
 *  ipuçları kendi içeriklerinin ötesine gerilmez (ortası boş kalırdı). */
const DOLGU_EN_COK: Partial<Record<KartTipi, number>> = { hava: 4, haberler: 4, arac_kiti: 4, piyasa: 2, ipuclari: 3 };
const dolguEnCok = (tip: KartTipi) => DOLGU_EN_COK[tip] ?? 2;

export function panoDiz({ kartlar, dolgular, sutun, hedefSatir }: PanoDuzeniGirdisi): PanoDuzeni {
  const hedef = Math.max(2, Math.floor(hedefSatir));
  const bantlar = BANT_TIPLERI.flatMap((t) => kartlar.filter((k) => k.tip === t).slice(0, 1));
  const kullanilabilir = new Set(dolgular);
  // Kuralla eklenen araç kiti (`yedek`: ana süreç onu her yerleşime koyar) doldurucu havuzuna gider; yeri ekranın doluluğuna göre burada
  // belirlenir. Planlayıcının yerleştirdiği doldurucular — araç kiti dahil (ör. "hava en üstte" tercihi) — yerinde kalır; kaynağı
  // kapalıysa düşer.
  const kullanici: Kart[] = kartlar.filter((k) => !bantMi(k.tip) && !(k.tip === 'arac_kiti' && k.yedek) && (!dolguMu(k.tip) || kullanilabilir.has(k.tip)));
  const havuz = dolgular.filter((t) => !kullanici.some((k) => k.tip === t));
  const bantSatiri = bantlar.length;
  const dolguKarti = (tip: KartTipi, yeniSatir = false): Kart => ({ id: tip, tip, kolon: 1, genislik: TERCIH[tip] ?? 4, yukseklik: 'k', ...(yeniSatir ? { yeniSatir } : {}) });
  // I7: kullanıcı satırları tek boyda; satırda kalan genişliğe gerilebilen doldurucu (havuzdan düşer).
  const satirli = satirlariKur(kullanici, havuz, sutun);

  type Aday = { dizi: Kart[]; puan: number; bos: number; n: number };
  const dene = (n: number): Aday | null => {
    const dolgu = havuz.slice(0, n).map((t, i) => dolguKarti(t, i === 0));
    const dizi: Kart[] = [...bantlar, ...satirli.map((k) => ({ ...k })), ...dolgu];
    const h = izgaraDiz(dizi, sutun);
    const rows = satirlar(h, bantSatiri);
    const toplam = rows.reduce((t, r) => t + r.boy, 0);
    if (toplam > hedef && n > 0) return null;
    let fazla = Math.max(0, hedef - toplam);
    // Boşluk satırları büyüterek kapatılır — YALNIZ bütün kartları doldurucu olan satırlar (I7, son inceleme: doldurucu içeren HER satır
    // büyüyordu; yanındaki kullanıcı kartı — Hatırlatıcılar, Döviz — beş günlük hava kartının boyuna gerilip ortası boş kalıyordu): önce
    // hava/haberler satırları, sonra diğerleri; her satır kartlarının gerilebildiği en büyük boya dek. Kalan boşluğu arayüz piksel olarak
    // yine yalnız böyle satırlara dağıtır (satirPikselleri). Satırın kartlarının boyu birlikte yazılır.
    const tip = new Map(dizi.map((k) => [k.id, k.tip] as const));
    const dolguSatiri = (r: { idler: string[] }) => r.idler.every((id) => dolguMu(tip.get(id)!));
    const uzayabilir = (r: { idler: string[] }) => r.idler.some((id) => tip.get(id) === 'hava' || tip.get(id) === 'haberler');
    const dolguSatirlari = rows.filter(dolguSatiri);
    const buyutulecek = [...dolguSatirlari.filter(uzayabilir), ...dolguSatirlari.filter((r) => !uzayabilir(r))];
    const enCokBoy = (r: { idler: string[] }) => Math.min(...r.idler.map((id) => dolguEnCok(tip.get(id)!)));
    for (const r of buyutulecek) {
      while (fazla > 0 && r.boy < enCokBoy(r)) { r.boy += 1; fazla -= 1; }
    }
    const boylar = new Map<string, Boy>();
    for (const r of rows) for (const id of r.idler) boylar.set(id, BOY_SATIR[r.boy] ?? 'b');
    for (const k of dizi) if (boylar.has(k.id)) k.yukseklik = boylar.get(k.id)!;
    // Gerilen kart: önerisinin 1,5 katından geniş ve satırın yarısından geniş (tek başına koca kutu) → seyrek görünür.
    const gerilen = h.filter((x) => {
      const k = dizi.find((d) => d.id === x.id);
      return k && !bantMi(k.tip) && sutun > 1 && x.genislik >= olcekli(Number(k.genislik) || 6, sutun) * 1.5 && x.genislik > sutun / 2;
    }).length;
    return { dizi, puan: fazla * 100 + gerilen * 15 - n * 4, bos: fazla, n };
  };

  let en: Aday = dene(0)!;
  for (let n = 1; n <= havuz.length; n++) {
    const a = dene(n);
    if (a && (a.puan < en.puan || (a.puan === en.puan && a.n > en.n))) en = a;
  }
  // Yerleşmeyen çekirdek doldurucular aşağıda tek sıra (ekran doluysa "küçülüp aşağı iner").
  const yerlesen = new Set(en.dizi.map((k) => k.tip));
  const kuyruk = havuz.filter((t) => CEKIRDEK_DOLGU.includes(t) && !yerlesen.has(t)).map((t, i) => ({ ...dolguKarti(t, i === 0), genislik: KUYRUK_GENISLIK[t] ?? 4 }));
  const sonuc = [...en.dizi, ...kuyruk];
  const hucreler = izgaraDiz(sonuc, sutun);
  const toplamSatir = satirlar(hucreler, bantSatiri).reduce((t, r) => t + r.boy, 0);
  return { kartlar: sonuc, hucreler, toplamSatir, bosSatir: en.bos };
}

/** Görünen yükseklikten (px) satır sayısı: 92 px satır + 14 px aralık (tasarim.css .izgara). */
export const SATIR_PX = 92;
export const ARALIK_PX = 14;
/** 0.13 T14: bir ızgara satırının en çok yüksekliği (px). Uzun/geniş ekranda artan yükseklik doldurucu satırlara dağıtılırken satırlar bunu
 *  aşmaz (tam ekranda hava ve döviz garip görünüyor, boşluklar anlamsızlaşıyordu); kalan yükseklik kullanılmaz, sayfa kayar. */
export const SATIR_TAVAN_PX = 132;
export function hedefSatirHesapla(yukseklikPx: number, satirPx = SATIR_PX, aralikPx = ARALIK_PX): number {
  return Math.max(2, Math.floor((yukseklikPx + aralikPx) / (satirPx + aralikPx)));
}
/** Satırları görünen alana tam oturtan satır yüksekliği (en az 92, en çok 168 px: çok uzun pencerede satırlar devleşmesin). */
export function satirYuksekligi(yukseklikPx: number, gorunurSatir: number, aralikPx = ARALIK_PX): number {
  const v = Math.max(1, gorunurSatir);
  return Math.max(SATIR_PX, Math.min(168, Math.floor((yukseklikPx - (v - 1) * aralikPx) / v)));
}

/**
 * Izgara satırlarının tek tek yüksekliği (px; bantlar hariç, birim satır başına). Düzeltme turu 1: kullanıcı kartlarının satırları
 * içerik boyunda (92 px tabanı) kalır; görünen alanda artan yükseklik YALNIZ bütün kartları doldurucu olan satırlara — önce içeriği
 * uzadıkça zenginleşen hava/haberler satırlarına — dağıtılır (I7). Böyle satır yoksa (kullanıcının verisi ekranı dolduruyor) artan
 * yükseklik kullanılmaz: sıradaki satır görünen alanın dibine akar. Görünen alanın dışındaki satırlar taban yükseklikte.
 */
export function satirPikselleri(duzen: Pick<PanoDuzeni, 'kartlar' | 'hucreler' | 'toplamSatir'>, hedefSatir: number, alanPx: number): number[] {
  const n = duzen.toplamSatir;
  const px = Array.from({ length: n }, () => SATIR_PX);
  if (!n || !(alanPx > 0)) return px;
  const bant = duzen.kartlar.filter((k) => bantMi(k.tip)).length;
  const v = Math.min(n, Math.max(2, hedefSatir));
  const fazla = Math.floor(alanPx - (v * SATIR_PX + (v - 1) * ARALIK_PX));
  if (fazla <= 0) return px;
  const tip = new Map(duzen.kartlar.map((k) => [k.id, k.tip] as const));
  // I7 (son inceleme): bir satır YALNIZ onu kaplayan bütün kartlar doldurucuysa uzar — eskiden hava/haberler içeren her satır uzuyordu ve
  // yanındaki kullanıcı kartı (Hatırlatıcılar, Döviz) ortası boş, uzun bir kutu oluyordu. Önce hava/haberler satırları, sonra öteki
  // doldurucu satırları. Görünen alanda böyle satır yoksa artan yükseklik KULLANILMAZ: kullanıcı kartları gerilmez, sıradaki satır görünen
  // alanın dibine akar (sayfa kayar).
  const satirTipleri = Array.from({ length: v }, () => [] as KartTipi[]);
  for (const h of duzen.hucreler) {
    const t = tip.get(h.id);
    if (!t || bantMi(t)) continue;
    for (let r = h.satir - 1 - bant; r < h.satir - 1 - bant + h.boy; r++) if (r >= 0 && r < v) satirTipleri[r].push(t);
  }
  const dolguSatiri = (l: KartTipi[]) => l.length > 0 && l.every(dolguMu);
  const havaliMi = (l: KartTipi[]) => l.some((t) => t === 'hava' || t === 'haberler');
  const bul = (kosul: (l: KartTipi[]) => boolean) => satirTipleri.map((l, r) => (dolguSatiri(l) && kosul(l) ? r : -1)).filter((r) => r >= 0);
  let esnek = bul(havaliMi);
  if (!esnek.length) esnek = bul((l) => !havaliMi(l));
  if (!esnek.length) return px;
  // Satır başına üst sınır (Görev 23, G24 küçüğü): içeriği uzamayan doldurucu (ipuçları: başlık + 4 düğme) kendi boyunun ötesine
  // gerilmez — hava kapalı ve ağ yokken ipuçları kartı %65 boş kalıyordu. Sınırlanan satırın payı öteki esnek satırlara geçer; hepsi
  // sınırdaysa artan yükseklik kullanılmaz (boş kutu yerine kartların altında nefes payı).
  const tavan = new Map<number, number>();
  for (const h of duzen.hucreler) {
    const t = tip.get(h.id);
    const ic = t ? ICERIK_TAVANI[t] : undefined;
    if (!ic || bantMi(t!)) continue;
    const satirBasi = Math.max(SATIR_PX, Math.floor((ic - (h.boy - 1) * ARALIK_PX) / h.boy));
    for (let r = h.satir - 1 - bant; r < h.satir - 1 - bant + h.boy; r++) if (r >= 0 && r < v) tavan.set(r, Math.min(tavan.get(r) ?? Infinity, satirBasi));
  }
  // Her satırın genel üst sınırı da vardır (SATIR_TAVAN_PX); içerik sınırı bundan düşükse o geçer.
  const ust = (r: number) => Math.min(tavan.get(r) ?? Infinity, SATIR_TAVAN_PX);
  let kalan = fazla;
  let acik = esnek.filter((r) => px[r] < ust(r));
  while (kalan > 0 && acik.length) {
    const once = kalan;
    const pay = Math.floor(kalan / acik.length);
    let artan = kalan - pay * acik.length;
    for (const r of acik) {
      const iste = pay + (artan-- > 0 ? 1 : 0);
      const ver = Math.min(iste, ust(r) - px[r]);
      px[r] += ver;
      kalan -= ver;
    }
    acik = acik.filter((r) => px[r] < ust(r));
    if (kalan === once) break;
  }
  return px;
}
/** Doldurucunun içeriğinin tamamı görünürken kartın yüksekliği (px): ötesine gerilirse boş kalır. Uzadıkça zenginleşenler (hava, haberler,
 *  araç kiti: kutucuk görünümü, piyasa: grafik) sınırsız. */
const ICERIK_TAVANI: Partial<Record<KartTipi, number>> = { ipuclari: 310, piyasa: 240 };

/** Liste kartının alt şeridi (özet + tek eylem; ör. "+ Hatırlatıcı kur") sığar mı: kayıtlar gövdede yer aldıktan sonra ≥ 44 px kalıyorsa. */
const GOVDE_PX: Record<Boy, number> = { k: 124, o: 230, b: 336 };
export function altlikSigar(tip: KartTipi, v: KokpitVerisi, boy: Boy): boolean {
  const h = SATIR_YUK[tip];
  if (!h) return false;
  return GOVDE_PX[boy] - kayitSayisi(tip, v) * h >= 44;
}
export { SATIR };
