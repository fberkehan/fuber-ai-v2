// ── Claude Code → Eklentiler sekmesi (Görev 29, K18; 0.10 Görev 7 + K8; yalnız Geliştirici) ───────────────────────────────────────────
// K8 (27 Eki): Apple ürünü gibi hissettirmeli — sakin ve seyrek. Her araç: tek satır ad + tek kısa cümle + hâl + eylemler;
// kaynak, lisans, nereye yazdığı, ağ, not ve kaldırma yalnız "Ayrıntılar"da (B-7). Graphify listede sıradan bir öğe: kartta uyarı yok,
// yalnız kancası gerçekten bozuksa (graphifySorunu) hata hâli. Yerleşim (B-36): solda Oturumlar'la aynı genişlikte (--cc-sol) menü; üstte
// şerit YALNIZ sorun varken (Claude Code kurulu değil / Claude hesabı bağlı değil; onay bekleyen ya da sorunlu araç). Üç sayaç tek tanımdan (B-23):
// menü "8/9", bölüm başlığı "1 kurulacak", sağ üst "1 onay bekliyor" — hepsi paketSayaci.
//   · Önerilen araçlar — ★ dokuz + isteğe bağlı on: kurulmamışı seç, kur (ARKA PLANDA); kurulu öğede seçim kutusu yok ("Kurulu ✓" +
//     "Yönet", B-24); kurulum komutu onayı (komut + SHA-256 GÖSTERİLİR; yalnız onayla --accept-command); yeniden dene.
//   · Kurulu eklentiler — `claude plugin list --json`: aç/kapat, kaldır; bölüm başında tek "Hepsini güncelle", satırda "Güncelle" yalnız
//     katalogda yeni sürüm biliniyorsa (B-32).
//   · Beceriler — ~/.claude/skills (salt okur liste); kaldır = Geri Dönüşüm Kutusu (Graphify'ınki Graphify'la kalkar).
//   · MCP sunucuları — `claude mcp list`: Türkçe hâl (ham metin ipucunda), eklentinin sunucusu eklentinin adıyla (B-25).
//   · Katalogda ara — `claude plugin list --available --json`; ortak metin bölüm başında bir kez, sayaç yalnız aramada.
// Ana süreç: main/claudecode/eklenti-kurucu.ts (kanallar telefondan KAPALI). Fuber Claude Code'un dosyalarına doğrudan yazmaz.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { CcDurumSatiri, HalHapi, OgeAyrintisi, OnayKarti, SecimKutusu, ccSorunVar, useEklentiDurumu } from './GelistiriciPaketi';
import {
  CC_KATALOG, GELISTIRICI_PAKETI, ekYolu, graphifySorunu, kurulumSecimi, mcpGorunenAd, mcpHalAdi, ogeCozucu, ogeDesteklenirMi, paketSayaci, secimiSuz,
  tamamMi, varsayilanSecim, yeniSurumVar,
  type Beceri, type EklentiDurumu, type KatalogOgesi, type KomutOnayi, type KuruluEklenti, type ListeSonucu, type ListeTuru, type McpSunucu, type PaketOgeDurumu,
  type PaketOgesi, type PaketSayaci,
} from '../../shared/cc-eklentiler';
import './eklentiler.css';

type Bolum = 'paket' | 'eklenti' | 'beceri' | 'mcp' | 'katalog';
interface IslemSonucu { tamam: boolean; hata?: string; ileti?: string; onay?: KomutOnayi }
type Listeler = { eklenti?: ListeSonucu<KuruluEklenti>; beceri?: ListeSonucu<Beceri>; mcp?: ListeSonucu<McpSunucu>; katalog?: ListeSonucu<KatalogOgesi> };

/** Sol menünün "?" ipucu (B-36: eskiden menünün altında sabit paragraftı). */
const YARDIM = 'Kurulumu Claude Code’un kendi komutları yapar; Fuber onun dosyalarına doğrudan yazmaz. Yeni eklentiler yeni oturumlarda etkin olur.';

/** İki adımlı onay: önce "Kaldır", sonra "Kaldırılsın mı? Evet / Vazgeç". */
function SorDugmesi({ etiket, soru, yap, devreDisi }: { etiket: string; soru: string; yap: () => Promise<void>; devreDisi?: boolean }) {
  const [sor, setSor] = useState(false);
  const [suruyor, setSuruyor] = useState(false);
  if (!sor) return <button type="button" className="dgm dgm--hayalet dgm--k" disabled={devreDisi} onClick={() => setSor(true)} data-kaldir=""><Ikon ad="cop" olcu={14} />{etiket}</button>;
  return (
    <span className="ek-sor">
      <span>{soru}</span>
      <button type="button" className="dgm dgm--tehlike dgm--k" disabled={suruyor} onClick={() => { setSuruyor(true); void yap().finally(() => { setSuruyor(false); setSor(false); }); }} data-evet="">{suruyor ? <span className="donen" aria-hidden="true" /> : null}Evet</button>
      <button type="button" className="dgm dgm--hayalet dgm--k" disabled={suruyor} onClick={() => setSor(false)}>Vazgeç</button>
    </span>
  );
}

function Bos({ baslik, children, eylem }: { baslik: string; children: ReactNode; eylem?: ReactNode }) {
  return <div className="ek__bos" data-bos=""><b>{baslik}</b><span>{children}</span>{eylem}</div>;
}

