/**
 * Fuber XR köprü protokolü, sürüm 1 (`plugins/jarvis-quest/docs/PROTOCOL.md`). SAF: Electron'a ve uygulama
 * servislerine dokunmaz; yalnız Node `crypto`. Sunucu (`server.ts`), saat eklentisinin sınama sunucusu,
 * sahte gözlük istemcisi (birim ve uçtan uca sınamalar) ve test vektörü üreticisi aynı dosyayı kullanır.
 *
 * Tel düzeni:
 *   çerçeve   = u32 büyük-uçlu gövde uzunluğu (1..MAX_FRAME) + gövde
 *   el sıkışma gövdesi = düz UTF-8 JSON (tür baytı YOK)
 *   şifreli gövde      = AES-256-GCM(şifreli metin) || 16 bayt etiket; nonce = 4 bayt sıfır || u64 BE sayaç
 *   düz metin          = 0x01 + UTF-8 JSON nesnesi  |  0x02 + u8 kanal + u32 BE sıra + veri
 */

import crypto from 'node:crypto';

export const XR_PROTOCOL_VERSION = 1;
export const XR_PORT = 47852;
export const XR_DISCOVERY_PORT = 47853;
/** Gövde üst sınırı (uzunluk alanı hariç). Aşan çerçeve bağlantıyı kapatır. */
export const XR_MAX_FRAME = 4 * 1024 * 1024;
export const XR_HKDF_INFO = 'fuber-xr-v1';
export const XR_TAG_BYTES = 16;

export const KIND_JSON = 0x01;
export const KIND_BINARY = 0x02;
export const CH_MIC = 1;
export const CH_TTS = 2;
export const CH_SCREEN = 3;

export class XrProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'XrProtocolError';
    this.code = code;
  }
}

// ───────────────────────────── base64url ─────────────────────────────

export const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** Dolgusuz base64url çözer; geçersiz karakter ya da beklenen uzunluk tutmazsa fırlatır. */
export function fromB64u(text: unknown, expectedBytes?: number): Buffer {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new XrProtocolError('bad_b64', 'geçersiz base64url');
  const out = Buffer.from(text, 'base64url');
  if (expectedBytes !== undefined && out.length !== expectedBytes) {
    throw new XrProtocolError('bad_b64', `beklenen ${expectedBytes} bayt, gelen ${out.length}`);
  }
  // Kanonik biçim: yeniden kodlayınca aynı metin çıkmalı (dolgu/fazladan bit kabul edilmez).
  if (b64u(out) !== text) throw new XrProtocolError('bad_b64', 'kanonik olmayan base64url');
  return out;
}

// ───────────────────────────── X25519 ─────────────────────────────

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

export interface XrKeyPair {
  /** 32 bayt ham özel anahtar. */
  priv: Buffer;
  /** 32 bayt ham açık anahtar. */
  pub: Buffer;
}

function privateKeyObject(priv: Uint8Array): crypto.KeyObject {
  if (priv.length !== 32) throw new XrProtocolError('bad_key', 'X25519 özel anahtarı 32 bayt olmalı');
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, priv]), format: 'der', type: 'pkcs8' });
}

function publicKeyObject(pub: Uint8Array): crypto.KeyObject {
  if (pub.length !== 32) throw new XrProtocolError('bad_key', 'X25519 açık anahtarı 32 bayt olmalı');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, pub]), format: 'der', type: 'spki' });
}

export function publicFromPrivate(priv: Uint8Array): Buffer {
  const der = crypto.createPublicKey(privateKeyObject(priv)).export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32));
}

/** Yeni anahtar çifti; `priv` verilirse ondan türetilir (test vektörü). */
export function keyPair(priv?: Uint8Array): XrKeyPair {
  const raw = priv ? Buffer.from(priv) : crypto.randomBytes(32);
  return { priv: raw, pub: publicFromPrivate(raw) };
}

/** X25519(priv, pub). Sonuç sıfırsa (küçük dereceli nokta) fırlatır: el sıkışma reddedilir. */
export function x25519(priv: Uint8Array, pub: Uint8Array): Buffer {
  let shared: Buffer;
  try {
    shared = crypto.diffieHellman({ privateKey: privateKeyObject(priv), publicKey: publicKeyObject(pub) });
  } catch (error) {
    throw new XrProtocolError('bad_key', `X25519 başarısız: ${(error as Error).message}`);
  }
  if (shared.every((byte) => byte === 0)) throw new XrProtocolError('bad_key', 'X25519 sonucu sıfır');
  return shared;
}

/** `fp = base64url(SHA-256(S_pub_raw32))`, 43 karakter. */
export const fingerprint = (staticPub: Uint8Array): string => b64u(crypto.createHash('sha256').update(staticPub).digest());

/** Ekranda gösterilen kısa parmak izi (ilk 4 karakter, büyük harf DEĞİL; base64url büyük/küçük harfe duyarlıdır). */
export const shortFingerprint = (fp: string): string => fp.slice(0, 4);

// ───────────────────────────── anahtar türetme ─────────────────────────────

