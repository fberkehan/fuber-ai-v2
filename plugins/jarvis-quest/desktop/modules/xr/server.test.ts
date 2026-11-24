import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
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
import { PairingStore, PairingWindow, buildClientHello, clientHandshake } from './pairing';
import { XrServer } from './server';

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

let server: XrServer | null = null;
const headsets: FakeHeadset[] = [];
afterEach(() => {
  for (const h of headsets.splice(0)) h.close();
  server?.close();
  server = null;
});

describe('XrServer — gerçek TCP loopback', () => {
  it('pair akışı: paired + welcome, sonra şifreli ping→pong', async () => {
    const store = PairingStore.ephemeral();
    const win = new PairingWindow(Date.now(), { code: 'kod-123', pin: '111222' });
    server = new XrServer({ pcName: 'Fuber PC', store, pairingWindow: () => win, features: ['voice', 'dashboard'] });
    const port = await server.listen(0, '127.0.0.1');

    const hs = new FakeHeadset();
    headsets.push(hs);
    await hs.connect(port);
    const device = keyPair();
    const { paired, welcome } = await hs.pair(store.fingerprint, device, 'kod-123');
    expect(paired.t).toBe('paired');
    expect(welcome.t).toBe('welcome');
    expect(welcome.features).toEqual(['voice', 'dashboard']);
    // cihaz kaydedildi
    expect(store.list().length).toBe(1);
    // pencere yakıldı
    expect(win.isOpen()).toBe(false);

    // şifreli ping → pong
    hs.send({ t: 'ping', ts: 42 });
    const pong = await hs.recvJson();
    expect(pong).toEqual({ t: 'pong', ts: 42 });
  });

  it('iş iletisi onMessage geri çağrımına ulaşır; sunucu yanıtı çözülür', async () => {
    const store = PairingStore.ephemeral();
    const win = new PairingWindow(Date.now(), { code: 'k', pin: '000000' });
    server = new XrServer({
      pcName: 'PC',
      store,
      pairingWindow: () => win,
      onMessage: (session, msg) => {
        if (msg.t === 'chat.text') session.send({ t: 'transcript', turnId: 't1', role: 'assistant', text: `yankı: ${String(msg.text)}`, final: true });
      },
    });
    const port = await server.listen(0, '127.0.0.1');
    const hs = new FakeHeadset();
    headsets.push(hs);
    await hs.connect(port);
    await hs.pair(store.fingerprint, keyPair(), 'k');
    hs.send({ t: 'chat.text', text: 'selam' });
    const reply = await hs.recvJson();
    expect(reply.t).toBe('transcript');
    expect(reply.text).toBe('yankı: selam');
  });

  it('yanlış kod → bağlantı reddedilir (store boş kalır)', async () => {
    const store = PairingStore.ephemeral();
    const win = new PairingWindow(Date.now(), { code: 'dogru', pin: '000000' });
    server = new XrServer({ pcName: 'PC', store, pairingWindow: () => win });
    const port = await server.listen(0, '127.0.0.1');
    const hs = new FakeHeadset();
    headsets.push(hs);
    await hs.connect(port);
    await expect(hs.pair(store.fingerprint, keyPair(), 'YANLIS')).rejects.toBeTruthy();
    expect(store.list().length).toBe(0);
  });

  it('aynı türden ikinci cihaz birinciyi değiştirir (1 gözlük kuralı)', async () => {
    const store = PairingStore.ephemeral();
    server = new XrServer({ pcName: 'PC', store, pairingWindow: () => new PairingWindow(Date.now(), { code: 'k', pin: '000000' }) });
    const port = await server.listen(0, '127.0.0.1');

    const h1 = new FakeHeadset();
    headsets.push(h1);
    await h1.connect(port);
    await h1.pair(store.fingerprint, keyPair(), 'k');
    const s1 = server.session;
    expect(s1?.alive).toBe(true);
    expect(s1?.kind).toBe('quest');

    // İkinci gözlük el sıkışmayı bitirince sunucu eskisini 'replaced' ile düşürür.
    const h2 = new FakeHeadset();
    headsets.push(h2);
    await h2.connect(port);
    await h2.pair(store.fingerprint, keyPair(), 'k');
    await new Promise((r) => setTimeout(r, 50));
    expect(s1?.alive).toBe(false);
    expect(server.session?.alive).toBe(true);
    expect(server.sessions().length).toBe(1);
  });

  it('eşleşme penceresi tür taşır: VR penceresine saat, Saat penceresine gözlük bağlanamaz (wrong_kind)', async () => {
    const store = PairingStore.ephemeral();
    const questWin = new PairingWindow(Date.now(), { code: 'q', pin: '111111' });
    questWin.forKind = 'quest';
    const watchWin = new PairingWindow(Date.now(), { code: 'w', pin: '222222' });
    watchWin.forKind = 'watch';
    let current = questWin;
    server = new XrServer({ pcName: 'PC', store, pairingWindow: () => current });
    const port = await server.listen(0, '127.0.0.1');

    const watch = new FakeHeadset();
    headsets.push(watch);
    await watch.connect(port);
    await expect(watch.pair(store.fingerprint, keyPair(), 'q', { model: 'Galaxy Watch 8', kind: 'watch' })).rejects.toThrow(/wrong_kind/);
    expect(store.list().length).toBe(0);
    expect(questWin.isOpen()).toBe(true); // yanlış tür pencereyi yakmaz

    current = watchWin;
    const quest = new FakeHeadset();
    headsets.push(quest);
    await quest.connect(port);
    await expect(quest.pair(store.fingerprint, keyPair(), 'w', { model: 'Quest 3', kind: 'quest' })).rejects.toThrow(/wrong_kind/);
    expect(store.list().length).toBe(0);

    // doğru tür bağlanır
    const watch2 = new FakeHeadset();
    headsets.push(watch2);
    await watch2.connect(port);
    const ok = await watch2.pair(store.fingerprint, keyPair(), 'w', { model: 'Galaxy Watch 8', kind: 'watch' });
    expect(ok.paired.t).toBe('paired');
    expect(store.list().map((d) => d.model)).toEqual(['Galaxy Watch 8']);
  });

  it('1 gözlük + 1 saat aynı anda bağlı kalır; tür model önekinden ya da pair.kind’den gelir', async () => {
    const store = PairingStore.ephemeral();
    const seen: Array<{ kind: string; t: unknown }> = [];
    server = new XrServer({
      pcName: 'PC',
      store,
      pairingWindow: () => new PairingWindow(Date.now(), { code: 'k', pin: '000000' }),
      onMessage: (session, msg) => void seen.push({ kind: session.kind, t: msg.t }),
    });
    const port = await server.listen(0, '127.0.0.1');
    const quest = new FakeHeadset();
    const watch = new FakeHeadset();
    headsets.push(quest, watch);
    await quest.connect(port);
    await quest.pair(store.fingerprint, keyPair(), 'k', { model: 'Quest 3' });
    await watch.connect(port);
    await watch.pair(store.fingerprint, keyPair(), 'k', { model: 'Galaxy Watch 8' });

    expect(server.sessions().length).toBe(2);
    expect(server.sessionOf('quest')?.alive).toBe(true);
    expect(server.sessionOf('watch')?.alive).toBe(true);

    // her iki cihaz kendi türüyle ileti yollar; sunucu yalnız hedef türe yazar
    watch.send({ t: 'bio.sample', hr: 70 });
    quest.send({ t: 'hud.action', action: 'tab', tab: 'fleet' });
    server.sessionOf('watch')!.send({ t: 'ping', ts: 5 });
    expect((await watch.recvJson()).t).toBe('ping');
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toContainEqual({ kind: 'watch', t: 'bio.sample' });
    expect(seen).toContainEqual({ kind: 'quest', t: 'hud.action' });

    // pair.kind modelden önce gelir
    const odd = new FakeHeadset();
    headsets.push(odd);
    await odd.connect(port);
    await odd.pair(store.fingerprint, keyPair(), 'k', { model: 'SM-L300', kind: 'watch' });
    await new Promise((r) => setTimeout(r, 50));
    expect(server.sessionOf('watch')?.alive).toBe(true);
    expect(server.sessions().length).toBe(2); // eski saat 'replaced' ile düştü
  });
});
