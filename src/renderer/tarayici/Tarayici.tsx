// ── Fuber Tarayıcı: araç çubuğu, "Fuber'e sor", çalışma şeridi, sayfa alanı ─────────────────────────────────────
// Sayfa alanı (.tb-alan) boş bir çerçevedir: ana süreç web sayfasını (ayrı görünüm) tam bu alanın üstüne koyar; arayüz alanın
// yerini her değişimde bildirir ('tarayici:alan'). Bu yüzden sayfanın ÜSTÜNE çizilen hiçbir şey görünmez: geri bildirimler
// (gönderildi, hata) araç çubuğunda ya da "Fuber'e sor" panelinde gösterilir. Başlangıç sayfası ve "sayfa açılamadı"
// gösterilirken sayfa görünümü gizlidir, alanı bu arayüz doldurur.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { UrunIsareti } from '../bilesenler/UrunIsareti';
import { PencereDugmeleri } from '../pencere/PencereDugmeleri';
import { Baslangic } from './Baslangic';
import { useAcilDurdurma } from '../acil-kisayol';
import { hataMetni, httpDenemesi, SEKME_EN_COK, type TarayiciDurumu } from '../../shared/tarayici';

const ILK: TarayiciDurumu = { baslangic: true, adres: '', baslik: '', yukleniyor: false, geri: false, ileri: false, guvenlik: 'yok', calisiyor: false, sekmeler: [] };
type Eylem = 'geri' | 'ileri' | 'yenile' | 'dur' | 'baslangic';

/** Odakta değilken adres sade görünür: şema (kilit simgesi zaten söyler) ve yalnız "/" olan yol atılır. */
function gorunenAdres(adres: string): string {
  try {
    const u = new URL(adres);
    const yol = u.pathname === '/' && !u.search && !u.hash ? '' : `${u.pathname}${u.search}${u.hash}`;
    return `${u.host}${yol}`;
  } catch { return adres; }
}

const GUVEN: Record<TarayiciDurumu['guvenlik'], { ikon: string; ad?: string; ipucu: string }> = {
  guvenli: { ikon: 'kilit', ipucu: 'Güvenli bağlantı (HTTPS)' },
  guvensiz: { ikon: 'uyari', ad: 'Güvenli değil', ipucu: 'Bu bağlantı şifreli değil (HTTP): parola ya da kart bilgisi girme.' },
  yerel: { ikon: 'ekran', ad: 'Yerel', ipucu: 'Bu bilgisayardaki bir sunucu (localhost)' },
  hata: { ikon: 'uyari', ipucu: 'Sayfa açılamadı: bağlantı kurulamadı' },
  yok: { ikon: 'ara', ipucu: 'Ara ya da adres yaz' },
};

