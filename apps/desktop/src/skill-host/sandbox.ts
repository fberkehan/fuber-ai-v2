/**
 * Bir yeteneğin `vm` bağlamı: konak tarafı. Bağlam boş bir küresel nesneyle açılır (`process`, `require`, `fetch`,
 * `Buffer` yok), metinden kod üretimi kapalıdır (`eval`, `new Function`), dinamik `import()` yüklenemez.
 *
 * `node:vm` bir güvenlik sınırı DEĞİLDİR (Node belgeleri de böyle söyler). Buradaki kurgu saldırı yüzeyini küçültür:
 * bağlama konak dünyasından nesne sızdırılmaz, sınırdan yalnız metin geçer. Neyi engellediği ve engellemediği
 * `README.md` içinde yazılıdır.
 */
import vm from 'node:vm';
import { HOST_LIMITS, type BridgeMethod, type SelftestSpec, type SkillToolResult } from './protocol';
import { RUNTIME_SOURCE } from './runtime-source';

export interface SkillContextOptions {
  skillId: string;
  mode: 'live' | 'selftest';
  /** `ctx` isteğini ana sürece iletir. Reddederse ileti yetenek koduna hata olarak döner. */
  bridge(method: BridgeMethod, params: unknown): Promise<unknown>;
  log(level: 'info' | 'warn' | 'error', text: string): void;
}

export interface SkillContext {
  /** `index.mjs` gövdesini koşturur; verdiği araç adlarını döndürür. */
  load(script: string): Promise<string[]>;
  call(tool: string, input: unknown): Promise<SkillToolResult>;
  selftest(script: string, selftestScript: string, spec: SelftestSpec): Promise<{ called: string[]; effects: number }>;
  /** Zamanlayıcıları kapatır, bekleyen işleri reddeder; bağlam bir daha kullanılmaz. */
  dispose(): void;
}

/** Bağlamın içinden bakıldığında bağlam dünyasına ait işlevler; konak bunları yalnız metinle çağırır. */
interface RuntimeApi {
  deliver(text: string): void;
  load(opId: number, moduleFn: unknown): void;
  call(opId: number, name: string, inputText: string): void;
  selftest(opId: number, moduleFn: unknown, selftestFn: unknown, specText: string): void;
}

type FromContext =
  | { t: 'req'; id: number; method: string; params: unknown }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; text: string }
  | { t: 'op'; id: number; ok: true; value: unknown }
  | { t: 'op'; id: number; ok: false; error: { message: string; stack: string } };

const BRIDGE_METHODS: ReadonlySet<string> = new Set<BridgeMethod>([
  'fetch',
  'storage.get',
  'storage.set',
  'storage.delete',
  'storage.keys',
  'notify',
  'showCard',
  'remind',
  'validate',
  'speak',
  'settings.get',
  'files.read',
  'files.write',
  'files.exists',
  'files.list',
  'files.remove',
  'tools.call',
]);

/** Hata iletisine, yığında yeteneğin kendi dosyasına düşen ilk satırı ekler (modelin düzeltebilmesi için). */
function withLocation(error: { message: string; stack: string }, skillId: string): string {
  const frame = error.stack
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.includes(`${skillId}/index.mjs:`) || line.includes(`${skillId}/selftest.mjs:`));
  const where = frame?.match(/([a-z]+\.mjs):(\d+):(\d+)/);
  return where ? `${error.message} (${where[1]} satır ${where[2]})` : error.message;
}

