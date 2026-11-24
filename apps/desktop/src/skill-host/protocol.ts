/**
 * Ana süreç ↔ yetenek konağı iletileri. Düz JSON'dur; `utilityProcess` iletisiyle (sınamada `child_process` IPC'siyle)
 * taşınır. Yetenek kodu konağa DOSYA olarak değil, ana süreçte denetlenip dönüştürülmüş METİN olarak gelir:
 * denetlenen bayt ile çalışan bayt aynıdır ve konağın dosya sistemine ihtiyacı yoktur.
 */

/** Bir aracın modele dönen sonucu (konaktan çıkan biçim). */
export interface SkillToolResult {
  ok: boolean;
  text: string;
  data?: unknown;
}

export interface SelftestSpec {
  /** Manifestte bildirilen araç adları; `index.mjs` tam olarak bunları vermelidir. */
  declared: string[];
  /** Öz-sınamanın en az bir kez çağırması gereken araçlar (`read` riskli olanlar). */
  mustCall: string[];
  /** Eklenti ayarlarının varsayılanları: öz-sınamada `ctx.settings.get` bunları döndürür (`setSetting` ile değişir). */
  settings?: Record<string, unknown>;
}

export interface SelftestOutcome {
  ok: boolean;
  /** Başarısızsa neden (Türkçe, modele ve kullanıcıya gösterilebilir). */
  error: string | null;
  /** Öz-sınamanın çağırdığı araçlar. */
  called: string[];
  /** Öz-sınamada `ctx.notify` / `ctx.showCard` / `ctx.remind` ile istenen (gerçekte yapılmayan) etkiler. */
  effects: number;
}

export type HostRequest =
  | { op: 'ping' }
  /** Yeteneği canlı bağlama yükler; aynı kimlik yüklüyse önce boşaltılır. */
  | { op: 'load'; skillId: string; script: string }
  | { op: 'unload'; skillId: string }
  | { op: 'call'; skillId: string; tool: string; input: unknown }
  /** Geçici bir bağlamda `index.mjs` + `selftest.mjs` koşturur; canlı bağlama dokunmaz. */
  | { op: 'selftest'; skillId: string; script: string; selftestScript: string; spec: SelftestSpec };

export type HostResult =
  | { pong: true; loaded: string[] }
  | { tools: string[] }
  | { unloaded: boolean }
  | { result: SkillToolResult }
  | SelftestOutcome;

/** Yetenek kodunun `ctx` üzerinden istediği, ana süreçte yapılan işler. */
export type BridgeMethod =
  | 'fetch'
  | 'storage.get'
  | 'storage.set'
  | 'storage.delete'
  | 'storage.keys'
  | 'notify'
  | 'showCard'
  | 'remind'
  | 'validate'
  | 'speak'
  | 'settings.get'
  | 'files.read'
  | 'files.write'
  | 'files.exists'
  | 'files.list'
  | 'files.remove'
  | 'tools.call';

export interface BridgeCall {
  skillId: string;
  /** `selftest`: etkiler gerçekte uygulanmaz, depolama geçicidir. */
  mode: 'live' | 'selftest';
  method: BridgeMethod;
  params: unknown;
}

/** Ana süreç → konak. */
export type MainToHost =
  | { kind: 'request'; id: number; request: HostRequest }
  | { kind: 'bridge-reply'; id: number; ok: true; value: unknown }
  | { kind: 'bridge-reply'; id: number; ok: false; error: string };

/** Konak → ana süreç. */
export type HostToMain =
  | { kind: 'ready' }
  /** `call` isteği yetenek koduna girmek üzere: konak kilitlenirse hangi çağrının kilitlediği buradan anlaşılır. */
  | { kind: 'running'; id: number }
  | { kind: 'response'; id: number; ok: true; result: HostResult }
  | { kind: 'response'; id: number; ok: false; error: string }
  | ({ kind: 'bridge'; id: number } & BridgeCall)
  | { kind: 'log'; skillId: string; level: 'info' | 'warn' | 'error'; text: string };

/** Konağın iki ucu da aynı taşıma yüzünü kullanır (Electron `parentPort` ya da Node IPC). */
export interface HostTransport {
  send(message: HostToMain): void;
  onMessage(listener: (message: MainToHost) => void): void;
}

export const HOST_LIMITS = {
  /** Bağlamdan çıkan tek iletinin en büyük boyutu (karakter). */
  maxMessageChars: 1_000_000,
  /** Bir yeteneğin aynı anda bekleyen `ctx` isteği. */
  maxPendingBridge: 64,
  /** Bir yeteneğin aynı anda kurulu zamanlayıcısı. */
  maxTimers: 64,
  /** `setTimeout` üst sınırı (ms). */
  maxTimerMs: 60_000,
  /** Öz-sınama ve yüklemede modül gövdesinin eşzamanlı kısmına tanınan süre (ms). */
  evalTimeoutMs: 3_000,
} as const;
