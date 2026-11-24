// ── Panelin Şarkı sözü sayfası (0.14 T25; P14, B33, Review Focus 3) ──────────────────────────────────────────────────────────────────────────────
// Panel ikiye bölünür: solda küçük Müzik denetimi (kapak, başlık, sanatçı, geri · oynat/duraklat · ileri), sağda sözün satırları. Kurallar:
//  · Sözler internetten (LRCLIB; main/soz.ts 'soz:getir'). Parça değişince 600 ms beklenir (hızlı atlamada kaynağa her parça için istek gitmez); yanıt
//    beklenirken sayfa hemen çizilir ("Sözler aranıyor…"), sol taraf medyayı beklemeden gösterir. Son yanıtlar modülde tutulur: sayfalar arasında gezerken
//    yeniden istenmez.
//  · P14: Gizli ya da "Yalnız bu bilgisayar" seçiliyken istek HİÇ gönderilmez; satırların yerinde BULUT_KAPALI_METNI.soz. Ayar istek sürerken değişirse
//    bekleyen yanıt gösterilmez (ana süreç de isteği keser).
//  · Eşli sözde etkin satır yanar: satır başına TEK setTimeout zinciri (bir sonraki satırın başına kalan süre / hız; B33). Duraklamada, panel kapalıyken
//    (sayfa takılı değil) ya da sözler bitince zamanlayıcı yok; requestAnimationFrame döngüsü yok. Satıra tıklamak o satırın başına `konum` komutudur.
//  · Yalnız düz söz varsa eşsiz gösterilir (kaydırılabilir metin, altta "Bu sözler eşzamanlı değil."). Bulunamadıysa "Bu şarkının sözleri bulunamadı.".
//  · Medya yoksa "Şu an çalan bir şey yok.". Karakter yok (Sade modda da); vurgu --panel-vurgu (#BF5AF2). Hareket yalnız transform ve opacity.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cagir, dinle } from '../../api';
import { medyaKonumu } from '../../../shared/sistem-olay';
import { bulutYasak } from '../../../shared/bulut-kapisi';
import { etkinSatir, sonrakiSatirSn, sozAnahtari, sozDurumMetni, SOZ_METNI, type LrcSatiri, type SozSonucu } from '../../../shared/lrc';
import type { Ayarlar } from '../../../shared/tipler';
import { Denetimler, Kapak, ParcaBilgisi } from './Muzik';
import { calanMedya, medyaKomutuGonder, useMedya, type CalanMedya } from './useMedya';

/** Parça değişince isteğe kadar beklenen süre (hızlı atlama). */
export const SOZ_BEKLEME_MS = 600;
const SON_YANITLAR = new Map<string, SozSonucu>();
const SON_SINIRI = 30;

/** Son bilinen bulut kararı (sayfalar arasında gezerken ilk karede de doğru satır). */
let sonBulutKapali: boolean | null = null;

/** Bulut yasak mı (Gizli ya da "Yalnız bu bilgisayar"), ayar değişince canlı. null: henüz bilinmiyor — istek ayar okunmadan çıkmaz. */
function useBulutKapali(): boolean | null {
  const [kapali, setKapali] = useState<boolean | null>(sonBulutKapali);
  useEffect(() => {
    let takili = true;
    const uygula = (a: Partial<Ayarlar> | null | undefined) => {
      sonBulutKapali = bulutYasak({ gizliMod: a?.yerel?.gizliMod === true, yalnizYerel: a?.yerel?.yalnizYerel === true });
      if (takili) setKapali(sonBulutKapali);
    };
    void Promise.resolve(cagir<Ayarlar>('ayarlar:al')).then(uygula).catch(() => undefined);
    const birak = dinle('ayarlar:degisti', uygula);
    return () => { takili = false; birak(); };
  }, []);
  return kapali;
}

