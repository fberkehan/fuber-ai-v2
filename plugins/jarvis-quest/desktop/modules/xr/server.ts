/**
 * Köprü sunucusu (`plugins/jarvis-quest/docs/PROTOCOL.md` §1, §3, §6). Ham TCP 47852, `0.0.0.0` dinler (yalnız modül
 * açıkken). Tek gözlük oturumu; yeni bağlantı eskisini `bye: replaced` ile kapatır. El sıkışma, şifreli oturum,
 * ping/pong 15 sn zaman aşımı, yeniden bağlanma (resume).
 *
 * SAF: Electron'a dokunmaz; yalnız `node:net` + `protocol.ts` + `pairing.ts`. İş mantığı (ses/pano/onay) geri
 * çağrımlarla dışarıdan verilir; sunucu yalnız taşıma ve kimliktir.
 */

import net from 'node:net';
import {
  CipherState,
  FrameDecoder,
  XR_PORT,
  XrProtocolError,
  decodePlain,
  encodeBinary,
  encodeFrame,
  encodeJson,
  keyPair,
  parseHandshake,
  type XrJson,
  type XrKeyPair,
} from './protocol';
import {
  PairingStore,
  type PairingWindow,
  deviceRecordFromPair,
  serverHandshake,
} from './pairing';
import { deviceKindOf, type XrDeviceKind } from './kind';

const PING_TIMEOUT_MS = 15_000;

export interface XrServerHooks {
  pcName: string;
  store: PairingStore;
  /** Açık eşleşme penceresi ya da null. */
  pairingWindow: () => PairingWindow | null;
  features?: string[];
  authority?: 'ask' | 'smart' | 'full';
  onConnect?: (session: XrSession) => void;
  onMessage?: (session: XrSession, msg: XrJson) => void;
  onBinary?: (session: XrSession, channel: number, seq: number, data: Buffer) => void;
  onDisconnect?: (session: XrSession, reason: string) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, extra?: unknown) => void;
}

type Phase = 'hello' | 'first' | 'open' | 'dead';

