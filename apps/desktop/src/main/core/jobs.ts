// Sahibi: T2. Arka plan derin görevleri: sıra, ilerleme olayları, iptal, yeniden başlatmada "yarıda kaldı".
// İki olay yayınlanır: `job.progress` işin tam kaydını taşır (her değişimde); `job.activity` işlerin O ANKİ özetidir
// (hangi iş, hangi adım, yüzde ya da belirsiz, kaç iş koşuyor/bekliyor) ve adanın gösterdiği satırın verisidir.
import {
  newId,
  nowIso,
  type Id,
  type Job,
  type JobActivity,
  type JobSpec,
  type JobsApi,
  type Migration,
  type ServiceDeps,
  type SqlValue,
} from '@fuber/shared';

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'arka plan işleri',
    up: `CREATE TABLE jobs_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      module_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL,
      step TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      result_text TEXT,
      error TEXT
    );
    CREATE INDEX jobs_jobs_status ON jobs_jobs (status);`,
  },
];

/** Aynı anda koşan en çok iş; fazlası sırada bekler. */
export const MAX_RUNNING_JOBS = 2;
export const INTERRUPTED_JOB_ERROR = 'Uygulama kapandığı için yarıda kaldı; kendiliğinden yeniden başlatılmadı.';

interface Row {
  id: string;
  kind: string;
  module_id: string;
  title: string;
  status: string;
  progress: number | null;
  step: string;
  started_at: string;
  finished_at: string | null;
  result_text: string | null;
  error: string | null;
}

const toJob = (row: Row): Job => ({
  id: row.id,
  kind: row.kind,
  moduleId: row.module_id,
  title: row.title,
  status: row.status as Job['status'],
  progress: row.progress,
  step: row.step,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  resultText: row.result_text,
  error: row.error,
});

const FINISHED: ReadonlySet<Job['status']> = new Set(['done', 'failed', 'cancelled']);

