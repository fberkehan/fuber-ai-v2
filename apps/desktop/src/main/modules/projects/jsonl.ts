// Claude Code `.jsonl` dosyalarının artımlı okunması ve satır ayrıştırma.
// Kural (v1'de kayıt kaybettiren hata): yalnız `\n` ile bitmiş TAM satırlar işlenir; yarım kalan son satır
// okunmaz ve konum onun ÖNÜNDE bırakılır. Dosya küçülür ya da başı değişirse baştan okunur.
import fs from 'node:fs/promises';

/** Bundan uzun satır ayrıştırılmaz (araç çıktısı, görsel); yalnız sayılır. */
export const MAX_LINE_BYTES = 512 * 1024;
/** Dizine giren ileti metninin üst sınırı. */
export const MAX_TEXT_CHARS = 6000;
const CHUNK_BYTES = 1024 * 1024;
const HEAD_BYTES = 64;

export interface FileCursor {
  /** İşlenmiş son tam satırın bittiği bayt. */
  offset: number;
  /** Dosyanın ilk baytları (base64); yeniden yazılmayı anlamak için. */
  head: string | null;
}

export interface ReadResult {
  cursor: FileCursor;
  /** Dosya baştan okundu (küçüldü ya da yeniden yazıldı). */
  reset: boolean;
  size: number;
  mtimeMs: number;
  lines: number;
  skippedLong: number;
}

export interface ReadOptions {
  /** Her tam satır için; `null` = satır `MAX_LINE_BYTES`'tan uzundu, içeriği atlandı. */
  onLine(line: string | null): void;
  /** Her parça sonunda çağrılır (işlem kaydetme ve olay döngüsüne yol verme). `offset` o ana dek işlenen tam satırların sonu. */
  onChunk?(offset: number, head: string): Promise<void> | void;
  /** Okumadan ÖNCE çağrılır: dosya küçülmüş ya da yeniden yazılmış, baştan okunacak. */
  onReset?(): void;
  maxLineBytes?: number;
  chunkBytes?: number;
}

/** `cursor`'dan dosyanın şu anki sonuna kadar olan tam satırları okur. */
export async function readNewLines(file: string, cursor: FileCursor, options: ReadOptions): Promise<ReadResult> {
  const maxLine = options.maxLineBytes ?? MAX_LINE_BYTES;
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const size = stat.size;
    const headBuf = Buffer.alloc(Math.min(HEAD_BYTES, size));
    if (headBuf.length) await handle.read(headBuf, 0, headBuf.length, 0);
    const head = headBuf.toString('base64');

    let offset = cursor.offset;
    let reset = false;
    const oldHead = cursor.head ? Buffer.from(cursor.head, 'base64') : null;
    const headChanged = !!oldHead && oldHead.length > 0 && !headBuf.subarray(0, oldHead.length).equals(oldHead.subarray(0, headBuf.length));
    if (size < offset || headChanged) {
      offset = 0;
      reset = true;
      options.onReset?.();
    }

    const result: ReadResult = { cursor: { offset, head }, reset, size, mtimeMs: stat.mtimeMs, lines: 0, skippedLong: 0 };
    if (size === offset) return result;

    const chunk = Buffer.alloc(options.chunkBytes ?? CHUNK_BYTES);
    let position = offset;
    let pending: Buffer[] = [];
    let pendingLen = 0;
    let oversize = false;
    let lineStart = offset;

    const emit = (line: Buffer | null) => {
      result.lines++;
      if (line === null) {
        result.skippedLong++;
        options.onLine(null);
        return;
      }
      let end = line.length;
      if (end > 0 && line[end - 1] === 0x0d) end--;
      options.onLine(line.toString('utf8', 0, end));
    };

    while (position < size) {
      const want = Math.min(chunk.length, size - position);
      const { bytesRead } = await handle.read(chunk, 0, want, position);
      if (bytesRead <= 0) break;
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf(0x0a, start);
        if (nl === -1 || nl >= bytesRead) break;
        const piece = chunk.subarray(start, nl);
        if (oversize || pendingLen + piece.length > maxLine) {
          emit(null);
        } else if (pendingLen > 0) {
          emit(Buffer.concat([...pending, piece], pendingLen + piece.length));
        } else {
          emit(piece);
        }
        pending = [];
        pendingLen = 0;
        oversize = false;
        start = nl + 1;
        lineStart = position + start;
      }
      // Satırın kalanı bir sonraki parçaya: uzun satır biriktirilmez, yalnız işaretlenir.
      const rest = chunk.subarray(start, bytesRead);
      if (!oversize) {
        if (pendingLen + rest.length > maxLine) {
          oversize = true;
          pending = [];
          pendingLen = 0;
        } else if (rest.length) {
          pending.push(Buffer.from(rest));
          pendingLen += rest.length;
        }
      }
      position += bytesRead;
      result.cursor.offset = lineStart;
      await options.onChunk?.(lineStart, head);
    }
    result.cursor.offset = lineStart;
    return result;
  } finally {
    await handle.close();
  }
}

