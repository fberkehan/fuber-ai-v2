/**
 * Ağdan model indirme: yarıda kalınca kaldığı yerden süren (HTTP Range) indirme ve zip arşivinden dosya çıkarma.
 * Electron'a dokunmaz; `models.ts` kullanır. Özet (SHA-256) doğrulaması çağıranındır: buradan çıkan hiçbir dosya
 * doğrulanmadan kullanılmaz.
 *
 * Yarım dosya `<hedef>.part` olarak durur. İptalde ve ağ hatasında SİLİNMEZ (sonraki deneme oradan sürer);
 * içerik bozuksa (özet tutmadı) çağıran siler.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class DownloadError extends Error {
  constructor(
    /** `aborted` iptal · `http` sunucu reddetti (yeniden denemek boşuna) · `network` bağlantı sorunu · `extract` arşiv açılamadı */
    readonly code: 'aborted' | 'http' | 'network' | 'extract',
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadOptions {
  url: string;
  /** İndirilen dosyanın son yolu; indirme sürerken `<target>.part`. */
  target: string;
  signal: AbortSignal;
  /** `received`: diskteki toplam bayt (önceki denemelerden kalan dahil); `total`: sunucu bildirdiyse dosya boyu. */
  onProgress?(received: number, total: number | null): void;
  /** Ağ hatasında kaç kez daha denenir (her deneme kaldığı yerden sürer). */
  retries?: number;
  /** İlk yeniden deneme beklemesi (ms); her denemede ikiye katlanır. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export interface DownloadResult {
  bytes: number;
  /** Önceki bir denemeden kalan yarım dosyanın üstüne mi sürdü. */
  resumed: boolean;
  /** Ağ hatası yüzünden yapılan yeniden deneme sayısı. */
  retries: number;
}

const partOf = (target: string): string => `${target}.part`;

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function unlink(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // Yoksa sorun değil.
  }
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** `Content-Range: bytes 100-199/1000` → 1000; yoksa ya da bilinmiyorsa (`*`) `null`. */
function totalFromContentRange(header: string | null): number | null {
  const match = header?.match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

/**
 * Dosyayı indirir. Diskte yarım dosya varsa `Range` ile kaldığı yerden ister; sunucu aralığı desteklemiyorsa
 * (200) baştan alır. Bağlantı koparsa bekleyip yeniden dener ve yine kaldığı yerden sürer.
 */
export async function downloadToFile(options: DownloadOptions): Promise<DownloadResult> {
  const { url, target, signal } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const part = partOf(target);
  const maxRetries = options.retries ?? 3;
  fs.mkdirSync(path.dirname(target), { recursive: true });

  let resumed = false;
  let retries = 0;
  let rangeRejected = false;
  for (;;) {
    if (signal.aborted) throw new DownloadError('aborted', 'indirme iptal edildi');
    const offset = sizeOf(part);
    let response: Response;
    try {
      response = await doFetch(url, {
        redirect: 'follow',
        signal,
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      });
    } catch (error) {
      if (signal.aborted) throw new DownloadError('aborted', 'indirme iptal edildi');
      if (retries >= maxRetries) throw new DownloadError('network', `bağlanılamadı: ${(error as Error).message}`);
      await sleep((options.retryDelayMs ?? 1000) * 2 ** retries++, signal);
      continue;
    }

    if (response.status === 416 && offset > 0 && !rangeRejected) {
      // Yarım dosya sunucudakinden uzun ya da eşit: geçersizdir, baştan alınır.
      rangeRejected = true;
      await response.body?.cancel().catch(() => {});
      unlink(part);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      // 5xx ve 429 geçicidir; diğerleri (404, 403) yeniden denenmez.
      if ((response.status >= 500 || response.status === 429) && retries < maxRetries) {
        await sleep((options.retryDelayMs ?? 1000) * 2 ** retries++, signal);
        continue;
      }
      throw new DownloadError('http', `HTTP ${response.status}`, response.status);
    }

    const appending = offset > 0 && response.status === 206;
    if (appending) resumed = true;
    const length = Number(response.headers.get('content-length'));
    const total = appending
      ? (totalFromContentRange(response.headers.get('content-range')) ?? (Number.isFinite(length) && length > 0 ? offset + length : null))
      : Number.isFinite(length) && length > 0
        ? length
        : null;
    let received = appending ? offset : 0;
    const out = fs.createWriteStream(part, { flags: appending ? 'a' : 'w' });
    let failure: unknown = null;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        options.onProgress?.(received, total);
        if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', resolve));
      }
    } catch (error) {
      failure = error;
    }
    await new Promise<void>((resolve) => out.end(() => resolve()));

    if (signal.aborted) throw new DownloadError('aborted', 'indirme iptal edildi');
    const complete = failure === null && (total === null || received === total);
    if (complete) {
      unlink(target);
      fs.renameSync(part, target);
      return { bytes: received, resumed, retries };
    }
    // Bağlantı koptu ya da dosya eksik geldi: yarım dosya kalır, kaldığı yerden yeniden denenir.
    if (retries >= maxRetries) {
      throw new DownloadError('network', failure ? `bağlantı koptu: ${(failure as Error).message}` : 'dosya eksik geldi');
    }
    await sleep((options.retryDelayMs ?? 1000) * 2 ** retries++, signal);
  }
}

/** Yarım kalan indirmenin dosyasını siler (özet tutmadığında: içerik bozuk, sürdürmek anlamsız). */
export function discardPartial(target: string): void {
  unlink(partOf(target));
  unlink(target);
}

const TAR = (): string => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

/**
 * Zip arşivinden yalnız istenen dosyaları çıkarır (Windows'un kendi `tar.exe`'si; zip'i de açar).
 * Yollar göreli verilir ve çalışma dizini arşivin klasörüdür: kullanıcı klasöründeki Türkçe harfler komut
 * satırına girmez. Çıkan dosyalar `destDir/<arşiv içi yol>` konumunda olur.
 */
export function extractFromZip(options: { archive: string; entries: string[]; destDir: string; signal: AbortSignal }): Promise<void> {
  const { archive, entries, destDir, signal } = options;
  const cwd = path.dirname(archive);
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DownloadError('aborted', 'indirme iptal edildi'));
    const child = spawn(TAR(), ['-xf', path.basename(archive), '-C', path.relative(cwd, destDir) || '.', ...entries], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    const onAbort = (): void => void child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(new DownloadError('extract', `tar başlatılamadı: ${error.message}`));
    });
    child.on('exit', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) reject(new DownloadError('aborted', 'indirme iptal edildi'));
      else if (code === 0) resolve();
      else reject(new DownloadError('extract', `tar ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** Diskte `bytes` kadar boş yer var mı; ölçülemiyorsa (eski sürüm, ağ sürücüsü) var sayılır. */
export async function hasFreeSpace(dir: string, bytes: number): Promise<boolean> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stats = await fs.promises.statfs(dir);
    return stats.bavail * stats.bsize > bytes;
  } catch {
    return true;
  }
}
