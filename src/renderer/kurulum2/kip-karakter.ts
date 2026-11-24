// ── Kurulum › mod adımının göz kararları (0.14 T32; 11 Kas gözler; saf; tests/kurulum-v2.test.ts) ──────────────────────────────────────────────
// Kartta gözlerin boyu (spec B: kurulum mod kartları 120 px, siyah sahne), önizlemedeki gözlerin boyu, üzerine gelince oynayan jest (gözler selam verir:
// kısa gülümseme ve zıplama; imleci de izlerler) ve seçim değişince ModGecisi'nin eski/yeni kipi (göz aynı kalır, parıltının rengi çapraz solar).
// Az harekette (Görünüm → "Az hareket" ya da Windows'un animasyon tercihi; R16) ve Sade modda (T6b: göz yok) üzerine gelme bir şey oynatmaz.
import { modKip, type KipKimligi } from '../../shared/karakterler.ts';
import type { GozTetigi } from '../../shared/goz.ts';
import type { Mod } from '../../shared/tipler.ts';

/** Mod kartındaki gözler (spec B ölçekleri: 120 px kurulum mod kartları). */
export const KIP_KARTI_KARAKTERI = { boyut: 120 } as const;
/** Önizlemedeki gözler. */
export const KIP_ONIZLEME_KARAKTERI = { boyut: 88 } as const;
/** Sade modda kartın işareti (SadeIsaret; kipin vurgu rengi, göz yok). */
export const SADE_KART_ISARETI_PX = 72;

/** Kartın üzerine gelinince oynayan jest; az harekette ya da Sade'de null. İki modda da aynı (gözler selam verir). */
export function uzerineGelinceTetik(_mod: Mod, o: { azHareket: boolean; gorunur: boolean }): GozTetigi | null {
  if (o.azHareket || !o.gorunur) return null;
  return 'selam';
}

/** Seçim değişti: ModGecisi'nin eski ve yeni kipi; aynı seçimde null. */
export function kipGecisi(onceki: Mod, simdi: Mod): { eski: KipKimligi; yeni: KipKimligi } | null {
  return onceki === simdi ? null : { eski: modKip(onceki), yeni: modKip(simdi) };
}
