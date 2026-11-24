/**
 * Claude Code ikilisini bulma. v1'den (0.18.2 `claudecode/claude-ara.ts`) uyarlandı; oradaki kanıtlı tuzaklar:
 *  - Kurulu uygulamanın PATH'i Explorer'ın OTURUM AÇILIŞINDA aldığı kopyadır: Claude Code sonradan kurulduysa süreç onu
 *    görmez. Bu yüzden kayıt defterindeki GÜNCEL kullanıcı + makine PATH'i de aranır.
 *  - `npm -g` kurulumunda PATH'te yalnız `claude.cmd` kabuğu vardır; `.cmd` kabuksuz başlatılamaz (EINVAL). Yanındaki
 *    paketin gerçek ikilisine çözülür.
 *  - "Yok" sonucu yalnız kısa süre önbelleğe alınır: CLI sonradan kurulunca uygulama yeniden açılmadan bulunur.
 * Sıra (hepsi yalnız arar, çalıştırmaz): sürecin PATH'i (`where`) → bilinen kurulum yerleri → kayıt defteri PATH'i.
 * Arama saftır: ortam dışarıdan verilir (`findClaudeCli`), gerçek ortam `locateClaudeCli` içinde kurulur.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SearchEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  exists(file: string): boolean;
  /** `where claude` / `which claude` çıktısının satırları. */
  where(): string[];
  /** Kayıt defterinden (HKCU + HKLM) güncel PATH girdileri, genişletilmiş. */
  registryPath(): string[];
}

const NPM_BINARY = ['node_modules', '@anthropic-ai', 'claude-code', 'bin'];

/** Bir klasörde claude ikilisi: doğrudan ya da yanındaki npm paketinin içinde. */
function findInDir(dir: string, search: SearchEnv): string | null {
  const name = search.platform === 'win32' ? 'claude.exe' : 'claude';
  const direct = path.join(dir, name);
  if (search.exists(direct)) return direct;
  const npm = path.join(dir, ...NPM_BINARY, name);
  return search.exists(npm) ? npm : null;
}

/** `%AD%` genişletmesi (kayıttaki REG_EXPAND_SZ); bilinmeyen değişken olduğu gibi kalır. */
export function expandEnv(text: string, env: Record<string, string | undefined>): string {
  return text.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key && env[key] ? env[key] : whole;
  });
}

/** `reg query … /v Path` çıktısından PATH girdileri. */
export function parseRegistryPath(output: string, env: Record<string, string | undefined>): string[] {
  const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(output);
  if (!match) return [];
  return expandEnv(match[1]!.trim(), env)
    .split(';')
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

export function findClaudeCli(search: SearchEnv): string | null {
  const win = search.platform === 'win32';
  let lines: string[] = [];
  try {
    lines = search
      .where()
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // `where` çalışmadı: bilinen yerlere geçilir
  }
  const binary = lines.find((line) => /\.exe$/i.test(line) || (!win && path.isAbsolute(line)));
  if (binary && search.exists(binary)) return binary;
  // `.cmd` ya da uzantısız npm kabuğu: aynı klasördeki paketin gerçek ikilisi.
  for (const line of lines) {
    const found = findInDir(path.dirname(line), search);
    if (found) return found;
  }

  const known = [
    path.join(search.home, '.local', 'bin'),
    ...(search.env.APPDATA ? [path.join(search.env.APPDATA, 'npm')] : []),
    ...(search.env.LOCALAPPDATA ? [path.join(search.env.LOCALAPPDATA, 'Programs', 'claude'), path.join(search.env.LOCALAPPDATA, 'Programs', 'claude-code')] : []),
    path.join(search.home, '.claude', 'local'),
    path.join(search.home, 'AppData', 'Roaming', 'npm'),
  ];
  for (const dir of known) {
    const found = findInDir(dir, search);
    if (found) return found;
  }

  if (win) {
    let entries: string[] = [];
    try {
      entries = search.registryPath();
    } catch {
      // kayıt okunamadı
    }
    for (const dir of entries) {
      const found = findInDir(dir, search);
      if (found) return found;
    }
  }
  return null;
}

function registryPath(): string[] {
  const out: string[] = [];
  for (const key of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      out.push(...parseRegistryPath(output, process.env));
    } catch {
      // anahtar yok ya da okunamadı
    }
  }
  return out;
}

/** "Yok" sonucunun önbellekte kalma süresi. */
export const NOT_FOUND_CACHE_MS = 10_000;
let cached: string | null | undefined;
let notFoundAt = 0;

/** Bu bilgisayardaki `claude` ikilisinin yolu; yoksa `null`. Bulunan yol süreç boyunca, "yok" 10 sn önbellekte kalır. */
export function locateClaudeCli(): string | null {
  if (cached && fs.existsSync(cached)) return cached;
  if (cached === null && Date.now() - notFoundAt < NOT_FOUND_CACHE_MS) return null;
  cached = findClaudeCli({
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    exists: (file) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    },
    where: () =>
      execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/),
    registryPath,
  });
  if (!cached) notFoundAt = Date.now();
  return cached;
}

/** Önbelleği bırakır (CLI az önce kuruldu ya da kaldırıldı). */
export function resetClaudeCliCache(): void {
  cached = undefined;
  notFoundAt = 0;
}
