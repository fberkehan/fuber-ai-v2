// Profil servisi: öğrenme yolları (açık söz, model çıkarımı, davranış işaretleri, tanışma yanıtı) tek kapıdan depoya
// girer; istem bağlamı ve "Beni nasıl tanıyorsun" görünümü buradan okunur.
import { localDay, type Id, type Logger, type PresenceState } from '@fuber/shared';
import type { UserContext } from '../../../core/brain/prompt';
import { introState, introTurn, setIntroEnabled } from './intro';
import { explicitLearnings, topicOf, type Learned } from './learn';
import type { LearnOutcome, ProfileStore } from './store';
import { buildOverview, plainText, renderProfileContext } from './summary';
import type { ProfileCategory, ProfileIntroState, ProfileItem, ProfileOverview } from './types';

export interface TurnInfo {
  channel: 'voice' | 'chat';
  sessionId: Id | null;
  messageId: Id | null;
  userText: string;
  /** Asistanın BİR ÖNCEKİ yanıtı (düzeltme ona gönderme yapıyorsa kuralın yanına yazılır). */
  previousReply: string | null;
  /** Bu turda başarıyla çalışan araçların adları. */
  tools: string[];
}

export interface ProfileService {
  store: ProfileStore;
  /** Beynin kancası: her kişilikli turda isteme giren kullanıcı bağlamı. */
  context(input: { text: string; compact: boolean; conversational: boolean }): UserContext | null;
  /** Tur bitti: kullanıcının açık sözlerinden ve davranış işaretlerinden öğren. Yazılan/değişen kayıtlar döner. */
  learnFromTurn(turn: TurnInfo): LearnOutcome[];
  /** Modelin (hafıza yazıcısı ya da `profile_note` aracı) verdiği kayıt. */
  note(input: { category: ProfileCategory; key?: string | null; text: string; explicit: boolean; channel: ProfileItem['channel']; sessionId?: Id | null; messageId?: Id | null }): LearnOutcome;
  /** Onay kartının sonucu (onay / ret): yinelenen retten öğrenilir. */
  observeApproval(toolName: string, summary: string, approved: boolean): LearnOutcome | null;
  overview(): ProfileOverview;
  intro(): ProfileIntroState;
  setIntro(enabled: boolean): ProfileIntroState;
  /** Haber puanlaması için: ilgi alanları ve sevmedikleri (konu sözcükleri). */
  interests(): { follow: string[]; mute: string[] };
  /** Rutin kayıtları (brifing kişiselleştirmesi). */
  routines(): ProfileItem[];
  /** Depoya doğrudan yazıldıktan sonra (elle düzeltme, silme) değişikliği yayınlar. */
  notify(reason: 'learned' | 'edited' | 'removed' | 'intro', ids: Id[]): void;
}

export interface ProfileServiceDeps {
  store: ProfileStore;
  now?: () => Date;
  presence?: () => PresenceState | null;
  log: Pick<Logger, 'info' | 'warn' | 'debug'>;
  /** Kayıt değişince çağrılır (olay yayını). */
  onChange?(reason: 'learned' | 'edited' | 'removed' | 'intro', ids: Id[]): void;
}

/** Yinelenen isteklerden rutin: araç → kullanıcının ne yaptığı. Yalnız anlamlı, yinelenebilir istekler. */
const ROUTINE_TOOLS: Readonly<Record<string, string>> = {
  weather_get: 'hava durumunu sorar',
  fx_rate: 'döviz kurlarına bakar',
  news_get: 'haberleri sorar',
  feed_news: 'gündemi sorar',
  mail_list: 'e-postalarını sorar',
  reminder_list: 'günün hatırlatıcılarını sorar',
  todo_list: 'yapılacaklarını sorar',
  briefing_now: 'brifing ister',
  watch_list: 'takip işlerinin durumunu sorar',
};

const BUCKETS: ReadonlyArray<{ id: string; from: number; to: number; label: string }> = [
  { id: 'sabah', from: 5, to: 11, label: 'Sabahları' },
  { id: 'ogle', from: 11, to: 14, label: 'Öğle saatlerinde' },
  { id: 'ogleden-sonra', from: 14, to: 18, label: 'Öğleden sonraları' },
  { id: 'aksam', from: 18, to: 23, label: 'Akşamları' },
];

