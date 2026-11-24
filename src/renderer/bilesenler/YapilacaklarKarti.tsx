// ── Kokpit "Yapılacaklar" kartı (0.11 G4) ──────────────────────────────────────────────────────────────────────────────────────
// İşaretlenen madde hemen siliniyordu; üstü çizilmeli. İşaretlenen madde silinmez: kütüphanenin
// Isaret'i onu soluk ve üstü çizili gösterir (160 ms; hareketi azalt anında), liste sırası açıklar önce işaretliler en altta (ana süreç:
// planlama.ts kokpitYapilacaklari). Aynı gün işareti kaldırınca madde geri gelir; ertesi gün karttan kalkar ve hafızaya "Tamamlananlar" olur.
// Kart kütüphanenin Kart'ıdır; ızgara hücresinin öznitelikleri (data-kart, data-onem, görünüm geçişi…) Kokpit'ten aynen geçer — G5
// ızgarayı kütüphane kartlarıyla yeniden kurarken bu bileşeni yerleştirir, yeniden yazmaz.
// SIĞMA: kartta kaydırma yok. Satır sayısı boya göre üst sınırdan (YAPILACAK_AZAMI) başlar ve KARTIN GERÇEK taşmasına göre azalır
// (iki satırlık başlık, alt yazı, "N öğe daha" notu ve alt şerit satır yüksekliğini değiştirir: sabit sayı yetmez); sığmayan açıklar
// "N öğe daha" notuna iner, işaretli madde yerinde kalır (yapilacakGorunumu). 0.11 G5 (denetleyici eki): sığmayan madde de erişilir —
// başlığın eylemi "Tümü · N" bütün maddeleri (açıklar + bugün işaretlenenler) aynı işaret kutularıyla levhada açar; klavyeyle gezilir.
import { useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import { Bos, Isaret, Kart, Liste } from '../ui';
import { cagir, saatTarih } from '../api';
import { KartAltligi } from '../pano/PanoKartlari';
import { TumuLevhasi, useTumu } from '../pano/TumuLevhasi';
import { TERIM } from '../../shared/terimler';
import { kartGorevleri, yapilacakAlt, yapilacakGorunumu, YAPILACAK_AZAMI } from '../../shared/yapilacaklar';
import type { Boy } from '../../shared/izgara';
import type { Istem } from '../../shared/kokpit-istemleri';
import type { Gorev, KokpitVerisi } from '../../shared/tipler';

export type YapilacaklarKartiOzellikleri = {
  v: KokpitVerisi;
  boy: Boy;
  sor: (istem: Istem) => void;
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'>;

/** İşaretle / işareti kaldır: ana süreç durumu yazar ve kokpiti yayınlar; kart yeni listeyle çizilir (madde yerinde kalır ya da altına iner). */
const isaretle = (g: Gorev, isaretli: boolean) => { void Promise.resolve(cagir('plan:gorev', g.id, { durum: isaretli ? 'tamam' : 'acik' })).catch(() => undefined); };

export function YapilacaklarKarti({ v, boy, sor, className, ...hucre }: YapilacaklarKartiOzellikleri) {
  const liste = kartGorevleri(v);
  const kok = useRef<HTMLDivElement>(null);
  // Kartın ölçüsü (genişlik × yükseklik): pencere/ızgara değişince başlıklar yeniden sarılır, sığan satır sayısı baştan hesaplanır.
  const [olcu, setOlcu] = useState('');
  // Sığan satır: anahtar (boy, ölçü, liste) değişince üst sınıra döner, sonra ölçümle azalır; anahtar aynıyken kullanılan sayı saklanır.
  const anahtar = `${boy}|${olcu}|${liste.map((g) => `${g.id}${g.durum === 'tamam' ? '+' : ''}`).join(',')}`;
  const [sigan, setSigan] = useState({ anahtar: '', n: 0 });
  const n = sigan.anahtar === anahtar ? sigan.n : YAPILACAK_AZAMI[boy];
  useLayoutEffect(() => {
    const kart = kok.current?.closest<HTMLElement>('.ui-kart');
    if (!kart || typeof ResizeObserver !== 'function') return;
    const olc = () => setOlcu(`${Math.round(kart.clientWidth)}x${Math.round(kart.clientHeight)}`);
    olc();
    const ro = new ResizeObserver(olc);
    ro.observe(kart);
    return () => ro.disconnect();
  }, []);
  // Her çizimden sonra: kart taşıyorsa bir satır eksilt (tarayıcı boyamadan önce biter; kullanıcı ara hâlleri görmez).
  useLayoutEffect(() => {
    const kart = kok.current?.closest<HTMLElement>('.ui-kart');
    if (kart && n > 1 && kart.scrollHeight > kart.clientHeight + 1) setSigan({ anahtar, n: n - 1 });
  });
  const { gorunen, gizli } = yapilacakGorunumu(liste, n);
  // Liste ilk `azami` satırı çizer, kalanı "N öğe daha" notuna sayar: sığmayan açıklar sona konur (çizilmez), sığanlar önde kalır.
  const satir = (g: Gorev) => <Isaret key={g.id} isaretli={g.durum === 'tamam'} metin={g.baslik} alt={yapilacakAlt(g, saatTarih) || undefined} degistir={(sec) => isaretle(g, sec)} />;
  const t = useTumu(liste.length, gizli.length);
  const acikSayi = liste.filter((g) => g.durum !== 'tamam').length;
  return (
    <Kart {...hucre} className={className} baslik={TERIM.yapilacaklar} eylem={t.eylem}>
      <div ref={kok} className="yapilacak">
        <Liste azami={gorunen.length} bos={<Bos baslik="Yapılacak yok" metin="Aklındaki işi Fuber’e söylemen yeter." />}>
          {[...gorunen, ...gizli].map(satir)}
        </Liste>
      </div>
      <KartAltligi tip="plan" v={v} boy={boy} sor={sor} />
      {t.acik && (
        <TumuLevhasi baslik={TERIM.yapilacaklar} alt={`${acikSayi} açık${liste.length > acikSayi ? ` · ${liste.length - acikSayi} bugün bitti` : ''}`} kapat={t.kapat}>
          <Liste>{liste.map(satir)}</Liste>
        </TumuLevhasi>
      )}
    </Kart>
  );
}
