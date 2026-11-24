/**
 * Veri yaşam döngüsünün dosya işlemleri (v1 `main/veri/temizlik.ts` kurgusu): yedek al, geri yükle, yeni başla,
 * verilerimi sil. Electron'a bağlı değildir; kök PARAMETREYLE gelir (birim testleri geçici klasörde çalışır).
 *
 * - Yedek: veritabanının tutarlı kopyası (`VACUUM INTO`, açık bağlantıya dokunmadan), politika önbelleği ve kullanıcı
 *   yetenekleri, bir tanım dosyasıyla (`fuber-yedek.json`) seçilen klasörün altında yeni bir klasöre yazılır.
 * - Geri yükle / yeni başla / sil: açık veritabanı taşınmaz ve silinmez. İstek kökte `.veri-islemi` işareti olarak
 *   yazılır, uygulama yeniden açılır ve işlem bir sonraki açılışta veritabanı AÇILMADAN uygulanır (`applyPendingOperation`).
 *   İşaret işlemden önce silinir: işlem en çok bir kez yapılır.
 * - Bağlantılar (symlink, junction) izlenmez; her yol kökün içinde olmalı; sürücü kökü ve göreli kök reddedilir.
 * - Sınama kipinde gerçek veri klasörü (`%APPDATA%\Fuber AI 2`) reddedilir (`assertSafeRoot`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_MANIFEST, DATA_DIRS, DESKTOP_APP_NAME, type BackupManifest, type BackupResult, type DataSummary } from '@fuber/shared';

export const PENDING_MARKER = '.veri-islemi';
export const BACKUPS_DIR = 'yedekler';
/** Yedeğe giren ve geri yüklenen kişisel girdiler (veritabanı ayrıca, tutarlı kopyayla). */
export const BACKUP_ENTRIES: readonly string[] = [DATA_DIRS.policyCacheFile, DATA_DIRS.skills];
/** Hiçbir işlemde dokunulmayan çalışma dosyaları (tek örnek kilidi, Chromium'un bu kurulum anahtarı, işaretler). */
export const WORKING_FILES: readonly string[] = ['lockfile', 'Local State', '.cikis-destekli', PENDING_MARKER];
const DB = DATA_DIRS.dbFile;
const DB_SIDECARS: readonly string[] = [`${DB}-wal`, `${DB}-shm`];

export type PendingOperation =
  | { op: 'restore'; source: string }
  | { op: 'start-over' }
  | { op: 'wipe'; includeModels: boolean };

export interface PendingResult {
  applied: PendingOperation['op'] | null;
  /** Geri yüklemeden önce eski verinin taşındığı klasör. */
  previous?: string;
  skipped?: string[];
}

// ── güvenlik ──

/** Kök mutlak mı ve sürücü kökü değil mi. */
export function rootValid(root: string): boolean {
  if (typeof root !== 'string' || !root || !path.isAbsolute(root)) return false;
  const resolved = path.resolve(root);
  return path.parse(resolved).root !== resolved;
}

const samePath = (a: string, b: string): boolean => {
  const norm = (value: string) => path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/**
 * Yıkıcı işlem bu kökte koşabilir mi. Sınama kipinde gerçek veri klasörü (ve onun içi) reddedilir: sınama yalnız
 * yalıtılmış `FUBER2_DATA` klasöründe koşar.
 */
export function assertSafeRoot(root: string, guard: { testMode: boolean; realRoot: string }): void {
  if (!rootValid(root)) throw new Error('Veri klasörü geçersiz.');
  if (!guard.testMode) return;
  const rel = path.relative(path.resolve(guard.realRoot), path.resolve(root));
  if (samePath(root, guard.realRoot) || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error('Sınama kipinde gerçek veri klasörüne dokunulmaz.');
  }
}

const inside = (root: string, target: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
};
const lstat = (target: string): fs.Stats | null => {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
};

/** Bağlantı izlemeden siler; bağlantının yalnız kendisi kalkar. Silinemeyen `skipped`a düşer. */
function removeSafe(root: string, target: string, skipped: string[]): void {
  if (!inside(root, target)) {
    skipped.push(target);
    return;
  }
  const stat = lstat(target);
  if (!stat) return;
  try {
    if (stat.isSymbolicLink()) {
      try {
        fs.unlinkSync(target);
      } catch {
        fs.rmdirSync(target);
      }
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) removeSafe(root, path.join(target, name), skipped);
      fs.rmdirSync(target);
      return;
    }
    fs.rmSync(target, { force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    skipped.push(path.relative(root, target));
  }
}

/** Klasörü bağlantı izlemeden kopyalar. */
function copyTree(from: string, to: string): void {
  const stat = lstat(from);
  if (!stat || stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name));
    return;
  }
  fs.copyFileSync(from, to);
}

