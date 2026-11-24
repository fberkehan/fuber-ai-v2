/**
 * Yetenek konağının ana süreçteki yöneticisi: süreci başlatır, istek/yanıt eşler, zaman aşımını uygular,
 * yanıt vermeyen ya da çöken konağı öldürüp yeniden başlatır ve etkin yetenekleri yeniden yükler.
 *
 * Yalıtım kuralı: bir yetenekteki sonsuz döngü konağın olay döngüsünü kilitler; bunu durdurmanın tek yolu
 * süreci öldürmektir. Öldürülen konaktaki diğer çağrılar "yeniden başlatıldı" hatasıyla döner; yeni konak
 * etkin yetenekleri geri yükler, uygulama ve diğer yetenekler çalışmayı sürdürür.
 *
 * Süreç soyut bir arayüzdür (`HostProcess`): uygulamada Electron `utilityProcess`, sınamada Node çocuk süreci.
 */
import type { Logger } from '@fuber/shared';
import type {
  BridgeCall,
  HostRequest,
  HostResult,
  HostToMain,
  MainToHost,
  SelftestOutcome,
  SelftestSpec,
  SkillToolResult,
} from '../../../skill-host/protocol';

export interface HostProcess {
  postMessage(message: MainToHost): void;
  onMessage(listener: (message: HostToMain) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export interface SkillHostOptions {
  /** Yeni bir konak süreci başlatır. */
  spawn(): HostProcess;
  log: Logger;
  /** Yetenek kodunun `ctx` isteğini karşılar; reddederse ileti yeteneğe hata olarak döner. */
  bridge(call: BridgeCall): Promise<unknown>;
  /** Yeteneğin `ctx.log` / `console` satırları ve konağın kendi uyarıları (`skillId` boş). */
  onLog?(entry: { skillId: string; level: 'info' | 'warn' | 'error'; text: string }): void;
  /** Yeniden başlatmadan sonra geri yüklenemeyen (ya da yüklenirken konağı düşüren) yetenek. */
  onSkillDropped?(skillId: string, reason: string): void;
  timeouts?: Partial<HostTimeouts>;
}

export interface HostTimeouts {
  /** Konağın "hazır" demesi için tanınan süre. */
  startMs: number;
  loadMs: number;
  callMs: number;
  selftestMs: number;
  /** Zaman aşımından sonra konağın hâlâ yanıt verip vermediğini anlamak için. */
  pingMs: number;
}

export const DEFAULT_TIMEOUTS: HostTimeouts = {
  startMs: 10_000,
  loadMs: 10_000,
  callMs: 20_000,
  selftestMs: 60_000,
  pingMs: 1_500,
};

/** Çağrı zamanında bitmedi. `restarted`: konak yanıt vermediği için öldürüldü. */
export class HostTimeoutError extends Error {
  constructor(
    message: string,
    readonly restarted: boolean,
  ) {
    super(message);
    this.name = 'HostTimeoutError';
  }
}

/** Konak, çağrı sürerken çöktü ya da başka bir yetenek yüzünden yeniden başlatıldı. */
export class HostRestartedError extends Error {
  constructor(message = 'Yetenek konağı yeniden başlatıldı; işlem tamamlanmadı.') {
    super(message);
    this.name = 'HostRestartedError';
  }
}

export class HostAbortedError extends Error {
  constructor() {
    super('İşlem iptal edildi.');
    this.name = 'HostAbortedError';
  }
}

interface Pending {
  request: HostRequest;
  resolve(value: HostResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Running {
  process: HostProcess;
  ready: Promise<void>;
  pending: Map<number, Pending>;
  alive: boolean;
  /** Yetenek koduna en son giren `call` isteği (konak "çalışıyor" dedi, yanıt henüz gelmedi). */
  lastRunning: number | null;
  /** Süren "konak yanıt veriyor mu" yoklaması; aynı anda zaman aşımına düşen çağrılar tek yoklamayı paylaşır. */
  probe: Promise<void> | null;
}

/** Kısa sürede bu kadar çöküşten sonra konak kendiliğinden yeniden başlatılmaz; bir sonraki istekte denenir. */
const CRASH_LIMIT = 5;
const CRASH_WINDOW_MS = 60_000;

export interface SkillHost {
  /** Yeteneği canlı konağa yükler ve yeniden başlatmalarda geri yüklenecekler listesine alır. */
  load(skillId: string, script: string): Promise<string[]>;
  unload(skillId: string): Promise<void>;
  call(skillId: string, tool: string, input: unknown, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<SkillToolResult>;
  selftest(
    request: { skillId: string; script: string; selftestScript: string; spec: SelftestSpec },
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<SelftestOutcome>;
  /** Konak yanıt veriyor mu. Süreç yoksa başlatılmaz, `false` döner. */
  ping(): Promise<boolean>;
  /** Geri yüklenecekler listesindeki yetenekler. */
  loaded(): string[];
  /** Bugüne dek kaç kez yeniden başlatıldı (tanı ve sınama için). */
  restarts(): number;
  /** Süreci kapatır; bekleyen işler reddedilir. Sonraki istek yeni süreç başlatır. */
  stop(): void;
}

export function createSkillHost(options: SkillHostOptions): SkillHost {
  const { log } = options;
  const timeouts: HostTimeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  /** Canlı yüklü olması istenen yetenekler: kimlik → gövde. */
  const desired = new Map<string, string>();
  let running: Running | null = null;
  let nextId = 1;
  let restartCount = 0;
  let crashes: number[] = [];
  let reloading: Promise<void> | null = null;

  const rejectAll = (target: Running, error: Error) => {
    for (const entry of target.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    target.pending.clear();
  };

  const onMessage = (target: Running, message: HostToMain, markReady: () => void) => {
    if (!target.alive) return;
    switch (message.kind) {
      case 'ready':
        markReady();
        return;
      case 'running':
        target.lastRunning = message.id;
        return;
      case 'response': {
        if (target.lastRunning === message.id) target.lastRunning = null;
        const entry = target.pending.get(message.id);
        if (!entry) return;
        target.pending.delete(message.id);
        if (entry.timer) clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message.result);
        else entry.reject(new Error(message.error));
        return;
      }
      case 'bridge': {
        const { id, kind: _kind, ...call } = message;
        const reply = (reply: MainToHost) => {
          if (target.alive) target.process.postMessage(reply);
        };
        Promise.resolve()
          .then(() => options.bridge(call))
          .then(
            (value) => reply({ kind: 'bridge-reply', id, ok: true, value: value ?? null }),
            (error: unknown) => reply({ kind: 'bridge-reply', id, ok: false, error: error instanceof Error ? error.message : String(error) }),
          );
        return;
      }
      case 'log':
        options.onLog?.({ skillId: message.skillId, level: message.level, text: message.text });
        return;
    }
  };

  const spawn = (): Running => {
    const process = options.spawn();
    let markReady: () => void = () => {};
    let failReady: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failReady = reject;
    });
    const target: Running = { process, ready, pending: new Map(), alive: true, lastRunning: null, probe: null };
    const startTimer = setTimeout(() => failReady(new Error('yetenek konağı başlatılamadı (zaman aşımı)')), timeouts.startMs);
    ready.then(
      () => clearTimeout(startTimer),
      (error: Error) => {
        clearTimeout(startTimer);
        // Hazır olamayan süreç bırakılmaz: bir sonraki istek yenisini başlatır.
        kill(target, error);
      },
    );
    process.onMessage((message) => onMessage(target, message, markReady));
    process.onExit((code) => {
      if (!target.alive) return;
      target.alive = false;
      failReady(new Error('yetenek konağı başlamadan kapandı'));
      if (running === target) running = null;
      rejectAll(target, new HostRestartedError());
      log.warn(`yetenek konağı beklenmedik biçimde kapandı (kod ${code ?? '?'})`);
      afterDeath();
    });
    return target;
  };

  /** `culprit`: konağı kilitleyen çağrı; o "zaman aşımı", diğerleri "yeniden başlatıldı" hatası alır. */
  const kill = (target: Running, error: Error, culprit?: { id: number; error: Error }) => {
    if (!target.alive) return;
    target.alive = false;
    if (running === target) running = null;
    if (culprit) {
      const entry = target.pending.get(culprit.id);
      if (entry) {
        target.pending.delete(culprit.id);
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(culprit.error);
      }
    }
    rejectAll(target, error);
    try {
      target.process.kill();
    } catch (failure) {
      log.warn('yetenek konağı öldürülemedi', failure);
    }
  };

  /** Konak öldükten sonra: etkin yetenek varsa yenisini başlatıp geri yükler (çöküş döngüsüne girmeden). */
  const afterDeath = () => {
    restartCount++;
    const now = Date.now();
    crashes = [...crashes.filter((at) => now - at < CRASH_WINDOW_MS), now];
    if (desired.size === 0) return;
    if (crashes.length > CRASH_LIMIT) {
      log.error('yetenek konağı art arda çöküyor; kendiliğinden yeniden başlatma durduruldu');
      return;
    }
    void ensure().catch((error: unknown) => log.error('yetenek konağı yeniden başlatılamadı', error));
  };

  const send = (target: Running, request: HostRequest, timeoutMs: number | null): Promise<HostResult> =>
    new Promise<HostResult>((resolve, reject) => {
      if (!target.alive) {
        reject(new HostRestartedError());
        return;
      }
      const id = nextId++;
      const entry: Pending = { request, resolve, reject, timer: null };
      if (timeoutMs !== null) entry.timer = setTimeout(() => onTimeout(target, id), timeoutMs);
      target.pending.set(id, entry);
      target.process.postMessage({ kind: 'request', id, request });
    });

  const describe = (request: HostRequest) => (request.op === 'call' ? `${request.skillId} › ${request.tool}` : request.op);

  const responds = (target: Running): Promise<boolean> =>
    Promise.race([
      send(target, { op: 'ping' }, null).then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeouts.pingMs)),
    ]);

  /**
   * Zaman aşımı: konak yanıt veriyorsa yalnız bu çağrı düşer (eşzamansız bir beklemede takılmıştır). Vermiyorsa bir
   * yetenek olay döngüsünü kilitlemiştir: süreç öldürülür. Kilitleyen, yetenek koduna en son giren çağrıdır;
   * o bilinmiyorsa ilk zaman aşımına düşen.
   */
  const onTimeout = (target: Running, id: number) => {
    if (!target.alive || !target.pending.has(id)) return;
    target.probe ??= (async () => {
      const alive = await responds(target);
      target.probe = null;
      if (alive || !target.alive) return;
      const culpritId = target.lastRunning !== null && target.pending.has(target.lastRunning) ? target.lastRunning : id;
      const culprit = target.pending.get(culpritId)?.request;
      const what = culprit ? describe(culprit) : '?';
      log.warn(`yetenek konağı yanıt vermiyor (${what}); süreç yeniden başlatılıyor`);
      if (culprit?.op === 'load') dropSkill(culprit.skillId, 'Yüklenirken konak yanıt vermedi.');
      kill(target, new HostRestartedError(), {
        id: culpritId,
        error: new HostTimeoutError(`Zaman aşımı: ${what} yanıt vermedi; yetenek konağı yeniden başlatıldı.`, true),
      });
      afterDeath();
    })();
    void target.probe.then(() => {
      const entry = target.pending.get(id);
      if (!entry || !target.alive) return;
      target.pending.delete(id);
      entry.reject(new HostTimeoutError(`Zaman aşımı: ${describe(entry.request)} zamanında bitmedi.`, false));
    });
  };

  const dropSkill = (skillId: string, reason: string) => {
    if (!desired.delete(skillId)) return;
    try {
      options.onSkillDropped?.(skillId, reason);
    } catch (error) {
      log.warn('yetenek düşürme bildirimi hata verdi', error);
    }
  };

  /** Çalışan, hazır ve etkin yetenekleri yüklü bir konak döndürür. */
  const ensure = async (): Promise<Running> => {
    if (running?.alive) {
      await running.ready;
      if (reloading) await reloading;
      if (running?.alive) return running;
    }
    const target = spawn();
    running = target;
    const reload = (async () => {
      await target.ready;
      for (const [skillId, script] of [...desired]) {
        if (!target.alive) return;
        try {
          await send(target, { op: 'load', skillId, script }, timeouts.loadMs);
        } catch (error) {
          // Konak bu yetenek yüklenirken düştüyse yetenek zaten düşürülmüştür; diğer hatalarda burada düşer.
          dropSkill(skillId, error instanceof Error ? error.message : String(error));
          if (!target.alive) return;
        }
      }
    })();
    const tracked: Promise<void> = reload.finally(() => {
      if (reloading === tracked) reloading = null;
    });
    reloading = tracked;
    await tracked;
    if (!target.alive) throw new HostRestartedError();
    return target;
  };

  const withSignal = <T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
    if (!signal) return work;
    if (signal.aborted) return Promise.reject(new HostAbortedError());
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new HostAbortedError());
      signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  };

