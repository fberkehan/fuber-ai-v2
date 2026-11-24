// ── Kurulum sihirbazı (0.10 E4, K6) ──────────────────────────────────────────────────────────────────────────────────────────────────
// 27 Eki: uygulamayı indiren yönetici her adımı "ileri, ileri, ileri" diyerek geçebilmeli; kişiyi tanımak için birçok kurulum
// sayfası var ama seçim hakkı az (tek ürün). Apple havası: kaliteli, lüks, profesyonel. 3B beyin kalktı; Fuber adı ve logosu
// düzgünce kullanılır.
//
// Sayfa sırası VERİDEN (shared/kurulum-adimlari.ts KURULUM_ADIMLARI → adimSirasi): Hoş geldin → Fuber hesabı → Tanışalım → İşin → Günün →
// Görünüm → Ses → Gizlilik → Bu cihazda çalışan yapay zekâ → Bağlantılar → İzinler → [Geliştirici araçları] → Hazırsın. Sayfa KİMLİĞİYLE
// izlenir ("Geliştiriciyim" seçilince liste değişir, bulunulan sayfa kaymaz); her kimliğin çizimi ADIM tablosunda (Record<AdimId, …>).
// Her sayfada TEK soru, makul varsayılan seçili ve TEK birincil düğme: "Devam" (son sayfada "Başla"; yeniden açılan ve yükseltme
// sihirbazında "Bitti"). Hiçbir sayfa zorunlu girdi istemez (ad boş geçilir) — Fuber hesabı dışında: herkes kayıt olur (0.11 G2,
// spec §2). Hesap sayfasında "Devam" formu gönderir; ikincil "Şimdilik hesapsız devam et" YALNIZ hesap sunucusuna ulaşılamıyorken çıkar ve
// nedenini söyler (shared/masaustu-hesap.ts hesapsizDevam; ulaşılabilirlik ana süreçten: hesap:ulasilabilir). Hesapsız geçilirse İş'te
// Gizlilik, Gizli modu önerilmiş açar; Geliştirici kendi anahtarını sonra bağlar.
// Sayfadan İLERİ çıkarken seçim uygulanır (uygula): Gizlilik → Gizli mod; cihazdaki yapay zekâ → indirme ARKA PLANDA başlar (yerel:kur;
// sihirbaz beklemez); Geliştirici araçları → paket arka planda kurulur ya da "görüldü" sayılır. Öteki seçimler anında kaydedilir (tema,
// hız, izinler, kullanım biçimi) ya da sihirbaz sonunda yazılır (ad, hitap, iş profili, sabah özeti).
// Sol panel (kurulum/KurulumHaritasi): büyük FUBER yazısı, sayfa haritası ve seçilen değerler (adimOzeti), güven cümlesi; beyin/3B yok.
// Üç kip (KurulumKipi):
//   · 'ilk'      — kurulum bitmemiş profil; "Başla" kurulum:tamamla'yı çağırır (ad, hitap, iş profili, sabah özeti, kurulum sürümü), sonra tur.
//   · 'yeniden'  — Ayarlar → Görünüm → "Kurulum sihirbazını yeniden aç": uygulamanın üstünde katman; haritadaki her satır tıklanır;
//                  "Bitti" YALNIZ ayarları yazar; "Vazgeç"/Esc anında uygulanan ayarları açılıştaki hâline döndürür (shared/kurulum-vazgec.ts).
//   · 'yukseltme' — 0.12 H3a: YALNIZ `adimlar` ile (oturum ortasında İş → Geliştirici teklifi: "Geliştirici araçları"); yükseltme özeti
//                  KALKTI (açılışta hiçbir sihirbaz açılmaz — shared/kurulum-adimlari.ts kurulumYolu). Yeni kurulum, "Kurulumu yeniden aç"
//                  ve yalnız hesap ekranı artık renderer/kurulum2/ (fintech). Bu dosya bütün adımlar taşınana dek kalır.
// Motor durumu YALNIZ renderer/motor-sinyali.ts `gorunum`'dan (shared/motor-durumu.ts motorGorunumu; I1, R19) — sihirbazın kendi kuralı yok.
// Testler: tests/kurulum-adimlari.test.ts, tests/kurulum-yerel.test.ts, tests/yerel-oneri.test.ts; önizleme scripts/dev/kurulum-onizle.mjs.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cagir, dinle } from '../api';
import { opakSahne } from '../tema';
import { Ikon } from '../bilesenler/Ikon';
import { useYerelDurum, yerelKurulu as yerelKuruluMu } from '../bilesenler/YerelKurulum';
import { useMotorSinyali } from '../motor-sinyali';
import {
  adimAdi, adimOzeti, adimSirasi, gunBaslangici, isProfiliYamasi, ozelYukseltmeBitirirMi, sessizUygulanirMi,
  GUN_VARSAYILAN, KURULUM_ADIMLARI, KURULUM_SURUMU, type AdimId, type IsRolu, type KurulumKipi, type OzetAyari,
} from '../../shared/kurulum-adimlari';
import { vazgecGeriAlma } from '../../shared/kurulum-vazgec';
import {
  gizliIstendiMi, gizliKaydi, hazirDurumu, kurulumOnerisi, yerelBakamadimMi, yerelCikisSecimi, yerelHazirlik, yerelKarariUygulansinMi, yerelOzetSecimi,
} from '../../shared/kurulum-yerel';
import type { YerelOneri } from '../../shared/yerel-boyut';
import type { SistemBilgisi } from '../../shared/sistem-kontrol';
import type { Ayarlar } from '../../shared/tipler';
import { KurulumHaritasi } from '../kurulum/KurulumHaritasi';
import { Bas, BaglantilarAdimi, GununAdimi, HosGeldinAdimi, IsinAdimi, IzinlerAdimi, TanismaAdimi, type Tanisma } from '../kurulum/Adimlar';
import { TemaAdimi } from '../kurulum/TemaAdimi';
import { SesAdimi } from '../kurulum/SesAdimi';
import { GizlilikAdimi, type GizlilikSecimi } from '../kurulum/GizlilikAdimi';
import { YerelAdimi, type YerelSecimi } from '../kurulum/YerelAdimi';
import { GelistiriciAraclariAdimi, onerilenAraclar, type AraclarSecimi } from '../kurulum/GelistiriciAraclariAdimi';
import { AdaAdimi } from '../kurulum/AdaAdimi';
import '../kurulum/kurulum.css';

