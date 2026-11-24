// ── Gün kaydının bugünkü sayaçları, insan diliyle (11 Kas tasarımcı analizi, bulgu 7; saf — tests/ic-kimlik-sizintisi.test.ts) ────────────
// Eskiden "0 satır · 0 not (0 önemli) · 0 araya girme": döküm satırı sayısı teknik ayrıntıdır, sıfırlar gürültüdür. Artık yalnız anlamlı sayılar.

export interface GunKaydiBugun { satir: number; madde: number; onemli: number; eslik: number }

export function gunKaydiSayaclari(b: GunKaydiBugun): string {
  const parcalar: string[] = [];
  if (b.madde > 0) parcalar.push(`${b.madde} not${b.onemli > 0 ? ` (${b.onemli} önemli)` : ''}`);
  if (b.eslik > 0) parcalar.push(`${b.eslik} kez araya girdi`);
  return parcalar.length ? `Bugün ${parcalar.join(' · ')}` : 'Bugün henüz not yok.';
}
