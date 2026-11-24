// Brifing modülü: Jarvis'in kendiliğinden konuşması. Sabah karşılaması ("Günaydın …, bugün şunlar var; haberlere
// baktım, sizi ilgilendirebilecek üç gelişme…"), gün içi kısa güncellemeler ve önemli gelişmede araya girme.
//
//   ayarlar ve sesle ayar            prefs.ts
//   kapılar ve ilgiye göre azalma    gates.ts (saf; sessiz saat, toplantı, tam ekran, saatlik/günlük sınır, kullanıcı konuşurken girmez)
//   içerik                           compose.ts (takvim, son günler, işler, e-posta, kişisel gündem; şablonla, model çağrısı yok)
//   zamanlama, teslim, öğrenme       engine.ts
//   araçlar                          tools.ts (briefing_now, briefing_set, briefing_status)
//
// Ses ve ada Dikkat Yöneticisi üzerinden gider (KURGU §8); brifing ayrıca Bugün panosunda karttır. Gündem `news`
// modülünden, kişiselleştirme hafıza modülünün profil katmanından gelir (ikisi de kapalıyken brifing yine çalışır).
import { addDays, daysBetween, dashboard, defineModule, fromLocal, isWithinLocalTimeRange, localDay, localTime, t, UserError, type LocalDay, type ModuleContext, type Unsubscribe } from '@fuber/shared';
import type { BrainService } from '../../core/brain';
import { testing } from '../../testing';
import type { MailQueryEvent } from '../mail/types';
import { activeProfile } from '../memory/profile/access';
import { activeNews, setNewsInterestProvider } from '../news/access';
import { createPlannerRepo } from '../planner/repo';
import type { BriefingSources } from './compose';
import { createBriefingEngine, type BriefingEngine } from './engine';
import { BRIEFING_MIGRATIONS } from './prefs';
import { briefingTools } from './tools';
import type { Briefing } from './types';
import './types';

export const MODULE_ID = 'briefing';
export const BRIEFING_CARD_ID = 'briefing';
const TICK_MS = 60_000;
const FIRST_TICK_MS = 20_000;

declare module '@fuber/shared' {
  interface BusEvents {
    /**
     * Planlar modülü sabah/akşam özetini bildirmeden önce yayınlar. Brifing modülü sabah brifingini kendisi veriyorsa
     * `handled`'ı `true` yapar ve planlar aynı özeti ikinci kez bildirmez (aynı bildirim `planner/types.ts` içinde de var).
     */
    'planner.brief.before': { kind: 'morning' | 'evening'; handled: boolean };
  }
}

interface Runtime {
  engine: BriefingEngine;
  dispose(): void;
}

let runtime: Runtime | null = null;
/** Sınama: sahte saat (`__fuber2Test.briefing.setNow`). Üretimde hiç atanmaz. */
let clockOverride: number | null = null;
let clockSetAt = 0;

const live = (): BriefingEngine => {
  if (!runtime) throw new UserError(t('briefing.error.off'));
  return runtime.engine;
};

/** Modülün saati: sınamada verilen andan itibaren gerçek hızla akar. */
const nowDate = (): Date => (clockOverride === null ? new Date() : new Date(clockOverride + (Date.now() - clockSetAt)));

