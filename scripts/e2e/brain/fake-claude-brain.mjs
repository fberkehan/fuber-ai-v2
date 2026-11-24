// Sahte Claude Code CLI: KONUŞAN BEYİN kipi (sınama fikstürü). Gerçek CLI'nin kalıcı, akış girdili başsız sürecini
// taklit eder: `-p --input-format stream-json --output-format stream-json --include-partial-messages --mcp-config …`.
// Biçim 2.1.325'in gerçek akışından alındı (el sıkışma, her turda `system/init`, `stream_event` parçaları, `assistant`,
// `rate_limit_event`, `result`, `control_request: interrupt`). Açılışta gerçek CLI gibi MCP sunucusuna bağlanır
// (`initialize`, `tools/list`) ve araçları YALNIZ oradan çağırır. Ağa çıkmaz, kotadan harcamaz.
//
// Davranışı son kullanıcı iletisindeki yönerge seçer:  [[sahte:<senaryo>|<arg>|<arg>]]
//
//   (yönerge yok)             düz yanıt, parça parça: "Sahte Claude: <sözün başı>"
//   yanki                     bayrakları, ortam değişkeni adlarını, sistem istemini, araç listesini ve bu süreçte
//                             görülen kullanıcı iletilerini JSON olarak döndürür
//   arac|<ad>|<json girdi>    MCP üzerinden aracı çağırır, sonucunu söyler ("Araç sonucu: …")
//   iki-arac|<ad>|<json>|<ad>|<json>  iki aracı sırayla çağırır
//   uzun|<cümle sayısı>|<ms>  cümleleri aralıklı akıtır (araya girme / iptal sınaması)
//   gec|<ms>                  ilk parçadan önce bekler (bekleme sözü sınaması); önce düşünme bloğu açar
//   asili                     hiç yanıt vermez (ilk çıktı süresi sınaması)
//   limit                     abonelik sınırı: rate_limit_event (rejected) + CLI'nin kendi iletisi + hatalı sonuç
//   oturum                    oturum hatası ("Not logged in · Please run /login")
//   cokme                     turun ortasında hata çıktısı yazıp 1 koduyla çıkar
//   cokme-sonra               yanıt verir, sonra (turlar arasında) çöker
//   yerlesik                  `system/init`'te yerleşik bir araç (Bash) gösterir (yalıtım ihlali sınaması)
//
// Ortam (yalnız birim sınamaları verir): SAHTE_CC_ACILIS=cokme → el sıkışmadan önce çıkar · SAHTE_CC_HER_TUR=limit|oturum
// → yönergesiz her tur o senaryoyla yanıtlanır · SAHTE_CC_GECIKME=<ms> → ilk parçadan önceki bekleme.
// Süreç kimliği çalışma klasörünün üstündeki `sahte-pidler.txt` dosyasına eklenir (artık süreç denetimi için).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const VERSION = process.env.FAKE_CLAUDE_VERSION ?? '2.1.325';
const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? '');
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (event) => process.stdout.write(`${JSON.stringify({ session_id: 'sahte-beyin', uuid: `u${Math.random().toString(36).slice(2)}`, ...event })}\n`);

try {
  fs.appendFileSync(path.join(process.cwd(), '..', 'sahte-pidler.txt'), `${process.pid}\n`);
} catch {
  // klasör yazılamıyorsa önemsiz
}
if (process.env.SAHTE_CC_ACILIS === 'cokme') {
  process.stderr.write('Error: sahte CLI açılışta çöktü\n');
  process.exit(1);
}

const model = flag('--model') ?? 'sonnet';
const modelId = `claude-${model}-sahte`;
const systemFile = flag('--system-prompt-file');
const systemText = systemFile && fs.existsSync(systemFile) ? fs.readFileSync(systemFile, 'utf8') : '';

