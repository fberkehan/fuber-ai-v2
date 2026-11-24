// ── Kurulum v2 (0.12 H3a; spec §1, "Tasarım dili: Apple fintech") ───────────────────────────────────────────────────────────────────
// 0.11.0'dan sonra: "Ne işle uğraşıyorsunuz" gibi sorular hep yukarıda kalıyor, ekranın büyük kısmı boş duruyordu.
// Kurulum sayfaları baştan hazırlandı: bol animasyonlu, profesyonel, Apple/fintech havasında.
// Kabuk: OPAK tam pencere (saf siyah / Apple grisi sahne; buzlu cam yok). Üstte ince ilerleme çizgisi + adım sayısı ("3 / 11"); solda tek
// sorunun içeriği (en çok 520 px, DİKEY ORTALI — hiçbir zaman üste yapışık değil); sağda o adımın CANLI önizlemesi (taslağın o anki hâli);
// altta Geri (solda) ve tek birincil düğme (sağda, Enter). Adım geçişi yay eğrisiyle (~420 ms, 24 px + opaklık), önizleme 60 ms sonra
// (ui/fintech AdimGecisi). Adımlar ve kuralları: kurulum2/adimlar.ts (ADIMLAR), shared/kurulum-taslak.ts.
// Kipler (shared/kurulum-taslak.ts Kurulum2Kipi):
//   · 'ilk'          yeni kurulum; "Fuber’i aç" kurulum:tamamla'yı çağırır (ad, hitap, iş profili, sabah özeti, tema), ardından açılış animasyonu
//                    ve tanıtım turu (renderer/main.tsx).
//   · 'yeniden'      Ayarlar → Görünüm → "Kurulumu yeniden aç": uygulamanın üstünde opak katman; "Bitti" yalnız ayarları yazar; "Vazgeç"/Esc
//                    anında kaydedilenleri (ses, izinler, Gizli mod) açılıştakine döndürür (shared/kurulum-vazgec.ts).
//   · 'yalniz-hesap' yükseltmede ya da "Kaldığın yerden devam et"te hesap yoksa YALNIZ hesap ekranı (shared/kurulum-adimlari.ts kurulumYolu).
// Anında kaydedilen: kip (Business mode, Developer mode), ses ("Sesli konuşma", "Hey Fuber"), izinler, Nerede'den İLERİ çıkarken seçim (Fuber · Yalnız bu bilgisayar · Gizli) +
// yerel sürümün indirmesi (arka planda; 0.12 H3c: kurulum2/yerel-karar.ts). Nerede'nin ön seçimi taslaktan kopya değil (Y1, H3b yeniden
// incelemesi): kullanıcının bu kurulumdaki son açık seçimi, yoksa o anki GERÇEK hâl — hesap adımında "Gizli moddan çık" denirse açık "Gizli"
// seçimi düşer ve Nerede "Fuber (önerilen)" ile gelir (shared/nerede.ts neredeOnSecimi, gizliKapanincaSecim).
// Sonda yazılan: ad, hitap, şirket ve çalışma saatleri (iş profili + sessiz saat; kayıtlı rol olduğu gibi kalır), sabah özeti, Developer'da Claude
// Code notları ve tema. Tema bilerek sonda (0.13 spec B): pencere kurulum boyunca opak kalır, şeffaflık kurulum bitince uygulanır; "Vazgeç" hiç yazmaz.
// Testler: tests/kurulum-v2.test.ts, tests/nerede.test.ts; önizleme scripts/dev/kurulum2-onizle.mjs (her ekran × 3 boy — 1440×900, 1080×680,
// 1536×816 — × 2 tema; boşluk kuralı; tasmaDenetle).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cagir, dinle } from '../api';
import { opakSahne } from '../tema';
import { Ikon } from '../bilesenler/Ikon';
import { useMotorSinyali } from '../motor-sinyali';
import { AdimGecisi, FuberYazisi, HapDugme, IlerlemeCizgisi, ONIZLEME_GECIKMESI_MS } from '../ui/fintech';
import { gunBaslangici, isProfiliYamasi } from '../../shared/kurulum-adimlari';
import { kurulum2Sirasi, kurulumTamamlaGovdesi, sesIndirilsinMi, taslakBaslangici, temaYamasi, type Kurulum2Kipi, type KurulumTaslagi } from '../../shared/kurulum-taslak';
import { vazgecGeriAlma } from '../../shared/kurulum-vazgec';
import { gizliKapanincaSecim, neredeOnSecimi } from '../../shared/nerede';
import { sec } from '../../shared/kurulum-metin';
import { sizliMi } from '../../shared/hitap';
import { modKip } from '../../shared/karakterler';
import { vurguStili } from '../ui/vurgu';
import type { Ayarlar, SesBilgisi } from '../../shared/tipler';
import { AdimBaglamiK, type AdimBaglami } from './baglam';
import { useSesBilgisi } from '../ayarlar/SesSecimi';
import { adimTanimi } from './adimlar';
import { bagliSayisi } from './adimlar/Baglantilar';
import { sesBilgisayardan } from './adimlar/Ses';
import { useYerelKarar } from './yerel-karar';
import './kurulum2.css';

