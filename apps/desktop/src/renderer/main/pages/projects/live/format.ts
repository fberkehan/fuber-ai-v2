// Canlı oturum arayüzünün saf yardımcıları (v1 `renderer/claudecode/yardimci.ts`'ten): tetik bulma, komut süzme, biçim, adlar.
import { foldForSearch, t } from '@fuber/shared';
import type { Tone } from '@fuber/ui';
import type {
  EffortLevel,
  LiveCommand,
  LiveSessionSummary,
  LiveStatus,
  PermissionMode,
  PermissionRequestEvent,
} from '../../../../../main/modules/projects/claude/types';

// ── Yazma kutusu: "/" komut paleti ve "@" dosya önerisi ──

export interface Trigger {
  kind: 'command' | 'file';
  query: string;
  start: number;
  end: number;
}

/**
 * İmlecin bulunduğu belirteç bir tetik mi:
 *  • "/" komut paleti: metnin EN BAŞINDA "/" ve imleç ilk sözcükte; metnin ortasındaki "/" (yol) tetik değil.
 *  • "@" dosya önerisi: imlecin solundaki sözcük "@" ile başlıyor ve "@"den önce boşluk ya da metnin başı var (e-posta değil).
 */
export function findTrigger(text: string, cursor: number): Trigger | null {
  const at = Math.max(0, Math.min(cursor, text.length));
  let start = at;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  let end = at;
  while (end < text.length && !/\s/.test(text[end]!)) end++;
  const word = text.slice(start, at);
  if (start === 0 && word.startsWith('/') && !word.slice(1).includes('/')) return { kind: 'command', query: word.slice(1), start, end };
  if (word.startsWith('@')) return { kind: 'file', query: word.slice(1), start, end };
  return null;
}

/** Tetiğin yerine seçilen komut ya da yol yazılır (sonuna tek boşluk); dönen imleç eklenenin sonu. */
export function completeTrigger(text: string, trigger: Trigger, value: string): { text: string; cursor: number } {
  const insert = trigger.kind === 'command' ? `/${value}` : `@${/\s/.test(value) ? `"${value}"` : value}`;
  const rest = text.slice(trigger.end);
  const space = rest.startsWith(' ') ? '' : ' ';
  return { text: `${text.slice(0, trigger.start)}${insert}${space}${rest}`, cursor: trigger.start + insert.length + 1 };
}

