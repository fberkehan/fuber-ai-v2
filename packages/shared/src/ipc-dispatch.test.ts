import { describe, expect, it, vi } from 'vitest';
import { createIpcDispatcher, UserError } from './ipc-dispatch';

interface TestApi {
  'math.double': { req: { n: number }; res: number };
  'app.ping': { req: void; res: string };
}

describe('createIpcDispatcher', () => {
  it('kayıtlı işleyiciyi çağırır ve sonucu zarflar', async () => {
    const router = createIpcDispatcher<TestApi, { sender: number }>();
    router.handle('math.double', ({ n }, ctx) => n * 2 + ctx.sender);
    router.handle('app.ping', async () => 'pong');
    expect(await router.dispatch('math.double', { n: 4 }, { sender: 1 })).toEqual({ ok: true, data: 9 });
    expect(await router.dispatch('app.ping', undefined, { sender: 1 })).toEqual({ ok: true, data: 'pong' });
    expect(router.channels()).toEqual(['app.ping', 'math.double']);
  });

  it('bilinmeyen kanalda hata zarfı döner ve bildirir', async () => {
    const onError = vi.fn();
    const router = createIpcDispatcher<TestApi>({ onError });
    const result = await router.dispatch('yok.boyle', null, undefined);
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown_channel', channel: 'yok.boyle' } });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('UserError iletisini olduğu gibi, diğer hataları genel iletiyle taşır', async () => {
    const onError = vi.fn();
    const router = createIpcDispatcher<TestApi>({ onError });
    router.handle('app.ping', () => {
      throw new UserError('Bu ad zaten kullanılıyor.');
    });
    router.handle('math.double', () => {
      throw new TypeError('gizli iç ayrıntı');
    });
    expect(await router.dispatch('app.ping', undefined, undefined)).toEqual({
      ok: false,
      error: { code: 'handler_error', channel: 'app.ping', message: 'Bu ad zaten kullanılıyor.' },
    });
    const wrapped = await router.dispatch('math.double', { n: 1 }, undefined);
    expect(wrapped).toMatchObject({ ok: false, error: { code: 'handler_error' } });
    expect(JSON.stringify(wrapped)).not.toContain('gizli iç ayrıntı');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('aynı kanalın ikinci kaydını reddeder', () => {
    const router = createIpcDispatcher<TestApi>();
    router.handle('app.ping', () => 'a');
    expect(() => router.handle('app.ping', () => 'b')).toThrow();
  });

  it('handleAll bir alanın kanallarını topluca bağlar', async () => {
    const router = createIpcDispatcher<TestApi>();
    router.handleAll({ 'app.ping': () => 'pong', 'math.double': ({ n }) => n * 2 });
    expect(await router.dispatch('math.double', { n: 21 }, undefined)).toEqual({ ok: true, data: 42 });
  });
});
