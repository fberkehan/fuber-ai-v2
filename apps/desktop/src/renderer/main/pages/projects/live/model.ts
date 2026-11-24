// Canlı dökümün modeli (v1 `renderer/claudecode/dokum-modeli.ts` + `katla.ts`'ten). Saf: olay kayıtlarını çizilecek ÖĞELERE çevirir.
//  • asistan metni blok başına TEK öğe: `text_delta` eklenir, `text` tam metinle değiştirir
//  • araç kartı: `tool_start` + `tool_end` aynı kimlikte birleşir · alt ajan iç içe (`parent` = alt ajanın araç kimliği)
//  • yapılacaklar: art arda gelen güncellemeler tek kartta · izin isteği: kendi araç kartı varsa karar o kartta rozet olur
//  • değişen öğe (ve alt ajan zincirinde ataları) YENİ nesne olur, değişmeyen aynı kalır: `memo` yalnız değişeni yeniden çizer
import type { LiveEvent, PermissionRequestEvent, TodoItem, ToolKind, TurnResultEvent } from '../../../../../main/modules/projects/claude/types';

export type ToolState = 'running' | 'done' | 'error' | 'interrupted';
export type PermissionDecision = 'allow' | 'always' | 'deny' | 'cancelled';

interface Base {
  key: string;
  at: number;
  parent: string | null;
}
export type UserItem = Base & { kind: 'user'; text: string; images: number };
export type TextItem = Base & { kind: 'text'; block: string; text: string; streaming: boolean };
export type ThinkingItem = Base & { kind: 'thinking'; block: string; done: boolean };
export type ToolItem = Base & {
  kind: 'tool';
  id: string;
  name: string;
  toolKind: ToolKind;
  input: Record<string, unknown>;
  summary: string;
  state: ToolState;
  output?: string;
  truncated?: boolean;
  inputTruncated?: boolean;
  endedAt?: number;
  /** Bu aracın izin isteğine verilen karar (kartta rozet). */
  decision?: PermissionDecision;
};
export type SubagentItem = Base & {
  kind: 'subagent';
  id: string;
  description: string;
  agentType?: string;
  prompt: string;
  state: ToolState;
  output?: string;
  endedAt?: number;
  children: TranscriptItem[];
};
export type TodosItem = Base & { kind: 'todos'; id: string; items: TodoItem[]; stale: boolean };
export type PermissionItem = Base & { kind: 'permission'; request: PermissionRequestEvent; decision?: PermissionDecision; toolId?: string };
/** `background`: sonuç geldiği an (ve sonra düştükçe) arkada süren iş sayısı; yalnız SON sonuç kartı canlı sayar. */
export type ResultItem = Base & { kind: 'result'; result: TurnResultEvent; background: number };
export type SystemItem = Base & { kind: 'system'; level: 'info' | 'warn' | 'error'; text: string; detail?: string };
export type NoteItem = Base & { kind: 'note'; note: 'mode' | 'model'; value: string };
export type LimitItem = Base & { kind: 'limit'; resetsAt: number | null; limitType: string | null };
export type TranscriptItem =
  | UserItem
  | TextItem
  | ThinkingItem
  | ToolItem
  | SubagentItem
  | TodosItem
  | PermissionItem
  | ResultItem
  | SystemItem
  | NoteItem
  | LimitItem;

/** Bellekte tutulan en çok üst düzey öğe (fazlası en eskiden atılır). */
export const ITEM_LIMIT = 6000;

let modelCounter = 0;

