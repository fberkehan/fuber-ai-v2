// Toplantı modu (KURGU §10.6): iki kaynaklı canlı yazı, anlık çeviri, yanıt önerisi, bağlam, özet ve yapılacaklar.
//
//   ses hattı `voice.meeting` (mikrofon = "Siz", bilgisayar sesi = "Karşı taraf"; ses bu modüle HİÇ gelmez)
//     → yankı süzgeci ("Siz" satırı karşı tarafın hoparlörden kaçan sesi mi; kısa bekletme + geriye dönük silme)
//     → kesin satır (depo) → çeviri sırası → karşı tarafın sorusunda yanıt önerisi
//   bitince → özet (derin beyin; yoksa bulut; o da yoksa yalnız kısa toplantıda yerel model) → yapılacaklar Planlar'a
//
// Fuber AI 1'in `main/toplanti/oturum.ts` (1053 satır) dosyasının sadeleştirilmiş karşılığı. Alınmayanlar: üç yazıya
// çevirme kipi (canlı Scribe, toplu bulut, Gemini) ve aralarındaki devir; bu yüzden "bulut düştü, yerele geçildi"
// durumları, kredi sınırları ve büyüyen pencere de yok. Yazıya çevirme her zaman ses hattının yerel Whisper'ıdır.
import {
  t,
  UserError,
  type AttentionApi,
  type BrainApi,
  type Bus,
  type Id,
  type IsoDateTime,
  type Logger,
  type PolicyApi,
  type SettingsApi,
  type ToolRegistry,
  type Unsubscribe,
  type VoiceApi,
} from '@fuber/shared';
import { z } from 'zod';
import type { DeepBrain } from '../../core/brain/deep/types';
import {
  cleanContext,
  cleanTranslation,
  contextEmpty,
  contextText,
  detectLanguage,
  ECHO_WINDOW_MS,
  extractJson,
  groundSummary,
  isEcho,
  isMeetingLanguage,
  LOCAL_SUMMARY_MAX,
  meetingTitle,
  numberedTranscript,
  questionKind,
  suggestionPrompt,
  summaryInstructions,
  translationInstructions,
  type RawSummaryItem,
} from './pure';
import type { MeetingRepo } from './repo';
import { MEETING_RETENTION } from './retention';
import type {
  Meeting,
  MeetingChange,
  MeetingContext,
  MeetingLine,
  MeetingStartOptions,
  MeetingStatus,
  MeetingSummary,
  SummaryEngine,
  SummaryProblem,
} from './types';

export const MODULE_ID = 'meeting';

/** "Siz" satırı, karşı taraf kaynağı açıkken bu kadar bekletilir: aynı sözün karşı taraf dökümü gelsin, yankıysa yazılmasın. */
export const ECHO_HOLD_MS = 2500;
/** Bu kadar çeviri sırada beklerse en eskileri atlanır (canlı yazı geride kalmasın). */
const TRANSLATION_BACKLOG = 8;
/** Ses hattında bu kadar bölüt yazıya çevrilmeyi bekliyorsa çeviri ve öneri bekler: önce yazı. */
const STT_BACKLOG = 2;
/** Sesli tur ya da yazıya çevirme sırası yüzünden ertelenen dil modeli işinin yeniden deneme aralığı. */
const RETRY_MS = 700;
/** Bitişte ses hattının elindeki son bölütlerin yazılması için en çok bekleme. */
const DRAIN_MS = 6000;
const DEEP_SUMMARY_SECONDS = 150;

/** Ses hattının yükü: bilinmeyen alanlar (ör. yanlışlıkla gelen ses örneği) ATILIR. */
export const MeetingFeedSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string(),
  source: z.enum(['mic', 'system']),
  startedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  endedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  durationMs: z.number().nonnegative(),
  lang: z.string().max(12).optional(),
  detectedLang: z.string().max(12).nullable().optional(),
  languageConfidence: z.number().nullable().optional(),
});

const TranslationSchema = z.object({ translation: z.string() });
const SuggestionSchema = z.object({ reply: z.string(), translation: z.string().optional() });
const RawItem = z.object({
  text: z.string(),
  line: z.coerce.number().int(),
  quote: z.string().default(''),
  owner: z.string().optional(),
  due: z.string().optional(),
});
export const SummarySchema = z.object({
  points: z.array(RawItem).default([]),
  decisions: z.array(RawItem).default([]),
  actions: z.array(RawItem).default([]),
});

