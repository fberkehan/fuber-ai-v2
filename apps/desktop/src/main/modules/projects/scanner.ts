// Proje taraması: kök klasör(ler)de `.git` ya da bilinen bildirim dosyası olan klasörleri bulur.
// Proje bulununca içine inilmez (tek depo içindeki alt paketler ayrı proje sayılmaz). Büyük ağaçta hızlı
// olsun diye derinlik sınırlı ve bağımlılık/derleme/yedek klasörleri hiç açılmaz.
import fs from 'node:fs/promises';
import path from 'node:path';

const MANIFESTS: Record<string, string> = {
  'package.json': 'node',
  'pubspec.yaml': 'flutter',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'setup.py': 'python',
  'Cargo.toml': 'rust',
  'go.mod': 'go',
  'composer.json': 'php',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'build.gradle.kts': 'java',
  'Gemfile': 'ruby',
  'deno.json': 'deno',
  'Package.swift': 'swift',
  'CMakeLists.txt': 'cpp',
};

const SKIP_DIRS = new Set([
  'node_modules', 'build', 'dist', 'out', 'target', 'release', 'releases', 'coverage', 'vendor', 'venv', 'env',
  '__pycache__', 'bin', 'obj', 'pods', 'tmp', 'temp', 'cache', 'logs', 'artifacts', 'site-packages',
]);
const SKIP_PATTERN = /^(yedek|backup|backups|_?ar[sş]iv|archive|old|eski)([-_ .]|$)|\.(bak|old|orig)$|^dist-/i;

const NODE_FRAMEWORKS: Array<[string, string]> = [
  ['next', 'next'],
  ['astro', 'astro'],
  ['electron', 'electron'],
  ['react-native', 'react-native'],
  ['expo', 'expo'],
  ['react', 'react'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['vite', 'vite'],
];

export interface ScannedProject {
  path: string;
  name: string;
  stack: string[];
  gitBranch: string | null;
  modifiedAt: string;
}

export interface ScanResult {
  projects: ScannedProject[];
  dirsVisited: number;
  durationMs: number;
}

async function readText(file: string, max = 64 * 1024): Promise<string | null> {
  try {
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(max);
      const { bytesRead } = await handle.read(buffer, 0, max, 0);
      return buffer.toString('utf8', 0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** `.git/HEAD` içinden dal adı; ayrık HEAD ya da okunamazsa `null`. */
async function gitBranch(gitDir: string): Promise<string | null> {
  const head = await readText(path.join(gitDir, 'HEAD'), 512);
  const match = head ? /^ref:\s*refs\/heads\/(.+)$/m.exec(head.trim()) : null;
  return match?.[1]?.trim() ?? null;
}

async function mtime(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Tek klasörü proje olarak inceler. `force`: bildirim dosyası olmasa da proje say (Claude Code oturumunun
 * çalıştığı klasör). Proje değilse `null`. Git çalışma ağacı (`.git` dosyası `worktrees/`'a bakıyorsa) atlanır:
 * geçicidir ve ana deponun kopyasıdır.
 */
export async function inspectDir(dir: string, names?: string[], force = false): Promise<ScannedProject | null> {
  let entries = names;
  if (!entries) {
    try {
      entries = await fs.readdir(dir);
    } catch {
      return null;
    }
  }
  const set = new Set(entries);
  const stack: string[] = [];
  let branch: string | null = null;
  let isProject = false;
  let gitIndexTime = 0;

  if (set.has('.git')) {
    const gitPath = path.join(dir, '.git');
    try {
      const stat = await fs.stat(gitPath);
      if (stat.isDirectory()) {
        isProject = true;
        stack.push('git');
        branch = await gitBranch(gitPath);
        gitIndexTime = await mtime(path.join(gitPath, 'index'));
      } else {
        const pointer = (await readText(gitPath, 1024)) ?? '';
        if (/[\\/]worktrees[\\/]/.test(pointer)) return null;
        isProject = true;
        stack.push('git');
      }
    } catch {
      // erişilemeyen .git: yok say
    }
  }
  for (const [file, tag] of Object.entries(MANIFESTS)) {
    if (!set.has(file)) continue;
    isProject = true;
    if (!stack.includes(tag)) stack.push(tag);
  }
  if (entries.some((name) => name.endsWith('.sln') || name.endsWith('.csproj'))) {
    isProject = true;
    stack.push('dotnet');
  }
  if (!isProject && !force) return null;

  if (set.has('package.json')) {
    const raw = await readText(path.join(dir, 'package.json'));
    try {
      const pkg = raw ? (JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }) : null;
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      for (const [dep, tag] of NODE_FRAMEWORKS) if (dep in deps && !stack.includes(tag)) stack.push(tag);
    } catch {
      // bozuk package.json: yalnız "node"
    }
  }

  // "En son değişiklik" ucuz tahmin: klasörün, en üst düzey girdilerin ve git indeksinin en yenisi.
  let newest = Math.max(await mtime(dir), gitIndexTime);
  const sample = entries.filter((name) => !SKIP_DIRS.has(name.toLowerCase()) && name !== '.git').slice(0, 60);
  const times = await Promise.all(sample.map((name) => mtime(path.join(dir, name))));
  for (const time of times) if (time > newest) newest = time;

  return {
    path: dir,
    name: path.basename(dir),
    stack,
    gitBranch: branch,
    modifiedAt: new Date(newest || Date.now()).toISOString(),
  };
}

/** Kökleri derinlik sınırıyla tarar. Erişilemeyen klasörler sessizce atlanır. */
export async function scanRoots(roots: string[], maxDepth = 4): Promise<ScanResult> {
  const started = Date.now();
  const projects: ScannedProject[] = [];
  const seen = new Set<string>();
  let dirsVisited = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    const key = dir.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirsVisited++;
    if (depth > 0) {
      const project = await inspectDir(dir, dirents.map((entry) => entry.name));
      if (project) {
        projects.push(project);
        return;
      }
    }
    if (depth >= maxDepth) return;
    const children = dirents.filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('$') &&
        !SKIP_DIRS.has(entry.name.toLowerCase()) &&
        !SKIP_PATTERN.test(entry.name),
    );
    // Aynı anda çok klasör açmak diski boğar; küçük gruplar hâlinde.
    for (let i = 0; i < children.length; i += 16) {
      await Promise.all(children.slice(i, i + 16).map((entry) => walk(path.join(dir, entry.name), depth + 1)));
    }
  };

  for (const root of roots) await walk(path.resolve(root), 0);
  return { projects, dirsVisited, durationMs: Date.now() - started };
}

/** `child` klasörü `parent`'ın kendisi ya da altında mı (büyük/küçük harf duyarsız, Windows). */
export function isInside(child: string, parent: string): boolean {
  const c = path.resolve(child).toLowerCase();
  const p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}
