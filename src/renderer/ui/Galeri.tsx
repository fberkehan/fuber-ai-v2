// Arayüz kütüphanesi galerisi (0.11 G3): YALNIZ test derlemesinde (FUBER_DEMO) #galeri adresinde açılan geliştirici sayfası
// (galeri-kapisi.ts; main.tsx tembel yükler). Her bileşen iki genişlikte (320 ve 520 px kart), normal ve ZORLAYICI veriyle (galeri-veri.ts:
// 200 karakterlik başlık, 60+ karakterlik tek sözcük, çok uzun şehir, boş, hata, yükleniyor, 0 ve 7 haneli sayı). Tema uygulamanın
// temasıdır (üstteki seçici Ayarlar → Görünüm'le aynı alanı yazar). scripts/dev/ui-onizle.mjs üç temada, iki pencere boyunda her öğeyi
// ölçer: taşma (tasma.mjs), okunurluk ve kontrast (okunurluk.mjs). [data-galeri-ornek] her örnek kartın adıdır (hata iletilerinde görünür).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { cagir, dinle } from '../api';
import type { Ayarlar } from '../../shared/tipler';
import { GOZ_IFADELERI, GOZ_TETIKLERI, type GozHali, type GozIfadesi, type GozTetigi } from '../../shared/goz';
import { Ikon } from '../bilesenler/Ikon';
import { Ayrac, Bos, Dugme, EKRANLAR, Ilerleme, Isaret, Iskelet, Kart, Liste, MetinKirp, Rozet, SAYFA_VURGUSU, Satir, Sayi, Sekmeler, vurguRengi, vurguStili, type EkranAdi } from './index';
import { Anahtar } from './fintech';
import { AracAdimlari } from '../bilesenler/AracAdimlari';
import { YapayZekaKarti } from '../bilesenler/YapayZekaKarti';
import { ARAC_ORNEKLERI, HABERLER, HATIRLATICILAR, HAVA, KART_ORNEKLERI, KART_ZORLAYICI, PIYASA, SAYILAR, YAPILACAKLAR, ZORLAYICI, type HavaOrnegi } from './galeri-veri';
import { Gozler, GorunenGoz, ModGecisi, SadeIsaret, type SadeHal } from './goz';
import { useKarakterGorunur } from '../karakter-gorunum';
import type { KipKimligi } from '../../shared/karakterler';
import './galeri.css';

const GENISLIKLER = [320, 520] as const;
type Genislik = (typeof GENISLIKLER)[number];

/** Bir bölüm: başlık + her genişlikte bir sütun; `ornek(genislik)` o sütunun kartlarını çizer. */
function Bolum({ ad, bilesenler, not, ornek }: { ad: string; bilesenler: string; not?: string; ornek: (g: Genislik) => ReactNode }) {
  return (
    <section className="galeri__bolum" data-bilesen={bilesenler}>
      <div className="galeri__bolum-bas">
        <h2 className="galeri__bolum-baslik">{ad}</h2>
        {not && <p className="galeri__not">{not}</p>}
      </div>
      <div className="galeri__ikili">
        {GENISLIKLER.map((g) => (
          <div key={g} className="galeri__sutun" style={{ width: g }}>
            <span className="galeri__olcu">{g} px</span>
            {ornek(g)}
          </div>
        ))}
      </div>
    </section>
  );
}

// 0.13 T13: Şeffaf geri geldi; 0.14 T29: seçici ortak Sekmeler bileşeniyle (radyo).
const TEMALAR = [['koyu', 'Koyu'], ['acik', 'Açık'], ['cam', 'Şeffaf']] as const;
type GaleriTemasi = (typeof TEMALAR)[number][0];
function TemaSecici() {
  const [tema, setTema] = useState<GaleriTemasi>('koyu');
  useEffect(() => {
    const al = (a: Ayarlar) => setTema((TEMALAR.find(([id]) => id === a.gorunum?.tema)?.[0]) ?? 'koyu');
    void cagir<Ayarlar>('ayarlar:al').then(al).catch(() => undefined);
    return dinle('ayarlar:degisti', al);
  }, []);
  return <Sekmeler rol="radio" etiket="Tema" secenekler={TEMALAR} deger={tema} sec={(id) => void cagir('ayarlar:kaydet', { gorunum: { tema: id } })} />;
}

