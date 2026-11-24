import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CipherState,
  FrameDecoder,
  decodePlain,
  encodeFrame,
  encodeJson,
  keyPair,
  parseHandshake,
  type XrJson,
  type XrKeyPair,
} from './protocol';
import { PairingStore, buildClientHello, clientHandshake } from './pairing';
import { XrBridge } from './bridge';

// Gerçek soket açılır (loopback) ama LAN'a UDP keşif yayını YAPILMAZ.
vi.mock('./discovery', async (orig) => {
  const mod = await orig<typeof import('./discovery')>();
  return { ...mod, DiscoveryBroadcaster: class { start(): void {} stop(): void {} } };
});

/** Sahte gözlük: gerçek TCP soketiyle el sıkışma + şifreli kanal (sınama). */
class FakeHeadset {
  private sock!: net.Socket;
  private readonly decoder = new FrameDecoder();
  private pending: Buffer[] = [];
  private waiters: Array<(f: Buffer | null) => void> = [];
  private sendCipher: CipherState | null = null;
  private recvCipher: CipherState | null = null;

  async connect(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.sock = net.createConnection({ port, host: '127.0.0.1' }, resolve);
      this.sock.on('error', reject);
      this.sock.on('data', (chunk) => {
        for (const f of this.decoder.push(chunk)) {
          const w = this.waiters.shift();
          if (w) w(f);
          else this.pending.push(f);
        }
      });
      this.sock.on('close', () => {
        this.closed = true;
        for (const w of this.waiters.splice(0)) w(null);
      });
    });
  }

  private closed = false;

  private nextFrame(): Promise<Buffer | null> {
    const f = this.pending.shift();
    if (f) return Promise.resolve(f);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private writeFrame(body: Buffer): void {
    this.sock.write(encodeFrame(body));
  }

  /** pair kipinde tam el sıkışma; döner welcome iletisi. */
  async pair(expectedFp: string, device: XrKeyPair, code: string, opts: { model?: string; kind?: string } = {}): Promise<{ paired: XrJson; welcome: XrJson }> {
    const clientEph = keyPair();
    const hello1 = buildClientHello(clientEph, 'pair');
    this.writeFrame(hello1.bytes);
    const serverHelloFrame = await this.nextFrame();
    if (!serverHelloFrame) throw new Error('bağlantı kapandı (hello öncesi)');
    const serverHello = parseHandshake(serverHelloFrame);
    if (serverHello.t === 'reject') throw new Error(`reject: ${String(serverHello.code)}`);
    const keys = clientHandshake({
      clientEph,
      hello1Bytes: hello1.bytes,
      serverHello,
      serverHelloBytes: serverHelloFrame,
      device: null,
      expectedFp,
    });
    this.sendCipher = new CipherState(keys.c2s);
    this.recvCipher = new CipherState(keys.s2c);
    // ilk şifreli: pair
    this.sendEncrypted(
      encodeJson({ t: 'pair', code, ...(opts.kind ? { kind: opts.kind } : {}), device: { name: opts.model ?? 'Meta Quest 3', pub: device.pub.toString('base64url'), model: opts.model ?? 'Quest 3', app: '0.1.0' } }),
    );
    const paired = await this.recvJson();
    if (paired.t === 'error') throw new Error(`eşleşme hatası: ${String(paired.code)}`);
    const welcome = await this.recvJson();
    return { paired, welcome };
  }

  sendEncrypted(plain: Buffer): void {
    if (!this.sendCipher) throw new Error('şifre yok');
    this.writeFrame(this.sendCipher.seal(plain));
  }

  async recvJson(): Promise<XrJson> {
    const frame = await this.nextFrame();
    if (!frame) throw new Error('bağlantı kapandı');
    if (!this.recvCipher) throw new Error('şifre yok');
    const decoded = decodePlain(this.recvCipher.open(frame));
    if (decoded.kind !== 'json') throw new Error('json bekleniyordu');
    return decoded.msg;
  }

  send(msg: XrJson): void {
    this.sendEncrypted(encodeJson(msg));
  }

  close(): void {
    try {
      this.sock.destroy();
    } catch {
      /* yok say */
    }
  }
}

