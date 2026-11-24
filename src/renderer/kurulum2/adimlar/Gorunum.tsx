// Kurulum v2 › Görünüm (0.13 spec B): Otomatik · Koyu · Açık · Şeffaf (Şeffaf yalnız bu bilgisayar destekliyorsa: shared/tema-cozum.ts sunulanTemalar;
// liste shared/kurulum-taslak.ts gorunumSecenekleri). Seçim YALNIZ taslakta kalır ve kurulum bitince uygulanır (Kurulum2.tsx): kurulum penceresi her durumda opak, "Vazgeç" hiçbir
// şey yazmaz. Sağda Adım 3'teki GERÇEK karşılama kartı (Tanisma.tsx KokpitKarti) seçilen temaya göre çizilir (0.13.1; gri iskelet kalktı); Otomatik'te gündüz ve
// gece çapraz yan yana. Pencerenin o anki temasından farklı bir tema gösterildiği için belirteçler kartın kabında yeniden tanımlanır (kurulum2.css
// .k2-tema__katman[data-tur]); gerçek pencereye dokunmaz.
import { SecimGrubu, Tepsi } from '../../ui/fintech';
import { gorunumSecenekleri } from '../../../shared/kurulum-taslak';
import { sunulanTemalar } from '../../../shared/tema-cozum';
import { useCamDestegi } from '../../cam-destegi';
import { KM } from '../../../shared/kurulum-metin';
import { useAdim } from '../baglam';
import { Bas, kademe } from '../Ortak';
import { KokpitKarti } from './Tanisma';

export function GorunumAdimi() {
  const { taslak: t, degistir, m } = useAdim();
  // Şeffaf yalnız bu bilgisayar destekliyorsa sunulur (Windows 11 22H2+ / macOS; ana süreç bildirir). Başka bilgisayardan gelen 'cam' taslağı
  // burada Koyu seçili görünür.
  const sunulan = sunulanTemalar(useCamDestegi());
  const secili = sunulan.includes(t.tema) ? t.tema : 'koyu';
  const aciklama = (g: { deger: string; aciklama: string }) => (g.deger === 'sistem' ? m(KM.gorunumSistem) : g.deger === 'cam' ? m(KM.gorunumCam) : g.aciklama);
  return (
    <div className="k2-adim" data-gorunum="">
      <Bas baslik="Nasıl görüneyim?" giris={m(KM.gorunumGiris)} />
      <div {...kademe(2)}>
        <SecimGrubu etiket="Görünüm" deger={secili} sec={(tema) => degistir({ tema })} secenekler={gorunumSecenekleri(sunulan).map((g) => ({ ...g, aciklama: aciklama(g), onerilen: g.deger === 'sistem' }))} />
      </div>
    </div>
  );
}

/** Temalı kab: gerçek karşılama kartı, o temanın belirteçleriyle. */
function Katman({ tur }: { tur: string }) {
  return <div className="k2-tema__katman" data-tur={tur}><KokpitKarti /></div>;
}

export function GorunumOnizleme() {
  const { taslak: t } = useAdim();
  const g = gorunumSecenekleri().find((x) => x.deger === t.tema);
  return (
    <Tepsi etiket="Görünüm önizlemesi">
      <div className="k2-tema" data-onizleme-tema={t.tema} aria-hidden="true">
        {t.tema === 'sistem' ? <><Katman tur="koyu" /><Katman tur="acik" /></> : <Katman tur={t.tema} />}
      </div>
      <p className="k2-tema__ad"><b>{g?.baslik}</b></p>
    </Tepsi>
  );
}
