/**
 * Yerel model dosyalarının disk işleri: özet hesabı, doğrulama önbelleği, bilinen yerel kaynaklardan
 * yerleştirme. Electron'a dokunmaz; `models.ts` ve `scripts/voice/prepare-models.mjs` aynı kuralları kullanır.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FileSpec {
  /** `Paths.models` altına göreli hedef, `/` ayraçlı. */
  path: string;
  sha256: string;
  bytes: number;
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
}

interface CacheFile {
  version: 1;
  /** Klasöre göreli yol (`/` ayraçlı) → son doğrulama. */
  files: Record<string, CacheEntry>;
  /** Klasör dışındaki kaynak dosyalar (mutlak yol) → son özet. */
  external: Record<string, CacheEntry>;
}

export const VERIFY_CACHE_FILE = '.verified.json';

/** Politika ağdan gelir: hedef yol model klasörünün dışına çıkamaz. */
export function isSafeRelativePath(relative: string): boolean {
  if (relative.length === 0 || relative.includes('\\') || relative.includes(':')) return false;
  if (relative.startsWith('/')) return false;
  return relative.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function resolveModelPath(root: string, relative: string): string {
  if (!isSafeRelativePath(relative)) throw new Error(`güvensiz model yolu: ${relative}`);
  return path.join(root, ...relative.split('/'));
}

/**
 * Dosyayı siler; yoksa sessizce geçer. `fs.rmSync` KULLANILMAZ: Node 24.11'de Windows'ta yolda "İ", "ş", "ğ"
 * gibi harfler varsa hata vermeden hiçbir şey silmiyor (ölçüldü); `unlinkSync` doğru çalışıyor.
 */
export function removeFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 1 << 20, signal });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Doğrulama önbelleği: gigabaytlık dosyaların özeti her açılışta yeniden hesaplanmasın diye boyut ve
 * değişiklik anı değişmediği sürece son özet geçerli sayılır.
 */
export class VerifyCache {
  private data: CacheFile = { version: 1, files: {}, external: {} };
  private dirty = false;
  private readonly dir: string;
  private readonly readOnly: boolean;

  // Parametre özelliği kullanılmaz: hazırlama betiği bu dosyayı Node'un tür silmesiyle doğrudan yükler.
  constructor(dir: string, readOnly = false) {
    this.dir = dir;
    this.readOnly = readOnly;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, VERIFY_CACHE_FILE), 'utf8')) as Partial<CacheFile>;
      if (raw.version === 1) {
        this.data = { version: 1, files: raw.files ?? {}, external: raw.external ?? {} };
      }
    } catch {
      // Yok ya da bozuk: boş önbellekle başlanır, dosyalar yeniden özetlenir.
    }
  }

  private static matches(entry: CacheEntry | undefined, stat: fs.Stats): entry is CacheEntry {
    return entry !== undefined && entry.size === stat.size && Math.abs(entry.mtimeMs - stat.mtimeMs) < 2;
  }

  /** Klasör içindeki dosyanın önbellekteki özeti; dosya değiştiyse ya da kayıt yoksa `null`. */
  lookup(relative: string, stat: fs.Stats): string | null {
    const entry = this.data.files[relative];
    return VerifyCache.matches(entry, stat) ? entry.sha256 : null;
  }

  lookupExternal(absolute: string, stat: fs.Stats): string | null {
    const entry = this.data.external[absolute.toLowerCase()];
    return VerifyCache.matches(entry, stat) ? entry.sha256 : null;
  }

  record(relative: string, stat: fs.Stats, sha256: string): void {
    this.data.files[relative] = { size: stat.size, mtimeMs: stat.mtimeMs, sha256 };
    this.dirty = true;
  }

  recordExternal(absolute: string, stat: fs.Stats, sha256: string): void {
    this.data.external[absolute.toLowerCase()] = { size: stat.size, mtimeMs: stat.mtimeMs, sha256 };
    this.dirty = true;
  }

  forget(relative: string): void {
    if (relative in this.data.files) {
      delete this.data.files[relative];
      this.dirty = true;
    }
  }

  save(): void {
    if (!this.dirty || this.readOnly) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const target = path.join(this.dir, VERIFY_CACHE_FILE);
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data));
      fs.renameSync(temp, target);
      this.dirty = false;
    } catch {
      // Önbellek yazılamazsa yalnız bir sonraki açılış yavaşlar.
    }
  }
}

