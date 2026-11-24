// ── Ada: üst ortadan inen çentik (görünüm) ──────────────────────────────────────────────────────────────────────
// A · Çentik: ekranın üst kenarına yapışık şekil (0.13: her temada saf siyah; kökteki `koyu-bolge` yazı belirteçlerini açık temada da koyuda tutar); iş
// geldikçe yaylanarak büyür, bitince geri çekilir. Pencere 720×460 × ölçek, saydamdır (ana süreç: src/main/ada.ts). 0.14 T19: biçim dokuz dilimdir
// (CentikSekli.tsx: yalnız transform; R15), ölçek kökte CSS zoom (`ada:olcek`); boşta dinlenme (karakterin yüzü bakar), medya ya da Fuber noktası varken
// Kapalı hap (saat + simge). Hal `adaHaliBul`'dan, en/boy `adaOlcusu`'ndan gelir (src/shared/ada.ts); kart, yanıt ve onayda boy
// içerikten ölçülür (en çok 440 px, sonra içi kayar). İçerik katmanları hedef enle çizilir, biçim büyürken gecikmeli solarak girer;
// hal değişince eski katman solarak çıkar, yenisi solarak girer (çapraz solma). İmleç şeklin üstüne gelince `ada:fare` ile
// tıklama yakalanır, gerisi alttaki uygulamaya geçer; imleç sessiz çentikte durunca 'selam' açılır, Fuber'in sessiz mesajı varsa
// çentikte nokta görünür ve imleç gelince mesaj açılır (0.13). 0.14 T22: boşta sistem uyarı hapı ('uyari': simge + metin; ses ve parlaklıkta düzey çubuğu,
// yalnız transform) — karakter çizmez, Sade modda da aynıdır. Durum ve olaylar: useAsistan.ts. Malzeme ve hareket: ada.css.
// 0.14 T23: hover ve tıklama açık paneli açar (Panel.tsx, sayfalar/Asistan.tsx; 0.13'ün selamının yerinde). Gözlü hâller (11 Kas, "Pamuk"; GorunenGoz: Sade modda
// kipin vurgu renkli nötr işareti): dinliyor (göz büyür, bebek genişler), konuşuyor (hafif ritim), Çalışıyor (düşünen göz + halka + "Adım N" + Durdur), onay
// (dinleyen göz + kart), hata (üzgün göz). Mod değişince göz aynı kalır, parıltının rengi çapraz solar (ModGecisi; süren tur eski kiple biter —
// shared/ada.ts centikKipiAdimi).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { UrunIsareti } from '../bilesenler/UrunIsareti';
import { Markdown } from '../bilesenler/Ortak';
import { MetinKirp } from '../ui';
import { isGuvenliMetin } from '../../shared/beyin';
import { OnayKarti } from '../bilesenler/Sohbet';
import { AracAdimlari } from '../bilesenler/AracAdimlari';
import { KartOzeti } from '../bilesenler/YapayZekaKarti';
import { adaHaliBul, adaOlcusu, bekleyenCip, calisiyorAdimMetni, calisiyorHapMetni, centikKipiAdimi, fuberNoktasiVar, gorevHapMetni, MOTOR_HAP_METNI, type CentikKipi } from '../../shared/ada';
import { motorBildirimi, type MotorEylemi } from '../../shared/motor-durumu';
import { YerelYenidenIndirDugmeleri } from '../bilesenler/YerelYenidenIndir';
import { motorEylemiYap } from '../motor-sinyali';
import { AdaBaglami, useAsistan, type AdaBildirimi } from './useAsistan';
import { ACIL_YEDEK, useAcilDurdurma } from '../acil-kisayol';
import { GorunenGoz, Gozler, ModGecisi, kipVurgusu, defterEtkinligi, type UykuDefteri } from '../ui/goz';
import { useKarakterGorunur } from '../karakter-gorunum';
import { modKip, type KipKimligi } from '../../shared/karakterler';
import { IMLEC_ARALIK_MS, type GozHali, type GozIfadesi } from '../../shared/goz';
import type { SistemUyarisi } from '../../shared/sistem-uyarilari';
import { CentikSekli } from './CentikSekli';
import { centikKosesi } from './centik-olcu';
import { Panel } from './Panel';
import { useCentikOdak } from './odak-durumu';
import { odakIlerlemesi } from '../../shared/odak';
import { sayfaVurgusu } from '../../shared/centik-sayfalar';
import { FiilGecisi, IsIsareti, IsSeridi, IsYorungesi, isVurguStili, useBitisUcusu } from '../is-izi/IsSeridi';
import { isGit, useSaniye } from '../is-izi/depo';
import { aktifMi, centikOzeti, isSuresi, yardimciOzeti } from '../../shared/is-izi';
import './ada.css';

/** İçerik boyundaki hallerin üst sınırı (src/shared/ada.ts ölçü tablosuyla aynı); aşan içerik şeklin içinde kayar. */
const ICERIK_EN_COK = 440;
/** Çentikli Mac ekranı: büyüyen haller gerçek çentiğin altından başlar (çentik ~32 px). */
const CENTIK_BOY = 32;
const DINLENME = adaOlcusu('dinlenme');
/** Dinlenmedeki gözlerin boyu (CSS px, ölçek 1; 11 Kas "Pamuk": 132×30 çentikte 16 px boyunda göz çifti — ölçek kökteki zoom'dan). */
const GOZ_PX = 16;
/** Sade dinlenmedeki noktanın boyu (CSS px; ada.css .centik-yuz__yer-tutucu ile aynı). Mod geçişi de bu boyda: büyük işaret bir an görünmesin (düzeltme turu 1). */
const SADE_NOKTA_PX = 8;
/**
 * Dinlenme yüzünün uyku defteri (0.14 T28 düzeltme turu 2, yeniden inceleme New 1): son KULLANICI etkinliğinin anı (performance.now; karakter kancasının saat
 * tabanı). Yüz yalnız 'dinlenme' hâlinde takılıdır; yardımcının olayı (uyarı hapı, medya başladı/bitti) hâli değiştirince yüz çıkar, geri gelince yeni bir
 * karakter kurulur — defter modül düzeyinde olduğundan geri sayım sıfırlanmaz, süre dolmuşsa yüz ilk karede uyur. Deftere yalnız gerçek girdi yazar: karakterin
 * kendi kancası (imleç alanı, hover, tık) ve şekle gelen imleç, basma, tekerlek, tuş (`kullaniciEtkinligi`; panel ya da kart açıkken yüz takılı değildir).
 * Zamanlayıcı yok: kalan süre kancanın tek atımlık uyku zamanlayıcısıyla işler.
 */
const DINLENME_UYKU_DEFTERI: UykuDefteri = { son: null };
// Deftere yazar ve takılı yüze de söyler (T28 düzeltme turu 3, C2): şekle gelen tekerlek ya da tuş canlı karakterin geri sayımını yeniler, uyuyorsa uyandırır.
const kullaniciEtkinligi = () => defterEtkinligi(DINLENME_UYKU_DEFTERI, performance.now());

