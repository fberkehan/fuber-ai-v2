/**
 * Claude Code'un akış iletilerini (`stream-json` satırları; SDK'daki `SDKMessage`) sade olaylara çevirir.
 * v1 `shared/cc-olay.ts` › `ccNormallestir`'den taşındı: akan metin blok kimliğiyle izlenir (tam metin gelince parçanın
 * yerine geçer), araç sonuçları araç çağrısıyla eşlenir, Task* araçları yapılacaklar listesine, arka plan işleri ayrı bir
 * listeye toplanır. Bilinmeyen tür/alan sessizce atlanır (CLI yeni ileti ekleyebilir).
 */
import { t } from '@fuber/shared';
import { describeCliError } from './session-errors';
import {
  isRecord,
  oneLine,
  OUTPUT_LIMIT,
  showsCost,
  toolKind,
  toolSummary,
  truncate,
  truncateInput,
  type BackgroundTask,
  type StreamEvent,
  type TodoItem,
  type ToolKind,
  type TurnResultEvent,
} from './session-events';

type Json = Record<string, unknown>;
const isString = (value: unknown): value is string => typeof value === 'string';
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

interface StreamingMessage {
  id: string;
  textCount: number;
  blocks: Map<number, { kind: string; block: string }>;
}

/** Oturum başına bir kez kurulur; süreç yeniden açılsa da aynı bağlam sürer. */
export interface NormalizeContext {
  /** `parent_tool_use_id` (ana konuşma '') → akmakta olan ileti. */
  streaming: Map<string, StreamingMessage>;
  /** Tam asistan iletilerinde ileti kimliği başına görülen metin bloğu sayısı (akıştaki sırayla eşleşir). */
  assistantText: Map<string, number>;
  /** Akışta düşünme bloğu görülen iletiler (tam iletideki düşünme ikinci kez bildirilmesin). */
  thinkingSeen: Set<string>;
  /** tool_use kimliği → araç (sonuçlar için). */
  tools: Map<string, { name: string; kind: ToolKind; input?: Record<string, unknown> }>;
  /** Task* araçlarının görev listesi, eklenme sırasıyla. */
  taskTodos: Map<string, TodoItem>;
  /** Arka planda süren görevlerin kimlikleri. */
  background: Set<string>;
  lastBackgroundCount: number;
  apiKeySource?: string;
  tasks: Map<string, BackgroundTask>;
  /** Kabuk aracı kimliği → çıktı dosyası (task_started'dan önce ya da sonra gelebilir). */
  toolOutputs: Map<string, string>;
  /** Bu turda asistan hata iletisi gösterildi; sonuç satırı cümleyi yinelemesin. */
  turnErrorShown?: boolean;
  /** Son `rate_limit_event` durumu (sonucun "sınır doldu" sayılması için). */
  rateLimit?: { status: string; resetsAt: number | null };
}

export const createNormalizeContext = (): NormalizeContext => ({
  streaming: new Map(),
  assistantText: new Map(),
  thinkingSeen: new Set(),
  tools: new Map(),
  taskTodos: new Map(),
  background: new Set(),
  lastBackgroundCount: 0,
  tasks: new Map(),
  toolOutputs: new Map(),
});

function backgroundEvent(ctx: NormalizeContext): StreamEvent[] {
  const count = ctx.background.size;
  if (count === ctx.lastBackgroundCount) return [];
  ctx.lastBackgroundCount = count;
  return [{ type: 'background', count }];
}

const TASK_LIMIT = 30;
const FINISHED_LIMIT = 8;

/** Liste olayı (kopya); biten işler en çok `FINISHED_LIMIT`, toplam `TASK_LIMIT` (eskisi düşer). */
export function tasksEvent(ctx: NormalizeContext): StreamEvent {
  const finished = [...ctx.tasks.values()].filter((task) => task.status !== 'running');
  for (const task of finished.slice(0, Math.max(0, finished.length - FINISHED_LIMIT))) ctx.tasks.delete(task.id);
  while (ctx.tasks.size > TASK_LIMIT) ctx.tasks.delete(ctx.tasks.keys().next().value as string);
  return { type: 'tasks', tasks: [...ctx.tasks.values()].map((task) => ({ ...task })) };
}

