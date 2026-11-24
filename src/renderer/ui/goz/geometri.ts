// ── Gözler: "Pamuk" geometrisi ve anahtar kareleri (11 Kas; saf; tests/goz-cizim.test.ts, tests/goz-hareket.test.ts) ──────────────────────────────
// Kaynak: onaylanan göz tasarımı (goz-tasarimi-2, öneri 05 "Pamuk": dış üst köşesi yumuşakça düşen göz, aşağıda ve
// içte duran iri bebek, büyük parıltı; keskin köşe yok). Değerler oradan BİREBİR taşındı; burada yalnız veri ve saf hesap var, DOM yok.
//   · Her göz kendi merkezinde (0,0) ve sağ göz için yazılır; `d(yol, s)` x'leri yanla (s) çarpar, sol göz aynadır (s = −1). Parıltılar aynalanmaz:
//     ışık iki gözde aynı yandan gelir. Çift görünüm kutusu 100×40, gözlerin dikey merkezi y = 20.
//   · Kapak ve yanak kırpma yolu KULLANMAZ: gözden biraz geniş, tam örten siyah şekillerdir (kırpmanın kenar yumuşatması beyaz hale bırakıyordu).
//   · Renk yalnız beyaz, siyah ve kipin vurgusu (yalnız küçük parıltıda). Yol komutları yalnız M L C Q H V Z.
import type { GozDurumu } from '../../../shared/goz.ts';
import type { KipKimligi } from '../../../shared/karakterler.ts';

/** İki ondalığa yuvarlanmış sayı (yol ve dönüşüm metinleri). */
export const yuv = (n: number): string => String(Math.round(n * 100) / 100 + 0);
/** Yoldaki x değerlerini (çift sıradaki sayılar) yanla çarpar: sol göz sağın aynası. */
export function d(yol: string, s = 1): string {
  let i = 0;
  return yol.replace(/-?\d*\.?\d+/g, (m) => yuv(parseFloat(m) * (i++ % 2 === 0 ? s : 1)));
}

/** Pamuk'un ölçüleri (tasarımdaki TASARIMLAR[4]). */
export const PAMUK = {
  cx: [30, 70] as const,
  yt: -12,
  yb: 12.3,
  /** Kapalı yayın belirdiği kapak aralığı [yayBas, yaySon] (p: 0 açık, 1 kapalı). */
  yayBas: 0.7,
  yaySon: 0.92,
  lidK: 9,
  cheekK: 32,
  mutluY: -1.2,
  menzil: { x: 4, y: 2.6 },
  /** Bebekli göz: bebek kayar, göz ona bu payla eşlik eder. */
  bakisCarpani: 0.2,
} as const;
export type Pamuk = typeof PAMUK;

/** Gözün gövdesi (sağ göz; s = −1 sol). */
export const sekil = (s: number): string =>
  d('M-12 0 C-12 -7.4 -6.6 -12.4 0 -12 C5.8 -11.7 10.4 -7.6 12.1 -3.4 C12.5 -2.2 12.5 -0.6 12.5 0.8 C12.5 7.6 6.9 12.3 0 12.3 C-6.8 12.3 -12 7.2 -12 0 Z', s);
/** Bebek, büyük parıltı ve küçük (mod renkli) parıltı: bebek içte (−0,9·s) ve aşağıda; parıltı ofsetleri aynalanmaz. */
export const bebek = (s: number) => ({
  bebek: { cx: yuv(-0.9 * s), cy: '2.1', r: '7.3' },
  buyukParilti: { cx: yuv(-0.9 * s - 2.6), cy: '-0.6', r: '2.5' },
  kucukParilti: { cx: yuv(-0.9 * s + 2.3), cy: '4.5', r: '1.05' },
});
/** Kapalı göz yayı (kırpmada ve uykuda; gözün alt kenarına, son ince beyazın yerine oturur). */
export const KAPALI_YOL = 'M-9.4 7 Q0 15.2 9.4 7';

