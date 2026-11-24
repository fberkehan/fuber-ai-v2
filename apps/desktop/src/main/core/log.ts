import fs from 'node:fs';
import path from 'node:path';
import { localDay, type Logger, type ServiceDeps } from '@fuber/shared';

type Level = 'debug' | 'info' | 'warn' | 'error';

const KEEP_DAYS = 14;
const MAX_DATA_CHARS = 4000;
const SECRET_KEY = /key|token|secret|password|authorization/i;

/**
 * Günlüğe giden nesnelerde sır taşıyabilecek alanları gizler. Politika (`keys`) ve cihaz belirteci
 * yanlışlıkla günlüğe verilse bile diske düz yazı olarak inmesin diye son savunma hattıdır.
 */
function redact(key: string, value: unknown): unknown {
  if (key === 'keys' && typeof value === 'object' && value !== null) return '«gizli»';
  if (typeof value === 'string' && SECRET_KEY.test(key)) return '«gizli»';
  return value;
}

export function formatLogData(data: unknown): string {
  if (data === undefined || data === '') return '';
  if (data instanceof Error) return data.stack ?? `${data.name}: ${data.message}`;
  if (typeof data === 'string') return data.slice(0, MAX_DATA_CHARS);
  try {
    return (JSON.stringify(data, redact) ?? String(data)).slice(0, MAX_DATA_CHARS);
  } catch {
    return String(data).slice(0, MAX_DATA_CHARS);
  }
}

/** Günlük: konsol + `logs/fuber-<gün>.log`. Dosyaya yazılamazsa uygulama yine çalışır (yalnız konsol). */
export function createLogger(deps: ServiceDeps['log']): Logger {
  const dir = deps.paths.logs;
  let day = '';
  let stream: fs.WriteStream | null = null;

  const prune = () => {
    try {
      const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
      for (const name of fs.readdirSync(dir)) {
        if (!/^fuber-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
        const file = path.join(dir, name);
        if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
      }
    } catch {
      // eski günlükler silinemedi: zararsız
    }
  };

  const target = (): fs.WriteStream | null => {
    const today = localDay();
    if (today === day) return stream;
    day = today;
    stream?.end();
    try {
      fs.mkdirSync(dir, { recursive: true });
      stream = fs.createWriteStream(path.join(dir, `fuber-${today}.log`), { flags: 'a' });
      stream.on('error', () => {
        stream = null;
      });
      prune();
    } catch {
      stream = null;
    }
    return stream;
  };

  const write = (level: Level, scope: string, message: string, data: unknown) => {
    const detail = formatLogData(data);
    const text = `${scope ? `[${scope}] ` : ''}${message}${detail ? ` ${detail}` : ''}`;
    console[level](text);
    // Ayrıntı düzeyi dosyayı şişirir; yalnız konsolda kalır.
    if (level !== 'debug') target()?.write(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`);
  };

  const make = (scope: string): Logger => ({
    debug: (message, data) => write('debug', scope, message, data),
    info: (message, data) => write('info', scope, message, data),
    warn: (message, data) => write('warn', scope, message, data),
    error: (message, data) => write('error', scope, message, data),
    child: (name) => make(scope ? `${scope}:${name}` : name),
  });
  return make('');
}
