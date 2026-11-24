// ── Ayarlar kategori kaydı: dizin (metinler, gruplar, mod işaretleri) + grup içerikleri ───────────────────────────────────
// Kabuk (sayfalar/Ayarlar.tsx) yalnız bunu okur. Yeni grup: dizin.ts'e grup/ayar tanımı + kategori dosyasının haritasına bileşen.
// Görev 14: HESAP (Hesap.tsx). Kabuk değişmez. 0.13 T15: Yapay zekâ kategorisi (motor anahtarları, model kartları) kalktı.
import type { IcerikHaritasi } from './baglam';
import { KATEGORILER, ESKI_CIPALAR, type AyarGrubu, type AyarKategorisi, type KategoriId } from './dizin';
import { GENEL } from './Genel';
import { GORUNUM } from './Gorunum';
import { PANO } from './Pano';
import { SES } from './SesVeAda';
import { GIZLILIK } from './Gizlilik';
import { PROAKTIF } from './Proaktif';
import { DUSUNME } from './Dusunme';
import { YETKILER } from './Yetkiler';
import { KULLANIM } from './Kullanim';
import { VERI } from './Veri';
import { SAGLAYICI } from './Saglayici';

// 0.14 (ürün kararı): 'motor' = Yapay zekâ sağlayıcısı — YALNIZ Developer mode (Fuber ya da kullanıcının Claude anahtarı).
export const ICERIKLER: Readonly<Record<KategoriId, IcerikHaritasi>> = {
  motor: SAGLAYICI, genel: GENEL, gorunum: GORUNUM, pano: PANO, ses: SES, gizlilik: GIZLILIK,
  proaktif: PROAKTIF, dusunme: DUSUNME, yetkiler: YETKILER, kullanim: KULLANIM, veri: VERI,
};

export { KATEGORILER, ESKI_CIPALAR };
export type { AyarGrubu, AyarKategorisi, KategoriId, IcerikHaritasi };
