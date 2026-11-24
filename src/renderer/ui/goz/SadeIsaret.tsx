// SadeIsaret (0.14 T6b, Sade mod): gözlerin yerine çizilen nötr işaret — yüz yok (11 Kas: gözler gelince de Sade aynen kaldı). Kipin vurgu rengiyle
// (vurgu.ts KIP_VURGUSU: Business turuncu, Developer yeşil) bir halka ve ortasında Fuber'in F işareti; kutu gözlerle AYNI boyda (boyut × boyut), yer değiştirmez.
// Hâl işaretleri karakterle aynı anlamı taşır, yalnız ince: dinliyor = halka yavaşça nefes alır, düşünüyor / çalışıyor = halkanın yayı döner,
// konuşuyor = nokta atar, onay = sarı, hata = kırmızı (hareketsiz), uyuyor = soluk, sevinç = bir kez parlar. Az hareket (ayar) ya da Windows'un
// animasyon efektleri kapalıysa (prefers-reduced-motion) hareket yok, yalnız renk ve saydamlık (sade.css). Döngü CSS'te; JS zamanlayıcısı yok.
import type { ReactElement } from 'react';
import type { KipKimligi } from '../../../shared/karakterler';
import { sadeHal, type SadeHal } from '../../../shared/karakter-gorunum';
import type { GozHali, GozIfadesi } from '../../../shared/goz';
import { kipVurgusu } from './vurgu';
import { MINI_BOY, MINI_EN, MINI_YOLLAR } from '../../../shared/urun-isareti';
import './sade.css';

// 11 Kas (tasarımcı bulgu 10): Sade'de Fuber'in kimliği iki ayrı işaretle çiziliyordu (sohbette F logosu, çentikte/kurulumda iç içe halka). Artık
// ortadaki nokta yerine Fuber'in F işareti (shared/urun-isareti.ts MINI_YOLLAR — uygulama ikonu ve rayın logosuyla aynı yollar); hâl F'nin
// çevresindeki ince halkayla okunur. F, halkanın içine sığar (yükseklik 30 birim, kutu 100).
const F_BOY = 30;
const F_OLCEK = F_BOY / MINI_BOY;
const F_DONUSUM = `translate(${50 - (MINI_EN * F_OLCEK) / 2} ${50 - F_BOY / 2}) scale(${F_OLCEK})`;

/** Sade halkasının küçük boydaki kalınlığı (CSS piksel; 24 px'te 2 px). */
export const SADE_HALKA_PX = 2;

export { sadeHal, type SadeHal };

export interface SadeIsaretOzellikleri {
  kip: KipKimligi;
  /** CSS piksel (kare); karakterin boyutuyla aynı. */
  boyut: number;
  hal?: GozHali;
  ifade?: GozIfadesi;
  azHareket?: boolean;
  /** Erişilebilir ad; verilmezse süs (aria-hidden). */
  etiket?: string;
}

export function SadeIsaret({ kip, boyut, hal, ifade, azHareket = false, etiket }: SadeIsaretOzellikleri): ReactElement {
  const durum = sadeHal(hal, ifade);
  // Küçük boyda çizgi viewBox biriminde kalınlaşır (24 px'te 2 px: 11 Kas bulgu 10, 1,5 px koyu zeminde ince kalıyordu), büyükte 3,5 birim.
  const cizgi = Math.max(3.5, (SADE_HALKA_PX * 100) / Math.max(boyut, 1));
  return (
    <svg
      className="sade-isaret"
      width={boyut}
      height={boyut}
      viewBox="0 0 100 100"
      data-sade-isaret={kip}
      data-hal={durum}
      data-az-hareket={azHareket ? '' : undefined}
      style={{ ['--sade-vurgu' as string]: kipVurgusu(kip) }}
      {...(etiket ? { role: 'img', 'aria-label': etiket } : { 'aria-hidden': true })}
    >
      <circle className="sade-isaret__hale" cx="50" cy="50" r="30" />
      <circle className="sade-isaret__halka" cx="50" cy="50" r="22" fill="none" strokeWidth={cizgi} />
      <circle className="sade-isaret__yay" cx="50" cy="50" r="22" fill="none" strokeWidth={cizgi} pathLength={100} />
      <g className="sade-isaret__f" data-sade-f="">
        <g transform={F_DONUSUM}>{MINI_YOLLAR.map((d) => <path key={d.slice(0, 16)} d={d} />)}</g>
      </g>
    </svg>
  );
}
