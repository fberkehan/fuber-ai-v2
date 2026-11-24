// ── Plan önceliğinin görünümü (saf) ──────────────────────────────────────────────────────────────────────────────────────
// Görev 20b (K16): kokpit Plan kartında öncelik "●●●●●" olarak yazılıyor, dar kartta görev başlığını kesiyordu. Yerine tek renkli
// nokta + sayı: 5 kırmızı, 4 turuncu, altı nötr; renk tek başına anlam taşımaz (sayı ve "Öncelik n/5" etiketi var).

export interface OncelikGorunumu { sayi: number; nokta: 'kirmizi' | 'turuncu' | null; etiket: string }

export function oncelikGorunumu(oncelik: number): OncelikGorunumu {
  const sayi = Number.isFinite(oncelik) ? Math.min(5, Math.max(1, Math.round(oncelik))) : 3;
  return { sayi, nokta: sayi >= 5 ? 'kirmizi' : sayi === 4 ? 'turuncu' : null, etiket: `Öncelik ${sayi}/5` };
}
