// Araç adımları (0.11 G6): sohbette ve adada her adım TEK satır — simge · insan diliyle ne yapıldığı · durum (sürüyor / tamam / olmadı);
// ardışık adımlar "N adım" diye tek satırda toplanır, açılınca liste (shared/arac-satiri.ts aracSatiri: satırın metni tek yerde kurulur).
// Araç adımlarının tasarımı tutarsızdı. Fuber arayüz kütüphanesinden (Kart, Liste, Satir, Rozet, Dugme); renderer/bilesenler/sohbet-kartlari.css.
//   · İş: ham girdi/çıktı, araç adı ve koordinat yok; satır tıklanmaz (ekran görüntüsü varsa küçük önizleme kalır).
//   · Geliştirici: satır tıklanınca "Ayrıntılar" açılır — araç adı, ham girdi (yazılan metin yalnız karakter sayısı: P10) ve çıktı.
//   · Ada: ilk 3 adım + "N adım daha · Sohbette gör" (ada dar; tamamı ana sohbette).
import { useState } from 'react';
import { cagir } from '../api';
import { useMod } from '../mod';
import { Dugme, Kart, Liste, Rozet, Satir } from '../ui';
import { Ikon } from './Ikon';
import { KatliSatir } from '../is-izi/IsSeridi';
import { adimGorunurMu, aracSatiri, ayrintiMetni, type AracSatiriSonucu } from '../../shared/arac-satiri';
import type { AracBlok, Mod } from '../../shared/tipler';
import './sohbet-kartlari.css';

interface Adim { b: AracBlok; s: AracSatiriSonucu }

const hesapla = (b: AracBlok, mod: Mod): Adim => ({ b, s: aracSatiri(b.ad, b.girdi, { durum: b.durum, ozet: b.ozet, etiket: b.etiket }, mod) });

function Durum({ durum }: { durum: AracSatiriSonucu['durum'] }) {
  if (durum === 'suruyor') return <span className="arac-durum" role="img" aria-label="Sürüyor"><span className="donen" /></span>;
  if (durum === 'tamam') return <span className="arac-durum" role="img" aria-label="Tamam"><Ikon ad="tamam" olcu={15} kalinlik={2} /></span>;
  return <Rozet ton="hata">Olmadı</Rozet>;
}

function Ayrinti({ b }: { b: AracBlok }) {
  return (
    <div className="arac-ayrinti" data-arac-ayrinti="">
      <p className="arac-ayrinti__baslik">Ayrıntılar · {b.ad}</p>
      <pre className="arac-ayrinti__kod">{ayrintiMetni(b.ad, b.girdi)}</pre>
      {b.ozet && <><p className="arac-ayrinti__baslik">Çıktı</p><pre className="arac-ayrinti__kod">{b.ozet}</pre></>}
    </div>
  );
}

/** Bir adım: tek satır (+ Geliştirici'de açılan ayrıntı, ekran görüntüsü önizlemesi, "Oturumu aç"). `ayrinti`: satır tıklanıp açılabilir (Geliştirici, sohbet). */
function AdimSatiri({ adim, ayrinti }: { adim: Adim; ayrinti: boolean }) {
  const [acik, setAcik] = useState(false);
  const { b, s } = adim;
  return (
    <>
      <Satir
        sol={<Ikon ad={s.simge} olcu={16} />}
        baslik={s.metin}
        satir={2}
        sag={<Durum durum={s.durum} />}
        tikla={ayrinti ? () => setAcik((x) => !x) : undefined}
        aria-expanded={ayrinti ? acik : undefined}
        data-arac-satir=""
        data-durum={b.durum}
        data-arac={b.ad}
      />
      {ayrinti && acik && <Ayrinti b={b} />}
      {b.gorsel && <img className="arac-gorsel" src={b.gorsel} alt="" />}
      {/* Görev 28 düzeltme 1: Claude Code işi → o oturum (Claude Code sayfası). Telefonda sayfa yok. */}
      {b.yol && window.fuber?.platform !== 'cep' && (
        <Dugme tur="ikincil" boyut="k" simge="kod" data-arac-git={b.yol} onClick={() => { void cagir('ana:goster', b.yol); }}>Oturumu aç</Dugme>
      )}
    </>
  );
}

