import { describe, expect, it, vi } from 'vitest';
import { parsePluginPageRoute, pluginPageRoute } from '../../../main/modules/workshop/types';
import { answerFrameRequest, createRateLimiter, FRAME_MAX_PAYLOAD, isFrameRequest, type FrameBackend } from './frame-protocol';
import { PLUGIN_ICON_KEYS, pluginIconKey } from './plugin-icons';
import { addsBadges, classifyAdd, classifyPermission, isLocalHost } from './preview-logic';

describe('simge haritası', () => {
  it('bilinen adlar kendine, eş anlamlılar karşılığına, bilinmeyen puzzle olur', () => {
    for (const key of PLUGIN_ICON_KEYS) expect(pluginIconKey(key)).toBe(key);
    expect(pluginIconKey('  Timer ')).toBe('timer');
    expect(pluginIconKey('pomodoro')).toBe('timer');
    expect(pluginIconKey('rocket')).toBe('puzzle');
    expect(pluginIconKey('')).toBe('puzzle');
    expect(pluginIconKey(undefined)).toBe('puzzle');
  });
});

describe('sayfa rotası', () => {
  it('üretilen rota geri ayrıştırılır, bozuk rota null verir', () => {
    expect(parsePluginPageRoute(pluginPageRoute('pomodoro', 'main'))).toEqual({ skillId: 'pomodoro', pageId: 'main' });
    expect(parsePluginPageRoute('today')).toBeNull();
    expect(parsePluginPageRoute('plugin:Bad:x')).toBeNull();
    expect(parsePluginPageRoute('plugin:a')).toBeNull();
  });
});

describe('çerçeve iletisi doğrulaması', () => {
  it('geçerli istekleri kabul eder', () => {
    expect(isFrameRequest({ fuberPlugin: 1, id: 1, op: 'call', tool: 'say', input: { a: 1 } })).toBe(true);
    expect(isFrameRequest({ fuberPlugin: 1, id: 2, op: 'storage.get', key: 'k' })).toBe(true);
    expect(isFrameRequest({ fuberPlugin: 1, id: 3, op: 'storage.set', key: 'k', value: null })).toBe(true);
    expect(isFrameRequest({ fuberPlugin: 1, id: 4, op: 'storage.delete', key: 'k' })).toBe(true);
    expect(isFrameRequest({ fuberPlugin: 1, id: 5, op: 'settings.get', key: 'k' })).toBe(true);
  });

  it('bozuk biçimleri reddeder', () => {
    expect(isFrameRequest(null)).toBe(false);
    expect(isFrameRequest('x')).toBe(false);
    expect(isFrameRequest([])).toBe(false);
    expect(isFrameRequest({ id: 1, op: 'call', tool: 'x' })).toBe(false);
    expect(isFrameRequest({ fuberPlugin: 2, id: 1, op: 'call', tool: 'x' })).toBe(false);
    expect(isFrameRequest({ fuberPlugin: 1, id: '1', op: 'call', tool: 'x' })).toBe(false);
    expect(isFrameRequest({ fuberPlugin: 1, id: 1.5, op: 'call', tool: 'x' })).toBe(false);
    expect(isFrameRequest({ fuberPlugin: 1, id: 1, op: 'exec', tool: 'x' })).toBe(false);
    expect(isFrameRequest({ fuberPlugin: 1, id: 1, op: 'call', tool: '' })).toBe(false);
    expect(isFrameRequest({ fuberPlugin: 1, id: 1, op: 'storage.set', key: 'k' })).toBe(false);
    expect(isFrameRequest({ fuberPlugin: 1, id: 1, op: 'storage.get', key: 'x'.repeat(201) })).toBe(false);
  });

  it('aşırı büyük yükü ve döngüsel yapıyı reddeder', () => {
    expect(isFrameRequest({ fuberPlugin: 1, id: 1, op: 'call', tool: 'x', input: 'a'.repeat(FRAME_MAX_PAYLOAD + 1) })).toBe(false);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(isFrameRequest({ fuberPlugin: 1, id: 1, op: 'storage.set', key: 'k', value: loop })).toBe(false);
  });
});

describe('istek sınırlayıcı', () => {
  it('pencere içinde sınırı aşanı keser, pencere kayınca yeniden verir', () => {
    let now = 1000;
    const allow = createRateLimiter(3, 1000, () => now);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
    now += 999;
    expect(allow()).toBe(false);
    now += 2;
    expect(allow()).toBe(true);
  });
});