/** Bir isteğin rutin sayılması için gereken farklı gün sayısı (son `ROUTINE_WINDOW_DAYS` günde). */
export const ROUTINE_MIN_DAYS = 3;
export const ROUTINE_WINDOW_DAYS = 14;
/** Aynı işin bu kadar reddi (ve hiç onayı yokken) öğrenilir. */
export const DENY_MIN = 2;

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const changed = (reason: 'learned' | 'edited' | 'removed' | 'intro', outcomes: LearnOutcome[]) => {
    const ids = outcomes.flatMap((outcome) => (outcome.kind === 'skipped' ? [] : [outcome.item.id]));
    if (ids.length) deps.onChange?.(reason, ids);
  };

  const apply = (learned: Learned, origin: { channel: ProfileItem['channel']; sessionId: Id | null; messageId: Id | null }): LearnOutcome =>
    store.learn({ category: learned.category, key: learned.key, text: learned.text, confidence: learned.confidence, origin: learned.origin, channel: origin.channel, sessionId: origin.sessionId, messageId: origin.messageId });

  const api: ProfileService = {
    store,

    context(input) {
      let note: string | null = null;
      // Tanışma yalnız kullanıcıyla konuşulan turda değerlendirilir: arka plan görevinin metni bekleyen soruya yanıt sayılmasın.
      if (input.conversational && input.text.trim()) {
        try {
          const turn = introTurn(store, { text: input.text, now: now(), presence: deps.presence?.() ?? null, conversational: input.conversational });
          note = turn.note;
          if (turn.answer) changed('learned', [store.learn({ category: turn.answer.category, key: turn.answer.key, text: turn.answer.text, confidence: 1, origin: 'intro', channel: 'system' })]);
          if (turn.declined) deps.onChange?.('intro', []);
        } catch (error) {
          deps.log.warn('tanışma değerlendirilemedi', error);
        }
      }
      const rendered = renderProfileContext(store, { compact: input.compact, text: input.text });
      if (!rendered.summary && rendered.details.length === 0 && !note) return null;
      // Yerel modelde tanışma notu verilmez: küçük model soruyu yersiz yere ve her yanıtta sorabiliyor.
      return { summary: rendered.summary, details: rendered.details, note: input.compact ? null : note };
    },

    learnFromTurn(turn) {
      const outcomes: LearnOutcome[] = [];
      const origin = { channel: turn.channel, sessionId: turn.sessionId, messageId: turn.messageId };
      for (const learned of explicitLearnings(turn.userText, turn.previousReply)) outcomes.push(apply(learned, origin));

      // Yinelenen istek: aynı araç, günün aynı diliminde, farklı günlerde.
      const at = now();
      const hour = at.getHours();
      const bucket = BUCKETS.find((candidate) => hour >= candidate.from && hour < candidate.to);
      if (bucket) {
        for (const name of new Set(turn.tools)) {
          const what = ROUTINE_TOOLS[name];
          if (!what) continue;
          const seen = store.bumpSignal(`tool:${name}:${bucket.id}`, localDay(at), ROUTINE_WINDOW_DAYS);
          if (seen.days >= ROUTINE_MIN_DAYS) {
            outcomes.push(
              store.learn({
                category: 'routine',
                key: `istek-${name}-${bucket.id}`,
                text: `${bucket.label} genelde ${what}.`,
                confidence: Math.min(0.85, 0.6 + 0.05 * (seen.days - ROUTINE_MIN_DAYS)),
                origin: 'observed',
                channel: 'system',
                sessionId: turn.sessionId,
                messageId: turn.messageId,
              }),
            );
          }
        }
      }
      const written = outcomes.filter((outcome) => outcome.kind !== 'skipped' && outcome.kind !== 'confirmed');
      if (written.length) deps.log.info(`profil: ${written.length} kayıt öğrenildi`);
      changed('learned', outcomes);
      return outcomes;
    },

    note(input) {
      const outcome = store.learn({
        category: input.category,
        key: input.key ?? null,
        text: input.text,
        confidence: input.explicit ? 1 : 0.7,
        origin: input.explicit ? 'said' : 'inferred',
        channel: input.channel,
        sessionId: input.sessionId ?? null,
        messageId: input.messageId ?? null,
      });
      changed('learned', [outcome]);
      return outcome;
    },

    observeApproval(toolName, summary, approved) {
      const day = localDay(now());
      const key = `approval:${toolName}:${approved ? 'yes' : 'no'}`;
      store.bumpSignal(key, day, 60);
      if (approved) return null;
      const since = new Date(now().getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
      const denied = store.signal(`approval:${toolName}:no`, since).total;
      const allowed = store.signal(`approval:${toolName}:yes`, since).total;
      if (denied < DENY_MIN || allowed > 0) return null;
      const outcome = store.learn({
        category: 'dislike',
        key: `onay-${toolName}`,
        text: `Şu tür işi onaylamıyor (${denied} kez reddetti): ${summary.replace(/\s+/g, ' ').trim().slice(0, 120)}. Sorulmadan önerme.`,
        confidence: Math.min(0.85, 0.5 + 0.1 * denied),
        origin: 'observed',
        channel: 'system',
      });
      changed('learned', [outcome]);
      return outcome;
    },

    overview: () => buildOverview(store, introState(store), now()),
    intro: () => introState(store),
    setIntro(enabled) {
      const state = setIntroEnabled(store, enabled, now());
      deps.onChange?.('intro', []);
      return state;
    },

    interests() {
      // Bir kayıt birden çok konu sayabilir ("yapay zekâ, girişimcilik ve ekonomi"): her biri ayrı konudur.
      const topics = (category: ProfileCategory) =>
        store
          .list({ category })
          .filter((item) => !item.key.startsWith('onay-'))
          .flatMap((item) => item.text.replace(/^[^:“]{0,40}\(kendi anlatımı\):\s*/, '').replace(/[“”]/g, '').split(/[,;]|\s+ve\s+|\s+veya\s+|\s+ile\s+/))
          .map((piece) => topicOf(plainText(piece)))
          .filter((topic) => topic.length >= 2 && topic.split(/\s+/).length <= 3);
      return { follow: [...new Set(topics('interest'))], mute: [...new Set(topics('dislike'))] };
    },

    routines: () => store.list({ category: 'routine' }),
    notify: (reason, ids) => deps.onChange?.(reason, ids),
  };
  return api;
}
