// Tek seçimli grupların ortak klavye davranışı (SecimGrubu, Segment, CipGrubu): ←/→ ya da ↑/↓ seçimi değiştirir (kapalı seçenek atlanır),
// odak yeni seçeneğe geçer (WAI-ARIA radio group). Seçenek düğmeleri `data-deger` taşır.
import type { KeyboardEvent } from 'react';

export function radyoTusu<T extends string>(e: KeyboardEvent<HTMLElement>, degerler: readonly T[], deger: T | null, sec: (v: T) => void): void {
  const yon = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!yon || !degerler.length) return;
  e.preventDefault();
  const i = deger === null ? -1 : degerler.indexOf(deger);
  const yeni = degerler[(i + yon + degerler.length) % degerler.length];
  sec(yeni);
  const grup = e.currentTarget;
  requestAnimationFrame(() => grup.querySelector<HTMLElement>(`[data-deger="${CSS.escape(yeni)}"]`)?.focus());
}
