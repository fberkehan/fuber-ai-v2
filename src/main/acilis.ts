// ── Açılış örtüsü: ana sürecin "ilk gösterim" bayrağı ve FUBER_DEMO açılış günlüğü (0.11 G11, spec §9) ───────────────────────────
// `acilisKapisi`: süreç başına BİR kez — ana pencerenin ilk gerçek gösterimi (main.ts 'show' olayı). Arayüz `uygulama:ilk-gosterim` ile sorar;
// `--gizli` (tepsiye açılış) başlangıçta pencere gösterilene dek cevap gelmez, sonra tek kez true döner (shared/acilis.ts ilkGosterimKapisi).
// FUBER_DEMO'da test günlüğü ("ana olay günlüğü"): arayüz açılış olaylarını yazar (acilis-basladi, acilis-sesi — ses çalınmaz, çalacağı an
// kaydedilir —, acilis-atlandi, acilis-bitti); önizleme betiği okur. Üretimde yazma da okuma da yoktur (kanalların işleyicisi kayıtlı değil).
import { ilkGosterimKapisi, ACILIS_OLAYLARI, type AcilisOlayi } from '../shared/acilis.js';

export const acilisKapisi = ilkGosterimKapisi();

const gunluk: { olay: AcilisOlayi; zaman: number }[] = [];

/** FUBER_DEMO günlüğüne açılış olayı yazar; tanınmayan ad ya da demo dışı çağrı yok sayılır (false). */
export function acilisOlayiYaz(ad: unknown): boolean {
  if (!process.env.FUBER_DEMO) return false;
  if (typeof ad !== 'string' || !(ACILIS_OLAYLARI as readonly string[]).includes(ad)) return false;
  gunluk.push({ olay: ad as AcilisOlayi, zaman: Date.now() });
  return true;
}

export const acilisOlaylari = () => gunluk.slice();
