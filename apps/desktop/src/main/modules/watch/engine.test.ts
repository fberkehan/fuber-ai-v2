// v1 `tests/isler-zamanlayici.test.ts`ten taşındı (node:test → vitest; sahte saat ve zamanlayıcı). Taşınan kabuller:
// değişiklik yokken model 0 kez çağrılır ve aralık ×1,5 büyür; süre dolunca biter, zamanlayıcı kalmaz; acil durdurma
// bütün işleri durdurur ve süren denetimin geç sonucu yazılmaz (kuşak); aynı anda en çok N iş; kaynak hatası izi
// değiştirmez; üst üste hatada iş durur. v2'ye özgü: yeniden açılışta iş KENDİLİĞİNDEN sürer (v1 "Sürdür" isterdi),
// çağrı bütçesi, olay kaynağının "dürt"mesi. v1'in ekran kilidi, görev sohbeti ve adım/yankı kuralları v2'de yok
// (v2 gözcüsü araç kullanan bir yapay zekâ adımı çalıştırmaz).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NotifyRequest, ToolResult } from '@fuber/shared';
import { silentLog, tempStore } from '../../core/brain/testkit';
import { createWatchEngine, type EngineDeps, type Judge, type WatchEngine } from './engine';
import { DEFAULT_MAX_ACTIVE, MAX_ERRORS } from './rules';
import { WATCH_MIGRATIONS, createWatchRepo, type WatchRepo } from './repo';
import type { WatchCondition, WatchJob, WatchPlan, WatchProbe, WatchSourceDef } from './types';

const T0 = Date.parse('2026-11-16T10:00:00Z');

/** Elle ilerleyen saat ve zamanlayıcılar. */
function fakeClock() {
  let now = T0;
  let seq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer(run: () => void, ms: number) {
      const id = ++seq;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer(handle: unknown) {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    /** `ms` kadar ilerler; vakti gelen zamanlayıcıları sırayla çalıştırır, her birinden sonra işin bitmesini bekler. */
    async advance(ms: number, engine: WatchEngine) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = Math.max(now, due[1].at);
        timers.delete(due[0]);
        due[1].run();
        await engine.idle();
        await Promise.resolve();
      }
      now = end;
    },
  };
}

/** Metni elle değişen durum kaynağı; her denetimi sayar. */
function stateSource(kind = 'fake', mode: 'state' | 'events' = 'state') {
  const box = { text: 'Fiyat 1.299 TL', checks: 0, fail: null as string | null, hang: false, events: [] as string[] };
  const source: WatchSourceDef = {
    kind,
    moduleId: 'test',
    label: 'Sahte',
    targetHint: '',
    mode,
    minIntervalSec: 10,
    maxIntervalSec: 60,
    describe: (target) => `sahte ${target}`,
    async check({ previous, signal }): Promise<WatchProbe> {
      box.checks++;
      if (box.hang) await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('kesildi'))));
      if (box.fail) throw new Error(box.fail);
      if (mode === 'events') {
        const fresh = box.events.splice(0);
        return { signature: fresh.length ? String(box.checks) : (previous ?? '0'), text: fresh.join('\n') };
      }
      return { signature: box.text, text: box.text };
    },
  };
  return { box, source };
}

const plan = (patch: Partial<WatchPlan> = {}, condition: WatchCondition = { type: 'changed' }): WatchPlan => ({
  source: { kind: 'fake', target: 'x' },
  condition,
  repeat: false,
  speak: true,
  untilAt: new Date(T0 + 3_600_000).toISOString(),
  interval: { minSec: 10, maxSec: 60 },
  maxModelCalls: 5,
  action: null,
  ...patch,
});

let env: ReturnType<typeof tempStore>;
let repo: WatchRepo;
beforeEach(() => {
  env = tempStore();
  env.store.migrate('watch', WATCH_MIGRATIONS);
  repo = createWatchRepo(env.store.scoped('watch'));
});
afterEach(() => env.close());

