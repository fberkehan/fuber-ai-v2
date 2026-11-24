import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { relativeDateTime, t } from '@fuber/shared';
import { Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Menu, Skeleton, type MenuItem } from '@fuber/ui';
import {
  Archive,
  ArrowLeft,
  ArrowUUpLeft,
  Check,
  DotsThree,
  CheckCircle,
  GitBranch,
  PencilSimple,
  PushPin,
  PushPinSlash,
  Tag,
  TerminalWindow,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { LiveImage, LiveOpResult, LiveSessionSummary } from '../../../../main/modules/projects/claude/types';
import type { SessionMessage, SessionRow } from '../../../../main/modules/projects/types';
import { clearDraft, Composer } from './live/Composer';
import { formatDuration } from './live/format';
import { StartPrompts, useStarter } from './live/start';
import { errorText, fuber, highlight, MiddlePath } from './shared';
import './projects.css';

const PAGE = 60;

interface Page {
  total: number;
  offset: number;
  messages: SessionMessage[];
}

export function SessionPreview({
  session,
  matchSeq,
  query,
  categories,
  onChanged,
  onArchived,
  onResumed,
  onBack,
}: {
  session: SessionRow;
  matchSeq: number | null;
  query: string;
  categories: string[];
  onChanged(session: SessionRow): void;
  onArchived(): void;
  /** Bu oturum uygulama içinde sürdürüldü: sayfa canlı görünüme geçer. */
  onResumed?(session: LiveSessionSummary): void;
  /** Dar kapta (bölmeler sırayla açılırken) listeye dönüş. */
  onBack?(): void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dialog, setDialog] = useState<'rename' | 'category' | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollTarget = useRef<'match' | 'bottom' | 'keep' | null>(null);
  const draftKey = `preview:${session.id}`;
  const starter = useStarter((live) => {
    clearDraft(draftKey);
    onResumed?.(live);
  });
  // Geçmiş oturuma yazmak onu uygulama içinde sürdürür (`claude --resume`); klasör güveni ya da "başka yerde açık" kararı
  // gerekiyorsa kart kutunun üstünde çıkar ve ileti kutuda kalır.
  const resume = async (text: string, images: LiveImage[]): Promise<LiveOpResult> => {
    const result = await starter.start({ resume: session.id, cwd: session.cwd, prompt: text, ...(images.length ? { images } : {}) });
    return result?.ok ? { ok: true } : { ok: false };
  };

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setError(null);
    scrollTarget.current = matchSeq !== null ? 'match' : 'bottom';
    fuber()
      .invoke('projects.sessionMessages', { id: session.id, limit: PAGE, ...(matchSeq !== null ? { around: matchSeq } : {}) })
      .then((next) => !cancelled && setPage(next))
      .catch((cause) => !cancelled && setError(errorText(cause)));
    return () => {
      cancelled = true;
    };
  }, [session.id, matchSeq]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !page || !scrollTarget.current) return;
    if (scrollTarget.current === 'match' && matchSeq !== null) {
      element.querySelector<HTMLElement>(`[data-seq="${matchSeq}"]`)?.scrollIntoView({ block: 'center' });
    } else if (scrollTarget.current === 'bottom') {
      element.scrollTop = element.scrollHeight;
    }
    scrollTarget.current = null;
  }, [page, matchSeq]);

  const loadMore = async (direction: 'before' | 'after') => {
    if (!page) return;
    const offset = direction === 'before' ? Math.max(0, page.offset - PAGE) : page.offset + page.messages.length;
    const limit = direction === 'before' ? page.offset - offset : PAGE;
    if (limit <= 0) return;
    const element = scrollRef.current;
    const fromBottom = element ? element.scrollHeight - element.scrollTop : 0;
    const next = await fuber().invoke('projects.sessionMessages', { id: session.id, offset, limit });
    setPage((current) =>
      current
        ? direction === 'before'
          ? { total: next.total, offset: next.offset, messages: [...next.messages, ...current.messages] }
          : { total: next.total, offset: current.offset, messages: [...current.messages, ...next.messages] }
        : next,
    );
    if (direction === 'before') {
      // Öne eklenen iletiler okunan yeri kaydırmasın.
      requestAnimationFrame(() => {
        if (element) element.scrollTop = element.scrollHeight - fromBottom;
      });
    }
  };

  const update = async (patch: { pinned?: boolean; category?: string | null; title?: string }) => {
    try {
      // Ana süreç `SessionRow` döndürür (sözleşmedeki `CodeSession` + arşiv ve proje adı).
      onChanged((await fuber().invoke('projects.updateSession', { id: session.id, patch })) as SessionRow);
    } catch (cause) {
      setResult({ ok: false, message: errorText(cause) });
    }
  };

  const archive = async () => {
    try {
      await fuber().invoke('projects.archiveSession', { id: session.id, archived: !session.archived });
      onArchived();
    } catch (cause) {
      setResult({ ok: false, message: errorText(cause) });
    }
  };

  const openInTerminal = async () => {
    setOpening(true);
    setResult(null);
    try {
      setResult(await fuber().invoke('projects.openSession', { id: session.id }));
    } catch (cause) {
      setResult({ ok: false, message: errorText(cause) });
    } finally {
      setOpening(false);
    }
  };

  const categoryItems: MenuItem[] = [
    ...categories.map((name) => ({
      id: `c:${name}`,
      label: name,
      icon: name === session.category ? <Check /> : <span className="size-4" />,
      onSelect: () => void update({ category: name === session.category ? null : name }),
    })),
    ...(categories.length ? [{ type: 'separator' as const, id: 'sep' }] : []),
    {
      id: 'new',
      label: t('projects.page.newCategory'),
      icon: <Tag />,
      onSelect: () => {
        setDraft('');
        setDialog('category');
      },
    },
    ...(session.category ? [{ id: 'clear', label: t('projects.page.clearCategory'), icon: <X />, onSelect: () => void update({ category: null }) }] : []),
  ];

  const before = page ? page.offset : 0;
  const after = page ? page.total - page.offset - page.messages.length : 0;

  const pinLabel = session.pinned ? t('projects.page.unpin') : t('projects.page.pin');
  const archiveLabel = session.archived ? t('projects.page.unarchive') : t('projects.page.archive');
  const rename = () => {
    setDraft(session.title);
    setDialog('rename');
  };
  const duration = Math.max(0, Date.parse(session.lastAt) - Date.parse(session.startedAt));

  return (
    <>
      <div className="ses-detail" data-testid="session-preview">
        <header className="flex shrink-0 flex-col gap-2.5 border-b border-line px-6 py-3.5">
          <div className="flex items-center gap-3">
            {onBack && (
              <IconButton size="sm" className="ses-back -ml-2 shrink-0" label={t('projects.live.back')} icon={<ArrowLeft />} onClick={onBack} data-testid="session-back" />
            )}
            {/* Ad ve altındaki bilgi tek öbek: geniş bölmede yan yana (tek satır), sığmazsa bilgi alta sarar. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3.5 gap-y-1.5">
              <h2 className="min-w-0 text-xl leading-snug font-semibold tracking-tight text-pretty text-fg" data-selectable>
                {session.title}
              </h2>
          {/* Üçüncü bölme yokken (dar kap) oturum bilgisi ve eylemler başlıkta, sıkışık hâlde durur. */}
              <div className="ses-inline ses-head-meta flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-fg-muted">
                {session.projectName && <Badge>{session.projectName}</Badge>}
                {session.category && (
                  <Badge tone="accent" icon={<Tag />}>
                    {session.category}
                  </Badge>
                )}
                {session.gitBranch && (
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-fg-faint">
                    <GitBranch className="size-3.5" aria-hidden />
                    {session.gitBranch}
                  </span>
                )}
                <span className="text-fg-faint tabular-nums">{relativeDateTime(session.lastAt)}</span>
                <span className="text-fg-faint tabular-nums">{t('projects.page.messageCount', { count: session.messageCount })}</span>
              </div>
            </div>
            <Button variant="secondary" size="sm" icon={<TerminalWindow />} loading={opening} onClick={() => void openInTerminal()} data-testid="session-terminal">
              {t('projects.page.openInTerminal')}
            </Button>
            {/* Üçüncü bölme yokken eylemler tek menüde toplanır (dört çıplak ikon yerine). */}
            <span className="ses-inline">
              <Menu
                placement="bottom-end"
                label={t('projects.page.more')}
                trigger={<IconButton size="sm" label={t('projects.page.more')} icon={<DotsThree weight="bold" />} tooltip={false} data-testid="session-more" />}
                items={[
                  { id: 'pin', label: pinLabel, icon: session.pinned ? <PushPinSlash /> : <PushPin />, onSelect: () => void update({ pinned: !session.pinned }) },
                  { id: 'rename', label: t('projects.page.rename'), icon: <PencilSimple />, onSelect: rename },
                  { id: 'archive', label: archiveLabel, icon: session.archived ? <ArrowUUpLeft /> : <Archive />, onSelect: () => void archive() },
                  { type: 'separator', id: 'sep-category' },
                  { type: 'label', id: 'category-label', label: t('projects.page.category') },
                  ...categoryItems,
                ]}
              />
            </span>
          </div>
          {result && (
            <p role="status" className={`flex items-center gap-2 text-sm ${result.ok ? 'text-success' : 'text-danger'}`}>
              {result.ok ? <CheckCircle weight="fill" className="size-4 shrink-0" /> : <WarningCircle weight="fill" className="size-4 shrink-0" />}
              <span data-selectable>{result.message}</span>
            </p>
          )}
        </header>

        <div ref={scrollRef} className="ses-scroll ui-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {error ? (
            <EmptyState size="sm" icon={<WarningCircle />} title={t('projects.page.loadFailed')} description={error} />
          ) : !page ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              <Skeleton className="ml-auto h-11 w-3/5 rounded-md" />
              <Skeleton className="h-24 w-4/5 rounded-md" />
              <Skeleton className="h-16 w-3/4 rounded-md" />
            </div>
          ) : page.messages.length === 0 ? (
            <EmptyState size="sm" title={t('projects.page.noMessages')} description={t('projects.page.noMessagesHint')} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-3.5">
              {before > 0 && (
                <Button variant="ghost" size="sm" className="self-center" onClick={() => void loadMore('before')}>
                  {t('projects.page.earlier', { count: before })}
                </Button>
              )}
              {groupMessages(page.messages).map((group) => (
                <MessageGroup key={group[0]!.seq} messages={group} query={query} matchSeq={matchSeq} />
              ))}
              {after > 0 && (
                <Button variant="ghost" size="sm" className="self-center" onClick={() => void loadMore('after')}>
                  {t('projects.page.later', { count: after })}
                </Button>
              )}
            </div>
          )}
        </div>

        {onResumed && (
          <div className="flex shrink-0 flex-col">
            {(starter.trust || starter.error || starter.elsewhere) && (
              <div className="flex flex-col gap-2 border-t border-line px-6 pt-3">
                <StartPrompts starter={starter} />
              </div>
            )}
            <Composer
              draftKey={draftKey}
              compact
              column
              onSend={resume}
              disabled={starter.pending}
              placeholder={t('projects.live.composer.placeholderHistory')}
              inputTestId="preview-composer-input"
              sendTestId="preview-send"
            />
          </div>
        )}
      </div>

      {/* Üçüncü bölme (geniş kap): oturum bilgisi ve eylemler, etiketleriyle. */}
      <aside className="ses-info ui-scroll overflow-y-auto" aria-label={t('projects.info.title')} data-testid="session-info">
        <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
          <h3 className="text-sm font-medium text-fg-muted">{t('projects.info.title')}</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5 text-sm">
            <InfoRow label={t('projects.info.project')}>{session.projectName ?? t('projects.info.noProject')}</InfoRow>
            {session.gitBranch && (
              <InfoRow label={t('projects.info.branch')}>
                <span className="font-mono text-xs">{session.gitBranch}</span>
              </InfoRow>
            )}
            <InfoRow label={t('projects.info.started')}>{relativeDateTime(session.startedAt)}</InfoRow>
            <InfoRow label={t('projects.info.last')}>{relativeDateTime(session.lastAt)}</InfoRow>
            <InfoRow label={t('projects.info.duration')}>{formatDuration(duration)}</InfoRow>
            <InfoRow label={t('projects.info.messages')}>{session.messageCount}</InfoRow>
            <InfoRow label={t('projects.info.folder')}>
              <MiddlePath path={session.cwd} />
            </InfoRow>
          </dl>
          <div className="flex flex-wrap items-center gap-1.5">
            {session.pinned && (
              <Badge icon={<PushPin weight="fill" />} tone="accent">
                {t('projects.page.pinnedLabel')}
              </Badge>
            )}
            {session.category && <Badge icon={<Tag />}>{session.category}</Badge>}
            {session.archived && <Badge icon={<Archive />}>{t('projects.info.archived')}</Badge>}
            {!session.pinned && !session.category && !session.archived && <span className="text-sm text-fg-faint">{t('projects.info.noTags')}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 border-t border-line p-2.5">
          <InfoAction icon={session.pinned ? <PushPinSlash /> : <PushPin />} onClick={() => void update({ pinned: !session.pinned })}>
            {pinLabel}
          </InfoAction>
          <Menu
            trigger={
              <InfoAction icon={<Tag />}>{session.category ? t('projects.info.changeCategory') : t('projects.info.addCategory')}</InfoAction>
            }
            items={categoryItems}
            placement="bottom-start"
          />
          <InfoAction icon={<PencilSimple />} onClick={rename}>
            {t('projects.page.rename')}
          </InfoAction>
          <InfoAction icon={session.archived ? <ArrowUUpLeft /> : <Archive />} onClick={() => void archive()}>
            {archiveLabel}
          </InfoAction>
        </div>
      </aside>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        size="sm"
        title={dialog === 'rename' ? t('projects.page.rename') : t('projects.page.newCategory')}
        footer={
          <>
            <Button
              variant="primary"
              onClick={() => {
                void update(dialog === 'rename' ? { title: draft } : { category: draft.trim() || null });
                setDialog(null);
              }}
            >
              {t('projects.page.save')}
            </Button>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t('projects.page.cancel')}
            </Button>
          </>
        }
      >
        <Field label={dialog === 'rename' ? t('projects.page.titleLabel') : t('projects.page.category')}>
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              void update(dialog === 'rename' ? { title: draft } : { category: draft.trim() || null });
              setDialog(null);
            }}
          />
        </Field>
      </Dialog>
    </>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 truncate text-fg tabular-nums" data-selectable>
        {children}
      </dd>
    </>
  );
}