export interface SessionKeys {
  th: Buffer;
  okm: Buffer;
  c2s: Buffer;
  s2c: Buffer;
}

/** `th = SHA-256(hello1 || hello2)` (tel baytları); `okm = HKDF-SHA256(dh1||dh2[||dh3], th, "fuber-xr-v1", 64)`. */
export function deriveSessionKeys(input: { dh: Buffer[]; hello1: Uint8Array; hello2: Uint8Array }): SessionKeys {
  const th = crypto.createHash('sha256').update(input.hello1).update(input.hello2).digest();
  const okm = Buffer.from(crypto.hkdfSync('sha256', Buffer.concat(input.dh), th, Buffer.from(XR_HKDF_INFO, 'utf8'), 64));
  return { th, okm, c2s: okm.subarray(0, 32), s2c: okm.subarray(32, 64) };
}

/** Sunucu tarafı türetme: `dh1 = X25519(Se, Ce)`, `dh2 = X25519(S, Ce)`, resume'da `dh3 = X25519(Se, D)`. */
export function serverKeys(input: {
  serverEph: XrKeyPair;
  serverStatic: XrKeyPair;
  clientEphPub: Buffer;
  devicePub: Buffer | null;
  hello1: Uint8Array;
  hello2: Uint8Array;
}): SessionKeys {
  const dh = [x25519(input.serverEph.priv, input.clientEphPub), x25519(input.serverStatic.priv, input.clientEphPub)];
  if (input.devicePub) dh.push(x25519(input.serverEph.priv, input.devicePub));
  return deriveSessionKeys({ dh, hello1: input.hello1, hello2: input.hello2 });
}

/** İstemci (gözlük) tarafı türetme: `dh1 = X25519(Ce, Se)`, `dh2 = X25519(Ce, S)`, resume'da `dh3 = X25519(D, Se)`. */
export function clientKeys(input: {
  clientEph: XrKeyPair;
  serverEphPub: Buffer;
  serverStaticPub: Buffer;
  device: XrKeyPair | null;
  hello1: Uint8Array;
  hello2: Uint8Array;
}): SessionKeys {
  const dh = [x25519(input.clientEph.priv, input.serverEphPub), x25519(input.clientEph.priv, input.serverStaticPub)];
  if (input.device) dh.push(x25519(input.device.priv, input.serverEphPub));
  return deriveSessionKeys({ dh, hello1: input.hello1, hello2: input.hello2 });
}

// ───────────────────────────── AES-256-GCM ─────────────────────────────

export function nonceFor(counter: bigint): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(counter, 4);
  return nonce;
}

/** Tek yönün şifresi: kendi sayacı 0'dan başlar, her çerçevede 1 artar. Şifre çözme hatası fırlatır. */
export class CipherState {
  private counter = 0n;
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new XrProtocolError('bad_key', 'AES-256 anahtarı 32 bayt olmalı');
  }

  get nextCounter(): bigint {
    return this.counter;
  }

  seal(plain: Uint8Array): Buffer {
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonceFor(this.counter), { authTagLength: XR_TAG_BYTES });
    const out = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    this.counter++;
    return out;
  }

  open(sealed: Uint8Array): Buffer {
    if (sealed.length < XR_TAG_BYTES) throw new XrProtocolError('decrypt', 'şifreli çerçeve çok kısa');
    const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonceFor(this.counter), { authTagLength: XR_TAG_BYTES });
    decipher.setAuthTag(buf.subarray(buf.length - XR_TAG_BYTES));
    let out: Buffer;
    try {
      out = Buffer.concat([decipher.update(buf.subarray(0, buf.length - XR_TAG_BYTES)), decipher.final()]);
    } catch {
      throw new XrProtocolError('decrypt', 'şifre çözülemedi (bozuk, yeniden oynatılmış ya da sıra dışı çerçeve)');
    }
    this.counter++;
    return out;
  }
}

// ───────────────────────────── çerçeve ─────────────────────────────

export function encodeFrame(body: Uint8Array): Buffer {
  if (body.length === 0 || body.length > XR_MAX_FRAME) throw new XrProtocolError('frame_size', `geçersiz çerçeve boyu ${body.length}`);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Akıştan çerçeve ayıklar. Boyu 0 ya da `XR_MAX_FRAME`'den büyük çerçeve `frame_size` hatası fırlatır. */
export class FrameDecoder {
  private chunks: Buffer[] = [];
  private buffered = 0;

  push(chunk: Uint8Array): Buffer[] {
    this.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    this.buffered += chunk.byteLength;
    const frames: Buffer[] = [];
    for (;;) {
      if (this.buffered < 4) break;
      const head = this.peek(4);
      const length = head.readUInt32BE(0);
      if (length === 0 || length > XR_MAX_FRAME) throw new XrProtocolError('frame_size', `geçersiz çerçeve boyu ${length}`);
      if (this.buffered < 4 + length) break;
      const all = this.take(4 + length);
      frames.push(all.subarray(4));
    }
    return frames;
  }

  private peek(n: number): Buffer {
    if (this.chunks[0] && this.chunks[0].length >= n) return this.chunks[0].subarray(0, n);
    const joined = Buffer.concat(this.chunks);
    this.chunks = [joined];
    return joined.subarray(0, n);
  }

  private take(n: number): Buffer {
    const joined = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
    const out = Buffer.from(joined.subarray(0, n));
    const rest = joined.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.buffered -= n;
    return out;
  }
}

// ───────────────────────────── düz metin iletileri ─────────────────────────────

export type XrJson = { t: string } & Record<string, unknown>;

export type XrPlain =
  | { kind: 'json'; msg: XrJson }
  | { kind: 'binary'; channel: number; seq: number; data: Buffer };

export function encodeJson(msg: XrJson): Buffer {
  return Buffer.concat([Buffer.from([KIND_JSON]), Buffer.from(JSON.stringify(msg), 'utf8')]);
}

export function encodeBinary(channel: number, seq: number, data: Uint8Array): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt8(KIND_BINARY, 0);
  head.writeUInt8(channel, 1);
  head.writeUInt32BE(seq >>> 0, 2);
  return Buffer.concat([head, data]);
}