/** "Ayrıntılar" açma düğmesi (her satırda aynı; ok açıkken döner). */
function AyrintiDugmesi({ acik, degistir }: { acik: boolean; degistir: () => void }) {
  return <button type="button" className="dgm dgm--hayalet dgm--k ekl__ac" aria-expanded={acik} onClick={degistir} data-ayrinti-ac="">Ayrıntılar<Ikon ad="ileri" olcu={13} /></button>;
}

export function Eklentiler() {
  const { d, tazele, izle } = useEklentiDurumu();
  const [bolum, setBolum] = useState<Bolum>('paket');
  const [l, setL] = useState<Listeler>({});
  const [yukleniyor, setYukleniyor] = useState<Partial<Record<ListeTuru, boolean>>>({});
  const [ileti, setIleti] = useState<{ metin: string; hata?: boolean; ayrinti?: string } | null>(null);
  const [ara, setAra] = useState('');
  const [yardim, setYardim] = useState(false);
  const [guncelleniyor, setGuncelleniyor] = useState(false);
  const kurulu = Boolean(d?.claude.kurulu);

  const yukle = (tur: ListeTuru, zorla = false) => {
    setYukleniyor((y) => ({ ...y, [tur]: true }));
    void cagir<ListeSonucu<unknown>>('claudecode:eklenti-liste', tur, { tazele: zorla })
      .then((r) => setL((x) => ({ ...x, [tur]: r })))
      .catch((e) => setL((x) => ({ ...x, [tur]: { liste: null, hata: String(e), zaman: Date.now() } })))
      .finally(() => setYukleniyor((y) => ({ ...y, [tur]: false })));
  };
  useEffect(() => { yukle('eklenti'); yukle('beceri'); const z = setTimeout(() => yukle('mcp'), 600); return () => clearTimeout(z); }, [kurulu]); // eslint-disable-line react-hooks/exhaustive-deps
  // Paketten bir öğe bitince kurulu listeler (MCP de: Context7, Playwright kendi sunucularını getirir) ve durum (Graphify denetimi) tazelenir.
  const bitenler = d?.paket.ogeler.filter((o) => tamamMi(o.hal) || o.hal === 'hata').length ?? 0;
  useEffect(() => { if (bitenler) { yukle('eklenti', true); yukle('beceri', true); yukle('mcp', true); tazele(); } }, [bitenler]); // eslint-disable-line react-hooks/exhaustive-deps
  // Katalog YALNIZ "Katalogda ara" açılınca okunur (okumak resmi kataloğu Claude Code'a ekleyebilir: ağ + yapılandırma yazımı — düzeltme
  // turu 1). Kurulu eklentiler'deki satır "Güncelle"si katalog daha önce okunduysa onun sürümünü kullanır; okunmadıysa yalnız "Hepsini güncelle".
  useEffect(() => { if (bolum === 'katalog' && !l.katalog && kurulu) yukle('katalog'); }, [bolum, kurulu]); // eslint-disable-line react-hooks/exhaustive-deps

  // Güncellemenin kurulum komutu değiştiyse (Claude Code shownCommand bildirir) satırda onay kartı (eklenti kimliği → komut).
  const [onaylar, setOnaylar] = useState<Record<string, KomutOnayi>>({});
  useEffect(() => { setIleti(null); }, [bolum]);
  const FIIL: Record<string, string> = { ac: 'açıldı', kapat: 'kapatıldı', guncelle: 'güncellendi', kaldir: 'kaldırıldı' };
  const islem = async (o: { tur: string; id: string; islem: string; kapsam?: string }, sonra: ListeTuru[] = []) => {
    setIleti(null);
    const r = await cagir<IslemSonucu>('claudecode:eklenti-islem', o).catch((e) => ({ tamam: false, hata: String(e) }) as IslemSonucu);
    if (r.onay) setOnaylar((x) => ({ ...x, [o.id]: r.onay! }));
    else if (!r.tamam) setIleti({ metin: r.hata ?? 'İşlem yapılamadı.', hata: true });
    // Başarı iletisi Türkçe (Claude Code'un İngilizce iletisi yalnız hatada gösterilir).
    else setIleti({ metin: o.tur === 'eklenti' ? `${o.id.split('@')[0]} ${FIIL[o.islem] ?? 'tamam'}.` : r.ileti ?? 'Tamam.' });
    for (const t of sonra) yukle(t, true);
    tazele();
  };
  // Bölüm başındaki tek "Hepsini güncelle" (B-32): kurulu her eklenti sırayla `claude plugin update`; komut değişen güncelleme onay ister.
  const hepsiniGuncelle = async () => {
    const liste = l.eklenti?.liste ?? [];
    if (!liste.length || guncelleniyor) return;
    setGuncelleniyor(true);
    setIleti(null);
    let tamam = 0, onay = 0;
    const hatalar: string[] = [];
    for (const e of liste) {
      const r = await cagir<IslemSonucu>('claudecode:eklenti-islem', { tur: 'eklenti', id: e.id, islem: 'guncelle', kapsam: e.kapsam }).catch((x) => ({ tamam: false, hata: String(x) }) as IslemSonucu);
      if (r.onay) { onay++; setOnaylar((x) => ({ ...x, [e.id]: r.onay! })); } else if (r.tamam) tamam++; else hatalar.push(`${e.id.split('@')[0]}: ${r.hata ?? 'güncellenemedi'}`);
    }
    setGuncelleniyor(false);
    const parca = [tamam ? `${tamam} eklenti güncel` : '', onay ? `${onay} eklenti onayını bekliyor` : '', hatalar.length ? `${hatalar.length} eklenti güncellenemedi` : ''].filter(Boolean);
    setIleti({ metin: `${parca.join(' · ')}.`, hata: hatalar.length > 0 && !tamam, ...(hatalar.length ? { ayrinti: hatalar.join('\n') } : {}) });
    yukle('eklenti', true);
    if (l.katalog) yukle('katalog', true);
    tazele();
  };
  // Paket öğesinin onayı (Önerilen araçlar bölümü) ana süreçte öğe hâlini değiştirir → 'claudecode:eklenti' olayı → bitenler → listeler tazelenir.
  const guncelOnayla = async (id: string, o: KomutOnayi, kabul: boolean) => {
    const r = await cagir<IslemSonucu>('claudecode:eklenti-onay', { id, sha256: o.sha256, kabul }).catch((e) => ({ tamam: false, hata: String(e) }) as IslemSonucu);
    setOnaylar((x) => { const { [id]: _s, ...k } = x; return r.onay ? { ...k, [id]: r.onay } : k; });
    setIleti(!kabul ? { metin: `${id.split('@')[0]} güncellenmedi: komutu onaylamadın.` } : r.tamam ? { metin: `${id.split('@')[0]} güncellendi.` } : r.onay ? null : { metin: r.hata ?? 'Güncellenemedi.', hata: true });
    yukle('eklenti', true);
  };

  // ── Öğelerin GEÇERLİ hâli (tek çözücü gecerliHal: satırlar da sayaçlar da bunu kullanır; bozuk Graphify'ın TEK hâli "hata") ──
  const eklentiler = l.eklenti?.liste ?? null, beceriler = l.beceri?.liste ?? null;
  const gSorun = graphifySorunu(d);
  // Düzeltme turu 2: "liste okundu" türe göre (Graphify → Beceriler, katalog → Kurulu eklentiler); okunmamış / okunamamış listede kayıt geçerli.
  const hal = ogeCozucu(d, { eklentiler, beceriler });
  const gecerli: EklentiDurumu | null = d ? { ...d, paket: { ...d.paket, ogeler: GELISTIRICI_PAKETI.map(hal).filter((x): x is PaketOgeDurumu => Boolean(x)) } } : null;
  const sayac = paketSayaci(GELISTIRICI_PAKETI, gecerli, window.fuber?.platform);
  const kurBirincil = Boolean(d && !d.claude.kurulu && !d.claude.yukleyiciAcik);

  // Katalog araması (sayaç yalnız aramada: eşleşme sayısı).
  const eslesen = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase('tr');
    return (l.katalog?.liste ?? []).filter((k) => !q || `${k.ad} ${k.aciklama} ${k.id}`.toLocaleLowerCase('tr').includes(q));
  }, [l.katalog, ara]);
  const sayilar: Record<Bolum, string> = {
    paket: d ? `${sayac.hazir}/${sayac.onerilen}` : '',
    eklenti: eklentiler ? String(eklentiler.length) : '',
    beceri: beceriler ? String(beceriler.length) : '',
    mcp: l.mcp?.liste ? String(l.mcp.liste.length) : '',
    katalog: ara.trim() && l.katalog?.liste ? String(eslesen.length) : '',
  };
  const MENU: [Bolum, string, string][] = [['paket', 'yildiz', 'Önerilen araçlar'], ['eklenti', 'arac', 'Kurulu eklentiler'], ['beceri', 'isik', 'Beceriler'], ['mcp', 'baglanti', 'MCP sunucuları'], ['katalog', 'ara', 'Katalogda ara']];

  // Sağ üstteki durum yalnız sorun varken; ikisi de paketSayaci'ndan: onay bekleyen ve sorunlu (kurulamadı / bozuk Graphify kancası). Tıklayınca o satır.
  const sorunaGit = (sec: string) => {
    setBolum('paket');
    setTimeout(() => document.querySelector(sec)?.scrollIntoView({ block: 'nearest' }), 60);
  };
  const cipler: { tur: 'onay' | 'hata'; metin: string; sec: string }[] = [
    ...(sayac.onayBekleyen ? [{ tur: 'onay' as const, metin: `${sayac.onayBekleyen} onay bekliyor`, sec: '[data-ek-oge][data-hal="onay"]' }] : []),
    ...(sayac.sorunlu ? [{ tur: 'hata' as const, metin: `${sayac.sorunlu} araçta sorun`, sec: '[data-ek-oge][data-hal="hata"]' }] : []),
  ];
  const serit = ccSorunVar(d?.claude);
  const ust = serit || cipler.length > 0;

  let icerik: ReactNode;
  if (bolum === 'paket') icerik = <PaketBolumu d={d} hal={hal} sayac={sayac} kurBirincil={kurBirincil} gSorun={gSorun} yonet={(o) => setBolum(o.tur === 'graphify' ? 'beceri' : 'eklenti')} />;
  else if (bolum === 'eklenti') icerik = <EklentiBolumu s={l.eklenti} katalog={l.katalog?.liste ?? null} yukleniyor={Boolean(yukleniyor.eklenti)} kurulu={kurulu} yenile={() => yukle('eklenti', true)} islem={islem} hepsiniGuncelle={hepsiniGuncelle} guncelleniyor={guncelleniyor} pakete={() => setBolum('paket')} onaylar={onaylar} onayla={guncelOnayla} />;
  else if (bolum === 'beceri') icerik = <BeceriBolumu s={l.beceri} yukleniyor={Boolean(yukleniyor.beceri)} yenile={() => yukle('beceri', true)} islem={islem} />;
  else if (bolum === 'mcp') icerik = <McpBolumu s={l.mcp} yukleniyor={Boolean(yukleniyor.mcp)} kurulu={kurulu} yenile={() => yukle('mcp', true)} islem={islem} />;
  else icerik = <KatalogBolumu s={l.katalog} bulunan={eslesen.slice(0, 80)} ara={ara} setAra={setAra} yukleniyor={Boolean(yukleniyor.katalog)} kurulu={kurulu} yenile={() => yukle('katalog', true)} kuruldu={() => { yukle('eklenti', true); yukle('katalog', true); }} />;

  return (
    <div className="ek" data-ek-bolum={bolum} data-ust={ust ? '' : undefined}>
      {ust && (
        <div className="ek__ust" data-ek-ust="">
          {serit && <CcDurumSatiri d={d} izle={izle} tazele={tazele} kurBirincil={kurBirincil} serit />}
          {cipler.length > 0 && (
            <div className="ek__durum" role="group" aria-label="Önerilen araçların durumu">
              {cipler.map((c) => <button key={c.tur} type="button" className="ek-cip" data-ek-cip={c.tur} onClick={() => sorunaGit(c.sec)}><i className="ek-cip__nokta" aria-hidden="true" />{c.metin}</button>)}
            </div>
          )}
        </div>
      )}
      <div className="ek__govde">
        <nav className="kart ek__menu" aria-label="Eklentiler bölümleri">
          <div className="ek__menu-liste" role="tablist" aria-orientation="vertical">
            {MENU.map(([b, ikon, ad]) => (
              <button key={b} type="button" role="tab" aria-selected={bolum === b} onClick={() => setBolum(b)} data-ek-menu={b}
                title={b === 'paket' && d ? `${sayac.onerilen} önerilen araçtan ${sayac.hazir} tanesi hazır` : undefined}>
                <Ikon ad={ikon} olcu={16} /><span>{ad}</span>{sayilar[b] && <span className="ek__menu-sayi" data-ek-sayi={b}>{sayilar[b]}</span>}
              </button>
            ))}
          </div>
          <div className="ek__menu-alt">
            <button type="button" className="dgm dgm--hayalet dgm--k ek__yardim" aria-expanded={yardim} aria-controls="ek-yardim" aria-label="Bu sekme nasıl çalışır?" title={YARDIM} onClick={() => setYardim(!yardim)} data-ek-yardim="">?</button>
            <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => void cagir('claudecode:eklenti-gunluk')} title={d?.paket.gunluk ? `Kurulum günlüğü: ${d.paket.gunluk}` : 'Kurulum günlüğü'}><Ikon ad="liste" olcu={14} />Günlük</button>
          </div>
          {yardim && <p id="ek-yardim" className="ek__menu-not">{YARDIM}</p>}
        </nav>
        <section className="kart ek__icerik" aria-label={MENU.find((m) => m[0] === bolum)?.[2]}>
          {icerik}
          {ileti && <div className="ek__ileti" data-hata={ileti.hata ? '' : undefined} role="status" title={ileti.ayrinti}>{ileti.metin}</div>}
        </section>
      </div>
    </div>
  );
}

