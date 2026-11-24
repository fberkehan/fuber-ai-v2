import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_MANIFEST } from '@fuber/shared';
import {
  applyPendingOperation,
  assertSafeRoot,
  changedSettingsCount,
  clearReinstall,
  createBackup,
  PENDING_MARKER,
  readBackup,
  readPending,
  reinstallMarked,
  requestOperation,
  uninstallCommand,
} from './lifecycle-data';

const APP = 'Fuber AI 2';
let base: string;
let root: string;

const db = (dir = root) => new DatabaseSync(path.join(dir, 'fuber.db'));
function seed(rows: string[]): void {
  const conn = db();
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('CREATE TABLE IF NOT EXISTS notes (text TEXT)');
  conn.exec('DELETE FROM notes');
  for (const text of rows) conn.prepare('INSERT INTO notes VALUES (?)').run(text);
  conn.close();
}
const notes = (dir = root): string[] => {
  const conn = db(dir);
  try {
    return (conn.prepare('SELECT text FROM notes ORDER BY rowid').all() as Array<{ text: string }>).map((row) => row.text);
  } finally {
    conn.close();
  }
};

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-lifecycle-'));
  root = path.join(base, 'data');
  fs.mkdirSync(path.join(root, 'skills', 'doviz'), { recursive: true });
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'models', 'whisper.bin'), 'model');
  fs.writeFileSync(path.join(root, 'skills', 'doviz', 'index.mjs'), 'export default 1');
  fs.writeFileSync(path.join(root, 'policy.json'), '{"v":1}');
  fs.mkdirSync(path.join(root, 'Partitions', 'tarayici'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lockfile'), '');
  seed(['ilk not', 'ikinci not']);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe('yedek', () => {
  it('veritabanının tutarlı kopyası, politika ve yetenekler tanım dosyasıyla yazılır; modeller girmez', () => {
    // Açık bağlantı WAL'da yazmışken bile kopya son hali taşır.
    const open = db();
    open.exec("INSERT INTO notes VALUES ('wal içinde')");
    const result = createBackup({ root, parent: path.join(base, 'yedekler'), appName: APP, version: '2.0.0-demo.3', summary: { memory: 2, chats: 1, settings: 3 }, now: new Date(2026, 10, 17, 9, 5) });
    open.close();
    expect(path.basename(result.path)).toBe('Fuber AI 2 yedek 2026-11-17 09-05');
    expect(notes(result.path)).toEqual(['ilk not', 'ikinci not', 'wal içinde']);
    expect(fs.existsSync(path.join(result.path, 'skills', 'doviz', 'index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.path, 'models'))).toBe(false);
    const manifest = readBackup(result.path, APP);
    expect(manifest.files.sort()).toEqual(['fuber.db', 'policy.json', 'skills']);
    expect(manifest.summary).toEqual({ memory: 2, chats: 1, settings: 3 });
    // Aynı dakikada ikinci yedek ayrı klasöre.
    const again = createBackup({ root, parent: path.join(base, 'yedekler'), appName: APP, version: 'x', summary: { memory: 0, chats: 0, settings: 0 }, now: new Date(2026, 10, 17, 9, 5) });
    expect(again.path).not.toBe(result.path);
  });

  it('tanımsız ya da başka uygulamanın klasörü yedek sayılmaz', () => {
    const other = path.join(base, 'baska');
    fs.mkdirSync(other);
    expect(() => readBackup(other, APP)).toThrow(/yedeği değil/);
    fs.writeFileSync(path.join(other, BACKUP_MANIFEST), JSON.stringify({ app: 'Başka', files: [] }));
    expect(() => readBackup(other, APP)).toThrow(/yedeği değil/);
  });
});

describe('bekleyen işlem', () => {
  it('yedek al → sil → geri yükle: veri gerçekten geri gelir', () => {
    const backup = createBackup({ root, parent: path.join(base, 'yedekler'), appName: APP, version: 'v', summary: { memory: 0, chats: 0, settings: 0 } });
    requestOperation(root, { op: 'wipe', includeModels: false });
    expect(applyPendingOperation(root, APP).applied).toBe('wipe');
    expect(fs.existsSync(path.join(root, 'fuber.db'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Partitions'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'models', 'whisper.bin'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'lockfile'))).toBe(true);

    seed(['yeni profil']);
    requestOperation(root, { op: 'restore', source: backup.path });
    const restored = applyPendingOperation(root, APP, new Date(2026, 10, 17, 10, 0));
    expect(restored.applied).toBe('restore');
    expect(notes()).toEqual(['ilk not', 'ikinci not']);
    expect(fs.readFileSync(path.join(root, 'policy.json'), 'utf8')).toBe('{"v":1}');
    // Geri yüklemeden önceki veri kaybolmaz, kenara alınır.
    expect(notes(restored.previous)).toEqual(['yeni profil']);
  });

  it('yeni başla: kişisel veri gider; modeller, yedekler ve günlükler kalır', () => {
    fs.mkdirSync(path.join(root, 'yedekler', 'eski'), { recursive: true });
    fs.mkdirSync(path.join(root, 'logs'));
    requestOperation(root, { op: 'start-over' });
    expect(applyPendingOperation(root, APP).applied).toBe('start-over');
    expect(fs.existsSync(path.join(root, 'fuber.db'))).toBe(false);
    for (const kept of ['models', 'yedekler', 'logs', 'lockfile']) expect(fs.existsSync(path.join(root, kept)), kept).toBe(true);
  });

  it('modeller dahil silme modelleri de siler', () => {
    requestOperation(root, { op: 'wipe', includeModels: true });
    applyPendingOperation(root, APP);
    expect(fs.existsSync(path.join(root, 'models'))).toBe(false);
  });

  it('işaret işlemden önce silinir: işlem en çok bir kez; bozuk işaret hiçbir şeye dokunmaz', () => {
    requestOperation(root, { op: 'wipe', includeModels: false });
    applyPendingOperation(root, APP);
    seed(['ikinci açılış']);
    expect(applyPendingOperation(root, APP).applied).toBeNull();
    expect(notes()).toEqual(['ikinci açılış']);
    fs.writeFileSync(path.join(root, PENDING_MARKER), '{bozuk');
    expect(readPending(root)).toBe('invalid');
    expect(applyPendingOperation(root, APP).applied).toBeNull();
    expect(notes()).toEqual(['ikinci açılış']);
  });

  it('geçersiz yedeğe geri yükleme hiçbir şeye dokunmaz', () => {
    requestOperation(root, { op: 'restore', source: path.join(base, 'yok') });
    expect(applyPendingOperation(root, APP).applied).toBeNull();
    expect(notes()).toEqual(['ilk not', 'ikinci not']);
  });

  it('bağlantılar izlenmez: silmede hedefe dokunulmaz', () => {
    const outside = path.join(base, 'disarida');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'degerli.txt'), 'x');
    fs.symlinkSync(outside, path.join(root, 'baglanti'), 'junction');
    requestOperation(root, { op: 'wipe', includeModels: true });
    applyPendingOperation(root, APP);
    expect(fs.existsSync(path.join(outside, 'degerli.txt'))).toBe(true);
  });
});

describe('güvenlik ve işaretler', () => {
  it('sınama kipinde gerçek veri klasörü reddedilir', () => {
    const real = path.join(base, 'AppData', 'Fuber AI 2');
    expect(() => assertSafeRoot(real, { testMode: true, realRoot: real })).toThrow(/gerçek veri/);
    expect(() => assertSafeRoot(real.toUpperCase(), { testMode: true, realRoot: real })).toThrow();
    expect(() => assertSafeRoot(path.join(real, 'alt'), { testMode: true, realRoot: real })).toThrow();
    expect(() => assertSafeRoot(root, { testMode: true, realRoot: real })).not.toThrow();
    expect(() => assertSafeRoot(real, { testMode: false, realRoot: real })).not.toThrow();
    expect(() => assertSafeRoot('göreli', { testMode: false, realRoot: real })).toThrow();
    expect(() => assertSafeRoot(path.parse(root).root, { testMode: false, realRoot: real })).toThrow();
  });

  it('yeniden kurulum işareti okunur ve silinir', () => {
    expect(reinstallMarked(root, '.yeniden-kurulum')).toBe(false);
    fs.writeFileSync(path.join(root, '.yeniden-kurulum'), 'kaldirildi');
    expect(reinstallMarked(root, '.yeniden-kurulum')).toBe(true);
    clearReinstall(root, '.yeniden-kurulum');
    expect(reinstallMarked(root, '.yeniden-kurulum')).toBe(false);
  });

  it('kaldırıcı komutu: veri saklanırsa /S, silinirse /S --verileri-sil', () => {
    const exe = path.join('C:\\Program Files', 'Fuber AI 2', 'Fuber AI 2.exe');
    expect(uninstallCommand(true, exe)).toEqual({ command: path.join('C:\\Program Files', 'Fuber AI 2', 'Uninstall Fuber AI 2.exe'), args: ['/S'] });
    expect(uninstallCommand(false, exe).args).toEqual(['/S', '--verileri-sil']);
  });

  it('değişen ayar sayısı varsayılana göre', () => {
    expect(changedSettingsCount({ a: 1, b: [1], c: null }, { a: 1, b: [1], c: 'x' })).toBe(1);
  });
});
