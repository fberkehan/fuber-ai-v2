// ── Tekrar hoş geldin (0.12 H3a, spec §2; baştan) ───────────────────────────────────────────────────────────────────────────────────
// Daha önce kurulu olan bilgisayarlara özel giriş ekranı: devam mı etmek istiyorsunuz, sıfırdan mı?
// Kullanıcı Fuber'i kaldırırken "verilerim kalsın" dedi (kaldırıcı veri klasörüne `.yeniden-kurulum` yazdı; build/kurulum.nsh — GÜNCELLEME
// işaret yazmaz) ve yeniden kurdu: açılışta, kurulum ve kokpitten önce TEK ekran (shared/kurulum-adimlari.ts kurulumYolu →
// 'tekrar-hos-geldin'). Fintech kabuğu (kurulum2 ile aynı dil, opak tam pencere): solda tek soru ve iki büyük seçenek, sağda TEK kart —
// baş harf, e-posta, "Son kullanım: 3 gün önce" ve bu bilgisayarda duranlar: sohbet ve hafıza SAYILARI (`veri:ozet`; uygulamanın kendi
// sayıları), ayarlar, varsa indirilen yapay zekâ. Sayı 0 ise satır "Boş" der (H3a düzeltme turu 1, Ö4: "0 sohbet" + "Yerinde ✓" yok).
//  · "Kaldığın yerden devam et" (önerilen, seçili): işaret silinir (`veri:devam`); hesabın hâli sunucuya bir kez sorulur. Cihaz anahtarı
//    geçersizse (401 / askı) kayıt SİLİNMEZ, durumu 'kapali' olur (main/hesap.ts) — 0.12 H3b (H3a incelemesi a): böyle bir kayıt "hesap yok"
//    sayılır (shared/masaustu-hesap.ts hesapGecerliMi). Sonra kurulumYolu: geçerli hesap yoksa YALNIZ hesap ekranı (yeniden giriş), kurulum
//    bitmemişse kurulum, yoksa kokpit.
//  · "Sıfırdan başla": bu bilgisayarın hesap bağlantısı kapatılır (en iyi çaba), uygulama yeniden açılır ve veri klasörü açılmadan kişisel
//    dosyalar yedeğe TAŞINIR (silinmez; main/veri/temizlik.ts) — sonra yeni kurulum.
import { useEffect, useState, type CSSProperties } from 'react';
import { cagir, dinle } from '../api';
import { opakSahne } from '../tema';
import { Ikon } from '../bilesenler/Ikon';
import { AdimGecisi, MiniLogo, FuberYazisi, HapDugme, ONIZLEME_GECIKMESI_MS, SecimGrubu, Tepsi } from '../ui/fintech';
import { kurulumYolu, type KurulumYolu } from '../../shared/kurulum-adimlari';
import {
  DEVAM_ACIKLAMA, DEVAM_DUGME, SIFIRDAN_DUGME, sifirdanNotu, TEKRAR_BASLIK_KISA, TEKRAR_BOS, TEKRAR_GIRIS_KISA, TEKRAR_GUVENCE, basHarf, sonKullanimGoreli, tekrarSatirlari,
  type VeriDurumu, type VeriIslemYaniti,
} from '../../shared/veri-islemi';
import { hesapGecerliMi, type HesapAyari } from '../../shared/masaustu-hesap';
import type { Ayarlar, Mod } from '../../shared/tipler';
import { modKip } from '../../shared/karakterler';
import { vurguStili } from '../ui/vurgu';
import { Not } from '../kurulum2/Ortak';
import '../kurulum2/kurulum2.css';

/** Hesabın hâli sunucuya en çok bu kadar beklenir (ağ yoksa kayıtlı hâlle sürer). */
const HESAP_SURESI_MS = 6000;
const BOS: VeriDurumu = { yenidenKurulum: true, hafiza: 0, sohbet: 0, sonKullanim: null, hesapEposta: null, yedekSayisi: 0, yedekBayt: null, yerelBayt: null, boyutTam: true, kaldirilabilir: false };