// ── MCP istemcisi (yalnız --mcp-config ile verilen sunucu) ──
const mcpConfig = (() => {
  try {
    const parsed = JSON.parse(flag('--mcp-config') ?? '{}');
    const [name, server] = Object.entries(parsed.mcpServers ?? {})[0] ?? [];
    if (!name || !server) return null;
    const headers = Object.fromEntries(
      Object.entries(server.headers ?? {}).map(([key, value]) => [key, String(value).replace(/\$\{(\w+)\}/g, (_whole, variable) => process.env[variable] ?? '')]),
    );
    return { name, url: server.url, headers };
  } catch {
    return null;
  }
})();
let rpcId = 0;
async function rpc(method, params, notification = false) {
  if (!mcpConfig) throw new Error('mcp yapılandırması yok');
  const response = await fetch(mcpConfig.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...mcpConfig.headers },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++rpcId }), method, ...(params ? { params } : {}) }),
  });
  if (notification) return null;
  if (!response.ok) throw new Error(`mcp HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`mcp: ${body.error.message}`);
  return body.result;
}
let mcpTools = [];
let mcpStatus = mcpConfig ? 'pending' : 'none';
const mcpReady = (async () => {
  if (!mcpConfig) return;
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: VERSION } });
    await rpc('notifications/initialized', undefined, true);
    mcpTools = (await rpc('tools/list')).tools ?? [];
    mcpStatus = 'connected';
  } catch (error) {
    mcpStatus = 'failed';
    process.stderr.write(`mcp bağlanamadı: ${error.message}\n`);
  }
})();
const toolName = (name) => `mcp__${mcpConfig?.name ?? 'fuber'}__${name}`;

// ── tur ──
const seenUser = [];
let turnCount = 0;
let toolCounter = 0;
/** Süren turun iptal bayrağı; `interrupt` gelince kalkar. */
let current = null;

const usage = (extra = {}) => ({ input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 1500 + 200 * turnCount, cache_creation_input_tokens: 100, ...extra });
const init = (tools) =>
  out({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    tools,
    mcp_servers: mcpConfig ? [{ name: mcpConfig.name, status: mcpStatus }] : [],
    model: modelId,
    permissionMode: flag('--permission-mode') ?? 'default',
    slash_commands: [],
    apiKeySource: 'none',
    claude_code_version: VERSION,
    agents: [],
    skills: [],
    plugins: [],
  });
const stream = (event) => out({ type: 'stream_event', event, parent_tool_use_id: null });
const result = (text, turns, extra = {}) =>
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    num_turns: turns,
    total_cost_usd: 0,
    stop_reason: 'end_turn',
    api_error_status: null,
    usage: usage(),
    permission_denials: [],
    ...extra,
  });

/** Metni parça parça akıtır; iptal edilirse `false` döner. */
async function say(turn, text, pieceMs = 5) {
  stream({ type: 'message_start', message: { model: modelId, usage: usage({ output_tokens: 1 }) } });
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  const pieces = text.match(/\S+\s*/g) ?? [text];
  for (const piece of pieces) {
    if (turn.cancelled) return false;
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } });
    if (pieceMs) await sleep(pieceMs);
  }
  if (turn.cancelled) return false;
  out({ type: 'assistant', message: { role: 'assistant', model: modelId, content: [{ type: 'text', text }] }, parent_tool_use_id: null });
  stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: usage() });
  return true;
}

/** MCP üzerinden araç çağrısı + sonucu; dönen: sonuç metni. */
async function callTool(turn, name, input) {
  const id = `toolu_sahte_${++toolCounter}`;
  stream({ type: 'message_start', message: { model: modelId, usage: usage({ output_tokens: 1 }) } });
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: toolName(name), input: {} } });
  out({ type: 'assistant', message: { role: 'assistant', model: modelId, content: [{ type: 'tool_use', id, name: toolName(name), input }] }, parent_tool_use_id: null });
  stream({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: usage() });
  let text;
  let isError = false;
  try {
    const answer = await rpc('tools/call', { name, arguments: input, _meta: { 'claudecode/toolUseId': id } });
    text = (answer.content ?? []).map((block) => block.text ?? '').join('\n');
    isError = answer.isError === true;
  } catch (error) {
    text = `MCP hatası: ${error.message}`;
    isError = true;
  }
  if (turn.cancelled) return { text, isError };
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text }] }] }, parent_tool_use_id: null });
  return { text, isError };
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

async function runTurn(text) {
  const turn = { cancelled: false };
  current = turn;
  turnCount++;
  seenUser.push(text);
  await mcpReady;
  const directive = [...text.matchAll(/\[\[sahte:([^\]]+)\]\]/g)].at(-1);
  const forced = process.env.SAHTE_CC_HER_TUR;
  const [scenario, ...params] = directive ? directive[1].split('|') : forced ? [forced] : ['duz'];
  const tools = mcpTools.map((tool) => toolName(tool.name));
  init(scenario === 'yerlesik' ? [...tools, 'Bash'] : tools);
  const delay = Number(process.env.SAHTE_CC_GECIKME ?? 0);
  if (delay) await sleep(delay);
  const done = (replyText, turns = 1, extra = {}) => {
    if (turn.cancelled) return;
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1795363200, rateLimitType: 'seven_day' } });
    result(replyText, turns, extra);
  };
  // Kullanıcının kendi sözü: bağlam ve önsöz blokları ile yönerge atılır.
  const own = text
    .replace(/<onceki_konusma>[\s\S]*?<\/onceki_konusma>/g, '')
    .replace(/<baglam>[\s\S]*?<\/baglam>/g, '')
    .replace(/\[\[sahte:[^\]]+\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  switch (scenario) {
    case 'yanki': {
      const reply = JSON.stringify({
        args: argv,
        env: Object.keys(process.env).sort(),
        system: systemText,
        systemInsideCwd: systemFile ? path.resolve(systemFile).startsWith(path.resolve(process.cwd()) + path.sep) : null,
        cwd: process.cwd(),
        tools: mcpTools.map((tool) => tool.name),
        mcp: mcpStatus,
        // Yalnız sınama: tur dışında gelen araç çağrısının reddedildiğini doğrulamak için bağlantı bilgisi.
        mcpUrl: mcpConfig?.url ?? null,
        mcpAuth: mcpConfig?.headers.Authorization ?? null,
        turn: turnCount,
        user: seenUser,
        pid: process.pid,
      });
      if (await say(turn, reply, 0)) done(reply);
      break;
    }
    case 'arac': {
      const first = await callTool(turn, params[0] ?? 'yok', parseJson(params[1] ?? '{}'));
      const reply = `Araç sonucu: ${first.text}`;
      if (await say(turn, reply)) done(reply, 2);
      break;
    }
    case 'iki-arac': {
      const first = await callTool(turn, params[0] ?? 'yok', parseJson(params[1] ?? '{}'));
      const second = await callTool(turn, params[2] ?? 'yok', parseJson(params[3] ?? '{}'));
      const reply = `Birinci: ${first.text} İkinci: ${second.text}`;
      if (await say(turn, reply)) done(reply, 3);
      break;
    }
    case 'uzun': {
      const count = Number(params[0] ?? 8);
      const reply = Array.from({ length: count }, (_unused, index) => `Bu ${index + 1}. cümle.`).join(' ');
      if (await say(turn, reply, Number(params[1] ?? 60))) done(reply);
      break;
    }
    case 'gec': {
      stream({ type: 'message_start', message: { model: modelId, usage: usage({ output_tokens: 1 }) } });
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
      await sleep(Number(params[0] ?? 500));
      const reply = 'Geç gelen yanıt.';
      if (await say(turn, reply)) done(reply);
      break;
    }
    case 'asili':
      await new Promise(() => {});
      break;
    case 'limit': {
      out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600, rateLimitType: 'five_hour', overageStatus: 'rejected' } });
      const message = "You've hit your limit · resets 3pm (Europe/Istanbul)";
      out({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: message }] }, parent_tool_use_id: null, error: 'rate_limit' });
      result(message, 1, { is_error: true, api_error_status: 429 });
      break;
    }
    case 'oturum': {
      const message = 'Not logged in · Please run /login';
      out({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: message }] }, parent_tool_use_id: null, error: 'authentication_failed' });
      result(message, 1, { is_error: true });
      break;
    }
    case 'cokme':
      process.stderr.write('Error: sahte CLI bilerek çöktü\n');
      process.exit(1);
      break;
    case 'cokme-sonra': {
      const reply = 'Yanıt verdim, birazdan çökeceğim.';
      if (await say(turn, reply)) done(reply);
      setTimeout(() => process.exit(1), 30);
      break;
    }
    default: {
      const reply = `Sahte Claude: ${own.slice(0, 80)}`;
      if (await say(turn, reply)) done(reply);
    }
  }
  if (current === turn) current = null;
}

// ── girdi: satır başına bir JSON; turlar sırayla yürür ──
let queue = Promise.resolve();
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.type === 'control_request') {
      const subtype = message.request?.subtype;
      if (subtype === 'initialize') {
        void mcpReady.then(() =>
          out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { commands: [], models: [{ value: 'sonnet', displayName: 'Sonnet (sahte)' }], account: null, claude_code_version: VERSION, pid: process.pid } } }),
        );
      } else if (subtype === 'interrupt') {
        const turn = current;
        out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { still_queued: [] } } });
        if (turn) {
          turn.cancelled = true;
          current = null;
          out({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 1, total_cost_usd: 0, stop_reason: null, usage: usage({ output_tokens: 0 }), permission_denials: [] });
        }
      } else {
        out({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: `unsupported: ${subtype}` } });
      }
      continue;
    }
    if (message.type === 'user') {
      const content = Array.isArray(message.message?.content) ? message.message.content : [{ type: 'text', text: String(message.message?.content ?? '') }];
      const text = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
      queue = queue.then(() => runTurn(text)).catch((error) => process.stderr.write(`sahte tur hatası: ${error.message}\n`));
    }
  }
});
process.stdin.on('end', () => {
  // Girdi kapandı: gerçek CLI gibi süren işi bırakıp çıkar.
  setTimeout(() => process.exit(0), 20);
});
