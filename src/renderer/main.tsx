// ── Ana pencere: ray (sol menü) + çentikli pano ─────────────────────────────────────────────────────────────
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tasarim.css';
import { cagir, dinle, birakmayiEngelle } from './api';
import { temayiBagla } from './tema';
import { Ikon } from './bilesenler/Ikon';
import { Logo } from './bilesenler/Ortak';
import { UrunIsareti } from './bilesenler/UrunIsareti';
import { pencereKabugunuKur } from './pencere/PencereDugmeleri';
import { Kokpit } from './sayfalar/Kokpit';
import { Sohbetler } from './sayfalar/Sohbetler';
import { Hafiza } from './sayfalar/Hafiza';
import { Etkinlik } from './sayfalar/Etkinlik';
import { ClaudeCode } from './sayfalar/ClaudeCode';
import { Baglantilar } from './sayfalar/Baglantilar';
import { Ayarlar } from './sayfalar/Ayarlar';
import { Toplanti } from './toplanti/Toplanti';
import { Kurulum } from './sayfalar/Kurulum';
import { Kurulum2 } from './kurulum2/Kurulum2';
import { TekrarHosGeldin } from './sayfalar/TekrarHosGeldin';
import { Tanitim } from './bilesenler/Tanitim';
import { Acilis } from './acilis/Acilis';
import { HizliDenetimler } from './bilesenler/HizliDenetimler';
import { KipAnahtari } from './bilesenler/KipAnahtari';
import { TostAlani } from './bilesenler/TostAlani';
import { IsRayNoktasi, IsUcusIzleyici } from './is-izi/SuAn';
import { TANITIM_SURUMU, tanitimAcilsinMi } from '../shared/tanitim';
import { araclarGecisiMi, araclarTeklifEdilsinMi, kurulumYolu, veriVarMi, type KurulumYolu } from '../shared/kurulum-adimlari';
import type { VeriDurumu } from '../shared/veri-islemi';
import { araclarTeklifi } from './claudecode/araclar-teklifi-durumu';
import { araclarErtelemesi } from './araclar-ertelemesi';
import { motorBagliMi } from '../shared/abonelik';
import type { EklentiDurumu } from '../shared/cc-eklentiler';
import { ccCanliVar, type CcOlayZarfi, type CcOturumOzeti } from '../shared/cc-olay';
import { kisayolluAd } from '../shared/kisayol';
import { kisayolCoz, siradakiSayfa, sayfaKisayolMetni, yaziAlaniMi, gorunenRay, RAY_SIRASI, type RaySayfasi } from '../shared/uygulama-kisayol';
import { sayfaAdiCoz } from '../shared/etkinlik';
import { okunmamisToplami } from '../shared/kokpit-sohbet';
import { reddedilenMetni, type Reddedilen } from '../shared/tost-grup';
import { tostGoster } from './tostlar';
import { galeriAcikMi } from './ui/galeri-kapisi';
import { silmeler } from './geri-al';
import type { SohbetSecimi } from './sayfalar/Sohbetler';
import type { Ayarlar as AyarTipi, SohbetOzet } from '../shared/tipler';
import type { KisayolDurumu } from '../shared/genel-kisayol';

type Sayfa = RaySayfasi;
// Ray sırası Ctrl+1…7'nin de sırasıdır (Görev 20b, K10): numaralar yalnız GÖRÜNEN öğelere verilir (İş modunda Claude Code yok). Sıra
// tek kaynaktan: shared/uygulama-kisayol.ts RAY_SIRASI / gorunenRay (0.10 Görev 1, P1: Etkinlik Bağlantılar'dan sonra). Her sayfa: [kimlik,
// simge, ad].
const MENU: readonly (readonly [Sayfa, string, string])[] = [
  ['kokpit', 'kokpit', 'Kokpit'],
  ['sohbetler', 'sohbet', 'Sohbetler'],
  ['hafiza', 'hafiza', 'Hafıza'],
  ['toplanti', 'toplanti', 'Toplantı'],
  ['claude', 'kod', 'Claude Code'],
  ['baglantilar', 'baglanti', 'Bağlantılar'],
  ['etkinlik', 'etkinlik', 'Etkinlik'],
  ['ayarlar', 'ayarlar', 'Ayarlar'],
];
const menuOgesi = (s: Sayfa) => MENU.find(([m]) => m === s)!;
const sayfaMi = (s: string): s is Sayfa => (RAY_SIRASI as readonly string[]).includes(s);

