// ── Kokpit (ana ekran) ───────────────────────────────────────────────────────────────────────────────────────
// Solda yapay zekânın yerleştirdiği kart ızgarası (yerleşim ana süreçte kokpit/duzen.ts'te planlanır; burada
// shared/izgara.ts ile ızgaranın o anki genişliğine göre 12/6/1 sütuna deliksiz dizilir), sağda ana sohbet ("Fuber").
// Yerleşim değişince kartlar View Transitions ile yeni yerlerine akar. Önemi artan ya da yeni beliren kart kısa bir
// ışık süpürmesiyle parlar, sonra ince renkli kenarına iner.
// Görev 24 (K14, "dolu pano"): zihin bandının altında her zaman GÜNDEM bandı (bugün bekleyenler + gündemdeki konular); verisi
// olmayan kart hiç çizilmez; görünen alanda kalan satırlar doldurucularla (hava, haberler, araç kiti, döviz, öneriler) tam doldurulur
// (shared/pano-duzen.ts). Görünen alanın yüksekliği burada ölçülür; satır yüksekliği alanı tam dolduracak kadar uzar (en az 92 px).
// 0.11 G5: her hücre kütüphanenin Kart'ıdır (src/renderer/ui; kartlar pano/PanoKartlari.tsx, pano/KullaniciKartlari.tsx): aynı başlık ve
// eylem yeri, kartta kaydırma yok (fazlası "Tümü"). Görevler kartı (0.11 G10, pano/GorevlerKarti.tsx): görev varken gündem bandının altında
// data-kart="gorevler"; görev yokken G5'in boş, görünmez yuvası ızgarada yer tutmaz; ilk kullanımda bir kez ızgaranın üstünde tek satır.
// 0.14 T30 (Nusa dili): kök ekranın TEK vurgusunu taşır (ui/vurgu.ts vurguStili('kokpit'), kokpit mavisi); sağdaki sohbet paneli kendi kökü
// değildir (ekranKoku=false), vurguyu miras alır. Kartların iç görünümü pano/pano.css'te (büyük sıkı sayılar, haplar, derin siyah).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { cagir, dinle } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { vurguStili } from '../ui/vurgu';
import { Sohbet } from '../bilesenler/Sohbet';
import { GunKaydiKarti, MeselelerKarti } from '../bilesenler/DusunmeKart';
import { YapilacaklarKarti } from '../bilesenler/YapilacaklarKarti';
import { GizliGeriAlindiNotu, YerelBekleyenBildirim } from '../bilesenler/YerelKurulum';
import { motorEylemiYap, useMotorSinyali } from '../motor-sinyali';
import { motorBildirimi, motorCipEylemi, yalnizYerelSecili } from '../../shared/motor-durumu';
import type { KokpitDurumu, KartYerlesimi, KartOnemi } from '../../shared/tipler';
import { sutunSec, onemOku, onemDegisti, type SutunSayisi } from '../../shared/izgara';
import { MESGUL_MESAJI } from '../../shared/mesgul';
import { gorunumGecisi } from '../gecis';
import { useSilmeler } from '../geri-al';
import { tostGoster } from '../tostlar';
import { usePano, notrPano } from '../pano/usePano';
import { GundemBandi, HavaKarti, HaberlerKarti, PiyasaKarti, IpuclariKarti, HizliIsler, MotorIpucu, GizliMod, AracsizMod, type Hucre } from '../pano/PanoKartlari';
import { EpostaKarti, HafizaKarti, HatirlaticilarKarti, IceAktarmaKarti, OnerilerKarti, OzelKart, ProjelerKarti, SohbetlerKarti, WhatsappKarti, ZihinBandi } from '../pano/KullaniciKartlari';
import { istemOnerilir, type Istem } from '../../shared/kokpit-istemleri';
import { SohbetBaslangic } from '../pano/SohbetBaslangic';
import { SohbetSecici } from '../pano/SohbetSecici';
import { useKokpitSohbet } from '../pano/useKokpitSohbet';
import { GorevBosIpucu } from '../pano/GorevlerKarti';
import { SuAnKarti } from '../is-izi/SuAn';
import { useIsIzi } from '../is-izi/depo';
import { gorevleriKat, ustGruplari } from '../../shared/is-izi';
import { YenilikKarti, useYenilikKarti } from '../pano/YenilikKarti';
import { useGorevKarti } from '../pano/useGorevler';
import { GOREV_BOS_METNI } from '../../shared/isler-gorunum';
import { panoDiz, kartDoluMu, boylariIcerigeGore, DOLGU_TIPLERI, hedefSatirHesapla, satirPikselleri, ARALIK_PX, SATIR_PX, type PanoDuzeni } from '../../shared/pano-duzen';
import { bantMi, izgaraDiz, type Boy } from '../../shared/izgara';
import type { PanoDurumu } from '../../shared/pano';
import type { IsOzet } from '../../shared/isler';
import type { KartTipi } from '../../shared/tipler';
import { bantDisiVeri, bantHaberleri } from '../../shared/kokpit-tekil';

