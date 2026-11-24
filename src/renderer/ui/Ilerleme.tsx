// Ilerleme (0.11 G3): etiket (tek satır) + "değer/azami" (tabular) + ince çubuk. Erişilebilir ad etiketten; değer metni
// "3/5 · %60". Oran 0–1'e sıkışır (azami 0 ise boş çubuk). Dolgu ekranın vurgusunda, ölçekle (scaleX, --oran) 280 ms'de yumuşar — genişlik
// canlandırılmaz (0.14 T29); hareketi azaltta anında.
import { useId, type CSSProperties } from 'react';
import { ilerlemeOrani, sayiBicim, yuzdeBicim } from './bicim';
import { MetinKirp } from './MetinKirp';
import { Sayi } from './Sayi';
import './ui.css';

export interface IlerlemeOzellikleri {
  deger: number;
  azami: number;
  etiket: string;
}

export function Ilerleme({ deger, azami, etiket }: IlerlemeOzellikleri) {
  const id = useId();
  const oran = ilerlemeOrani(deger, azami);
  return (
    <div className="ui-ilerleme">
      <div className="ui-ilerleme__ust">
        <span className="ui-ilerleme__etiket" id={id}><MetinKirp as="span" metin={etiket} satir={1} /></span>
        <span className="ui-ilerleme__deger" aria-hidden="true"><Sayi deger={deger} />/<Sayi deger={azami} /></span>
      </div>
      <div
        className="ui-ilerleme__cubuk"
        role="progressbar"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(oran * 100)}
        aria-valuetext={`${sayiBicim(deger)}/${sayiBicim(azami)} · ${yuzdeBicim(oran)}`}
      >
        <span className="ui-ilerleme__dolgu" style={{ '--oran': oran } as CSSProperties} />
      </div>
    </div>
  );
}