/** Çalan parçanın sözü: null = aranıyor (ya da medya yok). */
function useSoz(m: CalanMedya | null, bulutKapali: boolean | null): SozSonucu | null {
  const istek = m && m.baslik.trim() ? { baslik: m.baslik, sanatci: m.sanatci, album: m.album, sure: m.sure } : null;
  const anahtar = istek ? sozAnahtari(istek) : null;
  const [sonuc, setSonuc] = useState<{ anahtar: string | null; s: SozSonucu | null }>({ anahtar: null, s: null });
  useEffect(() => {
    if (!anahtar || !istek || bulutKapali !== false) return;
    const hazir = SON_YANITLAR.get(anahtar);
    if (hazir) { setSonuc({ anahtar, s: hazir }); return; }
    setSonuc({ anahtar, s: null });
    let iptal = false;
    const z = setTimeout(() => {
      void Promise.resolve(cagir<SozSonucu>('soz:getir', istek)).catch((): SozSonucu => ({ tur: 'hata' })).then((s) => {
        if (iptal || !s) return; // parça değişti, sayfa kapandı ya da Gizli açıldı: yanıt gösterilmez
        if (s.tur !== 'hata' && s.tur !== 'kapali') {
          SON_YANITLAR.delete(anahtar);
          SON_YANITLAR.set(anahtar, s);
          if (SON_YANITLAR.size > SON_SINIRI) SON_YANITLAR.delete(SON_YANITLAR.keys().next().value as string);
        }
        setSonuc({ anahtar, s });
      });
    }, SOZ_BEKLEME_MS);
    return () => { iptal = true; clearTimeout(z); };
    // anahtar istek alanlarını içerir.
  }, [anahtar, bulutKapali]);
  if (!m || bulutKapali === null) return null;
  if (bulutKapali) return { tur: 'kapali' };
  if (!istek) return { tur: 'bulunamadi' };
  return sonuc.anahtar === anahtar ? sonuc.s : SON_YANITLAR.get(anahtar!) ?? null;
}

/** Etkin satırın sırası: satır başına tek setTimeout zinciri (çalarken); duraklamada sabit. */
function useEtkinSatir(satirlar: readonly LrcSatiri[] | null, m: CalanMedya | null): number {
  const [etkin, setEtkin] = useState(-1);
  const mRef = useRef(m);
  mRef.current = m;
  const caliyor = Boolean(m?.caliyor && m.hiz > 0);
  useEffect(() => {
    const md = mRef.current;
    if (!satirlar || !md) { setEtkin(-1); return; }
    let z: ReturnType<typeof setTimeout> | undefined;
    const adim = () => {
      const konum = medyaKonumu(md, Date.now());
      setEtkin(etkinSatir(satirlar, konum));
      if (!caliyor) return;
      const sonraki = sonrakiSatirSn(satirlar, konum);
      if (sonraki === null) return; // son satır: zincir biter
      z = setTimeout(adim, Math.max(20, ((sonraki - konum) / md.hiz) * 1000 + 15));
    };
    adim();
    return () => clearTimeout(z);
  }, [satirlar, m?.baslik, m?.konum, m?.konumZamani, m?.hiz, caliyor]);
  return etkin;
}

function Satirlar({ satirlar, m }: { satirlar: readonly LrcSatiri[]; m: CalanMedya }): ReactElement {
  const etkin = useEtkinSatir(satirlar, m);
  // Görünen pencere: etkin satır ortada, önce ve sonra birer satır (ilk satırdan önce: ilk iki satır).
  const bas = Math.max(0, Math.min(satirlar.length - 3, etkin - 1));
  const gorunen = satirlar.slice(bas, bas + 3).map((s, i) => ({ s, i: bas + i }));
  return (
    <ol key={etkin} className="soz-sayfa__satirlar" data-etkin-satir={etkin} aria-live="off">
      {gorunen.map(({ s, i }) => (
        <li key={i}>
          <button type="button" className="soz-sayfa__satir" data-etkin={i === etkin ? '' : undefined} title={s.metin || undefined}
            onClick={() => void medyaKomutuGonder({ eylem: 'konum', sn: s.sn })}>
            {s.metin || '♪'}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function Soz(): ReactElement {
  const d = useMedya();
  const m = calanMedya(d);
  const bulutKapali = useBulutKapali();
  const s = useSoz(m, bulutKapali);
  const metin = m ? sozDurumMetni(s) : SOZ_METNI.yok;
  return (
    <div className="soz-sayfa" data-soz-durum={!m ? 'yok' : s?.tur ?? 'araniyor'}>
      <div className="soz-sayfa__sol">
        <Kapak m={m} olcu={44} />
        {/* Oturum yokken tek satır sağda (iki kez yazılmaz). */}
        <ParcaBilgisi m={m} yokMetni={false} />
        <Denetimler m={m} kucuk />
      </div>
      <div className="soz-sayfa__sag">
        {metin !== null || !m || !s
          ? <p className="soz-sayfa__tek" data-soz-metni="">{metin}</p>
          : s.tur === 'esli'
            ? <Satirlar satirlar={s.satirlar} m={m} />
            : s.tur === 'duz'
              ? (
                <div className="soz-sayfa__duz">
                  <p className="soz-sayfa__duz-metin" tabIndex={0}>{s.metin}</p>
                  <p className="centik-not">{SOZ_METNI.duz}</p>
                </div>
              )
              : null}
      </div>
    </div>
  );
}
