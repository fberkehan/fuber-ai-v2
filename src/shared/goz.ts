// ── Gözler: hâl sözleşmesi (11 Kas, "Pamuk"; saf; tests/goz-hareket.test.ts) ──────────────────────────────────────────────────────────────
// Hayvan karakterler yerine yalnız gözler kullanılır (goz-tasarimi-2, öneri "Pamuk"). Bu dosya yalnız KARAR verir: ürünün hâli (KarakterHali gibi
// çağıran yüzeylerden gelen `hal`) ya da durağan ifade → gözün durumu. Çizim ve hareket renderer/ui/goz'dadır (Gozler.tsx, beyin.ts).
//   · R13: girdisiz 60 sn → uyku (yalnız 'sakin' hâlde); R14: imleç yalnız pencere kutusunda, alan dışında gözler 600 ms'de ortaya döner.
//   · R16: az hareket (ayar ya da sistem) → yalnız kırpma ve kısa hâl geçişleri.

/** Yüzeylerin verdiği hâl (çentik, panel, sohbet…). `calisiyor` düşünüyor gibi, `onay` dinliyor gibi, `sevinc` mutlu görünür. */
export type GozHali = 'sakin' | 'dinliyor' | 'dusunuyor' | 'konusuyor' | 'calisiyor' | 'onay' | 'hata' | 'sevinc';
/** Durağan ifade (hareketsiz önizlemeler, sohbet avatarı, onay kartı). */
export type GozIfadesi = 'sakin' | 'dinliyor' | 'dusunuyor' | 'konusuyor' | 'hata' | 'sevinc' | 'uyuyor';
/** Gözün çizdiği durum (tasarımın adları). */
export type GozDurumu = 'bosta' | 'dinliyor' | 'dusunuyor' | 'konusuyor' | 'mutlu' | 'hata' | 'uyuyor';
/** Dışarıdan tek atımlık jest: `kirp` çift kırpma, `selam` kısa gülümseme + zıplama (tıklama, kart üzerine gelme), `mod` zıplayıp kırpma (mod değişimi). */
export type GozTetigi = 'kirp' | 'selam' | 'mod';

export const GOZ_HALLERI: readonly GozHali[] = ['sakin', 'dinliyor', 'dusunuyor', 'konusuyor', 'calisiyor', 'onay', 'hata', 'sevinc'];
export const GOZ_IFADELERI: readonly GozIfadesi[] = ['sakin', 'dinliyor', 'dusunuyor', 'konusuyor', 'hata', 'sevinc', 'uyuyor'];
export const GOZ_DURUMLARI: readonly GozDurumu[] = ['bosta', 'dinliyor', 'dusunuyor', 'konusuyor', 'mutlu', 'hata', 'uyuyor'];
export const GOZ_TETIKLERI: readonly GozTetigi[] = ['kirp', 'selam', 'mod'];

/** Girdisiz kalınca uyku (R13). */
export const UYKU_MS = 60_000;
/** İmlecin etkisi: göz merkezinden bu uzaklığa (CSS px) kadar (R14). */
export const ALAN_PX = 200;
/** İmleç kutudan çıkınca gözlerin ortaya dönüş süresi (R14). */
export const GOZ_DONUS_MS = 600;
/** İmleç okuma aralığı (ms): fare olayları kareye kısılır. */
export const IMLEC_ARALIK_MS = 32;
/** Tıklamadan sonraki "nasıl yardımcı olabilirim" (dinliyor) hâlinin son girdiden sonraki ömrü (ms; Asistan sayfası). */
export const TIK_DINLEME_MS = 10_000;
/** Mod değişiminde parıltının çapraz solması (ms). */
export const MOD_PARILTI_MS = 280;

const HAL_DURUM: Record<GozHali, GozDurumu> = {
  sakin: 'bosta', dinliyor: 'dinliyor', dusunuyor: 'dusunuyor', konusuyor: 'konusuyor', calisiyor: 'dusunuyor', onay: 'dinliyor', hata: 'hata', sevinc: 'mutlu',
};
const IFADE_DURUM: Record<GozIfadesi, GozDurumu> = {
  sakin: 'bosta', dinliyor: 'dinliyor', dusunuyor: 'dusunuyor', konusuyor: 'konusuyor', hata: 'hata', sevinc: 'mutlu', uyuyor: 'uyuyor',
};

/** Gözün durumu: ifade verilirse o (durağan), yoksa hâl; ikisi de yoksa boşta. */
export function gozDurumu(hal?: GozHali, ifade?: GozIfadesi): GozDurumu {
  if (ifade) return IFADE_DURUM[ifade] ?? 'bosta';
  if (hal) return HAL_DURUM[hal] ?? 'bosta';
  return 'bosta';
}

/** Bu hâlde uyku saati işler mi (yalnız sakin; çalışırken, dinlerken uyumaz). */
export const uyuyabilirMi = (hal: GozHali | undefined): boolean => hal === undefined || hal === 'sakin';
