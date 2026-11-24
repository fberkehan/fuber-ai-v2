// ── "Önerilen araçlar"ın ortak parçaları (Görev 29, K18; adı 0.10'da K8): Claude Code durumu, paket ızgarası, öğe ayrıntısı, hâl hapı,
// kurulum komutu onayı. Sihirbazın "Geliştirici araçları" adımı (kurulum/GelistiriciAraclariAdimi.tsx) ve Claude Code → Eklentiler sekmesi
// (claudecode/Eklentiler.tsx) kullanır. Yalnız Geliştirici modunda çizilir. Kurulum ana süreçte, ARKA PLANDA (eklenti-kurucu.ts).
// Dışa açılanların adı ve imzası sihirbaz için korunur (CcDurumSatiri'ye yalnız isteğe bağlı `serit` eklendi).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import {
  ALAN_GOSTERIM_SINIRI, GELISTIRICI_PAKETI, KOMUT_COK_UZUN, KOMUT_GOSTERIM_SINIRI, KOMUT_SATIR_SINIRI, komutParcalari, ogeDesteklenirMi, onayAyrintilari, paketOgesi,
  type EklentiDurumu, type KomutOnayi, type OgeHali, type PaketDurumu, type PaketOgeDurumu, type PaketOgesi,
} from '../../shared/cc-eklentiler';
import './eklentiler.css';

/** Eklenti durumu: açılışta okunur, ilerleme olayıyla tazelenir. Yükleyici açıkken ya da "Oturum aç"tan sonra kısa aralıkla yeniden sorulur. */
export function useEklentiDurumu(): { d: EklentiDurumu | null; tazele: (zorla?: boolean) => void; izle: () => void } {
  const [d, setD] = useState<EklentiDurumu | null>(null);
  const izleme = useRef(0);
  const tazele = (zorla = false) => { void cagir<EklentiDurumu>('claudecode:eklenti-durum', { tazele: zorla }).then(setD).catch(() => undefined); };
  useEffect(() => {
    tazele();
    const k = dinle('claudecode:eklenti', (p: PaketDurumu) => setD((x) => (x ? { ...x, paket: p } : x)));
    return k;
  }, []);
  // Resmi yükleyici açıkken ya da girişten sonra (en çok 90 sn) 3 sn'de bir: kurulunca / oturum açılınca durum kendiliğinden güncellenir.
  useEffect(() => {
    const z = setInterval(() => {
      if (d?.claude.yukleyiciAcik || izleme.current > Date.now()) tazele(true);
    }, 3000);
    return () => clearInterval(z);
  }, [d?.claude.yukleyiciAcik]);
  return { d, tazele, izle: () => { izleme.current = Date.now() + 90_000; } };
}

export const HAL_ADI: Record<OgeHali, string> = {
  sirada: 'Sırada', bekliyor: 'Claude Code bekleniyor', kuruluyor: 'Kuruluyor', kuruldu: 'Kuruldu', kurulu: 'Kurulu', onay: 'Onay bekliyor', hata: 'Kurulamadı', reddedildi: 'Kurulmadı',
};

/** Öğenin hâl hapı. `ad`: hâlin adını değiştirir (ör. kancası bozuk Graphify'ın "hata"sı "Sorun var"; "Kurulamadı" değil). */
export function HalHapi({ o, ad: adOzel }: { o?: PaketOgeDurumu; ad?: string }) {
  if (!o) return null;
  const ad = adOzel ?? (o.hal === 'kuruluyor' && o.asama ? o.asama.replace(/…$/, '') : HAL_ADI[o.hal]);
  return (
    <span className="gp-hal" data-hal={o.hal} title={o.ileti}>
      {(o.hal === 'kuruluyor' || o.hal === 'sirada') ? <span className="donen" aria-hidden="true" />
        : (o.hal === 'kuruldu' || o.hal === 'kurulu') ? <Ikon ad="tamam" olcu={12} /> : <i className="gp-hal__nokta" aria-hidden="true" />}
      {ad}
    </span>
  );
}

/** Sıkı ızgaradaki (sihirbaz) hâl işareti: yalnız simge, köşede — yazının üstüne binmez; adı aria-label'da ve ayrıntı şeridinde. */
export function HalIsareti({ o }: { o?: PaketOgeDurumu }) {
  if (!o || o.hal === 'reddedildi') return null;
  const ad = HAL_ADI[o.hal];
  return (
    <span className="gp-isaret" data-hal={o.hal} role="img" aria-label={ad} title={o.ileti ? `${ad}: ${o.ileti}` : ad}>
      {(o.hal === 'kuruluyor' || o.hal === 'sirada') ? <span className="donen" aria-hidden="true" />
        : (o.hal === 'kuruldu' || o.hal === 'kurulu') ? <Ikon ad="tamam" olcu={11} /> : <i aria-hidden="true" />}
    </span>
  );
}

