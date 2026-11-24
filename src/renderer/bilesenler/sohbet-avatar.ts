// ── Sohbet avatarı (0.14 T30; 11 Kas gözler; saf; tests/sohbet-avatar.test.ts) — Fuber iletisinin başında ne çizilir ─────────────────────────────
// İletinin kendi kip'i (turun başında kilitlenir, main/ajan/dongu.ts → mesajlar.kip) varsa gözler: 24 px siyah daire, durağan (hareket beyni yok: uzun
// sohbette onlarca avatar boşta çizim yapmasın); parıltı kipin renginde (24 px'te ince parıltı gizli). Tur sürerken canlı balonda ifade 'konusuyor', bitince
// kayıtlı ileti 'sakin'. Eski ileti (kip sütunu boş), bozuk değer ya da Sade mod (T6b): göz yok, mevcut Fuber işareti (UrunIsareti). Kip ayardaki moddan
// tahmin edilmez: eski bir yanıtın hangi kiple yazıldığı bilinmiyorsa Fuber yazmıştır.
import { kipTemizle, type KipKimligi } from '../../shared/karakterler.ts';

export const AVATAR_PX = 24;

export type AvatarSecimi =
  | { tur: 'goz'; kip: KipKimligi; boyut: typeof AVATAR_PX; ifade: 'konusuyor' | 'sakin' }
  | { tur: 'isaret' };

export function avatarSec(o: { kip?: unknown; karakterGorunur: boolean; suruyor?: boolean }): AvatarSecimi {
  const kip = kipTemizle(o.kip);
  if (!kip || !o.karakterGorunur) return { tur: 'isaret' };
  return { tur: 'goz', kip, boyut: AVATAR_PX, ifade: o.suruyor ? 'konusuyor' : 'sakin' };
}
