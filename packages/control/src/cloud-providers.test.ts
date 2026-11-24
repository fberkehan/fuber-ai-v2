// OpenAI uyumlu sağlayıcı anahtarlarının sınanması ve model listesi (kayıtlı örnek yanıtlarla; ağa çıkılmaz), kontrol
// servisinde politika bağ denetimi, kasadan cihaza dağıtım ve "fiyat bilinmiyor" kullanımı.
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CLOUD_ENDPOINTS, type CloudEndpoint, type UsageEvent } from '@fuber/shared';
import { createControlClient } from './client';
import { listCloudModels, testProviderKey, type FetchLike } from './providers';
import { createControlService, type ControlService } from './service';
import { ADMIN_TOKEN, fakeSecrets, memoryLogger, tempDir } from './test-helpers';

const KEY = 'sk-' + 'or-FAKE-control-0000000000';
const ep = (preset: CloudEndpoint['preset'], patch: Partial<CloudEndpoint> = {}): CloudEndpoint => ({
  ...(DEFAULT_CLOUD_ENDPOINTS.find((item) => item.preset === preset) ?? { id: 'ozel', preset: 'custom', name: 'Özel', baseUrl: 'http://127.0.0.1:9/v1', keyId: 'custom', model: 'm', caps: { tools: true, vision: false, stream: true } }),
  ...patch,
});

/** Yol → yanıt tablosu; istenen her adres kaydedilir. */
function routes(table: Record<string, [number, unknown]>) {
  const seen: Array<{ url: string; auth: string | null; body: string | null }> = [];
  const fetch: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url, auth: headers.authorization ?? null, body: typeof init?.body === 'string' ? init.body : null });
    const hit = Object.entries(table).find(([suffix]) => url.endsWith(suffix));
    if (!hit) return new Response('yok', { status: 404 });
    const [status, body] = hit[1];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, seen };
}

describe('anahtar sınaması (geçerli / kredisiz / hatalı)', () => {
  it('OpenRouter: /models herkese açık olduğu için anahtar /key ile sınanır; kredi /credits ile', async () => {
    const valid = routes({ '/api/v1/key': [200, { data: { limit_remaining: null } }], '/api/v1/credits': [200, { data: { total_credits: 10, total_usage: 2.5 } }] });
    expect(await testProviderKey('openrouter', KEY, { fetch: valid.fetch, endpoint: ep('openrouter') })).toMatchObject({ status: 'valid', message: 'Geçerli; hesapta kredi var.' });
    expect(valid.seen.map((s) => s.url)).toEqual(['https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/credits']);
    expect(valid.seen[0]!.auth).toBe(`Bearer ${KEY}`);

    const broke = routes({ '/api/v1/key': [200, { data: { limit_remaining: null } }], '/api/v1/credits': [200, { data: { total_credits: 5, total_usage: 5 } }] });
    expect(await testProviderKey('openrouter', KEY, { fetch: broke.fetch, endpoint: ep('openrouter') })).toMatchObject({ status: 'no_credit' });

    const wrong = routes({ '/api/v1/key': [401, { error: { message: 'No auth credentials found', code: 401 } }] });
    const result = await testProviderKey('openrouter', KEY, { fetch: wrong.fetch, endpoint: ep('openrouter') });
    expect(result).toMatchObject({ status: 'invalid', httpStatus: 401 });
    expect(result.message).not.toContain(KEY);
  });

  it('Moonshot: bakiye ucu (available_balance)', async () => {
    const rich = routes({ '/v1/users/me/balance': [200, { code: 0, data: { available_balance: 12.3, voucher_balance: 0, cash_balance: 12.3 } }] });
    expect(await testProviderKey('moonshot', KEY, { fetch: rich.fetch, endpoint: ep('moonshot') })).toMatchObject({ status: 'valid' });
    const empty = routes({ '/v1/users/me/balance': [200, { code: 0, data: { available_balance: 0 } }] });
    expect(await testProviderKey('moonshot', KEY, { fetch: empty.fetch, endpoint: ep('moonshot') })).toMatchObject({ status: 'no_credit' });
  });

  it('OpenAI (kayıt varken): liste + seçili modele 1 tokenlık istek; kota bitmişse kredisiz', async () => {
    const quota = routes({
      '/v1/models': [200, { data: [{ id: 'gpt-5-mini' }] }],
      '/v1/chat/completions': [429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }],
    });
    expect(await testProviderKey('openai', KEY, { fetch: quota.fetch, endpoint: ep('openai') })).toMatchObject({ status: 'no_credit', httpStatus: 429 });
    expect(JSON.parse(quota.seen[1]!.body!)).toMatchObject({ model: 'gpt-5-mini', max_completion_tokens: 16 });
    const fine = routes({ '/v1/models': [200, { data: [] }], '/v1/chat/completions': [200, { choices: [] }] });
    expect(await testProviderKey('openai', KEY, { fetch: fine.fetch, endpoint: ep('openai') })).toMatchObject({ status: 'valid' });
  });

  it('özel adres: kayıt yoksa "adres yok"; model listesi ucu yoksa tanındı sayılmaz, açıkça yazılır', async () => {
    expect(await testProviderKey('custom', KEY, { endpoint: null })).toMatchObject({ status: 'invalid', message: expect.stringContaining('adresi tanımlı değil') });
    const noList = routes({});
    expect(await testProviderKey('custom', KEY, { fetch: noList.fetch, endpoint: ep('custom') })).toMatchObject({ status: 'recognized', httpStatus: 404 });
  });

  it('ağ hatası → ulaşılamadı', async () => {
    const down: FetchLike = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    expect(await testProviderKey('moonshot', KEY, { fetch: down, endpoint: ep('moonshot') })).toMatchObject({ status: 'unreachable' });
  });
});