/**
 * Dinlenme yüzü (0.14 T19, R13, R14; 11 Kas "Pamuk"): çentikte 16 px boyunda göz çifti. Göz takibi yalnız çentik penceresinin kutusundaki imleçten: Electron'un
 * `setIgnoreMouseEvents(true, { forward: true })` ile ilettiği fare hareketi göz çiftinin merkezine göre (ölçeksiz CSS px) `disImlec` olur. İmleç kutudan çıkınca
 * null: gözler 600 ms'de ortaya döner. Sakkad, kırpma, 60 sn sonra uyku (yarıya düşme, iki yavaş kırpma, kapanma, 6 nefes, sonra hiçbir şey çizilmez) ve uyanış
 * gözün hareket beyninde (ui/goz/beyin.ts); burada döngü yok. Sade mod (T6b): `karakterGorunur` false ise aynı yerde kipin vurgu renkli noktası (vurgu.ts).
 * Mod değişince (`gecis`) ModGecisi: göz aynı kalır, parıltının rengi çapraz solar.
 */
function DinlenmeYuzu({ kip, azHareket, olcek, karakterGorunur = true, gecis, bitti, odakta = false }: {
  kip: KipKimligi; azHareket: boolean; olcek: number; karakterGorunur?: boolean; gecis?: { eski: KipKimligi; yeni: KipKimligi } | null; bitti?: () => void;
  /** Odak sürüyor (0.14 çentik cilası): karakter sakin, odaklanmış yüzle (durağan 'dusunuyor' ifadesi; göz takibi ve uyku yok, döngü yok). */
  odakta?: boolean;
}) {
  const kutu = useRef<HTMLSpanElement>(null);
  const [imlec, setImlec] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!karakterGorunur) return;
    let son: { x: number; y: number } | null = null;
    let zaman: ReturnType<typeof setTimeout> | null = null;
    const yaz = () => { zaman = null; setImlec(son); };
    const hareket = (e: MouseEvent) => {
      const r = kutu.current?.getBoundingClientRect();
      if (!r) return;
      son = { x: (e.clientX - (r.left + r.width / 2)) / olcek, y: (e.clientY - (r.top + r.height / 2)) / olcek };
      if (!zaman) zaman = setTimeout(yaz, IMLEC_ARALIK_MS);
    };
    const cikti = (e: MouseEvent) => { if (e.relatedTarget) return; son = null; if (zaman) { clearTimeout(zaman); zaman = null; } setImlec(null); };
    window.addEventListener('mousemove', hareket, { passive: true });
    window.addEventListener('mouseout', cikti);
    return () => { window.removeEventListener('mousemove', hareket); window.removeEventListener('mouseout', cikti); if (zaman) clearTimeout(zaman); };
  }, [olcek, karakterGorunur]);
  return (
    <span className="centik-yuz" ref={kutu} aria-hidden="true">
      {gecis
        ? karakterGorunur
          ? <ModGecisi eski={gecis.eski} yeni={gecis.yeni} boyut={GOZ_PX} kesit="centik" azHareket={azHareket} bitti={bitti} />
          : <span className="centik-yuz__sade-gecis"><ModGecisi eski={gecis.eski} yeni={gecis.yeni} boyut={SADE_NOKTA_PX} azHareket={azHareket} bitti={bitti} /></span>
        : karakterGorunur
          ? (odakta
            ? <Gozler kip={kip} boyut={GOZ_PX} kesit="centik" ifade="dusunuyor" azHareket={azHareket} />
            : <Gozler kip={kip} boyut={GOZ_PX} kesit="centik" hal="sakin" azHareket={azHareket} disImlec={imlec} disTiklama etkinlik={DINLENME_UYKU_DEFTERI} />)
          : <span className="centik-yuz__yer-tutucu" style={{ background: kipVurgusu(kip) }} />}
    </span>
  );
}

/**
 * 0.14 T23 (11 Kas: gözler): hâlin küçük gözleri (dinliyor, konuşuyor, Çalışıyor, onay, hata). GorunenGoz: Sade modda aynı kutuda vurgu renkli nötr işaret. Hâl
 * verilen göz canlıdır (hâl döngüsü yalnız o hâl sürerken); `ifade` verilen (onay, hata) durağandır.
 */
function HalKarakteri({ kip, boyut, azHareket, hal, ifade }: { kip: KipKimligi; boyut: number; azHareket: boolean; hal?: GozHali; ifade?: GozIfadesi }) {
  return (
    <span className="ada__hal-karakter" style={{ width: boyut, height: boyut }} aria-hidden="true">
      <GorunenGoz kip={kip} boyut={boyut} azHareket={azHareket} hal={hal} ifade={ifade} />
    </span>
  );
}

/**
 * Işık katmanı (0.14 çentik cilası, 5 Kas; hedef: bol ışık geçişleri, hafif ışıklandırılmış görüntü, Apple cihazı hissi). Biçimin üstünde,
 * içeriğin altında, şeklin hedef ölçüsünde ve köşesinde kırpılı bir kutu; içindeki her şey ÖNCEDEN ÇİZİLMİŞ degrade katmanlardır, yalnız transform ve opacity
 * canlanır (filter ve box-shadow canlandırılmaz; ada.css):
 *   · kenar: alt kenarda ince iç parlama (durağan, kenar degradesi);
 *   · vurgu parıltısı: kipin vurgusunda (Business turuncu, Developer yeşil — ui/goz/vurgu.ts) alttan yumuşak ışık; hover'da açılır (opacity);
 *   · süzülme: hâl ya da gösterilen öğe değişince (açılış, uyarı hapı, onay…) tek bir ışık bandı soldan sağa bir kez geçer (anahtarla yeniden takılır; döngü yok);
 *   · Odak kenar ışığı: sayım sürerken alt kenarda ilerleyen çizgi — TEK CSS animasyonu (süre = toplam, gecikme = −geçen; adımlı eğri: kare başına çizim yok).
 * Biçim yayla büyürken kutu hedef ölçüdedir: katman biçim büyüdükten sonra solarak girer (dışarı taşan ışık görünmesin). Sade modda da aynıdır (karakter yok, ışık var).
 */
