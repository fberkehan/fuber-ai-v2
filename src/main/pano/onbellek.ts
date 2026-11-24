// ── Pano önbelleği (Görev 24): kaynak başına son başarılı veri, alındığı an ve tazelik ─────────────────────────────────────
// Çevrimdışında kartlar son veriyi YAŞIYLA gösterir; açılışta ağ beklenmeden önbellekten çizilir (kayma/titreme yok). Dosya:
// <veri>/pano-onbellek.json (atomik yazım + .bak; json-dosya.ts). Anahtar (şehrin koordinatı, ülke, kur kaynağı) değişince eski
// kayıt bu anahtar için yok sayılır. Electron'suz: tests/pano-motoru.test.ts (önbellek bölümü).
import { jsonOku, jsonYaz } from '../json-dosya.ts';
import { HAVA_EN_COK_MS, TAZELIK_MS, type PanoKaynakAdi } from '../../shared/pano.ts';

export interface KayitliKaynak<T = unknown> {
  anahtar: string;
  /** Verinin alındığı (ya da 304 ile doğrulandığı) an, ISO. */
  zaman: string;
  veri: T;
  /** Sunucunun "Expires" anı (ms); MET'e ondan önce yeniden sorulmaz. */
  bitis?: number;
  /** Sunucunun "Last-Modified" değeri (If-Modified-Since için). */
  sonDegisiklik?: string;
}
type Dosya = Partial<Record<PanoKaynakAdi, KayitliKaynak>>;

export class PanoOnbellek {
  private veri: Dosya = {};
  private readonly dosya: string | null;
  constructor(dosya: string | null) {
    this.dosya = dosya;
    if (!dosya) return;
    const o = jsonOku(dosya);
    if (typeof o === 'object') {
      for (const ad of ['hava', 'haberler', 'piyasa'] as PanoKaynakAdi[]) {
        const k = (o.veri as Dosya)[ad];
        if (k && typeof k === 'object' && typeof k.anahtar === 'string' && typeof k.zaman === 'string' && Number.isFinite(Date.parse(k.zaman))) this.veri[ad] = k;
      }
    }
  }
  /** Bu anahtarın kaydı (anahtar tutmuyorsa yok). */
  oku<T>(ad: PanoKaynakAdi, anahtar: string): KayitliKaynak<T> | undefined {
    const k = this.veri[ad];
    return k && k.anahtar === anahtar ? (k as KayitliKaynak<T>) : undefined;
  }
  yaz<T>(ad: PanoKaynakAdi, kayit: KayitliKaynak<T>): void {
    this.veri[ad] = kayit;
    if (!this.dosya) return;
    try { jsonYaz(this.dosya, this.veri); } catch (e) { console.warn('[pano] önbellek yazılamadı:', (e as Error).message); }
  }
  /** Kayıt hâlâ taze mi: hava için Expires'a uyulur (en az 30 dk, en çok 2 sa); diğerleri sabit süre. */
  tazeMi(ad: PanoKaynakAdi, anahtar: string, simdi = Date.now()): boolean {
    const k = this.oku(ad, anahtar);
    if (!k) return false;
    return simdi < tazelikSonu(ad, k);
  }
}

export function tazelikSonu(ad: PanoKaynakAdi, k: Pick<KayitliKaynak, 'zaman' | 'bitis'>): number {
  const t = Date.parse(k.zaman);
  if (ad !== 'hava') return t + TAZELIK_MS[ad];
  const bitis = Number.isFinite(k.bitis) ? (k.bitis as number) : t + TAZELIK_MS.hava;
  return Math.min(t + HAVA_EN_COK_MS, Math.max(t + TAZELIK_MS.hava, bitis));
}
