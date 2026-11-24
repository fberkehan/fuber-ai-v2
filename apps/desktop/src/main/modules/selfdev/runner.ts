// Komut koşucu: worktree'de `npm ci`, `npm run typecheck`, `npm test`, e2e ve paketleme komutlarını koşturur.
// `child_process.spawn`, kabuk YOK (Windows'ta `npm.cmd` kabuksuz başlamadığı için `ComSpec /d /s /c npm …`; argümanlar
// yalnız güvenli karakterlerdir). Süre sınırı, son N KB çıktı kuyruğu, iptalde AĞAÇLA öldürme, ortam temizliği (anahtarlar ve
// `FUBER2_*` çocuk sürece geçmez; `core/claude-cli/process.ts` › `isolatedCliEnv` izin listesi).
// Soyut arayüz (`Runner`) sınamada sahteyle değiştirilir.
import { spawn } from 'node:child_process';
import { isolatedCliEnv, killTree } from '../../core/claude-cli/process';

export interface CommandSpec {
  /** Günlükte ve sayfada görünen ad: `typecheck`, `npm ci`. */
  label: string;
  file: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  /** Çıktının son bölümü (stdout + stderr birlikte, geliş sırasıyla). */
  tail: string;
  /** Başlatılamadıysa neden. */
  error?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Her tamamlanan çıktı satırı (canlı günlük). */
  onLine?(line: string): void;
}

export interface Runner {
  run(spec: CommandSpec, options?: RunOptions): Promise<CommandResult>;
}

/** Çıktı kuyruğu üst sınırı (bayt yaklaşığı). */
export const TAIL_LIMIT = 24 * 1024;

/** npm argümanı ya da betik adı için güvenli karakterler (kabuk meta karakteri yok). */
const SAFE_ARG = /^[A-Za-z0-9:_.\-/@=]+$/;

/** `npm <args>` komutu. Windows'ta `ComSpec /d /s /c npm …`, başka yerde doğrudan `npm`. */
export function npmCommand(label: string, args: string[], cwd: string, timeoutMs: number): CommandSpec {
  for (const arg of args) if (!SAFE_ARG.test(arg)) throw new Error(`güvensiz npm argümanı: ${arg}`);
  if (process.platform === 'win32') {
    return { label, file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args], cwd, timeoutMs };
  }
  return { label, file: 'npm', args, cwd, timeoutMs };
}

/** `node <betik>` komutu (e2e). Betik yolu depo içi göreli, güvenli karakterlerden oluşur. */
export function nodeCommand(label: string, script: string, cwd: string, timeoutMs: number): CommandSpec {
  if (!SAFE_ARG.test(script) || script.startsWith('/') || script.includes('..')) throw new Error(`güvensiz betik yolu: ${script}`);
  return { label, file: 'node', args: [script], cwd, timeoutMs };
}

/** Çocuk sürece geçen ortam: izin listesi + sessiz npm. Anahtarlar, `FUBER2_*`, `ELECTRON_RUN_AS_NODE` geçmez. */
export function cleanEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return isolatedCliEnv({ NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false', FORCE_COLOR: '0' }, source);
}

// Uygulama beklenmedik biçimde çıkarsa başlattığımız komut ağaçları öksüz kalmasın.
const live = new Set<number>();
let exitHook = false;
function installExitHook(): void {
  if (exitHook) return;
  exitHook = true;
  process.on('exit', () => {
    for (const pid of live) killTree(pid, true);
  });
}

/** Gerçek koşucu. */
export function createRunner(options: { env?: () => Record<string, string> } = {}): Runner {
  return {
    run(spec, runOptions = {}) {
      installExitHook();
      return new Promise<CommandResult>((resolve) => {
        const started = Date.now();
        let tail = '';
        let timedOut = false;
        let cancelled = false;
        let settled = false;
        let pending = '';
        const finish = (result: Omit<CommandResult, 'durationMs' | 'tail' | 'timedOut' | 'cancelled'>): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          runOptions.signal?.removeEventListener('abort', onAbort);
          if (pending.trim()) runOptions.onLine?.(pending.trim());
          resolve({ ...result, durationMs: Date.now() - started, tail: tail.slice(-TAIL_LIMIT), timedOut, cancelled });
        };
        const push = (chunk: Buffer | string): void => {
          const text = chunk.toString();
          tail = (tail + text).slice(-TAIL_LIMIT * 2);
          if (!runOptions.onLine) return;
          pending += text;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) runOptions.onLine(line.trim());
        };
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(spec.file, spec.args, {
            cwd: spec.cwd,
            env: (options.env ?? cleanEnv)() as NodeJS.ProcessEnv,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
          });
        } catch (error) {
          finish({ ok: false, exitCode: null, error: error instanceof Error ? error.message : String(error) });
          return;
        }
        const pid = child.pid;
        if (pid !== undefined) live.add(pid);
        const onAbort = (): void => {
          cancelled = true;
          killTree(pid);
        };
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(pid);
        }, spec.timeoutMs);
        if (runOptions.signal?.aborted) onAbort();
        else runOptions.signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout?.on('data', push);
        child.stderr?.on('data', push);
        child.once('error', (error) => {
          if (pid !== undefined) live.delete(pid);
          finish({ ok: false, exitCode: null, error: error.message });
        });
        child.once('close', (code) => {
          if (pid !== undefined) live.delete(pid);
          finish({ ok: code === 0 && !timedOut && !cancelled, exitCode: code });
        });
      });
    },
  };
}
