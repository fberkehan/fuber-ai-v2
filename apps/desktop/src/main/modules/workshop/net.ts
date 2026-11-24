/**
 * `ctx.fetch`'in ana süreçteki uygulaması: ağ yalnız buradan geçer. Kapılar:
 *  - yalnız `http:` / `https:`, adreste kullanıcı bilgisi yok;
 *  - alan adı manifestteki `net.hosts` listesinde olmalı (manifest yalnız genel alan adı kabul eder; port yok,
 *    adres şemanın varsayılan portunda olmalı);
 *  - geri döngü, özel ağ, bağlantı-yerel, CGNAT, çok noktaya yayın ve benzeri adresler HER DURUMDA reddedilir:
 *    adres yazıyla verilmiş olsa da, alan adı sonradan böyle bir adrese çözülse de (DNS rebinding);
 *  - çözülen adres bağlanmadan ÖNCE denetlenir ve bağlantı o adrese sabitlenir (denetimle bağlantı arasında DNS
 *    değişemez);
 *  - her yönlendirme aynı kapılardan (izin listesi + çözüm + adres denetimi) yeniden geçer; zaman aşımı ve yanıt
 *    boyutu sınırlıdır.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export const FETCH_LIMITS = {
  timeoutMs: 15_000,
  maxTimeoutMs: 18_000,
  maxResponseBytes: 1_000_000,
  maxRequestBytes: 200_000,
  maxRedirects: 3,
} as const;

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
/** Yeteneğin koyamayacağı başlıklar: bağlantıyı ve hedefi belirleyenler ile kimlik taşıyabilecek vekil başlıkları. */
const BLOCKED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'keep-alive',
  'expect',
]);

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface FetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Metin olduğu gibi, nesne JSON olarak gönderilir. */
  body?: unknown;
  /** Adrese eklenecek sorgu parametreleri. */
  query?: Record<string, string | number | boolean>;
  timeoutMs?: number;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  /** Yönlendirmelerden sonraki son adres. */
  url: string;
  headers: Record<string, string>;
  body: string;
  /** Yanıt boyut sınırını aştı; `body` kısaltıldı. */
  truncated: boolean;
}

export type Lookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** Tek bir HTTP alışverişi: kapılardan geçmiş adrese (sabitlenmiş IP) bağlanır. Sınamada sahte taşıyıcı verilir. */
export type Transport = (request: TransportRequest) => Promise<RawResponse>;

export interface TransportRequest {
  url: URL;
  /** Kapıdan geçmiş (genel) adres; bağlantı yalnız buna yapılır. */
  pinned: { address: string; family: number };
  method: string;
  headers: Record<string, string>;
  body: Buffer | null;
  signal: AbortSignal;
}

export interface FetchOptions {
  /** Manifestteki `net.hosts` (küçük harf alan adları). */
  hosts: string[];
  lookup?: Lookup;
  /** Sınamada: gerçek ağ yerine sahte taşıyıcı. */
  transport?: Transport;
  signal?: AbortSignal;
}

const defaultLookup: Lookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

const stripDot = (host: string) => host.toLowerCase().replace(/\.$/, '');

/**
 * Adres izin listesine uyuyor mu: alan adı listede birebir olmalı ve port şemanın varsayılanı (80/443) olmalı.
 * (Eski manifestlerde `ad:port` yazılmışsa yalnız o port; yeni manifest port kabul etmez.)
 */
export function hostAllowed(url: URL, hosts: string[]): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = stripDot(url.hostname);
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  return hosts.some((entry) => {
    const separator = entry.lastIndexOf(':');
    const entryHost = separator === -1 ? entry : entry.slice(0, separator);
    const entryPort = separator === -1 ? defaultPort : Number(entry.slice(separator + 1));
    return stripDot(entryHost) === hostname && entryPort === port;
  });
}

function isPrivateV4(octets: number[]): boolean {
  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0 || // "bu ağ" (0.0.0.0 Windows'ta da yerele gider)
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // bağlantı-yerel (bulut üst veri servisi dahil)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protokol atamaları, belgeleme
    (a === 192 && b === 88 && c === 99) || // 6to4 aktarıcı
    (a === 198 && (b === 18 || b === 19)) || // ölçüm ağı
    (a === 198 && b === 51 && c === 100) || // belgeleme
    (a === 203 && b === 0 && c === 113) || // belgeleme
    a >= 224 // çok noktaya yayın, ayrılmış, yayın
  );
}