export interface MeetingDeps {
  repo: MeetingRepo;
  bus: Bus;
  voice: VoiceApi;
  brain: BrainApi;
  policy: PolicyApi;
  settings: SettingsApi;
  tools: ToolRegistry;
  attention: AttentionApi;
  log: Logger;
  /** Derin beyin (çekirdek `deepBrainFor`); sınamada sahte ya da `null`. */
  deep(): DeepBrain | null;
  now(): Date;
  defer(run: () => void, ms: number): () => void;
}

type LlmTask = { kind: 'translate'; lineId: Id } | { kind: 'suggest'; suggestionId: Id; lineId: Id };

interface Pending {
  line: MeetingLine;
  cancel: () => void;
}

export interface MeetingService {
  start(): void;
  stop(): void;
  status(): MeetingStatus;
  consent(accept: boolean): MeetingStatus;
  begin(options: MeetingStartOptions): MeetingStatus;
  /** Toplantıyı bitirir; özet arkada yazılır (`meeting.changed`). `summarize: false`: özet yazılmaz (acil durdurma). */
  end(options?: { summarize?: boolean; reason?: 'user' | 'panic' | 'shutdown' | 'consent' }): Promise<MeetingStatus>;
  setContext(patch: Partial<MeetingContext>): MeetingStatus;
  setOptions(patch: { target?: string | null; suggestions?: boolean; theirLanguage?: string }): MeetingStatus;
  summarize(id: Id): Promise<Meeting>;
  exportActions(id: Id, index?: number): Promise<{ added: number; skipped: number; meeting: Meeting }>;
  runRetention(): void;
  deleteMeeting(id: Id): void;
  deleteAll(): void;
  /** Süren toplantının kimliği (yoksa `null`). */
  activeId(): Id | null;
  /** Sınama: bekleyen işler bitti mi (yankı bekletmesi, dil modeli sırası, özet). */
  idle(): boolean;
}

