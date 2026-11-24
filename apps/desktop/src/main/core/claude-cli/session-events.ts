/**
 * Etkileşimli Claude Code oturumunun olay modeli (v1 `shared/cc-olay.ts`'ten uyarlandı). Saf tipler ve saf yardımcılar:
 * Node'a özgü hiçbir şey yoktur, sayfa da `import type` ile alır.
 *
 * Akış: CLI'nin `--output-format stream-json` satırları → `normalizeSessionMessage` (session-normalize.ts) → `StreamEvent`.
 * Oturum yöneticisi bunlara kendi olaylarını (kullanıcı iletisi, izin isteği/yanıtı, durum) ekler.
 */

/** İzin kipleri. `default` = her şeyi sor (CLI'de `manual` ile eş anlamlı; `default` 2.1.325'te kabul ediliyor). */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
export const isPermissionMode = (value: unknown): value is PermissionMode =>
  typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export const isEffortLevel = (value: unknown): value is EffortLevel =>
  typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value);

/** Claude Code oturum kimliği ve model adı komut satırına girer: yalnız bu biçimler kabul edilir. */
export const CLI_SESSION_ID_RE = /^[0-9a-zA-Z_-]{6,80}$/;
/** `-` ile başlamaz (bayrak gibi görünmesin). */
export const CLI_MODEL_RE = /^[\w.:@/[\]][\w.:@/[\]-]{0,119}$/;

export type ToolKind = 'read' | 'edit' | 'shell' | 'search' | 'subagent' | 'todos' | 'web' | 'mcp' | 'question' | 'plan' | 'other';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** TodoWrite listesi ya da Task* araçlarının görevi (`taskId`). */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'done';
  activeForm?: string;
  taskId?: string;
}

/** AskUserQuestion sorusu. */
export interface AskQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
}

/** Claude Code bir araç için izin istiyor (denetim protokolü `can_use_tool`). */
export interface PermissionRequestEvent {
  type: 'permission_request';
  requestId: string;
  tool: string;
  kind: ToolKind;
  input: Record<string, unknown>;
  /** Tek satırlık özet: dosya yolu, komut, soru. */
  summary: string;
  /** Claude Code'un kendi izin cümlesi / kısa adı / alt yazısı / nedeni (ham metin; arayüz kaçışlar). */
  title?: string;
  displayName?: string;
  description?: string;
  reason?: string;
  /** AskUserQuestion: seçenek kartı. */
  questions?: AskQuestion[];
  /** "Bu oturumda hep izin ver" sunulabilir mi. */
  canAlways: boolean;
  /** Tek tuşla onaylanmasın: kart "Reddet"te açılır. */
  defaultNo?: boolean;
  agentId?: string;
  toolUseId?: string;
  truncated?: boolean;
}

export interface TurnResultEvent {
  type: 'result';
  ok: boolean;
  /** Kullanıcı durdurdu (ya da tur zorla kapatıldı). */
  interrupted: boolean;
  durationMs: number;
  turns: number;
  costUsd: number;
  usage: TokenUsage;
  /** Kullanıcıya gösterilecek Türkçe hata cümlesi. */
  error?: string;
  /** Hata sınıfı (`session-errors.ts`); `limit` = abonelik/kullanım sınırı. */
  errorClass?: string;
  text?: string;
  /** `error` aynı turda dökümde zaten gösterildi: sonuç satırı cümleyi yinelemez. */
  errorShown?: boolean;
  /** `costUsd` gösterilebilir mi: yalnız API anahtarıyla çalışan oturumda (abonelikte tahmini dolar gösterilmez). */
  showCost?: boolean;
}

