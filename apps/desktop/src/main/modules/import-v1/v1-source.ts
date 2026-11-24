// v1 ("Fuber AI" 0.x) veritabanını SALT OKUNUR okur. Yalnız Node yerleşikleri kullanır: gerçek v1 dosyasında
// şema denetimi betikle de koşabilsin.
//
// Neden kopya: v1 WAL kipindedir ve çalışırken son değişiklikleri `fuber.db-wal` dosyasında tutar. Değişmez
// kipte (`immutable=1`) açmak WAL'ı hiç okumaz (son günün kayıtları görünmez); salt okunur kipte açmak ise
// `-shm` dosyasına okur kilidi yazar. İkisi de olmasın diye ana dosya ve WAL, paylaşımlı okuma tanıtıcısıyla
// bizim geçici klasörümüze bayt bayt kopyalanır ve kopya açılır. v1 klasörüne hiçbir dosya yazılmaz, açılmaz
// bırakılmaz; kopyalama sırasında v1 dosyayı değiştirirse kopya atılıp yeniden alınır.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { V1Table, V1TableStatus } from './types';

export const V1_DB_FILE = 'fuber.db';

/** v1 şeması (`src/main/vt.ts`, göç 1–8): aktarımın okuduğu sütunlar. `optional` olanlar sonraki göçlerle geldi. */
export const V1_SCHEMA: Record<V1Table, { required: string[]; optional: string[] }> = {
  hafizalar: {
    required: ['id', 'tur', 'baslik', 'icerik', 'etiketler', 'onem', 'sabit', 'kaynak', 'olay_tarihi', 'olusturma', 'guncelleme', 'silindi'],
    optional: ['gizli'],
  },
  hatirlaticilar: {
    required: ['id', 'baslik', 'aciklama', 'zaman', 'tekrar', 'durum', 'onem', 'kaynak', 'olusturma'],
    optional: ['gun', 'gizli'],
  },
  gorevler: {
    required: ['id', 'baslik', 'aciklama', 'durum', 'son_tarih', 'proje', 'oncelik', 'olusturma'],
    optional: ['tamamlanma', 'gizli'],
  },
  meseleler: {
    required: ['id', 'baslik', 'ayrinti', 'kisi', 'ilk_gun', 'hedef', 'durum', 'olusturma'],
    optional: ['kapanis', 'kaynak', 'guncelleme', 'gizli'],
  },
};

export const V1_TABLES = Object.keys(V1_SCHEMA) as V1Table[];

export function v1Paths(dir: string): { db: string; wal: string; shm: string } {
  const db = path.join(dir, V1_DB_FILE);
  return { db, wal: `${db}-wal`, shm: `${db}-shm` };
}

const statOrNull = (file: string): fs.Stats | null => {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
};

/** v1 klasörünün dosya düzeyinde durumu; veritabanı açılmaz. */
export function statV1(dir: string | null): { found: boolean; bytes: number; modifiedAt: string | null } {
  if (!dir) return { found: false, bytes: 0, modifiedAt: null };
  const files = v1Paths(dir);
  const db = statOrNull(files.db);
  if (!db?.isFile()) return { found: false, bytes: 0, modifiedAt: null };
  const wal = statOrNull(files.wal);
  const modified = Math.max(db.mtimeMs, wal?.mtimeMs ?? 0);
  return { found: true, bytes: db.size + (wal?.size ?? 0), modifiedAt: new Date(modified).toISOString() };
}

export class V1ReadError extends Error {}

const signature = (stat: fs.Stats | null) => (stat ? `${stat.size}:${stat.mtimeMs}` : 'yok');

/**
 * Dosyayı paylaşımlı okuma tanıtıcısıyla kopyalar (Windows'ta libuv FILE_SHARE_READ|WRITE|DELETE ile açar:
 * yazan v1 süreci engellenmez, ona kilit konmaz).
 */
function copyShared(source: string, target: string): void {
  const input = fs.openSync(source, 'r');
  try {
    const output = fs.openSync(target, 'wx');
    try {
      const buffer = Buffer.allocUnsafe(1 << 20);
      for (;;) {
        const read = fs.readSync(input, buffer, 0, buffer.length, null);
        if (read === 0) break;
        fs.writeSync(output, buffer, 0, read);
      }
    } finally {
      fs.closeSync(output);
    }
  } finally {
    fs.closeSync(input);
  }
}