// ───────────────────────────── ayrıştırma ─────────────────────────────

export type Entry =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string; at: string | null; stop: string | null; cwd: string | null; gitBranch: string | null }
  /** Konuşmaya ait ama dizine girmeyen satır (araç çağrısı, araç sonucu, komut çıktısı). */
  | { kind: 'activity'; role: 'user' | 'assistant'; at: string | null; stop: string | null; cwd: string | null; gitBranch: string | null }
  | { kind: 'title'; source: 'ai' | 'custom' | 'summary'; title: string }
  | { kind: 'other'; at: string | null; cwd: string | null; gitBranch: string | null }
  | { kind: 'bad' };

type Json = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_TEXT_CHARS ? `${trimmed.slice(0, MAX_TEXT_CHARS)}…` : trimmed;
}

const SKIP_USER = /^<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|bash-input|user-memory-input|task-notification)/;

/** Kullanıcı metnini dizine uygun hale getirir; dizine girmeyecekse `null`. */
export function cleanUserText(raw: string): string | null {
  let text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!text) return null;
  if (SKIP_USER.test(text)) return null;
  if (text.startsWith('[Request interrupted')) return null;
  if (text.startsWith('<command-')) {
    const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim() ?? '';
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? '';
    text = `${name} ${args}`.trim();
    if (!text) return null;
  }
  return clip(text);
}

function contentText(content: unknown, role: 'user' | 'assistant'): { text: string | null; hasNonText: boolean } {
  if (typeof content === 'string') return { text: role === 'user' ? cleanUserText(content) : clip(content) || null, hasNonText: false };
  if (!Array.isArray(content)) return { text: null, hasNonText: false };
  const parts: string[] = [];
  let hasNonText = false;
  for (const part of content as Json[]) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      const cleaned = role === 'user' ? cleanUserText(part.text) : part.text.trim();
      if (cleaned) parts.push(cleaned);
    } else {
      hasNonText = true;
    }
  }
  return { text: parts.length ? clip(parts.join('\n\n')) : null, hasNonText };
}

/** Tek bir tam satırı ayrıştırır. Bozuk JSON `bad` döner (satır atlanır, konum ilerler). */
export function parseLine(line: string): Entry {
  if (!line.trim()) return { kind: 'other', at: null, cwd: null, gitBranch: null };
  let obj: Json;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'bad' };
    obj = parsed as Json;
  } catch {
    return { kind: 'bad' };
  }
  const type = obj.type;
  const at = str(obj.timestamp);
  const cwd = str(obj.cwd);
  const gitBranch = str(obj.gitBranch);
  if (type === 'ai-title') {
    const title = str(obj.aiTitle);
    return title ? { kind: 'title', source: 'ai', title } : { kind: 'other', at, cwd, gitBranch };
  }
  if (type === 'custom-title') {
    const title = str(obj.customTitle) ?? str(obj.title);
    return title ? { kind: 'title', source: 'custom', title } : { kind: 'other', at, cwd, gitBranch };
  }
  if (type === 'summary') {
    const title = str(obj.summary);
    return title ? { kind: 'title', source: 'summary', title } : { kind: 'other', at, cwd, gitBranch };
  }
  if (type !== 'user' && type !== 'assistant') return { kind: 'other', at, cwd, gitBranch };
  if (obj.isSidechain === true) return { kind: 'other', at, cwd, gitBranch };
  const role = type;
  const message = (obj.message ?? {}) as Json;
  const stop = str(message.stop_reason);
  if (role === 'user' && (obj.isMeta === true || obj.isCompactSummary === true || obj.isVisibleInTranscriptOnly === true)) {
    return { kind: 'activity', role, at, stop: null, cwd, gitBranch };
  }
  if (role === 'assistant' && obj.isApiErrorMessage === true) return { kind: 'activity', role, at, stop, cwd, gitBranch };
  const { text } = contentText(message.content, role);
  if (!text) return { kind: 'activity', role, at, stop, cwd, gitBranch };
  return { kind: 'message', role, text, at, stop, cwd, gitBranch };
}

