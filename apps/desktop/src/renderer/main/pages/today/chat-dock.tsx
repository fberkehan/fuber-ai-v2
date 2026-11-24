// Yerleşik sohbet: Kokpit'in sağındaki ana sohbet (v1'in sağ sütunu). Son konuşmayı ve yazma kutusunu taşır;
// kutuda ek ve mikrofon vardır. Sohbet sayfasının kendi parçalarıyla kurulur (ileti balonları, yazma kutusu, akış
// deposu), bu yüzden burada yazılan söz Sohbet sayfasında da aynı oturumda görünür.
//
// Geniş pencerede yanda tam boy bir sütundur; dar pencerede altta bir şerittir ve konuşma istenince şeridin üstünde
// açılır (yazma kutusu her zaman eldedir).
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { AnimatePresence } from 'motion/react';
import { ArrowUpRight, CaretDown, CaretUp, Cpu, NotePencil } from '@phosphor-icons/react';
import { t, type ChatMessage, type Id } from '@fuber/shared';
import { IconButton, toast } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt, errorText, useEvent, useLive } from '../../shell/live';
import { capitalize } from '../../shell/text';
import { DropOverlay, useAttachments, useDropZone } from '../chat/attachments';
import { Composer } from '../chat/composer';
import { AssistantMessage, MessageEntry, StreamingMessage, UserBubble } from '../chat/messages';
import { chatStore, ensureChatSubscription } from '../chat/store';
import '../chat/chat.css';

ensureChatSubscription();

/** Yerleşik sohbet son iletileri gösterir; daha eskisi Sohbet sayfasındadır. */
const HISTORY_LIMIT = 30;

export interface ChatDockHandle {
  /** Sözü yazma kutusuna koyar ve kutuya odaklanır (öneri kartı, boş durumdaki örnekler). */
  compose(text: string): void;
}

/** Konuşmanın durumu: henüz okunmadı, gösterecek ileti yok, ileti var (ya da yanıt akıyor). */
export type ChatDockState = 'unknown' | 'quiet' | 'active';

