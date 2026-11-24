// Projeler sekmesi: son çalışılanlar birincil kutuda hücre ızgarası (ad, teknoloji, dal, son oturum, tek "Aç"),
// altında bütün projelerin yoğun tablosu (sıralama, arama, ortadan kırpılan yol); bağlam sütununda dizin durumu ve süzgeçler.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t, type OpenTarget } from '@fuber/shared';
import {
  Badge,
  Button,
  Chip,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  KeyHint,
  Menu,
  Panel,
  ProgressBar,
  Skeleton,
  Textarea,
  Tooltip,
  WorkspaceGrid,
  toast,
  type MenuItem,
} from '@fuber/ui';
import {
  ArrowsClockwise,
  CaretDown,
  CaretUp,
  Code,
  DotsThree,
  FolderOpen,
  GitBranch,
  MagnifyingGlass,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Sparkle,
  TerminalWindow,
  WarningCircle,
} from '@phosphor-icons/react';
import type { IndexStatus, ProjectDetail } from '../../../../main/modules/projects/types';
import { errorText, fuber, MiddlePath, SayExamples, stackLabels, when } from './shared';
import './projects.css';

const TARGETS: Array<{ target: OpenTarget; icon: typeof Code }> = [
  { target: 'editor', icon: Code },
  { target: 'explorer', icon: FolderOpen },
  { target: 'terminal', icon: TerminalWindow },
  { target: 'claude', icon: Sparkle },
];

const RECENT_COUNT = 6;
const LAST_TARGET_KEY = 'fuber2.projects.lastTarget';

type SortKey = 'recent' | 'name' | 'sessions';
type Sort = { key: SortKey; dir: 1 | -1 };
type Scope = 'all' | 'pinned' | 'sessions';

/** Projenin en son kullanılan açma hedefi (yerel tercih; okunamazsa kod düzenleyici). */
function readLastTargets(): Record<string, OpenTarget> {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_TARGET_KEY) ?? '{}') as Record<string, OpenTarget>;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
function rememberTarget(id: string, target: OpenTarget) {
  try {
    localStorage.setItem(LAST_TARGET_KEY, JSON.stringify({ ...readLastTargets(), [id]: target }));
  } catch {
    // saklanamadıysa varsayılan hedef kalır
  }
}

const activityOf = (project: ProjectDetail) =>
  Math.max(...[project.lastOpenedAt, project.lastSessionAt, project.modifiedAt].map((value) => (value ? Date.parse(value) : 0)));
/** Tabloda gösterilen ve sıralamada kullanılan "son etkinlik": en son açılış, oturum ya da klasör değişikliği. */
const lastActivity = (project: ProjectDetail) => new Date(activityOf(project)).toISOString();
const workedOn = (project: ProjectDetail) => Math.max(...[project.lastOpenedAt, project.lastSessionAt].map((value) => (value ? Date.parse(value) : 0)));

