// ── Eski kurulum › Görünüm: Koyu / Açık ─────────────────────────────────────────────────────────────────────────────────────────────
// 0.12 H3a: yeni kurulumda (renderer/kurulum2) Görünüm sorusu YOK (varsayılan Otomatik; Ayarlar → Görünüm). Bu sayfa yalnız eski
// sihirbazın kodunda kalır (bütün adımlar kurulum2'ye taşınana dek); "Buzlu cam" kartı kalktı (tema yok).
// Her kartta o temanın küçük canlı önizlemesi: masaüstü, Fuber penceresi ve üst ortada inen ada. Kutu kendi temasının belirteçlerini taşır
// ([data-tema-kutu], tasarim.css), sayfanın temasından bağımsız. Seçim anında uygulanır (ayarlar:kaydet → ana süreç → 'tema:degisti').
import { Ikon } from '../bilesenler/Ikon';
import { AdaSahnesi } from './AdaKopyasi';
import { Bas } from './Adimlar';
import { temaGocu } from '../../shared/tema-cozum';
import type { Ayarlar, Tema } from '../../shared/tipler';

const KARTLAR: { tema: 'koyu' | 'acik'; ad: string; metin: string; ikon: string }[] = [
  { tema: 'koyu', ad: 'Koyu', metin: 'Siyah sahne, siyah ada. Göz yormaz, odakta tutar.', ikon: 'ay' },
  { tema: 'acik', ad: 'Açık', metin: 'Beyaz ada, yumuşak gölge. Aydınlık ofiste ferah.', ikon: 'gunes' },
];

export function TemaAdimi({ ayar, kaydet }: { ayar: Ayarlar; kaydet: (d: Partial<Ayarlar>) => void }) {
  const secili: Tema = temaGocu(ayar.gorunum?.tema);
  const sec = (t: Tema) => { if (t !== secili) kaydet({ gorunum: { ...ayar.gorunum, tema: t } }); };

  return (
    <>
      <Bas baslik="Nasıl görüneyim?" giris="Seçtiğin anda uygulanır. Ekranın üstünden inen bildirimlerim de bu renkte olur." />
      <div className="tema-kartlari" role="radiogroup" aria-label="Tema">
        {KARTLAR.map((k) => (
          <button key={k.tema} type="button" role="radio" className="tema-karti" data-tema-sec={k.tema} aria-checked={secili === k.tema} onClick={() => sec(k.tema)}>
            <div className="tema-onizleme" data-tema-kutu={k.tema}><AdaSahnesi olcek="mini" /></div>
            <div className="tema-karti__yazi">
              <span className="tema-karti__ad"><Ikon ad={k.ikon} olcu={15} />{k.ad}{secili === k.tema && <span className="tema-karti__isaret"><Ikon ad="tamam" olcu={13} kalinlik={2.4} /></span>}</span>
              <span className="tema-karti__metin">{k.metin}</span>
            </div>
          </button>
        ))}
      </div>
      <p className="kurulum__dip">Windows’un temasına uymasını istersen sonra Ayarlar → Görünüm → Otomatik.</p>
    </>
  );
}