/** Klasörü siler. `fs.rmSync` Türkçe harfli yolda sessizce hiçbir şey silmiyor (TUZAKLAR §7): dosya dosya. */
function removeDir(dir: string): void {
  try {
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    fs.rmdirSync(dir);
  } catch {
    // Geçici klasör açılışta zaten temizlenir.
  }
}

export interface V1Snapshot {
  /** Kopyanın bağlantısı (`query_only`): yazma girişimi hata verir. */
  db: DatabaseSync;
  close(): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * v1 veritabanının tutarlı bir anlık kopyasını açar. Kopyalama boyunca v1 dosyaları değişirse (boyut ya da
 * değişim anı) ya da kopya bütünlük denetiminden geçmezse yeniden dener.
 */
export async function openSnapshot(dir: string, tempRoot: string, options: { attempts?: number; delayMs?: number } = {}): Promise<V1Snapshot> {
  const files = v1Paths(dir);
  if (!statOrNull(files.db)?.isFile()) throw new V1ReadError('Eski Fuber AI veritabanı bulunamadı.');
  const attempts = options.attempts ?? 5;
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    fs.mkdirSync(tempRoot, { recursive: true });
    const work = path.join(tempRoot, `v1-kopya-${randomBytes(6).toString('hex')}`);
    fs.mkdirSync(work);
    const copy = path.join(work, V1_DB_FILE);
    let db: DatabaseSync | null = null;
    try {
      const before = [signature(statOrNull(files.db)), signature(statOrNull(files.wal))];
      copyShared(files.db, copy);
      if (statOrNull(files.wal)) copyShared(files.wal, `${copy}-wal`);
      const after = [signature(statOrNull(files.db)), signature(statOrNull(files.wal))];
      if (before[0] !== after[0] || before[1] !== after[1]) throw new V1ReadError('kopyalanırken değişti');
      // Kopya bizim klasörümüzde: olağan kipte açılır ki WAL işlensin; sonra yazmaya kapatılır.
      db = new DatabaseSync(copy);
      db.exec('PRAGMA query_only = ON;');
      const verdict = db
        .prepare('PRAGMA quick_check')
        .all()
        .map((row) => String(Object.values(row)[0]))
        .join('; ');
      if (verdict !== 'ok') throw new V1ReadError(`bütünlük denetimi: ${verdict.slice(0, 200)}`);
      const opened = db;
      return {
        db: opened,
        close() {
          try {
            opened.close();
          } finally {
            removeDir(work);
          }
        },
      };
    } catch (error) {
      try {
        db?.close();
      } catch {
        // açılamamıştı
      }
      removeDir(work);
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep((options.delayMs ?? 250) * attempt);
    }
  }
  throw new V1ReadError(`Eski Fuber AI veritabanının tutarlı bir kopyası alınamadı (${lastError}). Eski uygulamayı kapatıp yeniden deneyin.`);
}

/** Tabloların şemaya uyup uymadığı; satırlara bakılmaz. */
export function inspectSchema(db: DatabaseSync): { schemaVersion: number | null; tables: V1TableStatus[] } {
  const names = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
  );
  const tables = V1_TABLES.map((table): V1TableStatus => {
    if (!names.has(table)) return { table, state: 'missing', missingColumns: [], hasPrivateColumn: false };
    const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
    const missingColumns = V1_SCHEMA[table].required.filter((column) => !columns.has(column));
    return { table, state: missingColumns.length ? 'incompatible' : 'ok', missingColumns, hasPrivateColumn: columns.has('gizli') };
  });
  let schemaVersion: number | null = null;
  if (names.has('meta')) {
    try {
      const row = db.prepare("SELECT v FROM meta WHERE k = 'surum'").get() as { v?: string } | undefined;
      const parsed = Number.parseInt(String(row?.v ?? ''), 10);
      schemaVersion = Number.isInteger(parsed) ? parsed : null;
    } catch {
      schemaVersion = null;
    }
  }
  return { schemaVersion, tables };
}

/** Gelecekteki ve etkin hatırlatıcı koşulu (tekrarlı seri, son anı geçmiş olsa da etkindir). */
export const UPCOMING_REMINDER_SQL = "durum = 'bekliyor' AND (zaman > ? OR COALESCE(tekrar, 'yok') NOT IN ('yok', ''))";

export interface V1Counts {
  memories: { active: number; private: number; deletedOrArchived: number };
  reminders: { upcoming: number; past: number; private: number };
  todos: { open: number; done: number; private: number };
  issues: { open: number; closed: number; private: number };
}

