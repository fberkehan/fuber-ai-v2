import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Notification, NotifyRequest, PresenceState, VoiceState } from '@fuber/shared';
import { silentLog, tempStore } from '../../core/brain/testkit';
import type { NewsStory } from '../news/types';
import { composeBriefing, type BriefingSources } from './compose';
import { createBriefingEngine, type BriefingEngine } from './engine';
import { applyEngagement, dailyBreakingLimit, dailyUpdateLimit, speakGate, STEP_DOWN_WEIGHT, type GateInput } from './gates';
import { BRIEFING_MIGRATIONS, DEFAULT_ADAPTIVE, DEFAULT_PREFS, mergePrefs, normalizePrefs, parseSpokenPrefs, spokenClock } from './prefs';

const presence = (patch: Partial<PresenceState> = {}): PresenceState =>
  ({ mode: 'normal', fullscreen: false, meeting: false, cameraInUse: false, micInUseByOther: false, quiet: false, idleSeconds: 5, ...patch }) as PresenceState;

const story = (id: string, title: string, patch: Partial<NewsStory> = {}): NewsStory => ({
  id,
  title,
  url: `https://ornek.test/${id}`,
  source: 'TRT Haber',
  sources: ['TRT Haber'],
  category: 'tr',
  lang: 'tr',
  at: '2026-11-17T05:00:00.000Z',
  score: 60,
  reasons: [],
  read: false,
  ...patch,
});

describe('kapılar: ne zaman kendiliğinden konuşulur', () => {
  const base = (patch: Partial<GateInput> = {}): GateInput => ({
    kind: 'morning',
    now: new Date(2026, 10, 17, 8, 30),
    prefs: DEFAULT_PREFS,
    adaptive: { factor: 1 },
    presence: presence(),
    quiet: false,
    killSwitch: false,
    voiceState: 'idle',
    voiceQuiet: false,
    conversation: false,
    spokenLastHour: 0,
    updatesToday: 0,
    breakingToday: 0,
    lastSpokenAt: null,
    lastUpdateAt: null,
    ...patch,
  });

  it.each([
    ['olağan durumda konuşur', {}, 'ok'],
    ['acil durdurma', { killSwitch: true }, 'kill_switch'],
    ['brifing kapalı', { prefs: { ...DEFAULT_PREFS, enabled: false } }, 'disabled'],
    ['konuşkanlık sessiz', { prefs: { ...DEFAULT_PREFS, talk: 'silent' } }, 'silent'],
    ['öğrenilmiş sessizlik', { adaptive: { factor: 0 } }, 'learned_silent'],
    ['sessiz saat', { quiet: true }, 'quiet_hours'],
    ['tam ekran', { presence: presence({ fullscreen: true, mode: 'fullscreen' }) }, 'fullscreen'],
    ['toplantı (mikrofon başka uygulamada)', { presence: presence({ micInUseByOther: true }) }, 'meeting'],
    ['toplantı (kamera)', { presence: presence({ cameraInUse: true }) }, 'meeting'],
    ['sessiz kip', { voiceQuiet: true }, 'voice_quiet'],
    ['kullanıcı konuşuyor', { voiceState: 'listening' as VoiceState }, 'user_speaking'],
    ['asistan konuşuyor', { voiceState: 'speaking' as VoiceState }, 'user_speaking'],
    ['sohbet kipi açık', { conversation: true }, 'user_speaking'],
    ['bilgisayar başında değil', { presence: presence({ idleSeconds: 900 }) }, 'away'],
    ['saatlik üst sınır', { spokenLastHour: 2 }, 'hourly_limit'],
    ['az önce konuştu', { lastSpokenAt: new Date(2026, 10, 17, 8, 20).getTime() }, 'min_gap'],
    ['az düzeyde güncelleme yok', { kind: 'update', prefs: { ...DEFAULT_PREFS, talk: 'low' } }, 'level'],
    ['güncelleme saatleri dışında', { kind: 'update' }, 'outside_hours'],
    ['günlük güncelleme sınırı', { kind: 'update', now: new Date(2026, 10, 17, 15, 0), updatesToday: 2 }, 'daily_limit'],
    ['iki güncelleme arası üç saat', { kind: 'update', now: new Date(2026, 10, 17, 15, 0), updatesToday: 1, lastUpdateAt: new Date(2026, 10, 17, 13, 30).getTime() }, 'min_gap'],
    ['güncelleme zamanı', { kind: 'update', now: new Date(2026, 10, 17, 15, 0), updatesToday: 1, lastUpdateAt: new Date(2026, 10, 17, 11, 0).getTime() }, 'ok'],
    ['araya girme kapalı', { kind: 'breaking', prefs: { ...DEFAULT_PREFS, breaking: false } }, 'level'],
    ['günlük araya girme sınırı', { kind: 'breaking', breakingToday: 2 }, 'daily_limit'],
    ['kullanıcı istedi: sınırlara takılmaz', { kind: 'manual', quiet: true, spokenLastHour: 9, presence: presence({ idleSeconds: 900 }) }, 'ok'],
  ] as Array<[string, Partial<GateInput>, string]>)('%s', (_name, patch, expected) => {
    expect(speakGate(base(patch))).toBe(expected);
  });

  it('öğrenilmiş çarpan günlük sınırı indirir', () => {
    expect(dailyUpdateLimit('normal', 1)).toBe(2);
    expect(dailyUpdateLimit('normal', 0.5)).toBe(1);
    expect(dailyUpdateLimit('normal', 0.25)).toBe(0);
    expect(dailyUpdateLimit('high', 0.5)).toBe(2);
    expect(dailyBreakingLimit('normal', 0.5)).toBe(1);
    expect(dailyBreakingLimit('normal', 0.25)).toBe(0);
    expect(dailyBreakingLimit('normal', 0)).toBe(0);
  });
});