export function Tarayici() {
  const [d, setD] = useState<TarayiciDurumu>(ILK);
  const [yazi, setYazi] = useState('');
  const [duzenleniyor, setDuzenleniyor] = useState(false);
  const [sorAcik, setSorAcik] = useState(false);
  // Acil durdurma tuşu yalnız gerçekten alındıysa ipucu olur (Görev 20b düzeltme turu 2); yoksa yanındaki "Durdur" düğmesi yeter.
  const acilTus = useAcilDurdurma();
  // Ana sürecin kısa uyarısı (ör. "İndirmeler bu tarayıcıda kapalı."): araç çubuğunun altında, birkaç saniye.
  const [uyari, setUyari] = useState<{ no: number; metin: string } | null>(null);
  const alanRef = useRef<HTMLDivElement>(null);
  const adresRef = useRef<HTMLInputElement>(null);
  const dRef = useRef<TarayiciDurumu>(ILK);
  dRef.current = d;

  useEffect(() => {
    void cagir<TarayiciDurumu>('tarayici:durum').then(setD).catch(() => undefined);
    const k = [
      dinle('tarayici:durum', (yeni: TarayiciDurumu) => setD(yeni)),
      dinle('tarayici:komut', (c: { tur: string; metin?: string }) => {
        if (c.tur === 'adres') { adresRef.current?.focus(); adresRef.current?.select(); }
        else if (c.tur === 'bildirim' && c.metin) setUyari({ no: Date.now(), metin: c.metin });
      }),
    ];
    return () => k.forEach((f) => f());
  }, []);
  useEffect(() => {
    if (!uyari) return;
    const z = setTimeout(() => setUyari(null), 5000);
    return () => clearTimeout(z);
  }, [uyari?.no]);

  // Adres çubuğu sayfayı izler; yazarken değişmez (yazdığın silinmesin).
  useEffect(() => { if (!duzenleniyor) setYazi(d.baslangic ? '' : gorunenAdres(d.adres)); }, [d.adres, d.baslangic, duzenleniyor]);
  // Başlangıç sayfasına gelince adres çubuğuna odaklan: hemen yazılabilsin.
  useEffect(() => { if (d.baslangic) adresRef.current?.focus(); }, [d.baslangic]);

  // Sayfa alanının yeri ana sürece: web sayfası tam buraya konur (şerit/panel açılınca alan aşağı kayar).
  useLayoutEffect(() => {
    const el = alanRef.current;
    if (!el) return;
    let son = '';
    const bildir = () => {
      const r = el.getBoundingClientRect();
      const v = { x: Math.round(r.left), y: Math.round(r.top), en: Math.round(r.width), boy: Math.round(r.height), pencereEn: innerWidth, pencereBoy: innerHeight };
      const imza = JSON.stringify(v);
      if (imza === son) return;
      son = imza;
      void cagir('tarayici:alan', v).catch(() => undefined);
    };
    bildir();
    const ro = new ResizeObserver(bildir);
    ro.observe(el);
    ro.observe(document.body);
    addEventListener('resize', bildir);
    return () => { ro.disconnect(); removeEventListener('resize', bildir); };
  }, []);

  const gezin = (e: Eylem) => void cagir('tarayici:gezin', e).catch(() => undefined);
  const sekme = (eylem: 'ac' | 'gec' | 'kapat', no?: number) => void cagir('tarayici:sekme', eylem, no).catch(() => undefined);
  const git = (girdi: string) => {
    if (!girdi.trim()) return;
    void cagir('tarayici:git', girdi).catch(() => undefined);
    setDuzenleniyor(false);
    adresRef.current?.blur();
  };
  const gonder = (e: FormEvent) => { e.preventDefault(); git(yazi); };
  const adresTusu = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); setDuzenleniyor(false); setYazi(d.baslangic ? '' : gorunenAdres(d.adres)); e.currentTarget.blur(); }
  };

  // Pencere kısayolları (sayfa görünümündekileri ana süreç yakalar): Ctrl+L/F6 adres, Alt+←/→, F5/Ctrl+R; Esc paneli kapatır.
  useEffect(() => {
    const tus = (e: globalThis.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey && k === 'l') || e.key === 'F6') { e.preventDefault(); adresRef.current?.focus(); adresRef.current?.select(); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); gezin('geri'); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); gezin('ileri'); }
      else if (e.key === 'F5' || (e.ctrlKey && k === 'r')) { e.preventDefault(); gezin('yenile'); }
      else if (e.ctrlKey && k === 't') { e.preventDefault(); sekme('ac'); }
      else if (e.ctrlKey && k === 'w') { const a = dRef.current.sekmeler.find((s) => s.aktif); if (a) { e.preventDefault(); sekme('kapat', a.no); } }
      else if (e.key === 'Escape' && sorAcik && !(e.target as HTMLElement)?.closest?.('.tb-adres')) setSorAcik(false);
    };
    addEventListener('keydown', tus);
    return () => removeEventListener('keydown', tus);
  }, [sorAcik]);

  const g = GUVEN[d.guvenlik];
  const sayfaVar = !d.baslangic && !d.hata && Boolean(d.adres);

  return (
    <div className="tb" data-calisiyor={d.calisiyor || undefined}>
      <header className="tb-ust surukle">
        <div className="tb-ust__gezinme surukleme">
          <button type="button" className="tb-dgm tb-ev" aria-label="Başlangıç sayfası" title="Başlangıç sayfası" aria-current={d.baslangic ? 'page' : undefined} onClick={() => gezin('baslangic')}>
            <UrunIsareti olcu={16} />
          </button>
          <span className="tb-ayrac" aria-hidden="true" />
          <button type="button" className="tb-dgm" aria-label="Geri" title="Geri (Alt+←)" disabled={!d.geri} onClick={() => gezin('geri')}><Ikon ad="geri" olcu={18} /></button>
          <button type="button" className="tb-dgm" aria-label="İleri" title="İleri (Alt+→)" disabled={!d.ileri} onClick={() => gezin('ileri')}><Ikon ad="ileri" olcu={18} /></button>
          {d.yukleniyor
            ? <button type="button" className="tb-dgm" aria-label="Yüklemeyi durdur" title="Yüklemeyi durdur" onClick={() => gezin('dur')}><Ikon ad="kapat" olcu={17} /></button>
            : <button type="button" className="tb-dgm" aria-label="Yenile" title="Yenile (F5)" disabled={d.baslangic} onClick={() => gezin('yenile')}><Ikon ad="yenile" olcu={17} /></button>}
          <button type="button" className="tb-dgm tb-yeni-sekme" aria-label="Yeni sekme" title={d.sekmeler.length >= SEKME_EN_COK ? `En çok ${SEKME_EN_COK} sekme` : 'Yeni sekme (Ctrl+T)'} disabled={d.sekmeler.length >= SEKME_EN_COK} onClick={() => sekme('ac')}><Ikon ad="arti" olcu={17} /></button>
        </div>

        <form className="tb-adres surukleme" role="search" data-guvenlik={d.guvenlik} data-yukleniyor={d.yukleniyor || undefined} onSubmit={gonder}>
          <span className="tb-guven" title={g.ipucu}>
            <Ikon ad={g.ikon} olcu={15} />
            {g.ad && <span>{g.ad}</span>}
          </span>
          <input
            ref={adresRef}
            className="tb-adres__girdi"
            aria-label="Adres ya da arama"
            placeholder="Ara ya da adres yaz"
            spellCheck={false}
            autoComplete="off"
            value={yazi}
            onFocus={(e) => { setDuzenleniyor(true); if (!d.baslangic) setYazi(d.hata?.adres || d.adres); requestAnimationFrame(() => e.target.select()); }}
            onBlur={() => setDuzenleniyor(false)}
            onChange={(e) => { setDuzenleniyor(true); setYazi(e.target.value); }}
            onKeyDown={adresTusu}
          />
          {d.yukleniyor && <span className="tb-yukleme" aria-hidden="true" />}
        </form>

        <button type="button" className="dgm dgm--koyu dgm--k tb-sor-dgm surukleme" aria-expanded={sorAcik} aria-controls="tb-sor" onClick={() => setSorAcik((a) => !a)}>
          <Ikon ad="asistan" olcu={16} />Fuber'e sor
        </button>
        {/* Kendi pencere düğmeleri (Görev 22): küçült, büyüt/geri al, kapat — macOS'ta yerel trafik ışıkları (solda). */}
        <PencereDugmeleri yerlesim="satir" />
      </header>

      {/* Sekme şeridi (0.14 T15): yalnız birden çok sekme varken; tek sekmede "+" düğmesi yeter. */}
      {d.sekmeler.length > 1 && (
        <div className="tb-sekmeler" role="tablist" aria-label="Sekmeler">
          {d.sekmeler.map((s) => (
            <div key={s.no} className="tb-sekme" role="presentation" data-aktif={s.aktif || undefined}>
              <button type="button" className="tb-sekme__ad" role="tab" aria-selected={s.aktif} title={s.adres || 'Boş sekme'} onClick={() => sekme('gec', s.no)}>
                {s.yukleniyor && <span className="tb-sekme__yukleme" aria-hidden="true" />}
                <span className="tb-sekme__yazi">{s.baslik || gorunenAdres(s.adres) || 'Yeni sekme'}</span>
              </button>
              <button type="button" className="tb-sekme__kapat" aria-label={`Sekmeyi kapat: ${s.baslik || gorunenAdres(s.adres) || 'Yeni sekme'}`} title="Sekmeyi kapat (Ctrl+W)" onClick={() => sekme('kapat', s.no)}><Ikon ad="kapat" olcu={14} /></button>
            </div>
          ))}
        </div>
      )}

      {sorAcik && <SorPaneli d={d} sayfaVar={sayfaVar} kapat={() => setSorAcik(false)} />}

      {d.calisiyor && (
        <div className="tb-calis" role="status" aria-live="polite">
          <span className="tb-calis__nokta" aria-hidden="true" />
          <b className="tb-calis__baslik">Fuber bu sayfada çalışıyor</b>
          {d.sonAdim && <span className="tb-calis__adim">{d.sonAdim}</span>}
          {acilTus && <span className="tb-calis__ipucu">{acilTus}</span>}
          <button type="button" className="dgm dgm--k tb-calis__dur" onClick={() => void cagir('tarayici:durdur')}><Ikon ad="dur" olcu={14} />Durdur</button>
        </div>
      )}

      {uyari && (
        <div className="tb-uyari" role="status" aria-live="polite">
          <Ikon ad="uyari" olcu={16} />
          <span className="tb-uyari__metin">{uyari.metin}</span>
          <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" aria-label="Kapat" onClick={() => setUyari(null)}><Ikon ad="kapat" olcu={15} /></button>
        </div>
      )}

      <main className="tb-alan" ref={alanRef} aria-label={d.baslangic ? 'Başlangıç sayfası' : d.baslik || 'Sayfa'}>
        {d.baslangic ? <Baslangic git={git} /> : d.hata ? (
          <div className="tb-hata" role="alert">
            <div className="tb-hata__simge"><Ikon ad="uyari" olcu={24} /></div>
            <h1 className="tb-hata__baslik">Bu sayfa açılamadı</h1>
            <p className="tb-hata__metin">{hataMetni(d.hata.kod, d.hata.aciklama)}</p>
            <code className="tb-hata__adres">{d.hata.adres}</code>
            <div className="tb-hata__dugmeler">
              <button type="button" className="dgm dgm--beyaz" onClick={() => gezin('yenile')}><Ikon ad="yenile" olcu={16} />Yeniden dene</button>
              {httpDenemesi(d.hata) && <button type="button" className="dgm dgm--koyu" data-http="" title="Bağlantı şifrelenmez: parola ya da kart bilgisi girme." onClick={() => git(httpDenemesi(d.hata!)!)}>Şifresiz (http) aç</button>}
              <button type="button" className="dgm dgm--koyu" onClick={() => gezin('baslangic')}>Başlangıç sayfası</button>
            </div>
          </div>
        ) : <div className="tb-alan__yer" aria-hidden="true" />}
      </main>
    </div>
  );
}

