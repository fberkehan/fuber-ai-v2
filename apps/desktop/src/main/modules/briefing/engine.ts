// Brifing motoru: ne zaman konuşulacağı (sabah, gün içi güncelleme, önemli gelişme), kapılar, teslim (Dikkat
// Yöneticisi üzerinden: ses + ada; kart her durumda), kullanıcının tepkisinden öğrenme. Saat dışarıdan verilir.
import { addDays, foldForSearch, fromLocal, localDay, t, type Id, type IsoDateTime, type JsonValue, type Logger, type Notification, type NotifyRequest, type PresenceState, type ScopedDb, type VoiceState } from '@fuber/shared';
import type { NewsStory } from '../news/types';
import { composeBriefing, hasContent, type BriefingSources } from './compose';
import {
  applyEngagement,
  dailyBreakingLimit,
  dailyUpdateLimit,
  DECLINE_WORDS,
  isTransient,
  MORNING_WINDOW_MS,
  RESPONSE_WINDOW_MS,
  speakGate,
  type Engagement,
  type GateInput,
  type GateReason,
} from './gates';
import { createKv, DEFAULT_ADAPTIVE, DEFAULT_PREFS, mergePrefs, normalizePrefs, type PrefsPatch } from './prefs';
import type { Briefing, BriefingAdaptive, BriefingKind, BriefingPrefs, BriefingState } from './types';

/** Gün içi güncellemede haberin söylenmeye değer sayılması için en düşük puan (takip/ilgi eşleşmesi bunu aşar). */
export const UPDATE_MIN_SCORE = 55;
/** Güncelleme en az bu kadar yeni haber olunca yapılır (takip edilen konudaki tek haber de yeter). */
export const UPDATE_MIN_STORIES = 2;
/** Haberleri tazelerken en çok bu kadar beklenir; ağ yavaşsa eldeki başlıklarla devam edilir. */
const REFRESH_WAIT_MS = 8000;

export interface EngineNews {
  stories(query: { limit?: number; unreadOnly?: boolean; since?: IsoDateTime }): NewsStory[];
  breaking(sinceIso: string): NewsStory[];
  refresh(): Promise<unknown>;
  markRead(ids: Id[]): void;
}

export interface EngineDeps {
  db: ScopedDb;
  now(): Date;
  sources: BriefingSources;
  presence(): PresenceState;
  /** Sessiz saat ya da "rahatsız etme" açık mı. */
  quiet(): boolean;
  killSwitch(): boolean;
  voice(): { state: VoiceState; quiet: boolean; conversation: boolean };
  notify(request: NotifyRequest): Notification;
  /** Sesle söylenen brifing sohbet dökümüne düşer: kullanıcı "ikincisini anlat" dediğinde beyin neyi söylediğini bilir. */
  appendTranscript(text: string): void;
  news(): EngineNews | null;
  /** Öğrenilen konuşma tercihi profile yazılır (profil katmanı kapalıysa çağrılmaz). */
  learn?(text: string): void;
  log: Pick<Logger, 'info' | 'warn' | 'debug'>;
  onChange(reason: 'prefs' | 'briefing' | 'adaptive'): void;
}

export interface BriefingEngine {
  state(): BriefingState;
  prefs(): BriefingPrefs;
  setPrefs(patch: PrefsPatch): BriefingState;
  resetAdaptive(): BriefingState;
  /** Brifingi şimdi hazırlar (kart güncellenir); `speak` ise sesle de söyler. */
  runNow(options?: { speak?: boolean }): Promise<Briefing>;
  feedback(id: Id, response: 'engaged' | 'declined'): BriefingState;
  /** Dakikada bir ve durum değişince çağrılır: vakti gelen brifingi verir, yanıtsız kalanı işler. */
  tick(): Promise<void>;
  /** Kullanıcı bir tur konuştu / yazdı. */
  onUserTurn(text: string): void;
  /** Bildirim gerçekten gösterildi/söylendi (bekletilen bildirim sonradan çıkabilir). */
  onShown(notification: Notification, channel: string): void;
  /** Bildirim eylemi ("Bugün yeter") ya da kullanıcının kapatması. */
  onAction(briefingId: Id, action: string): void;
  /** Kullanıcı "sus" dedi (konuşmayı kesti). */
  onHush(): void;
  /** Bugünün kartı. */
  today(): Briefing | null;
  reasonText(reason: GateReason): string;
}