/** Çift tıklamanın ikinci ve sonraki tıklamaları (geçiş sürerken gelir) yok sayılır: adım atlanmasın. Klavye (detail 0) geçer. */
const cokluTik = (e?: { detail?: number }) => (e?.detail ?? 0) > 1;

export function Kurulum2({ kip = 'ilk', bitti }: { kip?: Kurulum2Kipi; bitti: (sonuc: 'tamam' | 'vazgec') => void }) {
  const [ayar, setAyar] = useState<Ayarlar | null>(null);
  const acilis = useRef<Ayarlar | null>(null);
  useEffect(() => {
    void cagir<Ayarlar>('ayarlar:al').then((a) => { acilis.current = structuredClone(a); setAyar(a); });
    // Köşedeki pencere düğmesi çentiği sahnenin renginde (kurulum2.css :root[data-sahne='kurulum']).
    document.documentElement.dataset.sahne = 'kurulum';
    // 0.13 T13: tema Şeffaf olsa bile kurulum açıkken pencere opak (sistem malzemesi 'none'); kapanınca tema geri gelir (main/tema.ts).
    const opakKapat = opakSahne();
    const birak = dinle('ayarlar:degisti', (a: Ayarlar) => setAyar(a));
    return () => { birak(); opakKapat(); delete document.documentElement.dataset.sahne; };
  }, []);
  // 0.14 T32: ekranın tek vurgusu kökte (ui/vurgu.ts; kurulum = seçilen kipin karakter rengi). Ayar gelene dek varsayılan kip (Business).
  if (!ayar || !acilis.current) return <div className="k2" data-kip={kip} data-vurgu="kurulum" style={vurguStili('kurulum') as CSSProperties} aria-busy="true" />;
  return <Kurulum2Govde kip={kip} bitti={bitti} ayar={ayar} setAyar={setAyar} acilis={acilis.current} />;
}

function useSimdi(): Date {
  const [d, setD] = useState(() => new Date());
  useEffect(() => { const z = setInterval(() => setD(new Date()), 20_000); return () => clearInterval(z); }, []);
  return d;
}

