/**
 * Claude Code süreçleri: ortam, başlatma, izleme, ağaçla öldürme, kısa alt komutlar ve yoklama. Electron'a bağlı değildir.
 * v1'den (0.18.2 `claudecode/yurutucu.ts`) alınanlar: süreç ağacını `taskkill /T /F` ile öldürme, başlatılan süreçleri
 * izleyip ana süreç çıkarken (çökme dahil) hepsini eşzamanlı öldürme, `auth status` çıktısından YALNIZ oturum durumunu okuma
 * (çıktıdaki e-posta ve kuruluş bilgisi tutulmaz, günlüğe yazılmaz).
 */
import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** Çalıştırılacak komut. Sınamada sahte CLI betiği (`node betik.mjs`) verilir. */
export interface CliCommand {
  command: string;
  prefixArgs: string[];
  /** Süreç ortamına eklenecekler (yalnız sınama fikstürü için). */
  env?: Record<string, string>;
}

export interface CliProbe {
  installed: boolean;
  path: string | null;
  version: string | null;
  /** Oturum açık mı; yoklanamadıysa `null`. */
  loggedIn: boolean | null;
  /** Sürüm, başsız çalıştırmanın istediği bayrakları destekliyor mu (`MIN_CLI_VERSION`). */
  supported: boolean;
  checkedAt: number;
}

/** `--permission-prompts` bayrağını getiren sürüm; `--restricted` 2.1.248'de geldi. */
export const MIN_CLI_VERSION = '2.1.259';

/** Çocuk sürece geçen ortam değişkenleri. Bunların dışındaki hiçbir şey (anahtarlar, `CLAUDE_*`, `FUBER2_*`) geçmez. */
const ENV_ALLOW = [
  'SystemRoot',
  'SystemDrive',
  'windir',
  'PATH',
  'Path',
  'PATHEXT',
  'COMSPEC',
  'ComSpec',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERNAME',
  'USER',
  'USERDOMAIN',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'CommonProgramFiles',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'LANG',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
] as const;

/**
 * YALITILMIŞ koşunun ortamı (derin beyin, yoklama, kısa alt komutlar): İZİN LİSTESİ. Yalnız yukarıdaki değişkenler geçer.
 * Ortamdaki bir `ANTHROPIC_API_KEY` CLI'yi abonelik yerine (kredisi olmayan) anahtara yöneltir; `CLAUDECODE`/`CLAUDE_CODE_*`
 * iç içe oturum sanılmasına yol açar: ikisi de geçmez.
 *
 * Kullanıcının kendi etkileşimli oturumu bununla BAŞLATILMAZ: o, kullanıcının bütün ortamını ister (MCP sunucularının
 * belirteçleri, kabuk komutlarının PATH'i) ve yalnız birkaç değişkeni çıkarır. Karşılığı `userSessionEnv`
 * (`session-channel.ts`, YASAK LİSTESİ). İkisi bilerek ayrıdır; birini ötekinin yerine kullanmayın.
 */
export function isolatedCliEnv(extra: Record<string, string> = {}, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOW) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Süreç yaşıyor mu (yalnız varlık sorgusu). `EPERM`: süreç var ama bizim değil. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Süreci ve bütün torunlarını öldürür. Windows'ta `kill()` yalnız süreci öldürür (CLI'nin başlattığı kabuklar ve MCP
 * sunucuları kalır); ağaç için `taskkill /T /F` gerekir. `sync`: ana süreç çıkarken (bekleyecek olay döngüsü yok).
 */
export function killTree(pid: number | undefined, sync = false): void {
  if (!pid || !isAlive(pid)) return;
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T', '/F'];
    try {
      if (sync) spawnSync('taskkill', args, { windowsHide: true, timeout: 5000, stdio: 'ignore' });
      else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
    } catch {
      // taskkill yok: yapacak bir şey kalmadı
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // süreç zaten bitmiş
    }
  }
}

// Süreç izleme TEK yerdedir: derin beynin başsız koşuları da etkileşimli oturumlar da (`session-channel.ts`) `spawnCli`
// ile başlar ve bu kümeye girer. Uygulama kapanırken (çökme dahil) kümedeki her süreç ağacıyla ölür.
const tracked = new Set<number>();
let exitHook = false;

