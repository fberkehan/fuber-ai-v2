// Kurulum sihirbazının ortak parçaları: yönlü adım geçişi (v1 `AdimGecisi` mantığı), sağdaki panoya giden önizleme
// portalı, başlık, durum satırı, seçenek kartı, anahtar listesi. Sihirbaza özgüdür; `@fuber/ui`'nin dış arayüzü
// değişmez.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check } from '@phosphor-icons/react';
import { t, type LocalModelProgress } from '@fuber/shared';
import { Button, Spinner, Switch, cn, type ButtonVariant } from '@fuber/ui';

// ───────────────────────────── geçiş ─────────────────────────────

/** Çıkan katmanın kalma süresi: sol 180 ms, önizleme 60 ms gecikmeli (+ pay). */
const EXIT_MS = 300;

interface Layer {
  /** `gir` yeni adım, `cik` çıkan adım (etkileşimsiz, ekran okuyucudan gizli). */
  phase: 'gir' | 'cik';
  /** Önizlemenin yerleşeceği pano yuvası. */
  slot: HTMLElement | null;
  id: string;
}

const LayerContext = createContext<Layer>({ phase: 'gir', slot: null, id: '' });

/**
 * Adım geçişi: yeni adım geldiği yönden kayarak ve belirerek girer, eski adım aynı ızgara hücresinde kısa sürede
 * ters yöne söner (iki katman üst üste; yerleşim zıplamaz). Çıkan katman aynı anahtarla kalır: durumu korunur,
 * etkileri yeniden koşmaz. Önizleme (`Preview`) aynı katmanın içinden panoya taşınır ve 60 ms sonra değişir.
 * Hızlı art arda geçişte eski katman hemen yenisiyle değişir (kesilebilir).
 */
export function StepSwap({ id, slot, children }: { id: string; slot: HTMLElement | null; children: ReactNode }) {
  // Çıkan katman ÇİZİM SIRASINDA türetilir (etkide değil): eski adımın anahtarı ağaçtan bir an bile düşmez, bileşeni
  // yeniden kurulmaz ve etkileri yeniden koşmaz (ör. bir sınamanın "Şimdilik geç"i sonraki ekrana sızmaz). Son çizilen
  // öğe aynen kullanılır; React aynı öğeyi yeniden çizmez.
  const latest = useRef<{ id: string; el: ReactNode }>({ id, el: children });
  const [leaving, setLeaving] = useState<{ id: string; el: ReactNode } | null>(null);
  if (latest.current.id !== id) setLeaving(latest.current);
  latest.current = { id, el: children };
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  return (
    <div className="setup-swap">
      {leaving && leaving.id !== id ? (
        <LayerContext.Provider key={leaving.id} value={{ phase: 'cik', slot, id: leaving.id }}>
          <div className="setup-layer" data-gecis="cik" aria-hidden inert>
            {leaving.el}
          </div>
        </LayerContext.Provider>
      ) : null}
      <LayerContext.Provider key={id} value={{ phase: 'gir', slot, id }}>
        <div className="setup-layer" data-gecis="gir">
          {children}
        </div>
      </LayerContext.Provider>
    </div>
  );
}

/** `--k` sırası: başlık 0, açıklama 1, denetimler 2… Girişte öğeler 45 ms arayla aşağıdan gelir. */
export const stagger = (k: number) => ({ 'data-k': '', style: { '--k': k } as CSSProperties });

/**
 * Adımın sağdaki canlı önizlemesi: pano yuvasına portal. Gövde ortalanır, altta tek satır not (`caption`).
 * Adımın kendi durumunu (sınama sonucu, seçim) doğrudan okur; ayrı bir kopya tutulmaz.
 */
export function Preview({ children, caption, kind }: { children: ReactNode; caption?: ReactNode; kind: string }) {
  const layer = useContext(LayerContext);
  if (!layer.slot) return null;
  return createPortal(
    <div className="setup-layer setup-pv" data-gecis={layer.phase} data-preview={kind} aria-hidden={layer.phase === 'cik' || undefined} inert={layer.phase === 'cik'}>
      <div className="setup-pv-body">{children}</div>
      {caption ? <p className="setup-pv-caption">{caption}</p> : null}
    </div>,
    layer.slot,
    layer.id,
  );
}

// ───────────────────────────── sol sütun ─────────────────────────────

/** Tek büyük soru + kısa açıklama. Başlık her adımda aynı yükseklikte başlar; odak adım değişince buraya gelir. */
export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      <h1 className="setup-h1" tabIndex={-1} data-testid="setup-title" {...stagger(0)}>
        {title}
      </h1>
      {children ? (
        <div className="setup-lead" {...stagger(1)}>
          {children}
        </div>
      ) : null}
    </header>
  );
}

/** Tek durum satırı: rengi yalnız im taşır, yazı nötrdür (renkli çıplak yazı yok). */
export function Notice({ tone, icon, children, testId }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; icon?: ReactNode; children: ReactNode; testId?: string }) {
  const colors = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-fg-faint' } as const;
  return (
    <p className="flex items-start gap-2.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0" data-testid={testId} data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>
      {icon ? <span className={cn('contents', colors[tone])}>{icon}</span> : null}
      <span className={tone === 'neutral' ? 'text-fg-muted' : 'text-fg'}>{children}</span>
    </p>
  );
}

/**
 * Adımın kendi eylemi. Sürerken yazısı kaybolmaz ("Sınama sürüyor…"), boş bir hap kalmaz; odak düğmede kalır ve
 * ikinci basış yok sayılır.
 */
