// ── Toplantı tercihi: kalıcı model / yazıya çevirme seçimi (13 Kas 2026, 0.17.3; Electron'suz, kök parametreyle — tests/toplanti.test.ts) ─────────────
// Veri kökünde tek küçük JSON (toplanti-tercih.json): { yz, yazi }. Yazım atomik; okuma bellekte tutulur (her istek seçimi o an okur, ama diske gitmez).
// "Verilerimi sil" kökü bütünüyle siler (tercih de gider). Bozuk/eksik dosya → varsayılan; hiçbir şey ağa gitmez.
import fs from 'node:fs';
import path from 'node:path';
import { VARSAYILAN_TERCIH, tercihTemizle, type ToplantiTercihi } from '../../shared/toplanti-model.ts';

export const TERCIH_DOSYASI = 'toplanti-tercih.json';

export function tercihDeposu(kok: () => string) {
  let bellek: ToplantiTercihi | null = null;
  let bellekKok = '';
  const dosya = () => path.join(kok(), TERCIH_DOSYASI);
  const oku = (): ToplantiTercihi => {
    const k = kok();
    if (bellek && bellekKok === k) return bellek;
    let t: ToplantiTercihi = { ...VARSAYILAN_TERCIH };
    try { t = tercihTemizle(JSON.parse(fs.readFileSync(dosya(), 'utf8'))); } catch { /* yok ya da bozuk: varsayılan */ }
    bellek = t; bellekKok = k;
    return t;
  };
  return {
    oku,
    /** Verilen alanlar geçerliyse yazılır (geçersiz alan eskisini korur). Yeni tercihi döndürür. */
    yaz(ham: unknown): ToplantiTercihi {
      const yeni = tercihTemizle(ham, oku());
      bellek = yeni; bellekKok = kok();
      try {
        fs.mkdirSync(kok(), { recursive: true });
        const gecici = `${dosya()}.${process.pid}.tmp`;
        fs.writeFileSync(gecici, JSON.stringify(yeni));
        fs.renameSync(gecici, dosya());
      } catch { /* disk yazılamadı: seçim bu oturumda bellekte geçerli kalır */ }
      return yeni;
    },
  };
}
