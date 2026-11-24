// ── Gizli bölüm sütunları (Görev 21 düzeltme 1-2; Electron'dan bağımsız, birim testli: tests/gizli-sema.test.ts) ──────────────────
// Gizli mod açıkken oluşan kayıtlar (sohbet mesajları ve gün kaydı: döküm satırları, not maddeleri, meseleler, raporlar, eşlikler)
// `gizli = 1` ile işaretlenir ve hiçbir bulut işine girmez. Sütun PRAGMA table_info ile denetlenerek eklenir: tekrar çalışması zararsız;
// başka bir dal aynı numaralı göçü başka işe kullansa da vt.ts her açılışta bunu çağırır — şema eksik kalmaz.
import type { DatabaseSync } from 'node:sqlite';

// `gorevler` (0.11 G4): satır Gizli'de OLUŞMAZ (Gizli turda araç yok) — `gizli = 1` "tamamlanma anında Gizli açıktı" demektir; gün dönümünde
// o madde "Tamamlananlar" hafıza kaydına girmez (planlama.ts gunDonumu).
export const GIZLI_TABLOLAR = ['mesajlar', 'dokum', 'not_maddeleri', 'meseleler', 'raporlar', 'eslikler', 'gorevler'] as const;

/** Eksik `gizli` sütunlarını ekler; eklenen tabloları döndürür. Tablo yoksa atlanır. */
export function gizliSutunlari(v: DatabaseSync): string[] {
  const eklenen: string[] = [];
  for (const t of GIZLI_TABLOLAR) {
    const sutunlar = v.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!sutunlar.length || sutunlar.some((s) => s.name === 'gizli')) continue;
    v.exec(`ALTER TABLE ${t} ADD COLUMN gizli INTEGER NOT NULL DEFAULT 0;`);
    eklenen.push(t);
  }
  return eklenen;
}