let bridge: XrBridge | null = null;
const headsets: FakeHeadset[] = [];
afterEach(() => {
  for (const h of headsets.splice(0)) h.close();
  bridge?.stop();
  bridge = null;
});

describe('XrBridge — gerçek loopback soketiyle çoklu cihaz', () => {
  it('gözlük + saat bağlanır; iletiler türle gelir; ping→pong gecikme verir; send türe göre yollar', async () => {
    const port = 47_900 + Math.floor(Math.random() * 90);
    const got: Array<{ kind: string; t: unknown }> = [];
    const connected: string[] = [];
    let clock = Date.now();
    const store = PairingStore.ephemeral();
    bridge = new XrBridge({
      store,
      pcName: 'TEST',
      port,
      hostsOf: () => ['127.0.0.1'],
      qrDataUrl: async () => 'data:image/png;base64,AA==',
      pingEveryMs: 0,
      now: () => clock,
      onMessage: (kind, _id, msg) => void got.push({ kind, t: msg.t }),
      onConnected: (kind) => void connected.push(kind),
    });
    await bridge.start();
    const status = await bridge.startPairing('quest');
    const code = new URL(status.pairing!.uri.replace('fuberxr:1?', 'http://x/?')).searchParams.get('c') ?? '';
    expect(code.length).toBeGreaterThan(4);

    const quest = new FakeHeadset();
    const watch = new FakeHeadset();
    headsets.push(quest, watch);
    await quest.connect(port);
    await quest.pair(store.fingerprint, keyPair(), code, { model: 'Quest 3' });
    // Pencere ilk eşleşmede kapanır; ikinci cihaz için yeniden açılır.
    const again = await bridge.startPairing('watch');
    const code2 = new URL(again.pairing!.uri.replace('fuberxr:1?', 'http://x/?')).searchParams.get('c') ?? '';
    await watch.connect(port);
    await watch.pair(store.fingerprint, keyPair(), code2, { model: 'Galaxy Watch 8' });
    await new Promise((r) => setTimeout(r, 50));

    const st = bridge.status();
    expect(connected.sort()).toEqual(['quest', 'watch']);
    expect(st.connected).not.toBeNull();
    expect(st.watch).not.toBeNull();
    expect(st.connections.map((c) => c.kind).sort()).toEqual(['quest', 'watch']);
    expect(st.devices.map((d) => d.kind).sort()).toEqual(['quest', 'watch']);

    watch.send({ t: 'bio.sample', hr: 71 });
    quest.send({ t: 'hud.action', action: 'palette', palette: 'blue' });
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toContainEqual({ kind: 'watch', t: 'bio.sample' });
    expect(got).toContainEqual({ kind: 'quest', t: 'hud.action' });

    // yalnız saate
    expect(bridge.send({ t: 'hud.log', entry: { text: 'x' } }, 'quest')).toBe(1);
    expect((await quest.recvJson()).t).toBe('hud.log');
    expect(bridge.send({ t: 'ping-yok' }, 'watch')).toBe(1);
    expect((await watch.recvJson()).t).toBe('ping-yok');

    // ping → pong → gecikme (sahte saat 37 ms ilerler)
    bridge.pingAll();
    const ping = await quest.recvJson();
    expect(ping.t).toBe('ping');
    clock += 37;
    quest.send({ t: 'pong', ts: ping.ts });
    await new Promise((r) => setTimeout(r, 50));
    const q = bridge.status().connections.find((c) => c.kind === 'quest')!;
    expect(q.latencyMs).toBe(37);
    expect(bridge.status().connections.find((c) => c.kind === 'watch')!.latencyMs).toBeNull();
    expect(got.some((m) => m.t === 'pong')).toBe(false); // pong iş iletisi değildir

    // saat kopunca yalnız o düşer
    watch.close();
    await new Promise((r) => setTimeout(r, 80));
    expect(bridge.status().watch).toBeNull();
    expect(bridge.status().connected).not.toBeNull();
  });
});
