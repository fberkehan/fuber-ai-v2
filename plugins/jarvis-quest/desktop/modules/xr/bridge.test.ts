import { describe, expect, it } from 'vitest';
import { XrBridge } from './bridge';
import { PairingStore, PAIRING_WINDOW_MS, type DeviceRecord } from './pairing';
import { XR_PORT } from './protocol';

/** Ağ açmadan, sahte QR ve sabit adres/saatle köprü mantığını koşturan yardımcı. */
function makeBridge(now: () => number = () => 1_000) {
  const store = PairingStore.ephemeral();
  const bridge = new XrBridge({
    store,
    pcName: 'TEST-PC',
    hostsOf: () => ['192.168.1.42'],
    qrDataUrl: async (uri) => `data:image/png;base64,${Buffer.from(uri).toString('base64')}`,
    net: false,
    now,
  });
  return { bridge, store };
}

const sampleDevice = (deviceId: string): DeviceRecord => ({
  deviceId,
  pub: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  name: 'Meta Quest 3',
  model: 'Quest3',
  app: '1.0.0',
  pairedAt: '2026-11-18T00:00:00.000Z',
  lastSeen: '2026-11-18T00:00:00.000Z',
});

describe('XrBridge', () => {
  it('başlangıç durumu: çalışmıyor, cihaz yok, eşleşme yok', async () => {
    const { bridge } = makeBridge();
    await bridge.start(); // net:false → soket açılmaz ama running olur
    const s = bridge.status();
    expect(s.port).toBe(XR_PORT);
    expect(s.pcName).toBe('TEST-PC');
    expect(s.hosts).toEqual(['192.168.1.42']);
    expect(s.devices).toEqual([]);
    expect(s.connected).toBeNull();
    expect(s.pairing).toBeNull();
    expect(s.fingerprint.length).toBeGreaterThan(20);
    expect(s.shortFp).toBe(s.fingerprint.slice(0, 4));
  });

  it('eşleşme açınca QR + 6 haneli PIN + fuberxr içeriği üretir', async () => {
    const { bridge } = makeBridge();
    const s = await bridge.startPairing();
    expect(s.pairing).not.toBeNull();
    expect(s.pairing!.pin).toMatch(/^\d{6}$/);
    expect(s.pairing!.qr.startsWith('data:image/png;base64,')).toBe(true);
    expect(s.pairing!.uri.startsWith('fuberxr:1?')).toBe(true);
    expect(s.pairing!.uri).toContain('h=192.168.1.42');
    expect(s.pairing!.uri).toContain('n=TEST-PC');
    expect(s.pairing!.attemptsLeft).toBe(5);
  });

  it('eşleşme iptal edilince pencere kapanır', async () => {
    const { bridge } = makeBridge();
    await bridge.startPairing();
    const s = bridge.cancelPairing();
    expect(s.pairing).toBeNull();
  });

  it('5 dakika geçince eşleşme penceresi kendiliğinden kapanır', async () => {
    let t = 1_000;
    const { bridge } = makeBridge(() => t);
    await bridge.startPairing();
    expect(bridge.status().pairing).not.toBeNull();
    t += PAIRING_WINDOW_MS + 1;
    expect(bridge.status().pairing).toBeNull();
  });

  it('cihaz unutunca kayıttan silinir', async () => {
    const { bridge, store } = makeBridge();
    store.upsert(sampleDevice('dev-1'));
    expect(bridge.status().devices.map((d) => d.deviceId)).toEqual(['dev-1']);
    const s = bridge.forget('dev-1');
    expect(s.devices).toEqual([]);
    expect(store.get('dev-1')).toBeUndefined();
  });

  it('cihaz türü: kayıtlı modelden gözlük/saat olarak görünür; saat eşleşmesi için pencere forKind taşır', async () => {
    const { bridge, store } = makeBridge();
    store.upsert(sampleDevice('q'));
    store.upsert({ ...sampleDevice('w'), name: 'Galaxy Watch 8', model: 'Galaxy Watch 8' });
    const s = bridge.status();
    expect(s.devices.map((d) => [d.deviceId, d.kind])).toEqual([['q', 'quest'], ['w', 'watch']]);
    expect(s.watch).toBeNull();
    expect(s.connections).toEqual([]);
    const watchPairing = await bridge.startPairing('watch');
    expect(watchPairing.pairing!.forKind).toBe('watch');
    expect((await bridge.startPairing()).pairing!.forKind).toBe('quest');
  });

  it('ağsız kipte ileti yollamak kimseye gitmez (0)', async () => {
    const { bridge } = makeBridge();
    await bridge.start();
    expect(bridge.send({ t: 'hud.snapshot' })).toBe(0);
    expect(bridge.send({ t: 'x' }, 'watch')).toBe(0);
  });
});