interface LogRow {
  id: string;
  kind: string;
  day: string;
  at: string;
  delivered: string;
  response: string;
  spoken_at: string | null;
  data: string;
}

interface Awaiting {
  id: Id;
  spokenAt: IsoDateTime;
}

const REASON_KEY = {
  ok: 'briefing.reason.ok',
  disabled: 'briefing.reason.disabled',
  silent: 'briefing.reason.silent',
  learned_silent: 'briefing.reason.learnedSilent',
  level: 'briefing.reason.level',
  kill_switch: 'briefing.reason.killSwitch',
  quiet_hours: 'briefing.reason.quietHours',
  fullscreen: 'briefing.reason.fullscreen',
  meeting: 'briefing.reason.meeting',
  voice_quiet: 'briefing.reason.voiceQuiet',
  user_speaking: 'briefing.reason.userSpeaking',
  away: 'briefing.reason.away',
  hourly_limit: 'briefing.reason.hourlyLimit',
  daily_limit: 'briefing.reason.dailyLimit',
  min_gap: 'briefing.reason.minGap',
  outside_hours: 'briefing.reason.outsideHours',
} as const satisfies Record<GateReason, string>;

export function createBriefingEngine(deps: EngineDeps): BriefingEngine {
  const kv = createKv(deps.db);
  const now = () => deps.now();
  let busy = false;

  const prefs = (): BriefingPrefs => normalizePrefs(kv.get<JsonValue>('prefs'), DEFAULT_PREFS);
  const adaptive = (): BriefingAdaptive => ({ ...DEFAULT_ADAPTIVE, ...((kv.get<JsonValue>('adaptive') as unknown as Partial<BriefingAdaptive> | undefined) ?? {}) });
  const saveAdaptive = (value: BriefingAdaptive) => kv.set('adaptive', value as unknown as JsonValue);

  const toBriefing = (row: LogRow): Briefing => ({ ...(JSON.parse(row.data) as Briefing), delivered: row.delivered as Briefing['delivered'], response: row.response as Briefing['response'] });
  const rowOf = (id: Id) => deps.db.get<LogRow>('SELECT * FROM briefing_log WHERE id = ?', [id]);
  const save = (briefing: Briefing, spokenAt: IsoDateTime | null) => {
    deps.db.run(
      `INSERT INTO briefing_log (id, kind, day, at, delivered, response, spoken_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET delivered = excluded.delivered, response = excluded.response, spoken_at = COALESCE(excluded.spoken_at, briefing_log.spoken_at), data = excluded.data`,
      [briefing.id, briefing.kind, briefing.day, briefing.at, briefing.delivered, briefing.response, spokenAt, JSON.stringify(briefing)],
    );
    // Geçmiş 30 gün tutulur.
    deps.db.run('DELETE FROM briefing_log WHERE day < ?', [addDays(localDay(now()), -30)]);
  };

  const countSpoken = (where: string, params: Array<string | number>): number =>
    deps.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM briefing_log WHERE spoken_at IS NOT NULL AND ${where}`, params)?.n ?? 0;
  const lastSpoken = (kind?: BriefingKind): number | null => {
    const row = kind
      ? deps.db.get<{ at: string | null }>('SELECT MAX(spoken_at) AS at FROM briefing_log WHERE kind = ?', [kind])
      : deps.db.get<{ at: string | null }>('SELECT MAX(spoken_at) AS at FROM briefing_log');
    return row?.at ? Date.parse(row.at) : null;
  };

  const gateInput = (kind: BriefingKind): GateInput => {
    const at = now();
    const day = localDay(at);
    const voice = deps.voice();
    return {
      kind,
      now: at,
      prefs: prefs(),
      adaptive: adaptive(),
      presence: deps.presence(),
      quiet: deps.quiet(),
      killSwitch: deps.killSwitch(),
      voiceState: voice.state,
      voiceQuiet: voice.quiet,
      conversation: voice.conversation,
      spokenLastHour: countSpoken('spoken_at >= ?', [new Date(at.getTime() - 3_600_000).toISOString()]),
      updatesToday: countSpoken(`day = ? AND kind = 'update'`, [day]),
      breakingToday: countSpoken(`day = ? AND kind = 'breaking'`, [day]),
      lastSpokenAt: lastSpoken(),
      lastUpdateAt: lastSpoken('update'),
    };
  };

  /** Kullanıcı bugün "yeter" dedi: gün bitene dek kendiliğinden konuşulmaz. */
  const mutedToday = (): boolean => kv.get<string>('mutedDay') === localDay(now());
  const gate = (kind: BriefingKind): GateReason => (kind !== 'manual' && mutedToday() ? 'disabled' : speakGate(gateInput(kind)));

  const reasonText = (reason: GateReason): string => t(REASON_KEY[reason]);

  const refreshNews = async () => {
    const news = deps.news();
    if (!news) return;
    try {
      await Promise.race([news.refresh(), new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS).unref?.())]);
    } catch (error) {
      deps.log.debug(`haberler yenilenemedi: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const cardBody = (briefing: Briefing): string =>
    briefing.sections
      .flatMap((section) => [`${section.title}:`, ...section.lines.slice(0, 4).map((line) => `· ${line}`)])
      .join('\n')
      .slice(0, 900);

  /** Brifingi teslim eder: kapı açıksa ses (Dikkat Yöneticisi üzerinden), değilse yalnız kart. */
  const deliver = (briefing: Briefing, speak: boolean, reason: GateReason): Briefing => {
    let spokenAt: IsoDateTime | null = null;
    if (speak && briefing.spoken) {
      const notification = deps.notify({
        moduleId: 'briefing',
        title: briefing.greeting,
        body: cardBody(briefing),
        priority: 'high',
        speak: briefing.spoken,
        dedupeKey: `briefing.${briefing.id}`,
        data: { briefingId: briefing.id },
        actions: briefing.kind === 'manual' ? [] : [{ id: 'enough', label: t('briefing.action.enough'), kind: 'secondary' }],
      });
      if (notification.channel === 'voice') {
        briefing.delivered = 'voice';
        spokenAt = now().toISOString();
      } else if (notification.channel === 'deferred' || notification.status === 'pending') {
        briefing.delivered = 'deferred';
        briefing.reason = t('briefing.reason.deferred');
      } else {
        // Toplantı: Dikkat Yöneticisi sessiz toast gösterdi.
        briefing.delivered = 'card';
        briefing.reason = t('briefing.reason.meeting');
      }
    } else {
      briefing.delivered = hasContent(briefing) || briefing.kind === 'morning' || briefing.kind === 'manual' ? 'card' : 'skipped';
      briefing.reason = reason === 'ok' ? null : reasonText(reason);
    }
    save(briefing, spokenAt);
    if (spokenAt) afterSpoken(briefing, spokenAt);
    deps.onChange('briefing');
    return briefing;
  };

  const afterSpoken = (briefing: Briefing, spokenAt: IsoDateTime) => {
    try {
      deps.appendTranscript(briefing.spoken);
    } catch (error) {
      deps.log.debug(`brifing dökümü yazılamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Söylenen haberler okundu sayılır: bir sonraki güncellemede yinelenmez.
    try {
      if (briefing.news.length) deps.news()?.markRead(briefing.news.map((item) => item.id));
    } catch {
      // gündem modülü kapandı
    }
    if (briefing.kind !== 'manual') kv.set('awaiting', { id: briefing.id, spokenAt } satisfies Awaiting as unknown as JsonValue);
    deps.log.info(`brifing söylendi: ${briefing.kind}`);
  };

  const engagement = (signal: Engagement, briefingId: Id | null) => {
    const kind = (briefingId ? (rowOf(briefingId)?.kind as BriefingKind | undefined) : undefined) ?? 'update';
    const change = applyEngagement(adaptive(), signal, now(), { down: t('briefing.adaptive.down'), up: t('briefing.adaptive.up') }, kind);
    saveAdaptive(change.adaptive);
    kv.set('awaiting', null);
    if (briefingId) {
      const row = rowOf(briefingId);
      if (row && row.response === 'pending') deps.db.run('UPDATE briefing_log SET response = ? WHERE id = ?', [signal, briefingId]);
    }
    if (change.stepped) {
      deps.log.info(`brifing konuşkanlığı ${change.stepped === 'down' ? 'azaldı' : 'arttı'}: çarpan ${change.adaptive.factor}`);
      try {
        deps.learn?.(t(change.stepped === 'down' ? 'briefing.learned.down' : 'briefing.learned.up'));
      } catch {
        // profil katmanı kapalı
      }
    }
    deps.onChange('adaptive');
  };

  const awaiting = (): Awaiting | null => (kv.get<JsonValue>('awaiting') as unknown as Awaiting | null | undefined) ?? null;

  /** Sabah brifingi: vakti geldiyse ve bugün verilmediyse. Kullanıcı bilgisayar başına gelene dek bekler. */
  const morning = async (): Promise<void> => {
    const current = prefs();
    if (!current.enabled || !current.morning.enabled) return;
    const at = now();
    const day = localDay(at);
    const due = fromLocal(day, current.morning.time);
    if (at.getTime() < due.getTime()) return;
    const done = deps.db.get<{ id: string }>(`SELECT id FROM briefing_log WHERE day = ? AND kind = 'morning'`, [day]);
    if (done) return;
    const late = at.getTime() - due.getTime() > MORNING_WINDOW_MS;
    const reason = gate('morning');
    if (reason !== 'ok' && isTransient(reason) && !late) return;
    await refreshNews();
    const briefing = composeBriefing({ kind: 'morning', now: now(), prefs: current, sources: deps.sources });
    // Tazeleme sürerken durum değişmiş olabilir: kapı yeniden sorulur.
    const final = late ? reason : gate('morning');
    deliver(briefing, final === 'ok', final);
  };

  /** Gün içi kısa güncelleme: yalnız söylenmeye değer yeni haber varsa. */
  const update = (): void => {
    if (gate('update') !== 'ok') return;
    const current = prefs();
    if (!current.scope.news) return;
    const since = new Date(Math.max(lastSpoken() ?? 0, fromLocal(localDay(now())).getTime())).toISOString();
    const fresh = deps.sources.news(Math.max(current.newsCount, 5), since);
    const followed = fresh.filter((story) => story.reasons.some((reason) => /^(takip|ilgi alanı):/.test(reason)));
    const strong = fresh.filter((story) => story.score >= UPDATE_MIN_SCORE);
    const picked = [...new Map([...followed, ...strong].map((story) => [story.id, story])).values()].slice(0, current.newsCount);
    if (followed.length === 0 && picked.length < UPDATE_MIN_STORIES) return;
    deliver(composeBriefing({ kind: 'update', now: now(), prefs: current, sources: deps.sources, stories: picked }), true, 'ok');
  };

  /** Önemli gelişme: çok kaynağın verdiği ya da takip edilen konudaki okunmamış haber. */
  const breaking = (): void => {
    const news = deps.news();
    if (!news) return;
    const at = now();
    const since = kv.get<string>('breakingSince') ?? new Date(at.getTime() - 2 * 3_600_000).toISOString();
    if (gate('breaking') !== 'ok') return;
    let stories: NewsStory[] = [];
    try {
      stories = news.breaking(since);
    } catch (error) {
      deps.log.debug(`önemli gelişme okunamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
    kv.set('breakingSince', at.toISOString());
    if (stories.length === 0) return;
    deliver(composeBriefing({ kind: 'breaking', now: at, prefs: prefs(), sources: deps.sources, stories: stories.slice(0, 1) }), true, 'ok');
  };

  const api: BriefingEngine = {
    prefs,
    reasonText,

    state() {
      const current = prefs();
      const learned = adaptive();
      const at = now();
      const day = localDay(at);
      const reason = gate('update');
      let nextMorningAt: IsoDateTime | null = null;
      if (current.enabled && current.morning.enabled) {
        const todayDue = fromLocal(day, current.morning.time);
        const doneToday = deps.db.get<{ id: string }>(`SELECT id FROM briefing_log WHERE day = ? AND kind = 'morning'`, [day]);
        nextMorningAt = (!doneToday && at.getTime() < todayDue.getTime() ? todayDue : fromLocal(addDays(day, 1), current.morning.time)).toISOString();
      }
      return {
        prefs: current,
        adaptive: learned,
        last: api.today(),
        spokenToday: countSpoken('day = ?', [day]),
        dailyLimit: (current.morning.enabled && current.talk !== 'silent' ? 1 : 0) + dailyUpdateLimit(current.talk, learned.factor) + dailyBreakingLimit(current.talk, learned.factor),
        nextMorningAt,
        canSpeak: { ok: reason === 'ok', reason: reason === 'ok' ? null : reasonText(reason) },
      };
    },

    setPrefs(patch) {
      kv.set('prefs', mergePrefs(prefs(), patch) as unknown as JsonValue);
      // Kullanıcı düzeyi kendisi seçtiyse o günkü "yeter" kalkar.
      if (patch.talk !== undefined || patch.enabled === true) kv.set('mutedDay', null);
      deps.onChange('prefs');
      return api.state();
    },

    resetAdaptive() {
      saveAdaptive({ ...DEFAULT_ADAPTIVE });
      kv.set('mutedDay', null);
      deps.onChange('adaptive');
      return api.state();
    },

    async runNow(options = {}) {
      await refreshNews();
      const briefing = composeBriefing({ kind: 'manual', now: now(), prefs: prefs(), sources: deps.sources });
      const reason = options.speak ? gate('manual') : 'ok';
      return deliver(briefing, options.speak === true && reason === 'ok', reason);
    },

    feedback(id, response) {
      const row = rowOf(id);
      if (row) {
        if (response === 'declined') kv.set('mutedDay', localDay(now()));
        // Kart tepkisi yalnız kendiliğinden gelen brifingde öğrenmeye girer (kullanıcının istediği brifing nötrdür).
        if (row.kind !== 'manual' && row.response === 'pending') engagement(response, id);
        else deps.db.run('UPDATE briefing_log SET response = ? WHERE id = ?', [response, id]);
        deps.onChange('briefing');
      }
      return api.state();
    },

    async tick() {
      if (busy) return;
      busy = true;
      try {
        // Yanıtsız kalan kendiliğinden konuşma.
        const waiting = awaiting();
        if (waiting && now().getTime() - Date.parse(waiting.spokenAt) > RESPONSE_WINDOW_MS) engagement('ignored', waiting.id);
        if (deps.killSwitch()) return;
        await morning();
        breaking();
        update();
      } catch (error) {
        deps.log.warn('brifing adımı başarısız', error);
      } finally {
        busy = false;
      }
    },

    onUserTurn(text) {
      const waiting = awaiting();
      if (!waiting) return;
      if (now().getTime() - Date.parse(waiting.spokenAt) > RESPONSE_WINDOW_MS) return engagement('ignored', waiting.id);
      const said = foldForSearch(text);
      const words = said.split(/\s+/).filter(Boolean).length;
      engagement(words <= 6 && DECLINE_WORDS.test(said) ? 'declined' : 'engaged', waiting.id);
    },

    onShown(notification, channel) {
      const id = typeof notification.data.briefingId === 'string' ? notification.data.briefingId : null;
      if (!id || channel !== 'voice') return;
      const row = rowOf(id);
      if (!row || row.spoken_at) return;
      // Bekletilen brifing sonradan söylendi (sessiz saat bitti).
      const briefing = { ...toBriefing(row), delivered: 'voice' as const, reason: null };
      const spokenAt = now().toISOString();
      save(briefing, spokenAt);
      afterSpoken(briefing, spokenAt);
      deps.onChange('briefing');
    },

    onAction(briefingId, action) {
      if (action !== 'enough') return;
      kv.set('mutedDay', localDay(now()));
      engagement('declined', briefingId);
      deps.onChange('briefing');
    },

    onHush() {
      const waiting = awaiting();
      if (waiting && now().getTime() - Date.parse(waiting.spokenAt) <= 90_000) engagement('declined', waiting.id);
    },

    today() {
      const row = deps.db.get<LogRow>(`SELECT * FROM briefing_log WHERE day = ? AND delivered != 'skipped' ORDER BY at DESC LIMIT 1`, [localDay(now())]);
      return row ? toBriefing(row) : null;
    },
  };
  return api;
}
