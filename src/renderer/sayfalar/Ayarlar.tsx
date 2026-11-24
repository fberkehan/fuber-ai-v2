// ── Ayarlar: iki bölmeli kabuk (macOS Sistem Ayarları gibi) ──────────────────────────────────────────────────────────────
// Ayarlar sayfası sadeleşti: her ayar grubu ayrı bir düğmede, üst kategoriler altında; basınca o kategorinin
// ayarları akordeon olarak açılır. Solda arama + kategori listesi (simge, ad, kısa açıklama); sağda seçili
// kategorinin başlığı ve akordeon grupları (ilk grup açık; açık/kapalı durumu kalıcı değil). Kategori, grup ve ayar metinleri
// ayarlar/dizin.ts'te, grup içerikleri ayarlar/kayit.ts'te — kabuk ikisini birleştirir; yeni içerik için değişmez.
// Arama (shared/ayar-arama.ts): sonuçlar kategori adıyla gruplanır; tıklayınca kategori ve grup açılır, ayar vurgulanır.
// Çapalar: 'ayarlar#motorlar' gibi (ana:git, Etkinlik sayfası, ada, kokpit) location.hash ile gelir — eski adlar (motorlar, ses,
// yetkiler, gorunum, dusunme, yerel), 'kategori', 'kategori/grup' ya da ayar kimliği. Mod (K2): İş modunda geliştirici kategori,
// grup ve ayarlar listelenmez ve aranmaz; seçili kategori gizlenirse Genel açılır. Ctrl+F aramaya odaklanır.
// 0.14 T31 (Nusa dili): kök ekranın TEK vurgusunu taşır (vurguStili('ayarlar'), çivit); anahtarlar, seçili kategorinin simgesi ve başlık simgesi
// bu vurguyla. Kategoriler (bölüm başına bir grup: role="group" + görünmez başlık, M6) ve arama sonuçları ortak Liste'yle. Aramadan gelinen ayarın geçici
// işareti data-isaret (kök vurgusuyla karışmaz). Seçenek eklenmedi.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Liste, vurguStili } from '../ui';
import { Akordeon } from '../bilesenler/Akordeon';
import { aramaYeterli, ayarAra, cipaCoz, dizinKur, eslesmeAraliklari, gorunurMu, modaGore, type AramaSonucu, type CipaHedefi } from '../../shared/ayar-arama';
import type { Ayarlar as A, Mod } from '../../shared/tipler';
import { AyarBaglamiCtx, type AyarBaglami } from '../ayarlar/baglam';
import { ICERIKLER, KATEGORILER, ESKI_CIPALAR, type AyarKategorisi, type KategoriId } from '../ayarlar/kayit';
import { KaydedildiRozeti } from '../ayarlar/Ortak';
import { useAcilDurdurma } from '../acil-kisayol';
import { acilYerlestir } from '../../shared/genel-kisayol';
import '../ayarlar/ayarlar.css';

/** Kategori bölümlerinin ekran okuyucuya söylenen adları (dizin.ts `bolum` sırası; görünmez başlık). */
export const BOLUM_ADI: Readonly<Record<number, string>> = { 0: 'Hesap', 1: 'Uygulama', 2: 'Gizlilik ve Fuber’in çalışması', 3: 'Yetkiler ve veri' };

/** Kategorileri sıralarını koruyarak bölümlere ayırır (ardışık aynı `bolum` bir grup). */
export function kategoriBolumleri<K extends { bolum: number }>(kategoriler: readonly K[]): { bolum: number; liste: K[] }[] {
  const gruplar: { bolum: number; liste: K[] }[] = [];
  for (const k of kategoriler) {
    const son = gruplar[gruplar.length - 1];
    if (son && son.bolum === k.bolum) son.liste.push(k); else gruplar.push({ bolum: k.bolum, liste: [k] });
  }
  return gruplar;
}

/** Bu oturumda en son açılan kategori: Ayarlar'a dönünce aynı yer (akordeonlar her açılışta yalnız ilk grup açık). */
let sonKategori: KategoriId = 'genel';

interface Hedef { grup?: string; ayar?: string; odakla?: boolean; n: number }

