import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError, hostAllowed, isPrivateAddress, requestOnce, safeFetch, type Lookup, type Transport, type TransportRequest } from './net';

// Gerçek dış ağa hiçbir istek gitmez: alan adları sahte çözümleyiciyle "genel" bir adrese çözülür, bağlantıyı
// sahte taşıyıcı kurar. Taşıyıcı, HTTP katmanını da sınamak için isteği yerel sınama sunucusuna aktarır
// (kapı, bağlanılacak adresi taşıyıcıdan ÖNCE denetler; yerel sunucu yalnız taşıyıcının arkasındadır).
let server: http.Server;
let port: number;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    hits.push(`${request.method} ${request.headers.host} ${request.url}`);
    const url = new URL(request.url ?? '/', 'http://x');
    if (url.pathname === '/redirect-out') {
      response.writeHead(302, { location: 'http://evil.example/steal' }).end();
    } else if (url.pathname === '/redirect-in') {
      response.writeHead(302, { location: '/json?via=redirect' }).end();
    } else if (url.pathname === '/redirect-other') {
      response.writeHead(302, { location: 'https://cdn.example.org/json' }).end();
    } else if (url.pathname === '/big') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(1_200_000));
    } else if (url.pathname === '/slow') {
      setTimeout(() => response.end('geç'), 2000);
    } else if (url.pathname === '/echo') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ body, type: request.headers['content-type'], host: request.headers.host, cookie: request.headers.cookie ?? null }));
      });
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, query: Object.fromEntries(url.searchParams) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const PUBLIC = { address: '93.184.215.14', family: 4 };
/** Alan adına göre sahte DNS; tanımadığı adı çözemez. Her çağrı kaydedilir. */
function fakeDns(table: Record<string, Array<{ address: string; family: number }>>): Lookup & { asked: string[] } {
  const asked: string[] = [];
  const lookup = (async (hostname: string) => {
    asked.push(hostname);
    const found = table[hostname];
    if (!found) throw new Error('ENOTFOUND');
    return found;
  }) as Lookup & { asked: string[] };
  lookup.asked = asked;
  return lookup;
}
/** Sahte taşıyıcı: kapıdan geçen adresi kaydeder, isteği yerel sınama sunucusuna aktarır (Host alan adı kalır). */
function fakeTransport(): Transport & { seen: TransportRequest[] } {
  const seen: TransportRequest[] = [];
  const transport = ((request: TransportRequest) => {
    seen.push(request);
    const local = new URL(`${request.url.pathname}${request.url.search}`, `http://127.0.0.1:${port}`);
    return requestOnce({
      ...request,
      url: local,
      pinned: { address: '127.0.0.1', family: 4 },
      headers: { ...request.headers, host: request.url.host },
    });
  }) as Transport & { seen: TransportRequest[] };
  transport.seen = seen;
  return transport;
}

