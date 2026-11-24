/**
 * Kokpit sürüklemesinde yer değiştirme kararı (saf işlev; DOM'a dokunmaz).
 *
 * İmleç hedef kartın kutusuna girer girmez yer değiştirilseydi, değişimden sonra imleç çoğu zaman hedef kartın
 * YENİ yerinin üstünde kalır ve küçük bir fare oynaması sırayı geri çevirirdi (titreme). Histerezis: yer değişimi
 * ancak imleç, sürüklenen kartın yuvasından hedefe doğru bakıldığında hedefin MERKEZİNİ `dead` px geçince olur.
 * Geri dönmek için de aynı eşik ters yönde geçilmelidir (o an yuvalar yer değiştirmiş olduğundan yön de dönmüştür);
 * merkezin çevresindeki oynama bu yüzden sırayı değiştirmez.
 */

export interface SwapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Merkezi geçmenin eşiği (px): bu kadar ileri gidilmeden yer değişmez. */
export const SWAP_DEAD_PX = 12;

const center = (rect: SwapRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

const inside = (x: number, y: number, rect: SwapRect) =>
  x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;

/**
 * İmleç (`x`, `y`) `target` kartıyla yer değiştirmeyi hak ediyor mu? `slot`, sürüklenen kartın şu anki yerleşim
 * kutusudur (sürüklenen görüntü değil, ızgaradaki yuvası).
 */
export function shouldSwap(x: number, y: number, slot: SwapRect, target: SwapRect, dead = SWAP_DEAD_PX): boolean {
  if (!inside(x, y, target)) return false;
  const from = center(slot);
  const to = center(target);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // Merkezler çakışıyorsa yön yoktur: kutunun içinde olmak yeter.
  if (length < 1) return true;
  // İmlecin hedef merkezinden, yuvadan hedefe giden yön boyunca ne kadar ileride olduğu.
  const beyond = ((x - to.x) * dx + (y - to.y) * dy) / length;
  // Eşik kartın yarı boyunu aşmasın: küçük kartta da merkezin ötesinde ulaşılabilir bir bölge kalsın.
  const half = Math.abs(dx) >= Math.abs(dy) ? target.width / 2 : target.height / 2;
  return beyond >= Math.min(dead, half / 2);
}
