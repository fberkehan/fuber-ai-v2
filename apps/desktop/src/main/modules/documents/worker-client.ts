/**
 * Belge işçisinin ana süreç tarafı: ayrı süreç (Electron `utilityProcess`; sınamada `worker_threads`), kesin süre
 * (varsayılan 45 sn) ve bellek sınırı (V8 yığını 512 MB). Süre dolarsa ya da süreç çökerse süreç öldürülür, çağıran
 * tek satırlık hata alır; ana süreç hiçbir durumda donmaz ya da bellek dolarak çökmez (v1 `belge-ayristir.ts`).
 * İstekler sırayla gider; süreç birkaç istek boyunca açık kalır (açılış ~150 ms), sonra yenilenir.
 */
import { Worker } from 'node:worker_threads';
import type {
  GenerateContent,
  GenerateRequest,
  GenerateResponse,
  ParseRequest,
  ParseResponse,
  WorkerRequest,
  WorkerResponse,
} from './worker/protocol';

export const PARSE_TIMEOUT_MS = 45_000;
export const WORKER_MEMORY_MB = 512;
/** Bu kadar istekten sonra süreç yenilenir (sızıntı birikmesin). */
const MAX_REQUESTS_PER_PROCESS = 25;
/** Boşta bu kadar kalan süreç kapatılır. */
const IDLE_MS = 20_000;

export type RunFailure = { ok: false; code: 'timeout' | 'memory' | 'crashed' | 'aborted'; error: string };
export type ParseResult = ParseResponse | RunFailure;
export type GenerateResult = GenerateResponse | RunFailure;

