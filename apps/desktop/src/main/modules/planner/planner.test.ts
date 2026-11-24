import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bus, ModuleContext, NotifyRequest, SchedulerApi } from '@fuber/shared';
import { createMemory } from '../../core/memory';
import { createScheduler } from '../../core/scheduler';
import { loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import planner, { composeBrief } from './index';

const T0 = new Date('2026-11-16T09:00:00+03:00');
let env: ReturnType<typeof tempStore>;
let bus: Bus;
let scheduler: SchedulerApi;
let tools: ReturnType<typeof miniTools>;
let notified: NotifyRequest[];
let ctx: ModuleContext;

async function boot() {
  bus = testBus();
  scheduler = createScheduler({ store: env.store, bus, log: silentLog });
  scheduler.start();
  tools = miniTools();
  notified = [];
  ctx = moduleContext(
    'planner',
    {
      bus,
      scheduler,
      memory: createMemory({ store: env.store, bus, log: silentLog }),
      attention: {
        start() {},
        stop() {},
        notify(request) {
          notified.push(request);
          return {} as never;
        },
        dismiss() {},
        act() {},
        pending: () => [],
        recent: () => [],
      },
    },
    env.store,
  );
  await loadModule(planner, ctx, env.store, tools);
}

async function shutdown() {
  await planner.teardown?.();
  scheduler.stop();
}

const voice = { channel: 'voice' as const, speakerVerified: null };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(T0);
  env = tempStore();
  await boot();
});
afterEach(async () => {
  await shutdown();
  vi.useRealTimers();
  env.close();
});

describe('planner araçları', () => {
  it('reminder_create doğru tarihli kayıt açar, hafızaya söz yazar', async () => {
    const result = await tools.run(
      'reminder_create',
      { text: 'KDV beyannamesini ver', due_at: '2026-11-17T10:00:00+03:00' },
      { origin: voice },
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain('yarın 10:00');
    const row = env.store.scoped('planner').get<{ due_at: string; status: string; memory_id: string }>('SELECT * FROM planner_reminders')!;
    expect(row.due_at).toBe('2026-11-17T07:00:00.000Z');
    expect(row.status).toBe('scheduled');
    expect(ctx.memory.get(row.memory_id)?.kind).toBe('commitment');
    expect(scheduler.list('planner.reminder')).toHaveLength(1);
  });

  it('geçmişteki tek seferlik zamanı reddeder (ok:false, "yaptım" denemez)', async () => {
    const result = await tools.run('reminder_create', { text: 'x', due_at: '2026-11-15T10:00:00+03:00' }, { origin: voice });
    expect(result.ok).toBe(false);
    expect(env.store.scoped('planner').all('SELECT * FROM planner_reminders')).toHaveLength(0);
  });

  it('her ayın 28’i: geçmiş ilk an verilse de gelecekteki ilk 28’e kurulur', async () => {
    const result = await tools.run(
      'reminder_create',
      { text: 'KDV', due_at: '2026-10-28T10:00:00+03:00', recurrence: { freq: 'monthly', interval: 1 } },
      { origin: voice },
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain('her ay');
    const row = env.store.scoped('planner').get<{ due_at: string }>('SELECT due_at FROM planner_reminders')!;
    expect(row.due_at).toBe('2026-11-28T07:00:00.000Z');
  });

  it('zamanı gelen hatırlatıcı high + speak ile bildirilir', async () => {
    await tools.run('reminder_create', { text: 'Toplantıya çık', due_at: new Date(T0.getTime() + 60_000).toISOString() }, { origin: voice });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ moduleId: 'planner', priority: 'high', body: 'Toplantıya çık' });
    expect(String(notified[0]!.speak)).toContain('Toplantıya çık');
    const row = env.store.scoped('planner').get<{ status: string }>('SELECT status FROM planner_reminders')!;
    expect(row.status).toBe('fired');
  });

  it('kapalıyken kaçanlar açılışta TEK özet olarak bir kez gelir', async () => {
    await tools.run('reminder_create', { text: 'Birinci', due_at: new Date(T0.getTime() + 60_000).toISOString() }, { origin: voice });
    await tools.run('reminder_create', { text: 'İkinci', due_at: new Date(T0.getTime() + 120_000).toISOString() }, { origin: voice });
    await shutdown();
    vi.setSystemTime(new Date(T0.getTime() + 3_600_000));
    await boot();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.title).toContain('2 hatırlatma');
    expect(String(notified[0]!.speak)).toContain('Birinci');
    expect(String(notified[0]!.speak)).toContain('İkinci');
    await shutdown();
    await boot();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notified).toHaveLength(0);
  });

  it('todo_add_many birden çok maddeyi ekler', async () => {
    const result = await tools.run(
      'todo_add_many',
      { items: [{ text: 'Süt' }, { text: 'Ekmek' }, { text: 'Yumurta' }] },
      { origin: { channel: 'chat', speakerVerified: null } },
    );
    expect(result.ok).toBe(true);
    expect(result.show?.body[0]).toMatchObject({ type: 'list' });
    const list = await tools.run('todo_list', {}, { origin: voice });
    expect((list.data as Array<{ text: string }>).map((todo) => todo.text)).toEqual(['Süt', 'Ekmek', 'Yumurta']);
  });

  it('todo_done ve reminder_cancel', async () => {
    const added = await tools.run('todo_add', { text: 'Fatura öde' }, { origin: voice });
    const id = (added.data as { id: string }).id;
    expect((await tools.run('todo_done', { id }, { origin: voice })).ok).toBe(true);
    expect(((await tools.run('todo_list', {}, { origin: voice })).data as unknown[]).length).toBe(0);
    const created = await tools.run('reminder_create', { text: 'x', due_at: '2026-11-20T10:00:00+03:00' }, { origin: voice });
    const reminderId = (created.data as { id: string }).id;
    expect((await tools.run('reminder_cancel', { id: reminderId }, { origin: voice })).ok).toBe(true);
    expect(scheduler.list('planner.reminder')).toHaveLength(0);
    expect((await tools.run('reminder_cancel', { id: 'yok' }, { origin: voice })).ok).toBe(false);
  });

  it('eylem düğmesi: tamam ve ertele', async () => {
    const created = await tools.run('reminder_create', { text: 'Ara', due_at: new Date(T0.getTime() + 60_000).toISOString() }, { origin: voice });
    const id = (created.data as { id: string }).id;
    await vi.advanceTimersByTimeAsync(61_000);
    bus.emit('attention.action', { id: 'n', moduleId: 'planner', actionId: 'snooze10', data: { reminderId: id } });
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    expect(notified).toHaveLength(2);
    bus.emit('attention.action', { id: 'n', moduleId: 'planner', actionId: 'done', data: { reminderId: id } });
    expect(env.store.scoped('planner').get<{ status: string }>('SELECT status FROM planner_reminders')!.status).toBe('done');
  });

  it('sabah özeti bugünün işlerini ve başka modüllerin katkısını toplar', async () => {
    await tools.run('reminder_create', { text: 'Muhasebeciyi ara', due_at: '2026-11-16T15:00:00+03:00' }, { origin: voice });
    await tools.run('todo_add', { text: 'Rapor yaz', due_day: '2026-11-16' }, { origin: voice });
    bus.on('planner.brief.collect', ({ lines }) => void lines.push('KDV beyannamesi 12 gün sonra'));
    const lines = composeBrief(ctx, 'morning', '2026-11-16');
    expect(lines).toEqual(['15:00 Muhasebeciyi ara', 'Rapor yaz', 'KDV beyannamesi 12 gün sonra']);
  });
});

