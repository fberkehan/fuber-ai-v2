// Sekmeler (0.14 T29, Nusa dili): hap sekmeler — kap ve seçili sekme --r-hap köşeli (tasarim.css .sekmeler; ekranların elle yazdığı sekmelerle
// aynı biçem, T30–T33 onları buna taşır). Seçili sekme ters ışıklı hap (koyuda beyaz, açıkta mürekkep); geçiş yalnız renkte, genişlik ya da
// konum canlandırılmaz. `rol`: 'tab' (varsayılan; sayfa içi bölümler, role=tablist) ya da 'radio' (tek seçimli değer, role=radiogroup).
// Klavye: ←/→ ya da ↑/↓ seçer ve odağı taşır (radyo.ts; WAI-ARIA), yalnız seçili sekme sekme sırasındadır. Etiket tek satır, kırpılmaz.
import type { ReactElement } from 'react';
import { radyoTusu } from './fintech/radyo';
import './ui.css';

export interface SekmelerOzellikleri<T extends string> {
  secenekler: readonly (readonly [T, string])[];
  deger: T;
  sec: (v: T) => void;
  /** Erişilebilir ad (ör. "Tema"). */
  etiket?: string;
  rol?: 'tab' | 'radio';
  className?: string;
}

export function Sekmeler<T extends string>({ secenekler, deger, sec, etiket, rol = 'tab', className }: SekmelerOzellikleri<T>): ReactElement {
  const secili = (d: T) => d === deger;
  const durum = (d: T) => (rol === 'tab' ? { 'aria-selected': secili(d) } : { 'aria-checked': secili(d) });
  const odakli = secenekler.some(([d]) => secili(d));
  return (
    <div
      className={['sekmeler', 'ui-sekmeler', className].filter(Boolean).join(' ')}
      role={rol === 'tab' ? 'tablist' : 'radiogroup'}
      aria-label={etiket}
      onKeyDown={(e) => radyoTusu(e, secenekler.map(([d]) => d), odakli ? deger : null, sec)}
    >
      {secenekler.map(([d, ad], i) => (
        <button key={d} type="button" role={rol} data-deger={d} {...durum(d)} tabIndex={secili(d) || (!odakli && i === 0) ? 0 : -1} onClick={() => sec(d)}>{ad}</button>
      ))}
    </div>
  );
}
