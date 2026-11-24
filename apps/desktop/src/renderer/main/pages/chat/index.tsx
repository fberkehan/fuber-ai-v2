// Sohbet: üç bölmeli çalışma yüzeyi. Sahne (sohbet listesi + konuşma) sayfanın tek birincil kutusudur; sağda bağlam
// sütunu (konuşmanın künyesi, araç adımları, ekler, öğrenilenler). Dar kapta liste ve bağlam çekmeceye iner (`chat.css`).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import {
  Bell,
  Brain,
  ChatsCircle,
  Cpu,
  DotsThree,
  Info,
  ListChecks,
  MagnifyingGlass,
  Microphone,
  NotePencil,
  PencilSimple,
  SidebarSimple,
  Sun,
  Trash,
  X,
} from '@phosphor-icons/react';
import { daysBetween, localDay, relativeTime, t, type ChatMessage, type ChatSearchHit, type ChatSession, type Id } from '@fuber/shared';
import { Button, Core, Dialog, EmptyState, Field, IconButton, Input, Menu, Panel, Skeleton, Workspace, WorkspaceHeader, toast } from '@fuber/ui';
import { getLevelFrom, useShell } from '../../shell/context';
import { attempt, errorText, useLive } from '../../shell/live';
import { ConfirmDialog, ErrorPanel } from '../../shell/parts';
import { capitalize } from '../../shell/text';
import { definePage } from '../page';
import { Composer } from './composer';
import { ConversationContext, NewChatContext } from './context';
import { AssistantMessage, MessageEntry, StreamingMessage, UserBubble } from './messages';
import { chatStore, ensureChatSubscription } from './store';
import { DropOverlay, useAttachments, useDropZone } from './attachments';
import './chat.css';

ensureChatSubscription();

const HISTORY_LIMIT = 120;