/** Süreç bitti: arka plan işleri onunla öldü. Süren işler "durduruldu" olur; liste görünür kalır. */
export function resetBackground(ctx: NormalizeContext): StreamEvent[] {
  ctx.background.clear();
  ctx.streaming.clear();
  let changed = false;
  for (const task of ctx.tasks.values()) {
    if (task.status !== 'running') continue;
    task.status = 'stopped';
    task.endedAt = Date.now();
    task.summary = task.summary || t('claude.sys.taskDiedWithProcess');
    changed = true;
  }
  return [...backgroundEvent(ctx), ...(changed ? [tasksEvent(ctx)] : [])];
}

const taskKind = (value: unknown): BackgroundTask['kind'] =>
  value === 'local_bash' ? 'shell' : value === 'local_agent' || value === 'remote_agent' ? 'agent' : value === 'monitor' || value === 'local_monitor' ? 'monitor' : 'other';

/** Kabuk arka plan sonucundaki çıktı dosyası. Yalnız Claude Code'un KENDİ cümlesi (sonucun ilk satırı); ağ yolu kabul edilmez. */
export function findOutputFile(text: string): string | undefined {
  const match = /^\s*Command running in background with ID: [^\r\n]*?Output is being written to:\s*([^\r\n]+?)\s*(?:$|[\r\n])/i.exec(text);
  const file = match ? match[1]!.trim().replace(/[.,;]+$/, '') : undefined;
  return file && !/^[\\/]{2}/.test(file) ? file : undefined;
}

function findTask(ctx: NormalizeContext, message: Json): BackgroundTask | undefined {
  if (isString(message.task_id) && ctx.tasks.has(message.task_id)) return ctx.tasks.get(message.task_id);
  if (isString(message.tool_use_id)) for (const task of ctx.tasks.values()) if (task.toolUseId === message.tool_use_id) return task;
  return undefined;
}

const TODO_STATUS: Record<string, TodoItem['status']> = { pending: 'pending', in_progress: 'in_progress', completed: 'done' };
const todoList = (ctx: NormalizeContext): TodoItem[] => [...ctx.taskTodos.values()].map((item) => ({ ...item }));

function readTodos(todos: unknown): TodoItem[] {
  if (!Array.isArray(todos)) return [];
  return todos
    .filter(isRecord)
    .slice(0, 100)
    .map((item) => ({
      content: oneLine(isString(item.content) ? item.content : '', 300),
      status: item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'in_progress' : 'pending',
      ...(isString(item.activeForm) ? { activeForm: oneLine(item.activeForm, 300) } : {}),
    }));
}

/** TaskUpdate (araç çağrısında; iyimser): durum/başlık/etkin metin; 'deleted' siler. */
function updateTaskTodo(ctx: NormalizeContext, input: Record<string, unknown>): boolean {
  const taskId = isString(input.taskId) ? input.taskId : '';
  if (!taskId) return false;
  if (input.status === 'deleted') return ctx.taskTodos.delete(taskId);
  const previous = ctx.taskTodos.get(taskId);
  if (!previous && !isString(input.subject)) return false;
  const next: TodoItem = { ...(previous ?? { content: '', status: 'pending' }), taskId };
  if (isString(input.subject)) next.content = oneLine(input.subject, 300);
  if (isString(input.activeForm)) next.activeForm = oneLine(input.activeForm, 300);
  const status = isString(input.status) ? TODO_STATUS[input.status] : undefined;
  if (status) next.status = status;
  ctx.taskTodos.set(taskId, next);
  return true;
}