export class TranscriptModel {
  private readonly prefix = `t${++modelCounter}-`;
  private counter = 0;
  private roots: string[] = [];
  /** Öğenin kendi alanları (alt ajanda `children` boş tutulur; çocuklar `kids` haritasında). */
  private base = new Map<string, TranscriptItem>();
  private kids = new Map<string, string[]>();
  private parentOf = new Map<string, string>();
  private toolKey = new Map<string, string>();
  private blockKey = new Map<string, string>();
  private permissionKey = new Map<string, string>();
  /** Başlangıcı bu modelde olmayan araç sonuçları (döküm sınırı). */
  private orphans = new Map<string, { error: boolean; output: string; truncated: boolean; at: number }>();
  /** parent ('' = ana konuşma) → son yapılacaklar öğesi. */
  private lastTodos = new Map<string, string>();
  private built = new Map<string, TranscriptItem>();
  private dirty = new Set<string>();
  private background = 0;
  private lastResult: string | null = null;
  private lastLimit: string | null = null;
  private cache: TranscriptItem[] | null = null;
  /** Sınır yüzünden atılan üst düzey öğe sayısı. */
  dropped = 0;
  /** Her değişiklikte artar. */
  version = 0;

  /** Tek olay; değişiklik olduysa `true`. */
  apply(event: LiveEvent, at = Date.now()): boolean {
    const changed = this.handle(event, at);
    if (changed) {
      this.version++;
      this.cache = null;
    }
    return changed;
  }

  applyAll(events: ReadonlyArray<{ event: LiveEvent; at: number }>): void {
    let changed = false;
    for (const item of events) changed = this.handle(item.event, item.at) || changed;
    if (changed) {
      this.version++;
      this.cache = null;
    }
  }

  /** Çizilecek üst düzey öğeler (biten düşünme göstergeleri ve kendi araç kartı olan izin satırları gizli). */
  list(): TranscriptItem[] {
    if (this.cache) return this.cache;
    const out: TranscriptItem[] = [];
    for (const key of this.roots) {
      const item = this.build(key);
      if (!item || (item.kind === 'thinking' && item.done) || (item.kind === 'permission' && (!item.decision || this.hasCard(item.toolId)))) continue;
      out.push(item);
    }
    this.dirty.clear();
    this.cache = out;
    return out;
  }

  /** Bu araç kimliği dökümde bir araç kartı olarak var mı. */
  hasCard(toolId: string | undefined): boolean {
    if (!toolId) return false;
    const key = this.toolKey.get(toolId);
    return Boolean(key && this.base.get(key)?.kind === 'tool');
  }

  /** Akmakta olan metin ya da süren düşünme var mı. */
  streaming(): boolean {
    for (const item of this.base.values()) if ((item.kind === 'text' && item.streaming) || (item.kind === 'thinking' && !item.done)) return true;
    return false;
  }

  private nextKey(): string {
    return `${this.prefix}${++this.counter}`;
  }

  private add(item: TranscriptItem, parent: string | null): void {
    const parentKey = parent ? this.toolKey.get(parent) : undefined;
    const owner = parentKey ? this.base.get(parentKey) : undefined;
    this.base.set(item.key, item);
    if (owner?.kind === 'subagent') {
      const list = this.kids.get(owner.key) ?? [];
      list.push(item.key);
      this.kids.set(owner.key, list);
      this.parentOf.set(item.key, owner.key);
      this.touch(owner.key);
    } else {
      this.roots.push(item.key);
      if (this.roots.length > ITEM_LIMIT) this.trim(this.roots.length - ITEM_LIMIT);
    }
    this.dirty.add(item.key);
  }

  private trim(count: number): void {
    const removed = this.roots.splice(0, count);
    this.dropped += count;
    const drop = (key: string) => {
      const item = this.base.get(key);
      this.base.delete(key);
      this.built.delete(key);
      this.parentOf.delete(key);
      this.dirty.delete(key);
      if (item && (item.kind === 'tool' || item.kind === 'subagent') && this.toolKey.get(item.id) === key) this.toolKey.delete(item.id);
      if (item && (item.kind === 'text' || item.kind === 'thinking') && this.blockKey.get(item.block) === key) this.blockKey.delete(item.block);
      if (item?.kind === 'permission' && this.permissionKey.get(item.request.requestId) === key) this.permissionKey.delete(item.request.requestId);
      for (const child of this.kids.get(key) ?? []) drop(child);
      this.kids.delete(key);
    };
    for (const key of removed) drop(key);
  }

