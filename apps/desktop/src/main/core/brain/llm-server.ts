// Sahibi: T2. Yerel beynin `llama-server` alt süreci: rastgele port (yalnız 127.0.0.1), sağlık denetimi,
// GPU doğrulaması (işlemciye sessiz düşüş yok), boşta kapatma, çökünce üstel bekleme, üç denemede vazgeçme.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { LOCAL_MODEL_IDS, LOCAL_MODEL_PATHS, type Logger, type ModelsApi, type PolicyApi } from '@fuber/shared';

export const LLM_IDLE_MS = 10 * 60_000;
const HEALTH_TIMEOUT_MS = 120_000;
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 3;
/** KV önbelleği ve CUDA bağlamı için model dosyasının üstüne gereken pay. */
const VRAM_HEADROOM_MIB = 900;

export interface LlmFiles {
  serverExe: string;
  modelFile: string;
  modelId: string;
}

export type LlmServerState = 'stopped' | 'starting' | 'ready' | 'failed';

export interface LlmServerStatus {
  state: LlmServerState;
  /** Kullanılamıyorsa Türkçe neden. */
  reason: string | null;
  baseUrl: string | null;
  modelId: string | null;
}

export interface LlmServer {
  /** Dosyalar yerinde ve kalıcı olarak düşmemiş mi (süreç kapalı olabilir; ilk kullanımda açılır). */
  available(): { ok: boolean; reason: string | null };
  /** Süreci gerekirse başlatır; hazır taban adresi döner. Kullanılamıyorsa Türkçe nedenle fırlatır. */
  ensure(): Promise<string>;
  /** Kullanım oldu: boşta kapatma sayacı yeniden başlar. */
  touch(): void;
  status(): LlmServerStatus;
  stop(): Promise<void>;
}

export interface GpuProbe {
  /** Boş ekran belleği (MiB); ölçülemezse `null`. */
  freeMiB(): Promise<number | null>;
  /** Bu süreç CUDA bağlamı açmış mı (GPU'da mı); ölçülemezse `null`. */
  usesGpu(pid: number): Promise<boolean | null>;
}

export interface LlmServerDeps {
  log: Logger;
  policy: PolicyApi;
  models?: ModelsApi;
  /** Dosyaların yeri; verilmezse `models` + politikadan çözülür. */
  resolve?: () => LlmFiles | null;
  gpu?: GpuProbe;
  idleMs?: number;
  contextTokens?: () => number;
  /**
   * Şu an bir sesli tur sürüyor mu (dinleme / düşünme / konuşma). `true` iken boşta kapatma ERTELENİR: ekran belleği
   * tam kullanıcı konuşurken bırakılıp hemen yeniden yüklenmez. Bu "aç-kapa savaşı" ses konağını (Supertonic/EMA)
   * işlemciye düşürüyordu. Verilmezse boşta kapatma olağan işler.
   */
  voiceBusy?: () => boolean;
  spawnFn?: typeof spawn;
  fetchFn?: typeof fetch;
}

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  );

export const nvidiaSmiProbe: GpuProbe = {
  async freeMiB() {
    try {
      const out = await run('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits']);
      const values = out.split(/\r?\n/).map((line) => Number.parseInt(line, 10)).filter(Number.isFinite);
      return values.length ? Math.max(...values) : null;
    } catch {
      return null;
    }
  },
  async usesGpu(pid) {
    try {
      const out = await run('nvidia-smi', ['--query-compute-apps=pid', '--format=csv,noheader']);
      return out.split(/\r?\n/).some((line) => Number.parseInt(line, 10) === pid);
    } catch {
      return null;
    }
  },
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('port yok'))));
    });
  });
}

/**
 * Varsayılan çözümleyici: model yöneticisinin dosya yolları + `policy.brain.local.modelId`. Dosyaları yerleştirmek
 * (özet doğrulaması, yerel kaynaktan bağlama) yalnız model yöneticisinin işidir; burada yalnız yol sorulur.
 * Sunucu ya da model listede yoksa ya da hazır değilse `null` (yerel beyin "kurulu değil").
 */
