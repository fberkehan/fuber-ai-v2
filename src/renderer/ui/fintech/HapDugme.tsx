// Hap düğme (fintech): birincil (koyuda beyaz, açıkta siyah), ikincil (kıl payı çizgili yüzey) ve hayalet. Basınca 0,97 ölçek (anında,
// pointer-down'da); `kisayol` sağda küçük bir tuş başlığı (ör. ⏎); `bekliyor` yazının yerine dönen halka (genişlik korunur).
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface HapDugmeOzellikleri extends ButtonHTMLAttributes<HTMLButtonElement> {
  tur?: 'birincil' | 'ikincil' | 'hayalet';
  boy?: 'b' | 'orta' | 'k';
  /** Sağdaki küçük tuş başlığı (ör. "⏎"); ekran okuyucuya gizli. */
  kisayol?: string;
  bekliyor?: boolean;
  simge?: ReactNode;
}

export function HapDugme({ tur = 'birincil', boy = 'orta', kisayol, bekliyor = false, simge, children, className, type = 'button', ...geri }: HapDugmeOzellikleri) {
  const sinif = ['ft-hap', `ft-hap--${tur}`, boy !== 'orta' ? `ft-hap--${boy}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={sinif} aria-busy={bekliyor || undefined} {...geri}>
      {bekliyor ? <span className="ft-donen" aria-label="Bekleniyor" /> : <>{simge}{children}</>}
      {kisayol && !bekliyor && <span className="ft-hap__tus" aria-hidden="true">{kisayol}</span>}
    </button>
  );
}
