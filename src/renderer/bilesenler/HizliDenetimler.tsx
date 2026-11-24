// ── Sol ray hızlı denetimleri (K6): mikrofon, ada, sürekli dinleme, rahatsız etme ────────────────────────────────────
// Ayarlar içinde aramadan tek tıkla: mikrofonu tamamen kapat ("Hey Fuber" + gün kaydı + sesle sorma), adayı göster / 1 saat gizle /
// tamamen kapat (küçük menü), sürekli dinlemeyi (gün kaydı) kapat, 1 saat rahatsız etme (hatırlatıcılar hariç). Ayarlarla AYNI alanları
// yazar (tek doğruluk kaynağı: ayarlar:kaydet → 'ayarlar:degisti'); Ayarlar'da da görünürler (Ses, Görünüm, Düşünme motoru,
// Kendiliğinden yazma). Kapalı olan üstü çizili simgeyle durur; süreli olanlarda (1 saat gizle, rahatsız etme, duraklatma) küçük
// kehribar nokta ve ipucunda bitiş saati. Sürekli dinlemeyi AÇMAK rıza ister: Ayarlar → Düşünme motoru açılır.
import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent as TusOlayi } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from './Ikon';
import { sureSuruyor } from '../../shared/ada';
import type { Ayarlar } from '../../shared/tipler';
import './hizli-denetimler.css';

const SAAT_MS = 3600_000;
const saatMetni = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
type AdaSecimi = 'goster' | 'gizli' | 'kapali';

/** Ray düğmesi: simge (kapalıyken üstü çizili), süreli durumda nokta, üzerine gelince iki satırlık ipucu. */
function Dugme({ ad, simge, kapali, sureli, baslik, durum, ...p }: {
  ad: string; simge: string; kapali: boolean; sureli?: boolean; baslik: string; durum: string;
} & ComponentProps<'button'>) {
  return (
    <button type="button" className="ray__hizli" data-hizli={ad} data-kapali={kapali ? '' : undefined} {...p}>
      <Ikon ad={simge} olcu={18} ustuCizili={kapali} />
      {sureli && <span className="ray__hizli-nokta" aria-hidden="true" />}
      <span className="ray__ipucu ray__ipucu--hizli" aria-hidden="true"><b>{baslik}</b><span>{durum}</span></span>
    </button>
  );
}

/** `ilk`: kabuğun (main.tsx) zaten yüklediği ayarlar — A7 (son düzeltme): denetimler ilk karede çizilir. Eskiden kendi ayar isteği
 *  dönene dek hiçbir şey çizilmiyor, `.ray__alt` (margin-top: auto) Tarayıcı/Asistan düğmelerini her açılışta ~150 px zıplatıyordu. */
