// ── Kokpit ızgarası ve kart önemi ────────────────────────────────────────────────────────────────────────────
// Kart dağılımı ızgarayı bazen bozuyordu; ızgara düzgün yönetilir. Önemliyse kenarlıkta renk değişimi,
// geçici efektler olabilir. Yapay zekâ kartların SIRASINI ve kabaca ölçüsünü önerir; burada
// belirleyici bir düzene çevrilir (ana süreç 12 sütun için, arayüz o anki genişlik için aynı işlevi çağırır):
//  1. Genişlik küçük bir kümeye oturur (12 sütunda 3/4/6/8/9/12) ve kart tipinin en dar hâlinin altına inmez.
//  2. Kartlar SIRAYLA satırlara dolar (planlayıcının önceliği bozulmaz); sığmayan kart yeni satıra geçer.
//  3. Her satır tam dolar: sütunlar, önerilen genişliklere en yakın izinli bölüşümle dağıtılır → delik kalmaz.
//  4. Satırdaki kartlar aynı boydadır (en uzununki); kart tipinin en kısa boyunun altına inilmez.
//  5. Sütun sayısı (12 → 6 → 1) ızgaranın KENDİ genişliğinden seçilir: sohbet sütunu yer kapladığı için pencere
//     genişliği yanıltıcıdır.
//  5b. 0.13 T14 (geniş ekran): kokpit alanı KOKPIT_EN_GENIS'ten (px) geniş olmaz, ortalanır; bazı kartlar (hava, döviz, öneriler) 12 sütunda
//     KART_EN_GENIS'ten geniş olmaz — dolgu gerekirse satırın öteki kartları (haberler, kullanıcı kartları) büyür. "Her şey genişliyor,
//     boşluklar anlamsızlaşıyor" sorunu: hava ve döviz tam ekranda üçte bir satır kalır, içlerini geniş-kart yerleşimleri (pano.css) düzenler.
//  6. Zihin kartı (selamlama bandı) ızgaraya girmez: HER ZAMAN ilk kart, tam genişlikte ve tek başına bir satırdır
//     (komşusu onu germez); yüksekliği içeriğinden gelir → arayüz o satırı `auto` yapar (BANT_SATIRI = 1 satır).
//     Görev 24: gündem bandı ('gundem': bugün bekleyenler + gündemdeki konular) da bir banttır; zihinden hemen sonra gelir.
// Saf işlevler (DOM yok, veritabanı yok): tests/izgara.test.ts doğrudan sınar.
import type { KartOnemi, KartTipi, KartYerlesimi, KokpitVerisi } from './tipler.js';

/** Bantlar (kendi satırında, tam genişlik, `auto` yükseklik) ve sıraları: önce zihin, sonra gündem. */
export const BANT_TIPLERI: readonly KartTipi[] = ['zihin', 'gundem'];
export const bantMi = (tip: KartTipi) => BANT_TIPLERI.includes(tip);

export type Boy = KartYerlesimi['yukseklik'];
export type SutunSayisi = 12 | 6 | 1;

/** Bir boy kaç ızgara satırı tutar (satır yüksekliği CSS'te: .izgara grid-auto-rows). */
export const SATIR: Record<Boy, number> = { k: 2, o: 3, b: 4 };
const IZINLI: Record<SutunSayisi, readonly number[]> = { 12: [3, 4, 6, 8, 9, 12], 6: [3, 6], 1: [1] };

/** Zihin bandının ızgara satırı sayısı: tek satır; arayüz o satırı `auto` yapar (kart içeriğine göre yükselir). */
export const BANT_SATIRI = 1;

/** Kokpit alanındaki ızgaranın en geniş hâli (px): 2560'ta kartlar uzayıp kutuların içi boşalmasın. Sohbet sütunu (clamp 360–480 px) ayrı ve sabit;
 *  değer tasarim.css'te `--kokpit-en-genis` (tests/izgara.test.ts ikisini eşler). Dar ekranlarda alan zaten bundan dar: bir şey değişmez. */
export const KOKPIT_EN_GENIS = 1680;
/** 12 sütunda kart tipinin en çok genişliği: ekran ne kadar geniş olursa olsun hava ve döviz satırın üçte birinde kalır (4 sütun), öneriler yarısında. */
export const KART_EN_GENIS: Partial<Record<KartTipi, number>> = { hava: 4, piyasa: 4, ipuclari: 6 };

/** 12 sütunda kart tipinin en dar hâli: gün kaydı dar sütunda sıkışıyordu; listeler 4'ün altında okunmuyor. (Zihin bandı hep tam genişlik.) */
const EN_DAR: Partial<Record<KartTipi, number>> = { dusunme: 6, ozel: 3, ice_aktarma: 3, piyasa: 3, ipuclari: 3 };
const VARSAYILAN_EN_DAR = 4;
/** Kart tipinin en kısa boyu (gün kaydı kartının sayaç + not + rapor satırları küçük boya sığmıyor). */
const EN_KISA: Partial<Record<KartTipi, Boy>> = { dusunme: 'o' };