/** Yalnız `COUNT(*)`: satır içeriği okunmaz. Okunamayan tabloda sayılar 0'dır. */
export function countRows(db: DatabaseSync, tables: V1TableStatus[], now: Date): V1Counts {
  const usable = (table: V1Table) => tables.find((status) => status.table === table)?.state === 'ok';
  const privateCol = (table: V1Table) => tables.find((status) => status.table === table)?.hasPrivateColumn === true;
  const count = (table: V1Table, where: string, params: string[] = []): number => {
    if (!usable(table)) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number };
    return Number(row.n);
  };
  const visible = (table: V1Table) => (privateCol(table) ? 'COALESCE(gizli, 0) = 0' : '1 = 1');
  const hidden = (table: V1Table) => (privateCol(table) ? 'COALESCE(gizli, 0) = 1' : '1 = 0');
  const nowIso = now.toISOString();
  return {
    memories: {
      active: count('hafizalar', `silindi = 0 AND ${visible('hafizalar')}`),
      private: count('hafizalar', `silindi = 0 AND ${hidden('hafizalar')}`),
      deletedOrArchived: count('hafizalar', 'silindi != 0'),
    },
    reminders: {
      upcoming: count('hatirlaticilar', `${UPCOMING_REMINDER_SQL} AND ${visible('hatirlaticilar')}`, [nowIso]),
      past: count('hatirlaticilar', `NOT (${UPCOMING_REMINDER_SQL}) AND ${visible('hatirlaticilar')}`, [nowIso]),
      private: count('hatirlaticilar', hidden('hatirlaticilar')),
    },
    todos: {
      open: count('gorevler', `durum = 'acik' AND ${visible('gorevler')}`),
      done: count('gorevler', `durum = 'tamam' AND ${visible('gorevler')}`),
      private: count('gorevler', hidden('gorevler')),
    },
    issues: {
      open: count('meseleler', `durum = 'acik' AND ${visible('meseleler')}`),
      closed: count('meseleler', `durum != 'acik' AND ${visible('meseleler')}`),
      private: count('meseleler', hidden('meseleler')),
    },
  };
}

// ───────────── satırlar (yalnız kullanıcı onayından sonra) ─────────────

export interface V1MemoryRow {
  id: number;
  tur: string | null;
  baslik: string | null;
  icerik: string | null;
  etiketler: string | null;
  onem: number | null;
  sabit: number | null;
  kaynak: string | null;
  olay_tarihi: string | null;
  olusturma: string | null;
  silindi: number | null;
  gizli: number | null;
}

export interface V1ReminderRow {
  id: number;
  baslik: string | null;
  aciklama: string | null;
  zaman: string | null;
  tekrar: string | null;
  durum: string | null;
  onem: number | null;
  kaynak: string | null;
  olusturma: string | null;
  gun: number | null;
  gizli: number | null;
}

export interface V1TodoRow {
  id: number;
  baslik: string | null;
  aciklama: string | null;
  durum: string | null;
  son_tarih: string | null;
  proje: string | null;
  oncelik: number | null;
  olusturma: string | null;
  tamamlanma: string | null;
  gizli: number | null;
}

export interface V1IssueRow {
  id: number;
  baslik: string | null;
  ayrinti: string | null;
  kisi: string | null;
  ilk_gun: string | null;
  hedef: string | null;
  durum: string | null;
  olusturma: string | null;
  gizli: number | null;
}

export interface V1RowMap {
  hafizalar: V1MemoryRow;
  hatirlaticilar: V1ReminderRow;
  gorevler: V1TodoRow;
  meseleler: V1IssueRow;
}

/** Tablonun aktarımın kullandığı sütunları (eksik isteğe bağlı sütun NULL gelir), kimlik sırasıyla. */
export function readRows<T extends V1Table>(db: DatabaseSync, status: V1TableStatus & { table: T }): Array<V1RowMap[T]> {
  if (status.state !== 'ok') return [];
  const columns = new Set((db.prepare(`PRAGMA table_info(${status.table})`).all() as Array<{ name: string }>).map((row) => row.name));
  const { required, optional } = V1_SCHEMA[status.table];
  const select = [...required, ...optional.map((column) => (columns.has(column) ? column : `NULL AS ${column}`))].join(', ');
  return db.prepare(`SELECT ${select} FROM ${status.table} ORDER BY id`).all() as unknown as Array<V1RowMap[T]>;
}
