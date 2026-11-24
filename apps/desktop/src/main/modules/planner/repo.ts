// Sahibi: T2. Hatırlatıcı ve yapılacak kayıtları; araçlar, IPC ve zamanlayıcı işleyicisi aynı yolu kullanır.
import {
  newId,
  nextOccurrence,
  nowIso,
  type Id,
  type IsoDateTime,
  type Migration,
  type ModuleContext,
  type Priority,
  type Recurrence,
  type RecordSource,
  type Reminder,
  type ReminderInput,
  type SqlValue,
  type Todo,
  type TodoInput,
} from '@fuber/shared';

export const REMINDER_TASK = 'planner.reminder';

export const PLANNER_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'hatırlatıcılar ve yapılacaklar',
    up: `CREATE TABLE planner_reminders (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      due_at TEXT NOT NULL,
      recurrence TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      fired_at TEXT,
      memory_id TEXT
    );
    CREATE INDEX planner_reminders_due ON planner_reminders (status, due_at);
    CREATE TABLE planner_todos (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      notes TEXT NOT NULL,
      done INTEGER NOT NULL,
      due_day TEXT,
      priority TEXT NOT NULL,
      source TEXT NOT NULL,
      sort INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      done_at TEXT
    );`,
  },
];

interface ReminderRow {
  id: string;
  text: string;
  due_at: string;
  recurrence: string | null;
  status: string;
  priority: string;
  source: string;
  created_at: string;
  fired_at: string | null;
  memory_id: string | null;
}

interface TodoRow {
  id: string;
  text: string;
  notes: string;
  done: number;
  due_day: string | null;
  priority: string;
  source: string;
  sort: number;
  created_at: string;
  done_at: string | null;
}

const toReminder = (row: ReminderRow): Reminder => ({
  id: row.id,
  text: row.text,
  dueAt: row.due_at,
  recurrence: row.recurrence ? (JSON.parse(row.recurrence) as Recurrence) : null,
  status: row.status as Reminder['status'],
  priority: row.priority as Priority,
  source: row.source as RecordSource,
  createdAt: row.created_at,
  firedAt: row.fired_at,
  memoryId: row.memory_id,
});

const toTodo = (row: TodoRow): Todo => ({
  id: row.id,
  text: row.text,
  notes: row.notes,
  done: row.done === 1,
  dueDay: row.due_day,
  priority: row.priority as Priority,
  source: row.source as RecordSource,
  order: row.sort,
  createdAt: row.created_at,
  doneAt: row.done_at,
});

export class PlannerError extends Error {}

/** Verilen an geçmişteyse ve tekrarlıysa serinin gelecekteki ilk anı; tek seferlikse hata. */
function firstDue(dueAt: string, recurrence: Recurrence | null): Date {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) throw new PlannerError(`Zaman anlaşılamadı: "${dueAt}". ISO 8601 biçiminde olmalı.`);
  // Bir dakikalık pay: "şimdi hatırlat" diyen kullanıcının isteği saat farkıyla geçmişe düşmesin.
  if (due.getTime() >= Date.now() - 60_000) return due;
  if (!recurrence) throw new PlannerError('Bu an geçmişte kaldı; ileri bir zaman verin.');
  const next = nextOccurrence(recurrence, due, new Date());
  if (!next) throw new PlannerError('Tekrarın bitiş tarihi geçmiş; hatırlatıcı hiç çalmaz.');
  return next;
}

