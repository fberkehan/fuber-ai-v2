// ── Denetçi (sağ panel; Görev 28, K17) ──────────────────────────────────────────────────────────────────────────────────────────
// Klasör, dal, değişen dosyalar ("Bu oturumda" önce, sonra kapalı "Depodaki diğer değişiklikler"; dosyaya tıklayınca `git diff` fark
// sayfası), yapılacaklar, model, mod, süre, tur, maliyet/belirteç, Claude Code sürümü. Eylemler: Klasörü aç, Terminalde aç (eski yol);
// altta sabit 2×2: Çatalla, Durdur, Kapat, Unut (iki adımlı, kırmızı onay).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cagir, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { YapilacakListesi } from './Kartlar';
import { MOD_ADLARI, EFOR_ADLARI, sureMetni, maliyetSatiri, belirtecMetni, turSuruyor, dosyaGruplari, type GecmisOturum } from './yardimci';
import { islem, ccDepo, type CanliOturum } from './depo';
import { ccModelGorunenAdi } from '../../shared/cc-olay';

export interface Degisiklikler { git: boolean; dal?: string; dosyalar: { yol: string; durum: string }[]; oturumDosyalari: string[] }

const DURUM_ADI: Record<string, { k: string; ad: string }> = {
  M: { k: 'M', ad: 'Değişti' }, A: { k: 'A', ad: 'Eklendi' }, D: { k: 'D', ad: 'Silindi' }, R: { k: 'R', ad: 'Yeniden adlandı' }, C: { k: 'C', ad: 'Kopyalandı' }, U: { k: 'U', ad: 'Çakışma' }, '?': { k: '?', ad: 'Yeni (izlenmiyor)' },
};
export const durumKodu = (xy: string) => { const c = xy.replace(/\s/g, '')[0] ?? 'M'; return DURUM_ADI[c] ?? DURUM_ADI.M; };

function Bolum({ baslik, sag, children }: { baslik: string; sag?: ReactNode; children: ReactNode }) {
  return (
    <section className="cc-denetci__bolum">
      <div className="cc-denetci__bolum-bas"><span className="ust-etiket">{baslik}</span>{sag}</div>
      {children}
    </section>
  );
}

function Deger({ ad, children }: { ad: string; children: ReactNode }) {
  return <div className="cc-deger"><dt>{ad}</dt><dd>{children}</dd></div>;
}

/** Terminalde aç (eski yol: görünür konsol / Windows Terminal) — sonucu satır içinde. */
function useTerminal() {
  const [ileti, setIleti] = useState<{ metin: string; hata?: boolean } | null>(null);
  const ac = async (o: { id?: string; cwd?: string }) => {
    setIleti(null);
    const r = await islem<{ tamam: boolean; hata?: string; komutSatiri?: string }>('claudecode:ac', { ...o, terminal: true });
    setIleti(r.tamam ? { metin: `Terminal açıldı: ${r.komutSatiri ?? 'claude'}` } : { metin: r.hata ?? 'Terminal açılamadı.', hata: true });
  };
  return { ileti, ac };
}

function DosyaListesi({ dosyalar, farkAc, etiket }: { dosyalar: { yol: string; durum: string }[]; farkAc: (dosya: string) => void; etiket: string }) {
  return (
    <ul className="cc-dosyalar" aria-label={etiket}>
      {dosyalar.slice(0, 60).map((f) => {
        const dk = durumKodu(f.durum);
        return (
          <li key={f.yol}>
            <button type="button" className="cc-dosya" onClick={() => farkAc(f.yol)} title={`${dk.ad} · ${f.yol}`}>
              <span className="cc-dosya__durum" data-durum={dk.k} aria-label={dk.ad}>{dk.k}</span>
              <span className="cc-dosya__ad">{f.yol.split('/').pop()}</span>
              <span className="cc-dosya__klasor">{f.yol.includes('/') ? f.yol.slice(0, f.yol.lastIndexOf('/')) : ''}</span>
            </button>
          </li>
        );
      })}
      {dosyalar.length > 60 && <li className="cc-denetci__bos">ve {dosyalar.length - 60} dosya daha</li>}
    </ul>
  );
}