/** Izgara genişliğine (px) göre sütun sayısı. Eşikler: 12 sütunda bir sütun ~50 px'in altına inmesin; 6'da kart ~200 px. */
export function sutunSec(genislikPx: number): SutunSayisi {
  return genislikPx >= 760 ? 12 : genislikPx >= 440 ? 6 : 1;
}

function enDar(tip: KartTipi, sutun: SutunSayisi): number {
  const d = EN_DAR[tip] ?? VARSAYILAN_EN_DAR;
  return sutun === 12 ? d : sutun === 6 ? (d >= 6 ? 6 : 3) : 1;
}

/** Önerilen 12'lik genişliği (bozuk değer olabilir) bu sütun sayısına ölçekler; satıra bölme bu ham değerle yapılır. */
function hamGenislik(g: unknown, sutun: SutunSayisi): number {
  const n = Number(g);
  const g12 = Math.max(1, Math.min(12, Number.isFinite(n) && n > 0 ? n : 6));
  return sutun === 12 ? g12 : sutun === 6 ? g12 / 2 : 1;
}

/** Kartın bu sütun sayısındaki en dar, önerilen ve satıra yerleşen ("ham") genişliği — izgaraDiz'in satır kurma kuralıyla aynı (pano düzeni
 *  satırları önceden kurarken kullanır: shared/pano-duzen.ts). */
export function kartGenisligi(k: { tip: KartTipi; genislik?: unknown }, sutun: SutunSayisi): { en: number; oneri: number; ham: number } {
  const en = enDar(k.tip, sutun);
  const oneri = hamGenislik(k.genislik, sutun);
  return { en, oneri, ham: Math.min(sutun, Math.max(en, oneri)) };
}

export function boyOku(k: { tip: KartTipi; yukseklik?: unknown }, sutun: SutunSayisi = 12): Boy {
  // Zihin bandı yalnız metin (selamlama + odak + hap; beyin Beyin sayfasına taşındı) ve kendi satırında yalnızdır: kayıtlı
  // boy hep 'k'. Gerçek yükseklik içeriğinden gelir (izgaraDiz → BANT_SATIRI, arayüzde `auto` satır). Gündem bandı da öyle.
  if (bantMi(k.tip)) return 'k';
  const b: Boy = k.yukseklik === 'k' || k.yukseklik === 'b' ? k.yukseklik : 'o';
  const en = EN_KISA[k.tip];
  return en && SATIR[en] > SATIR[b] ? en : b;
}

/**
 * Satırı tam doldurur: her kart için izinli bir genişlik seçer, toplam = sütun sayısı, kartın en dar hâlinin altına
 * inmez; önerilen genişliklerden sapma en az olsun (büyük sapma tek karta yığılmasın diye kare ceza; daraltma ayrıca
 * cezalı; eşitlikte önce sondaki kart büyür). En çok 4 kart × 6 seçenek: kaba kuvvet yeterli ve belirleyici.
 */
export function satiriDagit(hedef: number[], enDarlar: number[], sutun: SutunSayisi, enCoklar?: (number | undefined)[]): number[] {
  // En çok sınırlarıyla bölüşüm yoksa (satırda hepsi sınırlı: sütunlar dolmaz) sınırsız denenir: delik bırakmaktansa sınır esner.
  return dagit(hedef, enDarlar, sutun, enCoklar) ?? dagit(hedef, enDarlar, sutun) ?? yedekDagit(hedef, enDarlar, sutun);
}
function dagit(hedef: number[], enDarlar: number[], sutun: SutunSayisi, enCoklar?: (number | undefined)[]): number[] | null {
  const izinli = IZINLI[sutun];
  const n = hedef.length;
  let en: number[] | null = null;
  let enMaliyet = Infinity;
  const secim: number[] = [];
  const dene = (i: number, kalan: number) => {
    if (i === n) {
      if (kalan !== 0) return;
      let m = 0;
      for (let j = 0; j < n; j++) {
        const f = secim[j] - hedef[j];
        m += f * f * (1 + (n - 1 - j) * 0.02) + (f < 0 ? 0.5 : 0);
      }
      if (m < enMaliyet - 1e-9) { enMaliyet = m; en = [...secim]; }
      return;
    }
    for (const g of izinli) {
      if (g < enDarlar[i] || g > kalan || g > (enCoklar?.[i] ?? Infinity)) continue;
      secim.push(g);
      dene(i + 1, kalan - g);
      secim.pop();
    }
  };
  dene(0, sutun);
  return en;
}
function yedekDagit(hedef: number[], enDarlar: number[], sutun: SutunSayisi): number[] {
  const n = hedef.length;
  // İzinli bölüşüm yoksa (satır oluşturma kuralı gereği olmaz): son kart kalanı alır.
  const out = hedef.map((h, j) => Math.max(enDarlar[j], Math.round(h)));
  out[n - 1] = Math.max(1, sutun - out.slice(0, -1).reduce((a, b) => a + b, 0));
  return out;
}