// ── Biçim profilleri (12 Kas): Business "Pamuk", Developer keskin bakış ───────────────────────────────────────────────────────────────
// Keskin bakış ve normal bakış ayrı modlardır; yalnız renk değişimi yetmez. İlk keskin denemeler (goz-tasarimi: Bıçak, yarık bebek) korkutucu
// bulundu; keskin göz Pamuk ailesinde kalır: yuvarlak iri bebek ve iki parıltı aynı, fark gövdenin biçimi, içe eğik düz kenarlı kapak ("odaklanmış",
// "avlanan" değil), biraz küçük bebek ve bakışın tarzı. Önizleme: .superpowers/goz-keskin/index.html (üç öneri). Takas tek satır: KIP_SEKLI.
//   · Bebek ve parıltı öğeleri bütün biçimlerde ORTAK (aynı konum ve yarıçap); biçim farkı bebekte yalnız ölçektir (transform). Gövde ve kapak yolu biçime
//     özgüdür; Gozler iki biçimin katmanını çizer, hangisinin görüneceğini kök svg'nin data-sekil'i seçer (opacity). Takas kırpmanın kapalı anında olur
//     (beyin.ts sekilDegisti): kapaklar gövdeyi tam örttüğünden görünmez. Kapalı yay her biçimde aynıdır (takasta yay sıçramaz).
//   · Hâl ayarları sağ göz içindir; döndürme yanla (s) çarpılır. Eksi döndürme iç köşeyi indirir (odak); hata Pamuk'tan gelir (dış köşe düşer: üzgün, kızgın değil).
export type GozSekliAdi = 'pamuk' | 'odak' | 'ufuk' | 'mercek';
/** Bakışın tarzı: serbest (Pamuk: geniş sakkadlar), odak (dar bant, uzun bakış, satır okur gibi küçük adımlar), sakin (seyrek, yavaş, dar). */
export type BakisTarzi = 'serbest' | 'odak' | 'sakin';
export interface HalAyari { p?: number; rot?: number; q?: number; qIc?: number }
export interface GozSekli {
  ad: GozSekliAdi;
  /** Önizlemedeki adı ve tek satırlık anlatımı. */
  baslik: string;
  anlatim: string;
  /** Gövde (sağ göz; govdeYolu ile aynalanır). */
  govde: string;
  /** Kapak kenarının sarkması (Pamuk 9: yumuşak kase; keskinlerde düz). */
  lidK: number;
  /** Bebeğin ölçeği (bebek ve parıltılar birlikte; yuvarlak kalır). */
  bebekOlcek: number;
  /** Kapalı yay (verilmezse KAPALI_YOL; her biçimde aynı olmalı). */
  kapali?: string;
  hal: Partial<Record<GozDurumu, HalAyari>>;
  bakis: BakisTarzi;
}
const PAMUK_GOVDE = 'M-12 0 C-12 -7.4 -6.6 -12.4 0 -12 C5.8 -11.7 10.4 -7.6 12.1 -3.4 C12.5 -2.2 12.5 -0.6 12.5 0.8 C12.5 7.6 6.9 12.3 0 12.3 C-6.8 12.3 -12 7.2 -12 0 Z';
export const SEKILLER: Readonly<Record<GozSekliAdi, GozSekli>> = {
  pamuk: {
    ad: 'pamuk', baslik: 'Pamuk', anlatim: 'Business: yumuşak, meraklı; dış köşesi düşen yuvarlak göz, geniş sakkadlar.',
    govde: PAMUK_GOVDE, lidK: PAMUK.lidK, bebekOlcek: 1, hal: {}, bakis: 'serbest',
  },
  odak: {
    ad: 'odak', baslik: 'Odak', anlatim: 'Biraz geniş ve basık göz, içe eğik düz kapak, sabit bakış ve satır okur gibi küçük adımlar: kod okuyan dikkat.',
    govde: 'M-12.6 0.6 C-12.6 -6.2 -7.2 -10.8 0 -10.8 C6.2 -10.8 11 -7.6 12.6 -3.2 C13.1 -1.9 13.1 -0.4 13.1 1 C13.1 7.6 7.2 11.9 0 11.9 C-7.1 11.9 -12.6 7.4 -12.6 0.6 Z',
    lidK: 1.5, bebekOlcek: 0.88, bakis: 'odak',
    hal: {
      bosta: { p: 0.2, rot: -9 }, dinliyor: { p: 0.09, rot: -5 }, dusunuyor: { p: 0.26, rot: -9.5, q: 0.24, qIc: 0.14 },
      konusuyor: { p: 0.17, rot: -7, q: 0.16 }, mutlu: { p: 0.03, rot: -2 },
    },
  },
  ufuk: {
    ad: 'ufuk', baslik: 'Ufuk', anlatim: 'Üstü düz, altı yuvarlak göz (ekran gibi), hafif eğik kapak, seyrek ve yavaş bakış: sakin kararlılık.',
    govde: 'M-12.4 0.6 C-12.4 -5 -12 -9 -8 -9 L8.4 -9 C12.4 -9 12.8 -5.4 12.8 0.6 C12.8 7.6 7 11.8 0 11.8 C-7 11.8 -12.4 7.4 -12.4 0.6 Z',
    lidK: 0, bebekOlcek: 0.9, bakis: 'sakin',
    hal: {
      bosta: { p: 0.13, rot: -6 }, dinliyor: { p: 0.05, rot: -2 }, dusunuyor: { p: 0.24, rot: -8, q: 0.2, qIc: 0.1 },
      konusuyor: { p: 0.12, rot: -4, q: 0.12 }, mutlu: { p: 0, rot: 0 },
    },
  },
  mercek: {
    ad: 'mercek', baslik: 'Mercek', anlatim: 'Pamuk gövdesi, alttan hafif kısılmış ve içe eğik kapak, küçük bebek: ekrana yakından bakan dikkat.',
    govde: PAMUK_GOVDE, lidK: 4, bebekOlcek: 0.84, bakis: 'odak',
    hal: {
      bosta: { p: 0.14, rot: -6, q: 0.2 }, dinliyor: { p: 0.06, rot: -3, q: 0.08 }, dusunuyor: { p: 0.2, rot: -8, q: 0.34, qIc: 0.24 },
      konusuyor: { p: 0.12, rot: -5, q: 0.26 }, mutlu: { p: 0.02, rot: -1 },
    },
  },
};
/** Kipin göz biçimi. Developer'ın biçimini değiştirmek için yalnız bu satır (önizlemenin öneri 2'si 'ufuk', 3'ü 'mercek'). */
export const KIP_SEKLI: Readonly<Record<KipKimligi, GozSekliAdi>> = { business: 'pamuk', developer: 'odak' };
export const kipSekli = (kip: KipKimligi | string | undefined): GozSekli => SEKILLER[KIP_SEKLI[kip === 'developer' ? 'developer' : 'business']];
/** Biçimin gövde yolu (s = −1 sol göz, ayna). */
export const govdeYolu = (sk: GozSekli, s: number): string => d(sk.govde, s);