export function CanliDenetci({ k, farkAc, catalla, kapat }: { k: CanliOturum; farkAc: (dosya: string) => void; catalla: () => void; kapat?: () => void }) {
  const o = k.ozet;
  const [d, setD] = useState<Degisiklikler | null>(null);
  const [unutOnay, setUnutOnay] = useState(false);
  const [digerAcik, setDigerAcik] = useState(false);
  const [islemHata, setIslemHata] = useState('');
  const terminal = useTerminal();
  const unutZaman = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Değişen dosyalar: oturum açılınca ve her düzenlemeden/tur bitişinden sonra (kısa gecikmeyle) tazelenir.
  useEffect(() => {
    let iptal = false;
    const z = setTimeout(() => { void cagir<Degisiklikler | null>('claudecode:degisiklikler', o.id).then((r) => { if (!iptal) setD(r); }).catch(() => undefined); }, 250);
    return () => { iptal = true; clearTimeout(z); };
  }, [o.id, o.degisenDosyaSayisi, o.durum]);
  useEffect(() => () => clearTimeout(unutZaman.current), []);
  useEffect(() => { setUnutOnay(false); setDigerAcik(false); }, [o.id]);

  const eylem = async (kanal: 'claudecode:kes' | 'claudecode:kapat' | 'claudecode:unut') => {
    setIslemHata('');
    const r = await islem<{ tamam: boolean; hata?: string }>(kanal, o.id);
    if (!r.tamam) setIslemHata(r.hata ?? 'Yapılamadı.');
  };
  const g = dosyaGruplari(d, k.degisenDosyalar, o.cwd);
  const belirtec = o.belirtec;
  const suruyor = turSuruyor(o);
  return (
    <>
      <div className="cc-denetci__icerik">
        {kapat && <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge cc-denetci__kapat" onClick={kapat} aria-label="Denetçiyi kapat" title="Denetçiyi kapat"><Ikon ad="kapat" olcu={15} /></button>}
        <Bolum baslik="Proje">
          <div className="cc-proje-ozet">
            <b>{o.proje}</b>
            <span className="cc-yol" title={o.cwd}>{o.cwd}</span>
            <span className="cc-proje-ozet__satir">
              {(d?.dal) && <span className="cc-cip"><Ikon ad="dal" olcu={12} />{d.dal}</span>}
              {d && !d.git && <span className="cc-cip">git yok</span>}
            </span>
          </div>
          <div className="cc-denetci__dugmeler">
            <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void cagir('claudecode:klasor-ac', o.cwd)}><Ikon ad="klasor" olcu={14} />Klasörü aç</button>
            <button type="button" className="dgm dgm--koyu dgm--k" data-terminal="" disabled={suruyor} title={suruyor ? 'Tur sürerken terminalde açılmaz' : 'Görünür terminalde aç (eski yol)'} onClick={() => void terminal.ac(o.kimlik ? { id: o.kimlik } : { cwd: o.cwd })}><Ikon ad="terminal" olcu={14} />Terminalde aç</button>
          </div>
          {terminal.ileti && <div className={`cc-ileti${terminal.ileti.hata ? ' cc-ileti--hata' : ''}`} data-terminal-ileti="">{terminal.ileti.metin}</div>}
        </Bolum>

        <Bolum baslik={`Bu oturumda (${g.oturumda.length})`}>
          <div data-dosya-grup="oturum">
            {g.oturumda.length ? <DosyaListesi dosyalar={g.oturumda} farkAc={farkAc} etiket="Bu oturumda değişen dosyalar" />
              : <p className="cc-denetci__bos">{d === null && !k.degisenDosyalar.length ? 'Değişiklikler okunuyor…' : 'Bu oturumda henüz dosya değişmedi.'}</p>}
          </div>
          {g.diger.length > 0 && (
            <div className="cc-denetci__diger" data-dosya-grup="diger">
              <button type="button" className="cc-denetci__ac" aria-expanded={digerAcik} onClick={() => setDigerAcik(!digerAcik)}>
                <Ikon ad="ileri" olcu={13} className="cc-denetci__ok" />Depodaki diğer değişiklikler ({g.diger.length})
              </button>
              {digerAcik && <DosyaListesi dosyalar={g.diger} farkAc={farkAc} etiket="Depodaki diğer değişiklikler" />}
            </div>
          )}
        </Bolum>

        <Bolum baslik="Yapılacaklar" sag={k.yapilacaklar.length ? <span className="cc-denetci__sayi">{k.yapilacaklar.filter((m) => m.durum === 'tamam').length}/{k.yapilacaklar.length}</span> : undefined}>
          {k.yapilacaklar.length ? <YapilacakListesi maddeler={k.yapilacaklar} /> : <p className="cc-denetci__bos">Claude Code bir yapılacaklar listesi tutarsa burada izlenir.</p>}
        </Bolum>

        <Bolum baslik="Oturum">
          <dl className="cc-degerler">
            {/* Analiz 11 Kas bulgu 2: seçim dostça adla; Claude Code'un çözdüğü tam kimlik yanında (yalnız denetçide). */}
            <Deger ad="Model"><span title={o.etkinModel ?? undefined}>{o.model ? ccModelGorunenAdi(o.model, ccDepo.modelListesi()) : `Varsayılan${o.etkinModel ? ` · ${ccModelGorunenAdi(o.etkinModel)}` : ''}`}</span>{o.etkinModel && <span className="cc-yol" style={{ display: 'block', opacity: 0.6, fontSize: 11 }}>{o.etkinModel}</span>}</Deger>
            <Deger ad="Düşünme">{o.efor ? EFOR_ADLARI[o.efor] : 'Varsayılan'}</Deger>
            <Deger ad="Mod"><span className={o.mod === 'bypassPermissions' ? 'cc-tam-rozet' : undefined}>{MOD_ADLARI[o.mod]}</span></Deger>
            <Deger ad="Süre">{sureMetni(o.sureMs)}</Deger>
            <Deger ad="Tur">{o.turSayisi ?? 0}</Deger>
            {/* Tahmini dolar yalnız API anahtarıyla çalışan oturumda (üyelikte özet tutarı taşımaz → satır yok). */}
            {maliyetSatiri(o) !== null && <Deger ad="Maliyet">{maliyetSatiri(o)}</Deger>}
            {o.arkaPlan > 0 && <Deger ad="Arka plan">{o.arkaPlan} iş sürüyor</Deger>}
            <Deger ad="Belirteç">{belirtec ? `${belirtecMetni(belirtec.girdi)} girdi · ${belirtecMetni(belirtec.cikti)} çıktı · ${belirtecMetni(belirtec.onbellekOkuma)} önbellek` : '—'}</Deger>
            {o.surum && <Deger ad="Claude Code">{o.surum}</Deger>}
            <Deger ad="Başlatan">{o.kaynak === 'sohbet' ? 'Fuber sohbeti' : o.kaynak === 'telefon' ? 'Telefon' : 'Bu sayfa'}</Deger>
          </dl>
        </Bolum>
      </div>
      <footer className="cc-denetci__alt" aria-label="Oturum eylemleri">
        {islemHata && <div className="cc-ileti cc-ileti--hata cc-denetci__alt-ileti" role="alert">{islemHata}</div>}
        {unutOnay ? (
          <div className="cc-denetci__onay" role="group" aria-label="Oturumu unut">
            <span>Listeden kaldırılsın mı? Claude Code’un kendi dökümü durur.</span>
            <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => { clearTimeout(unutZaman.current); setUnutOnay(false); }}>Vazgeç</button>
            <button type="button" className="dgm dgm--tehlike dgm--k" data-unut-onay="" onClick={() => void eylem('claudecode:unut')}>Evet, unut</button>
          </div>
        ) : (
          <div className="cc-denetci__izgara">
            <button type="button" className="dgm dgm--koyu dgm--k" disabled={!o.kimlik} onClick={catalla} title={o.kimlik ? 'Bu konuşmadan yeni bir kollu oturum' : 'İlk turdan sonra çatallanabilir'}><Ikon ad="catal" olcu={14} />Çatalla</button>
            <button type="button" className="dgm dgm--koyu dgm--k" disabled={!suruyor} onClick={() => void eylem('claudecode:kes')} title={suruyor ? 'Süren turu durdur (Esc)' : 'Süren tur yok'}><Ikon ad="dur" olcu={14} />Durdur</button>
            <button type="button" className="dgm dgm--koyu dgm--k" disabled={o.durum === 'kapandi'} onClick={() => void eylem('claudecode:kapat')} title="Süreç kapanır; yeni mesaj sürdürür"><Ikon ad="kapat" olcu={14} />Kapat</button>
            <button type="button" className="dgm dgm--koyu dgm--k cc-tehlike-yazi" data-unut=""
              onClick={() => { setUnutOnay(true); clearTimeout(unutZaman.current); unutZaman.current = setTimeout(() => setUnutOnay(false), 8000); }}
              title="Listeden kaldırır; Claude Code’un kendi dökümü durur"><Ikon ad="cop" olcu={14} />Unut</button>
          </div>
        )}
      </footer>
    </>
  );
}