/** `sihirbaziAc`: Görünüm → "Kurulum sihirbazını yeniden aç" (sihirbaz main.tsx'te katman olarak açılır). */
export function Ayarlar({ sihirbaziAc }: { sihirbaziAc?: () => void }) {
  const [a, setA] = useState<A | null>(null);
  const [kategori, setKategori] = useState<KategoriId>(sonKategori);
  const [acik, setAcik] = useState<ReadonlySet<string> | null>(null); // null: yalnız ilk grup
  const [aninda, setAninda] = useState<string | null>(null);
  const [hedef, setHedef] = useState<Hedef | null>(null);
  const [sorgu, setSorgu] = useState('');
  const [kaydedildi, setKaydedildi] = useState(0);
  const icerik = useRef<HTMLDivElement>(null);
  const araKutusu = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void cagir<A>('ayarlar:al').then(setA);
    // Ayarlar başka yerden de değişir (yeniden açılan kurulum sihirbazı, tepsi menüsü, ray hızlı denetimleri): sayfa bayat kalmasın —
    // bayat nesneden yapılan sonraki kayıt (ör. { yetki: { ...a.yetki, … } }) o değişikliği geri alırdı.
    return dinle('ayarlar:degisti', (y: A) => setA(y));
  }, []);

  const mod: Mod = a?.mod === 'gelistirici' ? 'gelistirici' : 'is';
  const modRef = useRef(mod);
  modRef.current = mod;
  const kategoriler = useMemo(() => KATEGORILER.filter((k) => gorunurMu(k, mod)), [mod]);
  const secili: AyarKategorisi = kategoriler.find((k) => k.id === kategori) ?? kategoriler.find((k) => k.id === 'genel')!;
  const gruplar = secili.gruplar.filter((g) => gorunurMu(g, mod));
  const acikGruplar = acik ?? new Set(gruplar.length ? [gruplar[0].id] : []);

  const dizin = useMemo(() => dizinKur(KATEGORILER, mod), [mod]);
  const aramada = aramaYeterli(sorgu); // ayarAra ile aynı eşik (2 harf): tek harfte kategori görünümü kalır
  const sonuclar = useMemo(() => (aramada ? ayarAra(dizin, sorgu) : []), [dizin, sorgu, aramada]);
  const sayac = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sonuclar) m.set(s.kayit.kategori, (m.get(s.kayit.kategori) ?? 0) + 1);
    return m;
  }, [sonuclar]);

  const kategoriAc = useCallback((id: KategoriId, h?: { grup?: string; ayar?: string; odakla?: boolean }) => {
    setSorgu('');
    setKategori(id);
    sonKategori = id;
    setAcik(h?.grup ? new Set([h.grup]) : null);
    setAninda(h?.grup ?? null); // gezinmeyle açılan grup canlandırmasız: kaydırma hemen doğru yere gider
    setHedef({ grup: h?.grup, ayar: h?.ayar, odakla: h?.odakla, n: Date.now() });
  }, []);
  const hedefeGit = useCallback((h: CipaHedefi, odakla = false) => kategoriAc(h.kategori as KategoriId, { ...h, odakla }), [kategoriAc]);

  // Mod değişip seçili kategori gizlendiyse (İş modunda Yapay zekâ) Genel'e geçilir. Ayarlar yüklenmeden (mod henüz bilinmezken)
  // karar verilmez: oturumda hatırlanan Yapay zekâ kategorisi yanlışlıkla Genel'e düşmesin.
  useEffect(() => {
    if (!a || secili.id === kategori) return;
    setKategori(secili.id);
    sonKategori = secili.id;
    setAcik(null);
  }, [a, secili.id, kategori]);

  // Çapa: ilk açılışta ve sayfa açıkken (hashchange). Tanınmayan çapa başka sayfanındır (Hafıza → #raporlar): dokunulmaz. Bu
  // modda gizli bir ayar çapası (İş modunda #yapay-zeka) adresten silinir, sayfa olduğu yerde kalır.
  const yuklendi = Boolean(a);
  useEffect(() => {
    if (!yuklendi) return;
    const uygula = () => {
      const h = location.hash.slice(1);
      if (!h) return;
      const c = cipaCoz(h, KATEGORILER, modRef.current, ESKI_CIPALAR);
      const ayarCipasi = c ?? cipaCoz(h, KATEGORILER, 'gelistirici', ESKI_CIPALAR);
      if (!ayarCipasi) return;
      history.replaceState(null, '', location.pathname + location.search);
      if (c) hedefeGit(c);
    };
    uygula();
    addEventListener('hashchange', uygula);
    return () => removeEventListener('hashchange', uygula);
  }, [yuklendi, hedefeGit]);

  // Hedefe kaydırma + vurgu. İçerik IPC ile geç dolabilir (ses listesi, yerel beyin durumu): ayar bulunana dek birkaç kare beklenir.
  useLayoutEffect(() => {
    const kutu = icerik.current;
    if (!hedef || !kutu) return;
    let iptal = false;
    let kare = 0;
    const bul = () => {
      if (iptal) return;
      const sec = hedef.ayar ? `[data-ayar="${CSS.escape(hedef.ayar)}"]` : hedef.grup ? `[data-grup="${CSS.escape(hedef.grup)}"]` : '';
      const el = sec ? kutu.querySelector<HTMLElement>(sec) : null;
      if (!el) {
        if (hedef.ayar && kare++ < 40) { requestAnimationFrame(bul); return; }
        kutu.scrollTop = 0;
        return;
      }
      if (hedef.ayar) {
        // 0.12 H3c: uzun satır (ör. "Nerede çalışsın": üç seçenek + sürüm kartları) ortalanırsa başı, grubun ve sayfanın başlığı pencere
        // düğmelerinin altına kayıyordu — başı zaten görünürse kaydırılmaz; görünmüyorsa üstte payla getirilir. Kısa satır eskisi gibi ortalanır.
        const kr = kutu.getBoundingClientRect(), er = el.getBoundingClientRect();
        if (er.height > kr.height * 0.5) { const ust = er.top - kr.top; if (ust < 60 || ust > kr.height - 200) kutu.scrollTop += ust - 140; }
        else el.scrollIntoView({ block: 'center' });
        el.removeAttribute('data-isaret');
        void el.offsetWidth; // aynı ayar art arda: canlandırma yeniden başlasın
        el.setAttribute('data-isaret', '');
        setTimeout(() => el.removeAttribute('data-isaret'), 2400);
        if (hedef.odakla) el.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')?.focus({ preventScroll: true });
      } else if (hedef.grup && kutu.querySelector('[data-grup]') !== el) el.scrollIntoView({ block: 'start' });
      else kutu.scrollTop = 0;
    };
    bul();
    return () => { iptal = true; };
  }, [hedef]);

  // Ctrl+F: arama kutusu (kurulum sihirbazı, tanıtım turu ya da model seçici üstteyken değil; seçici kendi aramasına odaklar).
  useEffect(() => {
    const tus = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return;
      if (document.querySelector('.kurulum, .tanitim, .msec, .fhp')) return;
      e.preventDefault();
      araKutusu.current?.focus();
      araKutusu.current?.select();
    };
    addEventListener('keydown', tus);
    return () => removeEventListener('keydown', tus);
  }, []);

  if (!a) return null;

  const kaydet = (d: Partial<A>) => void cagir<A>('ayarlar:kaydet', d).then((y) => { setA(y); setKaydedildi(Date.now()); });
  const baglam: AyarBaglami = {
    a, kaydet, mod, sihirbaziAc,
    yenile: () => void cagir<A>('ayarlar:al').then(setA),
    git: (c) => { const h = cipaCoz(c, KATEGORILER, mod, ESKI_CIPALAR); if (h) hedefeGit(h, true); },
  };
  const grupDegistir = (id: string, ac: boolean) => {
    setAninda(null);
    setAcik((o) => { const s = new Set(o ?? acikGruplar); if (ac) s.add(id); else s.delete(id); return s; });
  };
  const sonucSec = (s: AramaSonucu) => hedefeGit({ kategori: s.kayit.kategori, grup: s.kayit.grup, ayar: s.kayit.id }, true);
  const araTus = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (sorgu) { e.preventDefault(); e.stopPropagation(); setSorgu(''); } else e.currentTarget.blur();
    } else if (e.key === 'Enter' && sonuclar[0]) { e.preventDefault(); sonucSec(sonuclar[0]); }
    else if (e.key === 'ArrowDown' && sonuclar.length) { e.preventDefault(); icerik.current?.querySelector<HTMLElement>('.arama__sonuc')?.focus(); }
  };

  return (
    <AyarBaglamiCtx.Provider value={baglam}>
      <div className="ayarlar" data-vurgu="ayarlar" style={vurguStili('ayarlar') as CSSProperties} data-mod={mod}>
        <nav className="ayarlar__yan" aria-label="Ayar kategorileri">
          <h1 className="ayarlar__baslik">Ayarlar</h1>
          <div className="ayarlar__ara" role="search">
            <Ikon ad="ara" olcu={16} />
            <input
              ref={araKutusu} type="search" value={sorgu} placeholder="Ayarlarda ara" aria-label="Ayarlarda ara" aria-controls="ayarlar-icerik"
              spellCheck={false} autoComplete="off" onChange={(e) => setSorgu(e.target.value)} onKeyDown={araTus}
            />
            {sorgu && (
              <button type="button" className="ayarlar__temizle" aria-label="Aramayı temizle" title="Aramayı temizle (Esc)" onClick={() => { setSorgu(''); araKutusu.current?.focus(); }}>
                <Ikon ad="kapat" olcu={14} />
              </button>
            )}
          </div>
          {/* Düzeltme turu 1 (M6): her bölüm ayrı grup — ekran okuyucu bölüm sınırını adıyla duyar (görünmeyen başlık + aria-labelledby);
              görünen ayrım grubun üstündeki ince çizgi. */}
          <div className="ayarlar__liste">
            {kategoriBolumleri(kategoriler).map(({ bolum, liste }) => (
              <div key={bolum} className="ayarlar__bolum" role="group" aria-labelledby={`ayar-bolum-${bolum}`} data-bolum={bolum}>
                <h2 className="ui-gizli" id={`ayar-bolum-${bolum}`}>{BOLUM_ADI[bolum] ?? 'Diğer ayarlar'}</h2>
                <Liste>
                  {liste.map((k) => (
                    <button
                      key={k.id} type="button" className="kategori" data-kategori={k.id} data-is-dili-istisna={k.isDiliIstisna ? '' : undefined} aria-current={!aramada && k.id === secili.id ? 'page' : undefined}
                      onClick={() => { if (aramada || k.id !== secili.id) kategoriAc(k.id); }}
                    >
                      <span className="kategori__simge"><Ikon ad={k.simge} olcu={16} /></span>
                      <span className="kategori__metin"><span className="kategori__ad">{k.ad}</span><span className="kategori__aciklama">{modaGore(mod, k.aciklama, k.aciklamaIs)}</span></span>
                      {aramada && sayac.get(k.id) ? <span className="kategori__sayi" aria-label={`${sayac.get(k.id)} sonuç`}>{sayac.get(k.id)}</span> : null}
                    </button>
                  ))}
                </Liste>
              </div>
            ))}
          </div>
        </nav>

        <div className="ayarlar__icerik" id="ayarlar-icerik" ref={icerik}>
          {aramada ? <AramaSonuclari sorgu={sorgu} sonuclar={sonuclar} sec={sonucSec} /> : (
            <section className="ayarlar__sayfa" id={secili.id} data-kategori={secili.id} data-is-dili-istisna={secili.isDiliIstisna ? '' : undefined} aria-labelledby="ayarlar-baslik">
              <header className="ayarlar__bas">
                <span className="ayarlar__bas-simge"><Ikon ad={secili.simge} olcu={22} /></span>
                <div className="ayarlar__bas-metin">
                  <h2 className="ayarlar__bas-ad" id="ayarlar-baslik">{secili.ad}</h2>
                  <p className="ayarlar__bas-giris">{modaGore(mod, secili.giris, secili.girisIs)}</p>
                </div>
                <KaydedildiRozeti zaman={kaydedildi} />
              </header>
              <div className="ayarlar__gruplar">
                {gruplar.map((g) => {
                  const Icerik = ICERIKLER[secili.id]?.[g.id];
                  return (
                    <Akordeon
                      key={`${secili.id}/${g.id}`} id={`ayar-${secili.id}-${g.id}`} baslik={modaGore(mod, g.baslik, g.baslikIs)} aciklama={g.aciklama !== undefined ? modaGore(mod, g.aciklama, g.aciklamaIs) : undefined} ozet={g.ozet?.(a)}
                      acik={acikGruplar.has(g.id)} aninda={aninda === g.id} degistir={(v) => grupDegistir(g.id, v)} veri={{ 'data-grup': g.id }}
                    >
                      {Icerik ? <Icerik /> : null}
                    </Akordeon>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </AyarBaglamiCtx.Provider>
  );
}

/** Arama sonuçları: kategori başlığı altında (en iyi sonucun sırasıyla), satırda ad + açıklama (eşleşme vurgulu) + grup adı. ↑/↓ gezinir. */
function AramaSonuclari({ sorgu, sonuclar, sec }: { sorgu: string; sonuclar: AramaSonucu[]; sec: (s: AramaSonucu) => void }) {
  const acil = useAcilDurdurma(); // B8: açıklamadaki acil durdurma tuşu gerçek duruma göre
  const gruplar: { kategori: AyarKategorisi; liste: AramaSonucu[] }[] = [];
  for (const s of sonuclar) {
    let g = gruplar.find((x) => x.kategori.id === s.kayit.kategori);
    if (!g) { g = { kategori: KATEGORILER.find((k) => k.id === s.kayit.kategori)!, liste: [] }; gruplar.push(g); }
    g.liste.push(s);
  }
  const tus = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const l = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.arama__sonuc')];
    const i = l.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) { document.querySelector<HTMLInputElement>('.ayarlar__ara input')?.focus(); return; }
    l[Math.max(0, Math.min(l.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  const s = sorgu.trim();
  return (
    <section className="ayarlar__sayfa arama" onKeyDown={tus} aria-labelledby="arama-baslik">
      <header className="ayarlar__bas">
        <span className="ayarlar__bas-simge"><Ikon ad="ara" olcu={22} /></span>
        <div className="ayarlar__bas-metin">
          <h2 className="ayarlar__bas-ad" id="arama-baslik">Arama</h2>
          <p className="ayarlar__bas-giris" aria-live="polite">{sonuclar.length ? `“${s}” için ${sonuclar.length} ayar` : `“${s}” ile eşleşen ayar yok.`}</p>
        </div>
      </header>
      {!sonuclar.length && <div className="kart arama__bos">Başka bir sözcük dene: “tema”, “mikrofon”, “sabah özeti”, “yetki”.</div>}
      {gruplar.map(({ kategori, liste }) => (
        <div key={kategori.id} className="arama__grup" data-kategori={kategori.id}>
          <div className="arama__grup-bas"><Ikon ad={kategori.simge} olcu={15} />{kategori.ad}</div>
          <div className="kart arama__liste">
            <Liste>{liste.map((x) => (
              <button key={x.kayit.id} type="button" className="arama__sonuc" data-sonuc={x.kayit.id} onClick={() => sec(x)}>
                <span className="arama__metin">
                  <span className="arama__ad"><Vurgulu metin={x.kayit.ad} sorgu={sorgu} /></span>
                  {x.kayit.aciklama && <span className="arama__aciklama"><Vurgulu metin={acilYerlestir(x.kayit.aciklama, acil)} sorgu={sorgu} /></span>}
                </span>
                <span className="arama__yol">{x.kayit.grupAd}<Ikon ad="ileri" olcu={14} /></span>
              </button>
            ))}</Liste>
          </div>
        </div>
      ))}
    </section>
  );
}

function Vurgulu({ metin, sorgu }: { metin: string; sorgu: string }) {
  const ar = eslesmeAraliklari(metin, sorgu);
  if (!ar.length) return <>{metin}</>;
  const parcalar: ReactNode[] = [];
  let i = 0;
  for (const [b, s] of ar) {
    if (b > i) parcalar.push(metin.slice(i, b));
    parcalar.push(<mark key={b} className="eslesme">{metin.slice(b, s)}</mark>);
    i = s;
  }
  if (i < metin.length) parcalar.push(metin.slice(i));
  return <>{parcalar}</>;
}
