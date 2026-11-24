// Toplantı modülü: sahte ses hattı (hazır `voice.meeting` olayları), sahte beyin ve derin beyin, gerçek SQLite.
// Gerçek mikrofon, bilgisayar sesi ve model yok; ses hattı ile uçtan uca yol `scripts/e2e/meeting.mjs`'tedir.
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type BrainExtractRequest, type BrainStatus, type IsoDateTime, type Notification, type NotifyRequest, type VoiceMeetingStatus } from '@fuber/shared';
import { fakePolicy, fakeSettings, fakeVoice, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import type { DeepAvailability, DeepBrain } from '../../core/brain/deep/types';
import { createMeetingRepo, MEETING_MIGRATIONS } from './repo';
import { createMeetingService, ECHO_HOLD_MS } from './service';
import { createTools } from './tools';
import type { MeetingChange } from './types';

const START = Date.UTC(2026, 10, 16, 9, 0, 0);

interface Options {
  provider?: BrainStatus['provider'];
  deep?: boolean;
  consent?: boolean;
  summary?: unknown;
}

const kits: Array<{ close(): void }> = [];
afterEach(() => {
  for (const kit of kits.splice(0)) kit.close();
});

function kit(options: Options = {}) {
  const env = tempStore();
  kits.push(env);
  env.store.migrate('meeting', MEETING_MIGRATIONS);
  const bus = testBus();
  let nowMs = START;
  const now = () => new Date(nowMs);
  const repo = createMeetingRepo(env.store.scoped('meeting'), now);
  const policy = fakePolicy();
  const settings = fakeSettings(bus, { userName: 'Kaan' });
  const voice = fakeVoice();
  const meetingState: VoiceMeetingStatus = { on: false, system: 'off', systemError: null, queued: 0 };
  const meetingCalls: Array<{ on: boolean; system?: boolean; systemLanguage?: string }> = [];
  const voiceStatus = voice.status.bind(voice);
  voice.status = () => ({ ...voiceStatus(), meeting: { ...meetingState } });
  voice.setMeeting = (request) => {
    meetingCalls.push(request);
    meetingState.on = request.on;
    meetingState.system = request.on && request.system !== false ? 'on' : 'off';
  };
  let provider = options.provider ?? 'local';
  const extractCalls: Array<BrainExtractRequest<unknown>> = [];
  const answers = {
    translate: (input: string): unknown => ({ translation: `TR: ${input}` }),
    suggest: (_input: string): unknown => ({ reply: 'Cuma günü gönderebilirim.', translation: 'I can send it on Friday.' }),
    summary: (_input: string): unknown => options.summary ?? null,
  };
  const brain = {
    async extract<T>(request: BrainExtractRequest<T>): Promise<T | null> {
      extractCalls.push(request as BrainExtractRequest<unknown>);
      const kind = request.instructions.startsWith('Translate') ? 'translate' : request.instructions.startsWith('You help') ? 'suggest' : 'summary';
      const raw = answers[kind](request.input);
      const parsed = (request.schema as z.ZodType<T>).safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    status: (): BrainStatus => ({ provider, reason: 'ok', cause: null, localReady: true, localModel: 'test', message: null }),
  };
  const deepCalls: string[] = [];
  const deepState: DeepAvailability = options.deep ? { ok: true, provider: 'claude-code' } : { ok: false, provider: null, reason: 'Claude Code kurulu değil' };
  const deep = {
    available: () => deepState,
    refresh: async () => deepState,
    ask: async (request: { prompt: string }) => {
      deepCalls.push(request.prompt);
      return { text: JSON.stringify(options.summary ?? {}), provider: 'claude-code' };
    },
  } as unknown as DeepBrain;
  const tools = miniTools();
  const todos: Array<Record<string, unknown>> = [];
  const ctx = moduleContext('planner', { bus });
  tools.bind(ctx, [
    defineTool({
      name: 'todo_add',
      description: 'sahte',
      input: z.object({ text: z.string(), notes: z.string().optional(), due_day: z.string().optional() }),
      risk: 'write',
      async run(input) {
        todos.push(input);
        return { ok: true, text: 'eklendi', data: { id: `todo-${todos.length}` } };
      },
    }),
  ]);
  const notifications: NotifyRequest[] = [];
  const deferred: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const service = createMeetingService({
    repo,
    bus,
    voice,
    brain: brain as never,
    policy,
    settings,
    tools,
    attention: {
      notify(request: NotifyRequest) {
        notifications.push(request);
        return { id: `n${notifications.length}` } as Notification;
      },
    } as never,
    log: silentLog,
    deep: () => deep,
    now,
    defer(run, ms) {
      const entry = { run, ms, cancelled: false };
      deferred.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  const changes: MeetingChange[] = [];
  bus.on('meeting.changed', (change) => void changes.push(change));
  service.start();
  if (options.consent !== false) service.consent(true);
  let counter = 0;
  /** Ses hattının yayınladığı satır; `at` toplantı başından saniye. */
  const feed = (source: 'mic' | 'system', text: string, at: number, seconds = 2, extra: Record<string, unknown> = {}) => {
    bus.emit('voice.meeting', {
      id: `f-${++counter}`,
      text,
      source,
      startedAt: new Date(START + at * 1000).toISOString() as IsoDateTime,
      endedAt: new Date(START + (at + seconds) * 1000).toISOString() as IsoDateTime,
      durationMs: seconds * 1000,
      lang: source === 'mic' ? 'tr' : 'auto',
      ...extra,
    } as never);
  };
  /** Bekleyen gecikmeli işleri (yankı bekletmesi, yeniden deneme) koşturur ve mikro görevleri boşaltır. */
  const settle = async () => {
    for (let round = 0; round < 20; round++) {
      const due = deferred.splice(0).filter((entry) => !entry.cancelled);
      for (const entry of due) entry.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (deferred.every((entry) => entry.cancelled) && service.idle()) return;
    }
  };
  return {
    env,
    bus,
    repo,
    policy,
    voice,
    meetingState,
    meetingCalls,
    service,
    answers,
    extractCalls,
    deepCalls,
    todos,
    notifications,
    deferred,
    changes,
    feed,
    settle,
    tools: createTools(() => ({ service, repo, bus, now })),
    setProvider(next: BrainStatus['provider']) {
      provider = next;
    },
    advance(ms: number) {
      nowMs += ms;
    },
    lines: () => repo.lines(service.activeId() ?? repo.list(1)[0]?.id ?? ''),
  };
}

describe('başlatma ve gizlilik', () => {
  it('rıza olmadan başlamaz; rızayla ses hattını toplantı kipine alır', () => {
    const h = kit({ consent: false });
    expect(() => h.service.begin({})).toThrow(/rıza/);
    expect(h.meetingCalls).toHaveLength(0);
    h.service.consent(true);
    const status = h.service.begin({ theirLanguage: 'en', context: { topic: 'Atlas teklifi' } });
    expect(h.meetingCalls).toEqual([{ on: true, system: true, systemLanguage: 'en' }]);
    expect(status.active).toMatchObject({ state: 'live', title: 'Atlas teklifi', target: 'tr', suggestions: true });
    // Ekranda gösterge: başlangıç bildirimi sessizdir (seslendirilmez).
    expect(h.notifications[0]).toMatchObject({ priority: 'normal', speak: false });
  });

  it('ses saklanmaz: yükteki ses örneği atılır, hiçbir tabloda ikili sütun yok', async () => {
    const h = kit();
    h.service.begin({ system: false });
    h.feed('mic', 'Merhaba, başlayalım.', 0, 2, { pcm: [1, 2, 3], wav: 'UklGRg==' });
    await h.settle();
    const db = h.env.store.scoped('meeting');
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'meeting_%' AND name NOT LIKE '%fts%'");
    for (const { name } of tables) {
      const columns = db.all<{ name: string; type: string }>(`PRAGMA table_info(${name})`);
      expect(columns.some((column) => /blob/i.test(column.type) || /pcm|wav|audio/i.test(column.name)), name).toBe(false);
    }
    const stored = JSON.stringify(db.all('SELECT * FROM meeting_lines'));
    expect(stored).not.toContain('UklGRg');
    expect(stored).toContain('Merhaba');
  });

  it('acil durdurma toplantıyı özetsiz bitirir ve ses hattını kipten çıkarır', async () => {
    const h = kit({ deep: true });
    h.service.begin({});
    h.bus.emit('app.panic', { at: new Date().toISOString() as IsoDateTime, source: 'ui' });
    await h.settle();
    expect(h.meetingCalls.at(-1)).toEqual({ on: false });
    expect(h.repo.list(1)[0]).toMatchObject({ state: 'ended', hasSummary: false });
    expect(h.deepCalls).toHaveLength(0);
  });
});

describe('canlı yazı, yankı süzgeci, çeviri, öneri', () => {
  it('iki kaynak ayrı etiketlenir; karşı tarafın İngilizce satırı Türkçeye çevrilir, Türkçe satır çevrilmez', async () => {
    const h = kit();
    h.service.begin({ system: false });
    h.feed('system', 'We shipped the first batch yesterday.', 0);
    h.feed('mic', 'Güzel, teşekkürler.', 3);
    await h.settle();
    const lines = h.lines();
    expect(lines.map((line) => [line.speaker, line.lang])).toEqual([
      ['them', 'en'],
      ['me', 'tr'],
    ]);
    expect(lines[0]).toMatchObject({ translationState: 'done', translation: 'TR: We shipped the first batch yesterday.' });
    expect(lines[1]).toMatchObject({ translationState: 'same', translation: null });
    // Çeviri istemi terim sözlüğünü korur ve hedef dili söyler.
    expect(h.extractCalls[0]?.instructions).toContain('Turkish');
  });

  it('hoparlörden mikrofona kaçan karşı taraf sesi "Siz" diye yazılmaz (önce karşı taraf gelirse)', async () => {
    const h = kit();
    h.service.begin({});
    h.feed('system', 'Could you send me the final offer by Friday?', 10, 4);
    h.feed('mic', 'Could you sent me the final offer by friday', 10.3, 4);
    await h.settle();
    expect(h.lines().map((line) => line.speaker)).toEqual(['them']);
    expect(h.service.status().active?.echoDropped).toBe(1);
  });

  it('"Siz" satırı önce gelirse bekletilir; aynı söz karşı taraftan gelince geri alınır, gerçek söz kalır', async () => {
    const h = kit();
    h.service.begin({});
    h.feed('mic', 'Can we move the deadline to next week', 20, 3);
    h.feed('mic', 'Bence olur, ekiple konuşurum.', 26, 2);
    expect(h.changes.filter((change) => change.kind === 'pending')).toHaveLength(2);
    expect(h.lines()).toHaveLength(0);
    h.feed('system', 'Can we move the deadline to next week?', 19.8, 3.2);
    expect(h.changes.some((change) => change.kind === 'line_removed' && change.reason === 'echo')).toBe(true);
    expect(h.deferred.some((entry) => entry.ms === ECHO_HOLD_MS)).toBe(true);
    await h.settle();
    expect(h.lines().map((line) => `${line.speaker}: ${line.text}`)).toEqual(['them: Can we move the deadline to next week?', 'me: Bence olur, ekiple konuşurum.']);
  });

  it('karşı tarafın sorusunda yalnız ekranda yanıt önerisi; düz cümlede öneri yok', async () => {
    const h = kit();
    h.service.begin({ system: false });
    h.feed('system', 'We will start next month.', 0);
    h.feed('system', 'When can you send the signed contract?', 5);
    await h.settle();
    const meeting = h.service.status().active;
    const suggestions = h.repo.suggestions(meeting?.id ?? '');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ state: 'ready', reply: 'Cuma günü gönderebilirim.', question: 'When can you send the signed contract?' });
    const prompt = h.extractCalls.find((call) => call.instructions.startsWith('You help'));
    expect(prompt?.instructions).toContain('Kaan');
    expect(prompt?.input).toContain('We will start next month.');
  });

  it('öncelik: sesli tur sürerken ya da yazıya çevirme sırası doluyken dil modeline iş verilmez', async () => {
    const h = kit();
    h.service.begin({ system: false });
    h.bus.emit('voice.state', { state: 'thinking', prev: 'listening', reason: 'speech_end', at: new Date().toISOString() as IsoDateTime });
    h.feed('system', 'We shipped the first batch yesterday.', 0);
    for (const entry of h.deferred.splice(0)) entry.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.extractCalls).toHaveLength(0);
    h.meetingState.queued = 5;
    h.bus.emit('voice.state', { state: 'idle', prev: 'thinking', reason: 'turn_done' as never, at: new Date().toISOString() as IsoDateTime });
    for (const entry of h.deferred.splice(0)) entry.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.extractCalls).toHaveLength(0);
    h.meetingState.queued = 0;
    await h.settle();
    expect(h.extractCalls).toHaveLength(1);
  });
});

describe('özet ve Planlar', () => {
  const SUMMARY = {
    points: [{ text: 'Teslim tarihi konuşuldu', line: 1, quote: 'send the signed contract' }],
    decisions: [
      { text: 'Fiyat yüzde on indirilecek', line: 2, quote: 'yüzde on indirime karar verdik' },
      { text: 'Yeni ofis kiralanacak', line: 2, quote: 'yeni ofis tutuyoruz' },
    ],
    actions: [{ text: 'İmzalı sözleşmeyi cumaya kadar gönder', line: 1, quote: 'send the signed contract', owner: 'Karşı taraf', due: '2026-11-20' }],
  };

  it('derin beyinle özet; dayanaksız madde atılır; yapılacaklar tek tıkla Planlar’a, ikinci kez eklenmez', async () => {
    const h = kit({ deep: true, summary: SUMMARY });
    h.service.begin({ system: false });
    h.feed('system', 'When can you send the signed contract?', 0);
    h.feed('mic', 'Tamam, yüzde on indirime karar verdik.', 4);
    await h.settle();
    await h.service.end({ reason: 'user' });
    await h.settle();
    const meeting = h.repo.ended(1)[0];
    expect(meeting?.summary?.engine).toBe('deep');
    expect(meeting?.summary?.decisions.map((item) => item.text)).toEqual(['Fiyat yüzde on indirilecek']);
    expect(meeting?.summaryDropped).toBe(1);
    expect(h.deepCalls[0]).toContain('[1] 0:00 Other side: When can you send');
    expect(h.meetingCalls.at(-1)).toEqual({ on: false });
    const first = await h.service.exportActions(meeting?.id ?? '');
    expect(first.added).toBe(1);
    expect(h.todos[0]).toMatchObject({ text: 'İmzalı sözleşmeyi cumaya kadar gönder', due_day: '2026-11-20' });
    expect(String(h.todos[0]?.notes)).toContain('Sorumlu: Karşı taraf');
    const second = await h.service.exportActions(meeting?.id ?? '');
    expect(second).toMatchObject({ added: 0, skipped: 1 });
    expect(h.todos).toHaveLength(1);
    expect(h.notifications.at(-1)).toMatchObject({ speak: false });
  });

  it('derin beyin yokken uzun toplantı yerel modelle özetlenmez: "derin beyin gerekiyor"', async () => {
    const h = kit({ provider: 'local', summary: SUMMARY });
    h.service.begin({ system: false });
    for (let index = 0; index < 120; index++) h.feed('mic', `Uzun toplantının ${index}. satırı, bütçe ve takvim üzerine ayrıntılı bir konuşma.`, index * 5, 4);
    await h.settle();
    await h.service.end({ reason: 'user' });
    const meeting = h.repo.ended(1)[0];
    expect(meeting).toMatchObject({ summary: null, summaryProblem: 'needs_deep', summaryDetail: 'Claude Code kurulu değil' });
    expect(h.extractCalls.some((call) => call.instructions.startsWith('Summarize'))).toBe(false);
  });

  it('derin beyin yokken kısa toplantı yerel modelle özetlenir ve öyle işaretlenir', async () => {
    const h = kit({ provider: 'local', summary: SUMMARY });
    h.service.begin({ system: false });
    h.feed('system', 'When can you send the signed contract?', 0);
    h.feed('mic', 'Tamam, yüzde on indirime karar verdik.', 4);
    await h.settle();
    await h.service.end({ reason: 'user' });
    expect(h.repo.ended(1)[0]?.summary?.engine).toBe('local');
  });

  it('hiç beyin yokken uydurma yok: özet yazılmaz, nedeni kayıtlı', async () => {
    const h = kit({ provider: 'none', summary: SUMMARY });
    h.service.begin({ system: false });
    h.feed('mic', 'Tamam, yüzde on indirime karar verdik.', 4);
    await h.settle();
    await h.service.end({ reason: 'user' });
    expect(h.repo.ended(1)[0]).toMatchObject({ summary: null, summaryProblem: 'no_brain' });
  });
});

describe('saklama', () => {
  it('döküm ortam dinlemenin süresiyle silinir; özet daha uzun kalır, sonra o da gider', async () => {
    const h = kit({ deep: true, summary: { points: [{ text: 'Merhaba', line: 1, quote: 'Merhaba herkese' }] } });
    h.policy.set({ ambient: { ...h.policy.get().ambient, retentionDays: 3 } });
    h.service.begin({ system: false });
    h.feed('mic', 'Merhaba herkese, başlayalım.', 0);
    await h.settle();
    await h.service.end({ reason: 'user' });
    const id = h.repo.ended(1)[0]?.id ?? '';
    h.advance(4 * 86_400_000);
    h.service.runRetention();
    expect(h.repo.lines(id)).toHaveLength(0);
    expect(h.repo.get(id)?.summary?.points).toHaveLength(1);
    h.advance(60 * 86_400_000);
    h.service.runRetention();
    expect(h.repo.get(id)).toBeNull();
  });
});

describe('araçlar', () => {
  const run = async (h: ReturnType<typeof kit>, name: string, input: Record<string, unknown> = {}) => {
    const tool = h.tools.find((item) => item.name === name);
    if (!tool) throw new Error(name);
    return tool.run(tool.input.parse(input) as never, {} as never);
  };

  it('meeting_start rıza yoksa sayfayı açar ve dürüstçe söyler; meeting_stop bitirir', async () => {
    const h = kit({ consent: false });
    const navigations: string[] = [];
    h.bus.on('app.navigate', ({ page }) => void navigations.push(page));
    const refused = await run(h, 'meeting_start');
    expect(refused.ok).toBe(false);
    expect(navigations).toEqual(['meeting']);
    h.service.consent(true);
    const started = await run(h, 'meeting_start', { topic: 'Bütçe' });
    expect(started.text).toContain('Toplantı modu açıldı');
    expect(h.service.status().active?.title).toBe('Bütçe');
    const stopped = await run(h, 'meeting_stop');
    expect(stopped.text).toContain('Toplantı bitti');
    await h.settle();
  });

  it('meeting_recall geçen toplantının kararını bulur; kayıt yoksa uydurmaz', async () => {
    const h = kit({ deep: true, summary: { decisions: [{ text: 'Fiyat yüzde on indirilecek', line: 1, quote: 'yüzde on indirime' }] } });
    expect((await run(h, 'meeting_recall', { query: 'fiyat' })).text).toBe('Kayıtlı toplantı yok.');
    h.service.begin({ system: false });
    h.feed('mic', 'Tamam, yüzde on indirime karar verdik.', 0);
    await h.settle();
    await h.service.end({ reason: 'user' });
    const found = await run(h, 'meeting_recall', { query: 'fiyat indirim' });
    expect(found.text).toContain('Fiyat yüzde on indirilecek');
    const summary = await run(h, 'meeting_summary');
    expect(summary.text).toContain('Kararlar:\n- Fiyat yüzde on indirilecek');
    expect(summary.text).toContain('kayıtta yapılacak yok');
    const none = await run(h, 'meeting_recall', { query: 'uzay mekiği' });
    expect(none.text).toContain('bir şey yok');
  });
});