export function ChatDock({ mode, ref, onState }: { mode: 'side' | 'bar'; ref?: Ref<ChatDockHandle>; onState?: (state: ChatDockState) => void }) {
  const shell = useShell();
  const [sessionId, setSessionId] = useState<Id | null>(null);
  /** Kullanıcı "yeni sohbet" dedi: en son oturum kendiliğinden seçilmez. */
  const [fresh, setFresh] = useState(false);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  // Şeritten yan sütuna bu ziyaret sırasında geçildiyse sütun kısa bir girişle açılır (sayfa açılışında değil).
  const lastMode = useRef(mode);
  const [opened, setOpened] = useState(false);
  useLayoutEffect(() => {
    if (lastMode.current === 'bar' && mode === 'side') setOpened(true);
    if (mode === 'bar') setOpened(false);
    lastMode.current = mode;
  }, [mode]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);
  const attachments = useAttachments();
  const drop = useDropZone((files) => void attachments.addFiles(files));
  useSyncExternalStore(chatStore.subscribe, chatStore.version);

  // Ana sohbet = en son oturum (sesli ya da yazılı). Yeni bir tur başka oturumda başlarsa sohbet onu izler.
  const sessions = useLive(() => window.fuber.invoke('chat.sessions', { limit: 1 }), ['chat.changed']);
  useEvent('chat.stream', (event) => {
    if (event.kind === 'start' && event.sessionId !== sessionId) sessions.reload();
  });
  const latest = sessions.data?.[0] ?? null;
  useEffect(() => {
    if (fresh || !latest) return;
    setSessionId(latest.id);
  }, [latest?.id, fresh]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const open = mode === 'side' || expanded;

  // Sayfa, gösterecek konuşma yokken yandaki sütunu açmaz (boş kutu çizilmez); bunu buradan öğrenir.
  const settled = sessions.data !== null && (latest === null || fresh || (sessionId === latest.id && history.data !== null));
  const state: ChatDockState = messages.length > 0 || draft ? 'active' : settled ? 'quiet' : 'unknown';
  useEffect(() => onState?.(state), [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alta yapışık kal: kullanıcı yukarı kaydırmadıysa yeni içerik görünür kalsın.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  });
  // Dar şeritte yanıt akmaya başlayınca konuşma kendiliğinden açılır.
  useEffect(() => {
    if (draft) setExpanded(true);
  }, [draft?.messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    compose(value: string) {
      setText(value);
      // Odak, değer yazıldıktan sonra verilir ki imleç sözün sonunda dursun.
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(value.length, value.length);
      });
    },
  }));

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
      setFresh(false);
      if (result.sessionId !== sessionId) setSessionId(result.sessionId);
    } catch (error) {
      setText(message);
      toast.error(errorText(error));
    }
  };

  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const retry = lastUser ? () => void send(lastUser.text, (lastUser.attachments ?? []).map((item) => item.id)) : undefined;
  const lastId = messages[messages.length - 1]?.id;
  const session = sessionId && latest?.id === sessionId ? latest : null;
  const empty = messages.length === 0 && !draft;

  return (
    <section
      className="kokpit-chat"
      data-mode={mode}
      data-opened={opened ? '' : undefined}
      // Şeritte gösterecek konuşma yokken çerçeve ve başlık çizilmez: yalnız yazma kutusu (kutu içinde kutu olmaz).
      data-bare={mode === 'bar' && state !== 'active' ? '' : undefined}
      aria-label={t('dashboard.chat.title')}
      data-testid="today-chat"
      data-session={sessionId ?? ''}
      {...drop.handlers}
    >
      <DropOverlay visible={drop.over} />
      <header className="kokpit-chat-head flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="kokpit-card-title shrink-0 text-fg">{t('dashboard.chat.title')}</h2>
        {session?.title ? (
          <span className="min-w-0 truncate text-sm text-fg-faint" data-testid="today-chat-title">
            {capitalize(session.title)}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center">
          {mode === 'bar' && (
            <IconButton
              icon={expanded ? <CaretDown /> : <CaretUp />}
              label={t(expanded ? 'dashboard.chat.hide' : 'dashboard.chat.show')}
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              data-testid="today-chat-toggle"
            />
          )}
          <IconButton
            icon={<NotePencil />}
            label={t('dashboard.chat.new')}
            size="sm"
            onClick={() => {
              setFresh(true);
              setSessionId(null);
              inputRef.current?.focus();
            }}
            data-testid="today-chat-new"
          />
          <IconButton icon={<ArrowUpRight />} label={t('dashboard.chat.open')} size="sm" onClick={() => shell.navigate('chat')} data-testid="today-go-chat" />
        </div>
      </header>

      {open && (
        <div
          ref={scrollRef}
          className={`kokpit-chat-scroll px-4 ${mode === 'side' ? 'flex-1' : ''}`}
          onScroll={(event) => {
            const element = event.currentTarget;
            stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
          }}
          data-testid="today-chat-messages"
        >
          {empty ? (
            <p className={`max-w-[34ch] text-sm text-fg-muted ${mode === 'side' ? 'pt-2' : 'py-2'}`} data-testid="today-chat-empty">
              {t('dashboard.chat.empty', { name: shell.name, wake: shell.wakePhrase })}
            </p>
          ) : (
            <div className="flex flex-col gap-5 pt-1 pb-4">
              {loaded.length >= HISTORY_LIMIT && <p className="text-xs text-fg-faint">{t('dashboard.chat.earlier')}</p>}
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
            </div>
          )}
        </div>
      )}

      <div className="kokpit-chat-compose shrink-0 px-3 pb-3" data-testid="today-compose">
        {shell.brain === 'none' && (
          <p className="mb-2 flex items-center gap-2 px-1 text-sm text-warning" data-testid="today-no-brain-note">
            <Cpu className="size-4 shrink-0" aria-hidden />
            {shell.brainStatus?.message ?? t('nav.status.brainNoneHint')}
          </p>
        )}
        <Composer
          value={text}
          onChange={setText}
          onSend={() => void send()}
          onStop={() => sessionId && void attempt(() => window.fuber.invoke('chat.cancel', { sessionId }))}
          streaming={streaming}
          inputRef={inputRef}
          attachments={attachments}
          localBrain={shell.brain !== 'cloud'}
        />
      </div>
    </section>
  );
}