/** IPv6 metnini sekiz 16 bitlik gruba açar (gömülü IPv4 ve `::` dahil); geçersizse `null`. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const parts = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

const embeddedV4 = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff];

/**
 * Geri döngü, özel ağ, bağlantı-yerel, CGNAT, çok noktaya yayın, belgeleme ve benzeri dışarıdan ulaşılamayan (ya da
 * yerele dönebilen) adresler. IPv6'da IPv4'ü gömen biçimler (eşlenmiş, uyumlu, NAT64, 6to4) gömülü adrese göre,
 * Teredo her zaman reddedilir. IP olmayan metin de reddedilir.
 */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateV4(address.split('.').map(Number));
  if (family !== 6) return true;
  const g = ipv6Groups(address);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const zeroTo = (n: number) => g.slice(0, n).every((group) => group === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && g7 === 1) return true; // ::1
  if (zeroTo(5) && g5 === 0xffff) return isPrivateV4(embeddedV4(g6, g7)); // ::ffff:a.b.c.d
  if (zeroTo(6)) return true; // ::a.b.c.d (eski "uyumlu" biçim)
  if (g0 === 0x64 && g1 === 0xff9b) return g2 !== 0 || g3 !== 0 || g4 !== 0 || g5 !== 0 || isPrivateV4(embeddedV4(g6, g7)); // NAT64
  if (g0 === 0x2002) return isPrivateV4(embeddedV4(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // belgeleme
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // atma öneki
  if ((g0 & 0xfe00) === 0xfc00) return true; // benzersiz yerel fc00::/7
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true; // bağlantı-yerel, eski site-yerel
  if ((g0 & 0xff00) === 0xff00) return true; // çok noktaya yayın
  return false;
}

function buildUrl(request: FetchRequest): URL {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new FetchError(`Geçersiz adres: ${String(request.url).slice(0, 200)}`);
  }
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function checkUrl(url: URL, hosts: string[]): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError(`Yalnız http ve https adreslerine istek yapılabilir (${url.protocol}).`);
  }
  if (url.username || url.password) throw new FetchError('Adreste kullanıcı adı ya da parola olamaz.');
  if (!hostAllowed(url, hosts)) {
    throw new FetchError(
      `"${url.host}" bu yeteneğin izinli adresleri arasında değil. İzinli: ${hosts.length ? hosts.join(', ') : 'yok'}.`,
    );
  }
}

async function pinAddress(url: URL, lookup: Lookup): Promise<{ address: string; family: number }> {
  const hostname = stripDot(url.hostname).replace(/^\[(.*)\]$/, '$1');
  const literal = net.isIP(hostname);
  if (literal !== 0) {
    // Yazıyla verilmiş IP: yerelse hiçbir koşulda bağlanılmaz (manifest de IP kabul etmez).
    if (isPrivateAddress(hostname)) throw new FetchError(`"${hostname}" yerel ağdaki bir adres; istek yapılmadı.`);
    return { address: hostname, family: literal };
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new FetchError(`"${hostname}" bu bilgisayarın kendisi; istek yapılmadı.`);
  }
  let found: Array<{ address: string; family: number }>;
  try {
    found = await lookup(hostname);
  } catch {
    throw new FetchError(`"${hostname}" adresi çözülemedi (ağ yok ya da alan adı geçersiz).`);
  }
  if (found.length === 0) throw new FetchError(`"${hostname}" adresi çözülemedi.`);
  // Çözülen adreslerden biri bile yerelse istek yapılmaz (DNS ile yerele sıçrama).
  if (found.some((entry) => isPrivateAddress(entry.address))) {
    throw new FetchError(`"${hostname}" yerel ağdaki bir adrese çözülüyor; istek yapılmadı.`);
  }
  return found[0]!;
}

