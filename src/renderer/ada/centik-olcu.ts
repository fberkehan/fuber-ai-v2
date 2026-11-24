// ── Çentik biçiminin ölçüleri (0.14 T19, R15; saf: tests/centik-hareket-kurali.test.ts) ──────────────────────────────
// Dokuz dilim biçimin (CentikSekli.tsx) sabitleri, köşe kuralı ve yarım parçaların hesabı. JSX'siz ayrı dosya: test React yüklemeden okur.
//   · Omuz: çentik üst kenarla kaynaşır; iki yanda 12 px'lik ters köşe (ekranın kenarından şekle yumuşak geçiş).
//   · Alt köşe: haplarda (sabit boylu hâller) boyun yarısı — tam hap; içerik boyundaki hâllerde (kart, yanıt, onay) ve açık panelde 28 px. Panelin boyu sabittir
//     (188) ama hap değildir: köşe kuralı hâle bağlıdır (`centikKosesi`; T28 düzeltme turu 1 — çağrı yeri boy/2 = 94 px veriyordu, plan 28 px).
//   · Ayna (T28 düzeltme turu 1): parçalar yalnız SOL yarı için hesaplanır (`yariParcalari`); sağ yarı aynı parçaların durağan `scaleX(-1)` aynasıdır. Her dış
//     kenar tek bir öteleme değerinden geçer (eskiden sağ kenar `öteleme + taban × ölçek` toplamıydı ve yuvarlama/örnekleme hatası ölçekle büyüyüp 2–3 aygıt
//     pikseli basamak yapıyordu). İki yarı ortada (x = 0) yarım px'le örtüşür: düz dolgu, dikiş görünmez.

export const OMUZ_PX = 12;
export const PANEL_KOSE_PX = 28;
/** Gövde parçalarının taban karesi ve köşe parçasının taban yarıçapı (CSS px; ada.css `.ada-bicim__govde`, `.ada-bicim__kose` ile aynı). */
export const GOVDE_TABAN = 100;
export const KOSE_TABAN = 64;

/** Alt köşe yarıçapı: `icerikli` değilse boy/2, içerikliyse 28 px; hiçbir zaman boyun yarısını aşmaz (kısa içerikte köşeler çakışmasın). */
export function koseYaricapi(boy: number, icerikli: boolean): number {
  const yarim = Math.max(0, boy) / 2;
  return icerikli ? Math.min(PANEL_KOSE_PX, yarim) : yarim;
}

/** Çağrı yerinin kuralı (Ada.tsx): içerikli hâller ve açık panel 28 px, öbür sabit boylu hâller hap. */
export function centikKosesi(hal: string, boy: number, icerikli: boolean): number {
  return koseYaricapi(boy, icerikli || hal === 'panel');
}

export interface YariParca {
  ad: 'ust' | 'alt' | 'kose' | 'omuz';
  /** Parçanın sol kenarı (ötelemesi, CSS px; şeklin ortası 0) ve üst kenarı. */
  x: number;
  y: number;
  sx: number;
  sy: number;
}

/**
 * Sol yarının parçaları (translate + scale). Sağ yarı bunların aynasıdır. `en`, `boy`: şeklin ölçüsü; `kose`: alt köşe yarıçapı; `omuz`: omuzlar görünür mü.
 * Gövde yarıları ortaya yarım px taşar (iki yarı orada örtüşür); üst gövde alt gövdeye 1 px biner (yatay dikiş görünmesin).
 */
export function yariParcalari(en: number, boy: number, kose: number, omuz: boolean): YariParca[] {
  const r = Math.max(0, Math.min(kose, boy, en / 2));
  const yari = en / 2;
  const govdeBoy = Math.max(0, boy - r);
  const ort = boy > 0 ? 1 : 0; // örtüşme yalnız şekil varken (toplanmış şekilde çizgi kalmasın)
  const o = omuz && boy > 0 ? 1 : 0;
  const orta = ort / 2;
  return [
    { ad: 'ust', x: -yari, y: 0, sx: (yari + orta) / GOVDE_TABAN, sy: Math.min(boy, govdeBoy + ort) / GOVDE_TABAN },
    // Alt gövde köşeye de yarım px biner (köşe ile gövde arasındaki iç dikiş görünmesin).
    { ad: 'alt', x: -yari + r - orta, y: govdeBoy, sx: Math.max(0, yari - r + 2 * orta) / GOVDE_TABAN, sy: r / GOVDE_TABAN },
    { ad: 'kose', x: -yari, y: govdeBoy, sx: r / KOSE_TABAN, sy: r / KOSE_TABAN },
    { ad: 'omuz', x: -yari - OMUZ_PX * o, y: 0, sx: o, sy: o },
  ];
}