/** Ana süreç beklenmedik biçimde çıkarsa başlattığımız bütün CLI süreçleri ağaçlarıyla öldürülür (öksüz süreç kalmaz). */
function installExitHook(): void {
  if (exitHook) return;
  exitHook = true;
  process.on('exit', () => killTrackedCli(true));
}

/** Başlattığımız ve hâlâ yaşayan CLI süreçleri (başsız koşular + etkileşimli oturumlar). */
export const trackedCliPids = (): number[] => [...tracked].filter(isAlive);

/** İzlenen bütün CLI süreçlerini ağaçlarıyla öldürür. `sync`: ana süreç çıkarken. */
export function killTrackedCli(sync = false): void {
  for (const pid of tracked) killTree(pid, sync);
}

export interface SpawnCliOptions {
  cwd: string;
  /** Gelince süreç ağacıyla öldürülür. */
  signal?: AbortSignal;
  /**
   * Verilirse süreç ortamı olduğu gibi budur: etkileşimli oturum `userSessionEnv` sonucunu verir (kullanıcının ortamı
   * BİLEREK dahildir). Verilmezse yalıtılmış koşunun izin listesi uygulanır (`isolatedCliEnv`).
   */
  env?: Record<string, string | undefined>;
}

/** CLI'yi borularla ve penceresiz başlatır; PID'i izler. Kabuk kullanılmaz (argümanlar dizi olarak gider). Başlatılamazsa `spawn` gibi fırlatabilir. */
export function spawnCli(command: CliCommand, args: string[], options: SpawnCliOptions): ChildProcessWithoutNullStreams {
  installExitHook();
  const child = spawn(command.command, [...command.prefixArgs, ...args], {
    cwd: options.cwd,
    env: options.env ? (options.env as NodeJS.ProcessEnv) : isolatedCliEnv(command.env),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    // POSIX'te süreç grubu: ağaç tek sinyalle ölür.
    detached: process.platform !== 'win32',
  });
  const pid = child.pid;
  if (pid !== undefined) tracked.add(pid);
  const forget = () => {
    if (pid !== undefined) tracked.delete(pid);
  };
  child.once('exit', forget);
  child.once('error', forget);
  if (options.signal) {
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) killTree(pid);
    };
    if (options.signal.aborted) kill();
    else {
      options.signal.addEventListener('abort', kill, { once: true });
      child.once('exit', () => options.signal?.removeEventListener('abort', kill));
    }
  }
  return child;
}

/** Kısa bir alt komut (`--version`, `auth status`): çıktıyı döner; sıfır olmayan çıkışta da çıktı korunur. */
export function execCli(command: CliCommand, args: string[], timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      command.command,
      [...command.prefixArgs, ...args],
      { env: isolatedCliEnv(command.env), timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? '') }),
    );
  });
}

export function compareCliVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** `claude auth status` çıktısından YALNIZ oturum durumu. Çıktı önünde/ardında başka satır olsa da JSON bulunur. */
export function parseAuthStatus(stdout: string): boolean | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
    const loggedIn = typeof parsed === 'object' && parsed !== null ? (parsed as { loggedIn?: unknown }).loggedIn : undefined;
    return typeof loggedIn === 'boolean' ? loggedIn : null;
  } catch {
    return null;
  }
}

/** Sürümü ve oturum durumunu yoklar. Model çağrısı ve kota harcaması yoktur (`--version`, `auth status --json`). */
export async function probeClaudeCli(command: CliCommand | null, timeoutMs = 15_000): Promise<CliProbe> {
  const base: CliProbe = { installed: false, path: null, version: null, loggedIn: null, supported: false, checkedAt: Date.now() };
  if (!command) return base;
  const [version, auth] = await Promise.all([execCli(command, ['--version'], timeoutMs), execCli(command, ['auth', 'status', '--json'], timeoutMs)]);
  const match = /(\d+\.\d+\.\d+)/.exec(version.stdout);
  if (!version.ok || !match) return { ...base, path: command.command };
  return {
    installed: true,
    path: command.command,
    version: match[1]!,
    loggedIn: parseAuthStatus(auth.stdout),
    supported: compareCliVersions(match[1]!, MIN_CLI_VERSION) >= 0,
    checkedAt: Date.now(),
  };
}
