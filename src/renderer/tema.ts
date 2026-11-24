// ── Tema (arayüz) ────────────────────────────────────────────────────────────────────────────────────────────
// <html data-tema="koyu|acik|cam">: tasarim.css renk belirteçlerini buna göre seçer. İlk karede ana süreçten henüz yanıt
// gelmemiştir; ana süreç nativeTheme.themeSource'u ayara eşitlediği için `prefers-color-scheme` zaten doğru koyu/açığı
// söyler (parlama yok). Sonra etkin tema ana süreçten alınır ('tema:etkin') ve 'tema:degisti' ile canlı izlenir: "Otomatik" ('sistem')
// orada çözülür, burada yeniden hesaplanmaz. Fuber Cep (telefon) ayrıdır: ana pencerenin sistem malzemesi telefonda yoktur, Şeffaf → koyu; "sistem"
// telefonun kendi temasını izler. 0.13 T13: Şeffaf (cam) geri geldi — destek bilgisi (`camDestegi`) ve kurulumun opaklığı (`opakSahne`) buradan.
import { cagir, dinle } from './api';
import { etkinTemaBul, type EtkinTema } from '../shared/tema-cozum';
import { gorunumGecisi } from './gecis';
import type { Ayarlar, Tema } from '../shared/tipler';

const acikMedya = window.matchMedia('(prefers-color-scheme: light)');
const azHareket = window.matchMedia('(prefers-reduced-motion: reduce)');
// Telefonda `window.fuber` bu modül yüklendikten SONRA kurulur (cep.tsx: fuberKopruKur()); bu yüzden her seferinde okunur.
const telefonMu = (): boolean => window.fuber?.platform === 'cep';
let anaTema: EtkinTema | null = null; // masaüstü: ana sürecin çözdüğü tema
let secim: Tema | undefined; // telefon: ayardaki seçim
// Canlı değişimde sayfa geçişi (View Transitions). Ada penceresi kapatır: çoğu zaman gizlidir; gizli pencerede geçiş kare
// bekleyip temayı geciktiriyor, üst üste gelen geçişler "Transition was skipped" hatası bırakıyordu. Ada rengi kendisi yumuşar.
let gecisli = true;

function etkin(): EtkinTema {
  const sistemKoyu = !acikMedya.matches;
  if (telefonMu() && secim) return etkinTemaBul(secim, sistemKoyu, false);
  return anaTema ?? etkinTemaBul('sistem', sistemKoyu, false); // ilk kare: işletim sisteminin rengi
}

function uygula(yumusak: boolean): void {
  const kok = document.documentElement;
  const yeni = etkin();
  if (kok.dataset.tema === yeni) return;
  const degistir = () => { kok.dataset.tema = yeni; };
  // Canlı değişimde tüm sayfa yumuşakça geçsin (View Transitions); ilk karede ve az hareket isteyende anında.
  if (yumusak && gecisli && 'startViewTransition' in document && !azHareket.matches && kok.dataset.tema) gorunumGecisi(degistir);
  else degistir();
}

/** Uygulama açılırken bir kez çağrılır (ana pencere ve ada). `gecis: false`: canlı değişim anında (ada). */
export function temayiBagla(o: { gecis?: boolean } = {}): void {
  gecisli = o.gecis ?? true;
  uygula(false);
  acikMedya.addEventListener('change', () => uygula(true));
  if (telefonMu()) {
    const al = (a: Ayarlar | null | undefined, yumusak: boolean) => { secim = a?.gorunum?.tema ?? 'koyu'; uygula(yumusak); };
    // Yeni eşleşmede bilgisayarın ilk yanıtı gecikebilir ya da düşebilir (bkz. cep.tsx ilkYukle): tema ayarı birkaç kez denenir.
    const yukle = (deneme: number): void => { void cagir<Ayarlar>('ayarlar:al').then((a) => al(a, false)).catch(() => { if (deneme < 4) setTimeout(() => yukle(deneme + 1), 2500); }); };
    yukle(0);
    dinle('ayarlar:degisti', (a: Ayarlar) => al(a, true));
    return;
  }
  const al = (t: EtkinTema, yumusak: boolean) => { anaTema = t; uygula(yumusak); };
  void cagir<{ tema: EtkinTema; cam: boolean }>('tema:etkin').then((d) => { camVar = d.cam === true; al(d.tema, false); }).catch(() => undefined);
  dinle('tema:degisti', (d: { tema: EtkinTema }) => al(d.tema, true));
}

let camVar: boolean | null = null;
let camSozu: Promise<boolean> | null = null;
/** Bu bilgisayarda Şeffaf var mı (Windows 11 22H2+ / macOS; ana süreç `tema:etkin` ile bildirir)? Bir kez sorulur; yanıt gelmezse yok sayılır (sunulmaz). */
export function camDestegi(): Promise<boolean> {
  if (camVar !== null) return Promise.resolve(camVar);
  camSozu ??= cagir<{ cam: boolean }>('tema:etkin').then((d) => (camVar = d.cam === true)).catch(() => false);
  return camSozu;
}

/** Kurulum / Tekrar hoş geldin ekranı açıkken ana sürece haber verir: pencere malzemesi 'none' ve zemin opak olur (main/tema.ts; tema camda olsa bile).
 *  Dönen işlev ekran kapanırken çağrılır (useEffect temizliği). */
export function opakSahne(): () => void {
  void cagir('tema:sahne', true).catch(() => undefined);
  return () => { void cagir('tema:sahne', false).catch(() => undefined); };
}