/** Çift (üçlü…) tıklamanın ikinci ve sonraki tıklamaları: sayfa geçişi sürerken gelir; "Devam"/"Geri"/"Başla" onları yok sayar (sayfa
 *  atlanmasın, son sayfaya geçiren çift tıklama "Başla"ya düşmesin). Klavye (detail 0) ve tek tıklama geçer. */
const cokluTik = (e?: { detail?: number }) => (e?.detail ?? 0) > 1;
const VAZGEC_IPUCU = 'Tema, kullanım biçimi, ses, izinler ve gizli modu açılıştaki hâline döndürüp kapat (Esc). Başlayan indirme ve araç kurulumu sürer.';

/** Bilgisayarın bilgisi (`sistem:kontrol`, bir kez; yalnız gerekince — `etkin` ilk kez doğru olunca). null: bekleniyor; 'hata': okunamadı.
 *  Ekran kartı yoklaması takılırsa sihirbaz beklemekte kalmasın: 10 sn'de yanıt yoksa 'hata' — F1 (K3): öneri YOK, sayfa "bakamadım" der,
 *  varsayılan "Şimdilik hayır" (shared/kurulum-yerel.ts kurulumOnerisi; ölçülmemiş şey söylenmez). */
const SISTEM_SURESI_MS = 10_000;
function useSistemBilgisi(etkin: boolean): SistemBilgisi | null | 'hata' {
  const [b, setB] = useState<SistemBilgisi | null | 'hata'>(null);
  const istendi = useRef(false);
  useEffect(() => {
    if (!etkin || istendi.current) return;
    istendi.current = true;
    const z = setTimeout(() => setB((x) => x ?? 'hata'), SISTEM_SURESI_MS);
    void cagir<SistemBilgisi>('sistem:kontrol').then((x) => { clearTimeout(z); setB(x); }, () => { clearTimeout(z); setB('hata'); });
  }, [etkin]);
  return b;
}

/** `etkin` ilk kez doğru olduktan `ms` sonra true (bir kez; sonra hep true). */
function useSureDoldu(etkin: boolean, ms: number): boolean {
  const [doldu, setDoldu] = useState(false);
  const zaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (etkin && !zaman.current) zaman.current = setTimeout(() => setDoldu(true), ms);
  }, [etkin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (zaman.current) clearTimeout(zaman.current); }, []);
  return doldu;
}