describe('isteğin yanıta çevrilmesi', () => {
  const backend = (): FrameBackend => ({
    pageCall: vi.fn(async ({ tool }) => (tool === 'bad' ? { ok: false, text: 'olmadı' } : { ok: true, text: 'tamam', data: { n: 1 } })),
    pageStorage: vi.fn(async ({ op, key }) => ({ found: op === 'get' && key === 'var', value: 'v' })),
    settings: vi.fn(async () => [{ key: 'limit', label: 'Limit', type: 'number' as const, default: 5, value: 9 }]),
  });

  it('araç çağrısı başarıda metin ve veri, başarısızlıkta hata döndürür', async () => {
    const b = backend();
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 7, op: 'call', tool: 'ok', input: {} }, b)).toEqual({ fuberPlugin: 1, id: 7, ok: true, value: { text: 'tamam', data: { n: 1 } } });
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 8, op: 'call', tool: 'bad', input: {} }, b)).toEqual({ fuberPlugin: 1, id: 8, ok: false, error: 'olmadı' });
  });

  it('depo ve ayar işlemleri', async () => {
    const b = backend();
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 1, op: 'storage.get', key: 'var' }, b)).toMatchObject({ ok: true, value: 'v' });
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 2, op: 'storage.get', key: 'yok' }, b)).toMatchObject({ ok: true, value: null });
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 3, op: 'storage.set', key: 'k', value: 1 }, b)).toMatchObject({ ok: true, value: true });
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 4, op: 'settings.get', key: 'limit' }, b)).toMatchObject({ ok: true, value: 9 });
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 5, op: 'settings.get', key: 'yok' }, b)).toMatchObject({ ok: true, value: null });
  });

  it('IPC hatası fırlatmaz, hata yanıtına döner ve Electron sarmalını soyar', async () => {
    const b = backend();
    b.pageCall = vi.fn(async () => {
      throw new Error("Error invoking remote method 'plugins.pageCall': Error: izin yok");
    });
    expect(await answerFrameRequest('s', 'p', { fuberPlugin: 1, id: 9, op: 'call', tool: 'x', input: null }, b)).toEqual({ fuberPlugin: 1, id: 9, ok: false, error: 'izin yok' });
  });
});

describe('önizleme mantığı', () => {
  it('rozetlerde sıfırlar gösterilmez, sıra sabit', () => {
    expect(addsBadges({ tools: 2, cards: 0, pages: 1, voice: 3 })).toEqual([
      { kind: 'tools', count: 2 },
      { kind: 'pages', count: 1 },
      { kind: 'voice', count: 3 },
    ]);
    expect(addsBadges(undefined)).toEqual([]);
  });

  it('ekleme satırlarını türe göre sınıflar', () => {
    expect(classifyAdd('Bugün panosuna “BTC fiyatı” kartı')).toBe('cards');
    expect(classifyAdd('Her gün 09:00’da çalışan iş')).toBe('jobs');
    expect(classifyAdd('Yan menüde “Pomodoro” sayfası')).toBe('pages');
    expect(classifyAdd('Sesli komut: “molaya geç”')).toBe('voice');
    expect(classifyAdd('2 araç')).toBe('tools');
    expect(classifyAdd('Başka bir şey')).toBe('other');
  });

  it('izin satırlarını önce yapılandırılmış alanlara, sonra sözcüklere göre sınıflar', () => {
    const preview = { hosts: ['api.coindesk.com'], roots: ['{belgeler}/notlar'], usedTools: ['memory_add'] };
    expect(classifyPermission('api.coindesk.com adresine bağlanır', preview)).toBe('net');
    expect(classifyPermission('{belgeler}/notlar klasörünü okur', preview)).toBe('files');
    expect(classifyPermission('memory_add aracını çağırır', preview)).toBe('tools');
    expect(classifyPermission('Sessiz bildirim gönderir')).toBe('notify');
    expect(classifyPermission('Sesli duyuru yapar')).toBe('speak');
    expect(classifyPermission('Bilinmeyen')).toBe('other');
  });

  it('yerel adresleri tanır', () => {
    expect(isLocalHost('localhost:3000')).toBe(true);
    expect(isLocalHost('192.168.1.5')).toBe(true);
    expect(isLocalHost('api.example.com')).toBe(false);
  });
});