export function briefingSources(ctx: ModuleContext, now: () => Date = nowDate): BriefingSources {
  const moduleOn = (id: string) => ctx.policy.moduleAllowed(id) && !ctx.settings.get().disabledModules.includes(id);
  const safe = <T,>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch (error) {
      ctx.log.debug(`brifing: okuma atlandı (${error instanceof Error ? error.message : String(error)})`);
      return fallback;
    }
  };
  return {
    address: () => ctx.settings.get().userAddress?.trim() || ctx.policy.get().persona.address,

    agenda(day: LocalDay) {
      if (!moduleOn('planner')) return [];
      return safe(() => {
        const repo = createPlannerRepo(ctx);
        const start = fromLocal(day);
        const end = fromLocal(addDays(day, 1));
        const today = repo
          .listReminders({ status: ['scheduled'], from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() })
          .filter((reminder) => Date.parse(reminder.dueAt) >= now().getTime() - 60_000)
          .map((reminder) => ({ time: localTime(reminder.dueAt), text: reminder.text, overdue: false }));
        const overdue = repo
          .listReminders({ status: ['fired'] })
          .slice(0, 3)
          .map((reminder) => ({ time: null, text: reminder.text, overdue: true }));
        return [...today, ...overdue];
      }, []);
    },

    tasks(day: LocalDay) {
      if (!moduleOn('planner')) return { due: [], open: 0 };
      return safe(() => {
        const todos = createPlannerRepo(ctx).listTodos(false);
        const due = todos.filter((todo) => todo.dueDay !== null && todo.dueDay <= day);
        return { due: due.slice(0, 5).map((todo) => (todo.dueDay! < day ? `${todo.text} ${t('briefing.overdue')}` : todo.text)), open: todos.length - due.length };
      }, { due: [], open: 0 });
    },

    mail() {
      if (!moduleOn('mail')) return null;
      return safe(() => {
        const event: MailQueryEvent = { query: { unreadOnly: true, minImportance: 4, since: new Date(now().getTime() - 3 * 86_400_000).toISOString(), limit: 5 }, result: null };
        ctx.bus.emit('mail.query', event);
        const result = event.result as MailQueryEvent['result'];
        if (!result?.available) return null;
        return { count: result.hits.length, items: result.hits.slice(0, 3).map((hit) => `${hit.from || hit.fromAddress}: ${hit.subject.slice(0, 80)}`) };
      }, null);
    },

    news(limit, since) {
      const news = activeNews();
      if (!news) return [];
      return safe(() => news.stories({ limit, unreadOnly: true, ...(since ? { since } : {}) }), []);
    },
  };
}

/** Sessiz saat ya da "rahatsız etme" (Dikkat Yöneticisi ile aynı kural). */
function quietNow(ctx: ModuleContext, now: Date): boolean {
  const settings = ctx.settings.get();
  if (settings.dnd && (!settings.dndUntil || Date.parse(settings.dndUntil) > now.getTime())) return true;
  return settings.quietHours.enabled && isWithinLocalTimeRange(now, settings.quietHours.from, settings.quietHours.to);
}