export function resolveFromModels(models: ModelsApi, policy: PolicyApi): LlmFiles | null {
  const modelId = policy.get().brain.local.modelId;
  const modelFile = models.filePath(modelId);
  const serverExe = models.filePath(LOCAL_MODEL_IDS.llamaServer, LOCAL_MODEL_PATHS.llamaServer);
  return modelFile && serverExe ? { serverExe, modelFile, modelId } : null;
}

export function createLlmServer(deps: LlmServerDeps): LlmServer {
  const log = deps.log.child('llm-server');
  const gpu = deps.gpu ?? nvidiaSmiProbe;
  const doSpawn = deps.spawnFn ?? spawn;
  const doFetch = deps.fetchFn ?? fetch;
  const idleMs = deps.idleMs ?? LLM_IDLE_MS;
  const resolve = deps.resolve ?? (() => (deps.models ? resolveFromModels(deps.models, deps.policy) : null));

  let child: ChildProcess | null = null;
  let baseUrl: string | null = null;
  let modelId: string | null = null;
  let state: LlmServerState = 'stopped';
  let reason: string | null = null;
  let starting: Promise<string> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const crashes: number[] = [];
  let stoppingOnPurpose = false;

  // Windows'ta alt süreç ana süreçle birlikte ölmez: uygulama nasıl kapanırsa kapansın sunucu VRAM'de kalmasın.
  process.once('exit', () => kill(child));

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      // Sesli tur sürerken bırakma: tam konuşurken ekran belleğini boşaltıp hemen yeniden yüklemek, ses konağını
      // işlemciye düşüren aç-kapa savaşına yol açıyordu. Tur bitene dek ertelenir; boşta kalınca bir sonraki tur kapatır.
      if (state === 'ready' && deps.voiceBusy?.()) {
        armIdle();
        return;
      }
      log.info('yerel beyin boşta; ekran belleği geri veriliyor');
      void stop();
    }, idleMs);
    idleTimer.unref?.();
  };

  const kill = (proc: ChildProcess | null) => {
    if (!proc || proc.exitCode !== null) return;
    try {
      proc.kill();
    } catch {
      // zaten kapalı
    }
  };

  const stop = async () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const proc = child;
    child = null;
    baseUrl = null;
    if (state !== 'failed') state = 'stopped';
    if (!proc || proc.exitCode !== null) return;
    stoppingOnPurpose = true;
    await new Promise<void>((done) => {
      proc.once('exit', () => done());
      kill(proc);
      setTimeout(done, 3000).unref?.();
    });
    stoppingOnPurpose = false;
  };

  const fail = (message: string): never => {
    state = 'failed';
    reason = message;
    throw new Error(message);
  };

  const start = async (): Promise<string> => {
    const now = Date.now();
    while (crashes.length && now - crashes[0]! > CRASH_WINDOW_MS) crashes.shift();
    if (crashes.length >= MAX_CRASHES) fail('Yerel beyin kullanılamıyor: sunucu art arda kapandı.');
    if (crashes.length > 0) {
      const delay = 1000 * 2 ** (crashes.length - 1);
      await new Promise((done) => setTimeout(done, delay));
    }
    const files = resolve();
    if (!files) return fail('Yerel beyin kullanılamıyor: model ya da sunucu dosyası yok.');

    let modelMiB: number;
    try {
      modelMiB = fs.statSync(files.modelFile).size / 1_048_576;
    } catch {
      // Dosya, model yöneticisi "hazır" dedikten sonra silinmiş ya da taşınmış. Kalıcı sayılmaz: yeniden yerleştirilebilir.
      state = 'stopped';
      reason = 'Yerel beyin kullanılamıyor: model dosyası okunamadı.';
      throw new Error(reason);
    }
    const free = await gpu.freeMiB();
    if (free === null) return fail('Yerel beyin kullanılamıyor: ekran kartı bulunamadı (işlemciyle çalıştırılmaz).');
    if (free < modelMiB + VRAM_HEADROOM_MIB) {
      // Kalıcı değil: başka uygulama belleği bırakınca yeniden denenebilir.
      state = 'stopped';
      reason = 'Yerel beyin için yeterli ekran belleği yok.';
      throw new Error(reason);
    }

    const port = await freePort();
    const context = deps.contextTokens?.() ?? deps.policy.get().brain.local.contextTokens;
    // Model dosyası çalışma klasörüne göre göreli verilir: Türkçe harfli/boşluklu tam yolda llama/whisper ikilileri çökebiliyor.
    const args = [
      '-m', path.basename(files.modelFile),
      '--host', '127.0.0.1',
      '--port', String(port),
      '-ngl', '99',
      '-c', String(context),
      '-np', '1',
      '--jinja',
      '--no-webui',
    ];
    state = 'starting';
    reason = null;
    let proc: ChildProcess;
    try {
      proc = doSpawn(files.serverExe, args, { cwd: path.dirname(files.modelFile), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      log.warn('yerel sunucu başlatılamadı', error);
      return fail('Yerel beyin kullanılamıyor: sunucu başlatılamadı.');
    }
    // Çalıştırılabilir dosya yoksa `spawn` fırlatmaz, `error` olayı yayınlar; dinlenmezse süreç düşer.
    proc.on('error', (error) => {
      log.warn('yerel sunucu başlatılamadı', error);
      if (child !== proc) return;
      child = null;
      baseUrl = null;
      state = 'stopped';
      reason = 'Yerel beyin kullanılamıyor: sunucu başlatılamadı.';
    });
    let stderr = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-4000);
    });
    child = proc;
    proc.on('exit', (code) => {
      if (child !== proc) return;
      child = null;
      baseUrl = null;
      if (stoppingOnPurpose) return;
      crashes.push(Date.now());
      state = 'stopped';
      reason = `Yerel sunucu kapandı (kod ${code}).`;
      log.warn(`${reason} ${stderr.split('\n').filter((line) => /error|fail|out of memory/i.test(line)).slice(-2).join(' ')}`);
    });

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child !== proc) throw new Error(reason ?? 'Yerel sunucu açılırken kapandı.');
      try {
        const response = await doFetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && ((await response.json()) as { status?: string }).status === 'ok') break;
      } catch {
        // yükleniyor
      }
      await new Promise((done) => setTimeout(done, 300));
    }
    if (Date.now() >= deadline) {
      kill(proc);
      return fail('Yerel beyin kullanılamıyor: sunucu iki dakikada hazır olmadı.');
    }
    const onGpu = proc.pid ? await gpu.usesGpu(proc.pid) : null;
    if (onGpu === false) {
      await stop();
      return fail('Yerel beyin kullanılamıyor: model ekran kartına yüklenemedi (işlemciye düşülmedi).');
    }
    baseUrl = url;
    modelId = files.modelId;
    state = 'ready';
    log.info(`yerel beyin hazır: ${files.modelId} (${Math.round(modelMiB)} MiB)`);
    armIdle();
    return url;
  };

  return {
    available() {
      if (state === 'failed') return { ok: false, reason };
      if (state === 'ready' || state === 'starting') return { ok: true, reason: null };
      try {
        const files = resolve();
        return files ? { ok: true, reason: null } : { ok: false, reason: 'Yerel model kurulu değil.' };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async ensure() {
      if (state === 'ready' && baseUrl && child) {
        armIdle();
        return baseUrl;
      }
      starting ??= start().finally(() => {
        starting = null;
      });
      return starting;
    },
    touch: () => {
      if (state === 'ready') armIdle();
    },
    status: () => ({ state, reason, baseUrl, modelId }),
    stop,
  };
}
