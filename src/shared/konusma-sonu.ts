// ── Konuşmanın sonu (VAD; Görev 21): kullanıcı susunca soru ne zaman biter? (saf; birim testli: tests/konusma-sonu.test.ts) ──────────
// Ses seviyesi 60 ms'de bir ölçülür. İlk 300 ms ortam gürültüsü öğrenilir; eşik = max(0,018, gürültü × 2,2). Konuşma başladıktan sonra
// `sessizlikMs` boyunca eşiğin altında kalınca biter. Görev 21: 1,1 sn → 0,7 sn (olabildiğince hızlı). Cümle içi duraklamaların
// çoğunlukla 0,5 sn'nin altında kaldığı bir VARSAYIMDIR (gerçek Türkçe konuşmayla ölçülmedi); tests/konusma-sonu.test.ts yalnız kuralı
// sınar (0,5 sn duraklama konuşmayı bitirmez, 0,7 sn sessizlik bitirir) — sentetik seviye dizileriyle. Hiç konuşma yoksa 6 sn'de "boş"
// (uyanmayla açılan dinlemede 3 sn; 0.13 T8); en uzun 20 sn.

export const SESSIZLIK_MS = 700;
export const ESKI_SESSIZLIK_MS = 1100;
/** Hiç konuşma gelmezse "boş" süresi. */
export const BOS_MS = 6000;
/** Uyanmayla açılan dinleme daha kısa bekler (0.13 T8): yanlış uyanmada çentik sessizce kapanır, sohbete bir şey yazılmaz. */
export const UYANMA_BOS_MS = 3000;

export interface VadDurumu { bas: number; gurultu: number; konustu: boolean; sonSes: number }
export type VadKarari = 'surer' | 'bitti' | 'bos' | 'uzun';

export const vadBaslat = (t: number): VadDurumu => ({ bas: t, gurultu: 0.008, konustu: false, sonSes: t });

/** Bir ölçüm adımı: seviye (RMS) ve zaman (ms). Durum yerinde güncellenir. */
export function vadAdim(d: VadDurumu, seviye: number, t: number, sessizlikMs = SESSIZLIK_MS, bosMs = BOS_MS): VadKarari {
  if (t - d.bas < 300) { d.gurultu = Math.max(d.gurultu, seviye * 1.2); return 'surer'; }
  const esik = Math.max(0.018, d.gurultu * 2.2);
  if (seviye > esik) { d.konustu = true; d.sonSes = t; }
  if (d.konustu && t - d.sonSes > sessizlikMs) return 'bitti';
  if (!d.konustu && t - d.bas > bosMs) return 'bos';
  if (t - d.bas > 20000) return 'uzun';
  return 'surer';
}