export function HizliDenetimler({ ilk }: { ilk?: Ayarlar | null } = {}) {
  const [a, setA] = useState<Ayarlar | null>(ilk ?? null);
  const [, yenidenCiz] = useState(0);
  const [menu, setMenu] = useState(false);
  const kok = useRef<HTMLDivElement>(null);
  const adaDugmesi = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void cagir<Ayarlar>('ayarlar:al').then(setA).catch(() => undefined);
    return dinle('ayarlar:degisti', (y: Ayarlar) => setA(y));
  }, []);
  // Süreli durumlar bitince (1 saat gizle, rahatsız etme, gün kaydı duraklatma) düğme kendiliğinden eski hâline dönsün.
  useEffect(() => {
    if (!a) return;
    const kalan = [a.gorunum?.adaGizliBitis, a.proaktif?.rahatsizEtmeBitis, a.gunKaydi?.duraklatBitis]
      .map((x) => (x ? Date.parse(x) - Date.now() : NaN)).filter((x) => x > 0);
    if (!kalan.length) return;
    // En geç 30 sn'de bir: uyku sonrası geciken zamanlayıcı bitişi kaçırmasın.
    const z = setTimeout(() => yenidenCiz((n) => n + 1), Math.min(Math.min(...kalan) + 250, 30_000));
    return () => clearTimeout(z);
  });
  // Menü dışına tıklanınca kapanır.
  useEffect(() => {
    if (!menu) return;
    const disari = (e: MouseEvent) => { if (!kok.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', disari);
    return () => document.removeEventListener('mousedown', disari);
  }, [menu]);
  // Menü açılınca seçili öğe klavye odağını alır.
  useEffect(() => {
    if (!menu) return;
    const m = kok.current?.querySelector('.hizli-menu');
    (m?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ?? m?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
  }, [menu]);
  // Ayar henüz yoksa aynı ölçüde görünmez yer tutucu: rayın alt grubu yerinden oynamasın (A7).
  if (!a) {
    return (
      <div className="ray__hizli-grup" data-yer-tutucu="" aria-hidden="true" style={{ visibility: 'hidden' }}>
        {[0, 1, 2, 3].map((i) => <span key={i} className="ray__hizli" />)}
      </div>
    );
  }

  const kaydet = (d: Partial<Ayarlar>) => void cagir<Ayarlar>('ayarlar:kaydet', d).then(setA).catch(() => undefined);
  const simdi = Date.now();
  const mikrofonKapali = Boolean(a.ses.mikrofonKapali);
  const g = a.gorunum;
  const adaGizli = sureSuruyor(g.adaGizliBitis, simdi);
  const adaSecimi: AdaSecimi = g.ada === 'kapali' ? 'kapali' : adaGizli ? 'gizli' : 'goster';
  const gk = a.gunKaydi;
  const duraklatildi = gk.etkin && sureSuruyor(gk.duraklatBitis, simdi);
  const dinliyor = gk.etkin && !duraklatildi && !mikrofonKapali;
  const rahatsiz = sureSuruyor(a.proaktif.rahatsizEtmeBitis, simdi);

  const adaSec = (s: AdaSecimi) => {
    kaydet({ gorunum: { ...g, ada: s === 'kapali' ? 'kapali' : 'goster', adaGizliBitis: s === 'gizli' ? new Date(Date.now() + SAAT_MS).toISOString() : undefined } });
    menuyuKapat();
  };
  const menuyuKapat = () => { setMenu(false); adaDugmesi.current?.focus(); };
  const sureklidinleme = () => {
    if (mikrofonKapali) return;
    if (duraklatildi) kaydet({ gunKaydi: { ...gk, duraklatBitis: undefined } });
    else if (gk.etkin) kaydet({ gunKaydi: { ...gk, etkin: false } });
    // Açmak rıza ister (TCK/KVKK uyarısı ve "Anladım, aç"): Ayarlar → Düşünme motoru.
    else void cagir('ana:goster', 'ayarlar#dusunme');
  };
  // Menüde ok tuşları, Home/End; Esc ve Tab kapatır (Esc odağı düğmeye geri verir).
  const menuTusu = (e: TusOlayi<HTMLDivElement>) => {
    const ogeler = [...(kok.current?.querySelectorAll<HTMLElement>('.hizli-menu [role^="menuitem"]') ?? [])];
    const i = ogeler.indexOf(document.activeElement as HTMLElement);
    const git = (n: number) => { e.preventDefault(); ogeler[(n + ogeler.length) % ogeler.length]?.focus(); };
    if (e.key === 'ArrowDown') git(i + 1);
    else if (e.key === 'ArrowUp') git(i - 1);
    else if (e.key === 'Home') git(0);
    else if (e.key === 'End') git(ogeler.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); menuyuKapat(); }
    else if (e.key === 'Tab') setMenu(false);
  };

  const adaDurumu = adaSecimi === 'kapali' ? 'Kapalı · kendiliğinden inmez' : adaSecimi === 'gizli' ? `Gizli · ${saatMetni(g.adaGizliBitis!)}’e kadar` : g.adaSessiz !== false ? 'Açık · boştayken de görünür' : 'Açık · yalnız bir şey olunca iner';

  return (
    <div className="ray__hizli-grup" ref={kok} role="group" aria-label="Hızlı denetimler" data-tur="hizli">
      <Dugme
        ad="mikrofon" simge="mikrofon" kapali={mikrofonKapali} role="switch" aria-checked={!mikrofonKapali} aria-label="Mikrofon"
        baslik={mikrofonKapali ? 'Mikrofon kapalı' : 'Mikrofon açık'}
        durum={mikrofonKapali ? '“Hey Fuber”, gün kaydı ve sesle sorma kapalı · açmak için tıkla' : 'Tamamen kapatmak için tıkla'}
        onClick={() => kaydet({ ses: { ...a.ses, mikrofonKapali: !mikrofonKapali } })}
      />
      <div className="ray__hizli-sar">
        <Dugme
          ad="ada" simge="ada" kapali={adaSecimi !== 'goster'} sureli={adaSecimi === 'gizli'} ref={adaDugmesi}
          aria-haspopup="menu" aria-expanded={menu} aria-label="Ada (üstteki çentik)"
          baslik="Ada (üstteki çentik)" durum={menu ? 'Seçenekler açık' : adaDurumu}
          onClick={() => setMenu((m) => !m)}
          onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setMenu(true); } }}
        />
        {menu && (
          <div className="hizli-menu" role="menu" aria-label="Ada" onKeyDown={menuTusu}>
            <div className="hizli-menu__baslik">Ada (üstteki çentik)</div>
            {([['goster', 'Göster'], ['gizli', '1 saat gizle'], ['kapali', 'Tamamen kapat']] as [AdaSecimi, string][]).map(([s, ad]) => (
              <button key={s} type="button" role="menuitemradio" aria-checked={adaSecimi === s} className="hizli-menu__oge" onClick={() => adaSec(s)}>
                <span className="hizli-menu__isaret">{adaSecimi === s && <Ikon ad="tamam" olcu={14} kalinlik={2} />}</span>
                <span>{ad}</span>
                {s === 'gizli' && adaSecimi === 'gizli' && <span className="hizli-menu__ek">{saatMetni(g.adaGizliBitis!)}’e kadar</span>}
              </button>
            ))}
            <div className="hizli-menu__ayrac" role="separator" />
            <button type="button" role="menuitemcheckbox" aria-checked={g.adaSessiz !== false} className="hizli-menu__oge"
              onClick={() => { kaydet({ gorunum: { ...g, adaSessiz: g.adaSessiz === false } }); menuyuKapat(); }}>
              <span className="hizli-menu__isaret" />
              <span>Boştayken göster</span>
              <span className="anahtar hizli-menu__anahtar" aria-hidden="true" aria-checked={g.adaSessiz !== false} />
            </button>
            <p className="hizli-menu__not">Uygulama öndeyken ada görünmez; o sırada gelenler burada bildirim olur. Kapalıyken hatırlatıcılar Windows bildirimi olur.</p>
          </div>
        )}
      </div>
      <Dugme
        ad="dinleme" simge="dalga" kapali={!dinliyor} sureli={duraklatildi && !mikrofonKapali} role="switch" aria-checked={dinliyor}
        aria-label="Sürekli dinleme (gün kaydı)" aria-disabled={mikrofonKapali || undefined}
        baslik={mikrofonKapali ? 'Sürekli dinleme · mikrofon kapalı' : dinliyor ? 'Sürekli dinleme açık' : duraklatildi ? 'Sürekli dinleme duraklatıldı' : 'Sürekli dinleme kapalı'}
        durum={mikrofonKapali ? 'Önce mikrofonu aç' : dinliyor ? 'Gün kaydı dinliyor · kapatmak için tıkla' : duraklatildi ? `${saatMetni(gk.duraklatBitis!)}’e kadar · sürdürmek için tıkla` : 'Açmak için tıkla (önce onayın istenir)'}
        onClick={sureklidinleme}
      />
      <Dugme
        ad="rahatsiz" simge="zil" kapali={rahatsiz} sureli={rahatsiz} role="switch" aria-checked={rahatsiz} aria-label="Rahatsız etme (1 saat)"
        baslik={rahatsiz ? 'Rahatsız etme açık' : 'Rahatsız etme'}
        durum={rahatsiz ? `${saatMetni(a.proaktif.rahatsizEtmeBitis!)}’e kadar · hatırlatıcılar yine gelir · kapatmak için tıkla` : '1 saat kendiliğinden mesaj yok · hatırlatıcılar gelir'}
        onClick={() => kaydet({ proaktif: { ...a.proaktif, rahatsizEtmeBitis: rahatsiz ? undefined : new Date(Date.now() + SAAT_MS).toISOString() } })}
      />
    </div>
  );
}
