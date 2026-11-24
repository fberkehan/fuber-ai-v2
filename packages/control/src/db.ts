/**
 * Kontrol veritabanını açar, numaralı göçleri uygular. Dosya bozuksa yedekleyip temiz açar;
 * kilitliyse (başka süreç yazıyor) bozuk SAYMAZ, açık hata verir: kilitli dosyayı "bozuk" diye
 * kenara almak sağlam veriyi kaybettirirdi.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ControlStartError, type ControlLogger } from './types';

/**
 * Şema. SQL, SQLite'ın sade ve taşınabilir bir alt kümesinde tutulur (başka bir SQL sürücüsüne geçiş kolay olsun):
 * yalnız TEXT/INTEGER/REAL/BLOB, `ON CONFLICT`, `INSERT OR IGNORE`; PRAGMA'lar yalnız bu açıcıda.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE policy_revisions (
    revision INTEGER PRIMARY KEY,
    updated_at TEXT NOT NULL,
    note TEXT NOT NULL,
    changed_keys TEXT NOT NULL,
    policy TEXT NOT NULL,
    actor TEXT NOT NULL
  );
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    install_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    app_version TEXT NOT NULL,
    status TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    registered_at TEXT NOT NULL,
    approved_at TEXT,
    last_seen_at TEXT,
    policy_revision INTEGER,
    voice_ready INTEGER,
    uptime_seconds INTEGER,
    modules TEXT,
    remote_address TEXT
  );
  CREATE TABLE usage_events (
    device_id TEXT NOT NULL,
    id TEXT NOT NULL,
    at TEXT NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    audio_seconds REAL NOT NULL,
    cost_usd REAL NOT NULL,
    duration_ms INTEGER NOT NULL,
    received_at TEXT NOT NULL,
    PRIMARY KEY (device_id, id)
  );
  CREATE INDEX usage_events_day ON usage_events (day);
  CREATE TABLE secrets (
    provider TEXT PRIMARY KEY,
    ciphertext BLOB NOT NULL,
    hint TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_test TEXT
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    target TEXT NOT NULL,
    summary TEXT NOT NULL
  );
  `,
  // 2: fiyatı bilinmeyen çağrı (OpenAI uyumlu sağlayıcılar): tutar 0 ama "bilinmiyor" (G8).
  `ALTER TABLE usage_events ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1;`,
];

export interface OpenedDatabase {
  db: DatabaseSync;
  /** Bozuk dosya kenara alındıysa yedeğin yolu. */
  recoveredFrom: string | null;
}

function isLockError(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(text);
}

function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      version += 1;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function openAndCheck(dbPath: string): DatabaseSync {
  // `timeout`: kısa süreli kilitte (aynı anda yazan ikinci süreç) hemen hata yerine bekler.
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    db.exec('PRAGMA journal_mode = WAL');
    const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
    const verdict = check ? String(Object.values(check)[0]) : 'ok';
    if (verdict !== 'ok') throw new Error(`quick_check: ${verdict}`);
    migrate(db);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // açılamayan bağlantıyı kapatmak da başarısız olabilir
    }
    throw error;
  }
}

function moveAside(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${dbPath}.corrupt-${stamp}`;
  fs.renameSync(dbPath, backup);
  for (const suffix of ['-wal', '-shm']) {
    const side = `${dbPath}${suffix}`;
    if (fs.existsSync(side)) fs.renameSync(side, `${backup}${suffix}`);
  }
  return backup;
}

/** `:memory:` da kabul edilir (sınamalar için). */
export function openControlDatabase(dbPath: string, log: ControlLogger): OpenedDatabase {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    return { db: openAndCheck(dbPath), recoveredFrom: null };
  } catch (error) {
    if (isLockError(error)) {
      throw new ControlStartError(
        'database_locked',
        'Kontrol veritabanı başka bir süreç tarafından kilitli. Diğer Fuber Yönetim penceresini kapatıp yeniden deneyin.',
      );
    }
    if (dbPath === ':memory:' || !fs.existsSync(dbPath)) {
      throw new ControlStartError('database_unavailable', `Kontrol veritabanı açılamadı: ${String(error)}`);
    }
    const backup = moveAside(dbPath);
    log.warn('control: veritabanı bozuk, yedeklenip temiz açılıyor', { backup, reason: String(error) });
    try {
      return { db: openAndCheck(dbPath), recoveredFrom: backup };
    } catch (second) {
      throw new ControlStartError('database_unavailable', `Kontrol veritabanı açılamadı: ${String(second)}`);
    }
  }
}
