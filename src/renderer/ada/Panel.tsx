// ── Çentiğin açık paneli (0.14 T23; R13, R20) ────────────────────────────────────────────────────────────────────────────────────────────
// İmleç boştaki çentikte durunca (hover, 120 ms) ya da tıklanınca (Asistan, yazı alanı odakta) açılır; 560×188 (shared/ada.ts 'panel'). Yapı:
//   · Üst satır: solda sayfanın adı (vurgu noktasıyla), ortada tarih ve kalın saat (Intl.DateTimeFormat, uygulamanın dili), sağda medya çalıyorsa küçük
//     çubuklar (durağan; boşta çizim yok). Saat bir sonraki dakika başına kurulan TEK setTimeout zinciriyle; yalnız panel görünürken (bileşen takılıyken).
//   · Gövde: o sayfanın bileşeni. Sayfa kaydı (B9): `sayfaKaydet(id, bilesen)`; T24–T27 kendi sayfa dosyasını ve aşağıdaki kayıtta tek satırını ekler.
//     Kaydı olmayan sayfa gizlenmez, ertelenmiş gibi de görünmez: tek satır boş durum ve "Bağla" düğmesi (Ayarlar → Görünüm → Çentik sayfaları'na götürür).
//   · Alt: noktalar (üzerine gelince sayfa simgeleri), iki yanda oklar (uçta gizlenir; R20 sarmaz), panel odaktayken ← →, fare tekerleği 60 birimde bir
//     sayfa (en sık 250 ms'de bir; zaman damgasıyla, zamanlayıcısız).
// Hareket yalnız transform ve opacity (panel.css); sayfa değişince gövde kısa bir kaymayla solar. Ses yok: panel açılırken hiçbir şey seslendirilmez.
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type WheelEvent as ReactWheelEvent } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { PANEL_SAYFALARI, TEKERLEK_ARALIK_MS, komsuSayfa, sayfaVurgusu, tekerlekBirikimi, type SayfaKimligi } from '../../shared/centik-sayfalar';
import { Asistan } from './sayfalar/Asistan';
import { Gundem } from './sayfalar/Gundem';
import { Gorevler } from './sayfalar/Gorevler';
import { Gelenler } from './sayfalar/Gelenler';
import { Muzik } from './sayfalar/Muzik';
import { Soz } from './sayfalar/Soz';
import { Odak } from './sayfalar/Odak';
import { Yapilacaklar } from './sayfalar/Yapilacaklar';
import { Raf } from './sayfalar/Raf';
import './panel.css';

// ── Sayfa kaydı (B9) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const KAYIT = new Map<SayfaKimligi, ComponentType>();
/** Bir sayfanın bileşenini kaydeder (T24–T27: kendi sayfa dosyası + aşağıda tek satır). Bileşen verisini kendi kancasından alır; panel ona özellik geçmez. */
export function sayfaKaydet(id: SayfaKimligi, bilesen: ComponentType): void {
  KAYIT.set(id, bilesen);
}
sayfaKaydet('asistan', Asistan);
sayfaKaydet('gundem', Gundem);
sayfaKaydet('gorevler', Gorevler);
sayfaKaydet('gelenler', Gelenler);
sayfaKaydet('muzik', Muzik);
sayfaKaydet('soz', Soz);
sayfaKaydet('odak', Odak);
sayfaKaydet('yapilacaklar', Yapilacaklar);
sayfaKaydet('raf', Raf);

/** Panelin üst satırı ve gövdesi için gereken her şey (Ada.tsx useAsistan'dan geçirir). */
export interface PanelOzellikleri {
  sayfa: SayfaKimligi;
  /** Gezilen sayfalar (açık olanlar, ayardaki sırayla). */
  sayfalar: readonly SayfaKimligi[];
  sec: (id: SayfaKimligi) => void;
  /** Uygulamanın dili (BCP 47; boşsa Türkçe). */
  dil?: string;
  /** 'is' | 'gelistirici': Asistan'ın vurgusu karakterin rengidir. */
  kip: string;
  /** Bilgisayarda medya çalıyor (olay yardımcısı; T21/T25). */
  medya?: boolean;
  azHareket: boolean;
}

/** Bir sonraki dakika başına kurulan tek zamanlayıcı (yalnız bileşen takılıyken; R13 Kapalı hapıyla aynı desen). */
function useDakikaSaati(): number {
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    let z: ReturnType<typeof setTimeout>;
    const kur = () => { z = setTimeout(() => { setSimdi(Date.now()); kur(); }, 60_000 - (Date.now() % 60_000) + 20); };
    kur();
    return () => clearTimeout(z);
  }, []);
  return simdi;
}