/**
 * Claude Code satırı: kurulu mu, Claude hesabı bağlı mı; "Claude Code'u kur" (resmi yükleyici, görünür PowerShell) ve "Claude hesabına giriş yap". `serit`: Eklentiler
 * sekmesinin üstünde yalnız sorun varken çıkan ince şerit (B-36; sekme onu yalnız ccSorunVar iken çizer).
 */
export function CcDurumSatiri({ d, izle, tazele, kurBirincil, serit = false }: { d: EklentiDurumu | null; izle: () => void; tazele: (z?: boolean) => void; kurBirincil: boolean; serit?: boolean }) {
  const [ileti, setIleti] = useState<{ metin: string; hata?: boolean } | null>(null);
  const [aciliyor, setAciliyor] = useState(false);
  const c = d?.claude;
  // Çift tık ikinci bir yükleyici açmaz: düğme yanıt gelene dek kapalı (ana süreç de yükleyici açıkken ikincisini açmaz).
  const kur = async () => {
    if (aciliyor) return;
    setIleti(null);
    setAciliyor(true);
    const r = await cagir<{ tamam: boolean; hata?: string }>('claudecode:cc-kur').catch((e) => ({ tamam: false, hata: String(e) }));
    setAciliyor(false);
    if (!r.tamam) setIleti({ metin: r.hata ?? 'Yükleyici açılamadı.', hata: true });
    tazele(true);
  };
  const giris = async () => {
    setIleti(null);
    const r = await cagir<{ tamam: boolean; hata?: string }>('claudecode:giris').catch((e) => ({ tamam: false, hata: String(e) }));
    if (r.tamam) { setIleti({ metin: 'Tarayıcıda Anthropic’in giriş sayfası açıldı; bitince burası kendiliğinden güncellenir.' }); izle(); } else setIleti({ metin: r.hata ?? 'Giriş başlatılamadı.', hata: true });
  };
  let durum: ReactNode;
  if (!c) durum = <><span className="donen" aria-hidden="true" />Denetleniyor…</>;
  else if (!c.kurulu && c.yukleyiciAcik) durum = <><span className="donen" aria-hidden="true" />Kuruluyor (PowerShell penceresinde); bitince seçtiklerini kurarım.</>;
  else if (!c.kurulu) durum = <><span className="nokta nokta--turuncu" />Kurulu değil; kurulunca seçtiklerin kurulur.</>;
  // Sözlük (0.10, P2): Claude Code girişi "Claude hesabı: bağlı" / "Claude hesabına giriş yap" ("oturum" sözcüğü Claude Code oturumlarına ait).
  else if (c.girisYapildi) durum = <><span className="nokta nokta--yesil" />Kurulu · Claude hesabı bağlı{c.yontem && c.yontem !== 'none' ? ` (${c.yontem})` : ''}</>;
  else durum = <><span className="nokta nokta--turuncu" />Kurulu · Claude hesabı bağlı değil; eklentiler yine kurulur.</>;
  return (
    <div className={`kart ccd${serit ? ' ccd--serit' : ''}`} data-cc-durum={!c ? 'bilinmiyor' : !c.kurulu ? (c.yukleyiciAcik ? 'kuruluyor' : 'yok') : c.girisYapildi ? 'acik' : 'kapali'}>
      <span className="ccd__simge"><Ikon ad="kod" olcu={18} /></span>
      <div className="ccd__metin">
        <b>Claude Code</b>
        <span>{durum}</span>
        {ileti && <span style={{ color: ileti.hata ? 'var(--yazi-hata)' : 'var(--ink-2)' }} role="status">{ileti.metin}</span>}
      </div>
      <div className="ccd__dugmeler">
        {c && !c.kurulu && !c.yukleyiciAcik && (
          <button type="button" className={`dgm dgm--k ${kurBirincil ? 'dgm--beyaz' : 'dgm--koyu'}`} disabled={aciliyor} onClick={() => void kur()} data-cc-kur=""
            title="Anthropic’in resmi yükleyicisi (irm https://claude.ai/install.ps1 | iex) görünür bir PowerShell penceresinde açılır.">
            <Ikon ad="dis" olcu={14} />Claude Code’u kur
          </button>
        )}
        {c?.kurulu && !c.girisYapildi && (
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void giris()} data-cc-giris="" title="Anthropic’in kendi giriş akışı (claude auth login); kimlik bilgin Fuber’den geçmez.">
            <Ikon ad="kilit" olcu={14} />Claude hesabına giriş yap
          </button>
        )}
      </div>
    </div>
  );
}

