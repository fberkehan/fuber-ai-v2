import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionApi, ModuleContext, NotifyRequest, Notification, StageApi, StageCard, ToolRegistry } from '@fuber/shared';
import { fakePolicy, moduleContext, tempStore, testBus } from '../../core/brain/testkit';
import type { BridgeCall } from '../../../skill-host/protocol';
import { createBridge, sanitizeCard } from './bridge';
import { createWorkshopStore, STORAGE_LIMITS, WORKSHOP_MIGRATIONS } from './store';
import type { WorkshopManifest } from './types';

const manifest = (patch: Partial<WorkshopManifest> = {}): WorkshopManifest => ({
  id: 'haber',
  name: 'Haber',
  description: 'Sınama yeteneği.',
  version: 1,
  permissions: [],
  createdBy: 'manual',
  tools: [
    {
      name: 'skill_haber_oku',
      description: 'Sınama aracı; girdi olarak bir sayı alır.',
      risk: 'read',
      inputSchema: { type: 'object', properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'] },
    },
  ],
  ...patch,
});

let env: ReturnType<typeof tempStore>;
let notified: NotifyRequest[];
let shown: Array<{ moduleId: string; card: StageCard }>;
let ran: Array<{ name: string; input: unknown; channel: string }>;
let policy: ReturnType<typeof fakePolicy>;
let ctx: ModuleContext;

beforeEach(() => {
  env = tempStore();
  env.store.migrate('workshop', WORKSHOP_MIGRATIONS);
  notified = [];
  shown = [];
  ran = [];
  policy = fakePolicy();
  ctx = moduleContext(
    'workshop',
    {
      bus: testBus(),
      policy,
      attention: {
        notify(request: NotifyRequest) {
          notified.push(request);
          return { id: 'n1' } as Notification;
        },
      } as unknown as AttentionApi,
      stage: {
        showCard(moduleId: string, card: StageCard) {
          shown.push({ moduleId, card });
          return { id: 's1' };
        },
      } as unknown as StageApi,
      tools: {
        async run(name: string, input: unknown, options: { origin: { channel: string } }) {
          ran.push({ name, input, channel: options.origin.channel });
          return { ok: true, text: 'Hatırlatıcı kuruldu.' };
        },
      } as unknown as ToolRegistry,
    },
    env.store,
  );
});
afterEach(() => env.close());

const bridgeFor = (current: WorkshopManifest | null) =>
  createBridge({ ctx, store: createWorkshopStore(ctx.db), manifestOf: () => current });
const live = (method: BridgeCall['method'], params: unknown): BridgeCall => ({ skillId: 'haber', mode: 'live', method, params });

describe('ctx köprüsü', () => {
  it('tanınmayan yeteneğin isteğini reddeder', async () => {
    await expect(bridgeFor(null)(live('storage.keys', null))).rejects.toThrow(/tanınmıyor/);
  });

  it('izin bildirilmemişse ağ, bildirim ve hatırlatıcıyı reddeder', async () => {
    const bridge = bridgeFor(manifest());
    await expect(bridge(live('fetch', { url: 'https://example.com/' }))).rejects.toThrow(/"net" izni gerekli/);
    await expect(bridge(live('notify', { title: 'x' }))).rejects.toThrow(/"notify" izni gerekli/);
    await expect(bridge(live('remind', { text: 'x', afterSeconds: 60 }))).rejects.toThrow(/"notify" izni gerekli/);
    expect(notified).toEqual([]);
    expect(ran).toEqual([]);
  });

  it('öz-sınamada (onaydan önce) ctx.fetch kapalı: izinli adrese bile ağa çıkılmaz', async () => {
    const net = manifest({ permissions: ['net'], net: { hosts: ['api.example.com'] } });
    let looked = 0;
    const bridge = createBridge({
      ctx,
      store: createWorkshopStore(ctx.db),
      manifestOf: () => net,
      lookup: async () => {
        looked++;
        return [{ address: '93.184.215.14', family: 4 }];
      },
      transport: async () => {
        throw new Error('taşıyıcıya ulaşılmamalıydı');
      },
    });
    await expect(bridge({ skillId: 'haber', mode: 'selftest', method: 'fetch', params: { url: 'https://api.example.com/' } })).rejects.toThrow(
      /öz-sınama sırasında ağ kapalı; ağ gerektiren davranışı sahte veriyle sına/,
    );
    expect(looked).toBe(0);
  });

  it('onaylı (canlı) yetenekte genel alan adına istek kapıdan geçer (sahte çözümleyici + sahte taşıyıcı)', async () => {
    const net = manifest({ permissions: ['net'], net: { hosts: ['api.example.com'] } });
    const seen: string[] = [];
    const bridge = createBridge({
      ctx,
      store: createWorkshopStore(ctx.db),
      manifestOf: () => net,
      lookup: async (hostname) => (hostname === 'api.example.com' ? [{ address: '93.184.215.14', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]),
      transport: async (request) => {
        seen.push(`${request.pinned.address} ${request.url.href}`);
        return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"ok":1}', truncated: false };
      },
    });
    const response = (await bridge(live('fetch', { url: 'https://api.example.com/v1', query: { a: 1 } }))) as { ok: boolean; body: string };
    expect(response).toMatchObject({ ok: true, body: '{"ok":1}' });
    expect(seen).toEqual(['93.184.215.14 https://api.example.com/v1?a=1']);
    await expect(bridge(live('fetch', { url: 'http://127.0.0.1:47820/v1/policy' }))).rejects.toThrow(/izinli adresleri arasında değil/);
    expect(seen).toHaveLength(1);
  });

  it('Gizli kipte ağ isteğini reddeder; izinsiz adrese ağa çıkmadan ret verir', async () => {
    const net = manifest({ permissions: ['net'], net: { hosts: ['api.example.com'] } });
    await expect(bridgeFor(net)(live('fetch', { url: 'https://evil.example/' }))).rejects.toThrow(/izinli adresleri arasında değil/);
    policy.networkAllowed = () => false;
    await expect(bridgeFor(net)(live('fetch', { url: 'https://api.example.com/' }))).rejects.toThrow(/Gizli kipte/);
  });

  it('bildirimi en çok normal öncelikle, sessiz ve yeteneğin adıyla gönderir; dakikada altıyla sınırlar', async () => {
    const bridge = bridgeFor(manifest({ permissions: ['notify'] }));
    await bridge(live('notify', { title: 'Kur değişti', body: 'Dolar yükseldi', priority: 'urgent', speak: true }));
    expect(notified[0]).toMatchObject({ moduleId: 'skill:haber', title: 'Haber: Kur değişti', body: 'Dolar yükseldi', priority: 'normal', speak: false });
    await bridge(live('notify', { title: 'Sessiz', priority: 'low' }));
    expect(notified[1]?.priority).toBe('low');
    await expect(bridge(live('notify', { title: '  ' }))).rejects.toThrow(/başlığı/);
    for (let i = 0; i < 4; i++) await bridge(live('notify', { title: `n${i}` }));
    await expect(bridge(live('notify', { title: 'fazla' }))).rejects.toThrow(/Çok sık bildirim/);
  });

  it('hatırlatıcıyı çekirdeğin araç kapısından, yetenek kökeniyle kurar', async () => {
    const bridge = bridgeFor(manifest({ permissions: ['notify'] }));
    expect(await bridge(live('remind', { text: 'Kuru kontrol et', afterSeconds: 90.7 }))).toEqual({ ok: true, text: 'Hatırlatıcı kuruldu.' });
    expect(ran).toEqual([{ name: 'reminder_create', input: { text: 'Haber: Kuru kontrol et', after_seconds: 90 }, channel: 'skill' }]);
    await expect(bridge(live('remind', { text: 'zamansız' }))).rejects.toThrow(/at \(ISO 8601\) ya da afterSeconds/);
  });

  it('kartı sözleşmedeki bloklara indirger; dosya yolu taşıyan blok ve eylemler alınmaz', async () => {
    const bridge = bridgeFor(manifest());
    await bridge(
      live('showCard', {
        title: 'Kurlar',
        actions: [{ id: 'x', label: 'Tıkla' }],
        body: [
          { type: 'keyValue', rows: [{ label: 'USD', value: 50.37 }] },
          { type: 'link', label: 'Kaynak', url: 'https://example.com' },
        ],
      }),
    );
    expect(shown[0]?.moduleId).toBe('skill:haber');
    expect(shown[0]?.card).toEqual({
      title: 'Kurlar',
      subtitle: 'Haber',
      body: [
        { type: 'keyValue', rows: [{ label: 'USD', value: '50.37' }] },
        { type: 'link', label: 'Kaynak', url: 'https://example.com' },
      ],
    });
    expect(() => sanitizeCard({ title: 'x', body: [{ type: 'image', src: 'C:/Users/x/gizli.png', alt: '' }] }, 'Haber')).toThrow(/Desteklenmeyen kart bloğu/);
    expect(() => sanitizeCard({ title: 'x', body: [{ type: 'link', label: 'y', url: 'file:///C:/x' }] }, 'Haber')).toThrow(/http ya da https/);
    expect(() => sanitizeCard({ title: 'x', body: [] }, 'Haber')).toThrow(/en az bir blok/);
  });

  it('depolama yeteneğe özeldir ve sınırlıdır', async () => {
    const bridge = bridgeFor(manifest());
    await bridge(live('storage.set', { key: 'son', value: { n: 1 } }));
    expect(await bridge(live('storage.get', { key: 'son' }))).toEqual({ found: true, value: { n: 1 } });
    expect(await bridge({ skillId: 'baska', mode: 'live', method: 'storage.get', params: { key: 'son' } })).toEqual({ found: false, value: null });
    expect(await bridge(live('storage.keys', null))).toEqual({ keys: ['son'] });
    expect(await bridge(live('storage.delete', { key: 'son' }))).toEqual({ deleted: true });
    await expect(bridge(live('storage.set', { key: 'büyük', value: 'x'.repeat(STORAGE_LIMITS.maxValueChars + 1) }))).rejects.toThrow(/çok büyük/);
  });

  it('öz-sınamada araç girdisini manifest şemasıyla doğrular', async () => {
    const bridge = bridgeFor(manifest());
    const validate = (input: unknown): BridgeCall => ({ skillId: 'haber', mode: 'selftest', method: 'validate', params: { tool: 'skill_haber_oku', input } });
    await expect(bridge(validate({ n: 3 }))).resolves.toBeNull();
    await expect(bridge(validate({ n: 0 }))).rejects.toThrow(/inputSchema'ya uymuyor/);
    await expect(bridge(validate({}))).rejects.toThrow(/inputSchema'ya uymuyor/);
    await expect(bridge({ skillId: 'haber', mode: 'selftest', method: 'validate', params: { tool: 'skill_haber_yok', input: {} } })).rejects.toThrow(
      /adında araç yok/,
    );
  });
});