// 0.14 T29 (Nusa dili): ekran vurguları — her satır kendi ekranının kökü gibi `vurguStili` taşır; anahtar ve ilerleme o vurguyu okur.
const EKRAN_ADLARI: Record<EkranAdi, string> = {
  kokpit: 'Kokpit', sohbet: 'Sohbet', gorevler: 'Görevler', ayarlar: 'Ayarlar', baglantilar: 'Bağlantılar', kurulum: 'Kurulum', yonetim: 'Fuber Yönetim',
};
function VurguKarti({ ad }: { ad: string }) {
  const [kip, setKip] = useState<KipKimligi>('business');
  const [acik, setAcik] = useState<Record<string, boolean>>(() => Object.fromEntries(EKRANLAR.map((e, i) => [e, i % 2 === 0])));
  return (
    <Kart baslik="Ekran vurguları" data-galeri-ornek={ad}>
      <Sekmeler rol="radio" etiket="Mod" secenekler={[['business', 'Business mode'], ['developer', 'Developer mode']]} deger={kip} sec={setKip} />
      <ul className="g-vurgular">
        {EKRANLAR.map((e, i) => (
          <li key={e} className="g-vurgu" style={vurguStili(e, kip) as CSSProperties} data-vurgu={e}>
            <Satir sol={<span className="ui-vurgu-simge" data-vurgu-simge=""><Ikon ad="zil" olcu={16} /></span>} baslik={EKRAN_ADLARI[e]} alt={SAYFA_VURGUSU[e] === 'karakter' ? 'Modun karakteri' : vurguRengi(e)} sag={<Anahtar acik={acik[e]} degistir={(v) => setAcik((x) => ({ ...x, [e]: v }))} etiket={`${EKRAN_ADLARI[e]} anahtarı`} />} />
            <Ilerleme deger={i + 1} azami={EKRANLAR.length} etiket={`${EKRAN_ADLARI[e]} ilerlemesi`} />
            <span className="ui-vurgu-yazi g-vurgu__yazi" data-vurgu-yazi="">Vurgu rengiyle yazı</span>
          </li>
        ))}
      </ul>
    </Kart>
  );
}
function SekmeKarti({ ad }: { ad: string }) {
  const [donem, setDonem] = useState<'gun' | 'hafta' | 'ay'>('hafta');
  return (
    <Kart baslik="Sekmeler" data-galeri-ornek={ad}>
      <Sekmeler etiket="Dönem" secenekler={[['gun', 'Gün'], ['hafta', 'Hafta'], ['ay', 'Ay']]} deger={donem} sec={setDonem} />
      <p className="g-metin g-metin--soluk">Hap sekmeler: seçili sekme ters ışıklı; ←/→ ile gezilir.</p>
      <div className="ui-deger"><Sayi deger={ZORLAYICI.yediHaneOndalik} ondalik={1} birim="TL" /></div>
    </Kart>
  );
}

// ── Örnek kartlar: kütüphaneyle kurulan widget'lar (Görev 5'in yönü; gerçek kartlar orada) ───────────────────────────────────────────
function HavaKarti({ v, ad }: { v: HavaOrnegi; ad: string }) {
  return (
    <Kart baslik="Hava" data-galeri-ornek={ad}>
      <div className="g-hava">
        <div className="g-hava__sehir"><MetinKirp metin={v.sehir} satir={1} /></div>
        <div className="ui-deger"><Sayi deger={v.derece} birim="°" /></div>
        <div className="g-hava__durum"><MetinKirp metin={v.durum} satir={1} /></div>
        <p className="g-hava__uclar">
          <span>En yüksek <Sayi deger={v.yuksek} birim="°" /></span>
          <span>En düşük <Sayi deger={v.dusuk} birim="°" /></span>
        </p>
      </div>
      <Ayrac />
      <ol className="g-hava__saatler" aria-label="Sonraki saatler">
        {v.saatler.map((s) => (
          <li key={s.saat}><span className="g-hava__saat">{s.saat.slice(0, 2)}</span><span className="g-hava__derece"><Sayi deger={s.derece} birim="°" /></span></li>
        ))}
      </ol>
      <div className="g-dipnot"><MetinKirp metin={v.kaynak} satir={1} /></div>
    </Kart>
  );
}

function HaberlerKarti({ ad }: { ad: string }) {
  return (
    <Kart baslik="Haberler" eylem={{ etiket: 'Tümü', tikla: () => undefined }} data-galeri-ornek={ad}>
      <Liste azami={3}>
        {HABERLER.map((h) => <Satir key={h.baslik} baslik={h.baslik} alt={`${h.kaynak} · ${h.saat}`} satir={2} tikla={() => undefined} />)}
      </Liste>
    </Kart>
  );
}

function HatirlaticilarKarti({ ad }: { ad: string }) {
  const [acik, setAcik] = useState(false);
  return (
    <Kart baslik="Hatırlatıcılar" eylem={<Dugme tur="hayalet" boyut="k" simge="arti" aria-label="Hatırlatıcı kur" />} data-galeri-ornek={ad}>
      <Liste azami={acik ? undefined : 4} tumu={{ etiket: acik ? 'Daha az' : 'Tümü', tikla: () => setAcik((a) => !a) }}>
        {HATIRLATICILAR.map((h) => (
          <Satir key={h.baslik} sol={h.saat} baslik={h.baslik} alt={h.alt} sag={h.onem && <Rozet ton={h.onem}>{h.onem === 'hata' ? 'Gecikti' : 'Yakında'}</Rozet>} />
        ))}
      </Liste>
    </Kart>
  );
}

function YapilacaklarKarti({ ad, isaretler, degistir }: { ad: string; isaretler: boolean[]; degistir: (i: number, v: boolean) => void }) {
  const biten = isaretler.filter(Boolean).length;
  return (
    <Kart baslik="Yapılacaklar" eylem={{ etiket: 'Ekle', tikla: () => undefined }} data-galeri-ornek={ad}>
      <Ilerleme deger={biten} azami={isaretler.length} etiket="Bugün" />
      <Liste>
        {YAPILACAKLAR.map((y, i) => <Isaret key={y.metin} isaretli={isaretler[i]} metin={y.metin} alt={y.alt} degistir={(v) => degistir(i, v)} />)}
      </Liste>
    </Kart>
  );
}