export function decodePlain(plain: Buffer): XrPlain {
  if (plain.length < 1) throw new XrProtocolError('bad_message', 'boş ileti');
  const kind = plain[0];
  if (kind === KIND_JSON) {
    let msg: unknown;
    try {
      msg = JSON.parse(plain.subarray(1).toString('utf8'));
    } catch {
      throw new XrProtocolError('bad_message', 'JSON çözülemedi');
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof (msg as XrJson).t !== 'string') {
      throw new XrProtocolError('bad_message', 'ileti nesne değil ya da `t` yok');
    }
    return { kind: 'json', msg: msg as XrJson };
  }
  if (kind === KIND_BINARY) {
    if (plain.length < 6) throw new XrProtocolError('bad_message', 'ikili ileti başlığı eksik');
    return { kind: 'binary', channel: plain.readUInt8(1), seq: plain.readUInt32BE(2), data: plain.subarray(6) };
  }
  throw new XrProtocolError('bad_message', `bilinmeyen ileti türü ${kind}`);
}

/** El sıkışma çerçevesi (düz JSON, tür baytı yok). */
export function parseHandshake(body: Buffer): XrJson {
  let msg: unknown;
  try {
    msg = JSON.parse(body.toString('utf8'));
  } catch {
    throw new XrProtocolError('bad_message', 'el sıkışma JSON değil');
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof (msg as XrJson).t !== 'string') {
    throw new XrProtocolError('bad_message', 'el sıkışma iletisi geçersiz');
  }
  return msg as XrJson;
}

// ───────────────────────────── QR ─────────────────────────────

export interface XrQrInfo {
  hosts: string[];
  port: number;
  fp: string;
  /** 16 bayt sır, base64url (22 karakter). */
  code: string;
  name: string;
}

/** QR'ın taşıyabileceği en uzun içerik (sürüm 10, hata düzeltme M, bayt kipi: 213 bayt). */
export const XR_QR_MAX_BYTES = 213;

/**
 * `fuberxr:1?h=<ip1>,<ip2>&p=47852&f=<fp>&c=<sır>&n=<ad>`. En çok 4 adres; içerik 213 baytı aşarsa önce adres sayısı
 * (en az 1), sonra bilgisayar adı kısaltılır. `n` `encodeURIComponent` ile kodlanır.
 */
export function buildQrUri(info: XrQrInfo): string {
  let hosts = info.hosts.slice(0, 4);
  let name = info.name;
  const make = () =>
    `fuberxr:${XR_PROTOCOL_VERSION}?h=${hosts.join(',')}&p=${info.port}&f=${info.fp}&c=${info.code}&n=${encodeURIComponent(name)}`;
  while (Buffer.byteLength(make(), 'utf8') > XR_QR_MAX_BYTES && hosts.length > 1) hosts = hosts.slice(0, -1);
  while (Buffer.byteLength(make(), 'utf8') > XR_QR_MAX_BYTES && name.length > 0) name = Array.from(name).slice(0, -1).join('');
  return make();
}

export function parseQrUri(uri: string): XrQrInfo {
  const match = /^fuberxr:(\d+)\?(.*)$/.exec(uri.trim());
  if (!match) throw new XrProtocolError('bad_qr', 'fuberxr: içeriği değil');
  if (Number(match[1]) !== XR_PROTOCOL_VERSION) throw new XrProtocolError('bad_version', 'desteklenmeyen QR sürümü');
  const params = new Map<string, string>();
  for (const part of match[2]!.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const hosts = (params.get('h') ?? '').split(',').filter(Boolean);
  const port = Number(params.get('p'));
  const fp = params.get('f') ?? '';
  const code = params.get('c') ?? '';
  if (!hosts.length || !Number.isInteger(port) || port < 1 || port > 65535) throw new XrProtocolError('bad_qr', 'adres ya da kapı eksik');
  fromB64u(fp, 32);
  fromB64u(code, 16);
  return { hosts, port, fp, code, name: decodeURIComponent(params.get('n') ?? '') };
}
