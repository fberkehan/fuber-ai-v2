// Sahibi: T2. Kalıcı zamanlayıcı: tek seferlik ve tekrarlı işler, kaçanlar, saat sıçraması, uykudan dönüş.
import {
  fromLocal,
  localDay,
  localTime,
  newId,
  nextOccurrence,
  nowIso,
  type Id,
  type JsonObject,
  type Migration,
  type Recurrence,
  type ScheduledTask,
  type SchedulerApi,
  type ServiceDeps,
  type TaskRun,
  type Unsubscribe,
} from '@fuber/shared';

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'zamanlanmış işler',
    up: `CREATE TABLE scheduler_tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      due_at TEXT NOT NULL,
      due_ms INTEGER NOT NULL,
      recurrence TEXT,
      payload TEXT NOT NULL,
      key TEXT,
      created_at TEXT NOT NULL,
      -- Tekrarlı serinin dayanak anı: saat, gün ve ayın günü buradan alınır.
      anchor_at TEXT NOT NULL,
      -- Dayanağın yerel duvar saati ("YYYY-MM-DD HH:MM"); saat dilimi değişince seri buna göre yeniden kurulur.
      anchor_local TEXT NOT NULL,
      last_run_at TEXT
    );
    CREATE INDEX scheduler_tasks_due ON scheduler_tasks (due_ms);
    CREATE UNIQUE INDEX scheduler_tasks_key ON scheduler_tasks (kind, key) WHERE key IS NOT NULL;`,
  },
];

/** Uzun zamanlayıcıya güvenilmez (uyku, saat değişimi): en geç bu aralıkla yeniden bakılır. */
export const SCHEDULER_POLL_MS = 30_000;
/** Bu kadar geç çalışan iş (uykudan dönüş) de "kaçmış" sayılır ve özetle bildirilir. */
export const SCHEDULER_LATE_AS_MISSED_MS = 5 * 60_000;
/** Duvar saati ile tekdüze saat arasında bu kadar fark: sistem saati değişti. */
const CLOCK_JUMP_MS = 60_000;

interface Row {
  id: string;
  kind: string;
  due_at: string;
  due_ms: number;
  recurrence: string | null;
  payload: string;
  key: string | null;
  created_at: string;
  anchor_at: string;
  anchor_local: string;
  last_run_at: string | null;
}

function toTask(row: Row): ScheduledTask {
  return {
    id: row.id,
    kind: row.kind,
    dueAt: row.due_at,
    recurrence: row.recurrence ? (JSON.parse(row.recurrence) as Recurrence) : null,
    payload: JSON.parse(row.payload) as JsonObject,
    key: row.key,
    createdAt: row.created_at,
  };
}

const wallClock = (date: Date) => `${localDay(date)} ${localTime(date)}`;

type Handler = (task: ScheduledTask, run: TaskRun) => void | Promise<void>;

