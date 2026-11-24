import { describe, expect, it } from 'vitest';
import { ANTHROPIC_TEST_MESSAGES, ELEVENLABS_DEFAULT_VOICE, listAnthropicModels, summarizeBody, testProviderKey, type FetchLike } from './providers';

const KEY = 'test-key-ABCDEFGH12345678';

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(route: Route): FetchLike & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return route(url, init);
  }) as FetchLike & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sağlayıcı sınaması', () => {
  const anthropicModels = json(200, { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }], has_more: false });

  it('Anthropic: liste + 1 token\'lık istek 200 → geçerli, kredi var; en ucuz model, doğru başlıklar', async () => {
    const fetch = fakeFetch((url) => (url.includes('/v1/models') ? anthropicModels.clone() : json(200, { content: [] })));
    const result = await testProviderKey('anthropic', KEY, { fetch });
    expect(result).toMatchObject({ status: 'valid', message: ANTHROPIC_TEST_MESSAGES.valid });
    const headers = fetch.calls[0]!.init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(fetch.calls[0]!.url).toContain('/v1/models');
    expect(fetch.calls[1]!.url).toContain('/v1/messages');
    expect(JSON.parse(String(fetch.calls[1]!.init!.body))).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 1 });
  });

  it('Anthropic: liste 200 ama mesaj 400 "credit balance is too low" → kredi yok (plan yetersiz)', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('/v1/models')
        ? anthropicModels.clone()
        : json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }),
    );
    const result = await testProviderKey('anthropic', KEY, { fetch });
    expect(result).toMatchObject({ status: 'insufficient_plan', httpStatus: 400 });
    expect(result.message).toContain(ANTHROPIC_TEST_MESSAGES.noCredit);
    expect(result.message).toContain('credit balance is too low');
  });

  it('Anthropic: mesaj isteği karar vermezse (529) → "anahtar tanındı", geçerli sayılır', async () => {
    const fetch = fakeFetch((url) => (url.includes('/v1/models') ? anthropicModels.clone() : json(529, { error: { type: 'overloaded_error' } })));
    const result = await testProviderKey('anthropic', KEY, { fetch });
    expect(result.status).toBe('valid');
    expect(result.message.startsWith(ANTHROPIC_TEST_MESSAGES.recognized)).toBe(true);
  });

  it('ElevenLabs: 401 quota_exceeded → kota doldu (geçersiz değil)', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('subscription') ? json(200, { tier: 'free' }) : json(401, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } }),
    );
    const result = await testProviderKey('elevenlabs', KEY, { fetch });
    expect(result.status).toBe('insufficient_plan');
    expect(result.message).toMatch(/Kota doldu/);
  });

  it('ElevenLabs: ses seçilmemişse masaüstüyle aynı varsayılan ses (Daniel) denenir', async () => {
    const fetch = fakeFetch((url) => (url.includes('subscription') ? json(200, { tier: 'free' }) : new Response(new Uint8Array([1]), { status: 200 })));
    await testProviderKey('elevenlabs', KEY, { fetch });
    expect(fetch.calls[1]!.url).toContain(`/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE}`);
    expect(ELEVENLABS_DEFAULT_VOICE).toBe('onwK4e9ZLuTAKqWW03F9');
  });

  it('Anthropic: 401 geçersiz, hata gövdesi açıklamada korunur', async () => {
    const fetch = fakeFetch(() =>
      json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    );
    const result = await testProviderKey('anthropic', KEY, { fetch });
    expect(result).toMatchObject({ status: 'invalid', httpStatus: 401 });
    expect(result.message).toContain('authentication_error');
    expect(result.message).toContain('invalid x-api-key');
  });

  it('ElevenLabs: abonelik 200 + seslendirme 402 → plan yetersiz (gövde korunur)', async () => {
    const fetch = fakeFetch((url) => {
      if (url.includes('/v1/user/subscription')) return json(200, { tier: 'free' });
      if (url.includes('/v1/text-to-speech/'))
        return json(402, { detail: { status: 'payment_required', message: 'Free users cannot use library voices via the API.' } });
      return json(404, {});
    });
    const result = await testProviderKey('elevenlabs', KEY, { fetch });
    expect(result).toMatchObject({ status: 'insufficient_plan', httpStatus: 402 });
    expect(result.message).toContain('plan: free');
    expect(result.message).toContain('Free users cannot use library voices');
  });

  it('ElevenLabs: politikada seçili ses ve modelle dener', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('subscription') ? json(200, { tier: 'free' }) : new Response(new Uint8Array([1]), { status: 200 }),
    );
    await testProviderKey('elevenlabs', KEY, { fetch, elevenLabs: { voiceId: 'libVoice123', model: 'eleven_v3' } });
    const tts = fetch.calls[1]!;
    expect(tts.url).toContain('/v1/text-to-speech/libVoice123');
    expect(JSON.parse(String(tts.init!.body))).toMatchObject({ model_id: 'eleven_v3' });
  });

  it('ElevenLabs: abonelik 401 → geçersiz, seslendirme denenmez', async () => {
    const fetch = fakeFetch(() => json(401, { detail: { status: 'invalid_api_key' } }));
    const result = await testProviderKey('elevenlabs', KEY, { fetch });
    expect(result.status).toBe('invalid');
    expect(fetch.calls).toHaveLength(1);
  });

  it('ElevenLabs: ikisi de başarılı → geçerli', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('subscription') ? json(200, { tier: 'creator' }) : new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    expect((await testProviderKey('elevenlabs', KEY, { fetch })).status).toBe('valid');
  });

  it('Gemini: 400 API_KEY_INVALID → geçersiz', async () => {
    const fetch = fakeFetch(() => json(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }));
    const result = await testProviderKey('gemini', KEY, { fetch });
    expect(result.status).toBe('invalid');
    expect(fetch.calls[0]!.url).toContain('generativelanguage.googleapis.com');
  });

  it('OpenAI: 200 geçerli', async () => {
    const fetch = fakeFetch(() => json(200, { data: [] }));
    expect((await testProviderKey('openai', KEY, { fetch })).status).toBe('valid');
  });

  it('ağ hatası → ulaşılamıyor (fırlatmaz)', async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' } });
    });
    const result = await testProviderKey('anthropic', KEY, { fetch });
    expect(result.status).toBe('unreachable');
    expect(result.message).toContain('ENOTFOUND');
  });

  it('zaman aşımı → ulaşılamıyor', async () => {
    const fetch = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const result = await testProviderKey('openai', KEY, { fetch, timeoutMs: 50 });
    expect(result.status).toBe('unreachable');
    expect(result.message).toMatch(/yanıt gelmedi/);
  });

  it('5xx → ulaşılamıyor; anahtar gövdede yankılanırsa gizlenir', async () => {
    const fetch = fakeFetch(() => new Response(`upstream error for key ${KEY}`, { status: 503 }));
    const result = await testProviderKey('anthropic', KEY, { fetch });
    expect(result.status).toBe('unreachable');
    expect(result.message).not.toContain(KEY);
    expect(result.message).toContain('***');
  });
});

describe('listeler', () => {
  it('Anthropic modelleri sayfalanarak toplanır', async () => {
    const fetch = fakeFetch((url) =>
      url.includes('after_id')
        ? json(200, { data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }], has_more: false })
        : json(200, { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }], has_more: true, last_id: 'claude-opus-5-5' }),
    );
    const models = await listAnthropicModels(KEY, { fetch });
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
  });

  it('summarizeBody tek satıra indirir ve kısaltır', () => {
    expect(summarizeBody('a\n  b\t c', 'xxxxxxxxxxxx')).toBe('a b c');
    expect(summarizeBody('x'.repeat(400), 'yyyyyyyyyy', 10)).toBe(`${'x'.repeat(10)}…`);
  });
});
