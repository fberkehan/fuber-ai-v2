/**
 * Depo: tek SQLite dosyası (`node:sqlite`, WAL), numaralı göçler, kapsam önekli tablolar, anahtar-değer
 * deposu ve FTS5 yardımcıları. Dosya açılamayacak kadar bozuksa yedeklenir ve temiz bir dosya açılır.
 */

import fs from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import {
  foldForSearch,
  FTS_TOKENIZER,
  ftsQuery,
  nowIso,
  type IsoDateTime,
  type JsonValue,
  type KeyValueStore,
  type Logger,
  type Migration,
  type ScopedDb,
  type ServiceDeps,
  type SqlParams,
  type SqlValue,
  type Store,
} from '@fuber/shared';

/** Kapsam adından tablo öneki: `voice-control` → `voice_control_`. */
export function tablePrefix(scope: string): string {
  return `${scope.replace(/[^a-zA-Z0-9]+/g, '_')}_`;
}

/** Bozuk veritabanının yedeklenip temiz dosyayla açıldığı durumun kaydı. */
export interface StoreRecovery {
  /** Bozuk dosyanın taşındığı yer (`fuber.db.bozuk-<zaman>`). */
  backupPath: string;
  /** SQLite'ın verdiği neden. */
  reason: string;
  at: IsoDateTime;
}

// Depo olay yoluna bağlı değildir (tabloda `bus` yok); kurtarmayı bootstrap bu olayla duyurur.
// Sözleşmede karşılığı olmadığı için olay burada tip genişletmesiyle tanımlanır ve ana süreçte kalır.
declare module '@fuber/shared' {
  interface BusEvents {
    'store.recovered': StoreRecovery;
  }
}

const recoveries = new WeakMap<Store, StoreRecovery>();

/** Bu depo açılırken bozuk dosya yedeklendiyse ayrıntısı; yoksa `null`. Bootstrap bunu olay yoluna duyurur. */
export function storeRecovery(store: Store): StoreRecovery | null {
  return recoveries.get(store) ?? null;
}

// SQLITE_CORRUPT ve SQLITE_NOTADB. Kilit ya da izin hatasında dosya sağlamdır; ona dokunulmaz.
const CORRUPT_CODES = new Set([11, 26]);

class IntegrityError extends Error {}

function isCorruption(error: unknown): boolean {
  if (error instanceof IntegrityError) return true;
  const code = (error as { errcode?: unknown } | null)?.errcode;
  if (typeof code === 'number') return CORRUPT_CODES.has(code & 0xff);
  return /not a database|malformed|corrupt/i.test(String((error as Error | null)?.message ?? ''));
}

function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    const verdict = db
      .prepare('PRAGMA quick_check')
      .all()
      .map((row) => String(Object.values(row)[0]))
      .join('; ');
    if (verdict !== 'ok') throw new IntegrityError(`bütünlük denetimi: ${verdict.slice(0, 300)}`);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // zaten açılamadı
    }
    throw error;
  }
}

function quarantine(file: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const backup = `${file}.bozuk-${stamp}`;
  fs.renameSync(file, backup);
  // WAL ve paylaşım dosyaları bozuk dosyayla birlikte gider; yeni dosyanın yanında kalırlarsa onu da bozarlar.
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, backup + suffix);
  }
  return backup;
}

function openOrRecover(file: string, log: Logger): { db: DatabaseSync; recovery: StoreRecovery | null } {
  try {
    return { db: open(file), recovery: null };
  } catch (error) {
    if (!isCorruption(error)) throw error;
    const reason = (error as Error).message;
    const backupPath = quarantine(file);
    log.error(`veritabanı bozuk; yedeklendi ve temiz dosya açılıyor: ${backupPath}`, reason);
    return { db: open(file), recovery: { backupPath, reason, at: nowIso() } };
  }
}

const STATEMENT_CACHE_SIZE = 200;

