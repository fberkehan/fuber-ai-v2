// Web modülünün tek ağ kapısı. Bütün dış istekler buradan geçer (hava, arama, sayfa okuma, kur).
// Güvenlik (KURGU §13): yalnız http/https; yerel ağ, geri döngü ve özel adresler ENGELLİ (SSRF). Ad çözümlemesi
// bağlantının kendisinde denetlenir (DNS yeniden bağlama ile denetimden sonra adres değişemez); yönlendirmeler elle
// izlenir ve her adım yeniden denetlenir. Boyut ve süre sınırı vardır; betik çalıştırılmaz (yanıt yalnız bayttır).
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { PassThrough, type Readable } from 'node:stream';

/** Kullanıcıyı tanıtmayan, genel bir tarayıcı adı (KURGU §13: dışarıya yalnız sorgunun kendisi gider). */
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
/** Açık uçlar (API) için genel istemci adı; kişi, cihaz ya da konum bilgisi taşımaz. */
export const API_UA = 'FuberAI-Desktop/2 (+https://github.com/fberkehan/orion)';

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Bütün istek (yönlendirmeler dahil) için süre sınırı. */
  timeoutMs?: number;
  /** Açılmış gövdenin en çok bayt sayısı; aşılırsa gövde kesilir (`truncated`). */
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface FetchResponse {
  status: number;
  /** Yönlendirmelerden sonraki son adres. */
  url: string;
  contentType: string;
  charset: string | null;
  body: Buffer;
  truncated: boolean;
}

export type Fetcher = (url: string, options?: FetchOptions) => Promise<FetchResponse>;

export type BlockReason = 'scheme' | 'credentials' | 'port' | 'host' | 'private' | 'redirects';

/** Güvenlik kapısının reddettiği istek. Kullanıcıya "bu adrese gidilmez" denir; bulut yedeği de denenmez. */
export class FetchBlockedError extends Error {
  constructor(
    readonly reason: BlockReason,
    readonly target: string,
  ) {
    super(`blocked:${reason}`);
    this.name = 'FetchBlockedError';
  }
}

/** Ağ hatası, zaman aşımı ya da beklenmeyen yanıt. */
export class FetchFailedError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'aborted' | 'status',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchFailedError';
  }
}

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

// IPv4 ve IPv6'da herkese açık olmayan bütün bloklar (IANA özel amaçlı adres kayıtları).
const BLOCKED = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(prefix, bits, 'ipv6');
}

function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  // Sonda IPv4 gösterimi (::ffff:1.2.3.4) iki 16 bitlik gruba çevrilir.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const parts = v4[1]!.split('.').map(Number);
    if (parts.some((part) => part > 255)) return null;
    text = `${text.slice(0, v4.index)}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

/** IPv6 içine gömülü IPv4 (eşlenmiş ::ffff:, NAT64 64:ff9b::, 6to4 2002::, uyumlu ::a.b.c.d). */
function embeddedIpv4(groups: number[]): string | null {
  const v4 = (high: number, low: number) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  const zeros = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0);
  if (zeros(0, 5) && groups[5] === 0xffff) return v4(groups[6]!, groups[7]!);
  if (zeros(0, 6)) return v4(groups[6]!, groups[7]!);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return v4(groups[6]!, groups[7]!);
  if (groups[0] === 0x2002) return v4(groups[1]!, groups[2]!);
  return null;
}

/** Adres herkese açık internette mi? Özel, geri döngü, yerel bağ, çok noktaya yayın ve ayrılmış bloklar `false`. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  if (family !== 6) return false;
  const groups = expandIpv6(address);
  if (!groups) return false;
  const inner = embeddedIpv4(groups);
  if (inner) return isPublicAddress(inner);
  return !BLOCKED.check(address.replace(/%.*$/, ''), 'ipv6');
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa', '.localdomain'];

/**
 * Adresi istek öncesi denetler (ad çözümlemesinden önce yapılabilen her şey). Geçersizse `FetchBlockedError` fırlatır.
 * Tek etiketli adlar (`http://yazici/`) yerel ağ adıdır, reddedilir.
 */
const defaultPortAllowed = (port: string) => ALLOWED_PORTS.has(port);

