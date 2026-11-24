import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keyPair } from './protocol';
import {
  PairingStore,
  PairingWindow,
  PIN_MAX_ATTEMPTS,
  buildClientHello,
  clientHandshake,
  deviceIdFor,
  deviceRecordFromPair,
  generatePin,
  parseClientHello,
  serverHandshake,
} from './pairing';

const tmps: string[] = [];
function tmpFile(): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xr-pair-')), 'pairings.json');
  tmps.push(path.dirname(f));
  return f;
}
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('PairingStore', () => {
  it('statik anahtar üretir, kalıcı (yeniden açınca aynı)', () => {
    const f = tmpFile();
    const s1 = PairingStore.open(f);
    const fp1 = s1.fingerprint;
    const s2 = PairingStore.open(f);
    expect(s2.fingerprint).toBe(fp1);
    expect(fs.existsSync(f)).toBe(true);
    // dosya izinleri (0600) — Windows'ta mode tam uygulanmaz, varlık yeterli
  });

  it('cihaz ekle/bul/sil, diske yazılır', () => {
    const f = tmpFile();
    const s = PairingStore.open(f);
    const dpub = keyPair().pub;
    const id = deviceIdFor(dpub);
    s.upsert({ deviceId: id, pub: dpub.toString('base64url'), name: 'Quest 3', model: 'Quest 3', app: '0.1.0', pairedAt: 'x', lastSeen: 'x' });
    expect(PairingStore.open(f).get(id)?.name).toBe('Quest 3');
    expect(s.remove(id)).toBe(true);
    expect(PairingStore.open(f).get(id)).toBeUndefined();
  });
});

describe('PairingWindow', () => {
  it('QR sırrı eşleşir; süre dolunca kapanır', () => {
    const t0 = 1_000_000;
    const w = new PairingWindow(t0, { code: 'secret-code', pin: '123456' });
    expect(w.matchCode('secret-code', t0 + 1000)).toBe(true);
    expect(w.matchCode('yanlis', t0 + 1000)).toBe(false);
    expect(w.isOpen(t0 + 6 * 60 * 1000)).toBe(false);
    expect(w.matchCode('secret-code', t0 + 6 * 60 * 1000)).toBe(false);
  });

  it('PIN en çok 5 deneme, sonra pencere kapanır', () => {
    const w = new PairingWindow(0, { pin: '000111' });
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) expect(w.matchPin('999999', 1)).toBe(false);
    expect(w.isOpen(1)).toBe(false);
    // kapandıktan sonra doğru PIN bile geçmez
    expect(w.matchPin('000111', 1)).toBe(false);
  });

  it('generatePin 6 hane', () => {
    for (let i = 0; i < 50; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });
});

describe('uçtan uca el sıkışma (pair)', () => {
  it('iki taraf aynı oturum anahtarını türetir ve fp doğrulanır', () => {
    const store = PairingStore.ephemeral();
    const clientEph = keyPair();
    const device = keyPair();

    const hello1 = buildClientHello(clientEph, 'pair');
    const serverEph = keyPair();
    const res = serverHandshake({
      hello1: hello1.msg,
      hello1Bytes: hello1.bytes,
      serverEph,
      store,
      pcName: 'Fuber PC',
      pairingOpen: true,
      deviceConnected: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const cliKeys = clientHandshake({
      clientEph,
      hello1Bytes: hello1.bytes,
      serverHello: res.serverHello.msg,
      serverHelloBytes: res.serverHello.bytes,
      device: null, // pair'de dh3 yok
      expectedFp: store.fingerprint,
    });
    expect(cliKeys.okm).toEqual(res.keys.okm);

    // pair iletisinden cihaz kaydı
    const rec = deviceRecordFromPair(
      { t: 'pair', code: 'x', device: { name: 'Meta Quest 3', pub: device.pub.toString('base64url'), model: 'Quest 3', app: '0.1.0' } },
      new Date().toISOString(),
    );
    store.upsert(rec);
    expect(store.get(rec.deviceId)?.pub).toBe(device.pub.toString('base64url'));
  });

  it('eşleşme penceresi kapalıyken pair reddedilir (not_pairing)', () => {
    const store = PairingStore.ephemeral();
    const h = buildClientHello(keyPair(), 'pair');
    const res = serverHandshake({ hello1: h.msg, hello1Bytes: h.bytes, serverEph: keyPair(), store, pcName: 'PC', pairingOpen: false, deviceConnected: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not_pairing');
  });

  it('yanlış fp → MITM reddi', () => {
    const store = PairingStore.ephemeral();
    const clientEph = keyPair();
    const h = buildClientHello(clientEph, 'pair');
    const res = serverHandshake({ hello1: h.msg, hello1Bytes: h.bytes, serverEph: keyPair(), store, pcName: 'PC', pairingOpen: true, deviceConnected: false });
    if (!res.ok) throw new Error('beklenmedik');
    expect(() =>
      clientHandshake({
        clientEph,
        hello1Bytes: h.bytes,
        serverHello: res.serverHello.msg,
        serverHelloBytes: res.serverHello.bytes,
        device: null,
        expectedFp: 'yanlisparmakizi',
      }),
    ).toThrow(/parmak izi/);
  });
});

describe('uçtan uca el sıkışma (resume)', () => {
  it('kayıtlı cihaz resume ile bağlanır (dh3 ile)', () => {
    const store = PairingStore.ephemeral();
    const device = keyPair();
    const rec = { deviceId: deviceIdFor(device.pub), pub: device.pub.toString('base64url'), name: 'Q', model: 'Q', app: '0', pairedAt: 'x', lastSeen: 'x' };
    store.upsert(rec);

    const clientEph = keyPair();
    const serverEph = keyPair();
    const hello1 = buildClientHello(clientEph, 'resume', rec.deviceId);
    const res = serverHandshake({ hello1: hello1.msg, hello1Bytes: hello1.bytes, serverEph, store, pcName: 'PC', pairingOpen: false, deviceConnected: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('resume');
    const cliKeys = clientHandshake({
      clientEph,
      hello1Bytes: hello1.bytes,
      serverHello: res.serverHello.msg,
      serverHelloBytes: res.serverHello.bytes,
      device, // dh3
      expectedFp: store.fingerprint,
    });
    expect(cliKeys.okm).toEqual(res.keys.okm);
  });

  it('bilinmeyen cihaz resume reddedilir (unknown_device)', () => {
    const store = PairingStore.ephemeral();
    const h = buildClientHello(keyPair(), 'resume', 'yok-boyle-cihaz');
    const res = serverHandshake({ hello1: h.msg, hello1Bytes: h.bytes, serverEph: keyPair(), store, pcName: 'PC', pairingOpen: false, deviceConnected: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unknown_device');
  });

  it('başka gözlük bağlıyken busy', () => {
    const store = PairingStore.ephemeral();
    const h = buildClientHello(keyPair(), 'pair');
    const res = serverHandshake({ hello1: h.msg, hello1Bytes: h.bytes, serverEph: keyPair(), store, pcName: 'PC', pairingOpen: true, deviceConnected: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('busy');
  });
});

describe('parseClientHello', () => {
  it('geçersiz sürüm/kip reddedilir', () => {
    expect(() => parseClientHello({ t: 'hello', v: 2, mode: 'pair', eph: 'AA' })).toThrow(/sürüm/);
    expect(() => parseClientHello({ t: 'hello', v: 1, mode: 'xx', eph: 'AA' })).toThrow(/kip/);
  });
});