describe('model listesi', () => {
  it('OpenRouter listesi fiyat ve yetenekle gelir', async () => {
    const list = routes({
      '/api/v1/models': [200, { data: [{ id: 'moonshotai/kimi-k2', name: 'Kimi K2', pricing: { prompt: '0.000001', completion: '0.000003' }, supported_parameters: ['tools'] }] }],
    });
    expect(await listCloudModels(ep('openrouter'), KEY, { fetch: list.fetch })).toEqual([
      { id: 'moonshotai/kimi-k2', displayName: 'Kimi K2', tools: true, vision: null, contextTokens: null, price: { input: 1, output: 3 } },
    ]);
  });

  it('sağlayıcı reddederse anlaşılır hata', async () => {
    const bad = routes({ '/v1/models': [401, { error: { message: 'bad key' } }] });
    await expect(listCloudModels(ep('openai'), KEY, { fetch: bad.fetch })).rejects.toThrow(/Anahtar reddedildi \(401\)/);
  });
});

describe('kontrol servisi', () => {
  let tmp: ReturnType<typeof tempDir>;
  let service: ControlService;
  let url: string;
  const fake = routes({
    '/api/v1/key': [200, { data: { limit_remaining: null } }],
    '/api/v1/credits': [200, { data: { total_credits: 1, total_usage: 1 } }],
    '/lm/v1/models': [200, { data: [{ id: 'qwen3-8b' }] }],
  });

  beforeEach(async () => {
    tmp = tempDir();
    service = createControlService({ dbPath: path.join(tmp.dir, 'control.db'), secrets: fakeSecrets(), adminToken: ADMIN_TOKEN, log: memoryLogger(), fetch: fake.fetch });
    ({ url } = await service.start(0));
  });
  afterEach(async () => {
    await service.close();
    tmp.cleanup();
  });

  it('olmayan sağlayıcı kaydına bağlanan rol reddedilir (masaüstü beyinsiz kalmasın)', async () => {
    const base = await service.admin.getPolicy();
    await expect(
      service.admin.updatePolicy({ baseRevision: base.revision, patch: { models: { voice: { provider: 'openai-compatible', endpoint: 'yok' } } }, note: '' }),
    ).rejects.toThrow(/"yok" adlı sağlayıcı kaydı yok/);
    const next = await service.admin.updatePolicy({ baseRevision: base.revision, patch: { models: { voice: { provider: 'openai-compatible', endpoint: 'openrouter', model: 'moonshotai/kimi-k2' } } }, note: 'Kimi' });
    expect(next.models.voice).toMatchObject({ provider: 'openai-compatible', endpoint: 'openrouter' });
  });

  it('anahtar kasadan onaylı cihaza iner; sınama politikadaki kaydın adresiyle yapılır; kredisiz durum ayrılır', async () => {
    await service.admin.setKey('openrouter', KEY);
    const test = await service.admin.testKey('openrouter');
    expect(test.status).toBe('no_credit');
    const client = createControlClient({ baseUrl: url });
    await client.register({ name: 'e2e', platform: 'win32', arch: 'x64', appVersion: '2.0.0', installId: 'install-cloud-1' });
    const polled = await client.getPolicy();
    expect(polled.changed && polled.envelope.policy.keys.openrouter).toBe(KEY);
    const audit = await service.admin.listAudit(50);
    expect(JSON.stringify(audit)).not.toContain(KEY);
  });

  it('özel adres: kaydedilmemiş (taslak) adresle model listesi çekilir', async () => {
    await service.admin.setKey('custom', 'local-key-00000000');
    const models = await service.admin.listCloudModels('lm', { preset: 'custom', keyId: 'custom', baseUrl: 'http://lm.example/lm/v1' });
    expect(models.map((m) => m.id)).toEqual(['qwen3-8b']);
    await expect(service.admin.listCloudModels('hic-yok')).rejects.toThrow(/sağlayıcı kaydı yok/);
  });

  it('kullanım: fiyatı bilinmeyen çağrılar ayrı sayılır (0 diye toplanmaz)', async () => {
    const client = createControlClient({ baseUrl: url });
    await client.register({ name: 'e2e', platform: 'win32', arch: 'x64', appVersion: '2.0.0', installId: 'install-cloud-2' });
    const event = (id: string, extra: Partial<UsageEvent>): UsageEvent => ({
      id, at: new Date().toISOString(), kind: 'voice', provider: 'openrouter', model: 'moonshotai/kimi-k2',
      inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, audioSeconds: 0, costUsd: 0, durationMs: 100, ...extra,
    });
    await client.sendUsage([event('a', { costKnown: false }), event('b', { costKnown: false }), event('c', { provider: 'anthropic', model: 'claude-haiku-5-5', costUsd: 0.002 })]);
    const summary = await service.admin.usageSummary(1);
    const today = summary.days[0]!;
    expect(today.unpricedCalls).toBe(2);
    expect(today.costUsd).toBeCloseTo(0.002, 6);
    expect(today.byModel.find((m) => m.provider === 'openrouter')).toMatchObject({ calls: 2, unpricedCalls: 2 });
  });
});
