// ── Açılış örtüsü: Fuber işareti belirir, FUBER yazısı gelir, örtü uygulamaya erir (0.11 G11, spec §9) ─────────────────────────────
// Süreç başına BİR kez, ana pencere ilk gerçekten gösterildiğinde (ana süreç `uygulama:ilk-gosterim` ile söyler; `--gizli` başlangıçta pencere
// gösterilene dek bekler, sonraki gösterimlerde hiç). Örtü yalnız bir KATMANDIR: uygulama (kurulum sihirbazı dahil) altında kendi hızında
// hazırlanır, hiçbir veri beklenmez ve örtü hiçbir şeyi engellemez (pointer-events:none). Tıklama ya da herhangi bir tuş örtüyü atlatır:
// atlatan TIKLAMA tüketilir (pointerdown + devamı pointerup/mouseup/click yakalama aşamasında yutulur; alttaki, görünmeyen denetim
// etkinleşmez — ilk açılışta kurulum sihirbazı düğmeleri dahil; üretimde HER ZAMAN, yalnız FUBER_DEMO'da otomasyonun ilk tıklaması
// yutulmasın diye varsayılan geçirir; pencere düğmeleri — Küçült/Büyüt/Kapat — HİÇBİR ZAMAN tüketilmez, örtüyü atlatır ama düğmeye ulaşır:
// shared/acilis.ts acilisTiklamaTuketilsinMi); TUŞLAR geçer (önden yazma). Ses işaret belirdiği an başlar ve atlatınca
// KESİLMEZ. Zaman çizelgesi tek kaynaktan: shared/acilis.ts ACILIS (acilisSureleri → CSS değişkenleri).
// Soru sürerken ('bekliyor') örtü opak zemin olarak durur (ayarlar gelene dek `Uygulama` null çizer: boş kare yerine); pencere o sırada
// henüz gösterilmemiştir ya da cevap birkaç ms içinde gelir.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cagir } from '../api';
import { UrunIsareti } from '../bilesenler/UrunIsareti';
import { Logo } from '../bilesenler/Ortak';
import { ACILIS, acilisCalsinMi, acilisSesiKarari, acilisSureleri, acilisTiklamaTuketilsinMi, type AcilisKipi, type AcilisOlayi } from '../../shared/acilis';
import type { Ayarlar } from '../../shared/tipler';
import { acilisSesiBaslat } from './acilis-sesi';
import './acilis.css';

/** Ana süreçteki bayrağa süreç boyunca TEK soru (StrictMode ya da yeniden çizim ikinci soru açıp "false" almasın). */
let ilkSoru: Promise<boolean> | null = null;
const ilkGosterimMi = () => (ilkSoru ??= cagir<boolean>('uygulama:ilk-gosterim').then((b) => b === true).catch(() => false));

const demoMu = () => window.fuber?.demo === true;
/** Test günlüğü: yalnız FUBER_DEMO'da ana sürece yazılır (ses çalınmaz, "acilis-sesi" burada görünür); üretimde hiçbir şey gitmez. */
const gunluge = (olay: AcilisOlayi) => { if (demoMu()) void cagir('uygulama:acilis-olayi', olay).catch(() => undefined); };

/** Test kapısı: `<html data-acilis-tiklama="yut">` FUBER_DEMO'da üretim davranışını (tıklama tüketimi) açar (acilis-onizle). Karar
 *  shared/acilis.ts acilisTiklamaTuketilsinMi'de (üretimde HER ZAMAN tüketir; pencere düğmeleri hariç). */
const demoYutKapisi = () => document.documentElement.dataset.acilisTiklama === 'yut';
/** Pencere düğmeleri (Küçült/Büyüt/Kapat; renderer/pencere/PencereDugmeleri.tsx, z 1100) örtünün üstünde durur. */
const pencereDugmesiMi = (hedef: EventTarget | null) => hedef instanceof Element && hedef.closest('.pd-dugmeler') !== null;

