import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@fuber/shared';
import { Button, Chip, EmptyState, IconButton, Input, KeyHint, Panel, ProgressBar, Select, Skeleton, Surface, type SelectOption } from '@fuber/ui';
import { ArrowLeft, ChatsCircle, GearSix, MagnifyingGlass, Plus, PushPin, WarningCircle } from '@phosphor-icons/react';
import type { LiveSessionSummary } from '../../../../main/modules/projects/claude/types';
import type { IndexStatus, ProjectDetail, SessionHitDetail, SessionRow } from '../../../../main/modules/projects/types';
import { LiveList, StatusBadge } from './live/LiveList';
import { LiveView } from './live/LiveView';
import { NewSessionDialog } from './live/NewSessionDialog';
import { SettingsDialog } from './live/SettingsDialog';
import { useLiveEnvironment, useLiveRetain, useLiveSessions } from './live/store';
import { SessionPreview } from './SessionPreview';
import { errorText, fuber, SayExamples, Snippet, tidyPath, when } from './shared';
import './projects.css';

const ROW_HEIGHT = 68;
const PAGE = 200;
const OVERSCAN = 6;

type DateFilter = 'all' | 'day' | 'week' | 'month';
const SINCE_MS: Record<Exclude<DateFilter, 'all'>, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

interface Item {
  session: SessionRow;
  hit: SessionHitDetail | null;
}

