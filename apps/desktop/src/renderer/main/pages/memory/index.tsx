// Hafıza: "Jarvis hakkınızda ne biliyor". Birincil kutu kayıt akışıdır: arama + tür süzgeci, sayı ve sıralama satırı,
// sonra konuya göre bölünmeyen gruplar (ilk grup sabitlenenler; "En yeni" sıralaması son öğrenilenleri verir).
// Bağlam sütunu yalnız seçili kaydın ayrıntısı ve düzenlemesidir: listede görünen hiçbir kayıt orada yinelenmez.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowsDownUp, BookmarkSimple, Brain, ClockCounterClockwise, Handshake, MagnifyingGlass, PencilSimple, Plus, PushPin, Question, Trash, type Icon } from '@phosphor-icons/react';
import { formatDay, relativeTime, t, type MemoryItem, type MemoryKind } from '@fuber/shared';
import {
  Button,
  Chip,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  Panel,
  Select,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
  Workspace,
  WorkspaceGrid,
  WorkspaceHeader,
  cn,
  enter,
  toast,
  useMotionPreset,
} from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt, useLive } from '../../shell/live';
import { ConfirmDialog, ErrorPanel } from '../../shell/parts';
import { capitalize, formatPercent } from '../../shell/text';
import { definePage } from '../page';
import { ContextCard, ContextSection, Disclosure, Fact, RollingNumber, useContainerWide } from './page-parts';

/** Hatırlatıcıdan türeyen kaydın metni bu önekle yazılır (Planlar modülü); kendi grubunda önek gösterilmez. */
const REMINDER_PREFIX = /^Hatırlatıcı:\s*/;
import { AmbientPanel, MEMORY_TABS_ID, memoryTabs, type MemoryTab } from './ambient/Panel';
import { ProfileView } from './profile/ProfileView';
import './memory.css';

type Filter = 'all' | MemoryKind;
const KINDS: MemoryKind[] = ['fact', 'episode', 'commitment'];

interface Draft {
  id: string | null;
  kind: MemoryKind;
  text: string;
  subject: string;
  pinned: boolean;
}

const draftOf = (item: MemoryItem): Draft => ({ id: item.id, kind: item.kind, text: item.text, subject: item.subject ?? '', pinned: item.pinned });

async function saveDraft(draft: Draft): Promise<boolean> {
  const body = { kind: draft.kind, text: draft.text.trim(), subject: draft.subject.trim() || null, pinned: draft.pinned };
  const result = draft.id
    ? await attempt(() => window.fuber.invoke('memory.update', { id: draft.id!, patch: body }))
    : await attempt(() => window.fuber.invoke('memory.save', body));
  if (result) toast.success(draft.id ? t('memory.toast.updated') : t('memory.toast.saved'));
  return result !== null;
}

/** Kayıt alanları: bilgi, tür, konu, sabitleme. Diyalogda ve bağlam sütunundaki düzenlemede aynıdır. */
function MemoryFields({ value, onChange, stacked }: { value: Draft; onChange: (next: Draft) => void; stacked?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('memory.dialog.text')}>
        <Textarea value={value.text} minRows={3} onChange={(event) => onChange({ ...value, text: event.target.value })} data-testid="memory-input-text" autoFocus />
      </Field>
      <div className={cn('grid gap-4', stacked ? 'grid-cols-1' : 'grid-cols-2')}>
        <Field label={t('memory.dialog.kind')}>
          <Select<MemoryKind>
            value={value.kind}
            onChange={(kind) => onChange({ ...value, kind })}
            options={KINDS.map((kind) => ({ value: kind, label: t(`memory.kind.${kind}`), description: t(`memory.kindHint.${kind}`) }))}
          />
        </Field>
        <Field label={t('memory.dialog.subject')} aside={t('memory.dialog.optional')}>
          <Input value={value.subject} onChange={(event) => onChange({ ...value, subject: event.target.value })} placeholder={t('memory.dialog.subjectPlaceholder')} />
        </Field>
      </div>
      <Switch checked={value.pinned} onCheckedChange={(pinned) => onChange({ ...value, pinned })} label={t('memory.dialog.pin')} description={t('memory.dialog.pinHint')} />
    </div>
  );
}

function MemoryDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const [value, setValue] = useState<Draft | null>(draft);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(draft), [draft]);
  const current = value ?? draft;
  const save = async () => {
    if (!current || !current.text.trim()) return;
    setBusy(true);
    const ok = await saveDraft(current);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => !open && onClose()}
      title={draft?.id ? t('memory.dialog.editTitle') : t('memory.dialog.addTitle')}
      description={t('memory.dialog.description')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="primary" loading={busy} disabled={!current?.text.trim()} onClick={() => void save()} data-testid="memory-save">
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </>
      }
    >
      {current && <MemoryFields value={current} onChange={setValue} />}
    </Dialog>
  );
}

// ───────────── kayıt satırı ─────────────

const KIND_ICON: Record<MemoryKind, Icon> = { fact: BookmarkSimple, episode: ClockCounterClockwise, commitment: Handshake };

/** Türkçe katlamayla (İ/ı) büyük-küçük harf ayırmadan eşleşen yerleri vurgular. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .toLocaleLowerCase('tr-TR')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  if (words.length === 0) return <>{text}</>;
  const folded = text.toLocaleLowerCase('tr-TR');
  // Katlama uzunluğu değiştirdiyse (nadir) konumlar kayar; o zaman vurgusuz yazılır.
  if (folded.length !== text.length) return <>{text}</>;
  const marks: Array<[number, number]> = [];
  for (const word of words) {
    for (let from = folded.indexOf(word); from !== -1; from = folded.indexOf(word, from + word.length)) marks.push([from, from + word.length]);
  }
  if (marks.length === 0) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [from, to] of marks) {
    if (from < cursor) continue;
    if (from > cursor) parts.push(text.slice(cursor, from));
    parts.push(
      <mark key={from} className="mem-mark">
        {text.slice(from, to)}
      </mark>,
    );
    cursor = to;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Bu güvenin altındaki kayıt satırda "emin değil" diye işaretlenir; yüzde ayrıntıda yazar. */
const LOW_CONFIDENCE = 0.75;

/**
 * Kayıt satırı: tür işareti, metin; sağda sabit sütunlar: durum (sabit ya da emin değil), konu (yalnız kayıt kendi
 * konu grubunun dışında gösterilirken: düz liste ve sabitlenenler) ve zaman. Kaynak satırda yazmaz, ayrıntıdadır.
 * Sütunlar satırdan satıra oynamaz. Eylemler geniş kapta ayrıntı kutusundadır; dar kapta sağ yuvada belirir.
 */
function MemoryRow({
  item,
  query = '',
  selected,
  faded,
  showSubject,
  hidePin,
  stripPrefix,
  onSelect,
  onEdit,
  onForget,
}: {
  item: MemoryItem;
  query?: string;
  selected?: boolean;
  faded?: boolean;
  /** Kayıt kendi konu grubunun dışındayken (düz liste, sabitlenenler) konusu satırda yazar. */
  showSubject?: boolean;
  /** "Sabitlenenler" grubunda iğne yinelenmez. */
  hidePin?: boolean;
  /** "Hatırlatıcılardan" grubunda önek yinelenmez. */
  stripPrefix?: boolean;
  onSelect?: () => void;
  /** Verilirse satırda düzenle/unut düğmeleri belirir (dar kap). Geniş kapta verilmez: eylemler ayrıntı kutusundadır. */
  onEdit?: () => void;
  onForget: () => void;
}) {
  const preset = useMotionPreset(enter.fade);
  const KindIcon = KIND_ICON[item.kind];
  const unsure = item.confidence < LOW_CONFIDENCE;
  const actions = onEdit !== undefined || faded === true;

  return (
    <motion.li {...preset} exit={{ opacity: 0 }} data-testid="memory-item" data-id={item.id} data-status={item.status}>
      <div
        className="mem-row"
        {...(onSelect
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-pressed': selected ?? false,
              onClick: onSelect,
              onKeyDown: (event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onSelect();
                }
              },
            }
          : {})}
      >
        <span className="mem-row-kind" title={t(`memory.kind.${item.kind}`)}>
          <KindIcon aria-label={t(`memory.kind.${item.kind}`)} />
        </span>
        <p className={cn('mem-row-text', faded ? 'text-fg-faint' : 'text-fg')} data-selectable data-testid="memory-text">
          <Highlight text={stripPrefix ? item.text.replace(REMINDER_PREFIX, '') : item.text} query={query} />
        </p>
        <div className="mem-row-side" data-actions={actions || undefined}>
          <span className="mem-row-info" data-tag={showSubject || undefined}>
            <span className="mem-row-state">
              {item.pinned && !hidePin ? (
                <PushPin weight="fill" className="size-3.5 text-fg-muted" aria-label={t('memory.pinned')} />
              ) : unsure ? (
                <span className="flex text-warning" title={`${t('memory.confidence', { value: formatPercent(item.confidence) })}. ${t('memory.confidenceHint')}`}>
                  <Question weight="bold" className="size-3.5" aria-label={t('memory.unsure')} />
                </span>
              ) : null}
            </span>
            {showSubject && <span className="mem-row-source">{item.subject ?? ''}</span>}
            <time className="mem-row-time" dateTime={item.at} title={formatDay(new Date(item.at))}>
              {capitalize(relativeTime(item.at))}
            </time>
          </span>
          {actions && (
            <span className="mem-row-actions" onClick={(event) => event.stopPropagation()}>
              {onEdit && <IconButton icon={<PencilSimple />} label={t('common.edit')} size="sm" onClick={onEdit} data-testid="memory-edit" />}
              <IconButton icon={<Trash />} label={t('memory.forget')} size="sm" onClick={onForget} data-testid="memory-forget" />
            </span>
          )}
        </div>
      </div>
    </motion.li>
  );
}

