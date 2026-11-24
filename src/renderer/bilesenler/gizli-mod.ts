import { useEffect, useState } from 'react';
import { cagir, dinle } from '../api';
import type { Ayarlar } from '../../shared/tipler';

/** Is Private mode on (from settings; updated via 'ayarlar:degisti')? Never touches the network. */
export function useGizliMod(): boolean {
  const [gizli, setGizli] = useState(false);
  useEffect(() => {
    let canli = true;
    void cagir<Ayarlar>('ayarlar:al').then((a) => { if (canli) setGizli(a?.yerel?.gizliMod === true); }, () => undefined);
    const birak = dinle('ayarlar:degisti', (a: Ayarlar) => setGizli(a?.yerel?.gizliMod === true));
    return () => { canli = false; birak(); };
  }, []);
  return gizli;
}
