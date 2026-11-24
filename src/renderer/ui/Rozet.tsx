// Rozet (0.11 G3): küçük durum hapı. Ton yalnız renk değildir: yazı her zaman anlamı taşır. notr = nötr hap; iyi/uyari/hata = önem
// renginin çok hafif zemini + okunur yazı belirteci (--yazi-basari/uyari/hata, üç temada ≥ 4,5:1) + aynı renkte nokta; bilgi = nötr hap +
// mavi nokta (Çentik dili: mavi yalnız küçük nokta/rozet). Tek satır; sığmazsa … (bilinçli kırpma), metinse tamamı `title`'da.
// (bilesenler/Rozet "Önerilen" rozetidir; bu genel durum rozetidir.)
import type { ReactNode } from 'react';
import './ui.css';

export type RozetTonu = 'notr' | 'iyi' | 'uyari' | 'hata' | 'bilgi';

export function Rozet({ ton, children }: { ton: RozetTonu; children: ReactNode }) {
  return (
    <span className="ui-rozet" data-ton={ton} title={typeof children === 'string' ? children : undefined}>
      {ton !== 'notr' && <span className="ui-rozet__nokta" aria-hidden="true" />}
      <span className="ui-rozet__metin" data-kirp="1">{children}</span>
    </span>
  );
}