/** TaskCreate / TaskList sonucu: yapısal çıktı varsa ondan; yoksa metindeki "#<kimlik>". */
function applyTaskResult(ctx: NormalizeContext, tool: { name: string; input?: Record<string, unknown> }, toolId: string, structured: unknown, text: string): boolean {
  const data = isRecord(structured) ? structured : {};
  if (tool.name === 'TaskCreate') {
    const task = isRecord(data.task) ? data.task : {};
    const taskId = isString(task.id) ? task.id : (/#\s?([\w-]+)/.exec(text)?.[1] ?? `cc-${toolId}`);
    const input = tool.input ?? {};
    const subject = isString(task.subject) ? task.subject : isString(input.subject) ? input.subject : '';
    ctx.taskTodos.set(taskId, { content: oneLine(subject, 300), status: 'pending', taskId, ...(isString(input.activeForm) ? { activeForm: oneLine(input.activeForm, 300) } : {}) });
    return true;
  }
  if (tool.name === 'TaskList' && Array.isArray(data.tasks)) {
    const previous = ctx.taskTodos;
    ctx.taskTodos = new Map();
    for (const task of data.tasks.filter(isRecord).slice(0, 200)) {
      if (!isString(task.id)) continue;
      const old = previous.get(task.id);
      ctx.taskTodos.set(task.id, {
        content: oneLine(isString(task.subject) ? task.subject : (old?.content ?? ''), 300),
        status: (isString(task.status) ? TODO_STATUS[task.status] : undefined) ?? old?.status ?? 'pending',
        taskId: task.id,
        ...(old?.activeForm ? { activeForm: old.activeForm } : {}),
      });
    }
    return true;
  }
  return false;
}

/** Bağlam haritaları sınırsız büyümesin (uzun oturum). */
function prune(ctx: NormalizeContext): void {
  const cap = <K, V>(map: Map<K, V>, max: number) => {
    while (map.size > max) map.delete(map.keys().next().value as K);
  };
  cap(ctx.assistantText, 400);
  cap(ctx.tools, 2000);
  cap(ctx.taskTodos, 300);
  while (ctx.thinkingSeen.size > 400) ctx.thinkingSeen.delete(ctx.thinkingSeen.values().next().value as string);
}

function contentText(content: unknown): string {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) ? (part.type === 'text' && isString(part.text) ? part.text : part.type === 'image' ? t('claude.sys.image') : '') : ''))
    .filter(Boolean)
    .join('\n');
}

function toolStarted(ctx: NormalizeContext, block: Json, parent: string | null): StreamEvent[] {
  const id = isString(block.id) ? block.id : '';
  const name = isString(block.name) ? block.name : '';
  if (!id || !name) return [];
  const kind = toolKind(name);
  const { input, truncated } = truncateInput(block.input);
  ctx.tools.set(id, { name, kind, ...(kind === 'todos' ? { input } : {}) });
  if (kind === 'todos') {
    if (name === 'TodoWrite') return [{ type: 'todos', id, items: readTodos(input.todos), parent }];
    if (name === 'TaskUpdate' && updateTaskTodo(ctx, input)) return [{ type: 'todos', id, items: todoList(ctx), parent }];
    // TaskCreate / TaskList: kimlik ve liste sonuçta gelir; TaskGet listeyi değiştirmez.
    return [];
  }
  if (kind === 'subagent') {
    return [
      {
        type: 'subagent',
        id,
        description: oneLine(isString(input.description) ? input.description : t('claude.sys.subagent'), 200),
        prompt: truncate(isString(input.prompt) ? input.prompt : '', 2000),
        parent,
        ...(isString(input.subagent_type) ? { agentType: input.subagent_type } : {}),
      },
    ];
  }
  return [{ type: 'tool_start', id, name, kind, input, summary: toolSummary(name, input), parent, ...(truncated ? { truncated } : {}) }];
}

function toolFinished(ctx: NormalizeContext, block: Json, parent: string | null, structured?: unknown): StreamEvent[] {
  const id = isString(block.tool_use_id) ? block.tool_use_id : '';
  if (!id) return [];
  const tool = ctx.tools.get(id);
  const raw = contentText(block.content);
  if (tool?.kind === 'todos') {
    // Liste zaten gösterildi ("başarıyla güncellendi" gürültüsü kart olmaz); TaskCreate/TaskList sonucu listeyi kurar.
    if (block.is_error !== true && applyTaskResult(ctx, tool, id, structured, raw)) return [{ type: 'todos', id, items: todoList(ctx), parent }];
    return [];
  }
  const out: StreamEvent[] = [{ type: 'tool_end', id, error: block.is_error === true, output: truncate(raw, OUTPUT_LIMIT), truncated: raw.length > OUTPUT_LIMIT, parent }];
  // Kabuk komutu arka plana alındı: sonuç metni çıktı dosyasını söyler; işin satırına bağlanır.
  const file = tool?.kind === 'shell' ? findOutputFile(raw) : undefined;
  if (file) {
    ctx.toolOutputs.set(id, file);
    while (ctx.toolOutputs.size > 200) ctx.toolOutputs.delete(ctx.toolOutputs.keys().next().value as string);
    const task = [...ctx.tasks.values()].find((item) => item.toolUseId === id);
    if (task) {
      task.outputFile = file;
      task.backgrounded = true;
      out.push(tasksEvent(ctx));
    }
  }
  return out;
}

