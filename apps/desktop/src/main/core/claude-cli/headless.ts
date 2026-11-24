/**
 * Claude Code'u başsız (`-p`) ve yalıtılmış çalıştırma: bayraklar, girdi iletisi, tek koşu, eşzamanlılık sınırı.
 * Bayraklar 2.1.325'in `--help` çıktısından ve resmî CLI başvurusundan alındı; yalıtım gerçek çağrıyla doğrulandı:
 *  - `--system-prompt-file`: kendi sistem istemimiz; CLI'nin varsayılan istemi kullanılmaz (v1'in kök nedeni boş istemdi).
 *  - `--safe-mode`: kullanıcının CLAUDE.md'si, hafızası, becerileri, eklentileri, kancaları ve MCP sunucuları yüklenmez.
 *  - `--restricted`: kabuk ve kod çalıştıran araçlar yoktur, kullanıcı/proje ayar dosyaları okunmaz, dosya araçları
 *    yalnız çalışma klasöründe çalışır. `--strict-mcp-config`: MCP tümüyle kapalı.
 *  - `--tools`: yalnız işin istediği yerleşik araçlar; `--permission-mode dontAsk` + `--permission-prompts none`:
 *    izin isteyen her şey sormadan reddedilir.
 *  - `--no-session-persistence`: konuşma diske yazılmaz. `--bare` KULLANILMAZ: abonelik oturumunu okumaz.
 * CLI yine de hesabın e-postasını ve çalışma klasörü/tarih bilgisini modele kendi sistem notuyla verir; bunu kapatan
 * bir bayrak yoktur.
 */
import { spawnCli, killTree, type CliCommand } from './process';
import { createStreamParser, type CliEvent, type CliResultEvent } from './stream';

export interface CliArgsInput {
  systemPromptFile: string;
  model: string;
  /** Claude Code'un yerleşik araç adları: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`. Boş = araçsız. */
  tools: string[];
  maxTurns: number;
}

/** Başsız çalıştırmanın bayrakları. Araç listesi hem "var olan araçlar" (`--tools`) hem "sormadan izinli" (`--allowedTools`) listesidir. */
export function buildCliArgs(input: CliArgsInput): string[] {
  const tools = input.tools.join(',');
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--system-prompt-file',
    input.systemPromptFile,
    '--model',
    input.model,
    '--restricted',
    '--safe-mode',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--tools',
    tools,
    ...(tools ? ['--allowedTools', tools] : []),
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--max-turns',
    String(input.maxTurns),
  ];
}

export type CliContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/** `--input-format stream-json` için tek kullanıcı iletisi (satır sonuyla biter). */
export function userMessageLine(content: CliContentBlock[]): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

export interface CliRunOptions {
  command: CliCommand;
  cwd: string;
  args: string[];
  /** Standart girdiye yazılacak ileti satırları. */
  stdin: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onEvent(event: CliEvent): void;
}

export interface CliRunOutcome {
  exitCode: number | null;
  /** Süreci biz öldürdüysek neden. */
  killed: 'timeout' | 'abort' | null;
  /** Süreç hiç başlatılamadıysa (dosya yok, izin yok) hata iletisi. */
  spawnError: string | null;
  /** Hata çıktısının sonu (en çok 4000 karakter); günlüğe yazılmaz, yalnız hata iletisi için. */
  stderr: string;
  result: CliResultEvent | null;
  lines: number;
  garbage: number;
}

const MAX_STDERR_CHARS = 4000;

/** CLI'yi bir kez çalıştırır; çıktı olaylarını akarken bildirir. Hiç fırlatmaz. */
export function runClaudeCli(options: CliRunOptions): Promise<CliRunOutcome> {
  if (options.signal?.aborted) {
    return Promise.resolve({ exitCode: null, killed: 'abort', spawnError: null, stderr: '', result: null, lines: 0, garbage: 0 });
  }
  return new Promise((resolve) => {
    let result: CliResultEvent | null = null;
    let stderr = '';
    let killed: CliRunOutcome['killed'] = null;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const parser = createStreamParser((event) => {
      if (event.type === 'result') result = event;
      try {
        options.onEvent(event);
      } catch {
        // dinleyicinin hatası çalıştırmayı bozmaz
      }
    });

    const finish = (exitCode: number | null, spawnError: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      parser.end();
      resolve({ exitCode, killed, spawnError, stderr, result, ...parser.stats() });
    };

    const child = spawnCli(options.command, options.args, { cwd: options.cwd });

    const stop = (reason: 'timeout' | 'abort') => {
      if (settled || killed) return;
      killed = reason;
      killTree(child.pid);
      // Ağaç öldürülemese bile çağıran sonsuza dek beklemesin.
      setTimeout(() => finish(null, null), 5000).unref?.();
    };
    function onAbort() {
      stop('abort');
    }
    timer = setTimeout(() => stop('timeout'), options.timeoutMs);
    timer.unref?.();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => parser.push(chunk));
    // Hata çıktısı okunmazsa boru dolar ve süreç kilitlenir; yalnız sonu tutulur.
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_CHARS);
    });
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code, null));
    child.stdin.on('error', () => {
      // süreç girdiyi okumadan kapandıysa sonuç `close` ile gelir
    });
    child.stdin.end(options.stdin);
  });
}

/** Aynı anda koşan CLI sayısını sınırlar; fazlası sırada bekler (iptal edilirse sıradan çıkar). */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    running--;
    waiting.shift()?.();
  };
  return {
    async acquire(signal?: AbortSignal): Promise<(() => void) | null> {
      if (signal?.aborted) return null;
      if (running < max) {
        running++;
        return release;
      }
      return new Promise((resolve) => {
        const grant = () => {
          signal?.removeEventListener('abort', cancel);
          running++;
          resolve(release);
        };
        const cancel = () => {
          const index = waiting.indexOf(grant);
          if (index !== -1) waiting.splice(index, 1);
          resolve(null);
        };
        waiting.push(grant);
        signal?.addEventListener('abort', cancel, { once: true });
      });
    },
    running: () => running,
    waiting: () => waiting.length,
  };
}
