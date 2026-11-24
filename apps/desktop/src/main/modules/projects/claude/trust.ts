/**
 * Klasör güveni (v1 `claudecode/klasor-guveni.ts` + `ccOnKancaKarari`'dan taşındı): klasörün KENDİ Claude Code ayarları —
 * kancalar, izin kuralları, MCP sunucuları, komut/beceri/ajan.
 *
 * Başsız Claude Code terminaldeki "Bu klasöre güveniyor musun?" sorusunu SORMAZ: `--setting-sources` verilmezse yeni klonlanmış
 * bir deponun `.claude/settings.json` kancaları ilk oturumda çalışır, izin kuralları geçerli olur, `.mcp.json` sunucuları başlar.
 * Uygulama kendi kartını gösterir ve kararı klasör başına saklar.
 *  - Güvenilmeyen ya da kararı verilmemiş klasör: yalnız kullanıcı ayarları yüklenir (proje + yerel kaynak yok); `.mcp.json`
 *    varsa klasörün MCP sunucuları da başlamaz.
 *  - Hangi dosyalar (Claude Code ikilisinden okundu): proje ayarı `cwd/.claude/settings.json`; yerel ayar `cwd` ya da git
 *    kökünde `.claude/settings.local.json`; `.mcp.json` `cwd`'den yukarı her klasörde. Kullanıcının kendi `~/.claude`'u sayılmaz.
 *  - v2 farkı: kullanıcı karar vermemişse Claude Code'un KENDİ güven kaydına bakılır (`~/.claude.json`): kullanıcı o klasöre
 *    terminalde zaten güvendiyse burada da güvenilir (v1'de bu kapı yüzünden skill/MCP yüklenmiyordu).
 * Electron'a bağlı değildir: kararların deposu dışarıdan verilir.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '@fuber/shared';
import type { FolderTrustState } from './types';

export type TrustDecision = 'trust' | 'distrust';

export interface TrustRecord {
  decision: TrustDecision;
  /** Kararın verildiği andaki ayar dosyalarının parmak izi; değişince "güven" kararı yeniden sorulur. */
  fingerprint?: string;
}

export interface FolderSettings {
  /** Klasörün kendi ayarı var: karar gerekir. */
  required: boolean;
  files: Array<{ path: string; summary: string }>;
  /** Kanca tanımı ya da kanca betiği var. */
  hooks: boolean;
  mcp: boolean;
  /** Taranan dosya kümesinin özeti (adlar + içerikler, SHA-256); ayarsız klasörde boş; bütçe aşıldıysa `FINGERPRINT_UNBOUNDED`. */
  fingerprint: string;
  /** Bütçe aşıldı ya da içerik izlenemiyor (bağlantı): "güven" kararı saklanmaz, ayarlar yüklenmez. */
  unbounded?: boolean;
}

const READ_LIMIT = 512 * 1024;
const MAX_DEPTH = 40;
const WIN = process.platform === 'win32';

/** Görünen metinde denetim ve yön karakterleri yok (dosya içeriği güvenilmez). */
const sanitize = (value: unknown, max = 40): string => {
  // eslint-disable-next-line no-control-regex
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const isFile = (file: string): boolean => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};
const isDir = (dir: string): boolean => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};
const fold = (value: string): string => (WIN ? value.toLowerCase() : value);
const samePath = (a: string, b: string): boolean => fold(path.resolve(a)) === fold(path.resolve(b));
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function readJson(file: string): { json?: Record<string, unknown>; problem?: string } {
  try {
    if (fs.statSync(file).size > READ_LIMIT) return { problem: t('claude.trust.summary.tooLarge') };
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
    return isRecord(parsed) ? { json: parsed } : { problem: t('claude.trust.summary.badShape') };
  } catch {
    return { problem: t('claude.trust.summary.unreadable') };
  }
}

const nameList = (names: string[], max = 4): string =>
  names
    .slice(0, max)
    .map((name) => sanitize(name, 32))
    .join(', ') + (names.length > max ? ` +${names.length - max}` : '');

const hasHookEntries = (json: Record<string, unknown>): boolean =>
  isRecord(json.hooks) && Object.values(json.hooks).some((value) => Array.isArray(value));

