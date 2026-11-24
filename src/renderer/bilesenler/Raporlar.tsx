// Hafıza → Raporlar: günlük / haftalık / aylık raporlar ve "Şimdi hazırla" (model çağrısı; 10–60 sn sürebilir).
import { useEffect, useState } from 'react';
import { cagir, zamanGoreli } from '../api';
import { Ikon } from './Ikon';
import { hataMetni, silinmeMetni, UFAK_HAP } from './DusunmeOrtak';
import type { Rapor, RaporBolumu, RaporTuru } from '../../shared/tipler';
import { gizliRaporNotu } from '../../shared/gizli-suzgec';
import { TERIM } from '../../shared/terimler';

const TURLER: [RaporTuru, string][] = [['gunluk', 'Günlük'], ['haftalik', 'Haftalık'], ['aylik', 'Aylık']];

/** "2026-10-19" → "19 Ekim Pazartesi"; "2026-W43" → "2026 · 43. hafta"; "2026-10" → "Ekim 2026". */
function donemMetni(r: Rapor): string {
  const h = /^(\d{4})-W(\d{1,2})$/.exec(r.donem);
  if (h) return `${h[1]} · ${Number(h[2])}. hafta`;
  if (/^\d{4}-\d{2}$/.test(r.donem)) return new Date(`${r.donem}-01T12:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.donem)) return new Date(`${r.donem}T12:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  return r.donem;
}

export function Raporlar() {
  const [tur, setTur] = useState<RaporTuru>('gunluk');
  const [liste, setListe] = useState<Rapor[] | null>(null);
  const [hazirlanan, setHazirlanan] = useState<RaporTuru | null>(null);
  const [mesaj, setMesaj] = useState<{ tamam: boolean; metin: string } | null>(null);
  const [tazele, setTazele] = useState(0);

  useEffect(() => {
    setListe(null);
    void cagir<Rapor[]>('gunkaydi:raporlar', { tur, limit: 30 }).then((l) => setListe(Array.isArray(l) ? l : [])).catch(() => setListe([]));
  }, [tur, tazele]);

  const hazirla = () => {
    const t = tur;
    setHazirlanan(t); setMesaj(null);
    void cagir<Rapor | null>('gunkaydi:rapor-hazirla', t)
      .then((r) => setMesaj(r ? { tamam: true, metin: r.yerelKorundu ? gizliRaporNotu(t) : `✓ ${TURLER.find(([k]) => k === t)?.[1]} rapor hazır.` } : { tamam: false, metin: 'Bu dönem için rapor çıkaracak not yok.' }))
      .catch((e) => setMesaj({ tamam: false, metin: hataMetni(e) }))
      .finally(() => { setHazirlanan(null); setTazele((n) => n + 1); });
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="sekmeler" role="tablist">{TURLER.map(([k, e]) => <button key={k} role="tab" aria-selected={tur === k} onClick={() => setTur(k)}>{e}</button>)}</div>
        <span style={{ flex: 1 }} />
        {hazirlanan && <span className="t-kucuk">Rapor hazırlanıyor; bu 10–60 sn sürebilir.</span>}
        <button className="dgm dgm--beyaz dgm--k" disabled={hazirlanan !== null} onClick={hazirla}>
          {hazirlanan === tur ? <span className="donen" /> : <Ikon ad="yildiz" olcu={14} />}
          {hazirlanan ? 'Hazırlanıyor…' : 'Şimdi hazırla'}
        </button>
      </div>
      {mesaj && <div style={{ fontSize: 13, color: mesaj.tamam ? 'var(--yazi-basari)' : 'var(--yazi-hata)' }}>{mesaj.metin}</div>}
      {liste === null ? <div className="cok-soluk" style={{ fontSize: 13 }}>Yükleniyor…</div>
        : !liste.length ? <div className="kart kutu cok-soluk" style={{ fontSize: 13.5 }}>Henüz {TURLER.find(([k]) => k === tur)?.[1].toLocaleLowerCase('tr-TR')} rapor yok. Günlük rapor her akşam ayarladığın saatte, haftalık ve aylık raporlar dönem sonunda hazırlanır; istersen şimdi hazırla.</div>
          : liste.map((r) => <RaporKarti key={r.id} r={r} />)}
    </div>
  );
}

function RaporKarti({ r }: { r: Rapor }) {
  const altBolumler: [string, string[]][] = ([['Kararlar', r.kararlar], [TERIM.takip, r.acikMeseleler], ['İleriye', r.ileriye]] as [string, string[]][]).filter(([, l]) => l?.length);
  return (
    <div className="kart kutu" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-ara">{r.baslik}</div>
          {r.ozet && <div className="soluk" style={{ fontSize: 14, marginTop: 6, userSelect: 'text', textWrap: 'pretty' }}>{r.ozet}</div>}
        </div>
        <span className="hap" style={UFAK_HAP}>{donemMetni(r)}</span>
      </div>
      {(r.onemli?.length > 0 || r.onemsiz?.length > 0) && (
        <div className="ikili">
          {r.onemli?.length > 0 && <RaporBolumListesi baslik="Önemli" liste={r.onemli} />}
          {r.onemsiz?.length > 0 && <RaporBolumListesi baslik="Önemsiz" liste={r.onemsiz} soluk />}
        </div>
      )}
      {altBolumler.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {altBolumler.map(([b, l]) => (
            <div key={b}><div className="ust-etiket">{b}</div><ul className="rapor-liste">{l.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          ))}
        </div>
      )}
      {r.espri && <div style={{ fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 13.5 }}><span style={{ fontStyle: 'normal', marginRight: 6 }}>😄</span>{r.espri}</div>}
      <div className="t-kucuk" style={{ borderTop: '1px solid var(--cizgi)', paddingTop: 10 }}>
        {/* Görev 21: tek görünen kimlik "Fuber" — raporu yazan modelin adı gösterilmez. */}
        {[`${r.maddeSayisi} madde`, `güncellendi ${zamanGoreli(r.guncelleme)}`].join(' · ')}
      </div>
    </div>
  );
}

function RaporBolumListesi({ baslik, liste, soluk }: { baslik: string; liste: RaporBolumu[]; soluk?: boolean }) {
  return (
    <div style={soluk ? { opacity: 0.62 } : undefined}>
      <div className="ust-etiket">{baslik}</div>
      <ul className="rapor-liste">
        {liste.map((b, i) => (
          <li key={i}>{b.metin}{b.silinme && <span className="t-kucuk" style={{ marginLeft: 8, fontSize: 11.5 }}>· {silinmeMetni(b.silinme)}</span>}</li>
        ))}
      </ul>
    </div>
  );
}
