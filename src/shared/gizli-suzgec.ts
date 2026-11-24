// ── Bulut işine giden veriden Gizli mod kayıtlarını çıkarma (Görev 21 düzeltme turu 2; saf, birim testli: tests/gizli-suzgec.test.ts) ──
// Kokpit planlayıcısı (kokpit/duzen.ts) bulut yolunda gün kaydının "bugünün önemlileri", "son rapor" ve "açık meseleler"ini kullanır;
// Gizli modda oluşanlar bunlara girmez. Arayüz (yerel) hepsini göstermeye devam eder.
import type { KokpitVerisi, RaporTuru } from './tipler.ts';

/** Bulut yolunda "Şimdi hazırla": dönemin raporu Gizli modda yerelde yazılmış — üstüne yazılmaz (düzeltme turu 3); kullanıcı tek satırla
 *  nerede hazırlandığını öğrenir (düzeltme turu 4; iki modda aynı sade metin, model/sağlayıcı adı yok). */
export function gizliRaporNotu(tur: RaporTuru): string {
  return `${tur === 'gunluk' ? 'Bu günün' : tur === 'haftalik' ? 'Bu haftanın' : 'Bu ayın'} raporu Gizli modda yerel olarak hazırlandı.`;
}

export function kokpitGizlisiz(v: KokpitVerisi): KokpitVerisi {
  const d = v.dusunme;
  return { ...v, dusunme: { ...d, bugunOnemli: d.bugunOnemli.filter((m) => !m.gizli), sonRapor: d.sonRapor?.gizli ? undefined : d.sonRapor, meseleler: d.meseleler.filter((m) => !m.gizli) } };
}
