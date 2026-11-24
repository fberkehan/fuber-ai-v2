// ── Ana pencerenin tostları (tek depo) ────────────────────────────────────────────────────────────────────────────────────
// Görev 20b düzeltme turu 2: bilgi/hata tostları ve adanın uygulama içi karşılığı (hatırlatıcı, Fuber'in sözü, onay; AdaTost.tsx)
// tek kuyrukta (shared/tost-kuyrugu.ts); hepsi çentiğin altından inen katmanda görünür (bilesenler/TostAlani.tsx), sayfa alanı hiç
// değişmez. "Geri al" tostları ayrı depoda (geri-al.ts) ama aynı katmanda. Pencere odağı gidince duraklatmalar kalkar.
import { useEffect, useState } from 'react';
import { TostKuyrugu, type Tost, type TostGirdisi } from '../shared/tost-kuyrugu';

export type { Tost };
const kuyruk = new TostKuyrugu();
if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => kuyruk.hepsiniSurdur());
  document.addEventListener('visibilitychange', () => { if (document.hidden) kuyruk.hepsiniSurdur(); });
}

/** Bilgi ya da hata tostu (varsayılan 6 sn; süre tost görünürken işler). */
export function tostGoster(metin: string, tur?: 'hata', ms = 6000): void {
  kuyruk.ekle({ tur: tur ?? 'bilgi', metin, sure: ms });
}
export const tostEkle = (g: TostGirdisi) => kuyruk.ekle(g);
export const tostKaldir = (id: number) => kuyruk.kaldir(id);
export const tostlariSuz = (f: (t: Tost) => boolean) => kuyruk.suz(f);
export const tostGorunenler = (idler: readonly number[]) => kuyruk.gorunenler(idler);
export const tostDuraklat = (id: number, v: boolean) => kuyruk.duraklat(id, v);
/** Çentikteki "+N" hapı (B8): katlanmış kalıcı tostlar yeniden açılır. */
export const tostlariAc = () => kuyruk.katlilariAc();

export function useTostlar(): Tost[] {
  const [, setSurum] = useState(0);
  useEffect(() => kuyruk.dinle(() => setSurum((n) => n + 1)), []);
  return kuyruk.liste();
}
