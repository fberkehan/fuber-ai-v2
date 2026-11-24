// Isaret (0.11 G3): işaret kutusu + metin (en çok 2 satır) + isteğe bağlı alt satır. İşaretlenince metin SİLİNMEZ: üstü çizilir ve
// soluklaşır (eskiden hemen siliniyordu) — kutu dolar, çizgi ve renk 160 ms'de gelir; hareketi
// azaltta anında. Soluk hâl opaklık değil --ink-3 (üç temada ≥ 4,5:1). Satırın tamamı düğmedir (role=checkbox, ≥ 40 px); tam metin
// `title`'da, kırpılmışsa klavye odağında ipucuyla.
import { useRef, type CSSProperties } from 'react';
import { kirpGerekli } from './bicim';
import { useKirpildi, useOdakIpucu } from './kirp';
import { Ikon } from '../bilesenler/Ikon';
import './ui.css';

export interface IsaretOzellikleri {
  isaretli: boolean;
  metin: string;
  degistir: (v: boolean) => void;
  alt?: string;
}

export function Isaret({ isaretli, metin, degistir, alt }: IsaretOzellikleri) {
  const mRef = useRef<HTMLSpanElement>(null);
  const aRef = useRef<HTMLSpanElement>(null);
  const tam = alt ? `${metin}\n${alt}` : metin;
  const kesik = useKirpildi([mRef, aRef], kirpGerekli(metin, 2) || (alt ? kirpGerekli(alt, 1) : false), tam);
  const { olaylar, ipucu } = useOdakIpucu(kesik, tam);
  return (
    <>
      <button type="button" role="checkbox" aria-checked={isaretli} className="ui-isaret" title={tam} onClick={() => degistir(!isaretli)} {...olaylar}>
        <span className="ui-isaret__kutu" aria-hidden="true"><Ikon ad="tamam" olcu={14} kalinlik={2.6} /></span>
        <span className="ui-isaret__ana">
          <span ref={mRef} className="ui-isaret__metin ui-kirp" data-kirp="2" style={{ '--kirp-satir': 2 } as CSSProperties}>{metin}</span>
          {alt && <span ref={aRef} className="ui-isaret__alt ui-kirp" data-kirp="1">{alt}</span>}
        </span>
      </button>
      {ipucu}
    </>
  );
}