export function Kurulum({ bitti, kip = 'ilk', adimlar }: { bitti: () => void; kip?: KurulumKipi; adimlar?: AdimId[] }) {
  const yeniden = kip === 'yeniden';
  const yukseltme = kip === 'yukseltme';
  const [ayar, setAyar] = useState<Ayarlar | null>(null);
  const [adimId, setAdimId] = useState<AdimId | null>(null);
  const [goruldu, setGoruldu] = useState<ReadonlySet<AdimId>>(new Set());
  const [tanisma, setTanisma] = useState<Tanisma>({ kullaniciAdi: '', hitap: '' });
  const [rol, setRolDurumu] = useState<IsRolu>('yonetici');
  const [sirket, setSirket] = useState('');
  const [gun, setGun] = useState<{ bas: string; bit: string }>({ bas: GUN_VARSAYILAN.gunBas, bit: GUN_VARSAYILAN.gunBit });
  const [sabah, setSabah] = useState<string>(GUN_VARSAYILAN.sabah);
  const [claudeHafiza, setClaudeHafiza] = useState(false); // C-11: varsayılan kapalı
  const [claudeSayi, setClaudeSayi] = useState(0);
  const [gizliSecim, setGizliSecim] = useState<GizlilikSecimi | null>(null);
  const [yerelSecim, setYerelSecim] = useState<YerelSecimi>('evet');
  const [yerelBaslatildi, setYerelBaslatildi] = useState(false);
  const [araclar, setAraclar] = useState<AraclarSecimi>('hepsi');
  const [araclarUygulandi, setAraclarUygulandi] = useState(false);
  const [claudeYok, setClaudeYok] = useState(false);
  const [bitiriliyor, setBitiriliyor] = useState(false);
  const [bitirmeHatasi, setBitirmeHatasi] = useState('');
  // Sihirbaz Gizli modu geri aldı (bilgisayar uygun değil ya da hiçbir şey hazırlanamadı): Hazırsın sakin bir satırla söyler.
  const [gizliGeriAlindi, setGizliGeriAlindi] = useState<'yetmiyor' | 'hazir-degil' | null>(null);
  const acilis = useRef<Ayarlar | null>(null); // yeniden: açılıştaki ayarlar (Vazgeç bunlara döner)
  const profilSurumu = useRef(0); // yükseltme listesi açılıştaki kurulum sürümünden kurulur, sihirbaz boyunca sabit
  const sonIndeks = useRef(0);
  const kapaniyor = useRef(false);
  // İş profili (rol, şirket, çalışma saatleri) açılıştaki hâli: yükseltmede ve yeniden açılan sihirbazda yalnız GERÇEKTEN değiştiyse
  // yazılır (shared/kurulum-adimlari.ts isProfiliYamasi) — dokunulmamış varsayılan ("Yönetici", 09:00–18:00) var olan bir profile, sessiz
  // saate ve hafızaya kendiliğinden yazılmaz.
  const acilisIs = useRef<{ rol: IsRolu; sirket: string; gunBas: string; gunBit: string }>({ rol: 'yonetici', sirket: '', gunBas: GUN_VARSAYILAN.gunBas, gunBit: GUN_VARSAYILAN.gunBit });
  const [saatKaynagi, setSaatKaynagi] = useState<'profil' | 'sessiz' | 'varsayilan'>('varsayilan');
  // Bilgisayarın bilgisi Görünüm'den itibaren önceden okunur: Gizlilik açıldığında öneri hazır olsun (seçim sonradan değişip kaymasın).
  const sistem = useSistemBilgisi(adimId === 'gorunum' || adimId === 'ses' || adimId === 'gizlilik' || adimId === 'yerel');
  const yd = useYerelDurum();
  // Cihazdaki yapay zekâ sayfası "Devam"ı öneri gelene dek tutar; yerel durum (yerel:durum) da yanıt vermezse en çok 10 sn (I1 5b):
  // süre dolunca sayfa "bakamadım" hâliyle geçilir.
  const yerelSureDoldu = useSureDoldu(adimId === 'yerel', SISTEM_SURESI_MS);
  // Motorun TEK hâli (shared/motor-durumu.ts motorGorunumu; I1, R19): sihirbaz kendi motor kuralını kurmaz.
  const { gorunum, motor } = useMotorSinyali();

  const yenile = () => void cagir<Ayarlar>('ayarlar:al').then(setAyar);
  useEffect(() => opakSahne(), []); // 0.13 T13: sihirbaz açıkken pencere opak (tema Şeffaf olsa bile; main/tema.ts)
  useEffect(() => {
    void cagir<Ayarlar>('ayarlar:al').then((a) => {
      profilSurumu.current = a.kurulumSurumu ?? 0;
      acilis.current = structuredClone(a);
      setAyar(a);
      const r = a.isProfili?.rol ?? (a.mod === 'gelistirici' ? 'gelistirici' : 'yonetici');
      // Profilde saat yoksa (yükseltme yolu) kayıtlı sessiz saatin tersi: sayfa gerçeği gösterir, dokunulmazsa yazılmaz (I1 5b).
      const g = gunBaslangici(kip, a.isProfili, a.proaktif);
      acilisIs.current = { rol: r, sirket: (a.isProfili?.sirket ?? '').trim(), gunBas: g.bas, gunBit: g.bit };
      setSaatKaynagi(g.kaynak);
      setRolDurumu(r);
      setSirket(a.isProfili?.sirket ?? '');
      setGun({ bas: g.bas, bit: g.bit });
      if (a.yerel.gizliMod) setGizliSecim('gizli');
      if (kip === 'ilk') return;
      setTanisma({ kullaniciAdi: a.kullaniciAdi, hitap: a.hitap });
      // Olduğu gibi: boş saat sabah özetinin tek "kapalı" hâlidir (zamanlayici.ts); varsayılanla doldurmak kapalı özeti açardı.
      setSabah(a.proaktif.sabahOzeti ?? '');
    });
    // Yalnız ilk kurulumda Claude Code notları içe aktarılabilir (Geliştirici'de, varsayılan kapalı).
    if (kip === 'ilk') void cagir<number>('kurulum:claude-hafiza-sayisi').then(setClaudeSayi).catch(() => undefined);
    // Tema, kullanım biçimi, hesap ve öteki pencerelerden gelen değişiklikler (aynı ayar nesnesi) burada da görünsün.
    return dinle('ayarlar:degisti', (a: Ayarlar) => setAyar(a));
  }, []);

  /** Yeniden kip: sihirbazın anında uyguladığı ayarlar açılıştaki hâline döner, katman kapanır (kurulumTamam'a dokunulmaz). */
  const vazgec = async () => {
    if (kapaniyor.current) return;
    kapaniyor.current = true;
    const o = acilis.current;
    const simdiki = await cagir<Ayarlar>('ayarlar:al').catch(() => null);
    const g = o && simdiki ? vazgecGeriAlma(o, simdiki) : null;
    if (g) {
      await cagir('ayarlar:kaydet', g.ayar).catch(() => undefined);
      if (g.bekleyenGizliKapat) await cagir('yerel:bekleyen-gizli', false).catch(() => undefined);
    }
    bitti();
  };
  const vazgecRef = useRef(vazgec);
  vazgecRef.current = vazgec;
  useEffect(() => {
    if (!yeniden) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]:not(.kurulum)')) void vazgecRef.current(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const sira = ayar
    ? (adimlar ? adimlar.filter((x) => { const t = KURULUM_ADIMLARI.find((a) => a.id === x); return t && (!t.mod || t.mod === ayar.mod); }) : adimSirasi(ayar.mod, kip, profilSurumu.current, KURULUM_ADIMLARI, {}))
    : [];
  // Yükseltmede gösterilecek sayfa kalmadıysa (ör. başka pencerede tamamlandı) sihirbaz kendiliğinden kapanır.
  useEffect(() => { if (ayar && !sira.length) bitti(); }, [ayar, sira.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ayar || !sira.length) return null;

  // ── Türetilenler ──
  const ozetEkrani = false; // 0.12 H3a: yükseltme özeti ekranı kalktı
  const id: AdimId = adimId && sira.includes(adimId) ? adimId : sira[Math.min(sonIndeks.current, sira.length - 1)];
  const adim = sira.indexOf(id);
  sonIndeks.current = adim;
  const son = adim === sira.length - 1;
  // Bulut yapay zekâsı hazır (Fuber hesabı aktif ya da Geliştirici'nin kendi anahtarı): yalnız motorGorunumu'ndan.
  const motorVar = gorunum === 'hazir';
  const iniyor = yd?.indirme && !yd.indirme.hata && yd.indirme.yuzde < 100 ? yd.indirme.yuzde : null;
  // F1 (son inceleme K3): öneri yalnız ÖLÇÜLMÜŞ bilgisayardan (shared/kurulum-yerel.ts kurulumOnerisi): bilgisayar okunamadıysa öneri yok —
  // sayfa "bakamadım" der, çıkışta seçim "Şimdilik hayır" (eskiden 8 GB/NVIDIA yok varsayılıp öneri ölçülmüş gibi gösteriliyordu).
  const oneri: YerelOneri | null = kurulumOnerisi({ sistem, yerel: yd, model: ayar.yerel.model, islemciZorla: ayar.yerel.gpu === 'cpu' });
  const bakamadim = yerelBakamadimMi({ oneriVar: Boolean(oneri), sureDoldu: yerelSureDoldu, sistemHata: sistem === 'hata' });
  // Hesapsız İş'te Gizli mod önerili: bilgisayarın uygun olmadığı BİLİNENE dek (öneri okunurken de) seçili — sonradan çevrilip kaymasın.
  const gizli: GizlilikSecimi = oneri && !oneri.uygun ? 'normal' : gizliSecim ?? (ayar.yerel.gizliMod ? 'gizli' : 'normal');
  // Gizli mod İSTENDİ (ekranda uygun değil diye "Normal"e dönmüş olsa da: öneri gelmeden kaydedilmiş Gizli mod geri alınabilsin).
  const gizliIstendi = gizli === 'gizli' || gizliIstendiMi(gizliSecim, ayar.yerel.gizliMod === true);
  const yerelHal = oneri && !oneri.uygun ? 'uygun-degil' as const : oneri?.kurulu ? 'kurulu' as const : iniyor !== null ? 'iniyor' as const : undefined;
  // Bir yerel yapay zekâ kurulu (çalıştırıcı + model) ve hazır (kurulu + açık; Gizli modda motor yolu yalnız bununla vardır).
  const yerelKurulu = yerelKuruluMu(yd);
  const yerelHazir = yerelKurulu && ayar.yerel.etkin === true;
  const aracSayisi = onerilenAraclar().length;
  const isSecimi = { rol, sirket: sirket.trim(), gunBas: gun.bas, gunBit: gun.bit };
  const isYamasi = isProfiliYamasi(ayar.isProfili, isSecimi, acilisIs.current);
  const isDegisti = isYamasi !== null;
  // "Günün" yalnız uygulanan şeyi söyler (I1 5b): saatler sessiz saate eşlenir mi — ilk kurulumda, profilde/sessiz saatte kayıtlı
  // saatlerde ya da kullanıcı değiştirince (ve gece yarısını aşmayan mesaide; shared/kurulum-adimlari.ts sessizSaatleri).
  const saatDokunuldu = gun.bas !== acilisIs.current.gunBas || gun.bit !== acilisIs.current.gunBit;
  const sessizUygulanir = sessizUygulanirMi({ kip, kaynak: saatKaynagi, dokunuldu: saatDokunuldu, gunBas: gun.bas, gunBit: gun.bit, sabah });
  const ozetAyari: OzetAyari = { ...ayar, kullaniciAdi: tanisma.kullaniciAdi, hitap: tanisma.hitap, yerel: { gizliMod: gizli === 'gizli' } };
  // Yükseltme özetinde ve yeniden açılan sihirbazda harita ŞİMDİKİ ayarları özetler: hiç kaydedilmemiş bir seçimin varsayılanı
  // ("Yönetici", "İstiyorum") görülmemiş sayfada yazılmaz.
  const kayitli = (x: AdimId) => kip === 'ilk' || goruldu.has(x) || x === id;
  // Cihazdaki yapay zekânın kararı haritayla atlanırken ve "Bitti"de yalnız sayfa görüldüyse ya da Gizli mod BU sihirbazda açıldıysa
  // (shared/kurulum-yerel.ts yerelKarariUygulansinMi): kayıtlı Gizli mod geri alınmaz, görülmemiş "İstiyorum" indirme başlatmaz.
  const yerelKarari = { yerelGoruldu: kayitli('yerel'), gizliIstendi, acilistaGizli: acilis.current?.yerel.gizliMod === true };
  const isVar = Boolean(ayar.isProfili) || isDegisti || ayar.mod === 'gelistirici';
  const ozetle = (x: AdimId) => adimOzeti(x, ozetAyari, {
    rol: isVar || kayitli('isin') ? rol : undefined, sirket, ...(isVar || kayitli('gunun') ? { gunBas: gun.bas, gunBit: gun.bit } : {}), sabah, hesapsiz: false,
    yerel: !kayitli('yerel') ? undefined : yerelOzetSecimi(gizli === 'gizli' ? 'evet' : yerelSecim, { oneriVar: Boolean(oneri) }), yerelHal,
    araclar: araclarUygulandi || x !== 'gelistirici-araclari' ? araclar : undefined, aracSayisi,
  });
  const ozetler = Object.fromEntries(sira.map((x) => [x, ozetle(x)])) as Partial<Record<AdimId, string>>;

  const kaydet = (d: Partial<Ayarlar>) => void cagir<Ayarlar>('ayarlar:kaydet', d).then(setAyar);
  /** "Geliştiriciyim" kullanım biçimini anında çevirir; öteki roller İş'e döndürür (sihirbazın sonraki sayfaları moda göre çizilir). */
  const setRol = (r: IsRolu) => {
    setRolDurumu(r);
    const mod = r === 'gelistirici' ? 'gelistirici' : 'is';
    if (ayar.mod !== mod) kaydet({ mod });
  };

  /** Cihazdaki yapay zekânın kararı (shared/kurulum-yerel.ts yerelHazirlik): indir, durdur ya da — Gizli mod hiç hazırlanamıyorsa —
   *  Gizli modu geri al (sessizce hiç hazır olmayan Gizli mod kalmaz). Sayfa ileri geçilirken, haritadan atlanırken ve sihirbaz biterken. */
  const yereliUygula = (secim: YerelSecimi = yerelSecim) => {
    const e = yerelHazirlik({ gizli: gizliIstendi, istiyor: secim === 'evet', oneri, kurulu: yerelKurulu, iniyor: iniyor !== null || Boolean(yd?.inen), baslatildi: yerelBaslatildi });
    if (e === 'indir' && oneri?.uygun) {
      setYerelBaslatildi(true);
      void cagir('yerel:kur', oneri.model, { ac: true, gizli: gizliIstendi }).catch(() => undefined);
    } else if (e === 'durdur') {
      setYerelBaslatildi(false);
      void cagir('yerel:durdur').catch(() => undefined);
    } else if (e === 'gizli-geri-al') {
      setGizliSecim('normal');
      // Ölçülmemiş şey söylenmez (I1 5b): bilgisayar ölçüldüyse "yetmiyor", ölçülmediyse ya da durum alınamadıysa "hazır değil".
      setGizliGeriAlindi(oneri && !oneri.uygun ? 'yetmiyor' : 'hazir-degil');
      kaydet({ yerel: { ...ayar.yerel, gizliMod: false } });
      if (ayar.yerel.bekleyenKurulum?.gizliMod) void cagir('yerel:bekleyen-gizli', false).catch(() => undefined);
    }
  };
  /** Sayfadan çıkarken seçimi uygular. `ileri`: yalnız ileri giderken başlayanlar (indirme, araç kurulumu). `hedef`: gidilen sayfa —
   *  cihazdaki yapay zekâ sayfasının ÜSTÜNDEN haritayla atlanırken de onun kararı uygulanır. */
  const uygula = (x: AdimId, ileri: boolean, hedef?: AdimId) => {
    if (x === 'gizlilik') {
      // Gizli mod kurulu yerel yapay zekâyı da AÇAR (kapalı kalmış yükseltilmiş/yeniden açılmış profil; shared/kurulum-yerel.ts gizliKaydi).
      const v = gizli === 'gizli';
      const y = gizliKaydi(v, ayar.yerel, yerelKurulu);
      if (y) kaydet({ yerel: { ...ayar.yerel, ...y } });
      if (ayar.yerel.bekleyenKurulum && Boolean(ayar.yerel.bekleyenKurulum.gizliMod) !== v) void cagir('yerel:bekleyen-gizli', v).catch(() => undefined);
    }
    const yi = sira.indexOf('yerel');
    if (x === 'yerel') {
      // Öneri hiç gösterilmediyse ("bakıyorum" ya da "bakamadım"; süreye bakılmaz) etkin seçim "Şimdilik hayır" (shared/kurulum-yerel.ts
      // yerelCikisSecimi): özet de, sonradan gelen durum da.
      const s = yerelCikisSecimi(yerelSecim, { oneriVar: Boolean(oneri) });
      if (s !== yerelSecim) setYerelSecim(s);
      if (ileri) yereliUygula(s);
    } else if (ileri && yi >= 0 && sira.indexOf(x) < yi && hedef !== undefined && sira.indexOf(hedef) > yi && yerelKarariUygulansinMi(yerelKarari)) {
      yereliUygula();
    }
    if (x === 'gelistirici-araclari' && ileri) {
      setAraclarUygulandi(true);
      void cagir('claudecode:paket-baslat', araclar === 'hepsi' ? { secim: onerilenAraclar().map((o) => o.id) } : { yalnizGoruldu: true }).catch(() => undefined);
    }
  };
  const git = (yeni: AdimId) => {
    if (!ozetEkrani) uygula(id, sira.indexOf(yeni) > adim, yeni);
    setGoruldu((g) => new Set([...g, id]));
    setAdimId(yeni);
  };
  // Çift tıklamanın ikinci tıklaması (sayfa geçişi sürerken gelir; düğme yeni sayfada aynı yerde durduğu için bir sayfayı atlatıyordu)
  // yok sayılır. `detail` tıklama sayısıdır; klavyeyle 0.
  const ileri = (e?: React.MouseEvent) => { if (cokluTik(e)) return; git(sira[Math.min(sira.length - 1, adim + 1)]); };
  const geri = (e?: React.MouseEvent) => { if (cokluTik(e)) return; git(sira[Math.max(0, adim - 1)]); };
  const isProfili = isSecimi;

  const tamamla = async () => {
    setBitiriliyor(true);
    setBitirmeHatasi('');
    kapaniyor.current = true;
    uygula(id, true); // son sayfa "Geliştirici araçları" ise (yalnız o sayfayla açılan sihirbaz)
    // Cihazdaki yapay zekâ sayfası görüldüyse ya da Gizli mod BU sihirbazda açıldıysa karar bir kez daha (atlanmış/yarım kalmış hâl; çift
    // başlatma yok). Önceden kayıtlı Gizli mod, sayfasına hiç uğranmadan "Bitti"de geri alınmaz (Hazırsın onun hâlini söyler).
    if (sira.includes('yerel') && yerelKarariUygulansinMi(yerelKarari)) yereliUygula();
    if (yukseltme) {
      // Kurulum sürümü + — kullanıcı İşin'de rolünü/şirketini GERÇEKTEN değiştirdiyse — iş profili (ayarlar:kaydet o zaman hafızaya tek
      // "İşi ve günü" kaydı yazar). Sohbet, kokpit planı, model çağrısı YOK. Yalnız belli sayfalarla açılan sihirbaz (oturum ortasında İş →
      // Geliştirici) sürümü yalnız bekleyen başka yükseltme sayfası kalmadıysa yazar.
      if (sira.includes('isin') && !ozetEkrani && isYamasi) await cagir('ayarlar:kaydet', { isProfili: isYamasi }).catch(() => undefined);
      if (!adimlar || ozelYukseltmeBitirirMi(ayar.mod, profilSurumu.current, sira)) await cagir('kurulum:yukseltme-bitti').catch(() => undefined);
      bitti();
      return;
    }
    if (yeniden) {
      // Yalnız ayarlar: ad/hitap değiştiyse ayarlar:kaydet çekirdek hafızadaki TEK ad kaydını, iş profili TEK "İşi ve günü" kaydını günceller
      // (mesai değiştiyse sessiz saat de; ipc.ts). İş profili yalnız gerçekten değiştiyse; saatler yalnız kayıtta varsa ya da değiştiyse
      // (shared/kurulum-adimlari.ts isProfiliYamasi — dokunulmamış saat kullanıcının sessiz saatini ezmez).
      await cagir('ayarlar:kaydet', { kullaniciAdi: tanisma.kullaniciAdi.trim(), hitap: tanisma.hitap.trim(), proaktif: { ...ayar.proaktif, sabahOzeti: sabah }, ...(isYamasi ? { isProfili: isYamasi } : {}) }).catch(() => undefined);
      if ((ayar.kurulumSurumu ?? 0) < KURULUM_SURUMU && ozelYukseltmeBitirirMi(ayar.mod, profilSurumu.current, sira)) await cagir('kurulum:yukseltme-bitti').catch(() => undefined);
      bitti();
      return;
    }
    try {
      await cagir('kurulum:tamamla', { kullaniciAdi: tanisma.kullaniciAdi.trim(), hitap: tanisma.hitap.trim(), claudeHafiza: rol === 'gelistirici' && claudeHafiza, sabahOzeti: sabah, isProfili });
    } catch {
      // Kayıt düşerse "Başlıyor…"da asılı kalınmaz: düğme geri gelir, tek sakin cümle.
      kapaniyor.current = false;
      setBitiriliyor(false);
      setBitirmeHatasi('Kaydedemedim; bir daha dene.');
      return;
    }
    bitti();
  };
  // Sayfaların çizimi (kimlik → içerik). Yeni bir AdimId burada çizilmezse derleme düşer.
  const ADIM: Record<AdimId, () => ReactNode> = {
    hosgeldin: () => <HosGeldinAdimi kip={kip} />,
    hesap: () => null, // no account step in this build
    tanisma: () => <TanismaAdimi t={tanisma} set={setTanisma} />,
    isin: () => <IsinAdimi rol={rol} setRol={setRol} sirket={sirket} setSirket={setSirket} claudeSayi={kip === 'ilk' ? claudeSayi : 0} claudeHafiza={claudeHafiza} setClaudeHafiza={setClaudeHafiza} />,
    gunun: () => <GununAdimi gunBas={gun.bas} gunBit={gun.bit} setGun={(bas, bit) => setGun({ bas, bit })} sabah={sabah} setSabah={setSabah} ayar={ayar} kaydet={kaydet} sessizUygulanir={sessizUygulanir} />,
    gorunum: () => <TemaAdimi ayar={ayar} kaydet={kaydet} />,
    ses: () => <SesAdimi ayar={ayar} kaydet={kaydet} />,
    gizlilik: () => <GizlilikAdimi secim={gizli} sec={setGizliSecim} oneri={oneri} hesapsizIs={false} gelistirici={ayar.mod === 'gelistirici'} />,
    // R25: model kimliği yalnız Ayarlar → Yapay zekâ'da; burada (Geliştirici'de de) yalnız boy ve boyut.
    yerel: () => <YerelAdimi oneri={oneri} bakamadim={bakamadim} secim={yerelSecim} sec={setYerelSecim} gizli={gizliIstendi} iniyor={iniyor} gelistirici={ayar.mod === 'gelistirici'} />,
    baglantilar: () => <BaglantilarAdimi ayar={ayar} yenile={yenile} />,
    izinler: () => <IzinlerAdimi ayar={ayar} kaydet={kaydet} />,
    'gelistirici-araclari': () => <AraclarSayfasi secim={araclar} sec={setAraclar} claudeYok={claudeYok} setClaudeYok={setClaudeYok} />,
    ada: () => (
      <AdaAdimi ayar={ayar} kip={kip} tanisma={tanisma} durum={hazirDurumu({
        mod: ayar.mod, gorunum, gizliMod: ayar.yerel.gizliMod === true, yerelHazir,
        yerelIniyor: iniyor !== null, yerelIstendi: yerelBaslatildi || Boolean(ayar.yerel.bekleyenKurulum), gizliGeriAlindi,
        // F1 düzeltme turu 1 (K-1): duraklamış hazırlık ana süreç sinyalinden (bu sihirbaz indirmeyi başlattıysa "iniyor").
        yerelYarim: Boolean(motor.yarim) && !yerelBaslatildi,
      })} />
    ),
  };

  // Cihazdaki yapay zekâ sayfası öneri gelene dek "Devam"ı tutar (öneri bilinmeden Gizli mod hazırlanamaz); sayfa o sırada tek sakin satır
  // gösterir: "Bilgisayarına bakıyorum…". En çok ~10 sn (sistem:kontrol ve yerel:durum için ayrı üst süre); sonra "bakamadım" hâliyle geçilir.
  const yerelBekliyor = id === 'yerel' && !ozetEkrani && !oneri && !bakamadim;
  const altNot = bitirmeHatasi;
  const sonAdi = kip === 'ilk' ? 'Başla' : 'Bitti';
  const altBaslik = yukseltme ? (adimlar ? 'Geliştirici araçları' : 'Yenilikler') : yeniden ? 'Kurulum' : 'Kurulum · yaklaşık 3 dk';
  const birincilAd = bitiriliyor ? (kip === 'ilk' ? 'Başlıyor…' : 'Kaydediliyor…') : son ? sonAdi : 'Devam';

  return (
    <div className="kurulum" data-adim={ozetEkrani ? 'ozet' : adim} data-adim-id={ozetEkrani ? 'ozet' : id} data-mod={ayar.mod} data-kip={kip} data-yeniden={yeniden ? '' : undefined}
      {...(yeniden ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Kurulum sihirbazı' } : {})}>
      <KurulumHaritasi
        sira={sira} simdiki={ozetEkrani ? null : id} ozetler={ozetler} altBaslik={altBaslik} git={git} hepsiniOzetle={yeniden || ozetEkrani} mod={ayar.mod}
        tiklanir={(x, i) => yeniden || ozetEkrani || i < adim || goruldu.has(x)}
      />

      <section className="kurulum__form" aria-label={ozetEkrani ? 'Kurulum: yenilikler' : `Kurulum: ${adimAdi(id, KURULUM_ADIMLARI, ayar.mod)}`}>
        <div className="kurulum__ust" aria-hidden="true" />
        <div className="kurulum__govde">
          <div className="kurulum__icerik" key={ozetEkrani ? 'ozet' : id} data-sayfa={ozetEkrani ? 'ozet' : id}>
            {ADIM[id]()}
          </div>
        </div>

        <div className="kurulum__alt">
          {yeniden && <button type="button" className="dgm dgm--hayalet" onClick={() => void vazgec()} title={VAZGEC_IPUCU} data-vazgec="">Vazgeç</button>}
          {!yeniden && !ozetEkrani && adim > 0 && <button type="button" className="dgm dgm--hayalet" disabled={bitiriliyor} onClick={geri} data-geri=""><Ikon ad="geri" olcu={15} />Geri</button>}
          <span className="kurulum__alt-not" role={altNot ? 'status' : undefined} data-alt-not={altNot ? '' : undefined}>{altNot}</span>
          {(
            // Anahtarlar (key) bilerek ayrı: önceki sayfanın "Devam"ı tıklama sürerken aynı DOM düğmesi hesap sayfasında gönder düğmesine
            // dönüşmesin (tıklamanın varsayılan eylemi yeni hâliyle formu boş gönderiyordu).
            <>
              {son ? (
                <button key="son" type="button" className="dgm dgm--beyaz" disabled={bitiriliyor} onClick={(e) => { if (!cokluTik(e)) void tamamla(); }} data-ileri="" data-son="">{birincilAd}<Ikon ad={kip === 'ilk' ? 'gonder' : 'tamam'} olcu={15} /></button>
              ) : (
                <button key="devam" type="button" className="dgm dgm--beyaz" disabled={yerelBekliyor} onClick={ileri} data-ileri="">Devam<Ikon ad="gonder" olcu={15} /></button>
              )}
            </>
          )}
        </div>
      </section>
      <div className="kurulum__surukle" aria-hidden="true" />
    </div>
  );
}

/** Geliştirici araçları sayfası + Claude Code durumu (yalnız "Claude Code kurulunca kurarım" cümlesi için; ayrıntı yok, K8). */
function AraclarSayfasi({ secim, sec, claudeYok, setClaudeYok }: { secim: AraclarSecimi; sec: (v: AraclarSecimi) => void; claudeYok: boolean; setClaudeYok: (v: boolean) => void }) {
  useEffect(() => {
    void cagir<{ claude?: { kurulu?: boolean } }>('claudecode:eklenti-durum').then((d) => setClaudeYok(!d?.claude?.kurulu)).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <GelistiriciAraclariAdimi secim={secim} sec={sec} claudeYok={claudeYok} />;
}