export default defineModule({
  id: MODULE_ID,
  version: '1.0.0',
  nameKey: 'module.briefing.name',
  descriptionKey: 'module.briefing.description',
  permissions: [],
  migrations: BRIEFING_MIGRATIONS,
  windowEvents: ['briefing.changed'],

  tools: briefingTools(live),

  ipc: () => ({
    'briefing.state': () => live().state(),
    'briefing.setPrefs': ({ patch }) => live().setPrefs(patch),
    'briefing.runNow': ({ speak }) => live().runNow({ speak: speak === true }),
    'briefing.feedback': ({ id, response }) => live().feedback(id, response),
    'briefing.resetAdaptive': () => live().resetAdaptive(),
  }),

  setup(ctx) {
    const offs: Unsubscribe[] = [];
    const engine = createBriefingEngine({
      db: ctx.db,
      now: nowDate,
      sources: briefingSources(ctx),
      presence: () => ctx.presence.get(),
      quiet: () => quietNow(ctx, nowDate()),
      killSwitch: () => ctx.policy.killSwitchActive(),
      voice: () => {
        try {
          const status = ctx.voice.status();
          return { state: status.state, quiet: status.quiet, conversation: status.conversation };
        } catch {
          return { state: 'idle', quiet: false, conversation: false };
        }
      },
      notify: (request) => ctx.attention.notify(request),
      appendTranscript(text) {
        const session = ctx.conversation.currentSession('voice');
        ctx.conversation.appendMessage({ sessionId: session.id, role: 'assistant', text, channel: 'voice' });
      },
      news: () => activeNews(),
      learn(text) {
        activeProfile()?.note({ category: 'preference', key: 'brifing-sikligi', text, explicit: false, channel: 'system' });
      },
      log: ctx.log,
      onChange(reason) {
        ctx.bus.emit('briefing.changed', { reason });
        dashboard.invalidate(BRIEFING_CARD_ID);
      },
    });

    // Gündemin kişiselleştirmesi profilden: ilgi alanları öne çıkar, sevmedikleri elenir.
    setNewsInterestProvider(() => activeProfile()?.interests() ?? { follow: [], mute: [] });

    // Kendiliğinden adım (zamanlayıcı ve olaylar). İki durumda ATILMAZ:
    //  - sınama kipinde: her uçtan uca koşunun açılışında sabah brifingi söylenir, ada ve bildirim açılırdı (başka
    //    sınamaların beklediği "boşta" durumu bozulur); sınama adımı kendisi atar (`__fuber2Test.briefing.tick`);
    //  - kurulum bitmeden: sihirbaz sürerken Jarvis kendiliğinden konuşmaz.
    const auto = () => {
      if (testing.enabled || !ctx.settings.get().setupCompletedAt) return;
      void engine.tick();
    };
    let pending: ReturnType<typeof setTimeout> | null = null;
    const soon = (delayMs = 1500) => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        auto();
      }, delayMs);
      pending.unref?.();
    };
    const interval = setInterval(auto, TICK_MS);
    interval.unref?.();
    soon(FIRST_TICK_MS);

    offs.push(
      ctx.bus.on('presence.changed', () => soon()),
      ctx.bus.on('settings.changed', () => soon()),
      ctx.bus.on('news.changed', ({ reason }) => {
        if (reason === 'refresh') soon();
      }),
      ctx.bus.on('voice.state', ({ state }) => {
        if (state === 'idle') soon(4000);
      }),
      ctx.bus.on('conversation.turn', (turn) => {
        try {
          const user = ctx.conversation.messages(turn.sessionId, { limit: 4 }).find((message) => message.id === turn.userMessageId);
          if (user) engine.onUserTurn(user.text);
        } catch (error) {
          ctx.log.debug(`brifing: tur okunamadı (${error instanceof Error ? error.message : String(error)})`);
        }
      }),
      ctx.bus.on('attention.notify', ({ notification, channel }) => {
        if (notification.moduleId === MODULE_ID) engine.onShown(notification, channel);
      }),
      ctx.bus.on('attention.action', ({ moduleId, actionId, data }) => {
        if (moduleId === MODULE_ID && typeof data.briefingId === 'string') engine.onAction(data.briefingId, actionId);
      }),
      ctx.bus.on('tool.call', (call) => {
        if (call.phase === 'end' && call.name === 'voice_stop_speaking') engine.onHush();
      }),
      // Sabah brifingini biz veriyorsak planlar modülü aynı özeti ikinci kez bildirmez.
      ctx.bus.on('planner.brief.before', (box) => {
        const prefs = engine.prefs();
        if (box.kind === 'morning' && prefs.enabled && prefs.morning.enabled) box.handled = true;
      }),
      dashboard.registerProvider<Briefing>({
        id: BRIEFING_CARD_ID,
        kind: 'briefing',
        moduleId: MODULE_ID,
        title: t('briefing.card.title'),
        defaultSize: 'wide',
        priority: 96,
        page: 'settings',
        events: ['briefing.changed', 'module.changed'],
        fill() {
          const briefing = engine.today();
          return briefing ? { data: briefing } : null;
        },
      }),
    );

    // Öz-tanım: brifing asistanın "değiştirebildiklerim" arasındadır (sabit metin; sabit sistem istemine girer).
    const brain = ctx.brain as Partial<BrainService>;
    let attached: Partial<BrainService> | null = null;
    try {
      brain.attachSelfPart?.(MODULE_ID, () => ({ canChange: [t('briefing.self.canChange')] }));
      attached = brain;
    } catch (error) {
      ctx.log.debug(`öz-tanım parçası bağlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }

    testing.expose({
      briefing: {
        /** Sahte saat: verilen andan itibaren gerçek hızla akar; `null` gerçek saate döner. */
        setNow(iso: string | null) {
          clockOverride = iso === null ? null : Date.parse(iso);
          clockSetAt = Date.now();
        },
        tick: () => engine.tick(),
        state: () => engine.state(),
        runNow: (speak = false) => engine.runNow({ speak }),
        userTurn: (text: string) => engine.onUserTurn(text),
      },
    });

    runtime = {
      engine,
      dispose() {
        clearInterval(interval);
        if (pending) clearTimeout(pending);
        for (const off of offs.splice(0)) off();
        setNewsInterestProvider(null);
        try {
          attached?.attachSelfPart?.(MODULE_ID, null);
        } catch {
          // beyin yer tutucusu
        }
      },
    };
  },

  teardown() {
    runtime?.dispose();
    runtime = null;
    clockOverride = null;
  },

  purge(ctx) {
    ctx.db.run('DELETE FROM briefing_log');
    ctx.db.run('DELETE FROM briefing_state');
    dashboard.invalidate(BRIEFING_CARD_ID);
  },
});