/** Doldurucu şu an gösterilebilir mi: kaynağı açık ve verisi var ya da geliyor (bağlantısız ilk açılışta haber/döviz yoksa yer
 *  tutmaz; hava kartı ağsız da dolu: şehir, saat, gün doğumu/batımı). */
function dolguKullanilabilir(t: KartTipi, p: PanoDurumu): boolean {
  if (t === 'hava') return p.hava.durum !== 'kapali';
  // 11 Kas (bulgu 6): Gündemde'nin gösterdiği haberlerden başka haber yoksa Haberler kartı yer tutmaz (yinelenen kart yok).
  if (t === 'haberler') {
    if (p.haberler.durum === 'yukleniyor') return true;
    if (p.haberler.durum !== 'hazir') return false;
    const hepsi = p.haberler.veri ?? [];
    const bantta = bantHaberleri(p.gundem.durum === 'hazir' ? (p.gundem.veri ?? []) : [], hepsi);
    return hepsi.some((x) => !bantta.has(x.id));
  }
  if (t === 'piyasa') return p.piyasa.durum === 'hazir' || p.piyasa.durum === 'yukleniyor';
  return true;
}

const ONEM_ADI: Record<KartOnemi, string> = { normal: '', dikkat: 'dikkat', acil: 'acil', olumlu: 'olumlu' };
const PARILTI_MS = 2800;
/** Etkinlik hapının yazısı (zihin:durum): 'bos' = hap yok. */
const ZIHIN_ADI: Record<string, string> = { dusunuyor: 'düşünüyor', dinliyor: 'dinliyor', konusuyor: 'konuşuyor' };

/** `yeniSohbet`: Ctrl+N sayacı (renderer/main.tsx) — kokpitteyken sayfa değişmeden panelde taslak sohbet açılır (0.11 G7).
 *  `turAcik`: tanıtım turu açık (renderer/main.tsx) — sürümün "yeni" kartı (0.12 H6: "0.12’de yeni") tur bitene dek gelmez (0.11 G12b; tur ızgarayı vurgular, kart onu kaydırmasın). */
