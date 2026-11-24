/**
 * Eşleşme ve el sıkışma mantığı (`plugins/jarvis-quest/docs/PROTOCOL.md` §2, §3, §5). SAF: Electron'a dokunmaz; yalnız
 * `node:crypto`, `node:fs`, `node:path` ve `protocol.ts`. `server.ts` bunu sürücü olarak kullanır; birim sınaması
 * sahte gözlük istemcisiyle el sıkışmayı uçtan uca koşturur.
 *
 * - `PairingStore`: bilgisayarın kalıcı statik X25519 anahtarı + eşleşmiş cihaz kayıtları (gözlüğün `persistentDataPath`
 *   eşdeğeri bilgisayar tarafı). JSON dosyası, atomik yazım.
 * - `PairingWindow`: 5 dakikalık eşleşme penceresi (QR sırrı + 6 haneli PIN, sabit zamanlı karşılaştırma, PIN deneme
 *   sınırı).
 * - Sunucu el sıkışması: gelen `hello` → `serverKeys` ile oturum anahtarları + kip kararı; ilk şifreli ileti
 *   (`pair`/`auth`) doğrulaması.
 * - İstemci (gözlük) el sıkışması: yalnız test ve geliştirici sunucusu için simülasyon.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  XR_PROTOCOL_VERSION,
  XrProtocolError,
  b64u,
  clientKeys,
  fingerprint,
  fromB64u,
  keyPair,
  serverKeys,
  type SessionKeys,
  type XrJson,
  type XrKeyPair,
} from './protocol';

// ───────────────────────────── kalıcı depo ─────────────────────────────

export interface DeviceRecord {
  deviceId: string;
  /** Cihaz statik açık anahtarı (base64url, 32 bayt). */
  pub: string;
  name: string;
  model: string;
  app: string;
  pairedAt: string;
  lastSeen: string;
  /** Cihaz türü (`pair.kind`); yoksa `model` önekinden çıkarılır (bkz. `kind.ts`). */
  kind?: 'quest' | 'watch';
}

interface StoreData {
  v: 1;
  /** Bilgisayar statik özel anahtarı (hex, 32 bayt). Gerçekte işletim sistemi anahtar kasasıyla şifrelenmeli;
   * burada dosya izinleriyle korunur (demo). */
  staticPriv: string;
  devices: DeviceRecord[];
}

/** `deviceId = base64url(SHA-256(D_pub))[0..22]`. Çarpışmaya karşı yeterince uzun, QR/ekranda kısa. */
export function deviceIdFor(devicePub: Uint8Array): string {
  return b64u(crypto.createHash('sha256').update(devicePub).digest()).slice(0, 22);
}

export class PairingStore {
  private data: StoreData;
  private readonly staticKey: XrKeyPair;

  private constructor(
    private readonly file: string,
    data: StoreData,
  ) {
    this.data = data;
    this.staticKey = keyPair(Buffer.from(data.staticPriv, 'hex'));
  }

