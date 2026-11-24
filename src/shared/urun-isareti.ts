// Fuber AI ürün işaretleri.
//
// 1) MINI LOGO (0.12; Fuber AI'nin işareti): resources/ikon/kaynak/fuber-ai-mini.svg (beyaz dolgu,
//    126,54 × 158,6, iki yol; yollar BİREBİR kopya, elle değiştirme — tests/pencere.test.ts kaynak dosyayla eşitliği denetler). Bu logo
//    yalnız bu uygulama içindir: ters B'li logonun mini hâli — küçük ikonlar ve sol kenar çubuğundakiler
//    için. Uygulama ikonu ailesi aynı dosyadan üretilir (scripts/ikon-uret.mjs). Arayüzde: renderer/ui/fintech/Isaret.tsx MiniLogo
//    (kurulum, rayın logosu, avatarlar, ada…). Ters B'li FUƎER yazısı ayrıdır ve büyük yerlerde sürer (logo.ts).
// 2) "F + iki nokta" (Görev 22, K13; markanın özgün sohbet.svg dosyası): 0.12'den beri YALNIZ Fuber Yönetim'in işareti (yonetim/
//    FuberIsareti'ni kullanır; ikonu scripts/yonetim-ikon-uret.py → scripts/ikon-uret.py kütüphanesi). Fuber AI'de kullanılmaz.
export const MINI_VB = '0 0 126.54 158.6';
export const MINI_EN = 126.54;
export const MINI_BOY = 158.6;
export const MINI_YOLLAR: readonly string[] = [
  'M96.17,29.91c12.94-.19,22.39-11.21,23.41-23.67l-84.92.14c-13.94.02-27.62,11.76-27.79,25.62l-.57,47.02-.37,10.13c-.14,3.91-.86,7.45-5.64,8.26l.07-68.37C3.72,13.53,15.74,2.16,31.6,0l94.81.05c1.6,18.74-11.99,36.53-30.98,36.68l-41.8.32c-10.35,2.66-16.5,11.4-15.84,22.22.22,3.67-2.72,7.33-6.23,9.3l-.02-12.64c-.02-13.15,10.74-25.22,24.34-25.42l40.28-.6Z',
  'M31.23,141.51l.23-35.41c1.22-1.25,3.7-1.87,6.16-1.69v35.67c0,10.95-8.7,18.37-18.58,18.52S.38,150.86,0,140.15c.11-5.93-.23-12.19.63-17.93,2.41-16.05,15.26-27.05,30.64-30.17,1.27-15.76,12.44-29.11,28.32-30.7,6.24-.63,12.66-.23,19.06-.33,9.46,1.44,15.98,9.43,16.04,18.73.05,8.67-7.63,17.95-17.41,18.07l-42.75.55c-15.02.19-26.69,12.57-28.34,27.13-.61,5.39-.59,10.97,0,16.14.74,6.38,6.36,10.67,12.13,10.96,5.2.27,12.86-4.25,12.9-11.08ZM79.12,90.93c4.13-.06,8.06-5.47,8.58-8.68,1.16-7.14-2.47-14.38-10.44-14.82-4.89-.27-10.42-.41-15.43.05-12.93,1.18-23.49,11.08-24.12,24.06l7.07-.11,34.34-.51Z',
];
/** Kaynağın çizgi kalınlığı (viewBox birimi; üst kol ve gövde ~6,2–6,8). */
export const MINI_CIZGI = 6.3;
/** Kaynağın EN DAR iç boşluğu (viewBox birimi): ilmeğin üst ucuyla kase arasındaki çentik. Yüksek çözünürlükte genişletme ölçüsü
 *  (scripts/ikon-uret.mjs kapaliBolgeSayisi): 6,3 birimde kapanır ve yeni bir kapalı cep doğar; sonraki boşluklar ≈10,3 · 26 · 28. */
export const MINI_EN_DAR_BOSLUK = 6.3;
/** Kalınlaştırmadan sonra en dar boşluğun en az kalacağı genişlik (CSS pikseli). */
const KALAN_BOSLUK_PX = 0.2;
/**
 * Küçük boyda optik kalınlaştırma: logo `olcu` CSS pikseli yükseklikte çizilince eklenecek kontur genişliği (viewBox birimi; konturun
 * yarısı her yana taşar). Kaynağın çizgisi yüksekliğin %4'ü — 16 px'te 0,64 px (soluk bir leke); hedef toplam ~1,2 px. AMA kalınlaştırma
 * hiçbir iç boşluğu kapatmaz: en dar boşluk (MINI_EN_DAR_BOSLUK) en az 0,2 px açık kalır (inceleme Minor-3: 12–14 px avatarlarda boşluklar
 * kapanıp ilmek leke oluyordu). Bu yüzden 12–14 px'te kalınlaştırma azalır (toplam ~0,75–0,9 px), 20–24 px'te hedef 1,2 px'e ulaşılır.
 * 24 px'ten büyükte söner, 40 px ve üstünde kaynağın kendi kalınlığı (0). Uygulama ikonunun küçük boyları üreticide ayrıca ayarlanır
 * (scripts/ikon-uret.mjs KUCUK_KARO).
 */
export function miniKalinlik(olcu: number): number {
  if (!(olcu > 0) || olcu >= 40) return 0;
  const pxBirim = olcu / MINI_BOY;
  const dogal = MINI_CIZGI * pxBirim;
  const bosluk = MINI_EN_DAR_BOSLUK * pxBirim;
  const ek = Math.max(0, Math.min(1.2 - dogal, bosluk - KALAN_BOSLUK_PX)) * Math.min(1, (40 - olcu) / 16);
  return Math.floor((ek / pxBirim) * 100) / 100;
}

// ── "F + iki nokta" (yalnız Fuber Yönetim) ──
export const URUN_VB = '0 0 101.07 123.41';
export const URUN_YOLLAR: readonly string[] = [
  'M30.26,36.54l-.07,86.87-30.19-.07V29.77C1.71,13.44,14.07,1.37,30.34,0h70.73s-.02,31.43-.02,31.43H35.75c-2.19.66-4.94,2.61-5.49,5.11Z',
  'M76.5,49.79c5.52-2.1,10.94.78,12.99,5.86,1.95,4.83-.79,11.03-5.85,12.81-5.11,1.79-10.43-.32-12.62-5.45s-.31-11.02,5.48-13.22Z',
  'M57.58,66.66c-4.53,4.25-11.56,2.78-14.68-1.97-3.26-4.94-1.8-11.53,3.72-14.46,4.4-2.34,9.73-.82,12.5,3.11,2.78,3.94,2.63,9.41-1.53,13.31Z',
];
/** Her yolun kendi gümüş geçişi (kaynakta userSpaceOnUse; x1, y1, x2, y2): F gövdesi, sağ nokta, sol nokta — #b9bdcd → #dfe4ee. */
export const URUN_GECISLER: readonly (readonly [number, number, number, number])[] = [
  [-6.24, 191.16, 61.09, -1.01],
  [29.43, 203.67, 96.77, 11.49],
  [3.6, 194.61, 70.94, 2.44],
];