function PiyasaKarti({ ad }: { ad: string }) {
  return (
    <Kart baslik="Piyasa" data-galeri-ornek={ad}>
      <Liste>
        {PIYASA.map((p) => (
          <Satir
            key={p.ad}
            baslik={p.ad}
            alt={p.alt}
            sag={(
              <span className="g-piyasa__sag">
                <span className="g-piyasa__deger"><Sayi deger={p.deger} ondalik={p.ondalik} birim={p.birim} /></span>
                <Rozet ton={p.degisim > 0 ? 'iyi' : p.degisim < 0 ? 'hata' : 'notr'}><Sayi deger={p.degisim} birim="%" ondalik={2} /></Rozet>
              </span>
            )}
          />
        ))}
      </Liste>
    </Kart>
  );
}

// ── 11 Kas: göz varlık sayfası (#galeri/karakter; "Pamuk") ──────────────────────────────────────────────────────────────────────
// Gözler: her ifade × boy (24 sohbet avatarı, 36 çentik hâli, 64 boş durum, 96 Asistan sayfası, 120 kurulum kartı,
// 160 Yönetim), iki kipte (parıltı Business turuncu, Developer yeşil), siyah sahnede (göz beyaz, kapak siyah). Çentik şeridi (kesit 'centik', 16 px göz)
// ayrı satırda. Canlı deneme: hâl, jest, mod ve az hareket düğmeleri; 60 sn boşta uyur. scripts/dev/goz-onizle.mjs bu sayfayı çeker.
// Seçiciler: [data-blok], [data-hareket-deneme], [data-hal-dugmesi], [data-tetik-dugmesi], [data-az-dugmesi], [data-mod-dugmesi], [data-mod-durum].
const IFADE_ADI: Record<GozIfadesi, string> = { sakin: 'Sakin', dinliyor: 'Dinliyor', dusunuyor: 'Düşünüyor', konusuyor: 'Konuşuyor', uyuyor: 'Uyuyor', sevinc: 'Sevinç', hata: 'Hata' };
const BOYLAR = [24, 36, 64, 96, 120, 160] as const;
const KARAKTER_STILI = `
.g-kr { position: fixed; inset: 0; overflow: auto; background: #161618; color: #F5F5F7; font: 14px/1.4 system-ui, sans-serif; padding: 24px; }
.g-kr h1 { font-size: 22px; margin: 0 0 4px; } .g-kr p { margin: 0 0 20px; color: #A1A1A6; }
.g-kr__blok { display: inline-flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: 22px; margin: 0 16px 16px 0; vertical-align: top; background: #000000; }
.g-kr__sira { display: flex; gap: 16px; align-items: flex-end; }
.g-kr__hucre { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 12px; }
.g-kr__etiket { width: 96px; font-size: 13px; font-weight: 600; align-self: center; }
.g-kr__deneme { display: flex; flex-direction: column; gap: 14px; }
.g-kr__sahne { width: 420px; height: 300px; display: grid; place-items: center; border-radius: 18px; background: #000000; box-shadow: inset 0 0 0 1px #2C2C2E; }
.g-kr__denetim { display: flex; flex-direction: column; gap: 10px; max-width: 520px; }
.g-kr__dugmeler { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.g-kr__dugmeler > span { width: 64px; color: #A1A1A6; font-size: 12px; }
.g-kr__dugmeler button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 999px; border: 1px solid #3A3A3C; background: #1C1C1E; color: #F5F5F7; cursor: pointer; }
.g-kr__dugmeler button:is([aria-pressed='true'], [aria-checked='true']) { background: #F5F5F7; color: #0B0B0C; border-color: #F5F5F7; }
`;
const ZEMINLER = [['koyu', 'Koyu zemin', '#000000', '#F5F5F7'], ['acik', 'Açık zemin', '#F5F5F7', '#1D1D1F']] as const;
const KIPLER_G: readonly { kip: KipKimligi; ad: string }[] = [{ kip: 'business', ad: 'Business mode' }, { kip: 'developer', ad: 'Developer mode' }];