/** İki ya da daha çok ardışık adım: "N adım" satırı; açılınca her adım kendi satırında. */
function Grup({ adimlar, ayrinti }: { adimlar: Adim[]; ayrinti: boolean }) {
  const [acik, setAcik] = useState(false);
  const suren = adimlar.find((a) => a.s.durum === 'suruyor');
  const olmayan = adimlar.filter((a) => a.s.durum === 'hata').length;
  const durum: AracSatiriSonucu['durum'] = suren ? 'suruyor' : olmayan ? 'hata' : 'tamam';
  return (
    <div className="arac-grup">
      <Satir
        sol={<Ikon ad="liste" olcu={16} />}
        baslik={`${adimlar.length} adım`}
        alt={suren ? suren.s.metin : olmayan ? `${olmayan} adım olmadı` : 'Tamamlandı'}
        sag={<><Durum durum={durum} /><span className="arac-chevron" aria-hidden="true"><Ikon ad="asagi" olcu={15} /></span></>}
        tikla={() => setAcik((x) => !x)}
        aria-expanded={acik}
        data-arac-grup=""
        data-durum={durum === 'suruyor' ? 'calisiyor' : durum}
      />
      {acik && (
        <div className="arac-grup__liste">
          <Liste>{adimlar.map((a) => <AdimSatiri key={a.b.id} adim={a} ayrinti={ayrinti} />)}</Liste>
        </div>
      )}
    </div>
  );
}

/**
 * Ardışık araç adımlarının kartı. Sohbet: tek adım tek satır, ikiden çok adım "N adım" (katlanır). Ada (`ada`): ilk 3 adım ayrı satırlarda,
 * kalanı "N adım daha · Sohbette gör" (`sohbeteGit`).
 */
export function AracAdimlari({ bloklar, ada, sohbeteGit }: { bloklar: AracBlok[]; ada?: boolean; sohbeteGit?: () => void }) {
  const mod: Mod = useMod() ?? 'is';
  const [katliAcik, setKatliAcik] = useState(false);
  // İş'te başarısız kart_goster satırı gösterilmez (gürültü: model yeniden dener); grup özeti gizlenenleri saymaz, görünür adım yoksa kart hiç çıkmaz.
  const adimlar = bloklar.filter((b) => adimGorunurMu(b.ad, b.durum, mod)).map((b) => hesapla(b, mod));
  if (!adimlar.length) return null;
  const ayrinti = mod === 'gelistirici' && !ada;
  if (ada) {
    const gorunen = adimlar.slice(0, 3);
    const kalan = adimlar.slice(3);
    const suren = kalan.find((a) => a.s.durum === 'suruyor');
    return (
      <Kart yogun className="arac-adim" aria-label="Araç adımları" data-arac-adim="ada">
        <Liste>{gorunen.map((a) => <AdimSatiri key={a.b.id} adim={a} ayrinti={false} />)}</Liste>
        {kalan.length > 0 && (
          <Satir
            sol={<Ikon ad="liste" olcu={16} />}
            baslik={`${kalan.length} adım daha`}
            alt={suren?.s.metin}
            sag={sohbeteGit ? <>Sohbette gör<Ikon ad="ileri" olcu={14} /></> : undefined}
            tikla={sohbeteGit}
            data-arac-devami=""
          />
        )}
      </Kart>
    );
  }
  // 11 Kas ("biten agentlar chatte çok büyük yer kaplıyor"): bitmiş çok adımlı grup kart değil, tek katlı satır ("✓ 6 adım"); tıklayınca adımlar açılır.
  // Süren grup kartında kalır.
  if (adimlar.length > 1 && !adimlar.some((a) => a.s.durum === 'suruyor')) {
    const olmayan = adimlar.filter((a) => a.s.durum === 'hata').length;
    return (
      <div className="arac-adim arac-adim--katli" data-arac-adim="katli">
        <KatliSatir metin={`${adimlar.length} adım${olmayan ? ` · ${olmayan} olmadı` : ''}`} tamam={!olmayan} acik={katliAcik} degistir={setKatliAcik} etiket="Araç adımları">
          <Liste>{adimlar.map((a) => <AdimSatiri key={a.b.id} adim={a} ayrinti={ayrinti} />)}</Liste>
        </KatliSatir>
      </div>
    );
  }
  return (
    <Kart yogun className="arac-adim" aria-label={adimlar.length > 1 ? 'Araç adımları' : 'Araç adımı'} data-arac-adim={adimlar.length > 1 ? 'grup' : 'tek'}>
      {adimlar.length > 1 ? <Grup adimlar={adimlar} ayrinti={ayrinti} /> : <AdimSatiri adim={adimlar[0]} ayrinti={ayrinti} />}
    </Kart>
  );
}
