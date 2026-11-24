// Sayi (0.11 G3): tr-TR yazım (1.234.567,8), tabular rakamlar (sütunda hizalı), tipografik eksi; birim yeri Türkçe kurala göre: yüzde
// önde ("%42", eksi "−%0,30"), derece bitişik ("18°"), öteki birimler dar boşlukla ayrı ve sakin ("1.234 TL"). Satır kırılmaz: sayıyı
// esnemeyen bir yere koy. Büyük birincil değer için sarmalayıcı: <div className="ui-deger"><Sayi …/></div> — yazı boyu kabın genişliğine
// ve sayının karakter sayısına (--hane) göre ayarlanır (en çok 48 px): "18°" büyük, "1.234.567,8 TL" dar sütunda da sığar.
import type { CSSProperties } from 'react';
import { birimKonumu, sayiBicim, sayiMetni } from './bicim';
import './ui.css';

export interface SayiOzellikleri {
  deger: number;
  birim?: string;
  ondalik?: number;
}

export function Sayi({ deger, birim, ondalik = 0 }: SayiOzellikleri) {
  const s = sayiBicim(deger, ondalik);
  const b = birim?.trim() ?? '';
  const konum = Number.isFinite(deger) ? birimKonumu(b) : 'yok';
  const stil = { '--hane': [...sayiMetni(deger, b, ondalik)].length } as CSSProperties;
  if (konum === 'on') {
    const eksi = s.startsWith('−');
    return <span className="ui-sayi" style={stil}>{eksi && '−'}<span className="ui-sayi__birim">{b}</span>{eksi ? s.slice(1) : s}</span>;
  }
  if (konum === 'bitisik') return <span className="ui-sayi" style={stil}>{s}<span className="ui-sayi__birim">{b}</span></span>;
  if (konum === 'ayri') return <span className="ui-sayi" style={stil}>{s}<span className="ui-sayi__birim ui-sayi__birim--ayri">{' '}{b}</span></span>;
  return <span className="ui-sayi" style={stil}>{s}</span>;
}