/** Claude Code tarafında sorun var mı (kurulu değil, yükleyici açık, oturum kapalı, okunamadı): Eklentiler sekmesi yalnız o zaman şerit çizer. */
export const ccSorunVar = (c: EklentiDurumu['claude'] | undefined) => Boolean(c && (!c.kurulu || c.yukleyiciAcik || !c.girisYapildi || c.hata));

/** Öğenin ayrıntısı ("Ayrıntılar"): kaynak, sürüm, lisans, nereye yazar, ağ, gereksinim, not, kaldırma. */
export function OgeAyrintisi({ o }: { o: PaketOgesi }) {
  return (
    <dl className="ekl__ayrinti">
      <dt>Kaynak</dt><dd>{o.kaynak}</dd>
      {o.surum && <><dt>Sürüm</dt><dd>{o.surum}</dd></>}
      <dt>Lisans</dt><dd>{o.lisans}</dd>
      <dt>Nereye yazar</dt><dd><ul>{o.yazdigiYer.map((y) => <li key={y}>{y}</li>)}</ul></dd>
      <dt>Ağ</dt><dd>{o.ag}</dd>
      <dt>Gereksinim</dt><dd>{o.gereksinim}</dd>
      {o.notlar?.length ? <><dt>Not</dt><dd><ul>{o.notlar.map((n) => <li key={n}>{n}</li>)}</ul></dd></> : null}
      {o.kaldirma && <><dt>Kaldırma</dt><dd>{o.kaldirma}</dd></>}
    </dl>
  );
}

/**
 * Metni KISALTMADAN çizer (izin listesi: yalnız yazdırılabilir ASCII ve — komutta — satır sonu düz): görünmeyen / yön değiştiren her
 * karakter yerinde yalnız "U+XXXX" kutusu; öteki ASCII dışı karakter okunur kalır ama işaretli ve yanında kodu (yönü yalıtılmış).
 */
export function GorunurMetin({ metin, satirSonu = true }: { metin: string; satirSonu?: boolean }) {
  const { parcalar } = komutParcalari(metin, { satirSonu });
  return <>{parcalar.map((p, i) => (
    p.tur === 'gizli' ? <mark key={i} className="ek-onay__gizli" data-gizli-karakter={p.metin} title="Görünmeyen ya da yazının görünüşünü/yönünü değiştiren karakter">{p.metin}</mark>
      : p.tur === 'isaretli' ? <mark key={i} className="ek-onay__ascii-disi" data-ascii-disi={p.kod} title={`ASCII dışı karakter ${p.kod}`}><bdi>{p.metin}</bdi><span className="ek-onay__kod">{p.kod}</span></mark>
        : <span key={i}>{p.metin}</span>
  ))}</>;
}

/**
 * Kurulum komutu onayı: Claude Code'un `--accept-command` ile onaylatacağı şeyin TAMAMI gösterilir — komut (kısaltılmadan; görünmeyen
 * karakterler işaretli), eklenti kimliği, indirilecek arşiv (`archiveUrl`), kip ve katalog sürümü, SHA-256. Yalnız kullanıcı onaylarsa
 * `--accept-command <sha256>` (asla körlemesine -y). Gösterilemeyecek kadar uzun komut için onay düğmesi YOK (ana süreç de reddeder).
 */
