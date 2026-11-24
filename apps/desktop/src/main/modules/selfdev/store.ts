// Çekirdek geliştirmenin kalıcı kaydı: koşular (geçmiş), koşu günlüğü ve durum (kurulu sürüm geçmişi, bekleyen güncelleme).
// Tablolar `selfdev_` önekiyle başlar (`ScopedDb`).
import { nowIso, type Migration, type ScopedDb } from '@fuber/shared';
import type { CheckResult, EventKind, RunStatus, SelfdevEvent, SelfdevRun, SelfdevState } from './types';

export const SELFDEV_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'koşular, günlük ve durum',
    up: `CREATE TABLE selfdev_runs (
      id TEXT PRIMARY KEY,
      request TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'chat',
      status TEXT NOT NULL,
      plan_summary TEXT,
      plan_text TEXT,
      plan_files TEXT NOT NULL DEFAULT '[]',
      plan_risk TEXT,
      branch TEXT,
      worktree TEXT,
      base_commit TEXT,
      head_commit TEXT,
      files TEXT NOT NULL DEFAULT '[]',
      risk_flags TEXT NOT NULL DEFAULT '[]',
      checks TEXT NOT NULL DEFAULT '[]',
      fix_rounds INTEGER NOT NULL DEFAULT 0,
      from_version TEXT NOT NULL,
      version TEXT,
      package_path TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX selfdev_runs_created ON selfdev_runs (created_at);
    CREATE TABLE selfdev_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX selfdev_events_run ON selfdev_events (run_id, id);
    CREATE TABLE selfdev_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`,
  },
];

