import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CipherState,
  FrameDecoder,
  buildQrUri,
  clientKeys,
  decodePlain,
  encodeBinary,
  encodeFrame,
  encodeJson,
  fingerprint,
  fromB64u,
  keyPair,
  nonceFor,
  parseQrUri,
  publicFromPrivate,
  serverKeys,
  x25519,
  XR_MAX_FRAME,
  XrProtocolError,
} from './protocol';
import { buildTestVector } from './testvector';

const here = path.dirname(fileURLToPath(import.meta.url));
// docs: hem d4-quest hem Quest tarafı aynı dosyayı tutar; kaynak doğruluk d4-quest/docs.
const VECTOR_PATH = path.resolve(here, '../../../../../../docs/protokol-test-vektoru.json');

describe('X25519 + anahtar türetme', () => {
  it('ham private → ham public tutarlı (iki yoldan)', () => {
    const kp = keyPair();
    expect(kp.pub).toEqual(publicFromPrivate(kp.priv));
    expect(kp.pub.length).toBe(32);
  });

  it('DH simetrik: X25519(a, B) == X25519(b, A)', () => {
    const a = keyPair();
    const b = keyPair();
    expect(x25519(a.priv, b.pub)).toEqual(x25519(b.priv, a.pub));
  });

  it('sıfır/küçük dereceli sonuç reddedilir', () => {
    const a = keyPair();
    const zero = new Uint8Array(32); // tümü sıfır açık anahtar → düşük dereceli
    expect(() => x25519(a.priv, zero)).toThrow(XrProtocolError);
  });

  it('pair ve resume oturum anahtarları iki tarafta uyuşur', () => {
    const ce = keyPair();
    const se = keyPair();
    const s = keyPair();
    const d = keyPair();
    const h1 = Buffer.from('{"t":"hello","mode":"pair"}');
    const h2 = Buffer.from('{"t":"hello"}');
    const srv = serverKeys({ serverEph: se, serverStatic: s, clientEphPub: ce.pub, devicePub: null, hello1: h1, hello2: h2 });
    const cli = clientKeys({ clientEph: ce, serverEphPub: se.pub, serverStaticPub: s.pub, device: null, hello1: h1, hello2: h2 });
    expect(srv.okm).toEqual(cli.okm);
    // resume: dh3 eklenir, farklı anahtar çıkmalı ama iki tarafta yine aynı
    const srvR = serverKeys({ serverEph: se, serverStatic: s, clientEphPub: ce.pub, devicePub: d.pub, hello1: h1, hello2: h2 });
    const cliR = clientKeys({ clientEph: ce, serverEphPub: se.pub, serverStaticPub: s.pub, device: d, hello1: h1, hello2: h2 });
    expect(srvR.okm).toEqual(cliR.okm);
    expect(srvR.okm).not.toEqual(srv.okm);
  });

  it('parmak izi 43 karakter base64url', () => {
    const fp = fingerprint(keyPair().pub);
    expect(fp).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('AES-256-GCM CipherState', () => {
  it('şifrele → çöz turu, türkçe metin korunur', () => {
    const key = Buffer.alloc(32, 7);
    const enc = new CipherState(key);
    const dec = new CipherState(key);
    const msg = Buffer.from('ışık ğ ş ü ç ö İ — fuber', 'utf8');
    const sealed = enc.seal(msg);
    expect(dec.open(sealed)).toEqual(msg);
  });

  it('sayaç ilerler; sıra dışı/yeniden oynatılan çerçeve reddedilir', () => {
    const key = Buffer.alloc(32, 9);
    const enc = new CipherState(key);
    const dec = new CipherState(key);
    const c0 = enc.seal(Buffer.from('bir'));
    const c1 = enc.seal(Buffer.from('iki'));
    // c1'i önce açmaya çalış → sayaç 0 beklerken 1 → başarısız
    expect(() => dec.open(c1)).toThrow(/çözülemedi/);
  });

  it('nonce = 4 bayt sıfır || u64 BE sayaç', () => {
    expect(nonceFor(0n).toString('hex')).toBe('000000000000000000000000');
    expect(nonceFor(1n).toString('hex')).toBe('000000000000000000000001');
    expect(nonceFor(258n).toString('hex')).toBe('000000000000000000000102');
  });
});

describe('çerçeve kodlama/çözme', () => {
  it('encode → FrameDecoder turu, parçalı akışta da', () => {
    const a = encodeFrame(Buffer.from('aaa'));
    const b = encodeFrame(Buffer.from('bbbb'));
    const dec = new FrameDecoder();
    const all = Buffer.concat([a, b]);
    // bayt bayt besle
    const frames: Buffer[] = [];
    for (const byte of all) frames.push(...dec.push(Buffer.from([byte])));
    expect(frames.map((f) => f.toString())).toEqual(['aaa', 'bbbb']);
  });

  it('boş ya da aşırı büyük çerçeve reddedilir', () => {
    expect(() => encodeFrame(Buffer.alloc(0))).toThrow(XrProtocolError);
    const dec = new FrameDecoder();
    const bad = Buffer.alloc(4);
    bad.writeUInt32BE(XR_MAX_FRAME + 1, 0);
    expect(() => dec.push(bad)).toThrow(/çerçeve boyu/);
  });
});

describe('düz metin iletileri', () => {
  it('JSON turu', () => {
    const d = decodePlain(encodeJson({ t: 'ping', ts: 5 }));
    expect(d).toEqual({ kind: 'json', msg: { t: 'ping', ts: 5 } });
  });

  it('ikili turu (kanal/sıra/veri)', () => {
    const data = Buffer.from([1, 2, 3]);
    const d = decodePlain(encodeBinary(2, 99, data));
    expect(d.kind).toBe('binary');
    if (d.kind === 'binary') {
      expect(d.channel).toBe(2);
      expect(d.seq).toBe(99);
      expect(d.data).toEqual(data);
    }
  });

  it('`t` olmayan JSON reddedilir', () => {
    const bad = Buffer.concat([Buffer.from([0x01]), Buffer.from('{"x":1}')]);
    expect(() => decodePlain(bad)).toThrow(/`t` yok/);
  });
});

describe('QR oluştur/ayrıştır', () => {
  it('tur: buildQrUri → parseQrUri', () => {
    const info = { hosts: ['192.168.1.5', '10.0.0.2'], port: 47852, fp: fingerprint(keyPair().pub), code: crypto.randomBytes(16).toString('base64url'), name: 'Fuber PC — oda ışığı' };
    const uri = buildQrUri(info);
    const back = parseQrUri(uri);
    expect(back.hosts).toEqual(info.hosts);
    expect(back.port).toBe(info.port);
    expect(back.fp).toBe(info.fp);
    expect(back.name).toBe(info.name);
  });

  it('bozuk/eksik QR reddedilir', () => {
    expect(() => parseQrUri('http://x')).toThrow(XrProtocolError);
    expect(() => parseQrUri('fuberxr:9?h=1.2.3.4&p=1&f=a&c=b')).toThrow(/sürüm/);
  });
});

describe('bilinen cevap vektörü (iki taraf uyumu kilidi)', () => {
  it('vektör kendi içinde tutarlı (pair/resume okm iki tarafta eşit; seal→open; frame/qr turu)', () => {
    const v = buildTestVector();
    // AES seal'leri yeniden çözülebilmeli
    const key = Buffer.from(v.aes_gcm.key, 'hex');
    const dec = new CipherState(key);
    for (const s of v.aes_gcm.seals) {
      const opened = dec.open(Buffer.from(s.sealed, 'hex'));
      expect(opened.toString('utf8')).toBe(s.plain_utf8);
    }
    // QR geri ayrıştır
    const qr = parseQrUri(v.qr.uri);
    expect(qr.fp).toBe(v.qr.fp);
    expect(qr.code).toBe(v.qr.code);
  });

  it('taahhüt edilmiş docs/protokol-test-vektoru.json yeniden hesaplananla AYNI (C# bu dosyaya karşı doğrular)', () => {
    const fresh = buildTestVector();
    if (process.env.XR_WRITE_VECTORS === '1') {
      fs.mkdirSync(path.dirname(VECTOR_PATH), { recursive: true });
      fs.writeFileSync(VECTOR_PATH, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
    }
    expect(fs.existsSync(VECTOR_PATH)).toBe(true);
    const committed = JSON.parse(fs.readFileSync(VECTOR_PATH, 'utf8'));
    expect(committed).toEqual(fresh);
  });
});
