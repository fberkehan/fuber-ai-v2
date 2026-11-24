// ── Bekçi ajan: saklama sürelerini uygular ───────────────────────────────────────────────────────────────────────
// Ham döküm: notlandırıldıktan sonra `saklama.ham` gün. Not maddeleri: kendi silinme tarihleri (önemsiz 3, önemli 7).
// Rapor kalemleri: günlük → önemsiz/önemli gün sayıları; haftalık → önemsiz 7, önemli 30 gün. Aylık raporlar kalıcı.
// Boşalmış eski günlük/haftalık raporlar da silinir (haftalık/aylık raporlar özlerini taşımıştır).
import { ayarlar } from '../ayarlar.js';
import { veritabani } from '../vt.js';
import { suresiDolanMaddeleriSil, eskiDokumuSil, raporKalemleriniBuda } from './depo.js';
import { gunAnahtari, gunEkle } from './donem.js';

export function bekciCalis(): { madde: number; dokum: number; kalem: number; rapor: number } {
  const s = ayarlar().gunKaydi.saklama;
  const bugun = gunAnahtari(new Date());
  const madde = suresiDolanMaddeleriSil();
  const dokum = eskiDokumuSil(gunEkle(bugun, -Math.max(1, s.ham)));
  const kalem = raporKalemleriniBuda();
  const vt = veritabani();
  let rapor = 0;
  for (const r of vt.prepare("SELECT id, tur, donem, yapi FROM raporlar WHERE tur IN ('gunluk', 'haftalik')").all() as { id: number; tur: string; donem: string; yapi: string }[]) {
    const y = JSON.parse(r.yapi || '{}');
    const bos = !(y.onemli?.length) && !(y.onemsiz?.length);
    const eski = r.tur === 'gunluk' ? r.donem < gunEkle(bugun, -Math.max(s.onemli, 7) - 7) : false;
    if (bos || eski) {
      vt.prepare('DELETE FROM rapor_ara WHERE rowid = ?').run(r.id);
      vt.prepare('DELETE FROM raporlar WHERE id = ?').run(r.id);
      rapor++;
    }
  }
  return { madde, dokum, kalem, rapor };
}