function assistantBlocks(ctx: NormalizeContext, messageId: string, content: unknown, parent: string | null): StreamEvent[] {
  const out: StreamEvent[] = [];
  const blocks = isString(content) ? [{ type: 'text', text: content }] : content;
  if (!Array.isArray(blocks)) return out;
  let thinking = 0;
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && isString(block.text)) {
      const index = ctx.assistantText.get(messageId) ?? 0;
      ctx.assistantText.set(messageId, index + 1);
      if (block.text.trim()) out.push({ type: 'text', block: `${messageId}#${index}`, text: block.text, parent });
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      if (!ctx.thinkingSeen.has(messageId)) out.push({ type: 'thinking', block: `${messageId}#d${thinking}`, phase: 'end', parent });
      thinking++;
    } else if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
      out.push(...toolStarted(ctx, block, parent));
    } else if (isString(block.type) && block.type.endsWith('_tool_result') && isString(block.tool_use_id)) {
      out.push(...toolFinished(ctx, block, parent));
    }
  }
  return out;
}

/** Canlı akışta kullanıcı metnini oturum yöneticisi kendisi yazar (gönderirken); buradan yalnız araç sonuçları çıkar. */
function userBlocks(ctx: NormalizeContext, content: unknown, parent: string | null, structured?: unknown): StreamEvent[] {
  if (!Array.isArray(content)) return [];
  const out: StreamEvent[] = [];
  // Yapısal araç çıktısı (`tool_use_result`) iletinin TEK araç sonucuna aittir.
  const single = content.filter((item) => isRecord(item) && item.type === 'tool_result').length === 1;
  for (const block of content) {
    if (isRecord(block) && block.type === 'tool_result') out.push(...toolFinished(ctx, block, parent, single ? structured : undefined));
  }
  return out;
}

function streamEvent(ctx: NormalizeContext, event: Json, parent: string | null): StreamEvent[] {
  const key = parent ?? '';
  if (event.type === 'message_start') {
    const message = isRecord(event.message) ? event.message : {};
    const id = isString(message.id) ? message.id : `stream-${ctx.streaming.size}-${Date.now()}`;
    ctx.streaming.set(key, { id, textCount: 0, blocks: new Map() });
    return [];
  }
  const current = ctx.streaming.get(key);
  if (!current) return [];
  const index = typeof event.index === 'number' ? event.index : -1;
  if (event.type === 'content_block_start' && isRecord(event.content_block)) {
    const kind = event.content_block.type;
    if (kind === 'text') {
      current.blocks.set(index, { kind: 'text', block: `${current.id}#${current.textCount++}` });
      return [];
    }
    if (kind === 'thinking' || kind === 'redacted_thinking') {
      const block = `${current.id}#d${[...current.blocks.values()].filter((item) => item.kind === 'thinking').length}`;
      current.blocks.set(index, { kind: 'thinking', block });
      ctx.thinkingSeen.add(current.id);
      return [{ type: 'thinking', block, phase: 'start', parent }];
    }
    current.blocks.set(index, { kind: String(kind), block: '' });
    return [];
  }
  if (event.type === 'content_block_delta' && isRecord(event.delta)) {
    const block = current.blocks.get(index);
    if (block?.kind === 'text' && event.delta.type === 'text_delta' && isString(event.delta.text) && event.delta.text) {
      return [{ type: 'text_delta', block: block.block, text: event.delta.text, parent }];
    }
    return [];
  }
  if (event.type === 'content_block_stop') {
    const block = current.blocks.get(index);
    return block?.kind === 'thinking' ? [{ type: 'thinking', block: block.block, phase: 'end', parent }] : [];
  }
  if (event.type === 'message_stop') ctx.streaming.delete(key);
  return [];
}

/** Arka plan görevi sayılır mı: ortam/izleyici (ambient, skip_transcript) görevler sayılmaz. */
const countsAsBackground = (task: Json): boolean => isString(task.task_id) && task.task_id !== '' && task.ambient !== true && task.skip_transcript !== true;