// ── Önerilen araçlar ────────────────────────────────────────────────────────────────────────────────────────────────────────
function PaketBolumu({ d, hal, sayac, kurBirincil, gSorun, yonet }: {
  d: EklentiDurumu | null; hal: (o: PaketOgesi) => PaketOgeDurumu | undefined; sayac: PaketSayaci; kurBirincil: boolean; gSorun: string | null; yonet: (o: PaketOgesi) => void;
}) {
  const [secim, setSecim] = useState<string[] | null>(null);
  const [acik, setAcik] = useState<string | null>(null);
  const p = d?.paket ?? null;
  useEffect(() => {
    if (secim !== null || !p) return;
    // Paket daha önce seçildiyse (adım görüldü) o seçim; görülmediyse ★ varsayılan (tek tek kurulmuş araçlar varsayılanı daraltmaz).
    const onceki = p.adimGoruldu ? secimiSuz(p.ogeler.filter((o) => o.hal !== 'reddedildi').map((o) => o.id)) : [];
    setSecim(onceki.length ? onceki : varsayilanSecim(window.fuber?.platform));
  }, [p, secim]);
  const s = secim ?? [];
  // Gönderilecek / kurulacaklar (kurulumSecimi): kurulu öğe yeniden kuyruğa girmez; kancası bozuk Graphify'ın tek eylemi satırındaki
  // "Yeniden kur"; süren / onay bekleyen seçili öğe gönderilir ki kuyruktan düşmesin.
  const { gonderilecek, yeni } = kurulumSecimi(s, hal, { platform: window.fuber?.platform, graphifySorunu: gSorun });
  const kur = () => void cagir('claudecode:paket-baslat', { secim: gonderilecek });
  const degistir = (id: string) => setSecim(s.includes(id) ? s.filter((x) => x !== id) : GELISTIRICI_PAKETI.filter((o) => o.id === id || s.includes(o.id)).map((o) => o.id));
  const satir = (o: PaketOgesi) => {
    const h = hal(o);
    const tamam = tamamMi(h?.hal);
    const sec = s.includes(o.id);
    const destek = ogeDesteklenirMi(o, window.fuber?.platform);
    // Kancası bozuk Graphify: TEK hâl ("hata", ileti gecerliHal'den), TEK eylem ("Yeniden kur"); seçim kutusu ve "Yeniden dene" yok.
    const sorun = o.tur === 'graphify' && gSorun && h?.hal === 'hata' ? h.ileti ?? gSorun : null;
    // Satırdaki ileti yalnız nedenini söylemesi gerekende (kurulamadı / onaylamadın); öteki hâllerin adı haptadır.
    const neden = !sorun && h?.ileti && (h.hal === 'hata' || h.hal === 'reddedildi') ? h.ileti : '';
    return (
      <div key={o.id} className="ekl ekl--oge" data-ek-oge={o.id} data-hal={h?.hal ?? ''} data-sorun={sorun ? '' : undefined}>
        <span className="ekl__sol">
          {!tamam && !sorun && <button type="button" role="checkbox" aria-checked={sec} className="gp-kutu-dgm" onClick={() => degistir(o.id)} aria-label={`${o.ad} seç`}
            disabled={!destek && !sec} title={destek ? undefined : 'Şimdilik yalnız Windows’ta kurulur'}><SecimKutusu secili={sec} /></button>}
        </span>
        <div className="ekl__bas"><b>{o.ad}</b>{!tamam && <HalHapi o={h} ad={sorun ? 'Sorun var' : undefined} />}</div>
        <div className="ekl__yan">
          {tamam && <span className="gp-hal" data-hal="kurulu" data-kurulu-etiket=""><Ikon ad="tamam" olcu={12} />Kurulu</span>}
          {tamam && <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => yonet(o)} data-yonet=""
            aria-label={o.tur === 'graphify' ? `${o.ad}: Beceriler’de yönet` : `${o.ad}: Kurulu eklentiler’de yönet`} title={o.tur === 'graphify' ? 'Beceriler’de yönet' : 'Kurulu eklentiler’de yönet'}>Yönet</button>}
          {h?.hal === 'hata' && !sorun && <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void cagir('claudecode:eklenti-kur', { id: o.id })} data-yeniden-dene=""><Ikon ad="yenile" olcu={14} />Yeniden dene</button>}
          <AyrintiDugmesi acik={acik === o.id} degistir={() => setAcik(acik === o.id ? null : o.id)} />
        </div>
        <div className="ekl__metin">{o.kazanc}{neden ? <span className="ekl__neden" data-hata={h?.hal === 'hata' ? '' : undefined}>{neden}</span> : null}</div>
        {sorun && (
          <div className="ekl__sorun" role="alert" data-graphify-sorunu="">
            <i className="ekl__sorun-nokta" aria-hidden="true" /><span>{sorun}</span>
            <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void cagir('claudecode:eklenti-kur', { id: o.id })} data-graphify-onar=""><Ikon ad="yenile" olcu={14} />Yeniden kur</button>
          </div>
        )}
        {acik === o.id && <OgeAyrintisi o={o} />}
        {h?.hal === 'onay' && h.onay && (
          <OnayKarti ad={o.ad} onay={h.onay} ileti={h.ileti} yanitla={async (kabul) => { await cagir('claudecode:eklenti-onay', { id: o.id, sha256: h.onay!.sha256, kabul }); }} />
        )}
      </div>
    );
  };
  const birincil = !kurBirincil && yeni.length > 0;
  return (
    <>
      <div className="ek__bolum-bas">
        <div><b>Önerilen araçlar</b><span data-ek-baslik-sayi="">{!d ? 'Okunuyor…' : sayac.kurulacak ? `${sayac.kurulacak} kurulacak` : 'Hepsi hazır'}</span></div>
        {p?.calisiyor && <div className="ilerleme ek__ilerleme" aria-label="Kurulum ilerlemesi"><i style={{ width: `${Math.round((sayac.hazir / Math.max(1, sayac.onerilen)) * 100)}%` }} /></div>}
        {/* Kurulacak bir şey yoksa düğme hiç çizilmez (devre dışı ağır bir düğme kalmaz); kurulum sürerken "Kuruluyor…". */}
        {p?.calisiyor ? <button type="button" className="dgm dgm--koyu dgm--k" disabled data-secilenleri-kur=""><span className="donen" aria-hidden="true" />Kuruluyor…</button>
          : yeni.length > 0 && <button type="button" className={`dgm dgm--k ${birincil ? 'dgm--beyaz' : 'dgm--koyu'}`} onClick={kur} data-secilenleri-kur=""><Ikon ad="indir" olcu={14} />{yeni.length} aracı kur</button>}
      </div>
      <div className="ek__liste">
        <div className="ek__grup">Önerilen</div>
        <div className="ek-kume">{GELISTIRICI_PAKETI.filter((o) => o.varsayilan).map(satir)}</div>
        <div className="ek__grup">İsteğe bağlı</div>
        <div className="ek-kume">{GELISTIRICI_PAKETI.filter((o) => !o.varsayilan).map(satir)}</div>
      </div>
    </>
  );
}