interface Group {
  key: string;
  label: string;
  items: MemoryItem[];
}

/** Yalnız çok kalabalık grup kısaltılır (bu sayıdan fazlaysa ilk `GROUP_PREVIEW` kayıt görünür, kalanı düğmeyle açılır). */
const GROUP_LIMIT = 20;
const GROUP_PREVIEW = 16;

/**
 * Kayıtlar konuya göre gruplanır (tür süzgeçte ve satırın işaretinde). İlk grup sabitlenenlerdir (kendi konu
 * grubunda yinelenmezler); konusu yazılmamışlar "Genel" adıyla sona gelir. Grup içi sıra yeniden eskiyedir.
 */
function groupItems(items: MemoryItem[]): Group[] {
  const subjects = new Map<string, Group>();
  const pinned: MemoryItem[] = [];
  const none: MemoryItem[] = [];
  for (const item of items) {
    if (item.pinned) {
      pinned.push(item);
      continue;
    }
    const subject = item.subject?.trim();
    if (!subject) {
      none.push(item);
      continue;
    }
    const key = subject.toLocaleLowerCase('tr-TR');
    const group = subjects.get(key) ?? { key: `s:${key}`, label: subject, items: [] };
    group.items.push(item);
    subjects.set(key, group);
  }
  const newestFirst = (group: Group): Group => ({ ...group, items: [...group.items].sort((a, b) => b.at.localeCompare(a.at)) });
  return [
    ...(pinned.length ? [{ key: 'pinned', label: t('memory.pinnedTitle'), items: pinned }] : []),
    ...[...subjects.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'tr')),
    ...(none.length ? [{ key: 'none', label: t('memory.group.none'), items: none }] : []),
  ].map(newestFirst);
}