describe('ilgiye göre kendiliğinden azalma', () => {
  const notes = { down: 'azaldı', up: 'arttı' };
  const now = new Date(2026, 10, 17, 9, 0);

  it('dört yanıtsız ya da iki ret bir basamak indirir; ilgi geri çıkarır', () => {
    let state = { ...DEFAULT_ADAPTIVE };
    for (let index = 0; index < STEP_DOWN_WEIGHT - 1; index++) {
      const change = applyEngagement(state, 'ignored', now, notes);
      expect(change.stepped).toBeNull();
      state = change.adaptive;
    }
    let change = applyEngagement(state, 'ignored', now, notes);
    expect(change).toMatchObject({ stepped: 'down', adaptive: { factor: 0.5, ignoredStreak: 0, note: 'azaldı' } });
    change = applyEngagement(change.adaptive, 'declined', now, notes);
    change = applyEngagement(change.adaptive, 'declined', now, notes);
    expect(change).toMatchObject({ stepped: 'down', adaptive: { factor: 0.25 } });
    change = applyEngagement(change.adaptive, 'engaged', now, notes);
    expect(change).toMatchObject({ stepped: 'up', adaptive: { factor: 0.5, note: 'arttı' } });
    change = applyEngagement(change.adaptive, 'engaged', now, notes);
    expect(change).toMatchObject({ stepped: 'up', adaptive: { factor: 1, note: null } });
    expect(applyEngagement(change.adaptive, 'engaged', now, notes).stepped).toBeNull();
  });

  it('yanıtsızlık zayıf işarettir: sabah brifingi yarım sayılır ve çarpanı 0,5 altına indiremez', () => {
    let state = { ...DEFAULT_ADAPTIVE };
    for (let index = 0; index < 7; index++) state = applyEngagement(state, 'ignored', now, notes, 'morning').adaptive;
    expect(state.factor).toBe(1);
    state = applyEngagement(state, 'ignored', now, notes, 'morning').adaptive;
    expect(state.factor).toBe(0.5);
    // Tabanda: ne kadar yanıtsız kalırsa kalsın daha aşağı inmez ve sayaç birikmez.
    for (let index = 0; index < 20; index++) state = applyEngagement(state, 'ignored', now, notes, 'update').adaptive;
    expect(state).toMatchObject({ factor: 0.5, ignoredStreak: 0, ignored: 28 });
    // Susturmak için açık ret gerekir.
    state = applyEngagement(state, 'declined', now, notes).adaptive;
    state = applyEngagement(state, 'declined', now, notes).adaptive;
    expect(state.factor).toBe(0.25);
  });

  it('en alt basamak yalnız karttır; daha aşağı inmez', () => {
    let state = { ...DEFAULT_ADAPTIVE, factor: 0 };
    for (let index = 0; index < 6; index++) state = applyEngagement(state, 'declined', now, notes).adaptive;
    expect(state.factor).toBe(0);
  });
});

