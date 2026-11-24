/**
 * Köprü protokolü BİLİNEN CEVAP VEKTÖRÜ üreticisi. Sabit (hex) girdilerden protokolün bütün ilkel işlemlerini
 * hesaplar; çıktı `docs/protokol-test-vektoru.json`'a yazılır ve hem masaüstü (bu dosya) hem Unity C# tarafı aynı
 * vektöre karşı doğrulanır. Böylece iki bağımsız uygulamanın bit düzeyinde UYUŞTUĞU kanıtlanır.
 *
 * Girdiler sabittir: üretim her zaman aynı JSON'u verir (deterministik). `protocol.test.ts` hem turları hem de
 * taahhüt edilmiş JSON'un yeniden hesaplananla aynı olduğunu doğrular.
 */

import {
  CipherState,
  buildQrUri,
  clientKeys,
  encodeBinary,
  encodeFrame,
  encodeJson,
  fingerprint,
  keyPair,
  nonceFor,
  serverKeys,
  x25519,
  type XrJson,
} from './protocol';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const unhex = (s: string): Buffer => Buffer.from(s, 'hex');

// Sabit özel anahtarlar (yalnız test; gerçek sırlar değil). 32 bayt.
const K = {
  clientEph: '0101010101010101010101010101010101010101010101010101010101010101',
  serverEph: '0202020202020202020202020202020202020202020202020202020202020202',
  serverStatic: '0303030303030303030303030303030303030303030303030303030303030303',
  devicePriv: '0404040404040404040404040404040404040404040404040404040404040404',
  dhA: '0505050505050505050505050505050505050505050505050505050505050505',
  dhB: '0606060606060606060606060606060606060606060606060606060606060606',
  aesKey: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
} as const;

export interface XrTestVector {
  version: number;
  note: string;
  x25519_keypairs: Array<{ priv: string; pub: string }>;
  x25519_dh: { aPriv: string; aPub: string; bPriv: string; bPub: string; shared: string };
  fingerprint: { pub: string; fp: string };
  hkdf_session_pair: {
    mode: 'pair';
    clientEphPriv: string;
    serverEphPriv: string;
    serverStaticPriv: string;
    hello1_utf8: string;
    hello2_utf8: string;
    th: string;
    okm: string;
    c2s: string;
    s2c: string;
  };
  hkdf_session_resume: {
    mode: 'resume';
    clientEphPriv: string;
    serverEphPriv: string;
    serverStaticPriv: string;
    devicePriv: string;
    hello1_utf8: string;
    hello2_utf8: string;
    th: string;
    okm: string;
    c2s: string;
    s2c: string;
  };
  aes_gcm: {
    key: string;
    seals: Array<{ counter: number; nonce: string; plain_utf8: string; sealed: string }>;
  };
  frame: { body: string; encoded: string };
  plain_json: { msg: XrJson; encoded: string };
  plain_binary: { channel: number; seq: number; data: string; encoded: string };
  qr: { hosts: string[]; port: number; fp: string; code: string; name: string; uri: string };
}

