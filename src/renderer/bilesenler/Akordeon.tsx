// ── Akordeon: başlığa basınca açılan kart (Ayarlar grupları; kurulum ve abonelik ekranları da kullanabilir) ───────────────
// Başlık bir <button> (aria-expanded / aria-controls), gövde bölge (region). Kapalı gövde görünmez (visibility: hidden): sekme
// sırasına ve ekran okuyucuya girmez, ama içerik takılı kalır (durumunu kaybetmez, açılınca yeniden yüklenmez). Yükseklik CSS
// ızgarasıyla (0fr → 1fr) 240 ms açılır; `aninda` (aramadan/çapadan gelinen grup) ve az hareket tercihinde canlandırma yok.
// Denetimli (`acik` + `degistir`) ya da kendi durumuyla (`varsayilanAcik`) kullanılır.
import { useId, useState, type ReactNode } from 'react';
import { Ikon } from './Ikon';
import './akordeon.css';

export interface AkordeonOzellikleri {
  baslik: ReactNode;
  aciklama?: ReactNode;
  /** Başlığın sağında kısa durum ("Koyu", "Açık"). */
  ozet?: ReactNode;
  /** Ikon adı (başlığın solunda). */
  simge?: string;
  acik?: boolean;
  varsayilanAcik?: boolean;
  degistir?: (acik: boolean) => void;
  /** Bu açılış canlandırmasız (kaydırma hemen doğru yere gitsin). */
  aninda?: boolean;
  id?: string;
  className?: string;
  /** Kök öğeye eklenecek data-* nitelikleri (betikler ve vurgu için). */
  veri?: Record<`data-${string}`, string>;
  children: ReactNode;
}

export function Akordeon({ baslik, aciklama, ozet, simge, acik, varsayilanAcik = false, degistir, aninda, id, className, veri, children }: AkordeonOzellikleri) {
  const [ic, setIc] = useState(varsayilanAcik);
  const taban = useId();
  const acikMi = acik ?? ic;
  const basId = `${id ?? taban}-bas`;
  const govdeId = `${id ?? taban}-govde`;
  const cevir = () => { if (acik === undefined) setIc(!acikMi); degistir?.(!acikMi); };
  return (
    <section id={id} className={`akordeon kart${className ? ` ${className}` : ''}`} data-acik={acikMi} data-aninda={aninda ? '' : undefined} {...veri}>
      <h3 className="akordeon__kap">
        <button type="button" id={basId} className="akordeon__bas" aria-expanded={acikMi} aria-controls={govdeId} onClick={cevir}>
          {simge && <span className="akordeon__simge"><Ikon ad={simge} olcu={16} /></span>}
          <span className="akordeon__metin">
            <span className="akordeon__baslik">{baslik}</span>
            {aciklama && <span className="akordeon__aciklama">{aciklama}</span>}
          </span>
          {ozet ? <span className="akordeon__ozet">{ozet}</span> : <span />}
          <Ikon ad="asagi" olcu={18} className="akordeon__ok" />
        </button>
      </h3>
      <div id={govdeId} className="akordeon__govde" role="region" aria-labelledby={basId} inert={!acikMi}>
        <div className="akordeon__ic"><div className="akordeon__icerik">{children}</div></div>
      </div>
    </section>
  );
}