export function checkUrl(raw: string, isAllowed: (address: string) => boolean = isPublicAddress, isPortAllowed: (port: string) => boolean = defaultPortAllowed): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError('scheme', raw);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlockedError('scheme', raw);
  if (url.username || url.password) throw new FetchBlockedError('credentials', raw);
  if (!isPortAllowed(url.port)) throw new FetchBlockedError('port', raw);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host) throw new FetchBlockedError('host', raw);
  if (net.isIP(host)) {
    if (!isAllowed(host)) throw new FetchBlockedError('private', raw);
    return url;
  }
  if (host === 'localhost' || !host.includes('.') || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new FetchBlockedError('host', raw);
  }
  return url;
}

type LookupAddress = { address: string; family: number };
type LookupFn = (hostname: string, callback: (error: Error | null, addresses: LookupAddress[]) => void) => void;

// IPv4 önce: bazı sunucuların (ölçüldü: tcmb.gov.tr) IPv6 adresi yanıt vermiyor, bağlantı 9 sn bekliyordu.
const systemLookup: LookupFn = (hostname, callback) => dns.lookup(hostname, { all: true, order: 'ipv4first' }, callback);

/**
 * Bağlantının kullandığı ad çözümleyici: çözülen adreslerden BİRİ bile özelse bağlantı kurulmaz. Böylece denetim ile
 * bağlantı arasında adres değişemez (DNS yeniden bağlama).
 */
function guardedLookup(resolve: LookupFn, isAllowed: (address: string) => boolean) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: (...args: unknown[]) => void) => {
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error);
      const wanted = addresses.filter((entry) => !options.family || options.family === entry.family || options.family === `IPv${entry.family}`);
      if (wanted.length === 0) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
      if (wanted.some((entry) => !isAllowed(entry.address))) return callback(new FetchBlockedError('private', hostname));
      if (options.all) return callback(null, wanted);
      return callback(null, wanted[0]!.address, wanted[0]!.family);
    });
  };
}

function decoderFor(encoding: string | undefined, stream: Readable): Readable {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return stream.pipe(zlib.createGunzip());
    case 'deflate': {
      // "deflate" etiketli yanıt zlib başlıklı (RFC 1950) ya da ham (RFC 1951) olabilir: ilk iki bayta bakılır (v1 dersi).
      const out = new PassThrough();
      let inflater: zlib.Inflate | zlib.InflateRaw | null = null;
      stream.on('data', (chunk: Buffer) => {
        if (!inflater) {
          const zlibHeader = chunk.length < 2 || ((chunk[0]! & 0x0f) === 8 && ((chunk[0]! << 8) | chunk[1]!) % 31 === 0);
          inflater = zlibHeader ? zlib.createInflate() : zlib.createInflateRaw();
          inflater.on('error', (error) => out.destroy(error));
          inflater.pipe(out);
        }
        inflater.write(chunk);
      });
      stream.on('end', () => (inflater ? inflater.end() : out.end()));
      stream.on('error', (error) => out.destroy(error));
      return out;
    }
    case 'br':
      return stream.pipe(zlib.createBrotliDecompress());
    default:
      return stream;
  }
}

export function parseContentType(header: string | undefined): { type: string; charset: string | null } {
  const value = header ?? '';
  const type = value.split(';')[0]!.trim().toLowerCase();
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(value)?.[1]?.toLowerCase() ?? null;
  return { type, charset };
}

export interface SafeFetchDeps {
  /** Sınama için: ad çözümleyici. */
  lookup?: LookupFn;
  /** Sınama için: hangi adrese bağlanılabilir (varsayılan `isPublicAddress`). */
  isAllowed?: (address: string) => boolean;
  /** Sınama için: hangi port açık (sınama sunucusu rastgele portta koşar). Varsayılan 80, 443, 8080, 8443. */
  isPortAllowed?: (port: string) => boolean;
}

