// OpenAI uyumlu akışın (Chat Completions SSE) tek ayrıştırıcısı: yerel sağlayıcı (llama-server) ve bulut sağlayıcıları
// (OpenAI, OpenRouter, Moonshot, özel adres; Fuber geçidinin adlı olayları) aynı kodu kullanır.
import { newId } from '@fuber/shared';
import type { ToolCallRequest } from './types';

/** Bir SSE olayı: `event:` adı (yoksa boş) ve birleşmiş `data:` satırları. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Akış gövdesini SSE olaylarına böler. Boş satır olayı bitirir; `:` ile başlayan satır nabızdır; CRLF çözülür; birden
 * çok `data:` satırı `\n` ile birleşir. Akış sonunda yarım kalan olay da verilir (bazı sunucular son boş satırı yazmaz).
 */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = '';
  let data: string[] = [];
  const take = (line: string): SseEvent | null => {
    if (line === '') {
      if (data.length === 0) {
        event = '';
        return null;
      }
      const out = { event, data: data.join('\n') };
      event = '';
      data = [];
      return out;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    return null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, boundary).replace(/\r$/, '');
        pending = pending.slice(boundary + 1);
        const out = take(line);
        if (out) yield out;
      }
    }
    pending += decoder.decode();
    if (pending) {
      const out = take(pending.replace(/\r$/, ''));
      if (out) yield out;
    }
    const last = take('');
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

/** Küçük modelin sık yaptığı JSON bozukluklarını bir kez onarmayı dener; olmazsa `null`. */
export function repairJson(raw: string): unknown | null {
  const attempt = (text: string) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };
  const direct = attempt(raw);
  if (direct !== undefined) return direct;
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  text = text.replace(/,\s*([}\]])/g, '$1');
  const opens = (text.match(/{/g) ?? []).length - (text.match(/}/g) ?? []).length;
  const quotes = (text.match(/(?<!\\)"/g) ?? []).length;
  if (quotes % 2 === 1) text += '"';
  if (opens > 0) text += '}'.repeat(opens);
  const repaired = attempt(text);
  return repaired === undefined ? null : repaired;
}

/** Araç girdisi (JSON metni) → nesne; çözülemezse ham metin ve neden. */
export function parseToolArguments(raw: string): { input: unknown; error?: string } {
  if (!raw.trim()) return { input: {} };
  const value = repairJson(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { input: raw, error: raw.slice(0, 500) };
  return { input: value };
}

interface ChunkToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface ChunkUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  /** Moonshot'un önbellek sayımı. */
  cached_tokens?: number;
  /** OpenRouter: bu çağrının gerçek maliyeti (USD), `usage: {include: true}` istenince. */
  cost?: number;
}
interface StreamChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: ChunkToolCall[] | null };
    finish_reason?: string | null;
    /** Moonshot akışta kullanımı seçimin içinde verir. */
    usage?: ChunkUsage | null;
  }>;
  usage?: ChunkUsage | null;
  /** OpenRouter akış ortasında hata nesnesi gönderebilir (HTTP 200 açıldıktan sonra). */
  error?: { code?: number | string; message?: string } | null;
}

export interface StreamUsage {
  input: number;
  output: number;
  cachedInput: number;
  /** Sağlayıcının bildirdiği gerçek maliyet; yoksa `null`. */
  costUsd: number | null;
}

/**
 * Chat Completions akış parçalarını biriktirir: görünür metin (`onContent`), araç çağrıları (paralel dahil; parça
 * `index` taşımasa da yeni `id` yeni çağrıdır), bitiş nedeni, kullanım ve akış ortası hata. Düşünme alanları
 * (`reasoning`, `reasoning_content`) kullanıcıya gitmez.
 */
export class ChatCompletionAccumulator {
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();
  private lastIndex = -1;
  finish: string | null = null;
  usage: StreamUsage | null = null;
  model: string | null = null;
  /** Akış içinde gelen hata (HTTP 200 sonrası). */
  error: { code: string; message: string } | null = null;
  /** En az bir anlamlı parça geldi mi (metin, araç ya da bitiş). */
  received = false;

  constructor(private readonly onContent: (piece: string) => void) {}

  push(raw: string): void {
    if (raw === '[DONE]') return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(raw) as StreamChunk;
    } catch {
      // Olaylar arasına boş satır koymayan sunucu: her `data:` satırı ayrı parçadır.
      if (raw.includes('\n')) for (const line of raw.split('\n')) this.push(line.trim());
      return;
    }
    if (chunk.error && typeof chunk.error === 'object') {
      this.error = { code: String(chunk.error.code ?? ''), message: String(chunk.error.message ?? '') };
      return;
    }
    if (typeof chunk.model === 'string' && chunk.model) this.model = chunk.model;
    const choice = chunk.choices?.[0];
    const usage = chunk.usage ?? choice?.usage ?? null;
    if (usage) {
      this.usage = {
        input: usage.prompt_tokens ?? 0,
        output: usage.completion_tokens ?? 0,
        cachedInput: usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0,
        costUsd: typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null,
      };
    }
    if (!choice) return;
    const content = choice.delta?.content;
    if (typeof content === 'string' && content) {
      this.received = true;
      this.onContent(content);
    }
    for (const part of choice.delta?.tool_calls ?? []) this.addToolPart(part);
    if (choice.finish_reason) {
      this.received = true;
      this.finish = choice.finish_reason;
    }
  }

  /** Fuber geçidi gibi araç çağrısını tek parça veren akışlar için. */
  addToolCall(call: { id: string; name: string; arguments: string }): void {
    this.received = true;
    const index = this.calls.size === 0 ? 0 : Math.max(...this.calls.keys()) + 1;
    this.calls.set(index, { id: call.id, name: call.name, args: call.arguments });
  }

  private addToolPart(part: ChunkToolCall): void {
    this.received = true;
    let index = part.index ?? this.lastIndex;
    if (index < 0) index = 0;
    const current = this.calls.get(index);
    // `index` vermeyen sunucu: yeni kimlik yeni çağrıdır (yoksa iki paralel çağrı tek çağrıya karışır).
    if (part.index === undefined && current && part.id && current.id && part.id !== current.id) index = Math.max(...this.calls.keys()) + 1;
    const entry = this.calls.get(index) ?? { id: '', name: '', args: '' };
    if (part.id) entry.id = part.id;
    if (part.function?.name) entry.name += part.function.name;
    if (part.function?.arguments) entry.args += part.function.arguments;
    this.calls.set(index, entry);
    this.lastIndex = index;
  }

  toolCalls(): ToolCallRequest[] {
    return [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call)
      .filter((call) => call.name)
      .map((call) => {
        const parsed = parseToolArguments(call.args);
        return { id: call.id || `call_${newId()}`, name: call.name, input: parsed.input, ...(parsed.error ? { inputError: parsed.error } : {}) };
      });
  }
}