export function createStore(deps: ServiceDeps['store']): Store {
  const { db, recovery } = openOrRecover(deps.paths.db, deps.log);
  db.exec('CREATE TABLE IF NOT EXISTS core_migrations (scope TEXT, id INTEGER, name TEXT, at TEXT, PRIMARY KEY (scope, id))');
  db.exec('CREATE TABLE IF NOT EXISTS core_kv (scope TEXT, key TEXT, value TEXT, PRIMARY KEY (scope, key))');

  let closed = false;
  const statements = new Map<string, StatementSync>();

  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      if (statements.size >= STATEMENT_CACHE_SIZE) statements.delete(statements.keys().next().value!);
      statements.set(sql, statement);
    }
    return statement;
  };

  const bind = (sql: string, params?: SqlParams) => {
    const args = params === undefined ? [] : Array.isArray(params) ? params : [params];
    return { statement: prepare(sql), args: args as SQLInputValue[] };
  };

  let depth = 0;
  const transaction = <T>(fn: () => T): T => {
    // İç içe çağrıda SAVEPOINT: içteki geri alınırsa dıştaki sürebilir.
    const level = depth;
    const name = `sp_${level}`;
    db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    depth = level + 1;
    try {
      const result = fn();
      db.exec(level === 0 ? 'COMMIT' : `RELEASE ${name}`);
      depth = level;
      return result;
    } catch (error) {
      depth = level;
      if (db.isTransaction) {
        try {
          db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
        } catch {
          // SQLite bazı hatalarda (disk dolu gibi) işlemi kendisi geri alır; asıl hata gizlenmesin.
        }
      }
      throw error;
    }
  };

  const scoped = (scope: string): ScopedDb => ({
    prefix: tablePrefix(scope),
    exec: (sql) => db.exec(sql),
    run(sql, params) {
      const { statement, args } = bind(sql, params);
      const result = statement.run(...args);
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
    get<T>(sql: string, params?: SqlParams) {
      const { statement, args } = bind(sql, params);
      return statement.get(...args) as T | undefined;
    },
    all<T>(sql: string, params?: SqlParams) {
      const { statement, args } = bind(sql, params);
      return statement.all(...args) as T[];
    },
    transaction,
  });

  const core = scoped('core');
  const tableNames = () =>
    new Set(core.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").map((row) => row.name));

  const store: Store = {
    path: deps.paths.db,
    scoped,
    migrate(scope: string, migrations: Migration[]) {
      const applied = new Set(
        core.all<{ id: number }>('SELECT id FROM core_migrations WHERE scope = ?', [scope]).map((row) => row.id),
      );
      const target = scoped(scope);
      const seen = new Set<number>();
      for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
        if (!Number.isInteger(migration.id) || migration.id < 1 || seen.has(migration.id)) {
          throw new Error(`geçersiz göç numarası: ${scope} #${migration.id} (1'den başlayan, yinelenmeyen tam sayı olmalı)`);
        }
        seen.add(migration.id);
        if (applied.has(migration.id)) continue;
        const before = tableNames();
        transaction(() => {
          if (typeof migration.up === 'string') target.exec(migration.up);
          else migration.up(target);
          core.run('INSERT INTO core_migrations (scope, id, name, at) VALUES (?, ?, ?, ?)', [
            scope,
            migration.id,
            migration.name,
            nowIso(),
          ]);
        });
        // Ad alanı kuralı: iki modül aynı tablo adını seçerse ikincisinin göçü anlaşılmaz bir hatayla düşer.
        const foreign = [...tableNames()].filter((name) => !before.has(name) && !name.startsWith(target.prefix));
        if (foreign.length > 0) {
          deps.log.warn(`göç ${scope} #${migration.id} önek dışı tablo açtı (beklenen önek ${target.prefix})`, foreign);
        }
        deps.log.info(`göç uygulandı: ${scope} #${migration.id} ${migration.name}`);
      }
    },
    kv(scope: string): KeyValueStore {
      return {
        get<T extends JsonValue>(key: string) {
          const row = core.get<{ value: string }>('SELECT value FROM core_kv WHERE scope = ? AND key = ?', [scope, key]);
          if (!row) return undefined;
          try {
            return JSON.parse(row.value) as T;
          } catch {
            return undefined;
          }
        },
        set(key, value) {
          core.run(
            'INSERT INTO core_kv (scope, key, value) VALUES (?, ?, ?) ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value',
            [scope, key, JSON.stringify(value) as SqlValue],
          );
        },
        delete(key) {
          core.run('DELETE FROM core_kv WHERE scope = ? AND key = ?', [scope, key]);
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      statements.clear();
      try {
        // WAL ana dosyaya işlenir: kapanıştan sonra tek dosya kalır, yedeklemesi ve taşınması güvenlidir.
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (error) {
        deps.log.warn('kapanışta WAL işlenemedi', error);
      }
      db.close();
    },
  };

  if (recovery) recoveries.set(store, recovery);
  return store;
}

// ───────────────────────────── FTS5 ─────────────────────────────

export interface FtsHit {
  /** `put` ile verilen kayıt kimliği. */
  ref: string;
  /** bm25 puanı; küçük olan daha iyi eşleşmedir. */
  rank: number;
}

/**
 * Bir kapsamın tam metin dizini (`packages/shared/src/search.ts` kalıbı): dizine katlanmış metin yazılır,
 * sorgu aynı katlamadan geçer; böylece arama büyük/küçük harfe ve Türkçe karakterin yazılıp yazılmamasına duyarsızdır.
 */
export interface FtsIndex {
  /** Sanal tablonun adı (`<önek><ad>_fts`). */
  readonly table: string;
  /** `ref` kaydının metnini dizine yazar; aynı `ref` varsa yenisiyle değişir. */
  put(ref: string, text: string): void;
  remove(ref: string): void;
  /**
   * En iyi eşleşmeden başlayarak sonuçlar. Son sözcük önek olarak aranır ("beyan" → "beyannamesini").
   * `any`: sözcüklerden biri yeter (varsayılan: hepsi). Aranabilir sözcük yoksa boş liste.
   */
  search(text: string, options?: { limit?: number; any?: boolean; prefixLast?: boolean }): FtsHit[];
}

/**
 * FTS5 sanal tablosunun DDL'i (göç içinde kullanmak için). Sütun adları sabittir (`norm`, `ref`):
 * FTS5'te sütun adı tablo adıyla aynı olamaz ("vtable constructor failed"); tablo adı her zaman `_fts`
 * ile bittiği için çakışma olmaz.
 */
export function ftsTableSql(table: string): string {
  if (!/^[a-z][a-z0-9_]*_fts$/.test(table)) throw new Error(`geçersiz FTS tablo adı: ${table}`);
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(norm, ref UNINDEXED, tokenize = "${FTS_TOKENIZER}")`;
}

/** `db` kapsamında `<önek><name>_fts` dizinini açar (yoksa kurar). */
export function createFtsIndex(db: ScopedDb, name: string): FtsIndex {
  const table = `${db.prefix}${name}_fts`;
  db.exec(ftsTableSql(table));
  return {
    table,
    put(ref, text) {
      db.transaction(() => {
        db.run(`DELETE FROM ${table} WHERE ref = ?`, [ref]);
        db.run(`INSERT INTO ${table} (norm, ref) VALUES (?, ?)`, [foldForSearch(text), ref]);
      });
    },
    remove(ref) {
      db.run(`DELETE FROM ${table} WHERE ref = ?`, [ref]);
    },
    search(text, options = {}) {
      const query = ftsQuery(text, { any: options.any, prefixLast: options.prefixLast });
      if (query === null) return [];
      return db.all<FtsHit>(
        `SELECT ref, bm25(${table}) AS rank FROM ${table} WHERE ${table} MATCH ? ORDER BY rank LIMIT ?`,
        [query, options.limit ?? 20],
      );
    },
  };
}