function AdaIsigi({ en, boy, kose, anahtar, gizli, odak, icerikli }: {
  en: number; boy: number; kose: number; anahtar: string; gizli: boolean; icerikli: boolean;
  odak: { toplamMs: number; gecenMs: number; oran: number; akiyor: boolean; renk: string | null } | null;
}) {
  if (gizli || boy <= 0) return null;
  return (
    <div className="ada-isik" aria-hidden="true" style={{ width: en, height: boy, borderRadius: `0 0 ${kose}px ${kose}px` }}>
      {/* İçerik boyundaki hâllerde (akan yanıt) boy sürekli değişir: kenar ve parıltı yalnız sabit ölçülü hâllerde (biçimin dışına taşmasınlar). */}
      {!icerikli && <i className="ada-isik__parilti" />}
      {!icerikli && <i className="ada-isik__kenar" />}
      <i key={anahtar} className="ada-isik__suzulme" />
      {odak && (
        <i className="ada-isik__odak" data-akiyor={odak.akiyor ? '' : undefined} style={{
          ...(odak.renk ? { ['--odak-renk' as string]: odak.renk } : {}),
          ...(odak.akiyor
            ? { animationDuration: `${odak.toplamMs}ms`, animationDelay: `-${Math.round(odak.gecenMs)}ms` }
            : { transform: `scaleX(${odak.oran.toFixed(4)})` }),
        }} />
      )}
    </div>
  );
}

/** Kapalı hapın saati (R13): yalnız hap görünürken, bir sonraki dakika başına kurulan tek `setTimeout` zinciriyle; görünmezken zamanlayıcı yok. */
function useDakika(aktif: boolean): number {
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    if (!aktif) return;
    setSimdi(Date.now());
    let z: ReturnType<typeof setTimeout>;
    const kur = () => { z = setTimeout(() => { setSimdi(Date.now()); kur(); }, 60_000 - (Date.now() % 60_000) + 20); };
    kur();
    return () => clearTimeout(z);
  }, [aktif]);
  return simdi;
}

/**
 * Sistem uyarı hapı (0.14 T22): simge + metin; ses ve parlaklıkta düzey çubuğu (çubuk tam boy çizilir, düzey yalnız `transform: scaleX` ile — genişlik
 * canlandırılmaz). Karakter YOK: hap iki modda (Göster, Sade) aynıdır. Okuyucu için durum satırı (role=status).
 */
function UyariHapi({ u }: { u: SistemUyarisi }) {
  const duzey = typeof u.duzey === 'number' ? Math.min(1, Math.max(0, u.duzey)) : null;
  return (
    <div className="ada__satir ada__uyari" role="status" aria-live="polite" data-uyari={u.tur}>
      <span className="ada__simge"><Ikon ad={u.simge} olcu={16} /></span>
      <span className="ada__baslik">{u.metin}</span>
      {duzey !== null && <span className="ada__duzey" aria-hidden="true"><i style={{ transform: `scaleX(${duzey.toFixed(3)})` }} /></span>}
    </div>
  );
}

/** Windows'un animasyon tercihi (R16): olayla izlenir (yoklama yok). */
function useSistemAzHareket(): boolean {
  const [az, setAz] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const s = matchMedia('(prefers-reduced-motion: reduce)');
    const degisti = () => setAz(s.matches);
    degisti();
    s.addEventListener('change', degisti);
    return () => s.removeEventListener('change', degisti);
  }, []);
  return az;
}

/** Son çizilen katman: hal değişince solarak çıkan kopya bundan yapılır. `gizli`: o karede ada toplanmıştı (çıkacak bir şey yok). */
interface Cizim { anahtar: string; icerik: ReactNode; en: number; boy: number; sabit: boolean; gizli: boolean }

const saat = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
/** Az önce geldiyse "şimdi", sırada beklediyse geldiği saat. */
const neZaman = (ms: number) => (Date.now() - ms < 60_000 ? 'şimdi' : saat(ms));
/** Hap önizlemesi için markdown işaretleri ve atıflar düşer. */
const duz = (m: string) => m.replace(/\[(H|M|D|N|G|R)-\d+[^\]]*\]/g, '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();

/** Bildirimin simgesi: hatırlatıcı zil; Fuber'in mesajı Fuber'in mini logosu (0.12; yazı rengini alır — adanın --ink-2'si). */
const bildirimSimgesi = (tur: AdaBildirimi['tur'], olcu: number): ReactNode =>
  tur === 'hatirlatma' ? <Ikon ad="zil" olcu={olcu} /> : <UrunIsareti olcu={olcu - 1} renk="currentColor" />;

function Sayac({ toplam }: { toplam: number }) {
  return toplam > 1 ? <span className="ada__sayac" title={`Sırada ${toplam - 1} bildirim daha var`}>1/{toplam}</span> : null;
}

/** Motor kartının düğmesi: ana pencere öne gelir ve Fuber hesabı penceresi (ya da Ayarlar'ın o yeri: 'yapay-zeka/motorlar') açılır; ada
 *  çekilir (0.10 Görev 2: "Giriş yap" / "Hesabı gör" / Geliştirici'de "Kendi anahtarımla bağla"). */
const motorEylemi = (d: { eylem?: MotorEylemi; cipa?: string }, kapat: () => void) => { motorEylemiYap(d); kapat(); };