  return {
    async load(skillId, script) {
      const target = await ensure();
      const result = (await send(target, { op: 'load', skillId, script }, timeouts.loadMs)) as { tools: string[] };
      desired.set(skillId, script);
      return result.tools;
    },

    async unload(skillId) {
      desired.delete(skillId);
      const target = running;
      if (!target?.alive) return;
      try {
        await send(target, { op: 'unload', skillId }, timeouts.loadMs);
      } catch (error) {
        log.debug(`yetenek boşaltılamadı (${skillId}): ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async call(skillId, tool, input, callOptions = {}) {
      const work = (async () => {
        const target = await ensure();
        if (!desired.has(skillId)) throw new Error(`yetenek yüklü değil: ${skillId}`);
        const result = (await send(target, { op: 'call', skillId, tool, input }, callOptions.timeoutMs ?? timeouts.callMs)) as {
          result: SkillToolResult;
        };
        return result.result;
      })();
      return withSignal(work, callOptions.signal);
    },

    async selftest(request, callOptions = {}) {
      const work = (async () => {
        const target = await ensure();
        return (await send(target, { op: 'selftest', ...request }, callOptions.timeoutMs ?? timeouts.selftestMs)) as SelftestOutcome;
      })();
      return withSignal(work, callOptions.signal);
    },

    async ping() {
      const target = running;
      if (!target?.alive) return false;
      return responds(target);
    },

    loaded: () => [...desired.keys()],
    restarts: () => restartCount,

    stop() {
      desired.clear();
      if (running) kill(running, new HostRestartedError('Yetenek konağı kapatıldı.'));
    },
  };
}