describe('alan adı kapısı', () => {
  it('yalnız listedeki alan adına ve varsayılan porta izin verir', () => {
    const hosts = ['api.example.com', 'data.example.org'];
    expect(hostAllowed(new URL('https://api.example.com/v1/x?y=1'), hosts)).toBe(true);
    expect(hostAllowed(new URL('http://API.EXAMPLE.COM./'), hosts)).toBe(true);
    expect(hostAllowed(new URL('https://data.example.org:443/'), hosts)).toBe(true);
    expect(hostAllowed(new URL('https://data.example.org:8443/'), hosts)).toBe(false);
    expect(hostAllowed(new URL('http://api.example.com:47820/'), hosts)).toBe(false);
    expect(hostAllowed(new URL('https://evil.com/'), hosts)).toBe(false);
    expect(hostAllowed(new URL('https://api.example.com.evil.com/'), hosts)).toBe(false);
    expect(hostAllowed(new URL('https://sub.api.example.com/'), hosts)).toBe(false);
    expect(hostAllowed(new URL('https://evil.com/?api.example.com'), hosts)).toBe(false);
    expect(hostAllowed(new URL('ftp://api.example.com/'), hosts)).toBe(false);
    expect(hostAllowed(new URL('file:///C:/Windows/win.ini'), hosts)).toBe(false);
  });

  it('yerel ağ adreslerini tanır (v4, v6 ve IPv4 gömen biçimler)', () => {
    const local = [
      '127.0.0.1', '127.255.255.254', '10.1.2.3', '192.168.1.10', '172.16.0.1', '172.31.255.255', '169.254.169.254',
      '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.255.255.250', '255.255.255.255', '192.0.2.1',
      '198.51.100.7', '203.0.113.9', '198.18.0.1',
      '::', '::1', '0:0:0:0:0:0:0:1', 'fd00::1', 'fc00::1', 'fe80::1', 'fe80::1%12', 'febf::1', 'fec0::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a00:1',
      '64:ff9b:1::1', '2002:7f00:1::', '2002:c0a8:0101::1', '2001:0:4136:e378::1', '2001:db8::1', '100::1',
      'yerel-ad', '',
    ];
    for (const address of local) expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ['8.8.8.8', '104.16.1.1', '93.184.215.14', '100.63.255.255', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe('ctx.fetch (safeFetch): sahte çözümleyici + sahte taşıyıcı', () => {
  const options = (extra: Record<string, Array<{ address: string; family: number }>> = {}) => {
    const lookup = fakeDns({ 'api.example.com': [PUBLIC], ...extra });
    const transport = fakeTransport();
    return { hosts: ['api.example.com'], lookup, transport };
  };

  it('izinli genel alan adına istek kapıdan geçer; bağlantı denetlenen adrese sabitlenir; sorgu eklenir', async () => {
    const o = options();
    const response = await safeFetch({ url: 'https://api.example.com/json', query: { q: 'döviz', n: 2 } }, o);
    expect(response.ok).toBe(true);
    expect(JSON.parse(response.body)).toEqual({ ok: true, query: { q: 'döviz', n: '2' } });
    expect(o.lookup.asked).toEqual(['api.example.com']);
    expect(o.transport.seen).toHaveLength(1);
    expect(o.transport.seen[0]!.pinned).toEqual(PUBLIC);
    expect(o.transport.seen[0]!.url.host).toBe('api.example.com');
  });

  it('izinsiz alan adı, port, şema ve kullanıcı bilgisi ağa (DNS dahil) çıkmadan reddedilir', async () => {
    const o = options();
    await expect(safeFetch({ url: 'http://example.com/' }, o)).rejects.toThrow(/izinli adresleri arasında değil/);
    await expect(safeFetch({ url: 'https://api.example.com:47820/' }, o)).rejects.toThrow(FetchError);
    await expect(safeFetch({ url: 'file:///C:/Windows/win.ini' }, o)).rejects.toThrow(/http ve https/);
    await expect(safeFetch({ url: 'https://user:pass@api.example.com/' }, o)).rejects.toThrow(/kullanıcı adı/);
    await expect(safeFetch({ url: 'adres değil' }, o)).rejects.toThrow(/Geçersiz adres/);
    expect(o.lookup.asked).toEqual([]);
    expect(o.transport.seen).toEqual([]);
  });

  it('yerel adres HER DURUMDA reddedilir: listede yazılı olsa da (eski manifest), yazıyla da, sayısal biçimle de', async () => {
    const transport = fakeTransport();
    const lookup = fakeDns({});
    const legacy = { hosts: ['127.0.0.1:47820', 'localhost', '[::1]', '2130706433', '10.0.0.5'], lookup, transport };
    await expect(safeFetch({ url: 'http://127.0.0.1:47820/v1/policy' }, legacy)).rejects.toThrow(/yerel ağdaki bir adres/);
    await expect(safeFetch({ url: 'http://localhost/' }, legacy)).rejects.toThrow(/bu bilgisayarın kendisi/);
    await expect(safeFetch({ url: 'http://[::1]/' }, legacy)).rejects.toThrow(FetchError);
    // URL ayrıştırıcısı "2130706433"ı 127.0.0.1'e çevirir; liste girdisi o biçimde eşleşmese de sonuç ret.
    await expect(safeFetch({ url: 'http://2130706433/' }, legacy)).rejects.toThrow(FetchError);
    await expect(safeFetch({ url: 'http://10.0.0.5/' }, legacy)).rejects.toThrow(/yerel ağdaki bir adres/);
    expect(transport.seen).toEqual([]);
  });

  it('izinli alan adı yerel ağa çözülüyorsa bağlanmadan reddeder (DNS rebinding)', async () => {
    for (const address of [
      { address: '127.0.0.1', family: 4 },
      { address: '192.168.1.1', family: 4 },
      { address: '::ffff:127.0.0.1', family: 6 },
      { address: '169.254.169.254', family: 4 },
    ]) {
      const transport = fakeTransport();
      const lookup = fakeDns({ 'rebind.example.com': [PUBLIC, address] });
      await expect(safeFetch({ url: 'https://rebind.example.com/json' }, { hosts: ['rebind.example.com'], lookup, transport })).rejects.toThrow(
        /yerel ağdaki bir adrese/,
      );
      expect(transport.seen, address.address).toEqual([]);
    }
  });

  it('yönlendirme her adımda yeniden denetlenir: izin listesi dışı ve yerele çözülen hedef izlenmez', async () => {
    const o = options();
    await expect(safeFetch({ url: 'https://api.example.com/redirect-out' }, o)).rejects.toThrow(/izinli adresleri arasında değil/);
    const followed = await safeFetch({ url: 'https://api.example.com/redirect-in' }, o);
    expect(JSON.parse(followed.body).query).toEqual({ via: 'redirect' });
    expect(o.lookup.asked).toEqual(['api.example.com', 'api.example.com', 'api.example.com']);

    // İzinli ikinci alan adına yönlendirme; o ad yerele çözülüyor → bağlanmadan ret.
    const lookup = fakeDns({ 'api.example.com': [PUBLIC], 'cdn.example.org': [{ address: '10.0.0.7', family: 4 }] });
    const transport = fakeTransport();
    await expect(
      safeFetch({ url: 'https://api.example.com/redirect-other' }, { hosts: ['api.example.com', 'cdn.example.org'], lookup, transport }),
    ).rejects.toThrow(/yerel ağdaki bir adrese/);
    expect(transport.seen.map((request) => request.url.host)).toEqual(['api.example.com']);
  });

  it('Host başlığını yetenek değiştiremez; gövde JSON gider', async () => {
    const o = options();
    const response = await safeFetch(
      { url: 'https://api.example.com/echo', method: 'POST', body: { a: 1 }, headers: { Host: 'evil.example', Cookie: 'x=1' } },
      o,
    );
    const echoed = JSON.parse(response.body) as { body: string; type: string; host: string; cookie: string | null };
    expect(echoed.body).toBe('{"a":1}');
    expect(echoed.type).toContain('application/json');
    expect(echoed.host).toBe('api.example.com');
    expect(echoed.cookie).toBe('x=1');
    expect(o.transport.seen[0]!.headers.host).toBeUndefined();
  });

  it('yanıt boyutunu ve süreyi sınırlar', async () => {
    const big = await safeFetch({ url: 'https://api.example.com/big' }, options());
    expect(big.truncated).toBe(true);
    expect(big.body.length).toBe(1_000_000);
    await expect(safeFetch({ url: 'https://api.example.com/slow', timeoutMs: 200 }, options())).rejects.toThrow(/zaman aşımı/);
  });

  it('desteklenmeyen yöntemi reddeder', async () => {
    await expect(safeFetch({ url: 'https://api.example.com/', method: 'CONNECT' }, options())).rejects.toThrow(/Desteklenmeyen yöntem/);
  });

  it('gerçek taşıyıcı da yerel adrese bağlanmaz (kapı taşıyıcıdan önce)', async () => {
    const before = hits.length;
    const lookup = fakeDns({ 'api.example.com': [{ address: '127.0.0.1', family: 4 }] });
    await expect(safeFetch({ url: `http://api.example.com/json` }, { hosts: ['api.example.com'], lookup })).rejects.toThrow(/yerel ağdaki/);
    expect(hits.length).toBe(before);
  });
});
