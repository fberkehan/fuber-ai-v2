// ── Panelin Odak sayfası (0.14 T26; R26) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Solda iri rakamlarla kalan süre (MM:SS) ve altında ince ilerleme çizgisi, sağda hap düğmeler: "Başlat" / "Duraklat" / "Sürdür", boştayken "Kısa mola" ve "Uzun mola"
// (önerilen mola belirgin), sayım açıkken "Sıfırla". Sayım ANA SÜREÇTE tutulur (main/odak.ts: mutlak bitiş, tek setTimeout, kalıcı): panel kapansa da sürer ve bitince
// çentikte "Odak bitti · Kısa mola" hapı + zil çıkar. Burada yalnız gösterim:
//  · Kalan süre her zaman `bitis − şimdi`'den hesaplanır (shared/odak.ts kalanSn); saniye göstergesi saniye sınırına hizalı TEK setTimeout zinciriyle güncellenir, yalnız
//    sayım sürerken ve yalnız sayfa takılıyken (bileşen çıkınca zincir kesilir); duraklamada, boştayken ve sayfa kapalıyken hiçbir zamanlayıcı yok. setInterval ve çizim döngüsü yok.
//  · İlerleme çizgisi: kalan süre boyunca TEK WAAPI `scaleX` animasyonu (doğrusal, yalnız transform); duraklamada ve boştayken durağan.
//  · Düğmeler yerel <button> (klavye: Sekme/Boşluk/Enter); mola düğmeleri sayım açıkken görünmez (süren odak yanlışlıkla bozulmaz). Karakter yok (Sade modda da);
//    vurgu Panel'in --panel-vurgu'su (Odak kırmızı), mola yeşil.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cagir, dinle } from '../../api';
import { HapDugme } from '../../ui/fintech';
import {
  ODAK_ILK, ODAK_SURELERI, ODAK_TUR_ADI, kalanSn, odakCalisiyor, odakDuraklatildi, onerilenMola, sureMetni, type OdakAdimi, type OdakDurumu, type OdakTuru,
} from '../../../shared/odak';

let son: OdakDurumu | null = null;

/** Ana sürecin sayım durumu: sayfa takılınca bir kez sorulur, sonra 'odak:durum' olayıyla (yoklama yok). Son durum modülde tutulur (sayfalar arası gezinirken anında). */
function useOdakDurumu(): [OdakDurumu | null, (d: OdakDurumu) => void] {
  // Önbellekteki sayım bitmişse (bitiş geçmiş) eski kare (00:00) gösterilmez: boş durum, ardından 'odak:al' yanıtı.
  const [d, setD] = useState<OdakDurumu | null>(() => (son && !(son.bitis !== null && son.bitis <= Date.now()) ? son : null));
  useEffect(() => {
    let takili = true;
    const yaz = (x: OdakDurumu) => { son = x; if (takili) setD(x); };
    void Promise.resolve(cagir<OdakDurumu>('odak:al')).then((x) => { if (x) yaz(x); }).catch(() => undefined);
    const k = dinle('odak:durum', (x: OdakDurumu) => { if (x) yaz(x); });
    return () => { takili = false; k(); };
  }, []);
  return [d, (x) => { son = x; setD(x); }];
}

/** Sayım sürerken "şimdi"yi saniye sınırlarında günceller (TEK setTimeout zinciri; sürmüyorsa zamanlayıcı yok). */
function useSaniye(bitis: number | null): number {
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    setSimdi(Date.now());
    if (bitis === null) return;
    let z: ReturnType<typeof setTimeout> | undefined;
    const kur = () => {
      const kalan = bitis - Date.now();
      if (kalan <= 0) return; // bitiş: yeni durumu ana süreç yollar
      z = setTimeout(() => { setSimdi(Date.now()); kur(); }, (kalan % 1000 || 1000) + 8);
    };
    kur();
    return () => clearTimeout(z);
  }, [bitis]);
  return simdi;
}

/** Süre dakika ve saniye olarak (ekran okuyucu için; dakikada bir değişir, her saniye okutmaz). */
const sureSozle = (sn: number): string => { const dk = Math.floor(sn / 60); return dk > 0 ? `${dk} dakika` : `${sn} saniye`; };

