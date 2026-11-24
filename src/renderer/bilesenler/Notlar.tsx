// Hafıza → Notlar: gün kaydının gün gün tuttuğu not maddeleri (önemli / önemsiz) ve istenirse o gün yazıya dökülen konuşma (P2).
import { useEffect, useMemo, useRef, useState } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from './Ikon';
import { gunAnahtari, saatMetni, silinmeMetni, hataMetni, UFAK_HAP } from './DusunmeOrtak';
import type { DokumSatiri, DusunmeDurumu, NotMaddesi } from '../../shared/tipler';
import { TERIM, buyukBasla } from '../../shared/terimler';

/** Son 7 gün: Bugün, Dün, sonra "17 Cum" gibi. */
function sonYediGun(): { gun: string; ad: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(); t.setDate(t.getDate() - i);
    return { gun: gunAnahtari(t), ad: i === 0 ? 'Bugün' : i === 1 ? 'Dün' : `${t.getDate()} ${t.toLocaleDateString('tr-TR', { weekday: 'short' })}` };
  });
}

export function Notlar() {
  const gunler = useMemo(sonYediGun, []);
  const bugun = gunler[0].gun;
  const [gun, setGun] = useState(bugun);
  const [maddeler, setMaddeler] = useState<NotMaddesi[] | null>(null);
  const [dokumAcik, setDokumAcik] = useState(false);
  const [dokum, setDokum] = useState<DokumSatiri[] | null>(null);
  const [tutuluyor, setTutuluyor] = useState(false);
  const [mesaj, setMesaj] = useState<{ tamam: boolean; metin: string } | null>(null);

  const yukle = () => void cagir<NotMaddesi[]>('gunkaydi:maddeler', { gun }).then((l) => setMaddeler(Array.isArray(l) ? l : [])).catch(() => setMaddeler([]));
  const dokumYukle = () => void cagir<DokumSatiri[]>('gunkaydi:dokum', gun)
    .then((l) => setDokum(Array.isArray(l) ? [...l].sort((x, y) => x.zaman.localeCompare(y.zaman) || x.id - y.id) : []))
    .catch(() => setDokum([]));
  useEffect(() => { setMaddeler(null); yukle(); }, [gun]);
  useEffect(() => { if (dokumAcik) { setDokum(null); dokumYukle(); } }, [gun, dokumAcik]);

  // Bugün seçiliyken yeni not ya da yeni satır gelince tazele (sayaç değişmedikçe sessiz).
  const son = useRef({ madde: -1, satir: -1 });
  useEffect(() => dinle('gunkaydi:durum', (d: DusunmeDurumu) => {
    if (gun !== bugun || !d?.bugun) return;
    if (d.bugun.madde !== son.current.madde) { if (son.current.madde >= 0) yukle(); son.current.madde = d.bugun.madde; }
    if (d.bugun.satir !== son.current.satir) { if (son.current.satir >= 0 && dokumAcik) dokumYukle(); son.current.satir = d.bugun.satir; }
  }), [gun, dokumAcik]);

  const notTut = () => {
    setTutuluyor(true); setMesaj(null);
    void cagir<{ madde: number }>('gunkaydi:not-tut')
      .then((r) => { setMesaj({ tamam: true, metin: r?.madde ? `${r.madde} yeni not eklendi.` : 'Yeni not çıkmadı.' }); if (gun === bugun) yukle(); })
      .catch((e) => setMesaj({ tamam: false, metin: hataMetni(e) }))
      .finally(() => setTutuluyor(false));
  };

  const onemli = (maddeler ?? []).filter((m) => m.onem === 'onemli');
  const onemsiz = (maddeler ?? []).filter((m) => m.onem !== 'onemli');

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="sekmeler" role="tablist">{gunler.map((g) => <button key={g.gun} role="tab" aria-selected={gun === g.gun} onClick={() => setGun(g.gun)}>{g.ad}</button>)}</div>
        <span style={{ flex: 1 }} />
        <button className="dgm dgm--hayalet dgm--k" aria-pressed={dokumAcik} onClick={() => setDokumAcik((x) => !x)}><Ikon ad="liste" olcu={14} />{dokumAcik ? 'Konuşmayı gizle' : 'Konuşmayı göster'}</button>
        <button className="dgm dgm--koyu dgm--k" disabled={tutuluyor} onClick={notTut}>{tutuluyor ? <span className="donen" /> : <Ikon ad="kalem" olcu={14} />}{tutuluyor ? 'Not tutuluyor…' : 'Şimdi not tut'}</button>
      </div>
      {mesaj && <div style={{ fontSize: 13, color: mesaj.tamam ? 'var(--yazi-basari)' : 'var(--yazi-hata)' }}>{mesaj.metin}</div>}

      {dokumAcik && (
        <div className="kart kutu" style={{ padding: '14px 18px' }}>
          <div className="ust-etiket">{buyukBasla(TERIM.dokum)}{dokum ? ` · ${dokum.length} satır` : ''}</div>
          <Dokum satirlar={dokum} />
        </div>
      )}

      {maddeler === null ? <div className="cok-soluk" style={{ fontSize: 13 }}>Yükleniyor…</div>
        : !maddeler.length ? <div className="kart kutu cok-soluk" style={{ fontSize: 13.5 }}>{gun === bugun ? 'Bugün henüz not yok. Sürekli dinleme açıksa Fuber duyduklarından düzenli aralıklarla not çıkarır; beklemek istemezsen “Şimdi not tut”.' : 'Bu gün için not yok.'}</div>
          : <>
            <NotGrubu baslik="Önemli" liste={onemli} />
            <NotGrubu baslik="Önemsiz" liste={onemsiz} soluk />
          </>}
    </div>
  );
}