export function createScheduler(deps: ServiceDeps['scheduler']): SchedulerApi {
  const log = deps.log.child('scheduler');
  const db = deps.store.scoped('scheduler');
  const handlers = new Map<string, Handler>();
  let ready = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bu süreç başlamadan önce vakti gelmiş işler "kaçmış"tır (uygulama kapalıydı). */
  let startedAtMs = Date.now();
  let lastWall = Date.now();
  let lastMono = performance.now();
  let lastOffset = new Date().getTimezoneOffset();
  let ticking = false;

  const ensure = () => {
    if (ready) return;
    deps.store.migrate('scheduler', MIGRATIONS);
    ready = true;
  };

  const rowById = (id: Id) => db.get<Row>('SELECT * FROM scheduler_tasks WHERE id = ?', [id]);

  /** Saat dilimi değişince tekrarlı işlerin bir sonraki anı yeni dilimin duvar saatine göre yeniden hesaplanır. */
  const realignRecurring = () => {
    const rows = db.all<Row>('SELECT * FROM scheduler_tasks WHERE recurrence IS NOT NULL');
    for (const row of rows) {
      const recurrence = JSON.parse(row.recurrence!) as Recurrence;
      const [day = '', time = ''] = row.anchor_local.split(' ');
      const anchor = fromLocal(day, time);
      const after = new Date(Date.parse(row.last_run_at ?? row.created_at) || Date.now());
      const next = nextOccurrence(recurrence, anchor, new Date(after.getTime() - 1));
      if (!next) continue;
      db.run('UPDATE scheduler_tasks SET due_at = ?, due_ms = ?, anchor_at = ? WHERE id = ?', [
        next.toISOString(),
        next.getTime(),
        anchor.toISOString(),
        row.id,
      ]);
    }
  };

  const detectClockChange = () => {
    const wall = Date.now();
    const mono = performance.now();
    const drift = wall - lastWall - (mono - lastMono);
    if (Math.abs(drift) > CLOCK_JUMP_MS) log.info(`sistem saati ya da uyku sıçraması: ${Math.round(drift / 1000)} sn`);
    lastWall = wall;
    lastMono = mono;
    const offset = new Date().getTimezoneOffset();
    if (offset !== lastOffset) {
      log.info(`saat dilimi değişti: ${lastOffset} → ${offset}`);
      lastOffset = offset;
      realignRecurring();
    }
  };

  const runDue = async () => {
    if (ticking) return;
    ticking = true;
    try {
      detectClockChange();
      const now = Date.now();
      const kinds = [...handlers.keys()];
      if (kinds.length === 0) return;
      const due = db.all<Row>(
        `SELECT * FROM scheduler_tasks WHERE due_ms <= ? AND kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY due_ms`,
        [now, ...kinds],
      );
      for (const row of due) {
        const handler = handlers.get(row.kind);
        if (!handler) continue;
        const run: TaskRun = {
          scheduledFor: row.due_at,
          missed: row.due_ms < startedAtMs || now - row.due_ms > SCHEDULER_LATE_AS_MISSED_MS,
          lateMs: Math.max(0, now - row.due_ms),
        };
        // İşaret işleyiciden ÖNCE kalıcı yazılır: işleyici çökse ya da uygulama kapansa da iki kez çalmaz.
        let task = toTask(row);
        if (task.recurrence) {
          // Kaçan bütün tekrarlar atlanır; seri bir sonraki gelecekteki ana geçer, iş bir kez çalışır.
          const next = nextOccurrence(task.recurrence, row.anchor_at, new Date(now));
          if (next) {
            db.run('UPDATE scheduler_tasks SET due_at = ?, due_ms = ?, last_run_at = ? WHERE id = ?', [
              next.toISOString(),
              next.getTime(),
              new Date(now).toISOString(),
              row.id,
            ]);
            task = { ...task, dueAt: next.toISOString() };
          } else {
            db.run('DELETE FROM scheduler_tasks WHERE id = ?', [row.id]);
          }
        } else {
          db.run('DELETE FROM scheduler_tasks WHERE id = ?', [row.id]);
        }
        try {
          await handler(task, run);
        } catch (error) {
          log.error(`işleyici hata verdi: ${row.kind}`, error);
        }
      }
    } finally {
      ticking = false;
    }
  };

  const arm = () => {
    if (!running) return;
    if (timer) clearTimeout(timer);
    const next = db.get<{ due_ms: number }>('SELECT MIN(due_ms) AS due_ms FROM scheduler_tasks');
    const wait = next?.due_ms == null ? SCHEDULER_POLL_MS : Math.max(0, next.due_ms - Date.now());
    timer = setTimeout(() => {
      timer = null;
      void runDue().finally(arm);
    }, Math.min(wait, SCHEDULER_POLL_MS));
  };

  const kick = () => {
    if (!running) return;
    void runDue().finally(arm);
  };

  return {
    start() {
      ensure();
      running = true;
      startedAtMs = Date.now();
      lastWall = Date.now();
      lastMono = performance.now();
      lastOffset = new Date().getTimezoneOffset();
      kick();
    },

    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },

    schedule(input) {
      ensure();
      const due = new Date(input.dueAt);
      if (Number.isNaN(due.getTime())) throw new Error(`geçersiz zaman: ${input.dueAt}`);
      const now = nowIso();
      const id = db.transaction(() => {
        const existing = input.key
          ? db.get<Row>('SELECT * FROM scheduler_tasks WHERE kind = ? AND key = ?', [input.kind, input.key])
          : undefined;
        const recurrence = input.recurrence ? JSON.stringify(input.recurrence) : null;
        if (existing) {
          db.run(
            `UPDATE scheduler_tasks SET due_at = ?, due_ms = ?, recurrence = ?, payload = ?, anchor_at = ?, anchor_local = ?,
               last_run_at = NULL WHERE id = ?`,
            [
              due.toISOString(),
              due.getTime(),
              recurrence,
              JSON.stringify(input.payload),
              due.toISOString(),
              wallClock(due),
              existing.id,
            ],
          );
          return existing.id;
        }
        const newTaskId = newId();
        db.run(
          `INSERT INTO scheduler_tasks (id, kind, due_at, due_ms, recurrence, payload, key, created_at, anchor_at, anchor_local)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newTaskId,
            input.kind,
            due.toISOString(),
            due.getTime(),
            recurrence,
            JSON.stringify(input.payload),
            input.key ?? null,
            now,
            due.toISOString(),
            wallClock(due),
          ],
        );
        return newTaskId;
      });
      arm();
      return toTask(rowById(id)!);
    },

    cancel(id) {
      ensure();
      const removed = db.run('DELETE FROM scheduler_tasks WHERE id = ?', [id]).changes > 0;
      if (removed) arm();
      return removed;
    },

    cancelByKey(kind, key) {
      ensure();
      const removed = db.run('DELETE FROM scheduler_tasks WHERE kind = ? AND key = ?', [kind, key]).changes > 0;
      if (removed) arm();
      return removed;
    },

    get(id) {
      ensure();
      const row = rowById(id);
      return row ? toTask(row) : null;
    },

    list(kind) {
      ensure();
      const rows = kind
        ? db.all<Row>('SELECT * FROM scheduler_tasks WHERE kind = ? ORDER BY due_ms', [kind])
        : db.all<Row>('SELECT * FROM scheduler_tasks ORDER BY due_ms');
      return rows.map(toTask);
    },

    handle(kind, handler): Unsubscribe {
      ensure();
      if (handlers.has(kind)) throw new Error(`zamanlayıcı işleyicisi zaten kayıtlı: ${kind}`);
      handlers.set(kind, handler);
      // Kayıt beklerken vakti gelmiş işler hemen işlenir (açılışta modüller zamanlayıcıdan sonra yüklenir).
      kick();
      return () => {
        if (handlers.get(kind) === handler) handlers.delete(kind);
      };
    },
  };
}
