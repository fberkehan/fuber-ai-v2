/**
 * Oturum klasörünün git özeti, tek dosyanın farkı ve "@" dosya önerisi (v1 `claudecode/yurutucu.ts` ve `dokum.ts`'ten taşındı).
 * Hepsi argüman dizisiyle (kabuk yok) ve zaman aşımlı çalışır; deponun yapılandırması program ÇALIŞTIRAMAZ.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { t } from '@fuber/shared';
import type { GitFile, GitSummary } from './types';

// `-c core.fsmonitor=` (izleme kancası kapalı), `-c diff.external=` (+ farkta `--no-ext-diff --no-textconv`);
// `--no-optional-locks` (status dizin dosyasına yazmaz); GIT_EXTERNAL_DIFF/GIT_PAGER ortamdan atılır.
const GIT_HARDENING = ['--no-optional-locks', '-c', 'core.fsmonitor=', '-c', 'diff.external='];

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_PAGER;
  return env;
}

function git(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...GIT_HARDENING, ...args],
      { timeout: 10_000, windowsHide: true, maxBuffer, encoding: 'utf8', env: gitEnv() },
      (error, stdout) => resolve({ ok: !error, output: String(stdout ?? '') }),
    );
  });
}

const fold = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value);

/** `target` (bağlantılar çözülünce) `root`'un içinde mi. Olmayan dosyada en yakın var olan üst klasör çözülür. */
export function isReallyInside(root: string, target: string): boolean {
  let realRoot: string;
  try {
    realRoot = fold(fs.realpathSync.native(path.resolve(root)));
  } catch {
    return false;
  }
  let head = path.resolve(target);
  const tail: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const real = fold(path.join(fs.realpathSync.native(head), ...tail));
      return real === realRoot || real.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return false;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
  return false;
}

/** `git status --porcelain=v1 -z` → değişen dosyalar (yeniden adlandırmada yeni ad). En çok 500. */
export function parsePorcelain(output: string): GitFile[] {
  const parts = output.split('\0');
  const out: GitFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.length < 4) continue;
    const status = part.slice(0, 2);
    out.push({ path: part.slice(3), status: status.trim() || status });
    // Yeniden adlandırma/kopyada eski ad bir sonraki parçadadır.
    if (status[0] === 'R' || status[0] === 'C') i++;
  }
  return out.slice(0, 500);
}

/**
 * Porcelain yolları DEPO KÖKÜNE göredir; proje deponun alt klasöründeyse (`git rev-parse --show-prefix`, ör. "paketler/uygulama/")
 * yollar proje klasörüne göre çevrilir. Önek dışındaki yollar atılır.
 */
export function relativeToProject(files: GitFile[], prefix: string): GitFile[] {
  const clean = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean) return files;
  const head = fold(`${clean}/`);
  return files.filter((file) => fold(file.path).startsWith(head)).map((file) => ({ ...file, path: file.path.slice(head.length) }));
}

/** Git deposu değilse `{ git: false, files: [] }`. Yalnız proje klasörünün altı (deponun geri kalanı bu oturumun projesi değil). */
export async function gitSummary(cwd: string): Promise<GitSummary> {
  const [status, prefix, branch] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    git(cwd, ['rev-parse', '--show-prefix']),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);
  if (!status.ok) return { git: false, files: [] };
  return {
    git: true,
    ...(branch.ok && branch.output.trim() ? { branch: branch.output.trim() } : {}),
    files: relativeToProject(parsePorcelain(status.output), prefix.ok ? prefix.output.trim() : ''),
  };
}

const DIFF_LIMIT = 200_000;

/** Tek dosyanın farkı (izlenmeyen dosya: içeriği "+" satırlarıyla). `file` proje klasörünün içinde olmalı; değilse fırlatır. */
export async function gitDiff(cwd: string, file: string): Promise<{ diff: string; truncated: boolean }> {
  const root = path.resolve(cwd);
  const full = path.resolve(cwd, file);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(t('claude.git.outside'));
  // Bağlantı (symlink / junction) proje dışına çıkarıyorsa okunmaz.
  if (!isReallyInside(root, full)) throw new Error(t('claude.git.outsideLink'));
  const relative = path.relative(root, full);
  const result = await git(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD', '--', relative], 8 * 1024 * 1024);
  let diff = result.ok ? result.output : '';
  if (!diff && fs.existsSync(full) && fs.statSync(full).isFile()) {
    const content = fs.readFileSync(full, 'utf8').slice(0, DIFF_LIMIT);
    diff = `--- /dev/null\n+++ b/${relative.replace(/\\/g, '/')}\n${content
      .split('\n')
      .map((line) => `+${line}`)
      .join('\n')}`;
  }
  return { diff: diff.slice(0, DIFF_LIMIT), truncated: diff.length > DIFF_LIMIT };
}

// ── "@" dosya önerisi için proje dosyaları (.gitignore'a uyar) ──
// Ana süreç ASLA donmaz: gezinti eşzamansız, klasör/dosya/süre bütçeli, kısmi sonuç `truncated` ile döner; ağır klasörler atlanır;
// klasör başına aynı anda TEK tarama (sonraki tuş vuruşları onu bekler); önbellek sınırlı. Git listesi taşar ya da zaman aşımına
// uğrarsa gezintiye DÜŞÜLMEZ: kısmi git listesi döner.
const SKIPPED = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'dist', 'build', 'out', 'release', '.next', '.nuxt', '.turbo', '.venv', 'venv',
  '__pycache__', '.cache', 'coverage', 'target', '.gradle', '.idea', '.vs', '.pnpm-store', '.yarn', '.npm',
  // Ev klasörü ya da sistem kökü proje seçildiyse:
  'AppData', 'Application Data', '$Recycle.Bin', 'System Volume Information', 'Windows', 'WinSxS', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Library', '.Trash',
]);

