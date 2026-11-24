// İlerleme çizgisi (fintech): ince iz + yayla dolan çizgi + gerçek ilerlemeyi gösteren adım sayısı ("3 / 11"). Solda uzun sayfa haritası yok.
import type { CSSProperties } from 'react';

export function IlerlemeCizgisi({ simdi, toplam, etiket = 'Kurulum ilerlemesi' }: { simdi: number; toplam: number; etiket?: string }) {
  const oran = toplam > 0 ? Math.min(1, Math.max(0, simdi / toplam)) : 0;
  return (
    <div className="ft-ilerleme" data-ilerleme={`${simdi}/${toplam}`}>
      <div className="ft-ilerleme__iz" role="progressbar" aria-label={etiket} aria-valuemin={1} aria-valuemax={toplam} aria-valuenow={simdi} aria-valuetext={`${simdi} / ${toplam}`}>
        <span className="ft-ilerleme__dolu" style={{ '--ft-oran': oran } as CSSProperties} />
      </div>
      <span className="ft-ilerleme__sayi" aria-hidden="true">{simdi} / {toplam}</span>
    </div>
  );
}
