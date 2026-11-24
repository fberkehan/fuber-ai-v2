// Uygulama içi MCP sunucusu: kimlik denetimi (belirteç, Origin, Host), protokol ve araç çağrısının işleyiciye gitmesi.
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLog } from '../testkit';
import { createToolMcpServer, type McpSession, type ToolMcpServer } from './mcp-server';

let server: ToolMcpServer;
let session: McpSession;
let calls: Array<{ name: string; input: unknown; toolUseId: string | null }>;

const post = (body: unknown, headers: Record<string, string> = {}, url = session.url) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`, ...headers }, body: JSON.stringify(body) });

/** `fetch` Host başlığını değiştirtmez; DNS yeniden bağlama sınaması için ham istek. */
const rawPost = (headers: Record<string, string>): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = new URL(session.url);
    const request = http.request(
      { host: '127.0.0.1', port: url.port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`, ...headers } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });

beforeEach(async () => {
  server = createToolMcpServer(silentLog);
  await server.start();
  calls = [];
  session = server.open({
    tools: () => [{ name: 'reminder_create', description: 'Hatırlatıcı kurar.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }],
    async call(name, input, meta) {
      calls.push({ name, input, toolUseId: meta.toolUseId });
      if (name === 'patlar') throw new Error('bilerek');
      return { text: `tamam: ${name}`, isError: false };
    },
  });
});
afterEach(() => server.stop());

describe('kimlik denetimi', () => {
  it('yalnız 127.0.0.1 üzerinde dinler ve belirteçsiz isteği reddeder', async () => {
    expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const none = await fetch(session.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(none.status).toBe(401);
    const wrong = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer yanlis-belirtec' });
    expect(wrong.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(server.stats().rejected).toBe(2);
  });

  it('tarayıcı isteğini (Origin) ve yabancı Host başlığını reddeder (DNS yeniden bağlama)', async () => {
    expect(await rawPost({ Origin: 'https://kotu.example' })).toBe(403);
    expect(await rawPost({ Host: 'kotu.example' })).toBe(403);
    expect(await rawPost({})).toBe(200);
    const other = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {}, session.url.replace('/mcp', '/baska'));
    expect(other.status).toBe(404);
  });

  it('oturum kapanınca belirteç geçersizleşir; her oturumun belirteci ayrıdır', async () => {
    const second = server.open({ tools: () => [], call: async () => ({ text: 'ikinci', isError: false }) });
    expect(second.token).not.toBe(session.token);
    expect(second.token.length).toBeGreaterThanOrEqual(40);
    session.close();
    const after = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(after.status).toBe(401);
    const alive = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { Authorization: `Bearer ${second.token}` });
    expect(alive.status).toBe(200);
  });
});

describe('protokol', () => {
  it('el sıkışma, bildirim, araç listesi ve bilinmeyen yöntem', async () => {
    const init = (await (await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } })).json()) as { result: unknown };
    expect(init.result).toMatchObject({ protocolVersion: '2025-11-25', serverInfo: { name: 'fuber' }, capabilities: { tools: {} } });
    const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notified.status).toBe(202);
    const list = (await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()) as { result: { tools: unknown[] } };
    expect(list.result.tools).toEqual([{ name: 'reminder_create', description: 'Hatırlatıcı kurar.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }]);
    const unknown = (await (await post({ jsonrpc: '2.0', id: 'server-discover-probe-1', method: 'server/discover' })).json()) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
    const get = await fetch(session.url, { headers: { Authorization: `Bearer ${session.token}` } });
    expect(get.status).toBe(405);
  });

  it('araç çağrısı işleyiciye gider; işleyici fırlatırsa hata sonucu döner', async () => {
    const ok = (await (
      await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'reminder_create', arguments: { text: 'KDV' }, _meta: { 'claudecode/toolUseId': 'toolu_1' } } })
    ).json()) as { result: unknown };
    expect(ok.result).toEqual({ content: [{ type: 'text', text: 'tamam: reminder_create' }], isError: false });
    expect(calls).toEqual([{ name: 'reminder_create', input: { text: 'KDV' }, toolUseId: 'toolu_1' }]);
    const failed = (await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'patlar', arguments: {} } })).json()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(failed.result.isError).toBe(true);
    expect(failed.result.content[0]!.text).toContain('bilerek');
    expect(session.calls()).toBe(2);
  });

  it('bozuk gövde 400 döner', async () => {
    const bad = await fetch(session.url, { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: '{yarım' });
    expect(bad.status).toBe(400);
  });
});