function headersOf(request: FetchRequest, body: Buffer | null, json: boolean): Record<string, string> {
  const headers: Record<string, string> = { accept: '*/*', 'accept-encoding': 'gzip, deflate, br', 'user-agent': 'FuberAI-Skill/2 (+https://github.com/fberkehan/orion)' };
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const key = name.toLowerCase().trim();
    if (!key || BLOCKED_HEADERS.has(key) || key.startsWith('proxy-') || key.startsWith('sec-')) continue;
    if (typeof value !== 'string' || /[\r\n]/.test(value) || /[^\w!#$%&'*+.^`|~-]/.test(key)) continue;
    headers[key] = value;
  }
  if (body) {
    headers['content-length'] = String(body.length);
    if (json && !headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';
  }
  return headers;
}

export interface RawResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

/** Gerçek taşıyıcı: Node `http`/`https`, bağlantı `pinned` adrese sabit. */
export function requestOnce({ url, pinned, method, headers, body, signal }: TransportRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method,
        headers,
        signal,
        agent: false,
        // Bağlantı, kapıdan geçen adrese sabitlenir; sunucu adı (SNI, Host) alan adı olarak kalır.
        lookup: (_hostname, options, callback) => {
          const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
          if (all) (callback as (error: null, list: Array<{ address: string; family: number }>) => void)(null, [pinned]);
          else (callback as (error: null, address: string, family: number) => void)(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
        const stream =
          encoding === 'gzip'
            ? response.pipe(zlib.createGunzip())
            : encoding === 'deflate'
              ? response.pipe(zlib.createInflate())
              : encoding === 'br'
                ? response.pipe(zlib.createBrotliDecompress())
                : response;
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const done = () => {
          const flat: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) flat[name] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: flat,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
          });
        };
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          const room = FETCH_LIMITS.maxResponseBytes - size;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            size += room;
            truncated = true;
            request.destroy();
            done();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on('end', () => {
          if (!truncated) done();
        });
        stream.on('error', (error: Error) => {
          if (!truncated) reject(new FetchError(`Yanıt okunamadı: ${error.message}`));
        });
      },
    );
    request.on('error', (error: Error) => {
      if (signal.aborted) reject(new FetchError('İstek zaman aşımına uğradı ya da iptal edildi.'));
      else reject(new FetchError(`İstek başarısız: ${error.message}`));
    });
    if (body) request.write(body);
    request.end();
  });
}

/** İzin listesi ve sınırlarla tek bir HTTP isteği yapar (yönlendirmeleri izler). Kapıdan geçemeyen istek ağa çıkmaz. */
export async function safeFetch(request: FetchRequest, options: FetchOptions): Promise<FetchResponse> {
  const method = String(request.method ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new FetchError(`Desteklenmeyen yöntem: ${method}.`);
  let url = buildUrl(request);
  checkUrl(url, options.hosts);

  let body: Buffer | null = null;
  let json = false;
  if (request.body !== undefined && request.body !== null && method !== 'GET' && method !== 'HEAD') {
    json = typeof request.body !== 'string';
    body = Buffer.from(json ? JSON.stringify(request.body) : (request.body as string), 'utf8');
    if (body.length > FETCH_LIMITS.maxRequestBytes) throw new FetchError('İstek gövdesi çok büyük.');
  }

  const requested = Number(request.timeoutMs);
  const timeoutMs = Math.min(FETCH_LIMITS.maxTimeoutMs, Number.isFinite(requested) && requested > 0 ? requested : FETCH_LIMITS.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const lookup = options.lookup ?? defaultLookup;
  const transport = options.transport ?? requestOnce;

  try {
    let currentMethod = method;
    let currentBody = body;
    for (let hop = 0; ; hop++) {
      const pinned = await pinAddress(url, lookup);
      const raw = await transport({
        url,
        pinned,
        method: currentMethod,
        headers: headersOf(request, currentBody, json),
        body: currentBody,
        signal: controller.signal,
      });
      const location = raw.headers.location;
      if (raw.status >= 300 && raw.status < 400 && location && raw.status !== 304) {
        if (hop >= FETCH_LIMITS.maxRedirects) throw new FetchError('Çok fazla yönlendirme.');
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new FetchError('Geçersiz yönlendirme adresi.');
        }
        // Yönlendirilen adres de izin listesinde olmalı; aksi halde izinli alan adı bir sıçrama tahtası olurdu.
        // Çözüm ve adres denetimi döngünün başında (`pinAddress`) her adımda yeniden yapılır.
        checkUrl(next, options.hosts);
        if (raw.status === 303 || ((raw.status === 301 || raw.status === 302) && currentMethod === 'POST')) {
          currentMethod = 'GET';
          currentBody = null;
        }
        url = next;
        continue;
      }
      return {
        ok: raw.status >= 200 && raw.status < 300,
        status: raw.status,
        statusText: raw.statusText,
        url: url.toString(),
        headers: raw.headers,
        body: raw.body,
        truncated: raw.truncated,
      };
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
