// Sohbet iletileri: kullanıcı balonu (gümüş), asistan turu (kutusuz metin, solda varlık), araç satırı (sakin, katlanabilir).
// Kaplar `chat.css` içindeki üç malzemeden gelir. İleti başına zaman ve kanal işareti (sesli / yazılı).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowClockwise, CaretDown, Keyboard, Microphone, WarningCircle } from '@phosphor-icons/react';
import { hasMessage, localDay, localTime, relativeDateTime, t, type ChatMessage } from '@fuber/shared';
import { Badge, Button, Spinner, cn, durations, easings, enter, spring, useMotionPreset, useMotionTransition, useReducedMotion } from '@fuber/ui';
import { attempt } from '../../shell/live';
import { capitalize } from '../../shell/text';
import { Markdown, countWords } from './markdown';
import { chatStore, type Draft, type ToolChip } from './store';
import { MessageAttachments } from './attachments';
import './chat.css';

const openLink = (url: string) => void attempt(() => window.fuber.invoke('app.openExternal', { url }));

/**
 * Araç adımının okunur özeti, nesnesiyle ("Hatırlatıcı kuruldu: KDV beyannamesi, yarın 10:00"). Araç metni modele
 * yazılır ve ilk cümleden sonra modele yönerge taşıyabilir: yalnız ilk cümle alınır. Başarısız adımda, çok uzun ya da
 * yapısal (JSON, çok satırlı döküm) metinde genel etikete dönülür.
 */
export function stepSummary(call: { name: string; ok: boolean; text: string }): string {
  const label = toolDoneLabel(call.name, call.ok);
  if (!call.ok) return label;
  const line = call.text.split(/\r?\n/)[0]?.trim() ?? '';
  const first = (/^(.+?[.!?])(?=\s|$)/.exec(line)?.[1] ?? line).replace(/[.!?]$/, '');
  if (first.length < 4 || first.length > 110 || /[{}\[\]]/.test(first)) return label;
  return first;
}

export function toolLabel(name: string): string {
  const key = `chat.tool.${name}`;
  return hasMessage(key) ? t(key) : t('chat.tool.generic', { name });
}

/** Biten aracın etiketi (sürerken "kuruluyor", bitince "kuruldu"). */
export function toolDoneLabel(name: string, ok: boolean): string {
  if (!ok) return t('chat.toolFailed', { name: toolLabel(name) });
  const key = `chat.toolDone.${name}`;
  return hasMessage(key) ? t(key) : t('chat.toolDone.generic', { name });
}

/** Bugünse yalnız saat ("14:32"); değilse gün ve saat ("Dün 14:32"). */
export function stamp(at: string): string {
  return localDay(at) === localDay() ? localTime(at) : capitalize(relativeDateTime(at));
}

// ───────────── zaman ve kanal ─────────────

function Meta({ at, channel }: { at: string; channel: ChatMessage['channel'] }) {
  const voice = channel === 'voice';
  const label = voice ? t('chat.channel.voiceMessage') : t('chat.channel.chatMessage');
  const Mark = voice ? Microphone : Keyboard;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-faint tabular-nums" data-testid="msg-meta" data-channel={channel}>
      <time dateTime={at}>{stamp(at)}</time>
      <span title={label} aria-label={label} role="img" className="inline-flex">
        <Mark className="size-3.5" aria-hidden />
      </span>
    </span>
  );
}

// ───────────── araç adımları ─────────────

export interface Step {
  id: string;
  label: string;
  state: 'running' | 'ok' | 'failed';
}

