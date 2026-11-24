// ── Çentiğin biçimi: dokuz dilim (0.14 T19, R15; T28 düzeltme turu 1: aynalı) ───────────────────────────────────────
// Çentik ekranın üst kenarıyla kaynaşık siyah bir şekildir: iki yanda 12 px'lik ters köşe omuz, altta haplarda boy/2, içerikli hâllerde ve açık panelde 28 px
// köşe (ölçüler ve kural: centik-olcu.ts). Genişlik, yükseklik ve köşe yarıçapı HİÇ canlandırılmaz (Hafiflik: yalnız transform ve opacity): şekil sabit ölçülü
// parçalardan kurulur, her parça yalnız `transform` alır —
//   · üst gövde yarısı ve alt gövde yarısı: 100×100'lük kare `translate` + `scale` ile gerilir (düz renk, bozulma yok);
//   · alt köşe: çeyrek daire, eş eksenli `scale` ile köşe yarıçapına büyür (daire daire kalır) ve `translate` ile yerine gider;
//   · omuz: 12 px'lik ters köşe, yalnız `translate` (gizlenirken `scale(0)`).
// Parçalar YALNIZ sol yarı için hesaplanır (yariParcalari); sağ yarı aynı parçaların durağan `scaleX(-1)` aynasıdır (ada.css `.ada-bicim__yari--ayna`; kap
// canlandırılmaz). Böylece iki yanın her dış kenarı tek bir öteleme değerinden geçer ve şekil yapı gereği simetriktir (T28: eskiden sağ kenar `öteleme + taban ×
// ölçek` toplamıydı, açık panelde 2–3 aygıt pikseli basamak yapıyordu). Bütün parçalar aynı süre ve eğriyle geçer (ada.css `.ada-bicim__parca`); komşu parçalar
// yarım/1 px örtüşür (alt piksel dikiş görünmesin). Renk `--centik-dolgu` (her temada #000; ada.css).
// Tıklama yakalamaz: imleç kutusu Ada.tsx'teki `.ada__sekil`dir (anında yerleşir, canlandırılmaz).
import { yariParcalari } from './centik-olcu';

export interface CentikSekliOzellikleri {
  /** Şeklin eni ve boyu (CSS px, ölçek 1; ölçek kökte `zoom` ile uygulanır). */
  en: number;
  boy: number;
  /** Alt köşe yarıçapı (centik-olcu.ts centikKosesi). */
  kose: number;
  /** Omuzlar görünsün mü (şekil üst kenara toplanırken söner). */
  omuz?: boolean;
}

const SINIF = { ust: 'ada-bicim__govde', alt: 'ada-bicim__govde', kose: 'ada-bicim__kose', omuz: 'ada-bicim__omuz' } as const;

export function CentikSekli({ en, boy, kose, omuz = true }: CentikSekliOzellikleri) {
  const parcalar = yariParcalari(en, boy, kose, omuz).map((p) => (
    <i key={p.ad} className={`ada-bicim__parca ${SINIF[p.ad]}`} style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${p.sx}, ${p.sy})` }} />
  ));
  return (
    <div className="ada-bicim" aria-hidden="true">
      <div className="ada-bicim__yari">{parcalar}</div>
      <div className="ada-bicim__yari ada-bicim__yari--ayna">{parcalar}</div>
    </div>
  );
}