function Kurulum2Govde({ kip, bitti, ayar, setAyar, acilis }: {
  kip: Kurulum2Kipi; bitti: (sonuc: 'tamam' | 'vazgec') => void; ayar: Ayarlar; setAyar: (a: Ayarlar) => void; acilis: Ayarlar;
}) {
  const sira = useMemo(() => kurulum2Sirasi(kip), [kip]);
  const [sesBilgisi, sesYukle] = useSesBilgisi();
  // Çalışma saatlerinin açılış hâli: yeni kurulumda önerilen; yeniden açılanda kayıtlı profil ya da sessiz saatin tersi (I1 5b).
  const gunAcilis = useMemo(() => gunBaslangici(kip === 'ilk' ? 'ilk' : 'yeniden', acilis.isProfili, acilis.proaktif), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [taslak, setTaslak] = useState<KurulumTaslagi>(() => taslakBaslangici(acilis, kip, { bas: gunAcilis.bas, bit: gunAcilis.bit }));
  const acilisIs = useRef({ sirket: (acilis.isProfili?.sirket ?? '').trim(), gunBas: gunAcilis.bas, gunBit: gunAcilis.bit });
  const [i, setI] = useState(0);
  const [yon, setYon] = useState<1 | -1>(1);
  const [bitiriliyor, setBitiriliyor] = useState(false);
  const [hata, setHata] = useState('');
  const kapaniyor = useRef(false);
  const kok = useRef<HTMLDivElement>(null);
  const simdi = useSimdi();
  // 0.13.1: resmî hitap seçildiyse kurulum metinleri "siz" konuşur (Adım 3 önizlemesinden sonuna; shared/kurulum-metin.ts).
  const siz = sizliMi(taslak.hitap);
  const { gorunum, motor } = useMotorSinyali();
  const id = sira[Math.min(i, sira.length - 1)];
  const tanim = adimTanimi(id);
  const son = i === sira.length - 1;

  const kaydet = (d: Partial<Ayarlar>) => void cagir<Ayarlar>('ayarlar:kaydet', d).then(setAyar).catch(() => undefined);
  const yenile = () => void cagir<Ayarlar>('ayarlar:al').then(setAyar).catch(() => undefined);
  const degistir: AdimBaglami['degistir'] = (y) => setTaslak((t) => (typeof y === 'function' ? y(t) : { ...t, ...y }));
  // Nerede'nin o anki seçimi (Y1): açık seçim varsa o, yoksa GERÇEK hâl (Gizli / Yalnız bu bilgisayar / hesapsız geçişte yerel / Fuber).
  const nerede = neredeOnSecimi({ secim: taslak.nerede, gizliMod: ayar.yerel?.gizliMod === true, yalnizYerel: ayar.yerel?.yalnizYerel === true, hesapsiz: taslak.akis.hesapsiz });
  const yerel = useYerelKarar({
    ayar, kaydet, etkin: kip === 'yeniden' || i >= sira.indexOf('tanisma'), adimda: id === 'nerede', yerelSecili: nerede !== 'fuber',
    secimDondu: (n) => degistir({ nerede: n }),
  });
  // Y1: gerçek Gizli hâli açıktan kapalıya döndüyse (hesap adımında "Gizli moddan çık ve devam et", ya da Gizli kendiliğinden geri alındı) bu
  // kurulumdaki açık "Gizli" seçimi düşer — "Devam" Gizli'yi yeniden açmaz; kullanıcı Gizli'yi yine açıkça seçebilir.
  const sonGizli = useRef(ayar.yerel?.gizliMod === true);
  useEffect(() => {
    const simdi = ayar.yerel?.gizliMod === true;
    const once = sonGizli.current;
    sonGizli.current = simdi;
    if (once !== simdi) setTaslak((t) => { const n = gizliKapanincaSecim(t.nerede, once, simdi); return n === t.nerede ? t : { ...t, nerede: n }; });
  }, [ayar.yerel?.gizliMod]);

  const gizliAcik = ayar.yerel?.gizliMod === true;

  // Adım değişince odak yeni adımın başlığına (bir alan kendini odaklamadıysa): klavye ve ekran okuyucu yeni soruyu duyar.
  useEffect(() => {
    const z = requestAnimationFrame(() => {
      const a = document.activeElement as HTMLElement | null;
      const gir = kok.current?.querySelector('.k2__icerik [data-gecis="gir"]');
      if (a && gir?.contains(a) && a !== document.body) return;
      gir?.querySelector<HTMLElement>('[data-adim-baslik]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(z);
  }, [id]);

  const t2: KurulumTaslagi = { ...taslak, akis: { ...taslak.akis, hesapBagli: false, yerelBekliyor: yerel.bekliyor } };
  const gecerli = tanim.gecerliMi(t2);

  const git = (yeni: number) => {
    setYon(yeni >= i ? 1 : -1);
    setI(Math.max(0, Math.min(sira.length - 1, yeni)));
  };
  const tamamla = async () => {
    if (kapaniyor.current) return;
    kapaniyor.current = true;
    setBitiriliyor(true);
    setHata('');
    try {
      if (kip === 'ilk') {
        await cagir('kurulum:tamamla', kurulumTamamlaGovdesi(taslak));
      } else if (kip === 'yeniden') {
        // İş profili yalnız gerçekten değiştiyse; saatler yalnız kayıtta varsa ya da değiştiyse (dokunulmamış saat sessiz saati ezmez).
        const yama = isProfiliYamasi(ayar.isProfili, { sirket: taslak.sirket, gunBas: taslak.gunBas, gunBit: taslak.gunBit }, acilisIs.current);
        await cagir('ayarlar:kaydet', { kullaniciAdi: taslak.ad.trim(), hitap: taslak.hitap.trim(), proaktif: { ...ayar.proaktif, sabahOzeti: taslak.sabah }, baslangictaAc: taslak.baslangictaAc, ...(yama ? { isProfili: yama } : {}), ...temaYamasi(ayar.gorunum, taslak.tema) });
      }
    } catch {
      kapaniyor.current = false;
      setBitiriliyor(false);
      setHata('Kaydedemedim. Bir daha dene.');
      return;
    }
    bitti('tamam');
  };
  /** Adımdan İLERİ çıkarken o adımın arka plan işleri. */
  const cikarkenUygula = () => {
    if (id === 'nerede') {
      // "Devam" o an görünen seçimi uygular (açık seçim olur); hiçbir sürüm hazırlanamıyorsa Fuber'e döner (Hazırsın söyler).
      const n = yerel.uygula({ nerede, model: taslak.model });
      degistir({ nerede: n });
    }
    if (id === 'ses' && sesBilgisayardan({ nerede, ayar })) {
      // Bu bilgisayarın sesi kurulu değilse bir kez, arka planda iner (kurulum beklemez) — yalnız "Sesli konuşma" açıksa: kapalıyken 86 MB inmez.
      // Anahtar anında kaydedilir; en son kayıtlı değer ana süreçten okunur (bayat arayüz kopyası kararı bozmasın).
      void Promise.all([cagir<Ayarlar>('ayarlar:al'), cagir<SesBilgisi>('ses:bilgi')]).then(([a, b]) => {
        if (sesIndirilsinMi({ seslendirme: a.ses.seslendirme, bilgisayardan: true, kurulu: b.yedek.kurulu }) && !(b.yedek.indirme && !b.yedek.indirme.hata)) void cagir('ses:yedek-kur').catch(() => undefined);
      }).catch(() => undefined);
    }
  };
  const ileri = () => {
    if (bitiriliyor) return;
    cikarkenUygula();
    if (son) { void tamamla(); return; }
    git(i + 1);
  };
  const ileriRef = useRef(ileri);
  ileriRef.current = ileri;
  const geri = () => { if (i > 0) git(i - 1); };

  const vazgec = async () => {
    if (kapaniyor.current) return;
    kapaniyor.current = true;
    const s = await cagir<Ayarlar>('ayarlar:al').catch(() => null);
    const g = s ? vazgecGeriAlma(acilis, s) : null;
    if (g) {
      await cagir('ayarlar:kaydet', g.ayar).catch(() => undefined);
      if (g.bekleyenGizliKapat) await cagir('yerel:bekleyen-gizli', false).catch(() => undefined);
    }
    bitti('vazgec');
  };


  const birincilAd = bitiriliyor ? (kip === 'ilk' ? 'Açılıyor…' : 'Kaydediliyor…')
    : id === 'hosgeldin' && kip === 'ilk' ? 'Başlayalım'
    : id === 'baglantilar' && bagliSayisi(ayar) === 0 ? 'Şimdilik atla'
    : son ? (kip === 'ilk' ? 'Fuber’i aç' : kip === 'yeniden' ? 'Bitti' : 'Devam')
    : 'Devam';
  // Klavyenin genel Enter'ı (aşağıda). Google onayında Enter bilgisayarı BAĞLAMAZ (düzeltme turu 1, inceleme küçük 2: odak başlıkta; bağlama
  // yalnız "Bu hesapla devam et" düğmesinin kendisiyle), Google beklerken bir şey yapmaz ve "Gizli moddan çıkılsın mı?" onayında Gizli'yi KAPATMAZ.
  const birincil = () => {
    if (gecerli) ileriRef.current();
  };
  const birincilRef = useRef(birincil);
  birincilRef.current = birincil;
  const vazgecRef = useRef(vazgec);
  vazgecRef.current = vazgec;

  // Klavye: Enter birincil düğme (odak bir düğmede, metin alanında ya da formda değilse — onlar kendi Enter'ını işler); Esc yeniden kipte Vazgeç.
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[data-levha]')) return;
      if (e.key === 'Escape' && kip === 'yeniden') { e.preventDefault(); void vazgecRef.current(); return; }
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const h = e.target as HTMLElement | null;
      if (h?.closest('button, a, textarea, form, [role="switch"], [role="radio"], [role="spinbutton"]')) return;
      e.preventDefault();
      birincilRef.current();
    };
    addEventListener('keydown', tus);
    return () => removeEventListener('keydown', tus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const baglam: AdimBaglami = {
    kip, taslak: t2, degistir, ayar, siz, m: (c) => sec(siz, c), kaydet, yenile, ileri: () => ileriRef.current(),
    yerel, ses: { bilgi: sesBilgisi, yukle: sesYukle }, nerede, motor: { gorunum, yarim: Boolean(motor.yarim) }, simdi, gunAcilis,
  };
  const { Bilesen, Onizleme } = tanim;
  const kapali = bitiriliyor || !gecerli;
  const geriVar = i > 0;
  const geriKapali = bitiriliyor;

  return (
    <div
      ref={kok} className="k2" data-kip={kip} data-adim={i} data-adim-id={id} data-vurgu="kurulum" style={vurguStili('kurulum', modKip(taslak.mod)) as CSSProperties}
      {...(kip === 'yeniden' ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Kurulum' } : {})}
    >
      <header className="k2__ust">
        <span className="k2__marka" aria-hidden="true"><FuberYazisi yukseklik={11} /></span>
        {sira.length > 1 ? <IlerlemeCizgisi simdi={i + 1} toplam={sira.length} /> : <span />}
        <span />
      </header>
      <AdimBaglamiK.Provider value={baglam}>
        <main className="k2__govde" aria-label={`Kurulum: ${tanim.ad}`}>
          <AdimGecisi anahtar={id} yon={yon} className="k2__icerik"><Bilesen /></AdimGecisi>
          <AdimGecisi anahtar={id} yon={yon} gecikme={ONIZLEME_GECIKMESI_MS} className="k2__onizleme"><Onizleme /></AdimGecisi>
        </main>
      </AdimBaglamiK.Provider>
      <footer className="k2__alt">
        <div className="k2__alt-sol">
          {kip === 'yeniden' && <HapDugme tur="hayalet" onClick={() => void vazgec()} title="Değiştirmeden kapat (Esc)" data-vazgec="">Vazgeç</HapDugme>}
          {geriVar && <HapDugme tur="hayalet" simge={<Ikon ad="geri" olcu={16} />} disabled={geriKapali} onClick={(e) => { if (cokluTik(e)) return; geri(); }} data-geri="">Geri</HapDugme>}
        </div>
        <span className="k2__alt-not" role={hata ? 'status' : undefined} data-alt-not={hata ? '' : undefined}>{hata}</span>
        <div className="k2__alt-sag">
          <HapDugme
            key={id === 'hazirsin' ? 'son' : 'ileri'} tur="birincil" boy="b" kisayol="⏎"
            type="button" disabled={kapali}
            onClick={(e) => { if (cokluTik(e)) { e.preventDefault(); return; } ileri(); }}
            data-ileri="" data-son={son ? '' : undefined}
          >{birincilAd}</HapDugme>
        </div>
      </footer>
    </div>
  );
}
