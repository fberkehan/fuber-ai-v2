// ── Ayar/sır JSON dosyaları: atomik yazım + .bak yedeği (saf modül: Electron'suz, testlerde doğrudan çalışır) ──
// Eskiden writeFileSync doğrudan asıl dosyaya yazıyordu: yazım yarıda kalırsa (çökme, disk dolu, elektrik) dosya
// bozuluyor, okuma da sessizce varsayılana dönüp bir sonraki kayıtta bütün ayarları/sırları siliyordu.
// Şimdi: geçici dosyaya yaz → asıl dosya SAĞLAMSA .bak'a kopyala → geçiciyi asılın yerine taşı (rename).
import fs from 'node:fs';

export type JsonOkuma = { veri: Record<string, unknown>; yedektenMi: boolean } | 'yok' | 'bozuk';

function tekDosya(dosya: string): { veri: Record<string, unknown> } | 'yok' | 'bozuk' {
  let ham: string;
  try { ham = fs.readFileSync(dosya, 'utf8'); } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'yok' : 'bozuk'; }
  try {
    const v: unknown = JSON.parse(ham);
    return v && typeof v === 'object' && !Array.isArray(v) ? { veri: v as Record<string, unknown> } : 'bozuk';
  } catch { return 'bozuk'; }
}

/** Asıl dosya; okunamazsa `.bak`. 'yok' = hiç yok (ilk açılış); 'bozuk' = dosya var ama ne kendisi ne yedeği okunuyor. */
export function jsonOku(dosya: string): JsonOkuma {
  const asil = tekDosya(dosya);
  if (typeof asil === 'object') return { ...asil, yedektenMi: false };
  const yedek = tekDosya(`${dosya}.bak`);
  if (typeof yedek === 'object') return { ...yedek, yedektenMi: true };
  return asil;
}

/** Atomik yazım. Asıl dosya okunabiliyorsa önce `.bak` olur (bozuk asıl, sağlam yedeği EZMEZ). */
export function jsonYaz(dosya: string, veri: unknown, girinti?: number): void {
  const gecici = `${dosya}.yaziliyor`;
  fs.writeFileSync(gecici, JSON.stringify(veri, null, girinti), 'utf8');
  if (typeof tekDosya(dosya) === 'object') { try { fs.copyFileSync(dosya, `${dosya}.bak`); } catch { /* yedek en iyi çaba */ } }
  try {
    fs.renameSync(gecici, dosya);
  } catch {
    // Windows'ta hedef başka süreçte (virüs tarayıcı) açıksa rename EPERM verebilir: kopyala + geçiciyi sil.
    fs.copyFileSync(gecici, dosya);
    try { fs.unlinkSync(gecici); } catch { /* kalsın */ }
  }
}