export function ProjectsTab({ active, status }: { active: boolean; status: IndexStatus | null }) {
  const [projects, setProjects] = useState<ProjectDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProjectDetail[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<ProjectDetail | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [sort, setSort] = useState<Sort | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [stack, setStack] = useState<string | null>(null);
  const [root, setRoot] = useState<string>('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [lastTargets, setLastTargets] = useState<Record<string, OpenTarget>>(readLastTargets);

  const load = useCallback(async () => {
    try {
      setProjects(await fuber().invoke('projects.listDetailed', {}));
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);

  useEffect(() => {
    void load();
    void fuber()
      .invoke('settings.get')
      .then((settings) => setRoot(settings.projectsRoot))
      .catch(() => {});
    return fuber().on('projects.changed', ({ entity }) => {
      if (entity === 'project') void load();
    });
  }, [load]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fuber()
        .invoke('projects.listDetailed', { query: text })
        .then((list) => !cancelled && setResults(list))
        .catch(() => {});
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, projects]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const open = async (project: ProjectDetail, target: OpenTarget) => {
    rememberTarget(project.id, target);
    setLastTargets((current) => ({ ...current, [project.id]: target }));
    setBusy(`${project.id}:${target}`);
    try {
      const result = await fuber().invoke('projects.open', { id: project.id, target });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) toast.success(result.message);
      else toast({ title: result.message, tone: 'danger' });
    } catch (cause) {
      setMessage({ ok: false, text: errorText(cause) });
    } finally {
      setBusy(null);
    }
  };

  const togglePin = async (project: ProjectDetail) => {
    try {
      await fuber().invoke('projects.update', { id: project.id, patch: { pinned: !project.pinned } });
      await load();
    } catch (cause) {
      setMessage({ ok: false, text: errorText(cause) });
    }
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const result = await fuber().invoke('projects.rescan');
      setMessage({ ok: true, text: t('projects.page.rescanned', { projects: result.projects, sessions: result.sessions }) });
      await load();
    } catch (cause) {
      setMessage({ ok: false, text: errorText(cause) });
    } finally {
      setScanning(false);
    }
  };

  const all = projects ?? [];
  const searching = results !== null;
  const filtered = scope !== 'all' || stack !== null;

  /** Son çalışılanlar: sabitler önce, sonra en son açılan ya da oturumu olanlar. */
  const recent = useMemo(() => {
    const pinned = all.filter((project) => project.pinned).sort((a, b) => activityOf(b) - activityOf(a));
    const worked = all.filter((project) => !project.pinned && workedOn(project) > 0).sort((a, b) => workedOn(b) - workedOn(a));
    return [...pinned, ...worked].slice(0, RECENT_COUNT);
  }, [all]);

  /** Teknoloji süzgeci: en çok geçen etiketler. */
  const stacks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of all) for (const label of stackLabels(project.stack)) counts.set(label, (counts.get(label) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr')).slice(0, 10);
  }, [all]);

  const rows = useMemo(() => {
    let list = searching ? results : all;
    if (scope === 'pinned') list = list.filter((project) => project.pinned);
    if (scope === 'sessions') list = list.filter((project) => project.sessionCount > 0);
    if (stack) list = list.filter((project) => stackLabels(project.stack).includes(stack));
    // Aramada varsayılan sıra alaka sırasıdır (ana süreçten gelir); başlığa basınca seçilen sütuna göre sıralanır.
    const effective = sort ?? (searching ? null : { key: 'recent' as const, dir: -1 as const });
    if (!effective) return list;
    const by: Record<SortKey, (a: ProjectDetail, b: ProjectDetail) => number> = {
      recent: (a, b) => activityOf(a) - activityOf(b),
      name: (a, b) => a.name.localeCompare(b.name, 'tr'),
      sessions: (a, b) => a.sessionCount - b.sessionCount || a.name.localeCompare(b.name, 'tr'),
    };
    return [...list].sort((a, b) => by[effective.key](a, b) * effective.dir);
  }, [all, results, searching, scope, stack, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => {
      const base = current ?? (searching ? null : { key: 'recent' as const, dir: -1 as const });
      if (base?.key === key) return { key, dir: base.dir === 1 ? -1 : 1 };
      return { key, dir: key === 'name' ? 1 : -1 };
    });
  const shownSort = sort ?? (searching ? null : { key: 'recent' as const, dir: -1 as const });

  const openButton = (project: ProjectDetail, className?: string) => {
    const lastTarget = lastTargets[project.id] ?? 'editor';
    const LastIcon = TARGETS.find((entry) => entry.target === lastTarget)?.icon ?? Code;
    return (
      // Tek eylem: "Aç", en son kullanılan hedefle; öbür hedefler ve sabitleme menüde.
      <Tooltip content={t(`projects.page.openIn.${lastTarget}`)}>
        <Button
          size="sm"
          icon={<LastIcon />}
          loading={busy === `${project.id}:${lastTarget}`}
          onClick={() => void open(project, lastTarget)}
          className={className}
          data-testid="project-open"
        >
          {t('projects.page.open')}
        </Button>
      </Tooltip>
    );
  };

  const moreMenu = (project: ProjectDetail) => {
    const lastTarget = lastTargets[project.id] ?? 'editor';
    const menu: MenuItem[] = [
      ...TARGETS.filter((entry) => entry.target !== lastTarget).map(({ target, icon: TargetIcon }) => ({
        id: target,
        label: t(`projects.page.openIn.${target}`),
        icon: <TargetIcon />,
        onSelect: () => void open(project, target),
      })),
      { type: 'separator', id: 'sep' },
      {
        id: 'pin',
        label: project.pinned ? t('projects.page.unpin') : t('projects.page.pin'),
        icon: project.pinned ? <PushPinSlash /> : <PushPin />,
        onSelect: () => void togglePin(project),
      },
      { id: 'edit', label: t('projects.page.edit'), icon: <PencilSimple />, onSelect: () => setEditing(project) },
    ];
    return <Menu trigger={<IconButton size="sm" label={t('projects.page.more')} icon={<DotsThree weight="bold" />} tooltip={false} />} placement="bottom-end" items={menu} />;
  };

  /** Son çalışılanlar hücresi: ad ve teknoloji, altında dal ve son oturum tek satırda; tek eylem "Aç". */
  const renderCell = (project: ProjectDetail) => {
    const labels = stackLabels(project.stack);
    return (
      <div key={project.id} role="listitem" className="prj-cell" data-testid="project-recent" data-project={project.id}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              {project.pinned && <PushPin weight="fill" className="size-3.5 shrink-0 text-accent-fg" aria-label={t('projects.page.pinnedLabel')} />}
              <span className="truncate text-base font-semibold tracking-tight text-fg">{project.name}</span>
            </span>
            <span className="truncate text-sm text-fg-muted">{labels.length ? labels.join(', ') : t('projects.page.noStack')}</span>
          </div>
          {openButton(project, 'shrink-0')}
        </div>
        {/* Dal ve son oturum ayrı satırlarda: ikisi de kırpılmadan sığar. */}
        <div className="flex min-w-0 flex-col gap-0.5 text-sm">
          <span className="text-fg-muted tabular-nums">
            {project.sessionCount > 0 ? t('projects.page.sessionCount', { count: project.sessionCount, when: when(project.lastSessionAt) }) : when(lastActivity(project))}
          </span>
          <span className="flex min-w-0 items-center gap-1 font-mono text-xs text-fg-faint">
            <GitBranch className="size-3.5 shrink-0" aria-hidden />
            <span className="[overflow-wrap:anywhere]">{project.gitBranch ?? t('projects.page.noGit')}</span>
          </span>
        </div>
      </div>
    );
  };

  const renderRow = (project: ProjectDetail) => {
    const labels = stackLabels(project.stack);
    return (
      <div key={project.id} role="listitem" className="prj-row" data-testid="project-row" data-project={project.id}>
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            {project.pinned && <PushPin weight="fill" className="size-3.5 shrink-0 text-accent-fg" aria-label={t('projects.page.pinnedLabel')} />}
            <span className="truncate text-base font-medium text-fg">{project.name}</span>
            {project.aliases.slice(0, 2).map((alias) => (
              <Badge key={alias} size="sm">
                {alias}
              </Badge>
            ))}
            {project.category && <Badge size="sm">{project.category}</Badge>}
          </span>
          <span className="prj-path-inline min-w-0">
            <MiddlePath path={project.path} root={root} />
          </span>
        </div>
        <span className="prj-col-stack truncate text-sm text-fg-muted">{labels.length ? labels.join(', ') : <Empty />}</span>
        <span className="prj-col-branch truncate font-mono text-xs text-fg-muted">{project.gitBranch ?? <Empty />}</span>
        <span className="truncate text-sm text-fg-muted tabular-nums">{when(lastActivity(project))}</span>
        <span className="prj-col-count text-sm text-fg-muted tabular-nums">{project.sessionCount > 0 ? project.sessionCount : <Empty />}</span>
        <span className="prj-col-path min-w-0">
          <MiddlePath path={project.path} root={root} />
        </span>
        <span className="flex items-center justify-end gap-1">
          {openButton(project, 'prj-row-open')}
          {moreMenu(project)}
        </span>
      </div>
    );
  };

  const sortButton = (key: SortKey, label: string, className?: string) => {
    const on = shownSort?.key === key;
    return (
      <span className={className} role="columnheader" aria-sort={on ? (shownSort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="prj-sort" data-active={on ? '' : undefined} onClick={() => toggleSort(key)} data-testid={`sort-${key}`}>
          {label}
          {on && (shownSort.dir === 1 ? <CaretUp weight="bold" className="size-3" aria-hidden /> : <CaretDown weight="bold" className="size-3" aria-hidden />)}
        </button>
      </span>
    );
  };

  if (error) {
    return (
      <Panel className="max-w-[720px]">
        <EmptyState
          icon={<WarningCircle />}
          title={t('projects.page.loadFailed')}
          description={error}
          actions={<Button onClick={() => void load()}>{t('projects.page.retry')}</Button>}
        />
      </Panel>
    );
  }

  const empty = projects !== null && projects.length === 0;
  const indexing = status?.state === 'indexing';
  const progress = status && status.bytesTotal > 0 ? status.bytesDone / status.bytesTotal : 0;

  /** Dizin durumu: ne zaman güncellendi, hangi kök taranıyor; sayılar sekmelerde yazdığı için burada yinelenmez. */
  const indexPanel = (
    <Panel title={t('projects.index.title')} data-testid="projects-index">
      {indexing ? (
        <ProgressBar
          size="sm"
          value={progress}
          label={t('projects.page.indexing')}
          valueLabel={t('projects.page.indexingFiles', { done: status.filesDone, total: status.filesTotal })}
        />
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-fg-muted">{t('projects.index.updated')}</dt>
            <dd className="min-w-0 truncate text-fg tabular-nums">
              {status?.state === 'error' ? <span className="text-danger">{t('projects.index.failed')}</span> : status?.lastIndexedAt ? when(status.lastIndexedAt) : t('projects.index.never')}
            </dd>
          </div>
          {root && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-fg-muted">{t('projects.index.root')}</dt>
              <dd className="min-w-0">
                <MiddlePath path={root} />
              </dd>
            </div>
          )}
          {status && status.messages > 0 && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-fg-muted">{t('projects.index.messages')}</dt>
              <dd className="text-fg tabular-nums">{new Intl.NumberFormat('tr-TR').format(status.messages)}</dd>
            </div>
          )}
        </dl>
      )}
      {/* Boş dizinde "Yeniden tara" birincil kutudadır; iki yerde durmaz. */}
      {!empty && (
        <Button variant="secondary" size="sm" icon={<ArrowsClockwise />} loading={scanning} onClick={() => void rescan()} className="self-start" data-testid="rescan">
          {t('projects.page.rescan')}
        </Button>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? 'text-fg-muted' : 'text-danger'}`}>
          {message.text}
        </p>
      )}
    </Panel>
  );

  /** Süzgeçler tek yerde: kapsam ve teknoloji. */
  const filterPanel = !empty && projects !== null && (
    <Panel
      title={t('projects.filter.title')}
      action={
        filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setScope('all');
              setStack(null);
            }}
          >
            {t('projects.filter.clear')}
          </Button>
        ) : undefined
      }
      className="prj-aside-filters"
      data-testid="projects-filters"
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('projects.filter.scope')}>
        {(['all', 'pinned', 'sessions'] as const).map((value) => (
          <Chip key={value} selected={scope === value} onClick={() => setScope(value)} data-testid={`scope-${value}`}>
            {t(`projects.filter.scope.${value}`)}
          </Chip>
        ))}
      </div>
      {stacks.length > 1 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3.5">
          <span className="text-sm text-fg-muted">{t('projects.filter.stack')}</span>
          <div className="flex flex-wrap gap-2">
            {stacks.map(([label, count]) => (
              <Chip key={label} selected={stack === label} onClick={() => setStack(stack === label ? null : label)} data-testid={`stack-${label}`}>
                {label}
                <span className="ml-1.5 text-xs opacity-70 tabular-nums">{count}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );

  const search = (
    <Input
      ref={searchRef}
      size="sm"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setQuery('');
        if (event.key === 'Enter' && rows[0] && searching) void open(rows[0], lastTargets[rows[0].id] ?? 'editor');
      }}
      placeholder={t('projects.page.searchShort')}
      aria-label={t('projects.page.searchProjects')}
      leading={<MagnifyingGlass />}
      trailing={query ? <KeyHint keys={['Enter']} size="sm" /> : <KeyHint keys={['Ctrl', 'F']} size="sm" />}
      frameClassName="prj-search"
    />
  );

  return (
    <>
      <WorkspaceGrid
        asideWidth={288}
        aside={
          <>
            {filterPanel}
            {indexPanel}
          </>
        }
      >
        {projects === null ? (
          <>
            <Skeleton className="h-56 w-full rounded-lg" />
            <Skeleton className="h-80 w-full rounded-md" />
          </>
        ) : empty ? (
          <Panel tone="lead" padding="none" className="prj-empty" data-testid="projects-empty">
            <div className="prj-empty-grid">
              <div className="flex flex-col items-start gap-5 px-7 py-8">
                <div className="flex max-w-[56ch] flex-col gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-fg">{t('projects.page.emptyTitle')}</h2>
                  <p className="text-base text-fg-muted">{t('projects.page.emptyBody')}</p>
                </div>
                <Button variant="primary" icon={<ArrowsClockwise />} loading={scanning} onClick={() => void rescan()}>
                  {t('projects.page.rescan')}
                </Button>
                <p className="mt-auto border-t border-line pt-4 text-sm text-fg-muted">{t('projects.page.emptyHint')}</p>
              </div>
              <SayExamples title={t('projects.say.title')} keys={['projects.say.open', 'projects.say.find', 'projects.say.start']} />
            </div>
          </Panel>
        ) : (
          <>
            {!searching && !filtered && recent.length > 0 && (
              <Panel tone="lead" padding="none" title={t('projects.page.recent')} className="prj-recent" data-testid="projects-recent">
                <div role="list" className="prj-cells">
                  {recent.map(renderCell)}
                </div>
              </Panel>
            )}

            <Panel
              padding="none"
              title={searching ? t('projects.page.results') : t('projects.page.all')}
              count={rows.length}
              action={search}
              className="prj-table"
              data-testid="projects-table"
            >
              {/* Dar kapta bağlam sütunu tablonun altına iner: süzgeçler burada, tablonun başında durur. */}
              <div className="prj-narrow-filters" role="group" aria-label={t('projects.filter.scope')}>
                {(['all', 'pinned', 'sessions'] as const).map((value) => (
                  <Chip key={value} selected={scope === value} onClick={() => setScope(value)}>
                    {t(`projects.filter.scope.${value}`)}
                  </Chip>
                ))}
                {stacks.length > 1 &&
                  stacks.map(([label, count]) => (
                    <Chip key={label} selected={stack === label} onClick={() => setStack(stack === label ? null : label)}>
                      {label}
                      <span className="ml-1.5 text-xs opacity-70 tabular-nums">{count}</span>
                    </Chip>
                  ))}
              </div>
              {rows.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={<MagnifyingGlass />}
                  title={searching ? t('projects.page.noMatch', { query: query.trim() }) : t('projects.page.noFiltered')}
                  description={searching ? t('projects.page.noMatchHint') : t('projects.page.noFilteredHint')}
                />
              ) : (
                <div className="px-2 pt-2 pb-2">
                  <div className="prj-head" role="row">
                    {sortButton('name', t('projects.col.name'))}
                    <span className="prj-col-stack" role="columnheader">
                      {t('projects.col.stack')}
                    </span>
                    <span className="prj-col-branch" role="columnheader">
                      {t('projects.col.branch')}
                    </span>
                    {sortButton('recent', t('projects.col.recent'))}
                    {sortButton('sessions', t('projects.col.sessions'), 'prj-col-count')}
                    <span className="prj-col-path" role="columnheader">
                      {t('projects.col.path')}
                    </span>
                    <span />
                  </div>
                  <div role="list" className="flex flex-col gap-0.5">
                    {rows.map(renderRow)}
                  </div>
                </div>
              )}
            </Panel>
          </>
        )}
      </WorkspaceGrid>
      <EditProjectDialog project={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
    </>
  );
}

/** Boş hücre: değer yok. Yazı yerine soluk bir işaret; sütun hizası bozulmaz. */
function Empty() {
  return (
    <span className="text-fg-faint" aria-label={t('projects.col.none')}>
      -
    </span>
  );
}

function EditProjectDialog({ project, onClose, onSaved }: { project: ProjectDetail | null; onClose(): void; onSaved(): void }) {
  const [aliases, setAliases] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setAliases(project.aliases.join(', '));
    setCategory(project.category ?? '');
    setNote(project.description);
    setError(null);
  }, [project]);

  const save = async () => {
    if (!project) return;
    setSaving(true);
    try {
      await fuber().invoke('projects.setAliases', { id: project.id, aliases: aliases.split(',') });
      await fuber().invoke('projects.update', { id: project.id, patch: { category: category.trim() || null, description: note } });
      onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(open) => !open && onClose()}
      title={project ? t('projects.page.editTitle', { name: project.name }) : ''}
      description={t('projects.page.editHint')}
      footer={
        <>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {t('projects.page.save')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('projects.page.cancel')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('projects.page.aliases')} hint={t('projects.page.aliasesHint')}>
          <Input value={aliases} onChange={(event) => setAliases(event.target.value)} />
        </Field>
        <Field label={t('projects.page.category')}>
          <Input value={category} onChange={(event) => setCategory(event.target.value)} />
        </Field>
        <Field label={t('projects.page.note')} error={error ?? undefined}>
          <Textarea value={note} minRows={2} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
