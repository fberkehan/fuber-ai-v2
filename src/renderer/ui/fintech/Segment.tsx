// Segment denetimi (fintech; 2–3 seçenek): kayan tek parça kaydırak yayla yer değiştirir. `deger` seçeneklerden biri değilse (ör. elle
// girilmiş saat) kaydırak saklanır ve hiçbiri seçili görünmez. Radyo grubu (←/→).
import type { CSSProperties } from 'react';
import { radyoTusu } from './radyo';

export function Segment<T extends string>({ etiket, secenekler, deger, sec, className }: {
  etiket: string; secenekler: readonly (readonly [T, string])[]; deger: T | null; sec: (v: T) => void; className?: string;
}) {
  const i = secenekler.findIndex(([d]) => d === deger);
  const stil = { '--n': secenekler.length, '--i': Math.max(0, i) } as CSSProperties;
  return (
    <div className={`ft-segment${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={etiket} style={stil} data-secimsiz={i < 0 ? '' : undefined}
      onKeyDown={(e) => radyoTusu(e, secenekler.map(([d]) => d), i < 0 ? null : deger, sec)}>
      <span className="ft-segment__kaydirak" aria-hidden="true" />
      {secenekler.map(([d, ad], j) => (
        <button key={d} type="button" role="radio" className="ft-segment__dgm" data-deger={d} aria-checked={j === i} tabIndex={j === i || (i < 0 && j === 0) ? 0 : -1} onClick={() => sec(d)}>{ad}</button>
      ))}
    </div>
  );
}

/** Çip grubu (rol, hitap): tek seçimli, sarılan hap düğmeler. */
export function CipGrubu<T extends string>({ etiket, secenekler, deger, sec }: {
  etiket: string; secenekler: readonly (readonly [T, string])[]; deger: T; sec: (v: T) => void;
}) {
  return (
    <div className="ft-cipler" role="radiogroup" aria-label={etiket} onKeyDown={(e) => radyoTusu(e, secenekler.map(([d]) => d), deger, sec)}>
      {secenekler.map(([d, ad]) => (
        <button key={d} type="button" role="radio" className="ft-cip" data-deger={d} aria-checked={d === deger} tabIndex={d === deger ? 0 : -1} onClick={() => sec(d)}>{ad}</button>
      ))}
    </div>
  );
}
