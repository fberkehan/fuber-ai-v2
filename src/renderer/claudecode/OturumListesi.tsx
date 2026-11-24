// ── Sol panel (Görev 28, K17): Yeni oturum · arama (Ctrl+K) · Çalışanlar (canlı hâl rozeti) · projelere göre geçmiş ───────────────
import { useMemo, useState, type RefObject } from 'react';
import { zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { halBilgisi, oturumEslesir, gecmisGrupla, type GecmisOturum } from './yardimci';
import type { CanliOturum } from './depo';

export type Secim = { tur: 'canli'; id: string } | { tur: 'gecmis'; o: GecmisOturum } | { tur: 'yeni'; cwd: string | null } | null;

const GRUP_SINIRI = 4;

export function OturumListesi({ canlilar, gecmis, secim, sec, ara, setAra, aramaRef, yeniOturum, mac }: {
  canlilar: CanliOturum[]; gecmis: GecmisOturum[] | null; secim: Secim; sec: (s: Secim) => void;
  ara: string; setAra: (s: string) => void; aramaRef: RefObject<HTMLInputElement | null>; yeniOturum: () => void; mac: boolean;
}) {
  const [acikGruplar, setAcikGruplar] = useState<Set<string>>(new Set());
  const canliGorunen = useMemo(() => canlilar.filter((k) => oturumEslesir(k.ozet, ara)), [canlilar, ara]);
  const canliKimlikler = useMemo(() => new Set(canlilar.map((k) => k.ozet.kimlik).filter((x): x is string => Boolean(x))), [canlilar]);
  const gruplar = useMemo(() => gecmisGrupla(gecmis ?? [], canliKimlikler), [gecmis, canliKimlikler]);
  const tus = mac ? '⌘' : 'Ctrl+';
  return (
    <aside className="cc-sol" aria-label="Oturumlar">
      <div className="cc-sol__ust">
        <button type="button" className="dgm dgm--beyaz cc-yeni" onClick={yeniOturum} aria-keyshortcuts={mac ? 'Meta+N' : 'Control+N'} data-secili={secim?.tur === 'yeni' ? '' : undefined}>
          <Ikon ad="arti" olcu={16} />Yeni oturum<kbd>{tus}N</kbd>
        </button>
        <label className="cc-ara">
          <Ikon ad="ara" olcu={15} />
          <input ref={aramaRef} value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Oturum ara" aria-label="Oturum ara" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
            onKeyDown={(e) => { if (e.key === 'Escape' && ara) { e.preventDefault(); e.stopPropagation(); setAra(''); } }} />
          {ara ? <button type="button" className="cc-ara__temizle" onClick={() => setAra('')} aria-label="Aramayı temizle" title="Temizle"><Ikon ad="kapat" olcu={13} /></button> : <kbd>{tus}K</kbd>}
        </label>
      </div>
      <div className="cc-sol__liste">
        <div className="cc-sol__bolum-bas"><span className="ust-etiket">Çalışanlar</span>{canlilar.length > 0 && <span className="cc-sol__sayi">{canlilar.length}</span>}</div>
        {canliGorunen.map((k) => {
          const o = k.ozet;
          const h = halBilgisi(o);
          return (
            <button key={o.id} type="button" className="cc-oturum" aria-current={secim?.tur === 'canli' && secim.id === o.id ? 'true' : undefined} onClick={() => sec({ tur: 'canli', id: o.id })} data-oturum={o.id} data-kimlik={o.kimlik} data-hal={h.ton}>
              <span className="cc-oturum__ust">
                <span className="cc-hal" data-ton={h.ton}><i aria-hidden="true" />{h.etiket}</span>
                {o.mod === 'bypassPermissions' && <span className="cc-tam-rozet" title="Tam yetki: izin sormaz">Tam yetki</span>}
                <span className="cc-oturum__zaman">{zamanGoreli(new Date(o.sonEtkinlik).toISOString())}</span>
              </span>
              <span className="cc-oturum__baslik">{o.baslik}</span>
              <span className="cc-oturum__alt">
                <Ikon ad="klasor" olcu={12} />{o.proje}
                {o.kuyruk > 0 && <span className="cc-oturum__ek">· {o.kuyruk} sırada</span>}
                {o.kaynak !== 'sayfa' && <span className="cc-oturum__ek">· {o.kaynak === 'sohbet' ? 'sohbetten' : 'telefondan'}</span>}
              </span>
            </button>
          );
        })}
        {!canliGorunen.length && <p className="cc-sol__not">{ara ? 'Eşleşen çalışan oturum yok.' : 'Uygulamada başlattığın oturumlar burada canlı izlenir: hâli, izin istekleri, sırası.'}</p>}

        <div className="cc-sol__bolum-bas cc-sol__bolum-bas--ayrik"><span className="ust-etiket">Geçmiş</span>{gecmis && <span className="cc-sol__sayi">{gruplar.reduce((n, g) => n + g.oturumlar.length, 0)}</span>}</div>
        {gecmis === null && <p className="cc-sol__not">Oturumlar taranıyor…</p>}
        {gecmis !== null && !gruplar.length && <p className="cc-sol__not">{ara ? 'Eşleşen geçmiş oturum yok.' : 'Bu bilgisayarda başka Claude Code oturumu yok.'}</p>}
        {gruplar.map((g) => {
          const acik = Boolean(ara) || acikGruplar.has(g.cwd);
          const gorunen = acik ? g.oturumlar : g.oturumlar.slice(0, GRUP_SINIRI);
          return (
            <div key={g.cwd} className="cc-grup">
              <div className="cc-grup__bas" title={g.cwd}><Ikon ad="klasor" olcu={13} /><b>{g.proje}</b><span>{g.oturumlar.length}</span></div>
              {gorunen.map((o) => (
                <button key={o.id} type="button" className="cc-oturum cc-oturum--gecmis" aria-current={secim?.tur === 'gecmis' && secim.o.id === o.id ? 'true' : undefined} onClick={() => sec({ tur: 'gecmis', o })} data-gecmis={o.id}>
                  <span className="cc-oturum__baslik">{o.baslik}</span>
                  <span className="cc-oturum__alt">{o.sonZaman ? zamanGoreli(o.sonZaman) : ''}{o.dal ? ` · ${o.dal}` : ''} · {o.istemSayisi} istem</span>
                  {o.parca && <span className="cc-oturum__parca">“{o.parca.slice(0, 110)}”</span>}
                </button>
              ))}
              {!ara && g.oturumlar.length > GRUP_SINIRI && (
                <button type="button" className="cc-katla cc-grup__daha" onClick={() => setAcikGruplar((s) => { const y = new Set(s); if (y.has(g.cwd)) y.delete(g.cwd); else y.add(g.cwd); return y; })}>
                  {acik ? 'Daha az' : `${g.oturumlar.length - GRUP_SINIRI} oturum daha`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