/** Güvenli `fetch`. Yalnız sınamalar `deps` verir; üretimde hepsi varsayılandır. */
export function createSafeFetch(deps: SafeFetchDeps = {}): Fetcher {
  const isAllowed = deps.isAllowed ?? isPublicAddress;
  const isPortAllowed = deps.isPortAllowed ?? defaultPortAllowed;
  const lookup = guardedLookup(deps.lookup ?? systemLookup, isAllowed);

  return async function safeFetch(raw, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxBytes = options.maxBytes ?? 2_000_000;
    const maxRedirects = options.maxRedirects ?? 5;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new FetchFailedError('timeout', 'zaman aşımı')), timeoutMs);
    const onOuterAbort = () => controller.abort(new FetchFailedError('aborted', 'iptal edildi'));
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });
    if (options.signal?.aborted) onOuterAbort();
    try {
      let current = raw;
      let method = options.method ?? 'GET';
      let body = options.body;
      for (let hop = 0; ; hop++) {
        const url = checkUrl(current, isAllowed, isPortAllowed);
        const result = await requestOnce(url, { method, body, headers: options.headers ?? {}, maxBytes, signal: controller.signal, lookup });
        if (result.redirect) {
          if (hop >= maxRedirects) throw new FetchBlockedError('redirects', current);
          current = new URL(result.redirect, url).toString();
          if (result.status === 303 || ((result.status === 301 || result.status === 302) && method === 'POST')) {
            method = 'GET';
            body = undefined;
          }
          continue;
        }
        return { ...result.response!, url: url.toString() };
      }
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof Error && !(error instanceof FetchBlockedError)) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
  };
}

interface OnceResult {
  status: number;
  redirect?: string;
  response?: Omit<FetchResponse, 'url'>;
}

function requestOnce(
  url: URL,
  options: { method: string; body: string | undefined; headers: Record<string, string>; maxBytes: number; signal: AbortSignal; lookup: ReturnType<typeof guardedLookup> },
): Promise<OnceResult> {
  return new Promise<OnceResult>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      ...options.headers,
    };
    if (options.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(options.body));
    const request = client.request(
      url,
      { method: options.method, headers, lookup: options.lookup as never, signal: options.signal, agent: false },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({ status, redirect: location });
          return;
        }
        const { type, charset } = parseContentType(response.headers['content-type']);
        const stream = decoderFor(response.headers['content-encoding'], response);
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({ status, response: { status, contentType: type, charset, body: Buffer.concat(chunks), truncated } });
        };
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          const room = options.maxBytes - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            size = options.maxBytes;
            truncated = true;
            finish();
            response.destroy();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on('end', finish);
        stream.on('error', (error) => {
          if (truncated || settled) return;
          settled = true;
          reject(new FetchFailedError('network', `yanıt okunamadı: ${error.message}`));
        });
        response.on('error', (error) => {
          if (truncated || settled) return;
          settled = true;
          reject(new FetchFailedError('network', `yanıt okunamadı: ${error.message}`));
        });
      },
    );
    request.on('error', (error) => {
      if (error instanceof FetchBlockedError) return reject(error);
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof FetchBlockedError) return reject(cause);
      if (options.signal.aborted) return reject(options.signal.reason instanceof Error ? options.signal.reason : new FetchFailedError('aborted', 'iptal edildi'));
      reject(new FetchFailedError('network', error.message));
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/** Gövdeyi yazıya çevirir: başlıktaki, yoksa sayfanın `<meta charset>` bildirimindeki kodlamayla. */
export function decodeBody(response: Pick<FetchResponse, 'body' | 'charset' | 'contentType'>): string {
  let charset = response.charset;
  if (!charset && /html|xml/.test(response.contentType)) {
    const head = response.body.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? null;
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(response.body);
  } catch {
    return new TextDecoder('utf-8').decode(response.body);
  }
}

export const safeFetch: Fetcher = createSafeFetch();

/** JSON uçları için kısa yol: 2xx değilse `FetchFailedError('status')`. */
export async function fetchJson<T>(fetcher: Fetcher, url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetcher(url, { ...options, headers: { 'User-Agent': API_UA, Accept: 'application/json', ...options.headers } });
  if (response.status < 200 || response.status >= 300) throw new FetchFailedError('status', `HTTP ${response.status}`, response.status);
  return JSON.parse(decodeBody(response)) as T;
}

/** Metin uçları için kısa yol (HTML, XML). */
export async function fetchText(fetcher: Fetcher, url: string, options: FetchOptions = {}): Promise<{ text: string; response: FetchResponse }> {
  const response = await fetcher(url, options);
  if (response.status < 200 || response.status >= 300) throw new FetchFailedError('status', `HTTP ${response.status}`, response.status);
  return { text: decodeBody(response), response };
}