function Uygulama() {
  // Açılışta hangi ekran (0.12 H3a, spec §2; shared/kurulum-adimlari.ts kurulumYolu — SÜRÜM NUMARASI KARARA GİRMEZ): yeniden kurulum
  // işareti → "Tekrar hoş geldin" (sayfalar/TekrarHosGeldin.tsx); kurulum bitmemiş → yeni kurulum (kurulum2/Kurulum2.tsx); hesap yok →
  // YALNIZ hesap ekranı; değilse doğrudan kokpit. Yükseltme hiçbir sihirbaz ya da özet açmaz (gereksiz ekran gösterilmez).
  // undefined = ayarlar henüz gelmedi (hiçbir şey çizilmez; açılış örtüsü opak zemin olarak durur).
  const [yol, setYol] = useState<KurulumYolu | undefined>(undefined);
  // Yeni kurulum "Fuber’i aç"la bitince 0.11 açılış animasyonu bir kez daha oynar (kokpite geçiş; acilis/Acilis.tsx `zorla`).
  const [acilisTekrar, setAcilisTekrar] = useState(0);
  // Yalnız hesap ekranı YALNIZ hesap sunucusuna ulaşılabiliyorken ve Gizli mod kapalıyken (shared/kurulum-adimlari.ts acilisEkrani):
  // ulaşılamıyorsa o ekranın tek eylemi "Şimdilik hesapsız devam et" olurdu — doğrudan kokpit. Yoklama kısa (≤ 4 sn), yalnız hesapsız
  // profilde ve GİZLİ MODDA HİÇ YOK (acilisYoklamasi; K1/F1: Gizli kendiliğinden ağa çıkmaz, hesap önermez). Gizli bayrağı o anki ayarlardan
  // (Tekrar hoş geldin sonrası da); okunamazsa yoklama yapılmaz.
  const yoluKur = (y: KurulumYolu) => { setYol(y); };
  const [sayfa, setSayfa] = useState<Sayfa>('kokpit');
  const [sohbetSecimi, setSohbetSecimi] = useState<SohbetSecimi>(null);
  // Yeni sohbet istendi (Ctrl+N ya da "Yeni"): sayaç değişince yazı alanı odaklanır.
  const [sohbetOdak, setSohbetOdak] = useState(0);
  const sohbetSec = (s: SohbetSecimi) => { setSohbetSecimi(s); if (s === 'yeni') setSohbetOdak((n) => n + 1); };
  // 0.11 G7: Ctrl+N kokpitteyken sayfa değişmez; kokpitin sohbet panelinde taslak sohbet açılır (sayaç değişince; pano/useKokpitSohbet.ts).
  const [kokpitYeni, setKokpitYeni] = useState(0);
  const [okunmamis, setOkunmamis] = useState(0);
  // Kokpit tanıtım turu: kurulum tamam ve bu sürümün turu henüz izlenmedi (src/shared/tanitim.ts; 0.6.0'dan yükselen profil de bir kez
  // görür). Ayarlar → Görünüm → "Tanıtımı yeniden izle" işareti siler.
  const [tanitim, setTanitim] = useState(false);
  const [kisayol, setKisayol] = useState('CommandOrControl+Shift+Space');
  // Ayarlar → Görünüm → "Kurulumu yeniden aç": yeni kurulum (kurulum2) uygulamanın üstünde OPAK, tam pencere katman olarak, "yeniden"
  // kipinde (bitince yalnız ayarlar kaydedilir, kurulum:tamamla çağrılmaz). Vazgeç/Esc uygulamaya değişmeden döner.
  const [sihirbaz, setSihirbaz] = useState(false);
  // Fuber hesabı penceresi (0.10 E3): ana:git('fuber-hesabi') açar (kurulum, motor bildirimleri, tepsi); Esc/Kapat kapatır.
  // Kurulum, "Tekrar hoş geldin" ya da yalnız hesap ekranı açıkken kabuk ve tur onların arkasında çizilmez; ekran bitince tur açılır.
  const turAyari = (a: AyarTipi, oturumOrtasi = false) => { setTanitim(tanitimAcilsinMi(a, oturumOrtasi)); setKisayol(a.ses.kisayol); };
  // Oturum ortasında İş → Geliştirici: "Geliştirici araçları" teklifi — I8: Ayarlar → Genel'de mod anahtarının altında, satır içinde
  // (claudecode/araclar-teklifi-durumu.ts; pencerenin üstünde sabit kart DEĞİL). "Göster" yalnız o adımlı sihirbazı açar.
  const [araclarSihirbazi, setAraclarSihirbazi] = useState(false);
  useEffect(() => { araclarTeklifi.gostericiBagla(() => setAraclarSihirbazi(true)); return () => araclarTeklifi.gostericiBagla(null); }, []);
  // A12: raydaki "Asistan" ipucu yalnız GERÇEKTEN alınmış kısayolu yazar (açılışta yasak bulunan ya da başka uygulamadaki tuş söz verilmez).
  const [asistanAlindi, setAsistanAlindi] = useState(true);
  useEffect(() => {
    const yaz = (d: KisayolDurumu | null | undefined) => { if (d?.asistan) setAsistanAlindi(d.asistan.alindi); };
    void cagir<KisayolDurumu>('kisayol:durum').then(yaz).catch(() => undefined);
    return dinle('kisayol:degisti', yaz);
  }, []);
  // A7: ilk yüklenen ayarlar rayın hızlı denetimlerine de verilir (ilk karede çizilir; Tarayıcı/Asistan düğmeleri zıplamaz).
  const [ilkAyar, setIlkAyar] = useState<AyarTipi | null>(null);

  const tost = tostGoster;
  // Öğretilemeyen dosyalar (Görev 20b, G19): kısa aralıkta gelen redler tek tostta ("N dosya öğretilemedi"); on dosya on tost olmasın.
  const redler = useRef<{ liste: Reddedilen[]; zaman: ReturnType<typeof setTimeout> | null }>({ liste: [], zaman: null });
  const reddet = (r: Reddedilen) => {
    const k = redler.current;
    k.liste.push(r);
    if (k.zaman) clearTimeout(k.zaman);
    k.zaman = setTimeout(() => { const l = k.liste; k.liste = []; k.zaman = null; tost(reddedilenMetni(l), 'hata'); }, 1200);
  };

  useEffect(() => {
    // G2 düzeltme turu 1 (K2): açılışta yalnız yeniden kurulum işareti sorulur (tek dosya bakışı); sayılar YALNIZ işaret varken (karşılanacak
    // veri var mı: kurulumYolu kural 1).
    void Promise.all([cagir<AyarTipi>('ayarlar:al'), cagir<Pick<VeriDurumu, 'yenidenKurulum'>>('veri:ozet', { yalnizIsaret: true }).catch(() => null)]).then(async ([a, v]) => {
      const yenidenKurulum = v?.yenidenKurulum === true;
      const ozet = yenidenKurulum ? await cagir<VeriDurumu>('veri:ozet').catch(() => null) : null;
      const hesapVar = Boolean(a.hesap);
      yoluKur(kurulumYolu({ veriVar: veriVarMi({ kurulumTamam: a.kurulumTamam, hesapVar }, ozet), yenidenKurulum, kurulumTamam: a.kurulumTamam, hesapVar, hesapsizTercih: a.hesapsizTercih === true }));
      turAyari(a); setIlkAyar(a);
    });
    const okSay = () => void cagir<SohbetOzet[]>('sohbet:liste').then((l) => setOkunmamis(okunmamisToplami(l, { anaHaric: true })));
    okSay();
    const k = [
      // 'sayfa', 'sohbetler/12' ya da 'ayarlar#motorlar' (bölüme kaydırır: Ayarlar yüklenince hash'i okur; açıksa hemen). Eski sayfa adı
      // ('beyin': telefondan ya da kayıtlı bir yerden) Etkinlik'e çözülür (shared/etkinlik.ts sayfaAdiCoz) — boş sayfa açılmaz.
      dinle('ana:git', (git: string) => {
        const [yol, cipa] = git.split('#');
        const [ham, id] = yol.split('/');
        const s = sayfaAdiCoz(ham);
        if (cipa) { location.hash = cipa; requestAnimationFrame(() => document.getElementById(cipa)?.scrollIntoView({ block: 'start' })); }
        if (sayfaMi(s)) setSayfa(s);
        if (id) setSohbetSecimi(Number(id));
      }),
      dinle('sohbet:olay', (o: { tur: string }) => { if (o.tur === 'bitti' || o.tur === 'yeni_mesaj') okSay(); }),
      dinle('iceaktar:islendi', (v: { ad: string }) => tost(`Öğrendim: ${v.ad}`)),
      dinle('iceaktar:zaten', (v: { dosya: string }) => tost(`${v.dosya} zaten öğrenilmiş; Hafıza → Belgeler’de duruyor.`)),
      dinle('iceaktar:ozet-sonra', (v: { dosya: string }) => tost(`${v.dosya}: özet şimdilik çıkarılamadı; belge şimdiden aranabilir.`)),
      // Alan adları gönderenlerle aynı: iceaktar.ts {dosya, mesaj}, eposta.ts {hesap, mesaj}, whatsapp.ts {mesaj}.
      dinle('iceaktar:hata', (v: { dosya: string; mesaj: string }) => reddet({ dosya: v.dosya, mesaj: v.mesaj })),
      dinle('eposta:hata', (v: { hesap?: string; mesaj: string }) => tost(`E-posta${v.hesap ? ` (${v.hesap})` : ''}: ${v.mesaj}`, 'hata')),
      dinle('whatsapp:hata', (v: { mesaj: string }) => tost(`WhatsApp: ${v.mesaj}`, 'hata')),
      // Kurulum ya da yükseltme bitince (kurulum sürümü yazıldı) ve "Tanıtımı yeniden izle"de (işaret silindi) tur açılır.
      dinle('ayarlar:degisti', (a: AyarTipi) => turAyari(a, true)),
    ];
    return () => k.forEach((f) => f());
  }, []);
  // Tur her açılışta kokpitten başlar (yeniden izlemede Ayarlar'dan gelinir).
  useEffect(() => { if (tanitim) setSayfa('kokpit'); }, [tanitim]);
  // Mod (K2): İş modunda Claude Code menüsü yok; o sayfadayken İş'e geçilirse kokpite dönülür. Mod yüklenene dek kabuk çizilmez
  // (Geliştirici modunda menü bir kare eksik görünüp titremesin).
  const [mod, setMod] = useState<AyarTipi['mod'] | null>(null);
  const oncekiMod = useRef<AyarTipi['mod'] | null>(null);
  const oncekiTamam = useRef<boolean | null>(null);
  useEffect(() => {
    void cagir<AyarTipi>('ayarlar:al').then((a) => { setMod(a.mod); oncekiMod.current = a.mod; oncekiTamam.current = a.kurulumTamam; });
    return dinle('ayarlar:degisti', (a: AyarTipi) => {
      const onceki = oncekiMod.current;
      const tamam = oncekiTamam.current;
      oncekiMod.current = a.mod;
      oncekiTamam.current = a.kurulumTamam;
      setMod(a.mod);
      if (a.mod !== 'gelistirici') { araclarTeklifi.kapat(); araclarErtelemesi.birak(); return; }
      // 0.10 Görev 2 (D-2): bulut motoru yokken teklif bekler (Ayarlar önce Motorlar'ı açar); bekleyen teklif, motor bağlanınca açılır.
      const motorVar = motorBagliMi(a.saglayicilar, a.hesap);
      // 0.13: kurulumda Developer seçip bitiren de geçiş sayılır (yeni kurulumda bu sayfa yok; kip kartı anında kaydedildiği için `onceki` burada zaten Developer'dır).
      const gecis = araclarGecisiMi({ onceki, oncekiTamam: tamam, kurulumTamam: a.kurulumTamam });
      if (!a.kurulumTamam || (!gecis && !(araclarErtelemesi.ertelendiMi() && motorVar))) return;
      void cagir<EklentiDurumu>('claudecode:eklenti-durum').then((d) => {
        const goruldu = d.paket.adimGoruldu;
        if (araclarTeklifEdilsinMi({ onceki: 'is', yeni: a.mod, kurulumTamam: a.kurulumTamam, araclarGoruldu: goruldu, motorVar })) {
          araclarErtelemesi.birak();
          araclarTeklifi.ac();
        } else if (gecis && !motorVar && !goruldu) araclarErtelemesi.ertele();
      }).catch(() => undefined);
    });
  }, []);
  // Developer'dan Business'a geçilince süren Claude Code oturumu yarıda kalmaz (0.13): canlı oturum ya da bekleyen izin varken sayfa rayda ve açık kalır, izin kartındaki "Aç"
  // boşa gitmez. Kural shared/cc-olay.ts ccCanliVar; oturum hâli 'durum' olayıyla tazelenir (metin akışında değil). Kokpite atan etki yalnız kip geçişinde bakar: oturum
  // bitince okuyan kişi sayfadan atılmaz, çıkınca menüden kalkar.
  const [ccCanli, setCcCanli] = useState(false);
  const ccCanliRef = useRef(false);
  useEffect(() => {
    const ccTazele = () => void cagir<CcOturumOzeti[]>('claudecode:oturumlar').then((l) => { const v = ccCanliVar(l); ccCanliRef.current = v; setCcCanli(v); }).catch(() => undefined);
    ccTazele();
    return dinle('claudecode:olay', (z: CcOlayZarfi) => { if (z.olay.tur === 'durum') ccTazele(); });
  }, []);
  useEffect(() => { if (mod === 'is' && sayfa === 'claude' && !ccCanliRef.current) setSayfa('kokpit'); }, [mod]);

  const mac = window.fuber?.platform === 'darwin';
  const gorunenMenu = gorunenRay(mod ?? 'is', ccCanli || sayfa === 'claude').map(menuOgesi);
  // Uygulama içi kısayollar (K10): Ctrl+N yeni sohbet (yazarken de), Ctrl+1…7 ray sırası (yazı alanında değil). Tanıtım turu,
  // kurulum sihirbazı ya da açık bir iletişim kutusu (aria-modal) varken çalışmaz.
  const kisayolDurumu = useRef<{ gorunenMenu: typeof gorunenMenu; engel: boolean; sayfa: Sayfa }>({ gorunenMenu, engel: false, sayfa });
  kisayolDurumu.current = { gorunenMenu, engel: tanitim || sihirbaz || yol !== 'yok', sayfa };
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.defaultPrevented || kisayolDurumu.current.engel || document.querySelector('[aria-modal="true"]')) return;
      const k = kisayolCoz(e, { mac, yaziyor: yaziAlaniMi(document.activeElement as HTMLElement | null) });
      if (!k) return;
      // 0.11 G7: kokpitteyken taslak panelde açılır (sayfa değişmez); başka sayfalarda eskisi gibi Sohbetler'de yeni taslak.
      if (k.tur === 'yeni-sohbet') {
        e.preventDefault();
        if (kisayolDurumu.current.sayfa === 'kokpit') { setKokpitYeni((n) => n + 1); return; }
        setSayfa('sohbetler'); sohbetSec('yeni'); return;
      }
      // Ctrl+Z: en son "Geri al"lı silmeyi geri alır (bekleyen yoksa tuşa dokunulmaz).
      if (k.tur === 'geri-al') { if (silmeler.sonuncuyuGeriAl()) e.preventDefault(); return; }
      const hedef = siradakiSayfa(kisayolDurumu.current.gorunenMenu, k.sira);
      if (hedef) { e.preventDefault(); setSayfa(hedef[0]); }
    };
    addEventListener('keydown', tus);
    return () => removeEventListener('keydown', tus);
  }, []);

  if (yol === undefined || mod === null) return null;
  if (yol === 'tekrar-hos-geldin') return <TekrarHosGeldin bitti={(sonraki) => yoluKur(sonraki)} />;
  if (yol === 'yeni') return <Kurulum2 kip="ilk" bitti={() => { setYol('yok'); setAcilisTekrar((n) => n + 1); }} />;
  // Oturum ortasında İş → Geliştirici: eski sihirbazın yalnız "Geliştirici araçları" sayfası (özetsiz; kurulum2'ye taşınana dek).
  if (araclarSihirbazi) return <Kurulum kip="yukseltme" adimlar={['gelistirici-araclari']} bitti={() => setAraclarSihirbazi(false)} />;

  const git = (s: string, id?: number) => { setSayfa(s as Sayfa); if (id) setSohbetSecimi(id); };
  const turBitti = () => { setTanitim(false); void cagir('ayarlar:kaydet', { tanitimSurumu: TANITIM_SURUMU }); };

  return (
    <div className="kabuk">
      <nav className="ray">
        <div className="surukle" style={{ position: 'absolute', top: 0, left: 0, width: 68, height: 'var(--ust)' }} />
        {/* Ürün işareti (0.12): mini logo — uygulama ikonuyla aynı kaynak (shared/urun-isareti.ts MINI_*). */}
        <div style={{ margin: '-6px 0 14px', opacity: 0.95 }} title="Fuber AI"><UrunIsareti olcu={24} etiket="Fuber AI" /></div>
        {/* İpucunda sayfanın kısayolu (Ctrl+1…): yazısı CSS'ten (data-kisayol), ipucunun metni sayfa adı olarak kalır. */}
        {gorunenMenu.map(([s, ikon, ad], i) => (
          <button key={s} className="ray__dgm" data-tur={s} aria-label={ad} aria-keyshortcuts={`${mac ? 'Meta' : 'Control'}+${i + 1}`} aria-current={sayfa === s ? 'page' : undefined} onClick={() => setSayfa(s)}>
            <Ikon ad={ikon} olcu={20} />
            {s === 'sohbetler' && okunmamis > 0 && <span className="ray__rozet">{okunmamis}</span>}
            {/* İş izi (11 Kas): işin yürüdüğü sayfanın simgesinde 6 px nokta (canlıyken nefes alır). */}
            {!(s === 'sohbetler' && okunmamis > 0) && <IsRayNoktasi sayfa={s} />}
            <span className="ray__ipucu" data-kisayol={sayfaKisayolMetni(i + 1, mac)}>{ad}</span>
          </button>
        ))}
        {/* 11 Kas (tasarımcı bulgu 5): rayın altı üç ayrı küme — araçlar (Tarayıcı, Asistan), kip anahtarı, hızlı anahtarlar. Kümeler ince çizgiyle
            ayrılır; araçlar sayfa düğmelerinden küçük ve sessizdir, hızlı anahtarlar kendi tepsisinde durur (sayfa düğmesi gibi görünmez). Her simgenin
            erişilebilir adı ve ipucu var. */}
        <div className="ray__alt">
          <div className="ray__kume" role="group" aria-label="Araçlar" data-ray-kume="araclar">
            <button type="button" className="ray__dgm ray__dgm--arac" aria-label="Fuber Tarayıcı" onClick={() => void cagir('tarayici:goster')}><Ikon ad="kure" olcu={18} /><span className="ray__ipucu" aria-hidden="true">Fuber Tarayıcı</span></button>
            <button type="button" className="ray__dgm ray__dgm--arac" data-asistan="" aria-label="Asistan" onClick={() => void cagir('asistan:goster', true)}><Ikon ad="asistan" olcu={18} /><span className="ray__ipucu" aria-hidden="true">{kisayolluAd('Asistan', asistanAlindi ? kisayol : '', mac)}</span></button>
          </div>
          <span className="ray__ayrac" aria-hidden="true" />
          {/* 0.13: kip anahtarı (Business / Developer); Ayarlar'daki mod kartlarıyla aynı alan. */}
          <KipAnahtari mod={mod} />
          <span className="ray__ayrac" aria-hidden="true" />
          {/* Hızlı denetimler (K6): mikrofon, ada, sürekli dinleme, rahatsız etme — Ayarlar'la aynı alanlar. */}
          <HizliDenetimler ilk={ilkAyar} />
        </div>
      </nav>

      <main className="pano">
        <div className="pano__ust surukle">
          <div />
          <div className="centik"><Logo yukseklik={13} /></div>
          <div />
        </div>
        <div className="pano__sayfalar">
          {sayfa === 'kokpit' && <Kokpit git={git} yeniSohbet={kokpitYeni} turAcik={tanitim} />}
          {sayfa === 'sohbetler' && <Sohbetler secili={sohbetSecimi} sec={sohbetSec} odak={sohbetOdak} />}
          {sayfa === 'hafiza' && <Hafiza />}
          {sayfa === 'toplanti' && <Toplanti />}
          {sayfa === 'etkinlik' && <Etkinlik git={git} />}
          {sayfa === 'claude' && <ClaudeCode />}
          {sayfa === 'baglantilar' && <Baglantilar />}
          {sayfa === 'ayarlar' && <Ayarlar sihirbaziAc={() => setSihirbaz(true)} />}
        </div>
        {/* Bütün uygulama içi bildirimler tek katmanda, çentiğin altından iner (Görev 20b düzeltme turu 2): "Geri al" (K2), bilgi/hata
            ve uygulama öndeyken adanın yerine hatırlatıcı, Fuber'in sözü, onay (K4). Sayfa alanı hiç değişmez. */}
        <TostAlani />
        {/* İş izi: biten işin işaretinden sayfasının ray simgesine uçuş; Az hareket kökte. */}
        <IsUcusIzleyici />
      </main>
      {tanitim && <Tanitim bitti={turBitti} kisayol={kisayol} mod={mod} />}
      {sihirbaz && <Kurulum2 kip="yeniden" bitti={() => setSihirbaz(false)} />}
      {acilisTekrar > 0 && <Acilis key={acilisTekrar} zorla />}
    </div>
  );
}