export function RunButton({
  running,
  runningLabel,
  onRun,
  variant,
  icon,
  disabled,
  testId,
  children,
}: {
  running: boolean;
  runningLabel: string;
  onRun(): void;
  variant: ButtonVariant;
  icon?: ReactNode;
  disabled?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant={variant}
      className={cn('rounded-full', running && 'pointer-events-none')}
      icon={running ? <Spinner size={14} label={null} /> : icon}
      onClick={() => {
        if (!running) onRun();
      }}
      disabled={disabled}
      aria-busy={running || undefined}
      aria-disabled={running || undefined}
      data-testid={testId}
    >
      {running ? runningLabel : children}
    </Button>
  );
}

/** Seçenek kartı (radyo): simge, ad, tek cümle, sağda seçim imi. Bütün kart düğmedir. */
export function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  body,
  badge,
  value,
  trailing,
  compact,
}: {
  selected: boolean;
  onSelect(): void;
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  badge?: ReactNode;
  value: string;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-value={value}
      data-selected={selected ? 'true' : 'false'}
      className="setup-option"
      data-compact={compact ? '' : undefined}
      onClick={onSelect}
    >
      {icon ? (
        <span className="setup-option-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-base font-medium text-fg">
          {title}
          {badge}
        </span>
        {body ? <span className="text-sm text-fg-muted">{body}</span> : null}
      </span>
      {trailing ?? (
        <span className="setup-radio" aria-hidden>
          {selected ? <Check weight="bold" /> : null}
        </span>
      )}
    </button>
  );
}

export interface ToggleItem {
  id: string;
  icon: ReactNode;
  label: string;
  hint: ReactNode;
  checked?: boolean;
  onChange?: (value: boolean) => void;
  testId?: string;
  /** Anahtarsız bilgi satırı (ör. dosya klasörleri: Ayarlar'dan seçilir). */
  info?: ReactNode;
}

/** Anahtarlı satırlardan oluşan tek kart (gruplu liste): simge, ad, tek cümle, anahtar. */
export function ToggleList({ items }: { items: ToggleItem[] }) {
  return (
    <div className="setup-list" role="group">
      {items.map((item) => (
        <div className="setup-list-row" key={item.id} data-perm={item.id} data-on={item.checked === undefined ? undefined : item.checked ? 'true' : 'false'}>
          <span className="setup-list-icon" aria-hidden>
            {item.icon}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-base font-medium text-fg">{item.label}</span>
            <span className="text-sm text-fg-muted">{item.hint}</span>
          </span>
          {item.onChange ? (
            <Switch checked={item.checked ?? false} onCheckedChange={item.onChange} aria-label={item.label} data-testid={item.testId} />
          ) : (
            (item.info ?? <span />)
          )}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── yardımcılar ─────────────────────────────

/** Toplam boyut: "5,2 GB" ya da "820 MB". */
export function formatSize(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

const ROLE_ORDER = ['stt', 'tts', 'llm', 'vad', 'wake', 'speaker'];

export interface RoleSummary {
  role: string;
  status: LocalModelProgress['status'];
  received: number;
  total: number;
  error: string | null;
}

/** Bir rolün dosyalarını tek satıra indirir: en "geride" olan durum satırın durumudur. */
export function summarize(models: LocalModelProgress[]): RoleSummary[] {
  const rank: Record<LocalModelProgress['status'], number> = { failed: 0, missing: 1, queued: 2, downloading: 3, verifying: 4, ready: 5 };
  const roles = new Map<string, RoleSummary>();
  for (const model of models) {
    const current = roles.get(model.role);
    if (!current) {
      roles.set(model.role, { role: model.role, status: model.status, received: model.receivedBytes, total: model.totalBytes, error: model.error });
      continue;
    }
    current.received += model.receivedBytes;
    current.total += model.totalBytes;
    current.error ??= model.error;
    // İnen bir dosya varken satır "iniyor" görünür (sıradakiler beklese de).
    const candidate = model.status;
    if (candidate === 'downloading' && current.status !== 'failed') current.status = 'downloading';
    else if (rank[candidate] < rank[current.status] && current.status !== 'downloading') current.status = candidate;
  }
  return [...roles.values()].sort((a, b) => ((ROLE_ORDER.indexOf(a.role) + 99) % 99) - ((ROLE_ORDER.indexOf(b.role) + 99) % 99));
}

export const roleLabel = (role: string) => (ROLE_ORDER.includes(role) ? t(`setup.models.role.${role}`) : t('setup.models.role.other'));

/** Saate göre selam: 05–11 günaydın, 11–17 iyi günler, 17–22 iyi akşamlar, kalanı iyi geceler. */
export function greeting(address: string, now: Date = new Date()): string {
  const hour = now.getHours();
  const key = hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'day' : hour >= 17 && hour < 22 ? 'evening' : 'night';
  return t(`setup.greet.${key}`, { address });
}

/** "17 Kasım Salı · 09:26" (yerel saat, dakikada bir yenilenir). */
export function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Dakika dönünce bir kez: sürekli döngü yok.
    const wait = 60_000 - (Date.now() % 60_000) + 50;
    const timer = setTimeout(() => setNow(new Date()), wait);
    return () => clearTimeout(timer);
  }, [now]);
  const day = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export function capitalize(phrase: string): string {
  return phrase
    .split(' ')
    .map((word) => (word ? word[0]!.toLocaleUpperCase('tr') + word.slice(1) : word))
    .join(' ');
}
