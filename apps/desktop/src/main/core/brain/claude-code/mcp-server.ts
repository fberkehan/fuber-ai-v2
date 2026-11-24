/**
 * Jarvis'in araçlarını Claude Code'a sunan uygulama içi MCP sunucusu (Streamable HTTP, JSON yanıt).
 *
 * Neden var: konuşan beyin Claude Code olduğunda (`providers/claude-code.ts`) modelin çağırabildiği TEK araç kümesi
 * budur; Claude Code'un kendi araçları (Bash, Edit, Write, Read, WebFetch…) o süreçte kapalıdır. Sunucu aracı kendisi
 * ÇALIŞTIRMAZ: çağrıyı oturumun işleyicisine verir, işleyici de mevcut araç kapısından (`tools.run`: acil durdurma,
 * modül izni, Gizli kip, konuşmacı doğrulama, onay kartı) geçirir. Kapıyı atlayan bir yol yoktur.
 *
 * Güvenlik:
 *  - Yalnız 127.0.0.1'i dinler; port işletim sisteminden rastgele alınır.
 *  - Her Claude Code süreci için ayrı, rastgele 256 bitlik belirteç (oturum). Belirteç sürece ortam değişkeniyle
 *    verilir (komut satırına ve diske yazılmaz); süreç kapanınca oturum silinir, belirteç geçersizleşir.
 *  - `Origin` başlığı taşıyan istek (tarayıcı) ve `Host`'u 127.0.0.1/localhost olmayan istek (DNS yeniden bağlama)
 *    reddedilir. Gövde sınırı vardır.
 *  - Oturumun o an süren bir turu yoksa araç çağrısı reddedilir (işleyici karar verir).
 *
 * Protokol 2.1.325 ile gerçek süreçte doğrulandı: `server/discover` (bilinmeyen yöntem: -32601), `initialize`,
 * `notifications/initialized` (202), `GET` (405: sunucudan istemciye akış yok), `tools/list`, `tools/call`.
 */
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { APP_VERSION, type Logger } from '@fuber/shared';

/** Claude Code'un araçları göreceği sunucu adı: araç adları `mcp__fuber__<ad>` olur. */
export const MCP_SERVER_NAME = 'fuber';
/** Modelin gördüğü araç adının öneki. */
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;
/** Belirtecin sürece verildiği ortam değişkeni (`--mcp-config` içinde `${…}` ile genişler). */
export const MCP_TOKEN_ENV = 'FUBER_MCP_TOKEN';

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

export interface McpSessionHandlers {
  /** O an sunulan araçlar (süreç açılırken bir kez sorulur). */
  tools(): McpToolSpec[];
  /** Araç çağrısı. Fırlatmamalı; fırlatırsa çağrı hata sonucu olarak döner. */
  call(name: string, input: unknown, meta: { toolUseId: string | null }): Promise<McpCallResult>;
}

export interface McpSession {
  readonly token: string;
  readonly url: string;
  /** Oturumu kapatır: belirteç geçersizleşir. */
  close(): void;
  /** Bu oturumda işlenen araç çağrısı sayısı (tanı ve sınama). */
  calls(): number;
}