temayiBagla();
birakmayiEngelle();
const kok = createRoot(document.getElementById('kok')!);
// 0.11 G3: arayüz kütüphanesi galerisi — YALNIZ test derlemesinde (FUBER_DEMO; preload) ve #galeri adresinde; karar açılışta bir kez
// verilir, galeri tembel yüklenir (müşteri sürümünde ne kodu çalışır ne adresi bir şey açar; tests/ui-kutuphanesi.test.ts).
if (galeriAcikMi({ demo: window.fuber?.demo === true, hash: location.hash })) {
  void import('./ui/Galeri').then(({ Galeri }) => kok.render(<StrictMode><Galeri /></StrictMode>));
} else {
  // 0.11 G11: açılış örtüsü uygulamanın kardeşi (üstte, pointer-events:none): ayarlar gelene dek `Uygulama` null çizerken de örtü opak
  // zemin olarak durur (boş kare yok), ilk gösterimde işaret + yazı + erime oynar (acilis/Acilis.tsx); uygulama arkada hazırlanır.
  kok.render(<StrictMode><Uygulama /><Acilis /></StrictMode>);
}
// Kendi pencere düğmeleri (Görev 22): sayfanın kökünden SONRA, ayrı kökte (sürükleme bölgeleri belge sırasıyla birleşir).
pencereKabugunuKur();