/** Adımın durum işareti: sürerken dönen halka, bitince çizilen onay işareti. */
function StepMark({ state }: { state: Step['state'] }) {
  const reduced = useReducedMotion();
  const transition = useMotionTransition(spring.snappy);
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          initial={reduced ? { opacity: 0 } : { opacity: 0, transform: 'scale(0.6)' }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, transform: 'scale(1)' }}
          exit={{ opacity: 0 }}
          transition={transition}
          className="flex"
        >
          {state === 'running' ? (
            <Spinner size={12} label={null} />
          ) : state === 'ok' ? (
            <svg viewBox="0 0 20 20" className="size-4 text-success" aria-hidden fill="none">
              <motion.path
                d="M5 10.4l3.2 3.2 6.8-7.2"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={reduced ? { duration: 0 } : { duration: durations.base, ease: easings.out }}
              />
            </svg>
          ) : (
            <WarningCircle weight="fill" className="size-4 text-warning" aria-hidden />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <span
      title={step.label}
      data-testid="tool-chip"
      data-state={step.state}
      className={cn(
        'inline-flex h-7 max-w-full items-center gap-2 rounded-full pr-3 pl-2 text-sm',
        step.state === 'failed' ? 'bg-warning-soft text-warning' : 'chat-tool text-fg-muted',
      )}
    >
      <StepMark state={step.state} />
      <span className="truncate">{step.label}</span>
    </span>
  );
}

/**
 * Araç adımları: tek adım tek satır; birden çok adım "N adım" diye tek satırda toplanır (açılınca her adım ayrı satır).
 * Süren adım özet satırında görünür kalır.
 */
