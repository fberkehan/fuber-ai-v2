// ── Bağlantılar: e-posta, WhatsApp, servisler (MCP kataloğu), Developer'ın MCP sunucuları, içe aktarma ──────────────────────────────
// 0.14 T16: "Servisler" bölümü her modda — Fuber Yönetim'in kataloğu (Gmail, Takvim, Notion…); kullanıcı tek tıkla bağlar (http: tarayıcıda izin;
// stdio, yalnız Developer: önce çalışacak komutun onay kartı — ürün kararı). Gizli ve "Yalnız bu bilgisayar"da kartlar önceki kopyadan görünür,
// bağlanılmaz (BULUT_KAPALI_METNI.mcp; mutlak gizlilik sözü yok). Developer'ın kendi "MCP sunucuları" bölümü yalnız Developer mode'da.
// 0.14 T24: çapalar (ana:git 'baglantilar#<id>' → location.hash): 'eposta', 'whatsapp', 'servisler' ve katalog kartı 'servis-<id>' — çentiğin Gündem ve
// Gelenler sayfalarındaki "Bağla" boş durumu düzelten yeri açar. Bölüm sonradan yüklenirse (ayarlar, katalog) çapaya yüklenince kaydırılır.
// 0.14 T31 (Nusa dili): kök ekranın TEK vurgusunu taşır (vurguStili('baglantilar'), yeşil; anahtarlar ve bağlı servisin simge zemini). Bölümler
// ortak Kart (başlık solda, tek eylem sağda). Ürün kararı: Fuber üründür, bağlantılar sessiz araçlardır — servis satırı yalnız simge, ad, TEK kısa
// satır ve durum (Bağlı / Bağla); tanıtım paragrafı, ortaklık kartı ve marka logosu yok. "İnternet araması" Fuber'in kendi aracıdır: durum
// satırı (seçenek değil); Gizli ve "Yalnız bu bilgisayar"da BULUT_KAPALI_METNI.web. Kaydırılan içerik pencerenin başlık şeridinin altına girmez.
// Davranış T15/T16'daki gibi (Bağla, Yeniden bağla, Vazgeç, stdio onay kartı, MCP sunucuları); yalnız görünüm değişti.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cagir, dinle, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { EpostaFormu, useWhatsappDurumu, type WhatsappArayuzDurumu } from '../bilesenler/Formlar';
import { Secici, type SeciciSecenegi } from '../bilesenler/Secici';
import { Satir, Dugme, Rozet, Bos, Kart, vurguStili } from '../ui';
import type { Ayarlar, McpSunucu } from '../../shared/tipler';
import type { CcAyari } from '../../shared/cc-ayar';
import { KIP_ADI } from '../../shared/karakterler';
import { CHROME_EKLENTI_ADRESI, type ChromeBilgisi } from '../../shared/chrome-baglanti';
import { sinamaMetni } from '../../shared/eposta-formu';
import { komutAyristir, komutSatiri } from '../../shared/komut-satiri';
import { BULUT_KAPALI_METNI, bulutYasak } from '../../shared/bulut-kapisi';
import { KATALOG_BOS_METNI, KATALOG_YOL_METNI, MCP_SIR_OKUNAMADI_METNI, type McpKatalogGorunumu, type McpKatalogKarti } from '../../shared/mcp-baglanti';
import { silmeler, useSilmeler } from '../geri-al';
import { klasorAdi } from '../../shared/gorunen-metin';
import './baglantilar.css';

/** Çapaya kaydırma (0.14 T24): main.tsx 'ana:git' hash'i yazar ve aynı karede kaydırır; bölüm o anda henüz yoksa (veri yükleniyor) yüklenince burada. */
function useCipayaKaydir(hazir: boolean): void {
  useEffect(() => {
    if (!hazir) return;
    // Düzeltme turu 1: kaydırınca çapa temizlenir (history.replaceState; hashchange doğmaz) — sonraki Bağlantılar açılışı aynı bölüme kaymaz.
    const kaydir = () => {
      const id = location.hash.slice(1);
      const el = id ? document.getElementById(id) : null;
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      history.replaceState(history.state, '', location.pathname + location.search);
    };
    kaydir();
    addEventListener('hashchange', kaydir);
    return () => removeEventListener('hashchange', kaydir);
  }, [hazir]);
}

const MCP_TURLERI: SeciciSecenegi<'stdio' | 'http'>[] = [
  { deger: 'stdio', etiket: 'Komut (stdio)', aciklama: 'Bu bilgisayarda bir komut çalıştırır' },
  { deger: 'http', etiket: 'HTTP adresi', aciklama: 'Uzaktaki bir MCP sunucusuna bağlanır' },
];