  private change(key: string, update: (item: TranscriptItem) => TranscriptItem): void {
    const item = this.base.get(key);
    if (!item) return;
    this.base.set(key, update(item));
    this.touch(key);
  }

  private touch(key: string): void {
    for (let current: string | undefined = key; current; current = this.parentOf.get(current)) this.dirty.add(current);
  }

  private build(key: string): TranscriptItem | undefined {
    if (!this.dirty.has(key)) {
      const ready = this.built.get(key);
      if (ready) return ready;
    }
    const item = this.base.get(key);
    if (!item) return undefined;
    let result: TranscriptItem = item;
    if (item.kind === 'subagent') {
      const children: TranscriptItem[] = [];
      for (const child of this.kids.get(key) ?? []) {
        const builtChild = this.build(child);
        if (builtChild && !(builtChild.kind === 'thinking' && builtChild.done)) children.push(builtChild);
      }
      result = { ...item, children };
    }
    this.built.set(key, result);
    return result;
  }

  private finishTool(key: string, error: boolean, output: string, truncated: boolean, at: number): void {
    this.change(key, (item) => {
      if (item.kind === 'tool') return { ...item, state: error ? 'error' : 'done', output, truncated, endedAt: at };
      if (item.kind === 'subagent') return { ...item, state: error ? 'error' : 'done', output, endedAt: at };
      return item;
    });
  }

  private staleTodos(key: string): void {
    this.change(key, (item) => (item.kind === 'todos' && !item.stale ? { ...item, stale: true } : item));
  }

