// v1 içe aktarıcısı: önizleme (yalnız sayılar) → kullanıcı onayı → tek işlemde aktarım → iz tablosu → geri alma.
// Kayıtlar başka modüllerin servislerine `ImportSink` üzerinden yazılır; bu dosya onların tablolarını bilmez.
import {
  newId,
  nowIso,
  t,
  UserError,
  type Bus,
  type Id,
  type IsoDateTime,
  type Logger,
  type MemorySaveInput,
  type Migration,
  type ReminderInput,
  type ScopedDb,
  type TodoInput,
} from '@fuber/shared';
import { mapIssue, mapMemory, mapPastReminderNote, mapReminder, mapTodo, v1Stamps, type Mapped } from './mapping';
import {
  countRows,
  inspectSchema,
  openSnapshot,
  readRows,
  statV1,
  UPCOMING_REMINDER_SQL,
  V1_TABLES,
  V1ReadError,
  type V1ReminderRow,
} from './v1-source';
import type {
  ImportV1Counts,
  ImportV1Options,
  ImportV1Phase,
  ImportV1Preview,
  ImportV1Result,
  ImportV1RunSummary,
  ImportV1Skipped,
  ImportV1Status,
  ImportV1UndoResult,
  V1Table,
  V1TableStatus,
} from './types';

export const IMPORT_V1_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'v1 aktarım izi',
    up: `CREATE TABLE import_v1_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      source_dir TEXT NOT NULL,
      options TEXT NOT NULL,
      result TEXT NOT NULL,
      undone_at TEXT
    );
    CREATE TABLE import_v1_items (
      v1_table TEXT NOT NULL,
      v1_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (v1_table, v1_id)
    );
    CREATE INDEX import_v1_items_hash ON import_v1_items (v1_table, content_hash);
    CREATE INDEX import_v1_items_run ON import_v1_items (run_id);`,
  },
];

export type TargetType = 'memory' | 'reminder' | 'todo';

/**
 * Hedef servisler. Her yöntem v2'de YENİ oluşturduğu kaydın kimliğini döner; hedef servis kendi kopya korumasıyla
 * var olan bir kaydı döndürdüyse `null` (o kayıt bu aktarımın değildir, geri almada silinmemeli).
 * Hedefin geçersiz girdi için fırlattığı hata `isRejection` ile tanınır: o satır atlanır, aktarım sürer.
 */
/** Kaydın kaynaktaki asıl zaman damgaları (aktarılan kayıt "bugün oluşturulmuş" görünmesin). */
export interface ImportStamps {
  createdAt?: IsoDateTime;
  /** Yalnız bitmiş yapılacakta. */
  doneAt?: IsoDateTime;
}

export interface ImportSink {
  /** Hatırlatıcı ve yapılacak tabloları hazır mı (Planlar modülü en az bir kez yüklendi mi). */
  plannerReady(): boolean;
  /**
   * Hedef servislerin tablolarını aktarım işleminden ÖNCE kurdurur. Yoksa ilk yazımda servisin kendi göçü bizim
   * işlemimizin içinde koşar; işlem geri alınınca tablolar da gider ama servis onları kurulmuş sanmaya devam eder.
   */
  prepare(): void;
  saveMemory(input: MemorySaveInput): Id | null;
  /** `null`: hedef var olan bir kaydı döndürdü (kopya koruması); o kayıt aktarımın değildir. */
  createReminder(input: ReminderInput, stamps?: ImportStamps): Id | null;
  createTodo(input: TodoInput, done: boolean, stamps?: ImportStamps): Id | null;
  /** Kaldırıldıysa `true`; kayıt zaten yoksa `false`. */
  remove(type: TargetType, id: Id): boolean;
  isRejection(error: unknown): boolean;
}

export interface ImporterDeps {
  db: ScopedDb;
  sink: ImportSink;
  bus: Bus;
  log: Logger;
  /** v1 veri klasörü (`%APPDATA%\Fuber AI`); yoksa `null`. */
  v1Dir(): string | null;
  /** Anlık kopyanın açılacağı, bize ait geçici klasör. */
  tempDir: string;
  now?: () => Date;
}