export interface ProjectFileList {
  list: string[];
  truncated: boolean;
  source: 'git' | 'walk';
}

export interface ScanOptions {
  dirLimit?: number;
  fileLimit?: number;
  /** Gezinti süre bütçesi (ms). */
  timeMs?: number;
  gitMaxBytes?: number;
  gitTimeoutMs?: number;
}

const SCAN_DEFAULTS: Required<ScanOptions> = { dirLimit: 5000, fileLimit: 50_000, timeMs: 300, gitMaxBytes: 16 * 1024 * 1024, gitTimeoutMs: 5000 };
const CACHE_TTL_MS = 10_000;
const CACHE_LIMIT = 16;
const fileCache = new Map<string, { at: number; result: ProjectFileList }>();
const running = new Map<string, Promise<ProjectFileList>>();

/** Sınamalar için. */
export const clearFileCache = (): void => fileCache.clear();

const slashes = (value: string): string => value.replace(/\\/g, '/');

/** `git ls-files -co --exclude-standard -z`. `none`: depo değil / git yok (gezintiye geçilir); `partial`: taştı / zaman aşımı. */
function gitFiles(root: string, options: Required<ScanOptions>): Promise<{ state: 'ok' | 'partial' | 'none'; list: string[] }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', root, ...GIT_HARDENING, 'ls-files', '-co', '--exclude-standard', '-z'],
      { timeout: options.gitTimeoutMs, maxBuffer: options.gitMaxBytes, windowsHide: true, encoding: 'utf8', env: gitEnv() },
      (error, stdout) => {
        const parts = String(stdout ?? '').split('\0');
        if (!error) return resolve({ state: 'ok', list: parts.filter(Boolean).slice(0, options.fileLimit).map(slashes) });
        const failure = error as Error & { code?: unknown; killed?: boolean };
        if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || failure.killed === true) {
          // Son parça yarım olabilir.
          parts.pop();
          return resolve({ state: 'partial', list: parts.filter(Boolean).slice(0, options.fileLimit).map(slashes) });
        }
        resolve({ state: 'none', list: [] });
      },
    );
  });
}

/** Eşzamansız, enine (önce sığ klasörler) ve bütçeli gezinti; bağlantılar izlenmez. */
async function walk(root: string, options: Required<ScanOptions>): Promise<{ list: string[]; truncated: boolean }> {
  const deadline = Date.now() + options.timeMs;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const list: string[] = [];
  let head = 0;
  let truncated = false;
  while (head < queue.length) {
    if (head >= options.dirLimit || list.length >= options.fileLimit || Date.now() > deadline) {
      truncated = true;
      break;
    }
    const { dir, depth } = queue[head++]!;
    let handle: fs.Dir;
    try {
      handle = await fs.promises.opendir(dir, { bufferSize: 64 });
    } catch {
      continue;
    }
    try {
      for await (const entry of handle) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!SKIPPED.has(entry.name) && depth < 12) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        } else if (entry.isFile()) {
          list.push(slashes(path.relative(root, path.join(dir, entry.name))));
        }
        if (list.length >= options.fileLimit || Date.now() > deadline) {
          truncated = true;
          break;
        }
      }
    } catch {
      // okunamayan klasör
    }
    if (truncated) break;
  }
  return { list, truncated };
}

/** "@" önerisinin dosyaları: git deposunda `.gitignore`'a uyan liste (taşarsa kısmi), değilse bütçeli gezinti. 10 sn önbellek. */
export function projectFiles(cwd: string, options: ScanOptions = {}): Promise<ProjectFileList> {
  const root = path.resolve(cwd);
  const cached = fileCache.get(root);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.result);
  const pending = running.get(root);
  if (pending) return pending;
  const settings = { ...SCAN_DEFAULTS, ...options };
  const task = (async (): Promise<ProjectFileList> => {
    const tracked = await gitFiles(root, settings);
    const result: ProjectFileList =
      tracked.state === 'none'
        ? { ...(await walk(root, settings)), source: 'walk' }
        : { list: tracked.list, truncated: tracked.state === 'partial' || tracked.list.length >= settings.fileLimit, source: 'git' };
    fileCache.delete(root);
    fileCache.set(root, { at: Date.now(), result });
    while (fileCache.size > CACHE_LIMIT) fileCache.delete(fileCache.keys().next().value as string);
    return result;
  })().finally(() => running.delete(root));
  running.set(root, task);
  return task;
}

/**
 * "@" dosya önerisi: en çok `limit` (50) yol. Sıra: yolun başı → dosya adının başı → bir klasör adının başı → içinde geçen →
 * harf sırası korunarak dağınık eşleşme (bulanık); eşitlikte kısa yol önce. Boş sorgu: en sığ yollar.
 */
export function matchFiles(list: string[], query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase().replace(/\\/g, '/').replace(/^@/, '');
  const depth = (file: string): number => file.split('/').length;
  if (!q) return list.slice().sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, limit);
  const scored: Array<{ file: string; score: number }> = [];
  for (const file of list) {
    const lower = file.toLowerCase();
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    let score = -1;
    if (lower.startsWith(q)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (lower.split('/').some((segment) => segment.startsWith(q))) score = 2;
    else if (lower.includes(q)) score = 3;
    else {
      let matched = 0;
      let gaps = 0;
      let last = -1;
      for (let j = 0; j < lower.length && matched < q.length; j++) {
        if (lower[j] === q[matched]) {
          if (last >= 0) gaps += j - last - 1;
          last = j;
          matched++;
        }
      }
      if (matched === q.length) score = 4 + Math.min(gaps, 500) / 1000;
    }
    if (score >= 0) scored.push({ file, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.file.length - b.file.length || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map((item) => item.file);
}