function sizeOf(target: string): number {
  const stat = lstat(target);
  if (!stat || stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of fs.readdirSync(target)) total += sizeOf(path.join(target, name));
  return total;
}

/** Yerel saatle `YYYY-AA-GG SS-DD` (dosya adına uygun). */
export function stamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}-${two(date.getMinutes())}`;
}

function uniqueDir(parent: string, name: string): string {
  let target = path.join(parent, name);
  for (let n = 2; lstat(target); n++) target = path.join(parent, `${name} (${n})`);
  return target;
}

// ── yedek ──

export interface BackupInput {
  root: string;
  /** Yedek klasörünün oluşturulacağı üst klasör. */
  parent: string;
  appName: string;
  version: string;
  summary: BackupManifest['summary'];
  now?: Date;
}

/** Veri klasörünün tutarlı kopyasını `parent` altında yeni bir klasöre yazar. */
export function createBackup(input: BackupInput): BackupResult {
  const { root, parent } = input;
  if (!rootValid(root)) throw new Error('Veri klasörü geçersiz.');
  if (!rootValid(parent)) throw new Error('Yedek klasörü geçersiz.');
  const now = input.now ?? new Date();
  fs.mkdirSync(parent, { recursive: true });
  const target = uniqueDir(parent, `${input.appName} yedek ${stamp(now)}`);
  fs.mkdirSync(target);
  const files: string[] = [];
  try {
    const dbFile = path.join(root, DB);
    if (lstat(dbFile)?.isFile()) {
      // Açık bağlantıya dokunmadan tutarlı kopya: WAL'daki son yazılar dahil tek dosya.
      const db = new DatabaseSync(dbFile);
      try {
        db.exec(`VACUUM INTO '${path.join(target, DB).replace(/'/g, "''")}'`);
      } finally {
        db.close();
      }
      files.push(DB);
    }
    for (const entry of BACKUP_ENTRIES) {
      const from = path.join(root, entry);
      if (!lstat(from) || lstat(from)?.isSymbolicLink()) continue;
      copyTree(from, path.join(target, entry));
      files.push(entry);
    }
    const manifest: BackupManifest = { app: input.appName, version: input.version, createdAt: now.toISOString(), summary: input.summary, files };
    fs.writeFileSync(path.join(target, BACKUP_MANIFEST), JSON.stringify(manifest, null, 2));
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return { path: target, bytes: sizeOf(target), createdAt: now.toISOString() };
}

/** Yedek klasörünün tanımını okur ve doğrular; geçersizse açıklamalı hata. */
export function readBackup(dir: string, appName: string): BackupManifest {
  if (!rootValid(dir)) throw new Error('Yedek klasörü geçersiz.');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, BACKUP_MANIFEST), 'utf8')) as BackupManifest;
  } catch {
    throw new Error('Bu klasör bir Fuber yedeği değil.');
  }
  if (manifest?.app !== appName || !Array.isArray(manifest.files)) throw new Error('Bu klasör bir Fuber yedeği değil.');
  if (manifest.files.includes(DB) && !lstat(path.join(dir, DB))?.isFile()) throw new Error('Yedekteki veritabanı eksik.');
  return manifest;
}

// ── bekleyen işlem ──

/** İsteği kökte atomik olarak yazar (geçici dosya + yeniden adlandırma). Uygulama hemen ardından yeniden açılır. */
export function requestOperation(root: string, operation: PendingOperation): void {
  if (!rootValid(root)) throw new Error('Veri klasörü geçersiz.');
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, PENDING_MARKER);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...operation, at: new Date().toISOString() }));
  fs.renameSync(temp, target);
}