function systemMessage(message: Json, ctx: NormalizeContext): StreamEvent[] {
  switch (message.subtype) {
    case 'init': {
      const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);
      ctx.apiKeySource = isString(message.apiKeySource) ? message.apiKeySource : undefined;
      return [
        {
          type: 'init',
          sessionId: isString(message.session_id) ? message.session_id : '',
          model: isString(message.model) ? message.model : '',
          mode: isString(message.permissionMode) ? message.permissionMode : '',
          version: isString(message.claude_code_version) ? message.claude_code_version : '',
          cwd: isString(message.cwd) ? message.cwd : '',
          tools: list(message.tools),
          commands: list(message.slash_commands),
          capabilities: list(message.capabilities),
          mcpServers: (Array.isArray(message.mcp_servers) ? message.mcp_servers : []).map((server) => (isRecord(server) && isString(server.name) ? server.name : '?')),
          skills: list(message.skills),
          ...(ctx.apiKeySource !== undefined ? { apiKeySource: ctx.apiKeySource } : {}),
        },
      ];
    }
    case 'task_started': {
      if (message.is_backgrounded === true && countsAsBackground(message)) ctx.background.add(message.task_id as string);
      const out = backgroundEvent(ctx);
      if (!countsAsBackground(message)) return out;
      const id = message.task_id as string;
      const toolUseId = isString(message.tool_use_id) ? message.tool_use_id : undefined;
      const previous = ctx.tasks.get(id);
      const file = toolUseId ? ctx.toolOutputs.get(toolUseId) : undefined;
      // Aynı işin ikinci bildirimi (değişen bir şey yoksa) yeniden yayınlanmaz.
      if (previous && previous.status === 'running' && previous.backgrounded === (message.is_backgrounded === true || previous.backgrounded) && (!toolUseId || previous.toolUseId === toolUseId)) {
        return out;
      }
      ctx.tasks.set(id, {
        ...(previous ?? {}),
        id,
        description: oneLine(isString(message.description) && message.description.trim() ? message.description : isString(message.workflow_name) ? message.workflow_name : t('claude.sys.task'), 200),
        kind: taskKind(message.task_type),
        status: 'running',
        backgrounded: message.is_backgrounded === true || Boolean(file),
        startedAt: previous?.startedAt ?? Date.now(),
        ...(toolUseId ? { toolUseId } : {}),
        ...(file ? { outputFile: file } : {}),
      });
      return [...out, tasksEvent(ctx)];
    }
    case 'task_progress': {
      const task = findTask(ctx, message);
      if (!task) return [];
      const usage = isRecord(message.usage) ? message.usage : {};
      if (num(usage.duration_ms)) task.elapsedSec = Math.floor(num(usage.duration_ms) / 1000);
      if (isString(message.last_tool_name)) task.lastTool = oneLine(message.last_tool_name, 60);
      if (isString(message.summary) && message.summary.trim()) task.summary = oneLine(message.summary, 200);
      return [tasksEvent(ctx)];
    }
    case 'task_notification': {
      if (isString(message.task_id)) ctx.background.delete(message.task_id);
      const out = backgroundEvent(ctx);
      const task = findTask(ctx, message);
      if (!task) return out;
      task.status = message.status === 'failed' ? 'failed' : message.status === 'stopped' ? 'stopped' : 'done';
      task.endedAt = Date.now();
      if (isString(message.output_file) && message.output_file.trim()) task.outputFile = message.output_file.trim();
      if (isString(message.summary) && message.summary.trim()) task.summary = oneLine(message.summary, 200);
      const usage = isRecord(message.usage) ? message.usage : {};
      if (num(usage.duration_ms)) task.elapsedSec = Math.floor(num(usage.duration_ms) / 1000);
      return [...out, tasksEvent(ctx)];
    }
    case 'task_updated': {
      const patch = isRecord(message.patch) ? message.patch : {};
      const ended = patch.status === 'completed' || patch.status === 'failed' || patch.status === 'killed';
      if (isString(message.task_id) && ended) ctx.background.delete(message.task_id);
      // Ön planda başlayan iş arka plana alındı: artık arka plan sayısına girer.
      else if (isString(message.task_id) && patch.is_backgrounded === true && ctx.tasks.has(message.task_id)) ctx.background.add(message.task_id);
      const out = backgroundEvent(ctx);
      const task = findTask(ctx, message);
      if (!task) return out;
      if (patch.is_backgrounded === true) task.backgrounded = true;
      if (isString(patch.description) && patch.description.trim()) task.description = oneLine(patch.description, 200);
      if (ended) {
        task.status = patch.status === 'failed' ? 'failed' : patch.status === 'killed' ? 'stopped' : 'done';
        task.endedAt = Date.now();
        if (isString(patch.error) && patch.error.trim()) task.summary = oneLine(patch.error, 200);
      }
      return [...out, tasksEvent(ctx)];
    }
    case 'background_tasks_changed': {
      // Seviye sinyali: kümeyi değiştirir (kaçan bir bitiş bildirimi sayıyı takılı bırakmaz).
      if (!Array.isArray(message.tasks)) return [];
      const list = message.tasks.filter(isRecord).filter(countsAsBackground).slice(0, 200);
      ctx.background = new Set(list.map((task) => task.task_id as string));
      let changed = false;
      for (const item of list) {
        const id = item.task_id as string;
        const task = ctx.tasks.get(id);
        if (task) {
          if (!task.backgrounded) {
            task.backgrounded = true;
            changed = true;
          }
          continue;
        }
        ctx.tasks.set(id, {
          id,
          description: oneLine(isString(item.description) && item.description.trim() ? item.description : t('claude.sys.task'), 200),
          kind: taskKind(item.task_type),
          status: 'running',
          backgrounded: true,
          startedAt: Date.now(),
        });
        changed = true;
      }
      return [...backgroundEvent(ctx), ...(changed ? [tasksEvent(ctx)] : [])];
    }
    case 'status': {
      const out: StreamEvent[] = [];
      if (isString(message.permissionMode)) out.push({ type: 'mode', mode: message.permissionMode });
      if (message.status === 'compacting') out.push({ type: 'system', level: 'info', text: t('claude.sys.compacting') });
      if (message.compact_result === 'failed') {
        out.push({ type: 'system', level: 'warn', text: t('claude.sys.compactFailed'), ...(isString(message.compact_error) ? { detail: oneLine(message.compact_error, 200) } : {}) });
      }
      return out;
    }
    case 'compact_boundary':
      return [{ type: 'system', level: 'info', text: t('claude.sys.compacted') }];
    case 'api_retry':
      return [{ type: 'system', level: 'warn', text: t('claude.sys.apiRetry', { attempt: num(message.attempt), max: num(message.max_retries) }) }];
    case 'permission_denied':
      return [
        {
          type: 'system',
          level: 'warn',
          text: t('claude.sys.autoDenied', { tool: isString(message.tool_name) ? message.tool_name : '?' }),
          ...(isString(message.decision_reason) ? { detail: oneLine(message.decision_reason, 200) } : {}),
        },
      ];
    case 'local_command_output':
      return isString(message.content) && message.content.trim()
        ? [{ type: 'text', block: isString(message.uuid) ? message.uuid : `local-${Date.now()}`, text: message.content, parent: null }]
        : [];
    case 'notification':
      return isString(message.text) && message.text.trim()
        ? [{ type: 'system', level: message.priority === 'high' || message.priority === 'immediate' ? 'warn' : 'info', text: oneLine(message.text, 300) }]
        : [];
    default:
      return [];
  }
}