/** Komut paleti süzgeci: ad öneki → adın içinde → açıklamada. Tek harfte yalnız önek eşleşir (ilk tuşta liste gürültülü olmasın). */
export function filterCommands(commands: readonly LiveCommand[], query: string, limit = 50): LiveCommand[] {
  const q = foldForSearch(query.replace(/^\//, '')).trim();
  if (!q) return [...commands].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const score = (command: LiveCommand) => {
    const name = foldForSearch(command.name);
    if (name.startsWith(q)) return 0;
    if (q.length < 2) return -1;
    if (name.includes(q)) return 1;
    if (foldForSearch(command.description).includes(q)) return 2;
    return -1;
  };
  return commands
    .map((command) => ({ command, rank: score(command) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.command.name.localeCompare(b.command.name))
    .slice(0, limit)
    .map((item) => item.command);
}

// ── Biçim ──

export function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return t('projects.live.unit.seconds', { n: 0 });
  if (ms < 1000) return t('projects.live.unit.millis', { n: Math.round(ms) });
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t('projects.live.unit.seconds', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? t('projects.live.unit.minutesSeconds', { m: minutes, s: seconds % 60 }) : t('projects.live.unit.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? t('projects.live.unit.hoursMinutes', { h: hours, m: minutes % 60 }) : t('projects.live.unit.hours', { n: hours });
}

/** Yaklaşık maliyet (ABD doları, Türkçe ondalık): küçük tutarlarda dört hane. */
export function formatCost(usd: number | undefined): string {
  const value = usd && Number.isFinite(usd) ? usd : 0;
  const digits = value > 0 && value < 0.1 ? 4 : 2;
  return `≈ ${new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}`;
}

export function formatTokens(count: number | undefined): string {
  const value = count && Number.isFinite(count) ? count : 0;
  return new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatClock(epochMs: number | null | undefined): string {
  if (!epochMs) return '';
  // `resetsAt` saniye cinsinden de gelebilir.
  const ms = epochMs < 10_000_000_000 ? epochMs * 1000 : epochMs;
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(ms));
}

/** Proje içindeki yolu göreli yazar (Windows ve '/' ayraçları; büyük/küçük harf duyarsız); dışarıdaysa olduğu gibi. */
export function relativePath(file: string, cwd: string): string {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const target = normalize(file);
  const root = normalize(cwd);
  if (root && target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return target.slice(root.length + 1);
  return target;
}

export const baseName = (file: string): string => file.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? file;
export const dirName = (file: string): string => {
  const parts = file.replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
};

/** Uzun metin: ilk `limit` satır görünür, kalanı katlanır. */
export function foldLines(text: string, limit: number, open: boolean): { shown: string; hidden: number; total: number } {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (open || lines.length <= limit) return { shown: lines.join('\n'), hidden: 0, total: lines.length };
  return { shown: lines.slice(0, limit).join('\n'), hidden: lines.length - limit, total: lines.length };
}

// ── Durum, kip, efor ──

export const STATUS_TONE: Record<LiveStatus, Tone> = {
  queued: 'neutral',
  running: 'accent',
  permission: 'warning',
  done: 'success',
  stopped: 'neutral',
  error: 'danger',
  limit: 'warning',
  idle: 'neutral',
  closed: 'neutral',
};

export function statusLabel(session: Pick<LiveSessionSummary, 'status' | 'queuePosition' | 'background'>): string {
  if (session.status === 'queued' && session.queuePosition) return t('projects.live.status.queuedAt', { n: session.queuePosition });
  if (session.status === 'done' && session.background > 0) return t('projects.live.status.background', { n: session.background });
  return t(`projects.live.status.${session.status}`);
}

/** Liste sırası: izin bekleyenler en üstte, sonra çalışan ve sıradakiler, sonra diğerleri; eşitlikte son etkinlik. */
const STATUS_RANK: Record<LiveStatus, number> = { permission: 0, running: 1, queued: 2, error: 3, limit: 3, done: 4, stopped: 4, idle: 4, closed: 5 };
export function sortSessions<T extends Pick<LiveSessionSummary, 'status' | 'lastActivityAt' | 'pendingPermissions'>>(list: readonly T[]): T[] {
  const rank = (session: T) => (session.pendingPermissions > 0 ? 0 : STATUS_RANK[session.status]);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.lastActivityAt - a.lastActivityAt);
}

/** Tur sürüyor mu (durdur düğmesi ve "sıraya girer" ipucu için). */
export const isBusy = (status: LiveStatus | undefined): boolean => status === 'running' || status === 'permission' || status === 'queued';

export const MODES: readonly PermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
export const modeLabel = (mode: string): string => ((MODES as readonly string[]).includes(mode) ? t(`projects.live.mode.${mode as PermissionMode}`) : mode);
export const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// ── Araç adları ve izin cümlesi ──

const KNOWN_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'PowerShell',
  'BashOutput',
  'KillShell',
  'Grep',
  'Glob',
  'LS',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
  'TodoWrite',
  'AskUserQuestion',
  'ExitPlanMode',
  'Skill',
]);

export function mcpParts(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1]!.replace(/_/g, ' '), tool: match[2]!.replace(/_/g, ' ') } : null;
}

/** "getUserByID" / "get_user" → "Get user by ID". */
export function readableName(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-zçğıöşü\d])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return name;
  const lowered = spaced
    .split(' ')
    .map((word, index) => (index === 0 || /^[A-Z\d]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(' ');
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

/** Kartta görünen araç adı; bilinmeyen araç okunur adıyla (ham kimlik tek başına görünmez). */
export function toolLabel(name: string): string {
  const mcp = mcpParts(name);
  if (mcp) return t('projects.live.tool.mcp', { server: mcp.server });
  return KNOWN_TOOLS.has(name) ? t(`projects.live.toolName.${name}`) : t('projects.live.tool.other', { name: readableName(name) });
}

/** İzin kartının cümlesi (Claude Code'un kendi başlığı İngilizce olabilir: kartta yalnız ipucu olarak gösterilir). */
export function permissionTitle(request: Pick<PermissionRequestEvent, 'tool' | 'kind'>): string {
  const mcp = mcpParts(request.tool);
  if (mcp) return t('projects.live.permission.title.mcp', { server: mcp.server, tool: mcp.tool });
  switch (request.tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return t('projects.live.permission.title.edit');
    case 'Write':
      return t('projects.live.permission.title.write');
    case 'Bash':
    case 'PowerShell':
      return t('projects.live.permission.title.shell');
    case 'WebFetch':
      return t('projects.live.permission.title.fetch');
    case 'WebSearch':
      return t('projects.live.permission.title.search');
    case 'ExitPlanMode':
      return t('projects.live.permission.title.plan');
    case 'AskUserQuestion':
      return t('projects.live.permission.title.question');
    default:
      return t('projects.live.permission.title.other', { name: KNOWN_TOOLS.has(request.tool) ? t(`projects.live.toolName.${request.tool}`) : readableName(request.tool) });
  }
}

export const inputText = (input: Record<string, unknown>, key: string): string => (typeof input[key] === 'string' ? (input[key] as string) : '');