function GozBolumu() {
  return (
    <section data-tur="gozler">
      <h1>Gözler · Pamuk</h1>
      <p>Geliştirici · yalnız test derlemesi. Yedi ifade, altı boy, iki mod; çentik şeridi 16 px göz.</p>
      {KIPLER_G.map(({ kip, ad }) => (
        <div key={kip} className="g-kr__blok" data-blok={`ifadeler-${kip}`}>
          <strong>{ad} · ifadeler (120 px)</strong>
          <div className="g-kr__sira">
            {GOZ_IFADELERI.map((i) => <div key={i} className="g-kr__hucre" data-ifade={i}><Gozler kip={kip} ifade={i} boyut={120} etiket={`${ad}, ${IFADE_ADI[i]}`} /><span>{IFADE_ADI[i]}</span></div>)}
          </div>
          <div className="g-kr__sira" data-sira="centik">
            <span className="g-kr__etiket">Çentik (16 px)</span>
            {GOZ_IFADELERI.map((i) => <div key={i} className="g-kr__hucre"><Gozler kip={kip} ifade={i} boyut={16} kesit="centik" /></div>)}
          </div>
        </div>
      ))}
      {KIPLER_G.map(({ kip, ad }) => (
        <div key={kip} className="g-kr__blok" data-blok={`boylar-${kip}`}>
          <strong>{ad} · boylar ({BOYLAR.join(', ')} px)</strong>
          {(['sakin', 'sevinc', 'uyuyor'] as const).map((i) => (
            <div key={i} className="g-kr__sira">
              <span className="g-kr__etiket">{IFADE_ADI[i]}</span>
              {BOYLAR.map((b) => <div key={b} className="g-kr__hucre" data-boy={b}><Gozler kip={kip} ifade={i} boyut={b} /></div>)}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

const DENEME_HALLERI: GozHali[] = ['sakin', 'dinliyor', 'dusunuyor', 'konusuyor', 'calisiyor', 'onay', 'hata', 'sevinc'];
/** Canlı gözler: hâl, jest, mod ve az hareket. İmleç sahnede izlenir; 60 sn boşta uyur (yarıya düşer, iki yavaş kırpar, kapanır, 6 nefes). */
function GozDeneme() {
  const [hal, setHal] = useState<GozHali>('sakin');
  const [kip, setKip] = useState<KipKimligi>('business');
  const [az, setAz] = useState(false);
  const [tetik, setTetik] = useState<{ ad: GozTetigi; no: number } | undefined>(undefined);
  const oynat = (ad: GozTetigi) => setTetik((x) => ({ ad, no: (x?.no ?? 0) + 1 }));
  return (
    <div className="g-kr__blok g-kr__deneme" data-hareket-deneme="gozler" data-mod-gecisi-deneme="">
      <strong>Hareket deneme · canlı gözler</strong>
      <span style={{ color: '#A1A1A6' }}>İmleci yaklaştır: gözler izler. Sol tıkla: selam. Mod değiştir: parıltı çapraz solar, göz zıplayıp kırpar. 60 sn boşta: uyur.</span>
      <div className="g-kr__sira" style={{ alignItems: 'flex-start' }}>
        <div className="g-kr__sahne" data-canli-sahne="gozler">
          <Gozler kip={kip} boyut={240} hal={hal} azHareket={az} tetik={tetik} etiket="Fuber, canlı" />
        </div>
        <div className="g-kr__denetim">
          <div className="g-kr__dugmeler">
            <span>Jest</span>
            {GOZ_TETIKLERI.map((x) => <button key={x} type="button" data-tetik-dugmesi={x} onClick={() => oynat(x)}>{x}</button>)}
          </div>
          <div className="g-kr__dugmeler" role="radiogroup" aria-label="Hâl">
            <span>Hâl</span>
            {DENEME_HALLERI.map((h) => <button key={h} type="button" role="radio" aria-checked={hal === h} data-hal-dugmesi={h} onClick={() => setHal(h)}>{h}</button>)}
          </div>
          <div className="g-kr__dugmeler">
            <span>Mod</span>
            <button type="button" data-mod-dugmesi="" onClick={() => setKip((k) => (k === 'business' ? 'developer' : 'business'))}>Mod değiştir</button>
            <span data-mod-durum={kip} style={{ width: 'auto' }}>{kip === 'business' ? 'Business mode' : 'Developer mode'}</span>
          </div>
          <div className="g-kr__dugmeler">
            <span>Ayar</span>
            <button type="button" aria-pressed={az} data-az-dugmesi="" onClick={() => setAz((a) => !a)}>Az hareket</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 0.14 T6b (Sade mod): ayar 'sade' ise göz galerisi de gözsüzdür — yerine nötr işaretin her hâli, dört boyda, iki kipte ve Sade mod
// geçişi (vurgu rengi çapraz solar). [data-sade-galerisi], [data-sade-hal], [data-sade-gecis-dugmesi]; scripts/dev/sade-onizle.mjs çeker.
const SADE_HALLERI: SadeHal[] = ['sakin', 'dinliyor', 'dusunuyor', 'konusuyor', 'onay', 'hata', 'sevinc', 'uyuyor'];
function SadeGalerisi() {
  const [kip, setKip] = useState<KipKimligi>('business');
  const [gecis, setGecis] = useState<{ eski: KipKimligi; yeni: KipKimligi } | null>(null);
  const degistir = () => {
    const simdiki = gecis ? gecis.yeni : kip;
    const sonraki: KipKimligi = simdiki === 'business' ? 'developer' : 'business';
    setGecis({ eski: simdiki, yeni: sonraki });
    setKip(sonraki);
  };
  return (
    <div className="g-kr" data-karakter-sayfasi="" data-sade-galerisi="">
      <style>{KARAKTER_STILI}</style>
      <section>
        <h1>Sade mod · göz yok</h1>
        <p>Ayarlar → Görünüm → Gözler: Sade. Gözler hiçbir yüzeyde çizilmez; yerlerinde aynı boyda nötr işaret (F).</p>
        {ZEMINLER.map(([z, ad, zemin, yazi]) => (
          <div key={z} className="g-kr__blok" data-blok={`sade-${z}`} style={{ background: zemin, color: yazi }}>
            <strong>{ad} · hâller</strong>
            {(['business', 'developer'] as const).map((k) => (
              <div key={k} className="g-kr__sira">
                <span className="g-kr__etiket">{k === 'business' ? 'Business mode' : 'Developer mode'}</span>
                {SADE_HALLERI.map((h) => (
                  <div key={h} className="g-kr__hucre" data-sade-hal={h}>
                    <SadeIsaret kip={k} boyut={96} hal={h === 'uyuyor' ? undefined : h} ifade={h === 'uyuyor' ? 'uyuyor' : undefined} />
                    <span>{h}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="g-kr__sira">
              <span className="g-kr__etiket">Boylar</span>
              {[240, 96, 40, 24].map((b) => <div key={b} className="g-kr__hucre"><SadeIsaret kip="business" boyut={b} hal="dinliyor" /></div>)}
            </div>
          </div>
        ))}
        <div className="g-kr__blok g-kr__deneme" data-mod-gecisi-deneme="" style={{ background: '#000000', color: '#F5F5F7' }}>
          <strong>Mod geçişi · Sade</strong>
          <span style={{ color: '#A1A1A6' }}>Yalnız vurgu rengi çapraz solar (240 ms); az harekette anında.</span>
          <div className="g-kr__sira" style={{ alignItems: 'flex-start' }}>
            <div className="g-kr__sahne" data-mod-sahne="">
              {gecis
                ? <ModGecisi eski={gecis.eski} yeni={gecis.yeni} boyut={240} bitti={() => setGecis(null)} />
                : <GorunenGoz kip={kip} boyut={240} hal="sakin" />}
            </div>
            <button type="button" data-sade-gecis-dugmesi="" onClick={degistir}>Mod değiştir</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function KarakterGalerisi() {
  if (!useKarakterGorunur()) return <SadeGalerisi />;
  return (
    <div className="g-kr" data-karakter-sayfasi="">
      <style>{KARAKTER_STILI}</style>
      <GozBolumu />
      <GozDeneme />
    </div>
  );
}

export function Galeri() {
  if (location.hash === '#galeri/karakter') return <KarakterGalerisi />;
  return <AnaGaleri />;
}

function AnaGaleri() {
  const [isaretler, setIsaretler] = useState(() => YAPILACAKLAR.map((y) => y.isaretli));
  const isaretDegistir = (i: number, v: boolean) => setIsaretler((l) => l.map((x, j) => (j === i ? v : x)));
  const [uzunListe, setUzunListe] = useState(false);
  return (
    <>
      {/* Pencereyi sürükleme şeridi: içerik değil, kabuk (galerinin dışında; ölçülmez). */}
      <div className="galeri__surukle surukle" aria-hidden="true" />
      <div className="galeri" data-galeri-kok="">
        <div className="galeri__ic">
          <header className="galeri__bas">
            <p className="ust-etiket galeri__etiket">Geliştirici · yalnız test derlemesi</p>
            <h1 className="t-baslik">Arayüz kütüphanesi</h1>
            <p className="t-giris galeri__giris">
              Kokpit kartları, sohbet kartları, yapılacaklar ve görevler bu parçalarla kurulur. Her bileşen iki genişlikte, normal ve zorlayıcı
              veriyle çizilir; önizleme her öğeyi ölçer: taşan metin yok, kart dışına çıkan öğe yok, yazılar okunur.
            </p>
            <TemaSecici />
          </header>

          <Bolum ad="Örnek kartlar" bilesenler="Kart KartBaslik Satir Liste MetinKirp Rozet Dugme Sayi Ilerleme Isaret Ayrac" not="Hava, haberler, hatırlatıcılar, yapılacaklar, piyasa" ornek={(g) => (
            <>
              <HavaKarti v={HAVA.normal} ad={`hava-${g}`} />
              <HavaKarti v={HAVA.zorlayici} ad={`hava-zorlayici-${g}`} />
              <HaberlerKarti ad={`haberler-${g}`} />
              <HatirlaticilarKarti ad={`hatirlaticilar-${g}`} />
              <YapilacaklarKarti ad={`yapilacaklar-${g}`} isaretler={isaretler} degistir={isaretDegistir} />
              <PiyasaKarti ad={`piyasa-${g}`} />
            </>
          )} />

          <Bolum ad="Kart" bilesenler="Kart KartBaslik Ayrac" not="Başlık + tek eylem; başlıksız; yoğun; sabit yükseklik" ornek={(g) => (
            <>
              <Kart baslik="Başlık ve eylem" eylem={{ etiket: 'Tümü', tikla: () => undefined }} data-galeri-ornek={`kart-eylem-${g}`}>
                <p className="g-metin">Kartın gövdesi. İkincil bilgi soluk ve küçük; birincil değer büyük.</p>
                <Ayrac />
                <p className="g-metin g-metin--soluk">Ayraçtan sonra ikinci bölüm.</p>
              </Kart>
              <Kart baslik={ZORLAYICI.hatirlatici} eylem={{ etiket: 'Hepsini gör ve düzenle', tikla: () => undefined }} data-galeri-ornek={`kart-uzun-baslik-${g}`}>
                <p className="g-metin">Uzun başlık tek satırda kalır; eylem sağda yerini korur.</p>
              </Kart>
              <Kart eylem={<Rozet ton="bilgi">Yeni</Rozet>} data-galeri-ornek={`kart-oge-eylem-${g}`}>
                <p className="g-metin">Başlıksız kart; eylem yerinde bir öğe (rozet).</p>
              </Kart>
              <Kart data-galeri-ornek={`kart-yalin-${g}`}>
                <div className="ui-deger"><Sayi deger={ZORLAYICI.yediHane} /></div>
                <p className="g-metin g-metin--soluk">Başlıksız, yalnız büyük değer (7 hane).</p>
              </Kart>
              <Kart baslik="Yoğun kart (sohbet içi)" yogun eylem={{ etiket: 'Aç', tikla: () => undefined }} data-galeri-ornek={`kart-yogun-${g}`}>
                <Satir sol={<Ikon ad="zil" olcu={16} />} baslik="Hatırlatıcı kuruldu" alt="Yarın 09:00 · Yatırımcı görüşmesi" />
              </Kart>
              <Kart baslik="Yoğun kart + Tümü" yogun data-galeri-ornek={`kart-yogun-tumu-${g}`}>
                <Liste azami={2} tumu={{ etiket: 'Tümü', tikla: () => undefined }}>
                  {HATIRLATICILAR.map((h) => <Satir key={h.baslik} sol={h.saat} baslik={h.baslik} />)}
                </Liste>
              </Kart>
              <div className="g-sabit">
                <Kart baslik="Sabit yükseklik (198 px)" eylem={{ etiket: 'Tümü', tikla: () => undefined }} data-galeri-ornek={`kart-sabit-${g}`} style={{ height: '100%' }}>
                  <Liste azami={2}>
                    {HATIRLATICILAR.map((h) => <Satir key={h.baslik} sol={h.saat} baslik={h.baslik} />)}
                  </Liste>
                </Kart>
              </div>
            </>
          )} />

          <Bolum ad="Satır ve liste" bilesenler="Satir Liste" not="Sol · başlık + alt · sağ; tıklanabilir, soluk, iki satır; azami + Tümü, boş liste" ornek={(g) => (
            <>
              <Kart baslik="Satır türleri" data-galeri-ornek={`satir-turleri-${g}`}>
                <Liste>
                  <Satir sol="09:00" baslik="Ece ile tasarım görüşmesi" alt="Ana sayfa revizyonu" />
                  <Satir sol={<Ikon ad="posta" olcu={16} />} baslik="Perşembe toplantısı için davet" alt="Yatırım Ortakları · 3 saat önce" sag={<Rozet ton="bilgi">Yeni</Rozet>} tikla={() => undefined} />
                  <Satir sol="Dün" baslik="Faturayı öde" alt="Tamamlandı" soluk sag="Bitti" />
                  <Satir baslik={ZORLAYICI.haberBasligi} alt={`Ekonomi Masası · ${ZORLAYICI.dosyaAdi}`} satir={2} sag={<Sayi deger={ZORLAYICI.yediHane} />} tikla={() => undefined} />
                  <Satir sol="23:59" baslik={ZORLAYICI.tekSozcuk} alt={ZORLAYICI.yer} sag={<Rozet ton="uyari">Çok uzun bir durum etiketi bile tek satırda kalır</Rozet>} />
                  <Satir baslik={ZORLAYICI.sehir} sag={<Sayi deger={-12.5} birim="°" ondalik={1} />} />
                </Liste>
              </Kart>
              <Kart baslik="Azami 3 + Tümü" data-galeri-ornek={`liste-tumu-${g}`}>
                <Liste azami={uzunListe ? undefined : 3} tumu={{ etiket: uzunListe ? 'Daha az' : 'Tümü', tikla: () => setUzunListe((a) => !a) }}>
                  {HATIRLATICILAR.map((h) => <Satir key={h.baslik} sol={h.saat} baslik={h.baslik} alt={h.alt} />)}
                </Liste>
              </Kart>
              <Kart baslik="Tümü düğmesi olmadan" data-galeri-ornek={`liste-kalan-${g}`}>
                <Liste azami={2}>
                  {HABERLER.map((h) => <Satir key={h.baslik} baslik={h.baslik} alt={h.kaynak} />)}
                </Liste>
              </Kart>
              <Kart baslik="Boş liste" data-galeri-ornek={`liste-bos-${g}`}>
                <Liste bos={<Bos baslik="Bugün hatırlatıcı yok" metin="Fuber’e “yarın 9’da hatırlat” demen yeter." eylem={{ etiket: 'Hatırlatıcı kur', tikla: () => undefined }} />} />
              </Kart>
            </>
          )} />

          <Bolum ad="Nusa dili: sekme, anahtar, vurgu" bilesenler="Sekmeler Anahtar Ilerleme" not="Hap sekmeler; anahtar ve ilerleme ekranın tek vurgusunu taşır (sohbet ve kurulum modu izler)" ornek={(g) => (
            <>
              <SekmeKarti ad={`sekmeler-${g}`} />
              <VurguKarti ad={`vurgu-${g}`} />
            </>
          )} />

          <Bolum ad="Metin kırpma" bilesenler="MetinKirp" not="Tamamı ipucunda ve klavye odağında okunur" ornek={(g) => (
            <Kart baslik="MetinKirp" data-galeri-ornek={`kirp-${g}`}>
              <div className="g-kirp g-kirp--baslik"><MetinKirp as="h3" metin={ZORLAYICI.haberBasligi} satir={2} /></div>
              <div className="g-kirp"><MetinKirp metin={ZORLAYICI.haberBasligi} satir={1} /></div>
              <div className="g-kirp"><MetinKirp metin={ZORLAYICI.haberBasligi} satir={3} /></div>
              <div className="g-kirp"><MetinKirp as="span" metin={ZORLAYICI.tekSozcuk} satir={1} /></div>
              <div className="g-kirp"><MetinKirp metin={ZORLAYICI.dosyaAdi} satir={2} /></div>
              <div className="g-kirp g-kirp--soluk"><MetinKirp metin="Kısa metin kırpılmaz." satir={1} /></div>
            </Kart>
          )} />

          <Bolum ad="Rozet ve düğme" bilesenler="Rozet Dugme" not="Beş ton; dört tür × iki boy, simgeli, yalnız simge, devre dışı, uzun etiket" ornek={(g) => (
            <>
              <Kart baslik="Rozet" data-galeri-ornek={`rozet-${g}`}>
                <div className="g-sira">
                  <Rozet ton="notr">Taslak</Rozet>
                  <Rozet ton="iyi">Tamam</Rozet>
                  <Rozet ton="uyari">Yakında</Rozet>
                  <Rozet ton="hata">Gecikti</Rozet>
                  <Rozet ton="bilgi">Yeni</Rozet>
                </div>
                <Rozet ton="uyari">{ZORLAYICI.hatirlatici}</Rozet>
                <Rozet ton="notr">{ZORLAYICI.tekSozcuk}</Rozet>
              </Kart>
              <Kart baslik="Düğme" data-galeri-ornek={`dugme-${g}`}>
                <div className="g-sira">
                  <Dugme tur="birincil">Kaydet</Dugme>
                  <Dugme tur="ikincil">Vazgeç</Dugme>
                  <Dugme tur="hayalet">Tümü</Dugme>
                  <Dugme tur="tehlike">Sil</Dugme>
                </div>
                <div className="g-sira">
                  <Dugme tur="birincil" boyut="k" simge="arti">Ekle</Dugme>
                  <Dugme tur="ikincil" boyut="k" simge="yenile">Yeniden dene</Dugme>
                  <Dugme tur="hayalet" boyut="k" simge="kalem" aria-label="Düzenle" />
                  <Dugme tur="tehlike" boyut="k" simge="cop" aria-label="Sil" />
                </div>
                <div className="g-sira">
                  <Dugme tur="birincil" disabled>Kaydet</Dugme>
                  <Dugme tur="ikincil" boyut="k" disabled>Vazgeç</Dugme>
                  <Dugme tur="hayalet" boyut="k" disabled>Tümü</Dugme>
                  <Dugme tur="tehlike" boyut="k" disabled>Sil</Dugme>
                </div>
                <Dugme tur="ikincil" simge="dis">{`Aç: ${ZORLAYICI.dosyaAdi} ve bütün ekleri bilgisayarda göster`}</Dugme>
              </Kart>
            </>
          )} />

          <Bolum ad="Sayı ve ilerleme" bilesenler="Sayi Ilerleme" not="tr-TR, tabular; 0 ve 7 hane; yüzde önde, derece bitişik" ornek={(g) => (
            <>
              <Kart baslik="Sayı" data-galeri-ornek={`sayi-${g}`}>
                <div className="g-ikili-deger">
                  <div><div className="ui-deger"><Sayi deger={ZORLAYICI.sifir} birim="°" /></div><p className="g-metin g-metin--soluk">Sıfır</p></div>
                  <div><div className="ui-deger"><Sayi deger={ZORLAYICI.yediHaneOndalik} ondalik={1} birim="TL" /></div><p className="g-metin g-metin--soluk">7 hane, birimli</p></div>
                </div>
                <Liste>
                  {SAYILAR.map(([d, b, o, ad]) => <Satir key={ad} baslik={ad} sag={<Sayi deger={d} birim={b} ondalik={o} />} />)}
                </Liste>
              </Kart>
              <Kart baslik="Esnek satırda büyük değer" data-galeri-ornek={`sayi-esnek-${g}`}>
                <div className="g-esnek">
                  <Ikon ad="gunes" olcu={28} />
                  <div className="ui-deger"><Sayi deger={18} birim="°" /></div>
                  <div className="g-esnek__durum"><MetinKirp metin="Parçalı bulutlu" satir={1} /></div>
                </div>
                <div className="g-esnek">
                  <Ikon ad="grafik" olcu={28} />
                  <div className="ui-deger"><Sayi deger={ZORLAYICI.yediHaneOndalik} ondalik={1} birim="TL" /></div>
                  <div className="g-esnek__durum"><MetinKirp metin="Gram altın" satir={1} /></div>
                </div>
              </Kart>
              <Kart baslik="İlerleme" data-galeri-ornek={`ilerleme-${g}`}>
                <Ilerleme deger={0} azami={5} etiket="Başlanmadı" />
                <Ilerleme deger={3} azami={5} etiket="Bugünün işleri" />
                <Ilerleme deger={5} azami={5} etiket="Tamam" />
                <Ilerleme deger={ZORLAYICI.yediHane} azami={9999999} etiket={ZORLAYICI.hatirlatici} />
                <Ilerleme deger={2} azami={0} etiket="Azami sıfır (boş çubuk)" />
              </Kart>
            </>
          )} />

          <Bolum ad="İşaret" bilesenler="Isaret" not="İşaretlenince silinmez: üstü çizilir, soluklaşır" ornek={(g) => (
            <Kart baslik="Yapılacaklar" data-galeri-ornek={`isaret-${g}`}>
              <Liste>
                {YAPILACAKLAR.map((y, i) => <Isaret key={y.metin} isaretli={isaretler[i]} metin={y.metin} alt={y.alt} degistir={(v) => isaretDegistir(i, v)} />)}
              </Liste>
            </Kart>
          )} />

          <Bolum ad="Boş, yükleniyor, hata" bilesenler="Bos Iskelet" not="Kart zıplamaz: iskelet satırların yerini tutar" ornek={(g) => (
            <>
              <Kart baslik="Haberler" data-galeri-ornek={`yukleniyor-${g}`}>
                <Iskelet satir={3} />
              </Kart>
              <Kart baslik="Haberler" data-galeri-ornek={`hata-${g}`}>
                <Bos baslik="Haberler alınamadı" metin="İnternet bağlantısı yok gibi. Son alınan haberler 3 saat önceydi." eylem={{ etiket: 'Yeniden dene', tikla: () => undefined }} />
              </Kart>
              <Kart baslik="Boş" data-galeri-ornek={`bos-${g}`}>
                <Bos baslik={ZORLAYICI.tekSozcuk} metin={ZORLAYICI.haberBasligi} />
              </Kart>
              <Kart baslik="Hatırlatıcılar" yogun data-galeri-ornek={`yukleniyor-yogun-${g}`}>
                <Iskelet satir={2} />
              </Kart>
              {/* İskelet = dolu liste (aynı yükseklik): önizleme ikisini ölçüp karşılaştırır. */}
              <Kart baslik="İskelet = satır (tek satır)" data-galeri-ornek={`iskelet-esit-tek-${g}`}>
                <Iskelet satir={3} />
                <Ayrac />
                <Liste>{HATIRLATICILAR.slice(0, 3).map((h) => <Satir key={h.baslik} sol={h.saat} baslik={h.baslik} />)}</Liste>
              </Kart>
              <Kart baslik="İskelet = satır (alt satırlı)" data-galeri-ornek={`iskelet-esit-alt-${g}`}>
                <Iskelet satir={3} alt />
                <Ayrac />
                <Liste>{HABERLER.slice(0, 3).map((h) => <Satir key={h.baslik} baslik={h.baslik} alt={`${h.kaynak} · ${h.saat}`} />)}</Liste>
              </Kart>
              <Kart baslik="İskelet = satır (iki satır başlık + alt)" data-galeri-ornek={`iskelet-esit-iki-${g}`}>
                <Iskelet satir={3} alt baslikSatiri={2} />
                <Ayrac />
                <Liste>
                  {[ZORLAYICI.haberBasligi, ZORLAYICI.gorev, ZORLAYICI.hatirlatici].map((b) => <Satir key={b} baslik={b} alt="Ekonomi Masası · 09:41" satir={2} />)}
                </Liste>
              </Kart>
            </>
          )} />

          {/* 0.11 G6: sohbet kartları — yapay zekânın kart_goster kartları (altı tür, normal + zorlayıcı) ve araç adımları (tek satır, "N adım"). */}
          <Bolum ad="Yapay zekâ kartları" bilesenler="YapayZekaKarti" not="kart_goster: özet, liste, tablo, adımlar, karşılaştırma, bağlantılar — normal ve sınırdaki (200 karakter, 6 sütun × 20 satır, 3 seçenek) veriyle" ornek={(g) => (
            <>
              {[...KART_ORNEKLERI, ...KART_ZORLAYICI].map((o) => <div key={o.ad} data-galeri-ornek={`${o.ad}-${g}`}><YapayZekaKarti kart={o.kart} /></div>)}
            </>
          )} />

          <Bolum ad="Araç adımları" bilesenler="AracAdimlari" not="Tek satır: sürüyor, tamam, olmadı, reddedildi; ardışık adımlar “N adım” (katlanır); uzun hedef ve bilinmeyen araç" ornek={(g) => (
            <>
              {ARAC_ORNEKLERI.map((o) => (
                <div key={o.ad} data-galeri-ornek={`arac-${o.ad}-${g}`}>
                  <AracAdimlari bloklar={o.adimlar.map((a) => ({ tur: 'arac' as const, ...a, girdi: a.girdi }))} />
                </div>
              ))}
              <div data-galeri-ornek={`arac-ada-${g}`}>
                <AracAdimlari ada sohbeteGit={() => undefined} bloklar={ARAC_ORNEKLERI.flatMap((o) => o.adimlar).slice(0, 6).map((a) => ({ tur: 'arac' as const, ...a, girdi: a.girdi }))} />
              </div>
            </>
          )} />
        </div>
      </div>
    </>
  );
}
