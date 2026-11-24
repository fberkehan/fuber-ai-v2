// Claude Code akış ayrıştırıcısı: satırlar 2.1.325'in gerçek çıktısından (kısaltılarak) alındı.
import { describe, expect, it } from 'vitest';
import { classifyFailure, createStreamParser, parseCliLine, type CliEvent } from './stream';

const INIT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  cwd: 'C:\\is',
  tools: ['Edit', 'Glob', 'Grep', 'Read', 'Write'],
  mcp_servers: [],
  model: 'claude-haiku-5-5',
  permissionMode: 'dontAsk',
  slash_commands: [],
  claude_code_version: '2.1.325',
  skills: [],
});
const TOOL_USE = JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'thinking', thinking: '…' }, { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: 'C:\\is\\not.txt', content: 'tamam' } }] },
  parent_tool_use_id: null,
});
const TOOL_RESULT = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'File created successfully' }] },
  parent_tool_use_id: null,
});
const DENIED = JSON.stringify({
  type: 'system',
  subtype: 'permission_denied',
  tool_name: 'Read',
  tool_use_id: 'toolu_2',
  decision_reason: '--restricted: path outside the working directory',
  message: 'C:\\dis\\gizli.txt is outside C:\\is',
});
const RATE = JSON.stringify({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed', resetsAt: 1794999600, rateLimitType: 'seven_day', overageStatus: 'rejected' },
});
const TEXT = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Bitti: şöyle yaptım.' }] }, parent_tool_use_id: null });
const RESULT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Bitti: şöyle yaptım.',
  num_turns: 4,
  total_cost_usd: 0.0022,
  stop_reason: 'end_turn',
  api_error_status: null,
  usage: { input_tokens: 4, cache_creation_input_tokens: 6156, cache_read_input_tokens: 4538, output_tokens: 2001 },
  permission_denials: [{ tool_name: 'Read' }],
});

function collect(chunks: Array<string | Buffer>) {
  const events: CliEvent[] = [];
  const parser = createStreamParser((event) => events.push(event));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return { events, stats: parser.stats() };
}

describe('Claude Code akış ayrıştırıcısı', () => {
  it('gerçek biçimdeki olayları dar kümeye çevirir', () => {
    const { events, stats } = collect([[INIT, '{"type":"system","subtype":"thinking_tokens","estimated_tokens":50}', TOOL_USE, TOOL_RESULT, DENIED, RATE, TEXT, RESULT].join('\n') + '\n']);
    expect(events.map((event) => event.type)).toEqual(['init', 'tool_use', 'tool_result', 'denied', 'rate_limit', 'text', 'result']);
    expect(events[0]).toMatchObject({ type: 'init', model: 'claude-haiku-5-5', tools: ['Edit', 'Glob', 'Grep', 'Read', 'Write'], mcpServers: [], version: '2.1.325', permissionMode: 'dontAsk' });
    expect(events[1]).toMatchObject({ type: 'tool_use', id: 'toolu_1', name: 'Write' });
    expect(events[2]).toMatchObject({ type: 'tool_result', id: 'toolu_1', ok: true });
    expect(events[3]).toMatchObject({ type: 'denied', tool: 'Read', reason: '--restricted: path outside the working directory' });
    expect(events[4]).toMatchObject({ type: 'rate_limit', status: 'allowed', resetsAt: 1794999600, limitType: 'seven_day' });
    expect(events[6]).toMatchObject({ type: 'result', ok: true, text: 'Bitti: şöyle yaptım.', turns: 4, denials: 1, inputTokens: 10698, outputTokens: 2001, stopReason: 'end_turn' });
    expect(stats).toEqual({ lines: 8, garbage: 0 });
  });

  it('satır ortasından ve çok baytlı harfin ortasından bölünen parçaları birleştirir', () => {
    const bytes = Buffer.from(`${TEXT}\n${RESULT}\n`, 'utf8');
    // "ş" iki bayttır: her baytı ayrı parça olarak ver.
    const chunks = [...bytes].map((byte) => Buffer.from([byte]));
    const { events } = collect(chunks);
    expect(events.map((event) => event.type)).toEqual(['text', 'result']);
    expect(events[0]).toMatchObject({ text: 'Bitti: şöyle yaptım.' });
  });

  it('satır sonu gelmeden biten son satırı da işler', () => {
    const { events } = collect([RESULT]);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('result');
  });

  it('JSON olmayan satırı çöp sayar ve sürdürür; tanımadığı olay türünü atlar', () => {
    const { events, stats } = collect([`bu JSON değil\n{"yarım": \n[1,2]\n{"type":"yepyeni_olay","x":1}\n${RESULT}\n`]);
    expect(events.map((event) => event.type)).toEqual(['garbage', 'garbage', 'garbage', 'result']);
    expect(stats.garbage).toBe(3);
  });

  it('alt ajanın iletilerini (parent_tool_use_id dolu) ana konuşmaya katmaz', () => {
    const nested = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'alt ajan' }] }, parent_tool_use_id: 'toolu_9' });
    expect(parseCliLine(nested)).toEqual([]);
  });

  it('başarısız sonucu sınıflandırır: sınır, oturum, adım sınırı, ret, diğer', () => {
    const base = { subtype: 'success', text: '', apiErrorStatus: null, stopReason: null };
    expect(classifyFailure({ ...base, text: "You've hit your limit · resets 3pm" }, null)).toBe('limit');
    expect(classifyFailure({ ...base, text: 'Claude AI usage limit reached|1794999600' }, null)).toBe('limit');
    expect(classifyFailure({ ...base, text: 'bir şey oldu' }, 'rejected')).toBe('limit');
    expect(classifyFailure({ ...base, apiErrorStatus: 429 }, null)).toBe('limit');
    expect(classifyFailure({ ...base, text: 'Not logged in · Please run /login' }, null)).toBe('auth');
    expect(classifyFailure({ ...base, apiErrorStatus: 401 }, null)).toBe('auth');
    expect(classifyFailure({ ...base, subtype: 'error_max_turns' }, null)).toBe('max_turns');
    expect(classifyFailure({ ...base, stopReason: 'refusal' }, null)).toBe('refusal');
    expect(classifyFailure({ ...base, subtype: 'error_during_execution', text: 'beklenmeyen' }, 'allowed')).toBe('error');
  });
});