/** Kapak ve yanağın yarım eni (göz biriminde). */
export const KW = 16;
/** Kapak: alt kenarı aşağı doğru hafif sarkar (yarı kapalıyken uykulu, yumuşak bir kase). y(x) = −K·(x/30)². */
export const kapakYolu = (K: number = PAMUK.lidK): string => { const k = yuv(K * (KW / 30) ** 2); return `M${-KW} -40 H${KW} V${-k} Q0 ${k} ${-KW} ${-k} Z`; };
/** Yanak: üst kenarı yukarı doğru kubbeli. Kalkınca gözün altını yer, göz yarım aya döner (^ ^). y(x) = K·(x/30)². */
export const yanakYolu = (K: number = PAMUK.cheekK): string => { const k = yuv(K * (KW / 30) ** 2); return `M${-KW} 40 H${KW} V${k} Q0 ${-k} ${-KW} ${k} Z`; };

// Kapak ve yanak konumları (göz yerel birimi). p = 0 açık, 1 kapalı. q = 0 yanak aşağıda, 1 mutlu.
export const kapakY = (p: number): number => (PAMUK.yt - 1) + p * ((PAMUK.yb + 2) - (PAMUK.yt - 1));
export const kapakT = (p: number, rot = 0): string => `translate(0px, ${yuv(kapakY(p))}px) rotate(${yuv(rot)}deg)`;
export const yanakY = (q: number): number => (PAMUK.yb + 1) + q * ((PAMUK.yb * 0.06 + PAMUK.mutluY) - (PAMUK.yb + 1));
export const yanakT = (q: number): string => `translate(0px, ${yuv(yanakY(q))}px)`;
/** Kapağın dikey ötelemesinden p (döndürme f'yi değiştirmez). */
export const kapakP = (f: number): number => Math.min(1, Math.max(0, (f - (PAMUK.yt - 1)) / ((PAMUK.yb + 2) - (PAMUK.yt - 1))));

