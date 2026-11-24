// Güvenli ağ kapısı (SSRF). Yerel sınama sunucusu 127.0.0.1'de koşar; dış ağa hiç gidilmez.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkUrl, createSafeFetch, decodeBody, FetchBlockedError, FetchFailedError, isPublicAddress } from './net';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '127.255.0.9', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:c0a8:101::1', '::127.0.0.1', 'fe80::1%12',
  ])('%s özel/ayrılmış sayılır', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '8.8.4.4', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('%s herkese açık', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it('IP olmayan dizge açık sayılmaz', () => {
    expect(isPublicAddress('ornek.com')).toBe(false);
    expect(isPublicAddress('999.1.1.1')).toBe(false);
  });
});

describe('checkUrl (bağlantıdan önce)', () => {
  const reason = (url: string) => {
    try {
      checkUrl(url);
      return 'ok';
    } catch (error) {
      return error instanceof FetchBlockedError ? error.reason : 'other';
    }
  };

  it.each([
    ['javascript:alert(1)', 'scheme'],
    ['file:///C:/Windows/win.ini', 'scheme'],
    ['ftp://ornek.com/a', 'scheme'],
    ['https://kullanici:parola@ornek.com/', 'credentials'],
    ['http://ornek.com:22/', 'port'],
    ['http://localhost/', 'host'],
    ['http://LOCALHOST./', 'host'],
    ['http://yazici/', 'host'],
    ['http://nas.local/', 'host'],
    ['http://servis.internal/', 'host'],
    ['http://a.localhost/', 'host'],
    ['http://127.0.0.1:8080/', 'private'],
    ['http://2130706433/', 'private'],
    ['http://0x7f.0.0.1/', 'private'],
    ['http://017700000001/', 'private'],
    ['http://[::1]/', 'private'],
    ['http://[::ffff:127.0.0.1]/', 'private'],
    ['http://169.254.169.254/latest/meta-data/', 'private'],
    ['http://192.168.1.1/', 'private'],
    ['http://[fe80::1]/', 'private'],
    ['https://www.gov.uk/guidance', 'ok'],
    ['https://8.8.8.8/', 'ok'],
    ['http://ornek.com:8080/a', 'ok'],
  ])('%s → %s', (url, expected) => {
    expect(reason(url)).toBe(expected);
  });
});

describe('createSafeFetch (yerel sınama sunucusu)', () => {
  let server: http.Server;
  let port = 0;
  let hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      const url = req.url ?? '/';
      if (url === '/ok') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>merhaba İstanbul</p>');
      if (url === '/to-private') return res.writeHead(302, { Location: 'http://10.0.0.5/admin' }).end();
      if (url === '/to-localhost') return res.writeHead(301, { Location: `http://localhost:${port}/ok` }).end();
      if (url === '/to-file') return res.writeHead(302, { Location: 'file:///C:/Windows/win.ini' }).end();
      if (url === '/to-ok') return res.writeHead(302, { Location: '/ok' }).end();
      if (url.startsWith('/loop')) return res.writeHead(302, { Location: `/loop${Number(url.slice(5) || 0) + 1}` }).end();
      if (url === '/big') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('a'.repeat(3_000_000));
        return;
      }
      if (url === '/gzip') return res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' }).end(zlib.gzipSync('sıkıştırılmış metin'));
      if (url === '/deflate-raw') return res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'deflate' }).end(zlib.deflateRawSync('ham deflate'));
      if (url === '/deflate-zlib') return res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'deflate' }).end(zlib.deflateSync('zlib deflate'));
      if (url === '/hang') return; // hiç yanıt vermez
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Sınama sunucusu geri döngüde: yalnız ona izin veren kapı (öteki her şey üretimdeki gibi denetlenir).
  const onlyLoopback = (address: string) => address === '127.0.0.1' || isPublicAddress(address);
  const local = () => createSafeFetch({ isAllowed: onlyLoopback, isPortAllowed: () => true });
  const base = () => `http://127.0.0.1:${port}`;

  it('üretim kapısı geri döngüye hiç bağlanmaz (sunucuya istek düşmez)', async () => {
    hits = [];
    await expect(createSafeFetch({ isPortAllowed: () => true })(`${base()}/ok`)).rejects.toMatchObject({ reason: 'private' });
    expect(hits).toEqual([]);
  });

  it('ad çözümlemesi özel adres verirse bağlantı kurulmaz; bir adresi bile özelse (DNS yeniden bağlama) reddedilir', async () => {
    hits = [];
    const toPrivate = createSafeFetch({ lookup: (_host, cb) => cb(null, [{ address: '10.1.2.3', family: 4 }]) });
    await expect(toPrivate('http://kotu.ornek.com/')).rejects.toBeInstanceOf(FetchBlockedError);
    const mixed = createSafeFetch({ lookup: (_host, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]) });
    await expect(mixed('http://karisik.ornek.com/')).rejects.toMatchObject({ reason: 'private' });
    // Ad 127.0.0.1'e çözülse bile üretim kapısı sınama sunucusuna bağlanmaz.
    const loop = createSafeFetch({ lookup: (_host, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) });
    await expect(loop('http://geri.ornek.com:8080/ok')).rejects.toMatchObject({ reason: 'private' });
    expect(hits).toEqual([]);
  });

  it('okur ve kodlamayı çözer', async () => {
    const response = await local()(`${base()}/ok`);
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('text/html');
    expect(decodeBody(response)).toContain('İstanbul');
  });

  it('özel adrese, localhost’a ve file: adresine yönlendirme engellenir; olağan yönlendirme izlenir', async () => {
    await expect(local()(`${base()}/to-private`)).rejects.toMatchObject({ reason: 'private' });
    await expect(local()(`${base()}/to-localhost`)).rejects.toMatchObject({ reason: 'host' });
    await expect(local()(`${base()}/to-file`)).rejects.toMatchObject({ reason: 'scheme' });
    const followed = await local()(`${base()}/to-ok`);
    expect(followed.url).toBe(`${base()}/ok`);
  });

  it('en çok 5 yönlendirme', async () => {
    await expect(local()(`${base()}/loop0`)).rejects.toMatchObject({ reason: 'redirects' });
  });

  it('boyut sınırında keser', async () => {
    const response = await local()(`${base()}/big`, { maxBytes: 100_000 });
    expect(response.truncated).toBe(true);
    expect(response.body.length).toBe(100_000);
  });

  it('süre sınırı: yanıt vermeyen sunucu zaman aşımına düşer', async () => {
    const started = Date.now();
    const error = await local()(`${base()}/hang`, { timeoutMs: 300 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FetchFailedError);
    expect((error as FetchFailedError).kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('çağıranın iptali "aborted" olarak döner', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(local()(`${base()}/hang`, { signal: controller.signal, timeoutMs: 5000 })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('gzip, zlib deflate ve ham deflate açılır', async () => {
    expect(decodeBody(await local()(`${base()}/gzip`))).toBe('sıkıştırılmış metin');
    expect(decodeBody(await local()(`${base()}/deflate-zlib`))).toBe('zlib deflate');
    expect(decodeBody(await local()(`${base()}/deflate-raw`))).toBe('ham deflate');
  });
});
