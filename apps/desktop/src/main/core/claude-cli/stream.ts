/**
 * Claude Code'un `--output-format stream-json` çıktısının ayrıştırıcısı. Çıktı satır başına bir JSON nesnesidir;
 * buradan çıkan olaylar sağlayıcıdan bağımsız, dar bir kümedir. Tanınmayan olay türleri sessizce atlanır (CLI yeni
 * olay ekleyebilir); JSON olmayan satır `garbage` sayılır ve işi durdurmaz.
 *
 * Biçim 2.1.325 ile gerçek çağrıda gözlendi: `system/init`, `system/thinking_tokens`, `assistant`, `user`,
 * `system/permission_denied`, `rate_limit_event`, `system/api_retry`, `result`.
 */
import { StringDecoder } from 'node:string_decoder';

export type CliEvent =
  | { type: 'init'; model: string | null; tools: string[]; mcpServers: string[]; skills: string[]; version: string | null; permissionMode: string | null }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; ok: boolean; text: string }
  | { type: 'denied'; tool: string; reason: string }
  | { type: 'rate_limit'; status: string; resetsAt: number | null; limitType: string | null }
  | { type: 'retry'; attempt: number; error: string; status: number | null }
  | CliResultEvent
  | { type: 'garbage'; line: string };

export interface CliResultEvent {
  type: 'result';
  /** `subtype: 'success'` ve `is_error` değil. */
  ok: boolean;
  /** `success`, `error_max_turns`, `error_during_execution`… */
  subtype: string;
  text: string;
  turns: number;
  costUsd: number | null;
  apiErrorStatus: number | null;
  /** Modelin son durma nedeni (`end_turn`, `refusal`…). */
  stopReason: string | null;
  denials: number;
  inputTokens: number;
  outputTokens: number;
}

/** Tek satır bu boyutu aşarsa atılır (bozuk ya da kötü niyetli çıktı belleği doldurmasın). */
const MAX_LINE_BYTES = 16 * 1024 * 1024;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** Araç sonucu içeriği dizgi ya da `[{ type: 'text', text }]` dizisidir. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (isObject(block) && block.type === 'text' ? (str(block.text) ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

/** Bir JSON satırını olaylara çevirir. Ana konuşma dışındaki (alt ajan) iletiler atlanır. */
export function parseCliLine(line: string): CliEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return [{ type: 'garbage', line: line.slice(0, 200) }];
  }
  if (!isObject(data) || typeof data.type !== 'string') return [{ type: 'garbage', line: line.slice(0, 200) }];

  switch (data.type) {
    case 'system': {
      if (data.subtype === 'init') {
        return [
          {
            type: 'init',
            model: str(data.model),
            tools: strings(data.tools),
            mcpServers: (Array.isArray(data.mcp_servers) ? data.mcp_servers : []).map((server) => (isObject(server) ? (str(server.name) ?? '?') : '?')),
            skills: strings(data.skills),
            version: str(data.claude_code_version),
            permissionMode: str(data.permissionMode),
          },
        ];
      }
      if (data.subtype === 'permission_denied') {
        return [{ type: 'denied', tool: str(data.tool_name) ?? '?', reason: str(data.decision_reason) ?? str(data.message) ?? '' }];
      }
      if (data.subtype === 'api_retry') {
        return [{ type: 'retry', attempt: num(data.attempt) ?? 0, error: str(data.error) ?? 'unknown', status: num(data.error_status) }];
      }
      return [];
    }
    case 'rate_limit_event': {
      const info = isObject(data.rate_limit_info) ? data.rate_limit_info : {};
      return [{ type: 'rate_limit', status: str(info.status) ?? 'unknown', resetsAt: num(info.resetsAt), limitType: str(info.rateLimitType) }];
    }
    case 'assistant': {
      if (data.parent_tool_use_id) return [];
      const message = isObject(data.message) ? data.message : {};
      const events: CliEvent[] = [];
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!isObject(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text) events.push({ type: 'text', text: block.text });
        else if (block.type === 'tool_use' && typeof block.name === 'string') {
          events.push({ type: 'tool_use', id: str(block.id) ?? '', name: block.name, input: isObject(block.input) ? block.input : {} });
        }
      }
      return events;
    }
    case 'user': {
      if (data.parent_tool_use_id) return [];
      const message = isObject(data.message) ? data.message : {};
      const events: CliEvent[] = [];
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (isObject(block) && block.type === 'tool_result') {
          events.push({ type: 'tool_result', id: str(block.tool_use_id) ?? '', ok: block.is_error !== true, text: contentText(block.content).slice(0, 2000) });
        }
      }
      return events;
    }
    case 'result': {
      const usage = isObject(data.usage) ? data.usage : {};
      const subtype = str(data.subtype) ?? 'unknown';
      return [
        {
          type: 'result',
          ok: subtype === 'success' && data.is_error !== true,
          subtype,
          text: str(data.result) ?? '',
          turns: num(data.num_turns) ?? 0,
          costUsd: num(data.total_cost_usd),
          apiErrorStatus: num(data.api_error_status),
          stopReason: str(data.stop_reason),
          denials: Array.isArray(data.permission_denials) ? data.permission_denials.length : 0,
          inputTokens: (num(usage.input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0),
          outputTokens: num(usage.output_tokens) ?? 0,
        },
      ];
    }
    default:
      return [];
  }
}