function setup(options: { sources?: WatchSourceDef[]; judge?: Judge; kill?: () => boolean; maxActive?: number; runAction?: EngineDeps['runAction'] } = {}) {
  const clock = fakeClock();
  const notes: NotifyRequest[] = [];
  const judgeCalls: string[] = [];
  const judge: Judge =
    options.judge ??
    (async ({ question }) => {
      judgeCalls.push(question);
      return { match: true, finding: 'model: koşul tuttu' };
    });
  const engine = createWatchEngine({
    repo,
    sources: () => options.sources ?? [],
    judge: async (input) => {
      if (options.judge) judgeCalls.push(input.question);
      return judge(input);
    },
    notify: (request) => void notes.push(request),
    runAction: options.runAction ?? (async () => ({ ok: true, text: 'okundu' }) as ToolResult),
    killSwitchActive: options.kill ?? (() => false),
    ...(options.maxActive ? { maxActive: () => options.maxActive! } : {}),
    emit() {},
    log: silentLog,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    checkTimeoutMs: 5_000,
  });
  engine.start();
  return { clock, engine, notes, judgeCalls };
}

const fresh = (engine: WatchEngine, id: string) => engine.get(id)!;

describe('zamanlayıcı', () => {
  it('değişiklik yokken model HİÇ çağrılmaz ve aralık ×1,5 büyür (en çok max)', async () => {
    const { box, source } = stateSource();
    const { clock, engine, judgeCalls, notes } = setup({ sources: [source] });
    const job = engine.create({ title: 'Fiyat', goal: 'fiyat değişince söyle', plan: plan({}, { type: 'ask', question: 'fiyat düştü mü' }) });
    const intervals: number[] = [];
    await clock.advance(0, engine);
    for (let i = 0; i < 6; i++) {
      intervals.push(fresh(engine, job.id).intervalSec);
      await clock.advance(fresh(engine, job.id).intervalSec * 1000, engine);
    }
    expect(box.checks).toBe(7);
    expect(judgeCalls).toEqual([]);
    expect(fresh(engine, job.id).modelCalls).toBe(0);
    expect(intervals).toEqual([15, 23, 35, 53, 60, 60]);
    expect(notes).toEqual([]);
    // Değişince aralık en kısaya döner ve model YALNIZ bir kez çağrılır.
    box.text = 'Fiyat 1.199 TL';
    await clock.advance(60_000, engine);
    expect(judgeCalls).toEqual(['fiyat düştü mü']);
    const done = fresh(engine, job.id);
    expect(done).toMatchObject({ status: 'done', reason: 'matched', modelCalls: 1, changes: 1, matches: 1 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ moduleId: 'watch', priority: 'high' });
    expect(clock.pending()).toBe(0);
  });

  it('kod koşulu (sayı eşiği): model hiç çağrılmaz; tekrarlı işte aynı durum yeniden haber vermez', async () => {
    const { box, source } = stateSource();
    const { clock, engine, judgeCalls, notes } = setup({ sources: [source] });
    const job = engine.create({ title: 'Fiyat', goal: '', plan: plan({ repeat: true, speak: false }, { type: 'below', value: 1250, near: 'Fiyat' }) });
    await clock.advance(0, engine);
    box.text = 'Fiyat 1.199 TL';
    await clock.advance(15_000, engine);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.priority).toBe('normal');
    expect(notes[0]!.speak).toBe(false);
    box.text = 'Fiyat 1.189 TL';
    await clock.advance(10_000, engine);
    expect(notes).toHaveLength(1);
    box.text = 'Fiyat 1.300 TL';
    await clock.advance(10_000, engine);
    box.text = 'Fiyat 1.100 TL';
    await clock.advance(10_000, engine);
    expect(notes).toHaveLength(2);
    expect(fresh(engine, job.id)).toMatchObject({ status: 'running', matches: 2 });
    expect(judgeCalls).toEqual([]);
  });

  it('süre dolunca biter ("gerçekleşmedi" sakin bildirimi), bekleyen zamanlayıcı kalmaz', async () => {
    const { source } = stateSource();
    const { clock, engine, notes } = setup({ sources: [source] });
    const job = engine.create({ title: 'Kısa', goal: '', plan: plan({ untilAt: new Date(T0 + 30_000).toISOString() }) });
    await clock.advance(31_000, engine);
    expect(fresh(engine, job.id)).toMatchObject({ status: 'done', reason: 'expired', nextCheckAt: null });
    expect(fresh(engine, job.id).result).toMatch(/gerçekleşmedi/);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ priority: 'normal', speak: false });
    expect(clock.pending()).toBe(0);
  });

  it('çağrı bütçesi: değişiklik başına bir çağrı; bütçe dolunca iş biter', async () => {
    const { box, source } = stateSource();
    const { clock, engine, judgeCalls } = setup({ sources: [source], judge: async () => ({ match: false, finding: '' }) });
    const job = engine.create({ title: 'Bütçe', goal: '', plan: plan({ maxModelCalls: 2 }, { type: 'ask', question: 'ilan çıktı mı' }) });
    await clock.advance(0, engine);
    for (const text of ['a', 'b', 'c']) {
      box.text = text;
      await clock.advance(15_000, engine);
    }
    expect(judgeCalls).toHaveLength(2);
    expect(fresh(engine, job.id)).toMatchObject({ status: 'done', reason: 'budget', modelCalls: 2 });
  });

  it('acil durdurma: bütün işler duraklar, zamanlayıcı kalmaz; süren denetimin geç sonucu yazılmaz (kuşak)', async () => {
    const a = stateSource('a');
    const b = stateSource('b');
    const { clock, engine } = setup({ sources: [a.source, b.source] });
    const first = engine.create({ title: 'A', goal: '', plan: plan({ source: { kind: 'a', target: '' } }) });
    const second = engine.create({ title: 'B', goal: '', plan: plan({ source: { kind: 'b', target: '' } }) });
    await clock.advance(0, engine);
    a.box.hang = true;
    a.box.text = 'değişti';
    const pending = clock.advance(15_000, engine);
    await Promise.resolve();
    expect(engine.pauseAll('panic')).toBe(2);
    await pending;
    await engine.idle();
    for (const id of [first.id, second.id]) expect(fresh(engine, id)).toMatchObject({ status: 'paused', reason: 'panic', nextCheckAt: null });
    expect(fresh(engine, first.id).changes).toBe(0);
    expect(clock.pending()).toBe(0);
    // Acil durdurma açıkken sürdürülemez, yeni iş başlamaz.
    const killed = setup({ sources: [a.source], kill: () => true });
    expect(() => killed.engine.create({ title: 'C', goal: '', plan: plan({ source: { kind: 'a', target: '' } }) })).toThrow(/Acil durdurma/);
  });

  it('yeniden açılış: iş kaldığı yerden KENDİLİĞİNDEN sürer (imza ve aralık korunur); son tarihi geçen biter', async () => {
    const { box, source } = stateSource();
    const one = setup({ sources: [source] });
    const job = one.engine.create({ title: 'Sürer', goal: '', plan: plan({}, { type: 'changed' }) });
    const short = one.engine.create({ title: 'Biter', goal: '', plan: plan({ untilAt: new Date(T0 + 20_000).toISOString() }) });
    await one.clock.advance(0, one.engine);
    await one.clock.advance(15_000, one.engine);
    const before = fresh(one.engine, job.id);
    one.engine.stop();
    expect(one.clock.pending()).toBe(0);
    // Uygulama kapalıyken sayfa değişti; yeni süreç 10 dk sonra açılıyor.
    box.text = 'kapalıyken değişti';
    const two = setup({ sources: [source] });
    await two.clock.advance(10 * 60_000, two.engine);
    const after = fresh(two.engine, job.id);
    expect(after.status).toBe('done');
    expect(after.reason).toBe('matched');
    expect(after.checks).toBeGreaterThan(before.checks);
    expect(two.notes.some((note) => note.title.includes('Sürer'))).toBe(true);
    expect(fresh(two.engine, short.id)).toMatchObject({ status: 'done', reason: 'expired' });
  });

  it(`aynı anda en çok ${DEFAULT_MAX_ACTIVE} iş (başlatma da sürdürme de); Yönetim sınırı değiştirebilir`, () => {
    const { source } = stateSource();
    const { engine } = setup({ sources: [source] });
    const jobs = [1, 2, 3].map((n) => engine.create({ title: `İş ${n}`, goal: '', plan: plan() }));
    expect(() => engine.create({ title: 'Fazla', goal: '', plan: plan() })).toThrow(/en çok 3/);
    engine.pause(jobs[0]!.id);
    const fourth = engine.create({ title: 'Dördüncü', goal: '', plan: plan() });
    expect(() => engine.resume(jobs[0]!.id)).toThrow(/en çok 3/);
    engine.cancel(fourth.id);
    expect(engine.resume(jobs[0]!.id).status).toBe('running');
    const wide = setup({ sources: [source], maxActive: 5 });
    expect(wide.engine.list({ status: ['running'] })).toHaveLength(3);
    wide.engine.create({ title: 'Beşinci', goal: '', plan: plan() });
  });

  it('kaynak hatası: izi değiştirmez (ilk denetim hata verirse sonraki başarılı denetim yalnız taban kaydeder); üst üste hatada iş duraklar', async () => {
    const { box, source } = stateSource();
    const { clock, engine, notes } = setup({ sources: [source] });
    box.fail = 'bağlantı kurulamadı';
    const job = engine.create({ title: 'Çöken', goal: '', plan: plan() });
    await clock.advance(0, engine);
    expect(fresh(engine, job.id)).toMatchObject({ errors: 1, lastError: 'bağlantı kurulamadı', intervalSec: 15 });
    box.fail = null;
    box.text = 'başka';
    await clock.advance(15_000, engine);
    expect(fresh(engine, job.id)).toMatchObject({ errors: 0, changes: 0, matches: 0, lastError: null });
    box.fail = 'yine yok';
    for (let i = 0; i < MAX_ERRORS + 2; i++) await clock.advance(60_000, engine);
    expect(fresh(engine, job.id)).toMatchObject({ status: 'paused', reason: 'errors' });
    expect(notes.filter((note) => note.dedupeKey?.endsWith('.errors'))).toHaveLength(1);
  });

  it('kaynak yoksa ya da kullanılamıyorsa hata sayılmaz, neden görünür, aralık büyür', async () => {
    const { source } = stateSource();
    let reason: string | null = 'izin kapalı';
    const gated: WatchSourceDef = { ...source, available: () => reason };
    const { clock, engine } = setup({ sources: [gated] });
    const job = engine.create({ title: 'Kapı', goal: '', plan: plan() });
    await clock.advance(0, engine);
    expect(fresh(engine, job.id)).toMatchObject({ errors: 0, lastError: 'izin kapalı', checks: 0, intervalSec: 15 });
    reason = null;
    await clock.advance(15_000, engine);
    expect(fresh(engine, job.id)).toMatchObject({ lastError: null, checks: 1 });
  });

  it('kullanıcı duraklatır/sürdürür/iptal eder; durdur → sürdür sırasında eski denetimin sonucu yeni çalışmaya yazılmaz', async () => {
    const { box, source } = stateSource();
    const { clock, engine, notes } = setup({ sources: [source] });
    const job = engine.create({ title: 'Kuşak', goal: '', plan: plan() });
    await clock.advance(0, engine);
    box.hang = true;
    box.text = 'değişti';
    const running = engine.checkNow(job.id).catch(() => null);
    await Promise.resolve();
    engine.pause(job.id);
    box.hang = false;
    engine.resume(job.id);
    await running;
    await engine.idle();
    expect(fresh(engine, job.id).matches).toBe(0);
    // Yeni kuşağın kendi denetimi değişikliği görür ve haber verir.
    await clock.advance(0, engine);
    expect(fresh(engine, job.id)).toMatchObject({ status: 'done', matches: 1 });
    expect(notes).toHaveLength(1);
    expect(() => engine.resume(job.id)).toThrow(/sürdürülemez/);
    const other = engine.create({ title: 'İptal', goal: '', plan: plan() });
    expect(engine.cancel(other.id)).toMatchObject({ status: 'cancelled', nextCheckAt: null });
    engine.remove(other.id);
    expect(engine.get(other.id)).toBeNull();
  });

  it('olay kaynağı: yeni olay işi beklemeden "dürter"; ilk denetimdeki olay da sayılır', async () => {
    const { box, source } = stateSource('events', 'events');
    let poke: (() => void) | null = null;
    const evented: WatchSourceDef = { ...source, maxIntervalSec: 600, subscribe: (_target, fn) => ((poke = fn), () => (poke = null)) };
    const { clock, engine, notes } = setup({ sources: [evented] });
    const job = engine.create({ title: 'Claude', goal: '', plan: plan({ source: { kind: 'events', target: 'atlas' }, interval: { minSec: 30, maxSec: 600 } }) });
    await clock.advance(0, engine);
    expect(poke).not.toBeNull();
    await clock.advance(31_000, engine);
    expect(notes).toHaveLength(0);
    const next = Date.parse(fresh(engine, job.id).nextCheckAt!);
    box.events.push('atlas: işini bitirdi');
    poke!();
    await clock.advance(2_000, engine);
    expect(clock.now()).toBeLessThan(next);
    expect(fresh(engine, job.id)).toMatchObject({ status: 'done', reason: 'matched', finding: expect.stringContaining('atlas') });
    expect(notes).toHaveLength(1);
    expect(poke).toBeNull();
  });

  it('olay kaynağı (d6): açılışta vakti gelmemiş iş de abone olur; kaynak o an kullanılamasa da abonelik kurulur, gelen olay hemen denetler', async () => {
    const { box, source } = stateSource('events', 'events');
    let poke: (() => void) | null = null;
    let available: string | null = null;
    const evented: WatchSourceDef = { ...source, maxIntervalSec: 900, available: () => available, subscribe: (_target, fn) => ((poke = fn), () => (poke = null)) };
    // Önceki oturumdan kalan iş: bir sonraki denetimi 10 dakika sonra.
    const first = setup({ sources: [evented] });
    const job = first.engine.create({ title: 'Ahmet yazınca', goal: '', plan: plan({ source: { kind: 'events', target: 'ahmet' }, repeat: true, interval: { minSec: 600, maxSec: 900 } }) });
    await first.clock.advance(0, first.engine);
    first.engine.stop();
    expect(poke).toBeNull();
    // Yeniden açılış: kaynak henüz "bağlı değil".
    available = 'WhatsApp şu an bağlı değil.';
    const second = setup({ sources: [evented] });
    expect(poke).not.toBeNull();
    const next = Date.parse(fresh(second.engine, job.id).nextCheckAt!);
    available = null;
    box.events.push('Ahmet: geldim');
    poke!();
    await second.clock.advance(2_000, second.engine);
    expect(second.clock.now()).toBeLessThan(next);
    expect(second.notes).toHaveLength(1);
    expect(fresh(second.engine, job.id).matches).toBe(1);
    second.engine.stop();
  });

  it('saat kaynağı: tam vaktinde uyanır (arada bakmaz), koşulsuz haber verir ve biter', async () => {
    let checks = 0;
    const at = T0 + 90_000;
    const time: WatchSourceDef = {
      kind: 'time',
      moduleId: 'watch',
      label: 'Saat',
      targetHint: '',
      mode: 'state',
      minIntervalSec: 10,
      maxIntervalSec: 3600,
      describe: () => 'saat',
      async check() {
        checks++;
        return Date.now() < 0 || clockRef.now() < at ? { signature: 'wait', text: '', wakeAt: at } : { signature: 'due', text: '', fire: true, finding: 'Vakit geldi.' };
      },
    };
    const clockRef = { now: () => 0 };
    const { clock, engine, notes } = setup({ sources: [time] });
    clockRef.now = clock.now;
    const job = engine.create({ title: 'Saat beş', goal: '', plan: plan({ source: { kind: 'time', target: new Date(at).toISOString() } }) });
    await clock.advance(89_000, engine);
    expect(checks).toBe(1);
    await clock.advance(1_500, engine);
    expect(checks).toBe(2);
    expect(fresh(engine, job.id)).toMatchObject({ status: 'done', reason: 'matched' });
    expect(notes[0]!.body).toBe('Vakit geldi.');
  });

  it('eylem: koşul tutunca çalışır ve sonucu habere eklenir; başarısızsa haber yine verilir', async () => {
    const { box, source } = stateSource();
    const actions: string[] = [];
    const { clock, engine, notes } = setup({
      sources: [source],
      runAction: async (action) => {
        actions.push(action.tool);
        return action.tool === 'fx_rate' ? { ok: true, text: '1 USD = 34,12 TL' } : { ok: false, text: 'araç yok' };
      },
    });
    engine.create({ title: 'Kur', goal: '', plan: plan({ action: { tool: 'fx_rate', input: { from: 'USD' } } }) });
    engine.create({ title: 'Bozuk', goal: '', plan: plan({ action: { tool: 'yok_araci', input: {} } }) });
    await clock.advance(0, engine);
    box.text = 'değişti';
    await clock.advance(15_000, engine);
    expect(actions.sort()).toEqual(['fx_rate', 'yok_araci']);
    expect(notes.find((note) => note.title.includes('Kur'))!.body).toContain('34,12');
    expect(notes.find((note) => note.title.includes('Bozuk'))!.body).toContain('araç yok');
  });

  it('bulguyu kaynağın sahibi duyurduysa (`announcedElsewhere`) iş bildirim göndermez; eylemi varsa gönderir', async () => {
    const { box, source } = stateSource('events', 'events');
    let elsewhere: boolean | Promise<boolean> = Promise.resolve(true);
    const owned: WatchSourceDef = {
      ...source,
      async check(input) {
        const probe = await source.check(input);
        return probe.text ? { ...probe, announcedElsewhere: elsewhere } : probe;
      },
    };
    const { clock, engine, notes } = setup({ sources: [owned] });
    const quiet = engine.create({ title: 'Claude bitince', goal: '', plan: plan({ source: { kind: 'events', target: 'atlas' } }) });
    const withAction = engine.create({ title: 'Claude bitince kur', goal: '', plan: plan({ source: { kind: 'events', target: 'atlas' }, action: { tool: 'fx_rate', input: {} } }) });
    await clock.advance(0, engine);
    // Olaylar ortak kutudan tüketilir: her iş kendi denetiminde bir olay alır (aralıklar büyüdüğü için süre geniş tutulur).
    box.events.push('atlas: işini bitirdi');
    await clock.advance(70_000, engine);
    box.events.push('atlas: işini bitirdi');
    await clock.advance(70_000, engine);
    // İş "gerçekleşti" diye biter ama bildirimi yoktur; eylemli işin bildirimi (yeni bilgi: eylemin sonucu) gönderilir.
    expect(fresh(engine, quiet.id)).toMatchObject({ status: 'done', reason: 'matched', matches: 1 });
    expect(fresh(engine, withAction.id)).toMatchObject({ status: 'done', reason: 'matched' });
    expect(notes.map((note) => note.title)).toEqual([expect.stringContaining('Claude bitince kur')]);
    expect(notes[0]!.body).toContain('okundu');
    // Sahibi duyurmadıysa (ya da duyuru okunamadıysa) haber işten gelir.
    elsewhere = Promise.reject(new Error('okunamadı'));
    const loud = engine.create({ title: 'Yeniden', goal: '', plan: plan({ source: { kind: 'events', target: 'atlas' } }) });
    await clock.advance(0, engine);
    box.events.push('atlas: işini bitirdi');
    await clock.advance(70_000, engine);
    expect(fresh(engine, loud.id).status).toBe('done');
    expect(notes.map((note) => note.title)).toContainEqual(expect.stringContaining('Yeniden'));
  });

  it('bulma: kısa kimlik (#son dört harf), küçük harf ya da başlıktaki sözcük', () => {
    const { source } = stateSource();
    const { engine } = setup({ sources: [source] });
    const job: WatchJob = engine.create({ title: 'Kulaklık fiyatı', goal: 'Sony kulaklık', plan: plan() });
    expect(engine.find(`#${job.id.slice(-4).toLowerCase()}`).map((item) => item.id)).toEqual([job.id]);
    expect(engine.find('kulaklık').map((item) => item.id)).toEqual([job.id]);
    expect(engine.find('sony')).toHaveLength(1);
    expect(engine.find('yok böyle')).toHaveLength(0);
  });
});