export class XrSession {
  readonly id: string;
  deviceId: string | null = null;
  /** Cihaz türü (el sıkışma bitince bellidir; o zamana dek varsayılan quest). */
  kind: XrDeviceKind = 'quest';
  private phase: Phase = 'hello';
  private readonly decoder = new FrameDecoder();
  private c2s: CipherState | null = null;
  private s2c: CipherState | null = null;
  private hello1Bytes: Buffer | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly socket: net.Socket,
    private readonly hooks: XrServerHooks,
    private readonly serverEph: { priv: Buffer; pub: Buffer },
    private readonly onEnd: (session: XrSession, reason: string) => void,
    private readonly onOpen: (session: XrSession) => void = (session) => hooks.onConnect?.(session),
  ) {
    this.id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.destroy('socket_error'));
    socket.on('close', () => this.destroy('closed'));
    this.resetPingTimer();
  }

  // ───────── genel API (iş katmanı kullanır) ─────────

  /** Şifreli JSON ileti yollar. */
  send(msg: XrJson): void {
    if (this.phase !== 'open' || !this.s2c) return;
    this.writeEncrypted(encodeJson(msg));
  }

  /** Şifreli ikili çerçeve yollar (ses/ekran). */
  sendBinary(channel: number, seq: number, data: Uint8Array): void {
    if (this.phase !== 'open' || !this.s2c) return;
    this.writeEncrypted(encodeBinary(channel, seq, data));
  }

  /** `bye` yollayıp kapatır. */
  bye(reason: string): void {
    if (this.phase === 'open' && this.s2c) {
      try {
        this.writeEncrypted(encodeJson({ t: 'bye', reason }));
      } catch {
        /* yok say */
      }
    }
    this.destroy(reason);
  }

  get alive(): boolean {
    return this.phase !== 'dead';
  }

  private get dead(): boolean {
    return this.phase === 'dead';
  }

  // ───────── iç akış ─────────

  private writeEncrypted(plain: Buffer): void {
    if (!this.s2c) return;
    this.socket.write(encodeFrame(this.s2c.seal(plain)));
  }

  private writePlain(body: Buffer): void {
    this.socket.write(encodeFrame(body));
  }

  private onData(chunk: Buffer): void {
    if (this.phase === 'dead') return;
    let frames: Buffer[];
    try {
      frames = this.decoder.push(chunk);
    } catch (e) {
      this.hooks.onLog?.('warn', 'çerçeve hatası', (e as Error).message);
      return this.destroy('frame_error');
    }
    for (const frame of frames) {
      if (this.dead) return;
      try {
        this.handleFrame(frame);
      } catch (e) {
        const err = e as XrProtocolError;
        this.hooks.onLog?.('warn', 'çerçeve işlenemedi', err.message);
        return this.destroy(err.code ?? 'error');
      }
    }
  }

  private handleFrame(frame: Buffer): void {
    this.resetPingTimer();
    if (this.phase === 'hello') return this.handleHello(frame);
    if (!this.c2s) return this.destroy('no_cipher');
    const plain = this.c2s.open(frame); // şifre çözme hatası fırlatır → bağlantı kapanır
    const decoded = decodePlain(plain);
    if (this.phase === 'first') return this.handleFirstEncrypted(decoded);
    // open
    if (decoded.kind === 'binary') {
      this.hooks.onBinary?.(this, decoded.channel, decoded.seq, decoded.data);
      return;
    }
    this.handleOpenJson(decoded.msg);
  }

  private handleHello(frame: Buffer): void {
    const hello1 = parseHandshake(frame);
    this.hello1Bytes = frame;
    const result = serverHandshake({
      hello1,
      hello1Bytes: frame,
      serverEph: { priv: this.serverEph.priv, pub: this.serverEph.pub },
      store: this.hooks.store,
      pcName: this.hooks.pcName,
      pairingOpen: this.hooks.pairingWindow() !== null && (this.hooks.pairingWindow()?.isOpen() ?? false),
      deviceConnected: false, // değiştirme XrServer tarafından yapılır (eskiyi kapatır)
    });
    if (!result.ok) {
      this.writePlain(encodeJson({ t: 'reject', code: result.code }));
      return this.destroy(`reject:${result.code}`);
    }
    this.c2s = new CipherState(result.keys.c2s);
    this.s2c = new CipherState(result.keys.s2c);
    this.deviceId = result.device?.deviceId ?? null;
    this._mode = result.mode;
    this.writePlain(result.serverHello.bytes);
    this.phase = 'first';
  }

  private _mode: 'pair' | 'resume' = 'pair';

  private handleFirstEncrypted(decoded: ReturnType<typeof decodePlain>): void {
    if (decoded.kind !== 'json') return this.destroy('bad_first');
    const msg = decoded.msg;
    if (this._mode === 'pair') {
      if (msg.t !== 'pair') return this.destroy('expected_pair');
      const win = this.hooks.pairingWindow();
      if (!win || !win.isOpen()) {
        this.send({ t: 'error', code: 'not_pairing' });
        return this.destroy('not_pairing');
      }
      const ok = typeof msg.code === 'string' ? win.matchCode(msg.code) : typeof msg.pin === 'string' ? win.matchPin(msg.pin) : false;
      if (!ok) {
        this.send({ t: 'error', code: 'bad_code' });
        return this.destroy('bad_code');
      }
      const rec = deviceRecordFromPair(msg, new Date().toISOString());
      // Pencere bir tür için açıldıysa başka tür bağlanamaz (VR sayfasından açılana saat, Saat sayfasından açılana gözlük).
      if (win.forKind && win.forKind !== deviceKindOf(rec.model, rec.kind)) {
        try {
          this.writeEncrypted(encodeJson({ t: 'error', code: 'wrong_kind' })); // `send` yalnız açık oturumda yazar; burada el sıkışma sürüyor
        } catch {
          /* yok say */
        }
        return this.destroy('wrong_kind');
      }
      this.hooks.store.upsert(rec);
      win.close();
      this.deviceId = rec.deviceId;
      this.kind = deviceKindOf(rec.model, rec.kind);
      // `send` yalnız 'open' evresinde yazar; bu yüzden önce evreyi aç, sonra `paired` + `welcome` yolla.
      this.phase = 'open';
      this.send({ t: 'paired', deviceId: rec.deviceId, name: this.hooks.pcName });
    } else {
      if (msg.t !== 'auth') return this.destroy('expected_auth');
      const known = this.deviceId ? this.hooks.store.get(this.deviceId) : undefined;
      this.kind = deviceKindOf(typeof msg.model === 'string' ? msg.model : known?.model, msg.kind ?? known?.kind);
      if (this.deviceId) this.hooks.store.touch(this.deviceId, new Date().toISOString());
      this.phase = 'open';
    }
    this.send({
      t: 'welcome',
      deviceId: this.deviceId,
      pcName: this.hooks.pcName,
      appVersion: '2.0.0',
      features: this.hooks.features ?? ['voice', 'dashboard', 'approvals'],
      authority: this.hooks.authority ?? 'ask',
    });
    this.onOpen(this);
  }

  private handleOpenJson(msg: XrJson): void {
    if (msg.t === 'ping') {
      this.send({ t: 'pong', ts: typeof msg.ts === 'number' ? msg.ts : Date.now() });
      return;
    }
    this.hooks.onMessage?.(this, msg);
  }

  private resetPingTimer(): void {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => this.destroy('ping_timeout'), PING_TIMEOUT_MS);
    this.pingTimer.unref?.();
  }

  destroy(reason: string): void {
    if (this.phase === 'dead') return;
    this.phase = 'dead';
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = null;
    try {
      this.socket.destroy();
    } catch {
      /* yok say */
    }
    this.onEnd(this, reason);
  }
}