/** Deterministik vektör nesnesi. */
export function buildTestVector(): XrTestVector {
  // 1) X25519 anahtar çiftleri (ham private -> ham public).
  const kpClientEph = keyPair(unhex(K.clientEph));
  const kpServerEph = keyPair(unhex(K.serverEph));
  const kpServerStatic = keyPair(unhex(K.serverStatic));
  const kpDevice = keyPair(unhex(K.devicePriv));

  // 2) Yalın DH turu.
  const kpA = keyPair(unhex(K.dhA));
  const kpB = keyPair(unhex(K.dhB));
  const shared = x25519(kpA.priv, kpB.pub);

  // 3) Parmak izi (sunucu statik açık anahtarı üzerinden).
  const fp = fingerprint(kpServerStatic.pub);

  // 4) El sıkışma iletileri (tel üzerindeki gerçek baytlar). Türetme bu baytların kopyasını kullanır.
  const hello1Pair: XrJson = { t: 'hello', v: 1, mode: 'pair', eph: Buffer.from(kpClientEph.pub).toString('base64url') };
  const hello2: XrJson = {
    t: 'hello',
    v: 1,
    eph: Buffer.from(kpServerEph.pub).toString('base64url'),
    static: Buffer.from(kpServerStatic.pub).toString('base64url'),
    name: 'Fuber PC',
  };
  const hello1PairBytes = Buffer.from(JSON.stringify(hello1Pair), 'utf8');
  const hello2Bytes = Buffer.from(JSON.stringify(hello2), 'utf8');

  // pair kipi: iki taraf da aynı oturum anahtarlarını türetmeli.
  const srvPair = serverKeys({
    serverEph: kpServerEph,
    serverStatic: kpServerStatic,
    clientEphPub: kpClientEph.pub,
    devicePub: null,
    hello1: hello1PairBytes,
    hello2: hello2Bytes,
  });
  const cliPair = clientKeys({
    clientEph: kpClientEph,
    serverEphPub: kpServerEph.pub,
    serverStaticPub: kpServerStatic.pub,
    device: null,
    hello1: hello1PairBytes,
    hello2: hello2Bytes,
  });
  if (!srvPair.okm.equals(cliPair.okm)) throw new Error('pair okm uyuşmadı (iç tutarlılık)');

  // resume kipi: dh3 eklenir.
  const hello1Resume: XrJson = {
    t: 'hello',
    v: 1,
    mode: 'resume',
    eph: Buffer.from(kpClientEph.pub).toString('base64url'),
    deviceId: 'dev-test-0001',
  };
  const hello1ResumeBytes = Buffer.from(JSON.stringify(hello1Resume), 'utf8');
  const srvResume = serverKeys({
    serverEph: kpServerEph,
    serverStatic: kpServerStatic,
    clientEphPub: kpClientEph.pub,
    devicePub: kpDevice.pub,
    hello1: hello1ResumeBytes,
    hello2: hello2Bytes,
  });
  const cliResume = clientKeys({
    clientEph: kpClientEph,
    serverEphPub: kpServerEph.pub,
    serverStaticPub: kpServerStatic.pub,
    device: kpDevice,
    hello1: hello1ResumeBytes,
    hello2: hello2Bytes,
  });
  if (!srvResume.okm.equals(cliResume.okm)) throw new Error('resume okm uyuşmadı (iç tutarlılık)');

  // 5) AES-256-GCM: sabit anahtar, 0'dan artan sayaç. İki şifreleme (nonce sayaç ilerleyişini kilitler).
  const key = unhex(K.aesKey);
  const sealer = new CipherState(key);
  const seals = [
    { counter: 0, plain: 'merhaba fuber' },
    { counter: 1, plain: 'ikinci çerçeve — türkçe: ışık, ğ, ş, ü, ç, ö, İ' },
  ].map((s) => {
    const nonce = nonceFor(BigInt(s.counter));
    const sealed = sealer.seal(Buffer.from(s.plain, 'utf8'));
    return { counter: s.counter, nonce: hex(nonce), plain_utf8: s.plain, sealed: hex(sealed) };
  });
  // Çözme turu da aynı anahtarla yapılmalı (doğrulama test içinde).

  // 6) Çerçeve (uzunluk önekli).
  const frameBody = Buffer.from('cerceve govdesi 123', 'utf8');
  const frameEncoded = encodeFrame(frameBody);

  // 7) Düz metin iletileri.
  const jsonMsg: XrJson = { t: 'ping', ts: 1234567890 };
  const jsonEncoded = encodeJson(jsonMsg);
  const binData = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x7f]);
  const binEncoded = encodeBinary(1, 7, binData);

  // 8) QR.
  const qrHosts = ['192.168.1.50', '10.0.0.3'];
  const qrCode = Buffer.from(unhex('a1b2c3d4e5f60718293a4b5c6d7e8f90')).toString('base64url');
  const qrInfo = { hosts: qrHosts, port: 47852, fp, code: qrCode, name: 'Fuber PC — oda' };
  const qrUri = buildQrUri(qrInfo);

  return {
    version: 1,
    note: 'Fuber XR protokol v1 bilinen cevap vektörü. Girdiler sabit test anahtarlarıdır; iki taraf (masaüstü TS, Unity C#) aynı çıktıyı üretmelidir. Tüm ikili alanlar hex.',
    x25519_keypairs: [kpClientEph, kpServerEph, kpServerStatic, kpDevice].map((kp) => ({ priv: hex(kp.priv), pub: hex(kp.pub) })),
    x25519_dh: { aPriv: hex(kpA.priv), aPub: hex(kpA.pub), bPriv: hex(kpB.priv), bPub: hex(kpB.pub), shared: hex(shared) },
    fingerprint: { pub: hex(kpServerStatic.pub), fp },
    hkdf_session_pair: {
      mode: 'pair',
      clientEphPriv: K.clientEph,
      serverEphPriv: K.serverEph,
      serverStaticPriv: K.serverStatic,
      hello1_utf8: hello1PairBytes.toString('utf8'),
      hello2_utf8: hello2Bytes.toString('utf8'),
      th: hex(srvPair.th),
      okm: hex(srvPair.okm),
      c2s: hex(srvPair.c2s),
      s2c: hex(srvPair.s2c),
    },
    hkdf_session_resume: {
      mode: 'resume',
      clientEphPriv: K.clientEph,
      serverEphPriv: K.serverEph,
      serverStaticPriv: K.serverStatic,
      devicePriv: K.devicePriv,
      hello1_utf8: hello1ResumeBytes.toString('utf8'),
      hello2_utf8: hello2Bytes.toString('utf8'),
      th: hex(srvResume.th),
      okm: hex(srvResume.okm),
      c2s: hex(srvResume.c2s),
      s2c: hex(srvResume.s2c),
    },
    aes_gcm: { key: K.aesKey, seals },
    frame: { body: hex(frameBody), encoded: hex(frameEncoded) },
    plain_json: { msg: jsonMsg, encoded: hex(jsonEncoded) },
    plain_binary: { channel: 1, seq: 7, data: hex(binData), encoded: hex(binEncoded) },
    qr: { hosts: qrHosts, port: 47852, fp, code: qrCode, name: qrInfo.name, uri: qrUri },
  };
}