/** Bilgi bölmesindeki etiketli eylem satırı (ikon + ad); menü tetikleyicisi de olabilir. */
function InfoAction({ icon, children, ...rest }: ComponentPropsWithRef<'button'> & { icon: ReactNode }) {
  return (
    <button
      type="button"
      className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-left text-sm text-fg-muted outline-offset-[-2px] transition-[background-color,color,transform] duration-(--duration-fast) ease-out hover:bg-surface-3 hover:text-fg active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0"
      {...rest}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Art arda gelen aynı kişinin iletileri tek öbek olur. */
function groupMessages(messages: SessionMessage[]): SessionMessage[][] {
  const groups: SessionMessage[][] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.role === message.role) last.push(message);
    else groups.push([message]);
  }
  return groups;
}

/**
 * İleti kapları Sohbet sayfasıyla aynı ailedendir: kullanıcı iletisi sağda gümüş balon, Claude'un yanıtı solda tam
 * genişlikte ince çizgili kart (canlı dökümle aynı biçim). Claude'un art arda gelen iletileri TEK kartta toplanır
 * (paragraflar arasında kıl payı çizgi): beş özdeş kutu alt alta dizilmez. İmza öbeğin sonunda bir kez yazar.
 * Eşleşen ileti (arama) "Eşleşme" rozeti alır; kart mavi kıl payı çerçeveyle işaretlenir.
 */
