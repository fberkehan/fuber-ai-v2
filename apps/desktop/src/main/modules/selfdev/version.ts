// Sürüm artırma: paket üretmeden önce worktree'de, KODLA ve deterministik (Claude'a bırakılmaz).
//   2.0.0-demo.3          → 2.0.0-demo.3.dev.1   (ön sürümü olan: ".dev.N" eklenir; semver'de daha büyüktür, bir sonraki
//                                                  gerçek sürümden (2.0.0-demo.4) küçüktür)
//   2.0.0-demo.3.dev.1    → 2.0.0-demo.3.dev.2
//   2.0.0                 → 2.0.1-dev.1          (ön sürümü olmayan: yama artırılır; 2.0.1-dev.N < 2.0.1)
// Karşılaştırma `compareVersions`'tadır (packages/shared/src/policy.ts); `release.minVersion` kapısını bozmaz: yeni sürüm
// kendi tabanından büyük, sonraki yayından küçüktür. electron-builder semver'i kabul eder (sayısal tanımlayıcılarda sıfır başı yok).
import fs from 'node:fs';
import path from 'node:path';

export interface DevVersion {
  version: string;
  /** `.dev.N` / `-dev.N` içindeki N. */
  devNumber: number;
  /** Artırmadan önceki, `dev` eksiz taban sürüm. */
  root: string;
}

const DEV_SUFFIX = /[-.]dev\.(\d+)$/;

/**
 * Bir sonraki `dev` sürümü. `knownMax`: bu motorun daha önce ürettiği en büyük N (depodaki sürüm bundan geride kalsa da
 * aynı numara iki kez üretilmez).
 */
export function nextDevVersion(base: string, knownMax = 0): DevVersion {
  const trimmed = base.trim().replace(/^v/, '');
  const match = DEV_SUFFIX.exec(trimmed);
  const root = match ? trimmed.slice(0, match.index) : trimmed;
  const previous = match ? Number.parseInt(match[1]!, 10) : 0;
  const devNumber = Math.max(previous, knownMax) + 1;
  if (root.includes('-')) return { version: `${root}.dev.${devNumber}`, devNumber, root };
  // Ön sürümsüz tabanın kendisi zaten "-dev.N" ise (önceki artırmanın ürünü) yama yeniden artırılmaz.
  if (match && match[0].startsWith('-')) return { version: `${root}-dev.${devNumber}`, devNumber, root };
  const parts = root.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) throw new Error(`tanınmayan sürüm: ${base}`);
  const [major, minor, patch] = parts as [number, number, number];
  return { version: `${major}.${minor}.${patch + 1}-dev.${devNumber}`, devNumber, root };
}

/** Sürümün `.dev.N` numarası; yoksa 0. */
export function devNumberOf(version: string): number {
  const match = DEV_SUFFIX.exec(version.trim());
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

/** Birlikte değişen sürüm dosyaları (depo köküne göre). */
export const VERSION_FILES = [
  'package.json',
  'apps/desktop/package.json',
  'apps/admin/package.json',
  'packages/control/package.json',
  'packages/shared/package.json',
  'packages/ui/package.json',
] as const;
export const CONSTANTS_FILE = 'packages/shared/src/constants.ts';
export const LOCK_FILE = 'package-lock.json';
/** `package-lock.json` içinde workspace sürümü taşıyan girişler. */
const LOCK_WORKSPACES = ['', 'apps/desktop', 'apps/admin', 'packages/control', 'packages/shared', 'packages/ui'];

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');

/** Kökteki `package.json` sürümü. */
export function readVersion(repo: string): string {
  const parsed = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string') throw new Error('package.json sürüm taşımıyor');
  return parsed.version;
}

/**
 * `repo` içindeki bütün sürüm alanlarını `version` yapar: kök ve çalışma alanı `package.json`'ları, `APP_VERSION`,
 * `package-lock.json` çalışma alanı girişleri. Biçim (girinti, satır sonu) korunur. Dönüş: değişen dosyalar.
 */
export function applyVersion(repo: string, version: string): string[] {
  const changed: string[] = [];
  for (const rel of VERSION_FILES) {
    const file = path.join(repo, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
    if (next !== text) {
      fs.writeFileSync(file, next, 'utf8');
      changed.push(rel);
    }
  }
  const constants = path.join(repo, CONSTANTS_FILE);
  if (fs.existsSync(constants)) {
    const text = fs.readFileSync(constants, 'utf8');
    const next = text.replace(/(export const APP_VERSION\s*=\s*)'[^']*'/, `$1'${version}'`);
    if (next !== text) {
      fs.writeFileSync(constants, next, 'utf8');
      changed.push(CONSTANTS_FILE);
    }
  }
  const lock = path.join(repo, LOCK_FILE);
  if (fs.existsSync(lock)) {
    const text = fs.readFileSync(lock, 'utf8');
    const parsed = JSON.parse(text) as { version?: string; packages?: Record<string, { version?: string }> };
    let touched = false;
    if (typeof parsed.version === 'string' && parsed.version !== version) {
      parsed.version = version;
      touched = true;
    }
    for (const key of LOCK_WORKSPACES) {
      const entry = parsed.packages?.[key];
      if (entry && typeof entry.version === 'string' && entry.version !== version) {
        entry.version = version;
        touched = true;
      }
    }
    if (touched) {
      const eol = eolOf(text);
      const body = JSON.stringify(parsed, null, 2).replace(/\n/g, eol) + (text.endsWith('\n') ? eol : '');
      fs.writeFileSync(lock, body, 'utf8');
      changed.push(LOCK_FILE);
    }
  }
  return changed;
}

/** Üretilen kurulum paketinin dosya adı (`electron-builder.yml` › `artifactName`). */
export const installerName = (version: string): string => `Fuber AI 2 Kurulum ${version}.exe`;
