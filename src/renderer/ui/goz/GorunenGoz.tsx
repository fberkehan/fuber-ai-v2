// GorunenGoz (11 Kas; 0.14 T6b'nin karakter sarmalayıcısının yerine): ürün yüzeylerinin (çentik, panel, kokpit, kurulum, boş durumlar) göz bileşeni. Göster'de
// gözler (Gozler), Sade modda aynı boyda nötr işaret (SadeIsaret: F işareti ve hâl halkası; değişmedi). Ayarı kendisi okur (renderer/karakter-gorunum.ts
// useKarakterGorunur): yeni bir ekran bunu kullanırsa Sade'yi unutamaz. Gozler'i doğrudan çizen dosya da kancaya bakmak zorunda (tests/karakter-gorunum.test.ts).
import type { ReactElement } from 'react';
import { Gozler, type GozlerOzellikleri } from './Gozler';
import { SadeIsaret } from './SadeIsaret';
import { useKarakterGorunur } from '../../karakter-gorunum';

export function GorunenGoz(o: GozlerOzellikleri): ReactElement {
  const gorunur = useKarakterGorunur();
  if (gorunur) return <Gozler {...o} />;
  return <SadeIsaret kip={o.kip} boyut={o.boyut} hal={o.hal} ifade={o.ifade} azHareket={o.azHareket} etiket={o.etiket ? 'Fuber' : undefined} />;
}
