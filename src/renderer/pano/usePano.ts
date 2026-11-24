// Pano verisi (Görev 24): 'pano:al' önbellekten anında döner; ana süreç bayat kaynakları arka planda tazeleyip 'pano:degisti' yayınlar.
// 5 dakikada bir yeniden sorulur (ana süreç o an bayatlayanı tazeler; taze olana istek gitmez). Arayüz ağa hiç çıkmaz.
// Düzeltme turu 1: pencere gizliyken (tepside, simge durumunda) sorulmaz; görünür olunca hemen sorulur. `bitti`: ilk yanıt geldi, hata
// verdi ya da 1,5 sn geçti — Kokpit pano verisini sonsuza dek beklemez (pano:al düşerse nötr durumla çizilir).
import { useEffect, useState } from 'react';
import { cagir, dinle } from '../api';
import { panoKonumu, type PanoDurumu } from '../../shared/pano';

const SORMA_ARASI_MS = 5 * 60_000;
const ILK_BEKLEME_MS = 1500;

/** Pano verisi gelmezse (ana süreç hatası) çizilecek nötr durum: ağ gerektiren kaynak yok, hava kartı yerel (şehir, saat, güneş). */
export function notrPano(): PanoDurumu {
  let konum;
  try { konum = panoKonumu(undefined, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language); } catch { konum = panoKonumu(undefined, 'Europe/Istanbul', 'tr-TR'); }
  return { konum, hava: { durum: 'yok' }, haberler: { durum: 'yok' }, gundem: { durum: 'yok' }, piyasa: { durum: 'yok' } };
}

export function usePano(): { pano: PanoDurumu | null; bitti: boolean } {
  const [p, setP] = useState<PanoDurumu | null>(null);
  const [bitti, setBitti] = useState(false);
  useEffect(() => {
    let canli = true;
    const al = () => {
      if (document.hidden) return;
      void cagir<PanoDurumu>('pano:al')
        .then((x) => { if (canli) { setP(x); setBitti(true); } })
        .catch((e) => { if (canli) { setBitti(true); console.warn('[pano] veri alınamadı:', (e as Error)?.message ?? e); } });
    };
    al();
    const k = dinle('pano:degisti', (x: PanoDurumu) => { if (canli) { setP(x); setBitti(true); } });
    const z = setInterval(al, SORMA_ARASI_MS);
    const ilk = setTimeout(() => { if (canli) setBitti(true); }, ILK_BEKLEME_MS);
    const gorunur = () => { if (!document.hidden) al(); };
    document.addEventListener('visibilitychange', gorunur);
    return () => { canli = false; k(); clearInterval(z); clearTimeout(ilk); document.removeEventListener('visibilitychange', gorunur); };
  }, []);
  return { pano: p, bitti };
}

/** Dakikada bir yeniden çizim (saat, günün ilerleyişi, "12 dk önce" yazıları): kendi bileşeninde, dakika sınırına hizalı. */
export function useDakika(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    let z: ReturnType<typeof setTimeout>;
    const kur = () => { z = setTimeout(() => { setT(Date.now()); kur(); }, 60_000 - (Date.now() % 60_000) + 50); };
    kur();
    return () => clearTimeout(z);
  }, []);
  return t;
}
