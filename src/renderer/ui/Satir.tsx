// Satir (0.11 G3): sol (saat ya da simge) · başlık + alt · sağ (rozet, sayı, saat). Başlık en çok `satir` satır (varsayılan 1), alt tek
// satır — ikisi de bilinçli kırpma ([data-kirp]); tamamı `title`'da, kırpılmışsa klavye odağında ipucuyla. `tikla` verilirse satırın
// tamamı düğmedir (≥ 40 px; sağ sütuna ikinci bir düğme koyma). `soluk`: bitmiş/geçmiş öğe — opaklık değil soluk yazı rengi (≥ 4,5:1).
// Satır, hover zemini kartın iç boşluğuna taşsın diye iki yandan 10 px dışa açılır; metin kenarı kartın içerik kenarıyla hizalı kalır.
// 0.11 G5: `ipucu` satırın `title`ına tam metnin altına eklenir (ör. "Fuber hesabına giriş yapınca çalışır"); `data-*` öznitelikleri
// satırın köküne geçer (önizleme ve motor işareti: data-motor-gerekli).
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { kirpGerekli } from './bicim';
import { useKirpildi, useOdakIpucu } from './kirp';
import './ui.css';

export type SatirOzellikleri = {
  sol?: ReactNode;
  baslik: string;
  alt?: string;
  sag?: ReactNode;
  satir?: 1 | 2 | 3 | 4;
  /** Alt satırın en çok kaç satır olacağı (varsayılan 1; sohbet kartları 2–3 verir). */
  altSatir?: 1 | 2 | 3;
  tikla?: () => void;
  soluk?: boolean;
  ipucu?: string;
  /** Açılır/katlanır satır (tikla ile): düğmenin durumu ekran okuyucuya söylenir. */
  'aria-expanded'?: boolean;
  /** 0.11 G7: açılır listenin seçeneği (tikla ile; kokpit sohbet seçici): düğme `role="option"` olur, `aria-selected` seçili durumu söyler. */
  rol?: 'option';
  'aria-selected'?: boolean;
} & { [veri: `data-${string}`]: string | undefined };

const varMi = (d: ReactNode) => d !== undefined && d !== null && d !== false && d !== '';

export function Satir({ sol, baslik, alt, sag, satir = 1, altSatir = 1, tikla, soluk, ipucu, rol, ...veri }: SatirOzellikleri) {
  const bRef = useRef<HTMLSpanElement>(null);
  const aRef = useRef<HTMLSpanElement>(null);
  const tam = alt ? `${baslik}\n${alt}` : baslik;
  const kesik = useKirpildi([bRef, aRef], kirpGerekli(baslik, satir) || (alt ? kirpGerekli(alt, altSatir) : false), `${satir}|${altSatir}|${tam}`);
  const { olaylar, ipucu: odakIpucu } = useOdakIpucu(kesik, tam);
  const sinif = `ui-satir${soluk ? ' ui-satir--soluk' : ''}`;
  const baslikYazisi = ipucu ? `${tam}\n${ipucu}` : tam;
  const ic = (
    <>
      {varMi(sol) && <span className="ui-satir__sol">{sol}</span>}
      <span className="ui-satir__ana">
        <span ref={bRef} className="ui-satir__baslik ui-kirp" data-kirp={satir} style={{ '--kirp-satir': satir } as CSSProperties}>{baslik}</span>
        {alt && <span ref={aRef} className="ui-satir__alt ui-kirp" data-kirp={altSatir} style={{ '--kirp-satir': altSatir } as CSSProperties}>{alt}</span>}
      </span>
      {varMi(sag) && <span className="ui-satir__sag">{sag}</span>}
    </>
  );
  return (
    <>
      {tikla
        ? <button type="button" {...veri} role={rol} className={sinif} title={baslikYazisi} onClick={tikla} {...olaylar}>{ic}</button>
        : <div {...veri} className={sinif} title={baslikYazisi} tabIndex={kesik ? 0 : undefined} {...(kesik ? olaylar : {})}>{ic}</div>}
      {odakIpucu}
    </>
  );
}