export interface NormalizeOptions {
  /** Bu turda kullanıcı "Durdur" dedi: sonuç "durduruldu" sayılır. */
  interruptRequested?: boolean;
}

function resultMessage(message: Json, options: NormalizeOptions, ctx: NormalizeContext): TurnResultEvent {
  const usage = isRecord(message.usage) ? message.usage : {};
  const interrupted = Boolean(options.interruptRequested) || (isString(message.terminal_reason) && message.terminal_reason.startsWith('aborted'));
  const errorShown = ctx.turnErrorShown === true;
  ctx.turnErrorShown = false;
  const failed = message.is_error === true || (isString(message.subtype) && message.subtype.startsWith('error'));
  const errors = Array.isArray(message.errors)
    ? message.errors
        .filter(isString)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const raw = errors.length ? errors.join('; ') : isString(message.result) && message.result ? message.result : isString(message.subtype) ? message.subtype : '';
  let error: { class: string; text: string } | null = null;
  if (failed && !interrupted) {
    // Sıfırlanma anı geçmiş bir "rejected" kaydı artık geçerli değildir (CLI yeni durumu ancak sonraki istekte bildirir):
    // o andan sonraki ilgisiz bir hata sınır sayılmaz.
    const limited = ctx.rateLimit?.status === 'rejected' && (ctx.rateLimit.resetsAt === null || ctx.rateLimit.resetsAt > Date.now());
    const described = describeCliError(raw, num(message.api_error_status) === 429 || limited ? 'rate_limit' : undefined);
    error = { class: described.class, text: truncate(described.text, 1000) };
  }
  return {
    type: 'result',
    ok: !failed && !interrupted,
    interrupted,
    durationMs: num(message.duration_ms),
    turns: num(message.num_turns),
    costUsd: num(message.total_cost_usd),
    showCost: showsCost(ctx.apiKeySource),
    usage: { input: num(usage.input_tokens), output: num(usage.output_tokens), cacheRead: num(usage.cache_read_input_tokens), cacheWrite: num(usage.cache_creation_input_tokens) },
    ...(error ? { error: error.text, errorClass: error.class, ...(errorShown ? { errorShown: true } : {}) } : {}),
    ...(message.subtype === 'success' && !failed && isString(message.result) && message.result ? { text: truncate(message.result, 4000) } : {}),
  };
}

