// Hafıza → Meseleler: konuşmalardan çıkan, takip edilecek işler. Kapat / iptal et / hedef tarih koy.
import { useEffect, useState } from 'react';
import { cagir } from '../api';
import { Ikon } from './Ikon';
import { gunFarki, gunGoreli, hataMetni, OdakGirdi, UFAK_HAP } from './DusunmeOrtak';
import type { Mesele } from '../../shared/tipler';

type Degisiklik = { durum?: Mesele['durum']; hedef?: string; baslik?: string };

/** Hedefi bir günden yakın ya da geçmişse turuncu. */
export const hedefYakin = (m: Mesele) => Boolean(m.hedef && m.durum === 'acik' && gunFarki(m.hedef) <= 1);

export function Meseleler() {
  const [durum, setDurum] = useState<'acik' | 'kapandi'>('acik');
  const [liste, setListe] = useState<Mesele[] | null>(null);
  const [hata, setHata] = useState('');
  const yukle = () => void cagir<Mesele[]>('gunkaydi:meseleler', durum).then((l) => setListe(Array.isArray(l) ? l : [])).catch(() => setListe([]));
  useEffect(() => { setListe(null); yukle(); }, [durum]);
  const guncelle = (id: number, d: Degisiklik) => {
    setHata('');
    void cagir<Mesele | null>('gunkaydi:mesele-guncelle', id, d).then(yukle).catch((e) => setHata(hataMetni(e)));
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="sekmeler" role="tablist">
          <button role="tab" aria-selected={durum === 'acik'} onClick={() => setDurum('acik')}>Açık</button>
          <button role="tab" aria-selected={durum === 'kapandi'} onClick={() => setDurum('kapandi')}>Kapanan</button>
        </div>
        <span className="t-kucuk">Konuşmalarda söz verilen ya da yarım kalan işler.</span>
      </div>
      {hata && <div style={{ fontSize: 13, color: 'var(--yazi-hata)' }}>{hata}</div>}
      {liste === null ? <div className="cok-soluk" style={{ fontSize: 13 }}>Yükleniyor…</div>
        : !liste.length ? <div className="kart kutu cok-soluk" style={{ fontSize: 13.5 }}>{durum === 'acik' ? 'Takip edilecek bir şey yok.' : 'Kapanan iş yok.'}</div>
          : <div style={{ display: 'grid', gap: 10 }}>{liste.map((m) => <MeseleKarti key={m.id} m={m} guncelle={guncelle} />)}</div>}
    </div>
  );
}

function MeseleKarti({ m, guncelle }: { m: Mesele; guncelle: (id: number, d: Degisiklik) => void }) {
  const yakin = hedefYakin(m);
  const acik = m.durum === 'acik';
  return (
    <div className="kart" style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <b style={{ fontSize: 14.5 }}>{m.baslik}</b>
          {m.kisi && <span className="hap" style={UFAK_HAP}>{m.kisi}</span>}
          {m.hedef && <span className="hap" style={{ ...UFAK_HAP, ...(yakin ? { color: 'var(--yazi-uyari)', boxShadow: 'inset 0 0 0 1px rgb(245 158 11 / 0.45)' } : {}) }}>hedef: {gunGoreli(m.hedef)}</span>}
          {m.durum === 'iptal' && <span className="hap" style={UFAK_HAP}>iptal</span>}
        </div>
        {m.ayrinti && <div className="soluk" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', userSelect: 'text' }}>{m.ayrinti}</div>}
        <div className="t-kucuk" style={{ marginTop: 6 }}>ilk: {gunGoreli(m.ilkGun)}{m.kapanis ? ` · kapanış: ${gunGoreli(m.kapanis)}` : ''}{m.kaynak ? ' · gün kaydından' : ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {acik ? (
          <>
            <OdakGirdi tur="date" genislik={150} stil={{ height: 32, fontSize: 13 }} title="Hedef tarih" aria-label="Hedef tarih" deger={m.hedef?.slice(0, 10) ?? ''} kaydet={(v) => guncelle(m.id, { hedef: v })} />
            <button className="dgm dgm--koyu dgm--k" onClick={() => guncelle(m.id, { durum: 'kapandi' })}><Ikon ad="tamam" olcu={14} />Kapandı</button>
            <button className="dgm dgm--hayalet dgm--k" onClick={() => guncelle(m.id, { durum: 'iptal' })}><Ikon ad="kapat" olcu={13} />İptal</button>
          </>
        ) : <button className="dgm dgm--hayalet dgm--k" onClick={() => guncelle(m.id, { durum: 'acik' })}><Ikon ad="yenile" olcu={13} />Yeniden aç</button>}
      </div>
    </div>
  );
}