export interface Hucre { id: string; kolon: number; genislik: number; satir: number; boy: number }

/**
 * Kartları verilen sütun sayısında delik bırakmadan dizer. Dönen hücreler CSS grid'e doğrudan yazılır:
 * grid-column: kolon / span genislik; grid-row: satir / span boy. Diğer kartların sırası korunur; zihin bandı (varsa) en
 * üstte, tam genişlikte ve tek başına bir satırdır (BANT_SATIRI; arayüz o satırı `auto` yapar).
 */
export function izgaraDiz(kartlar: readonly (Pick<KartYerlesimi, 'id' | 'tip' | 'genislik' | 'yukseklik'> & { yeniSatir?: boolean })[], sutun: SutunSayisi): Hucre[] {
  const bantlar = BANT_TIPLERI.flatMap((t) => kartlar.filter((k) => k.tip === t));
  const satirlar: { k: (typeof kartlar)[number]; ham: number; en: number }[][] = [];
  let satir: (typeof satirlar)[number] = [];
  let dolu = 0, doluOneri = 0, doluEn = 0;
  const E = 1e-9;
  for (const k of kartlar) {
    if (bantMi(k.tip)) continue;
    const en = enDar(k.tip, sutun);
    const oneri = hamGenislik(k.genislik, sutun);
    const ham = Math.min(sutun, Math.max(en, oneri));
    // Sığar: genişletilmiş hâliyle sığıyorsa ya da planlayıcı bu kartları zaten aynı satıra koymuşsa ve en dar
    // hâlleriyle sığıyorsa (4+5+3 önerisi, 3'lük görev en az 4 olunca satırdan taşmasın: 4+4+4 olur).
    const sigar = (dolu + ham <= sutun + E) || (doluOneri + oneri <= sutun + E && doluEn + en <= sutun + E);
    // `yeniSatir` (Görev 24, pano düzeni): doldurucular kullanıcı kartlarının satırına girmesin istenirse yeni satır başlatır.
    if (satir.length && (!sigar || k.yeniSatir)) { satirlar.push(satir); satir = []; dolu = 0; doluOneri = 0; doluEn = 0; }
    satir.push({ k, ham, en });
    dolu += ham; doluOneri += oneri; doluEn += en;
  }
  if (satir.length) satirlar.push(satir);

  const out: Hucre[] = [];
  let ust = 1;
  for (const b of bantlar) { out.push({ id: b.id, kolon: 1, genislik: sutun, satir: ust, boy: BANT_SATIRI }); ust += BANT_SATIRI; }
  for (const s of satirlar) {
    const g = satiriDagit(s.map((x) => x.ham), s.map((x) => x.en), sutun, sutun === 12 ? s.map((x) => KART_EN_GENIS[x.k.tip]) : undefined);
    const boy = Math.max(...s.map((x) => SATIR[boyOku(x.k, sutun)]));
    let kolon = 1;
    s.forEach((x, i) => { out.push({ id: x.k.id, kolon, genislik: g[i], satir: ust, boy }); kolon += g[i]; });
    ust += boy;
  }
  return out;
}

/**
 * Ana süreç: planlayıcının yerleşimini 12 sütunda düzgün satırlara oturtur (kolon/genişlik yeniden yazılır). Zihin bandı
 * başa alınır (kalan sıra korunur), tam genişlik ve 'k' boyuna sabitlenir: planlayıcı ne önerirse önersin komşusu onu germez.
 */
export function yerlesimiOturt<T extends KartYerlesimi>(kartlar: T[]): T[] {
  const h = new Map(izgaraDiz(kartlar, 12).map((x) => [x.id, x]));
  const sirali = [...BANT_TIPLERI.flatMap((t) => kartlar.filter((k) => k.tip === t)), ...kartlar.filter((k) => !bantMi(k.tip))];
  return sirali.map((k) => {
    const x = h.get(k.id);
    return x ? { ...k, kolon: x.kolon, genislik: x.genislik, yukseklik: boyOku(k) } : k;
  });
}

// ── Önem ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const ONEM_SIRASI: Record<KartOnemi, number> = { normal: 0, olumlu: 1, dikkat: 2, acil: 3 };
const ONEMLER = Object.keys(ONEM_SIRASI) as KartOnemi[];

