import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react';
import { cn } from '../cn';

/**
 * Çalışma yüzeyi: bütün sayfaların ortak kompozisyon dili. Tek sütunlu "liste sayfası" yerine geniş ekranı kullanan
 * düzen: sayfa başı (başlık + durum cümlesi + eylemler aynı satırda), altında ana alan ve bağlam sütunu.
 * Kap sorgusuyla çalışır (pencere değil, sayfanın kendi genişliği): ray daraltılınca ya da pencere küçülünce
 * bağlam sütunu ana alanın altına iner; 980 px pencerede her şey tek sütundur.
 *
 * Hiyerarşi yüzeyle kurulur, yalnız yazı boyutuyla değil: `Panel tone="lead"` sayfanın tek birincil kutusudur,
 * `base` ikinciller, `quiet` çerçevesiz gruplardır. Bir sayfada birden fazla `lead` olmaz.
 */
export interface WorkspaceProps extends ComponentPropsWithRef<'div'> {
  /** Sayfa en fazla bu genişliğe açılır (CSS px). Varsayılan 2240: 4K'da da ortada, kenar payıyla. */
  maxWidth?: number;
  /** Sayfa kendi yüksekliğini doldurur (iki bölmeli, içten kayan yüzeyler: sohbet, oturumlar). */
  fill?: boolean;
}

export function Workspace({ maxWidth = 2240, fill, className, style, children, ...rest }: WorkspaceProps) {
  return (
    <div className={cn('ui-workspace', fill && 'ui-workspace-fill', className)} style={{ '--ws-max': `${maxWidth}px`, ...style } as CSSProperties} {...rest}>
      <div className="ui-workspace-in">{children}</div>
    </div>
  );
}

export interface WorkspaceHeaderProps extends Omit<ComponentPropsWithRef<'header'>, 'title'> {
  title: ReactNode;
  /** Başlığın yanında, aynı taban çizgisinde tek cümle durum ("Bu ay 2 son gün var."). */
  status?: ReactNode;
  /** Başlığın solunda küçük işaret (geri düğmesi, varlık). */
  leading?: ReactNode;
  /** Sağda eylemler; birincil eylem en sağda. */
  actions?: ReactNode;
  /** Başlığın altında tam genişlik şerit: sekmeler, arama, süzgeçler. */
  children?: ReactNode;
}

/** Sayfa başı: sıkı. Başlık 28 px, durum cümlesi yanında; eylemler aynı satırda. Dev başlık + boşluk yok. */
export function WorkspaceHeader({ title, status, leading, actions, children, className, ...rest }: WorkspaceHeaderProps) {
  return (
    <header className={cn('ui-ws-header', className)} {...rest}>
      <div className="ui-ws-header-row">
        {leading && <div className="flex shrink-0 items-center">{leading}</div>}
        <div className="ui-ws-header-text">
          <h1 className="ui-ws-title">{title}</h1>
          {status && <p className="ui-ws-status">{status}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export interface WorkspaceGridProps extends ComponentPropsWithRef<'div'> {
  /** Bağlam sütunu: özet, yaklaşanlar, ayrıntı, yardımcı eylemler. Geniş kapta yanda ve yapışkan, dar kapta altta. */
  aside?: ReactNode;
  /** Bağlam sütununun yeri. */
  asideSide?: 'start' | 'end';
  /** Bağlam sütununun genişliği (CSS px). Çok geniş kapta kendiliğinden bir kademe açılır. */
  asideWidth?: number;
  /** Dar kapta bağlam sütunu ana alanın üstüne gelsin (özet önce okunacaksa). */
  asideFirstWhenStacked?: boolean;
}

/** Ana alan + bağlam sütunu. Kap 1040 px'ten darsa tek sütun. */
export function WorkspaceGrid({ aside, asideSide = 'end', asideWidth = 340, asideFirstWhenStacked, className, style, children, ...rest }: WorkspaceGridProps) {
  return (
    <div
      className={cn('ui-ws-grid', className)}
      data-aside={aside ? asideSide : undefined}
      data-aside-first={asideFirstWhenStacked ? '' : undefined}
      style={{ '--ws-aside': `${asideWidth}px`, ...style } as CSSProperties}
      {...rest}
    >
      <div className="ui-ws-main">{children}</div>
      {aside && <aside className="ui-ws-aside">{aside}</aside>}
    </div>
  );
}

export interface PanelProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  /**
   * `lead`: sayfanın birincil kutusu (bir tane): daha açık yüzey, üstten ışık, geniş iç boşluk.
   * `base`: ikincil kutu. `quiet`: çerçevesiz grup; yalnız başlık ve içerik.
   */
  tone?: 'lead' | 'base' | 'quiet';
  title?: ReactNode;
  /** Başlığın yanında sayı. */
  count?: number;
  /** Başlık satırının sağı. */
  action?: ReactNode;
  /** İç boşluk: `none` içerik kenara kadar (liste, tablo), `sm` 16, `md` 20 (varsayılan; `lead`de 24). */
  padding?: 'none' | 'sm' | 'md';
}

/** Kutu: Çalışma yüzeyinin yapı taşı. İç içe konmaz. */
export function Panel({ tone = 'base', title, count, action, padding = 'md', className, children, ...rest }: PanelProps) {
  return (
    <section className={cn('ui-panel', className)} data-tone={tone} data-pad={padding} {...rest}>
      {(title || action) && (
        <div className="ui-panel-head">
          {title && (
            <h2 className="ui-panel-title">
              {title}
              {count !== undefined && <span className="ui-panel-count">{count}</span>}
            </h2>
          )}
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export interface MetricProps extends ComponentPropsWithRef<'div'> {
  label: ReactNode;
  value: ReactNode;
  /** Değerin yanında küçük birim ("gün", "%"). */
  unit?: ReactNode;
  /** Altında tek satır açıklama. */
  hint?: ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  size?: 'md' | 'lg';
}

/** Ölçü: etiket + büyük rakam (tabular) + birim. Kutu değildir; bir `Panel`in içinde ya da yan yana durur. */
export function Metric({ label, value, unit, hint, tone = 'default', size = 'md', className, ...rest }: MetricProps) {
  return (
    <div className={cn('ui-metric', className)} data-tone={tone} data-size={size} {...rest}>
      <span className="ui-metric-label">{label}</span>
      <span className="ui-metric-value">
        {value}
        {unit && <span className="ui-metric-unit">{unit}</span>}
      </span>
      {hint && <span className="ui-metric-hint">{hint}</span>}
    </div>
  );
}

/** Kendiliğinden sütunlanan kart ızgarası: en az `min` px genişlikte, kabı dolduran eşit sütunlar. */
export function AutoGrid({ min = 300, className, style, ...rest }: ComponentPropsWithRef<'div'> & { min?: number }) {
  return <div className={cn('ui-auto-grid', className)} style={{ '--col-min': `${min}px`, ...style } as CSSProperties} {...rest} />;
}
