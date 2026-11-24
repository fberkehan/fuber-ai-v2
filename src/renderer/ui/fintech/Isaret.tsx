// Fuber işaretleri (fintech). Saf: yollar shared/ (urun-isareti.ts, logo.ts) — masaüstüne özgü bir şey içe aktarmaz (Fuber Yönetim de kullanır).
//  · `MiniLogo` (0.12): Fuber AI'nin işareti — mini logo (shared/urun-isareti.ts MINI_*; uygulama ikonuyla aynı kaynak).
//    Gümüş-titanyum geçiş (açıkta grafit; belirteçler `gecis`) ya da düz renk (`renk`, ör. currentColor). Küçük boyda çizgi optik olarak
//    kalınlaşır (miniKalinlik: kaynağın çizgisi yüksekliğin %4'ü, 16 px'te 0,6 px kalırdı). Fuber AI'de her küçük işaret bu.
//  · `FuberIsareti`: eski "F + iki nokta" — 0.12'den beri YALNIZ Fuber Yönetim'in (yonetim/renderer; mini logo yalnız bu uygulama içindir).
//  · `FuberYazisi`: ters B'li FUƎER yazısı (büyük yerlerde sürer).
//  · `IsaretAnimasyonu`: 0.11 açılış işaretinin (acilis/Acilis.tsx) BÜYÜK hâli — aynı zaman çizelgesi (shared/acilis.ts ACILIS: mini logonun
//    işaret alttan yukarı tüy gibi açılır + ölçeklenir, alt gövdesi erkenden yavaşça belirir, FUBER harfleri sırayla gelir); işaret yerinde kalır.
//    `oyna`: 'bekle' (gizli; açılış örtüsü sürerken), 'evet' (oynar). Azaltılmış harekette yalnız solma (fintech.css).
import { useId, type CSSProperties } from 'react';
import { MINI_BOY, MINI_EN, MINI_VB, MINI_YOLLAR, URUN_GECISLER, URUN_VB, URUN_YOLLAR, miniKalinlik } from '../../../shared/urun-isareti';
import { LOGO_VB, LOGO_YOLLAR } from '../../../shared/logo';
import { acilisSureleri } from '../../../shared/acilis';

/** Fintech belirteçleriyle gümüş-titanyum geçiş (koyuda gümüş, açıkta grafit). */
export const FT_GUMUS: readonly [string, string] = ['var(--ft-gumus-1)', 'var(--ft-gumus-2)'];

export interface MiniLogoOzellikleri {
  /** Yükseklik (CSS pikseli); genişlik orantılı (126,54 / 158,6). */
  olcu?: number;
  /** Erişilebilir ad; yoksa süs (aria-hidden). */
  etiket?: string;
  /** Geçişin iki durağı (sol alt → sağ üst). Varsayılan fintech belirteçleri. */
  gecis?: readonly [string, string];
  /** Düz renk (ör. 'currentColor'): verilirse geçiş yerine. */
  renk?: string;
}

export function MiniLogo({ olcu = 24, etiket, gecis = FT_GUMUS, renk }: MiniLogoOzellikleri) {
  const id = `ml-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const boya = renk ?? `url(#${id})`;
  const kalin = miniKalinlik(olcu);
  const kontur = kalin > 0 ? { stroke: boya, strokeWidth: kalin, strokeLinejoin: 'round' as const } : {};
  return (
    <svg viewBox={MINI_VB} data-mini-logo="" style={{ height: olcu, width: 'auto', display: 'block', overflow: 'visible' }} {...(etiket ? { role: 'img', 'aria-label': etiket } : { 'aria-hidden': true })}>
      {!renk && (
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1={MINI_BOY} x2={MINI_EN} y2="0">
            <stop offset="0" style={{ stopColor: gecis[0] }} />
            <stop offset="1" style={{ stopColor: gecis[1] }} />
          </linearGradient>
        </defs>
      )}
      {MINI_YOLLAR.map((d) => <path key={d.slice(0, 16)} fill={boya} d={d} {...kontur} />)}
    </svg>
  );
}

/** Eski "F + iki nokta" (yalnız Fuber Yönetim; Fuber AI MiniLogo kullanır). */
export function FuberIsareti({ olcu = 24, etiket }: { olcu?: number; etiket?: string }) {
  const id = `ft-is-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox={URUN_VB} style={{ height: olcu, width: 'auto', display: 'block' }} {...(etiket ? { role: 'img', 'aria-label': etiket } : { 'aria-hidden': true })}>
      <defs>
        {URUN_GECISLER.map(([x1, y1, x2, y2], i) => (
          <linearGradient key={i} id={`${id}-${i}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
            <stop offset="0" style={{ stopColor: 'var(--ft-gumus-1)' }} />
            <stop offset="1" style={{ stopColor: 'var(--ft-gumus-2)' }} />
          </linearGradient>
        ))}
      </defs>
      {URUN_YOLLAR.map((d, i) => <path key={d.slice(0, 16)} fill={`url(#${id}-${i})`} d={d} />)}
    </svg>
  );
}

/** FUBER yazısı (yazı rengini alır). */
export function FuberYazisi({ yukseklik = 14 }: { yukseklik?: number }) {
  return (
    <svg viewBox={LOGO_VB} style={{ height: yukseklik, width: 'auto', display: 'block' }} role="img" aria-label="FUBER">
      {LOGO_YOLLAR.map((d) => <path key={d.slice(0, 24)} fill="currentColor" d={d} />)}
    </svg>
  );
}

export function IsaretAnimasyonu({ olcu = 168, yazi = 26, oyna }: { olcu?: number; yazi?: number; oyna: boolean }) {
  // Süreler bileşenin içinde (modül düzeyinde değil): MiniLogo'yu içe aktaran paketler (telefon, ada) açılış çizelgesini taşımasın.
  return (
    <div className="ft-isaret" data-oyna={oyna ? 'evet' : 'bekle'} style={acilisSureleri() as CSSProperties} data-isaret-animasyonu="">
      <span className="ft-isaret__f"><MiniLogo olcu={olcu} etiket="Fuber" /></span>
      <span className="ft-isaret__yazi"><FuberYazisi yukseklik={yazi} /></span>
    </div>
  );
}