export function Baglantilar() {
  const [ayar, setAyar] = useState<Ayarlar | null>(null);
  const [epostaAcik, setEpostaAcik] = useState(false);
  const [ice, setIce] = useState<{ klasor: string; bekleyen: number; islenen: number; hata: number; ozetsiz?: number; son: { ad: string; durum: string; zaman: string }[] } | null>(null);
  const yenile = () => void cagir<Ayarlar>('ayarlar:al').then(setAyar);
  const iceYenile = () => void cagir<typeof ice>('iceaktar:durum').then(setIce);
  useEffect(() => { yenile(); iceYenile(); const k = [dinle('iceaktar:islendi', iceYenile), dinle('iceaktar:ozetsiz', iceYenile), dinle('ayarlar:degisti', (a: Ayarlar) => setAyar(a))]; return () => k.forEach((f) => f()); }, []);
  const [sinama, setSinama] = useState<Record<string, { metin: string; tamam?: boolean }>>({});
  const { gizli } = useSilmeler();
  useCipayaKaydir(Boolean(ayar));
  const epostaSina = async (id: string) => {
    setSinama((x) => ({ ...x, [id]: { metin: 'sınanıyor…' } }));
    const r = await cagir<{ imap: boolean; smtp: boolean; hata?: string }>('eposta:sina', id).catch((e: Error) => ({ imap: false, smtp: false, hata: e.message }));
    setSinama((x) => ({ ...x, [id]: sinamaMetni(r) }));
  };
  if (!ayar) return null;
  const gelistirici = ayar.mod === 'gelistirici';

  return (
    <div className="baglantilar" data-vurgu="baglantilar" style={vurguStili('baglantilar') as CSSProperties}>
      <div className="sayfa baglantilar__sayfa">
        <header className="baglantilar__bas"><h1 className="baglantilar__baslik">Bağlantılar</h1><p className="t-giris">Fuber’in eriştiği hesaplar.</p></header>

        {/* 0.13 T15: yapay zekâ motoru anahtar kartları kalktı — kimse API anahtarı girmez; yapay zekâ Fuber hesabıyla ya da bu bilgisayardaki modelle gelir. */}
        {/* Düzeltme turu 1 (I1): E-posta, WhatsApp servisler gibi tek kartta, satır satır — simge, ad, tek satır, durum, sessiz eylem. */}
        <Kart baslik="Hesaplar ve cihazlar" data-bolum="hesaplar">
          <div className="baglantilar__liste">
            <EpostaSatirlari
              hesaplar={ayar.eposta.filter((e) => !gizli(`eposta:${e.id}`))} acik={epostaAcik} ac={() => setEpostaAcik((x) => !x)}
              sinama={sinama} sina={(id) => void epostaSina(id)} bitti={() => { yenile(); setEpostaAcik(false); }}
            />
            <WhatsappSatiri />
          </div>
        </Kart>

        <KatalogBolumu gelistirici={gelistirici} yerelKapali={bulutYasak({ gizliMod: ayar.yerel.gizliMod === true, yalnizYerel: ayar.yerel.yalnizYerel === true })} />

        {gelistirici && <McpBolumu ayar={ayar} yenile={yenile} />}

        <Kart baslik="Öğretme klasörü" data-bolum="ogretme">
          {/* İş modunda (Ruling O) geliştirici aracının kayıt biçimi (Claude Code, .jsonl) sayılmaz. */}
          <p className="baglantilar__metin">Bu klasöre bıraktığın her şeyi okur, özetler ve hafızama işlerim: ChatGPT/Claude dışa aktarımları, {gelistirici ? 'Claude Code sohbet kayıtları (.jsonl), ' : ''}PDF, Word, e-posta, metin.</p>
          <div className="baglantilar__klasor">
            {/* 11 Kas (tasarımcı bulgu 7): tam Windows yolu (eş aralıklı) yerine klasörün adı; "Klasörü aç" yolu açar. */}
            <span className="baglantilar__yol" data-ogretme-klasoru=""><Ikon ad="klasor" olcu={14} />{klasorAdi(ice?.klasor)}</span>
            <Dugme tur="ikincil" boyut="k" simge="klasor" onClick={() => void cagir('iceaktar:klasor-ac')}>Klasörü aç</Dugme>
            <Dugme tur="ikincil" boyut="k" simge="ice" onClick={() => void cagir('iceaktar:dosya-sec').then(iceYenile)}>Dosya seç</Dugme>
          </div>
          {ice && <p className="baglantilar__sayac">{ice.islenen} işlendi · {ice.bekleyen} bekliyor{ice.ozetsiz ? ` · ${ice.ozetsiz} özet sonra` : ''}{ice.hata ? ` · ${ice.hata} hata` : ''}</p>}
          {!!ice?.son.length && (
            <div className="baglantilar__son">
              {ice.son.map((x, i) => (
                <Satir key={i} sol={<span className={`nokta ${x.durum === 'islendi' ? 'nokta--yesil' : x.durum === 'hata' ? 'nokta--kirmizi' : x.durum === 'ozetsiz' ? '' : 'nokta--turuncu'}`} />} baslik={x.ad} sag={<span className="baglantilar__zaman">{zamanGoreli(x.zaman)}</span>} />
              ))}
            </div>
          )}
        </Kart>
      </div>
    </div>
  );
}