/** Claude Code'un bir işi: arka plan kabuğu, alt ajan, izleyici. */
export interface BackgroundTask {
  id: string;
  description: string;
  kind: 'shell' | 'agent' | 'monitor' | 'other';
  status: 'running' | 'done' | 'failed' | 'stopped';
  /** `false`: ön planda (turu bekleten) iş. */
  backgrounded: boolean;
  toolUseId?: string;
  startedAt: number;
  elapsedSec?: number;
  lastTool?: string;
  summary?: string;
  /** Claude Code'un çıktı dosyası (yalnız okunur; canlı çıktı kuyruğu buradan). */
  outputFile?: string;
  endedAt?: number;
}

/** CLI akışından doğan olaylar. `parent`: alt ajanın araç kimliği; ana konuşmada `null`. */
export type StreamEvent =
  | {
      type: 'init';
      sessionId: string;
      model: string;
      mode: string;
      version: string;
      cwd: string;
      tools: string[];
      commands: string[];
      capabilities: string[];
      mcpServers: string[];
      skills: string[];
      apiKeySource?: string;
    }
  | { type: 'user'; id: string; text: string; images: number }
  /** Akan metin parçası; aynı `block` için tam metin (`text`) gelince onun yerine geçer. */
  | { type: 'text_delta'; block: string; text: string; parent: string | null }
  | { type: 'text'; block: string; text: string; parent: string | null }
  | { type: 'thinking'; block: string; phase: 'start' | 'end'; parent: string | null }
  | { type: 'tool_start'; id: string; name: string; kind: ToolKind; input: Record<string, unknown>; summary: string; parent: string | null; truncated?: boolean }
  | { type: 'tool_end'; id: string; error: boolean; output: string; truncated: boolean; parent: string | null }
  | { type: 'subagent'; id: string; description: string; agentType?: string; prompt: string; parent: string | null }
  | { type: 'todos'; id: string; items: TodoItem[]; parent: string | null }
  | TurnResultEvent
  | { type: 'mode'; mode: string }
  | { type: 'model'; model: string }
  /** `detail`: açılır ayrıntı (görev sonucu, çıktı dosyası). */
  | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string; detail?: string }
  /** Arka planda süren iş sayısı (tur bitse de sürer); değişince bir kez. */
  | { type: 'background'; count: number }
  /** İşlerin tam listesi; dökümde tutulmaz. */
  | { type: 'tasks'; tasks: BackgroundTask[] }
  /** Abonelik sınırı bilgisi (`rate_limit_event`). `status: 'rejected'` = sınır doldu. */
  | { type: 'rate_limit'; status: string; resetsAt: number | null; limitType: string | null };

// ── Kısaltma ve araç özeti ──

export const INPUT_LIMIT = 20_000;
export const OUTPUT_LIMIT = 8_000;
export const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);

type Json = Record<string, unknown>;
export const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