  private handle(event: LiveEvent, at: number): boolean {
    switch (event.type) {
      case 'user': {
        if (!event.text.trim() && !event.images) return false;
        this.add({ kind: 'user', key: this.nextKey(), at, parent: null, text: event.text, images: event.images }, null);
        return true;
      }
      case 'text_delta':
      case 'text': {
        const key = this.blockKey.get(event.block);
        const item = key ? this.base.get(key) : undefined;
        if (key && item?.kind === 'text') {
          const text = event.type === 'text' ? event.text : item.text + event.text;
          const streaming = event.type === 'text_delta';
          if (text === item.text && streaming === item.streaming) return false;
          this.change(key, () => ({ ...item, text, streaming }));
          return true;
        }
        if (!event.text) return false;
        const created: TextItem = { kind: 'text', key: this.nextKey(), at, parent: event.parent, block: event.block, text: event.text, streaming: event.type === 'text_delta' };
        this.blockKey.set(event.block, created.key);
        this.add(created, event.parent);
        return true;
      }
      case 'thinking': {
        const key = this.blockKey.get(event.block);
        if (key) {
          const item = this.base.get(key);
          if (item?.kind !== 'thinking' || item.done === (event.phase === 'end')) return false;
          this.change(key, () => ({ ...item, done: event.phase === 'end' }));
          return true;
        }
        if (event.phase === 'end') return false;
        const created: ThinkingItem = { kind: 'thinking', key: this.nextKey(), at, parent: event.parent, block: event.block, done: false };
        this.blockKey.set(event.block, created.key);
        this.add(created, event.parent);
        return true;
      }
      case 'tool_start': {
        const existing = this.toolKey.get(event.id);
        if (existing) {
          this.change(existing, (item) => (item.kind === 'tool' ? { ...item, input: event.input, summary: event.summary } : item));
          return true;
        }
        const created: ToolItem = {
          kind: 'tool',
          key: this.nextKey(),
          at,
          parent: event.parent,
          id: event.id,
          name: event.name,
          toolKind: event.kind,
          input: event.input,
          summary: event.summary,
          state: 'running',
          ...(event.truncated ? { inputTruncated: true } : {}),
        };
        this.toolKey.set(event.id, created.key);
        this.add(created, event.parent);
        const orphan = this.orphans.get(event.id);
        if (orphan) {
          this.orphans.delete(event.id);
          this.finishTool(created.key, orphan.error, orphan.output, orphan.truncated, orphan.at);
        }
        return true;
      }
      case 'subagent': {
        if (this.toolKey.has(event.id)) return false;
        const created: SubagentItem = {
          kind: 'subagent',
          key: this.nextKey(),
          at,
          parent: event.parent,
          id: event.id,
          description: event.description,
          prompt: event.prompt,
          ...(event.agentType ? { agentType: event.agentType } : {}),
          state: 'running',
          children: [],
        };
        this.toolKey.set(event.id, created.key);
        this.add(created, event.parent);
        return true;
      }
      case 'tool_end': {
        const key = this.toolKey.get(event.id);
        if (!key) {
          this.orphans.set(event.id, { error: event.error, output: event.output, truncated: event.truncated, at });
          return false;
        }
        this.finishTool(key, event.error, event.output, event.truncated, at);
        return true;
      }
      case 'todos': {
        const scope = event.parent ?? '';
        const last = this.lastTodos.get(scope);
        const lastItem = last ? this.base.get(last) : undefined;
        const siblings = event.parent ? (this.kids.get(this.toolKey.get(event.parent) ?? '') ?? []) : this.roots;
        // Art arda gelen güncellemeler tek kartta: son öğe aynı listeyse yerinde güncellenir.
        if (last && lastItem?.kind === 'todos' && siblings[siblings.length - 1] === last) {
          this.change(last, () => ({ ...lastItem, items: event.items, at }));
          return true;
        }
        if (last) this.staleTodos(last);
        const created: TodosItem = { kind: 'todos', key: this.nextKey(), at, parent: event.parent, id: event.id, items: event.items, stale: false };
        this.lastTodos.set(scope, created.key);
        this.add(created, event.parent);
        return true;
      }
      case 'permission_request': {
        if (this.permissionKey.has(event.requestId)) return false;
        const created: PermissionItem = { kind: 'permission', key: this.nextKey(), at, parent: null, request: event, ...(event.toolUseId ? { toolId: event.toolUseId } : {}) };
        this.permissionKey.set(event.requestId, created.key);
        this.add(created, null);
        return true;
      }
      case 'permission_resolved': {
        const key = this.permissionKey.get(event.requestId);
        const item = key ? this.base.get(key) : undefined;
        if (!key || item?.kind !== 'permission' || item.decision === event.decision) return false;
        this.change(key, () => ({ ...item, decision: event.decision }));
        const toolKey = item.toolId ? this.toolKey.get(item.toolId) : undefined;
        const tool = toolKey ? this.base.get(toolKey) : undefined;
        if (toolKey && tool?.kind === 'tool') this.change(toolKey, () => ({ ...tool, decision: event.decision }));
        return true;
      }
      case 'result': {
        // Tur bitti: akan metinler ve süren göstergeler kapanır; hâlâ "çalışıyor" görünen araçlar kesildi sayılır.
        for (const [key, item] of this.base) {
          if (item.kind === 'text' && item.streaming) this.change(key, () => ({ ...item, streaming: false }));
          else if (item.kind === 'thinking' && !item.done) this.change(key, () => ({ ...item, done: true }));
          else if ((item.kind === 'tool' || item.kind === 'subagent') && item.state === 'running') this.change(key, () => ({ ...item, state: 'interrupted' }));
        }
        if (this.lastResult) this.change(this.lastResult, (item) => (item.kind === 'result' && item.background > 0 ? { ...item, background: 0 } : item));
        const created: ResultItem = { kind: 'result', key: this.nextKey(), at, parent: null, result: event, background: this.background };
        this.add(created, null);
        this.lastResult = created.key;
        return true;
      }
      case 'background': {
        this.background = event.count;
        const item = this.lastResult ? this.base.get(this.lastResult) : undefined;
        if (!this.lastResult || item?.kind !== 'result' || item.background === 0 || item.background === event.count) return false;
        this.change(this.lastResult, () => ({ ...item, background: event.count }));
        return true;
      }
      case 'system': {
        if (!event.text.trim()) return false;
        this.add({ kind: 'system', key: this.nextKey(), at, parent: null, level: event.level, text: event.text, ...(event.detail ? { detail: event.detail } : {}) }, null);
        return true;
      }
      case 'mode': {
        this.add({ kind: 'note', key: this.nextKey(), at, parent: null, note: 'mode', value: event.mode }, null);
        return true;
      }
      case 'model': {
        this.add({ kind: 'note', key: this.nextKey(), at, parent: null, note: 'model', value: event.model }, null);
        return true;
      }
      case 'rate_limit': {
        // Yalnız "sınır doldu" dökümde görünür; aynı sınır için art arda gelen bildirim tek satırda güncellenir.
        if (event.status !== 'rejected') return false;
        const last = this.lastLimit ? this.base.get(this.lastLimit) : undefined;
        if (this.lastLimit && last?.kind === 'limit' && this.roots[this.roots.length - 1] === this.lastLimit) {
          if (last.resetsAt === event.resetsAt && last.limitType === event.limitType) return false;
          this.change(this.lastLimit, () => ({ ...last, resetsAt: event.resetsAt, limitType: event.limitType, at }));
          return true;
        }
        const created: LimitItem = { kind: 'limit', key: this.nextKey(), at, parent: null, resetsAt: event.resetsAt, limitType: event.limitType };
        this.lastLimit = created.key;
        this.add(created, null);
        return true;
      }
      default:
        // init, status, tasks, forgotten: dökümde öğe değil
        return false;
    }
  }
}