// ── Kurulu eklentiler ───────────────────────────────────────────────────────────────────────────────────────────────────────
type IslemF = (o: { tur: string; id: string; islem: string; kapsam?: string }, sonra?: ListeTuru[]) => Promise<void>;

function BolumBasi({ baslik, aciklama, yenile, yukleniyor, ek }: { baslik: string; aciklama: string; yenile?: () => void; yukleniyor?: boolean; ek?: ReactNode }) {
  return (
    <div className="ek__bolum-bas">
      <div><b>{baslik}</b><span>{aciklama}</span></div>
      {ek}
      {yenile && <button type="button" className="dgm dgm--hayalet dgm--k" onClick={yenile} disabled={yukleniyor}>{yukleniyor ? <span className="donen" aria-hidden="true" /> : <Ikon ad="yenile" olcu={14} />}Yenile</button>}
    </div>
  );
}
const ClaudeYok = () => <Bos baslik="Claude Code kurulu değil">Üstteki “Claude Code’u kur” Anthropic’in resmi yükleyicisini görünür bir pencerede açar; kurulunca eklentiler burada listelenir.</Bos>;

function EklentiBolumu({ s, katalog, yukleniyor, kurulu, yenile, islem, hepsiniGuncelle, guncelleniyor, pakete, onaylar, onayla }: {
  s?: ListeSonucu<KuruluEklenti>; katalog: KatalogOgesi[] | null; yukleniyor: boolean; kurulu: boolean; yenile: () => void; islem: IslemF;
  hepsiniGuncelle: () => Promise<void>; guncelleniyor: boolean; pakete: () => void;
  onaylar: Record<string, KomutOnayi>; onayla: (id: string, o: KomutOnayi, kabul: boolean) => Promise<void>;
}) {
  const [acik, setAcik] = useState<string | null>(null);
  const l = s?.liste;
  return (
    <>
      <BolumBasi baslik="Kurulu eklentiler" aciklama="Değişiklikler yeni Claude Code oturumlarında geçerli olur." yenile={yenile} yukleniyor={yukleniyor}
        ek={<button type="button" className="dgm dgm--koyu dgm--k" disabled={!kurulu || !l?.length || guncelleniyor} onClick={() => void hepsiniGuncelle()} data-hepsini-guncelle="">
          {guncelleniyor ? <span className="donen" aria-hidden="true" /> : <Ikon ad="yenile" olcu={14} />}{guncelleniyor ? 'Güncelleniyor…' : 'Hepsini güncelle'}</button>} />
      <div className="ek__liste">
        {!kurulu ? <ClaudeYok /> : !l ? <Bos baslik={s?.hata ? 'Liste okunamadı' : 'Eklentiler okunuyor…'}>{s?.hata ?? 'Claude Code’a kurulu eklentiler soruluyor.'}</Bos>
          : !l.length ? <Bos baslik="Henüz eklenti yok" eylem={<button type="button" className="dgm dgm--koyu dgm--k" onClick={pakete}><Ikon ad="yildiz" olcu={14} />Önerilen araçları aç</button>}>Önerilen araçlar tek tıkla kurulur.</Bos>
            : <div className="ek-kume">{l.map((e) => {
              const ad = e.id.split('@')[0];
              const k = katalog?.find((x) => x.id === e.id);
              const yeni = yeniSurumVar(e.surum, k?.surum);
              return (
                <div key={e.id} className="ekl ekl--iki" data-ek-eklenti={e.id}>
                  <div className="ekl__bas"><b>{e.ad}</b>{!e.etkin && <span className="gp-hal" data-hal="bekliyor">Kapalı</span>}</div>
                  <div className="ekl__yan">
                    {yeni && <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void islem({ tur: 'eklenti', id: e.id, islem: 'guncelle', kapsam: e.kapsam }, ['eklenti'])} data-ek-guncelle="" title={`${e.surum} → ${k?.surum}`}><Ikon ad="yenile" olcu={14} />Güncelle</button>}
                    <Anahtar acik={e.etkin} etiket={`${e.ad} ${e.etkin ? 'açık' : 'kapalı'}`} degistir={(v) => void islem({ tur: 'eklenti', id: e.id, islem: v ? 'ac' : 'kapat', kapsam: e.kapsam }, ['eklenti', 'mcp'])} />
                    <SorDugmesi etiket="Kaldır" soru="Kaldırılsın mı?" yap={() => islem({ tur: 'eklenti', id: e.id, islem: 'kaldir', kapsam: e.kapsam }, ['eklenti', 'mcp'])} />
                    <AyrintiDugmesi acik={acik === e.id} degistir={() => setAcik(acik === e.id ? null : e.id)} />
                  </div>
                  <div className="ekl__metin">{e.aciklama || 'Açıklaması kataloğunda.'}</div>
                  {e.hatalar.length > 0 && <div className="ekl__sorun" role="alert"><i className="ekl__sorun-nokta" aria-hidden="true" /><span>{e.hatalar.join(' · ')}</span></div>}
                  {acik === e.id && (
                    <dl className="ekl__ayrinti" data-eklenti-ayrinti="">
                      <dt>Kimlik</dt><dd>{e.id}</dd>
                      {e.surum && <><dt>Sürüm</dt><dd>{e.surum}{yeni ? ` · katalogda ${k?.surum}` : ''}</dd></>}
                      <dt>Konum</dt><dd title={e.yol}>{ekYolu(e.yol ?? '~/.claude/plugins', ad)}</dd>
                      <dt>Nereye yazar</dt><dd>~/.claude/settings.json → enabledPlugins (Claude Code yazar)</dd>
                      {e.mcp.length > 0 && <><dt>MCP</dt><dd>{e.mcp.join(', ')} (eklentiyle gelir)</dd></>}
                    </dl>
                  )}
                  {onaylar[e.id] && <div className="ekl__tam"><OnayKarti ad={e.ad} onay={onaylar[e.id]} ileti="Güncelleme yeni bir komut çalıştıracak." yanitla={(kabul) => onayla(e.id, onaylar[e.id], kabul)} /></div>}
                </div>
              );
            })}</div>}
      </div>
    </>
  );
}