/** `settings(.local).json` için kısa özet: kancalar, izin kuralları, ortam, eklenti, yardımcı komutlar. */
export function settingsSummary(json: Record<string, unknown>): string {
  const parts: string[] = [];
  if (isRecord(json.hooks)) {
    const hooks = json.hooks;
    const events = Object.keys(hooks).filter((key) => Array.isArray(hooks[key]));
    if (events.length) parts.push(t('claude.trust.summary.hooks', { names: nameList(events) }));
  }
  if (json.disableAllHooks === true) parts.push(t('claude.trust.summary.hooksDisabled'));
  const permissions = isRecord(json.permissions) ? json.permissions : {};
  const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  if (count(permissions.allow)) parts.push(t('claude.trust.summary.allowRules', { count: count(permissions.allow) }));
  if (count(permissions.ask) || count(permissions.deny)) {
    parts.push(t('claude.trust.summary.askDenyRules', { count: count(permissions.ask) + count(permissions.deny) }));
  }
  if (typeof permissions.defaultMode === 'string') parts.push(t('claude.trust.summary.defaultMode', { mode: sanitize(permissions.defaultMode, 20) }));
  if (count(permissions.additionalDirectories)) parts.push(t('claude.trust.summary.extraDirs', { count: count(permissions.additionalDirectories) }));
  if (isRecord(json.env) && Object.keys(json.env).length) parts.push(t('claude.trust.summary.env', { count: Object.keys(json.env).length }));
  if (isRecord(json.enabledPlugins) && Object.keys(json.enabledPlugins).length) {
    parts.push(t('claude.trust.summary.plugins', { count: Object.keys(json.enabledPlugins).length }));
  }
  if (json.enableAllProjectMcpServers === true || count(json.enabledMcpjsonServers)) parts.push(t('claude.trust.summary.enablesMcp'));
  for (const key of ['apiKeyHelper', 'statusLine', 'awsAuthRefresh', 'otelHeadersHelper'] as const) {
    if (json[key] !== undefined) parts.push(t(`claude.trust.summary.${key}`));
  }
  return parts.length ? parts.join(' · ') : t('claude.trust.summary.settingsFile');
}

function mcpSummary(json: Record<string, unknown>): string {
  const servers = isRecord(json.mcpServers) ? Object.keys(json.mcpServers) : [];
  return servers.length ? t('claude.trust.summary.mcpServers', { names: nameList(servers) }) : t('claude.trust.summary.mcpConfig');
}

function gitRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// ── Parmak izi bütçesi: bir izde en çok 400 girdi (dosya + klasör, TOPLAM) ve 4 MB; tek dosya en çok 512 KB.
// Aşılırsa iz "sınırsız" olur: "güven" kararı kabul edilmez (yeniden sorulur), "güvenme" geçerli kalır; sessizce kabul yok.
export const FINGERPRINT_MAX_ENTRIES = 400;
export const FINGERPRINT_MAX_BYTES = 4 * 1024 * 1024;
export const FINGERPRINT_UNBOUNDED = 'unbounded';

interface Budget {
  entries: number;
  bytes: number;
  unbounded: boolean;
  seen: Set<string>;
}

/** İçerik özeti önbelleği: (yol, mtime, ctime, boyut) → SHA-256. ctime `utimes` ile geri alınamaz; aynı dosya her çağrıda yeniden okunmaz. */
const digestCache = new Map<string, string>();
const DIGEST_CACHE_MAX = 4000;
/** Sınamalar için: önbellekteki kayıt sayısı. */
export const fingerprintCacheSize = (): number => digestCache.size;

/** Dosyayı bütçeyle izlere ekler (aynı dosya bir kez); bütçe aşılınca `unbounded`. */
function addTrace(file: string, show: (file: string) => string, traces: string[], budget: Budget): void {
  if (budget.unbounded) return;
  const key = fold(path.resolve(file));
  if (budget.seen.has(key)) return;
  budget.seen.add(key);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    traces.push(`${show(file)}|unreadable`);
    return;
  }
  budget.entries++;
  budget.bytes += stat.size;
  if (budget.entries > FINGERPRINT_MAX_ENTRIES || stat.size > READ_LIMIT || budget.bytes > FINGERPRINT_MAX_BYTES) {
    budget.unbounded = true;
    return;
  }
  const cacheKey = `${key}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}`;
  let digest = digestCache.get(cacheKey);
  if (!digest) {
    try {
      digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } catch {
      digest = 'unreadable';
    }
    digestCache.set(cacheKey, digest);
    while (digestCache.size > DIGEST_CACHE_MAX) digestCache.delete(digestCache.keys().next().value as string);
  }
  traces.push(`${show(file)}|${digest}`);
}

