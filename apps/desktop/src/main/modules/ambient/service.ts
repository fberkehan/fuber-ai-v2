// Ortam dinleme servisi: besleme → döküm → dönem → not → mesele → rapor → eşlikçi boru hattının şefi.
// Fuber AI 1'in `gunkaydi/dusunme.ts` dosyasının v2 karşılığı. v1'de bu dosya ayar, ses, hafıza ve pencereye
// doğrudan bağlıydı; burada her bağ dar bir arayüzdür (`AmbientDeps`) ve saat dışarıdan verilir (sınamada sahte saat).
import {
  addDays,
  fromLocal,
  localDay,
  SIMILAR_SKIP,
  t,
  UserError,
  type AttentionApi,
  type BrainApi,
  type Bus,
  type Id,
  type IsoDateTime,
  type Logger,
  type MemoryApi,
  type PolicyApi,
  type PresenceApi,
  type SettingsApi,
  type ToolRegistry,
  type Unsubscribe,
  type VoiceApi,
} from '@fuber/shared';
import { addressNames, analyzeAddress, isFollowUp } from './address';
import { acceptDecision, collectTraces, decide, isHushWord, SAME_SOURCE_SILENCE_MS, type RejectReason } from './companion';
import { FeedSegmentSchema, type AmbientFeed } from './feed';
import { interjectGate, isQuietNow, listenGate, pauseUntil, SPEECH_SETTLE_MS } from './gates';
import { createNoteTaker, RETENTION, windowClosed, type NoteResult } from './note-taker';
import { currentPeriod, dayKey, dueReports, type ReportKind } from './periods';
import { appendHistory, readHistory, type ProactiveTrace } from './repeat-guard';
import { buildReport, hasReportData } from './reporter';
// Hafızanın kural kapısı (saf işlevler; çalışma anı bağı yok): yazıcının ve `memory_save` aracının kullandığı aynı ölçüt.
import { isSelfTalk, nearestMemory } from '../memory/writer';
import type { AmbientRepo } from './repo';
import type { AmbientIssue, AmbientNote, AmbientPrefs, AmbientReport, AmbientSegment, AmbientStatus, InterjectReason, PausePreset } from './types';

export const MODULE_ID = 'ambient';
export const DEFAULT_PREFS: AmbientPrefs = {
  enabled: false,
  companion: true,
  companionVoice: false,
  reportTime: '21:30',
  pauseWhenLocked: true,
  hours: { enabled: false, from: '09:00', to: '19:00', days: [1, 2, 3, 4, 5] },
};
/** Ham döküm hiçbir ayarla bundan uzun saklanmaz. */
export const MAX_RETENTION_DAYS = 7;
const TICK_MS = 30_000;
const REPORT_RETRY_MS = 10 * 60_000;
const FOLLOW_UP_WINDOW_MS = 12_000;
const MAX_SEGMENT_CHARS = 2000;
/** Önemli not bu kadar süre "yeni" sayılır; kapılar (konuşma sürüyor, aralık) bu sürede açılmazsa söze girilmez. */
const FRESH_NOTE_MS = 20 * 60_000;
/** Beyne danışma anlarının tutulduğu süre (saatlik sınır). */
const CONSULT_WINDOW_MS = 3_600_000;

export type CompanionOutcome = 'spoke' | 'no_new' | 'no_trace' | InterjectReason | RejectReason;

export interface RetentionResult {
  segments: number;
  notes: number;
  reports: number;
  issues: number;
  interjections: number;
}

export interface AmbientDeps {
  repo: AmbientRepo;
  feed: AmbientFeed;
  brain: Pick<BrainApi, 'extract' | 'status' | 'respond'>;
  memory: Pick<MemoryApi, 'search' | 'save' | 'forget'>;
  attention: Pick<AttentionApi, 'notify' | 'forgetModule'>;
  policy: Pick<PolicyApi, 'get' | 'killSwitchActive'>;
  settings: SettingsApi;
  presence: Pick<PresenceApi, 'get'>;
  voice: Pick<VoiceApi, 'status'>;
  tools: Pick<ToolRegistry, 'run' | 'has'>;
  bus: Bus;
  log: Logger;
  now(): Date;
  /** Ekran kilitli mi (işletim sistemi oturum kilidi). */
  screenLocked(): boolean;
  /** Gecikmeli çağrı; dönen işlev iptal eder. Sınamada elle tetiklenir. */
  defer(run: () => void, ms: number): () => void;
  /** Yinelenen çağrı; dönen işlev durdurur. Verilmezse servis kendi kendine yoklamaz. */
  every?(run: () => void, ms: number): () => void;
}

