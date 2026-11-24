/**
 * Bu bilgisayardaki Claude Code CLI'nin durumu ("Derin işler" satırının altındaki yazı için): kurulu mu, sürümü, oturumu.
 * Yalnız `--version` ve `auth status --json` çalıştırır; model çağrısı ve kota harcaması yoktur. `auth status` çıktısından
 * YALNIZ oturum durumu okunur (hesap bilgisi tutulmaz). Masaüstündeki asıl arama daha kapsamlıdır
 * (`apps/desktop/src/main/core/claude-cli/locate.ts`); burada yalnız bilinen kurulum yerlerine ve PATH'e bakılır.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeCodeInfo } from '@fuber/shared';

const NOT_INSTALLED: ClaudeCodeInfo = { installed: false, version: null, loggedIn: null };
const CACHE_MS = 30_000;
let cache: { at: number; info: ClaudeCodeInfo } | null = null;

function locate(): string | null {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const home = os.homedir();
  const npmBinary = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', exe];
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
  ];
  for (const dir of dirs) {
    for (const candidate of [path.join(dir, exe), path.join(dir, ...npmBinary)]) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // yok: sıradaki aday
      }
    }
  }
  return null;
}

function run(file: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  // Ortamdaki bir API anahtarı CLI'nin oturum bilgisini değiştirir; yoklama aboneliğin durumunu sorar.
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE)/i.test(name)) delete env[name];
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) =>
      resolve({ ok: !error, stdout: String(stdout ?? '') }),
    );
  });
}

export async function claudeCodeInfo(): Promise<ClaudeCodeInfo> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.info;
  const file = locate();
  let info = NOT_INSTALLED;
  if (file) {
    const [version, auth] = await Promise.all([run(file, ['--version']), run(file, ['auth', 'status', '--json'])]);
    const match = /(\d+\.\d+\.\d+)/.exec(version.stdout);
    if (version.ok && match) {
      let loggedIn: boolean | null = null;
      const start = auth.stdout.indexOf('{');
      const end = auth.stdout.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const value = (JSON.parse(auth.stdout.slice(start, end + 1)) as { loggedIn?: unknown }).loggedIn;
          if (typeof value === 'boolean') loggedIn = value;
        } catch {
          // oturum durumu okunamadı
        }
      }
      info = { installed: true, version: match[1]!, loggedIn };
    }
  }
  cache = { at: Date.now(), info };
  return info;
}
