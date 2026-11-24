// Önizleme kabuğu (fintech): kurulumun sağ sütunu — o adımın CANLI önizlemesi bir "tepsi"nin (yuvarlak, kıl payı çizgili, sahneden bir ton
// ayrı yüzey) ortasında durur; içinde derinliği olan nesneler (Nesne: yüksek gölgeli kart). `dip`: tepsinin altında tek sakin satır.
// Levha: form katmanı (perde + ortada levha; Esc ve perde kapatır, odak levhada başlar). Masaüstüne özgü bir şey yok.
import { useEffect, useRef, type ReactNode } from 'react';
import { Ikon } from '../../bilesenler/Ikon';

export function Tepsi({ children, dip, etiket, className }: { children: ReactNode; dip?: ReactNode; etiket: string; className?: string }) {
  return (
    <section className={`ft-tepsi${className ? ` ${className}` : ''}`} aria-label={etiket} data-onizleme="">
      <div className="ft-tepsi__ic">{children}</div>
      {dip && <p className="ft-tepsi__dip">{dip}</p>}
    </section>
  );
}

export function Nesne({ children, className, ...geri }: { children: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return <div className={`ft-nesne${className ? ` ${className}` : ''}`} {...geri}><div className="ft-nesne__ic">{children}</div></div>;
}

export function Levha({ baslik, kapat, children, etiket }: { baslik: ReactNode; kapat: () => void; children: ReactNode; etiket: string }) {
  const kok = useRef<HTMLDivElement>(null);
  const kapatRef = useRef(kapat);
  kapatRef.current = kapat;
  useEffect(() => {
    const once = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => kok.current?.querySelector<HTMLElement>('input, button:not([data-levha-kapat])')?.focus({ preventScroll: true }));
    const tus = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kapatRef.current(); } };
    addEventListener('keydown', tus, true);
    return () => { removeEventListener('keydown', tus, true); once?.focus?.({ preventScroll: true }); };
  }, []);
  return (
    <div className="ft-levha-perde" onMouseDown={(e) => { if (e.target === e.currentTarget) kapatRef.current(); }} data-levha="">
      <div ref={kok} className="ft-levha" role="dialog" aria-modal="true" aria-label={etiket}>
        <div className="ft-levha__bas">
          <h2 className="ft-ara">{baslik}</h2>
          <button type="button" className="ft-hap ft-hap--hayalet ft-hap--k" data-levha-kapat="" aria-label="Kapat" onClick={() => kapatRef.current()}><Ikon ad="kapat" olcu={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