export interface DocWorker {
  parse(request: Omit<ParseRequest, 'op'>, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ParseResult>;
  generate(format: 'docx' | 'xlsx' | 'pptx', content: GenerateContent, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<GenerateResult>;
  dispose(): void;
}

/** Süreç soyutlaması: utilityProcess ile worker_threads aynı yüzü verir. */
interface Child {
  post(message: WorkerRequest): void;
  onMessage(listener: (message: WorkerResponse) => void): void;
  onExit(listener: (reason: { code: number | null; oom: boolean; error?: string }) => void): void;
  kill(): void;
}

export interface DocWorkerOptions {
  /** Derlenmiş işçi betiği (`dist/doc-worker/index.js`). */
  workerPath: string;
  /**
   * `utility`: Electron yardımcı süreci (üretim) · `process`: Node alt süreci (sınama; yerel eklentili pdf.js ayrı
   * süreçte kalsın) · `thread`: worker_threads (yalnız yerel eklenti yüklemeyen sahte işçiler).
   */
  mode: 'utility' | 'process' | 'thread';
  memoryMb?: number;
  timeoutMs?: number;
}

/** Windows çıkış kodları: V8 bellek yetmezliği (134 / 3), yığın taşması (0xC00000FD). */
const OOM_EXIT_CODES = new Set([134, 3, -1073741571, 3221225725]);

async function spawn(options: DocWorkerOptions): Promise<Child> {
  const memory = options.memoryMb ?? WORKER_MEMORY_MB;
  if (options.mode === 'utility') {
    const { utilityProcess } = await import('electron');
    const child = utilityProcess.fork(options.workerPath, [], {
      execArgv: [`--max-old-space-size=${memory}`],
      serviceName: 'Fuber AI 2 belge okuyucu',
      stdio: 'ignore',
    });
    return {
      post: (message) => child.postMessage(message),
      onMessage: (listener) => child.on('message', (message: WorkerResponse) => listener(message)),
      onExit: (listener) => child.once('exit', (code) => listener({ code, oom: OOM_EXIT_CODES.has(code) })),
      kill: () => {
        try {
          child.kill();
        } catch {
          // süreç zaten kapandı
        }
      },
    };
  }
  if (options.mode === 'process') {
    const { fork } = await import('node:child_process');
    const child = fork(options.workerPath, [], { execArgv: [`--max-old-space-size=${memory}`], serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    return {
      post: (message) => child.send(message),
      onMessage: (listener) => child.on('message', (message) => listener(message as WorkerResponse)),
      onExit: (listener) => child.once('exit', (code) => listener({ code, oom: code !== null && OOM_EXIT_CODES.has(code) })),
      kill: () => {
        child.kill();
      },
    };
  }
  const worker = new Worker(options.workerPath, {
    resourceLimits: { maxOldGenerationSizeMb: memory, maxYoungGenerationSizeMb: 32 },
    stdout: true,
    stderr: true,
  });
  let exitListener: ((reason: { code: number | null; oom: boolean; error?: string }) => void) | null = null;
  let reported = false;
  const report = (reason: { code: number | null; oom: boolean; error?: string }) => {
    if (reported) return;
    reported = true;
    exitListener?.(reason);
  };
  worker.on('error', (error: NodeJS.ErrnoException) => report({ code: null, oom: error?.code === 'ERR_WORKER_OUT_OF_MEMORY', error: String(error?.message ?? error) }));
  worker.on('exit', (code) => report({ code, oom: false }));
  return {
    post: (message) => worker.postMessage(message),
    onMessage: (listener) => worker.on('message', listener),
    onExit: (listener) => {
      exitListener = listener;
    },
    kill: () => void worker.terminate(),
  };
}

export function createDocWorker(options: DocWorkerOptions): DocWorker {
  let child: Child | null = null;
  let served = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  let chain: Promise<unknown> = Promise.resolve();
  let disposed = false;
  /** Süren isteğin sonuçlandırıcısı (süreç ölürse hemen çağrılır). */
  let inflight: { id: number; child: Child; settle(response: WorkerResponse | RunFailure): void } | null = null;

  const drop = () => {
    const current = child;
    child = null;
    served = 0;
    current?.kill();
  };

  const ensure = async (): Promise<Child> => {
    if (child && served < MAX_REQUESTS_PER_PROCESS) return child;
    if (child) drop();
    const created = await spawn(options);
    created.onMessage((message) => {
      if (inflight && inflight.child === created && message.id === inflight.id) inflight.settle(message);
    });
    created.onExit((reason) => {
      if (child === created) child = null;
      // Yalnız bu sürece verilmiş istek sonuçlanır: öldürülen eski sürecin geç gelen çıkışı yeni isteği bozmasın.
      if (!inflight || inflight.child !== created) return;
      inflight.settle(
        reason.oom
          ? { ok: false, code: 'memory', error: 'okumak için gereken bellek sınırı aştı (dosya çok büyük ya da bozuk)' }
          : { ok: false, code: 'crashed', error: `okuyucu süreç beklenmedik biçimde kapandı${reason.error ? ` (${reason.error.slice(0, 120)})` : reason.code !== null ? ` (${reason.code})` : ''}` },
      );
    });
    child = created;
    return created;
  };

  const run = <T extends WorkerResponse>(request: ParseRequest | GenerateRequest, timeoutMs: number, signal?: AbortSignal): Promise<T | RunFailure> => {
    const job = chain.then(async (): Promise<T | RunFailure> => {
      if (disposed) return { ok: false, code: 'aborted', error: 'belge okuyucu kapatıldı' };
      if (signal?.aborted) return { ok: false, code: 'aborted', error: 'iptal edildi' };
      if (idle) {
        clearTimeout(idle);
        idle = null;
      }
      let worker: Child;
      try {
        worker = await ensure();
      } catch (error) {
        return { ok: false, code: 'crashed', error: `okuyucu süreç başlatılamadı: ${String((error as Error)?.message ?? error).slice(0, 160)}` };
      }
      served++;
      const id = nextId++;
      return new Promise<T | RunFailure>((resolve) => {
        let done = false;
        const settle = (response: WorkerResponse | RunFailure) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          inflight = null;
          if ('id' in response) {
            const { id: _id, ...rest } = response;
            resolve(rest as unknown as T);
          } else {
            resolve(response);
          }
          if (!disposed) idle = setTimeout(drop, IDLE_MS);
        };
        const timer = setTimeout(() => {
          drop();
          settle({ ok: false, code: 'timeout', error: `${Math.round(timeoutMs / 1000)} sn içinde bitmedi (dosya çok büyük ya da bozuk olabilir)` });
        }, timeoutMs);
        const onAbort = () => {
          drop();
          settle({ ok: false, code: 'aborted', error: 'iptal edildi' });
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        inflight = { id, child: worker, settle };
        worker.post({ ...request, id } as WorkerRequest);
      });
    });
    chain = job.catch(() => undefined);
    return job;
  };

  return {
    parse: (request, runOptions = {}) =>
      run<WorkerResponse & ParseResponse>({ op: 'parse', ...request }, runOptions.timeoutMs ?? options.timeoutMs ?? PARSE_TIMEOUT_MS, runOptions.signal) as Promise<ParseResult>,
    generate: (format, content, runOptions = {}) =>
      run<WorkerResponse & GenerateResponse>({ op: 'generate', format, content }, runOptions.timeoutMs ?? options.timeoutMs ?? PARSE_TIMEOUT_MS, runOptions.signal) as Promise<GenerateResult>,
    dispose() {
      disposed = true;
      if (idle) clearTimeout(idle);
      inflight?.settle({ ok: false, code: 'aborted', error: 'belge okuyucu kapatıldı' });
      drop();
    },
  };
}