export function onemGecerli(o: unknown): o is KartOnemi {
  return typeof o === 'string' && (ONEMLER as string[]).includes(o);
}

/** Kartın önemi; eski kayıtlarda yalnız `vurgu` vardır → dikkat. */
export function onemOku(k: { onem?: unknown; vurgu?: unknown }): KartOnemi {
  return onemGecerli(k.onem) ? k.onem : k.vurgu ? 'dikkat' : 'normal';
}

/** Parıltı ister mi: önem yükseldi ya da "olumlu"ya döndü (sakinleşen kart parlamaz). */
export function onemDegisti(eski: KartOnemi | undefined, yeni: KartOnemi): boolean {
  if (yeni === 'normal' || yeni === eski) return false;
  return yeni === 'olumlu' || ONEM_SIRASI[yeni] > ONEM_SIRASI[eski ?? 'normal'];
}

const gunAnahtari = (t: number) => new Date(t).toLocaleDateString('sv-SE');

/**
 * Veriden çıkan en az önem (planlayıcı unutsa ya da model yoksa da renk doğru olsun):
 * hatırlatıcı 1 saat içinde → acil, 3 saat içinde → dikkat; görevin son tarihi geçti → acil, 3 saat içinde → dikkat;
 * okunmamış çok önemli e-posta → dikkat; "dikkat" kartı doluysa → dikkat; açık meselenin hedefi geçti → acil, bugün/yarın
 * → dikkat; içe aktarmada hata → dikkat.
 */
export function kuralOnemi(tip: KartTipi, v: KokpitVerisi, simdi = Date.now()): KartOnemi {
  const SAAT = 3_600_000;
  const kalanlar = (l: (string | undefined)[]) => l.map((z) => (z ? Date.parse(z) - simdi : NaN)).filter(Number.isFinite);
  switch (tip) {
    case 'hatirlatici': {
      const k = kalanlar(v.hatirlaticilar.filter((h) => h.durum === 'bekliyor').map((h) => h.zaman));
      return k.some((x) => x <= SAAT) ? 'acil' : k.some((x) => x <= 3 * SAAT) ? 'dikkat' : 'normal';
    }
    case 'plan': {
      const k = kalanlar(v.gorevler.map((g) => g.sonTarih));
      return k.some((x) => x < 0) ? 'acil' : k.some((x) => x <= 3 * SAAT) ? 'dikkat' : 'normal';
    }
    case 'eposta':
      return v.epostalar.some((e) => !e.okundu && e.onem >= 5) ? 'dikkat' : 'normal';
    case 'dikkat':
      return v.oneriler.some((o) => o.tur === 'dikkat') ? 'dikkat' : 'normal';
    case 'meseleler': {
      const bugun = gunAnahtari(simdi), yarin = gunAnahtari(simdi + 86_400_000);
      const h = (v.dusunme?.meseleler ?? []).filter((m) => m.durum === 'acik' && m.hedef).map((m) => m.hedef!.slice(0, 10));
      return h.some((x) => x < bugun) ? 'acil' : h.some((x) => x <= yarin) ? 'dikkat' : 'normal';
    }
    case 'ice_aktarma':
      return v.iceAktarma.hata > 0 ? 'dikkat' : 'normal';
    default:
      return 'normal';
  }
}

/**
 * Planlayıcının önemi ile kuralın önemini birleştirir: hangisi daha yüksekse o (olumlu, kural "normal" derse kalır).
 * Zihin kartı hep normaldir. Önemliyse renk değişimi — renk SEYREK olmalı ki anlam taşısın: en çok 2
 * kart acil, en çok 2 kart dikkat; fazlası (planlayıcı sırasına göre) bir alt düzeye iner.
 */
export function onemleriBirlestir<T extends KartYerlesimi>(kartlar: T[], v: KokpitVerisi, simdi = Date.now()): T[] {
  const ham = kartlar.map((k) => {
    if (bantMi(k.tip)) return 'normal' as KartOnemi;
    const p = onemOku(k), r = kuralOnemi(k.tip, v, simdi);
    return ONEM_SIRASI[r] >= ONEM_SIRASI[p] ? r : p;
  });
  // Önce acilleri say (fazlası dikkate iner), sonra dikkatleri (fazlası normale iner).
  let acil = 0;
  const birinci = ham.map((o) => (o === 'acil' && ++acil > 2 ? 'dikkat' : o));
  let dikkat = 0;
  return kartlar.map((k, i) => {
    const o: KartOnemi = birinci[i] === 'dikkat' && ++dikkat > 2 ? 'normal' : birinci[i];
    return { ...k, onem: o, vurgu: o === 'dikkat' || o === 'acil' };
  });
}
