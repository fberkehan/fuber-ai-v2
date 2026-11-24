// Arka plan işleri: işin tam kaydı (`job.progress`) ve adanın gösterdiği o anki özet (`job.activity`).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bus, JobActivity, JobControl, JobsApi } from '@fuber/shared';
import { silentLog, tempStore, testBus } from './brain/testkit';
import { createJobs } from './jobs';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let jobs: JobsApi;
let activity: JobActivity[];

/** Dışarıdan yönetilen iş: adımlarını sınama atar, bitişini sınama verir. */
function controlled(title: string, kind = 'web.research') {
  let control!: JobControl;
  let finish!: (text: string) => void;
  let fail!: (error: Error) => void;
  let begun!: () => void;
  const started = new Promise<void>((resolve) => (begun = resolve));
  const job = jobs.start({
    kind,
    moduleId: kind.split('.')[0]!,
    title,
    run: (given) => {
      control = given;
      begun();
      return new Promise<string>((done, reject) => {
        finish = done;
        fail = reject;
      });
    },
  });
  return {
    started,
    id: job.id,
    update: (change: Parameters<JobControl['update']>[0]) => control.update(change),
    finish: (text = 'bitti') => finish(text),
    fail: (message: string) => fail(new Error(message)),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  jobs = createJobs({ store: env.store, bus, log: silentLog });
  activity = [];
  bus.on('job.activity', (event) => void activity.push(event));
});
afterEach(() => env.close());

describe('iş özeti (job.activity)', () => {
  it('başlama, adım, yüzde (ölçülemiyorsa belirsiz) ve bitiş tipli olarak yayınlanır', async () => {
    const job = controlled('E-fatura araştırması');
    await job.started;
    expect(activity.at(-1)).toMatchObject({ current: { title: 'E-fatura araştırması', status: 'running', step: 'Başladı', progress: null }, running: 1, queued: 0, finished: null });

    job.update({ step: 'Kaynaklar aranıyor' });
    expect(activity.at(-1)!.current).toMatchObject({ step: 'Kaynaklar aranıyor', progress: null });
    job.update({ step: '3 sayfa okundu', progress: 0.42 });
    expect(activity.at(-1)!.current).toMatchObject({ step: '3 sayfa okundu', progress: 0.42 });
    // Aynı durum yinelenirse yeni olay çıkmaz.
    const count = activity.length;
    job.update({ step: '3 sayfa okundu', progress: 0.42 });
    expect(activity).toHaveLength(count);

    job.finish();
    await flush();
    expect(activity.at(-1)).toEqual({ current: null, running: 0, queued: 0, finished: { id: job.id, title: 'E-fatura araştırması', status: 'done' } });
    expect(jobs.activity!()).toEqual({ current: null, running: 0, queued: 0, finished: null });
  });

  it('birkaç iş: satır en son ilerleme bildiren koşan işi gösterir; fazlası sırada sayılır', async () => {
    const a = controlled('Araştırma');
    const b = controlled('Yetenek geliştirme', 'workshop.skill_build');
    const c = controlled('Kod görevi', 'projects.code_task');
    await Promise.all([a.started, b.started]);
    // Aynı anda en çok iki iş koşar; üçüncüsü bekler.
    expect(jobs.activity!()).toMatchObject({ running: 2, queued: 1 });
    a.update({ step: 'A ilerledi' });
    expect(activity.at(-1)!.current).toMatchObject({ title: 'Araştırma', step: 'A ilerledi' });
    b.update({ step: 'B ilerledi', progress: 0.5 });
    expect(activity.at(-1)!.current).toMatchObject({ title: 'Yetenek geliştirme', step: 'B ilerledi', progress: 0.5 });

    b.fail('derlenemedi');
    await flush();
    await c.started;
    // Biten iş bildirilir; sıradaki koşmaya başlar.
    expect(activity.some((event) => event.finished?.status === 'failed' && event.finished.title === 'Yetenek geliştirme')).toBe(true);
    expect(jobs.activity!()).toMatchObject({ running: 2, queued: 0 });
    a.finish();
    c.finish();
    await flush();
    expect(jobs.activity!().current).toBeNull();
  });

  it('iptal: sıradaki ve koşan iş özetten düşer', async () => {
    const a = controlled('Uzun iş');
    await a.started;
    expect(jobs.cancel(a.id)).toBe(true);
    a.finish();
    await flush();
    expect(activity.at(-1)).toMatchObject({ current: null, finished: { status: 'cancelled' } });
  });
});