type EpostaHesabi = Ayarlar['eposta'][number];
// 11 Kas (tasarımcı bulgu 20): Servisler'deki Gmail satırıyla aynı cümleyi söylüyordu; bu satır adres + parolayla bağlanan her hesap.
const EPOSTA_METNI = 'Adres ve parolayla bağlanan her hesap: önemlileri söyler; gönderim her seferinde onay ister.';

/** E-posta (düzeltme turu 1, I1): servis satırı gibi — simge, ad, tek satır, durum, sessiz eylem ("Bağla" / "Hesap ekle"). Altında kayıtlı hesaplar
 *  (Sına, Kaldır) ve açıldığında form. "Kaldır" 5 sn "Geri al" penceresinden sonra uygulanır (Görev 20b, K2): hesap ve parolası birlikte silinir. */
function EpostaSatirlari({ hesaplar, acik, ac, sinama, sina, bitti }: {
  hesaplar: EpostaHesabi[]; acik: boolean; ac: () => void; sinama: Record<string, { metin: string; tamam?: boolean }>; sina: (id: string) => void; bitti: () => void;
}) {
  const parolali = hesaplar.some((e) => e.parolaVar);
  const durum = !hesaplar.length ? null : parolali ? <Rozet ton="iyi">Bağlı</Rozet> : <Rozet ton="uyari">Parola yok</Rozet>;
  return (
    <div className="baglanti-grup" id="eposta" data-bolum="eposta">
      <div className="baglanti-satir">
        <Satir
          sol={<span className="servis__simge" data-acik={parolali ? '' : undefined}><Ikon ad="posta" olcu={16} /></span>} baslik="E-posta"
          alt={hesaplar.length ? `${hesaplar.length} hesap · önemlileri söyler; gönderim her seferinde onay ister.` : EPOSTA_METNI} altSatir={1}
          sag={<span className="baglanti-satir__eylem">{durum}<Dugme tur={hesaplar.length ? 'hayalet' : 'ikincil'} boyut="k" data-eposta-ekle="" onClick={ac}>{acik ? 'Vazgeç' : hesaplar.length ? 'Hesap ekle' : 'Bağla'}</Dugme></span>}
        />
      </div>
      {hesaplar.map((e) => (
        <div key={e.id} className="baglanti-satir baglanti-satir--ic" data-eposta-hesap={e.id}>
          <Satir
            sol={<span className={`nokta ${e.parolaVar ? 'nokta--yesil' : 'nokta--kirmizi'}`} />} baslik={`${e.ad} · ${e.adres}`} alt={`${e.imapSunucu}:${e.imapPort} · ${e.smtpSunucu}:${e.smtpPort}`}
            sag={(
              <span className="baglanti-satir__eylem">
                <Dugme tur="hayalet" boyut="k" disabled={sinama[e.id]?.tamam === undefined && Boolean(sinama[e.id])} onClick={() => sina(e.id)}>Sına</Dugme>
                <Dugme tur="hayalet" boyut="k" onClick={() => silmeler.ertele({ tur: 'eposta', id: e.id }, `${e.adres} kaldırıldı`, `${e.adres} kaldırılamadı`)}>Kaldır</Dugme>
              </span>
            )}
          />
          {/* Sınama sonucu satırın içinde (eskiden ham JSON'la tarayıcı uyarısıydı). */}
          {sinama[e.id] && <p className="baglanti-satir__not" data-eposta-sinama={e.id} data-ton={sinama[e.id].tamam === undefined ? undefined : sinama[e.id].tamam ? 'iyi' : 'hata'}>{sinama[e.id].metin}</p>}
        </div>
      ))}
      {acik && <div className="baglanti-ic"><EpostaFormu birincil={false} bitti={bitti} /></div>}
    </div>
  );
}

const WHATSAPP_METNI = 'Mesajlarını bu bilgisayarda okur, önemlileri söyler; gönderim her seferinde onay ister.';

