/**
 * Ekranların ortak düzeni: masaüstüyle aynı çalışma yüzeyi (`Workspace`). Sayfa başı sıkıdır (başlık + bir cümle),
 * altında ana alan ve bağlam sütunu durur; kap daralınca bağlam sütunu ana alanın altına iner.
 *
 * Bir bölüm (`Block`) bir kutudur; ayarları (`SettingRow`) kutunun içinde çok sütunlu bir form ızgarasına (`Fields`)
 * dizilir: ad üstte, denetim altında, açıklama en altta. Aynı satırdaki denetimler bu sayede aynı hizada durur.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowClockwise, CaretRight, Check, PlugsConnected, WarningCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, EmptyState, Panel as Box, Skeleton, Workspace, WorkspaceGrid, WorkspaceHeader, cn, enter, spring, stagger, useMotionPreset } from '@fuber/ui';
import { useCountUp } from '../lib/count-up';

/** Yönetim sayfalarının en geniş hâli (CSS px): form bundan geniş esnemez; daha geniş pencerede sayfa ortada kalır. Durum şeridi de aynı ölçüye oturur. */
export const PAGE_MAX = 1600;

/**
 * Sayfa: başlık + ana alan (+ `aside`: bağlam sütunu). Genişlik `PAGE_MAX` ile sınırlıdır: 1440'ta da 3840'ta da aynı
 * düzen, yalnız kenar payı değişir.
 *
 * Bağlam sütunu yalnız pencereye sığıyorsa yapışkandır; sığmıyorsa sayfayla birlikte akar (iki sütun farklı hızda
 * kaymaz, başlığı kesilmez).
 */
