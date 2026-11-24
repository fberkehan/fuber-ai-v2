// Sohbetin bağlam bölmesi: yalnız GERÇEK veriden kurulur. Açık bir konuşmada o konuşmanın künyesi, çalışan araç
// adımları (nesnesiyle), eklenen dosyalar ve o konuşmadan hafızaya geçenler; yeni sohbette sıradaki hatırlatıcılar,
// son öğrenilenler ve açık yetenekler. Uydurma örnek içerik yoktur; veri yoksa bölüm çizilmez. Bölümler sahnenin
// (birincil kutunun) üçüncü bölmesinde durur: ayrı bir kutu değildir, aynı iç kenarı paylaşırlar.
import { ArrowUpRight, Check, WarningCircle } from '@phosphor-icons/react';
import {
  hasMessage,
  localTime,
  relativeDateTime,
  relativeTime,
  t,
  type ChatAttachment,
  type ChatMessage,
  type ChatSession,
  type MemoryItem,
  type MessageKey,
  type Reminder,
} from '@fuber/shared';
import { KeyHint } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { acceleratorKeys, useLive } from '../../shell/live';
import { capitalize } from '../../shell/text';
import { ContextSection, Fact } from '../memory/page-parts';
import { AttachmentCard } from './attachments';
import { stepSummary } from './messages';

