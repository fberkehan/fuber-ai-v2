// ── Fark görünümü (Görev 28): eklenen/silinen satırlar, varsa iki numara sütunu, uzun farkta "Tamamını göster" ───────────────────
// Eş aralıklı yazı (sistem yazı tipleri; ağdan yazı tipi YOK). Renk tek başına anlam taşımaz: satır başında +/− işareti de var.
import { memo, useState } from 'react';
import type { FarkParcasi, FarkSatiri } from './fark';

const ISARET: Record<FarkSatiri['tur'], string> = { ayni: ' ', ekle: '+', sil: '−' };

/** `acik`/`acikDegistir` verilirse "Tamamını göster" dışarıda tutulur (sanal listede kart sökülüp yeniden takılınca kaybolmasın). */
export const FarkGorunumu = memo(function FarkGorunumu({ satirlar, parcalar, enCok = 14, acikBaslangic = false, etiket, acik: disAcik, acikDegistir }: {
  satirlar?: readonly FarkSatiri[]; parcalar?: readonly FarkParcasi[]; enCok?: number; acikBaslangic?: boolean; etiket?: string;
  acik?: boolean; acikDegistir?: (v: boolean) => void;
}) {
  const [icAcik, setIcAcik] = useState(acikBaslangic);
  const acik = disAcik ?? icAcik;
  const setAcik = (f: (a: boolean) => boolean) => { const v = f(acik); if (acikDegistir) acikDegistir(v); else setIcAcik(v); };
  const gruplar: readonly { baslik?: string; satirlar: readonly FarkSatiri[] }[] = parcalar ?? [{ satirlar: satirlar ?? [] }];
  const toplam = gruplar.reduce((n, g) => n + g.satirlar.length, 0);
  const numarali = gruplar.some((g) => g.satirlar.some((s) => s.eski !== undefined || s.yeni !== undefined));
  let kalan = acik ? Infinity : enCok;
  const gorunen = gruplar.map((g) => {
    const l = g.satirlar.slice(0, Math.max(0, kalan));
    kalan -= l.length;
    return { ...g, satirlar: l };
  }).filter((g, i) => g.satirlar.length || i === 0);
  const gizli = acik ? 0 : Math.max(0, toplam - enCok);
  if (!toplam) return <div className="cc-fark cc-fark--bos">Fark yok.</div>;
  return (
    <div className="cc-fark" data-numarali={numarali ? '' : undefined} role="table" aria-label={etiket ?? 'Fark'}>
      {gorunen.map((g, gi) => (
        <div key={gi} className="cc-fark__parca" role="rowgroup">
          {(g.baslik !== undefined || gi > 0) && <div className="cc-fark__baslik" role="row">{g.baslik ? `⋯ ${g.baslik}` : '⋯'}</div>}
          {g.satirlar.map((s, i) => (
            <div key={i} className="cc-fark__satir" data-tur={s.tur} role="row">
              {numarali && <span className="cc-fark__no" role="cell">{s.eski ?? ''}</span>}
              {numarali && <span className="cc-fark__no" role="cell">{s.yeni ?? ''}</span>}
              <span className="cc-fark__isaret" role="cell" aria-label={s.tur === 'ekle' ? 'eklendi' : s.tur === 'sil' ? 'silindi' : undefined}>{ISARET[s.tur]}</span>
              <span className="cc-fark__metin" role="cell">{s.metin || ' '}</span>
            </div>
          ))}
        </div>
      ))}
      {(gizli > 0 || (acik && toplam > enCok)) && (
        <button type="button" className="cc-katla" onClick={() => setAcik((a) => !a)} aria-expanded={acik}>
          {acik ? 'Daha az göster' : `Tamamını göster · ${gizli} satır daha`}
        </button>
      )}
    </div>
  );
});