export function Kokpit({ git, yeniSohbet = 0, turAcik = false }: { git: (sayfa: string, id?: number) => void; yeniSohbet?: number; turAcik?: boolean }) {
  const [d, setD] = useState<KokpitDurumu | null>(null);
  // Pano verisi gelmezse (ana süreç hatası, 1,5 sn) Kokpit nötr durumla çizilir: kokpit pano verisine bağımlı değil (düzeltme turu 1).
  const { pano: panoHam, bitti: panoBitti } = usePano();
  const notr = useMemo(() => notrPano(), []);
  const pano = panoHam ?? (panoBitti ? notr : null);
  // 0.11 G7: sohbet paneli birden çok sohbeti taşır (ana sohbet, son sohbetler, taslak); açılış kararı shared/kokpit-sohbet.ts.
  const ks = useKokpitSohbet(yeniSohbet);
  const anaId = ks.anaId;
  const [zihin, setZihin] = useState<string>('bos');
  // Motor sinyali (Ruling K; tek kaynak) — ızgara kararı (Görevler kartı) ve aşağıdaki kart tıklamaları aynı sinyali okur.
  const motorS = useMotorSinyali();
  // 0.11 G10: Görevler kartı. Görev varsa ızgarada (gündem bandının altında), yoksa görünmez; ilk kullanımda bir kez ızgaranın üstünde tek satır.
  // Gizli modda ya da yalnız bu bilgisayardaki yapay zekâda (aracsiz) görev başlatılamaz: o satır söylenmez. Bütün durum tek kancada
  // (pano/useGorevler.ts useGorevKarti): "bir kez" bayrağı yalnız kokpit verisi geldiyse ve pencere görünürken yazılır (G10 düzeltme turu 1, K5).
  const gorev = useGorevKarti({ hazir: Boolean(d && pano), aracsiz: motorS.aracsiz });
  const gorevHali = gorev.hali;
  // İş izi (11 Kas; tasarımcı bulgu 1, 6): Görevler kartının süren bölümü ile Etkinlik'in "Şu an"ı tek "Şu an" kartında (is-izi/SuAn.tsx). Kart canlı iş
  // ya da bugünün görevi varken ızgarada; boyu satır sayısından (üst işler + yardımcıları + bugün biten/duran görevler).
  const isler = useIsIzi();
  const canliSatir = useMemo(() => ustGruplari(gorevleriKat(isler, gorev.liste, new Date())).reduce((n, g) => n + 1 + g.cocuklar.length, 0), [isler, gorev.liste]);
  const bugunSatir = gorev.bugun;
  const suAnVar = gorevHali === 'liste' || canliSatir > 0;
  const gorevSayisi = Math.max(1, canliSatir + (bugunSatir ? Math.min(3, bugunSatir) + 1 : 0));
  // 0.11 G12b (0.12 H6: "0.12’de yeni"): sürümün yenilik kartı — yükselen profile bir kez, ızgaranın üstünde; durumu burada durur: kapanınca Kokpit yeniden çizilir ve görünen alan
  // yeniden ölçülür (olc ızgaranın üstündekileri düşer; kart kapanınca ızgaraya o kadar yer açılır).
  const yenilik = useYenilikKarti(turAcik);
  // Kokpitin üstünde aynı anda tek sakin öğe (0.11'de kart Görevler'i de anlatıyordu; 0.12 H6'da kart 0.12'yi anlatır, kural kaldı): kart göründüyse
  // (ve aynı oturumda "Tamam"la kapanınca da) G10'un ilk kullanım satırı ayrıca çıkmaz; satırın "bir kez" bayrağı yine yazılır (useGorevKarti), yani sonraki açılışlarda da çıkmaz.
  const yenilikGorundu = useRef(false);
  if (yenilik.goster) yenilikGorundu.current = true;

  useEffect(() => {
    void cagir<KokpitDurumu>('kokpit:al').then(setD);
    const g = (yeni: KokpitDurumu) => gorunumGecisi(() => flushSync(() => setD(yeni))); // atlanan geçiş konsolu kirletmez
    const k1 = dinle('kokpit:durum', g);
    const k2 = dinle('kokpit:veri-degisti', () => void cagir<KokpitDurumu>('kokpit:al').then(setD));
    const k3 = dinle('zihin:durum', setZihin);
    // Önem saate bağlı (hatırlatıcı yaklaştıkça dikkat → acil): yeniden planlama beklemeden dakikada bir tazelenir.
    const z = setInterval(() => void cagir<KokpitDurumu>('kokpit:al').then(setD).catch(() => undefined), 60_000);
    return () => { k1(); k2(); k3(); clearInterval(z); };
  }, []);

  // Sütun sayısı ızgaranın KENDİ genişliğinden (sohbet sütunu yer kaplar; pencere genişliği yanıltır).
  const olcu = useRef<HTMLDivElement>(null);
  const [sutun, setSutun] = useState<SutunSayisi>(12);
  useLayoutEffect(() => {
    const el = olcu.current;
    if (!el) return;
    const g = () => setSutun(sutunSec(el.clientWidth));
    g();
    const r = new ResizeObserver(g);
    r.observe(el);
    return () => r.disconnect();
  }, []);
  // Görünen alan (Görev 24): kokpit alanının iç yüksekliğinden ızgaranın üstündekiler (yerel beyin bildirimi), bantlar ve alttaki
  // "Yerleşimi Fuber seçti" notu düşülür → bantların altına kaç satır sığar. Bantların yüksekliği sabittir (veri gelince değişmez).
  const alanRef = useRef<HTMLDivElement>(null);
  const izgaraRef = useRef<HTMLDivElement>(null);
  const [alanPx, setAlanPx] = useState(0);
  const hazir = Boolean(d && pano);
  const olc = () => {
    const alan = alanRef.current, iz = izgaraRef.current;
    if (!alan || !iz) return;
    const cs = getComputedStyle(alan);
    const ust = parseFloat(cs.paddingTop) || 0, alt = parseFloat(cs.paddingBottom) || 0;
    const ic = alan.clientHeight - ust - alt;
    const once = iz.getBoundingClientRect().top - alan.getBoundingClientRect().top + alan.scrollTop - ust;
    const bantlar = [...iz.querySelectorAll<HTMLElement>(':scope > [data-bant]')].reduce((n, b) => n + b.offsetHeight + ARALIK_PX, 0);
    const not = alan.querySelector<HTMLElement>(':scope > .izgara-not');
    const h = Math.max(0, Math.floor(ic - once - bantlar - (not ? not.offsetHeight + 16 : 0)));
    setAlanPx((o) => (Math.abs(o - h) > 1 ? h : o)); // eşik: ölçüm ↔ çizim döngüsü olmasın
  };
  const olcRef = useRef(olc);
  olcRef.current = olc;
  // Pencere/bant boyu değişince ölç; her çizimden sonra da (ızgaranın üstündeki yerel beyin bildirimi belirip kaybolabilir — bu
  // ResizeObserver'a görünmez). Ölçüm ucuz; değer değişmedikçe yeniden çizim yok.
  useLayoutEffect(() => {
    const alan = alanRef.current, iz = izgaraRef.current;
    if (!alan || !iz) return;
    const r = new ResizeObserver(() => olcRef.current());
    r.observe(alan);
    for (const b of iz.querySelectorAll(':scope > [data-bant]')) r.observe(b);
    return () => r.disconnect();
  }, [hazir]);
  useLayoutEffect(() => { olcRef.current(); });
  const hedefSatir = hedefSatirHesapla(alanPx || 446);
  // 11 Kas (tasarımcı bulgu 6): Bugün bandında görünen kayıt Hatırlatıcılar ve Yapılacaklar kartlarında yinelenmez (shared/kokpit-tekil.ts);
  // kayıt kalmayan kart çizilmez. Bant ve selam bandı tam veriyi okur.
  const kartVerisi = useMemo(() => (d ? bantDisiVeri(d.veri) : null), [d]);
  const duzen = useMemo((): PanoDuzeni | null => {
    if (!d || !pano || !kartVerisi) return null;
    // Boş kart yok; liste kartı içeriğine yeten boya iner (bir kayıtlı kart yarısı boş durmasın).
    let kartlar = d.kartlar;
    try { kartlar = boylariIcerigeGore(d.kartlar.filter((k) => kartDoluMu(k.tip, kartVerisi, k.id)), kartVerisi); } catch { /* ham sıra */ }
    if (!kartlar.some((k) => k.tip === 'gundem')) kartlar = [...kartlar.slice(0, kartlar.findIndex((k) => k.tip === 'zihin') + 1), { id: 'gundem', tip: 'gundem', kolon: 1, genislik: 12, yukseklik: 'k' }, ...kartlar.slice(kartlar.findIndex((k) => k.tip === 'zihin') + 1)];
    // 0.11 G10: Görevler kartı planlayıcının kararı değil, görev varsa arayüzün eklediği karttır (gündem bandının hemen altı; süren iş görünür kalsın).
    // 12 sütunda yarım genişlik (satırdaki "kalan süre · son kontrol · adım" tek satır sığar), dar ızgarada tam genişlik; boy satır sayısına göre.
    if (suAnVar) {
      const gundemSonrasi = kartlar.findIndex((k) => k.tip === 'gundem') + 1;
      const yukseklik: KartYerlesimi['yukseklik'] = gorevSayisi <= 2 ? 'k' : gorevSayisi <= 4 ? 'o' : 'b';
      kartlar = [...kartlar.slice(0, gundemSonrasi), { id: 'gorevler', tip: 'gorevler', kolon: 1, genislik: sutun === 12 ? 6 : 12, yukseklik }, ...kartlar.slice(gundemSonrasi)];
    }
    try {
      return panoDiz({ kartlar, dolgular: DOLGU_TIPLERI.filter((t) => dolguKullanilabilir(t, pano)), sutun, hedefSatir });
    } catch (e) {
      // Düzen hesabı düşerse kartlar yine çizilir (doldurucusuz, planlayıcının sırasıyla).
      console.warn('[kokpit] pano düzeni hesaplanamadı:', (e as Error).message);
      const hucreler = izgaraDiz(kartlar, sutun);
      return { kartlar, hucreler, toplamSatir: Math.max(0, ...hucreler.map((h) => h.satir + h.boy - 1)) - kartlar.filter((k) => bantMi(k.tip)).length, bosSatir: 0 };
    }
  }, [d, kartVerisi, pano, sutun, hedefSatir, suAnVar, gorevSayisi]);
  const hucreler = useMemo(() => new Map((duzen?.hucreler ?? []).map((h) => [h.id, h])), [duzen]);
  // Izgarada görünen kart tipleri: sağdaki "Bugünün özeti" yalnız ızgarada olmayanı taşır (11 Kas, bulgu 6).
  const izgaradakiler = useMemo(() => new Set<string>((duzen?.kartlar ?? []).map((k) => k.tip)), [duzen]);
  // Satır yükseklikleri tek tek (düzeltme turu 1): kullanıcı kartlarının satırları içerik boyunda (92 px), görünen alanı tamamlayan
  // yükseklik yalnız doldurucu satırlarına (önce hava/haberler).
  const satirlar = useMemo(() => (duzen ? satirPikselleri(duzen, hedefSatir, alanPx) : []), [duzen, hedefSatir, alanPx]);
  const bantSayisi = duzen ? duzen.kartlar.filter((k) => bantMi(k.tip)).length : 0;
  const BOY_ADI: Record<number, Boy> = { 2: 'k', 3: 'o', 4: 'b' };

  // Geçici parıltı: ilk açılışta önemli kartlar; sonra yeni beliren ya da önemi artan kart.
  const oncekiOnem = useRef<Map<string, KartOnemi> | null>(null);
  const [parlayan, setParlayan] = useState<ReadonlySet<string>>(new Set());
  const parlaZaman = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!d) return;
    const eski = oncekiOnem.current;
    const yeni = new Map(d.kartlar.map((k) => [k.id, onemOku(k)] as const));
    oncekiOnem.current = yeni;
    const isaret = [...yeni].filter(([id, o]) => (eski ? !eski.has(id) || onemDegisti(eski.get(id), o) : o !== 'normal')).map(([id]) => id);
    if (!isaret.length) return;
    setParlayan((p) => new Set([...p, ...isaret]));
    for (const id of isaret) {
      clearTimeout(parlaZaman.current.get(id));
      parlaZaman.current.set(id, setTimeout(() => {
        parlaZaman.current.delete(id);
        setParlayan((p) => { const s = new Set(p); s.delete(id); return s; });
      }, PARILTI_MS));
    }
  }, [d]);
  useEffect(() => () => { for (const z of parlaZaman.current.values()) clearTimeout(z); }, []);

  // Uyarı ana pencerenin tost katmanında (çentiğin altında; sayfayı kaydırmaz, Görev 20b). Geri al'lı silmeler değişince kartlar yeniden çizilir.
  const setUyari = (m: string) => tostGoster(m, 'hata', 5000);
  useSilmeler();

  // Motor sinyali (Ruling K; tek kaynak). 0.10 Görev 2 (A-38): motor yokken (gönderim kapalı) kart/çip/araç kiti tıklaması mesaj
  // göndermez ve şeridi titretmez — bildirimin kendi yolunu izler (motorCipEylemi: İş'te Fuber hesabı penceresi, Geliştirici'de Motorlar,
  // Gizli modda Gizlilik); düğmelerin ipucu ne zaman çalışacağını söyler (PanoKartlari.tsx MotorIpucu).
  const motorYok = motorS.hazir && !motorS.gonderilebilir;
  const motorB = motorYok ? motorBildirimi(motorS.gorunum, motorS.mod, motorS.hesapDurumu, motorS.gizli, motorS.motor.yarim, yalnizYerelSecili(motorS.motor), motorS.motor.yerelYuzde) : null;
  const motorIpucu = motorB?.ipucu;
  // false = ana sohbette yanıt sürüyor; kart tıklaması sessizce düşmesin. F1 düzeltme turu 2 (KK-1): `sor` yalnız ortak kaynaktaki
  // istemi alır (shared/kokpit-istemleri.ts; ham metin yok). Araçsız turda (Gizli ya da yalnız yerel) araç isteyen istem önerilmez (kartlar AracsizMod'la süzer) ve
  // önerilse de gönderilmez (son kapı).
  const sor = (i: Istem) => {
    if (!anaId) return;
    if (motorYok) { motorEylemiYap(motorB ? motorCipEylemi(motorB, motorS.mod) : { eylem: 'hesap' }); return; }
    if (!istemOnerilir(i, motorS.aracsiz)) return;
    // 0.11 G7: kartlar ve çipler Fuber'in ana sohbetine yazar; panel başka sohbetteyse (ya da taslaktaysa) yanıt görünsün diye ana'ya döner.
    if (ks.secim !== anaId) ks.sec(anaId);
    void cagir<boolean>('sohbet:gonder', anaId, i.metin).catch(() => false).then((alindi) => { if (!alindi) setUyari(MESGUL_MESAJI); });
  };

  return (
    <MotorIpucu.Provider value={motorIpucu}>
    {/* İki ayrı bilgi (G8 düzeltme turu 2): AracsizMod = Gizli YA DA yalnız yerel (istemler süzülür); GizliMod = yalnız GERÇEK Gizli (Gizli'nin kendi cümleleri). */}
    <AracsizMod.Provider value={motorS.aracsiz}>
    <GizliMod.Provider value={motorS.gizli}>
    <div className="kokpit" data-vurgu="kokpit" style={vurguStili('kokpit') as CSSProperties}>
      <div className="kokpit__alan" ref={alanRef}>
        {/* İstenmiş yerel beyin kurulumu (Görev 15): arka planda iniyor / yarıda kaldı / kurulamadı — akışta, kartların üstünde. */}
        {/* H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçiliyken hazırlanma/hazır değil hâlini motor kartı TEK başına söyler
            (yüzde, "Yeniden indir", "Fuber’le devam et"); istenmiş kurulumun ayrı kartı ikinci bir durum olarak çizilmez. */}
        {!(motorYok && yalnizYerelSecili(motorS.motor)) && <YerelBekleyenBildirim />}
        {/* F1 (Ö1): Gizli mod kendiliğinden kapandıysa tek sakin cümle ("Tamam"la kalkar). */}
        <GizliGeriAlindiNotu />
        {/* 0.11 G12b / 0.12 H6: "0.12’de yeni" — yükselen profile bir kez (yeni kurulumda hiç, "Tamam"dan sonra hiç); ızgaranın ÜSTÜNDE, görünen alan hesabı onu düşer. */}
        {yenilik.goster && <YenilikKarti kapat={yenilik.kapat} />}
        {/* 0.11 G10: görev yokken, ilk kullanımda BİR KEZ tek satır (boş kart yok; sonraki açılışlarda görünmez). Izgaranın ÜSTÜNDE: görünen alan hesabı
            (olc) ızgaranın üstündekileri zaten düşer — satır katlanın altına itilmez. */}
        {d && pano && duzen && gorevHali === 'bos' && yenilik.hazir && !yenilikGorundu.current && !suAnVar && <GorevBosIpucu metin={GOREV_BOS_METNI} />}
        <div ref={olcu}>
          {d && pano && duzen ? (
            // Bantlar (zihin, gündem) ilk satırlardır ve içeriklerine göre yükselir (`auto`; gündem bandı sabit yükseklikte); sonraki
            // satırlar görünen alanı tam dolduracak yükseklikte ızgara satırlarıdır (en az 92 px).
            <div className="izgara" ref={izgaraRef} style={{ '--sutun': sutun, gridTemplateRows: [...Array<string>(bantSayisi).fill('auto'), ...satirlar.map((p) => `${p}px`)].join(' ') || undefined, gridAutoRows: `${SATIR_PX}px` } as CSSProperties}>
              {duzen.kartlar.map((k) => {
                const h = hucreler.get(k.id);
                const onem = onemOku(k);
                const boy: Boy = h ? BOY_ADI[h.boy] ?? 'b' : 'o';
                // Izgara hücresinin öznitelikleri (konum, önem, görünüm geçişi, parıltı): kartın kendisi (kütüphanenin Kart'ı) hücredir.
                const hucre = {
                  className: `kk${k.tip === 'zihin' ? ' zihin-kart' : ''}${k.tip === 'gundem' ? ' gundem-kart' : ''}${parlayan.has(k.id) ? ' kk--parla' : ''}`,
                  'data-bant': bantMi(k.tip) || undefined,
                  'data-kart': k.tip,
                  'data-onem': onem !== 'normal' ? onem : undefined,
                  role: onem !== 'normal' ? 'group' : undefined,
                  'aria-label': onem !== 'normal' ? `Önem: ${ONEM_ADI[onem]}` : undefined,
                  style: {
                    gridColumn: h ? `${h.kolon} / span ${h.genislik}` : '1 / -1',
                    gridRow: h ? `${h.satir} / span ${h.boy}` : 'span 2',
                    viewTransitionName: `kart-${k.id.replace(/[^a-z0-9_-]/gi, '-')}`,
                  } as CSSProperties,
                } as Hucre;
                return <KokpitKarti key={k.id} k={k} boy={boy} d={d} kv={kartVerisi ?? d.veri} pano={pano} sor={sor} git={git} zihin={zihin} hucre={hucre} yenile={() => void cagir<KokpitDurumu>('kokpit:al').then(setD)} gorevler={gorev.liste} aracsiz={motorS.aracsiz} />;
              })}
              {/* Görevler kartı görev varken yukarıda, gündem bandının altındadır (duzen); görev yokken G5'in boş, görünmez yuvası ızgarada yer tutmaz. */}
              {!suAnVar && <div data-kart="gorevler" data-yuva="" hidden />}
            </div>
          ) : <div className="cok-soluk">Kokpit hazırlanıyor…</div>}
        </div>
        {d?.gerekce && <div className="t-kucuk izgara-not"><Ikon ad="isik" olcu={13} />Yerleşimi Fuber seçti: {d.gerekce} <button className="dgm dgm--hayalet dgm--k" onClick={() => void cagir('kokpit:yenile')}><Ikon ad="yenile" olcu={13} />Yeniden düzenle</button></div>}
      </div>
      <div className="kokpit__sohbet">
        {/* Düzeltme turu 1: sohbet boşken (taze profil) sütun boş kalmaz — Bugünün özeti, sorulabilecekler, motor kartı. */}
        {/* Kokpit verisi gelene dek boş yer tutucu: Sohbet'in varsayılan önerileri bir an görünüp kaybolmasın (G24 küçüğü). 0.10 Görev 2
            (A-1, A-3): motor yokken TEK bildirim panelin kartında — panel görünürken şerit çizilmez (bosPanelBildirir). A-40: sohbet
            başlığındaki durum hapı boştayken yok; yalnız etkinlikte "düşünüyor / dinliyor / konuşuyor" (0.11 G7: seçici şeridinin başlık satırında; dikey yer almaz).
            0.11 G7: başlık şeridi sohbet seçicidir (ana sohbet, son sohbetler, yeni sohbet taslağı, "Tümü"); "Bugünün özeti" paneli yalnız ana
            sohbet boşken; başka sohbetin ve taslağın boş hâli Sohbet'in hazır önerileridir (Gizli'de araçsız). */}
        <Sohbet sohbetId={ks.sohbetId} yeni={ks.yeni} odak={ks.odak} sikisik ekranKoku={false}
          ust={<SohbetSecici anaId={anaId} liste={ks.liste} secim={ks.secim} sec={ks.sec} taslakAc={ks.taslakAc} tumu={() => git('sohbetler')} yenile={ks.listeyiYenile}
            durum={zihin === 'bos' ? null : <span className="hap" role="status" title={ZIHIN_ADI[zihin] ?? 'konuşuyor'}><span className="nokta nokta--mavi" /><span className="sohbet-secici__durum-metin">{ZIHIN_ADI[zihin] ?? 'konuşuyor'}</span></span>} />}
          bosIcerik={ks.secim === null || ks.secim === anaId
            ? (d && pano && ks.secim !== null ? <SohbetBaslangic v={d.veri} pano={pano} sor={sor} git={git} sohbetler={ks.liste} sohbetAc={ks.sec} izgara={izgaradakiler} /> : <div className="sohbet-bas" aria-hidden="true" />)
            : undefined}
          bosPanelBildirir />
      </div>
    </div>
    </GizliMod.Provider>
    </AracsizMod.Provider>
    </MotorIpucu.Provider>
  );
}

