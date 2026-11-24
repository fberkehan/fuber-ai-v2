// ── Panelin Müzik sayfası (0.14 T25; R13) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Bilgisayarda çalan (Spotify, tarayıcı, herhangi bir medya uygulaması; Windows'un medya oturumu — T21) parça: solda kapak, sağda başlık ve sanatçı,
// ilerleme çubuğu, geri · duraklat/oynat · ileri ve ses düzeyi. Kaynak useMedya ('ada:medya'; yalnız değişince). Kurallar:
//  · İlerleme çubuğu: anlık konum `medyaKonumu`; kalan süre boyunca TEK WAAPI `scaleX` animasyonu (doğrusal). Duraklamada (hiz 0, T21) ve konum, hız, parça
//    değişince yeniden kurulur; requestAnimationFrame döngüsü yok. Saniye yazısı çalarken saniye başına tek setTimeout zinciri (useAnlikKonum).
//    Çubuğa tıklamak (ya da ← → 5 sn) `konum` komutudur.
//  · Komutlar yalnız 'medya:komut' → olay yardımcısı (medya tuşu yok). Oturum yoksa denetimler devre dışı ve tek satır "Şu an çalan bir şey yok.".
//  · Kapak yalnız yardımcının jpeg/png data URL'i, <img src> ile (HTML basılmaz); yoksa (256 KB'yi aşan kapak null gelir) sayfanın vurgu renginde yer tutucu.
//  · Ses düzeyi: kaydırıcı `{ ses: 0..1 }` (yardımcının {"k":"ses"} komutu); sürüklerken en sık 80 ms'de bir gönderilir (tek setTimeout).
//  · Karakter yok (Sade modda da); vurgu Panel'in --panel-vurgu'su (#FF375F). Hareket yalnız transform ve opacity.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import { Ikon } from '../../bilesenler/Ikon';
import { medyaKonumu } from '../../../shared/sistem-olay';
import { SOZ_METNI } from '../../../shared/lrc';
import { calanMedya, kapakAdresi, medyaKomutuGonder, sureMetni, uygulamaAdi, useAnlikKonum, useMedya, type CalanMedya } from './useMedya';

/** Kapak: güvenli data URL ya da vurgu renginde yer tutucu (dalga simgesi). */
export function Kapak({ m, olcu }: { m: CalanMedya | null; olcu: number }): ReactElement {
  const src = kapakAdresi(m?.kapak);
  const stil = { width: olcu, height: olcu } as CSSProperties;
  return src
    ? <img className="muzik-kapak" src={src} alt="" draggable={false} style={stil} data-kapak="" />
    : <span className="muzik-kapak muzik-kapak--yok" style={stil} aria-hidden="true" data-kapak-yok=""><Ikon ad="dalga" olcu={Math.round(olcu * 0.36)} /></span>;
}

/** Başlık (yoksa uygulamanın adı) ve sanatçı. Oturum yoksa tek satır. */
export function ParcaBilgisi({ m, yokMetni = true }: { m: CalanMedya | null; yokMetni?: boolean }): ReactElement {
  if (!m) return <span className="muzik-bilgi">{yokMetni && <span className="muzik-bilgi__yok" data-medya-yok="">{SOZ_METNI.yok}</span>}</span>;
  const baslik = m.baslik.trim() || uygulamaAdi(m.uygulama);
  const alt = m.sanatci.trim() || (m.baslik.trim() ? uygulamaAdi(m.uygulama) : '');
  return (
    <span className="muzik-bilgi">
      <span className="muzik-bilgi__baslik" title={baslik}>{baslik}</span>
      {alt && <span className="muzik-bilgi__sanatci" title={alt}>{alt}</span>}
    </span>
  );
}

/** Geri · oynat/duraklat · ileri. Oturum yoksa devre dışı. */
export function Denetimler({ m, kucuk = false }: { m: CalanMedya | null; kucuk?: boolean }): ReactElement {
  const yok = !m;
  const caliyor = Boolean(m?.caliyor);
  return (
    <span className="muzik-denetim" data-kucuk={kucuk ? '' : undefined}>
      <button type="button" className="muzik-dgm" aria-label="Önceki parça" title="Önceki parça" disabled={yok} onClick={() => void medyaKomutuGonder({ eylem: 'geri' })}>
        <Ikon ad="onceki" olcu={16} />
      </button>
      <button type="button" className="muzik-dgm muzik-dgm--ana" aria-label={caliyor ? 'Duraklat' : 'Oynat'} title={caliyor ? 'Duraklat' : 'Oynat'} disabled={yok} data-medya-eylem={caliyor ? 'duraklat' : 'oynat'}
        onClick={() => void medyaKomutuGonder({ eylem: caliyor ? 'duraklat' : 'oynat' })}>
        <Ikon ad={caliyor ? 'duraklat' : 'oynat'} olcu={16} kalinlik={caliyor ? 2.4 : 1.6} />
      </button>
      <button type="button" className="muzik-dgm" aria-label="Sonraki parça" title="Sonraki parça" disabled={yok} onClick={() => void medyaKomutuGonder({ eylem: 'ileri' })}>
        <Ikon ad="sonraki" olcu={16} />
      </button>
    </span>
  );
}

