// Ayarlar sayfasının yapı taşları. Bir bölüm bunlarla kurulur:
//
//   <SectionGrid>
//     <Group tone="lead" span="lead" title="…">            ← bölümün tek birincil kutusu
//       <SettingRow label="…" description="…"><Switch … /></SettingRow>
//     </Group>
//     <Column span="rest">                                 ← yan sütun: kutular alt alta
//       <Group title="…">…</Group>
//     </Column>
//   </SectionGrid>
//
// `Group` ve `SettingRow` kendilerini aramaya açar (`data-st-group`, `data-st-row`): arama kutusu ekrandaki metni
// okur, ayrı bir dizin tutulmaz. Yeni bir kutu eklemek için başka kayıt gerekmez.
import { Fragment, useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { LockKey } from '@phosphor-icons/react';
import { t, type Settings } from '@fuber/shared';
import { Badge, Input, Panel, cn, toast, type PanelProps } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt, useEvent } from '../../shell/live';
import { formatPercent } from '../../shell/text';

/**
 * Kutunun ızgaradaki yeri (içerik alanı 12 sütun; dar kapta hepsi tam genişlik):
 *
 *   full   her zaman tam genişlik
 *   lead   orta kapta tam, geniş kapta 8 sütun (yanına `rest` gelir)
 *   rest   orta kapta tam (içindeki kutular yan yana), geniş kapta 4 sütun
 *   main   orta kapta 7, geniş kapta 8 sütun
 *   side   orta kapta 5, geniş kapta 4 sütun
 *   half   6 sütun
 *   third  orta kapta 6, geniş kapta 4 sütun
 */
export type Span = 'full' | 'lead' | 'rest' | 'main' | 'side' | 'half' | 'third';

export async function updateSettings(patch: Partial<Settings>, quiet = false): Promise<boolean> {
  const result = await attempt(() => window.fuber.invoke('settings.update', { patch }));
  if (result && !quiet) toast.success(t('settings.saved'));
  return result !== null;
}

/** Bölümün ızgarası: içine `Group` ve `Column` konur. */
export function SectionGrid({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('st-grid', className)} {...rest} />;
}

/** Sütun: kutuları alt alta taşır (yükseklikleri birbirinden bağımsızdır). */
export function Column({ span = 'full', className, ...rest }: ComponentPropsWithRef<'div'> & { span?: Span }) {
  return <div className={cn('st-col', className)} data-span={span} {...rest} />;
}

export interface GroupProps extends Omit<PanelProps, 'title' | 'tone' | 'padding' | 'count'> {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Çerçevesiz (eski ad; `tone="quiet"` ile aynı). */
  bare?: boolean;
  /** `lead`: bölümün tek birincil kutusu. `base` (varsayılan): ikincil. `quiet`: çerçevesiz. */
  tone?: 'lead' | 'base' | 'quiet';
  span?: Span;
  /**
   * Satırlar yan yana sıkı ızgarada dizilir (kısa ayarlar; geniş kutu). Sayı verilirse hücrenin en dar genişliğidir
   * (CSS px, varsayılan 300).
   */
  columns?: boolean | number;
  /** Kutu, ızgara satırının boyunu doldurur ve içeriği de uzar (yanındaki sütun daha uzunsa boş kalmasın diye). */
  fill?: boolean;
  /** Aramada bu kutuyu buldurması istenen, ekranda yazmayan sözcükler. */
  keywords?: string;
  testId?: string;
}

/**
 * Ayar kutusu: başlık + bir cümle + satırlar. İç içe konmaz. Satırlar `SettingRow` ise tek sütunda kıl payı çizgiyle,
 * `columns` verilince yan yana boşlukla ayrılır; başka içerik (liste, önizleme) de konabilir.
 */
