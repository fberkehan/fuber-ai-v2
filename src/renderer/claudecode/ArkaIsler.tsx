// ── Claude Code işleri (analiz 11 Kas bulgu 5) ─────────────────────────────────────────────────────────────────────────────────────
// Bash `run_in_background`, alt ajan ve izleyici gibi işler yalnız sayı olarak görünüyordu: adı, çıktısı ve durdurma yolu yoktu. Bu şerit
// yazma kutusunun üstünde her işi bir satırla gösterir: ad, hâl, canlı süre (tool_progress / task_progress), son araç ya da özet; kabuk işinde
// açılır canlı çıktı kuyruğu (Claude Code'un çıktı dosyasının son satırları, açıkken saniyede bir); "Durdur" (SDK stopTask) ve ön plandaki
// iş için "Arka plana al" (SDK backgroundTasks — CLI'deki Ctrl+B). Biten işler kısa satır olarak kalır (en çok 3), süreç kapanınca "durdu".
// Hareket yalnız transform ve opacity (satır girişi, nabız); azaltılmış harekette hiç yok.
import { useEffect, useState } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { islem, type CanliOturum } from './depo';
import { sureMetni } from './yardimci';
import type { CcArkaIs, CcOturumOzeti } from '../../shared/cc-olay';
import { ccArkaIsIsi } from '../../shared/is-izi';
import { IsSeridi } from '../is-izi/IsSeridi';
import { useSaniye } from '../is-izi/depo';

const TIP_ADI: Record<CcArkaIs['tip'], string> = { kabuk: 'Komut', ajan: 'Alt ajan', izleyici: 'İzleyici', diger: 'Görev' };
const DURUM_ADI: Record<CcArkaIs['durum'], string> = { suruyor: 'sürüyor', bitti: 'bitti', basarisiz: 'başarısız', durduruldu: 'durduruldu' };

/** Görünen süre: süren işte son bildirilen süre ile başlangıçtan geçen sürenin büyüğü (bildirim gecikse de sayaç akar). */
export function isSuresi(i: Pick<CcArkaIs, 'durum' | 'sureSn' | 'baslangic' | 'bitis'>, simdi = Date.now()): number {
  const bildirilen = (i.sureSn ?? 0) * 1000;
  if (i.durum !== 'suruyor') return Math.max(bildirilen, i.bitis ? i.bitis - i.baslangic : 0);
  return Math.max(bildirilen, simdi - i.baslangic);
}

/** Şeritte görünecek işler: sürenler (ön plandakiler önce) + en yeni 3 biten. */
export function gorunenIsler(l: readonly CcArkaIs[]): CcArkaIs[] {
  const suren = l.filter((i) => i.durum === 'suruyor').sort((a, b) => Number(a.arkaPlanda) - Number(b.arkaPlanda) || a.baslangic - b.baslangic);
  const biten = l.filter((i) => i.durum !== 'suruyor').sort((a, b) => (b.bitis ?? 0) - (a.bitis ?? 0)).slice(0, 3);
  return [...suren, ...biten];
}

export function ArkaIsler({ k }: { k: CanliOturum }) {
  const isler = gorunenIsler(k.arkaIsler);
  // 12 Kas (İşler şeridi ekranın yarısını kaplıyordu): şerit varsayılan olarak TEK satır özet; liste yalnız açılınca görünür.
  // Ön planda süren iş (tur onu bekliyor) varsa liste kendiliğinden açık gelir; kullanıcı kapatırsa kapalı kalır.
  const [secim, setSecim] = useState<boolean | null>(null);
  if (!isler.length) return null;
  const suren = isler.filter((i) => i.durum === 'suruyor');
  const onPlanda = suren.some((i) => !i.arkaPlanda);
  const acik = secim ?? onPlanda;
  const ilk = suren[0] ?? isler[0];
  const ozet = suren.length ? `${suren.length} iş sürüyor` : `${isler.length} iş bitti`;
  return (
    <section className="cc-isler" data-acik={acik ? '' : undefined} data-suren={suren.length ? '' : undefined} aria-label="Claude Code işleri">
      <button type="button" className="cc-isler__bas" aria-expanded={acik} onClick={() => setSecim(!acik)}>
        <span className="cc-isler__isik" aria-hidden="true" />
        <span className="cc-isler__ozet">{ozet}</span>
        {!acik && ilk && <span className="cc-isler__ilk">{ilk.aciklama}</span>}
        {acik && suren.length > 0 && k.ozet.durum === 'bosta' && <span className="cc-isler__not">tur bitti; bu işler arkada sürüyor</span>}
        <Ikon ad="asagi" olcu={13} />
      </button>
      {acik && (
        <ul className="cc-isler__liste">
          {isler.map((i) => <IsSatiri key={i.id} oturum={k.ozet} is={i} />)}
        </ul>
      )}
    </section>
  );
}