interface RunRow {
  id: string;
  request: string;
  reason: string;
  origin: string;
  status: string;
  plan_summary: string | null;
  plan_text: string | null;
  plan_files: string;
  plan_risk: string | null;
  branch: string | null;
  worktree: string | null;
  base_commit: string | null;
  head_commit: string | null;
  files: string;
  risk_flags: string;
  checks: string;
  fix_rounds: number;
  from_version: string;
  version: string | null;
  package_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

const parseList = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

const toRun = (row: RunRow): SelfdevRun => ({
  id: row.id,
  request: row.request,
  reason: row.reason,
  origin: row.origin,
  status: row.status as RunStatus,
  planSummary: row.plan_summary,
  planText: row.plan_text,
  planFiles: parseList<string[]>(row.plan_files, []),
  planRisk: row.plan_risk,
  branch: row.branch,
  worktree: row.worktree,
  baseCommit: row.base_commit,
  headCommit: row.head_commit,
  files: parseList<string[]>(row.files, []),
  riskFlags: parseList<string[]>(row.risk_flags, []),
  checks: parseList<CheckResult[]>(row.checks, []),
  fixRounds: row.fix_rounds,
  fromVersion: row.from_version,
  version: row.version,
  packagePath: row.package_path,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  finishedAt: row.finished_at,
});

/** Koşu günlüğünde saklanan son satır sayısı (koşu başına) ve toplam üst sınır. */
export const EVENTS_PER_RUN = 400;
const EVENTS_TOTAL = 4000;
/** Saklanan koşu sayısı (eski bitmiş koşular silinir; kayıt kalır, yalnız çok eskiler gider). */
const RUNS_KEPT = 100;

export const EMPTY_STATE: SelfdevState = { installed: [], pending: null, healthFailed: null, lastDevNumber: 0 };

type Patch = Partial<Omit<SelfdevRun, 'id' | 'createdAt' | 'updatedAt'>>;

const COLUMNS: Record<keyof Patch, string> = {
  request: 'request',
  reason: 'reason',
  origin: 'origin',
  status: 'status',
  planSummary: 'plan_summary',
  planText: 'plan_text',
  planFiles: 'plan_files',
  planRisk: 'plan_risk',
  branch: 'branch',
  worktree: 'worktree',
  baseCommit: 'base_commit',
  headCommit: 'head_commit',
  files: 'files',
  riskFlags: 'risk_flags',
  checks: 'checks',
  fixRounds: 'fix_rounds',
  fromVersion: 'from_version',
  version: 'version',
  packagePath: 'package_path',
  error: 'error',
  finishedAt: 'finished_at',
};
const JSON_FIELDS: ReadonlySet<string> = new Set(['planFiles', 'files', 'riskFlags', 'checks']);

export function createSelfdevStore(db: ScopedDb) {
  return {
    insertRun(run: Omit<SelfdevRun, 'updatedAt'>): SelfdevRun {
      db.run(
        `INSERT INTO selfdev_runs (id, request, reason, origin, status, from_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [run.id, run.request, run.reason, run.origin, run.status, run.fromVersion, run.createdAt, run.createdAt],
      );
      return this.getRun(run.id)!;
    },

    getRun(id: string): SelfdevRun | null {
      const row = db.get<RunRow>('SELECT * FROM selfdev_runs WHERE id = ?', [id]);
      return row ? toRun(row) : null;
    },

    /** Yalnız verilen alanları günceller. */
    updateRun(id: string, patch: Patch): SelfdevRun | null {
      const sets: string[] = ['updated_at = ?'];
      const values: Array<string | number | null> = [nowIso()];
      for (const [key, value] of Object.entries(patch)) {
        const column = COLUMNS[key as keyof Patch];
        if (!column) continue;
        sets.push(`${column} = ?`);
        values.push(JSON_FIELDS.has(key) ? JSON.stringify(value ?? []) : ((value as string | number | null | undefined) ?? null));
      }
      values.push(id);
      db.run(`UPDATE selfdev_runs SET ${sets.join(', ')} WHERE id = ?`, values);
      return this.getRun(id);
    },

    listRuns(limit = 30): SelfdevRun[] {
      return db.all<RunRow>('SELECT * FROM selfdev_runs ORDER BY created_at DESC, rowid DESC LIMIT ?', [limit]).map(toRun);
    },

    /** Verilen durumlardaki koşular (yeniden eskiye). */
    runsWithStatus(statuses: RunStatus[]): SelfdevRun[] {
      if (statuses.length === 0) return [];
      const marks = statuses.map(() => '?').join(', ');
      return db.all<RunRow>(`SELECT * FROM selfdev_runs WHERE status IN (${marks}) ORDER BY created_at DESC`, statuses).map(toRun);
    },

    addEvent(runId: string, kind: EventKind, text: string): void {
      db.run('INSERT INTO selfdev_events (run_id, at, kind, text) VALUES (?, ?, ?, ?)', [runId, nowIso(), kind, text.slice(0, 2000)]);
      // Koşu başına son N satır.
      db.run('DELETE FROM selfdev_events WHERE run_id = ? AND id <= (SELECT id FROM selfdev_events WHERE run_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)', [runId, runId, EVENTS_PER_RUN]);
    },

    events(runId: string, limit = EVENTS_PER_RUN): SelfdevEvent[] {
      const rows = db.all<{ id: number; run_id: string; at: string; kind: string; text: string }>(
        'SELECT * FROM (SELECT * FROM selfdev_events WHERE run_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
        [runId, limit],
      );
      return rows.map((row) => ({ id: row.id, runId: row.run_id, at: row.at, kind: row.kind as EventKind, text: row.text }));
    },

    /** Eski koşuları ve günlüklerini temizler (bitmiş olanlar; çalışan/hazır koşuya dokunmaz). */
    prune(): void {
      db.run(
        `DELETE FROM selfdev_runs WHERE id IN (SELECT id FROM selfdev_runs WHERE status IN ('installed','failed','cancelled','rolled_back') ORDER BY created_at DESC LIMIT -1 OFFSET ?)`,
        [RUNS_KEPT],
      );
      db.run('DELETE FROM selfdev_events WHERE run_id NOT IN (SELECT id FROM selfdev_runs)');
      db.run('DELETE FROM selfdev_events WHERE id <= (SELECT COALESCE(MAX(id), 0) - ? FROM selfdev_events)', [EVENTS_TOTAL]);
    },

    state(): SelfdevState {
      const row = db.get<{ value: string }>("SELECT value FROM selfdev_state WHERE key = 'state'");
      if (!row) return { ...EMPTY_STATE, installed: [] };
      const parsed = parseList<Partial<SelfdevState>>(row.value, {});
      return {
        installed: Array.isArray(parsed.installed) ? parsed.installed : [],
        pending: parsed.pending ?? null,
        healthFailed: parsed.healthFailed ?? null,
        lastDevNumber: typeof parsed.lastDevNumber === 'number' ? parsed.lastDevNumber : 0,
      };
    },

    saveState(state: SelfdevState): void {
      db.run("INSERT INTO selfdev_state (key, value) VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(state)]);
    },

    /** Modülün bütün verisi (kullanıcı "verimi sil" derse). */
    clear(): void {
      db.run('DELETE FROM selfdev_events');
      db.run('DELETE FROM selfdev_runs');
      db.run('DELETE FROM selfdev_state');
    },
  };
}

export type SelfdevStore = ReturnType<typeof createSelfdevStore>;
