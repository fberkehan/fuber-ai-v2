// Liste (0.11 G3): satırların listesi. Boşsa `bos` (genelde <Bos/>) çizilir. `azami` kadar öğe görünür — kartın içinde kaydırma yok;
// fazlası `tumu` düğmesiyle ("Tümü" + kalan sayısı) ya da düğme yoksa sakin "N öğe daha" notuyla bildirilir.
import { Children, isValidElement, type ReactNode } from 'react';
import { listeDilimi, sayiBicim } from './bicim';
import { Dugme } from './Dugme';
import './ui.css';

export interface ListeOzellikleri {
  children?: ReactNode;
  bos?: ReactNode;
  azami?: number;
  tumu?: { etiket: string; tikla: () => void };
}

export function Liste({ children, bos, azami, tumu }: ListeOzellikleri) {
  const ogeler = Children.toArray(children);
  if (!ogeler.length) return bos ? <>{bos}</> : null;
  const { gorunen, kalan } = listeDilimi(ogeler, azami);
  return (
    <div className="ui-liste-kap">
      <ul className="ui-liste">
        {gorunen.map((o, i) => <li key={isValidElement(o) && o.key != null ? o.key : i}>{o}</li>)}
      </ul>
      {tumu ? (
        <div className="ui-liste__alt">
          <Dugme tur="hayalet" boyut="k" onClick={tumu.tikla}>{tumu.etiket}</Dugme>
          {kalan > 0 && <span className="ui-liste__kalan">+{sayiBicim(kalan)}</span>}
        </div>
      ) : kalan > 0 && <p className="ui-liste__kalan ui-liste__not">{sayiBicim(kalan)} öğe daha</p>}
    </div>
  );
}