export interface AmbientService {
  start(): void;
  stop(): void;
  status(): AmbientStatus;
  /** Kapıları yeniden hesaplar, ses hattına uygular, değiştiyse duyurur. */
  refresh(): AmbientStatus;
  consent(accept: boolean): AmbientStatus;
  setPrefs(patch: Partial<AmbientPrefs>): AmbientStatus;
  pause(preset: PausePreset | null): AmbientStatus;
  pauseMinutes(minutes: number): AmbientStatus;
  /** Beslemeden gelen ham yük. Yazıldıysa satır, atıldıysa `null`. */
  ingest(raw: unknown): AmbientSegment | null;
  tick(): Promise<void>;
  /** `force`: kullanıcı istedi; model az önce yanıt verememiş olsa da hemen yeniden denenir. */
  takeNotes(force?: boolean): Promise<NoteResult>;
  evaluateCompanion(): Promise<CompanionOutcome>;
  buildReport(kind: ReportKind, period?: string): Promise<AmbientReport | null>;
  runDueReports(): Promise<number>;
  runRetention(): RetentionResult;
  forgetRecent(minutes: number): { segments: number; notes: number; issues: number };
  /** Tek notu (ve hafızadaki kopyasını) siler. */
  deleteNote(id: Id): void;
  deleteAll(): void;
  /** Modül Yönetim'den ya da kullanıcıca kapatılırken: saklama görevi artık koşmayacağı için ham döküm hemen silinir. */
  purgeTranscript(): number;
  issueToReminder(id: Id, dueAt: IsoDateTime): Promise<AmbientIssue>;
  resolveSuggestion(id: Id, accept: boolean): void;
}

