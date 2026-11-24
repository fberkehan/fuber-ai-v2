// ── Kullanım özeti (`kullanim:ozet`: Ayarlar → Kullanım, Hesap ve kullanım'ın kullanım çubuğu) ─────────────────────────────────────────
// Kayıtlar (sağlayıcı, model, amaç) gruplanır; maliyet saf derleyicide (shared/kullanim-ozeti.ts) token sayılarından model bilgisinin
// fiyatıyla hesaplanır (K5): yerleşik tablo + OpenRouter canlı listesi. Fiyatı tabloda olmayan OpenRouter kaydı varsa ve anahtar
// kayıtlıysa liste bir kez istenir (model-listesi.ts: 10 dk önbellek; model seçicinin isteğiyle aynı) — anahtar yoksa ağa çıkılmaz.
// Pencere: `gun` (son N gün; varsayılan 30) ya da `baslangic` (ISO: İş modundaki "bu ay" — ayın ilk günü, yerel saat).
import { veritabani } from '../vt.js';
import { ayarlar } from '../ayarlar.js';
import { modelListesi } from './model-listesi.js';
import { canliFiyat } from './fiyat-onbellegi.js';
import { modelFiyati } from '../../shared/model-bilgisi.js';
import { MESAJ_IZI_SQL, kullanimDerle, type KullanimOzeti, type KullanimSatiri, type MesajIzi } from '../../shared/kullanim-ozeti.js';

export type KullanimPenceresi = number | { gun?: number; baslangic?: string } | null | undefined;

/** Pencerenin başı (ISO). Geçersiz girdi: son 30 gün. */
export function pencereBasi(p: KullanimPenceresi, simdi = Date.now()): string {
  const o = typeof p === 'number' ? { gun: p } : p ?? {};
  const t = typeof o.baslangic === 'string' ? Date.parse(o.baslangic) : NaN;
  if (Number.isFinite(t)) return new Date(t).toISOString();
  const gun = typeof o.gun === 'number' && Number.isFinite(o.gun) && o.gun > 0 ? Math.min(o.gun, 3660) : 30;
  return new Date(simdi - gun * 86_400_000).toISOString();
}

const fiyatBul = (s: string, m: string) => modelFiyati(s, m, canliFiyat(s, m));

export async function kullanimOzeti(p?: KullanimPenceresi): Promise<KullanimOzeti> {
  const bas = pencereBasi(p);
  const satirlar = veritabani().prepare(`
    SELECT COALESCE(saglayici, '') saglayici, COALESCE(model, '') model, COALESCE(amac, '') amac, COUNT(*) istek,
      COALESCE(SUM(giris), 0) giris, COALESCE(SUM(cikis), 0) cikis, COALESCE(SUM(onbellek_okuma), 0) onbellekOkuma,
      COALESCE(SUM(onbellek_yazma), 0) onbellekYazma, SUM(maliyet) kayitliMaliyet, COUNT(maliyet) kayitliSayi
    FROM kullanim WHERE zaman >= ? GROUP BY saglayici, model, amac`).all(bas) as unknown as KullanimSatiri[];
  // Tabloda olmayan OpenRouter kimliği: canlı liste (anahtar varsa; önbellekliyse ağa çıkmaz). Hata sessiz: fiyat "—" kalır.
  if (satirlar.some((r) => r.saglayici === 'openrouter' && !fiyatBul(r.saglayici, r.model)) && ayarlar().saglayicilar.openrouter.anahtarVar) {
    await modelListesi('openrouter').catch(() => undefined);
  }
  // Kullanıcının gördüğü yanıtlar mesaj kayıtlarından (shared/kullanim-ozeti.ts yanitSay): motor çağrısı sayısı değil. Sorgu yalnız
  // pencereyi (olusturma dizini) ve sayıma girenleri okur (MESAJ_IZI_SQL).
  const izler = veritabani().prepare(MESAJ_IZI_SQL).all(bas) as unknown as MesajIzi[];
  return kullanimDerle(satirlar, fiyatBul, izler);
}