// ── Görünüm kutuları ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface GorunumKutusu { x: number; y: number; w: number; h: number }
/** Çentik: tasarımın tam kutusu (100×40). */
export const VB_TAM: GorunumKutusu = { x: 0, y: 0, w: 100, h: 40 };
/** Avatar ve kart: gözler alanı daha iyi doldurur (tasarım VB_SIKI 80×38). */
export const VB_SIKI: GorunumKutusu = { x: 10, y: 1, w: 80, h: 38 };
/** Kare kutu (avatar, kart, panel): VB_SIKI'nin eni karenin ~%86,6'sı (tasarımda 24 px avatarda 20 px, 120 px kartta 104 px), ortada. */
export const KARE_DOLULUK = 0.866;
const KARE_KENAR = VB_SIKI.w / KARE_DOLULUK;
export const VB_KARE: GorunumKutusu = { x: 50 - KARE_KENAR / 2, y: 20 - KARE_KENAR / 2, w: KARE_KENAR, h: KARE_KENAR };
/** Göz boyu (birim): görünüm kutusu 40 birim, çentikte göz ≈ 16 px. */
export const GOZ_BIRIM = 26;
export const kutuMetni = (v: GorunumKutusu): string => `${yuv(v.x)} ${yuv(v.y)} ${yuv(v.w)} ${yuv(v.h)}`;

/** Kalınlık kademesi: piksel/birim oranından. xs (24 px avatar) dolgun yay ve küçük parıltı gizli; s çentik (1×); m büyük. */
export type GozKademesi = 'xs' | 's' | 'm';
export function gozKademesi(pikselBirim: number): GozKademesi {
  if (pikselBirim < 0.45) return 'xs';
  if (pikselBirim < 0.9) return 's';
  return 'm';
}

// ── Eğriler ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const EGRI_SAKKAD = 'cubic-bezier(0.25, 1.22, 0.45, 1)';
export const EGRI_YUMUSAK = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EGRI_SUZ = 'cubic-bezier(0.45, 0, 0.25, 1)';
export const EGRI_KAPAN = 'cubic-bezier(0.55, 0, 0.9, 0.45)';
export const EGRI_ACIL = 'cubic-bezier(0.15, 0.6, 0.3, 1)';
export const EGRI_YAYLI = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
export const EGRI_IMLEC = 'cubic-bezier(0.2, 0.7, 0.3, 1)';
export const EGRI_DONUS = 'cubic-bezier(0.4, 0, 0.2, 1)';

