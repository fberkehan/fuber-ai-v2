// Canlı döküm (v1 `Dokum.tsx` + `Kartlar.tsx`): kullanıcı iletisi, akan asistan metni, düşünme göstergesi, araç kartları,
// alt ajan (iç içe), yapılacaklar, sistem satırları, sonuç satırı. Sanallaştırma yok: en çok son `WINDOW` üst düzey öğe çizilir,
// öncekiler "öncekileri göster" ile açılır.
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@fuber/shared';
import { Badge, Spinner, cn } from '@fuber/ui';
import {
  ArrowsClockwise,
  CaretRight,
  CheckCircle,
  Circle,
  CircleNotch,
  Globe,
  ListChecks,
  MagnifyingGlass,
  PencilSimpleLine,
  Plugs,
  Prohibit,
  Robot,
  TerminalWindow,
  WarningCircle,
  Wrench,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { TodoItem, ToolKind } from '../../../../../main/modules/projects/claude/types';
import { Markdown } from '../../chat/markdown';
import { fuber } from '../shared';
import { FoldedText } from './controls';
import { toolDiff, diffCounts } from './diff';
import { DiffView } from './DiffView';
import { formatClock, formatCost, formatDuration, inputText, modeLabel, relativePath, toolLabel } from './format';
import '../projects.css';
import {
  foldItems,
  foldStats,
  type FoldedGroup,
  type PermissionDecision,
  type ResultItem,
  type SubagentItem,
  type TodosItem,
  type ToolItem,
  type ToolState,
  type TranscriptItem,
  type VisibleItem,
} from './model';

const WINDOW = 300;
const openLink = (url: string) => void fuber().invoke('app.openExternal', { url }).catch(() => {});

const KIND_ICON: Record<ToolKind, Icon> = {
  read: MagnifyingGlass,
  edit: PencilSimpleLine,
  shell: TerminalWindow,
  search: MagnifyingGlass,
  subagent: Robot,
  todos: ListChecks,
  web: Globe,
  mcp: Plugs,
  question: Wrench,
  plan: ListChecks,
  other: Wrench,
};

function StateIcon({ state }: { state: ToolState }) {
  if (state === 'running') return <Spinner size={16} aria-label={t('projects.live.tool.running')} />;
  if (state === 'done') return <CheckCircle weight="fill" className="size-4 text-success" aria-label={t('projects.live.tool.done')} />;
  if (state === 'error') return <XCircle weight="fill" className="size-4 text-danger" aria-label={t('projects.live.tool.failed')} />;
  return <Prohibit className="size-4 text-fg-faint" aria-label={t('projects.live.tool.interrupted')} />;
}

function DecisionBadge({ decision }: { decision: PermissionDecision }) {
  const tone = decision === 'deny' ? 'danger' : decision === 'cancelled' ? 'neutral' : 'success';
  return (
    <Badge size="sm" tone={tone}>
      {t(`projects.live.decision.${decision}`)}
    </Badge>
  );
}

function Fields({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs" data-selectable>
      {entries.slice(0, 20).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-fg-faint">{key}</dt>
          <dd className="min-w-0 font-mono break-words whitespace-pre-wrap text-fg-muted">
            {typeof value === 'string' ? (value.length > 2000 ? `${value.slice(0, 2000)}…` : value) : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** İzin bekleyen araç kimlikleri: bu araçların ayrıntısı (fark, komut) yalnız izin kartında görünür, dökümde yinelenmez. */
const WaitingTools = createContext<ReadonlySet<string>>(new Set());

const ToolCard = memo(function ToolCard({ item, cwd, nested }: { item: ToolItem; cwd: string; nested?: boolean }) {
  const waiting = useContext(WaitingTools).has(item.id) && !item.decision;
  const diff = useMemo(() => (item.toolKind === 'edit' ? toolDiff(item.name, item.input, item.output) : null), [item.toolKind, item.name, item.input, item.output]);
  const [choice, setChoice] = useState(item.toolKind === 'edit' || item.state === 'error');
  // İzin beklerken satır kapalı açılır (ayrıntı izin kartında); kullanıcı isterse yine açabilir.
  const [peek, setPeek] = useState(false);
  const open = waiting ? peek : choice;
  const setOpen = (value: boolean) => (waiting ? setPeek(value) : setChoice(value));
  const KindIcon = KIND_ICON[item.toolKind];
  const pathLike = item.toolKind === 'read' || item.toolKind === 'edit';
  const summary = pathLike ? relativePath(item.summary, cwd) : item.summary;
  const counts = diff ? diffCounts(diff.lines) : null;
  const command = item.toolKind === 'shell' ? inputText(item.input, 'command') : '';
  return (
    <article data-kind="tool" data-tool={item.name} data-state={item.state} className="rounded-sm">
      <button
        type="button"
        aria-expanded={open}
        data-waiting={waiting || undefined}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-offset-[-2px] transition-colors duration-(--duration-fast) hover:bg-surface-2',
          (open || waiting) && 'bg-surface-2',
        )}
      >
        <CaretRight aria-hidden weight="bold" className={cn('size-3 shrink-0 text-fg-faint transition-transform duration-(--duration-fast)', open && 'rotate-90')} />
        <KindIcon aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <span className="shrink-0 font-medium text-fg">{toolLabel(item.name)}</span>
        <span className={cn('min-w-0 flex-1 truncate text-fg-muted', (pathLike || item.toolKind === 'shell') && 'font-mono text-xs')} data-selectable>
          {summary}
        </span>
        {counts && (counts.added > 0 || counts.removed > 0) && (
          <span className="shrink-0 font-mono text-xs tabular-nums">
            <span className="text-success">+{counts.added}</span> <span className="text-danger">−{counts.removed}</span>
          </span>
        )}
        {item.decision && <DecisionBadge decision={item.decision} />}
        {waiting ? (
          <Badge size="sm" tone="warning">
            {t('projects.live.tool.waiting')}
          </Badge>
        ) : (
          <StateIcon state={item.state} />
        )}
      </button>
      {open && (
        <div className="mt-1 ml-[18px] flex flex-col gap-2 border-l border-line py-1 pl-3.5">
          {diff ? (
            <DiffView lines={diff.lines} />
          ) : command ? (
            <pre data-selectable className="overflow-auto rounded-sm bg-surface-2 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-fg">
              {command}
            </pre>
          ) : (
            <Fields input={item.input} />
          )}
          {item.inputTruncated && <p className="text-xs text-fg-faint">{t('projects.live.tool.inputTruncated')}</p>}
          {item.output !== undefined && item.output !== '' && !(diff && item.state === 'done') && (
            <FoldedText text={item.output} tone={item.state === 'error' ? 'error' : 'normal'} />
          )}
          {item.truncated && <p className="text-xs text-fg-faint">{t('projects.live.tool.outputTruncated')}</p>}
        </div>
      )}
    </article>
  );
});

const SubagentCard = memo(function SubagentCard({ item, cwd }: { item: SubagentItem; cwd: string }) {
  // Süren alt ajan açık görünür; biten kapanır (gövdesi tıklayınca açılır).
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? item.state === 'running';
  const steps = item.children.filter((child) => child.kind === 'tool' || child.kind === 'subagent').length;
  return (
    <article data-kind="subagent" data-state={item.state} className="rounded-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setChoice(!open)}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-offset-[-2px] transition-colors duration-(--duration-fast) hover:bg-surface-2',
          open && 'bg-surface-2',
        )}
      >
        <CaretRight aria-hidden weight="bold" className={cn('size-3 shrink-0 text-fg-faint transition-transform duration-(--duration-fast)', open && 'rotate-90')} />
        <Robot aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <span className="shrink-0 font-medium text-fg">{item.agentType ? t('projects.live.subagent.typed', { type: item.agentType }) : t('projects.live.subagent.title')}</span>
        <span className="min-w-0 flex-1 truncate text-fg-muted">{item.description}</span>
        {steps > 0 && <span className="shrink-0 text-xs text-fg-faint tabular-nums">{t('projects.live.subagent.steps', { n: steps })}</span>}
        <StateIcon state={item.state} />
      </button>
      {open && (
        <div className="mt-1 ml-[18px] flex flex-col gap-2 border-l border-line py-1 pl-3.5">
          {item.prompt && <FoldedText text={item.prompt} limit={4} />}
          {item.children.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {item.children.map((child) => (
                <ItemView key={child.key} item={child} cwd={cwd} nested />
              ))}
            </div>
          )}
          {item.output && <FoldedText text={item.output} tone={item.state === 'error' ? 'error' : 'normal'} />}
        </div>
      )}
    </article>
  );
});