export function createSkillContext(options: SkillContextOptions): SkillContext {
  const { skillId, mode } = options;
  const context = vm.createContext(Object.create(null) as object, {
    name: `skill:${skillId}`,
    codeGeneration: { strings: false, wasm: false },
  });

  let disposed = false;
  let nextOp = 1;
  const ops = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let pendingBridge = 0;

  const reply = (id: number, ok: boolean, value: unknown) => {
    if (disposed) return;
    try {
      api.deliver(JSON.stringify(ok ? { id, ok: true, value: value ?? null } : { id, ok: false, error: String(value) }));
    } catch {
      // Fırlatılan değer bağlam dünyasına aittir; konak ona dokunmaz.
      options.log('warn', 'yanıt bağlama iletilemedi');
    }
  };

  const onRequest = (id: number, method: string, params: unknown) => {
    if (method === 'timer') {
      if (timers.size >= HOST_LIMITS.maxTimers) return reply(id, false, 'çok fazla zamanlayıcı kurulu');
      const requested = Number((params as { ms?: unknown } | null)?.ms);
      const ms = Math.min(HOST_LIMITS.maxTimerMs, Math.max(0, Number.isFinite(requested) ? requested : 0));
      const handle = setTimeout(() => {
        timers.delete(handle);
        reply(id, true, null);
      }, ms);
      timers.add(handle);
      return;
    }
    if (!BRIDGE_METHODS.has(method)) return reply(id, false, `bilinmeyen ctx isteği: ${method}`);
    if (pendingBridge >= HOST_LIMITS.maxPendingBridge) return reply(id, false, 'çok fazla eşzamanlı ctx isteği');
    pendingBridge++;
    options.bridge(method as BridgeMethod, params).then(
      (value) => {
        pendingBridge--;
        reply(id, true, value);
      },
      (error: unknown) => {
        pendingBridge--;
        reply(id, false, error instanceof Error ? error.message : String(error));
      },
    );
  };

  // Bağlama giren TEK konak nesnesi. Asla fırlatmaz ve değer döndürmez: bağlama konak dünyasından hata ya da nesne sızmaz.
  const hostSend = (raw: unknown): void => {
    try {
      if (disposed || typeof raw !== 'string' || raw.length > HOST_LIMITS.maxMessageChars + 1024) return;
      const message = JSON.parse(raw) as FromContext;
      if (message.t === 'req') {
        onRequest(Number(message.id), String(message.method), message.params);
      } else if (message.t === 'log') {
        const level = message.level === 'warn' || message.level === 'error' ? message.level : 'info';
        options.log(level, String(message.text).slice(0, 2000));
      } else if (message.t === 'op') {
        const op = ops.get(message.id);
        if (!op) return;
        ops.delete(message.id);
        if (message.ok) op.resolve(message.value);
        else op.reject(new Error(withLocation({ message: String(message.error.message), stack: String(message.error.stack ?? '') }, skillId)));
      }
    } catch {
      // bozuk ileti: yok sayılır
    }
  };

  const boot = new vm.Script(RUNTIME_SOURCE, { filename: 'fuber-skill-runtime.js' }).runInContext(context) as (
    send: (raw: unknown) => void,
    configText: string,
  ) => RuntimeApi;
  const api = boot(hostSend, JSON.stringify({ skillId, mode, maxMessageChars: HOST_LIMITS.maxMessageChars }));

  /**
   * Ana süreçte dönüştürülmüş gövdeyi bağlamda bir işleve çevirir. Yalnız işlev ifadesi değerlendirilir; gövde
   * `load`/`selftest` çağrılınca koşar. Dinamik `import()` için yükleyici verilmez: çağrılırsa hata fırlar.
   */
  const compile = (script: string, file: string): unknown =>
    new vm.Script(`(async function (__exports) { 'use strict'; ${script}\n})`, {
      filename: `${skillId}/${file}`,
    }).runInContext(context, { timeout: HOST_LIMITS.evalTimeoutMs });

  const start = <T>(begin: (opId: number) => void): Promise<T> => {
    if (disposed) return Promise.reject(new Error('yetenek bağlamı kapalı'));
    return new Promise<T>((resolve, reject) => {
      const opId = nextOp++;
      ops.set(opId, { resolve: resolve as (value: unknown) => void, reject });
      try {
        begin(opId);
      } catch (error) {
        ops.delete(opId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  return {
    async load(script) {
      const moduleFn = compile(script, 'index.mjs');
      const { tools } = await start<{ tools: string[] }>((opId) => api.load(opId, moduleFn));
      return tools;
    },
    call(tool, input) {
      return start<SkillToolResult>((opId) => api.call(opId, tool, JSON.stringify(input ?? {})));
    },
    selftest(script, selftestScript, spec) {
      const moduleFn = compile(script, 'index.mjs');
      const selftestFn = compile(selftestScript, 'selftest.mjs');
      return start<{ called: string[]; effects: number }>((opId) => api.selftest(opId, moduleFn, selftestFn, JSON.stringify(spec)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of timers) clearTimeout(handle);
      timers.clear();
      const closed = new Error('yetenek boşaltıldı');
      for (const op of ops.values()) op.reject(closed);
      ops.clear();
    },
  };
}
