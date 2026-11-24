// ── Panelin Görevler sayfası (0.14 T24) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Solda süren iş sayısı iri ve sıkı (BuyukSayi); sağda satırlar (en çok 3): eşiği aşan sohbet turu (çentiğin Çalışıyor hapıyla aynı kaynak, 'ada:calisiyor'),
// süren görevler ve bugün bitenler (shared/centik-veri.ts gorevlerSayfasi; cümleler Görevler kartıyla aynı: shared/isler-gorunum.ts). Düğmeler hap:
// Durdur sohbet turunu çentiğin Çalışıyor hapının yolundan (calisiyorDurdur → sohbet:durdur), görevi görev hapının yolundan (gorevDurdur → isler:durdur)
// keser — IPC düşerse aynı tek satır hata (gorevHatasi). Duran görevde Sürdür (isler:surdur). Görevler 'isler:durum' ile tazelenir (yoklama yok).
// Karakter yok (Sade modda da); vurgu Panel'in --panel-vurgu'su.
import { useState, type ReactElement } from 'react';
import { cagir } from '../../api';
import { BuyukSayi, HapDugme } from '../../ui/fintech';
import { gorevlerSayfasi, type GorevSatiri } from '../../../shared/centik-veri';
import { GOREV_SURDUR_HATASI } from '../../../shared/isler-gorunum';
import { useAdaBaglami } from '../useAsistan';
import { useCentikVerisi } from './useCentikVerisi';

export function Gorevler(): ReactElement {
  const { a } = useAdaBaglami();
  const v = useCentikVerisi();
  const [surdurHatasi, setSurdurHatasi] = useState('');
  const s = gorevlerSayfasi(v?.gorevler.isler ?? [], a.calisiyor ?? null, Date.now(), v?.gorevler.mod ?? 'is');
  const eylem = (e: NonNullable<GorevSatiri['eylem']>) => {
    if (e.kanal === 'sohbet:durdur') a.calisiyorDurdur(e.id);
    else if (e.kanal === 'isler:durdur') a.gorevDurdur(e.id);
    else { setSurdurHatasi(''); void Promise.resolve(cagir('isler:surdur', e.id)).catch(() => setSurdurHatasi(GOREV_SURDUR_HATASI)); }
  };
  const hata = a.gorevHatasi || surdurHatasi;
  return (
    <div className="gorevler-sayfa">
      <div className="gorevler-sayfa__sayi">
        <BuyukSayi deger={s.suren} etiket="süren iş" />
      </div>
      <div className="gorevler-sayfa__sag">
        {s.bos
          ? <span className="gorevler-sayfa__bos" data-gorevler-bos="">{s.bos}</span>
          : (
            <ul className="gorevler-sayfa__liste">
              {s.ogeler.slice(0, 3).map((o) => (
                <li key={o.anahtar} className="gorevler-sayfa__satir" data-gorev-satiri={o.anahtar}>
                  <span className="gorevler-sayfa__metin">
                    <span className="gorevler-sayfa__baslik" title={o.baslik}>{o.baslik}</span>
                    <span className="gorevler-sayfa__alt" title={o.alt}>{o.alt}</span>
                  </span>
                  {o.eylem
                    ? <HapDugme tur={o.eylem.tur === 'durdur' ? 'birincil' : 'ikincil'} boy="k" data-gorev-eylem={o.eylem.kanal}
                        {...(o.eylem.tur === 'durdur' ? { onMouseEnter: () => a.durdurFare(true), onMouseLeave: () => a.durdurFare(false) } : {})}
                        onClick={() => eylem(o.eylem!)}>{o.eylem.tur === 'durdur' ? 'Durdur' : 'Sürdür'}</HapDugme>
                    : <span className="gorevler-sayfa__rozet">{o.rozet.metin}</span>}
                </li>
              ))}
            </ul>
          )}
        {hata && <p className="centik-not centik-not--hata" role="alert">{hata}</p>}
      </div>
    </div>
  );
}