// ───────────────────────────── oturum birikimi ─────────────────────────────

/** Bir oturum dosyasından artımlı olarak biriken özet. Veritabanı satırıyla birebir. */
export interface SessionAcc {
  cwd: string;
  gitBranch: string | null;
  aiTitle: string | null;
  customTitle: string | null;
  summaryTitle: string | null;
  firstPrompt: string | null;
  startedAt: string | null;
  lastAt: string | null;
  messageCount: number;
  lastRole: 'user' | 'assistant' | null;
  lastStop: string | null;
  lastConvAt: string | null;
  badLines: number;
}

export function emptyAcc(): SessionAcc {
  return {
    cwd: '',
    gitBranch: null,
    aiTitle: null,
    customTitle: null,
    summaryTitle: null,
    firstPrompt: null,
    startedAt: null,
    lastAt: null,
    messageCount: 0,
    lastRole: null,
    lastStop: null,
    lastConvAt: null,
    badLines: 0,
  };
}

export interface NewMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string | null;
}

/** Satırı birikime uygular; dizine girecek ileti varsa döndürür. */
export function applyEntry(acc: SessionAcc, entry: Entry): NewMessage | null {
  if (entry.kind === 'bad') {
    acc.badLines++;
    return null;
  }
  if (entry.kind === 'title') {
    if (entry.source === 'ai') acc.aiTitle = entry.title;
    else if (entry.source === 'custom') acc.customTitle = entry.title;
    else acc.summaryTitle = entry.title;
    return null;
  }
  if (entry.cwd && !acc.cwd) acc.cwd = entry.cwd;
  if (entry.gitBranch) acc.gitBranch = entry.gitBranch;
  if (entry.at) {
    if (!acc.startedAt || entry.at < acc.startedAt) acc.startedAt = entry.at;
    if (!acc.lastAt || entry.at > acc.lastAt) acc.lastAt = entry.at;
  }
  if (entry.kind === 'other') return null;
  acc.lastRole = entry.role;
  acc.lastStop = entry.stop;
  if (entry.at) acc.lastConvAt = entry.at;
  if (entry.kind === 'activity') return null;
  acc.messageCount++;
  if (entry.role === 'user' && !acc.firstPrompt) acc.firstPrompt = entry.text.replace(/\s+/g, ' ').slice(0, 160);
  return { role: entry.role, text: entry.text, at: entry.at };
}

/** Gösterilecek başlık: kullanıcının verdiği > Claude Code'da adlandırılan > otomatik başlık > özet > ilk istem. */
export function sessionTitle(acc: Pick<SessionAcc, 'aiTitle' | 'customTitle' | 'summaryTitle' | 'firstPrompt'>, userTitle: string | null): string {
  const first = acc.firstPrompt ? (acc.firstPrompt.length > 90 ? `${acc.firstPrompt.slice(0, 90)}…` : acc.firstPrompt) : null;
  return userTitle ?? acc.customTitle ?? acc.aiTitle ?? acc.summaryTitle ?? first ?? '';
}

/** Asistan turunu bitirdi mi (bildirim kuralının ilk koşulu). */
export function isTurnEnd(acc: Pick<SessionAcc, 'lastRole' | 'lastStop'>): boolean {
  return acc.lastRole === 'assistant' && acc.lastStop === 'end_turn';
}