const azHareketMi = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Çalma anındaki ayarlardan ses kararı (sessiz saat saati o an sorulur): çal, FUBER_DEMO'da yalnız kaydet ya da hiçbir şey.
 *  Ayarlar okunamadıysa (null) ses ÇALMAZ (shared/acilis.ts acilisSesiKarari). */
function sesiYonet(a: Ayarlar | null): void {
  const eylem = acilisSesiKarari(a, { simdi: new Date(), demo: demoMu() });
  if (eylem === 'cal') void acilisSesiBaslat();
  else if (eylem === 'kaydet') gunluge('acilis-sesi');
}

/** Kurulu yutma seti (aynı anda tek): yenisi kurulurken eskisi iptal edilir. */
let yutma: AbortController | null = null;
/** Atlatan tıklamanın devamını (pointerup, mouseup, contextmenu, click/auxclick) tek seferlik yakalama dinleyicileriyle yutar: tıklama
 *  alttaki görünmeyen denetime geçmesin. Set şunlarla kalkar: hareket bitince (click/auxclick/pointercancel), bundan SONRA gelen ilk yeni
 *  `pointerdown` (tüketilen hareketin click'i hiç gelmediyse sonraki gerçek tıklama yenmesin; örtü hâlâ yaşıyorsa o pointerdown'ı `tikla`
 *  zaten yeniden tüketir ve yeni set kurar) ya da 4 sn emniyeti. */
function hareketiYut(): void {
  yutma?.abort();
  const ac = (yutma = new AbortController());
  const yut = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  for (const tur of ['pointerup', 'mousedown', 'mouseup', 'contextmenu']) addEventListener(tur, yut, { capture: true, once: true, signal: ac.signal });
  for (const tur of ['click', 'auxclick']) addEventListener(tur, (e) => { yut(e); ac.abort(); }, { capture: true, once: true, signal: ac.signal });
  addEventListener('pointercancel', () => ac.abort(), { once: true, signal: ac.signal });
  // Tüketilen pointerdown'ın KENDİSİ bu dinleyiciyi tetiklemez (gönderim sırasında eklenen dinleyici o olayı görmez); sonraki hareket görür.
  addEventListener('pointerdown', () => ac.abort(), { capture: true, once: true, signal: ac.signal });
  setTimeout(() => ac.abort(), 4000);
}

const SURELER = acilisSureleri() as CSSProperties;

/** `zorla` (0.12 H3a): yeni kurulum "Fuber’i aç"la bitince örtü süreçteki ilk gösterimi sormadan bir kez daha oynar (kurulumdan kokpite
 *  geçiş; renderer/main.tsx). Kurallar aynı: tıklama/tuş atlatır, azaltılmış harekette kısa solma, ses kararı o anki ayarlardan. */