/** Bölüm içindeki tek satır kayıt: metin + sağda soluk ek bilgi. `onPress` verilirse satır düğmedir. */
function Line({ text, meta, tone, onPress, title }: { text: string; meta?: string; tone?: 'ok' | 'failed'; onPress?: () => void; title?: string }) {
  const body = (
    <>
      {tone && (
        <span className="flex shrink-0 translate-y-[3px]">
          {tone === 'ok' ? <Check className="size-4 text-success" weight="bold" aria-hidden /> : <WarningCircle className="size-4 text-warning" weight="fill" aria-hidden />}
        </span>
      )}
      <span className="line-clamp-2 min-w-0 flex-1 text-sm text-fg">{text}</span>
      {meta && <span className="shrink-0 text-xs text-fg-faint tabular-nums">{meta}</span>}
    </>
  );
  if (!onPress) {
    return (
      <li className="ctx-line" title={title}>
        {body}
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={onPress} title={title} className="ctx-link">
        {body}
      </button>
    </li>
  );
}

/** Başka sayfaya giden küçük bağlantı (bölüm başlığının sağında). */
function Jump({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="inline-flex cursor-pointer items-center gap-1 rounded-xs text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg [&_svg]:size-3.5"
    >
      {label}
      <ArrowUpRight aria-hidden />
    </button>
  );
}

/** Açık konuşmanın bağlamı. `messages`: ekrandaki iletiler (geçmiş + bu pencerede gelenler). */
export function ConversationContext({ session, messages }: { session: ChatSession; messages: ChatMessage[] }) {
  const shell = useShell();
  const memoryOn = shell.moduleEnabled('memory');
  const learned = useLive<MemoryItem[]>(
    async () => (memoryOn ? (await window.fuber.invoke('memory.list', { limit: 200 })).filter((item) => item.sessionId === session.id) : []),
    ['memory.changed'],
    [session.id, memoryOn],
  );
  const steps = messages.flatMap((message) => message.toolCalls.map((call) => ({ call, at: message.at })));
  const failed = steps.filter((step) => !step.call.ok).length;
  const files: ChatAttachment[] = messages.flatMap((message) => message.attachments ?? []);
  const voiceTurns = messages.filter((message) => message.channel === 'voice').length;
  const count = Math.max(session.messageCount, messages.length);
  const learnedItems = learned.data ?? [];

  return (
    <>
      <ContextSection title={t('chat.context.about')} data-testid="chat-context-about">
        <dl className="flex flex-col gap-2">
          <Fact label={t('chat.context.started')}>{capitalize(relativeDateTime(session.startedAt))}</Fact>
          <Fact label={t('chat.context.last')}>{capitalize(relativeTime(session.lastAt))}</Fact>
          <Fact label={t('chat.context.messages')}>
            {voiceTurns > 0 ? t('chat.context.messagesVoice', { count, voice: voiceTurns }) : t('chat.context.messagesCount', { count })}
          </Fact>
        </dl>
      </ContextSection>

      {steps.length > 0 && (
        <ContextSection
          title={t('chat.context.steps')}
          count={steps.length}
          action={failed > 0 ? <span className="text-sm text-warning">{t('chat.stepsFailed', { count: failed })}</span> : undefined}
          data-testid="chat-context-steps"
        >
          <ul className="flex flex-col">
            {steps.slice(-8).map(({ call, at }) => (
              <Line key={call.callId} tone={call.ok ? 'ok' : 'failed'} text={stepSummary(call)} meta={localTime(at)} />
            ))}
          </ul>
        </ContextSection>
      )}

      {files.length > 0 && (
        <ContextSection title={t('chat.context.files')} count={files.length} data-testid="chat-context-files">
          <div className="flex flex-col gap-1.5">
            {files.slice(-6).map((file) => (
              <AttachmentCard key={file.id} attachment={file} />
            ))}
          </div>
        </ContextSection>
      )}

      {learnedItems.length > 0 && (
        <ContextSection
          title={t('chat.context.learned')}
          count={learnedItems.length}
          action={<Jump label={t('nav.memory')} onPress={() => shell.navigate('memory')} />}
          data-testid="chat-context-learned"
        >
          <ul className="flex flex-col">
            {learnedItems.slice(0, 5).map((item) => (
              <Line key={item.id} text={item.text} meta={t(`memory.kind.${item.kind}`)} />
            ))}
          </ul>
        </ContextSection>
      )}
    </>
  );
}

const ABILITY_PREVIEW = 6;

/** Yeni (boş) sohbetin bağlamı: sırada ne var, son ne öğrenildi, neler açık (karşılama metnini yinelemez). */
export function NewChatContext({ onPick }: { onPick: (text: string) => void }) {
  const shell = useShell();
  const plannerOn = shell.moduleEnabled('planner');
  const memoryOn = shell.moduleEnabled('memory');
  const reminders = useLive<Reminder[]>(async () => (plannerOn ? window.fuber.invoke('planner.listReminders', {}) : []), ['planner.changed'], [plannerOn]);
  const memory = useLive<MemoryItem[]>(async () => (memoryOn ? window.fuber.invoke('memory.list', { limit: 30 }) : []), ['memory.changed'], [memoryOn]);
  const talk = shell.hotkeys.find((hotkey) => hotkey.id === 'talk' && hotkey.registered);
  const upcoming = [...(reminders.data ?? [])].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 4);
  const recent = (memory.data ?? []).filter((item) => item.status === 'active' && !item.reminderId).slice(0, 3);
  // Açık yetenekler: gerçekten yüklü ve araçları kayıtlı modüller (ne sorulabileceğinin gerçek listesi).
  const abilities = (shell.modules ?? []).filter((module) => module.enabled && module.tools.length > 0 && hasMessage(module.nameKey) && hasMessage(module.descriptionKey));

  return (
    <>
      {upcoming.length > 0 && (
        <ContextSection title={t('chat.context.upcoming')} action={<Jump label={t('nav.planner')} onPress={() => shell.navigate('planner')} />} data-testid="chat-context-upcoming">
          <ul className="flex flex-col">
            {upcoming.map((reminder) => (
              <Line key={reminder.id} text={reminder.text} meta={capitalize(relativeDateTime(reminder.dueAt))} onPress={() => onPick(t('chat.context.askReminder', { text: reminder.text }))} />
            ))}
          </ul>
        </ContextSection>
      )}

      {recent.length > 0 && (
        <ContextSection title={t('chat.context.recent')} action={<Jump label={t('nav.memory')} onPress={() => shell.navigate('memory')} />} data-testid="chat-context-recent">
          <ul className="flex flex-col">
            {recent.map((item) => (
              <Line key={item.id} text={item.text} meta={capitalize(relativeTime(item.at))} />
            ))}
          </ul>
        </ContextSection>
      )}

      {abilities.length > 0 && (
        <ContextSection
          title={t('chat.context.abilities')}
          action={<Jump label={t('chat.context.abilitiesCount', { count: abilities.length })} onPress={() => shell.navigate('skills')} />}
          data-testid="chat-context-abilities"
        >
          <dl className="flex flex-col gap-3">
            {abilities.slice(0, upcoming.length + recent.length > 0 ? 3 : ABILITY_PREVIEW).map((module) => (
              <div key={module.id} className="flex flex-col">
                <dt className="text-sm font-medium text-fg">{t(module.nameKey as MessageKey)}</dt>
                <dd className="m-0 text-sm text-fg-muted">{t(module.descriptionKey as MessageKey)}</dd>
              </div>
            ))}
          </dl>
        </ContextSection>
      )}

      {talk && (
        <ContextSection title={t('chat.context.hotkey')} data-testid="chat-context-how">
          <dl className="flex flex-col gap-2">
            <Fact label={t('chat.context.byVoice')}>
              <KeyHint keys={acceleratorKeys(talk.accelerator)} size="sm" />
            </Fact>
          </dl>
        </ContextSection>
      )}
    </>
  );
}