export interface StreamParser {
  push(chunk: Buffer | string): void;
  /** Akış bitti: satır sonu gelmemiş son parça da işlenir. */
  end(): void;
  stats(): { lines: number; garbage: number };
}

/** Parça parça gelen çıktıyı satırlara böler (çok baytlı harf iki parçaya bölünse de bozulmaz) ve olay üretir. */
export function createStreamParser(onEvent: (event: CliEvent) => void): StreamParser {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let lines = 0;
  let garbage = 0;
  let overflow = false;

  const handle = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    lines++;
    for (const event of parseCliLine(line)) {
      if (event.type === 'garbage') garbage++;
      onEvent(event);
    }
  };

  const feed = (text: string) => {
    buffer += text;
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (overflow) {
        // Sınırı aşan satırın kuyruğu: atılır, bir sonraki satırdan devam edilir.
        overflow = false;
        continue;
      }
      handle(line);
    }
    if (buffer.length > MAX_LINE_BYTES) {
      buffer = '';
      if (!overflow) {
        overflow = true;
        lines++;
        garbage++;
        onEvent({ type: 'garbage', line: '(çok uzun satır atıldı)' });
      }
    }
  };

  return {
    push(chunk) {
      feed(typeof chunk === 'string' ? chunk : decoder.write(chunk));
    },
    end() {
      feed(decoder.end());
      if (buffer && !overflow) handle(buffer);
      buffer = '';
    },
    stats: () => ({ lines, garbage }),
  };
}

export type CliFailure = 'limit' | 'auth' | 'max_turns' | 'refusal' | 'error';

/**
 * Başarısız `result` olayını sınıflandırır. Abonelik sınırı iletisinin tam metni gerçek çağrıyla gözlenemedi
 * (sınırı bilerek doldurmak gerekir); bilinen iki biçim ve `rate_limit_event`'in `rejected` durumu tanınır.
 */
export function classifyFailure(
  result: Pick<CliResultEvent, 'subtype' | 'text' | 'apiErrorStatus' | 'stopReason'>,
  lastRateLimitStatus: string | null,
): CliFailure {
  const text = result.text.toLowerCase();
  if (result.subtype === 'error_max_turns') return 'max_turns';
  if (result.apiErrorStatus === 401 || result.apiErrorStatus === 403 || /not logged in|please run \/login|invalid api key|authentication|oauth token|unauthorized/.test(text)) {
    return 'auth';
  }
  if (
    result.apiErrorStatus === 429 ||
    lastRateLimitStatus === 'rejected' ||
    /usage limit|hit your limit|limit reached|rate limit|out of extra usage|credit balance is too low/.test(text)
  ) {
    return 'limit';
  }
  if (result.stopReason === 'refusal') return 'refusal';
  return 'error';
}