export function OnayKarti({ ad, onay, ileti, yanitla }: { ad: string; onay: KomutOnayi; ileti?: string; yanitla: (kabul: boolean) => Promise<void> }) {
  const [suruyor, setSuruyor] = useState(false);
  const yap = async (k: boolean) => { setSuruyor(true); try { await yanitla(k); } finally { setSuruyor(false); } };
  // Ana süreç zaten reddeder; burada ikinci kat (kartta hiçbir alan kısaltılmaz: sınırı aşan alanda onay düğmesi yok).
  const uzun = onay.komut.length > KOMUT_GOSTERIM_SINIRI || onay.komut.split('\n').length > KOMUT_SATIR_SINIRI || (onay.arsivAdresi?.length ?? 0) > KOMUT_GOSTERIM_SINIRI
    || (onay.mod?.length ?? 0) > ALAN_GOSTERIM_SINIRI || (onay.katalogSurumu?.length ?? 0) > ALAN_GOSTERIM_SINIRI;
  // Claude Code'dan gelen her alan görünmeyen karakter denetiminden geçer; Fuber'in kendi sözlüğündeki tür adı ("Kurulum yardımcısı") geçmez.
  const ayrintilar = onayAyrintilari(onay);
  const alanlar = [komutParcalari(onay.komut), ...ayrintilar.filter((s) => !s.duz).map((s) => komutParcalari(s.deger, { satirSonu: false }))];
  const gizliVar = alanlar.some((a) => a.gizliVar || a.isaretliVar);
  return (
    <div className="ek-onay" role="group" aria-label={`${ad}: kurulum komutu onayı`} data-onay={onay.sha256.slice(0, 12)}>
      <b>{ad} kurulurken bilgisayarında şu komutu çalıştıracak:</b>
      {uzun ? <span className="ek-onay__uyari" role="alert" data-komut-uzun="">{KOMUT_COK_UZUN}</span> : <>
        <pre className="ek-onay__komut" data-komut-uzunluk={onay.komut.length}><GorunurMetin metin={onay.komut} /></pre>
        <dl className="ek-onay__ayrinti">
          {ayrintilar.map((s) => <div key={s.etiket}><dt>{s.etiket}</dt>{s.duz
            ? <dd className="ek-onay__duz" data-onay-ayrinti={s.etiket} title={s.ham}>{s.deger}</dd>
            : <dd data-onay-ayrinti={s.etiket}><GorunurMetin metin={s.deger} satirSonu={false} /></dd>}</div>)}
          <div><dt>SHA-256</dt><dd className="ek-onay__ozet">{onay.sha256}</dd></div>
        </dl>
        {gizliVar && <span className="ek-onay__uyari" role="alert" data-gizli-uyari="">Komutta ASCII dışı, görünmeyen ya da yazı yönünü değiştiren karakter var (işaretli). Ne yaptığından emin değilsen kurma.</span>}
      </>}
      <span className="ek-onay__not">{ileti ? `${ileti} ` : ''}{uzun ? 'Bu eklentiyi buradan kuramazsın.' : 'Yalnız sen onaylarsan, yalnız bu komut çalışır.'}</span>
      <div className="ek-onay__dugmeler">
        {!uzun && <button type="button" className="dgm dgm--koyu dgm--k" disabled={suruyor} onClick={() => void yap(true)} data-onayla="">{suruyor ? <span className="donen" aria-hidden="true" /> : <Ikon ad="tamam" olcu={14} />}Onayla ve kur</button>}
        <button type="button" className="dgm dgm--hayalet dgm--k" disabled={suruyor} onClick={() => void yap(false)} data-reddet="">Kurma</button>
      </div>
    </div>
  );
}

/** Seçim kutusu (role=checkbox). */
export function SecimKutusu({ secili }: { secili: boolean }) {
  return <span className="gp-kutu" aria-hidden="true">{secili && <Ikon ad="tamam" olcu={12} />}</span>;
}

type Gorunum = 'onerilen' | 'istege';
/**
 * Sihirbazın sıkı paket ızgarası: iki sekme (Önerilen ★ dokuz / İsteğe bağlı on), iki sütun; üstüne gelinen ya da odaklanan öğenin
 * ayrıntısı alttaki şeritte (kazanç, kaynak, lisans); "Ne yazar, ağ" bütün öğelerin tam açıklamasını katmanda açar.
 */
