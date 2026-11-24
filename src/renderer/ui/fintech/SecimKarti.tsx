// Seçim kartı (fintech): simge + başlık + tek satır açıklama; önerilen seçenekte sakin "Önerilen" rozeti. Basınca 0,98 (anında); seçilince
// kıl payı halka + yumuşak iç parıltı + sağda onay dairesi (renk yok). SecimGrubu radyo grubudur (←/→ ↑/↓; kapalı kart atlanır).
import { useId, type ReactNode } from 'react';
import { Ikon } from '../../bilesenler/Ikon';
import { radyoTusu } from './radyo';

export interface SecimSecenegi<T extends string> {
  deger: T;
  baslik: string;
  aciklama?: ReactNode;
  simge?: string;
  onerilen?: boolean;
  kapali?: boolean;
  /** Erişilebilir ad (görünen başlık + rozetten farklıysa; ör. "Fuber (önerilen)"). */
  etiket?: string;
}

export function SecimKarti<T extends string>({ s, secili, sec }: { s: SecimSecenegi<T>; secili: boolean; sec: (v: T) => void }) {
  const aciklamaId = useId();
  return (
    <button
      type="button" role="radio" className="ft-secim" data-deger={s.deger} aria-checked={secili} aria-disabled={s.kapali || undefined} aria-label={s.etiket}
      aria-describedby={s.etiket && s.aciklama ? aciklamaId : undefined}
      tabIndex={secili ? 0 : -1} onClick={() => { if (!s.kapali) sec(s.deger); }}
    >
      <span className="ft-secim__simge" aria-hidden="true"><Ikon ad={s.simge ?? 'tamam'} olcu={20} /></span>
      <span className="ft-secim__yazi">
        <span className="ft-secim__baslik">{s.baslik}{s.onerilen && <span className="ft-rozet">Önerilen</span>}</span>
        {s.aciklama && <span className="ft-secim__aciklama" id={aciklamaId}>{s.aciklama}</span>}
      </span>
      <span className="ft-secim__isaret" aria-hidden="true"><Ikon ad="tamam" olcu={13} kalinlik={2.6} /></span>
    </button>
  );
}

export function SecimGrubu<T extends string>({ etiket, secenekler, deger, sec, yan = false }: {
  etiket: string; secenekler: readonly SecimSecenegi<T>[]; deger: T; sec: (v: T) => void; yan?: boolean;
}) {
  const acik = secenekler.filter((s) => !s.kapali).map((s) => s.deger);
  return (
    <div className={`ft-secimler${yan ? ' ft-secimler--yan' : ''}`} role="radiogroup" aria-label={etiket} onKeyDown={(e) => radyoTusu(e, acik, deger, sec)}>
      {secenekler.map((s) => <SecimKarti key={s.deger} s={s} secili={s.deger === deger} sec={sec} />)}
    </div>
  );
}