interface Planned {
  table: V1Table;
  v1Id: number;
  hash: string;
  type: TargetType;
  counter: keyof ImportV1Counts;
  write(): Id | null;
}

const zeroCounts = (): ImportV1Counts => ({ memories: 0, reminders: 0, todos: 0, issueNotes: 0, pastReminderNotes: 0 });
const zeroSkipped = (): ImportV1Skipped => ({ private: 0, secrets: 0, duplicates: 0, invalid: 0, notSelected: 0 });
const sum = (counts: ImportV1Counts) => Object.values(counts).reduce((a, b) => a + b, 0);

export function tableMessage(status: V1TableStatus): string {
  const table = t(`importV1.table.${status.table}`);
  return status.state === 'missing'
    ? t('importV1.table.missing', { table })
    : t('importV1.table.incompatible', { table, columns: status.missingColumns.join(', ') });
}

export function createV1Importer(deps: ImporterDeps) {
  const { db, sink } = deps;
  const now = deps.now ?? (() => new Date());
  let busy = false;

  const progress = (phase: ImportV1Phase, done = 0, total = 0) => deps.bus.emit('import-v1.progress', { phase, done, total });

  const ledgerHas = (table: V1Table, v1Id: number, hash: string): boolean =>
    db.get('SELECT 1 FROM import_v1_items WHERE v1_table = ? AND (v1_id = ? OR content_hash = ?) LIMIT 1', [table, v1Id, hash]) !== undefined;

  const alreadyImported = (): Record<V1Table, number> => {
    const rows = db.all<{ v1_table: string; n: number }>('SELECT v1_table, COUNT(*) AS n FROM import_v1_items GROUP BY v1_table');
    return Object.fromEntries(V1_TABLES.map((table) => [table, rows.find((row) => row.v1_table === table)?.n ?? 0])) as Record<V1Table, number>;
  };

  /** Geri alınabilir kaydı olan en yeni koşu. Hiçbir şey eklemeyen (kopyasız) koşu öncekinin geri almasını gizlemesin. */
  const lastRun = (): ImportV1RunSummary | null => {
    const row = db.get<{ id: string; started_at: string; finished_at: string; result: string }>(
      `SELECT id, started_at, finished_at, result FROM import_v1_runs r WHERE undone_at IS NULL
         AND EXISTS (SELECT 1 FROM import_v1_items i WHERE i.run_id = r.id) ORDER BY finished_at DESC, rowid DESC LIMIT 1`,
    );
    if (!row) return null;
    const result = JSON.parse(row.result) as ImportV1Result;
    const undoable = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM import_v1_items WHERE run_id = ?', [row.id])?.n ?? 0;
    return { id: row.id, startedAt: row.started_at, finishedAt: row.finished_at, imported: result.imported, skipped: result.skipped, undoable };
  };

  const requireDir = (): string => {
    const dir = deps.v1Dir();
    if (!dir || !statV1(dir).found) throw new UserError(t('importV1.error.notFound'));
    return dir;
  };

  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy) throw new UserError(t('importV1.error.busy'));
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  };

  const snapshot = async (dir: string) => {
    try {
      return await openSnapshot(dir, deps.tempDir);
    } catch (error) {
      if (error instanceof V1ReadError) throw new UserError(t('importV1.error.read', { reason: error.message }));
      throw error;
    }
  };

  return {
    status(): ImportV1Status {
      const dir = deps.v1Dir();
      const stat = statV1(dir);
      return { found: stat.found, dir: stat.found ? dir : null, bytes: stat.bytes, modifiedAt: stat.modifiedAt, lastRun: lastRun(), plannerReady: sink.plannerReady() };
    },

    /** Yalnız şema ve `COUNT(*)`: hiçbir satırın içeriği okunmaz, hiçbir şey yazılmaz. */
    preview(): Promise<ImportV1Preview> {
      return exclusive(async () => {
        const dir = requireDir();
        const copy = await snapshot(dir);
        try {
          const schema = inspectSchema(copy.db);
          const counts = countRows(copy.db, schema.tables, now());
          return { dir, schemaVersion: schema.schemaVersion, tables: schema.tables, ...counts, alreadyImported: alreadyImported(), plannerReady: sink.plannerReady() };
        } finally {
          copy.close();
        }
      });
    },

    run(options: ImportV1Options): Promise<ImportV1Result> {
      return exclusive(async () => {
        const dir = requireDir();
        const startedAt = nowIso();
        const at = now();
        const imported = zeroCounts();
        const skipped = zeroSkipped();
        const tableErrors: ImportV1Result['tableErrors'] = [];
        const plannerReady = sink.plannerReady();

        progress('copying');
        const copy = await snapshot(dir);
        progress('reading');
        const planned: Planned[] = [];
        try {
          const { tables } = inspectSchema(copy.db);
          const status = <T extends V1Table>(table: T) => tables.find((entry) => entry.table === table)! as V1TableStatus & { table: T };
          const wanted: Record<V1Table, boolean> = {
            hafizalar: options.memories,
            hatirlaticilar: (options.reminders && plannerReady) || options.pastRemindersAsNotes,
            gorevler: options.todos && plannerReady,
            meseleler: options.issues,
          };
          for (const entry of tables) if (wanted[entry.table] && entry.state !== 'ok') tableErrors.push({ table: entry.table, message: tableMessage(entry) });
          if (!plannerReady && (options.reminders || options.todos)) {
            tableErrors.push({ table: options.reminders ? 'hatirlaticilar' : 'gorevler', message: t('importV1.type.plannerMissing') });
          }

          const seen = new Set<string>();
          const consider = (
            table: V1Table,
            v1Id: number,
            isPrivate: boolean,
            mapped: Mapped<unknown>,
            make: (hash: string) => Omit<Planned, 'table' | 'v1Id' | 'hash'>,
          ) => {
            if (isPrivate && !options.includePrivate) return void skipped.private++;
            if (!mapped.ok) return void (mapped.reason === 'secret' ? skipped.secrets++ : skipped.invalid++);
            const key = `${table}:${mapped.hash}`;
            if (seen.has(key) || ledgerHas(table, v1Id, mapped.hash)) return void skipped.duplicates++;
            seen.add(key);
            planned.push({ table, v1Id, hash: mapped.hash, ...make(mapped.hash) });
          };

          if (wanted.hafizalar) {
            for (const row of readRows(copy.db, status('hafizalar'))) {
              if (row.silindi !== 0) {
                skipped.notSelected++;
                continue;
              }
              const mapped = mapMemory(row);
              consider('hafizalar', row.id, row.gizli === 1, mapped, () => ({
                type: 'memory',
                counter: 'memories',
                write: () => (mapped.ok ? sink.saveMemory(mapped.value) : null),
              }));
            }
          }

          if (wanted.meseleler) {
            for (const row of readRows(copy.db, status('meseleler'))) {
              if (row.durum !== 'acik') {
                skipped.notSelected++;
                continue;
              }
              const mapped = mapIssue(row);
              consider('meseleler', row.id, row.gizli === 1, mapped, () => ({
                type: 'memory',
                counter: 'issueNotes',
                write: () => (mapped.ok ? sink.saveMemory(mapped.value) : null),
              }));
            }
          }

          if (wanted.hatirlaticilar) {
            const upcoming = new Set(
              status('hatirlaticilar').state === 'ok'
                ? copy.db
                    .prepare(`SELECT id FROM hatirlaticilar WHERE ${UPCOMING_REMINDER_SQL}`)
                    .all(at.toISOString())
                    .map((row) => Number((row as { id: number }).id))
                : [],
            );
            for (const row of readRows(copy.db, status('hatirlaticilar')) as V1ReminderRow[]) {
              if (upcoming.has(row.id)) {
                if (!(options.reminders && plannerReady)) {
                  skipped.notSelected++;
                  continue;
                }
                const mapped = mapReminder(row, at);
                consider('hatirlaticilar', row.id, row.gizli === 1, mapped, () => ({
                  type: 'reminder',
                  counter: 'reminders',
                  write: () => (mapped.ok ? sink.createReminder(mapped.value, v1Stamps(row)) : null),
                }));
              } else if (options.pastRemindersAsNotes) {
                const mapped = mapPastReminderNote(row);
                consider('hatirlaticilar', row.id, row.gizli === 1, mapped, () => ({
                  type: 'memory',
                  counter: 'pastReminderNotes',
                  write: () => (mapped.ok ? sink.saveMemory(mapped.value) : null),
                }));
              } else {
                skipped.notSelected++;
              }
            }
          }

          if (wanted.gorevler) {
            for (const row of readRows(copy.db, status('gorevler'))) {
              const state = row.durum;
              if (state !== 'acik' && !(state === 'tamam' && options.doneTodos)) {
                skipped.notSelected++;
                continue;
              }
              const mapped = mapTodo(row);
              consider('gorevler', row.id, row.gizli === 1, mapped, () => ({
                type: 'todo',
                counter: 'todos',
                write: () => (mapped.ok ? sink.createTodo(mapped.value.input, mapped.value.done, v1Stamps(row)) : null),
              }));
            }
          }
        } finally {
          copy.close();
        }

        // Tek işlem: araya giren beklenmedik hata (disk, şema) bütün aktarımı geri alır. Hedefin reddettiği tek
        // satır (geçersiz zaman gibi) kendi kayıt noktasında geri alınır ve atlanır; ötekiler sürer.
        progress('writing', 0, planned.length);
        sink.prepare();
        const runId = newId();
        let result: ImportV1Result;
        try {
          result = db.transaction(() => {
            for (const item of planned) {
              let targetId: Id | null;
              try {
                targetId = db.transaction(() => item.write());
              } catch (error) {
                if (!sink.isRejection(error)) throw error;
                skipped.invalid++;
                continue;
              }
              if (!targetId) {
                skipped.duplicates++;
                continue;
              }
              db.run(
                `INSERT INTO import_v1_items (v1_table, v1_id, content_hash, target_type, target_id, run_id, imported_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [item.table, item.v1Id, item.hash, item.type, targetId, runId, nowIso()],
              );
              imported[item.counter]++;
            }
            const finished: ImportV1Result = { runId, imported, skipped, tableErrors, startedAt, finishedAt: nowIso() };
            db.run(
              'INSERT INTO import_v1_runs (id, started_at, finished_at, source_dir, options, result) VALUES (?, ?, ?, ?, ?, ?)',
              [runId, startedAt, finished.finishedAt, dir, JSON.stringify(options), JSON.stringify(finished)],
            );
            return finished;
          });
        } catch (error) {
          deps.log.error('v1 aktarımı geri alındı', error);
          const reason = error instanceof Error ? error.message : String(error);
          throw new UserError(t('importV1.error.rolledBack', { reason }));
        } finally {
          progress('done', sum(imported), planned.length);
        }
        deps.log.info(`v1 aktarımı bitti: ${JSON.stringify(result.imported)} · atlanan ${JSON.stringify(result.skipped)}`);
        return result;
      });
    },

    /** Aktarımın eklediği bütün kayıtları tek işlemde kaldırır; iz silinir ki yeniden aktarılabilsin. */
    undo(runId: Id): ImportV1UndoResult {
      if (busy) throw new UserError(t('importV1.error.busy'));
      const run = db.get<{ id: string }>('SELECT id FROM import_v1_runs WHERE id = ? AND undone_at IS NULL', [runId]);
      if (!run) throw new UserError(t('importV1.error.noRun'));
      const items = db.all<{ target_type: TargetType; target_id: string }>(
        'SELECT target_type, target_id FROM import_v1_items WHERE run_id = ? ORDER BY rowid DESC',
        [runId],
      );
      let removed = 0;
      let alreadyGone = 0;
      db.transaction(() => {
        for (const item of items) {
          if (sink.remove(item.target_type, item.target_id)) removed++;
          else alreadyGone++;
        }
        db.run('DELETE FROM import_v1_items WHERE run_id = ?', [runId]);
        db.run('UPDATE import_v1_runs SET undone_at = ? WHERE id = ?', [nowIso(), runId]);
      });
      deps.log.info(`v1 aktarımı geri alındı: ${removed} kayıt kaldırıldı, ${alreadyGone} zaten yoktu`);
      return { runId, removed, alreadyGone };
    },

    lastRun,
  };
}

export type V1Importer = ReturnType<typeof createV1Importer>;