function NotGrubu({ baslik, liste, soluk }: { baslik: string; liste: NotMaddesi[]; soluk?: boolean }) {
  if (!liste.length) return null;
  return (
    <div className="kart kutu" style={{ padding: '14px 18px 6px' }}>
      <div className="ust-etiket">{baslik} · {liste.length}</div>
      {liste.map((m) => (
        <div key={m.id} className="not-satiri" style={soluk ? { opacity: 0.62 } : undefined}>
          <span className="not-satiri__saat">{saatMetni(m.zaman)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: 'var(--metin)', userSelect: 'text' }}>{m.eglenceli && <span title="eğlenceli" style={{ marginRight: 6 }}>🙂</span>}{m.metin}</div>
            {(m.konu || m.kisiler?.length > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {m.konu && <span className="hap" style={UFAK_HAP}>{m.konu}</span>}
                {m.kisiler?.map((k) => <span key={k} className="hap" style={{ ...UFAK_HAP, color: 'var(--ink-3)' }}>@{k}</span>)}
              </div>
            )}
          </div>
          <span className="t-kucuk" style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>{silinmeMetni(m.silinme)}</span>
        </div>
      ))}
    </div>
  );
}

/** Ham döküm: en yeni en altta; açılınca sona kaydırılır. */
function Dokum({ satirlar }: { satirlar: DokumSatiri[] | null }) {
  const kutu = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = kutu.current; if (k) k.scrollTop = k.scrollHeight; }, [satirlar]);
  if (!satirlar) return <div className="cok-soluk" style={{ fontSize: 13, marginTop: 10 }}>Yükleniyor…</div>;
  if (!satirlar.length) return <div className="cok-soluk" style={{ fontSize: 13, marginTop: 10 }}>Bu gün yazıya dökülen konuşma yok.</div>;
  return (
    <div ref={kutu} className="dokum">
      {satirlar.map((s) => <div key={s.id}><span className="cok-soluk" style={{ marginRight: 10 }}>{saatMetni(s.zaman, true)}</span>{s.metin}</div>)}
    </div>
  );
}