function IsSatiri({ oturum, is: i }: { oturum: CcOturumOzeti; is: CcArkaIs }) {
  const oturumId = oturum.id;
  const [acik, setAcik] = useState(false);
  const [cikti, setCikti] = useState<{ satirlar: string[]; hata?: string } | null>(null);
  const [hata, setHata] = useState('');
  const [bekliyor, setBekliyor] = useState(false);
  const suruyor = i.durum === 'suruyor';
  const simdi = useSaniye(suruyor);
  const ciktiVar = Boolean(i.ciktiDosyasi);
  // Açıkken çıktı kuyruğu: süren işte saniyede bir, biten işte bir kez.
  useEffect(() => {
    if (!acik || !ciktiVar) return;
    let iptal = false;
    const oku = () => void cagir<{ satirlar: string[]; hata?: string }>('claudecode:is-cikti', oturumId, i.id).then((r) => { if (!iptal) setCikti(r); }).catch(() => undefined);
    oku();
    if (!suruyor) return () => { iptal = true; };
    const z = setInterval(oku, 1000);
    return () => { iptal = true; clearInterval(z); };
  }, [acik, ciktiVar, suruyor, oturumId, i.id]);
  const eylem = async (kanal: 'claudecode:is-durdur' | 'claudecode:is-arka-plan') => {
    setBekliyor(true); setHata('');
    const r = await islem<{ tamam: boolean; hata?: string }>(kanal, oturumId, i.id);
    setBekliyor(false);
    if (!r.tamam) setHata(r.hata ?? 'Yapılamadı.');
  };
  const alt = i.ozet || (i.sonArac ? `son araç: ${i.sonArac}` : '');
  return (
    <li className="cc-is" data-durum={i.durum} data-arkada={i.arkaPlanda ? '' : undefined}>
      {/* İş izi (11 Kas): satır bütün yüzeylerin AYNI şerididir (durum işareti, tür, işin adı, canlı fiil, süre); eylemler sağda. */}
      <div className="cc-is__satir">
        <IsSeridi is={ccArkaIsIsi(i, oturum)} simdi={simdi} cesit="cc" kim={`${TIP_ADI[i.tip]}${!i.arkaPlanda && suruyor ? ' · ön planda' : ''}`} />
        <span className="gorunmez">{suruyor ? sureMetni(Math.floor(isSuresi(i) / 1000) * 1000) : DURUM_ADI[i.durum]}</span>
        {ciktiVar && <button type="button" className="dgm dgm--hayalet dgm--k" aria-expanded={acik} onClick={() => setAcik((x) => !x)}><Ikon ad="terminal" olcu={13} />{acik ? 'Çıktıyı gizle' : 'Çıktı'}</button>}
        {suruyor && !i.arkaPlanda && i.aracId && <button type="button" className="dgm dgm--koyu dgm--k" disabled={bekliyor} onClick={() => void eylem('claudecode:is-arka-plan')} title="Ön plandaki işi arka plana al (Ctrl+B karşılığı); tur sürer">Arka plana al</button>}
        {suruyor && <button type="button" className="dgm dgm--koyu dgm--k" data-is-durdur="" disabled={bekliyor} onClick={() => void eylem('claudecode:is-durdur')}><Ikon ad="dur" olcu={13} />Durdur</button>}
      </div>
      {alt && <div className="cc-is__alt">{alt}</div>}
      {hata && <div className="cc-is__alt" data-ton="hata" role="alert">{hata}</div>}
      {acik && (
        <pre className="cc-is__cikti" aria-live="off" aria-label={`${i.aciklama} çıktısı`}>
          {cikti ? (cikti.satirlar.length ? cikti.satirlar.join('\n') : cikti.hata ?? 'Henüz çıktı yok.') : 'Okunuyor…'}
        </pre>
      )}
    </li>
  );
}