export function readPending(root: string): PendingOperation | 'invalid' | null {
  const file = path.join(root, PENDING_MARKER);
  const stat = lstat(file);
  if (!stat) return null;
  if (!stat.isFile()) return 'invalid';
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<{ op: string; source: unknown; includeModels: unknown }>;
    if (value.op === 'restore' && typeof value.source === 'string' && value.source) return { op: 'restore', source: value.source };
    if (value.op === 'start-over') return { op: 'start-over' };
    if (value.op === 'wipe') return { op: 'wipe', includeModels: value.includeModels === true };
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

/** Veritabanı üçlüsünü siler (önce eşler). */
function removeDb(root: string, skipped: string[]): void {
  for (const name of [...DB_SIDECARS, DB]) removeSafe(root, path.join(root, name), skipped);
}

/**
 * Bekleyen işlemi uygular (açılışın en başında, depo açılmadan). İşlem yoksa hiçbir şeye dokunmaz.
 * - restore: şimdiki kişisel veri `yedekler/<zaman> geri yükleme öncesi/` altına taşınır, yedek kopyalanır.
 * - start-over: kişisel veri silinir; indirilen modeller, yedekler ve günlükler kalır. (Otomatik yedek istek anında alınır.)
 * - wipe: kökteki her şey silinir; `includeModels` değilse indirilen modeller kalır.
 * Yeniden kurulum işareti üç işlemde de silinir.
 */
export function applyPendingOperation(root: string, appName: string, now: Date = new Date()): PendingResult {
  if (!rootValid(root) || !lstat(root)?.isDirectory()) return { applied: null };
  const pending = readPending(root);
  if (!pending) return { applied: null };
  try {
    fs.unlinkSync(path.join(root, PENDING_MARKER));
  } catch {
    // İşaret silinemezse işlem yapılmaz: her açılışta yinelenmesin.
    return { applied: null };
  }
  if (pending === 'invalid') return { applied: null };
  const skipped: string[] = [];
  removeSafe(root, path.join(root, '.yeniden-kurulum'), skipped);

  if (pending.op === 'restore') {
    try {
      readBackup(pending.source, appName);
    } catch {
      return { applied: null, skipped: [pending.source] };
    }
    const backups = path.join(root, BACKUPS_DIR);
    fs.mkdirSync(backups, { recursive: true });
    const previous = uniqueDir(backups, `${stamp(now)} geri yükleme öncesi`);
    fs.mkdirSync(previous);
    for (const name of [DB, ...DB_SIDECARS, ...BACKUP_ENTRIES]) {
      const from = path.join(root, name);
      const stat = lstat(from);
      if (!stat || stat.isSymbolicLink()) continue;
      try {
        fs.renameSync(from, path.join(previous, name));
      } catch {
        skipped.push(name);
      }
    }
    for (const name of [DB, ...BACKUP_ENTRIES]) {
      const from = path.join(pending.source, name);
      if (lstat(from)) copyTree(from, path.join(root, name));
    }
    return { applied: 'restore', previous, ...(skipped.length ? { skipped } : {}) };
  }

  const keep = new Set<string>([...WORKING_FILES, ...DB_SIDECARS, DB]);
  if (pending.op === 'start-over') {
    keep.add(DATA_DIRS.models).add(BACKUPS_DIR).add(DATA_DIRS.logs);
  } else if (!pending.includeModels) {
    keep.add(DATA_DIRS.models);
  }
  removeDb(root, skipped);
  for (const name of fs.readdirSync(root)) {
    if (keep.has(name)) continue;
    removeSafe(root, path.join(root, name), skipped);
  }
  return { applied: pending.op, ...(skipped.length ? { skipped } : {}) };
}

// ── yeniden kurulum işareti ──

export const reinstallMarked = (root: string, marker: string): boolean => Boolean(lstat(path.join(root, marker))?.isFile());
export function clearReinstall(root: string, marker: string): void {
  const file = path.join(root, marker);
  if (lstat(file)?.isFile()) fs.unlinkSync(file);
}

/** Veritabanının boyutu (eşleri dahil). */
export const dbBytes = (root: string): number => [DB, ...DB_SIDECARS].reduce((sum, name) => sum + (lstat(path.join(root, name))?.size ?? 0), 0);

/** `DataSummary`'nin sayıları için yardımcı: varsayılandan farklı ayar sayısı. */
export function changedSettingsCount(current: Record<string, unknown>, defaults: Record<string, unknown>): number {
  return Object.keys(defaults).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(defaults[key])).length;
}

/**
 * Kaldırıcı komutu: electron-builder "Uninstall ${productName}.exe", uygulamanın yanında. `/S` sessiz kaldırır ve
 * veri klasörüne `.yeniden-kurulum` işaretini bırakır; `--verileri-sil` veriyi de siler (kurulum ajanının NSIS sözleşmesi).
 */
export function uninstallCommand(keepData: boolean, exePath: string, appName = DESKTOP_APP_NAME): { command: string; args: string[] } {
  return { command: path.join(path.dirname(exePath), `Uninstall ${appName}.exe`), args: keepData ? ['/S'] : ['/S', '--verileri-sil'] };
}

export type { DataSummary };