/** Konuşma başlığı kısa olsun: ilk harf büyük, en çok ~48 karakter, kelime sınırında kesilir. */
function shortTitle(title: string): string {
  const clean = capitalize(title.trim());
  if (clean.length <= 48) return clean;
  const cut = clean.slice(0, 48);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[.,;:!?]+$/, '')}…`;
}

// ───────────── sohbet listesi ─────────────

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('[[') && part.endsWith(']]') ? (
          <strong key={index} className="font-semibold text-fg">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

type Bucket = 'today' | 'yesterday' | 'week' | 'older';
const BUCKETS: Bucket[] = ['today', 'yesterday', 'week', 'older'];

/** Sohbetleri son iletinin gününe göre kümeler (liste zaten yeniden eskiye sıralı gelir). */
function bucketOf(session: ChatSession, today: string): Bucket {
  const diff = daysBetween(localDay(session.lastAt), today);
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : diff < 7 ? 'week' : 'older';
}

function SessionRow({ session, active, onSelect }: { session: ChatSession; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="chat-session" aria-current={active ? 'true' : undefined} onClick={onSelect} data-testid="chat-session" data-channel={session.channel}>
      <span className="chat-session-title" title={session.title || undefined}>
        {capitalize(session.title || t('chat.untitled'))}
      </span>
      <span className="chat-session-meta" title={t('chat.sessionMeta', { when: relativeTime(session.lastAt), count: session.messageCount })}>
        {session.channel === 'voice' && <Microphone className="size-3 shrink-0" aria-label={t('chat.channel.voice')} />}
        <span className="truncate">{capitalize(relativeTime(session.lastAt))}</span>
      </span>
    </button>
  );
}

function SessionList({ activeId, open, onSelect, onClose }: { activeId: Id | null; open: boolean; onSelect: (id: Id) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 160);
    return () => window.clearTimeout(id);
  }, [query]);
  const sessions = useLive(() => window.fuber.invoke('chat.sessions', { limit: 80, ...(debounced ? { query: debounced } : {}) }), ['chat.changed'], [debounced]);
  const hits = useLive<ChatSearchHit[]>(
    () => (debounced.length >= 2 ? window.fuber.invoke('chat.search', { query: debounced, limit: 12 }) : Promise.resolve([])),
    [],
    [debounced],
  );
  const today = localDay();
  const groups = useMemo(() => {
    const list = sessions.data ?? [];
    return BUCKETS.map((bucket) => ({ bucket, items: list.filter((session) => bucketOf(session, today) === bucket) })).filter((group) => group.items.length > 0);
  }, [sessions.data, today]);

  return (
    <aside className="chat-list" data-open={open || undefined} data-testid="chat-sessions" aria-label={t('chat.sessions')}>
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-3 pb-1">
        <Input
          size="sm"
          leading={<MagnifyingGlass />}
          placeholder={t('chat.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('chat.searchPlaceholder')}
          data-testid="chat-search"
        />
        <span className="chat-list-toggle">
          <IconButton icon={<X />} label={t('common.close')} size="sm" onClick={onClose} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 pb-6 pl-3 [scrollbar-gutter:stable]">
        {sessions.state.status === 'loading' ? (
          <div className="flex flex-col gap-4 px-3 pt-3" aria-busy aria-label={t('common.loading')}>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-4/5 rounded-full" />
                <Skeleton className="h-3 w-2/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : sessions.state.status === 'error' ? (
          <ErrorPanel message={sessions.state.message} onRetry={sessions.reload} />
        ) : sessions.state.data.length === 0 && (hits.data ?? []).length === 0 ? (
          <div className="flex flex-col gap-1 px-3 pt-3">
            <p className="text-sm font-medium text-fg">{debounced ? t('chat.noResults') : t('chat.noSessions')}</p>
            <p className="text-sm text-fg-muted">{debounced ? t('chat.noResultsHint') : t('chat.noSessionsHint')}</p>
          </div>
        ) : (
          <>
            <div role="list" aria-label={t('chat.sessions')} className="flex flex-col gap-3">
              {groups.map((group) => (
                <div key={group.bucket} role="group" aria-label={t(`chat.group.${group.bucket}`)} className="flex flex-col gap-0.5">
                  {!debounced && <p className="px-3 pt-2 pb-1 text-xs font-medium text-fg-faint">{t(`chat.group.${group.bucket}`)}</p>}
                  {group.items.map((session) => (
                    <div role="listitem" key={session.id}>
                      <SessionRow session={session} active={session.id === activeId} onSelect={() => onSelect(session.id)} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {(hits.data ?? []).length > 0 && (
              <div className="mt-4 flex flex-col gap-0.5" data-testid="chat-hits">
                <p className="px-3 pt-2 pb-1 text-xs font-medium text-fg-faint">{t('chat.inMessages')}</p>
                {(hits.data ?? []).map((hit) => (
                  <button key={hit.message.id} type="button" onClick={() => onSelect(hit.message.sessionId)} className="chat-session">
                    <span className="truncate text-sm font-medium text-fg">{capitalize(hit.sessionTitle)}</span>
                    <span className="line-clamp-2 text-sm text-fg-muted">
                      <Snippet text={hit.snippet} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// ───────────── konuşma ─────────────

/** Boş konuşma: ne yapılabileceği, söylenebilecek dört gerçek istek ve altta yazma kutusu. Ortalanmaz; okuma sütununda durur. */
function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  const shell = useShell();
  const suggestions: Array<{ icon: ReactNode; text: string }> = [
    { icon: <Bell />, text: t('chat.suggest.reminder') },
    { icon: <Sun />, text: t('chat.suggest.today') },
    { icon: <ListChecks />, text: t('chat.suggest.todo') },
    { icon: <Brain />, text: t('chat.suggest.memory') },
  ];
  return (
    <div className="chat-column flex flex-col items-center pt-6 pb-6 text-center" data-testid="chat-empty">
      <Core state={shell.core} getLevel={getLevelFrom(shell.level)} size={56} />
      <h3 className="chat-welcome-title mt-4 text-fg">{t('chat.empty.title')}</h3>
      <p className="mt-2 max-w-[48ch] text-base text-fg-muted">{t('chat.empty.body', { wake: shell.wakePhrase })}</p>
      <div className="chat-suggest-grid mt-7 w-full text-left" role="group" aria-label={t('chat.empty.suggestions')}>
        {suggestions.map((suggestion) => (
          <button key={suggestion.text} type="button" className="chat-suggest" onClick={() => onPick(suggestion.text)} data-testid="chat-suggest">
            <span className="flex shrink-0 text-fg-muted [&_svg]:size-4.5" aria-hidden>
              {suggestion.icon}
            </span>
            <span className="min-w-0 text-sm font-medium text-balance">{suggestion.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Geçmiş yüklenirken iletilerin biçiminde iskelet (bir kullanıcı balonu, bir asistan turu). */
function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-7" aria-busy aria-label={t('common.loading')}>
      <div className="flex justify-end">
        <Skeleton className="h-11 w-2/5 rounded-md" />
      </div>
      <div className="chat-measure flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <Skeleton shape="circle" className="size-[26px]" />
          <Skeleton className="h-3 w-24 rounded-full" />
        </div>
        <Skeleton shape="text" lines={3} />
      </div>
    </div>
  );
}

function Conversation({
  sessionId,
  session,
  contextHost,
  onSessionCreated,
  onDeleted,
  onOpenList,
  onOpenContext,
  onNew,
}: {
  sessionId: Id | null;
  session: ChatSession | null;
  /** Bağlam sütununun kabı: konuşma, kendi bağlamını buraya çizer (iletiler konuşmanın durumudur). */
  contextHost: HTMLElement | null;
  onSessionCreated: (id: Id) => void;
  onDeleted: () => void;
  onOpenList: () => void;
  onOpenContext: () => void;
  /** Dar kapta sayfa başı çizilmez; "Yeni sohbet" konuşma başlığına iner. */
  onNew: () => void;
}) {
  const shell = useShell();
  const [text, setText] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);
  const attachments = useAttachments();
  const drop = useDropZone((files) => void attachments.addFiles(files));
  useSyncExternalStore(chatStore.subscribe, chatStore.version);

  const history = useLive<ChatMessage[]>(
    () => (sessionId ? window.fuber.invoke('chat.history', { sessionId, limit: HISTORY_LIMIT }) : Promise.resolve([])),
    [],
    [sessionId],
  );
  useEffect(() => {
    if (sessionId && history.data) chatStore.settle(sessionId, history.data);
  }, [sessionId, history.data]);

  const loaded = history.data ?? [];
  const seen = new Set(loaded.map((message) => message.id));
  const messages = [...loaded, ...chatStore.appended(sessionId).filter((message) => !seen.has(message.id))];
  const draft = chatStore.draft(sessionId);
  const streaming = draft !== null && !draft.error;

  // Alta yapışık kal: kullanıcı yukarı kaydırmadıysa yeni içerik görünür kalsın.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    stick.current = true;
    inputRef.current?.focus();
  }, [sessionId]);

  /** `retryIds`: yeniden denemede önceki iletinin ekleri (yazma kutusundaki ekler o zaman gönderilmez). */
  const send = async (value = text, retryIds?: Id[]) => {
    const message = value.trim();
    const attachmentIds = retryIds ?? attachments.ready.map((item) => item.id);
    if (!message && attachmentIds.length === 0) return;
    stick.current = true;
    setText('');
    if (!retryIds && attachmentIds.length) attachments.clear();
    try {
      const result = await window.fuber.invoke('chat.send', { sessionId, text: message, ...(attachmentIds.length ? { attachmentIds } : {}) });
      if (result.sessionId !== sessionId) onSessionCreated(result.sessionId);
    } catch (error) {
      setText(message);
      toast.error(errorText(error));
    }
  };
  const pick = (suggestion: string) => {
    setText(suggestion);
    inputRef.current?.focus();
  };

  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const retry = lastUser ? () => void send(lastUser.text, (lastUser.attachments ?? []).map((item) => item.id)) : undefined;
  const lastId = messages[messages.length - 1]?.id;
  const empty = messages.length === 0 && !draft;
  const showEmpty = empty && history.state.status !== 'loading' && history.state.status !== 'error';

  return (
    <section className="chat-conv" data-empty={showEmpty || undefined} data-testid="chat-conversation" data-session={sessionId ?? ''} {...drop.handlers}>
      <DropOverlay visible={drop.over} />
      <header className="chat-conv-head" data-bare={session ? undefined : ''}>
        <div className="chat-column flex h-[52px] items-center gap-1.5">
          <span className="chat-list-toggle -ml-2">
            <IconButton icon={<SidebarSimple />} label={t('chat.sessions')} size="sm" onClick={onOpenList} data-testid="chat-list-toggle" />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-lg text-fg" data-testid="chat-title" title={session?.title || undefined}>
            {session ? shortTitle(session.title || t('chat.untitled')) : t('chat.newTitle')}
          </h2>

          {session && (
            <span className="chat-new-compact">
              <IconButton icon={<NotePencil />} label={t('chat.new')} size="sm" onClick={onNew} data-testid="chat-new-compact" />
            </span>
          )}
          <span className="chat-context-toggle">
            <IconButton icon={<Info />} label={t('chat.context.open')} size="sm" onClick={onOpenContext} data-testid="chat-context-toggle" />
          </span>
        {session && (
          <Menu
            label={t('common.more')}
            placement="bottom-end"
            trigger={<IconButton icon={<DotsThree weight="bold" />} label={t('common.more')} size="sm" data-testid="chat-menu" />}
            items={[
              {
                id: 'rename',
                label: t('chat.rename'),
                icon: <PencilSimple />,
                onSelect: () => {
                  setTitle(session.title);
                  setRenaming(true);
                },
              },
              { type: 'separator', id: 'sep' },
              { id: 'delete', label: t('chat.delete'), icon: <Trash />, danger: true, onSelect: () => setDeleting(true) },
            ]}
          />
        )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="chat-scroller"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {showEmpty ? (
          <EmptyChat onPick={pick} />
        ) : (
          <div className="chat-column flex flex-col gap-7 pt-7 pb-12" data-testid="chat-messages">
            {history.state.status === 'loading' && sessionId ? (
              <HistorySkeleton />
            ) : history.state.status === 'error' ? (
              <ErrorPanel message={history.state.message} onRetry={history.reload} />
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <MessageEntry key={message.id} role={message.role}>
                    {message.role === 'user' ? (
                      <UserBubble message={message} />
                    ) : (
                      <AssistantMessage message={message} name={shell.name} {...(retry && message.id === lastId ? { onRetry: retry } : {})} />
                    )}
                  </MessageEntry>
                ))}
                {draft && (
                  <MessageEntry key={draft.messageId} role="assistant">
                    <StreamingMessage draft={draft} name={shell.name} {...(retry ? { onRetry: retry } : {})} />
                  </MessageEntry>
                )}
              </AnimatePresence>
            )}
          </div>
        )}
      </div>

      <div className="chat-composer-slot shrink-0">
       <div className="chat-column pb-6">
        {shell.brain === 'none' && (
          <p className="mb-2 flex items-center gap-2 text-sm text-warning" data-testid="chat-no-brain-note">
            <Cpu className="size-4 shrink-0" aria-hidden />
            {shell.brainStatus?.message ?? t('nav.status.brainNoneHint')}
          </p>
        )}
        <Composer
          variant="stacked"
          value={text}
          onChange={setText}
          onSend={() => void send()}
          onStop={() => sessionId && void attempt(() => window.fuber.invoke('chat.cancel', { sessionId }))}
          streaming={streaming}
          inputRef={inputRef}
          attachments={attachments}
          localBrain={shell.brain !== 'cloud'}
          note={
            shell.brain === 'local' ? (
              <span className="flex min-w-0 items-center gap-1.5" data-testid="chat-local-note" title={t('chat.localNote')}>
                <Cpu className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{t('chat.localNoteShort')}</span>
              </span>
            ) : null
          }
        />
       </div>
      </div>

      {contextHost && createPortal(session ? <ConversationContext session={session} messages={messages} /> : <NewChatContext onPick={pick} />, contextHost)}

      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title={t('chat.rename')}
        size="sm"
        closeLabel={t('common.close')}
        footer={
          <>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={async () => {
                if (!sessionId) return;
                const ok = await attempt(() => window.fuber.invoke('chat.renameSession', { sessionId, title: title.trim() }));
                if (ok) setRenaming(false);
              }}
            >
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        }
      >
        <Field label={t('chat.renameLabel')}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('chat.deleteTitle')}
        body={t('chat.deleteBody')}
        confirmLabel={t('chat.delete')}
        onConfirm={async () => {
          if (!sessionId) return;
          const ok = await attempt(() => window.fuber.invoke('chat.deleteSession', { sessionId }));
          if (ok) {
            chatStore.forget(sessionId);
            onDeleted();
          }
        }}
      />
    </section>
  );
}

type Drawer = 'list' | 'context' | null;

function ChatPage() {
  const [activeId, setActiveId] = useState<Id | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  // Klavyeyle (Esc) kapanan çekmece canlandırılmaz; fareyle açılıp kapanan yumuşakça kayar.
  const [instant, setInstant] = useState(false);
  const [contextHost, setContextHost] = useState<HTMLElement | null>(null);
  const sessions = useLive(() => window.fuber.invoke('chat.sessions', { limit: 80 }), ['chat.changed']);

  // İlk açılışta en son oturum seçilir; kullanıcı "yeni sohbet" derse boş kalır.
  useEffect(() => {
    if (initialised || !sessions.data) return;
    setInitialised(true);
    setActiveId(sessions.data[0]?.id ?? null);
  }, [sessions.data, initialised]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // İşaretlenir: aynı Esc, asistan konuşuyor olsa da onu susturmaz (önce çekmece kapanır; `shell/voice-stop.ts`).
      event.preventDefault();
      setInstant(true);
      setDrawer(null);
    };
    // Yakalama evresinde dinlenir: düğmenin açık ipucu Esc'i önce tüketirse çekmece ikinci basışı beklemesin.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drawer]);
  const open = (next: Exclude<Drawer, null>) => {
    setInstant(false);
    setDrawer(next);
  };
  const close = () => {
    setInstant(false);
    setDrawer(null);
  };

  const session = useMemo(() => sessions.data?.find((item) => item.id === activeId) ?? null, [sessions.data, activeId]);
  const list = sessions.data ?? [];
  // Hiç sohbet yokken liste sütunu çizilmez (iki satırlık metin için tam boy sütun durmaz).
  const noSessions = sessions.state.status === 'ready' && list.length === 0;
  const status =
    sessions.state.status !== 'ready'
      ? undefined
      : list.length === 0
        ? undefined
        : t('chat.status', { count: list.length, when: relativeTime(list[0]!.lastAt) });

  return (
    <Workspace fill className="chat-page" data-testid="chat-page">
      <WorkspaceHeader
        title={t('nav.chat')}
        status={status}
        actions={
          <Button
            icon={<NotePencil />}
            onClick={() => {
              setActiveId(null);
              close();
            }}
            data-testid="chat-new"
          >
            {t('chat.new')}
          </Button>
        }
      />
      <div className="chat-layout" data-instant={instant || undefined}>
        <Panel tone="lead" padding="none" className="chat-stage" data-no-list={noSessions || undefined}>
          <SessionList
            activeId={activeId}
            open={drawer === 'list'}
            onSelect={(id) => {
              setActiveId(id);
              close();
            }}
            onClose={close}
          />
          <button type="button" tabIndex={-1} aria-hidden className="chat-scrim" data-for="list" data-open={drawer === 'list' || undefined} onClick={close} />
          {sessions.state.status === 'error' ? (
            <div className="flex items-center justify-center">
              <EmptyState icon={<ChatsCircle />} title={t('common.loadFailed')} description={sessions.state.message} />
            </div>
          ) : (
            <Conversation
              key={activeId ?? 'new'}
              sessionId={activeId}
              session={session}
              contextHost={contextHost}
              onSessionCreated={setActiveId}
              onDeleted={() => setActiveId(null)}
              onOpenList={() => open('list')}
              onOpenContext={() => open('context')}
              onNew={() => {
                setActiveId(null);
                close();
              }}
            />
          )}
          <button type="button" tabIndex={-1} aria-hidden className="chat-scrim" data-for="context" data-open={drawer === 'context' || undefined} onClick={close} />
          <aside className="chat-context" data-open={drawer === 'context' || undefined} aria-label={t('chat.context.label')} data-testid="chat-context">
            {/* Çekmecede kapatma düğmesi ilk bölüm başlığının hizasında durur (ayrı başlık satırı yok). */}
            <div className="chat-context-close">
              <IconButton icon={<X />} label={t('common.close')} size="sm" onClick={close} />
            </div>
            <div ref={setContextHost} className="flex min-h-0 flex-col" />
          </aside>
        </Panel>
      </div>
    </Workspace>
  );
}

export default definePage({
  id: 'chat',
  titleKey: 'nav.chat',
  icon: ChatsCircle,
  order: 20,
  Component: ChatPage,
});
