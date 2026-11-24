// ── Panelin Gündem, Görevler ve Gelenler sayfalarının ortak verisi (0.14 T24) ────────────────────────────────────────────────────────────────
// Sayfa görünür olunca (bileşen takılınca; Panel yalnız gösterilen sayfayı çizer) bir kez 'centik:veri' sorulur; görünürken kokpitin verisi değişince
// ('kokpit:veri-degisti'; arka plandaki takvim çağrısı bitince de bu olay gelir), görevler değişince ('isler:durum') ve İLGİLİ ayar değişince (Gizli,
// "Yalnız bu bilgisayar", mod, e-posta ve WhatsApp bağlantısı) yeniden. Düzeltme turu 1: olaylar sondan 300 ms'lik tek setTimeout'la birleştirilir (kaydırıcı
// sürüklemesi ana süreçte kokpit sorgusu üretmesin). Yoklama yok. Son yanıt modülde tutulur: sayfalar arasında gezerken önceki veri hemen çizilir.
import { useEffect, useState } from 'react';
import { cagir, dinle } from '../../api';
import type { CentikVerisi } from '../../../shared/centik-veri';
import type { Ayarlar } from '../../../shared/tipler';

/** Olayların birleştirildiği süre (ms). */
export const CENTIK_VERI_BIRLESTIRME_MS = 300;
/** Sayfaları etkileyen ayarların imzası: başka ayar (ses, tema, kaydırıcı) değişince yeniden çekilmez. */
export const ilgiliAyarImzasi = (a: Partial<Ayarlar> | null | undefined): string =>
  JSON.stringify([a?.yerel?.gizliMod === true, a?.yerel?.yalnizYerel === true, a?.mod, a?.eposta?.length ?? 0, a?.whatsapp?.etkin === true, a?.whatsapp?.bagli === true]);

let son: CentikVerisi | null = null;

export function useCentikVerisi(): CentikVerisi | null {
  const [v, setV] = useState<CentikVerisi | null>(son);
  useEffect(() => {
    let takili = true;
    let zaman: ReturnType<typeof setTimeout> | null = null;
    let imza: string | null = null;
    const al = () => {
      void Promise.resolve(cagir<CentikVerisi>('centik:veri')).then((x) => { son = x; if (takili) setV(x); }).catch(() => undefined);
    };
    const sonra = () => { if (zaman) clearTimeout(zaman); zaman = setTimeout(() => { zaman = null; al(); }, CENTIK_VERI_BIRLESTIRME_MS); };
    al();
    void Promise.resolve(cagir<Ayarlar>('ayarlar:al')).then((a) => { imza ??= ilgiliAyarImzasi(a); }).catch(() => undefined);
    const k = [
      dinle('kokpit:veri-degisti', sonra),
      dinle('isler:durum', sonra),
      dinle('ayarlar:degisti', (a: Ayarlar) => { const y = ilgiliAyarImzasi(a); if (y !== imza) { imza = y; sonra(); } }),
    ];
    return () => { takili = false; if (zaman) clearTimeout(zaman); k.forEach((f) => f()); };
  }, []);
  return v;
}