export function PaketIzgarasi({ secim, setSecim, paket, ayrintiAc }: { secim: string[]; setSecim: (s: string[]) => void; paket: PaketDurumu | null; ayrintiAc: () => void }) {
  const [gorunum, setGorunum] = useState<Gorunum>('onerilen');
  // R20: ayrıntı şeridi listenin İLK önerilen aracıyla açılır (Graphify öne çıkmaz; listede en sonda).
  const ilkOnerilen = GELISTIRICI_PAKETI.find((o) => o.varsayilan)!.id;
  const [odak, setOdak] = useState<string>(ilkOnerilen);
  const liste = useMemo(() => GELISTIRICI_PAKETI.filter((o) => (gorunum === 'onerilen' ? o.varsayilan : !o.varsayilan)), [gorunum]);
  const oge = paketOgesi(odak) ?? liste[0];
  const durum = (id: string) => paket?.ogeler.find((x) => x.id === id);
  const degistir = (id: string) => setSecim(secim.includes(id) ? secim.filter((x) => x !== id) : GELISTIRICI_PAKETI.filter((o) => o.id === id || secim.includes(o.id)).map((o) => o.id));
  const sayi = (v: boolean) => GELISTIRICI_PAKETI.filter((o) => o.varsayilan === v && secim.includes(o.id)).length;
  return (
    <div className="kart gp" data-gp-gorunum={gorunum}>
      <div className="gp__bas">
        <b>Önerilen araçlar</b>
        <span className="gp__sayi" data-gp-sayi="">{secim.length} / {GELISTIRICI_PAKETI.length} seçili</span>
        <div className="sekmeler" role="tablist" aria-label="Paket">
          <button type="button" role="tab" aria-selected={gorunum === 'onerilen'} onClick={() => { setGorunum('onerilen'); setOdak(ilkOnerilen); }}>Önerilen · {sayi(true)}/9</button>
          <button type="button" role="tab" aria-selected={gorunum === 'istege'} onClick={() => { setGorunum('istege'); setOdak('security-guidance'); }}>İsteğe bağlı · {sayi(false)}/10</button>
        </div>
      </div>
      <div className="gp__izgara" role="group" aria-label={gorunum === 'onerilen' ? 'Önerilen araçlar' : 'İsteğe bağlı araçlar'}>
        {liste.map((o) => {
          const d = durum(o.id);
          const secili = secim.includes(o.id);
          const destek = ogeDesteklenirMi(o, window.fuber?.platform);
          return (
            <button key={o.id} type="button" role="checkbox" aria-checked={secili} className="gp__oge" data-oge={o.id} data-odak={odak === o.id ? '' : undefined}
              disabled={!destek && !secili} title={destek ? undefined : 'Şimdilik yalnız Windows’ta kurulur'}
              onClick={() => { degistir(o.id); setOdak(o.id); }} onMouseEnter={() => setOdak(o.id)} onFocus={() => setOdak(o.id)} aria-describedby="gp-ayrinti">
              <SecimKutusu secili={secili} />
              <span className="gp__oge-metin"><b>{o.ad}</b><span>{o.kisa}</span></span>
              <HalIsareti o={d} />
            </button>
          );
        })}
      </div>
      {oge && (
        <div className="gp__ayrinti" data-gp-ayrinti={oge.id}>
          <div id="gp-ayrinti" aria-live="polite" className="gp__ayrinti-yazi">
            <span><b>{oge.ad}</b> — {oge.kazanc}</span>
            <span className="gp__ayrinti-meta">{(() => { const h = durum(oge.id); return h && h.hal !== 'reddedildi' ? `${HAL_ADI[h.hal]} · ` : ''; })()}Kaynak: {oge.kaynak} · Lisans: {oge.lisans}</span>
          </div>
          <button type="button" className="dgm dgm--hayalet dgm--k" onClick={ayrintiAc} data-gp-ayrinti-ac="" title="Her aracın nereye yazdığı, ağa çıkıp çıkmadığı ve gereksinimi">Ne yazar, ağ<Ikon ad="ileri" olcu={13} /></button>
        </div>
      )}
    </div>
  );
}

/** Sihirbazdaki "Ne yazar, ağ" katmanı: bütün öğelerin tam açıklaması (kendi içinde kayar; Esc kapatır). */
export function PaketAyrintiKatmani({ kapat }: { kapat: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const t = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); kapat(); } };
    window.addEventListener('keydown', t, true);
    return () => window.removeEventListener('keydown', t, true);
  }, []);
  return (
    <div ref={ref} className="gp-sayfa" role="dialog" aria-modal="true" aria-label="Önerilen araçlar: ne yazar, ağ" tabIndex={-1} data-gp-katman="">
      <div className="gp-sayfa__bas">
        <b>Ne yazar, ağa çıkar mı</b>
        <span>Katalog eklentilerini Claude Code’un kendisi kurar; Fuber Claude Code’un dosyalarına doğrudan yazmaz.</span>
        <button type="button" className="dgm dgm--koyu dgm--k" onClick={kapat}><Ikon ad="kapat" olcu={14} />Kapat</button>
      </div>
      <div className="gp-sayfa__liste">
        {GELISTIRICI_PAKETI.map((o) => (
          <div key={o.id} className="ekl" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <div className="ekl__bas"><b>{o.ad}</b>{o.varsayilan && <span className="gp-hal">Önerilen</span>}</div>
            <div className="ekl__metin" style={{ gridColumn: 1 }}>{o.kazanc}</div>
            <div style={{ gridColumn: 1 }}><OgeAyrintisi o={o} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