export function Ada() {
  const a = useAsistan();
  const hal = adaHaliBul(a.adaDurumu);
  // Motor kartı (0.10 Görev 2; §4.4, K2): kokpit kartı ve sohbet şeridiyle TEK kaynak (shared/motor-durumu.ts motorBildirimi) — başlık,
  // metin ve tek düğme ("Giriş yap" → Fuber hesabı penceresi; Geliştirici'de ek "Kendi anahtarımla bağla"); abonelik ve "Kullanım biçimini
  // değiştir" düğmesi yok. İçerik boyunda kart (geniş hal: adaOlcusu('motor-durdu')). A2: boştayken kart yalnız kırmızı hâlde (bağlantı
  // koptu, erişim kapalı, hak doldu) hapın üstüne gelince ya da tıklayınca (0.13: kendiliğinden hiç inmez); gerisi 'motor-hap'. Hap metni `kisa`.
  const motor = hal === 'motor-durdu' || hal === 'motor-hap' ? motorBildirimi(a.motor, a.motorBilgi.mod, a.motorBilgi.hesapDurumu, a.motorBilgi.gizli, a.motorBilgi.yarim, a.motorBilgi.yalnizYerel, a.motorBilgi.yuzde) : null;
  const olcu = adaOlcusu(hal);
  // İçerik boyunda mı (yükseklik içerikten). Alt köşe ayrıca hâle bağlıdır: açık panel sabit boylu olsa da 28 px (centikKosesi; T28 düzeltme turu 1).
  const icerikli = olcu.boy === 'icerik';
  const { taslak: metin, setTaslak: setMetin } = a; // soru kutusunun yazısı kancada: ada gizlenince silinir
  const acilTus = useAcilDurdurma(); // null: acil durdurma kısayolu alınamadı (başka bir uygulamada)
  const [icerikBoy, setIcerikBoy] = useState(0);
  const [cikan, setCikan] = useState<Cizim | null>(null);
  const [yayli, setYayli] = useState(true);
  const katman = useRef<HTMLDivElement>(null);
  const son = useRef<Cizim | null>(null);
  const altta = useRef(true);

  // Çentikli ekranda boştaki hâller (dinlenme, Kapalı) çizilmez (gerçek çentik zaten orada); büyüyen haller çentiğin altından doğar.
  const gizli = a.cekik || (a.centik && (hal === 'sessiz' || hal === 'dinlenme'));
  const ust = a.centik ? CENTIK_BOY : 0;
  const boy = icerikli ? Math.min(ICERIK_EN_COK, icerikBoy) : (olcu.boy as number);
  // R16: Görünüm'deki "Az hareket" ya da Windows'un animasyon tercihi.
  const sistemAz = useSistemAzHareket();
  const azHareket = a.azHareketAyar || sistemAz;
  const saatMs = useDakika(hal === 'sessiz' && !gizli);
  // T6b: Sade mod — false iken dinlenme yüzü aynı ölçüde nötr yer tutucudur.
  const karakterGorunur = useKarakterGorunur();
  // 0.14 çentik cilası (5 Kas): Odak sürerken kenar ışığı (tek CSS animasyonu: süre toplam, negatif gecikme = geçen; zamanlayıcı yok) ve odaklanmış yüz.
  const odak = useCentikOdak();
  const odakI = odak ? odakIlerlemesi(odak, Date.now()) : null;
  const odakAkiyor = Boolean(odakI?.akiyor && odakI.tur === 'odak');
  const bosHal = hal === 'dinlenme' || hal === 'sessiz';
  // 0.14 T23: çentikteki karakterin kipi ve mod geçişi (shared/ada.ts centikKipiAdimi). Ayarlar gelene dek ve ilk değerde geçiş oynamaz (açılışta Business → Developer
  // dönüşü görünmesin); süren tur (dinleme, düşünme, yanıt, Çalışıyor) eski karakterle biter, bitince geçiş oynar.
  const kip = modKip(a.motorBilgi.mod);
  const [kipi, setKipi] = useState<CentikKipi<KipKimligi>>(() => ({ gorunen: kip, gecis: null, bekleyen: null }));
  // T28 düzeltme turu 3 (C1): Ayarlar'dan mod ya da Sade değişimi kullanıcının işidir — karakter geçişten hemen sonra uyanık görünür (60 sn'lik girdisizlikten sonra
  // bile). İlk çizim ve ayarlar gelmeden önceki değişim (açılışta modun yüklenmesi) sayılmaz: yeniden takılma ve açılış etkinlik değildir.
  const ayarOnceki = useRef<{ kip: KipKimligi; karakterGorunur: boolean; hazir: boolean } | null>(null);
  useEffect(() => {
    const o = ayarOnceki.current;
    ayarOnceki.current = { kip, karakterGorunur, hazir: a.modHazir };
    if (o && o.hazir && (o.kip !== kip || o.karakterGorunur !== karakterGorunur)) kullaniciEtkinligi();
  }, [kip, karakterGorunur, a.modHazir]);
  const turSuruyor = a.hal !== 'bos' || Boolean(a.calisiyor);
  const ilkKip = useRef(true);
  useEffect(() => {
    const anlik = ilkKip.current || !a.modHazir;
    if (a.modHazir) ilkKip.current = false;
    setKipi((d) => centikKipiAdimi(d, { tur: 'mod', kip, gorunur: !gizli && !anlik, turSuruyor: !anlik && turSuruyor }));
  }, [kip, a.modHazir]);
  useEffect(() => { if (!turSuruyor) setKipi((d) => centikKipiAdimi(d, { tur: 'tur-bitti', gorunur: !gizli })); }, [turSuruyor]);
  const gecisBitti = useCallback(() => setKipi((d) => centikKipiAdimi(d, { tur: 'bitti' })), []);
  const hk = kipi.gorunen; // hâl karakterlerinin kipi (tur sürerken eski karakter)
  const vurgu = kipVurgusu(kipi.gorunen);
  const konusuyor = a.hal === 'konusuyor' || a.konusuyor;
  // İş izi (11 Kas): iş hapının ve listesinin süresi yalnız aktif iş görünürken saniyede bir; biten satır tik çizip hapın işaretine uçar (480 ms).
  const isSimdi = useSaniye((hal === 'gorev' || hal === 'isler') && (a.adaDurumu.islerAktif ?? 0) > 0);
  const isHedefi = useCallback(() => document.querySelector('.ada__katman:not(.ada__katman--cikan) [data-is-hedef]'), []);
  useBitisUcusu(a.centikIsleri, isHedefi);

  const b: AdaBildirimi | null = a.bildirim;
  // Katmanın kimliği: hal + gösterilen öğe. Kart kapanıp sıradaki kart gelince (hal aynı) de içerik çapraz solar, ani kesilmez.
  // 0.14 T22: aynı türden art arda uyarı (ses tuşu) aynı katmanda yerinde güncellenir (çubuk kayar, solma yok); başka tür çapraz solar.
  const anahtar = hal === 'bildirim' || hal === 'kart' ? `${hal}:${b?.no}` : hal === 'onay' ? `onay:${a.onaylar[0]?.id}` : hal === 'uyari' ? `uyari:${a.uyari?.tur}` : hal;
  const gonder = () => { if (!metin.trim()) return; void a.gonder(metin, false); setMetin(''); };

  /** Soru kutusunda (ve motorsuz kutu kartında) bekleyen çip — düzeltme 3: hatırlatıcı kendi çipiyle (başlığıyla), tıklanınca açılır;
   *  bilgi bildirimi "Bildirim var". `yalnizHatirlatma`: motor kartında yalnız hatırlatıcı gösterilir (gömülmesin). */
  const cipCiz = (yalnizHatirlatma = false): ReactNode => {
    const cip = bekleyenCip(a.adaDurumu, a.bildirim?.kaynak === 'hatirlatma' ? a.bildirim.baslik : undefined);
    if (!cip || (yalnizHatirlatma && cip.tur !== 'hatirlatma')) return null;
    return cip.tur === 'hatirlatma'
      ? <button type="button" className="ada__bekleyen ada__bekleyen--hatirlatma" data-cip="hatirlatma" onClick={a.hatirlatmayiAc} title="Hatırlatıcıyı aç"><Ikon ad="zil" olcu={12} /><span>{cip.metin}</span></button>
      : <span className="ada__bekleyen" role="status" data-cip={cip.tur}>{cip.metin}</span>;
  };

  const icerikCiz = (): ReactNode => {
    switch (hal) {
      case 'uyari':
        return a.uyari && <UyariHapi u={a.uyari} />;
      case 'dinlenme':
        // 0.14 T19 (R13): boşta, gösterecek bir şey yok — gözler çentikten bakar. 0.14 T23: tıklayınca panel Asistan sayfasıyla (gözler selam verir, yazı alanı odakta).
        return (
          <button type="button" className="ada__satir ada__satir--orta ada__dinlenme" onClick={a.panelTikla} aria-label={`${a.karakterAdi}: Fuber'e sor`}>
            <DinlenmeYuzu kip={kipi.gorunen} gecis={kipi.gecis} bitti={gecisBitti} azHareket={azHareket} olcek={a.olcek} karakterGorunur={karakterGorunur} odakta={odakAkiyor} />
          </button>
        );
      case 'sessiz': {
        // 0.14 T19 (R13): Kapalı hap — boşta ama medya çalıyor ya da Fuber'in mesajı noktada bekliyor: solda saat, sağda simge (mesaj noktası ya da medya).
        const nokta = fuberNoktasiVar(a.adaDurumu);
        const saatMetni = new Date(saatMs).toLocaleTimeString(a.dil || 'tr-TR', { hour: '2-digit', minute: '2-digit' });
        return (
          <button type="button" className="ada__satir ada__kapali" onClick={a.panelTikla} aria-label={nokta ? `${saatMetni} · Fuber'e sor · yeni mesaj var` : `${saatMetni} · Fuber'e sor`}>
            <span className="ada__saat">{saatMetni}</span>
            <span className="ada__sag">
              {nokta
                ? <span className="ada__nokta ada__nokta--mesaj" data-fuber-nokta="" />
                : a.adaDurumu.medya && <span className="ada__medya ada__esitleyici" data-medya="" aria-hidden="true"><i /><i /><i /><i /></span>}
            </span>
          </button>
        );
      }
      case 'panel':
        // 0.14 T23 (R13, R20): açık panel — üst satır, sayfa (Asistan ya da kayıtlı sayfa; kaydı yoksa tek satır boş durum), noktalar ve oklar.
        return <Panel sayfa={a.sayfa} sayfalar={a.sayfalar} sec={a.sayfaSec} dil={a.dil} kip={kipi.gorunen} medya={a.adaDurumu.medya} azHareket={azHareket} />;
      case 'bildirim':
        return b && (
          <button type="button" className="ada__satir" onClick={a.kartiAc} title={b.baslik}>
            <span className="ada__simge" data-tur={b.tur}>{bildirimSimgesi(b.tur, 16)}</span>
            <span className="ada__baslik">{b.baslik}</span>
            {b.metin && <span className="ada__onizleme">{duz(b.metin)}</span>}
            <span className="ada__sag"><Sayac toplam={a.bildirimSayisi} /><span className="ada__zaman" data-tur={b.tur}>{neZaman(b.zaman)}</span></span>
          </button>
        );
      case 'kart':
        return b && (
          <>
            <div className="ada__kaydir ada__kart" data-soz={b.soz ? '' : undefined}>
              <div className="ada__ust">
                <span className="ada__simge" data-tur={b.tur}>{bildirimSimgesi(b.tur, 14)}</span>
                <span>{b.soz ? b.baslik : b.tur === 'hatirlatma' ? 'Hatırlatma' : 'Fuber'} · {neZaman(b.zaman)}</span>
                <span className="ada__sag"><Sayac toplam={a.bildirimSayisi} /></span>
              </div>
              {!b.soz && <div className="ada__kart-baslik">{b.baslik}</div>}
              {b.metin && <Markdown metin={b.metin} className="md ada__md" />}
            </div>
            <div className="ada__alt ada__alt--kart">
              {a.bildirimKonusuyor
                ? <button type="button" className="dgm dgm--beyaz dgm--k" onClick={a.sustur}><Ikon ad="dur" olcu={13} />Sustur</button>
                : <button type="button" className="dgm dgm--beyaz dgm--k" onClick={a.bildirimiKaldir}>Tamam</button>}
              <button type="button" className="dgm dgm--koyu dgm--k" onClick={a.bildirimiAc}>Aç</button>
            </div>
          </>
        );
      case 'sor':
        return (
          <div className="ada__sor">
            <input
              value={metin} placeholder="Fuber'e sor…" autoFocus aria-label="Fuber'e sor" spellCheck={false}
              onChange={(e) => setMetin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') gonder(); }}
            />
            {/* B10: yazarken gelen onay/bildirim kutuyu örtmez, burada bekler; gönderince ya da kutuyu kapatınca iner. */}
            {cipCiz()}
            {/* Mikrofon tamamen kapalıysa "Sesle sor" yok: yalnız yazarak (sol menüdeki mikrofon). */}
            {metin.trim() || a.mikrofonKapali
              ? <button type="button" className="dgm dgm--beyaz dgm--simge ada__yuvarlak" title="Gönder (Enter)" aria-label="Gönder" disabled={!metin.trim()} onClick={gonder}><Ikon ad="gonder" olcu={16} kalinlik={2} /></button>
              : <button type="button" className="dgm dgm--koyu dgm--simge ada__yuvarlak" title="Sesle sor" onClick={() => void a.dinlemeyiBaslat()}><Ikon ad="mikrofon" olcu={16} /></button>}
          </div>
        );
      case 'dinliyor':
        return (
          <div className="ada__satir ada__dinle">
            {/* 0.14 T23 (11 Kas): dinleyen gözler — göz büyür, bebek genişler. */}
            <HalKarakteri kip={hk} boyut={36} azHareket={azHareket} hal="dinliyor" />
            <div className="ada__metinler">
              <span className="ada__baslik">Dinliyorum…</span>
              <span className="ada__kismi"><span>{a.soru || 'Konuş, seni dinliyorum'}</span></span>
            </div>
            <div className="ada__dalga" aria-hidden="true">
              {/* Çubuk 30 px sabit; düzey yalnız scaleY ile (4 px … 30 px) — Hafiflik: yükseklik canlandırılmaz. */}
              {a.seviyeler.map((v, i) => <i key={i} style={{ transform: `scaleY(${((4 + v * 26) / 30).toFixed(3)})`, opacity: 0.35 + v * 0.65 }} />)}
            </div>
          </div>
        );
      case 'dusunuyor':
        return (
          <div className="ada__satir ada__satir--orta" role="status">
            <span className="ada__isik ada__isik--canli" /><span className="ada__parilti">{a.hal === 'yaziya' ? 'Anlıyorum…' : 'Düşünüyorum…'}</span>
          </div>
        );
      case 'yanit': {
        const yaziyor = a.hal === 'dusunuyor';
        const yalnizHata = Boolean(a.hata) && !a.soru && !a.yanit && !a.araclar.length && !a.kartlar.length;
        // 0.11 G6: tamamı ana sohbette — "Sohbette gör" aynı yola gider ("Aç" ile aynı: ana pencere öne gelir, ada çekilir).
        const sohbeteGit = () => { void cagir('ana:goster'); a.kapat(); };
        return (
          <>
            <div className="ada__kaydir ada__yanit" onScroll={(e) => { const el = e.currentTarget; altta.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
              {a.soru && <div className="ada__soru">{a.soru}</div>}
              {a.araclar.length > 0 && <div className="ada__araclar"><AracAdimlari bloklar={a.araclar} ada sohbeteGit={sohbeteGit} /></div>}
              {a.kartlar.length > 0 && <div className="ada__araclar">{a.kartlar.map((k, i) => <KartOzeti key={i} kart={k} sohbeteGit={sohbeteGit} />)}</div>}
              {a.karakter && (a.yanit || a.araclar.length > 0) && (
                <div className="ada__karakter">
                  {/* 0.14 T23: yanıt akarken ya da sesi çalarken karakter konuşur (çene salınır); bitince sakin yüz. */}
                  <HalKarakteri kip={hk} boyut={24} azHareket={azHareket} hal={konusuyor || yaziyor ? 'konusuyor' : 'sakin'} />
                  {a.karakter}
                </div>
              )}
              {a.yanit && <Markdown metin={a.yanit} className="md ada__md ada__cevap" />}
              {a.hata && <div className="ada__hata" role="alert"><HalKarakteri kip={hk} boyut={24} azHareket={azHareket} ifade="hata" />{a.hata}{a.dikteYeniden && <> <button type="button" className="dgm dgm--beyaz dgm--k" onClick={a.dikteYeniden}>Yeniden dene</button></>}</div>}
            </div>
            <div className="ada__alt">
              {yalnizHata ? (
                <>
                  <button type="button" className="dgm dgm--beyaz dgm--k" onClick={a.yeniSoru}>Yazarak sor</button>
                  <button type="button" className="dgm dgm--koyu dgm--k" onClick={a.kapat}>Kapat</button>
                </>
              ) : (
                <>
                  {a.hal === 'konusuyor' || a.konusuyor
                    ? <button type="button" className="dgm dgm--beyaz dgm--k" data-sustur="" onClick={a.sustur}><Ikon ad="dur" olcu={13} />Sustur</button>
                    : <button type="button" className="dgm dgm--beyaz dgm--k" onClick={a.kapat}>Tamam</button>}
                  {/* Ana pencere öne gelir: ada onun üstünde kalmasın, geri çekilir (yanıt ana sohbette). */}
                  <button type="button" className="dgm dgm--koyu dgm--k" title="Ana sohbette aç" onClick={() => { void cagir('ana:goster'); a.kapat(); }}>Aç</button>
                  <span className="ada__bosluk" />
                  {yaziyor
                    ? <span className="ada__durum"><span className="ada__isik ada__isik--canli" />yazıyor</span>
                    : (
                      <>
                        <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" title="Yeni soru" aria-label="Yeni soru" onClick={a.yeniSoru}><Ikon ad="kalem" olcu={15} /></button>
                        {!a.mikrofonKapali && <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" title="Sesle sor" aria-label="Sesle sor" onClick={() => void a.dinlemeyiBaslat()}><Ikon ad="mikrofon" olcu={15} /></button>}
                      </>
                    )}
                </>
              )}
            </div>
          </>
        );
      }
      case 'onay':
        return (
          <div className="ada__kaydir ada__onay">
            {/* 0.14 T23: karar senden — düşünen yüz kartın sağ üstünde. */}
            <span className="ada__onay-karakter"><HalKarakteri kip={hk} boyut={32} azHareket={azHareket} ifade="dusunuyor" /></span>
            <Sayac toplam={a.onaylar.length} />
            <OnayKarti o={a.onaylar[0]} karar={a.onayla} />
          </div>
        );
      case 'ekranda':
        return (
          // Tuş yalnız gerçekten alındıysa yazılır (Görev 20b düzeltme turu 2); alınamadıysa tepsiye yönlendirir.
          <div className="ada__satir ada__ekranda" role="status" aria-label={`Fuber ekranında çalışıyor · durdurmak için ${acilTus ?? ACIL_YEDEK}`} title={`Fuber ekranında çalışıyor · durdurmak için ${acilTus ?? ACIL_YEDEK}`}>
            <span className="ada__nokta ada__nokta--calisiyor" />
            <span className="ada__baslik">Fuber ekranında çalışıyor</span>
            <span className="ada__tus" data-acil-tus={acilTus ? '' : 'yok'}>{acilTus ? `Durdur: ${acilTus}` : 'Durdur: tepsiden'}</span>
          </div>
        );
      case 'motor-hap': {
        // A2: boşta + bağlantı koptu = küçük hap (kırmızı nokta + kısa metin); üstüne gelince ya da tıklayınca tam kart açılır.
        const kisa = motor?.kisa ?? MOTOR_HAP_METNI;
        return (
          <button type="button" className="ada__satir ada__satir--orta ada__motor-hap" onClick={a.motorKartiAc} aria-label={`${kisa} — ayrıntı`} title="Ayrıntı için tıkla">
            <span className="ada__nokta ada__nokta--acil" /><span className="ada__ad">{kisa}</span>
          </button>
        );
      }
      case 'motor-durdu':
        if (!motor) return null;
        return (
          <>
            <div className="ada__kaydir ada__motor" role={motor.seviye === 'kirmizi' ? 'alert' : 'status'} data-seviye={motor.seviye}>
              <div className="ada__motor-ust"><span className={`ada__nokta ${motor.seviye === 'kirmizi' ? 'ada__nokta--acil' : 'ada__nokta--notr'}`} /><span className="ada__baslik">{motor.baslik}</span>{cipCiz(true)}</div>
              {motor.metin && <p className="ada__motor-metin">{motor.metin}</p>}
            </div>
            {(motor.dugme || motor.ikincil) && (
              <div className={`ada__alt ada__alt--kart${motor.eylem === 'yerel-kur' ? ' ada__alt--sarmal' : ''}`}>
                {motor.eylem === 'yerel-kur' ? <YerelYenidenIndirDugmeleri b={motor} sonra={a.kapat} /> : <>
                {motor.dugme && <button type="button" className="dgm dgm--k dgm--beyaz" data-eylem={motor.eylem} onClick={() => motorEylemi(motor, a.kapat)}>{motor.dugme}</button>}
                {motor.ikincil && <button type="button" className="dgm dgm--k dgm--koyu" data-cipa={motor.ikincil.cipa} data-eylem={motor.ikincil.eylem} onClick={() => motorEylemi(motor.ikincil!, a.kapat)}>{motor.ikincil.etiket}</button>}
                </>}
              </div>
            )}
          </>
        );
      case 'isler':
        // İş izi (11 Kas): hapın üstüne gelince açılan liste — üstte aynı hap, altında en çok 3 satır (durum işareti, kim, canlı fiil, yer, süre); satıra
        // tıklayınca o yere gidilir (ana pencere öne gelir, çentik çekilir). Fazlası "+N iş daha".
        return (
          <div className="ada__is-acik">
            <div className="ada__is-ust">{isHapi()}</div>
            <div className="ada__is-liste" style={isVurguStili(hk)}>
              {a.centikIsleri.slice(0, 3).map((is) => (
                <IsSeridi key={is.id} is={is} simdi={isSimdi} cesit="centik" yer tikla={() => { isGit(is); a.kapat(); }} />
              ))}
              {a.centikIsleri.length > 3 && (
                <button type="button" className="ada__is-kalan" onClick={() => { void cagir('ana:goster', 'kokpit'); a.kapat(); }}>+{a.centikIsleri.length - 3} iş daha · Kokpitte gör</button>
              )}
            </div>
          </div>
        );
      case 'gorev':
        return isHapi();
    }
  };

  /** İş hapı (görev adımı, sohbet turu ya da iş izinin işleri): 'gorev' hâlinin kendisi ve 'isler' listesinin üst satırı. */
  function isHapi(): ReactNode {
    {
      {
        // 0.11 G10 (spec §8): bir görev adımı çalışırken ya da görev ekranı tutarken küçük hap "Görev: <başlık>" + Durdur. Hal kuralı shared/ada.ts'te tek
        // yerde. Ekran kontrolü sürerken "ekranda" halinin yerini alır: acil durdurma tuşu hapta yazar, Durdur düğmesi o sırada da tıklanır (ana süreç yalnız
        // bu düğmenin üstünde tıklamayı yakalar: src/main/ada.ts durdurUzerinde). Birden çok görevin adımı sürüyorsa "+N".
        // İş izi (11 Kas): halkanın çevresinde paralel iş sayısı kadar nokta döner (IsYorungesi); görev/sohbet hapı yoksa iş izinin kendi hapı.
        const g = a.gorev;
        if (!g && !a.calisiyor) {
          const aktif = a.centikIsleri.filter((x) => aktifMi(x.hal));
          if (!a.centikIsleri.length) return null;
          const bitenAjan = a.centikIsleri.filter((x) => x.kaynak === 'cc-ajan');
          const metin = aktif.length ? centikOzeti(aktif) : (yardimciOzeti(bitenAjan) || 'Bitti');
          const ilk = aktif[0] ?? a.centikIsleri[0];
          return (
            <button type="button" className="ada__satir ada__gorev ada__is-hap" data-is-hap="" aria-label={`${metin} · ${ilk.nerede.ad}`} title={`${ilk.nerede.ad} sayfasını aç`}
              style={isVurguStili(hk)} onClick={() => { isGit(ilk); a.kapat(); }}>
              <span className="ada__halka ada__halka--is" data-yorunge="" style={{ ['--halka-vurgu' as string]: kipVurgusu(hk) }}>
                <IsYorungesi sayi={aktif.length} olcu={26}>
                  {aktif.length === 0
                    ? <IsIsareti hal="bitti" olcu={20} />
                    : karakterGorunur ? <HalKarakteri kip={hk} boyut={26} azHareket={azHareket} hal="calisiyor" /> : <UrunIsareti olcu={16} renk="currentColor" />}
                </IsYorungesi>
              </span>
              <span className="ada__baslik"><FiilGecisi metin={metin} /></span>
              {aktif.length > 0 && <span className="ada__is-sure">{isSuresi(isSimdi - Math.min(...aktif.map((x) => x.baslangic)))}</span>}
              <Ikon ad="ileri" olcu={14} />
            </button>
          );
        }
        const yorunge = a.adaDurumu.islerAktif ?? 0;
        if (!g) {
          // 0.14 T13 (R13): görev adımı yokken eşiği aşan sohbet turu aynı hapla: "Çalışıyor · N. adım · <süren aracın etiketi>" + Durdur (sohbet:durdur).
          const c = a.calisiyor;
          if (!c) return null;
          const metin = calisiyorHapMetni({ adim: c.adim, etiket: isGuvenliMetin(c.etiket, a.motorBilgi.mod, '') ?? '' });
          const ekranda = a.adaDurumu.ekranda;
          return (
            <div className="ada__satir ada__gorev ada__calisiyor" role="status" data-calisiyor-sohbet={String(c.sohbetId)} data-ekran={ekranda ? '' : undefined} aria-label={metin} title={metin}>
              {/* 0.14 T23 (11 Kas): düşünen gözler, çevresinde kipin vurgusunda halka; "Adım N", süren işin etiketi, Durdur. */}
              <span className="ada__halka" data-yorunge={yorunge > 1 ? '' : undefined} style={{ ['--halka-vurgu' as string]: kipVurgusu(hk), ...isVurguStili(hk) }}>
                <IsYorungesi sayi={yorunge > 1 ? yorunge : 0} olcu={26}>
                  {karakterGorunur ? <HalKarakteri kip={hk} boyut={26} azHareket={azHareket} hal="calisiyor" /> : <UrunIsareti olcu={16} renk="currentColor" />}
                </IsYorungesi>
              </span>
              <span className="ada__adim">{calisiyorAdimMetni(c.adim)}</span>
              {a.gorevHatasi
                ? <span className="ada__baslik ada__gorev-hata" role="alert" title={a.gorevHatasi}>{a.gorevHatasi}</span>
                : c.etiket.trim() && <span className="ada__baslik ada__calisiyor-etiket"><MetinKirp metin={isGuvenliMetin(c.etiket, a.motorBilgi.mod, '') ?? ''} satir={1} as="span" /></span>}
              <button type="button" className="dgm dgm--beyaz dgm--k ada__gorev-durdur" data-calisiyor-durdur="" aria-label={`Durdur: ${metin}`}
                onMouseEnter={() => a.durdurFare(true)} onMouseLeave={() => a.durdurFare(false)} onClick={() => a.calisiyorDurdur(c.sohbetId)}>Durdur</button>
            </div>
          );
        }
        // Başlık İş modunda yasak sözcük taşırsa gösterilmez (Etkinlik/Görevler kartıyla aynı kural, aynı yardımcı): hap yalnız "Görev" der.
        const metin = gorevHapMetni(isGuvenliMetin(g.baslik, a.motorBilgi.mod, '') ?? '');
        const ekranda = a.adaDurumu.ekranda;
        const tus = acilTus ?? ACIL_YEDEK;
        return (
          <div className="ada__satir ada__gorev" role="status" data-gorev-id={String(g.id)} data-ekran={ekranda ? '' : undefined}
            aria-label={`${metin}${g.sayi && g.sayi > 1 ? ` ve ${g.sayi - 1} görev daha` : ''} çalışıyor${ekranda ? ` · hepsini durdurmak için ${tus}` : ''}`} title={metin}>
            <span style={isVurguStili(hk)}><IsYorungesi sayi={yorunge > 1 ? yorunge : 0} olcu={10}><span className="ada__nokta ada__nokta--calisiyor" /></IsYorungesi></span>
            {/* Başlık kullanıcının/yapay zekânın metni: uzunsa tek satırda … ile biter (bilinçli kırpma; tamamı title'da), hapı taşırmaz. */}
            {a.gorevHatasi
              ? <span className="ada__baslik ada__gorev-hata" role="alert" title={a.gorevHatasi}>{a.gorevHatasi}</span>
              : <span className="ada__baslik"><MetinKirp metin={metin} satir={1} as="span" /></span>}
            {g.sayi && g.sayi > 1 && <span className="ada__sayac" title={`${g.sayi} görevin adımı sürüyor`}>+{g.sayi - 1}</span>}
            {ekranda && <span className="ada__tus" data-acil-tus={acilTus ? '' : 'yok'} title="Hepsini durdurur">{acilTus ? `Acil: ${acilTus}` : 'Acil: tepsiden'}</span>}
            <button type="button" className="dgm dgm--beyaz dgm--k ada__gorev-durdur" data-gorev-durdur="" aria-label={`Durdur: ${metin}`}
              onMouseEnter={() => a.durdurFare(true)} onMouseLeave={() => a.durdurFare(false)} onClick={() => a.gorevDurdur(g.id)}>Durdur</button>
          </div>
        );
      }
    }
  }
  const icerik = icerikCiz();

  // Hal ya da gösterilen öğe değişti: şekil yaylı geçer, eski katman solarak çıkar (ada toplanmışken görünen bir şey yoktu,
  // çıkış çizilmez). Akan yanıtın büyümesi (aynı katman) sakin ve yaysızdır.
  useLayoutEffect(() => {
    setYayli(true);
    const once = son.current;
    if (once && once.anahtar !== anahtar && !once.gizli && !gizli) setCikan(once);
    const t1 = setTimeout(() => setYayli(false), 480);
    const t2 = setTimeout(() => setCikan(null), 220);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [anahtar, gizli]);

  // İçerik boyundaki hallerde boy ölçülür (yeni katman ilk karede, sonra her büyümede).
  useLayoutEffect(() => {
    const el = katman.current;
    if (!el || !icerikli) return;
    const olc = () => setIcerikBoy(el.offsetHeight);
    olc();
    const ro = new ResizeObserver(olc);
    ro.observe(el);
    altta.current = true;
    return () => ro.disconnect();
  }, [anahtar, icerikli]);

  useLayoutEffect(() => { son.current = { anahtar, icerik, en: olcu.en, boy, sabit: !icerikli, gizli }; });

  // Akan yanıt alttan izlenir (okumak için yukarı kaydırılmadıysa). Kayan kısım katmanın içindeki .ada__kaydir'dır.
  useEffect(() => {
    const el = katman.current?.querySelector<HTMLElement>('.ada__kaydir');
    if (hal === 'yanit' && el && altta.current) el.scrollTop = el.scrollHeight;
  }, [hal, a.yanit, a.araclar, a.kartlar, a.hata]);

  // Soru kutusu boşken başka yere tıklanınca (pencere odağı gitti) ada geri çekilir.
  const odakDurumu = useRef({ hal, metin });
  odakDurumu.current = { hal, metin };
  const kapat = useRef(a.kapat);
  kapat.current = a.kapat;
  useEffect(() => {
    const bulanik = () => { const d = odakDurumu.current; if ((d.hal === 'sor' || d.hal === 'motor-durdu') && !d.metin.trim()) kapat.current(); };
    window.addEventListener('blur', bulanik);
    // Klavye girdisi de kullanıcı etkinliğidir (panelde yazı alanı, ok tuşları): dinlenmeye dönünce yüz uyanık başlar.
    window.addEventListener('keydown', kullaniciEtkinligi, true);
    return () => { window.removeEventListener('blur', bulanik); window.removeEventListener('keydown', kullaniciEtkinligi, true); };
  }, []);

  const katmanStili = (c: { en: number; boy: number; sabit: boolean }) => ({ top: ust, width: c.en, height: c.sabit ? c.boy : undefined });

  // Biçim (0.14 T19, R15): dokuz dilim CentikSekli yalnız transform'la büyür; `.ada__sekil` imleç kutusudur — ölçüsü anında yerleşir, canlandırılmaz.
  const sekilEn = gizli ? DINLENME.en : olcu.en;
  const sekilBoy = gizli ? 0 : boy + ust;
  // Ölçek (R15) kökte CSS zoom'la: yerleşim yeniden yapılır, yazı ve karakter o ekranın ölçeğinde keskin çizilir (transform'la büyütme bulanıklaştırırdı).

  return (
    <AdaBaglami.Provider value={{ a, azHareket, kipi, gecisBitti }}>
    <div
      className="ada koyu-bolge" data-ada-hal={hal} data-cekik={gizli ? '' : undefined} data-centik={a.centik ? '' : undefined}
      data-tehlike={hal === 'onay' ? a.onaylar[0]?.tehlike : undefined}
      data-az-hareket={azHareket ? '' : undefined} data-konusuyor={konusuyor ? '' : undefined} data-panel-sabit={a.panelAcik ? '' : undefined}
      data-medya-caliyor={a.adaDurumu.medya && !gizli ? '' : undefined} data-odak={odakI && bosHal && !gizli ? (odakI.akiyor ? 'akiyor' : 'durdu') : undefined}
      style={{ ...(a.olcek !== 1 ? { zoom: a.olcek } : {}), ['--ada-vurgu' as string]: vurgu }}
    >
      <div
        className="ada__sekil" data-gecis={yayli ? 'yay' : 'akis'}
        style={{ width: sekilEn, height: sekilBoy }}
        onMouseEnter={() => a.fare(true)} onMouseLeave={() => a.fare(false)}
        onMouseMove={(e) => a.surukleHareketi(e.buttons)} onMouseDown={a.icerdeBasildi}
        onMouseMoveCapture={kullaniciEtkinligi} onPointerDownCapture={kullaniciEtkinligi} onWheelCapture={kullaniciEtkinligi}
        // 0.14 çentik cilası: hover 60 ms'de paneli açtığı için hızlı bir tıklama çoğu zaman hover'la açılmış panele düşer — denetim olmayan yere tıklama da R13'ün
        // tıklamasıdır (gözler selam verir, panel Asistan'la sabitlenir, yazı alanı odakta). R13 gibi panel Asistan sayfasına geçer; düğme, bağlantı, yazı alanı ve kaydırıcı kendi işini yapar.
        onClick={(e) => { if (hal === 'panel' && !a.panelAcik && !(e.target as HTMLElement).closest('button, a, input, textarea, select, [role="slider"], [role="tab"]')) a.panelTikla(); }}
      >
        <CentikSekli en={sekilEn} boy={sekilBoy} kose={centikKosesi(hal, sekilBoy, icerikli)} omuz={!gizli} />
        <AdaIsigi en={sekilEn} boy={sekilBoy} kose={centikKosesi(hal, sekilBoy, icerikli)} anahtar={anahtar} gizli={gizli} icerikli={icerikli}
          odak={odakI && bosHal ? { ...odakI, renk: odakI.tur === 'odak' ? sayfaVurgusu('odak') : null } : null} />
        {cikan && <div className={`ada__katman ada__katman--cikan${cikan.sabit ? '' : ' ada__katman--icerik'}`} inert aria-hidden="true" style={katmanStili(cikan)}>{cikan.icerik}</div>}
        <div
          key={anahtar} ref={katman} className={`ada__katman${icerikli ? ' ada__katman--icerik' : ''}`}
          style={katmanStili({ en: olcu.en, boy, sabit: !icerikli })}
        >
          {icerik}
        </div>
      </div>
    </div>
    </AdaBaglami.Provider>
  );
}
