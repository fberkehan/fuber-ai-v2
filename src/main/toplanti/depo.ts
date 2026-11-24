// ── Geçmiş toplantılar: bu bilgisayardaki depo (12 Kas 2026; Electron'suz, kök parametreyle — tests/toplanti.test.ts) ─────────────────────────────
// Her toplantı veri kökünün `toplantilar/` klasöründe tek JSON dosyasıdır (<kimlik>.json; kimlik shared/toplanti.ts TOPLANTI_KIMLIGI deseninde — yol
// gezintisi yok). Yazım atomik (geçici dosya + yeniden adlandırma). Hiçbir şey kendiliğinden yüklenmez; silme kullanıcının "Sil"iyle (Geri al'lı
// silme kuyruğundan: main/silme-kuyrugu.ts 'toplanti'). "Verilerimi sil" kökü bütünüyle siler; "Yeni başla" klasörü yedeğe taşır
// (main/veri/temizlik.ts EK_KISISEL 'toplantilar').
import fs from 'node:fs';
import path from 'node:path';
import { TOPLANTI_KIMLIGI, kayitBasligi, type ToplantiKaydi, type ToplantiListeOgesi } from '../../shared/toplanti.ts';
import { baglamBosMu, baglamTemizle } from '../../shared/toplanti-baglam.ts';

export const TOPLANTI_KLASORU = 'toplantilar';
/** Listede en çok bu kadar toplantı (en yeni önce). */
const LISTE_SINIRI = 200;

export function toplantiDeposu(kok: string) {
  const klasor = path.join(kok, TOPLANTI_KLASORU);
  const dosya = (id: string): string | null => (TOPLANTI_KIMLIGI.test(id) ? path.join(klasor, `${id}.json`) : null);
  const oku = (p: string): ToplantiKaydi | null => {
    try {
      const k = JSON.parse(fs.readFileSync(p, 'utf8')) as ToplantiKaydi;
      if (!(k && k.surum === 1 && TOPLANTI_KIMLIGI.test(k.id) && Array.isArray(k.satirlar))) return null;
      // Bağlam dosyadan da sınırlara indirilir (elle bozulmuş kayıt arayüze taşmasın).
      if (k.baglam) { const b = baglamTemizle(k.baglam); if (baglamBosMu(b)) delete k.baglam; else k.baglam = b; }
      return k;
    } catch { return null; }
  };
  return {
    klasor,
    kaydet(k: ToplantiKaydi): void {
      const p = dosya(k.id);
      if (!p) throw new Error('Geçersiz toplantı kimliği.');
      fs.mkdirSync(klasor, { recursive: true });
      const gecici = `${p}.${process.pid}.tmp`;
      fs.writeFileSync(gecici, JSON.stringify(k));
      fs.renameSync(gecici, p);
    },
    al(id: string): ToplantiKaydi | null {
      const p = dosya(id);
      return p && fs.existsSync(p) ? oku(p) : null;
    },
    liste(): ToplantiListeOgesi[] {
      let adlar: string[] = [];
      try { adlar = fs.readdirSync(klasor).filter((a) => a.endsWith('.json')); } catch { return []; }
      const l: ToplantiListeOgesi[] = [];
      for (const a of adlar.sort().reverse().slice(0, LISTE_SINIRI)) {
        const k = oku(path.join(klasor, a));
        if (!k) continue;
        l.push({ id: k.id, baslangic: k.baslangic, sureMs: k.sureMs, satirSayisi: k.satirlar.length, baslik: kayitBasligi(k), gizli: k.gizli === true, ozetVar: Boolean(k.ozet) });
      }
      return l.sort((x, y) => y.baslangic.localeCompare(x.baslangic));
    },
    sil(id: string): boolean {
      const p = dosya(id);
      if (!p || !fs.existsSync(p)) return false;
      fs.unlinkSync(p);
      return true;
    },
  };
}
export type ToplantiDeposu = ReturnType<typeof toplantiDeposu>;