export function Odak(): ReactElement {
  const [d, ayarla] = useOdakDurumu();
  const durum = d ?? ODAK_ILK;
  const calisiyor = odakCalisiyor(durum);
  const duraklamis = odakDuraklatildi(durum);
  const bos = !calisiyor && !duraklamis;
  const simdi = useSaniye(durum.bitis);
  const kalan = kalanSn(durum, simdi);
  const adim = (a: OdakAdimi) => { void Promise.resolve(cagir<OdakDurumu>('odak:adim', a)).then((x) => { if (x) ayarla(x); }).catch(() => undefined); };

  // İlerleme çizgisi: toplam sürenin ne kadarı geçti. Sayım sürerken kalan süre boyunca tek doğrusal scaleX animasyonu.
  const cizgi = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = cizgi.current;
    if (!el) return;
    const toplam = ODAK_SURELERI[durum.tur] * 1000;
    const kalanMs = durum.bitis !== null ? Math.max(0, durum.bitis - Date.now()) : durum.duraklatildi ?? toplam;
    const oran = Math.min(1, Math.max(0, 1 - kalanMs / toplam));
    el.style.transform = `scaleX(${oran})`;
    if (durum.bitis === null || kalanMs <= 0) return;
    const a = el.animate([{ transform: `scaleX(${oran})` }, { transform: 'scaleX(1)' }], { duration: kalanMs, easing: 'linear', fill: 'forwards' });
    return () => a.cancel();
  }, [durum.tur, durum.bitis, durum.duraklatildi]);

  const oneri = bos && durum.tur !== 'odak' ? onerilenMola(durum) : null; // odak bitti: önerilen mola (dördüncüden sonra uzun)
  const mola = (tur: Exclude<OdakTuru, 'odak'>) => (
    <HapDugme key={tur} tur={oneri === tur ? 'birincil' : 'ikincil'} boy="k" data-odak-eylem={tur} data-onerilen={oneri === tur ? '' : undefined} onClick={() => adim({ tur: 'baslat', secim: tur })}>
      {ODAK_TUR_ADI[tur]}
    </HapDugme>
  );
  // Tek satır: sayı; odak bitmiş ve sıra molada ise kısa biçim + öneri ("4 odak · Uzun mola önerilir"), yoksa tam biçim.
  const not = durum.tamamlanan === 0 ? 'Bugün henüz odak yok'
    : oneri ? `${durum.tamamlanan} odak · ${ODAK_TUR_ADI[oneri]} önerilir` : `${durum.tamamlanan} odak tamamlandı`;

  return (
    <div className="odak-sayfa" data-odak-durum={calisiyor ? 'calisiyor' : duraklamis ? 'duraklamis' : 'bos'} data-tur={durum.tur === 'odak' ? 'odak' : 'mola'}>
      <div className="odak-sayfa__sol">
        <span className="odak-sayfa__tur" data-odak-tur={durum.tur}>{ODAK_TUR_ADI[durum.tur]}</span>
        <span className="odak-sayfa__sure" role="timer" aria-live="off" aria-label={`${ODAK_TUR_ADI[durum.tur]}, kalan ${sureSozle(kalan)}`} data-odak-sure={kalan}>{sureMetni(kalan)}</span>
        <span className="odak-sayfa__iz" aria-hidden="true"><span ref={cizgi} className="odak-sayfa__dolu" /></span>
        <span className="odak-sayfa__not" data-odak-not="">{not}</span>
      </div>
      <div className="odak-sayfa__dugmeler">
        {calisiyor
          ? <HapDugme tur="birincil" boy="k" data-odak-eylem="duraklat" onClick={() => adim({ tur: 'duraklat' })}>Duraklat</HapDugme>
          : duraklamis
            ? <HapDugme tur="birincil" boy="k" data-odak-eylem="surdur" onClick={() => adim({ tur: 'surdur' })}>Sürdür</HapDugme>
            : <HapDugme tur={oneri ? 'ikincil' : 'birincil'} boy="k" data-odak-eylem="baslat" onClick={() => adim({ tur: 'baslat' })}>Başlat</HapDugme>}
        {!calisiyor && (
          <>
            {durum.tur !== 'odak' && !duraklamis && <HapDugme tur="ikincil" boy="k" data-odak-eylem="odak" onClick={() => adim({ tur: 'baslat', secim: 'odak' })}>Odak</HapDugme>}
            {mola('kisa')}
            {mola('uzun')}
          </>
        )}
        {!bos && <HapDugme tur="ikincil" boy="k" data-odak-eylem="sifirla" onClick={() => adim({ tur: 'sifirla' })}>Sıfırla</HapDugme>}
      </div>
    </div>
  );
}