export type FileState = 'ready' | 'missing' | 'unverified' | 'mismatch';

/**
 * Hızlı (eşzamanlı) durum: dosya yerinde mi, boyutu doğru mu, önbellekteki özeti tutuyor mu.
 * `unverified`: boyut doğru ama özet henüz hesaplanmamış (ya da dosya değişmiş).
 */
export function quickState(root: string, spec: FileSpec, cache: VerifyCache): FileState {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolveModelPath(root, spec.path));
  } catch {
    return 'missing';
  }
  if (!stat.isFile()) return 'missing';
  if (stat.size !== spec.bytes) return 'mismatch';
  const known = cache.lookup(spec.path, stat);
  if (known === null) return 'unverified';
  return known === spec.sha256 ? 'ready' : 'mismatch';
}

/** Dosyanın özetini hesaplayıp beklenenle karşılaştırır; sonucu önbelleğe yazar. */
export async function verifyFile(
  root: string,
  spec: FileSpec,
  cache: VerifyCache,
  signal?: AbortSignal,
): Promise<boolean> {
  const state = quickState(root, spec, cache);
  if (state === 'ready') return true;
  if (state !== 'unverified') return false;
  const file = resolveModelPath(root, spec.path);
  const sha256 = await hashFile(file, signal);
  cache.record(spec.path, fs.statSync(file), sha256);
  return sha256 === spec.sha256;
}

/**
 * Bilinen bir yerel kaynak klasörü. Hedef yolun sondan parçaları sırayla denenir:
 * `piper/2023.11.14-2/espeak-ng-data/tr_dict` için önce tam yol, sonra `2023.11.14-2/…`, en son `tr_dict`.
 * Böylece hem model klasörünün aynası olan önbellek hem v1'in düz klasörleri aynı kuralla taranır.
 */
export interface LocalSource {
  dir: string;
  /** Kaynağın kendi doğrulama önbelleği varsa (ayna önbellek) özet yeniden hesaplanmaz. */
  cache?: VerifyCache;
}

function candidatePaths(source: LocalSource, relative: string): Array<{ file: string; relative: string }> {
  const parts = relative.split('/');
  const out: Array<{ file: string; relative: string }> = [];
  for (let skip = 0; skip < parts.length; skip++) {
    const rest = parts.slice(skip);
    out.push({ file: path.join(source.dir, ...rest), relative: rest.join('/') });
  }
  return out;
}

/** Özeti tutan bir yerel kopyanın yolunu döndürür; yoksa `null`. */
export async function findLocalCopy(
  spec: FileSpec,
  sources: LocalSource[],
  ownCache: VerifyCache,
  signal?: AbortSignal,
): Promise<string | null> {
  for (const source of sources) {
    for (const candidate of candidatePaths(source, spec.path)) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(candidate.file);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size !== spec.bytes) continue;
      let sha256 = source.cache?.lookup(candidate.relative, stat) ?? ownCache.lookupExternal(candidate.file, stat);
      if (sha256 === null) {
        sha256 = await hashFile(candidate.file, signal);
        ownCache.recordExternal(candidate.file, stat, sha256);
      }
      if (sha256 === spec.sha256) return candidate.file;
    }
  }
  return null;
}

/**
 * Doğrulanmış kaynağı hedefe yerleştirir: aynı sürücüdeyse sabit bağlantı (anında, yer kaplamaz),
 * değilse kopya. Sabit bağlantı aynı içeriktir; kopya yeniden özetlenir.
 */
export async function placeFile(
  root: string,
  spec: FileSpec,
  sourceFile: string,
  cache: VerifyCache,
): Promise<'linked' | 'copied'> {
  const target = resolveModelPath(root, spec.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  removeFile(target);
  let how: 'linked' | 'copied' = 'linked';
  try {
    fs.linkSync(sourceFile, target);
  } catch {
    how = 'copied';
    const temp = `${target}.part`;
    await fs.promises.copyFile(sourceFile, temp);
    const sha256 = await hashFile(temp);
    if (sha256 !== spec.sha256) {
      removeFile(temp);
      throw new Error(`kopya özeti tutmadı: ${spec.path}`);
    }
    fs.renameSync(temp, target);
  }
  cache.record(spec.path, fs.statSync(target), spec.sha256);
  return how;
}