export function TodoList({ items }: { items: readonly TodoItem[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((item, index) => (
        <li key={item.taskId ?? index} data-todo={item.status} className="flex items-start gap-2">
          {item.status === 'done' ? (
            <CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-success" aria-label={t('projects.live.todo.done')} />
          ) : item.status === 'in_progress' ? (
            <CircleNotch weight="bold" className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-label={t('projects.live.todo.inProgress')} />
          ) : (
            <Circle className="mt-0.5 size-4 shrink-0 text-fg-faint" aria-label={t('projects.live.todo.pending')} />
          )}
          <span className={cn('min-w-0 break-words', item.status === 'done' ? 'text-fg-faint line-through' : item.status === 'in_progress' ? 'text-fg' : 'text-fg-muted')}>
            {item.status === 'in_progress' && item.activeForm ? item.activeForm : item.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

const TodosCard = memo(function TodosCard({ item }: { item: TodosItem }) {
  const done = item.items.filter((todo) => todo.status === 'done').length;
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? !item.stale;
  return (
    <article data-kind="todos" className="rounded-sm">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen(!shown)}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-offset-[-2px] transition-colors duration-(--duration-fast) hover:bg-surface-2',
          shown && 'bg-surface-2',
        )}
      >
        <CaretRight aria-hidden weight="bold" className={cn('size-3 shrink-0 text-fg-faint transition-transform duration-(--duration-fast)', shown && 'rotate-90')} />
        <ListChecks aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <span className="font-medium text-fg">{t('projects.live.todo.title')}</span>
        <span className="ml-auto text-xs text-fg-faint tabular-nums">{t('projects.live.todo.progress', { done, total: item.items.length })}</span>
      </button>
      {shown && (
        <div className="mt-1 ml-[18px] border-l border-line py-1 pl-3.5">
          <TodoList items={item.items} />
        </div>
      )}
    </article>
  );
});

function ResultLine({ item }: { item: ResultItem }) {
  const { result } = item;
  const background = item.background > 0;
  const parts = [formatDuration(result.durationMs), result.turns ? t('projects.live.result.turns', { n: result.turns }) : '', result.showCost && result.costUsd > 0 ? formatCost(result.costUsd) : ''].filter(Boolean);
  const title = result.interrupted
    ? t('projects.live.result.interrupted')
    : !result.ok
      ? t('projects.live.result.failed')
      : background
        ? t('projects.live.result.background', { n: item.background })
        : t('projects.live.result.done');
  return (
    <div data-kind="result" data-ok={result.ok} className="flex flex-col gap-1">
      <div className="flex items-center gap-3 text-xs text-fg-faint">
        <span className="h-px flex-1 bg-line" aria-hidden />
        <span className={cn('font-medium', result.interrupted ? 'text-fg-muted' : !result.ok ? 'text-danger' : background ? 'text-accent-fg' : 'text-success')}>{title}</span>
        <span className="tabular-nums">{parts.join(', ')}</span>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>
      {result.error && !result.errorShown && !result.interrupted && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger" data-selectable>
          <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" />
          {result.error}
        </p>
      )}
    </div>
  );
}

const FoldedRow = memo(function FoldedRow({ group, cwd }: { group: FoldedGroup; cwd: string }) {
  const [open, setOpen] = useState(false);
  const stats = foldStats(group);
  const parts = [
    group.variety === 'subagent' ? t('projects.live.fold.agents', { n: stats.count }) : '',
    stats.steps ? t('projects.live.fold.steps', { n: stats.steps }) : '',
    formatDuration(stats.durationMs),
    stats.failed ? t('projects.live.fold.failed', { n: stats.failed }) : '',
  ].filter(Boolean);
  return (
    <div data-kind="tool" data-folded={group.items.length} className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2 self-start rounded-sm px-2 py-1 text-xs text-fg-muted hover:bg-surface-2">
        <CaretRight aria-hidden weight="bold" className={cn('size-3 text-fg-faint transition-transform duration-(--duration-fast)', open && 'rotate-90')} />
        {stats.failed ? <WarningCircle weight="fill" className="size-3.5 text-warning" aria-hidden /> : <CheckCircle weight="fill" className="size-3.5 text-success" aria-hidden />}
        <span className="tabular-nums">{parts.join(', ')}</span>
      </button>
      {open && group.items.map((item) => <ItemView key={item.key} item={item} cwd={cwd} />)}
    </div>
  );
});

const ItemView = memo(function ItemView({ item, cwd, nested }: { item: TranscriptItem; cwd: string; nested?: boolean }): ReactNode {
  switch (item.kind) {
    case 'user':
      return (
        // Sohbet sayfasıyla aynı aile: kullanıcı iletisi sağda gümüş balon.
        <article data-kind="user" className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
          {item.text && (
            <p className="cc-me rounded-md rounded-br-xs px-4 py-2.5 text-base font-medium [overflow-wrap:anywhere] whitespace-pre-wrap" data-selectable>
              {item.text}
            </p>
          )}
          <span className="flex items-center gap-2 text-xs text-fg-faint">
            <span className="font-medium text-fg-muted">{t('projects.page.you')}</span>
            {item.images > 0 && <span>{t('projects.live.images', { n: item.images })}</span>}
          </span>
        </article>
      );
    case 'text':
      return (
        <article
          data-kind="text"
          data-streaming={item.streaming || undefined}
          className={cn('min-w-0', !nested && 'cc-assistant rounded-md rounded-tl-xs px-4 py-3.5')}
        >
          <Markdown text={item.text} onLink={openLink} className={cn('text-sm [overflow-wrap:anywhere]', nested && 'text-fg-muted')} />
        </article>
      );
    case 'thinking':
      return (
        <div data-kind="system" data-thinking className="flex items-center gap-2 text-xs text-fg-faint">
          <Spinner size={16} />
          {t('projects.live.thinking')}
        </div>
      );
    case 'tool':
      return <ToolCard item={item} cwd={cwd} {...(nested ? { nested } : {})} />;
    case 'subagent':
      return <SubagentCard item={item} cwd={cwd} />;
    case 'todos':
      return <TodosCard item={item} />;
    case 'permission':
      // Yalnız yanıtlanmış ve kendi araç kartı olmayan istek satır olarak görünür (bekleyenler yazma kutusunun üstündedir).
      return (
        <div data-kind="system" data-permission={item.decision} className="flex items-center gap-2 text-xs text-fg-faint">
          <span className="truncate">{t('projects.live.permission.resolvedLine', { tool: toolLabel(item.request.tool), summary: item.request.summary })}</span>
          {item.decision && <DecisionBadge decision={item.decision} />}
        </div>
      );
    case 'result':
      return <ResultLine item={item} />;
    case 'system':
      return (
        <div data-kind="system" data-level={item.level} className={cn('flex flex-col gap-1 text-xs', item.level === 'error' ? 'text-danger' : item.level === 'warn' ? 'text-warning' : 'text-fg-faint')}>
          <p className="flex items-start gap-2" data-selectable>
            {item.level !== 'info' && <WarningCircle weight="fill" className="mt-px size-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0 break-words">{item.text}</span>
          </p>
          {item.detail && <FoldedText text={item.detail} limit={3} />}
        </div>
      );
    case 'note':
      return (
        <div data-kind="system" data-note={item.note} className="flex items-center gap-2 text-xs text-fg-faint">
          <ArrowsClockwise className="size-3.5" aria-hidden />
          {item.note === 'mode'
            ? t('projects.live.note.mode', { mode: modeLabel(item.value) })
            : t('projects.live.note.model', { model: item.value === 'default' ? t('projects.live.model.default') : item.value })}
        </div>
      );
    case 'limit':
      return (
        <div data-kind="system" data-level="warn" data-limit className="flex items-start gap-2 text-xs text-warning">
          <WarningCircle weight="fill" className="mt-px size-3.5 shrink-0" aria-hidden />
          {item.resetsAt ? t('projects.live.limit.resets', { when: formatClock(item.resetsAt) }) : t('projects.live.limit.reached')}
        </div>
      );
  }
});

const NO_WAITING: ReadonlySet<string> = new Set();

export function Transcript({
  items,
  version,
  cwd,
  sessionId,
  empty,
  header,
  headerKey,
  waiting,
}: {
  /** İzin bekleyen araç kimlikleri (ayrıntıları izin kartında). */
  waiting?: ReadonlySet<string>;
  items: readonly TranscriptItem[];
  version: number;
  cwd: string;
  sessionId: string;
  empty?: ReactNode;
  /** Dökümün üstünde gösterilen bölüm (dizindeki önceki konuşma). */
  header?: ReactNode;
  /** `header` içeriği değiştikçe değişir: üstte büyüyen içerik okunan yeri kaydırmasın. */
  headerKey?: string | number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const fromBottom = useRef(0);
  const [showAll, setShowAll] = useState(false);
  const visible = useMemo<VisibleItem[]>(() => foldItems(items), [items]);
  const shown = showAll || visible.length <= WINDOW ? visible : visible.slice(visible.length - WINDOW);
  const hidden = visible.length - shown.length;

  useEffect(() => {
    stick.current = true;
    setShowAll(false);
  }, [sessionId]);

  // Kullanıcı en alttaysa yeni içerikle birlikte altta kalınır; yukarı kaydırdıysa yeri korunur.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [version, sessionId]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = stick.current ? element.scrollHeight : element.scrollHeight - fromBottom.current;
  }, [headerKey]);

  return (
    <div
      ref={scrollRef}
      data-testid="live-transcript"
      role="log"
      aria-label={t('projects.live.transcript')}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        fromBottom.current = element.scrollHeight - element.scrollTop;
      }}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4"
    >
      {header && <div className="mx-auto mb-3 flex max-w-3xl flex-col">{header}</div>}
      {visible.length === 0 ? (
        empty
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {hidden > 0 && (
            <button type="button" className="self-center text-xs text-accent-fg hover:underline" onClick={() => setShowAll(true)}>
              {t('projects.live.earlier', { n: hidden })}
            </button>
          )}
          <WaitingTools.Provider value={waiting ?? NO_WAITING}>
            {shown.map((item) => (item.kind === 'folded' ? <FoldedRow key={item.key} group={item} cwd={cwd} /> : <ItemView key={item.key} item={item} cwd={cwd} />))}
          </WaitingTools.Provider>
        </div>
      )}
    </div>
  );
}