/** Izgaranın bir hücresi: kart tipine göre kütüphane kartı. Planlayıcının verdiği başlık (k.baslik) kullanıcı kartlarında korunur. */
function KokpitKarti({ k, boy, d, kv, pano, sor, git, zihin, yenile, hucre, gorevler, aracsiz }: { k: KartYerlesimi; boy: Boy; d: KokpitDurumu; kv: KokpitDurumu['veri']; pano: PanoDurumu; sor: (i: Istem) => void; git: (s: string, id?: number) => void; zihin: string; yenile: () => void; hucre: Hucre; gorevler: IsOzet[]; aracsiz: boolean }) {
  // Bantlar tam veriyi, kartlar bant dışı veriyi okur (11 Kas, bulgu 6: aynı kayıt iki yerde görünmez).
  const v = kv;
  switch (k.tip) {
    case 'zihin': return <ZihinBandi d={d} zihin={zihin} {...hucre} />;
    case 'gundem': return <GundemBandi v={d.veri} pano={pano} sor={sor} {...hucre} />;
    // ── Görev 24: doldurucular (pano/PanoKartlari.tsx) ──
    case 'hava': return <HavaKarti pano={pano} {...hucre} />;
    case 'haberler': return <HaberlerKarti pano={pano} {...hucre} />;
    case 'piyasa': return <PiyasaKarti pano={pano} {...hucre} />;
    case 'ipuclari': return <IpuclariKarti v={v} sor={sor} git={git} {...hucre} />;
    case 'arac_kiti': return <HizliIsler sor={sor} {...hucre} />;
    // ── 0.11 G10: Görevler (süren + bugün biten görevler; pano/GorevlerKarti.tsx) ──
    // İş izi (11 Kas): yuva aynı ('gorevler'), içerik tek "Şu an" kartı — canlı işler (bütün kaynaklar) + bugün biten/duran görevler.
    case 'gorevler': return <SuAnKarti gorevler={gorevler} git={git} aracsiz={aracsiz} {...hucre} />;
    // ── Kullanıcı kartları (pano/KullaniciKartlari.tsx, bilesenler/DusunmeKart.tsx; 0.11 G4: Yapılacaklar) ──
    case 'plan': return <YapilacaklarKarti v={v} boy={boy} sor={sor} {...hucre} />;
    case 'hatirlatici': return <HatirlaticilarKarti v={v} boy={boy} sor={sor} baslik={k.baslik} {...hucre} />;
    case 'dikkat':
    case 'oneriler': return <OnerilerKarti tip={k.tip} v={v} boy={boy} sor={sor} baslik={k.baslik} {...hucre} />;
    case 'eposta': return <EpostaKarti v={v} boy={boy} sor={sor} baslik={k.baslik} {...hucre} />;
    case 'whatsapp': return <WhatsappKarti v={v} sor={sor} baslik={k.baslik} {...hucre} />;
    case 'sohbetler': return <SohbetlerKarti v={v} git={git} baslik={k.baslik} {...hucre} />;
    case 'projeler': return <ProjelerKarti v={v} sor={sor} baslik={k.baslik} {...hucre} />;
    case 'hafiza': return <HafizaKarti v={v} git={git} baslik={k.baslik} {...hucre} />;
    case 'ice_aktarma': return <IceAktarmaKarti v={v} baslik={k.baslik} {...hucre} />;
    case 'dusunme': return <GunKaydiKarti v={v.dusunme} git={git} baslik={k.baslik} {...hucre} />;
    case 'meseleler': {
      const acik = (v.dusunme?.meseleler ?? []).filter((m) => m.durum === 'acik');
      return <MeselelerKarti liste={acik} sayi={v.dusunme?.durum.acikMesele ?? acik.length} git={git} yenile={yenile} baslik={k.baslik} {...hucre} />;
    }
    case 'ozel': {
      const o = v.ozelKartlar.find((x) => `ozel:${x.id}` === k.id);
      return o ? <OzelKart o={o} {...hucre} /> : null;
    }
    default:
      return null;
  }
}