/** Klasördeki dosyalar, derinlik ve TOPLAM girdi bütçesiyle (klasörler de sayılır). */
function addFolderTraces(root: string, show: (file: string) => string, traces: string[], budget: Budget, depth = 0): void {
  if (budget.unbounded) return;
  if (depth > 6) {
    budget.unbounded = true;
    return;
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (budget.unbounded) return;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (++budget.entries > FINGERPRINT_MAX_ENTRIES) {
        budget.unbounded = true;
        return;
      }
      traces.push(`${show(full)}/`);
      addFolderTraces(full, show, traces, budget, depth + 1);
    } else if (entry.isFile()) {
      addTrace(full, show, traces, budget);
    } else {
      // `.claude/` içinde bağlantı (symlink/junction) ya da özel girdi: hedefi sessizce değişebilir, içerik izlenemez.
      budget.unbounded = true;
      return;
    }
  }
}

/** Girdi bağlantı mı (symlink ya da junction; izlenmez, hedefine gidilmez). */
const isLink = (file: string): boolean => {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Ayar dosyasındaki kanca komutlarının çalıştırdığı, PROJENİN İÇİNDEKİ dosyalar: `.claude/<yol>`
 * (ör. `"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh`) ve `.claude/` dışındakiler (ör. `node tools/hook.js`). Kanca komutu proje
 * klasöründe çalışır; göreli parça projeye göre çözülür. Proje dışındaki yollar klasörün dosyası değildir (sayılmaz).
 */
function hookFiles(json: Record<string, unknown> | undefined, root: string): string[] {
  if (!json || !isRecord(json.hooks)) return [];
  const commands: string[] = [];
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 8) return;
    if (Array.isArray(value)) for (const item of value) walk(item, depth + 1);
    else if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'command' && typeof item === 'string') commands.push(item);
        else walk(item, depth + 1);
      }
    }
  };
  walk(json.hooks);
  const custom = path.join(root, '.claude');
  const out = new Set<string>();
  const add = (full: string): void => {
    if (out.size < FINGERPRINT_MAX_ENTRIES && isFile(full)) out.add(full);
  };
  for (const command of commands.slice(0, 200)) {
    for (const match of command.matchAll(/\.claude[\\/]+([^\s"'`;|&<>()]+)/gi)) {
      const full = path.resolve(custom, match[1]!);
      if (isInsideFolder(custom, full)) add(full);
    }
    // Komutun yol gibi görünen her parçası (ayraç ya da uzantı içeren): proje değişkeni proje köküyle, tırnaklar silinir, `--x=yol`'un yolu.
    const flat = command.replace(/\$\{?CLAUDE_PROJECT_DIR\}?|%CLAUDE_PROJECT_DIR%/g, '.').replace(/["'`]/g, '');
    for (const part of flat.split(/[\s;|&<>()]+/).slice(0, 64)) {
      const candidate = part.includes('=') ? part.slice(part.lastIndexOf('=') + 1) : part;
      if (!candidate || candidate.startsWith('-') || !(/[\\/]/.test(candidate) || /\.[A-Za-z0-9]{1,8}$/.test(candidate))) continue;
      const full = path.resolve(root, candidate);
      if (isInsideFolder(root, full)) add(full);
    }
  }
  return [...out];
}

/**
 * Klasörün kendi Claude Code ayarları. `userClaudeDir`: kullanıcının `~/.claude`'u; `cwd` ev klasörüyse oradaki
 * `settings.json` KULLANICI ayarıdır, klasörün değil.
 */
export function inspectFolderSettings(cwd: string, userClaudeDir?: string): FolderSettings {
  const root = path.resolve(cwd);
  const files: FolderSettings['files'] = [];
  const traces: string[] = [];
  const budget: Budget = { entries: 0, bytes: 0, unbounded: false, seen: new Set() };
  const show = (file: string): string => (path.relative(root, file) || path.basename(file)).split(path.sep).join('/');
  const isUserDir = (claudeFolder: string): boolean => Boolean(userClaudeDir) && samePath(claudeFolder, userClaudeDir!);
  const hookTargets: string[] = [];
  let hooks = false;

  const addSettings = (file: string): void => {
    if (!isFile(file) || isUserDir(path.dirname(file)) || files.some((item) => item.path === show(file))) return;
    const read = readJson(file);
    files.push({ path: show(file), summary: read.json ? settingsSummary(read.json) : read.problem! });
    if (read.json && hasHookEntries(read.json)) hooks = true;
    // Ayar dosyası ya da `.claude` klasörü bağlantıysa hedefi sessizce başka bir dosyaya çevrilebilir.
    if (isLink(file) || isLink(path.dirname(file))) budget.unbounded = true;
    addTrace(file, show, traces, budget);
    hookTargets.push(...hookFiles(read.json, path.dirname(path.dirname(file))));
  };
  addSettings(path.join(root, '.claude', 'settings.json'));
  addSettings(path.join(root, '.claude', 'settings.local.json'));
  const git = gitRoot(root);
  if (git && !samePath(git, root)) addSettings(path.join(git, '.claude', 'settings.local.json'));

  // Komut/beceri/ajan/kanca betiği klasörleri: becerilerin `allowed-tools` ön bilgisi izin verir; kanca betikleri kancaların çalıştırdığı kod.
  const custom = path.join(root, '.claude');
  if (!isUserDir(custom)) {
    const parts: string[] = [];
    if (isLink(custom)) budget.unbounded = true;
    for (const [sub, key] of [
      ['commands', 'commands'],
      ['skills', 'skills'],
      ['agents', 'agents'],
      ['hooks', 'hookScripts'],
    ] as const) {
      const dir = path.join(custom, sub);
      if (!isDir(dir)) continue;
      if (isLink(dir)) budget.unbounded = true;
      let count = 0;
      try {
        count = fs.readdirSync(dir).filter((name) => !name.startsWith('.')).length;
      } catch {
        // okunamadı: sayı 0 kalır
      }
      if (count) {
        parts.push(t(`claude.trust.summary.${key}`, { count }));
        if (sub === 'hooks') hooks = true;
      }
      addFolderTraces(dir, show, traces, budget);
    }
    if (parts.length) files.push({ path: t('claude.trust.summary.customFolder'), summary: parts.join(' · ') });
  }

  // Kanca komutlarının işaret ettiği dosyalar (`hooks/` dışında da olabilir), aynı bütçeyle.
  for (const target of hookTargets) {
    // `.claude/` altındaki kanca dosyasının yolunda bağlantı varsa (dosya ya da ara klasör) içerik izlenemez.
    for (let dir = target; !isUserDir(custom) && isInsideFolder(custom, dir) && !samePath(dir, root); dir = path.dirname(dir)) {
      if (isLink(dir)) {
        budget.unbounded = true;
        break;
      }
    }
    addTrace(target, show, traces, budget);
  }

  // `.mcp.json`: cwd ve üstleri (Claude Code proje MCP yapılandırmasını yukarı doğru toplar).
  let mcp = false;
  let dir = root;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const file = path.join(dir, '.mcp.json');
    if (isFile(file)) {
      mcp = true;
      const read = readJson(file);
      files.push({ path: show(file), summary: read.json ? mcpSummary(read.json) : read.problem! });
      addTrace(file, show, traces, budget);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const fingerprint = budget.unbounded ? FINGERPRINT_UNBOUNDED : traces.length ? createHash('sha256').update(traces.sort().join('\n')).digest('hex') : '';
  return { required: files.length > 0 || budget.unbounded, files, hooks, mcp, fingerprint, ...(budget.unbounded ? { unbounded: true } : {}) };
}

// ── Geniş/hassas klasörler: asistanın (ses/sohbet) açamayacağı yerler ──
// "Düzenlemelere izin ver" kipi cwd içindeki her yazımı sormadan onaylar: cwd ev klasörü ya da AppData olursa asistanın başlattığı
// oturum uygulamanın verisini, güven kararlarını, Başlangıç klasörünü, PowerShell profilini sormadan değiştirebilirdi.
export interface FolderLimits {
  home: string;
  /** Kendisi ya da ATASI cwd olamaz (yazımlar içine düşer): AppData (Roaming/Local). */
  parents: string[];
  /** Kendisi, atası ya da İÇİ cwd olamaz; düzenleme hedefi içindeyse sorulur: uygulamanın veri klasörü, `~/.claude`, Başlangıç, PowerShell profili. */
  sensitive: string[];
  /** Kendisi ya da içi cwd olamaz: Windows, Program Files, ProgramData. */
  system: string[];
}

const flatPath = (value: string): string => {
  let resolved = path.resolve(value);
  if (resolved.length > path.parse(resolved).root.length) resolved = resolved.replace(/[\\/]+$/, '');
  return fold(resolved);
};

/** `child`, `parent`'ın kendisi ya da içinde mi (Windows'ta büyük/küçük harf duyarsız). */
export function isInsideFolder(parent: string, child: string): boolean {
  const outer = flatPath(parent);
  const inner = flatPath(child);
  if (inner === outer) return true;
  return inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);
}

/** Ortamdan varsayılan sınırlar; `extra`: uygulamanın veri klasörü, `~/.claude`, Belgeler, (sınamada) ev klasörü. */
export function defaultFolderLimits(extra: { dataDir?: string; claudeDir?: string; documentsDir?: string; homeDir?: string } = {}): FolderLimits {
  const env = process.env;
  const home = extra.homeDir ?? os.homedir();
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const documents = extra.documentsDir || path.join(home, 'Documents');
  const unique = (list: Array<string | undefined>): string[] => [
    ...new Set(list.filter((item): item is string => Boolean(item && item.trim())).map((item) => path.resolve(item))),
  ];
  return {
    home,
    parents: unique([appData, localAppData]),
    sensitive: unique([
      extra.dataDir,
      extra.claudeDir,
      path.join(appData, 'Microsoft', 'Windows', 'Start Menu'),
      path.join(documents, 'WindowsPowerShell'),
      path.join(documents, 'PowerShell'),
    ]),
    system: unique([env.SystemRoot, env.WINDIR, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData]),
  };
}

// ── Yol yazımları: metin karşılaştırması yetmez ──
// Windows'ta aynı klasöre birçok yazım götürür: yerleşik bağlantılar (C:\Documents and Settings, ~\Start Menu), 8.3 kısa adlar
// (PROGRA~1), \\?\ ve UNC yolları, büyük/küçük harf. Karşılaştırmadan önce yol GERÇEK hâline çevrilir.

/** `\\?\`, `\\.\`, UNC (`\\sunucu\pay`) ve NT (`\??\`) yolları. */
export const isNetworkPath = (value: string): boolean => /^[\\/]{2}|^[\\/]\?\?[\\/]/.test(String(value ?? '').trim());

export interface RealPathInfo {
  path: string;
  /** Yolda VAR OLAN ama çözülemeyen bir girdi (hedefi olmayan bağlantı, erişilemeyen öğe): o girdinin yolu. */
  unresolved?: string;
}

const isMissing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/**
 * Yolun gerçek hâli: en derin VAR OLAN atanın `fs.realpathSync.native`'i (bağlantı/junction, 8.3 kısa ad, büyük/küçük harf
 * çözülür) + var olmayan kuyruk. Bir girdi `lstat` ile VAR görünüp `realpath` ile çözülemiyorsa (hedefi olmayan bağlantı) ya da
 * hata "yok" dışında bir şeyse üste ÇIKILMAZ: bağlantının adı gerçek yol sanılırdı (proje\fl.txt → var olmayan dışarı\yeni.txt).
 */
export function realPathInfo(value: string): RealPathInfo {
  const first = path.resolve(value);
  let head = first;
  const tail: string[] = [];
  for (let i = 0; i < 128; i++) {
    try {
      const real = fs.realpathSync.native(head);
      return { path: tail.length ? path.join(real, ...[...tail].reverse()) : real };
    } catch (error) {
      if (!isMissing(error)) return { path: first, unresolved: head };
      try {
        fs.lstatSync(head);
        return { path: first, unresolved: head };
      } catch (inner) {
        if (!isMissing(inner)) return { path: first, unresolved: head };
      }
    }
    const parent = path.dirname(head);
    if (parent === head) break;
    tail.push(path.basename(head));
    head = parent;
  }
  // Hiçbir parçası yok (ör. olmayan sürücü): çözülecek bağlantı da yok.
  return { path: first };
}

export const realPath = (value: string): string => realPathInfo(value).path;

// Sınır klasörlerinin gerçek hâlleri kısa ömürlü önbellekte: düzenleme denetimi her çağrıda aynı klasörleri yeniden çözmesin.
const limitCache = new Map<string, { path: string; at: number }>();
const LIMIT_CACHE_MS = 60_000;

export function limitRealPath(value: string): string {
  const key = fold(path.resolve(value));
  const now = Date.now();
  const cached = limitCache.get(key);
  if (cached && now - cached.at < LIMIT_CACHE_MS) return cached.path;
  const real = realPath(value);
  limitCache.set(key, { path: real, at: now });
  if (limitCache.size > 64) limitCache.delete(limitCache.keys().next().value as string);
  return real;
}

/** Sınamalar için. */
export const clearLimitCache = (): void => limitCache.clear();

/** Sürücü harfi (küçük) ya da ''. Farklı sürücü çözülmeden "klasör dışı" sayılır (kopuk ağ sürücüsü bekletmesin). */
export const driveLetter = (value: string): string => (/^[A-Za-z]:/.test(value) ? value[0]!.toLowerCase() : '');

/**
 * Düzenleme hedefinin ŞÜPHELİ yazımı (sorulur; muhafazakâr): ağ/aygıt yolu, sürücüye göreli yol (`C:dosya`), sürücü harfinden
 * sonra ':' (alternatif veri akışı), 8.3 kısa ad bileşeni (`~` + rakam), sonu nokta ya da boşlukla biten bileşen (Windows bunları
 * siler). `shortName: false`: kısa ad bileşeni denetlenmez (var olan klasör yolu realpath ile zaten çözülür).
 */
export function suspiciousSpelling(target: string, options: { shortName?: boolean } = {}): string | null {
  const text = String(target ?? '');
  if (isNetworkPath(text)) return t('claude.trust.spelling.network');
  if (/^[A-Za-z]:(?![\\/])/.test(text)) return t('claude.trust.spelling.driveRelative');
  const body = /^[A-Za-z]:/.test(text) ? text.slice(2) : text;
  if (body.includes(':')) return t('claude.trust.spelling.stream');
  for (const part of body.split(/[\\/]+/)) {
    if (!part || part === '.' || part === '..') continue;
    if (options.shortName !== false && /~\d/.test(part)) return t('claude.trust.spelling.shortName');
    if (/[. ]$/.test(part)) return t('claude.trust.spelling.trailing');
  }
  return null;
}

/**
 * Asistanın açacağı klasörün denetimi: açılamazsa `reason` (Türkçe), açılabilirse `null` + denetlenen GERÇEK yol (`path`; oturum
 * kaydına bu sabitlenir). Yol da sınırlar da gerçek hâlleriyle karşılaştırılır. Çözülemeyen bağlantı, gerçek hâli ağ yolu olan
 * sürücü (F: → \\sunucu\pay), sürücüye/köke göreli yazım ve şüpheli adlar reddedilir.
 */
export function checkProtectedFolder(
  cwd: string,
  limits: FolderLimits,
  resolve: (value: string) => RealPathInfo = realPathInfo,
): { reason: string | null; path: string } {
  const raw = String(cwd ?? '');
  const reject = (reason: string) => ({ reason, path: path.resolve(raw || '.') });
  if (isNetworkPath(raw)) return reject(t('claude.trust.folder.network'));
  if (!path.isAbsolute(raw) || (WIN && !/^[A-Za-z]:[\\/]/.test(raw))) return reject(t('claude.trust.folder.notAbsolute'));
  const spelling = suspiciousSpelling(raw, { shortName: false });
  if (spelling) return reject(t('claude.trust.folder.suspicious', { what: spelling }));
  const info = resolve(raw);
  if (info.unresolved) return reject(t('claude.trust.folder.unresolved'));
  const real = info.path;
  const result = (reason: string | null) => ({ reason, path: real });
  if (isNetworkPath(real)) return result(t('claude.trust.folder.network'));
  if (flatPath(real) === flatPath(path.parse(real).root)) return result(t('claude.trust.folder.driveRoot'));
  if (isInsideFolder(real, limitRealPath(limits.home))) return result(t('claude.trust.folder.home'));
  for (const parent of limits.parents) if (isInsideFolder(real, limitRealPath(parent))) return result(t('claude.trust.folder.appData'));
  for (const sensitive of limits.sensitive.map(limitRealPath)) {
    if (isInsideFolder(real, sensitive) || isInsideFolder(sensitive, real)) return result(t('claude.trust.folder.sensitive'));
  }
  for (const system of limits.system) if (isInsideFolder(limitRealPath(system), real)) return result(t('claude.trust.folder.system'));
  return result(null);
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * Asistanın başlattığı (kip tavanlı) oturumda düzenleme aracının hedefi kullanıcıya sorulmalı mı: sorulacaksa Türkçe neden,
 * değilse `null`. "Düzenlemelere izin ver" kipi şunları sormadan onaylardı: oturum klasörünün DIŞI (AppData dahil), korunan
 * klasörler (uygulamanın verisi, `~/.claude`, Başlangıç, PowerShell profili), klasörün kendi `.claude/`, `.mcp.json`, `.git/`
 * dosyaları. `cwd` oturum kaydına SABİTLENMİŞ gerçek klasördür; burada yeniden çözülmez (klasör sonradan bağlantıyla
 * değiştirilirse karşılaştırma yine sabit yolla yapılır).
 */
export function guardEditTarget(options: {
  cwd: string;
  limits: FolderLimits;
  tool: string;
  input: unknown;
  /** Sınamalar için: yol çözücü. */
  resolve?: (value: string) => RealPathInfo;
}): string | null {
  if (!EDIT_TOOLS.has(options.tool)) return null;
  const input = isRecord(options.input) ? options.input : {};
  const target =
    typeof input.file_path === 'string' && input.file_path ? input.file_path : typeof input.notebook_path === 'string' && input.notebook_path ? input.notebook_path : '';
  if (!target) return t('claude.trust.guard.noTarget');
  const spelling = suspiciousSpelling(target);
  if (spelling) return t('claude.trust.guard.suspicious', { what: spelling });
  const root = options.cwd;
  const raw = path.resolve(root, target);
  // Başka sürücüdeki hedef çözülmeye çalışılmaz (kopuk ağ sürücüsü denetimi bekletirdi); oturum klasörünün dışıdır.
  if (driveLetter(raw) !== driveLetter(root)) return t('claude.trust.guard.outside');
  const info = (options.resolve ?? realPathInfo)(raw);
  // Yolda hedefi olmayan bağlantı: yazım bağlantının hedefine düşer.
  if (info.unresolved) return t('claude.trust.guard.unresolved');
  if (isNetworkPath(info.path)) return t('claude.trust.guard.network');
  const full = info.path;
  if (!isInsideFolder(root, full)) return t('claude.trust.guard.outside');
  // Klasör içindeki hedef: yalnız HASSAS klasörler. AppData (`parents`) burada sayılmaz: cwd AppData'yı içeremez ama AppData'nın
  // İÇİNDE olabilir (ör. Temp); klasör içi sıradan yazım yanlışlıkla sorulmasın.
  for (const sensitive of options.limits.sensitive) if (isInsideFolder(limitRealPath(sensitive), full)) return t('claude.trust.guard.sensitive');
  const relative = path.relative(root, full).split(path.sep).join('/').toLowerCase();
  // `.git/` klasörünün TAMAMI (kancalar, config, modules, worktrees) ve `.git` dosyası; `.claude/` ve `.mcp.json` alt klasörlerde de.
  if (/(^|\/)(\.claude(\/|$)|\.mcp\.json$|\.git(\/|$))/.test(relative)) return t('claude.trust.guard.config');
  return null;
}

/** Kayıt anahtarı: tam yol; Windows'ta büyük/küçük harf duyarsız, sondaki ayıraç yok. */
export const trustKey = (cwd: string): string => flatPath(cwd);

interface StoredRecord {
  decision: TrustDecision;
  path: string;
  at: number;
  fingerprint?: string;
}
const MAX_RECORDS = 2000;

export interface TrustStore {
  get(cwd: string): TrustRecord | undefined;
  /** `decision` null: kayıt silinir (sonraki oturumda kart yeniden sorar). `fingerprint`: kartta gösterilen dosya kümesinin izi. */
  set(cwd: string, decision: TrustDecision | null, fingerprint?: string): void;
  /** Yeniden eskiye. */
  list(): Array<{ path: string; decision: TrustDecision; at: number }>;
}

/** Klasör başına güven kararı. Kararlar modülün kv deposunda tutulur: okuma/yazma işlevleri dışarıdan verilir. */
export function createTrustStore(io: { read(): unknown; write(value: unknown): void }): TrustStore {
  let memory: Map<string, StoredRecord> | null = null;
  const load = (): Map<string, StoredRecord> => {
    if (memory) return memory;
    const map = new Map<string, StoredRecord>();
    try {
      const raw = io.read();
      const folders = isRecord(raw) && isRecord(raw.folders) ? raw.folders : {};
      for (const [key, value] of Object.entries(folders)) {
        if (!isRecord(value) || (value.decision !== 'trust' && value.decision !== 'distrust') || typeof value.path !== 'string') continue;
        map.set(key, {
          decision: value.decision,
          path: value.path,
          at: Number(value.at) || 0,
          ...(typeof value.fingerprint === 'string' ? { fingerprint: value.fingerprint } : {}),
        });
      }
    } catch {
      // depo okunamadı ya da bozuk: karar yok (güvenilmemiş sayılır)
    }
    memory = map;
    return map;
  };
  return {
    get(cwd) {
      const record = load().get(trustKey(cwd));
      return record ? { decision: record.decision, ...(record.fingerprint !== undefined ? { fingerprint: record.fingerprint } : {}) } : undefined;
    },
    set(cwd, decision, fingerprint) {
      const map = load();
      const key = trustKey(cwd);
      map.delete(key);
      if (decision !== null) map.set(key, { decision, path: path.resolve(cwd), at: Date.now(), ...(fingerprint !== undefined ? { fingerprint } : {}) });
      while (map.size > MAX_RECORDS) map.delete(map.keys().next().value as string);
      io.write({ version: 1, folders: Object.fromEntries(map) });
    },
    list: () =>
      [...load().values()].sort((a, b) => b.at - a.at).map((record) => ({ path: record.path, decision: record.decision, at: record.at })),
  };
}

// ── Claude Code'un kendi güven kaydı (yalnız okunur) ──
const CLAUDE_JSON_MAX_BYTES = 32 * 1024 * 1024;
const CLAUDE_TRUST_CACHE_MS = 30_000;
const claudeTrustCache = new Map<string, { at: number; trusted: Set<string> }>();

/** `~/.claude.json` anahtarları ileri eğik çizgilidir ("C:/Users/…"); karşılaştırma ayırıcıdan ve harf büyüklüğünden bağımsız yapılır. */
const claudeKey = (value: string): string => {
  let text = value.replace(/\\/g, '/');
  if (text.length > 3) text = text.replace(/\/+$/, '');
  return text.toLowerCase();
};

function trustedByClaudeCode(homeDir: string): Set<string> {
  const file = path.join(homeDir, '.claude.json');
  const key = fold(path.resolve(file));
  const now = Date.now();
  const cached = claudeTrustCache.get(key);
  if (cached && now - cached.at < CLAUDE_TRUST_CACHE_MS) return cached.trusted;
  const trusted = new Set<string>();
  try {
    if (fs.statSync(file).size <= CLAUDE_JSON_MAX_BYTES) {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
      const projects = isRecord(parsed) && isRecord(parsed.projects) ? parsed.projects : {};
      for (const [folder, value] of Object.entries(projects)) {
        if (isRecord(value) && value.hasTrustDialogAccepted === true) trusted.add(claudeKey(folder));
      }
    }
  } catch {
    // dosya yok, bozuk ya da okunamadı: kimseye güvenilmemiş sayılır
  }
  claudeTrustCache.set(key, { at: now, trusted });
  if (claudeTrustCache.size > 8) claudeTrustCache.delete(claudeTrustCache.keys().next().value as string);
  return trusted;
}

/** Sınamalar için. */
export const clearClaudeTrustCache = (): void => claudeTrustCache.clear();

/**
 * Claude Code'un kendi güven kaydı: `<home>/.claude.json` → `projects[<cwd>].hasTrustDialogAccepted === true`. YALNIZ okur.
 * Üst klasörlerden biri güvenilmişse alt klasör de güvenilmiş sayılır (terminaldeki güven sorusu da üst klasörün kararını devralır).
 * Sonuç 30 sn önbelleklenir.
 */
export function claudeCodeTrusts(cwd: string, homeDir: string): boolean {
  if (!cwd || !path.isAbsolute(cwd)) return false;
  const trusted = trustedByClaudeCode(homeDir);
  if (trusted.size === 0) return false;
  let dir = path.resolve(cwd);
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (trusted.has(claudeKey(dir))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Klasörün güven durumu: kendi ayarı var mı (kart gerekir mi) ve geçerli karar.
 *  - Kullanıcının "güven" kararı, klasörün ayar dosyaları (ad + içerik) o karardan sonra değişmediyse geçerlidir; değiştiyse
 *    (ör. `git pull` yeni kanca getirdi) ya da kayıtta iz yoksa yok sayılır (`changed`).
 *  - Kullanıcının "güvenme" kararı güvenli yöndür: ayarlar değişse de, iz çıkarılamasa da geçerli kalır ve Claude Code'un kendi
 *    kaydı onu ezmez.
 *  - Geçerli kullanıcı kararı yoksa Claude Code'un kendi kaydı güveniyorsa `trust` / `claude-code`; iz çıkarılamıyorsa
 *    (`unbounded`) bu da kabul edilmez.
 */
export function folderTrustState(
  cwd: string,
  record: TrustRecord | undefined,
  options: { userClaudeDir?: string; claudeCodeTrusted?: boolean } = {},
): FolderTrustState & { fingerprint: string; changed?: boolean; unbounded?: boolean } {
  const settings = inspectFolderSettings(cwd, options.userClaudeDir);
  let decision: TrustDecision | null = null;
  let decidedBy: FolderTrustState['decidedBy'] = null;
  let changed = false;
  if (record) {
    if (record.decision === 'distrust' || !settings.required) {
      decision = record.decision;
      decidedBy = 'user';
    } else if (!settings.unbounded && record.fingerprint === settings.fingerprint && settings.fingerprint !== FINGERPRINT_UNBOUNDED) {
      decision = 'trust';
      decidedBy = 'user';
    } else {
      changed = true;
    }
  }
  if (!decision && options.claudeCodeTrusted && !settings.unbounded) {
    decision = 'trust';
    decidedBy = 'claude-code';
  }
  return {
    cwd: path.resolve(cwd),
    required: settings.required,
    decision,
    decidedBy,
    files: settings.files,
    hooks: settings.hooks,
    mcp: settings.mcp,
    fingerprint: settings.fingerprint,
    ...(changed ? { changed } : {}),
    ...(settings.unbounded ? { unbounded: true } : {}),
  };
}

/** Klasörün kendi ayarları yüklenir mi: kendi ayarı yoksa (yüklenecek bir şey yok) ya da güvenildiyse. */
export const loadsFolderSettings = (state: Pick<FolderTrustState, 'required' | 'decision'>): boolean => !state.required || state.decision === 'trust';