export function createMeetingService(deps: MeetingDeps): MeetingService {
  const { repo, bus, log } = deps;
  const subscriptions: Unsubscribe[] = [];
  let active: Id | null = null;
  const pending = new Map<Id, Pending>();
  const queue: LlmTask[] = [];
  let running = false;
  let retry: (() => void) | null = null;
  let voiceBusy = false;
  let summarizing = 0;
  let ending: Promise<MeetingStatus> | null = null;

  const iso = (): IsoDateTime => deps.now().toISOString() as IsoDateTime;
  const changed = (change: MeetingChange) => bus.emit('meeting.changed', change);
  const persona = () => deps.policy.get().persona;
  const retentionDays = () => Math.min(MEETING_RETENTION.transcriptMaxDays, Math.max(1, deps.policy.get().ambient.retentionDays));
  const consentAt = () => repo.getState<string>('consentAt');
  const current = (): Meeting | null => (active ? repo.get(active) : null);

  // ───────────────────────── durum ─────────────────────────

  function brainStatus(): MeetingStatus['brain'] {
    let provider: 'cloud' | 'local' | 'none' = 'none';
    try {
      provider = deps.brain.status().provider;
    } catch {
      provider = 'none';
    }
    const deep = deps.deep()?.available() ?? { ok: false, provider: null, reason: undefined };
    const summary = deep.ok ? 'deep' : provider === 'cloud' ? 'cloud' : provider === 'local' ? 'local_short' : 'none';
    return { translate: provider, summary, summaryReason: deep.ok ? null : (deep.reason ?? null) };
  }

  function status(): MeetingStatus {
    const voice = deps.voice.status();
    const supported = typeof deps.voice.setMeeting === 'function';
    const reason = !supported ? t('meeting.unavailable.voice') : !voice.ready ? (voice.notReadyReason ?? t('meeting.unavailable.voice')) : null;
    const meeting = voice.meeting;
    return {
      available: reason === null,
      unavailableReason: reason,
      consentAt: consentAt(),
      active: current(),
      sources: {
        mic: voice.ready && !voice.micMuted ? 'on' : 'off',
        system: meeting?.system ?? 'off',
        systemError: meeting?.systemError ?? null,
        queued: meeting?.queued ?? 0,
      },
      brain: brainStatus(),
      retentionDays: retentionDays(),
    };
  }

  const publish = (): MeetingStatus => {
    const value = status();
    bus.emit('meeting.status', value);
    return value;
  };

  // ───────────────────────── canlı yazı ─────────────────────────

  function translationTarget(meeting: Meeting): string | null {
    return meeting.target && isMeetingLanguage(meeting.target) ? meeting.target : null;
  }

  function needsTranslation(meeting: Meeting, line: Pick<MeetingLine, 'lang'>): boolean {
    const target = translationTarget(meeting);
    return target !== null && line.lang !== target;
  }

  /** Karşı tarafın yakın zamandaki kesin satırları (yankı karşılaştırması için). */
  function theirsNear(meetingId: Id, line: Pick<MeetingLine, 'startedAt' | 'endedAt'>): MeetingLine[] {
    const from = Date.parse(line.startedAt) - ECHO_WINDOW_MS;
    const to = Date.parse(line.endedAt) + ECHO_WINDOW_MS;
    return repo.lines(meetingId).filter((item) => item.speaker === 'them' && Date.parse(item.endedAt) >= from && Date.parse(item.startedAt) <= to);
  }

  function countEcho(meetingId: Id): void {
    const meeting = repo.get(meetingId);
    if (meeting) repo.update(meetingId, { echoDropped: meeting.echoDropped + 1 });
  }

  function finalize(draft: MeetingLine): void {
    const meeting = repo.get(draft.meetingId);
    if (!meeting) return;
    const translate = needsTranslation(meeting, draft);
    const line = repo.addLine({
      id: draft.id,
      meetingId: draft.meetingId,
      speaker: draft.speaker,
      text: draft.text,
      startedAt: draft.startedAt,
      endedAt: draft.endedAt,
      lang: draft.lang,
      translationState: translate ? 'pending' : translationTarget(meeting) ? 'same' : 'none',
    });
    changed({ kind: 'line', meetingId: line.meetingId, line });
    if (translate) enqueue({ kind: 'translate', lineId: line.id });
    if (line.speaker === 'them' && meeting.suggestions && meeting.state === 'live' && questionKind(line.text) === 'question') {
      // Yalnız en son soru önemlidir: başlamamış eski öneri atlanır.
      for (const task of queue.filter((item): item is Extract<LlmTask, { kind: 'suggest' }> => item.kind === 'suggest')) {
        queue.splice(queue.indexOf(task), 1);
        const skipped = repo.updateSuggestion(task.suggestionId, { state: 'skipped' });
        if (skipped) changed({ kind: 'suggestion', meetingId: skipped.meetingId, suggestion: skipped });
      }
      const suggestion = repo.addSuggestion({ meetingId: line.meetingId, lineId: line.id, question: line.text, state: 'working', reply: null, translation: null });
      changed({ kind: 'suggestion', meetingId: line.meetingId, suggestion });
      enqueue({ kind: 'suggest', suggestionId: suggestion.id, lineId: line.id });
    }
  }

  function onFeed(raw: unknown): void {
    const parsed = MeetingFeedSchema.safeParse(raw);
    if (!parsed.success || !active) return;
    const meeting = repo.get(active);
    if (!meeting || meeting.state !== 'live') return;
    const event = parsed.data;
    const text = event.text.replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    const speaker = event.source === 'mic' ? 'me' : 'them';
    const lang = detectLanguage(text) ?? event.detectedLang ?? (speaker === 'me' ? (event.lang ?? null) : null);
    const line: MeetingLine = {
      id: event.id,
      meetingId: meeting.id,
      speaker,
      text,
      startedAt: event.startedAt as IsoDateTime,
      endedAt: event.endedAt as IsoDateTime,
      lang: lang && lang !== 'auto' ? lang : null,
      translation: null,
      translationState: 'none',
    };
    if (speaker === 'them') {
      finalize(line);
      // Geriye dönük: bu sözün yankısı "Siz" diye önce yazılmış olabilir (iki kaynak ayrı sıradadır).
      const theirs = theirsNear(meeting.id, line);
      for (const [id, item] of [...pending]) {
        if (!isEcho(item.line, theirs)) continue;
        item.cancel();
        pending.delete(id);
        countEcho(meeting.id);
        changed({ kind: 'line_removed', meetingId: meeting.id, lineId: id, reason: 'echo' });
      }
      const from = Date.parse(line.startedAt) - ECHO_WINDOW_MS;
      for (const mine of repo.lines(meeting.id).filter((item) => item.speaker === 'me' && Date.parse(item.endedAt) >= from)) {
        if (!isEcho(mine, theirs)) continue;
        repo.deleteLines([mine.id]);
        countEcho(meeting.id);
        changed({ kind: 'line_removed', meetingId: meeting.id, lineId: mine.id, reason: 'echo' });
      }
      return;
    }
    if (isEcho(line, theirsNear(meeting.id, line))) {
      countEcho(meeting.id);
      log.debug('toplantı: "Siz" satırı karşı tarafın yankısı; yazılmadı');
      return;
    }
    const systemOn = meeting.system && deps.voice.status().meeting?.system === 'on';
    if (!systemOn) {
      finalize(line);
      return;
    }
    changed({ kind: 'pending', meetingId: meeting.id, line });
    const cancel = deps.defer(() => {
      if (!pending.delete(line.id)) return;
      if (isEcho(line, theirsNear(line.meetingId, line))) {
        countEcho(line.meetingId);
        changed({ kind: 'line_removed', meetingId: line.meetingId, lineId: line.id, reason: 'echo' });
        return;
      }
      finalize(line);
    }, ECHO_HOLD_MS);
    pending.set(line.id, { line, cancel });
  }

  function flushPending(): void {
    for (const [id, item] of [...pending]) {
      item.cancel();
      pending.delete(id);
      if (isEcho(item.line, theirsNear(item.line.meetingId, item.line))) {
        countEcho(item.line.meetingId);
        changed({ kind: 'line_removed', meetingId: item.line.meetingId, lineId: id, reason: 'echo' });
      } else finalize(item.line);
    }
  }

  // ───────────────────────── çeviri ve öneri (dil modeli sırası) ─────────────────────────

  function enqueue(task: LlmTask): void {
    queue.push(task);
    // Canlı yazı geride kalmasın: çok birikirse en eski çeviriler atlanır.
    const translations = queue.filter((item) => item.kind === 'translate');
    for (const old of translations.slice(0, Math.max(0, translations.length - TRANSLATION_BACKLOG))) {
      queue.splice(queue.indexOf(old), 1);
      const line = repo.setTranslation((old as Extract<LlmTask, { kind: 'translate' }>).lineId, null, 'skipped');
      if (line) changed({ kind: 'line', meetingId: line.meetingId, line });
    }
    pump();
  }

  /**
   * Öncelik kuralı (ekran kartı paylaşımı): (1) Jarvis'in kendi sesli turu, (2) toplantının yazıya çevrilmesi, (3) öneri,
   * (4) çeviri. Sesli tur sürerken ya da ses hattında yazıya çevrilmeyi bekleyen bölüt varken dil modeline iş verilmez.
   */
  function pump(): void {
    if (running || queue.length === 0) return;
    const sttBacklog = deps.voice.status().meeting?.queued ?? 0;
    if (voiceBusy || sttBacklog > STT_BACKLOG) {
      retry ??= deps.defer(() => {
        retry = null;
        pump();
      }, RETRY_MS);
      return;
    }
    const index = queue.findIndex((item) => item.kind === 'suggest');
    const [task] = queue.splice(index >= 0 ? index : 0, 1);
    if (!task) return;
    running = true;
    void (task.kind === 'translate' ? translate(task.lineId) : suggest(task.suggestionId, task.lineId))
      .catch((error: unknown) => log.warn('toplantı: dil modeli işi başarısız', error))
      .finally(() => {
        running = false;
        pump();
      });
  }

  async function translate(lineId: Id): Promise<void> {
    const line = repo.getLine(lineId);
    if (!line) return;
    const meeting = repo.get(line.meetingId);
    const target = meeting ? translationTarget(meeting) : null;
    if (!meeting || !target) {
      repo.setTranslation(lineId, null, 'none');
      return;
    }
    const result = await deps.brain
      .extract({ role: 'memory', instructions: translationInstructions(target, meeting.context), input: line.text, schema: TranslationSchema })
      .catch(() => null);
    const translation = cleanTranslation(result?.translation);
    const same = translation !== null && translation.toLocaleLowerCase('tr').replace(/\W+/gu, '') === line.text.toLocaleLowerCase('tr').replace(/\W+/gu, '');
    const updated = repo.setTranslation(lineId, same ? null : translation, translation === null ? 'failed' : same ? 'same' : 'done');
    if (updated) changed({ kind: 'line', meetingId: updated.meetingId, line: updated });
  }

  async function suggest(suggestionId: Id, lineId: Id): Promise<void> {
    const line = repo.getLine(lineId);
    const meeting = line ? repo.get(line.meetingId) : null;
    if (!line || !meeting || meeting.state !== 'live') {
      const skipped = repo.updateSuggestion(suggestionId, { state: 'skipped' });
      if (skipped) changed({ kind: 'suggestion', meetingId: skipped.meetingId, suggestion: skipped });
      return;
    }
    const recent = repo.lines(meeting.id).filter((item) => Date.parse(item.startedAt) <= Date.parse(line.startedAt)).slice(-12);
    const prompt = suggestionPrompt({
      question: line.text,
      questionLanguage: line.lang,
      target: translationTarget(meeting),
      recent,
      context: meeting.context,
      ...(deps.settings.get().userName ? { userName: deps.settings.get().userName as string } : {}),
    });
    const result = await deps.brain.extract({ role: 'memory', instructions: prompt.instructions, input: prompt.input, schema: SuggestionSchema }).catch(() => null);
    const reply = cleanTranslation(result?.reply);
    const updated = repo.updateSuggestion(suggestionId, {
      state: reply ? 'ready' : 'failed',
      reply,
      translation: reply ? cleanTranslation(result?.translation) : null,
    });
    if (updated) changed({ kind: 'suggestion', meetingId: updated.meetingId, suggestion: updated });
  }

  // ───────────────────────── özet ─────────────────────────

  async function summarize(id: Id): Promise<Meeting> {
    const meeting = repo.get(id);
    if (!meeting) throw new UserError(t('meeting.error.missing'));
    summarizing++;
    try {
      const lines = repo.lines(id);
      const finish = (patch: { summary: MeetingSummary | null; problem: SummaryProblem | null; detail?: string | null; dropped?: number }) => {
        const updated = repo.update(id, {
          summary: patch.summary,
          summaryProblem: patch.problem,
          summaryDetail: patch.detail ?? null,
          summaryDropped: patch.dropped ?? 0,
          title: meetingTitle({ topic: meeting.context.topic, summary: patch.summary, firstLine: lines[0]?.text ?? meeting.title }),
        });
        changed({ kind: 'meeting', meetingId: id });
        return updated ?? meeting;
      };
      if (lines.length === 0) return finish({ summary: meeting.summary, problem: meeting.summary ? null : 'empty' });

      const target = translationTarget(meeting) ?? persona().language;
      const transcript = numberedTranscript(lines, meeting.startedAt);
      const contextBlock = contextEmpty(meeting.context) ? '' : contextText(meeting.context, 'summary');
      const instructions = summaryInstructions(target, contextBlock !== '');
      const input = contextBlock ? `Meeting context given by the listener:\n${contextBlock}\n\nTranscript:\n${transcript}` : `Transcript:\n${transcript}`;

      let raw: z.infer<typeof SummarySchema> | null = null;
      let engine: SummaryEngine | null = null;
      let failure: string | null = null;
      const deep = deps.deep();
      const availability = deep ? await deep.refresh().catch(() => deep.available()) : null;
      if (deep && availability?.ok) {
        try {
          const answer = await deep.ask({ system: `${instructions} Reply with the JSON object only.`, prompt: input, maxSeconds: DEEP_SUMMARY_SECONDS });
          const parsed = SummarySchema.safeParse(extractJson(answer.text));
          if (parsed.success) {
            raw = parsed.data;
            engine = 'deep';
          } else failure = 'invalid';
        } catch (error) {
          log.warn('toplantı özeti derin beyinde yazılamadı', error);
          failure = (error as Error).message;
        }
      }
      if (!raw) {
        let provider: 'cloud' | 'local' | 'none' = 'none';
        try {
          provider = deps.brain.status().provider;
        } catch {
          provider = 'none';
        }
        if (provider === 'local' && input.length > LOCAL_SUMMARY_MAX) {
          // Küçük model yalnız kısa dökümü özetler: yarım dökümle yazılan özet bütün toplantının özeti sanılır.
          return finish({ summary: null, problem: 'needs_deep', detail: availability?.reason ?? failure ?? null });
        }
        if (provider === 'none') return finish({ summary: null, problem: deep && availability?.ok ? 'failed' : 'no_brain', detail: failure ?? availability?.reason ?? null });
        raw = await deps.brain.extract({ role: 'memory', instructions, input, schema: SummarySchema }).catch(() => null);
        engine = provider;
      }
      if (!raw || !engine) return finish({ summary: null, problem: 'failed', detail: failure });
      const grounded = groundSummary(raw as { points: RawSummaryItem[]; decisions: RawSummaryItem[]; actions: RawSummaryItem[] }, lines);
      if (grounded.dropped > 0) log.info(`toplantı özeti: dayanağı bulunmayan ${grounded.dropped} madde atıldı`);
      const summary: MeetingSummary = { ...grounded.summary, engine, createdAt: iso() };
      // Önceki özetten Planlar'a aktarılmış maddelerin bağı korunur.
      for (const action of summary.actions) {
        const before = meeting.summary?.actions.find((item) => item.text === action.text && item.todoId);
        if (before?.todoId) action.todoId = before.todoId;
      }
      return finish({ summary, problem: null, dropped: grounded.dropped });
    } finally {
      summarizing--;
    }
  }

  // ───────────────────────── başlat / bitir ─────────────────────────

  function begin(options: MeetingStartOptions): MeetingStatus {
    const existing = current();
    if (existing?.state === 'live') return status();
    if (deps.policy.killSwitchActive()) throw new UserError(t('meeting.error.killSwitch'));
    if (!consentAt()) throw new UserError(t('meeting.error.consent'));
    if (typeof deps.voice.setMeeting !== 'function') throw new UserError(t('meeting.unavailable.voice'));
    const voice = deps.voice.status();
    if (!voice.ready) throw new UserError(t('meeting.error.notReady', { reason: voice.notReadyReason ?? t('meeting.unavailable.voice') }));
    const context = cleanContext({ ...options.context, documents: options.context?.documents ?? [] });
    const target = options.target === null ? null : isMeetingLanguage(options.target) ? options.target : persona().language;
    const theirLanguage = options.theirLanguage && (options.theirLanguage === 'auto' || isMeetingLanguage(options.theirLanguage)) ? options.theirLanguage : 'auto';
    const meeting = repo.create({
      title: meetingTitle({ topic: context.topic }) || t('meeting.untitled'),
      startedAt: iso(),
      target,
      theirLanguage,
      suggestions: options.suggestions !== false,
      system: options.system !== false,
      context,
    });
    active = meeting.id;
    deps.voice.setMeeting({ on: true, system: meeting.system, systemLanguage: theirLanguage });
    deps.attention.notify({
      moduleId: MODULE_ID,
      title: t('meeting.notify.started'),
      body: t('meeting.notify.startedBody'),
      priority: 'normal',
      speak: false,
      dedupeKey: `meeting:${meeting.id}:start`,
      actions: [{ id: 'open', label: t('meeting.notify.open') }],
    });
    changed({ kind: 'meeting', meetingId: meeting.id });
    return publish();
  }

  function end(options: { summarize?: boolean; reason?: 'user' | 'panic' | 'shutdown' | 'consent' } = {}): Promise<MeetingStatus> {
    if (ending) return ending;
    const meeting = current();
    if (!meeting || meeting.state !== 'live') return Promise.resolve(status());
    ending = (async () => {
      const id = meeting.id;
      const quick = options.reason === 'panic' || options.reason === 'shutdown' || options.reason === 'consent';
      repo.update(id, { state: 'summarizing' });
      changed({ kind: 'meeting', meetingId: id });
      publish();
      if (!quick) {
        // Ses hattında yazılmayı bekleyen son sözler kaybolmasın (en çok `DRAIN_MS`).
        const deadline = deps.now().getTime() + DRAIN_MS;
        while ((deps.voice.status().meeting?.queued ?? 0) > 0 && deps.now().getTime() < deadline) {
          await new Promise<void>((resolve) => void deps.defer(resolve, 150));
        }
      }
      deps.voice.setMeeting?.({ on: false });
      flushPending();
      // Bitişte bekleyen öneriler anlamsızdır; çeviriler yalnız acil durdurma ve kapanışta atılır.
      for (const task of queue.splice(0)) {
        if (task.kind === 'suggest') {
          const skipped = repo.updateSuggestion(task.suggestionId, { state: 'skipped' });
          if (skipped) changed({ kind: 'suggestion', meetingId: skipped.meetingId, suggestion: skipped });
        } else if (quick) repo.setTranslation(task.lineId, null, 'skipped');
        else queue.push(task);
      }
      repo.update(id, { endedAt: iso() });
      active = null;
      const summarized = options.summarize !== false && !quick ? await summarize(id).catch((error: unknown) => {
        log.warn('toplantı özeti yazılamadı', error);
        return repo.update(id, { summaryProblem: 'failed' });
      }) : null;
      repo.update(id, { state: 'ended' });
      changed({ kind: 'meeting', meetingId: id });
      if (!quick) {
        const final = summarized ?? repo.get(id);
        deps.attention.notify({
          moduleId: MODULE_ID,
          title: t('meeting.notify.ended'),
          body: final?.summary ? t('meeting.notify.endedSummary', { decisions: final.summary.decisions.length, actions: final.summary.actions.length }) : t('meeting.notify.endedNoSummary'),
          priority: 'low',
          speak: false,
          dedupeKey: `meeting:${id}:end`,
          actions: [{ id: 'open', label: t('meeting.notify.open') }],
          data: { meetingId: id },
        });
      }
      pump();
      return publish();
    })().finally(() => {
      ending = null;
    });
    return ending;
  }

  // ───────────────────────── Planlar'a aktarma ─────────────────────────

  async function exportActions(id: Id, index?: number): Promise<{ added: number; skipped: number; meeting: Meeting }> {
    const meeting = repo.get(id);
    if (!meeting?.summary) throw new UserError(t('meeting.error.noSummary'));
    if (!deps.tools.has('todo_add')) throw new UserError(t('meeting.error.plannerOff'));
    const summary: MeetingSummary = { ...meeting.summary, actions: meeting.summary.actions.map((item) => ({ ...item })) };
    let added = 0;
    let skipped = 0;
    for (const [position, action] of summary.actions.entries()) {
      if (index !== undefined && index !== position) continue;
      if (action.todoId) {
        skipped++;
        continue;
      }
      const notes = [t('meeting.todo.note', { title: meeting.title }), action.owner ? t('meeting.todo.owner', { owner: action.owner }) : ''].filter(Boolean).join(' · ');
      // Planlar'ın kendi aracı: kopya koruması ve kayıt kuralları tek yerde kalır.
      const result = await deps.tools.run(
        'todo_add',
        { text: action.text, notes, ...(action.due ? { due_day: action.due } : {}) },
        { origin: { channel: 'ui', speakerVerified: null } },
      );
      if (!result.ok) throw new UserError(result.text);
      const todoId = (result.data as { id?: unknown } | undefined)?.id;
      if (typeof todoId === 'string') action.todoId = todoId;
      added++;
    }
    const updated = repo.update(id, { summary }) ?? meeting;
    changed({ kind: 'meeting', meetingId: id });
    return { added, skipped, meeting: updated };
  }

  // ───────────────────────── yaşam döngüsü ─────────────────────────

  function runRetention(): void {
    const now = deps.now().getTime();
    const removed = repo.retain(new Date(now - retentionDays() * 86_400_000).toISOString() as IsoDateTime, new Date(now - MEETING_RETENTION.summaryDays * 86_400_000).toISOString() as IsoDateTime);
    if (removed.lines || removed.meetings) log.info(`toplantı saklama: ${removed.lines} satır, ${removed.meetings} toplantı silindi`);
  }

  return {
    start() {
      // Uygulama süren toplantıyla kapandıysa toplantı biter (özetsiz; kullanıcı sonra özet isteyebilir).
      for (const meeting of repo.unfinished()) {
        const lines = repo.lines(meeting.id);
        repo.update(meeting.id, { state: 'ended', endedAt: meeting.endedAt ?? lines.at(-1)?.endedAt ?? meeting.startedAt });
      }
      subscriptions.push(
        bus.on('voice.meeting', (event) => onFeed(event)),
        bus.on('voice.state', ({ state }) => {
          voiceBusy = state === 'listening' || state === 'thinking' || state === 'speaking';
          if (!voiceBusy) pump();
        }),
        bus.on('voice.status', () => {
          if (active) publish();
        }),
        bus.on('brain.status', () => publish()),
        bus.on('app.panic', () => void end({ summarize: false, reason: 'panic' })),
        bus.on('policy.changed', () => {
          if (deps.policy.killSwitchActive() && active) void end({ summarize: false, reason: 'panic' });
          publish();
        }),
        bus.on('attention.action', ({ moduleId, actionId }) => {
          if (moduleId === MODULE_ID && actionId === 'open') bus.emit('app.navigate', { page: 'meeting' });
        }),
        bus.on('hotkey.pressed', ({ id }) => {
          if ((id as string) !== 'meeting') return;
          if (current()?.state === 'live') {
            void end({ reason: 'user' });
            return;
          }
          try {
            begin({});
          } catch (error) {
            // Rıza yoksa ya da hat hazır değilse sayfa açılır ve neden orada söylenir.
            deps.attention.notify({ moduleId: MODULE_ID, title: t('meeting.notify.cannotStart'), body: (error as Error).message, priority: 'normal', speak: false, actions: [{ id: 'open', label: t('meeting.notify.open') }] });
          }
        }),
      );
      runRetention();
      publish();
    },

    stop() {
      for (const off of subscriptions.splice(0)) off();
      retry?.();
      retry = null;
      for (const item of pending.values()) item.cancel();
      pending.clear();
      queue.length = 0;
      const meeting = current();
      if (meeting?.state === 'live') {
        deps.voice.setMeeting?.({ on: false });
        repo.update(meeting.id, { state: 'ended', endedAt: iso() });
      }
      active = null;
    },

    status,
    consent(accept) {
      repo.setState('consentAt', accept ? iso() : null);
      if (!accept && active) void end({ summarize: false, reason: 'consent' });
      return publish();
    },
    begin,
    end,
    setContext(patch) {
      const meeting = current();
      if (!meeting) throw new UserError(t('meeting.error.notActive'));
      const context = cleanContext({ ...meeting.context, ...patch });
      repo.update(meeting.id, { context, title: meetingTitle({ topic: context.topic }) || meeting.title });
      changed({ kind: 'meeting', meetingId: meeting.id });
      return publish();
    },
    setOptions(patch) {
      const meeting = current();
      if (!meeting) throw new UserError(t('meeting.error.notActive'));
      const target = patch.target === undefined ? undefined : patch.target === null ? null : isMeetingLanguage(patch.target) ? patch.target : undefined;
      const theirLanguage = patch.theirLanguage && (patch.theirLanguage === 'auto' || isMeetingLanguage(patch.theirLanguage)) ? patch.theirLanguage : undefined;
      repo.update(meeting.id, {
        ...(target !== undefined ? { target } : {}),
        ...(patch.suggestions !== undefined ? { suggestions: patch.suggestions } : {}),
        ...(theirLanguage ? { theirLanguage } : {}),
      });
      if (theirLanguage) deps.voice.setMeeting?.({ on: true, system: meeting.system, systemLanguage: theirLanguage });
      changed({ kind: 'meeting', meetingId: meeting.id });
      return publish();
    },
    summarize,
    exportActions,
    runRetention,
    deleteMeeting(id) {
      if (id === active) throw new UserError(t('meeting.error.deleteActive'));
      repo.deleteMeeting(id);
      changed({ kind: 'meeting', meetingId: id });
    },
    deleteAll() {
      if (active) void end({ summarize: false, reason: 'consent' });
      repo.deleteAll();
      deps.attention.forgetModule?.(MODULE_ID);
      changed({ kind: 'meeting', meetingId: '*' });
      publish();
    },
    activeId: () => active,
    idle: () => pending.size === 0 && queue.length === 0 && !running && summarizing === 0 && ending === null,
  };
}
