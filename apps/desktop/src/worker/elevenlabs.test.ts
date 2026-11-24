import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify, ElevenLabs, ElevenLabsError, type ElevenLabsConfig } from './elevenlabs';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: Record<string, unknown>) => void;

let server: http.Server;
let handler: Handler;
let requests: Array<{ method: string; url: string; key: string | undefined; body: Record<string, unknown> }>;
let clients: ElevenLabs[];

beforeEach(async () => {
  requests = [];
  clients = [];
  handler = (_req, res) => {
    res.writeHead(200);
    res.end(Buffer.alloc(4800));
  };
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch {
        // Gövdesiz istek.
      }
      requests.push({ method: req.method ?? '', url: req.url ?? '', key: req.headers['xi-api-key'] as string | undefined, body });
      if (req.method !== 'POST') {
        // Gerçek sunucu HEAD'e gövdesiz 405 döner ve bağlantıyı açık tutar.
        res.writeHead(405, { 'content-length': '0' });
        res.end();
        return;
      }
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterEach(async () => {
  for (const client of clients) client.stop();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(overrides: Partial<ElevenLabsConfig> = {}): ElevenLabs {
  const instance = new ElevenLabs({
    apiKey: 'gizli-anahtar',
    voiceId: 'ses1',
    model: 'eleven_flash_v2_5',
    languageCode: 'tr',
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    firstChunkTimeoutMs: 300,
    stallTimeoutMs: 300,
    charBudget: null,
    ...overrides,
  });
  clients.push(instance);
  return instance;
}

const collect = () => {
  const chunks: Int16Array[] = [];
  return { chunks, onChunk: (chunk: { pcm: Int16Array }) => void chunks.push(chunk.pcm), total: () => chunks.reduce((sum, chunk) => sum + chunk.length, 0) };
};

describe('ElevenLabs bağlayıcısı', () => {
  it('akışı parça parça verir; tek baytlık bölünmelerde örnek kaybetmez', async () => {
    const audio = Buffer.alloc(9600);
    for (let i = 0; i < 4800; i++) audio.writeInt16LE(i % 2 === 0 ? 1000 : -1000, i * 2);
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'audio/pcm' });
      // Parçalar örnek sınırına denk gelmez.
      res.write(audio.subarray(0, 3001));
      setTimeout(() => res.write(audio.subarray(3001, 6002)), 10);
      setTimeout(() => res.end(audio.subarray(6002)), 20);
    };
    const sink = collect();
    const result = await client().speak('Merhaba efendim.', sink.onChunk);
    expect(result).toMatchObject({ samples: 4800, chars: 16, cancelled: false });
    expect(result.firstChunkMs).toBeGreaterThanOrEqual(0);
    expect(sink.total()).toBe(4800);
    const joined = Int16Array.from(sink.chunks.flatMap((chunk) => [...chunk]));
    expect(joined[0]).toBe(1000);
    expect(joined[1]).toBe(-1000);
    expect(joined[4799]).toBe(-1000);
    const post = requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('/v1/text-to-speech/ses1/stream?output_format=pcm_24000');
    expect(post?.key).toBe('gizli-anahtar');
    expect(post?.body).toEqual({ text: 'Merhaba efendim.', model_id: 'eleven_flash_v2_5', language_code: 'tr' });
  });

  it('language_code yalnız destekleyen modelde gönderilir', async () => {
    await client({ model: 'eleven_multilingual_v2' }).speak('Merhaba.', () => {});
    expect(requests.at(-1)?.body).toEqual({ text: 'Merhaba.', model_id: 'eleven_multilingual_v2' });
    await client({ model: 'eleven_v3' }).speak('Merhaba.', () => {});
    expect(requests.at(-1)?.body.language_code).toBe('tr');
  });

  it('model language_code kabul etmezse parametresiz bir kez daha dener ve hatırlar', async () => {
    handler = (_req, res, body) => {
      if (body.language_code) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: { status: 'unsupported_language', message: 'language_code is not supported' } }));
        return;
      }
      res.writeHead(200);
      res.end(Buffer.alloc(2400));
    };
    const instance = client();
    expect((await instance.speak('Bir.', () => {})).samples).toBe(1200);
    await instance.speak('İki.', () => {});
    expect(requests.filter((request) => request.method === 'POST').map((request) => request.body.language_code ?? null)).toEqual(['tr', null, null]);
  });

  it.each([
    [401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }, 'unauthorized'],
    [401, { detail: { status: 'quota_exceeded', message: 'quota' } }, 'quota'],
    [402, { detail: { status: 'payment_required', message: 'Free users cannot use library voices' } }, 'payment'],
    [429, { detail: { status: 'too_many_concurrent_requests', message: 'busy' } }, 'rate_limit'],
    [404, { detail: { status: 'voice_not_found', message: 'no voice' } }, 'server'],
    [500, { detail: 'boom' }, 'server'],
  ] as const)('HTTP %i %j → %s', async (status, body, reason) => {
    handler = (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const error = await client()
      .speak('Merhaba.', () => {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ElevenLabsError);
    expect(error).toMatchObject({ reason, status, samples: 0 });
    expect((error as Error).message).not.toContain('gizli-anahtar');
  });

  it('anahtar yokken sunucuya gitmez', async () => {
    await expect(client({ apiKey: '' }).speak('Merhaba.', () => {})).rejects.toMatchObject({ reason: 'no_key' });
    expect(requests).toHaveLength(0);
  });

  it('ilk parça süresinde gelmezse zaman aşımı; bağlantı kapatılır', async () => {
    let closed = false;
    handler = (req) => {
      req.socket.on('close', () => {
        closed = true;
      });
    };
    const started = Date.now();
    await expect(client().speak('Merhaba.', () => {})).rejects.toMatchObject({ reason: 'timeout', samples: 0 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    expect(Date.now() - started).toBeLessThan(1500);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(true);
  });

  it('ses başladıktan sonra kopma ya da duraksama: ne kadarının verildiği bildirilir', async () => {
    handler = (req, res) => {
      res.writeHead(200);
      res.write(Buffer.alloc(4800));
      setTimeout(() => req.socket.destroy(), 30);
    };
    const sink = collect();
    await expect(client().speak('Merhaba.', sink.onChunk)).rejects.toMatchObject({ reason: 'interrupted', samples: 2400 });
    expect(sink.total()).toBe(2400);

    handler = (_req, res) => {
      res.writeHead(200);
      res.write(Buffer.alloc(4800));
    };
    await expect(client().speak('Merhaba.', () => {})).rejects.toMatchObject({ reason: 'interrupted', samples: 2400 });
  });

  it('iptal: istek kesilir, hata fırlatılmaz, sonradan parça gelmez', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => {
        if (res.destroyed) clearInterval(timer);
        else res.write(Buffer.alloc(4800));
      }, 10);
    };
    const instance = client();
    const sink = collect();
    const pending = instance.speak('Uzun bir cümle.', sink.onChunk);
    await new Promise((resolve) => setTimeout(resolve, 80));
    instance.cancel();
    const result = await pending;
    expect(result.cancelled).toBe(true);
    const delivered = sink.total();
    expect(delivered).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sink.total()).toBe(delivered);
  });

  it('sınama karakter sınırı aşılacaksa sunucuya gitmez', async () => {
    const instance = client({ charBudget: 20 });
    await instance.speak('On iki harf.', () => {});
    expect(instance.spentChars).toBe(12);
    await expect(instance.speak('Dokuz harf', () => {})).rejects.toMatchObject({ reason: 'budget' });
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });

  it('ısıtma boşta soket yokken bağlantı açar; cümle isteği aynı bağlantıdan gider', async () => {
    const sockets = new Set<unknown>();
    server.on('connection', (socket) => sockets.add(socket));
    const instance = client();
    instance.prewarm();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(requests.map((request) => request.method)).toEqual(['HEAD']);
    instance.prewarm();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(requests).toHaveLength(1);
    await instance.speak('Merhaba.', () => {});
    expect(sockets.size).toBe(1);
  });

  it('hata gövdesi sınıflandırması', () => {
    expect(classify(401, '{"detail":{"status":"quota_exceeded","message":"x"}}').reason).toBe('quota');
    expect(classify(403, '').reason).toBe('unauthorized');
    expect(classify(400, '{"detail":{"status":"only_for_paid_plan_subscription","message":"x"}}').reason).toBe('payment');
    expect(classify(503, 'gateway').reason).toBe('server');
  });
});
