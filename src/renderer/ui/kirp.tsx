// Kırpma ölçümü ve odak ipucu (0.11 G3): MetinKirp, Satir ve Isaret'in ortak iç parçası (dizinden dışa aktarılmaz).
// Kırpma bilinçlidir ([data-kirp] + -webkit-line-clamp); kırpılan metnin TAMAMI iki yoldan okunur: fareyle `title`, klavyeyle odak —
// kırpılmış öğe odaklanabilir olur (düğme değilse tabIndex 0) ve klavye odağında (:focus-visible) altında tam metin ipucu açılır.
// İpucu belgeye taşınır (portal): kartın overflow'u onu kesmez; ekranın dışına taşmaz (altta yer yoksa üstte). Esc kapatır.
import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { kirpildiMi } from './bicim';

/**
 * Verilen öğelerden biri kırpılmış mı (ölçüm). İlk değer tahmindir (kirpGerekli); yerleşimden hemen sonra ölçülür, boyut değişince
 * (ResizeObserver) ve yazı tipi yüklenince (yazı tipi takası metni genişletir) yeniden ölçülür. `anahtar` metin değişince ölçümü yeniler.
 */
export function useKirpildi(refler: readonly RefObject<HTMLElement | null>[], tahmin: boolean, anahtar: string): boolean {
  const [kesik, setKesik] = useState(tahmin);
  const reflerRef = useRef(refler);
  reflerRef.current = refler;
  useLayoutEffect(() => {
    const ogeler = reflerRef.current.map((r) => r.current).filter((e): e is HTMLElement => Boolean(e));
    if (!ogeler.length) return;
    let bitti = false;
    const olc = () => { if (!bitti) setKesik(ogeler.some((e) => kirpildiMi(e))); };
    olc();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(olc) : null;
    for (const e of ogeler) ro?.observe(e);
    void document.fonts?.ready.then(olc);
    return () => { bitti = true; ro?.disconnect(); };
  }, [anahtar]);
  return kesik;
}

export interface OdakOlaylari {
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/** Kırpılmış öğe klavyeyle odaklanınca tam metni gösteren ipucu: öğeye `olaylar` verilir, `ipucu` yanına çizilir. */
export function useOdakIpucu(kesik: boolean, metin: string): { olaylar: OdakOlaylari; ipucu: ReactNode } {
  const [hedef, setHedef] = useState<HTMLElement | null>(null);
  const olaylar: OdakOlaylari = {
    // Yalnız klavye odağı: fareyle tıklanan satırda ipucu açılmaz (fare için `title` var).
    onFocus: (e) => { if (kesik && e.currentTarget.matches(':focus-visible')) setHedef(e.currentTarget); },
    onBlur: () => setHedef(null),
    onKeyDown: (e) => { if (e.key === 'Escape' && hedef) { e.stopPropagation(); setHedef(null); } },
  };
  return { olaylar, ipucu: hedef && kesik ? <OdakIpucu hedef={hedef} metin={metin} /> : null };
}

function OdakIpucu({ hedef, metin }: { hedef: HTMLElement; metin: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [konum, setKonum] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const yerlestir = () => {
      const el = ref.current;
      if (!el) return;
      const r = hedef.getBoundingClientRect();
      const g = el.offsetWidth, y = el.offsetHeight, pay = 8, ara = 6;
      const altta = r.bottom + ara + y <= innerHeight - pay;
      setKonum({
        left: Math.round(Math.max(pay, Math.min(r.left, innerWidth - pay - g))),
        top: Math.round(altta ? r.bottom + ara : Math.max(pay, r.top - ara - y)),
      });
    };
    yerlestir();
    addEventListener('resize', yerlestir);
    addEventListener('scroll', yerlestir, true);
    return () => { removeEventListener('resize', yerlestir); removeEventListener('scroll', yerlestir, true); };
  }, [hedef, metin]);
  // Ekran okuyucu tam metni öğenin kendisinden okur (kırpma yalnız görseldir); ipucu görenler içindir → aria-hidden.
  return createPortal(
    <div ref={ref} className="ui-ipucu" aria-hidden="true" style={konum ?? { left: 0, top: 0, visibility: 'hidden' }}>{metin}</div>,
    document.body,
  );
}