export function ToolSteps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const transition = useMotionTransition(spring.smooth);
  if (steps.length === 0) return null;
  if (steps.length === 1) {
    return (
      <div className="flex" data-testid="tool-chips">
        <StepRow step={steps[0]!} />
      </div>
    );
  }
  const running = steps.find((step) => step.state === 'running');
  const failed = steps.filter((step) => step.state === 'failed').length;
  const state: Step['state'] = running ? 'running' : failed ? 'failed' : 'ok';
  const summary = running ? running.label : failed ? t('chat.stepsFailed', { count: failed }) : t('chat.stepsDone');
  return (
    <div className="flex flex-col items-start gap-1.5" data-testid="tool-chips" data-folded="">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('chat.stepsToggle')}
        onClick={() => setOpen((value) => !value)}
        data-testid="tool-group"
        data-state={state}
        className={cn(
          'inline-flex h-7 max-w-full cursor-pointer items-center gap-2 rounded-full pr-2.5 pl-2 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-4',
          failed && !running ? 'bg-warning-soft text-warning' : 'chat-tool text-fg-muted',
        )}
      >
        <StepMark state={state} />
        <span className="font-medium text-fg">{t('chat.steps', { count: steps.length })}</span>
        <span className="truncate">{summary}</span>
        <CaretDown className={cn('size-3.5 shrink-0 transition-transform duration-(--duration-fast) ease-out', !open && '-rotate-90')} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={transition}
            className="max-w-full overflow-hidden"
          >
            <ul className="chat-steps" data-testid="tool-steps">
              {steps.map((step) => (
                <li key={step.id} title={step.label} data-testid="tool-chip" data-state={step.state} className={step.state === 'failed' ? 'text-warning' : undefined}>
                  <StepMark state={step.state} />
                  <span className="truncate">{step.label}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ───────────── iletiler ─────────────

export function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end" data-testid="msg-user">
      <div className="flex max-w-[min(82%,520px)] flex-col items-end gap-1.5">
        <MessageAttachments attachments={message.attachments} />
        {message.text && (
          <div className="chat-me rounded-md rounded-br-xs px-4 py-2.5 whitespace-pre-wrap" data-selectable>
            {message.text}
          </div>
        )}
        <Meta at={message.at} channel={message.channel} />
      </div>
    </div>
  );
}

/** Hata turu: çerçevesiz, kehribar tonlu sakin blok; ne oldu, ne yapılır, tek eylem. */
function ErrorTurn({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="chat-measure chat-error flex items-start gap-3 rounded-sm px-4 py-3.5" data-testid="msg-error" role="status">
      <WarningCircle className="mt-0.5 size-5 shrink-0 text-warning" weight="fill" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-base font-medium text-fg">{t('chat.error.title')}</p>
        <p className="text-sm text-fg" data-selectable>
          {error}
        </p>
        <p className="text-sm text-fg-muted">{t('chat.error.hint')}</p>
        {onRetry && (
          <div className="mt-2">
            <Button size="sm" variant="secondary" icon={<ArrowClockwise />} onClick={onRetry} data-testid="msg-retry">
              {t('common.retry')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Asistan turu: başta Jarvis'in küçük varlığı, adı ve zaman; altında adımlar ve metin. Metin kutusuzdur (sahnenin
 * içinde ikinci bir kart yok); satır ölçüsünü `chat-prose` verir.
 */
function AssistantTurn({
  name,
  state,
  meta,
  children,
  testId,
  live,
}: {
  name: string;
  state: 'idle' | 'thinking';
  meta?: ChatMessage;
  children: ReactNode;
  testId?: string;
  live?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid={testId} {...(live ? { 'aria-live': 'polite' as const, 'aria-busy': true } : {})}>
      <div className="flex min-h-[26px] items-center gap-2.5">
        <span className="text-sm font-semibold text-fg">{name}</span>
        {meta && <Meta at={meta.at} channel={meta.channel} />}
      </div>
      {children}
    </div>
  );
}

export function AssistantMessage({ message, name, onRetry }: { message: ChatMessage; name: string; onRetry?: () => void }) {
  // Hata turu: bu pencerede yaşandıysa akıştan, geçmişten yüklendiyse iletinin `failed` işaretinden bilinir.
  const failure = chatStore.failure(message.id) ?? (message.failed ? message.text : null);
  if (failure) {
    return (
      <AssistantTurn name={name} state="idle" meta={message}>
        <ErrorTurn error={failure} {...(onRetry ? { onRetry } : {})} />
      </AssistantTurn>
    );
  }
  const steps: Step[] = message.toolCalls.map((call) => ({
    id: call.callId,
    label: stepSummary(call),
    state: call.ok ? 'ok' : 'failed',
  }));
  return (
    <AssistantTurn name={name} state="idle" meta={message} testId="msg-assistant">
      <ToolSteps steps={steps} />
      {message.text && (
        <div className="chat-prose">
          <Markdown text={message.text} onLink={openLink} />
        </div>
      )}
      {message.interrupted && (
        <div>
          <Badge size="sm" tone="neutral" data-testid="msg-interrupted">
            {t('chat.interrupted')}
          </Badge>
        </div>
      )}
    </AssistantTurn>
  );
}

export function StreamingMessage({ draft, name, onRetry }: { draft: Draft; name: string; onRetry?: () => void }) {
  const seen = useRef(0);
  const total = countWords(draft.text);
  const fadeFrom = seen.current;
  useEffect(() => {
    seen.current = total;
  }, [total]);
  if (draft.error) {
    return (
      <AssistantTurn name={name} state="idle">
        <ErrorTurn error={draft.error} {...(onRetry ? { onRetry } : {})} />
      </AssistantTurn>
    );
  }
  const steps: Step[] = draft.tools.map((tool: ToolChip) => ({
    id: tool.callId,
    label: tool.phase === 'end' ? toolDoneLabel(tool.name, tool.ok !== false) : (tool.step ?? toolLabel(tool.name)),
    state: tool.phase !== 'end' ? 'running' : tool.ok === false ? 'failed' : 'ok',
  }));
  return (
    <AssistantTurn name={name} state="thinking" testId="msg-streaming" live>
      <ToolSteps steps={steps} />
      {draft.text ? (
        <div className="chat-prose">
          <Markdown text={draft.text} fadeFrom={fadeFrom} onLink={openLink} />
        </div>
      ) : (
        steps.length === 0 && (
          <p className="text-sm text-fg-muted" data-testid="msg-thinking">
            {t('chat.thinking', { name })}
          </p>
        )
      )}
    </AssistantTurn>
  );
}

/** Sohbet iletisinin girişi: kullanıcının iletisi yazı kutusundan yükselir, asistanınki aşağıdan belirir. */
export function MessageEntry({ role, children }: { role: ChatMessage['role']; children: ReactNode }) {
  const fadeUp = useMotionPreset(enter.fadeUp);
  const reduced = useReducedMotion();
  const rise = role === 'user' && !reduced;
  return (
    <motion.div
      initial={rise ? { opacity: 0, transform: 'translateY(28px) scale(0.97)' } : fadeUp.initial}
      animate={rise ? { opacity: 1, transform: 'translateY(0px) scale(1)' } : fadeUp.animate}
      transition={fadeUp.transition}
    >
      {children}
    </motion.div>
  );
}