describe('sesle ayar: söz kodla okunur', () => {
  const now = new Date(2026, 10, 17, 14, 0);
  const parse = (text: string, current = DEFAULT_PREFS) => parseSpokenPrefs(text, current, now);

  it('saat', () => {
    expect(spokenClock('sabah brifingini sekizde ver', now)).toBe('08:00');
    expect(spokenClock('brifing 07:45 olsun', now)).toBe('07:45');
    expect(parse('Sabah brifingini sekiz buçukta ver.')?.patch).toEqual({ morning: { enabled: true, time: '08:30' } });
  });

  it('konuşkanlık', () => {
    expect(parse('Daha az konuş.')?.patch).toEqual({ talk: 'low' });
    expect(parse('Daha az konuş.', { ...DEFAULT_PREFS, talk: 'low' })?.patch).toEqual({ talk: 'silent' });
    expect(parse('Kendiliğinden konuşma.')?.patch).toEqual({ talk: 'silent' });
    expect(parse('Daha sık haber ver.')).toEqual({ patch: { talk: 'high' }, resetAdaptive: true });
    expect(parse('Eskisi gibi konuş.', { ...DEFAULT_PREFS, talk: 'silent' })).toEqual({ patch: { talk: 'normal' }, resetAdaptive: true });
  });

  it('kapsam ve araya girme', () => {
    expect(parse('Haberleri sorma.')?.patch).toEqual({ scope: { news: false } });
    expect(parse('Brifingde e-postaları da söyle.')?.patch).toEqual({ scope: { mail: true } });
    expect(parse('Önemli gelişmelerde araya girme.')?.patch).toEqual({ breaking: false });
    expect(parse('Sabah brifingini istemiyorum.')?.patch).toEqual({ morning: { enabled: false } });
    expect(parse('Brifingde beş haber olsun.')?.patch).toEqual({ newsCount: 5 });
  });

  it('anlaşılmayan söz tahmin edilmez', () => {
    expect(parse('Hava nasıl?')).toBeNull();
    expect(parse('Merhaba.')).toBeNull();
  });

  it('ayar birleştirme ve bozuk değer', () => {
    const merged = mergePrefs(DEFAULT_PREFS, { morning: { time: '07:15' }, scope: { mail: false } });
    expect(merged.morning).toEqual({ enabled: true, time: '07:15' });
    expect(merged.scope).toEqual({ ...DEFAULT_PREFS.scope, mail: false });
    expect(normalizePrefs({ morning: { time: '25:99' }, talk: 'bagir', maxPerHour: 99 }).morning.time).toBe('08:30');
    expect(normalizePrefs({ talk: 'bagir', maxPerHour: 99 })).toMatchObject({ talk: 'normal', maxPerHour: 12 });
  });
});

const sources = (patch: Partial<BriefingSources> = {}): BriefingSources => ({
  address: () => 'Deniz Hanım',
  agenda: () => [],
  tasks: () => ({ due: [], open: 0 }),
  mail: () => null,
  news: () => [],
  ...patch,
});