export function TekrarHosGeldin({ bitti }: { bitti: (sonraki: Exclude<KurulumYolu, 'tekrar-hos-geldin'>) => void }) {
  const [d, setD] = useState<VeriDurumu | null>(null);
  const [ad, setAd] = useState('');
  const [gizli, setGizli] = useState(false);
  // 0.14 T32: ekranın tek vurgusu kayıtlı kipin rengi (ui/vurgu.ts 'kurulum' = karakter; Sade'de de aynı renk, çizim yok).
  const [mod, setMod] = useState<Mod>('is');
  const [secim, setSecim] = useState<'devam' | 'sifirdan'>('devam');
  const [bekle, setBekle] = useState(false);
  const [hata, setHata] = useState('');
  useEffect(() => {
    // Önce sayılar (hızlı), sonra boyutlar (indirilen yapay zekâ satırı; tarama sınırlı, ≤ 2 sn — gelmezse satır yok).
    void cagir<VeriDurumu>('veri:ozet').then((x) => {
      setD(x);
      void cagir<VeriDurumu>('veri:ozet', { boyut: true }).then((b) => setD((o) => ({ ...(o ?? x), yerelBayt: b.yerelBayt, boyutTam: b.boyutTam }))).catch(() => undefined);
    }, () => setD(BOS));
    // 0.12 H3b düzeltme turu 2 (Y2): Gizli'de "Sıfırdan başla"nın notu "hesabından çıkar" demez (çıkış sunucuya bildirilmez).
    void cagir<Ayarlar>('ayarlar:al').then((a) => { setAd(a.kullaniciAdi ?? ''); setGizli(a.yerel?.gizliMod === true); setMod(a.mod === 'gelistirici' ? 'gelistirici' : 'is'); }).catch(() => undefined);
    document.documentElement.dataset.sahne = 'kurulum';
    const opakKapat = opakSahne(); // 0.13 T13: tema Şeffaf olsa bile bu ekran opak (main/tema.ts)
    // Kip başka yerden değişirse (telefon, test) vurgu izler.
    const birak = dinle('ayarlar:degisti', (a: Ayarlar) => setMod(a.mod === 'gelistirici' ? 'gelistirici' : 'is'));
    return () => { birak(); opakKapat(); delete document.documentElement.dataset.sahne; };
  }, []);

  const devam = async () => {
    setBekle(true);
    setHata('');
    try {
      await cagir('veri:devam');
      const a = await cagir<Ayarlar>('ayarlar:al');
      const yol = kurulumYolu({ veriVar: true, yenidenKurulum: false, kurulumTamam: a.kurulumTamam, hesapVar: hesapGecerliMi(a.hesap), hesapsizTercih: a.hesapsizTercih === true });
      bitti(yol === 'tekrar-hos-geldin' ? 'yok' : yol);
    } catch {
      setBekle(false);
      setHata('Olmadı; bir daha dene.');
    }
  };
  const sifirdan = async () => {
    setBekle(true);
    setHata('');
    const r = await cagir<VeriIslemYaniti>('veri:yeni-basla').catch((): VeriIslemYaniti => ({ tamam: false, hata: 'Olmadı; bir daha dene.' }));
    // Tamam: uygulama kapanıp yeniden açılıyor (düğme beklemede kalır).
    if (!r.tamam) { setBekle(false); setHata(r.hata); }
  };
  const ilerle = (e?: { detail?: number }) => {
    if (bekle || (e?.detail ?? 0) > 1) return;
    void (secim === 'devam' ? devam() : sifirdan());
  };
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || (e.target as HTMLElement | null)?.closest('button')) return;
      e.preventDefault();
      ilerle();
    };
    addEventListener('keydown', tus);
    return () => removeEventListener('keydown', tus);
  });

  const v = d ?? BOS;
  const baslik = ad.trim() ? `${TEKRAR_BASLIK_KISA}, ${ad.trim().split(/\s+/)[0]}.` : `${TEKRAR_BASLIK_KISA}.`;
  return (
    <div className="k2 k2--tekrar" data-tekrar="" data-kip="tekrar" data-vurgu="kurulum" style={vurguStili('kurulum', modKip(mod)) as CSSProperties} aria-busy={d ? undefined : 'true'}>
      <header className="k2__ust">
        <span className="k2__marka" aria-hidden="true"><FuberYazisi yukseklik={11} /></span>
        <span />
        <span />
      </header>
      <main className="k2__govde" aria-label="Tekrar hoş geldin">
        <AdimGecisi anahtar="tekrar" className="k2__icerik">
          <div className="k2-adim">
            <header className="k2-bas">
              <h1 className="ft-baslik" data-kademe="" style={{ '--k': 0 } as CSSProperties}>{baslik}</h1>
              <p className="ft-giris" data-kademe="" style={{ '--k': 1 } as CSSProperties}>{TEKRAR_GIRIS_KISA}</p>
            </header>
            <div data-kademe="" style={{ '--k': 2 } as CSSProperties}>
              <SecimGrubu etiket="Nasıl sürdürelim" deger={secim} sec={setSecim} secenekler={[
                { deger: 'devam', baslik: DEVAM_DUGME, simge: 'ileri', onerilen: true, aciklama: DEVAM_ACIKLAMA },
                { deger: 'sifirdan', baslik: SIFIRDAN_DUGME, simge: 'yenile', aciklama: sifirdanNotu(gizli) },
              ]} />
            </div>
            <div data-kademe="" style={{ '--k': 3 } as CSSProperties}><Not simge="kalkan" data-tekrar-guvence="">{TEKRAR_GUVENCE}</Not></div>
          </div>
        </AdimGecisi>
        <AdimGecisi anahtar="tekrar" gecikme={ONIZLEME_GECIKMESI_MS} className="k2__onizleme">
            <Tepsi etiket="Bu bilgisayardaki Fuber" dip={<><Ikon ad="kilit" olcu={14} /> Hafızan ve ayarların bu bilgisayarda saklanır.</>}>
              <div className="k2-tekrar-kart" data-tekrar-ozeti="">
                <div className="k2-tekrar-kart__ust">
                  <span className="k2-avatar" aria-hidden="true">{basHarf(ad, v.hesapEposta)}</span>
                  <span className="k2-tekrar-kart__kim">
                    <b data-ozet-satiri="Fuber hesabı">{v.hesapEposta ?? (ad.trim() || 'Bu bilgisayar')}</b>
                    {/* Tarih bilinmiyorsa "Son kullanım: Bilinmiyor" yazılmaz (görüntüde yarım duruyordu): hesabın ya da bilgisayarın hâli. */}
                    {v.sonKullanim
                      ? <span data-ozet-satiri="Son kullanım">Son kullanım: {sonKullanimGoreli(v.sonKullanim)}</span>
                      : <span>'Bu bilgisayarda'</span>}
                  </span>
                  <MiniLogo olcu={24} />
                </div>
                {/* Bu bilgisayarda duranlar (gruplu liste, kartın içinde): gerçek sayılar; 0 ise "Boş", onay işareti yok. */}
                <ul className="k2-tekrar-liste" aria-label="Bu bilgisayarda duranlar">
                  {tekrarSatirlari(v).map((s) => (
                    <li key={s.id} className="k2-tekrar-liste__oge" data-tekrar-satir={s.id} data-bos={s.deger === null ? '' : undefined}>
                      <span className="k2-tekrar-liste__simge" aria-hidden="true"><Ikon ad={s.simge} olcu={17} /></span>
                      <span className="k2-tekrar-liste__ad">{s.ad}</span>
                      <span className="k2-tekrar-liste__hal" data-deger={s.deger ?? ''}>
                        {s.deger === null ? TEKRAR_BOS : <>{s.birim ? <><b>{s.deger}</b> {s.birim}</> : s.deger}<Ikon ad="tamam" olcu={14} kalinlik={2.2} /></>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Tepsi>
        </AdimGecisi>
      </main>
      <footer className="k2__alt">
        <div className="k2__alt-sol" />
        <span className="k2__alt-not" role={hata ? 'status' : undefined} data-alt-not={hata ? '' : undefined}>{hata}</span>
        <div className="k2__alt-sag">
          <HapDugme tur="birincil" boy="b" kisayol="⏎" bekliyor={bekle} disabled={bekle || !d} onClick={(e) => ilerle(e)} data-ileri="" data-tekrar-eylem={secim}>
            {secim === 'devam' ? 'Devam et' : SIFIRDAN_DUGME}
          </HapDugme>
        </div>
      </footer>
    </div>
  );
}