// ── Beceriler ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
function BeceriBolumu({ s, yukleniyor, yenile, islem }: { s?: ListeSonucu<Beceri>; yukleniyor: boolean; yenile: () => void; islem: IslemF }) {
  const l = s?.liste;
  return (
    <>
      <BolumBasi baslik="Beceriler" aciklama="~/.claude/skills klasöründeki beceriler. Kaldırılan klasör Geri Dönüşüm Kutusu’na taşınır." yenile={yenile} yukleniyor={yukleniyor} />
      <div className="ek__liste">
        {!l ? <Bos baslik="Beceriler okunuyor…">~/.claude/skills taranıyor.</Bos>
          : !l.length ? <Bos baslik="Kullanıcı becerisi yok">Eklentilerin becerileri eklentiyle gelir ve eklentiyle kalkar.</Bos>
            : <div className="ek-kume">{l.map((b) => (
              <div key={b.ad} className="ekl ekl--iki" data-ek-beceri={b.ad}>
                <div className="ekl__bas"><b title={ekYolu(b.yol)}>{b.ad}</b>{b.kaynak === 'graphify' && <span className="gp-hal">Graphify ile geldi</span>}</div>
                <div className="ekl__yan">
                  <SorDugmesi etiket="Kaldır" soru={b.kaynak === 'graphify' ? 'Graphify kaldırılsın mı?' : 'Çöpe taşınsın mı?'} yap={() => islem({ tur: b.kaynak === 'graphify' ? 'graphify' : 'beceri', id: b.ad, islem: 'kaldir' }, ['beceri'])} />
                </div>
                <div className="ekl__metin">{b.aciklama || 'SKILL.md’de açıklama yok.'}</div>
              </div>
            ))}</div>}
      </div>
    </>
  );
}

