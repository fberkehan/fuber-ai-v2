// Dış süreç başlatma: Windows Terminal, VS Code, Claude Code. v1'in hatası: konsolsuz başlatıp hatayı
// dinlemeden "açıldı" demek. Burada başarı = süreç `waitMs` sonra hâlâ ayakta ya da 0 ile çıktı; değilse
// gerçek hata metni döner.
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface LaunchSpec {
  file: string;
  args: string[];
  cwd?: string;
  /** Komut satırı elle kurulmuştur (cmd.exe `start`); Node tırnaklamaz. */
  verbatim?: boolean;
}

export interface LaunchOutcome {
  ok: boolean;
  /** `ok: false` ise neden (Türkçe olmayan sistem metni olabilir; çağıran sarar). */
  error: string | null;
  code: number | null;
  /** Hâlâ ayakta (1,5 sn sonra). */
  alive: boolean;
  pid: number | null;
}

export type SpawnFn = (file: string, args: string[], options: SpawnOptions) => import('node:child_process').ChildProcess;

/** Oturum kimliği yalnız UUID biçiminde kabul edilir (komut satırına başka bir şey girmesin). */
export const SESSION_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Windows Terminal komut satırında `;` yeni sekme ayıracıdır; düz karakter olarak geçsin diye kaçırılır. */
export function escapeWt(arg: string): string {
  return arg.replace(/;/g, '\\;');
}

/** `wt.exe -w new -d <klasör> <komut...>`: yeni pencerede, o klasörde komut. Komut yoksa varsayılan kabuk. */
export function wtSpec(cwd: string, command: string[] = [], wt = 'wt.exe'): LaunchSpec {
  return { file: wt, args: ['-w', 'new', '-d', escapeWt(cwd), ...command.map(escapeWt)] };
}

/** Claude Code oturumunu sürdürmek: `wt.exe -w new -d <cwd> claude --resume <id>`. */
export function resumeSpec(cwd: string, sessionId: string, claudeCommand: string[], wt = 'wt.exe'): LaunchSpec {
  if (!SESSION_ID.test(sessionId)) throw new Error(`geçersiz oturum kimliği: ${sessionId}`);
  return wtSpec(cwd, [...claudeCommand, '--resume', sessionId], wt);
}

/** cmd.exe için tek argümanı tırnaklar (klasör yolunda tırnak olamaz; `%` ve `^` kaçırılır). */
export function quoteCmd(arg: string): string {
  if (arg === '') return '""';
  if (/^[\w.:\\/-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/** Windows Terminal yoksa yedek: `cmd /c start "" /D "<cwd>" <komut...>` yeni konsol penceresi açar. */
export function startSpec(cwd: string, command: string[]): LaunchSpec {
  const body = command.length ? command.map(quoteCmd).join(' ') : 'cmd.exe';
  return {
    file: process.env.ComSpec ?? 'cmd.exe',
    args: [`/d /s /c "start "" /D ${quoteCmd(cwd)} ${body}"`],
    cwd,
    verbatim: true,
  };
}

/** Alt süreçlere gitmemesi gereken ortam değişkenleri: test sınırı, Electron kipi, iç içe Claude Code işareti, anahtarlar. */
const PRIVATE_ENV = /^(FUBER2_|ELECTRON_RUN_AS_NODE$|ELECTRON_NO_ATTACH_CONSOLE$|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|CLAUDE_CODE_SSE_PORT$|ANTHROPIC_API_KEY$)/i;

export function childEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) if (!PRIVATE_ENV.test(key)) env[key] = value;
  return env;
}

/**
 * Süreci ayrık başlatır ve `waitMs` bekler: hata olayı ya da sıfırdan farklı çıkış → başarısız;
 * hâlâ ayakta ya da 0 ile çıktı → başarılı. Başarıda süreç bırakılır (uygulama kapansa da yaşar).
 */
export function launch(spec: LaunchSpec, options: { waitMs?: number; spawn?: SpawnFn } = {}): Promise<LaunchOutcome> {
  const waitMs = options.waitMs ?? 1500;
  const spawn = options.spawn ?? (nodeSpawn as SpawnFn);
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    const finish = (outcome: LaunchOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    let child: import('node:child_process').ChildProcess;
    try {
      child = spawn(spec.file, spec.args, {
        cwd: spec.cwd,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: false,
        windowsVerbatimArguments: spec.verbatim ?? false,
        env: childEnv(),
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error), code: null, alive: false, pid: null });
      return;
    }
    const timer = setTimeout(() => {
      child.stderr?.destroy();
      child.unref();
      finish({ ok: true, error: null, code: null, alive: true, pid: child.pid ?? null });
    }, waitMs);
    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < 2000) stderr += data.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, error: error.code === 'ENOENT' ? `ENOENT: ${spec.file}` : error.message, code: null, alive: false, pid: null });
    });
    child.on('exit', (code) => {
      if (code === 0) finish({ ok: true, error: null, code: 0, alive: false, pid: child.pid ?? null });
      else finish({ ok: false, error: stderr.trim() || `çıkış kodu ${code ?? 'yok'}`, code: code ?? null, alive: false, pid: child.pid ?? null });
    });
  });
}

/** VS Code'un asıl çalıştırılabilir dosyası (`code.cmd` kabuk ister; doğrudan `Code.exe` tırnak derdini kaldırır). */
export function findVsCode(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    if (exists(path.join(dir, 'code.cmd'))) {
      const exe = path.resolve(dir, '..', 'Code.exe');
      if (exists(exe)) return exe;
    }
  }
  const local = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : null;
  if (local && exists(local)) return local;
  const programs = env.ProgramFiles ? path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe') : null;
  if (programs && exists(programs)) return programs;
  return null;
}