export function createPlannerRepo(ctx: ModuleContext) {
  const db = ctx.db;
  const changed = (entity: 'reminder' | 'todo', op: 'created' | 'updated' | 'deleted', ids: Id[]) =>
    ctx.bus.emit('planner.changed', { entity, op, ids });

  const reminderRow = (id: Id) => db.get<ReminderRow>('SELECT * FROM planner_reminders WHERE id = ?', [id]);
  const todoRow = (id: Id) => db.get<TodoRow>('SELECT * FROM planner_todos WHERE id = ?', [id]);

  const schedule = (reminder: Reminder) => {
    ctx.scheduler.schedule({
      kind: REMINDER_TASK,
      key: reminder.id,
      dueAt: reminder.dueAt,
      recurrence: reminder.recurrence,
      payload: { reminderId: reminder.id },
    });
  };

  const getReminder = (id: Id): Reminder => {
    const row = reminderRow(id);
    if (!row) throw new PlannerError('Bu kimlikte bir hatırlatıcı yok.');
    return toReminder(row);
  };

  const getTodo = (id: Id): Todo => {
    const row = todoRow(id);
    if (!row) throw new PlannerError('Bu kimlikte bir yapılacak yok.');
    return toTodo(row);
  };

  return {
    /** `stamps.createdAt`: içe aktarılan kaydın asıl oluşturulma anı (`import-api.ts`); verilmezse şimdi. */
    createReminder(input: ReminderInput, source: RecordSource, sessionId?: Id | null, stamps: { createdAt?: IsoDateTime } = {}): Reminder {
      const text = input.text.trim();
      if (!text) throw new PlannerError('Hatırlatıcının metni boş.');
      const recurrence = input.recurrence ?? null;
      const due = firstDue(input.dueAt, recurrence);
      const id = newId();
      const createdAt = stamps.createdAt ?? nowIso();
      // Söz verilen iş hafızaya da geçer ki "neyi hatırlatacaktın?" sorusu hafızadan yanıtlanabilsin.
      const memory = ctx.memory.save({
        kind: 'commitment',
        text: `Hatırlatıcı: ${text}`,
        source,
        confidence: 1,
        importance: 0.7,
        reminderId: id,
        sessionId: sessionId ?? null,
        ...(stamps.createdAt ? { at: stamps.createdAt, updatedAt: stamps.createdAt } : {}),
      });
      db.run(
        `INSERT INTO planner_reminders (id, text, due_at, recurrence, status, priority, source, created_at, memory_id)
         VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
        [id, text, due.toISOString(), recurrence ? JSON.stringify(recurrence) : null, input.priority ?? 'high', source, createdAt, memory.id],
      );
      const reminder = getReminder(id);
      schedule(reminder);
      changed('reminder', 'created', [id]);
      return reminder;
    },

    updateReminder(id: Id, patch: Partial<ReminderInput>): Reminder {
      const current = getReminder(id);
      const recurrence = patch.recurrence === undefined ? current.recurrence : patch.recurrence;
      const dueSource = patch.dueAt ?? current.dueAt;
      const due = patch.dueAt !== undefined || patch.recurrence !== undefined ? firstDue(dueSource, recurrence) : new Date(current.dueAt);
      const text = patch.text?.trim() || current.text;
      db.run(
        `UPDATE planner_reminders SET text = ?, due_at = ?, recurrence = ?, priority = ?,
           status = CASE WHEN status = 'fired' AND ? THEN 'scheduled' ELSE status END WHERE id = ?`,
        [
          text,
          due.toISOString(),
          recurrence ? JSON.stringify(recurrence) : null,
          patch.priority ?? current.priority,
          patch.dueAt !== undefined ? 1 : 0,
          id,
        ],
      );
      const reminder = getReminder(id);
      if (reminder.status === 'scheduled') schedule(reminder);
      if (patch.text && current.memoryId) ctx.memory.update(current.memoryId, { text: `Hatırlatıcı: ${text}` });
      changed('reminder', 'updated', [id]);
      return reminder;
    },

    cancelReminder(id: Id): Reminder {
      getReminder(id);
      db.run(`UPDATE planner_reminders SET status = 'cancelled' WHERE id = ?`, [id]);
      ctx.scheduler.cancelByKey(REMINDER_TASK, id);
      changed('reminder', 'updated', [id]);
      return getReminder(id);
    },

    deleteReminder(id: Id): void {
      const reminder = getReminder(id);
      db.run('DELETE FROM planner_reminders WHERE id = ?', [id]);
      ctx.scheduler.cancelByKey(REMINDER_TASK, id);
      if (reminder.memoryId) ctx.memory.forget(reminder.memoryId);
      changed('reminder', 'deleted', [id]);
    },

    completeReminder(id: Id): Reminder {
      const reminder = getReminder(id);
      if (reminder.recurrence) {
        // Tekrarlıda yalnız bu sefer kapanır; seri planlı kalır.
        db.run(`UPDATE planner_reminders SET status = 'scheduled' WHERE id = ?`, [id]);
      } else {
        db.run(`UPDATE planner_reminders SET status = 'done' WHERE id = ?`, [id]);
        ctx.scheduler.cancelByKey(REMINDER_TASK, id);
      }
      changed('reminder', 'updated', [id]);
      return getReminder(id);
    },

    snoozeReminder(id: Id, minutes: number): Reminder {
      const reminder = getReminder(id);
      const due = new Date(Date.now() + Math.max(1, minutes) * 60_000);
      if (reminder.recurrence) {
        // Seriyi bozmadan tek seferlik erteleme: ayrı bir görev.
        ctx.scheduler.schedule({
          kind: REMINDER_TASK,
          key: `${id}:snooze`,
          dueAt: due.toISOString(),
          payload: { reminderId: id, snooze: true },
        });
        db.run(`UPDATE planner_reminders SET status = 'scheduled' WHERE id = ?`, [id]);
      } else {
        db.run(`UPDATE planner_reminders SET status = 'scheduled', due_at = ? WHERE id = ?`, [due.toISOString(), id]);
        schedule(getReminder(id));
      }
      changed('reminder', 'updated', [id]);
      return getReminder(id);
    },

    /** Zamanlayıcı çaldırınca: tek seferlik `fired`, tekrarlı bir sonraki ana geçer. */
    markFired(id: Id, nextDueAt: string | null): Reminder | null {
      const row = reminderRow(id);
      if (!row || row.status === 'cancelled' || row.status === 'done') return null;
      const at = nowIso();
      if (nextDueAt) {
        db.run(`UPDATE planner_reminders SET status = 'scheduled', fired_at = ?, due_at = ? WHERE id = ?`, [at, nextDueAt, id]);
      } else {
        db.run(`UPDATE planner_reminders SET status = 'fired', fired_at = ? WHERE id = ?`, [at, id]);
      }
      changed('reminder', 'updated', [id]);
      return getReminder(id);
    },

    getReminder,

    listReminders(filter: { status?: Reminder['status'][]; from?: string; to?: string } = {}): Reminder[] {
      const statuses = filter.status?.length ? filter.status : (['scheduled', 'fired'] as Reminder['status'][]);
      const conditions = [`status IN (${statuses.map(() => '?').join(', ')})`];
      const params: SqlValue[] = [...statuses];
      if (filter.from) {
        conditions.push('due_at >= ?');
        params.push(new Date(filter.from).toISOString());
      }
      if (filter.to) {
        conditions.push('due_at <= ?');
        params.push(new Date(filter.to).toISOString());
      }
      return db
        .all<ReminderRow>(`SELECT * FROM planner_reminders WHERE ${conditions.join(' AND ')} ORDER BY due_at`, params)
        .map(toReminder);
    },

    /** `stamps`: içe aktarılan kaydın asıl oluşturulma ve bitirilme anı (`import-api.ts`); `doneAt` verilirse kayıt bitmiş doğar. */
    createTodo(input: TodoInput, source: RecordSource, stamps: { createdAt?: IsoDateTime; doneAt?: IsoDateTime | null } = {}): Todo {
      const text = input.text.trim();
      if (!text) throw new PlannerError('Yapılacağın metni boş.');
      const id = newId();
      const sort = (db.get<{ n: number | null }>('SELECT MAX(sort) AS n FROM planner_todos')?.n ?? 0) + 1;
      const doneAt = stamps.doneAt ?? null;
      db.run(
        `INSERT INTO planner_todos (id, text, notes, done, due_day, priority, source, sort, created_at, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, text, input.notes?.trim() ?? '', doneAt ? 1 : 0, input.dueDay ?? null, input.priority ?? 'normal', source, sort, stamps.createdAt ?? nowIso(), doneAt],
      );
      changed('todo', 'created', [id]);
      return getTodo(id);
    },

    createTodos(inputs: TodoInput[], source: RecordSource): Todo[] {
      const created = db.transaction(() =>
        inputs.map((input) => {
          const text = input.text.trim();
          if (!text) throw new PlannerError('Listede metni boş bir madde var.');
          const id = newId();
          const sort = (db.get<{ n: number | null }>('SELECT MAX(sort) AS n FROM planner_todos')?.n ?? 0) + 1;
          db.run(
            `INSERT INTO planner_todos (id, text, notes, done, due_day, priority, source, sort, created_at)
             VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
            [id, text, input.notes?.trim() ?? '', input.dueDay ?? null, input.priority ?? 'normal', source, sort, nowIso()],
          );
          return id;
        }),
      );
      changed('todo', 'created', created);
      return created.map(getTodo);
    },

    updateTodo(id: Id, patch: Partial<TodoInput> & { done?: boolean }): Todo {
      const current = getTodo(id);
      const done = patch.done ?? current.done;
      db.run(
        `UPDATE planner_todos SET text = ?, notes = ?, due_day = ?, priority = ?, done = ?, done_at = ? WHERE id = ?`,
        [
          patch.text?.trim() || current.text,
          patch.notes ?? current.notes,
          patch.dueDay === undefined ? current.dueDay : patch.dueDay,
          patch.priority ?? current.priority,
          done ? 1 : 0,
          done ? (current.doneAt ?? nowIso()) : null,
          id,
        ],
      );
      changed('todo', 'updated', [id]);
      return getTodo(id);
    },

    deleteTodo(id: Id): void {
      getTodo(id);
      db.run('DELETE FROM planner_todos WHERE id = ?', [id]);
      changed('todo', 'deleted', [id]);
    },

    reorderTodos(ids: Id[]): void {
      db.transaction(() => ids.forEach((id, index) => db.run('UPDATE planner_todos SET sort = ? WHERE id = ?', [index + 1, id])));
      changed('todo', 'updated', ids);
    },

    getTodo,

    listTodos(includeDone = false): Todo[] {
      return db
        .all<TodoRow>(
          `SELECT * FROM planner_todos ${includeDone ? '' : 'WHERE done = 0'} ORDER BY done, sort`,
        )
        .map(toTodo);
    },
  };
}

export type PlannerRepo = ReturnType<typeof createPlannerRepo>;