describe('brifing metni', () => {
  const now = new Date(2026, 10, 17, 8, 30);

  it('sabah: hitap ayardan, takvim, e-posta ve kişisel gündem', () => {
    const briefing = composeBriefing({
      kind: 'morning',
      now,
      prefs: DEFAULT_PREFS,
      sources: sources({
        agenda: () => [
          { time: '10:00', text: 'Diş randevusu', overdue: false },
          { time: '14:00', text: 'Atlas toplantısı', overdue: false },
        ],
        mail: () => ({ count: 2, items: ['Ahmet Bey: Sözleşme', 'Banka: Ekstre'] }),
        news: () => [
          story('a', 'Yapay zekâ yasası Meclis’te kabul edildi', { reasons: ['takip: yapay zekâ', '3 kaynak'], sources: ['TRT Haber', 'NTV', 'AA'] }),
          story('b', 'Merkez Bankası faizi sabit tuttu'),
          story('c', 'OpenAI ships a new model', { lang: 'en', source: 'The Verge', sources: ['The Verge'] }),
        ],
      }),
    });
    expect(briefing.greeting).toBe('Günaydın Deniz Hanım');
    expect(briefing.spoken).toContain('Günaydın Deniz Hanım.');
    expect(briefing.spoken).toContain('Bugün takviminizde 2 iş var: saat 10:00 Diş randevusu; saat 14:00 Atlas toplantısı.');
    expect(briefing.spoken).toContain('Okunmamış 2 önemli e-postanız var.');
    expect(briefing.spoken).toContain('Haberlere baktım; sizi ilgilendirebilecek 2 gelişme var.');
    expect(briefing.spoken).toContain('Birincisi: yapay zekâ tarafında, Yapay zekâ yasası Meclis’te kabul edildi.');
    // Yabancı dildeki başlık Türkçe sesle okunmaz.
    expect(briefing.spoken).not.toContain('OpenAI ships');
    expect(briefing.spoken).toContain('Yabancı kaynaklarda 1 gelişme daha var');
    expect(briefing.sections.map((section) => section.id)).toEqual(['agenda', 'mail', 'news']);
    expect(briefing.news).toHaveLength(3);
    expect(briefing.news[0]).toMatchObject({ source: 'TRT Haber +2', reasons: ['takip: yapay zekâ', '3 kaynak'] });
  });

  it('kapsam dışı bölüm girmez; boş günde kısa selam', () => {
    const quietDay = composeBriefing({ kind: 'morning', now, prefs: { ...DEFAULT_PREFS, scope: { ...DEFAULT_PREFS.scope, news: false } }, sources: sources({ news: () => [story('a', 'Haber')] }) });
    expect(quietDay.sections).toEqual([]);
    expect(quietDay.spoken).toBe('Günaydın Deniz Hanım. Bugün takviminiz boş ve dikkatinizi isteyen bir gelişme görmedim.');
  });

  it('önemli gelişme ve güncelleme', () => {
    const breaking = composeBriefing({ kind: 'breaking', now, prefs: DEFAULT_PREFS, sources: sources(), stories: [story('a', 'Dolar rekor kırdı', { sources: ['AA', 'NTV', 'TRT Haber'] })] });
    expect(breaking.spoken).toBe('Deniz Hanım, araya giriyorum; önemli bir gelişme var. Dolar rekor kırdı. 3 kaynak bildiriyor.');
    const update = composeBriefing({ kind: 'update', now, prefs: DEFAULT_PREFS, sources: sources(), stories: [story('a', 'Birinci haber'), story('b', 'İkinci haber')] });
    expect(update.spoken).toBe('Deniz Hanım, kısa bir güncelleme. Son saatlerde 2 yeni gelişme var. Birincisi: Birinci haber. İkincisi: İkinci haber.');
  });
});