export interface ToolMcpServer {
  /** Dinlemeye başlar (yinelenebilir). */
  start(): Promise<void>;
  /** Yeni oturum; önce `start()` beklenmiş olmalıdır. */
  open(handlers: McpSessionHandlers): McpSession;
  stop(): Promise<void>;
  port(): number | null;
  stats(): { sessions: number; rejected: number; calls: number };
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const LATEST_PROTOCOL = '2025-06-18';
const KNOWN_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function createToolMcpServer(log: Logger): ToolMcpServer {
  /** Anahtar belirtecin özetidir: arama süresi belirtecin kendisinden bilgi sızdırmaz. */
  const sessions = new Map<string, { handlers: McpSessionHandlers; calls: number }>();
  let server: http.Server | null = null;
  let listening: Promise<void> | null = null;
  let boundPort: number | null = null;
  let rejected = 0;
  let totalCalls = 0;

  const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  const handleRpc = async (session: { handlers: McpSessionHandlers; calls: number }, body: JsonRpcRequest): Promise<unknown | null> => {
    const method = typeof body.method === 'string' ? body.method : '';
    // Bildirim (kimliksiz): yanıt gövdesi yok.
    if (body.id === undefined || body.id === null) return null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: body.id, result });
    switch (method) {
      case 'initialize': {
        const asked = isObject(body.params) && typeof body.params.protocolVersion === 'string' ? body.params.protocolVersion : LATEST_PROTOCOL;
        return ok({
          protocolVersion: KNOWN_PROTOCOLS.has(asked) ? asked : LATEST_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: APP_VERSION },
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list': {
        let tools: McpToolSpec[] = [];
        try {
          tools = session.handlers.tools();
        } catch (error) {
          log.warn('mcp: araç listesi üretilemedi', error);
        }
        return ok({ tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) });
      }
      case 'tools/call': {
        const params = isObject(body.params) ? body.params : {};
        const name = typeof params.name === 'string' ? params.name : '';
        if (!name) return rpcError(body.id, -32602, 'tool name is required');
        const meta = isObject(params._meta) ? params._meta : {};
        const toolUseId = typeof meta['claudecode/toolUseId'] === 'string' ? (meta['claudecode/toolUseId'] as string) : null;
        session.calls++;
        totalCalls++;
        let result: McpCallResult;
        try {
          result = await session.handlers.call(name, params.arguments ?? {}, { toolUseId });
        } catch (error) {
          result = { text: `HATA: ${error instanceof Error ? error.message : String(error)}`, isError: true };
        }
        return ok({ content: [{ type: 'text', text: result.text }], isError: result.isError });
      }
      default:
        return rpcError(body.id, -32601, 'Method not found');
    }
  };

  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const deny = (status: number, headers: Record<string, string> = {}) => {
      rejected++;
      res.writeHead(status, headers).end();
      req.resume();
    };
    // Tarayıcıdan gelen istek her zaman `Origin` taşır; CLI taşımaz.
    if (req.headers.origin !== undefined) return deny(403);
    const host = String(req.headers.host ?? '');
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) return deny(403);
    if ((req.url ?? '').split('?')[0] !== '/mcp') return deny(404);
    const auth = String(req.headers.authorization ?? '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const session = token ? sessions.get(digest(token)) : undefined;
    if (!session) return deny(401, { 'WWW-Authenticate': 'Bearer' });
    // Sunucudan istemciye akış (GET) ve oturum silme (DELETE) yok.
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('error', () => undefined);
    req.on('end', () => {
      if (tooLarge) {
        res.writeHead(413).end();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(rpcError(null, -32700, 'Parse error')));
        return;
      }
      const batch = Array.isArray(parsed);
      const items = (batch ? (parsed as unknown[]) : [parsed]).filter(isObject) as JsonRpcRequest[];
      void Promise.all(items.map((item) => handleRpc(session, item)))
        .then((answers) => {
          const out = answers.filter((answer) => answer !== null);
          if (res.destroyed || res.writableEnded) return;
          if (out.length === 0) {
            res.writeHead(202).end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(batch ? out : out[0]));
        })
        .catch((error: unknown) => {
          log.warn('mcp: istek işlenemedi', error);
          if (!res.destroyed && !res.writableEnded) res.writeHead(500).end();
        });
    });
  };

  return {
    start() {
      listening ??= new Promise<void>((resolve, reject) => {
        const created = http.createServer(onRequest);
        // Araç çağrısı onay beklerken dakikalarca sürebilir: sunucu tarafında istek/başlık zaman aşımı yok.
        created.requestTimeout = 0;
        created.headersTimeout = 0;
        created.keepAliveTimeout = 60_000;
        created.once('error', (error) => {
          listening = null;
          reject(error);
        });
        created.listen(0, '127.0.0.1', () => {
          server = created;
          boundPort = (created.address() as AddressInfo).port;
          created.unref();
          resolve();
        });
      });
      return listening;
    },

    open(handlers) {
      if (boundPort === null) throw new Error('mcp sunucusu başlatılmadı');
      const token = randomBytes(32).toString('base64url');
      const key = digest(token);
      const entry = { handlers, calls: 0 };
      sessions.set(key, entry);
      return {
        token,
        url: `http://127.0.0.1:${boundPort}/mcp`,
        close: () => void sessions.delete(key),
        calls: () => entry.calls,
      };
    },

    async stop() {
      sessions.clear();
      const current = server;
      server = null;
      listening = null;
      boundPort = null;
      if (!current) return;
      await new Promise<void>((resolve) => {
        current.close(() => resolve());
        current.closeAllConnections?.();
      });
    },

    port: () => boundPort,
    stats: () => ({ sessions: sessions.size, rejected, calls: totalCalls }),
  };
}