export function Page({
  title,
  description,
  actions,
  summary,
  aside,
  asideWidth = 400,
  below,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** "Bir bakışta" özet şeridi (`SummaryStrip`): sayfa başının altında, iki sütunun üstünde. */
  summary?: ReactNode;
  /** Bağlam sütunu: ikincil bölümler. Geniş kapta yanda, dar kapta altta. */
  aside?: ReactNode;
  asideWidth?: number;
  /**
   * İki sütunun altında, sayfanın tam genişliğinde akan bölümler (geniş tablolar, uzun listeler). Bağlam sütunu
   * kısa kaldığında yanında boş bir sütun uzamasın diye geniş içerik buraya konur.
   */
  below?: ReactNode;
  children: ReactNode;
}) {
  const grid = useRef<HTMLDivElement | null>(null);
  const hasAside = !!aside;
  useLayoutEffect(() => {
    const column = grid.current?.querySelector<HTMLElement>(':scope > .ui-ws-aside');
    const scroller = grid.current?.closest('main');
    if (!column || !scroller) return;
    const update = () => {
      column.style.position = column.offsetHeight <= scroller.clientHeight - 32 ? '' : 'static';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(column);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [hasAside]);
  return (
    <Workspace maxWidth={PAGE_MAX}>
      {/* v1 hiyerarşisi: büyük başlık, altında tek cümle; eylemler sağda, alt çizgiye hizalı (`.ad-head`, app.css). */}
      <WorkspaceHeader className="ad-head" title={title} status={description} actions={actions} />
      {summary}
      <WorkspaceGrid ref={grid} aside={aside} asideWidth={asideWidth}>
        {children}
      </WorkspaceGrid>
      {below ? (
        <div className="ui-ws-main" data-testid="page-below">
          {below}
        </div>
      ) : null}
    </Workspace>
  );
}

/**
 * Bölüm: tek kutu (başlık + bir cümle + içerik). `lead`: sayfanın birincil kutusu (bir tane). `quiet`: çerçevesiz;
 * içeriği zaten kutu olan bölümler (anahtar kartları, model kartları) için, kutu iç içe girmesin diye.
 * Kademeli giriş sırası `index` ile.
 */
export function Block({
  index = 0,
  title,
  description,
  action,
  count,
  children,
  id,
  tone = 'base',
  alert,
  testId,
}: {
  index?: number;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  count?: number;
  children: ReactNode;
  id?: string;
  tone?: 'lead' | 'base' | 'quiet';
  /** Dikkat isteyen bölüm (ortam dinleme açık, zorunlu güncelleme): kıl payı kehribar ya da kırmızı çerçeve. */
  alert?: 'warning' | 'danger';
  testId?: string;
}) {
  const preset = useMotionPreset(enter.fadeUp);
  return (
    <motion.div initial={preset.initial} animate={preset.animate} transition={stagger(index, preset.transition)} id={id} className="min-w-0 scroll-mt-4">
      <Box tone={tone} className={cn('ad-block', alert === 'warning' && 'border-warning/35!', alert === 'danger' && 'border-danger/45!')} data-testid={testId} data-alert={alert}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="ui-panel-title ad-block-title">
              {title}
              {count !== undefined && <span className="ui-panel-count">{count}</span>}
            </h2>
            {description && <p className="max-w-[72ch] text-sm text-fg-faint">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
        {children}
      </Box>
    </motion.div>
  );
}

/**
 * Form ızgarası: ayarlar yan yana, kabın genişliğine göre kendiliğinden sütunlanır (en dar hücre `min` px).
 * Tam genişlik isteyen ayar `SettingRow wide` ile verilir.
 */
export function Fields({ children, className, min = 260, max }: { children: ReactNode; className?: string; min?: number; /** En çok sütun sayısı: geniş kapta alanlar bundan fazla sütuna dağılmaz (yetim hücre kalmasın). */ max?: number }) {
  // `max` verilince hücre, kabın 1/max'inden dar olamaz: sütun sayısı genişlik ne olursa olsun `max`ı aşmaz (28 px = sütun aralığı).
  const cell = max ? `max(${min}px, calc((100% - ${(max - 1) * 28}px) / ${max}))` : `${min}px`;
  return (
    <div className={cn('grid gap-x-7 gap-y-6', className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${cell}, 100%), 1fr))` }}>
      {children}
    </div>
  );
}

/**
 * Tek ayar: ad üstte, denetim altında, bir cümle açıklama en altta. `htmlFor` verilirse ad denetimin etiketi olur
 * (ekran okuyucu ve tıklama). Hata metni açıklamanın yerine geçer.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  error,
  aside,
  wide,
  inline,
  testId,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  error?: string;
  aside?: ReactNode;
  /** Bütün sütunları kaplar (sistem istemi, uzun not). */
  wide?: boolean;
  /** Denetim adın yanında, aynı satırda (anahtar gibi küçük denetimler). */
  inline?: boolean;
  testId?: string;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className={cn('flex min-w-0 flex-col', inline ? 'gap-1' : 'gap-2', wide && 'col-span-full')} data-testid={testId}>
      <div className={cn('flex justify-between gap-3', inline ? 'min-h-8 items-center' : 'items-baseline')}>
        <Label htmlFor={htmlFor} className="text-sm font-medium text-balance text-fg">
          {label}
        </Label>
        {inline ? <div className="flex shrink-0 items-center gap-3">{children}</div> : aside && <span className="text-xs text-fg-faint tabular-nums">{aside}</span>}
      </div>
      {!inline && <div className="flex min-w-0 flex-col gap-2">{children}</div>}
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
          <WarningCircle aria-hidden weight="fill" className="size-4 shrink-0" />
          {error}
        </p>
      ) : (
        description && <p className="text-sm text-fg-faint">{description}</p>
      )}
    </div>
  );
}

/** Satır içi uyarı kutusu (plan yetersiz, anahtar yok, ortam dinleme uyarısı). */
export function Notice({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
  className,
  testId,
}: {
  tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'success';
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const tones = {
    neutral: 'bg-surface-3 text-fg-muted',
    accent: 'bg-accent-soft text-accent-fg',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-success-soft text-success',
  } as const;
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn('flex items-start gap-3 rounded-sm px-4 py-3 text-sm [&_svg]:size-4.5', tones[tone], className)}
    >
      {icon && <span className="mt-0.5 flex shrink-0">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title ? 'text-fg-muted' : '', 'break-words')}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 self-center">{action}</div>}
    </div>
  );
}

/** Yükleniyor: gelecek bölümün iskeleti (başlık + form hücreleri). */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Box aria-hidden>
      <Skeleton className="h-4 w-36 rounded-full" />
      <Fields>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex flex-col gap-2.5">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
          </div>
        ))}
      </Fields>
    </Box>
  );
}

/** Boş liste: bir bölümün içinde, sola yaslı tek satır (ikon + ne olduğu + ne zaman dolacağı). Kendi kutusu yoktur. */
export function InlineEmpty({ icon, title, children, testId }: { icon: ReactNode; title: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="flex items-start gap-3 text-sm text-fg-muted" data-testid={testId}>
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-4 text-fg-muted [&_svg]:size-4.5">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 self-center">
        <span className="text-base font-medium text-fg">{title}</span>
        {children && <span>{children}</span>}
      </span>
    </div>
  );
}

/** Yükleniyor: bir bölümün içindeki listenin iskeleti (kendi kutusu yoktur). */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4 py-1" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5 rounded-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Bir okumanın hatası; yeniden dene ile. Bir `Block`un içinde durur (kendi kutusu yoktur). */
export function ErrorPanel({ message, onRetry, title }: { message: string; onRetry?: () => void; title?: ReactNode }) {
  return (
    <EmptyState
      size="sm"
      icon={<WarningCircle />}
      title={title ?? t('admin.state.errorTitle')}
      description={message}
      actions={
        onRetry && (
          <Button size="sm" icon={<ArrowClockwise />} onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )
      }
    />
  );
}

/** Politika hiç okunamadı: servis ayağa kalkmamış. Ekranın tamamı bu durumu anlatır. */
export function ServiceDown({ message, onRetry, onRestart, restarting }: { message: string; onRetry: () => void; onRestart: () => void; restarting: boolean }) {
  return (
    <div className="flex h-full min-h-[480px] items-center justify-center px-10" data-testid="service-down">
      <EmptyState
        icon={<PlugsConnected />}
        title={t('admin.state.serviceDownTitle')}
        description={
          <>
            {t('admin.state.serviceDownBody')}
            <span className="mt-2 block font-mono text-xs text-fg-faint" data-selectable>
              {message}
            </span>
          </>
        }
        actions={
          <>
            <Button icon={<ArrowClockwise />} onClick={onRetry}>
              {t('common.retry')}
            </Button>
            <Button variant="primary" loading={restarting} onClick={onRestart}>
              {t('admin.state.restartService')}
            </Button>
          </>
        }
      />
    </div>
  );
}

// ───────────────────────── v1 Yönetim kalıpları: özet şeridi, durum dili, adımlar, sistem satırları ─────────────────────────

/** Durum dilinin tek biçimi: renkli nokta + metin. Rozet ya da renkli yazı yerine her yerde bu. */
export type DotTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export function StatusDot({ tone, children, className, testId, ...rest }: { tone: DotTone; children?: ReactNode; className?: string; testId?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <span className={cn('ad-status', className)} data-tone={tone} data-testid={testId} {...rest}>
      <span aria-hidden className="ad-dot" />
      {children !== undefined && <span className="ad-status-text">{children}</span>}
    </span>
  );
}

/** Simge kutusu: koyu dolgu, 28/30/36/44 px (v1 ritmi). */
export function IconBox({ size = 30, children, tone, className }: { size?: 28 | 30 | 36 | 44; children: ReactNode; tone?: 'warning' | 'accent' | 'danger'; className?: string }) {
  return (
    <span aria-hidden className={cn('ad-icon', className)} data-size={size} data-tone={tone}>
      {children}
    </span>
  );
}

export interface StatProps {
  label: ReactNode;
  icon: ReactNode;
  /** Sayıysa sayarak artar (`format` ile yazılır); metinse olduğu gibi, daha küçük puntoyla. `null`: veri yok. */
  value: number | string | null;
  format?: (value: number) => string;
  /** Sayının yanında küçük birim ("/ 10,00 $"). */
  unit?: ReactNode;
  note?: ReactNode;
  tone?: 'warning' | 'danger';
  testId?: string;
  /** Sınama ve okuma için ham değer (`data-value`). */
  raw?: string | number;
}

function StatValue({ value, format }: { value: number; format?: (value: number) => string }) {
  const shown = useCountUp(value);
  const v = shown ?? value;
  return <>{format ? format(v) : Math.round(v).toLocaleString('tr-TR')}</>;
}

/** Ölçü kartı: etiket solda soluk, sağ üstte simge kutusu, büyük tabular sayı, altında tek satır not. */
export function Stat({ label, icon, value, format, unit, note, tone, testId, raw, index = 0 }: StatProps & { index?: number }) {
  const preset = useMotionPreset(enter.fadeUp);
  const text = typeof value === 'string';
  return (
    <motion.div initial={preset.initial} animate={preset.animate} transition={{ ...spring.smooth, delay: index * 0.045 }} className="min-w-0">
      <Box className="ad-stat" data-testid={testId} data-value={raw ?? (value === null ? undefined : String(value))} data-state={tone}>
        <div className="ad-stat-top">
          <span className="ad-stat-label">{label}</span>
          <IconBox size={30}>{icon}</IconBox>
        </div>
        <p className="ad-stat-value" data-text={text || undefined}>
          {value === null ? '–' : text ? <span className="truncate">{value}</span> : <StatValue value={value} format={format} />}
          {unit && <span className="ad-stat-unit">{unit}</span>}
        </p>
        {note && <p className="ad-stat-note">{note}</p>}
      </Box>
    </motion.div>
  );
}

/** "Bir bakışta" şeridi: 3–4 ölçü kartı yan yana; dar kapta ikişer. */
export function SummaryStrip({ items, testId }: { items: StatProps[]; testId?: string }) {
  return (
    <div className="ad-stats" data-count={items.length} data-testid={testId ?? 'summary'}>
      {items.map((item, index) => (
        <Stat key={index} index={index} {...item} />
      ))}
    </div>
  );
}

export interface StepItem {
  title: ReactNode;
  body?: ReactNode;
  /** `done`: dolu beyaz daire + tik · `pending`: kehribar halka (sizi bekliyor) · `idle`: sayı. */
  state?: 'done' | 'pending' | 'idle';
  /** Başlığın yanında durum noktası (ses hattı gibi akışlarda). */
  status?: { tone: DotTone; label: ReactNode };
  testId?: string;
}

/** Numaralı adım listesi (v1 `.yn-adimlar`): 30 px daireler, aralarında 1 px dikey çizgi. */
export function Steps({ items, testId }: { items: StepItem[]; testId?: string }) {
  return (
    <ol className="ad-steps" data-testid={testId}>
      {items.map((step, index) => (
        <li key={index} className="ad-step" data-state={step.state ?? 'idle'} data-testid={step.testId}>
          <span className="ad-step-no" aria-hidden>
            {step.state === 'done' ? <Check weight="bold" /> : index + 1}
          </span>
          <div className="ad-step-text">
            <p className="ad-step-title">
              <span>{step.title}</span>
              {step.status && <StatusDot tone={step.status.tone}>{step.status.label}</StatusDot>}
            </p>
            {step.body && <p className="ad-step-body">{step.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface SystemItem {
  id: string;
  icon: ReactNode;
  label: ReactNode;
  tone: DotTone;
  value: ReactNode;
  /** Satıra basınca gidilecek yer; verilmezse satır yalnız durum gösterir. */
  onOpen?: () => void;
  /** Satırın ekran okuyucu adı ("Beyin'e git"). */
  openLabel?: string;
}

/** "Sistem" satırları: 28 px simge kutusu + ad · durum noktası + değer · ok. Satır ilgili ekrana götürür. */
export function SystemList({ items, testId }: { items: SystemItem[]; testId?: string }) {
  return (
    <div className="ad-system" data-testid={testId}>
      {items.map((item) => {
        const inner = (
          <>
            <span className="ad-system-name">
              <IconBox size={28}>{item.icon}</IconBox>
              <span className="truncate">{item.label}</span>
            </span>
            <span className="ad-system-value">
              <StatusDot tone={item.tone}>{item.value}</StatusDot>
              {item.onOpen && <CaretRight aria-hidden className="ad-system-caret" />}
            </span>
          </>
        );
        return item.onOpen ? (
          <button key={item.id} type="button" className="ad-system-row" onClick={item.onOpen} aria-label={item.openLabel} data-testid={`system-${item.id}`} data-tone={item.tone}>
            {inner}
          </button>
        ) : (
          <div key={item.id} className="ad-system-row" data-testid={`system-${item.id}`} data-tone={item.tone}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** Sakin boş durum (v1 `.yn-bos`): ortalı simge kutusu + "…burada görünür" cümlesi. */
export function CalmEmpty({ icon, children, testId }: { icon: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="ad-calm" data-testid={testId}>
      <IconBox size={44}>{icon}</IconBox>
      <p>{children}</p>
    </div>
  );
}
