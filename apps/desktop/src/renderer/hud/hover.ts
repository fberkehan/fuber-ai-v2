// Adanın imleç mantığı (saf): imleç gövdenin ÜSTÜNDE mi, ada o an hızlı denetimleri açabilir mi.
//
// Kural (proje kararı): ada imleç gelince KAYBOLMAZ. Üstüne gelince yerinde kalır, hafifçe genişler ve hızlı
// denetimleri gösterir; tıklamayı yalnız BİÇİMİN DIŞI alttaki uygulamaya geçirir (pencere, gövdeden biraz büyüktür:
// omuz ve gölge payı). Konum iki kaynaktan gelir: ana sürecin imleç yoklaması (`hud.pointer`; pencere tıklamayı
// geçirirken de çalışır) ve sayfanın kendi `pointermove` olayı.

/** Gövdenin hedef ölçüsü (omuzlar dahil genişlik), CSS px. Boşken 0 × 0. */
export interface ShapeSize {
  width: number;
  height: number;
}

/** İmleç: `x` gövdenin yatay MERKEZİNE, `y` ekranın üst kenarına göre (CSS px). */
export interface IslandPoint {
  x: number;
  y: number;
}

/** Gövde kenarında küçük pay: kenara sürtünen imleç titreşim yaratmasın. */
export const HOVER_SLACK = 4;
/** İmleç ayrıldıktan sonra denetimlerin açık kaldığı süre (kısa kaçışlarda kapanıp açılmasın). */
export const HOVER_LINGER_MS = 220;

/** İmleç gövdenin (biçimin) içinde mi. Gövde üst kenara kaynaklıdır: üstte pay yoktur, ekranın üstü sınırdır. */
export function insideShape(point: IslandPoint | null, shape: ShapeSize, slack = HOVER_SLACK): boolean {
  if (!point || shape.height <= 0 || shape.width <= 0) return false;
  return Math.abs(point.x) <= shape.width / 2 + slack && point.y >= -1 && point.y <= shape.height + slack;
}

/**
 * Pencere tıklamayı alttaki uygulamaya geçirsin mi: imleç biçimin dışındayken evet. Konum hiç bilinmiyorsa da EVET:
 * ada penceresi (sahne) gövdeden büyük ve saydamdır; imlecin gövdenin üstünde olduğu bilinmeden tıklamayı tutarsa
 * ekranın üst ortasında görünmez bir engel olur. Konum iki bağımsız kaynaktan gelir (ana sürecin yoklaması ve
 * pencereye iletilen fare hareketi), biri susarsa öteki sürdürür.
 */
export function shouldPassThrough(point: IslandPoint | null, shape: ShapeSize): boolean {
  if (!point) return true;
  return !insideShape(point, shape);
}

/** Sayfanın kendi fare olayından ada koordinatına: pencere gövdeyi yatayda ortalar, üst kenarı ekranın üstüdür. */
export function pointFromClient(clientX: number, clientY: number, viewportWidth: number): IslandPoint {
  return { x: clientX - viewportWidth / 2, y: clientY };
}