/** İlerleme çubuğu: kalan süre boyunca tek WAAPI scaleX; tıklayınca o konuma. Zaman çizelgesi yoksa (sure 0) boş çubuk, tıklanmaz. */
function IlerlemeCubugu({ m }: { m: CalanMedya | null }): ReactElement {
  const dolu = useRef<HTMLSpanElement>(null);
  const sure = m?.sure ?? 0;
  const anlik = useAnlikKonum(m);
  useEffect(() => {
    const el = dolu.current;
    if (!el) return;
    if (!m || sure <= 0) { el.style.transform = 'scaleX(0)'; return; }
    const konum = medyaKonumu(m, Date.now());
    const oran = Math.min(1, konum / sure);
    el.style.transform = `scaleX(${oran})`;
    if (!m.caliyor || m.hiz <= 0 || oran >= 1) return; // duraklamada konum ilerlemez (T21): animasyon yok
    const a = el.animate([{ transform: `scaleX(${oran})` }, { transform: 'scaleX(1)' }], { duration: ((sure - konum) / m.hiz) * 1000, easing: 'linear', fill: 'forwards' });
    return () => a.cancel();
    // m alanları ayrı ayrı: yardımcının yinelediği aynı satır (yeni nesne) animasyonu yeniden kurmasın.
  }, [m?.baslik, m?.konum, m?.konumZamani, m?.caliyor, m?.hiz, sure, Boolean(m)]);
  const git = (sn: number) => { if (m && sure > 0) void medyaKomutuGonder({ eylem: 'konum', sn: Math.min(sure, Math.max(0, sn)) }); };
  const tik = (e: ReactMouseEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) git(((e.clientX - r.left) / r.width) * sure);
  };
  const tus = (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation(); // panelin ← → sayfa geçişi değil
    git(anlik + (e.key === 'ArrowRight' ? 5 : -5));
  };
  const etkin = Boolean(m && sure > 0);
  return (
    <span className="muzik-ilerleme">
      <span className="muzik-ilerleme__iz" role="slider" aria-label="Parçanın konumu" aria-valuemin={0} aria-valuemax={Math.round(sure)} aria-valuenow={Math.round(anlik)}
        aria-valuetext={`${sureMetni(anlik)} / ${sureMetni(sure)}`} aria-disabled={!etkin || undefined} tabIndex={etkin ? 0 : -1}
        onClick={etkin ? tik : undefined} onKeyDown={etkin ? tus : undefined} data-ilerleme="">
        <span ref={dolu} className="muzik-ilerleme__dolu" />
      </span>
      <span className="muzik-ilerleme__sure" aria-hidden="true">{m && sure > 0 ? `${sureMetni(anlik)} / ${sureMetni(sure)}` : '–:–'}</span>
    </span>
  );
}

/** Ses düzeyi (sistemin varsayılan çıkışı). Düzey bilinmiyorsa (yardımcı yok) görünmez. */
function SesDuzeyi({ ses }: { ses: { duzey: number; sessiz: boolean } | null }): ReactElement | null {
  const [yerel, setYerel] = useState<number | null>(null);
  const bekleyen = useRef<{ z: ReturnType<typeof setTimeout> | null; deger: number }>({ z: null, deger: 0 });
  useEffect(() => () => { if (bekleyen.current.z) clearTimeout(bekleyen.current.z); }, []);
  if (!ses) return null;
  const deger = yerel ?? Math.round(ses.duzey * 100);
  const degisti = (v: number) => {
    setYerel(v);
    const b = bekleyen.current;
    b.deger = v;
    if (b.z) return;
    b.z = setTimeout(() => { b.z = null; void medyaKomutuGonder({ ses: b.deger / 100 }); }, 80);
  };
  return (
    <label className="muzik-ses" title={`Ses düzeyi: %${deger}`}>
      <Ikon ad={ses.sessiz || deger === 0 ? 'sessiz' : 'hoparlor'} olcu={15} />
      <input type="range" min={0} max={100} step={1} value={deger} aria-label="Ses düzeyi" style={{ ['--oran' as string]: deger / 100 }}
        onChange={(e) => degisti(Number(e.currentTarget.value))} onPointerUp={() => setYerel(null)} onBlur={() => setYerel(null)}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation(); }} />
    </label>
  );
}

export function Muzik(): ReactElement {
  const d = useMedya();
  const m = calanMedya(d);
  return (
    <div className="muzik-sayfa" data-medya-durum={!m ? 'yok' : m.caliyor ? 'caliyor' : 'durakladi'}>
      <Kapak m={m} olcu={92} />
      <div className="muzik-sayfa__sag">
        <ParcaBilgisi m={m} />
        <IlerlemeCubugu m={m} />
        <div className="muzik-sayfa__alt">
          <Denetimler m={m} />
          <SesDuzeyi ses={d.ses} />
        </div>
      </div>
    </div>
  );
}