const EGRI_AD: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
};
/** CSS eğrisinin çözücüsü (kapalı yay saydamlığını kapakla aynı eğriyle örneklemek için). */
export function egriFn(e: string): (x: number) => number {
  const [x1, y1, x2, y2] = EGRI_AD[e] ?? (e.match(/-?[\d.]+/g) ?? ['0', '0', '1', '1']).map(Number);
  const b = (t: number, a1: number, a2: number) => 3 * (1 - t) ** 2 * t * a1 + 3 * (1 - t) * t * t * a2 + t ** 3;
  return (x) => { let lo = 0; let hi = 1; let t = x; for (let i = 0; i < 28; i++) { t = (lo + hi) / 2; if (b(t, x1, x2) < x) lo = t; else hi = t; } return b(t, y1, y2); };
}

// ── Kare dizileri ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Anahtar kare: o konum 0..1, v değer, e bu kareye varan bölümün eğrisi. */
export interface Kare { o: number; v: string; e?: string }
/** Kapak karesi: p kapak konumu, r döndürmenin payı (uyanışta hata kapağı yavaş yavaş döner). */
export interface KapakKaresi { o: number; p: number; e?: string; r?: number }

/** Kapalı yay saydamlığı kapak konumunun işlevidir: kapak yayBas'ı geçince belirir, yaySon'da tamdır (beyazın son ince parçası söndüğü an yay oradadır). */
export const yayOpak = (p: number, a: number = PAMUK.yayBas, b: number = PAMUK.yaySon): number => {
  const x = Math.min(1, Math.max(0, (p - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
/** p0'dan başlayan kapak karelerini örnekler, yay saydamlığı karelerini döndürür. */
export function yayKareleri(p0: number, kareler: readonly KapakKaresi[], n = 120): Kare[] {
  const out: Kare[] = [];
  for (let i = 1; i <= n; i++) {
    const o = i / n; let po = 0; let pp = p0; let p = p0;
    for (const k of kareler) {
      if (o <= k.o) { p = pp + (k.p - pp) * egriFn(k.e ?? 'linear')((o - po) / (k.o - po)); break; }
      po = k.o; pp = k.p; p = k.p;
    }
    out.push({ o, v: yuv(yayOpak(p)) });
  }
  return out;
}

/** Kırpma (260 ms): 75 ms hızlanarak kapanır, 35 ms durur, 150 ms yavaşlayarak açılır. Son kare hâlin kapağına döner. */
export const KIRPMA_SURE = 260;
export const kirpmaKareleri = (hedefP: number): KapakKaresi[] => [{ o: 0.29, p: 1, e: EGRI_KAPAN }, { o: 0.42, p: 1 }, { o: 1, p: hedefP, e: EGRI_ACIL }];
/** Çift kırpmada ikinci kırpmanın gecikmesi. */
export const CIFT_KIRPMA_ARA = KIRPMA_SURE + 90;
/**
 * Mod değişiminin kırpması (12 Kas; 320 ms): 80 ms'de kapanır, 160 ms'ye dek KAPALI durur, 160 ms'de açılır. Biçim kapalı aralığın ortasında (120 ms)
 * takas edilir; uzun kapalı aralık, yeniden takılmanın yükünde canlandırma geç başlasa da (kare kare denetim: ~60 ms gecikme görüldü) takası örter.
 */
export const MOD_KIRPMA_SURE = 320;
export const modKirpmaKareleri = (hedefP: number): KapakKaresi[] => [{ o: 0.25, p: 1, e: EGRI_KAPAN }, { o: 0.5, p: 1 }, { o: 1, p: hedefP, e: EGRI_ACIL }];
/** Çift kırpma olasılığı. */
export const CIFT_KIRPMA_OLASILIGI = 0.16;

/** Uyku: yarıya düşer (1,1 sn), iki yavaş kırpma, sonra yavaşça kapanır (toplam 7,2 sn). */
export const UYKU_SURE = 7200;
export const UYKU_KAPAK: readonly KapakKaresi[] = [
  { o: 0.15, p: 0.45, e: 'cubic-bezier(0.45, 0, 0.35, 1)' },
  { o: 0.23, p: 0.47, e: 'linear' },
  { o: 0.31, p: 1, e: 'cubic-bezier(0.5, 0, 0.75, 0.4)' },
  { o: 0.355, p: 1, e: 'linear' },
  { o: 0.46, p: 0.55, e: 'cubic-bezier(0.2, 0.6, 0.35, 1)' },
  { o: 0.52, p: 0.6, e: 'linear' },
  { o: 0.6, p: 1, e: 'cubic-bezier(0.5, 0, 0.75, 0.4)' },
  { o: 0.665, p: 1, e: 'linear' },
  { o: 0.75, p: 0.72, e: 'cubic-bezier(0.2, 0.6, 0.35, 1)' },
  { o: 0.8, p: 0.73, e: 'linear' },
  { o: 1, p: 1, e: 'cubic-bezier(0.45, 0, 0.4, 1)' },
];
/** Uykuda çift biraz iner (göz birimi). */
export const UYKU_INIS = 1.2;
/** Nefes: kapandıktan 400 ms sonra 6 yavaş nefes (her biri 4,4 sn), sonra tam durgunluk — artık hiçbir şey çizilmez. */
export const NEFES_GECIKME = 400;
export const NEFES_SURE = 4400;
export const NEFES_SAYI = 6;
/** Nefesin genliği (göz birimi): aşağı 0,7, yana %7. Kompozitörde, kök svg'nin dönüşümü olarak çalışır (Gozler.tsx). */
export const NEFES_INIS = 0.7;
export const NEFES_EN = 1.07;
export const NEFES_EGRI = 'cubic-bezier(0.45, 0, 0.55, 1)';
/** Nefeste kökün en uç kayması (göz birimi): ölçek ortadan, dış kenar çiftin yarı eni (32 birim) kadar uzakta. */
const NEFES_UC_BIRIM = Math.max(NEFES_INIS, (NEFES_EN - 1) * 32);
/** Nefes adımında ekranda en çok bu kadar kayma (px): altında adım görünmez. */
export const NEFES_ADIM_PX = 0.2;
/**
 * Nefes kareleri (kök svg; `birimPx` göz biriminin CSS pikseli). Onaylı eğri (NEFES_EGRI, 0,45'te tepe) ADIMLI örneklenir: her karenin eğrisi steps(1),
 * adım sayısı ekrandaki kaymaya göre (adım başına ≤ 0,2 px; 16 px çentik gözünde nefes başına ~14, 120 px kartta ~30 adım). Böylece nefes her ekran
 * tazelemesinde değil, saniyede birkaç kez çizilir (boşta işlemci ve GPU; bosta-islemci) ve alt piksel kayma gözle sürekli görünür.
 */
export function nefesKareleri(birimPx: number): { transform: string; offset: number; easing: string }[] {
  const uc = NEFES_UC_BIRIM * Math.max(0.01, birimPx);
  const n = Math.min(60, Math.max(8, Math.ceil((2 * uc) / NEFES_ADIM_PX)));
  const egri = egriFn(NEFES_EGRI);
  const tepe = 0.45;
  const out: { transform: string; offset: number; easing: string }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k = t <= tepe ? egri(t / tepe) : 1 - egri((t - tepe) / (1 - tepe));
    out.push({ transform: `translate(0px, ${yuv(NEFES_INIS * birimPx * k)}px) scale(${yuv(1 + (NEFES_EN - 1) * k)}, 1)`, offset: Math.round(t * 10000) / 10000, easing: 'steps(1, end)' });
  }
  return out;
}
/** Uyku + nefes: bu süreden sonra uykudaki göz hiçbir şey çizmez (ms). */
export const UYKU_TOPLAM_MS = UYKU_SURE + NEFES_GECIKME + NEFES_SURE * NEFES_SAYI;

/** Uyanış (1,6 sn): yayın sönmesi, yarıya açılma, kısa duraksama, tam açılma ve bir kırpma. */
export const UYANIS_SURE = 1600;
export const uyanisKareleri = (hedefP: number): KapakKaresi[] => [
  { o: 0.22, p: 0.55, r: 0.5, e: 'cubic-bezier(0.3, 0, 0.2, 1)' },
  { o: 0.4, p: 0.5, r: 0.5, e: 'ease-in-out' },
  { o: 0.56, p: hedefP, r: 1, e: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { o: 0.63, p: 1, r: 1, e: EGRI_KAPAN },
  { o: 0.67, p: 1, r: 1 },
  { o: 0.83, p: hedefP, r: 1, e: EGRI_ACIL },
  { o: 1, p: hedefP, r: 1 },
];
/** Az harekette uyku ve uyanış tek kısa geçiştir. */
export const AZ_UYKU_SURE = 420;

/** Zıplama (mutlu, mod değişimi; 480 ms) ve "hayır" sallanması (hata; 560 ms): çiftin dönüşümü. */
export const ZIPLA_SURE = 480;
export const ZIPLA: readonly Kare[] = [
  { o: 0.36, v: 'translate(0px, -2.2px)', e: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }, { o: 0.7, v: 'translate(0px, 0.45px)', e: 'ease-in' }, { o: 1, v: 'translate(0px, 0px)', e: 'ease-out' },
];
export const SALLA_SURE = 560;
export const SALLA: readonly Kare[] = [
  { o: 0.16, v: 'translate(-1.5px, 0px)', e: 'ease-out' }, { o: 0.38, v: 'translate(1.4px, 0px)', e: 'ease-in-out' },
  { o: 0.6, v: 'translate(-0.9px, 0px)', e: 'ease-in-out' }, { o: 0.8, v: 'translate(0.4px, 0px)', e: 'ease-in-out' }, { o: 1, v: 'translate(0px, 0px)', e: 'ease-out' },
];

/** Hâl döngüleri (yalnız etkin hâllerde; boşta, uykuda ve az harekette yok). */
export const DUSUNME_DONGUSU = {
  kareler: [
    { transform: 'translate(0px, 0px) scale(1, 1)' }, { transform: 'translate(-0.8px, 0.3px) scale(1, 1)', offset: 0.33 },
    { transform: 'translate(0.7px, -0.3px) scale(1, 1)', offset: 0.66 }, { transform: 'translate(0px, 0px) scale(1, 1)' },
  ],
  sure: 5200, gecik: 800, egri: 'ease-in-out',
} as const;
export const KONUSMA_DONGUSU = {
  kareler: [
    { transform: 'translate(0px, 0px) scale(1, 1)', easing: 'ease-out' }, { transform: 'translate(0px, -0.8px) scale(1, 1.045)', offset: 0.16, easing: 'ease-in' },
    { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0.34, easing: 'ease-out' }, { transform: 'translate(0px, -0.5px) scale(1, 1.03)', offset: 0.5, easing: 'ease-in' },
    { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0.62, easing: 'ease-out' }, { transform: 'translate(0px, -0.65px) scale(1, 1.04)', offset: 0.8, easing: 'ease-in' },
    { transform: 'translate(0px, 0px) scale(1, 1)' },
  ],
  sure: 1500, gecik: 300, egri: 'linear',
} as const;

/** Hâlin hedefleri (göz başına; s yan). Kapak, yanak, gözün duruşu ve bebeğin ölçeği. */
export interface GozHedefi { p: number; rot: number; q: number; durum: string; bebek: string; kapak: string; yanak: string }
const DURGUN = 'translate(0px, 0px) scale(1, 1)';
export function hedef(dd: string, s: number, sk: GozSekli = SEKILLER.pamuk): GozHedefi {
  const h = { p: 0, rot: 0, q: 0, durum: DURGUN };
  let b = 1;
  if (dd === 'dinliyor') { h.durum = 'translate(0px, -0.6px) scale(1.07, 1.1)'; b = 1.12; }
  // Kapak inmez (sıkılmış görünüyordu); alttan hafif, tek yana ağır "hımm" kısılması.
  if (dd === 'dusunuyor') { h.q = s > 0 ? 0.34 : 0.12; }
  if (dd === 'konusuyor') { h.q = 0.22; }
  if (dd === 'mutlu') { h.q = 1; h.durum = 'translate(0px, -0.8px) scale(1.05, 1.05)'; b = 1.04; }
  if (dd === 'hata') { h.p = 0.3; h.rot = s * 13; h.durum = 'translate(0px, 0.6px) scale(1, 0.97)'; b = 0.92; }
  if (dd === 'uyuyor') { h.p = 1; }
  // Biçimin hâl ayarı (uykuda yok: kapalı göz her biçimde düz ve kapalı).
  const a = dd === 'uyuyor' ? undefined : sk.hal[dd as GozDurumu];
  if (a) {
    if (a.p !== undefined) h.p = a.p;
    if (a.rot !== undefined) h.rot = a.rot * s + 0;
    if (a.q !== undefined) h.q = s > 0 ? a.q : (a.qIc ?? a.q);
  }
  return { ...h, bebek: `scale(${yuv(b * sk.bebekOlcek)})`, kapak: kapakT(h.p, h.rot), yanak: yanakT(h.q) };
}
/** Hâlin bakışı (birim; menzile kenetlenir). Düşünürken yön her girişte değişir (`dusunYon`). */
export function halBakisi(dd: string, dusunYon: number): { x: number; y: number } | null {
  const M = PAMUK.menzil;
  if (dd === 'bosta') return { x: 0, y: 0 };
  if (dd === 'dinliyor') return { x: 0, y: -0.6 };
  if (dd === 'dusunuyor') return { x: dusunYon * M.x * 0.7, y: -M.y * 0.9 };
  if (dd === 'konusuyor') return { x: 0, y: 0.3 };
  if (dd === 'mutlu') return { x: 0, y: -0.8 };
  if (dd === 'hata') return { x: 0, y: M.y * 0.7 };
  if (dd === 'uyuyor') return { x: 0, y: 0.8 };
  return null;
}
/** Bakış (x, y birim) → bebeğin ve gözün dönüşümü. Bebek kayar, göz bakisCarpani payıyla eşlik eder. `yakinsama`: imleç yakınken gözler içe döner. */
export function bakisDonusumu(x: number, y: number, s: number, yakinsama = 0): { bebek: string; bakis: string } {
  const M = PAMUK.menzil;
  const cx = Math.max(-M.x, Math.min(M.x, x));
  const cy = Math.max(-M.y, Math.min(M.y, y));
  const gx = Math.max(-M.x, Math.min(M.x, cx - s * yakinsama));
  const f = PAMUK.bakisCarpani;
  return { bebek: `translate(${yuv(gx)}px, ${yuv(cy)}px)`, bakis: `translate(${yuv(gx * f)}px, ${yuv(cy * f)}px) scale(1, 1)` };
}
/** İmleç (göz çiftinin merkezine göre, birim) → bakış ve yakınsama (tasarım: tanh ile yumuşak kenetlenme). */
export function imlecBakisi(dx: number, dy: number): { x: number; y: number; yakinsama: number } {
  const M = PAMUK.menzil;
  return { x: M.x * Math.tanh(dx / 40), y: M.y * Math.tanh(dy / 14), yakinsama: Math.max(0, 1.4 - Math.hypot(dx, dy) / 30) };
}
