// ── Çalışan süreçler (analiz 11 Kas bulgu 4; yalnız Developer mode'da süreç olur) ────────────────────────────────────────────────────
// Sohbetin `komut_calistir { arka_plan: true }` ile başlattığı dev sunucusu / izleyici süreçleri yazma kutusunun üstünde listelenir: komut, klasör,
// süre, son satır; açılır canlı çıktı (açıkken saniyede bir 'surec:cikti') ve "Durdur" (süreç ağacı kapanır). Biten süreçler kısa satır olarak kalır
// (en çok 3; "Kapat" ile gizlenir). Liste ana süreçteki yöneticiden ('surec:liste' + 'surec:degisti'). Hareket yalnız transform ve opacity.
import { useEffect, useState } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from './Ikon';
import type { SurecOzeti } from '../../shared/surec';
import './calisan-surecler.css';
import { IsIsareti } from '../is-izi/IsSeridi';
import { surecIsi } from '../../shared/is-izi';

const sure = (ms: number): string => {
  const sn = Math.max(0, Math.floor(ms / 1000));
  if (sn < 60) return `${sn} sn`;
  const dk = Math.floor(sn / 60);
  if (dk < 60) return `${dk} dk ${sn % 60} sn`;
  return `${Math.floor(dk / 60)} sa ${dk % 60} dk`;
};
const klasorAdi = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function CalisanSurecler() {
  const [liste, setListe] = useState<SurecOzeti[]>([]);
  const [gizli, setGizli] = useState<Set<string>>(() => new Set());
  const [, setTik] = useState(0);
  useEffect(() => {
    void cagir<SurecOzeti[]>('surec:liste').then((l) => { if (Array.isArray(l)) setListe(l); }).catch(() => undefined);
    return dinle('surec:degisti', (l: SurecOzeti[]) => { if (Array.isArray(l)) setListe(l); });
  }, []);
  const calisan = liste.filter((s) => s.durum === 'calisiyor' || s.durum === 'durduruluyor');
  useEffect(() => {
    if (!calisan.length) return;
    const z = setInterval(() => setTik((n) => n + 1), 1000);
    return () => clearInterval(z);
  }, [calisan.length]);
  const biten = liste.filter((s) => s.durum !== 'calisiyor' && s.durum !== 'durduruluyor' && !gizli.has(s.kimlik)).sort((a, b) => (b.bitis ?? 0) - (a.bitis ?? 0)).slice(0, 3);
  const gorunen = [...calisan, ...biten];
  if (!gorunen.length) return null;
  return (
    <section className="surecler" aria-label="Çalışan süreçler" data-calisan={calisan.length}>
      <div className="surecler__bas"><Ikon ad="terminal" olcu={13} /><span>Çalışan süreçler{calisan.length ? ` · ${calisan.length}` : ''}</span><span className="surecler__not">uygulama kapanınca kapanır</span></div>
      <ul className="surecler__liste">
        {gorunen.map((s) => <SurecSatiri key={s.kimlik} s={s} kapat={() => setGizli((g) => new Set(g).add(s.kimlik))} />)}
      </ul>
    </section>
  );
}

function SurecSatiri({ s, kapat }: { s: SurecOzeti; kapat: () => void }) {
  const [acik, setAcik] = useState(false);
  const [satirlar, setSatirlar] = useState<string[] | null>(null);
  const [hata, setHata] = useState('');
  const calisiyor = s.durum === 'calisiyor' || s.durum === 'durduruluyor';
  useEffect(() => {
    if (!acik) return;
    let iptal = false;
    const oku = () => void cagir<{ satirlar: string[] } | null>('surec:cikti', s.kimlik, 80).then((r) => { if (!iptal) setSatirlar(r?.satirlar ?? []); }).catch(() => undefined);
    oku();
    if (!calisiyor) return () => { iptal = true; };
    const z = setInterval(oku, 1000);
    return () => { iptal = true; clearInterval(z); };
  }, [acik, calisiyor, s.kimlik]);
  const durdur = async () => {
    setHata('');
    const r = await cagir<{ tamam: boolean; hata?: string }>('surec:durdur', s.kimlik).catch((e) => ({ tamam: false, hata: (e as Error).message }));
    if (!r.tamam) setHata(r.hata ?? 'Durdurulamadı.');
  };
  const durumMetni = s.durum === 'durduruluyor' ? 'durduruluyor…' : calisiyor ? sure(Date.now() - s.baslangic) : s.durum === 'durduruldu' ? 'durduruldu' : s.durum === 'hata' ? 'başlatılamadı' : `bitti · çıkış kodu ${s.kod ?? '?'}`;
  return (
    <li className="surec" data-durum={s.durum} data-surec={s.kimlik}>
      <div className="surec__satir">
        {/* İş izi (11 Kas): aynı durum işareti (yörünge / tik / durağan nokta) — bütün yüzeylerle tek dil. */}
        <IsIsareti hal={surecIsi(s).hal} olcu={14} />
        <code className="surec__komut" title={s.komut}>{s.komut}</code>
        <span className="surec__klasor" title={s.klasor}>{klasorAdi(s.klasor)}</span>
        <span className="surec__sure">{durumMetni}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="dgm dgm--hayalet dgm--k" aria-expanded={acik} onClick={() => setAcik((x) => !x)}>{acik ? 'Çıktıyı gizle' : 'Çıktı'}</button>
        {calisiyor
          ? <button type="button" className="dgm dgm--koyu dgm--k" data-surec-durdur="" disabled={s.durum === 'durduruluyor'} onClick={() => void durdur()}><Ikon ad="dur" olcu={13} />Durdur</button>
          : <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" aria-label="Listeden kaldır" title="Listeden kaldır" onClick={kapat}><Ikon ad="kapat" olcu={13} /></button>}
      </div>
      {!acik && s.sonSatir && <div className="surec__son">{s.sonSatir}</div>}
      {s.hata && <div className="surec__son" data-ton="hata">{s.hata}</div>}
      {hata && <div className="surec__son" data-ton="hata" role="alert">{hata}</div>}
      {acik && <pre className="surec__cikti" aria-label={`${s.komut} çıktısı`}>{satirlar === null ? 'Okunuyor…' : satirlar.length ? satirlar.join('\n') : 'Henüz çıktı yok.'}</pre>}
    </li>
  );
}