export function createAmbient(deps: AmbientDeps): AmbientService {
  const { repo, log } = deps;
  const subscriptions: Unsubscribe[] = [];
  const noteTaker = createNoteTaker({ repo, brain: deps.brain, memory: deps.memory, log, now: deps.now });

  let listening = false;
  let lastReason: AmbientStatus['reason'] | null = null;
  let cancelCompanion: (() => void) | null = null;
  let evaluating = false;
  /** Her yeni satırda artar; model kararı sürerken artarsa kullanıcı hâlâ konuşuyor demektir. */
  let arrivals = 0;
  let lastArrivalAt: number | null = null;
  /** Eşlikçinin değerlendirdiği son önemli notun yazıldığı an; açılıştan önceki notlar söze girme konusu olmaz. */
  let lastEvaluatedAt = new Date(deps.now().getTime() - 1).toISOString();
  let lastSpokeAt = 0;
  let lastReportAttempt = 0;
  /** Süren ve sırada bekleyen not turu sayısı. */
  let notesRunning = 0;

  const prefs = (): AmbientPrefs => {
    const stored = repo.getState<Partial<AmbientPrefs>>('prefs') ?? {};
    return { ...DEFAULT_PREFS, ...stored, hours: { ...DEFAULT_PREFS.hours, ...(stored.hours ?? {}) } };
  };
  const pausedUntil = (): IsoDateTime | null => {
    const value = repo.getState<string | null>('pausedUntil') ?? null;
    return value && Date.parse(value) > deps.now().getTime() ? value : null;
  };
  const hushedToday = () => repo.getState<string | null>('hushedDay') === dayKey(deps.now());
  const history = (): ProactiveTrace[] => readHistory(JSON.stringify(repo.getState<unknown>('history') ?? []));
  const retentionDays = () => Math.min(MAX_RETENTION_DAYS, Math.max(1, deps.policy.get().ambient.retentionDays));
  /** Son bir saatte beyne "söze girmeye değer mi" diye danışılan anlar (ms). */
  const consults = (): number[] => {
    const cutoff = deps.now().getTime() - CONSULT_WINDOW_MS;
    const stored = repo.getState<unknown>('consults');
    return Array.isArray(stored) ? stored.filter((value): value is number => typeof value === 'number' && value > cutoff) : [];
  };
  /** Notların hafıza kopyalarını siler (saklama, "son N dakikayı unut", tek not ya da hepsini sil). */
  const forgetMemories = (memoryIds: Id[]) => {
    for (const id of memoryIds) {
      try {
        deps.memory.forget(id);
      } catch (error) {
        log.debug('ortam notunun hafıza kopyası silinemedi', error);
      }
    }
  };
  const deleteNotes = (ids: Id[]): number => {
    if (ids.length === 0) return 0;
    forgetMemories(repo.noteMemoryIds(ids));
    return repo.deleteNotes(ids);
  };

  const listenReason = (): AmbientStatus['reason'] => {
    const settings = deps.settings.get();
    const now = deps.now();
    return listenGate({
      now,
      killSwitch: deps.policy.killSwitchActive(),
      allowed: deps.policy.get().ambient.allowed,
      consentAt: settings.ambientConsentAt,
      prefs: prefs(),
      pausedUntil: pausedUntil(),
      micMuted: deps.voice.status().micMuted || deps.voice.status().state === 'mic_off',
      quiet: isQuietNow(settings, now),
      locked: deps.screenLocked(),
      feedReady: deps.feed.ready(),
    });
  };

  /** `countConsults`: teslimden önceki yeniden sorgu az önceki danışmayı sınıra saymasın diye `false`. */
  const companionReason = (isListening: boolean, busy: boolean, countConsults = true): InterjectReason => {
    const ambient = deps.policy.get().ambient;
    const now = deps.now();
    const last = repo.recentInterjections(1)[0];
    return interjectGate({
      now: now.getTime(),
      listening: isListening,
      mode: ambient.interjections,
      brain: deps.brain.status().provider,
      companion: prefs().companion,
      presence: deps.presence.get(),
      quiet: isQuietNow(deps.settings.get(), now),
      maxPerHour: ambient.maxInterjectionsPerHour,
      hushedToday: hushedToday(),
      countLastHour: repo.countInterjectionsSince(now.getTime() - 3_600_000),
      consultsLastHour: countConsults ? consults().length : 0,
      lastInterjectionAt: last ? Date.parse(last.at) : null,
      minGapSeconds: ambient.minGapSeconds,
      voiceState: deps.voice.status().state,
      lastSpeechEndedAt: lastArrivalAt,
      evaluating: busy,
    });
  };

  const status = (): AmbientStatus => {
    const reason = listenReason();
    const ambient = deps.policy.get().ambient;
    const now = deps.now();
    const gate = companionReason(reason === 'ok', false);
    return {
      allowed: ambient.allowed,
      consentAt: deps.settings.get().ambientConsentAt,
      prefs: prefs(),
      listening: reason === 'ok',
      reason,
      pausedUntil: pausedUntil(),
      feedSupported: deps.feed.supported(),
      limits: {
        retentionDays: retentionDays(),
        maxInterjectionsPerHour: ambient.maxInterjectionsPerHour,
        minGapSeconds: ambient.minGapSeconds,
        interjections: ambient.interjections,
      },
      // Yapısal engel (politika, bulut bekliyor, kullanıcı kapatmış, dinleme kapalı) "etkin değil" demektir; toplantı,
      // saatlik sınır, aralık gibi geçici durumlarda eşlikçi etkindir ve neden ayrıca söylenir.
      companion: {
        active: !['not_listening', 'policy_off', 'needs_cloud', 'user_off'].includes(gate),
        reason: gate === 'user_speaking' || gate === 'busy' ? 'ok' : gate,
      },
      today: repo.counts(dayKey(now), new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()),
    };
  };

  const announce = () => {
    deps.attention.notify({
      moduleId: MODULE_ID,
      title: t('ambient.notify.onTitle'),
      body: t('ambient.notify.onBody', { days: retentionDays() }),
      priority: 'normal',
      dedupeKey: `ambient.on.${dayKey(deps.now())}`,
    });
  };

  const refresh = (byUser = false): AmbientStatus => {
    const current = status();
    const changed = current.listening !== listening || current.reason !== lastReason;
    const feedChanged = current.listening !== listening || lastReason === null;
    const turnedOn = current.listening && !listening;
    listening = current.listening;
    lastReason = current.reason;
    // Ses hattına haber, durum güncellendikten SONRA verilir: hat kipi değiştirince aynı anda `voice.status` yayınlar ve
    // bu işleve yeniden girilir. Önce haber verilirse iç çağrı "yeni açıldı"yı tüketir ve "Ortam dinleme açık" bildirimi
    // hiç çıkmaz (gerçek ses hattıyla uçtan uca sınamada görüldü; sahte beslemede görünmüyordu).
    if (feedChanged) deps.feed.setEnabled(current.listening);
    if (!listening) {
      cancelCompanion?.();
      cancelCompanion = null;
    }
    if (changed || byUser) deps.bus.emit('ambient.status', current);
    if (turnedOn && byUser) announce();
    return current;
  };

  const savePrefs = (next: AmbientPrefs) => repo.setState('prefs', next);

  const emitChanged = (entity: 'segment' | 'note' | 'issue' | 'report' | 'suggestion' | 'interjection', op: 'created' | 'updated' | 'deleted', ids: Id[]) => {
    if (ids.length) deps.bus.emit('ambient.changed', { entity, op, ids });
  };

  const suggestReminder = (issue: AmbientIssue) => {
    deps.attention.notify({
      moduleId: MODULE_ID,
      title: t('ambient.notify.issueTitle'),
      body: issue.unsure ? t('ambient.unsure', { text: issue.title }) : issue.title,
      priority: 'low',
      actions: [
        { id: 'remind', label: t('ambient.action.remind'), kind: 'primary' },
        { id: 'skip', label: t('ambient.action.skip'), kind: 'secondary' },
      ],
      dedupeKey: `ambient.issue.${issue.id}`,
      data: { issueId: issue.id },
    });
  };

  /** Öneri için varsayılan an: hedef gün (yoksa yarın) 09:00; geçmişte kalıyorsa yarın 09:00. */
  const defaultReminderTime = (issue: AmbientIssue): IsoDateTime => {
    const now = deps.now();
    const tomorrow = addDays(localDay(now), 1);
    const candidate = fromLocal(issue.dueDay ?? tomorrow, '09:00');
    return (candidate.getTime() > now.getTime() ? candidate : fromLocal(tomorrow, '09:00')).toISOString();
  };

  /**
   * Yerel modelin ÖNEMLİ işaretlediği notlar hafızaya da yazılır (kaynak `ambient`, etiket `ortam`): sohbette hafıza
   * geri çağırmasıyla gelirler. Emin olunmayan not ve asistanın kendi hakkındaki söz yazılmaz; aynı bilgi hafızada
   * zaten varsa yinelenmez. Not silinince (saklama süresi, "son N dakikayı unut", hepsini sil) kopyası da silinir.
   */
  const rememberNotes = (notes: AmbientNote[]) => {
    for (const note of notes) {
      if (!note.important || note.unsure || isSelfTalk(note.text)) continue;
      try {
        const near = nearestMemory(deps.memory, note.text);
        if (near !== null && near.covered >= SIMILAR_SKIP) continue;
        const item = deps.memory.save({
          kind: 'episode',
          text: note.text,
          subject: note.people[0] ?? null,
          tags: ['ortam', note.kind],
          source: 'ambient',
          // Ortamdan duyulan söz: kimin söylediği bilinmez; açık söz kadar güvenilir değil.
          confidence: 0.6,
          importance: 0.6,
          at: note.at,
        });
        repo.linkNoteMemory(note.id, item.id);
      } catch (error) {
        log.debug('ortam notu hafızaya yazılamadı', error);
      }
    }
  };

  const takeNotes = async (force = false): Promise<NoteResult> => {
    notesRunning++;
    try {
      const result = await noteTaker.run(force);
      rememberNotes(result.notes);
      emitChanged('note', 'created', result.notes.map((note) => note.id));
      emitChanged('issue', 'created', result.issues.map((issue) => issue.id));
      emitChanged('issue', 'updated', result.closed.map((issue) => issue.id));
      emitChanged('suggestion', 'created', result.suggestions.map((entry) => entry.id));
      if (result.batches > 0) emitChanged('segment', 'updated', ['*']);
      for (const issue of result.issues) suggestReminder(issue);
      // Yerel model önemli bir not çıkardıysa eşlikçi sorulur (kapılar kapalıysa not sırada bekler).
      if (result.notes.some((note) => note.important)) void evaluateCompanion().catch((error: unknown) => log.warn('eşlikçi değerlendirmesi başarısız', error));
      return result;
    } finally {
      notesRunning--;
    }
  };

  /**
   * Henüz değerlendirilmemiş, yeni önemli notlar. Asistana seslenilen satırlardan çıkan not (sesli tura aittir) ve
   * `FRESH_NOTE_MS`'ten eski not söze girme konusu olmaz.
   */
  const freshImportantNotes = (): AmbientNote[] => {
    const cutoff = new Date(deps.now().getTime() - FRESH_NOTE_MS).toISOString();
    const since = lastEvaluatedAt > cutoff ? lastEvaluatedAt : cutoff;
    return repo.importantNotesSince(since, 20).filter((note) => {
      // Not yeni yazılmış olsa da dayandığı söz eskiyse (model saatlerce yanıt vermedi) söze girme konusu olmaz.
      if (Date.parse(note.sourceTo) < Date.parse(cutoff)) return false;
      const sources = repo.segmentsByIds(note.sourceIds);
      return sources.length === 0 || sources.some((segment) => !segment.addressed);
    });
  };

  const evaluateCompanion = async (): Promise<CompanionOutcome> => {
    const gate = companionReason(listening, evaluating);
    if (gate !== 'ok') return gate;
    const fresh = freshImportantNotes();
    if (fresh.length === 0) return 'no_new';
    lastEvaluatedAt = fresh.at(-1)!.createdAt;
    const now = deps.now();
    const used = new Set(repo.recentInterjections(40).filter((entry) => Date.parse(entry.at) >= now.getTime() - SAME_SOURCE_SILENCE_MS).flatMap((entry) => entry.sources));
    const traces = collectTraces({ repo, memory: deps.memory, log, now: deps.now }, fresh, used);
    if (traces.length === 0) return 'no_trace';

    evaluating = true;
    const seen = arrivals;
    try {
      const persona = deps.policy.get().persona;
      const ambient = deps.policy.get().ambient;
      const last = repo.recentInterjections(1)[0] ?? null;
      const freshIds = new Set(fresh.map((note) => note.id));
      const hourAgo = now.getTime() - 3_600_000;
      const context = repo.notesOfDay(dayKey(now)).filter((note) => !freshIds.has(note.id) && Date.parse(note.at) >= hourAgo);
      // Danışma, yanıt ne olursa olsun ("değmez" de) saatlik sınıra sayılır.
      repo.setState('consults', [...consults(), now.getTime()]);
      const decision = await decide(
        {
          brain: deps.brain,
          assistant: persona.name,
          address: deps.settings.get().userAddress?.trim() || persona.address,
          mode: ambient.interjections === 'on' ? 'on' : 'cloud-only',
          provider: deps.brain.status().provider,
          log,
        },
        { now, notes: fresh.slice(-3), context, traces, last },
      );
      const verdict = acceptDecision(decision, traces, history(), repo.recentInterjections(40), deps.now());
      if (!verdict.ok) return verdict.reason;
      // Model düşünürken durum değişmiş olabilir: yeni söz geldiyse kullanıcı hâlâ konuşuyor; toplantı başlamış,
      // mikrofon kapanmış, duraklatılmış olabilir. Kapılar teslimden hemen önce yeniden sorulur.
      if (arrivals !== seen) return 'user_speaking';
      const recheck = companionReason(listenReason() === 'ok', false, false);
      if (recheck !== 'ok') return recheck;

      const voiced = prefs().companionVoice && !deps.voice.status().quiet;
      const at = deps.now().toISOString();
      const record = repo.addInterjection({
        at,
        text: verdict.text,
        kind: verdict.kind,
        trigger: fresh.map((segment) => segment.text).join(' ').slice(0, 300),
        sources: [verdict.source.ref],
        voiced,
      });
      repo.setState('history', appendHistory(history(), { kind: 'interjection', text: verdict.text, at }));
      lastSpokeAt = deps.now().getTime();
      // Yalnız Dikkat Yöneticisi üzerinden: `high` + seslendirme yok = küçük ada bildirimi; ses kullanıcının seçimi.
      deps.attention.notify({
        moduleId: MODULE_ID,
        title: persona.name,
        body: verdict.text,
        priority: 'high',
        speak: voiced ? verdict.text : false,
        dedupeKey: `ambient.interjection.${verdict.source.ref}`,
        data: { interjectionId: record.id, source: verdict.source.ref },
      });
      emitChanged('interjection', 'created', [record.id]);
      return 'spoke';
    } catch (error) {
      log.warn('eşlikçi değerlendirmesi başarısız', error);
      return 'silent';
    } finally {
      evaluating = false;
    }
  };

  const ingest = (raw: unknown): AmbientSegment | null => {
    const parsed = FeedSegmentSchema.safeParse(raw);
    if (!parsed.success) {
      log.debug('ortam bölütü sözleşmeye uymuyor, atıldı');
      return null;
    }
    // Kapı her satırda yeniden sorulur: ses hattı kapatma isteğini geç uygulasa da kapalıyken gelen söz yazılmaz.
    if (listenReason() !== 'ok') return null;
    // Asistan konuşurken gelen satır kendi sesinin yankısıdır.
    if (deps.voice.status().state === 'speaking') return null;
    const text = parsed.data.text.replace(/\s+/g, ' ').trim().slice(0, MAX_SEGMENT_CHARS);
    if (text.length < 2) return null;
    const policy = deps.policy.get();
    const lowered = text.toLocaleLowerCase('tr');
    // Uyandırma sözüyle başlayan cümle sesli tura aittir; gün kaydına girmez.
    if (policy.persona.wakePhrases.some((phrase) => lowered.startsWith(phrase.toLocaleLowerCase('tr')))) return null;
    const now = deps.now().getTime();
    if (isHushWord(text)) {
      repo.setState('hushedDay', dayKey(deps.now()));
      return null;
    }
    const names = addressNames(policy.persona.name);
    const named = analyzeAddress(text, names).verdict === 'addressed';
    const followUp = !named && lastSpokeAt > 0 && isFollowUp(text, lastSpokeAt, now, names, FOLLOW_UP_WINDOW_MS);
    const segment = repo.addSegment({
      feedId: parsed.data.id,
      text,
      startedAt: parsed.data.startedAt,
      endedAt: parsed.data.endedAt,
      durationMs: parsed.data.durationMs,
      addressed: named || followUp,
    });
    if (!segment) return null;
    arrivals++;
    lastArrivalAt = now;
    emitChanged('segment', 'created', [segment.id]);
    cancelCompanion?.();
    cancelCompanion = null;
    if (segment.addressed) {
      deps.bus.emit('ambient.addressed', { segmentId: segment.id, text, why: named ? 'name' : 'follow_up' });
    } else {
      cancelCompanion = deps.defer(() => {
        cancelCompanion = null;
        void evaluateCompanion();
      }, SPEECH_SETTLE_MS + 100);
    }
    if (notesRunning === 0 && windowClosed(repo.pendingSegments(60), deps.now())) void takeNotes().catch((error: unknown) => log.warn('not tutucu başarısız', error));
    return segment;
  };

  const runRetention = (): RetentionResult => {
    const now = deps.now();
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    const result: RetentionResult = {
      segments: repo.deleteSegmentsBefore(daysAgo(retentionDays())),
      notes: deleteNotes(repo.expiredNoteIds(now.toISOString())),
      reports:
        repo.deleteReports(repo.reportIdsOlderThan('daily', daysAgo(RETENTION.dailyReportDays))) +
        repo.deleteReports(repo.reportIdsOlderThan('weekly', daysAgo(RETENTION.weeklyReportDays))),
      issues: repo.deleteIssues(repo.closedIssueIdsBefore(daysAgo(RETENTION.closedIssueDays))),
      interjections: repo.deleteInterjectionsBefore(now.getTime() - RETENTION.interjectionDays * 86_400_000),
    };
    repo.deleteResolvedSuggestionsBefore(daysAgo(RETENTION.closedIssueDays));
    if (result.segments) emitChanged('segment', 'deleted', ['*']);
    if (result.notes) emitChanged('note', 'deleted', ['*']);
    if (result.reports) emitChanged('report', 'deleted', ['*']);
    if (result.issues) emitChanged('issue', 'deleted', ['*']);
    if (result.segments + result.notes + result.reports + result.issues > 0) {
      log.info(`ortam saklama: ${result.segments} döküm satırı, ${result.notes} not, ${result.reports} rapor, ${result.issues} mesele silindi`);
    }
    return result;
  };

  const runDueReports = async (): Promise<number> => {
    const now = deps.now();
    if (now.getTime() - lastReportAttempt < REPORT_RETRY_MS) return 0;
    const reportTime = prefs().reportTime;
    const due = () =>
      dueReports(
        now,
        reportTime,
        (kind, period) => repo.getReport(kind, period) !== null,
        (kind, period) => hasReportData(repo, kind, period),
      );
    // Rapor saati geçtiyse bekleyen döküm önce notlanır: günün raporu notsuz dökümü görmez.
    const pastReportTime = now.getHours() * 60 + now.getMinutes() >= Number(reportTime.slice(0, 2)) * 60 + Number(reportTime.slice(3, 5));
    const pendingToday = pastReportTime && repo.pendingSegments(1).length > 0;
    if (due().length === 0 && !pendingToday) return 0;
    lastReportAttempt = now.getTime();
    if (repo.pendingSegments(1).length > 0) await takeNotes();
    const afterNotes = due();
    let built = 0;
    for (const entry of afterNotes) {
      try {
        const report = await buildReport({ repo, brain: deps.brain, log, now: deps.now }, entry.kind, entry.period);
        if (!report) continue;
        built++;
        emitChanged('report', 'created', [report.id]);
        const current = entry.period === currentPeriod(entry.kind, now) || entry.kind === 'weekly';
        if (current && entry.kind !== 'monthly') {
          deps.attention.notify({
            moduleId: MODULE_ID,
            title: entry.kind === 'daily' ? t('ambient.notify.dailyTitle') : t('ambient.notify.weeklyTitle'),
            // Gövdeye yalnız başlık konur, içerik Raporlar sekmesindedir ("hepsini sil" bildirim geçmişini de siler).
            body: report.title,
            priority: 'normal',
            dedupeKey: `ambient.report.${entry.kind}.${entry.period}`,
            data: { reportId: report.id },
          });
        }
      } catch (error) {
        log.warn(`ortam raporu hazırlanamadı (${entry.kind} ${entry.period})`, error);
        break;
      }
    }
    return built;
  };

  const service: AmbientService = {
    start() {
      subscriptions.push(deps.feed.subscribe((raw) => void ingest(raw)));
      for (const event of ['settings.changed', 'policy.changed', 'presence.changed', 'voice.status'] as const) {
        subscriptions.push(deps.bus.on(event, () => void refresh()));
      }
      subscriptions.push(
        deps.bus.on('voice.state', ({ reason }) => {
          // Kullanıcı "sus" dedi: bugün saatlik sınır yarıya iner (KURGU §10.2).
          if (reason === 'stop_word') repo.setState('hushedDay', dayKey(deps.now()));
          refresh();
        }),
      );
      subscriptions.push(
        deps.bus.on('attention.action', ({ moduleId, actionId, data }) => {
          if (moduleId !== MODULE_ID || actionId !== 'remind' || typeof data.issueId !== 'string') return;
          const issue = repo.getIssue(data.issueId);
          if (!issue || issue.reminderId) return;
          void service.issueToReminder(issue.id, defaultReminderTime(issue)).catch((error: unknown) => log.warn('mesele hatırlatıcıya çevrilemedi', error));
        }),
      );
      if (deps.every) subscriptions.push(deps.every(() => void service.tick().catch((error: unknown) => log.warn('ortam yoklaması başarısız', error)), TICK_MS));
      const current = refresh();
      if (current.listening) announce();
    },

    stop() {
      for (const off of subscriptions.splice(0)) off();
      cancelCompanion?.();
      cancelCompanion = null;
      if (listening) deps.feed.setEnabled(false);
      listening = false;
      lastReason = null;
    },

    status,
    refresh: () => refresh(),

    consent(accept) {
      if (accept && !deps.policy.get().ambient.allowed) throw new UserError(t('ambient.error.policy'));
      deps.settings.update({ ambientConsentAt: accept ? deps.now().toISOString() : null });
      savePrefs({ ...prefs(), enabled: accept });
      if (!accept) repo.setState('pausedUntil', null);
      return refresh(true);
    },

    setPrefs(patch) {
      const current = prefs();
      if (patch.enabled && !deps.settings.get().ambientConsentAt) throw new UserError(t('ambient.error.noConsent'));
      if (patch.reportTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.reportTime)) throw new UserError(t('ambient.error.time'));
      const hours = patch.hours ? { ...current.hours, ...patch.hours } : current.hours;
      if (![hours.from, hours.to].every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new UserError(t('ambient.error.time'));
      savePrefs({ ...current, ...patch, hours: { ...hours, days: [...new Set(hours.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] } });
      return refresh(true);
    },

    pause(preset) {
      repo.setState('pausedUntil', preset ? pauseUntil(preset, deps.now()) : null);
      return refresh(true);
    },

    pauseMinutes(minutes) {
      const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
      repo.setState('pausedUntil', clamped ? new Date(deps.now().getTime() + clamped * 60_000).toISOString() : null);
      return refresh(true);
    },

    ingest,

    async tick() {
      refresh();
      // Süren bir not turu varsa beklenir (not tutucu turları sıraya koyar); yoklama bitince bekleyen dönem notlanmıştır.
      if (windowClosed(repo.pendingSegments(60), deps.now())) await takeNotes();
    },

    takeNotes,
    evaluateCompanion,

    async buildReport(kind, period) {
      if (kind === 'daily') await takeNotes(true);
      const report = await buildReport({ repo, brain: deps.brain, log, now: deps.now }, kind, period);
      if (report) emitChanged('report', 'created', [report.id]);
      return report;
    },

    runDueReports,
    runRetention,

    forgetRecent(minutes) {
      const clamped = Math.max(1, Math.min(24 * 60, Math.round(minutes)));
      const since = new Date(deps.now().getTime() - clamped * 60_000).toISOString();
      const segmentIds = repo.segmentIdsSince(since);
      const noteIds = repo.noteIdsDerivedFrom(segmentIds, since);
      const issueIds = repo.issueIdsDerivedFrom(segmentIds, since);
      // Süren eşlikçi kararı ve bekleyen değerlendirme, silinen sözlere dayanıyor olabilir: ikisi de düşer.
      cancelCompanion?.();
      cancelCompanion = null;
      arrivals++;
      deleteNotes(noteIds);
      repo.deleteIssues(issueIds);
      repo.deleteSuggestions(repo.suggestionIdsDerivedFrom(segmentIds, since));
      const reports = repo.reportIdsCreatedSince(since);
      repo.deleteReports(reports);
      repo.deleteInterjectionsSince(Date.parse(since));
      repo.setState('history', history().filter((trace) => Date.parse(trace.at) < Date.parse(since)));
      const segments = repo.deleteSegments(segmentIds);
      emitChanged('segment', 'deleted', segmentIds);
      emitChanged('note', 'deleted', noteIds);
      emitChanged('issue', 'deleted', issueIds);
      emitChanged('suggestion', 'deleted', ['*']);
      emitChanged('report', 'deleted', reports);
      emitChanged('interjection', 'deleted', ['*']);
      return { segments, notes: noteIds.length, issues: issueIds.length };
    },

    deleteNote(id) {
      deleteNotes([id]);
      emitChanged('note', 'deleted', [id]);
    },

    deleteAll() {
      cancelCompanion?.();
      cancelCompanion = null;
      arrivals++;
      // Önemli notların hafıza kopyaları da gider (önerilerden kullanıcının eklediği kayıtlar durur).
      forgetMemories(repo.noteMemoryIds());
      repo.deleteAll();
      // Bildirim geçmişinde kalan içerik (iş başlığı, rapor başlığı, araya girme cümlesi) de gider.
      deps.attention.forgetModule?.(MODULE_ID);
      for (const entity of ['segment', 'note', 'issue', 'report', 'suggestion', 'interjection'] as const) emitChanged(entity, 'deleted', ['*']);
      deps.bus.emit('ambient.status', status());
    },

    purgeTranscript() {
      const ids = repo.segmentIdsSince(new Date(0).toISOString());
      return repo.deleteSegments(ids);
    },

    async issueToReminder(id, dueAt) {
      const issue = repo.getIssue(id);
      if (!issue) throw new UserError(t('ambient.error.issueMissing'));
      if (Number.isNaN(Date.parse(dueAt))) throw new UserError(t('ambient.error.time'));
      if (!deps.tools.has('reminder_create')) throw new UserError(t('ambient.error.plannerOff'));
      // Planlar modülünün kendi aracı: hatırlatıcının kuralları (yineleme, zamanlama) tek yerde kalır.
      const result = await deps.tools.run('reminder_create', { text: issue.title, due_at: dueAt }, { origin: { channel: 'ui', speakerVerified: null } });
      if (!result.ok) throw new UserError(result.text);
      const reminderId = (result.data as { id?: unknown } | undefined)?.id;
      const updated = repo.updateIssue(id, { reminderId: typeof reminderId === 'string' ? reminderId : null, dueDay: issue.dueDay ?? localDay(new Date(dueAt)) });
      emitChanged('issue', 'updated', [id]);
      return updated ?? issue;
    },

    resolveSuggestion(id, accept) {
      const suggestion = repo.getSuggestion(id);
      if (!suggestion || suggestion.status !== 'pending') return;
      if (accept) {
        // Hafızanın kural kapısı: aynı bilgi zaten kayıtlıysa yeniden yazılmaz (öneri yine de kabul edilmiş sayılır);
        // asistanın kendi hakkındaki söz ("Jarvis'in erişimi yok") kullanıcı onaylasa da kalıcı bilgi olmaz.
        const near = nearestMemory(deps.memory, suggestion.text);
        const known = near !== null && near.covered >= SIMILAR_SKIP;
        if (!known && !isSelfTalk(suggestion.text)) {
          deps.memory.save({
            kind: 'fact',
            text: suggestion.text,
            subject: suggestion.subject,
            source: 'ambient',
            // Ortamdan duyulan söz: kimin söylediği bilinmez; kullanıcı onayladı ama açık söz kadar güvenilir değil.
            confidence: 0.7,
            importance: 0.5,
          });
        }
      }
      repo.setSuggestionStatus(id, accept ? 'accepted' : 'dismissed');
      emitChanged('suggestion', 'updated', [id]);
    },
  };
  return service;
}

/** Sabah özetine eklenecek satırlar: vadesi bugün olan ya da geçmiş açık meseleler. */
export function briefLines(repo: AmbientRepo, day: string): string[] {
  const due = repo.listIssues('open', 80).filter((issue) => issue.dueDay !== null && issue.dueDay <= day);
  const lines = due.slice(0, 3).map((issue) => t('ambient.brief.issue', { title: issue.title }));
  if (due.length > 3) lines.push(t('ambient.brief.more', { count: due.length - 3 }));
  return lines;
}
