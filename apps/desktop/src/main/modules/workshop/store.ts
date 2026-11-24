/**
 * Atölye'nin kalıcı durumu. Kod klasördedir (`skills/<id>/`); ONAY ve durum burada, klasörün dışında tutulur:
 * yetenek klasörüne yazabilen hiçbir şey (model, elle düzenleme) kendi onayını veremez. Onay içeriğin özetine bağlıdır.
 */
import { nowIso, type Id, type IsoDateTime, type JsonValue, type Migration, type ScopedDb, type SkillStatus } from '@fuber/shared';
import type { SkillState } from './lifecycle';

export const WORKSHOP_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'yetenek durumu ve yetenek depolaması',
    up: `CREATE TABLE workshop_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      build INTEGER NOT NULL DEFAULT 1,
      approved_hash TEXT,
      tested_hash TEXT,
      content_hash TEXT,
      wanted INTEGER NOT NULL DEFAULT 0,
      draft INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'manual',
      job_id TEXT,
      goal TEXT,
      last_error TEXT,
      selftest_log TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workshop_storage (
      skill_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, key)
    );`,
  },
  {
    id: 2,
    name: 'eklenti platformu: güncelleme, sürümler, ayarlar, iş durumu, takipte görülenler',
    up: `ALTER TABLE workshop_skills ADD COLUMN staged_hash TEXT;
    ALTER TABLE workshop_skills ADD COLUMN staged_note TEXT;
    CREATE TABLE workshop_versions (
      skill_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      hash TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, version)
    );
    CREATE TABLE workshop_settings (
      skill_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, key)
    );
    CREATE TABLE workshop_runs (
      skill_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      last_run_at TEXT,
      last_ok INTEGER,
      last_text TEXT,
      data TEXT,
      PRIMARY KEY (skill_id, kind, item_id)
    );
    CREATE TABLE workshop_seen (
      skill_id TEXT NOT NULL,
      watch_id TEXT NOT NULL,
      key TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, watch_id, key)
    );`,
  },
];