/** Tek bir akış iletisini sade olaylara çevirir. Bilinmeyen tür/alan → []. */
export function normalizeSessionMessage(message: unknown, ctx: NormalizeContext, options: NormalizeOptions = {}): StreamEvent[] {
  if (!isRecord(message) || !isString(message.type)) return [];
  const parent = isString(message.parent_tool_use_id) ? message.parent_tool_use_id : null;
  try {
    switch (message.type) {
      case 'system':
        return systemMessage(message, ctx);
      case 'stream_event':
        return isRecord(message.event) ? streamEvent(ctx, message.event, parent) : [];
      case 'assistant': {
        const body = isRecord(message.message) ? message.message : {};
        const id = isString(body.id) ? body.id : isString(message.uuid) ? message.uuid : `assistant-${ctx.assistantText.size}`;
        // Claude Code hatayı sentetik bir asistan iletisi olarak da yazar ("Credit balance is too low", "API Error: 401 {json}"):
        // ham metin dökümde görünmez, yerine tek cümle + eylem gelir.
        if (isString(message.error) && (message.error !== 'unknown' || body.model === '<synthetic>')) {
          const described = describeCliError(contentText(body.content), message.error);
          ctx.turnErrorShown = true;
          prune(ctx);
          return [{ type: 'system', level: message.error === 'overloaded' || described.class === 'overloaded' ? 'warn' : 'error', text: described.text }];
        }
        const out = assistantBlocks(ctx, id, body.content, parent);
        prune(ctx);
        return out;
      }
      case 'user': {
        const body = isRecord(message.message) ? message.message : {};
        return userBlocks(ctx, body.content, parent, message.tool_use_result);
      }
      case 'result':
        return [resultMessage(message, options, ctx)];
      case 'rate_limit_event': {
        const info = isRecord(message.rate_limit_info) ? message.rate_limit_info : {};
        const status = isString(info.status) ? info.status : 'unknown';
        // CLI saniye cinsinden verir; arayüz epoch ms bekler.
        const resetsAt = num(info.resetsAt) ? (num(info.resetsAt) < 1e12 ? num(info.resetsAt) * 1000 : num(info.resetsAt)) : null;
        ctx.rateLimit = { status, resetsAt };
        return [{ type: 'rate_limit', status, resetsAt, limitType: isString(info.rateLimitType) ? info.rateLimitType : null }];
      }
      case 'tool_progress': {
        const task = findTask(ctx, message);
        if (!task || task.status !== 'running') return [];
        const seconds = Math.floor(num(message.elapsed_time_seconds));
        if (seconds === task.elapsedSec) return [];
        task.elapsedSec = seconds;
        return [tasksEvent(ctx)];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}