describe('brifing motoru', () => {
  let env: ReturnType<typeof tempStore>;
  let engine: BriefingEngine;
  let clock: Date;
  let who: PresenceState;
  let quiet: boolean;
  let voice: { state: VoiceState; quiet: boolean; conversation: boolean };
  let stories: NewsStory[];
  let breakingStories: NewsStory[];
  const notified: NotifyRequest[] = [];
  const transcript: string[] = [];
  const read: string[] = [];
  const learned: string[] = [];
  /** Dikkat Yöneticisinin kanalı (sınamada elle): `voice` söyler, `deferred` bekletir. */
  let channel: Notification['channel'];

  const at = (hour: number, minute = 0, day = 17) => {
    clock = new Date(2026, 10, day, hour, minute);
  };

  beforeEach(() => {
    env = tempStore();
    env.store.migrate('briefing', BRIEFING_MIGRATIONS);
    at(7, 0);
    who = presence();
    quiet = false;
    voice = { state: 'idle', quiet: false, conversation: false };
    stories = [story('a', 'Birinci haber'), story('b', 'İkinci haber')];
    breakingStories = [];
    notified.length = 0;
    transcript.length = 0;
    read.length = 0;
    learned.length = 0;
    channel = 'voice';
    engine = createBriefingEngine({
      db: env.store.scoped('briefing'),
      now: () => clock,
      sources: sources({ news: (limit) => stories.filter((item) => !read.includes(item.id)).slice(0, limit) }),
      presence: () => who,
      quiet: () => quiet,
      killSwitch: () => false,
      voice: () => voice,
      notify(request) {
        notified.push(request);
        return { id: `n${notified.length}`, moduleId: request.moduleId, title: request.title, body: request.body ?? '', priority: request.priority, actions: [], speak: typeof request.speak === 'string' ? request.speak : null, dedupeKey: request.dedupeKey ?? null, data: request.data ?? {}, status: channel === 'deferred' ? 'pending' : 'shown', channel, createdAt: clock.toISOString(), shownAt: null, resolvedAt: null, actionId: null } as Notification;
      },
      appendTranscript: (text) => void transcript.push(text),
      news: () => ({ stories: () => stories, breaking: () => breakingStories, refresh: async () => undefined, markRead: (ids) => void read.push(...ids) }),
      learn: (text) => void learned.push(text),
      log: silentLog,
      onChange() {},
    });
  });
  afterEach(() => env.close());

  it('sabah brifingi: saatinden önce susar, vakti gelince bir kez söyler, döküme düşer, haberleri okundu işaretler', async () => {
    await engine.tick();
    expect(notified).toHaveLength(0);
    at(8, 30);
    await engine.tick();
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ moduleId: 'briefing', priority: 'high', title: 'Günaydın Deniz Hanım' });
    expect(notified[0]?.speak).toContain('Haberlere baktım');
    expect(transcript).toHaveLength(1);
    expect(read).toEqual(['a', 'b']);
    expect(engine.today()).toMatchObject({ kind: 'morning', delivered: 'voice' });
    at(8, 31);
    await engine.tick();
    expect(notified).toHaveLength(1);
    expect(engine.state()).toMatchObject({ spokenToday: 1 });
    expect(new Date(engine.state().nextMorningAt!).getDate()).toBe(18);
  });

  it('kullanıcı bilgisayar başında değilse bekler; gelince söyler', async () => {
    who = presence({ idleSeconds: 1200, mode: 'away' });
    at(8, 30);
    await engine.tick();
    expect(notified).toHaveLength(0);
    expect(engine.today()).toBeNull();
    at(9, 10);
    who = presence();
    await engine.tick();
    expect(notified).toHaveLength(1);
    expect(engine.today()?.delivered).toBe('voice');
  });

  it('toplantıda, tam ekranda ve kullanıcı konuşurken girmez; bitince söyler', async () => {
    at(8, 30);
    who = presence({ meeting: true, mode: 'meeting' });
    await engine.tick();
    who = presence({ fullscreen: true, mode: 'fullscreen' });
    await engine.tick();
    who = presence();
    voice = { state: 'listening', quiet: false, conversation: false };
    await engine.tick();
    expect(notified).toHaveLength(0);
    voice = { state: 'idle', quiet: false, conversation: false };
    await engine.tick();
    expect(notified).toHaveLength(1);
  });

  it('pencere geçince brifing yalnız kart olur (söylenmez)', async () => {
    who = presence({ idleSeconds: 9999, mode: 'away' });
    at(13, 0);
    await engine.tick();
    expect(notified).toHaveLength(0);
    expect(engine.today()).toMatchObject({ kind: 'morning', delivered: 'card', reason: 'bilgisayar başında değilsiniz' });
  });

  it('konuşkanlık sessizken brifing karttır', async () => {
    engine.setPrefs({ talk: 'silent' });
    at(8, 30);
    await engine.tick();
    expect(notified).toHaveLength(0);
    expect(engine.today()).toMatchObject({ delivered: 'card' });
    expect(engine.state().canSpeak).toEqual({ ok: false, reason: 'konuşkanlık "sessiz": brifing yalnız kartta' });
  });

  it('Dikkat Yöneticisi bekletirse sonradan söylenince işlenir', async () => {
    channel = 'deferred';
    at(8, 30);
    await engine.tick();
    expect(engine.today()).toMatchObject({ delivered: 'deferred' });
    expect(transcript).toHaveLength(0);
    at(9, 0);
    engine.onShown({ data: { briefingId: engine.today()!.id } } as unknown as Notification, 'voice');
    expect(engine.today()).toMatchObject({ delivered: 'voice' });
    expect(transcript).toHaveLength(1);
  });

  it('gün içi güncelleme: yalnız yeterince yeni haber varsa, saat aralığında ve günde en çok iki kez', async () => {
    at(8, 30);
    await engine.tick();
    engine.onUserTurn('Teşekkürler, ikincisini anlat.');
    at(11, 0);
    stories = [story('c', 'Zayıf haber', { score: 20 })];
    await engine.tick();
    expect(notified).toHaveLength(1);
    stories = [story('d', 'Güçlü haber bir', { score: 70 }), story('e', 'Güçlü haber iki', { score: 80 })];
    await engine.tick();
    expect(notified).toHaveLength(2);
    expect(notified[1]?.speak).toContain('kısa bir güncelleme');
    engine.onUserTurn('Tamam.');
    // Üç saat geçmeden yenisi yok.
    at(12, 0);
    stories = [story('f', 'Yeni bir', { score: 90 }), story('g', 'Yeni iki', { score: 90 })];
    await engine.tick();
    expect(notified).toHaveLength(2);
    at(14, 30);
    await engine.tick();
    expect(notified).toHaveLength(3);
    engine.onUserTurn('Tamam.');
    at(18, 0);
    stories = [story('h', 'Dördüncü', { score: 90 }), story('i', 'Beşinci', { score: 90 })];
    await engine.tick();
    expect(notified).toHaveLength(3);
  });

  it('takip edilen konudaki tek haber güncelleme için yeter', async () => {
    at(8, 30);
    await engine.tick();
    engine.onUserTurn('Sağ ol.');
    at(11, 30);
    stories = [story('k', 'Yeni dil modeli duyuruldu', { score: 40, reasons: ['takip: yapay zekâ'] })];
    await engine.tick();
    expect(notified).toHaveLength(2);
    expect(notified[1]?.speak).toContain('yapay zekâ tarafında');
  });

  it('önemli gelişmede araya girer; kapalıysa girmez', async () => {
    at(8, 30);
    await engine.tick();
    engine.onUserTurn('Tamam.');
    at(9, 15);
    breakingStories = [story('z', 'Dolar rekor kırdı', { sources: ['AA', 'NTV', 'TRT Haber'] })];
    await engine.tick();
    expect(notified).toHaveLength(2);
    expect(notified[1]?.speak).toContain('araya giriyorum');
    engine.onUserTurn('Anladım.');
    engine.setPrefs({ breaking: false });
    at(10, 30);
    breakingStories = [story('y', 'Başka gelişme', { sources: ['AA', 'NTV', 'TRT Haber'] })];
    stories = [];
    await engine.tick();
    expect(notified).toHaveLength(2);
  });

  it('yanıtsız kalan ve reddedilen brifingler konuşmayı azaltır; ilgi geri getirir', async () => {
    for (let day = 17; day <= 24; day++) {
      at(8, 30, day);
      await engine.tick();
      at(8, 40, day);
      await engine.tick();
      // Sabah brifingi yanıtsız kalınca yarım sayılır: dört gün yetmez, sekiz gün gerekir.
      if (day === 20) expect(engine.state().adaptive).toMatchObject({ ignored: 4, factor: 1 });
    }
    const state = engine.state();
    expect(state.adaptive).toMatchObject({ ignored: 8, factor: 0.5 });
    expect(state.adaptive.note).toContain('daha seyrek');
    expect(learned).toEqual(['Kendiliğinden konuşmalara çoğu zaman yanıt vermiyor; daha seyrek konuş.']);
    expect(state.dailyLimit).toBe(3);
    at(8, 30, 25);
    await engine.tick();
    engine.onUserTurn('Birincisini biraz açar mısın?');
    expect(engine.state().adaptive).toMatchObject({ factor: 1, engaged: 1 });
    expect(learned.at(-1)).toContain('ilgileniyor');
  });

  it('"sus" ve "bugün yeter" ret sayılır; o gün yeniden konuşulmaz', async () => {
    at(8, 30);
    await engine.tick();
    engine.onUserTurn('Sus.');
    expect(engine.state().adaptive).toMatchObject({ declined: 1, ignoredStreak: 2 });
    at(11, 0);
    stories = [story('d', 'Güçlü bir', { score: 90 }), story('e', 'Güçlü iki', { score: 90 })];
    await engine.tick();
    expect(notified).toHaveLength(2);
    engine.onAction(engine.today()!.id, 'enough');
    expect(engine.state().adaptive).toMatchObject({ declined: 2, factor: 0.5 });
    at(15, 0);
    stories = [story('f', 'Yeni bir', { score: 90 }), story('g', 'Yeni iki', { score: 90 })];
    await engine.tick();
    expect(notified).toHaveLength(2);
    expect(engine.state().canSpeak.ok).toBe(false);
  });

  it('istenen brifing sınırlara takılmaz ve öğrenmeye girmez', async () => {
    quiet = true;
    const briefing = await engine.runNow({ speak: false });
    expect(briefing).toMatchObject({ kind: 'manual', delivered: 'card' });
    expect(notified).toHaveLength(0);
    at(7, 10);
    await engine.tick();
    expect(engine.state().adaptive).toMatchObject({ ignored: 0 });
  });
});