export interface SkillRecord extends SkillState {
  id: string;
  name: string;
  description: string;
  /** Yapım sayacı (`SkillInfo.version`). */
  build: number;
  /** Son doğrulama/öz-sınama denemesinin içerik özeti (geçsin ya da kalsın). */
  contentHash: string | null;
  /** Yapımı süren ya da yarıda kalan taslak: dosyaları `skills/.drafts/<id>/` altındadır. */
  draft: boolean;
  createdBy: 'workshop' | 'manual';
  jobId: Id | null;
  goal: string | null;
  lastError: string | null;
  selftestLog: string;
  /** Onay bekleyen güncellemenin içerik özeti (`.staged/<id>/`); yoksa `null`. Sürümü `build + 1` olur. */
  stagedHash: string | null;
  /** Güncellemeyi doğuran istek ("şunu da ekle…"). */
  stagedNote: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Saklanan bir sürüm: içerik `.versions/<id>/<sürüm>/` altında, özeti burada (klasöre yazabilen özeti değiştiremez). */
export interface VersionRecord {
  skillId: string;
  version: number;
  hash: string;
  note: string | null;
  createdAt: IsoDateTime;
}

/** Kendiliğinden çalışan katkının (iş, takip, kart) son koşusu. */
export interface RunRecord {
  skillId: string;
  kind: 'job' | 'watch' | 'card';
  itemId: string;
  lastRunAt: IsoDateTime | null;
  lastOk: boolean | null;
  lastText: string | null;
  /** Kartın son verisi (JSON) gibi katkıya özel durum. */
  data: JsonValue;
}

interface Row {
  id: string;
  name: string;
  description: string;
  status: string;
  build: number;
  approved_hash: string | null;
  tested_hash: string | null;
  content_hash: string | null;
  wanted: number;
  draft: number;
  created_by: string;
  job_id: string | null;
  goal: string | null;
  last_error: string | null;
  selftest_log: string;
  staged_hash: string | null;
  staged_note: string | null;
  created_at: string;
  updated_at: string;
}

const toRecord = (row: Row): SkillRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status as SkillStatus,
  build: row.build,
  approvedHash: row.approved_hash,
  testedHash: row.tested_hash,
  contentHash: row.content_hash,
  wanted: row.wanted === 1,
  draft: row.draft === 1,
  createdBy: row.created_by === 'workshop' ? 'workshop' : 'manual',
  jobId: row.job_id,
  goal: row.goal,
  lastError: row.last_error,
  selftestLog: row.selftest_log,
  stagedHash: row.staged_hash ?? null,
  stagedNote: row.staged_note ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const STORAGE_LIMITS = { maxKeys: 200, maxKeyChars: 128, maxValueChars: 64_000 } as const;
const MAX_LOG_CHARS = 20_000;

export interface WorkshopStore {
  list(): SkillRecord[];
  get(id: string): SkillRecord | null;
  /** Kaydı yazar (yoksa ekler). `updatedAt` şimdiye çekilir. */
  save(record: SkillRecord): SkillRecord;
  delete(id: string): void;
  storage: {
    get(skillId: string, key: string): { found: boolean; value: JsonValue };
    set(skillId: string, key: string, value: JsonValue): void;
    delete(skillId: string, key: string): boolean;
    keys(skillId: string): string[];
  };
  /** Eklenti ayarlarının kullanıcının değiştirdiği değerleri (varsayılanlar manifestte). */
  settings: {
    get(skillId: string, key: string): { found: boolean; value: JsonValue };
    set(skillId: string, key: string, value: JsonValue): void;
    /** Manifestte artık olmayan anahtarları siler. */
    prune(skillId: string, keep: string[]): void;
  };
  versions: {
    list(skillId: string): VersionRecord[];
    get(skillId: string, version: number): VersionRecord | null;
    save(record: VersionRecord): void;
    delete(skillId: string, version: number): void;
  };
  runs: {
    list(skillId?: string): RunRecord[];
    get(skillId: string, kind: RunRecord['kind'], itemId: string): RunRecord | null;
    save(record: RunRecord): void;
    /** Manifestte artık olmayan katkıların durumunu siler. */
    prune(skillId: string, keep: Array<{ kind: RunRecord['kind']; itemId: string }>): void;
  };
  seen: {
    has(skillId: string, watchId: string, key: string): boolean;
    count(skillId: string, watchId: string): number;
    add(skillId: string, watchId: string, keys: string[]): void;
  };
}

/** Bir takibin sakladığı en çok "görüldü" anahtarı; fazlası en eskiden silinir. */
const MAX_SEEN_KEYS = 500;
const MAX_RUN_TEXT = 600;

export function createWorkshopStore(db: ScopedDb): WorkshopStore {
  return {
    list: () => db.all<Row>('SELECT * FROM workshop_skills ORDER BY created_at DESC, id').map(toRecord),

    get(id) {
      const row = db.get<Row>('SELECT * FROM workshop_skills WHERE id = ?', [id]);
      return row ? toRecord(row) : null;
    },

    save(record) {
      const next: SkillRecord = { ...record, updatedAt: nowIso(), selftestLog: record.selftestLog.slice(-MAX_LOG_CHARS) };
      db.run(
        `INSERT INTO workshop_skills
           (id, name, description, status, build, approved_hash, tested_hash, content_hash, wanted, draft, created_by,
            job_id, goal, last_error, selftest_log, staged_hash, staged_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, description = excluded.description, status = excluded.status, build = excluded.build,
           approved_hash = excluded.approved_hash, tested_hash = excluded.tested_hash, content_hash = excluded.content_hash,
           wanted = excluded.wanted, draft = excluded.draft, created_by = excluded.created_by, job_id = excluded.job_id,
           goal = excluded.goal, last_error = excluded.last_error, selftest_log = excluded.selftest_log,
           staged_hash = excluded.staged_hash, staged_note = excluded.staged_note,
           updated_at = excluded.updated_at`,
        [
          next.id,
          next.name,
          next.description,
          next.status,
          next.build,
          next.approvedHash,
          next.testedHash,
          next.contentHash,
          next.wanted ? 1 : 0,
          next.draft ? 1 : 0,
          next.createdBy,
          next.jobId,
          next.goal,
          next.lastError,
          next.selftestLog,
          next.stagedHash,
          next.stagedNote,
          next.createdAt,
          next.updatedAt,
        ],
      );
      return next;
    },

    delete(id) {
      db.transaction(() => {
        db.run('DELETE FROM workshop_skills WHERE id = ?', [id]);
        db.run('DELETE FROM workshop_storage WHERE skill_id = ?', [id]);
        db.run('DELETE FROM workshop_settings WHERE skill_id = ?', [id]);
        db.run('DELETE FROM workshop_versions WHERE skill_id = ?', [id]);
        db.run('DELETE FROM workshop_runs WHERE skill_id = ?', [id]);
        db.run('DELETE FROM workshop_seen WHERE skill_id = ?', [id]);
      });
    },

    settings: {
      get(skillId, key) {
        const row = db.get<{ value: string }>('SELECT value FROM workshop_settings WHERE skill_id = ? AND key = ?', [skillId, key]);
        if (!row) return { found: false, value: null };
        try {
          return { found: true, value: JSON.parse(row.value) as JsonValue };
        } catch {
          return { found: false, value: null };
        }
      },
      set(skillId, key, value) {
        db.run(
          `INSERT INTO workshop_settings (skill_id, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(skill_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [skillId, key, JSON.stringify(value ?? null), nowIso()],
        );
      },
      prune(skillId, keep) {
        for (const row of db.all<{ key: string }>('SELECT key FROM workshop_settings WHERE skill_id = ?', [skillId])) {
          if (!keep.includes(row.key)) db.run('DELETE FROM workshop_settings WHERE skill_id = ? AND key = ?', [skillId, row.key]);
        }
      },
    },

    versions: {
      list: (skillId) =>
        db
          .all<{ skill_id: string; version: number; hash: string; note: string | null; created_at: string }>(
            'SELECT * FROM workshop_versions WHERE skill_id = ? ORDER BY version DESC',
            [skillId],
          )
          .map((row) => ({ skillId: row.skill_id, version: row.version, hash: row.hash, note: row.note, createdAt: row.created_at })),
      get(skillId, version) {
        const row = db.get<{ skill_id: string; version: number; hash: string; note: string | null; created_at: string }>(
          'SELECT * FROM workshop_versions WHERE skill_id = ? AND version = ?',
          [skillId, version],
        );
        return row ? { skillId: row.skill_id, version: row.version, hash: row.hash, note: row.note, createdAt: row.created_at } : null;
      },
      save(record) {
        db.run(
          `INSERT INTO workshop_versions (skill_id, version, hash, note, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(skill_id, version) DO UPDATE SET hash = excluded.hash, note = excluded.note`,
          [record.skillId, record.version, record.hash, record.note, record.createdAt],
        );
      },
      delete: (skillId, version) => void db.run('DELETE FROM workshop_versions WHERE skill_id = ? AND version = ?', [skillId, version]),
    },

    runs: (() => {
      interface RunRow {
        skill_id: string;
        kind: string;
        item_id: string;
        last_run_at: string | null;
        last_ok: number | null;
        last_text: string | null;
        data: string | null;
      }
      const toRun = (row: RunRow): RunRecord => {
        let data: JsonValue = null;
        try {
          data = row.data ? (JSON.parse(row.data) as JsonValue) : null;
        } catch {
          data = null;
        }
        return {
          skillId: row.skill_id,
          kind: row.kind as RunRecord['kind'],
          itemId: row.item_id,
          lastRunAt: row.last_run_at,
          lastOk: row.last_ok === null ? null : row.last_ok === 1,
          lastText: row.last_text,
          data,
        };
      };
      return {
        list: (skillId?: string) =>
          (skillId
            ? db.all<RunRow>('SELECT * FROM workshop_runs WHERE skill_id = ? ORDER BY kind, item_id', [skillId])
            : db.all<RunRow>('SELECT * FROM workshop_runs ORDER BY skill_id, kind, item_id')
          ).map(toRun),
        get(skillId: string, kind: RunRecord['kind'], itemId: string) {
          const row = db.get<RunRow>('SELECT * FROM workshop_runs WHERE skill_id = ? AND kind = ? AND item_id = ?', [skillId, kind, itemId]);
          return row ? toRun(row) : null;
        },
        save(record: RunRecord) {
          db.run(
            `INSERT INTO workshop_runs (skill_id, kind, item_id, last_run_at, last_ok, last_text, data) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(skill_id, kind, item_id) DO UPDATE SET
               last_run_at = excluded.last_run_at, last_ok = excluded.last_ok, last_text = excluded.last_text, data = excluded.data`,
            [
              record.skillId,
              record.kind,
              record.itemId,
              record.lastRunAt,
              record.lastOk === null ? null : record.lastOk ? 1 : 0,
              record.lastText === null ? null : record.lastText.slice(0, MAX_RUN_TEXT),
              JSON.stringify(record.data ?? null),
            ],
          );
        },
        prune(skillId: string, keep: Array<{ kind: RunRecord['kind']; itemId: string }>) {
          for (const row of db.all<RunRow>('SELECT * FROM workshop_runs WHERE skill_id = ?', [skillId])) {
            if (!keep.some((item) => item.kind === row.kind && item.itemId === row.item_id)) {
              db.run('DELETE FROM workshop_runs WHERE skill_id = ? AND kind = ? AND item_id = ?', [skillId, row.kind, row.item_id]);
              if (row.kind === 'watch') db.run('DELETE FROM workshop_seen WHERE skill_id = ? AND watch_id = ?', [skillId, row.item_id]);
            }
          }
        },
      };
    })(),

    seen: {
      has: (skillId, watchId, key) =>
        db.get('SELECT 1 AS x FROM workshop_seen WHERE skill_id = ? AND watch_id = ? AND key = ?', [skillId, watchId, key]) !== undefined,
      count: (skillId, watchId) =>
        db.get<{ n: number }>('SELECT COUNT(*) AS n FROM workshop_seen WHERE skill_id = ? AND watch_id = ?', [skillId, watchId])?.n ?? 0,
      add(skillId, watchId, keys) {
        const now = nowIso();
        db.transaction(() => {
          for (const key of keys) {
            db.run('INSERT OR IGNORE INTO workshop_seen (skill_id, watch_id, key, seen_at) VALUES (?, ?, ?, ?)', [skillId, watchId, key.slice(0, 200), now]);
          }
          db.run(
            `DELETE FROM workshop_seen WHERE skill_id = ? AND watch_id = ? AND key NOT IN (
               SELECT key FROM workshop_seen WHERE skill_id = ? AND watch_id = ? ORDER BY seen_at DESC, key LIMIT ?
             )`,
            [skillId, watchId, skillId, watchId, MAX_SEEN_KEYS],
          );
        });
      },
    },

    storage: {
      get(skillId, key) {
        const row = db.get<{ value: string }>('SELECT value FROM workshop_storage WHERE skill_id = ? AND key = ?', [skillId, key]);
        if (!row) return { found: false, value: null };
        try {
          return { found: true, value: JSON.parse(row.value) as JsonValue };
        } catch {
          return { found: false, value: null };
        }
      },
      set(skillId, key, value) {
        if (key.length === 0 || key.length > STORAGE_LIMITS.maxKeyChars) throw new Error('Depolama anahtarı 1–128 karakter olmalı.');
        const text = JSON.stringify(value ?? null);
        if (text.length > STORAGE_LIMITS.maxValueChars) throw new Error('Depolanan değer çok büyük (en çok 64 KB).');
        const exists = db.get('SELECT 1 AS x FROM workshop_storage WHERE skill_id = ? AND key = ?', [skillId, key]);
        if (!exists) {
          const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM workshop_storage WHERE skill_id = ?', [skillId])?.n ?? 0;
          if (count >= STORAGE_LIMITS.maxKeys) throw new Error(`Depolama dolu (en çok ${STORAGE_LIMITS.maxKeys} anahtar).`);
        }
        db.run(
          `INSERT INTO workshop_storage (skill_id, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(skill_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [skillId, key, text, nowIso()],
        );
      },
      delete: (skillId, key) => db.run('DELETE FROM workshop_storage WHERE skill_id = ? AND key = ?', [skillId, key]).changes > 0,
      keys: (skillId) =>
        db.all<{ key: string }>('SELECT key FROM workshop_storage WHERE skill_id = ? ORDER BY key', [skillId]).map((row) => row.key),
    },
  };
}
