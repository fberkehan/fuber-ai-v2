// ── Claude Code sayfasında şu an görünen oturum (Görev 28) ──────────────────────────────────────────────────────────────────────
// Motorun "izin bekliyor / bitti" bildirimi (ada yolu → uygulama öndeyken tost) kullanıcının ZATEN baktığı oturum içinse tost olarak
// tekrarlanmaz (aynı bilgi sayfada canlı: izin kartı, hâl rozeti). Başka oturumun ya da başka sayfadayken gelen bildirim tost olur;
// "Aç" o oturuma götürür.
import { ccCipaCoz } from '../../shared/cc-olay.ts';

let gorunen: string | null = null;

/** Sayfa seçili oturumu bildirir (null: oturum yok / sayfa kapandı). */
export function ccGorunenOturum(id: string | null): void { gorunen = id; }

/**
 * Bu bildirim yolu ('claude#cc-<id>' ya da düzeltme 2'den beri 'claude#cc-<id>~<Claude Code kimliği>') şu an ekranda açık olan
 * oturuma mı ait? Düzeltme 3 (F1): kimlik eki karşılaştırmayı bozmaz — çapa ayrıştırılır, yalnız oturum id'si karşılaştırılır.
 */
export function ccEkrandaMi(yol: unknown): boolean {
  if (!gorunen || typeof yol !== 'string' || typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
  const [sayfa, cipa] = yol.split('#');
  if (sayfa !== 'claude') return false;
  return ccCipaCoz(cipa)?.id === gorunen;
}