function GroupBlock({ group, children }: { group: Group; children: (items: MemoryItem[]) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const long = group.items.length > GROUP_LIMIT;
  const shown = open || !long ? group.items : group.items.slice(0, GROUP_PREVIEW);
  return (
    <section className="mem-group" data-testid="memory-group" data-key={group.key}>
      <h2 className="mem-group-title">
        {group.label}
        <span>{group.items.length}</span>
      </h2>
      <ul className="flex flex-col">{children(shown)}</ul>
      {long && (
        <div className="pt-1 pl-[26px]">
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid="memory-group-more">
            {open ? t('memory.group.less') : t('memory.group.more', { count: group.items.length })}
          </Button>
        </div>
      )}
    </section>
  );
}
// ───────────── bağlam sütunu ─────────────

/** Seçili kaydın ayrıntısı; "Düzenle" ile aynı kutuda düzenlemeye döner. */
function Detail({
  item,
  editing,
  bare,
  onEdit,
  onDone,
  onForget,
}: {
  item: MemoryItem;
  editing: boolean;
  /** Diyaloğun içinde: kendi kutusu çizilmez (iç içe yüzey olmaz). */
  bare?: boolean;
  onEdit: () => void;
  onDone: () => void;
  onForget: () => void;
}) {
  const [value, setValue] = useState<Draft>(draftOf(item));
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(draftOf(item)), [item.id, editing]);
  const save = async () => {
    if (!value.text.trim()) return;
    setBusy(true);
    const ok = await saveDraft(value);
    setBusy(false);
    if (ok) onDone();
  };
  const togglePin = () => void attempt(() => window.fuber.invoke('memory.update', { id: item.id, patch: { pinned: !item.pinned } }));
  const changed = item.updatedAt !== item.at;
  // Bir haftadan eskiyse göreli an zaten tarihtir; yinelenmez.
  const day = formatDay(new Date(item.at));
  const ago = relativeTime(item.at);
  const learned = ago === day ? day : `${day}, ${ago}`;
  const KindIcon = KIND_ICON[item.kind];
  return (
    <Panel tone={bare ? 'quiet' : 'base'} className={bare ? 'gap-4' : 'mem-detail'} data-testid="memory-detail" data-id={item.id}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-fg-muted [&_svg]:size-4">
          {editing ? (
            t('memory.dialog.editTitle')
          ) : (
            <>
              <KindIcon aria-hidden />
              {t(`memory.kind.${item.kind}`)}
            </>
          )}
        </span>
        {!editing && (
          <span className="flex rounded-full bg-surface-3">
            <IconButton icon={<PushPin weight={item.pinned ? 'fill' : 'regular'} />} label={item.pinned ? t('common.unpin') : t('common.pin')} size="sm" pressed={item.pinned} onClick={togglePin} data-testid="memory-pin" />
          </span>
        )}
      </div>
      {editing ? (
        <>
          <MemoryFields value={value} onChange={setValue} stacked />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" loading={busy} disabled={!value.text.trim()} onClick={() => void save()} data-testid="memory-save">
              {t('common.save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onDone}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-lg font-medium text-fg" data-selectable>
            {item.text}
          </p>
          <dl className="flex flex-col gap-2 border-t border-line pt-4">
            {item.subject && <Fact label={t('memory.detail.subject')}>{item.subject}</Fact>}
            <Fact label={t('memory.detail.source')}>{t(`source.${item.source}`)}</Fact>
            <Fact label={t('memory.detail.learned')}>{learned}</Fact>
            {changed && <Fact label={t('memory.detail.updated')}>{capitalize(relativeTime(item.updatedAt))}</Fact>}
            <Fact label={t('memory.detail.confidence')}>
              <span title={t('memory.confidenceHint')}>{item.confidence < 1 ? formatPercent(item.confidence) : t('memory.detail.confidenceFull')}</span>
            </Fact>
            {item.reminderId && <Fact label={t('memory.detail.reminder')}>{t('memory.detail.reminderLinked')}</Fact>}
          </dl>
          <div className="flex items-center gap-2">
            <Button size="sm" icon={<PencilSimple />} onClick={onEdit} data-testid="memory-detail-edit">
              {t('common.edit')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash />} onClick={onForget} data-testid="memory-detail-forget">
              {t('memory.forget')}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

// ───────────── sayfa ─────────────

function ListSkeleton() {
  return (
    <div className="mem-flow" aria-busy aria-label={t('common.loading')}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="mem-row">
          <Skeleton className="mt-1 size-4 rounded-xs" />
          <Skeleton className="mt-1 h-3.5 w-11/12 rounded-full" />
          <Skeleton className="mt-1 h-3 w-12 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Hiç kayıt yokken: ne olduğu, nasıl dolacağına üç örnek cümle, tek eylem; yanında hangi türlerin tutulduğu. */
function EmptyMemory({ onAdd }: { onAdd: () => void }) {
  const shell = useShell();
  const preset = useMotionPreset(enter.fadeUp);
  return (
    <motion.div {...preset}>
      <WorkspaceGrid
        asideWidth={348}
        aside={
          <ContextCard>
            <ContextSection title={t('memory.empty.kinds')}>
              <dl className="flex flex-col gap-3.5">
                {KINDS.map((kind) => {
                  const KindIcon = KIND_ICON[kind];
                  return (
                    <div key={kind} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5">
                      <KindIcon className="mt-[3px] size-4 text-fg-faint" aria-hidden />
                      <div className="flex flex-col">
                        <dt className="text-sm font-medium text-fg">{t(`memory.kind.${kind}`)}</dt>
                        <dd className="m-0 text-sm text-fg-muted">{t(`memory.kindHint.${kind}`)}</dd>
                      </div>
                    </div>
                  );
                })}
              </dl>
            </ContextSection>
            <ContextSection title={t('memory.empty.controlTitle')}>
              <p className="text-sm text-fg-muted">{t('memory.empty.control')}</p>
            </ContextSection>
          </ContextCard>
        }
      >
        <Panel tone="lead" padding="none" data-testid="memory-empty">
          {/* Solda davet ve tek eylem, sağda söyleyerek öğretme örnekleri (geniş kapta yan yana). */}
          <div className="mem-empty">
            <div className="flex flex-col items-start gap-3">
              <h2 className="text-2xl text-fg">{t('memory.empty.title')}</h2>
              <p className="max-w-[52ch] text-base text-fg-muted">{t('memory.empty.body', { wake: shell.wakePhrase })}</p>
              <div className="mt-3">
                <Button variant="primary" icon={<Plus weight="bold" />} onClick={onAdd} data-testid="memory-add">
                  {t('memory.add')}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold tracking-normal text-fg-muted">{t('memory.empty.voice')}</h3>
              <ul className="flex flex-col gap-2.5">
                {(['one', 'two', 'three'] as const).map((key) => (
                  <li key={key} className="text-base text-fg">
                    “{t(`memory.empty.example.${key}`, { wake: shell.wakePhrase })}”
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </WorkspaceGrid>
    </motion.div>
  );
}

function MemoryPage() {
  const shell = useShell();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wide = useContainerWide(rootRef, 1040);
  // Dar kapta süzgeç haplarında simge çizilmez: arama ile haplar tek satıra sığar.
  const roomy = useContainerWide(rootRef, 900);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [forgetting, setForgetting] = useState<MemoryItem | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [showDerived, setShowDerived] = useState(false);
  // "Konuya göre": gruplu akış (ilk grup sabitlenenler). "En yeni": düz liste, son öğrenilenler üstte.
  const [sort, setSort] = useState<'subject' | 'recent'>('subject');
  // Notlar / Meseleler / Raporlar sekmeleri ortam dinleme modülünündür (`./ambient`).
  const [tab, setTab] = useState<MemoryTab>('memory');

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 150);
    return () => window.clearTimeout(id);
  }, [query]);

  const kinds = filter === 'all' ? undefined : [filter];
  const items = useLive<MemoryItem[]>(
    async () => {
      if (debounced) {
        const hits = await window.fuber.invoke('memory.search', { query: debounced, limit: 80, ...(kinds ? { kinds } : {}) });
        return hits.map((hit) => hit.item);
      }
      return window.fuber.invoke('memory.list', { limit: 200, ...(kinds ? { kind: kinds[0] } : {}) });
    },
    ['memory.changed'],
    [debounced, filter],
  );
  // Bağlam sütunu süzgeçten bağımsızdır: sabitlenenler, son öğrenilenler ve geçersiz kılınanlar bütün hafızadan okunur.
  const everything = useLive<MemoryItem[]>(() => window.fuber.invoke('memory.list', { limit: 200, includeSuperseded: true }), ['memory.changed']);
  const stats = useLive(() => window.fuber.invoke('memory.stats'), ['memory.changed']);

  const active = (items.data ?? []).filter((item) => item.status === 'active');
  const all = everything.data ?? [];
  const old = all.filter((item) => item.status === 'superseded' && (filter === 'all' || item.kind === filter));
  const newest = all.reduce<string | null>((max, item) => (item.status === 'active' && (max === null || item.at > max) ? item.at : max), null);
  const counts: Record<Filter, number | undefined> = {
    fact: stats.data?.facts,
    episode: stats.data?.episodes,
    commitment: stats.data?.commitments,
    all: stats.data ? stats.data.facts + stats.data.episodes + stats.data.commitments : undefined,
  };
  const total = counts.all ?? 0;
  // Sayfanın tamamı boşsa tek cümle + tek eylem; üstteki "Elle ekle" o zaman çizilmez (ekranda tek birincil eylem).
  const pageEmpty = tab === 'memory' && stats.state.status === 'ready' && total === 0 && !debounced && items.state.status === 'ready' && active.length === 0;
  const filters: Array<{ value: Filter; label: string; icon?: ReactNode }> = [
    { value: 'all', label: t('common.all') },
    ...KINDS.map((kind) => {
      const KindIcon = KIND_ICON[kind];
      return { value: kind as Filter, label: t(`memory.kindPlural.${kind}`), icon: <KindIcon aria-hidden /> };
    }),
  ];
  const searching = debounced !== '';
  // Hatırlatıcıdan türeyen sözler (Planlar'ın kendi kaydı) asıl kayıtların arasına karışmaz: listenin altında katlı
  // durur. Aramada sonuçların arasındadır (alaka sırası bozulmaz).
  const main = useMemo(() => (searching ? active : active.filter((item) => !item.reminderId)), [items.data, searching]);
  const derived = useMemo(() => (searching ? [] : active.filter((item) => item.reminderId)), [items.data, searching]);
  // Arama ya da "En yeni" sıralaması varken liste düzdür; tür süzgeci gruplamayı bozmaz (sıralama "Konuya göre" kalır).
  const flat = searching || sort === 'recent';
  const groups = useMemo(() => (flat ? [] : groupItems(main)), [main, flat]);
  const flatItems = useMemo(
    () => (searching ? main : [...main].sort((a, b) => b.at.localeCompare(a.at))),
    [main, searching],
  );
  const ordered = flat ? flatItems : groups.flatMap((group) => group.items);
  // Seçim yalnız ekranda görünen kayıtlardan biri olabilir: katlı "Hatırlatıcılardan" grubundaki kayıt, grup
  // kapalıyken seçili sayılmaz (ayrıntı kutusu listede karşılığı olmayan bir kaydı göstermez).
  const visible = showDerived ? [...ordered, ...derived] : ordered;
  const firstId = visible[0]?.id ?? null;
  const selected = visible.find((item) => item.id === selectedId) ?? null;
  // Geniş kapta ayrıntı kutusu kalıcıdır: seçim yoksa ya da seçili kayıt listeden çıktıysa (arama, süzgeç, unutma)
  // listenin ilk kaydı seçilir. Böylece bağlam sütunu seçimle birlikte zıplamaz.
  useEffect(() => {
    if (!wide || items.state.status !== 'ready') return;
    if (selected || firstId === null) return;
    setEditing(false);
    setSelectedId(firstId);
  }, [wide, items.state.status, selected, firstId]);

  // Dar kaba geçilince (ya da sayfa dar kapta açılınca) kendiliğinden yapılmış seçim kalkar: ayrıntı diyaloğu yalnız
  // kullanıcı bir kayda basınca açılır.
  useEffect(() => {
    if (!wide) setSelectedId(null);
  }, [wide]);

  const addNew = () => setDraft({ id: null, kind: 'fact', text: '', subject: '', pinned: false });
  const select = (item: MemoryItem) => {
    // Geniş kapta ayrıntı bağlam sütununda, dar kapta aynı ayrıntı diyalogda açılır (düzenleme ikinci adımdır).
    setEditing(false);
    setSelectedId(item.id);
  };
  const edit = (item: MemoryItem) => {
    if (!wide) return setDraft(draftOf(item));
    setSelectedId(item.id);
    setEditing(true);
  };

  const status =
    stats.state.status !== 'ready' || total === 0
      ? undefined
      : newest
        ? t('memory.status', { name: shell.name, count: total, when: relativeTime(newest) })
        : t('memory.status.count', { name: shell.name, count: total });

  const row = (item: MemoryItem, stripPrefix = false, showSubject = flat, hidePin = false) => (
    <MemoryRow
      key={item.id}
      item={item}
      query={debounced}
      selected={wide && item.id === selectedId}
      showSubject={showSubject}
      hidePin={hidePin}
      stripPrefix={stripPrefix}
      onSelect={() => select(item)}
      {...(wide ? {} : { onEdit: () => edit(item) })}
      onForget={() => setForgetting(item)}
    />
  );

  return (
    <Workspace ref={rootRef} data-testid="memory-page">
      <WorkspaceHeader
        title={t('nav.memory')}
        status={tab === 'memory' ? status : tab === 'profile' ? t('profileUi.status') : t(`ambient.ui.tab.${tab}.status`)}
        actions={
          tab === 'memory' &&
          !pageEmpty && (
            <Button variant="primary" icon={<Plus weight="bold" />} onClick={addNew} data-testid="memory-add">
              {t('memory.add')}
            </Button>
          )
        }
      >
        <div data-testid="memory-tabs">
          <Tabs<MemoryTab> id={MEMORY_TABS_ID} value={tab} onChange={setTab} items={memoryTabs()} aria-label={t('nav.memory')} />
        </div>
      </WorkspaceHeader>

      {tab === 'profile' && <ProfileView />}
      {tab !== 'memory' && tab !== 'profile' && (
        <div data-testid="memory-ambient-panel">
          <AmbientPanel tab={tab} />
        </div>
      )}
      {tab === 'memory' && pageEmpty && <EmptyMemory onAdd={addNew} />}
      {tab === 'memory' && !pageEmpty && (
        <WorkspaceGrid
          asideWidth={348}
          aside={
            // Seçim sık yapılır: eski ayrıntı beklemeden çıkar, yenisi kısa bir belirmeyle gelir (çıkış animasyonu yok).
            !wide ? undefined : selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}>
                <Detail item={selected} editing={editing} onEdit={() => setEditing(true)} onDone={() => setEditing(false)} onForget={() => setForgetting(selected)} />
              </motion.div>
            ) : (
              <Panel tone="base" className="mem-detail" data-testid="memory-detail-none">
                <p className="text-sm text-fg-muted">{t('memory.detail.none')}</p>
              </Panel>
            )
          }
        >
          <Panel tone="lead" padding="none">
            {/* Arama ile süzgeçler tek satırdadır; haplar sabit, arama kutusu kalan yere göre (en çok 300 px) yerleşir. */}
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
              <div className="max-w-[300px] min-w-[150px] flex-1">
                <Input
                  leading={<MagnifyingGlass />}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('memory.searchPlaceholder')}
                  aria-label={t('memory.searchPlaceholder')}
                  data-testid="memory-search"
                />
              </div>
              <div className="flex shrink-0 gap-1.5" role="group" aria-label={t('memory.filterLabel')}>
                {filters.map((option) => {
                  const count = counts[option.value];
                  return (
                    <Chip key={option.value} selected={filter === option.value} icon={roomy ? option.icon : undefined} onClick={() => setFilter(option.value)} data-testid={`memory-filter-${option.value}`}>
                      {option.label}
                      {count !== undefined && <RollingNumber value={count} className={filter === option.value ? 'opacity-60' : 'text-fg-faint'} />}
                    </Chip>
                  );
                })}
                {/* Sıralama: aramada sıra alakadır, düğme çizilmez. */}
                {!searching && (
                  <span className="ml-1 flex items-center">
                    <Menu
                      label={t('memory.sort.label')}
                      placement="bottom-end"
                      trigger={<IconButton icon={<ArrowsDownUp />} label={t('memory.sort.current', { sort: t(`memory.sort.${sort}`) })} size="sm" data-testid="memory-sort" data-sort={sort} />}
                      items={[
                        { id: 'subject', label: t('memory.sort.subject'), onSelect: () => setSort('subject') },
                        { id: 'recent', label: t('memory.sort.recent'), onSelect: () => setSort('recent') },
                      ]}
                    />
                  </span>
                )}
              </div>
            </div>

            {items.state.status === 'loading' ? (
              <ListSkeleton />
            ) : items.state.status === 'error' ? (
              <div className="p-5">
                <ErrorPanel message={items.state.message} onRetry={items.reload} />
              </div>
            ) : active.length === 0 ? (
              <div className="flex flex-col items-start gap-1.5 px-5 py-5" data-testid="memory-no-results">
                <h2 className="text-lg text-fg">{t('memory.noResults.title')}</h2>
                <p className="text-base text-fg-muted">{t(filter === 'all' ? 'memory.noResults.bodyQuery' : 'memory.noResults.body')}</p>
                {(debounced || filter !== 'all') && (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                      }}
                    >
                      {t(filter === 'all' ? 'memory.noResults.clearQuery' : debounced ? 'memory.noResults.clear' : 'memory.noResults.clearFilter')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Aramada sonuç sayısı listenin başında yazar (toplam sayılar süzgeç haplarındadır). */}
                {searching && (
                  <div className="mem-listbar">
                    <p data-testid="memory-result-count">{t('memory.results', { count: active.length })}</p>
                  </div>
                )}
                {flat ? (
                  <div className="mem-flow" data-flat="" data-testid="memory-list">
                    <ul className="flex flex-col">
                      <AnimatePresence initial={false}>{flatItems.map((item) => row(item))}</AnimatePresence>
                    </ul>
                  </div>
                ) : (
                  <div className="mem-flow" data-testid="memory-list">
                    {groups.map((group) => (
                      <GroupBlock key={group.key} group={group}>
                        {(shown) => <AnimatePresence initial={false}>{shown.map((item) => row(item, false, group.key === 'pinned', group.key === 'pinned'))}</AnimatePresence>}
                      </GroupBlock>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="mt-auto">
              {derived.length > 0 && items.state.status === 'ready' && (
                <Disclosure
                  className="border-t border-line px-5 py-3"
                  title={t('memory.group.reminders')}
                  count={derived.length}
                  hint={showDerived ? t('memory.group.remindersHint') : undefined}
                  open={showDerived}
                  onToggle={() => setShowDerived((open) => !open)}
                  data-testid="memory-reminders"
                  toggleTestId="memory-reminders-toggle"
                >
                  <ul className="-mx-3 mt-1 flex flex-col">{derived.map((item) => row(item, true))}</ul>
                </Disclosure>
              )}
              {old.length > 0 && !debounced && (
                <Disclosure
                  className="border-t border-line px-5 py-3"
                  title={t('memory.superseded.title')}
                  count={old.length}
                  hint={showSuperseded ? t('memory.superseded.body') : undefined}
                  open={showSuperseded}
                  onToggle={() => setShowSuperseded((open) => !open)}
                  data-testid="memory-superseded"
                >
                  <ul className="-mx-3 mt-1 flex flex-col">
                    {old.map((item) => (
                      <MemoryRow key={item.id} item={item} faded onForget={() => setForgetting(item)} />
                    ))}
                  </ul>
                </Disclosure>
              )}
            </div>
          </Panel>
        </WorkspaceGrid>
      )}

      <MemoryDialog draft={draft} onClose={() => setDraft(null)} />
      <Dialog open={!wide && selected !== null && forgetting === null} onOpenChange={(open) => !open && setSelectedId(null)} title={t('memory.detail.title')} size="sm" closeLabel={t('common.close')}>
        {!wide && selected && (
          <Detail bare item={selected} editing={editing} onEdit={() => setEditing(true)} onDone={() => setEditing(false)} onForget={() => setForgetting(selected)} />
        )}
      </Dialog>
      <ConfirmDialog
        open={forgetting !== null}
        onOpenChange={(open) => !open && setForgetting(null)}
        title={t('memory.forgetTitle')}
        body={t('memory.forgetBody', { name: shell.name })}
        confirmLabel={t('memory.forget')}
        onConfirm={async () => {
          if (!forgetting) return;
          const ok = await attempt(() => window.fuber.invoke('memory.forget', { id: forgetting.id }));
          if (ok) {
            toast.success(t('memory.toast.forgotten'));
            if (forgetting.id === selectedId) setSelectedId(null);
          }
        }}
      >
        {forgetting && (
          <p className="rounded-sm border border-line bg-surface-1 px-4 py-3 text-sm text-fg" data-selectable>
            {forgetting.text}
          </p>
        )}
      </ConfirmDialog>
    </Workspace>
  );
}
export default definePage({
  id: 'memory',
  titleKey: 'nav.memory',
  icon: Brain,
  order: 30,
  moduleId: 'memory',
  Component: MemoryPage,
});