// ── MCP sunucuları ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const MCP_NOKTA: Record<McpSunucu['hal'], string> = { bagli: 'nokta--yesil', hata: 'nokta--kirmizi', bekliyor: 'nokta--turuncu', bilinmiyor: '' };
function McpBolumu({ s, yukleniyor, kurulu, yenile, islem }: { s?: ListeSonucu<McpSunucu>; yukleniyor: boolean; kurulu: boolean; yenile: () => void; islem: IslemF }) {
  const l = s?.liste;
  return (
    <>
      <BolumBasi baslik="MCP sunucuları" aciklama="Claude Code’un gördüğü sunucular; her biri bir kez denetlenir. Eklentiyle gelen sunucu eklentiyle kalkar." yenile={yenile} yukleniyor={yukleniyor} />
      <div className="ek__liste">
        {!kurulu ? <ClaudeYok /> : !l ? <Bos baslik={s?.hata ? 'Liste okunamadı' : 'Sunucular denetleniyor…'}>{s?.hata ?? 'Her sunucu kısa bir sağlık denetiminden geçer; birkaç saniye sürebilir.'}</Bos>
          : !l.length ? <Bos baslik="MCP sunucusu yok">Context7, Playwright ya da GitHub gibi eklentiler kendi sunucularını getirir.</Bos>
            : <div className="ek-kume">{l.map((m) => (
              <div key={m.ad} className="ekl ekl--iki" data-ek-mcp={m.ad}>
                {/* Ham hâl ("✓ Connected") ve iç ad ("plugin:playwright:playwright") yalnız ipucunda. */}
                <div className="ekl__bas"><b title={m.ad}>{mcpGorunenAd(m.ad)}</b><span className="ek-mcp-hal" data-mcp-hal={m.hal} title={m.durumMetni || undefined}><span className={`nokta ${MCP_NOKTA[m.hal]}`} />{mcpHalAdi(m.hal === 'bilinmiyor' ? m.durumMetni : m.hal)}</span></div>
                {(m.kaldirilabilir || m.kaynak === 'claude.ai') && (
                  <div className="ekl__yan">
                    {m.kaldirilabilir ? <SorDugmesi etiket="Kaldır" soru="Kaldırılsın mı?" yap={() => islem({ tur: 'mcp', id: m.ad, islem: 'kaldir' }, ['mcp'])} /> : <span className="gp-hal">claude.ai bağlayıcısı</span>}
                  </div>
                )}
                <div className="ekl__kimlik ekl__alt">{m.hedef}</div>
              </div>
            ))}</div>}
      </div>
    </>
  );
}

