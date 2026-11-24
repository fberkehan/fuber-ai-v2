// Adım geçişi (fintech; spec "Hareket"): yeni adım yay eğrisiyle (~420 ms, --ft-yay) 24 px kayarak ve belirerek gelir; eski adım aynı ızgara
// hücresinde kısa (200 ms) solarak çıkar — iki katman üst üste, yerleşim zıplamaz. `yon` ileri (1) / geri (-1): içerik geldiği yönden girer,
// gittiği yöne çıkar (Apple: mekânsal tutarlılık). `gecikme`: önizleme sütunu içerikten 60 ms sonra değişir (ayrı ritim). İçerideki
// `data-kademe` öğeleri (başlık → metin → denetimler; `--k` sırası) kademeli gelir. Azaltılmış harekette yalnız opaklık (fintech.css).
// Çıkan katman `inert` ve aria-hidden: odak ve ekran okuyucu yalnız yeni adımda.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Çıkan katmanın kalma süresi (ms; fintech.css ft-cik 200 ms + pay). */
const CIKIS_MS = 240;

export function AdimGecisi({ anahtar, yon = 1, gecikme = 0, children, className }: {
  anahtar: string; yon?: 1 | -1; gecikme?: number; children: ReactNode; className?: string;
}) {
  const kayit = useRef<{ k: string; el: ReactNode }>({ k: anahtar, el: children });
  const [cikan, setCikan] = useState<{ k: string; el: ReactNode } | null>(null);
  useLayoutEffect(() => {
    if (kayit.current.k !== anahtar) setCikan(kayit.current);
    kayit.current = { k: anahtar, el: children };
  });
  useEffect(() => {
    if (!cikan) return;
    const z = setTimeout(() => setCikan(null), CIKIS_MS + gecikme);
    return () => clearTimeout(z);
  }, [cikan, gecikme]);
  const stil = { '--ft-yon': yon, '--ft-gecikme': `${gecikme}ms` } as CSSProperties;
  return (
    <div className={`ft-gecis${className ? ` ${className}` : ''}`} style={stil}>
      {cikan && cikan.k !== anahtar && <div key={cikan.k} className="ft-gecis__kat" data-gecis="cik" aria-hidden="true" inert>{cikan.el}</div>}
      <div key={anahtar} className="ft-gecis__kat" data-gecis="gir">{children}</div>
    </div>
  );
}