  /** Dosyadan yükler; yoksa yeni statik anahtar üretir ve yazar. */
  static open(file: string): PairingStore {
    let data: StoreData | null = null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as StoreData;
      if (raw && raw.v === 1 && typeof raw.staticPriv === 'string' && Buffer.from(raw.staticPriv, 'hex').length === 32) {
        data = { v: 1, staticPriv: raw.staticPriv, devices: Array.isArray(raw.devices) ? raw.devices : [] };
      }
    } catch {
      data = null;
    }
    if (!data) {
      data = { v: 1, staticPriv: crypto.randomBytes(32).toString('hex'), devices: [] };
      const store = new PairingStore(file, data);
      store.flush();
      return store;
    }
    return new PairingStore(file, data);
  }

  /** Bellekte depo (sınama için; diske yazmaz). */
  static ephemeral(staticPriv?: Buffer): PairingStore {
    const data: StoreData = { v: 1, staticPriv: (staticPriv ?? crypto.randomBytes(32)).toString('hex'), devices: [] };
    const store = new PairingStore('', data);
    return store;
  }

  get static(): XrKeyPair {
    return this.staticKey;
  }

  get fingerprint(): string {
    return fingerprint(this.staticKey.pub);
  }

  list(): DeviceRecord[] {
    return this.data.devices.slice();
  }

  get(deviceId: string): DeviceRecord | undefined {
    return this.data.devices.find((d) => d.deviceId === deviceId);
  }

  /** Cihaz statik açık anahtarından kaydı bulur (resume'da deviceId yanında doğrulama için). */
  getByPub(pubB64u: string): DeviceRecord | undefined {
    return this.data.devices.find((d) => d.pub === pubB64u);
  }

  upsert(rec: DeviceRecord): void {
    const i = this.data.devices.findIndex((d) => d.deviceId === rec.deviceId);
    if (i >= 0) this.data.devices[i] = rec;
    else this.data.devices.push(rec);
    this.flush();
  }

  touch(deviceId: string, when: string): void {
    const rec = this.get(deviceId);
    if (rec) {
      rec.lastSeen = when;
      this.flush();
    }
  }

  remove(deviceId: string): boolean {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.deviceId !== deviceId);
    if (this.data.devices.length !== before) {
      this.flush();
      return true;
    }
    return false;
  }

  private flush(): void {
    if (!this.file) return; // ephemeral
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

// ───────────────────────────── eşleşme penceresi ─────────────────────────────

export const PAIRING_WINDOW_MS = 5 * 60 * 1000;
export const PIN_MAX_ATTEMPTS = 5;

/** 6 haneli PIN (sıfır dolgulu, 000000..999999). */
export function generatePin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 16 baytlık QR sırrı (base64url, 22 karakter). */
export function generateCode(): string {
  return b64u(crypto.randomBytes(16));
}

/** Sabit zamanlı dize karşılaştırması (uzunluk sızıntısına karşı SHA-256 üzerinden). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

export class PairingWindow {
  readonly code: string;
  readonly pin: string;
  readonly openedAt: number;
  private pinAttempts = 0;
  private closed = false;
  /** Pencerenin hangi cihaz türü için açıldığı (VR sayfası: quest, Saat sayfası: watch). Verilmezse tür sınırı yok. */
  forKind?: 'quest' | 'watch';

  constructor(now: number = Date.now(), opts?: { code?: string; pin?: string }) {
    this.code = opts?.code ?? generateCode();
    this.pin = opts?.pin ?? generatePin();
    this.openedAt = now;
  }

  isOpen(now: number = Date.now()): boolean {
    return !this.closed && now - this.openedAt < PAIRING_WINDOW_MS;
  }

  close(): void {
    this.closed = true;
  }

  /** QR sırrı eşleşmesi (sabit zamanlı). */
  matchCode(code: string, now: number = Date.now()): boolean {
    if (!this.isOpen(now)) return false;
    return constantTimeEqual(code, this.code);
  }

  /** PIN eşleşmesi: pencere başına en çok `PIN_MAX_ATTEMPTS` deneme, sonra pencere kapanır. */
  matchPin(pin: string, now: number = Date.now()): boolean {
    if (!this.isOpen(now)) return false;
    this.pinAttempts++;
    const ok = constantTimeEqual(pin, this.pin);
    if (!ok && this.pinAttempts >= PIN_MAX_ATTEMPTS) this.close();
    return ok;
  }

  get attemptsLeft(): number {
    return Math.max(0, PIN_MAX_ATTEMPTS - this.pinAttempts);
  }
}

// ───────────────────────────── el sıkışma ─────────────────────────────

export type HandshakeMode = 'pair' | 'resume';

export interface ClientHelloParsed {
  mode: HandshakeMode;
  clientEphPub: Buffer;
  deviceId: string | null;
}

/** Gözlükten gelen ilk `hello`'yu ayrıştırır ve doğrular. */
export function parseClientHello(msg: XrJson): ClientHelloParsed {
  if (msg.t !== 'hello') throw new XrProtocolError('bad_hello', '`hello` bekleniyordu');
  if (msg.v !== XR_PROTOCOL_VERSION) throw new XrProtocolError('bad_version', 'desteklenmeyen sürüm');
  const mode = msg.mode;
  if (mode !== 'pair' && mode !== 'resume') throw new XrProtocolError('bad_hello', 'kip `pair`|`resume` olmalı');
  const clientEphPub = fromB64u(msg.eph, 32);
  let deviceId: string | null = null;
  if (mode === 'resume') {
    if (typeof msg.deviceId !== 'string' || !msg.deviceId) throw new XrProtocolError('bad_hello', 'resume için deviceId gerekli');
    deviceId = msg.deviceId;
  }
  return { mode, clientEphPub, deviceId };
}

export interface ServerHello {
  msg: XrJson;
  bytes: Buffer;
}

/** Bilgisayarın `hello` yanıtı (başarı). `bytes` türetmede kullanılan tel baytlarıdır. */
export function buildServerHello(serverEph: XrKeyPair, serverStatic: XrKeyPair, pcName: string): ServerHello {
  const msg: XrJson = {
    t: 'hello',
    v: XR_PROTOCOL_VERSION,
    eph: b64u(serverEph.pub),
    static: b64u(serverStatic.pub),
    name: pcName,
  };
  return { msg, bytes: Buffer.from(JSON.stringify(msg), 'utf8') };
}

export interface ServerHandshakeOk {
  ok: true;
  mode: HandshakeMode;
  keys: SessionKeys;
  clientEphPub: Buffer;
  /** resume'da çözülen kayıt; pair'de null. */
  device: DeviceRecord | null;
  serverHello: ServerHello;
}

