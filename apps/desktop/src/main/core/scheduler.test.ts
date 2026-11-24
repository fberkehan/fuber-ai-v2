import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, SchedulerApi, TaskRun } from '@fuber/shared';
import { silentLog, tempStore, testBus } from './brain/testkit';
import { createScheduler, SCHEDULER_POLL_MS } from './scheduler';

let env: ReturnType<typeof tempStore>;
const started: SchedulerApi[] = [];

function scheduler(): SchedulerApi {
  const instance = createScheduler({ store: env.store, bus: testBus(), log: silentLog });
  started.push(instance);
  return instance;
}

const T0 = new Date('2026-11-16T09:00:00+03:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(T0);
  env = tempStore();
});
afterEach(() => {
  for (const instance of started.splice(0)) instance.stop();
  vi.useRealTimers();
  env.close();
});

const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();

describe('zamanlayıcı', () => {
  it('tek seferlik işi vaktinde bir kez çalıştırır ve siler', async () => {
    const s = scheduler();
    s.start();
    const runs: TaskRun[] = [];
    s.handle('t.once', (_task, run) => void runs.push(run));
    s.schedule({ kind: 't.once', dueAt: at(60_000), payload: {} });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.missed).toBe(false);
    expect(s.list('t.once')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runs).toHaveLength(1);
  });

  it('kapalıyken kaçan iş açılışta bir kez, "kaçmış" olarak çalışır; ikinci açılışta çalmaz', async () => {
    const first = scheduler();
    first.start();
    first.schedule({ kind: 't.missed', dueAt: at(60_000), payload: { n: 1 } });
    first.stop();
    vi.setSystemTime(new Date(T0.getTime() + 3 * 3_600_000));

    const second = scheduler();
    second.start();
    const runs: TaskRun[] = [];
    second.handle('t.missed', (_task, run) => void runs.push(run));
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ missed: true, scheduledFor: at(60_000) });
    second.stop();

    const third = scheduler();
    third.start();
    const again: TaskRun[] = [];
    third.handle('t.missed', (_task, run) => void again.push(run));
    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS * 2);
    expect(again).toHaveLength(0);
  });

  it('tekrarlı işte kaçan bütün tekrarlar tek çalışmaya iner ve seri geleceğe geçer', async () => {
    const first = scheduler();
    first.start();
    first.schedule({ kind: 't.daily', dueAt: at(60_000), payload: {}, recurrence: { freq: 'daily', interval: 1 } });
    first.stop();
    vi.setSystemTime(new Date(T0.getTime() + 3 * 86_400_000 + 3_600_000));

    const second = scheduler();
    second.start();
    const runs: Array<{ task: ScheduledTask; run: TaskRun }> = [];
    second.handle('t.daily', (task, run) => void runs.push({ task, run }));
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.run.missed).toBe(true);
    const next = new Date(second.list('t.daily')[0]!.dueAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    // Duvar saati korunur: her gün 09:01.
    expect(next.getHours()).toBe(new Date(at(60_000)).getHours());
    expect(next.getMinutes()).toBe(new Date(at(60_000)).getMinutes());
  });

  it('işleyici sonradan kaydedilince bekleyen vakti gelmiş iş çalışır', async () => {
    const s = scheduler();
    s.start();
    s.schedule({ kind: 't.late', dueAt: at(1_000), payload: {} });
    await vi.advanceTimersByTimeAsync(5_000);
    const runs: TaskRun[] = [];
    s.handle('t.late', (_task, run) => void runs.push(run));
    await vi.advanceTimersByTimeAsync(10);
    expect(runs).toHaveLength(1);
  });

  it('saat ileri sıçrarsa uzun zamanlayıcıya güvenmeden en geç bir yoklamada yakalar', async () => {
    const s = scheduler();
    s.start();
    const runs: TaskRun[] = [];
    s.handle('t.jump', (_task, run) => void runs.push(run));
    s.schedule({ kind: 't.jump', dueAt: at(3_600_000), payload: {} });
    // Sistem saati bir anda 2 saat ileri alındı (ya da uykudan dönüldü); zamanlayıcılar bunu bilmez.
    vi.setSystemTime(new Date(T0.getTime() + 2 * 3_600_000));
    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS + 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.lateMs).toBeGreaterThan(50 * 60_000);
    expect(runs[0]!.missed).toBe(true);
  });

  it('aynı tür + anahtar tek görevdir; yeniden planlama üstüne yazar', () => {
    const s = scheduler();
    s.start();
    s.schedule({ kind: 't.key', key: 'r1', dueAt: at(60_000), payload: { v: 1 } });
    s.schedule({ kind: 't.key', key: 'r1', dueAt: at(120_000), payload: { v: 2 } });
    const list = s.list('t.key');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ dueAt: at(120_000), payload: { v: 2 } });
    expect(s.cancelByKey('t.key', 'r1')).toBe(true);
    expect(s.list('t.key')).toHaveLength(0);
  });

  it('işleyici hata verse de iş ilerler', async () => {
    const s = scheduler();
    s.start();
    let calls = 0;
    s.handle('t.err', () => {
      calls++;
      throw new Error('boom');
    });
    s.schedule({ kind: 't.err', dueAt: at(1_000), payload: {} });
    await vi.advanceTimersByTimeAsync(SCHEDULER_POLL_MS * 3);
    expect(calls).toBe(1);
  });
});