function MessageGroup({ messages, query, matchSeq }: { messages: SessionMessage[]; query: string; matchSeq: number | null }) {
  const first = messages[0]!;
  const last = messages[messages.length - 1]!;
  const isUser = first.role === 'user';
  const matched = messages.some((message) => message.seq === matchSeq);
  const text = (message: SessionMessage) => (query ? highlight(message.text, query) : message.text);
  const meta = (
    <span className="flex items-center gap-2 px-1 text-xs text-fg-faint tabular-nums">
      <span className="font-medium text-fg-muted">{isUser ? t('projects.page.you') : t('projects.page.claude')}</span>
      {last.at && <time>{relativeDateTime(last.at)}</time>}
      {matched && (
        <Badge size="sm" tone="accent">
          {t('projects.page.match')}
        </Badge>
      )}
    </span>
  );
  if (isUser) {
    return (
      <article data-role="user" className="flex flex-col items-end gap-1.5 self-end" style={{ maxWidth: '82%' }}>
        {messages.map((message) => (
          <p
            key={message.seq}
            data-seq={message.seq}
            className="cc-me rounded-md rounded-br-xs px-4 py-2.5 text-base font-medium [overflow-wrap:anywhere] whitespace-pre-wrap"
            data-selectable
          >
            {text(message)}
          </p>
        ))}
        {meta}
      </article>
    );
  }
  return (
    <article data-role="assistant" className="flex flex-col items-stretch gap-1.5">
      <div className="cc-assistant flex flex-col rounded-md rounded-tl-xs" data-matched={matched ? '' : undefined}>
        {messages.map((message, index) => (
          <p
            key={message.seq}
            data-seq={message.seq}
            className={`px-4 py-3 text-base [overflow-wrap:anywhere] whitespace-pre-wrap text-fg ${index > 0 ? 'border-t border-line' : ''}`}
            data-selectable
          >
            {text(message)}
          </p>
        ))}
      </div>
      {meta}
    </article>
  );
}