export function SessionsTab({
  active,
  liveTarget = null,
  onFocusChange,
  actionsSlot = null,
}: {
  /** Sayfa başındaki eylem yuvası: "Yeni oturum" ve ayarlar buraya çizilir (ayrı bir araç şeridi satırı harcanmaz). */
  actionsSlot?: HTMLElement | null;
  active: boolean;
  liveTarget?: { id: string; at: number } | null;
  /** Bir canlı oturum açıkken sekme "çalışma alanı"na döner (liste + döküm + denetçi); sayfa başlığını gizlemesi için bildirilir. */
  onFocusChange?(focused: boolean): void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [projectId, setProjectId] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [date, setDate] = useState<DateFilter>('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Dar kapta bölmeler sırayla açılır: kullanıcı bir oturum seçince ayrıntı bölmesi listenin yerini alır. */
  const [paneOpen, setPaneOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectDetail[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);

  // ── canlı (uygulama içi) Claude Code oturumları ──
  useLiveRetain();
  const { sessions: liveSessions, ready: liveReady } = useLiveSessions();
  const environment = useLiveEnvironment();
  const [liveId, setLiveId] = useState<string | null>(() => liveTarget?.id ?? new URLSearchParams(location.search).get('live'));
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Geçmiş ön izlemesinden sürdürülen oturum: canlı görünümde "Önceki konuşma" açık gelir. */
  const [resumedId, setResumedId] = useState<string | null>(null);

  // Bildirimdeki "Oturumu aç": sayfa o canlı oturumu seçer.
  useEffect(() => {
    if (liveTarget) setLiveId(liveTarget.id);
  }, [liveTarget]);
  // Seçili canlı oturum unutulduysa (ya da hiç yoksa) seçim bırakılır.
  useEffect(() => {
    if (liveId && liveReady && !liveSessions.some((session) => session.id === liveId)) setLiveId(null);
  }, [liveId, liveReady, liveSessions]);

  /** Dizindeki oturum kimliği → o oturumun yaşayan (kapanmamış) canlı kaydı. */
  const liveByCliSession = useMemo(() => {
    const map = new Map<string, LiveSessionSummary>();
    for (const session of liveSessions) {
      if (!session.sessionId || session.status === 'closed') continue;
      const known = map.get(session.sessionId);
      if (!known || session.lastActivityAt > known.lastActivityAt) map.set(session.sessionId, session);
    }
    return map;
  }, [liveSessions]);

  // Canlı oturum seçiliyken sekme çalışma alanına döner: arama, süzgeçler ve geçmiş listesi yerine solda canlı oturumlar,
  // ortada döküm ve yazma kutusu, sağda denetçi. "Oturumlar" düğmesi listeye döndürür.
  const shownLive = liveId ? (liveSessions.find((session) => session.id === liveId) ?? null) : null;
  const focused = shownLive !== null;
  // Dar kapta (tek bölme) bir geçmiş oturum açıkken de sayfa başı gizlenir: döküm pencerenin büyük kısmını alır,
  // "Oturumlar" düğmesi listeye döndürür (canlı oturumla aynı odak düzeni).
  const [narrow, setNarrow] = useState(false);
  const shellRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const measure = () => setNarrow(element.clientWidth < 720);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const immersed = focused || (narrow && paneOpen && selectedId !== null);
  useEffect(() => onFocusChange?.(immersed), [immersed, onFocusChange]);
  useEffect(() => () => onFocusChange?.(false), [onFocusChange]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 120);
    return () => clearTimeout(timer);
  }, [query]);

  const filters = useMemo(
    () => ({
      ...(debounced ? { query: debounced } : {}),
      ...(pinnedOnly ? { pinnedOnly: true } : {}),
      ...(projectId ? { projectId } : {}),
      ...(category ? { category } : {}),
      ...(date !== 'all' ? { since: new Date(Date.now() - SINCE_MS[date]).toISOString() } : {}),
    }),
    [debounced, pinnedOnly, projectId, category, date],
  );

  const fetchPage = useCallback(
    async (offset: number) => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const result = await fuber().invoke('projects.findSessions', { ...filters, limit: filters.query ? 100 : PAGE, offset });
        if (request !== requestRef.current) return;
        const page: Item[] = result.hits
          ? result.hits.map((hit) => ({ session: hit.session, hit }))
          : result.items.map((session) => ({ session, hit: null }));
        setItems((current) => (offset === 0 || !current ? page : [...current, ...page]));
        setTotal(result.total);
        setError(null);
        if (offset === 0) {
          listRef.current?.scrollTo({ top: 0 });
          setScrollTop(0);
          setSelectedId((current) => (current && page.some((item) => item.session.id === current) ? current : (page[0]?.session.id ?? null)));
        }
      } catch (cause) {
        if (request === requestRef.current) setError(errorText(cause));
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [filters],
  );

  const refreshMeta = useCallback(() => {
    void fuber().invoke('projects.listDetailed', {}).then(setProjects).catch(() => {});
    void fuber().invoke('projects.categories').then(setCategories).catch(() => {});
  }, []);

  useEffect(() => void fetchPage(0), [fetchPage]);

  useEffect(() => {
    refreshMeta();
    void fuber().invoke('projects.indexStatus').then(setStatus).catch(() => {});
    const offProgress = fuber().on('projects.indexProgress', (next) => {
      setStatus((previous) => {
        // Dizinleme bitince liste yenilenir (yeni oturumlar görünsün).
        if (previous?.state === 'indexing' && next.state === 'idle') void fetchPage(0);
        return next;
      });
    });
    const offChanged = fuber().on('projects.changed', () => refreshMeta());
    return () => {
      offProgress();
      offChanged();
    };
  }, [refreshMeta, fetchPage]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [items === null, focused]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const list = items ?? [];
  const selectedIndex = list.findIndex((item) => item.session.id === selectedId);
  const selected = selectedIndex >= 0 ? list[selectedIndex]! : null;

  const select = (index: number) => {
    const item = list[index];
    if (!item) return;
    setSelectedId(item.session.id);
    setLiveId(null);
    const element = listRef.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(Math.min(list.length - 1, Math.max(0, (selectedIndex < 0 ? -1 : selectedIndex) + (event.key === 'ArrowDown' ? 1 : -1))));
    }
  };

  const onScroll = () => {
    const element = listRef.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
    if (!loading && list.length < total && element.scrollTop + element.clientHeight > list.length * ROW_HEIGHT - ROW_HEIGHT * 10) {
      void fetchPage(list.length);
    }
  };

  const replace = (session: SessionRow) =>
    setItems((current) => current?.map((item) => (item.session.id === session.id ? { ...item, session: { ...item.session, ...session } } : item)) ?? null);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(list.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

  const projectOptions: SelectOption[] = [
    { value: '', label: t('projects.page.allProjects') },
    ...projects.filter((project) => project.sessionCount > 0).map((project) => ({ value: project.id, label: project.name, description: t('projects.page.sessionTotal', { count: project.sessionCount }) })),
  ];
  const categoryOptions: SelectOption[] = [{ value: '', label: t('projects.page.allCategories') }, ...categories.map((name) => ({ value: name, label: name }))];
  const dateOptions: Array<SelectOption<DateFilter>> = (['all', 'day', 'week', 'month'] as const).map((value) => ({ value, label: t(`projects.page.date.${value}`) }));

  const indexing = status?.state === 'indexing';
  // Geçmiş oturum yokken (taze kurulum) sol sütunu canlı oturumlar doldurur; boş "Oturum yok" kutusu yer kaplamaz.
  const liveFill = liveSessions.length > 0 && items !== null && list.length === 0 && !error && !debounced && !indexing;
  const progress = status && status.bytesTotal > 0 ? status.bytesDone / status.bytesTotal : 0;

  const dialogs = (
    <>
      <NewSessionDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onStarted={(session) => {
          setResumedId(null);
          setLiveId(session.id);
        }}
        projects={projects}
        environment={environment}
        initialProjectId={projectId || undefined}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} environment={environment} />
    </>
  );

  if (shownLive) {
    return (
      <Surface level={1} data-testid="live-workspace" className="ses flex min-h-0 flex-1 overflow-hidden">
        {/* Tek canlı oturumda geçilecek başka oturum yoktur: liste sütunu açılmaz, dönüş ve "yeni oturum" başlığa taşınır. */}
        {liveSessions.length > 1 && (
        <div className="ses-live-list flex w-64 shrink-0 flex-col border-r border-line">
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-2">
            <Button size="sm" variant="ghost" icon={<ArrowLeft />} data-testid="live-back" onClick={() => setLiveId(null)}>
              {t('projects.live.back')}
            </Button>
            <span className="flex-1" />
            <IconButton size="sm" label={t('projects.live.new.button')} icon={<Plus />} data-testid="live-new" onClick={() => setNewOpen(true)} />
            <IconButton size="sm" label={t('projects.live.settings.title')} icon={<GearSix />} data-testid="live-settings" onClick={() => setSettingsOpen(true)} />
          </div>
          <PaneLabel count={liveSessions.length}>{t('projects.live.list.title')}</PaneLabel>
          <LiveList
            fill
            sessions={liveSessions}
            selectedId={shownLive.id}
            onSelect={(id) => {
              setResumedId(null);
              setLiveId(id);
            }}
          />
        </div>
        )}
        <LiveView
          key={shownLive.id}
          summary={shownLive}
          active={active}
          historyOpen={resumedId === shownLive.id}
          onForgotten={() => setLiveId(null)}
          onOpen={setLiveId}
          onBack={() => setLiveId(null)}
          {...(liveSessions.length > 1 ? {} : { standalone: { onNew: () => setNewOpen(true), onSettings: () => setSettingsOpen(true) } })}
        />
        {dialogs}
      </Surface>
    );
  }

  const filtersOn = pinnedOnly || projectId !== '' || category !== '' || date !== 'all';
  const headerActions = (
    <>
      <IconButton label={t('projects.live.settings.title')} icon={<GearSix />} variant="secondary" data-testid="live-settings" onClick={() => setSettingsOpen(true)} />
      <Button variant="secondary" icon={<Plus weight="bold" />} data-testid="live-new" onClick={() => setNewOpen(true)}>
        {t('projects.live.new.button')}
      </Button>
    </>
  );

  // Hiç oturum yokken (taze kurulum) liste ve döküm bölmeleri yerine tek bir davet gösterilir; süzgeçler de çizilmez.
  const blank = items !== null && list.length === 0 && liveSessions.length === 0 && !error && !debounced && !filtersOn && !indexing;
  if (blank) {
    return (
      <>
        <Panel tone="lead" padding="none" className="prj-empty" data-testid="sessions-shell" data-blank="">
          <div className="prj-empty-grid">
            <div className="flex flex-col items-start gap-5 px-7 py-8">
              <div className="flex max-w-[56ch] flex-col gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-fg">{t('projects.intro.title')}</h2>
                <p className="text-base text-fg-muted">{t('projects.intro.body')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="primary" icon={<Plus weight="bold" />} data-testid="live-new" onClick={() => setNewOpen(true)}>
                  {t('projects.live.new.button')}
                </Button>
                <IconButton label={t('projects.live.settings.title')} icon={<GearSix />} data-testid="live-settings" onClick={() => setSettingsOpen(true)} />
              </div>
              <p className="mt-auto border-t border-line pt-4 text-sm text-fg-muted">{t('projects.page.noSessionsHint')}</p>
            </div>
            <SayExamples title={t('projects.say.title')} keys={['projects.intro.say1', 'projects.intro.say2', 'projects.intro.say3']} />
          </div>
        </Panel>
        {dialogs}
      </>
    );
  }

  return (
    <div className="ses-wrap flex min-h-0 flex-1 flex-col">
      {actionsSlot && active
        ? createPortal(headerActions, actionsSlot)
        : null}
      <Surface ref={shellRef} level={1} className="ses flex min-h-0 flex-1 overflow-hidden" data-open={paneOpen ? 'detail' : 'list'} data-testid="sessions-shell">
        <div className="ses-list">
          {/* Liste bölmesinin başı: arama ve süzgeçler listeye aittir; ayrı bir araç şeridi satırı yoktur. */}
          <div className="ses-bar">
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                listRef.current?.focus();
                select(Math.max(0, selectedIndex));
              }
            }}
            placeholder={t('projects.page.searchSessionsShort')}
            aria-label={t('projects.page.searchSessions')}
            leading={<MagnifyingGlass />}
            trailing={<KeyHint keys={['Ctrl', 'F']} size="sm" />}
          />
            <div className="ses-bar-filters">
          <div className="ses-pick">
              <Select value={projectId} onChange={setProjectId} options={projectOptions} aria-label={t('projects.page.filterProject')} />
            </div>
            {categories.length > 0 && (
              <div className="ses-pick">
                <Select value={category} onChange={setCategory} options={categoryOptions} aria-label={t('projects.page.filterCategory')} />
              </div>
            )}
            <div className="ses-pick">
              <Select value={date} onChange={setDate} options={dateOptions} aria-label={t('projects.page.filterDate')} />
            </div>
            <IconButton
              label={t('projects.page.filterPinned')}
              icon={<PushPin weight={pinnedOnly ? 'fill' : 'regular'} />}
              variant="secondary"
              pressed={pinnedOnly}
              onClick={() => setPinnedOnly((value) => !value)}
              data-testid="filter-pinned"
            />
            {filtersOn && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setPinnedOnly(false);
                  setProjectId('');
                  setCategory('');
                  setDate('all');
                }}
              >
                {t('projects.filter.clear')}
              </Button>
            )}
            </div>
            {indexing && (
              <ProgressBar
                size="sm"
                value={progress}
                label={t('projects.page.indexing')}
                valueLabel={t('projects.page.indexingFiles', { done: status.filesDone, total: status.filesTotal })}
              />
            )}
            {!actionsSlot && <div className="flex items-center justify-end gap-2">{headerActions}</div>}
          </div>
          {liveSessions.length > 0 && <PaneLabel count={liveSessions.length}>{t('projects.live.list.title')}</PaneLabel>}
          <LiveList fill={liveFill} sessions={liveSessions} selectedId={null} onSelect={setLiveId} />
          {!liveFill && items !== null && !error && (
            <PaneLabel count={total}>{debounced ? t('projects.page.resultLabel') : t('projects.live.list.history')}</PaneLabel>
          )}
          {liveFill ? (
            <p className="shrink-0 border-t border-line px-5 py-3 text-sm text-fg-faint">{t('projects.live.list.noHistory')}</p>
          ) : error ? (
            <EmptyState size="sm" icon={<WarningCircle />} title={t('projects.page.loadFailed')} description={error} />
          ) : items === null ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 7 }, (_, index) => (
                <Skeleton key={index} className="h-18" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              size="sm"
              className="my-auto"
              icon={debounced ? <MagnifyingGlass /> : <ChatsCircle />}
              title={
                debounced
                  ? t('projects.page.noSessionsFor', { query: debounced })
                  : indexing
                    ? t('projects.page.indexingTitle')
                    : filtersOn
                      ? t('projects.page.noSessionsFiltered')
                      : t('projects.page.noSessions')
              }
              description={
                debounced || filtersOn ? t('projects.page.noSessionsForHint') : indexing ? t('projects.page.indexingBody') : t('projects.page.noSessionsHint')
              }
            />
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label={t('projects.page.sessionList')}
              aria-activedescendant={selected ? `session-${selected.session.id}` : undefined}
              tabIndex={0}
              onKeyDown={onListKey}
              onScroll={onScroll}
              className="ui-scroll relative min-h-0 flex-1 overflow-y-auto outline-offset-[-2px]"
            >
              <div style={{ height: list.length * ROW_HEIGHT }} />
              {list.slice(first, last).map((item, offset) => {
                const index = first + offset;
                return (
                  <SessionListRow
                    key={item.session.id}
                    item={item}
                    top={index * ROW_HEIGHT}
                    selected={item.session.id === selectedId}
                    live={liveByCliSession.get(item.session.id) ?? null}
                    onSelect={() => {
                      // Dizindeki oturum şu an uygulamada canlıysa ön izleme yerine canlı görünümü açılır.
                      const live = liveByCliSession.get(item.session.id);
                      setSelectedId(item.session.id);
                      setPaneOpen(true);
                      setResumedId(live ? live.id : null);
                      setLiveId(live ? live.id : null);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
        {selected ? (
          <SessionPreview
            key={selected.session.id}
            session={selected.session}
            matchSeq={selected.hit?.matchSeq ?? null}
            query={debounced}
            categories={categories}
            onBack={() => setPaneOpen(false)}
            onChanged={(session) => {
              replace(session);
              refreshMeta();
            }}
            onArchived={() => void fetchPage(0)}
            onResumed={(session) => {
              setResumedId(session.id);
              setLiveId(session.id);
            }}
          />
        ) : (
          <div className="ses-detail items-center justify-center">
            {liveSessions.length > 0 ? (
              <EmptyState size="sm" icon={<ChatsCircle />} title={t('projects.live.list.pick')} description={t('projects.live.list.pickHint')} />
            ) : items !== null && list.length > 0 ? (
              <EmptyState size="sm" icon={<ChatsCircle />} title={t('projects.page.pickSession')} />
            ) : null}
          </div>
        )}
      </Surface>
      {dialogs}
    </div>
  );
}

/** Bölme içi küçük başlık (canlı / geçmiş): çizgiyle ayrılan sakin etiket. */
function PaneLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex shrink-0 items-baseline gap-2 border-b border-line px-5 py-2 text-sm font-medium text-fg-muted">
      {children}
      {count !== undefined && <span className="text-xs text-fg-faint tabular-nums">{count}</span>}
    </div>
  );
}

function SessionListRow({ item, top, selected, live, onSelect }: { item: Item; top: number; selected: boolean; live: LiveSessionSummary | null; onSelect(): void }) {
  const { session, hit } = item;
  return (
    <div
      id={`session-${session.id}`}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={{ top, height: ROW_HEIGHT }}
      className={`absolute inset-x-0 flex cursor-pointer flex-col justify-center gap-1 border-b border-line px-5 transition-colors duration-(--duration-fast) ease-out ${
        selected ? 'bg-surface-4' : 'hover:bg-surface-2'
      }`}
    >
      {/* Üst satır: başlık ve sağında zaman; alt satır: proje ve özet (tam genişlik). */}
      <div className="flex min-w-0 items-center gap-2">
        {session.pinned && <PushPin weight="fill" className="size-3.5 shrink-0 text-accent-fg" aria-label={t('projects.page.pinnedLabel')} />}
        <span className={`min-w-0 flex-1 truncate text-base text-fg ${selected ? 'font-semibold' : 'font-medium'}`}>{session.title}</span>
        {live ? (
          <span className="shrink-0">
            <StatusBadge session={live} />
          </span>
        ) : (
          <span className="shrink-0 text-xs text-fg-faint tabular-nums">{when(session.lastAt)}</span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
        {session.projectName && <span className="max-w-[38%] shrink-0 truncate text-fg-faint">{session.projectName}</span>}
        {session.projectName && <span className="shrink-0 text-fg-faint" aria-hidden>·</span>}
        <span className="min-w-0 flex-1 truncate">{hit ? <Snippet text={hit.snippet} /> : (session.preview ?? tidyPath(session.cwd))}</span>
      </div>
    </div>
  );
}
