// Kart ve KartBaslik (0.11 G3): macOS widget'ı gibi — sakin başlık solda, tek eylem sağda, cömert iç boşluk; kartın içinde kaydırma
// çubuğu YOK (fazlası Liste `azami` + "Tümü" ile). Zemin, çizgi ve ışık tasarim.css .kart'tan (üç tema). `yogun`: sohbet/ada gibi dar
// yerler için küçük iç boşluk ve küçük köşe. Gövde taşarsa kart keser ve önizlemenin taşma denetimi (scripts/dev/tasma.mjs) bunu
// hata sayar — yüksekliği sabit ızgarada içerik `azami` ile sınırlanır.
import { isValidElement, useId, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { kartAdlandirma } from './bicim';
import { Dugme } from './Dugme';
import { MetinKirp } from './MetinKirp';
import './ui.css';

/** Kartın ya da boş hâlin tek eylemi: etiket + tıklama (hayalet/ikincil küçük düğme olur) ya da hazır bir öğe. */
export interface Eylem { etiket: string; tikla: () => void }

export interface KartBaslikOzellikleri {
  baslik?: string;
  eylem?: Eylem | ReactElement;
  /** Başlığın kimliği (kart aria-labelledby ile buna bağlanır). */
  id?: string;
}

export function KartBaslik({ baslik, eylem, id }: KartBaslikOzellikleri) {
  return (
    <header className="ui-kart__bas">
      {baslik ? <div className="ui-kart__baslik" id={id}><MetinKirp as="h3" metin={baslik} satir={1} /></div> : <span className="ui-kart__bosluk" />}
      {eylem && (
        <div className="ui-kart__eylem">
          {isValidElement(eylem) ? eylem : <Dugme tur="hayalet" boyut="k" onClick={(eylem as Eylem).tikla}>{(eylem as Eylem).etiket}</Dugme>}
        </div>
      )}
    </header>
  );
}

export type KartOzellikleri = {
  baslik?: string;
  eylem?: Eylem | ReactElement;
  yogun?: boolean;
  children?: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className' | 'title'>;

export function Kart({ baslik, eylem, yogun, children, className, ...oznitelik }: KartOzellikleri) {
  const id = useId();
  const sinif = ['kart', 'ui-kart', yogun && 'ui-kart--yogun', className].filter(Boolean).join(' ');
  return (
    <section {...oznitelik} className={sinif} {...kartAdlandirma(baslik, id, oznitelik)}>
      {(baslik || eylem) && <KartBaslik baslik={baslik} eylem={eylem} id={id} />}
      <div className="ui-kart__govde">{children}</div>
    </section>
  );
}