// ── Biten işlerin katlanması (v1 `katla.ts`) ──

export interface FoldedGroup {
  kind: 'folded';
  key: string;
  variety: 'subagent' | 'tool';
  items: Array<SubagentItem | ToolItem>;
}
export type VisibleItem = TranscriptItem | FoldedGroup;

const FOLD_MIN = 2;

/**
 * Aynı çeşitten art arda biten araç kartları (ya da alt ajanlar) tek satıra katlanır; süren iş diziyi böler ve kendisi katlanmaz.
 * Görünüm katmanıdır: model değişmez; grup, ilk öğesinin anahtarından türeyen kararlı bir anahtar taşır.
 */
export function foldItems(items: readonly TranscriptItem[]): VisibleItem[] {
  const out: VisibleItem[] = [];
  let run: Array<SubagentItem | ToolItem> = [];
  let variety: FoldedGroup['variety'] | null = null;
  const flush = () => {
    if (run.length >= FOLD_MIN && variety) out.push({ kind: 'folded', key: `fold:${run[0]!.key}`, variety, items: run });
    else out.push(...run);
    run = [];
    variety = null;
  };
  for (const item of items) {
    const current = item.kind === 'subagent' ? 'subagent' : item.kind === 'tool' ? 'tool' : null;
    if (current && (item.kind === 'tool' || item.kind === 'subagent') && item.state !== 'running') {
      if (variety !== current) flush();
      variety = current;
      run.push(item);
      continue;
    }
    flush();
    out.push(item);
  }
  flush();
  return out;
}

/** Katlı satırın sayıları: öğe, adım (alt ajanın içindeki kartlar dahil), süre ve başarısız sayısı. */
export function foldStats(group: FoldedGroup): { count: number; steps: number; durationMs: number; failed: number } {
  const start = Math.min(...group.items.map((item) => item.at));
  const end = Math.max(...group.items.map((item) => item.endedAt ?? item.at));
  const steps = group.items.reduce(
    (total, item) => total + (item.kind === 'subagent' ? item.children.filter((child) => child.kind === 'tool' || child.kind === 'subagent').length : 1),
    0,
  );
  return { count: group.items.length, steps, durationMs: Math.max(0, end - start), failed: group.items.filter((item) => item.state === 'error' || item.state === 'interrupted').length };
}