export interface ServerHandshakeReject {
  ok: false;
  code: 'bad_version' | 'unknown_device' | 'not_pairing' | 'busy' | 'bad_hello';
  message: string;
}

export type ServerHandshakeResult = ServerHandshakeOk | ServerHandshakeReject;

/**
 * Sunucu el sıkışması: gelen hello1 → oturum anahtarları. Reddi arayan taraf `reject` çerçevesiyle yollar.
 * `hello1Bytes` türetmede kullanılan TEL baytlarıdır (yeniden serileştirme değil).
 */
export function serverHandshake(input: {
  hello1: XrJson;
  hello1Bytes: Buffer;
  serverEph: XrKeyPair;
  store: PairingStore;
  pcName: string;
  pairingOpen: boolean;
  deviceConnected: boolean;
}): ServerHandshakeResult {
  let parsed: ClientHelloParsed;
  try {
    parsed = parseClientHello(input.hello1);
  } catch (e) {
    const err = e as XrProtocolError;
    return { ok: false, code: err.code === 'bad_version' ? 'bad_version' : 'bad_hello', message: err.message };
  }
  if (input.deviceConnected) return { ok: false, code: 'busy', message: 'başka gözlük bağlı' };

  let device: DeviceRecord | null = null;
  if (parsed.mode === 'pair') {
    if (!input.pairingOpen) return { ok: false, code: 'not_pairing', message: 'eşleşme penceresi kapalı' };
  } else {
    device = input.store.get(parsed.deviceId!) ?? null;
    if (!device) return { ok: false, code: 'unknown_device', message: 'kayıtlı değil' };
  }

  const serverHello = buildServerHello(input.serverEph, input.store.static, input.pcName);
  const keys = serverKeys({
    serverEph: input.serverEph,
    serverStatic: input.store.static,
    clientEphPub: parsed.clientEphPub,
    devicePub: device ? fromB64u(device.pub, 32) : null,
    hello1: input.hello1Bytes,
    hello2: serverHello.bytes,
  });
  return { ok: true, mode: parsed.mode, keys, clientEphPub: parsed.clientEphPub, device, serverHello };
}

/** İlk şifreli iletiden gelen `device` nesnesini kayda çevirir (pair). */
export function deviceRecordFromPair(msg: XrJson, now: string): DeviceRecord {
  const dev = msg.device as Record<string, unknown> | undefined;
  if (!dev || typeof dev.pub !== 'string') throw new XrProtocolError('bad_pair', 'device.pub yok');
  const pubB64u = dev.pub;
  fromB64u(pubB64u, 32); // doğrula
  const devicePub = fromB64u(pubB64u, 32);
  const kind = msg.kind ?? dev.kind;
  return {
    deviceId: deviceIdFor(devicePub),
    pub: pubB64u,
    name: typeof dev.name === 'string' ? dev.name : 'Meta Quest',
    model: typeof dev.model === 'string' ? dev.model : 'Quest',
    app: typeof dev.app === 'string' ? dev.app : '0.0.0',
    pairedAt: now,
    lastSeen: now,
    ...(kind === 'quest' || kind === 'watch' ? { kind } : {}),
  };
}

// ───────────────────────────── istemci (gözlük) tarafı — sınama/geliştirici ─────────────────────────────

/** Gözlüğün ilk `hello`'su. */
export function buildClientHello(clientEph: XrKeyPair, mode: HandshakeMode, deviceId?: string): ServerHello {
  const msg: XrJson =
    mode === 'pair'
      ? { t: 'hello', v: XR_PROTOCOL_VERSION, mode, eph: b64u(clientEph.pub) }
      : { t: 'hello', v: XR_PROTOCOL_VERSION, mode, eph: b64u(clientEph.pub), deviceId: deviceId ?? '' };
  return { msg, bytes: Buffer.from(JSON.stringify(msg), 'utf8') };
}

/** Gözlük: bilgisayarın hello'sunu doğrular (fp) ve oturum anahtarlarını türetir. */
export function clientHandshake(input: {
  clientEph: XrKeyPair;
  hello1Bytes: Buffer;
  serverHello: XrJson;
  serverHelloBytes: Buffer;
  device: XrKeyPair | null;
  expectedFp: string;
}): SessionKeys {
  if (input.serverHello.t !== 'hello') throw new XrProtocolError('bad_hello', 'sunucu hello değil');
  const serverEphPub = fromB64u(input.serverHello.eph, 32);
  const serverStaticPub = fromB64u(input.serverHello.static, 32);
  if (fingerprint(serverStaticPub) !== input.expectedFp) throw new XrProtocolError('bad_fp', 'parmak izi tutmadı (MITM)');
  return clientKeys({
    clientEph: input.clientEph,
    serverEphPub,
    serverStaticPub,
    device: input.device,
    hello1: input.hello1Bytes,
    hello2: input.serverHelloBytes,
  });
}
