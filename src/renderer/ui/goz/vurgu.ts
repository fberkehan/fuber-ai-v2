// Kipin vurgu rengi (B31; tek kaynak, ikinci kopya yok): Business turuncu, Developer yeşil. Gözlerde yalnız küçük parıltıda; panel, ekran vurguları
// (ui/vurgu.ts vurguStili), iş izi tonları, çentiğin ışığı ve Sade işareti de buradan okur. Renk bir hayvanı değil kipi anlatır.
import type { KipKimligi } from '../../../shared/karakterler.ts';

export const KIP_VURGUSU: Readonly<Record<KipKimligi, string>> = {
  business: '#F09532',
  developer: '#67AD58',
};

/** Kipin vurgusu (bilinmeyen değer Business). */
export const kipVurgusu = (kip: KipKimligi | string | undefined): string => (kip === 'developer' ? KIP_VURGUSU.developer : KIP_VURGUSU.business);
