// Akış normalleştirici ve olay yardımcıları (saf). v1 `tests/cc-olay.test.ts`, `cc-isler-model.test.ts` ve `cc-kredi.test.ts`
// içindeki normalleştirme senaryolarının v2 karşılığı; ayrıca oturum bayrakları ve süreç ortamı.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSessionArgs, userSessionEnv } from './session-channel';
import {
  checkAnswers,
  CLI_MODEL_RE,
  CLI_SESSION_ID_RE,
  firstSentence,
  INPUT_LIMIT,
  isEffortLevel,
  isPermissionMode,
  OUTPUT_LIMIT,
  showsCost,
  toolKind,
  toolSummary,
  truncateInput,
  type AskQuestion,
  type BackgroundTask,
  type StreamEvent,
} from './session-events';
import { createNormalizeContext, findOutputFile, normalizeSessionMessage, resetBackground } from './session-normalize';

const stream = (event: unknown, parent: string | null = null) => ({ type: 'stream_event', event, parent_tool_use_id: parent, uuid: 'u', session_id: 's' });
const assistant = (id: string, content: unknown[], parent: string | null = null, extra: Record<string, unknown> = {}) => ({
  type: 'assistant',
  message: { id, role: 'assistant', content },
  parent_tool_use_id: parent,
  uuid: 'u',
  session_id: 's',
  ...extra,
});
const user = (content: unknown, parent: string | null = null, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  message: { role: 'user', content },
  parent_tool_use_id: parent,
  uuid: 'k1',
  session_id: 's',
  ...extra,
});
const system = (subtype: string, extra: Record<string, unknown> = {}) => ({ type: 'system', subtype, uuid: 'u', session_id: 's', ...extra });
const counts = (events: StreamEvent[]): number[] => events.filter((event) => event.type === 'background').map((event) => (event as { count: number }).count);
const lastTasks = (events: StreamEvent[]): BackgroundTask[] | null =>
  events.filter((event): event is Extract<StreamEvent, { type: 'tasks' }> => event.type === 'tasks').at(-1)?.tasks ?? null;