export function GecmisDenetci({ o, catalla, kapat }: { o: GecmisOturum; catalla: () => void; kapat?: () => void }) {
  const terminal = useTerminal();
  return (
    <div className="cc-denetci__icerik">
      {kapat && <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge cc-denetci__kapat" onClick={kapat} aria-label="Denetçiyi kapat" title="Denetçiyi kapat"><Ikon ad="kapat" olcu={15} /></button>}
      <Bolum baslik="Proje">
        <div className="cc-proje-ozet">
          <b>{o.proje}</b>
          <span className="cc-yol" title={o.cwd}>{o.cwd}</span>
          {o.dal && <span className="cc-proje-ozet__satir"><span className="cc-cip"><Ikon ad="dal" olcu={12} />{o.dal}</span></span>}
        </div>
        <div className="cc-denetci__dugmeler">
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void cagir('claudecode:klasor-ac', o.cwd)}><Ikon ad="klasor" olcu={14} />Klasörü aç</button>
          <button type="button" className="dgm dgm--koyu dgm--k" data-terminal="" onClick={() => void terminal.ac({ id: o.id })}><Ikon ad="terminal" olcu={14} />Terminalde sürdür</button>
        </div>
        {terminal.ileti && <div className={`cc-ileti${terminal.ileti.hata ? ' cc-ileti--hata' : ''}`} data-terminal-ileti="">{terminal.ileti.metin}</div>}
      </Bolum>
      <Bolum baslik="Geçmiş oturum">
        <dl className="cc-degerler">
          <Deger ad="Son etkinlik">{o.sonZaman ? zamanGoreli(o.sonZaman) : '—'}</Deger>
          <Deger ad="İstem">{o.istemSayisi}</Deger>
          <Deger ad="Kimlik"><span className="cc-mono">{o.id.slice(0, 8)}</span></Deger>
        </dl>
        <p className="cc-denetci__bos">Yazdığında bu konuşma uygulamada sürer (Claude Code kaldığı yerden devam eder). Başka bir yerde açıksa çatallanır.</p>
        <div className="cc-denetci__dugmeler">
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={catalla}><Ikon ad="catal" olcu={14} />Çatalla</button>
        </div>
      </Bolum>
    </div>
  );
}