describe('yapılacak maddeleri: yer tutucu ve etiket', () => {
  it('yer tutucu madde tanınır; gerçek kalem tanınmaz', async () => {
    const { isPlaceholderItem } = await import('./dedupe');
    for (const text of [
      'madde 1',
      'Madde 2',
      'Alışveriş listesi maddesi 3',
      'Alışveriş listesi - madde 1',
      'Alışveriş listesi - 2. madde',
      'Alışveriş listesi: 1. Ürün 1',
      '1. madde',
      'Ürün 3',
      'Alışveriş listesi',
      'Alışveriş listesi: 1. Muz, 2. Elma, 3. Süt',
      // İsteğin kendisi madde diye yazılmış.
      'Ofis taşınması için üç maddelik liste oluştur',
      'Üç maddelik bir alışveriş listesi oluştur',
    ]) {
      expect(isPlaceholderItem(text), text).toBe(true);
    }
    for (const text of [
      'süt',
      'iki ekmek',
      'Faturaları öde',
      "Kaan'ı ara",
      'Alışveriş listesi: süt',
      '1. Ekmek',
      'Ürün kataloğunu güncelle',
      'Maddeleri gözden geçir',
      'Listeyi Kaan’a gönder',
      // Genel sözcük numarasızsa gerçek kalemdir.
      'kalem',
      'tükenmez kalem',
      'iki kalem',
      'temizlik ürünleri',
      'yeni ürün fotoğrafları',
      'Davetli listesi oluştur',
    ]) {
      expect(isPlaceholderItem(text), text).toBe(false);
    }
  });

  it('tek madde eklerken de isteğin kendisi ya da yer tutucu yazılmaz', async () => {
    const { isPlaceholderItem, placeholderRefusal } = await import('./dedupe');
    expect(isPlaceholderItem('Ofis taşınması için üç maddelik liste oluştur')).toBe(true);
    expect(placeholderRefusal('madde 1')).toMatch(/kalemin adı değil/);
  });

  it('kalemin başındaki liste etiketi ve sıra numarası atılır', async () => {
    const { cleanTodoItem } = await import('./dedupe');
    expect(cleanTodoItem('Alışveriş listesi: süt')).toBe('süt');
    expect(cleanTodoItem('Alışveriş Listesi - Ekmek')).toBe('Ekmek');
    expect(cleanTodoItem('1. Yumurta')).toBe('Yumurta');
    expect(cleanTodoItem('2) İki kilo domates')).toBe('İki kilo domates');
    expect(cleanTodoItem('- peynir')).toBe('peynir');
    expect(cleanTodoItem('Yapılacaklar: raporu gönder')).toBe('raporu gönder');
    // Kalemin kendisine dokunulmaz.
    expect(cleanTodoItem('Listeyi Kaan’a gönder')).toBe('Listeyi Kaan’a gönder');
    expect(cleanTodoItem('3 ekmek')).toBe('3 ekmek');
    expect(cleanTodoItem('2026 bütçesini hazırla')).toBe('2026 bütçesini hazırla');
  });
});