export function Group({ title, description, children, bare, tone, span, columns, fill, action, keywords, testId, className, ...rest }: GroupProps) {
  const resolved = tone ?? (bare ? 'quiet' : 'base');
  return (
    <Panel
      tone={resolved}
      className={cn('st-group', className)}
      data-span={span}
      data-fill={fill ? '' : undefined}
      data-st-group=""
      data-st-keywords={keywords}
      data-testid={testId}
      {...rest}
    >
      <div className="st-group-head" data-st-head="">
        <div className="st-group-text">
          <h2 className="ui-panel-title">{title}</h2>
          {description && <p className="st-group-desc">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      <Rows columns={columns}>{children}</Rows>
    </Panel>
  );
}

/** Satır kabı: `Group` kendisi kullanır; bir kutuda iki ayrı satır öbeği gerekiyorsa doğrudan da kullanılabilir. */
export function Rows({ columns, className, children }: { columns?: boolean | number; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('st-rows', className)}
      data-cols={columns ? '' : undefined}
      style={typeof columns === 'number' ? ({ '--st-cell': `${columns}px` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

export interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** Geçerli değer: denetimin solunda (kapalıyken de değeri söyler). */
  value?: ReactNode;
  children?: ReactNode;
  testId?: string;
  /** `inline` (varsayılan): denetim adın yanında; sığmazsa altına iner. `stack`: denetim altta, tam genişlik. */
  layout?: 'inline' | 'stack';
  /** Satırın altında tam genişlik tek cümle (sınama sonucu, uyarı). */
  note?: ReactNode;
  noteTone?: 'success' | 'warning' | 'muted';
  /** Aramada bu satırı buldurması istenen, ekranda yazmayan sözcükler. */
  keywords?: string;
  /** Satırın altında tam genişlikte ek denetimler (anahtara bağlı saat aralığı gibi); anahtar sağ kenarda kalır. */
  extra?: ReactNode;
}

/** Tek ayar: ad + bir cümle, yanında denetim. */
export function SettingRow({ label, description, value, children, testId, layout = 'inline', note, noteTone = 'muted', extra, keywords }: SettingRowProps) {
  return (
    <div className="st-row" data-layout={layout} data-st-row="" data-st-keywords={keywords} data-testid={testId}>
      <div className="st-row-text">
        <span className="st-row-label">{label}</span>
        {description && <span className="st-row-desc">{description}</span>}
      </div>
      {(value || children) && (
        <div className="st-row-control">
          {value && <span className="st-row-value">{value}</span>}
          {children}
        </div>
      )}
      {extra ? <div className="st-row-extra">{extra}</div> : null}
      {note ? (
        <p className="st-row-note" data-tone={noteTone} role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Dosya yolu: yalnız ayırıcılardan (\ ve /) sonra kırılır; klasör adı ortadan bölünmez, tek harf alt satıra düşmez.
 */
export function PathText({ path, className }: { path: string; className?: string }) {
  const parts = path.split(/(?<=[\\/])/);
  return (
    <span className={cn('font-mono break-words', className)} data-selectable>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** Çerçevesiz bilgi listesi: ad + değer çiftleri (üçüncül bilgi; ayar değildir). */
export function Facts({ min, className, children }: { min?: number; className?: string; children: ReactNode }) {
  return (
    <dl className={cn('st-facts', className)} style={min ? ({ '--st-cell': `${min}px` } as CSSProperties) : undefined}>
      {children}
    </dl>
  );
}

export function Fact({ label, children, hint, testId }: { label: ReactNode; children: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="st-fact" data-st-row="" data-testid={testId}>
      <dt>{label}</dt>
      <dd>{children}</dd>
      {hint && <span className="st-fact-hint">{hint}</span>}
    </div>
  );
}

/** Ayrıntı tablosu (Tanı): ad · açıklama · durum. Dar kapta açıklama alta iner. */
export function DataTable({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('st-table', className)}>{children}</div>;
}

export function DataRow({ label, detail, children, testId }: { label: ReactNode; detail?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="st-trow" data-st-row="" data-testid={testId}>
      <span className="st-trow-name">{label}</span>
      <span className="st-trow-detail">{detail}</span>
      <span className="st-trow-state">{children}</span>
    </div>
  );
}

/** Fuber Yönetim'den gelen, bu pencereden değişmeyen ayarın işareti. */
export function ManagedNote() {
  return (
    <Badge tone="neutral" icon={<LockKey weight="bold" />}>
      {t('settings.managed')}
    </Badge>
  );
}

/** Enter ya da odaktan çıkınca kaydeden metin alanı. */
export function CommitInput({
  value,
  placeholder,
  onCommit,
  testId,
  frameClassName = 'w-64',
  'aria-label': ariaLabel,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  testId?: string;
  frameClassName?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value.trim()) onCommit(draft.trim());
  };
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && (event.currentTarget.blur(), undefined)}
      frameClassName={frameClassName}
      data-testid={testId}
    />
  );
}

/**
 * Mikrofon düzeyi: ince çubuk + yüzde. Çizim React dışında, kare başına bir kez; ses gelmiyorken kare üretilmez
 * (çubuk sıfıra inince döngü durur, yeni ses olayıyla yeniden başlar).
 */
export function LiveLevel({ testId, className }: { testId?: string; className?: string }) {
  const shell = useShell();
  const bar = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const latest = useRef(0);
  const frame = useRef(0);
  const shown = useRef(0);
  const tick = useRef<() => void>(() => {});
  tick.current = () => {
    const raw = Math.min(1, latest.current * 4);
    latest.current *= 0.85;
    const value = raw < 0.01 ? 0 : raw;
    shown.current = value;
    if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0.02, value)})`;
    if (label.current) label.current.textContent = formatPercent(value);
    root.current?.setAttribute('data-level', value.toFixed(2));
    frame.current = value > 0 ? requestAnimationFrame(() => tick.current()) : 0;
  };
  useEvent('voice.level', ({ source, rms }) => {
    if (source !== 'mic') return;
    latest.current = rms;
    if (!frame.current) frame.current = requestAnimationFrame(() => tick.current());
  });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <div ref={root} className={cn('st-level', className)} data-testid={testId} data-level="0.00">
      <div className="st-level-track" role="img" aria-label={t('settings.diag.level')}>
        <div ref={bar} className={cn('st-level-bar', shell.voice?.micMuted ? 'bg-fg-faint' : 'bg-accent')} style={{ transform: 'scaleX(0.02)' }} />
      </div>
      <span ref={label} className="w-10 shrink-0 text-right text-sm text-fg-muted tabular-nums">
        {formatPercent(0)}
      </span>
    </div>
  );
}