export function Acilis({ zorla = false }: { zorla?: boolean } = {}) {
  // 'bekliyor': soru sürüyor (örtü opak, işaret yok); 'tam' | 'kisa': oynuyor; 'yok': örtü yok.
  const [kip, setKip] = useState<AcilisKipi | 'bekliyor'>('bekliyor');
  const [kalkti, setKalkti] = useState(false);
  const kok = useRef<HTMLDivElement>(null);
  const bitti = useRef(false);
  const atlandi = useRef(false);

  const bitir = () => {
    if (bitti.current) return;
    bitti.current = true;
    if (demoMu()) performance.mark('acilis:bitti');
    gunluge('acilis-bitti');
    setKalkti(true);
  };

  // 1) Süreçteki ilk gösterim mi? Pencere henüz gösterilmediyse (--gizli) cevap gösterilene dek gelmez.
  useEffect(() => {
    let iptal = false;
    void (zorla ? Promise.resolve(true) : ilkGosterimMi()).then((ilk) => {
      if (iptal) return;
      const k = acilisCalsinMi({ ilkGosterim: ilk, azaltilmisHareket: azHareketMi() });
      setKip(k);
      if (k === 'yok') return;
      gunluge('acilis-basladi');
      // Ayarlar çalma ANINDA okunur (sessiz saat/rahatsız etme o anki saate göre); örtü bunu beklemeden başlar. Okunamazsa sessiz.
      void cagir<Ayarlar>('ayarlar:al').catch(() => null).then((a) => sesiYonet(a));
    });
    return () => { iptal = true; };
  }, []);

  // 2) Oynarken: tıklama ya da tuş atlatır; emniyet zamanlayıcısı örtünün asla takılı kalmamasını sağlar. Örtü kalkınca (kalkti) dinleyiciler
  //    ve zamanlayıcı temizlenir.
  useEffect(() => {
    if ((kip !== 'tam' && kip !== 'kisa') || kalkti) return;
    // Ölçüm işareti (yalnız FUBER_DEMO; önizleme "başladı → bitti" süresini buradan okur): örtünün GERÇEKTEN oynamaya başladığı an
    // (animasyonun başlangıç zamanı; durum güncellemesi ile ilk kare arasındaki yük gecikmesi sayılmaz).
    if (demoMu()) {
      const ilk = kok.current?.getAnimations()[0];
      if (ilk) void ilk.ready.then(() => performance.mark('acilis:basladi', { startTime: ilk.startTime == null ? undefined : Number(ilk.startTime) })).catch(() => undefined);
      else performance.mark('acilis:basladi');
    }
    const atla = () => {
      const k = kok.current;
      if (!k || bitti.current || atlandi.current) return;
      atlandi.current = true;
      gunluge('acilis-atlandi');
      // Erime sürerken atlanırsa görünen saydamlıktan devam eder (geri sıçrama yok); ses etkilenmez.
      const simdi = Number(getComputedStyle(k).opacity);
      k.style.animation = 'none';
      k.style.opacity = String(simdi);
      const a = k.animate([{ opacity: simdi }, { opacity: 0 }], { duration: ACILIS.atlaSure, easing: 'ease-out', fill: 'forwards' });
      a.onfinish = bitir;
    };
    // Tıklama: atlatır VE tüketilir (alttaki denetime geçmez). Tuş: atlatır, geçer.
    // (Atlatma sönerken gelen ikinci tıklama da örtü kalkana dek tüketilir.)
    // Pencere düğmeleri (Küçült/Büyüt/Kapat) örtünün üstünde ve görünür: örtüyü yine atlatır ama TÜKETİLMEZ (ilk tıklamada çalışır).
    const tikla = (e: PointerEvent) => {
      if (bitti.current) return;
      const tuket = acilisTiklamaTuketilsinMi({ demo: demoMu(), demoKapisi: demoYutKapisi(), pencereDugmesi: pencereDugmesiMi(e.target) });
      if (tuket) { e.preventDefault(); e.stopPropagation(); hareketiYut(); }
      atla();
    };
    addEventListener('pointerdown', tikla, { capture: true });
    addEventListener('keydown', atla, { capture: true, passive: true });
    const emniyet = setTimeout(bitir, ACILIS.emniyet);
    return () => { removeEventListener('pointerdown', tikla, true); removeEventListener('keydown', atla, true); clearTimeout(emniyet); };
  }, [kip, kalkti]);

  if (kalkti || kip === 'yok') return null;
  return (
    <div
      ref={kok}
      className={`acilis acilis--${kip}`}
      data-kip={kip}
      aria-hidden="true"
      style={SURELER}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && e.animationName === 'acilis-erit') bitir(); }}
    >
      <div className="acilis__sahne">
        <span className="acilis__isaret"><UrunIsareti olcu={96} /></span>
        <span className="acilis__yazi"><Logo yukseklik={18} /></span>
      </div>
    </div>
  );
}
