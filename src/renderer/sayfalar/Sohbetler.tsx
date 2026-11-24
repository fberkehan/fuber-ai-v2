// ── Sohbetler: solda konuşmalar, sağda seçili sohbet ─────────────────────────────────────────────────────────
// Dar ekranda (Fuber Cep) aynı sayfa ya liste ya sohbet gösterir: sohbetten "‹ Sohbetler" ile listeye dönülür.
// "Yeni" (ve Ctrl+N; Görev 20b, K10/K11) kayıt AÇMAZ: listenin başında seçili bir taslak satırı ve boş sohbet görünür; kayıt ilk
// mesaj gönderilirken oluşur. Başka sohbete geçilirse taslak iz bırakmadan kaybolur (boş "Yeni sohbet" birikmez).
import { useEffect, useState } from 'react';
import { cagir, dinle, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Dugme } from '../ui';
import { Sohbet, type YeniSohbet } from '../bilesenler/Sohbet';
import type { SohbetOzet } from '../../shared/tipler';
import { yeniSohbetKisayolu } from '../../shared/uygulama-kisayol';
import { okunmamisToplami } from '../../shared/kokpit-sohbet';
import { TERIM } from '../../shared/terimler';

/** Seçim: kayıtlı sohbetin kimliği, 'yeni' (taslak) ya da null (ilk sohbet seçilir). */
export type SohbetSecimi = number | 'yeni' | null;

export function Sohbetler({ secili, sec, dar = false, odak }: { secili: SohbetSecimi; sec: (s: SohbetSecimi) => void; dar?: boolean; odak?: number }) {
  const [liste, setListe] = useState<SohbetOzet[]>([]);
  const [listeAcik, setListeAcik] = useState(false);
  const taslak = secili === 'yeni';
  const seciliId = typeof secili === 'number' ? secili : null;
  const yenile = () => void cagir<SohbetOzet[]>('sohbet:liste').then((l) => { setListe(l); if (secili === null && l[0]) sec(l[0].id); });
  useEffect(() => { yenile(); return dinle('sohbet:olay', (o: { tur: string }) => { if (o.tur === 'bitti' || o.tur === 'yeni_mesaj' || o.tur === 'basladi') yenile(); }); }, [secili]);
  const aktif = liste.find((s) => s.id === seciliId);
  const sec2 = (s: SohbetSecimi) => { sec(s); setListeAcik(false); };
  const mac = window.fuber?.platform === 'darwin';
  // Taslağın ilk mesajı: kayıt açılır, sayfa yeni kimliğe geçer (akış kesilmez: useSohbetAkisi).
  const yeni: YeniSohbet | undefined = taslak ? { olustur: () => cagir<number>('sohbet:yeni'), olustu: (id) => { sec(id); yenile(); } } : undefined;

  const listeGorunumu = (
    <div style={{ borderRight: dar ? 0 : '1px solid var(--cizgi)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="surukle" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'calc(var(--ust) + 10px) 14px 12px' }}>
        <span className="t-ara">Sohbetler</span>
        <span style={{ flex: 1 }} />
        <Dugme tur="birincil" boyut="k" simge="arti" className="surukleme" title={`Yeni sohbet (${yeniSohbetKisayolu(mac)})`} aria-keyshortcuts={mac ? 'Meta+N' : 'Control+N'} onClick={() => sec2('yeni')}>Yeni</Dugme>
      </div>
      <div style={{ overflow: 'auto', padding: '0 8px 12px', display: 'grid', alignContent: 'start', gap: 2 }}>
        {taslak && (
          <button className="satir" data-taslak="" aria-current="true" style={{ border: 0, textAlign: 'left', background: dar ? undefined : 'var(--dolgu-3)', margin: 0, gridTemplateColumns: '1fr auto' }} onClick={() => setListeAcik(false)}>
            <span className="satir__ana">
              <div className="satir__baslik">Yeni sohbet</div>
              <div className="satir__alt" style={{ color: 'var(--ink-3)' }}>İlk mesajınla kaydedilir</div>
            </span>
            <span className="satir__sag">şimdi</span>
          </button>
        )}
        {liste.map((s) => (
          <button key={s.id} onClick={() => sec2(s.id)} className="satir" data-tur={s.tur === 'gorev' ? 'gorev' : undefined} style={{ border: 0, textAlign: 'left', background: s.id === seciliId && !dar ? 'var(--dolgu-3)' : undefined, margin: 0, gridTemplateColumns: '1fr auto' }}>
            <span className="satir__ana">
              <div className="satir__baslik" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{s.tur === 'ana' && <Ikon ad="yildiz" olcu={12} />}{s.tur === 'gorev' && <span title={`${TERIM.gorev} sohbeti`} style={{ display: 'inline-flex', color: 'var(--ink-3)' }}><Ikon ad="saat" olcu={12} /></span>}{s.baslik}</div>
              {/* Seçili satırın zemini daha açık: soluk ikincil yazı orada 3,7:1 kalıyordu (Görev 19 denetimi) → bir ton koyu. */}
              <div className="satir__alt" style={s.id === seciliId && !dar ? { color: 'var(--ink-3)' } : undefined}>{s.sonMesaj ?? '—'}</div>
            </span>
            <span className="satir__sag" style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
              {zamanGoreli(s.guncelleme)}
              {!!s.okunmamis && <span className="ray__rozet" style={{ position: 'static' }}>{s.okunmamis}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
  const arsivle = aktif && aktif.tur !== 'ana'
    ? <Dugme tur="hayalet" boyut="k" onClick={() => void cagir('sohbet:arsivle', aktif.id).then(() => { sec(liste.find((x) => x.id !== aktif.id)?.id ?? null); yenile(); })}>Arşivle</Dugme>
    : undefined;
  const baslik = taslak ? 'Yeni sohbet' : aktif?.baslik ?? '';

  if (dar) {
    if (listeAcik || secili === null) return <div style={{ height: '100%', display: 'grid' }}>{listeGorunumu}</div>;
    const okunmamis = okunmamisToplami(liste.filter((s) => s.id !== seciliId));
    return (
      <Sohbet
        sohbetId={seciliId}
        yeni={yeni}
        odak={odak}
        baslik={baslik}
        solEk={<Dugme tur="hayalet" boyut="k" simge="liste" aria-label="Sohbetler" onClick={() => setListeAcik(true)}>{okunmamis > 0 && <span className="ray__rozet" style={{ position: 'static' }}>{okunmamis}</span>}</Dugme>}
        ustEk={arsivle}
      />
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0,1fr)', height: '100%' }}>
      {listeGorunumu}
      <Sohbet sohbetId={seciliId} yeni={yeni} odak={odak} baslik={baslik} ustEk={arsivle} />
    </div>
  );
}