/** WhatsApp (düzeltme turu 1, I1): servis satırı — WhatsApp simgesi nötr kutuda sönük, eylem sessiz "Bağla" (paylaşılan büyük beyaz
 *  WhatsappBaglan düğmesi burada yok). Davranış WhatsappBaglan'la aynı IPC: whatsapp:durum / whatsapp:baslat / whatsapp:cikis; QR satırın altında,
 *  "Vazgeç" ile okutmadan çıkılır ve geç dönen "başlat" yanıtı arada basılan Vazgeç'i ezmez (nesil sayacı, Görev 20b G19). */
function WhatsappSatiri() {
  // WhatsApp yalnız modül + İş modu + WhatsApp hakkı varken (ana sürecin kararı: `izinli`); değilse satır yok.
  const [d, setD] = useWhatsappDurumu();
  const nesil = useRef(0);
  const baslat = () => { const n = nesil.current; void cagir<WhatsappArayuzDurumu>('whatsapp:baslat').then((x) => { if (n === nesil.current) setD(x); }); };
  const vazgec = () => { nesil.current++; void cagir('whatsapp:cikis'); };
  const qr = d.durum === 'qr' && d.qr ? d.qr : null;
  const alt = d.durum === 'bagli' ? `+${d.numara ?? ''} · mesajların bu bilgisayarda saklanır.`
    : d.durum === 'hata' ? 'Bağlantı kurulamadı, tekrar dene.'
      : qr ? 'Telefonundaki WhatsApp ile aşağıdaki kodu okut.' : WHATSAPP_METNI;
  const sag = d.durum === 'bagli'
    ? <span className="baglanti-satir__eylem"><Rozet ton="iyi">Bağlı</Rozet><Dugme tur="hayalet" boyut="k" onClick={() => void cagir('whatsapp:cikis')}>Bağlantıyı kes</Dugme></span>
    : qr ? <Dugme tur="hayalet" boyut="k" onClick={vazgec}>Vazgeç</Dugme>
      : d.durum === 'baglaniyor'
        ? <span className="baglanti-satir__eylem"><Rozet ton="bilgi">Bağlanıyor…</Rozet><Dugme tur="hayalet" boyut="k" onClick={vazgec}>Vazgeç</Dugme></span>
        : <span className="baglanti-satir__eylem">{d.durum === 'hata' && <Rozet ton="hata">Bağlanamadı</Rozet>}<Dugme tur="ikincil" boyut="k" onClick={baslat}>Bağla</Dugme></span>;
  if (!d.izinli) return null;
  return (
    <div className="baglanti-grup" id="whatsapp" data-bolum="whatsapp">
      <div className="baglanti-satir">
        <Satir sol={<span className="servis__simge" data-acik={d.durum === 'bagli' ? '' : undefined}><Ikon ad="wp" olcu={16} /></span>} baslik="WhatsApp" alt={alt} altSatir={1} sag={sag} />
      </div>
      {/* Okutmadan vazgeçilebilsin: yoksa WhatsApp "açık" kalıyor, kod yenilenip duruyor ve her açılışta yeniden bağlanmaya çalışıyordu. */}
      {qr && (
        <div className="baglanti-ic baglanti-qr">
          <img className="qr" src={qr} alt="WhatsApp QR" />
          <p className="baglantilar__not">Telefonunda WhatsApp → <b>Ayarlar → Bağlı cihazlar → Cihaz bağla</b> ve bu kodu okut.</p>
        </div>
      )}
    </div>
  );
}

/** Katalog simgesi → uygulamanın simgesi (marka logosu yok; düz simge). */
const SIMGE: Record<string, string> = { gmail: 'posta', takvim: 'saat', drive: 'klasor', microsoft: 'panel', slack: 'sohbet', notion: 'dosya', github: 'dal', genel: 'baglanti' };
type BaglaSonucu = { tamam: boolean; hata?: string; iptal?: boolean; onay?: { ad: string; komut: string; parcalar: string[]; ozet: string } };
/** IPC hatası "Error invoking remote method …: Error: <cümle>" → cümle. */
const ipcHatasi = (e: unknown) => String((e as Error)?.message ?? e).replace(/^[\s\S]*?Error: /, '');