// ── Katalogda ara ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function KatalogBolumu({ s, bulunan, ara, setAra, yukleniyor, kurulu, yenile, kuruldu }: {
  s?: ListeSonucu<KatalogOgesi>; bulunan: KatalogOgesi[]; ara: string; setAra: (v: string) => void; yukleniyor: boolean; kurulu: boolean; yenile: () => void; kuruldu: () => void;
}) {
  const [sonuc, setSonuc] = useState<Record<string, IslemSonucu & { suruyor?: boolean }>>({});
  const [acik, setAcik] = useState<string | null>(null);
  const l = s?.liste;
  const kur = async (id: string) => {
    setSonuc((x) => ({ ...x, [id]: { tamam: false, suruyor: true } }));
    const r = await cagir<IslemSonucu>('claudecode:eklenti-kur', { id }).catch((e) => ({ tamam: false, hata: String(e) }) as IslemSonucu);
    setSonuc((x) => ({ ...x, [id]: r }));
    if (r.tamam) kuruldu();
  };
  const onayla = async (id: string, o: KomutOnayi, kabul: boolean) => {
    const r = await cagir<IslemSonucu>('claudecode:eklenti-onay', { id, sha256: o.sha256, kabul }).catch((e) => ({ tamam: false, hata: String(e) }) as IslemSonucu);
    setSonuc((x) => ({ ...x, [id]: kabul ? r : { tamam: false, ileti: 'Kurulmadı: kurulum komutunu onaylamadın.' } }));
    if (r.tamam && kabul) kuruldu();
  };
  return (
    <>
      {/* Ortak metin (nereye yazar, komut onayı) bölüm başında BİR KEZ (B-7); satırlarda yinelenmez. */}
      <BolumBasi baslik="Katalogda ara" aciklama="Claude Code eklentiyi ~/.claude/plugins klasörüne kurar; bir komut çalıştıracaksa önce sana gösterilir." yenile={kurulu ? yenile : undefined} yukleniyor={yukleniyor}
        ek={<label className="ek__ara"><Ikon ad="ara" olcu={15} /><input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Eklenti ara: ör. “lsp”, “sentry”, “test”" aria-label="Katalogda ara" /></label>} />
      <div className="ek__liste">
        {!kurulu ? <ClaudeYok /> : !l ? <Bos baslik={s?.hata ? 'Katalog okunamadı' : 'Katalog okunuyor…'}>{s?.hata ?? `Resmi katalog tanımlı değilse önce eklenir (${CC_KATALOG}).`}</Bos>
          : !bulunan.length ? <Bos baslik="Eşleşen eklenti yok">Başka bir sözcük dene; adı, açıklaması ve kimliği aranır.</Bos>
            : <div className="ek-kume">{bulunan.map((k) => {
              const r = sonuc[k.id];
              const kur_ = k.kurulu || r?.tamam;
              const resmi = k.katalog === CC_KATALOG;
              return (
                <div key={k.id} className="ekl ekl--iki" data-ek-katalog={k.id} data-resmi={resmi ? '' : undefined}>
                  <div className="ekl__bas"><b>{k.ad}</b>
                    {!resmi && <span className="gp-hal" data-hal="onay" data-resmi-degil="" title={`Bu eklenti Anthropic’in resmi kataloğundan değil, “${k.katalog || 'bilinmeyen'}” kataloğundan gelir; kaynağına güveniyorsan kur.`}><i className="gp-hal__nokta" aria-hidden="true" />Resmi olmayan katalog</span>}</div>
                  <div className="ekl__yan">
                    {kur_ ? <span className="gp-hal" data-hal="kurulu"><Ikon ad="tamam" olcu={12} />Kurulu</span>
                      : <button type="button" className="dgm dgm--koyu dgm--k" disabled={r?.suruyor} onClick={() => void kur(k.id)} data-katalog-kur="">{r?.suruyor ? <span className="donen" aria-hidden="true" /> : <Ikon ad="indir" olcu={14} />}Kur</button>}
                    <AyrintiDugmesi acik={acik === k.id} degistir={() => setAcik(acik === k.id ? null : k.id)} />
                  </div>
                  <div className="ekl__metin">{k.aciklama || 'Açıklama yok.'}{r?.hata ? <span className="ekl__neden" data-hata="">{r.hata}</span> : r?.ileti && !r.onay ? <span className="ekl__neden">{r.ileti}</span> : null}</div>
                  {acik === k.id && (
                    <dl className="ekl__ayrinti" data-katalog-ayrinti="">
                      <dt>Kimlik</dt><dd>{k.id}</dd>
                      {k.surum && <><dt>Sürüm</dt><dd>{k.surum}</dd></>}
                      {typeof k.kurulumSayisi === 'number' && <><dt>Kurulum</dt><dd>{k.kurulumSayisi.toLocaleString('tr-TR')}</dd></>}
                      <dt>Katalog</dt><dd>{k.katalog || 'bilinmiyor'}{resmi ? ' (Anthropic’in resmi kataloğu)' : ' (resmi olmayan katalog)'}</dd>
                      {k.kaynak && <><dt>Kaynak</dt><dd>{k.kaynak}</dd></>}
                    </dl>
                  )}
                  {r?.onay && <div className="ekl__tam"><OnayKarti ad={k.ad} onay={r.onay} ileti={r.ileti} yanitla={(kabul) => onayla(k.id, r.onay!, kabul)} /></div>}
                </div>
              );
            })}</div>}
      </div>
    </>
  );
}