export class XrServer {
  private server: net.Server | null = null;
  /** Bağlı oturumlar, türe göre: aynı anda en çok 1 gözlük (quest) + 1 saat (watch). */
  private readonly byKind = new Map<XrDeviceKind, XrSession>();

  constructor(private readonly hooks: XrServerHooks) {}

  /** Dinlemeye başlar. `port` 0 verilirse işletim sistemi serbest kapı seçer (sınama). Çözülen kapı döner. */
  listen(port: number = XR_PORT, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.accept(socket));
      server.on('error', reject);
      server.listen(port, host, () => {
        const addr = server.address();
        this.server = server;
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  }

  private accept(socket: net.Socket): void {
    // Her bağlantıda yeni geçici anahtar (ileri gizlilik).
    const serverEph: XrKeyPair = keyPair();
    // Aynı türden yeni cihaz el sıkışmayı bitirince eskisi `replaced` ile düşer; farklı türler (gözlük + saat) yan yana
    // yaşar. Tür el sıkışmadan önce bilinmediği için "değiştirme" oturum AÇILIRKEN yapılır.
    const session: XrSession = new XrSession(
      socket,
      this.hooks,
      serverEph,
      (s, reason) => {
        if (this.byKind.get(s.kind) === s) this.byKind.delete(s.kind);
        this.hooks.onDisconnect?.(s, reason);
      },
      (s) => {
        const old = this.byKind.get(s.kind);
        if (old && old !== s && old.alive) old.bye('replaced');
        this.byKind.set(s.kind, s);
        this.hooks.onConnect?.(s);
      },
    );
  }

  /** Geriye uyum (eski tek-oturum arayüzü): bağlı gözlük; yoksa bağlı herhangi bir oturum (ör. yalnız saat); hiçbiri yoksa null. */
  get session(): XrSession | null {
    const q = this.byKind.get('quest');
    if (q && q.alive) return q;
    return this.sessions()[0] ?? null;
  }

  /** Belirli türde bağlı oturum; yoksa null. */
  sessionOf(kind: XrDeviceKind): XrSession | null {
    const s = this.byKind.get(kind);
    return s && s.alive ? s : null;
  }

  /** Bağlı bütün oturumlar. */
  sessions(): XrSession[] {
    return [...this.byKind.values()].filter((s) => s.alive);
  }

  close(): void {
    for (const s of [...this.byKind.values()]) s.bye('server_closing');
    this.byKind.clear();
    if (this.server) {
      try {
        this.server.close();
      } catch {
        /* yok say */
      }
      this.server = null;
    }
  }
}