export function createJobs(deps: ServiceDeps['jobs']): JobsApi {
  const log = deps.log.child('jobs');
  const db = deps.store.scoped('jobs');
  const queue: Array<{ job: Job; spec: JobSpec }> = [];
  const active = new Map<Id, AbortController>();
  const waiters = new Map<Id, Array<(job: Job) => void>>();
  let ready = false;
  /** Koşan ve bekleyen işlerin son bilinen hali (ilerleme bildirim sırasıyla: en son bildiren en sonda). */
  const live = new Map<Id, Job>();
  let lastActivity = '';

  /**
   * İşlerin o anki özeti. Gösterilecek iş: en son ilerleme bildiren KOŞAN iş (birkaç iş birlikte koşuyorsa satır,
   * az önce adım atan işi gösterir); koşan yoksa sıradaki ilk iş. Yüzde ölçülemiyorsa `progress: null` (belirsiz).
   */
  const summarize = (finished: JobActivity['finished'] = null): JobActivity => {
    const jobs = [...live.values()];
    const running = jobs.filter((job) => job.status === 'running');
    const queued = jobs.filter((job) => job.status === 'queued');
    const shown = running.at(-1) ?? queued[0] ?? null;
    return {
      current: shown
        ? {
            id: shown.id,
            kind: shown.kind,
            moduleId: shown.moduleId,
            title: shown.title,
            status: shown.status as 'queued' | 'running',
            step: shown.step,
            progress: shown.progress,
            startedAt: shown.startedAt,
          }
        : null,
      running: running.length,
      queued: queued.length,
      finished,
    };
  };

  /** İşin yeni halini özete işler ve özet değiştiyse `job.activity` yayınlar. */
  const track = (job: Job) => {
    const done = FINISHED.has(job.status);
    // Yeniden eklemek sırayı günceller: en son ilerleme bildiren iş sona gelir.
    const known = live.delete(job.id);
    if (!done) live.set(job.id, job);
    else if (!known) return;
    const activity = summarize(done ? { id: job.id, title: job.title, status: job.status as 'done' | 'failed' | 'cancelled' } : null);
    const signature = JSON.stringify(activity);
    if (signature === lastActivity) return;
    lastActivity = signature;
    deps.bus.emit('job.activity', activity);
  };

  const ensure = () => {
    if (ready) return;
    deps.store.migrate('jobs', MIGRATIONS);
    // Önceki oturumdan kalan yarım işler: kendiliğinden yeniden koşturulmaz (yan etkileri olabilir).
    const stale = db.all<Row>(`SELECT * FROM jobs_jobs WHERE status IN ('queued', 'running')`);
    for (const row of stale) {
      db.run(`UPDATE jobs_jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`, [
        nowIso(),
        INTERRUPTED_JOB_ERROR,
        row.id,
      ]);
    }
    if (stale.length) log.info(`${stale.length} iş yarıda kalmış olarak işaretlendi`);
    ready = true;
  };

  const read = (id: Id) => {
    const row = db.get<Row>('SELECT * FROM jobs_jobs WHERE id = ?', [id]);
    return row ? toJob(row) : null;
  };

  const save = (id: Id, change: Partial<Record<keyof Row, SqlValue>>): Job => {
    const keys = Object.keys(change);
    if (keys.length) {
      db.run(`UPDATE jobs_jobs SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
        ...keys.map((key) => change[key as keyof Row] as SqlValue),
        id,
      ]);
    }
    const job = read(id)!;
    deps.bus.emit('job.progress', { job });
    track(job);
    if (FINISHED.has(job.status)) {
      for (const resolve of waiters.get(id) ?? []) resolve(job);
      waiters.delete(id);
    }
    return job;
  };

  const pump = () => {
    while (active.size < MAX_RUNNING_JOBS && queue.length > 0) {
      const next = queue.shift()!;
      void execute(next.job, next.spec);
    }
  };

  const execute = async (job: Job, spec: JobSpec) => {
    const controller = new AbortController();
    active.set(job.id, controller);
    save(job.id, { status: 'running', step: 'Başladı' });
    try {
      const text = await spec.run({
        id: job.id,
        signal: controller.signal,
        update(change) {
          if (controller.signal.aborted) return;
          const patch: Partial<Record<keyof Row, SqlValue>> = {};
          if (change.progress !== undefined) patch.progress = change.progress === null ? null : Math.min(1, Math.max(0, change.progress));
          if (change.step !== undefined) patch.step = change.step;
          save(job.id, patch);
        },
      });
      if (controller.signal.aborted) save(job.id, { status: 'cancelled', finished_at: nowIso(), step: 'İptal edildi' });
      else save(job.id, { status: 'done', progress: 1, finished_at: nowIso(), result_text: text, step: 'Tamamlandı' });
    } catch (error) {
      if (controller.signal.aborted) {
        save(job.id, { status: 'cancelled', finished_at: nowIso(), step: 'İptal edildi' });
      } else {
        log.error(`iş başarısız: ${job.kind}`, error);
        const message = error instanceof Error && error.message ? error.message : 'Beklenmeyen bir sorun oluştu.';
        save(job.id, { status: 'failed', finished_at: nowIso(), error: message, step: 'Başarısız' });
      }
    } finally {
      active.delete(job.id);
      pump();
    }
  };

  const cancel = (id: Id): boolean => {
    ensure();
    const controller = active.get(id);
    if (controller) {
      controller.abort();
      return true;
    }
    const index = queue.findIndex((entry) => entry.job.id === id);
    if (index === -1) return false;
    queue.splice(index, 1);
    save(id, { status: 'cancelled', finished_at: nowIso(), step: 'İptal edildi' });
    return true;
  };

  const api: JobsApi = {
    start(spec) {
      ensure();
      const id = newId();
      db.run(
        `INSERT INTO jobs_jobs (id, kind, module_id, title, status, progress, step, started_at) VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?)`,
        [id, spec.kind, spec.moduleId, spec.title, 'Sırada', nowIso()],
      );
      const job = save(id, {});
      queue.push({ job, spec });
      pump();
      return read(id)!;
    },
    cancel,
    cancelAll() {
      ensure();
      const ids = [...active.keys(), ...queue.map((entry) => entry.job.id)];
      let count = 0;
      for (const id of ids) if (cancel(id)) count++;
      return count;
    },
    get(id) {
      ensure();
      return read(id);
    },
    list(filter = {}) {
      ensure();
      const conditions: string[] = [];
      const params: SqlValue[] = [];
      if (filter.status) {
        conditions.push('status = ?');
        params.push(filter.status);
      }
      if (filter.kind) {
        conditions.push('kind = ?');
        params.push(filter.kind);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return db
        .all<Row>(`SELECT * FROM jobs_jobs ${where} ORDER BY id DESC LIMIT ?`, [...params, filter.limit ?? 50])
        .map(toJob);
    },
    activity: () => summarize(),
    wait(id) {
      ensure();
      const job = read(id);
      if (!job) return Promise.reject(new Error(`iş bulunamadı: ${id}`));
      if (FINISHED.has(job.status)) return Promise.resolve(job);
      return new Promise((resolve) => {
        const list = waiters.get(id) ?? [];
        list.push(resolve);
        waiters.set(id, list);
      });
    },
  };

  deps.bus.on('app.panic', () => {
    if (ready) api.cancelAll();
  });
  return api;
}