/** Kaydı olmayan sayfa: tek satır boş durum + "Bağla" (Görünüm → Çentik sayfaları; ana pencere öne gelir). */
function BosSayfa({ id }: { id: SayfaKimligi }) {
  const ad = PANEL_SAYFALARI[id].ad;
  return (
    <div className="panel__bos" data-sayfa-bos={id}>
      <span className="panel__bos-metin">{ad} henüz bir kaynağa bağlı değil.</span>
      <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => { void cagir('ana:goster', 'ayarlar#centik-sayfalari'); }}>Bağla</button>
    </div>
  );
}

export function Panel({ sayfa, sayfalar, sec, dil, kip, medya, azHareket }: PanelOzellikleri): ReactElement {
  const simdi = useDakikaSaati();
  const yerel = dil || 'tr-TR';
  const tarih = new Intl.DateTimeFormat(yerel, { weekday: 'short', day: 'numeric', month: 'short' }).format(simdi);
  const saat = new Intl.DateTimeFormat(yerel, { hour: '2-digit', minute: '2-digit' }).format(simdi);
  const bilgi = PANEL_SAYFALARI[sayfa];
  const Bilesen = KAYIT.get(sayfa);
  const onceki = komsuSayfa(sayfalar, sayfa, -1);
  const sonraki = komsuSayfa(sayfalar, sayfa, 1);
  // Tekerlek (R20): birikim ve son adım zamanı ref'te (çizim tetiklemez).
  const tekerlek = useRef({ birikim: 0, son: 0 });
  // Sayfa geçişinin yönü (gövdenin kayma yönü; yalnız transform/opacity).
  const [yon, setYon] = useState<1 | -1>(1);
  const git = (y: 1 | -1) => {
    const h = komsuSayfa(sayfalar, sayfa, y);
    if (!h) return;
    setYon(y);
    sec(h);
  };
  const tus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Yazı alanında ok tuşları imleci taşır, sayfa değiştirmez.
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); git(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); git(1); }
  };
  const teker = (e: ReactWheelEvent<HTMLDivElement>) => {
    const t = tekerlek.current;
    const r = tekerlekBirikimi(t.birikim, Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
    t.birikim = r.birikim;
    if (!r.adim) return;
    const an = e.timeStamp || Date.now();
    if (an - t.son < TEKERLEK_ARALIK_MS) return;
    t.son = an;
    git(r.adim);
  };
  return (
    <div className="panel" data-panel-sayfa={sayfa} data-az-hareket={azHareket ? '' : undefined} tabIndex={-1} onKeyDown={tus} onWheel={teker}
      style={{ ['--panel-vurgu' as string]: sayfaVurgusu(sayfa, kip) }}>
      <div className="panel__ust">
        <span className="panel__ad"><i className="panel__vurgu" aria-hidden="true" />{bilgi.ad}</span>
        <span className="panel__zaman"><span className="panel__tarih">{tarih}</span><b className="panel__saat">{saat}</b></span>
        <span className="panel__sag">
          {medya && <span className="panel__medya" aria-label="Medya çalıyor" role="img" data-medya=""><i /><i /><i /></span>}
        </span>
      </div>
      <div className="panel__govde">
        {onceki && <button type="button" className="panel__ok panel__ok--sol" aria-label={`Önceki sayfa: ${PANEL_SAYFALARI[onceki].ad}`} title={PANEL_SAYFALARI[onceki].ad} onClick={() => git(-1)}><Ikon ad="geri" olcu={14} /></button>}
        <div key={sayfa} className="panel__sayfa" data-yon={yon > 0 ? 'ileri' : 'geri'}>
          {Bilesen ? <Bilesen /> : <BosSayfa id={sayfa} />}
        </div>
        {sonraki && <button type="button" className="panel__ok panel__ok--sag" aria-label={`Sonraki sayfa: ${PANEL_SAYFALARI[sonraki].ad}`} title={PANEL_SAYFALARI[sonraki].ad} onClick={() => git(1)}><Ikon ad="ileri" olcu={14} /></button>}
      </div>
      <div className="panel__noktalar" role="tablist" aria-label="Çentik sayfaları">
        {sayfalar.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={s === sayfa} aria-label={PANEL_SAYFALARI[s].ad} title={PANEL_SAYFALARI[s].ad}
            className="panel__nokta" data-secili={s === sayfa ? '' : undefined} style={{ ['--nokta-vurgu' as string]: sayfaVurgusu(s, kip) }}
            onClick={() => { if (s !== sayfa) { setYon(sayfalar.indexOf(s) > sayfalar.indexOf(sayfa) ? 1 : -1); sec(s); } }}>
            <i className="panel__nokta-i" aria-hidden="true" />
            <span className="panel__nokta-simge" aria-hidden="true"><Ikon ad={PANEL_SAYFALARI[s].simge} olcu={12} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}
