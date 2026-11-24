// Paketleme: worktree'de `npm run dist:desktop` (≈2 dk) → `apps/desktop/release/Fuber AI 2 Kurulum <sürüm>.exe`; çıktı veri kökünde
// saklanır: `<data>/selfdev/packages/<sürüm>/` (`paths.temp` açılışta silinir, oraya konmaz). En çok 3 paket ve 2 anlık kopya
// tutulur (disk). `Packager` arayüzü: gerçek (komut koşucuyla) ve sahte (sınama).
import fs from 'node:fs';
import path from 'node:path';
import { installerName } from './version';
import { npmCommand, type CommandResult, type Runner } from './runner';

export interface PackageInput {
  worktree: string;
  version: string;
  /** npm betiği (`dist:desktop`). */
  script: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?(line: string): void;
}

export interface PackageOutput {
  ok: boolean;
  /** Üretilen kurulum dosyası (worktree içinde). */
  file?: string;
  error?: string;
  result?: CommandResult;
}

export interface Packager {
  build(input: PackageInput): Promise<PackageOutput>;
}

/** Kurulum dosyasının worktree'deki yeri. */
export const releaseFile = (worktree: string, version: string): string => path.join(worktree, 'apps', 'desktop', 'release', installerName(version));

export function createPackager(runner: Runner): Packager {
  return {
    async build(input) {
      const result = await runner.run(npmCommand(`npm run ${input.script}`, ['run', input.script], input.worktree, input.timeoutMs), {
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onLine ? { onLine: input.onLine } : {}),
      });
      if (!result.ok) {
        const why = result.cancelled ? 'iptal edildi' : result.timedOut ? 'süre doldu' : `çıkış kodu ${result.exitCode ?? '?'}`;
        return { ok: false, error: `paketleme başarısız (${why})`, result };
      }
      const file = releaseFile(input.worktree, input.version);
      try {
        if (fs.statSync(file).size <= 0) return { ok: false, error: 'kurulum dosyası boş', result };
      } catch {
        return { ok: false, error: `kurulum dosyası üretilmedi: ${path.basename(file)}`, result };
      }
      return { ok: true, file, result };
    },
  };
}

// ───────────────────────── saklama ─────────────────────────

export const selfdevDir = (dataDir: string): string => path.join(dataDir, 'selfdev');
export const packagesDir = (dataDir: string): string => path.join(selfdevDir(dataDir), 'packages');
export const rollbackDir = (dataDir: string): string => path.join(selfdevDir(dataDir), 'rollback');
export const pendingFile = (dataDir: string): string => path.join(selfdevDir(dataDir), 'pending-update.json');
export const healthFile = (dataDir: string): string => path.join(selfdevDir(dataDir), 'health.json');

/** Sürüm adı klasör adı olarak güvenli mi (yol kaçışı yok). */
export const isSafeVersion = (version: string): boolean => /^[0-9A-Za-z][0-9A-Za-z.+-]{0,60}$/.test(version);

/** Kurulum dosyasını veri köküne kopyalar; yeni yolu döndürür. */
export async function storePackage(dataDir: string, version: string, file: string): Promise<string> {
  if (!isSafeVersion(version)) throw new Error(`güvensiz sürüm adı: ${version}`);
  const dir = path.join(packagesDir(dataDir), version);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, path.basename(file));
  await fs.promises.copyFile(file, target);
  return target;
}

/** Bir sürümün saklanan kurulum dosyası; yoksa `null`. */
export function storedPackage(dataDir: string, version: string): string | null {
  if (!isSafeVersion(version)) return null;
  const dir = path.join(packagesDir(dataDir), version);
  try {
    const exe = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith('.exe'));
    return exe ? path.join(dir, exe) : null;
  } catch {
    return null;
  }
}

/** Saklama sınırları: en çok 3 paket, 2 anlık kopya. */
export const MAX_PACKAGES = 3;
export const MAX_SNAPSHOTS = 2;

/**
 * Eski paketleri ve anlık kopyaları siler (`fs.promises.rm`; Türkçe harfli yolda eşzamanlı silme sessizce başarısız olur).
 * `keep`: asla silinmeyecek sürümler (kurulu, önceki, bekleyen). Dönüş: silinen klasör sayısı.
 */
export async function pruneStorage(dataDir: string, keep: ReadonlySet<string>): Promise<number> {
  let removed = 0;
  for (const [root, limit] of [
    [packagesDir(dataDir), MAX_PACKAGES],
    [rollbackDir(dataDir), MAX_SNAPSHOTS],
  ] as const) {
    let entries: Array<{ name: string; time: number }>;
    try {
      entries = (await fs.promises.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, time: fs.statSync(path.join(root, entry.name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
    } catch {
      continue;
    }
    const surplus = entries.filter((entry) => !keep.has(entry.name)).slice(Math.max(0, limit - entries.filter((entry) => keep.has(entry.name)).length));
    for (const entry of surplus) {
      await fs.promises.rm(path.join(root, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}
