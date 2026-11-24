// Çekirdek geliştirmenin git yardımcıları. Hepsi `execFile('git', [...], { cwd })` (kabuk yok), zaman aşımlı. Kaynak deposunun
// ana çalışma kopyasına YAZMAZ: yalnız ayrı bir worktree ve dal açar. `modules/projects/claude/git.ts` ile aynı sertleştirme
// (modüller birbirini içe aktarmaz; kopya bilerek): izleme kancası, harici fark programı ve depo kancaları çalışmaz.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HARDENING = ['--no-optional-locks', '-c', 'core.fsmonitor=', '-c', 'diff.external=', '-c', 'core.hooksPath=NUL_HOOKS_DISABLED', '-c', 'protocol.ext.allow=never'];

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_PAGER;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

export interface GitOutput {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** `git -C <cwd> <argümanlar>`; hiç fırlatmaz. */
export function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<GitOutput> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...HARDENING, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: gitEnv() },
      (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? (error ? error.message : '')) }),
    );
  });
}

/** Deponun o anki HEAD işlemesi (tam karma); yoksa `null`. */
export async function headCommit(cwd: string, rev = 'HEAD'): Promise<string | null> {
  const result = await git(cwd, ['rev-parse', '--verify', `${rev}^{commit}`]);
  return result.ok ? result.stdout.trim() || null : null;
}

/** Çalışma kopyasında değişiklik var mı (izlenmeyen dosyalar dahil). Dönüş: değişen yollar. */
export async function status(cwd: string): Promise<string[]> {
  const result = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!result.ok) return [];
  const files: string[] = [];
  const parts = result.stdout.split('\0');
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index]!;
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    files.push(entry.slice(3));
    // Yeniden adlandırmada sonraki parça eski addır.
    if (code.includes('R') || code.includes('C')) index++;
  }
  return files;
}

/** `base`'den bu yana değişen dosyalar (işlenmiş + işlenmemiş + izlenmeyen), tekrarsız. */
export async function changedFiles(cwd: string, base: string): Promise<string[]> {
  const committed = await git(cwd, ['diff', '--name-only', '-z', base, 'HEAD']);
  const names = new Set<string>();
  if (committed.ok) for (const name of committed.stdout.split('\0')) if (name) names.add(name);
  for (const name of await status(cwd)) names.add(name);
  return [...names].sort();
}

/** `git diff --stat` özeti (son satır: "3 files changed, 40 insertions(+)"). */
export async function diffStat(cwd: string, base: string): Promise<string> {
  const result = await git(cwd, ['diff', '--stat', '--no-ext-diff', base, 'HEAD']);
  return result.ok ? result.stdout.trim() : '';
}

/** Dal adı kuralı: yalnız güvenli karakterler. */
export const isSafeBranch = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,98}$/.test(name) && !name.includes('..');

export interface WorktreeLayout {
  /** Worktree klasörü: `<depo üst klasörü>/<depo adı>-wt/selfdev-<kısa>`. */
  dir: string;
  branch: string;
}

/** Düzen: `<depo>` → `<depo>-wt\selfdev-<kısa>`; dal `selfdev/<kısa>`. */
export function worktreeLayout(repoRoot: string, shortId: string): WorktreeLayout {
  const root = path.resolve(repoRoot);
  return { dir: path.join(path.dirname(root), `${path.basename(root)}-wt`, `selfdev-${shortId}`), branch: `selfdev/${shortId}` };
}

/**
 * Yeni dal + worktree açar (`git worktree add -b <dal> <klasör> <taban>`). Mevcut dallara ve çalışma kopyasına dokunmaz.
 * Klasör zaten varsa reddeder.
 */
export async function worktreeAdd(repo: string, dir: string, branch: string, base: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSafeBranch(branch)) return { ok: false, error: `güvensiz dal adı: ${branch}` };
  if (fs.existsSync(dir)) return { ok: false, error: `klasör zaten var: ${dir}` };
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const result = await git(repo, ['worktree', 'add', '-b', branch, dir, base], 120_000);
  return result.ok ? { ok: true } : { ok: false, error: result.stderr.trim().slice(-400) || 'git worktree add başarısız' };
}

/**
 * Her şeyi işler (`git add -A` + işleme). Kimlik sabittir, imza ve kancalar kapalıdır. İşlenecek değişiklik yoksa `null`.
 * Dönüş: yeni işlemenin karması.
 */
export async function commitAll(cwd: string, message: string): Promise<string | null> {
  const added = await git(cwd, ['add', '-A']);
  if (!added.ok) return null;
  const pending = await git(cwd, ['diff', '--cached', '--quiet']);
  if (pending.ok) return null; // çıkış 0: hazırlanan değişiklik yok
  const committed = await git(cwd, ['-c', 'user.name=Fuber AI v2', '-c', 'user.email=selfdev@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', message]);
  if (!committed.ok) return null;
  return headCommit(cwd);
}

/**
 * Worktree'yi YALNIZ temizse kaldırır (`git worktree remove`, ASLA `--force`). Kirliyse ya da kaldırılamazsa olduğu gibi
 * bırakır (inceleme için). Dal silinmez.
 */
export async function worktreeRemoveIfClean(repo: string, dir: string): Promise<{ removed: boolean; reason: string }> {
  if (!fs.existsSync(dir)) return { removed: true, reason: 'klasör zaten yok' };
  const dirty = await status(dir);
  if (dirty.length > 0) return { removed: false, reason: `${dirty.length} değişiklik işlenmemiş; olduğu gibi bırakıldı` };
  const result = await git(repo, ['worktree', 'remove', dir], 120_000);
  return result.ok ? { removed: true, reason: 'kaldırıldı' } : { removed: false, reason: result.stderr.trim().slice(-300) || 'kaldırılamadı' };
}