/** Servisler (0.14 T16): Fuber kataloğunun servisleri, her modda. Kart: simge, ad, açıklama; "Bağla" / "Bağlı · Bağlantıyı kes" / "Yeniden bağla". */
function KatalogBolumu({ yerelKapali, gelistirici }: { yerelKapali: boolean; gelistirici: boolean }) {
  const [g, setG] = useState<McpKatalogGorunumu | null>(null);
  // Düzeltme turu 1: bağlanan kartlar ayrı ayrı (öbür kartların düğmeleri kilitlenmez); süren bağlanma "Vazgeç" ile iptal edilir (mcp:kes).
  const [suren, setSuren] = useState<ReadonlySet<string>>(new Set());
  const [hata, setHata] = useState<Record<string, string>>({});
  const [onay, setOnay] = useState<({ id: string } & NonNullable<BaglaSonucu['onay']>) | null>(null);
  const yenile = () => void cagir<McpKatalogGorunumu>('mcp:katalog').then(setG).catch(() => undefined);
  useEffect(() => { yenile(); const k = [dinle('ayarlar:degisti', yenile)]; return () => k.forEach((f) => f()); }, []);
  const surenDegis = (id: string, var_: boolean) => setSuren((s) => { const y = new Set(s); if (var_) y.add(id); else y.delete(id); return y; });
  const bagla = async (id: string, o?: { komutOzeti: string }) => {
    surenDegis(id, true);
    setHata(({ [id]: _eski, ...x }) => x);
    const r = await cagir<BaglaSonucu>('mcp:bagla', id, o).catch((e: unknown): BaglaSonucu => ({ tamam: false, hata: ipcHatasi(e) }));
    surenDegis(id, false);
    // stdio: komut başlamadan önce kart (ürün kararı); onay kartın özetiyle geri döner.
    if (r.onay) setOnay({ id, ...r.onay });
    else { setOnay((x) => (x?.id === id ? null : x)); if (!r.tamam && !r.iptal) setHata((x) => ({ ...x, [id]: r.hata ?? 'Bağlanılamadı; yeniden dene.' })); }
    yenile();
  };
  const kes = async (id: string) => { await cagir('mcp:kes', id).catch(() => undefined); yenile(); };
  useCipayaKaydir(Boolean(g));
  // M4: katalog görünümü gelmeden (ya da IPC düşünce) İnternet araması satırı yine görünür; durum ayarlardaki aynı kapıdan (bulutYasak).
  const bulutKapali = g?.bulutKapali ?? yerelKapali;
  if (!g) return <Kart baslik="Servisler" id="servisler" data-bolum="servisler"><div className="baglantilar__liste"><WebSatiri kapali={bulutKapali} /><TarayiciSatiri /><ChromeSatiri gelistirici={gelistirici} /></div></Kart>;
  const sag = (k: McpKatalogKarti) => {
    if (k.durum === 'bagli') return <span className="baglanti-satir__eylem"><Rozet ton="iyi">Bağlı</Rozet><Dugme tur="hayalet" boyut="k" onClick={() => void kes(k.id)}>{'Bağlantıyı kes'}</Dugme></span>;
    if (suren.has(k.id)) {
      return (
        <span className="baglanti-satir__eylem">
          <Rozet ton="bilgi">Bağlanıyor…</Rozet>
          <Dugme tur="hayalet" boyut="k" onClick={() => void kes(k.id)}>Vazgeç</Dugme>
        </span>
      );
    }
    const etiket = k.durum === 'yenilenmeli' ? 'Yeniden bağla' : 'Bağla';
    return (
      <span className="baglanti-satir__eylem">
        {k.durum === 'yenilenmeli' && <Rozet ton="uyari">Yenilenmeli</Rozet>}
        <Dugme tur="ikincil" boyut="k" disabled={g.bulutKapali} title={g.bulutKapali ? BULUT_KAPALI_METNI.mcp : undefined} onClick={() => void bagla(k.id)}>{etiket}</Dugme>
      </span>
    );
  };
  // Tek kısa satır (ürün kararı): servisin ne yaptırdığı; bağlanırken ne yapılacağı. Hata satırın altında, tam metniyle.
  const alt = (k: McpKatalogKarti) => (suren.has(k.id) && k.tur === 'http' ? 'Tarayıcında açılan sayfadan izin ver.' : k.aciklama);
  return (
    <Kart baslik="Servisler" id="servisler" data-bolum="servisler">
      {g.bulutKapali
        ? <p className="baglantilar__not" data-mcp-bulut-kapali="">{BULUT_KAPALI_METNI.mcp}</p>
        : g.kartlar.length > 0 && <p className="baglantilar__not">Bağladığın serviste Fuber senin için okur; bir şey yazmadan ya da göndermeden önce sorar.</p>}
      <div className="baglantilar__liste">
        <WebSatiri kapali={bulutKapali} />
        <TarayiciSatiri />
        <ChromeSatiri gelistirici={gelistirici} />
        {/* 11 Kas (tasarımcı bulgu 9): boş katalog açık kaynak kullanıcısına neyin nereden geldiğini söyler (Gündem'in "Bağla"sı buraya açar). */}
        {!g.kartlar.length && <Bos baslik={KATALOG_BOS_METNI} metin={gelistirici ? `${KATALOG_YOL_METNI} Kendi sunucunu aşağıdaki MCP sunucuları bölümünden de ekleyebilirsin.` : KATALOG_YOL_METNI} />}
        {g.kartlar.map((k) => (
          <div key={k.id} className="baglanti-satir" id={`servis-${k.id}`} data-mcp-kart={k.id} data-mcp-durum={k.durum}>
            <Satir sol={<span className="servis__simge"><Ikon ad={SIMGE[k.simge] ?? 'baglanti'} olcu={16} /></span>} baslik={k.ad} alt={alt(k)} altSatir={1} sag={sag(k)} />
            {hata[k.id] && <p className="baglanti-satir__not" data-ton="hata" role="alert">{hata[k.id]}</p>}
            {onay?.id === k.id && (
              <div className="baglanti-onay" data-mcp-onay={k.id}>
                <p className="baglantilar__not">{onay.ad} bu bilgisayarda şu komutu çalıştıracak:</p>
                <code className="baglantilar__kod">{onay.komut}</code>
                <div className="baglanti-onay__dugmeler">
                  <Dugme tur="hayalet" boyut="k" onClick={() => setOnay(null)}>Vazgeç</Dugme>
                  <Dugme tur="ikincil" boyut="k" onClick={() => void bagla(onay.id, { komutOzeti: onay.ozet })}>Çalıştır ve bağla</Dugme>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Kart>
  );
}

/** "İnternet araması" (R5: Fuber'in kendi aracı, modelden bağımsız): seçenek değil durum satırı. Kapalıyken yalnız neyin kapalı olduğu söylenir. */
const WEB_ACIK_METNI = 'Fuber gerektiğinde internette arar ve sayfaları okur.';
function WebSatiri({ kapali }: { kapali: boolean }) {
  return (
    <div className="baglanti-satir" data-web-satiri={kapali ? 'kapali' : 'acik'}>
      <Satir
        sol={<span className="servis__simge" data-acik={kapali ? undefined : ''}><Ikon ad="kure" olcu={16} /></span>} baslik="İnternet araması"
        alt={kapali ? BULUT_KAPALI_METNI.web : WEB_ACIK_METNI} altSatir={2} sag={<Rozet ton={kapali ? 'notr' : 'iyi'}>{kapali ? 'Kapalı' : 'Açık'}</Rozet>}
      />
    </div>
  );
}

/** Analiz 11 Kas bulgu 14 (dürüst satır): Fuber Tarayıcı ayrı bir profille çalışır — kullanıcının Chrome girişleri, parolaları ve eklentileri orada yok.
 *  Kullanıcının kendi Chrome'u için aşağıdaki "Kendi Chrome’um" satırı (ChromeSatiri) var; Fuber'in kendi eklentisi sonra (docs/chrome-eklentisi.md). */
export const TARAYICI_PROFIL_METNI = 'Fuber Tarayıcı kendi profilini kullanır: Chrome’daki girişlerin, parolaların ve eklentilerin orada yok.';
function TarayiciSatiri() {
  return (
    <div className="baglanti-satir" data-tarayici-satiri="">
      <Satir sol={<span className="servis__simge"><Ikon ad="kure" olcu={16} /></span>} baslik="Fuber Tarayıcı" alt={TARAYICI_PROFIL_METNI} altSatir={2} sag={<Rozet ton="notr">Ayrı profil</Rozet>} />
    </div>
  );
}

/** 13 Kas ("Cowork çalışmıyor"): kullanıcının KENDİ Chrome'u (girişleri, eklentileri). Gerçek yol Anthropic'in Claude eklentisi + Claude Code'un `--chrome`'u.
 *  Satır durumu dürüst söyler (Chrome yok / eklenti yok / hazır) ve adım adım yolu verir; anahtar yalnız Claude Code oturumlarını etkiler. */
export function ChromeSatiri({ gelistirici }: { gelistirici: boolean }) {
  const [b, setB] = useState<ChromeBilgisi | null>(null);
  const [cc, setCc] = useState<CcAyari | null>(null);
  const yukle = () => {
    void cagir<ChromeBilgisi>('chrome:durum').then(setB).catch(() => undefined);
    void cagir<{ ayar: CcAyari }>('claudecode:durum').then((d) => setCc(d.ayar)).catch(() => undefined);
  };
  useEffect(() => { yukle(); const k = dinle('ayarlar:degisti', yukle); return k; }, []);
  const anahtar = async (v: boolean) => { if (!cc) return; setCc({ ...cc, chrome: v }); await cagir('ayarlar:kaydet', { claudeCode: { ...cc, chrome: v } }).catch(() => undefined); };
  const hazir = b?.durum === 'hazir';
  const rozet = !b ? <Rozet ton="bilgi">Denetleniyor…</Rozet> : hazir ? <Rozet ton="iyi">Hazır</Rozet> : <Rozet ton="uyari">{b.durum === 'chrome-yok' ? 'Chrome yok' : 'Eklenti yok'}</Rozet>;
  return (
    <div className="baglanti-satir" data-chrome-satiri="" data-chrome-durum={b?.durum ?? 'bekliyor'}>
      <Satir
        sol={<span className="servis__simge" data-acik={hazir ? '' : undefined}><Ikon ad="kure" olcu={16} /></span>} baslik="Kendi Chrome’um"
        alt={b ? b.ozet : 'Chrome’daki Claude eklentisi denetleniyor.'} altSatir={2}
        sag={(
          <span className="baglanti-satir__eylem">
            {rozet}
            {b && !hazir && b.durum === 'eklenti-yok' && <Dugme tur="ikincil" boyut="k" onClick={() => void cagir('sistem:ac', CHROME_EKLENTI_ADRESI)}>Eklentiyi aç</Dugme>}
            {gelistirici && hazir && cc && <Anahtar acik={cc.chrome} degistir={(v) => void anahtar(v)} etiket="Claude Code oturumları Chrome’umu kullansın" />}
          </span>
        )}
      />
      {b && (
        <ol className="baglantilar__not" data-chrome-adimlar="">
          {b.adimlar.map((a) => <li key={a}>{a}</li>)}
        </ol>
      )}
      {b && !gelistirici && <p className="baglantilar__not">{`Chrome’da iş yapma şimdilik Claude Code oturumlarında (${KIP_ADI.gelistirici}) çalışır; ${KIP_ADI.is}’da sohbet yalnız Fuber Tarayıcı’yı kullanır.`}</p>}
    </div>
  );
}

function McpBolumu({ ayar, yenile }: { ayar: Ayarlar; yenile: () => void }) {
  const [yeni, setYeni] = useState<Partial<McpSunucu> | null>(null);
  // Komut satırı olduğu gibi tutulur, kaydederken ayrıştırılır (eskiden her tuşta bölünüyordu: boşluk yazılamıyordu).
  const [komutMetni, setKomutMetni] = useState('');
  const [aday, setAday] = useState<Omit<McpSunucu, 'id'>[] | null>(null);
  const [sinama, setSinama] = useState<Record<string, string>>({});

  // 0.14 T16: satır sonu ya da denetim karakteri taşıyan komut kaydedilmez — ana sürecin cümlesi formun altında.
  const [kayitHatasi, setKayitHatasi] = useState<string | null>(null);
  const kaydet = async (s: Partial<McpSunucu>) => {
    try { await cagir('mcp:kaydet', { etkin: true, her: false, tur: 'stdio', argumanlar: [], ...s }); } catch (e) { setKayitHatasi(ipcHatasi(e)); return; }
    setKayitHatasi(null); setYeni(null); yenile();
  };
  const formuKaydet = (y: Partial<McpSunucu>) => {
    if (y.tur === 'http') return kaydet({ ...y, ad: y.ad?.trim(), url: y.url?.trim(), komut: undefined, argumanlar: [] });
    const [komut, ...argumanlar] = komutAyristir(komutMetni);
    return kaydet({ ...y, ad: y.ad?.trim(), komut, argumanlar });
  };
  const formHazir = Boolean(yeni?.ad?.trim() && (yeni.tur === 'http' ? yeni.url?.trim() : komutAyristir(komutMetni).length));
  const sina = async (id: string) => {
    setSinama((x) => ({ ...x, [id]: 'sınanıyor…' }));
    const r = await cagir<{ tamam: boolean; araclar?: string[]; hata?: string }>('mcp:sina', id);
    setSinama((x) => ({ ...x, [id]: r.tamam ? `✓ ${r.araclar?.length} araç` : `✕ ${r.hata}` }));
  };

  return (
    <Kart
      baslik="MCP sunucuları" id="mcp" data-bolum="mcp"
      eylem={(
        <span className="baglanti-satir__eylem">
          <Dugme tur="hayalet" boyut="k" onClick={() => void cagir<Omit<McpSunucu, 'id'>[]>('mcp:claude-code').then(setAday)}>Claude Code'dan içe aktar</Dugme>
          <Dugme tur="ikincil" boyut="k" simge="arti" onClick={() => { setYeni({ tur: 'stdio', ad: '', aciklama: '' }); setKomutMetni(''); }}>Ekle</Dugme>
        </span>
      )}
    >
        <p className="baglantilar__not">Her sohbete hepsi eklenmez (token): “her sohbete” açık olanlar ve konuyla ilgili olanlar bağlanır; gerekince Fuber kendisi açar.</p>
        {ayar.mcp.map((s) => (
          <div key={s.id} className="mcp-satir" data-mcp-sunucu={s.id}>
            <Anahtar acik={s.etkin} etiket={`${s.ad} etkin`} degistir={(v) => void kaydet({ ...s, etkin: v })} />
            <span className="mcp-satir__ana">
              <span className="mcp-satir__baslik">{s.ad} <span className="mcp-satir__adres">· {s.tur === 'http' ? s.url : komutSatiri(s.komut, s.argumanlar)}</span></span>
              <span className="mcp-satir__alt">{s.aciklama} {sinama[s.id] ? `· ${sinama[s.id]}` : ''}</span>
              {s.sirOkunamadi && <span className="baglanti-satir__not" data-ton="hata" role="alert" data-mcp-sir-okunamadi="">{MCP_SIR_OKUNAMADI_METNI}</span>}
            </span>
            <span className="baglanti-satir__eylem">
              <span className="mcp-satir__her"><span>her sohbete</span><Anahtar acik={Boolean(s.her)} etiket={`${s.ad}: her sohbete bağla`} degistir={(v) => void kaydet({ ...s, her: v })} /></span>
              <Dugme tur="hayalet" boyut="k" onClick={() => void sina(s.id)}>Sına</Dugme>
              <Dugme tur="hayalet" boyut="k" onClick={() => void cagir('mcp:sil', s.id).then(yenile)}>Sil</Dugme>
            </span>
          </div>
        ))}
        {!ayar.mcp.length && !yeni && <p className="baglantilar__bos">Kayıtlı MCP sunucusu yok.</p>}
        {aday && (
          <div className="baglantilar__aday">
            <p className="baglantilar__not">Claude Code'da bulunanlar ({aday.length}) — eklemek istediklerine tıkla:</p>
            {aday.map((a) => <Satir key={a.ad} baslik={a.ad} alt={a.tur === 'http' ? a.url : komutSatiri(a.komut, a.argumanlar)} sag={<Ikon ad="arti" olcu={14} />} tikla={() => void kaydet({ ...a, etkin: true }).then(() => setAday((x) => x?.filter((y) => y.ad !== a.ad) ?? null))} />)}
            {!aday.length && <p className="baglantilar__bos">~/.claude.json içinde MCP tanımı bulunamadı.</p>}
          </div>
        )}
        {yeni && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="ikili">
              <label className="alan"><span>Ad</span><input className="girdi" value={yeni.ad ?? ''} onChange={(e) => setYeni({ ...yeni, ad: e.target.value })} /></label>
              <div className="alan"><span>Tür</span><Secici etiket="MCP sunucu türü" genislik="100%" deger={yeni.tur ?? 'stdio'} secenekler={MCP_TURLERI} degistir={(v) => setYeni({ ...yeni, tur: v })} /></div>
            </div>
            <label className="alan"><span>Ne işe yarar? (Fuber hangi konuda bağlanacağını buradan anlar)</span><input className="girdi" value={yeni.aciklama ?? ''} onChange={(e) => setYeni({ ...yeni, aciklama: e.target.value })} /></label>
            {yeni.tur === 'http'
              ? <label className="alan"><span>Adres</span><input className="girdi" value={yeni.url ?? ''} onChange={(e) => setYeni({ ...yeni, url: e.target.value })} placeholder="https://…/mcp" /></label>
              : <label className="alan"><span>Komut (boşluklu yolu çift tırnağa al)</span><input className="girdi" value={komutMetni} onChange={(e) => setKomutMetni(e.target.value)} spellCheck={false} placeholder={'npx -y @modelcontextprotocol/server-filesystem "D:\\Belgeler"'} /></label>}
            {kayitHatasi && <p className="baglanti-satir__not" data-ton="hata" role="alert">{kayitHatasi}</p>}
            <div className="baglanti-onay__dugmeler">
              <Dugme tur="hayalet" boyut="k" onClick={() => { setYeni(null); setKayitHatasi(null); }}>Vazgeç</Dugme>
              <Dugme tur="ikincil" boyut="k" disabled={!formHazir} title={formHazir ? undefined : yeni.tur === 'http' ? 'Ad ve adres gerekli' : 'Ad ve komut gerekli'} onClick={() => void formuKaydet(yeni)}>Kaydet</Dugme>
            </div>
          </div>
        )}
    </Kart>
  );
}
