// İşlerin kalıcı kaydı. Gözcünün iç izi (imza, önceki metin, son sayı) burada durur ki uygulama kapanıp açılınca iş
// kaldığı yerden sürsün; arayüze yalnız `WatchJob` gider.
import type { Channel, Id, Migration, ScopedDb, SqlValue } from '@fuber/shared';
import type { WatchJob, WatchPlan, WatchReason, WatchStatus } from './types';

export const WATCH_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'gözcülü işler',
    up: `CREATE TABLE watch_jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_check_at TEXT,
      next_check_at TEXT,
      interval_sec INTEGER NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0,
      changes INTEGER NOT NULL DEFAULT 0,
      model_calls INTEGER NOT NULL DEFAULT 0,
      matches INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_change_at TEXT,
      finding TEXT,
      result TEXT,
      finished_at TEXT,
      session_id TEXT,
      channel TEXT,
      signature TEXT,
      baseline TEXT,
      last_value REAL,
      last_match INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX watch_jobs_status ON watch_jobs (status);`,
  },
];

interface Row {
  id: string;
  title: string;
  goal: string;
  plan: string;
  status: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
  last_check_at: string | null;
  next_check_at: string | null;
  interval_sec: number;
  checks: number;
  changes: number;
  model_calls: number;
  matches: number;
  errors: number;
  last_error: string | null;
  last_change_at: string | null;
  finding: string | null;
  result: string | null;
  finished_at: string | null;
  session_id: string | null;
  channel: string | null;
  signature: string | null;
  baseline: string | null;
  last_value: number | null;
  last_match: number;
}

/** İşin kaydı: arayüzün gördüğü + gözcünün iç izi. */
export interface JobRecord extends WatchJob {
  channel: Channel | null;
  signature: string | null;
  baseline: string | null;
  lastValue: number | null;
  lastMatch: boolean;
}

export type JobPatch = Partial<Omit<JobRecord, 'id' | 'createdAt' | 'plan' | 'title' | 'goal'>>;

const COLUMN: Record<keyof JobPatch, keyof Row> = {
  status: 'status',
  reason: 'reason',
  updatedAt: 'updated_at',
  lastCheckAt: 'last_check_at',
  nextCheckAt: 'next_check_at',
  intervalSec: 'interval_sec',
  checks: 'checks',
  changes: 'changes',
  modelCalls: 'model_calls',
  matches: 'matches',
  errors: 'errors',
  lastError: 'last_error',
  lastChangeAt: 'last_change_at',
  finding: 'finding',
  result: 'result',
  finishedAt: 'finished_at',
  sessionId: 'session_id',
  channel: 'channel',
  signature: 'signature',
  baseline: 'baseline',
  lastValue: 'last_value',
  lastMatch: 'last_match',
};

function toRecord(row: Row): JobRecord {
  return {
    id: row.id,
    title: row.title,
    goal: row.goal,
    plan: JSON.parse(row.plan) as WatchPlan,
    status: row.status as WatchStatus,
    reason: row.reason as WatchReason | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckAt: row.last_check_at,
    nextCheckAt: row.next_check_at,
    intervalSec: row.interval_sec,
    checks: row.checks,
    changes: row.changes,
    modelCalls: row.model_calls,
    matches: row.matches,
    errors: row.errors,
    lastError: row.last_error,
    lastChangeAt: row.last_change_at,
    finding: row.finding,
    result: row.result,
    finishedAt: row.finished_at,
    sessionId: row.session_id,
    channel: row.channel as Channel | null,
    signature: row.signature,
    baseline: row.baseline,
    lastValue: row.last_value,
    lastMatch: row.last_match === 1,
  };
}

/** Arayüze giden görünüm: iç iz alanları atılır. */
export function toJob(record: JobRecord): WatchJob {
  const { channel: _channel, signature: _signature, baseline: _baseline, lastValue: _value, lastMatch: _match, ...job } = record;
  return job;
}

export interface WatchRepo {
  insert(record: JobRecord): JobRecord;
  get(id: Id): JobRecord | null;
  update(id: Id, patch: JobPatch): JobRecord | null;
  list(filter?: { status?: WatchStatus[]; limit?: number }): JobRecord[];
  remove(id: Id): boolean;
  removeAll(): number;
}

export function createWatchRepo(db: ScopedDb): WatchRepo {
  const get = (id: Id) => {
    const row = db.get<Row>('SELECT * FROM watch_jobs WHERE id = ?', [id]);
    return row ? toRecord(row) : null;
  };
  return {
    insert(record) {
      db.run(
        `INSERT INTO watch_jobs (id, title, goal, plan, status, reason, created_at, updated_at, last_check_at, next_check_at, interval_sec, checks, changes,
          model_calls, matches, errors, last_error, last_change_at, finding, result, finished_at, session_id, channel, signature, baseline, last_value, last_match)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.title,
          record.goal,
          JSON.stringify(record.plan),
          record.status,
          record.reason,
          record.createdAt,
          record.updatedAt,
          record.lastCheckAt,
          record.nextCheckAt,
          record.intervalSec,
          record.checks,
          record.changes,
          record.modelCalls,
          record.matches,
          record.errors,
          record.lastError,
          record.lastChangeAt,
          record.finding,
          record.result,
          record.finishedAt,
          record.sessionId,
          record.channel,
          record.signature,
          record.baseline,
          record.lastValue,
          record.lastMatch ? 1 : 0,
        ],
      );
      return get(record.id)!;
    },
    get,
    update(id, patch) {
      const keys = Object.keys(patch) as Array<keyof JobPatch>;
      if (keys.length) {
        const values = keys.map((key): SqlValue => {
          const value = patch[key];
          if (typeof value === 'boolean') return value ? 1 : 0;
          return (value ?? null) as SqlValue;
        });
        db.run(`UPDATE watch_jobs SET ${keys.map((key) => `${COLUMN[key]} = ?`).join(', ')} WHERE id = ?`, [...values, id]);
      }
      return get(id);
    },
    list(filter = {}) {
      const where = filter.status?.length ? `WHERE status IN (${filter.status.map(() => '?').join(', ')})` : '';
      return db
        .all<Row>(`SELECT * FROM watch_jobs ${where} ORDER BY created_at DESC LIMIT ?`, [...(filter.status ?? []), filter.limit ?? 100])
        .map(toRecord);
    },
    remove: (id) => db.run('DELETE FROM watch_jobs WHERE id = ?', [id]).changes > 0,
    removeAll: () => db.run('DELETE FROM watch_jobs').changes,
  };
}