describe('normalleştirme: ileti → olay', () => {
  it('system/init → init (kimlik, model, kip, sürüm, araçlar, komutlar, beceriler, MCP sunucuları); eski CLI çökmez', () => {
    const ctx = createNormalizeContext();
    const events = normalizeSessionMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'abc',
        model: 'claude-x',
        permissionMode: 'plan',
        claude_code_version: '2.1.325',
        cwd: 'C:\\p',
        tools: ['Read', 1],
        slash_commands: ['compact'],
        capabilities: ['interrupt_receipt_v1'],
        mcp_servers: [{ name: 'github', status: 'connected' }, 'bozuk'],
        skills: ['graphify'],
        uuid: 'u',
      },
      ctx,
    );
    expect(events).toEqual([
      {
        type: 'init',
        sessionId: 'abc',
        model: 'claude-x',
        mode: 'plan',
        version: '2.1.325',
        cwd: 'C:\\p',
        tools: ['Read'],
        commands: ['compact'],
        capabilities: ['interrupt_receipt_v1'],
        mcpServers: ['github', '?'],
        skills: ['graphify'],
      },
    ]);
    const old = normalizeSessionMessage({ type: 'system', subtype: 'init', session_id: 'x' }, ctx)[0] as Extract<StreamEvent, { type: 'init' }>;
    expect([old.capabilities, old.skills, old.mcpServers, old.commands]).toEqual([[], [], [], []]);
  });

  it('akış: metin parçaları blok kimliğiyle; tam asistan iletisi aynı bloğu "text" olarak kapatır; akışta görülen düşünme yinelenmez', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    const events = [
      ...run(stream({ type: 'message_start', message: { id: 'm1' } })),
      ...run(stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } })),
      ...run(stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } })),
      ...run(stream({ type: 'content_block_stop', index: 0 })),
      ...run(stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })),
      ...run(stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Mer' } })),
      ...run(stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'haba' } })),
      ...run(stream({ type: 'content_block_stop', index: 1 })),
      ...run(stream({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'Read' } })),
      ...run(stream({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"fi' } })),
      ...run(stream({ type: 'message_stop' })),
      // CLI blok başına bir asistan iletisi yayar (aynı message.id).
      ...run(assistant('m1', [{ type: 'thinking', thinking: 'hmm', signature: 'x' }])),
      ...run(assistant('m1', [{ type: 'text', text: 'Merhaba' }])),
      ...run(assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\p\\a.ts' } }])),
    ];
    expect(events).toEqual([
      { type: 'thinking', block: 'm1#d0', phase: 'start', parent: null },
      { type: 'thinking', block: 'm1#d0', phase: 'end', parent: null },
      { type: 'text_delta', block: 'm1#0', text: 'Mer', parent: null },
      { type: 'text_delta', block: 'm1#0', text: 'haba', parent: null },
      { type: 'text', block: 'm1#0', text: 'Merhaba', parent: null },
      { type: 'tool_start', id: 't1', name: 'Read', kind: 'read', input: { file_path: 'C:\\p\\a.ts' }, summary: 'C:\\p\\a.ts', parent: null },
    ]);
  });

  it('akışsız asistan iletisi: metin blokları sırayla numaralanır; düşünme göstergesi; boş metin atlanır', () => {
    const events = normalizeSessionMessage(
      assistant('m2', [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'A' }, { type: 'text', text: '  ' }, { type: 'text', text: 'B' }]),
      createNormalizeContext(),
    );
    expect(events).toEqual([
      { type: 'thinking', block: 'm2#d0', phase: 'end', parent: null },
      { type: 'text', block: 'm2#0', text: 'A', parent: null },
      { type: 'text', block: 'm2#2', text: 'B', parent: null },
    ]);
  });

  it('alt ajan (Task/Agent) iç içe: parent = parent_tool_use_id; alt ajanın akışı ana akışı bozmaz', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    const events = [
      ...run(assistant('m3', [{ type: 'tool_use', id: 'task1', name: 'Agent', input: { description: 'Kodu tara', prompt: 'Her dosyaya bak', subagent_type: 'Explore' } }])),
      ...run(stream({ type: 'message_start', message: { id: 'alt1' } }, 'task1')),
      ...run(stream({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }, 'task1')),
      ...run(stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'iç' } }, 'task1')),
      ...run(assistant('alt1', [{ type: 'tool_use', id: 'r1', name: 'Grep', input: { pattern: 'TODO', path: 'C:\\p\\src' } }], 'task1')),
      ...run(user([{ type: 'tool_result', tool_use_id: 'r1', content: 'yok' }], 'task1')),
      ...run(user([{ type: 'tool_result', tool_use_id: 'task1', content: [{ type: 'text', text: 'Rapor' }, { type: 'image', source: {} }] }])),
    ];
    expect(events).toEqual([
      { type: 'subagent', id: 'task1', description: 'Kodu tara', prompt: 'Her dosyaya bak', parent: null, agentType: 'Explore' },
      { type: 'text_delta', block: 'alt1#0', text: 'iç', parent: 'task1' },
      { type: 'tool_start', id: 'r1', name: 'Grep', kind: 'search', input: { pattern: 'TODO', path: 'C:\\p\\src' }, summary: '“TODO” · src', parent: 'task1' },
      { type: 'tool_end', id: 'r1', error: false, output: 'yok', truncated: false, parent: 'task1' },
      { type: 'tool_end', id: 'task1', error: false, output: 'Rapor\n[görsel]', truncated: false, parent: null },
    ]);
  });

  it('TodoWrite → yapılacaklar; sonucu kart olmaz', () => {
    const ctx = createNormalizeContext();
    const events = [
      ...normalizeSessionMessage(
        assistant('m4', [
          { type: 'tool_use', id: 'td', name: 'TodoWrite', input: { todos: [{ content: 'A', status: 'pending', activeForm: 'A yapılıyor' }, { content: 'B', status: 'in_progress' }, { content: 'C', status: 'completed' }] } },
        ]),
        ctx,
      ),
      ...normalizeSessionMessage(user([{ type: 'tool_result', tool_use_id: 'td', content: 'ok' }]), ctx),
    ];
    expect(events).toEqual([
      {
        type: 'todos',
        id: 'td',
        parent: null,
        items: [{ content: 'A', status: 'pending', activeForm: 'A yapılıyor' }, { content: 'B', status: 'in_progress' }, { content: 'C', status: 'done' }],
      },
    ]);
  });

  it('TaskCreate/TaskUpdate/TaskList → yapılacaklar (kimlik yapısal çıktıdan ya da metindeki #n); kart olmaz', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    const result = (id: string, content: string, structured?: unknown) =>
      user([{ type: 'tool_result', tool_use_id: id, content }], null, structured === undefined ? {} : { tool_use_result: structured });
    const events = [
      ...run(assistant('g1', [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'Testleri yaz', description: 'd', activeForm: 'Testler yazılıyor' } }])),
      ...run(result('c1', 'Task #1 created', { task: { id: '1', subject: 'Testleri yaz' } })),
      ...run(assistant('g2', [{ type: 'tool_use', id: 'c2', name: 'TaskCreate', input: { subject: 'Belge', description: 'd' } }])),
      // Yapısal çıktı yok → metindeki #7.
      ...run(result('c2', 'Task #7 created successfully: Belge')),
      ...run(assistant('g3', [{ type: 'tool_use', id: 'u1', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } }])),
      ...run(result('u1', 'ok', { success: true })),
      ...run(assistant('g4', [{ type: 'tool_use', id: 'u2', name: 'TaskUpdate', input: { taskId: '7', status: 'deleted' } }])),
      ...run(assistant('g5', [{ type: 'tool_use', id: 'g', name: 'TaskGet', input: { taskId: '1' } }])),
      ...run(result('g', 'detay')),
    ];
    expect(events.map((event) => event.type)).toEqual(['todos', 'todos', 'todos', 'todos']);
    expect((events.at(-1) as Extract<StreamEvent, { type: 'todos' }>).items).toEqual([{ content: 'Testleri yaz', status: 'in_progress', taskId: '1', activeForm: 'Testler yazılıyor' }]);
    expect(run(assistant('g6', [{ type: 'tool_use', id: 'l', name: 'TaskList', input: {} }]))).toEqual([]);
    const listed = run(
      result('l', '...', { tasks: [{ id: '1', subject: 'Testleri yaz', status: 'completed', blockedBy: [] }, { id: '3', subject: 'Yeni', status: 'pending', blockedBy: [] }] }),
    ) as Array<Extract<StreamEvent, { type: 'todos' }>>;
    expect(listed[0]!.items.map((item) => [item.taskId, item.status, item.activeForm])).toEqual([
      ['1', 'done', 'Testler yazılıyor'],
      ['3', 'pending', undefined],
    ]);
  });

  it('araç sonucu: hata bayrağı, uzun çıktı kısaltılır; canlı akışta kullanıcı metni yankılanmaz', () => {
    const ctx = createNormalizeContext();
    normalizeSessionMessage(assistant('m5', [{ type: 'tool_use', id: 'bx', name: 'Bash', input: { command: 'npm test\n--watch' } }]), ctx);
    const long = 'x'.repeat(OUTPUT_LIMIT + 50);
    const [ended] = normalizeSessionMessage(user([{ type: 'tool_result', tool_use_id: 'bx', content: long, is_error: true }]), ctx) as Array<Extract<StreamEvent, { type: 'tool_end' }>>;
    expect(ended).toMatchObject({ error: true, truncated: true });
    expect(ended!.output).toHaveLength(OUTPUT_LIMIT);
    // Kullanıcı iletisini oturum yöneticisi gönderirken kendisi yazar; akıştan gelen metin (yeniden oynatma dahil) olay üretmez.
    expect(normalizeSessionMessage(user('[Request interrupted by user]'), ctx)).toEqual([]);
    expect(normalizeSessionMessage(user([{ type: 'text', text: 'merhaba' }, { type: 'image' }], null, { isReplay: true }), ctx)).toEqual([]);
  });

  it('result → sonuç: başarı, hata cümlesi, durdurulma (terminal_reason ya da kullanıcı isteği), belirteçler', () => {
    const ctx = createNormalizeContext();
    const common = { duration_ms: 1200, num_turns: 3, total_cost_usd: 0.0123, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } };
    expect(normalizeSessionMessage({ type: 'result', subtype: 'success', is_error: false, result: 'Bitti.', ...common }, ctx)).toEqual([
      {
        type: 'result',
        ok: true,
        interrupted: false,
        durationMs: 1200,
        turns: 3,
        costUsd: 0.0123,
        showCost: false,
        usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
        text: 'Bitti.',
      },
    ]);
    const failed = normalizeSessionMessage({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['  çok tur  ', ''], ...common }, ctx)[0] as Extract<StreamEvent, { type: 'result' }>;
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/çok tur/);
    expect(failed.error).not.toMatch(/{/);
    expect(failed.errorClass).toBe('generic');
    const api = normalizeSessionMessage({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529', ...common }, ctx)[0] as Extract<StreamEvent, { type: 'result' }>;
    // Ham "API Error: 529" yerine tek cümle + eylem; ham metin sonuçta taşınmaz.
    expect(api.error).toMatch(/çok yoğun/);
    expect(api.errorClass).toBe('overloaded');
    expect(api.text).toBeUndefined();
    const aborted = normalizeSessionMessage(
      { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['aborted'], terminal_reason: 'aborted_tools', ...common },
      ctx,
    )[0] as Extract<StreamEvent, { type: 'result' }>;
    expect(aborted.interrupted).toBe(true);
    expect(aborted.error).toBeUndefined();
    const requested = normalizeSessionMessage({ type: 'result', subtype: 'success', is_error: false, result: '', ...common }, ctx, { interruptRequested: true })[0] as Extract<
      StreamEvent,
      { type: 'result' }
    >;
    expect([requested.interrupted, requested.ok]).toEqual([true, false]);
    // Eksik alanlar sıfır (çökme sonucu).
    expect((normalizeSessionMessage({ type: 'result', subtype: 'error_during_execution', is_error: true }, ctx)[0] as Extract<StreamEvent, { type: 'result' }>).usage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it('system iletileri: status (kip, sıkıştırma), compact_boundary, api_retry, permission_denied, yerel komut çıktısı; bilinmeyenler atlanır', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    expect(run(system('status', { status: 'compacting', permissionMode: 'acceptEdits' }))).toEqual([
      { type: 'mode', mode: 'acceptEdits' },
      { type: 'system', level: 'info', text: 'Bağlam sıkıştırılıyor…' },
    ]);
    expect(run(system('status', { compact_result: 'failed', compact_error: 'bağlam\nçok büyük' }))).toEqual([{ type: 'system', level: 'warn', text: 'Bağlam sıkıştırılamadı.', detail: 'bağlam çok büyük' }]);
    expect(run(system('compact_boundary', { compact_metadata: {} }))).toEqual([{ type: 'system', level: 'info', text: 'Bağlam sıkıştırıldı.' }]);
    expect((run(system('api_retry', { attempt: 2, max_retries: 5 }))[0] as { text: string }).text).toMatch(/2\/5/);
    expect(run(system('permission_denied', { tool_name: 'Bash', decision_reason: 'kural' }))).toEqual([{ type: 'system', level: 'warn', text: 'Bash kendiliğinden reddedildi.', detail: 'kural' }]);
    expect(run(system('local_command_output', { content: 'Toplam: $0.01', uuid: 'lc' }))).toEqual([{ type: 'text', block: 'lc', text: 'Toplam: $0.01', parent: null }]);
    expect(run(system('notification', { text: 'Dikkat', priority: 'high' }))).toEqual([{ type: 'system', level: 'warn', text: 'Dikkat' }]);
    for (const message of [system('hook_started'), { type: 'keep_alive' }, null, 42, 'x', { type: 'assistant' }, { type: 'stream_event', event: { type: 'content_block_delta' } }]) {
      expect(run(message)).toEqual([]);
    }
  });

  it('asistan hatası: ham metin yerine Türkçe tek cümle; yoğunluk uyarı düzeyinde; sonuç satırı cümleyi yinelemez', () => {
    const ctx = createNormalizeContext();
    const auth = normalizeSessionMessage(assistant('m6', [{ type: 'text', text: 'Invalid API key' }], null, { error: 'authentication_failed' }), ctx);
    expect(auth).toHaveLength(1);
    expect(auth[0]).toMatchObject({ type: 'system', level: 'error' });
    expect((auth[0] as { text: string }).text).toMatch(/oturum açın/);
    expect(JSON.stringify(auth)).not.toContain('Invalid API key');
    const result = normalizeSessionMessage({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' }, ctx)[0] as Extract<StreamEvent, { type: 'result' }>;
    expect(result).toMatchObject({ ok: false, errorClass: 'auth', errorShown: true });
    // Bayrak tek turluktur.
    expect((normalizeSessionMessage({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key' }, ctx)[0] as { errorShown?: boolean }).errorShown).toBeUndefined();
    const busy = normalizeSessionMessage(assistant('m7', [{ type: 'text', text: 'Overloaded' }], null, { error: 'overloaded' }), ctx);
    expect(busy[0]).toMatchObject({ type: 'system', level: 'warn' });
    // `error: 'unknown'` yalnız sentetik iletide hata sayılır; gerçek modelin iletisi olduğu gibi geçer.
    const real = normalizeSessionMessage(assistant('m8', [{ type: 'text', text: 'Düz yanıt' }], null, { error: 'unknown' }), ctx);
    expect(real).toEqual([{ type: 'text', block: 'm8#0', text: 'Düz yanıt', parent: null }]);
    const synthetic = normalizeSessionMessage(
      { type: 'assistant', message: { id: 'm9', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Unable to connect to API (ConnectionRefused)' }] }, error: 'unknown', parent_tool_use_id: null },
      ctx,
    );
    expect((synthetic[0] as { text: string }).text).toMatch(/internet/);
  });

  it('kullanım sınırı: rate_limit_event saniyeyi milisaniyeye çevirir; "rejected" iken hatalı sonuç sınır sayılır; sınır geçince sayılmaz', () => {
    const ctx = createNormalizeContext();
    const soon = Math.floor(Date.now() / 1000) + 3600;
    expect(normalizeSessionMessage({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: soon, rateLimitType: 'five_hour' } }, ctx)).toEqual([
      { type: 'rate_limit', status: 'rejected', resetsAt: soon * 1000, limitType: 'five_hour' },
    ]);
    const limited = normalizeSessionMessage({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['request failed'] }, ctx)[0] as Extract<StreamEvent, { type: 'result' }>;
    expect(limited.errorClass).toBe('limit');
    expect(limited.error).toMatch(/kullanım sınırı/);
    // Yeni durum "allowed": aynı hata artık sınır değil.
    expect(normalizeSessionMessage({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, ctx)).toEqual([{ type: 'rate_limit', status: 'allowed', resetsAt: null, limitType: null }]);
    expect((normalizeSessionMessage({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['request failed'] }, ctx)[0] as { errorClass?: string }).errorClass).toBe('generic');
    // Sıfırlanma anı geçmiş bir "rejected" kaydı sonraki ilgisiz hatayı sınıra çevirmez.
    const stale = createNormalizeContext();
    normalizeSessionMessage({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) - 60 } }, stale);
    expect((normalizeSessionMessage({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['request failed'] }, stale)[0] as { errorClass?: string }).errorClass).toBe('generic');
    // HTTP 429 her zaman sınırdır.
    expect((normalizeSessionMessage({ type: 'result', subtype: 'success', is_error: true, result: 'request failed', api_error_status: 429 }, stale)[0] as { errorClass?: string }).errorClass).toBe('limit');
  });
});

describe('arka plan işleri', () => {
  it('görev başlayınca sayı artar, bitince düşer; ön plan ve ortam görevleri sayılmaz', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    expect(counts(run(system('task_started', { task_id: 'a', description: 'ajan', is_backgrounded: true })))).toEqual([1]);
    expect(counts(run(system('task_started', { task_id: 'b', description: 'kabuk', is_backgrounded: true })))).toEqual([2]);
    // Aynı görevin ikinci bildirimi hiçbir şeyi değiştirmez → olay yok.
    expect(run(system('task_started', { task_id: 'b', description: 'kabuk', is_backgrounded: true }))).toEqual([]);
    expect(counts(run(system('task_notification', { task_id: 'a', status: 'completed', output_file: '', summary: '' })))).toEqual([1]);
    expect(counts(run(system('task_updated', { task_id: 'b', patch: { status: 'killed' } })))).toEqual([0]);
    expect(counts(run(system('task_started', { task_id: 'c', description: 'x', is_backgrounded: false })))).toEqual([]);
    expect(run(system('task_started', { task_id: 'd', description: 'x', is_backgrounded: true, ambient: true }))).toEqual([]);
    expect(run(system('task_started', { task_id: 'e', description: 'x', is_backgrounded: true, skip_transcript: true }))).toEqual([]);
  });

  it('background_tasks_changed seviye sinyalidir: kümeyi DEĞİŞTİRİR (kaçan kenar sayıyı takılı bırakmaz)', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    const task = (id: string, extra: object = {}) => ({ task_id: id, task_type: 'local_agent', description: id, ...extra });
    expect(counts(run(system('background_tasks_changed', { tasks: [task('a'), task('b'), task('iz', { ambient: true })] })))).toEqual([2]);
    expect(counts(run(system('background_tasks_changed', { tasks: [task('b')] })))).toEqual([1]);
    expect(counts(run(system('background_tasks_changed', { tasks: [] })))).toEqual([0]);
    expect(run(system('background_tasks_changed', { tasks: [] }))).toEqual([]);
    expect(run(system('background_tasks_changed', { tasks: 'x' }))).toEqual([]);
  });

  it('süreç bitince küme sıfırlanır; süren işler "durduruldu" olur, liste kalır', () => {
    const ctx = createNormalizeContext();
    normalizeSessionMessage(system('task_started', { task_id: 'a', description: 'x', is_backgrounded: true, task_type: 'local_agent' }), ctx);
    const reset = resetBackground(ctx);
    expect(counts(reset)).toEqual([0]);
    expect(lastTasks(reset)).toMatchObject([{ id: 'a', status: 'stopped', summary: 'Claude Code kapandı; iş onunla durdu.' }]);
    expect(resetBackground(ctx)).toEqual([]);
  });

  it('ön plan kabuk işi: task_started → tool_progress süresi → arka plana alınınca çıktı dosyası → durduruldu', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    run(assistant('m1', [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm run dev' } }]));
    let list = lastTasks(run(system('task_started', { task_id: 'b1', tool_use_id: 'tu1', description: 'npm run dev', task_type: 'local_bash', is_backgrounded: false })));
    expect(list).toHaveLength(1);
    expect({ ...list![0], startedAt: 0 }).toEqual({ id: 'b1', description: 'npm run dev', kind: 'shell', status: 'running', backgrounded: false, toolUseId: 'tu1', startedAt: 0 });
    // Ön plandaki iş arka plan sayısına girmez.
    expect(ctx.background.size).toBe(0);
    list = lastTasks(run({ type: 'tool_progress', tool_use_id: 'tu1', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 7.4 }));
    expect(list![0]!.elapsedSec).toBe(7);
    // Aynı saniye yeniden yayınlanmaz.
    expect(run({ type: 'tool_progress', tool_use_id: 'tu1', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 7.9 })).toEqual([]);
    run(system('task_updated', { task_id: 'b1', patch: { is_backgrounded: true } }));
    expect(ctx.background.size).toBe(1);
    list = lastTasks(run(user([{ type: 'tool_result', tool_use_id: 'tu1', content: 'Command running in background with ID: b1. Output is being written to: C:\\Temp\\claude\\tasks\\b1.output' }])));
    expect(list![0]).toMatchObject({ outputFile: 'C:\\Temp\\claude\\tasks\\b1.output', backgrounded: true });
    list = lastTasks(run(system('task_notification', { task_id: 'b1', status: 'stopped', output_file: 'C:\\Temp\\claude\\tasks\\b1.output', summary: 'durduruldu' })));
    expect(list![0]!.status).toBe('stopped');
    expect(ctx.background.size).toBe(0);
  });

  it('arka planda başlayan alt ajan: task_progress son araç ve özet; ortam işi listeye girmez; çıktı dosyası task_started’dan önce gelebilir', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    expect(lastTasks(run(system('task_started', { task_id: 'w', description: 'izleyici', ambient: true })))).toBeNull();
    let list = lastTasks(run(system('task_started', { task_id: 'a1', description: 'Testleri incele', task_type: 'local_agent', is_backgrounded: true })));
    expect(list![0]!.kind).toBe('agent');
    list = lastTasks(
      run(system('task_progress', { task_id: 'a1', description: 'Testleri incele', usage: { total_tokens: 10, tool_uses: 2, duration_ms: 12_500 }, last_tool_name: 'Grep', summary: 'test klasörünü tarıyor' })),
    );
    expect(list![0]).toMatchObject({ lastTool: 'Grep', summary: 'test klasörünü tarıyor', elapsedSec: 12 });
    run(assistant('m2', [{ type: 'tool_use', id: 'tu9', name: 'Bash', input: { command: 'npm run watch', run_in_background: true } }]));
    run(user([{ type: 'tool_result', tool_use_id: 'tu9', content: 'Command running in background with ID: b9. Output is being written to: /tmp/x/b9.output' }]));
    list = lastTasks(run(system('task_started', { task_id: 'b9', tool_use_id: 'tu9', description: 'npm run watch', task_type: 'local_bash', is_backgrounded: true })));
    expect(list!.find((task) => task.id === 'b9')!.outputFile).toBe('/tmp/x/b9.output');
    const after = lastTasks(resetBackground(ctx))!;
    expect(after).toHaveLength(2);
    expect(after.every((task) => task.status === 'stopped')).toBe(true);
  });

  it('seviye sinyali task_started kaçsa da satırı kurar; biten işler en çok 8 tutulur', () => {
    const ctx = createNormalizeContext();
    const run = (message: unknown) => normalizeSessionMessage(message, ctx);
    const list = lastTasks(run(system('background_tasks_changed', { tasks: [{ task_id: 'x1', task_type: 'local_bash', description: 'vite' }] })));
    expect(list![0]).toMatchObject({ description: 'vite', backgrounded: true, kind: 'shell' });
    for (let index = 0; index < 12; index++) {
      run(system('task_started', { task_id: `t${index}`, description: `iş ${index}`, task_type: 'local_agent', is_backgrounded: true }));
      run(system('task_notification', { task_id: `t${index}`, status: 'completed', output_file: '', summary: 'bitti' }));
    }
    const last = lastTasks(run(system('task_notification', { task_id: 'x1', status: 'completed', output_file: '', summary: 'bitti' })))!;
    expect(last.filter((task) => task.status !== 'running').length).toBeLessThanOrEqual(8);
  });

  it('çıktı dosyası yalnız Claude Code’un kendi arka plan cümlesinden; ağ yolu ve metin içindeki benzer satır kabul edilmez', () => {
    expect(findOutputFile('Command running in background with ID: abc. Output is being written to: C:\\a b\\c.output\n')).toBe('C:\\a b\\c.output');
    expect(findOutputFile('merhaba')).toBeUndefined();
    expect(findOutputFile('dosyanın içeriği:\nOutput is being written to: C:\\x\\y.output')).toBeUndefined();
    expect(findOutputFile('Command running in background with ID: b1. Output is being written to: \\\\saldirgan\\pay\\x.output')).toBeUndefined();
    expect(findOutputFile('Command running in background with ID: b1. Output is being written to: //saldirgan/pay/x.output')).toBeUndefined();
  });
});

describe('maliyet gösterimi', () => {
  it('apiKeySource init’ten gelir; yalnız API anahtarı kaynaklarında dolar gösterilir, bilinmiyorsa gösterilmez', () => {
    const init = (extra: object) => ({ type: 'system', subtype: 'init', session_id: 'x', ...extra });
    const result = (ctx: ReturnType<typeof createNormalizeContext>) =>
      normalizeSessionMessage({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 5.5, duration_ms: 1, num_turns: 1 }, ctx)[0] as Extract<StreamEvent, { type: 'result' }>;
    const subscription = createNormalizeContext();
    expect((normalizeSessionMessage(init({ apiKeySource: 'none' }), subscription)[0] as { apiKeySource?: string }).apiKeySource).toBe('none');
    expect(['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key'].map(showsCost)).toEqual([true, true, true]);
    expect(['none', 'oauth', 'user', undefined, '', 5].map(showsCost)).toEqual([false, false, false, false, false, false]);
    expect(result(subscription).showCost).toBe(false);
    const key = createNormalizeContext();
    normalizeSessionMessage(init({ apiKeySource: 'ANTHROPIC_API_KEY' }), key);
    expect(result(key).showCost).toBe(true);
    // init görülmedi → bilinmiyor → gösterilmez; tutar yine de korunur (göstermek arayüzün kararı).
    expect(result(createNormalizeContext()).showCost).toBe(false);
    expect(result(key).costUsd).toBe(5.5);
  });
});

describe('olay yardımcıları', () => {
  it('araç türleri ve tek satırlık özetler (MCP dahil); uzun girdi kısaltılır', () => {
    const names = ['Read', 'Edit', 'MultiEdit', 'Write', 'Bash', 'PowerShell', 'Grep', 'Glob', 'Task', 'Agent', 'TodoWrite', 'TaskCreate', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'ExitPlanMode', 'mcp__github__create_issue', 'Yeni'];
    expect(names.map(toolKind)).toEqual(['read', 'edit', 'edit', 'edit', 'shell', 'shell', 'search', 'search', 'subagent', 'subagent', 'todos', 'todos', 'web', 'web', 'question', 'plan', 'mcp', 'other']);
    expect(toolSummary('Bash', { command: 'git   status\n && ls' })).toBe('git status && ls');
    expect(toolSummary('WebSearch', { query: 'electron 45' })).toBe('“electron 45”');
    expect(toolSummary('mcp__github__create_issue', { title: 'x' })).toBe('github · create issue');
    expect(toolSummary('Yeni', { a: 1, b: 'ilk metin' })).toBe('ilk metin');
    expect(toolSummary('Write', { file_path: 'C:\\p\\Şirket İşleri\\a.md', content: 'x' })).toBe('C:\\p\\Şirket İşleri\\a.md');
    expect(toolSummary('AskUserQuestion', { questions: [{ question: 'Hangi  renk?' }] })).toBe('Hangi renk?');
    const { input, truncated } = truncateInput({ a: [{ b: 'z'.repeat(30) }] }, 10);
    expect(truncated).toBe(true);
    expect((input.a as Array<{ b: string }>)[0]!.b).toHaveLength(10);
    const write = truncateInput({ file_path: 'x', content: 'y'.repeat(INPUT_LIMIT + 10) });
    expect([write.truncated, (write.input.content as string).length]).toEqual([true, INPUT_LIMIT]);
    expect(truncateInput('nesne değil')).toEqual({ input: {}, truncated: false });
  });

  it('soru yanıtları: her soru yanıtlı, fazla anahtar yok, seçenekler geçerli (çoklu seçim virgülle), "Diğer" serbest metni', () => {
    const questions: AskQuestion[] = [
      { question: 'Dil?', options: [{ label: 'TS' }, { label: 'Py' }], multiSelect: false },
      { question: 'Özellik?', options: [{ label: 'Test' }, { label: 'CI' }, { label: 'Belge' }], multiSelect: true },
    ];
    expect(checkAnswers(questions, { 'Dil?': 'TS', 'Özellik?': ['Test', 'CI'] })).toEqual({ ok: true, answers: { 'Dil?': 'TS', 'Özellik?': 'Test, CI' } });
    expect(checkAnswers(questions, { 'Dil?': 'Py', 'Özellik?': 'Belge, Test' })).toEqual({ ok: true, answers: { 'Dil?': 'Py', 'Özellik?': 'Belge, Test' } });
    expect(checkAnswers(questions, { 'Dil?': 'TS' })).toEqual({ ok: false, problem: 'missing', subject: 'Özellik?' });
    expect(checkAnswers(questions, { 'Dil?': 'TS', 'Özellik?': 'CI', 'Başka?': 'x' })).toMatchObject({ ok: false, problem: 'extra', subject: 'Başka?' });
    expect(checkAnswers(questions, { 'Dil?': 'Rust', 'Özellik?': 'CI' })).toEqual({ ok: false, problem: 'unknown', subject: 'Rust' });
    expect(checkAnswers(questions, { 'Dil?': ['TS', 'Py'], 'Özellik?': 'CI' })).toMatchObject({ ok: false, problem: 'single' });
    expect(checkAnswers(questions, { 'Dil?': 'TS', 'Özellik?': [] })).toMatchObject({ ok: false, problem: 'empty' });
    expect(checkAnswers(questions, null).ok).toBe(false);
    expect(checkAnswers(questions, { 'Dil?': '  Rust  ', 'Özellik?': 'CI' }, ['Dil?'])).toEqual({ ok: true, answers: { 'Dil?': 'Rust', 'Özellik?': 'CI' } });
    expect(checkAnswers(questions, { 'Dil?': ' ', 'Özellik?': 'CI' }, ['Dil?']).ok).toBe(false);
  });

  it('kimlik, model, kip ve efor biçimleri: yol kaçışı, boşluk ve bayrak gibi değerler geçmez', () => {
    for (const id of ['aaaa1111-0000-4000-8000-000000000001', 'abc_DEF-123']) expect(CLI_SESSION_ID_RE.test(id), id).toBe(true);
    for (const id of ['../../etc', 'abc', 'a b c d e f', 'x'.repeat(81), '']) expect(CLI_SESSION_ID_RE.test(id), id).toBe(false);
    for (const model of ['claude-sonnet-5-5', 'opus', 'us.anthropic.claude-x@2026', 'claude-opus-4-8[1m]']) expect(CLI_MODEL_RE.test(model), model).toBe(true);
    for (const model of ['--dangerously-skip-permissions', '-x', 'a b', 'x;rm', '']) expect(CLI_MODEL_RE.test(model), model).toBe(false);
    expect(['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto', 'dontAsk', 1].map(isPermissionMode)).toEqual([true, true, true, true, false, false, false]);
    expect(['low', 'max', 'xhigh', 'dev', '--x', 5].map(isEffortLevel)).toEqual([true, true, true, false, false, false]);
  });

  it('ilk cümle: Markdown ve kod blokları atılır', () => {
    expect(firstSentence('**Tamam.** İki dosyayı düzelttim. Testler geçti.')).toBe('Tamam.');
    expect(firstSentence('```ts\nkod\n```\nYaptım! Sonra')).toBe('Yaptım!');
    expect(firstSentence('nokta yok')).toBe('nokta yok');
    expect(firstSentence('')).toBe('');
    expect(firstSentence('x'.repeat(400))).toHaveLength(200);
  });
});

describe('bağımlılık yönü', () => {
  it('oturum katmanı Electron’a, modüllere, beyne ve sınama sınırına bağlı değildir (yalnız paylaşılan sözleşme ve kendi klasörü)', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = fs.readdirSync(dir).filter((name) => /^session-.*\.ts$/.test(name) && !name.endsWith('.test.ts'));
    expect(files).toEqual(expect.arrayContaining(['session-channel.ts', 'session-errors.ts', 'session-events.ts', 'session-normalize.ts']));
    for (const name of files) {
      const source = fs.readFileSync(path.join(dir, name), 'utf8');
      const imports = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]!);
      for (const target of imports) expect(/^(node:[\w/]+|@fuber\/shared|\.\/[\w-]+)$/.test(target), `${name}: ${target}`).toBe(true);
      expect(source, name).not.toMatch(/process\.env\.(FUBER2_|ANTHROPIC_API_KEY)/);
    }
    // Sayfanın `import type` ile aldığı dosyada Node'a özgü hiçbir şey yok.
    expect(fs.readFileSync(path.join(dir, 'session-events.ts'), 'utf8')).not.toMatch(/from\s+['"]node:/);
  });
});

describe('oturum bayrakları ve süreç ortamı', () => {
  it('bayrak sırası SDK’nınkiyle aynı; sistem istemi ve -p yok; ayar kaynakları her zaman açıkça verilir', () => {
    expect(buildSessionArgs({ mode: 'default', allowBypass: false, folderSettings: true })).toEqual([
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--permission-prompt-tool=stdio',
      '--setting-sources',
      'user,project,local',
      '--permission-mode',
      'default',
      '--include-partial-messages',
    ]);
    const full = buildSessionArgs({ mode: 'bypassPermissions', resume: 'abc-123456', fork: true, model: 'sonnet', effort: 'high', allowBypass: true, folderSettings: false, strictMcp: true });
    expect(full).toEqual([
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--effort',
      'high',
      '--model',
      'sonnet',
      '--permission-prompt-tool=stdio',
      '--resume',
      'abc-123456',
      '--setting-sources',
      'user',
      '--strict-mcp-config',
      '--permission-mode',
      'bypassPermissions',
      '--allow-dangerously-skip-permissions',
      '--include-partial-messages',
      '--fork-session',
    ]);
    // Güvenilen klasörde `.mcp.json` kısıtı uygulanmaz; sürdürme yokken çatallama bayrağı verilmez.
    const trusted = buildSessionArgs({ mode: 'plan', fork: true, allowBypass: false, folderSettings: true, strictMcp: true });
    expect(trusted).not.toContain('--strict-mcp-config');
    expect(trusted).not.toContain('--fork-session');
    for (const args of [full, trusted]) {
      expect(args).not.toContain('-p');
      expect(args.some((arg) => arg.includes('system-prompt'))).toBe(false);
    }
  });

  it('ortam: sınama sınırı, Electron kipi, iç içe oturum işaretleri ve API anahtarı sürece geçmez; kullanıcının ortamı geçer', () => {
    const env = userSessionEnv(
      { EK: '1' },
      {
        PATH: 'C:\\bin',
        GITHUB_TOKEN: 'kullanıcının-belirteci',
        FUBER2_TEST: '1',
        fuber2_data: 'x',
        ELECTRON_RUN_AS_NODE: '1',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_SSE_PORT: '1234',
        ANTHROPIC_API_KEY: 'gizli',
        NODE_OPTIONS: '--inspect',
        CLAUDE_CONFIG_DIR: 'C:\\ayar',
        BOS: undefined,
      },
    );
    expect(env).toEqual({ PATH: 'C:\\bin', GITHUB_TOKEN: 'kullanıcının-belirteci', CLAUDE_CONFIG_DIR: 'C:\\ayar', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', EK: '1' });
    // Komutun kendi ortamı (sınama fikstürü) en son uygulanır.
    expect(userSessionEnv({ ELECTRON_RUN_AS_NODE: '1' }, { ELECTRON_RUN_AS_NODE: '0' }).ELECTRON_RUN_AS_NODE).toBe('1');
  });
});