/** Girdiyi derin kopyalar; sınırı aşan metinler kısaltılır (Write içeriği, uzun komut). */
export function truncateInput(input: unknown, limit = INPUT_LIMIT): { input: Record<string, unknown>; truncated: boolean } {
  let truncated = false;
  const copy = (value: unknown, depth: number): unknown => {
    if (isString(value)) {
      if (value.length > limit) {
        truncated = true;
        return truncate(value, limit);
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (depth > 6) return [];
      if (value.length > 200) truncated = true;
      return value.slice(0, 200).map((item) => copy(item, depth + 1));
    }
    if (isRecord(value)) {
      if (depth > 6) return {};
      const out: Json = {};
      for (const [key, item] of Object.entries(value)) out[key] = copy(item, depth + 1);
      return out;
    }
    return value;
  };
  return { input: copy(isRecord(input) ? input : {}, 0) as Record<string, unknown>, truncated };
}

export function toolKind(name: string): ToolKind {
  if (name.startsWith('mcp__')) return 'mcp';
  switch (name) {
    case 'Read':
    case 'NotebookRead':
    case 'LS':
      return 'read';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit';
    case 'Bash':
    case 'PowerShell':
    case 'BashOutput':
    case 'KillShell':
    case 'KillBash':
      return 'shell';
    case 'Grep':
    case 'Glob':
      return 'search';
    case 'Task':
    case 'Agent':
      return 'subagent';
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
      return 'todos';
    case 'WebFetch':
    case 'WebSearch':
      return 'web';
    case 'AskUserQuestion':
      return 'question';
    case 'ExitPlanMode':
      return 'plan';
    default:
      return 'other';
  }
}

export const oneLine = (text: string, max = 140): string => truncate(text.replace(/\s+/g, ' ').trim(), max);
const baseName = (file: string): string => file.split(/[\\/]/).filter(Boolean).pop() ?? file;

/** Araç çağrısının tek satırlık özeti (dil içermez: yol, komut, sorgu). */
export function toolSummary(name: string, input: Record<string, unknown>): string {
  const get = (key: string): string => (isString(input[key]) ? (input[key] as string) : '');
  const kind = toolKind(name);
  if (kind === 'read' || kind === 'edit') return get('file_path') || get('notebook_path') || get('path') || name;
  if (kind === 'shell') return oneLine(get('command') || get('bash_id') || get('shell_id') || name);
  if (name === 'Grep') return `“${oneLine(get('pattern'), 80)}”${get('path') ? ` · ${baseName(get('path'))}` : ''}`;
  if (name === 'Glob') return oneLine(get('pattern') || name);
  if (name === 'WebFetch') return oneLine(get('url') || name);
  if (name === 'WebSearch') return `“${oneLine(get('query'), 100)}”`;
  if (kind === 'subagent') return oneLine(get('description') || get('prompt') || name);
  if (kind === 'todos') return Array.isArray(input.todos) ? String(input.todos.length) : oneLine(get('subject') || get('taskId') || name);
  if (kind === 'question') {
    const first = Array.isArray(input.questions) && isRecord(input.questions[0]) ? input.questions[0].question : '';
    return oneLine(isString(first) ? first : name);
  }
  if (kind === 'plan') return name;
  if (kind === 'mcp') {
    const match = /^mcp__(.+?)__(.+)$/.exec(name);
    return match ? `${match[1]!.replace(/_/g, ' ')} · ${match[2]!.replace(/_/g, ' ')}` : name;
  }
  const first = Object.values(input).find(isString);
  return first ? oneLine(first) : name;
}

export function readQuestions(input: Record<string, unknown>): AskQuestion[] {
  const list = Array.isArray(input.questions) ? input.questions.filter(isRecord) : [];
  return list.slice(0, 10).map((item) => ({
    question: isString(item.question) ? item.question : '',
    ...(isString(item.header) ? { header: item.header } : {}),
    options: (Array.isArray(item.options) ? item.options.filter(isRecord) : []).slice(0, 20).map((option) => ({
      label: isString(option.label) ? option.label : '',
      ...(isString(option.description) ? { description: option.description } : {}),
    })),
    multiSelect: item.multiSelect === true,
  }));
}

export type AnswerCheck = { ok: true; answers: Record<string, string> } | { ok: false; problem: 'missing' | 'extra' | 'empty' | 'single' | 'unknown'; subject: string };

/**
 * AskUserQuestion yanıtları sorulan sorulara uymalı: her soru (tam metniyle) yanıtlanmış, fazladan anahtar yok; seçenek yanıtı
 * seçeneklerden biri (çoklu seçimde bir ya da daha çok; CLI'ye virgülle birleştirilir). `freeText` listesindeki sorular
 * boş olmayan serbest metin alır (Claude Code her soruya kendiliğinden bir "Diğer" seçeneği ekler).
 */
export function checkAnswers(questions: AskQuestion[], answers: unknown, freeText: unknown = []): AnswerCheck {
  if (!isRecord(answers)) return { ok: false, problem: 'missing', subject: '' };
  const free = new Set(Array.isArray(freeText) ? freeText.filter(isString) : []);
  const expected = new Set(questions.map((item) => item.question));
  const extra = Object.keys(answers).find((key) => !expected.has(key));
  if (extra !== undefined) return { ok: false, problem: 'extra', subject: truncate(extra, 80) };
  const out: Record<string, string> = {};
  for (const item of questions) {
    const given = answers[item.question];
    const subject = truncate(item.question, 80);
    if (given === undefined) return { ok: false, problem: 'missing', subject };
    if (free.has(item.question)) {
      if (!isString(given) || !given.trim()) return { ok: false, problem: 'empty', subject };
      out[item.question] = truncate(given.trim(), 4000);
      continue;
    }
    const labels = new Set(item.options.map((option) => option.label));
    const chosen = Array.isArray(given)
      ? given.filter(isString).map((value) => value.trim())
      : isString(given)
        ? item.multiSelect
          ? given.split(',').map((value) => value.trim())
          : [given.trim()]
        : [];
    if (chosen.length === 0 || chosen.some((value) => !value)) return { ok: false, problem: 'empty', subject };
    if (!item.multiSelect && chosen.length !== 1) return { ok: false, problem: 'single', subject };
    const unknown = chosen.find((value) => !labels.has(value));
    if (unknown !== undefined) return { ok: false, problem: 'unknown', subject: truncate(unknown, 80) };
    out[item.question] = [...new Set(chosen)].join(', ');
  }
  return { ok: true, answers: out };
}

/** Metnin ilk cümlesi (Markdown işaretleri ve kod blokları atılır; en çok 200 karakter). */
export function firstSentence(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_#>]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  const match = /^(.+?[.!?…])(\s|$)/.exec(plain);
  return truncate(match ? match[1]! : plain, 200);
}

/**
 * Bitiş duyurusunun sonucu (demo.5): oturumun son asistan iletisinden 1–2 cümle, en çok `max` karakter. Kod çitleri,
 * satır içi kod, Markdown işaretleri, başlıklar, liste satırları, tablolar, dosya yolları, adresler ve anahtara benzeyen
 * uzun dizgiler atılır: söylenen metin "ne oldu"dur, dosya içeriği ya da sır değildir. Geriye bir şey kalmazsa ''.
 */
export function resultSummary(text: string, max = 240): string {
  const prose = text
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .split(/\r?\n/)
    // Başlık, liste, tablo ve alıntı satırları uzun dökümdür; özet düz paragraftan çıkar.
    .filter((line) => !/^\s*(#{1,6}\s|[-*+•]\s|\d+[.)]\s|\||>)/.test(line))
    .join(' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@~-]+){2,}[\\/]?/g, ' ')
    .replace(/\b[\w.-]+\.(?:ts|tsx|js|mjs|json|md|py|css|html|yml|yaml|toml|lock|env)\b/g, ' ')
    .replace(/\b(?:sk|pk|ghp|gho|xox[a-z])[-_][\w-]{10,}\b|\b[A-Za-z0-9+/_-]{32,}={0,2}/g, ' ')
    .replace(/[*_#>~]+/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!prose) return '';
  // Cümle sonu: noktalamadan sonra boşluk ya da metnin sonu ("not.txt" ortadaki nokta cümle bitirmez).
  const sentences = prose.match(/.+?[.!?…]+(?=\s|$)|.+$/g) ?? [prose];
  let out = '';
  for (const sentence of sentences.slice(0, 2)) {
    const next = out ? `${out} ${sentence.trim()}` : sentence.trim();
    if (next.length > max) break;
    out = next;
  }
  return out || truncate(sentences[0]!.trim(), max);
}

/** Tahmini dolar yalnız API anahtarıyla çalışan oturumda gösterilir (abonelikte ya da bilinmiyorsa hayır). */
export const showsCost = (apiKeySource: unknown): boolean =>
  apiKeySource === 'ANTHROPIC_API_KEY' || apiKeySource === 'apiKeyHelper' || apiKeySource === '/login managed key';