/** "Fuber'e sor": istek ana sohbete açık sayfanın adresi ve başlığıyla gider (ana pencere öne gelir). Sonuç burada söylenir:
 *  sayfanın üstüne çizilen bir bildirim görünmezdi. */
function SorPaneli({ d, sayfaVar, kapat }: { d: TarayiciDurumu; sayfaVar: boolean; kapat: () => void }) {
  const [metin, setMetin] = useState('');
  const [hal, setHal] = useState<{ tur: 'bos' | 'gidiyor' | 'gitti' | 'hata'; mesaj?: string }>({ tur: 'bos' });
  const girdi = useRef<HTMLInputElement>(null);
  useEffect(() => { girdi.current?.focus(); }, []);
  useEffect(() => {
    if (hal.tur !== 'gitti') return;
    const z = setTimeout(kapat, 2600);
    return () => clearTimeout(z);
  }, [hal.tur]);

  const sor = async (ozetle: boolean) => {
    if (!ozetle && !metin.trim()) { girdi.current?.focus(); return; }
    setHal({ tur: 'gidiyor' });
    const r = await cagir<{ tamam: boolean; mesaj?: string }>('tarayici:sor', { istek: metin, ozetle }).catch((e: Error) => ({ tamam: false, mesaj: e.message }));
    if (r.tamam) { setMetin(''); setHal({ tur: 'gitti' }); } else setHal({ tur: 'hata', mesaj: r.mesaj });
  };
  let host = '';
  try { host = new URL(d.adres).host; } catch { /* sayfa yok */ }

  return (
    <form id="tb-sor" className="tb-sor" aria-label="Fuber'e sor" onSubmit={(e) => { e.preventDefault(); void sor(false); }}>
      <div className="tb-sor__satir">
        <span className="tb-sor__simge" aria-hidden="true"><Ikon ad="asistan" olcu={18} /></span>
        <input
          ref={girdi}
          className="tb-sor__girdi"
          aria-label="Fuber ne yapsın?"
          placeholder={sayfaVar ? 'Bu sayfada ne yapayım? Örn. “formu doldur”, “fiyatları karşılaştır”' : 'Fuber web’de ne yapsın? Örn. “Gmail’de bugünkü e-postaları özetle”'}
          value={metin}
          onChange={(e) => { setMetin(e.target.value); if (hal.tur !== 'gidiyor') setHal({ tur: 'bos' }); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); kapat(); } }}
        />
        <button type="button" className="dgm dgm--koyu dgm--k" disabled={!sayfaVar || hal.tur === 'gidiyor'} title={sayfaVar ? undefined : 'Önce bir sayfa aç'} onClick={() => void sor(true)}>Bu sayfayı özetle</button>
        <button type="submit" className="dgm dgm--beyaz dgm--k" disabled={hal.tur === 'gidiyor'}><Ikon ad="gonder" olcu={15} />Gönder</button>
        <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" aria-label="Kapat" title="Kapat (Esc)" onClick={kapat}><Ikon ad="kapat" olcu={16} /></button>
      </div>
      <div className="tb-sor__not" role={hal.tur === 'hata' ? 'alert' : 'status'} data-hal={hal.tur}>
        {hal.tur === 'gitti' ? <><Ikon ad="tamam" olcu={14} />Ana sohbete gönderildi. Fuber bu sayfada çalışırken üstte şerit görürsün.</>
          : hal.tur === 'hata' ? <><Ikon ad="uyari" olcu={14} />{hal.mesaj || 'Gönderilemedi.'}</>
          : sayfaVar ? <>Ana sohbete bu sayfayla gider: <b>{d.baslik || host}</b>{d.baslik && host ? <span className="tb-sor__host"> · {host}</span> : null}</>
          : <>Ana sohbete gider. Açık bir sayfa yok; Fuber gerekirse kendisi açar.</>}
      </div>
    </form>
  );
}
