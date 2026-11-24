// ── Öğretilemeyen dosyaların tostu (saf) ─────────────────────────────────────────────────────────────────────────────────
// Görev 20b (G19): klasöre on dosya birden bırakılınca on ayrı hata tostu üst üste biniyordu. Kısa aralıkta gelen redler tek tostta
// toplanır: "N dosya öğretilemedi: a, b, c ve 2 dosya daha." Hepsinin nedeni aynıysa neden bir kez yazılır; hepsi tür reddiyse
// desteklenen türler bir kez yazılır. Tek dosyada eski ileti aynen kalır.

export interface Reddedilen { dosya: string; mesaj: string }

const buyukBasla = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);

export function reddedilenMetni(liste: readonly Reddedilen[]): string {
  if (!liste.length) return '';
  if (liste.length === 1) return `${liste[0].dosya} okunamadı: ${liste[0].mesaj}`;
  const adlar = liste.slice(0, 3).map((x) => x.dosya).join(', ');
  const kalan = liste.length - 3;
  const bas = `${liste.length} dosya öğretilemedi: ${adlar}${kalan > 0 ? ` ve ${kalan} dosya daha` : ''}.`;
  const nedenler = new Set(liste.map((x) => x.mesaj));
  if (nedenler.size === 1) return `${bas} ${buyukBasla(liste[0].mesaj)}`;
  const destek = liste.map((x) => x.mesaj.indexOf('Desteklenenler:'));
  if (destek.every((i) => i >= 0)) return `${bas} ${liste[0].mesaj.slice(destek[0])}`;
  return bas;
}
