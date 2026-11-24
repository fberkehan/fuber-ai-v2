// Konak protokolü: gerçek konak kodu (demetlenmiş) düz Node çocuk sürecinde koşar.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BridgeCall } from '../../../skill-host/protocol';
import { prepareSource } from './audit';
import { createSkillHost, HostRestartedError, HostTimeoutError, type HostProcess, type SkillHost } from './host';
import { SELFTEST_NET_CLOSED } from './bridge';
import { EXAMPLE_SKILL } from './prompt';
import { forkHost, hostBundle } from './testkit';

const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
let file: string;
const spawned: HostProcess[] = [];
const hosts: SkillHost[] = [];

beforeAll(async () => {
  file = await hostBundle();
}, 30_000);

afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
});
afterAll(() => {
  for (const process of spawned) process.kill();
});

const script = (source: string, name: 'index.mjs' | 'selftest.mjs' = 'index.mjs') => {
  const prepared = prepareSource(source, name);
  if (!prepared.ok) throw new Error(prepared.issues.map((issue) => issue.message).join('; '));
  return prepared.script;
};

function start(options: { bridge?: (call: BridgeCall) => Promise<unknown>; callMs?: number; dropped?: string[]; logs?: string[] } = {}) {
  const host = createSkillHost({
    spawn: () => forkHost(file, spawned),
    log: silent,
    bridge: options.bridge ?? (async () => null),
    onLog: (entry) => options.logs?.push(`${entry.skillId}:${entry.text}`),
    onSkillDropped: (id) => options.dropped?.push(id),
    timeouts: { callMs: options.callMs ?? 3000, pingMs: 500, loadMs: 3000, selftestMs: 4000 },
  });
  hosts.push(host);
  return host;
}

const ADD = script(`export const tools = {
  async skill_topla_iki(input, ctx) {
    ctx.log('toplanıyor', input);
    return { ok: true, text: String(input.a + input.b), data: { sum: input.a + input.b } };
  },
};`);

const LOOP = script(`export const tools = {
  async skill_dongu_sonsuz() {
    for (;;) {}
  },
  async skill_dongu_bekle() {
    await new Promise(() => {});
    return { ok: true, text: 'asla' };
  },
};`);

describe('yetenek konağı', () => {
  it('yükler, çağırır, boşaltır', async () => {
    const logs: string[] = [];
    const host = start({ logs });
    expect(await host.load('topla', ADD)).toEqual(['skill_topla_iki']);
    expect(await host.call('topla', 'skill_topla_iki', { a: 2, b: 3 })).toEqual({ ok: true, text: '5', data: { sum: 5 } });
    expect(logs.some((line) => line.startsWith('topla:toplanıyor'))).toBe(true);
    await host.unload('topla');
    await expect(host.call('topla', 'skill_topla_iki', { a: 1, b: 1 })).rejects.toThrow(/yüklü değil/);
    expect(await host.ping()).toBe(true);
  });

  it('hatalı sonucu ve fırlatan aracı hata olarak döndürür; konak ayakta kalır', async () => {
    const host = start();
    await host.load(
      'bozuk',
      script(`export const tools = {
  async skill_bozuk_firlat() { throw new Error('patladı'); },
  async skill_bozuk_bicim() { return 'metin'; },
  async skill_bozuk_reddet() { Promise.reject(new Error('sahipsiz')); return { ok: true, text: 'tamam' }; },
};`),
    );
    await expect(host.call('bozuk', 'skill_bozuk_firlat', {})).rejects.toThrow(/patladı/);
    await expect(host.call('bozuk', 'skill_bozuk_bicim', {})).rejects.toThrow(/döndürmeli/);
    await expect(host.call('bozuk', 'constructor', {})).rejects.toThrow(/araç bulunamadı/);
    expect(await host.call('bozuk', 'skill_bozuk_reddet', {})).toEqual({ ok: true, text: 'tamam' });
    expect(await host.ping()).toBe(true);
    expect(host.restarts()).toBe(0);
  });

  it('bağlamda süreç, modül yükleme ve ağ yoktur', async () => {
    // Denetimi bilerek atlayan gövde: statik denetimden kaçan kod konakta da bu kapılara çarpmalı.
    const host = start();
    await host.load(
      'kacak',
      `const probe = async (name, run) => { try { return name + '=' + String(await run()); } catch (error) { return name + '!' + error.name; } };
const tools = {
  async skill_kacak_bak() {
    const found = [
      await probe('process', () => typeof process),
      await probe('require', () => typeof require),
      await probe('fetch', () => typeof fetch),
      await probe('Buffer', () => typeof Buffer),
      await probe('global', () => typeof global),
      await probe('eval', () => eval('1 + 1')),
      await probe('Function', () => new Function('return 1')()),
      await probe('ctor', () => (() => 0).constructor('return 1')()),
      await probe('import', () => import('node:fs')),
      await probe('this', () => typeof this),
      await probe('yigin', () => { Error['prepare' + 'StackTrace'] = () => 1; return typeof Error.prepareStackTrace; }),
    ];
    return { ok: true, text: found.join(' ') };
  },
};
__exports.tools = tools;`,
    );
    const { text } = await host.call('kacak', 'skill_kacak_bak', {});
    expect(text).toContain('process=undefined');
    expect(text).toContain('require=undefined');
    expect(text).toContain('fetch=undefined');
    expect(text).toContain('Buffer=undefined');
    expect(text).toContain('global=undefined');
    expect(text).toContain('eval!EvalError');
    expect(text).toContain('Function!EvalError');
    expect(text).toContain('ctor!EvalError');
    expect(text).toMatch(/import![A-Za-z]*Error/);
    expect(text).toContain('yigin!TypeError');
  });

  it('ctx isteklerini ana sürece köprüler ve reddi yeteneğe hata olarak iletir', async () => {
    const calls: BridgeCall[] = [];
    const host = start({
      bridge: async (call) => {
        calls.push(call);
        if (call.method === 'fetch') {
          const { url } = call.params as { url: string };
          if (url.includes('yasak')) throw new Error('izinli değil');
          return { ok: true, status: 200, statusText: 'OK', url, headers: {}, body: '{"n":7}', truncated: false };
        }
        if (call.method === 'storage.get') return { found: true, value: { kayit: 1 } };
        return null;
      },
    });
    await host.load(
      'ag',
      script(`export const tools = {
  async skill_ag_getir(input, ctx) {
    const response = await ctx.fetch(input.url, { query: { a: 1 } });
    const saved = await ctx.storage.get('son');
    await ctx.storage.set('son', { n: (await response.json()).n });
    return { ok: true, text: 'n=' + (await response.json()).n + ' kayit=' + saved.kayit };
  },
  async skill_ag_dene(input, ctx) {
    try {
      await ctx.fetch(input.url);
      return { ok: true, text: 'geçti' };
    } catch (error) {
      return { ok: false, text: 'reddedildi: ' + error.message };
    }
  },
};`),
    );
    expect((await host.call('ag', 'skill_ag_getir', { url: 'https://api.example.com/x' })).text).toBe('n=7 kayit=1');
    expect(await host.call('ag', 'skill_ag_dene', { url: 'https://yasak.example/' })).toEqual({ ok: false, text: 'reddedildi: izinli değil' });
    expect(calls.map((call) => `${call.skillId}:${call.mode}:${call.method}`)).toEqual([
      'ag:live:fetch',
      'ag:live:storage.get',
      'ag:live:storage.set',
      'ag:live:fetch',
    ]);
    expect(calls[2]?.params).toEqual({ key: 'son', value: { n: 7 } });
  });

  it('eşzamansız takılan çağrı zaman aşımına düşer; konak öldürülmez', async () => {
    const host = start({ callMs: 300 });
    await host.load('dongu', LOOP);
    await host.load('topla', ADD);
    const error = await host.call('dongu', 'skill_dongu_bekle', {}).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(HostTimeoutError);
    expect((error as HostTimeoutError).restarted).toBe(false);
    expect(host.restarts()).toBe(0);
    expect((await host.call('topla', 'skill_topla_iki', { a: 1, b: 1 })).text).toBe('2');
  });

  it('sonsuz döngü: zaman aşımı → konak öldürülür ve yeniden başlar → diğer yetenek çalışmayı sürdürür', async () => {
    const host = start({ callMs: 400 });
    await host.load('dongu', LOOP);
    await host.load('topla', ADD);

    const looping = host.call('dongu', 'skill_dongu_sonsuz', {});
    const collateral = host.call('topla', 'skill_topla_iki', { a: 1, b: 2 });
    const [loopError, collateralError] = await Promise.all([
      looping.catch((failure: unknown) => failure),
      collateral.catch((failure: unknown) => failure),
    ]);
    expect(loopError).toBeInstanceOf(HostTimeoutError);
    expect((loopError as HostTimeoutError).restarted).toBe(true);
    // Aynı anda süren diğer çağrı ya döngüden önce yanıtlandı ya da "yeniden başlatıldı" hatası aldı; asılı kalmadı.
    if (collateralError instanceof Error) expect(collateralError).toBeInstanceOf(HostRestartedError);

    expect(host.restarts()).toBe(1);
    expect((await host.call('topla', 'skill_topla_iki', { a: 20, b: 22 })).text).toBe('42');
    expect(host.loaded().sort()).toEqual(['dongu', 'topla']);
  }, 15_000);

  it('konak çökerse yeniden başlar ve etkin yetenekleri geri yükler', async () => {
    const host = start();
    await host.load('topla', ADD);
    spawned.at(-1)?.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(host.restarts()).toBe(1);
    expect((await host.call('topla', 'skill_topla_iki', { a: 4, b: 5 })).text).toBe('9');
  }, 15_000);

  it('yüklenirken konağı kilitleyen yetenek düşürülür, diğerleri geri gelir', async () => {
    const dropped: string[] = [];
    const host = start({ dropped });
    await host.load('topla', ADD);
    const error = await host.load('kilit', `for (;;) {}`).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(HostTimeoutError);
    expect(host.loaded()).toEqual(['topla']);
    expect((await host.call('topla', 'skill_topla_iki', { a: 1, b: 1 })).text).toBe('2');
  }, 20_000);

  it('öz-sınama: geçer, kalır, şema ve çağrılmayan araç denetimi', async () => {
    const validated: unknown[] = [];
    const host = start({
      bridge: async (call) => {
        if (call.method === 'validate') {
          validated.push(call.params);
          const { input } = call.params as { input: { a?: unknown } };
          if (typeof input.a !== 'number') throw new Error('girdi inputSchema\'ya uymuyor (a: sayı olmalı)');
        }
        return null;
      },
    });
    const index = ADD;
    const spec = { declared: ['skill_topla_iki'], mustCall: ['skill_topla_iki'] };
    const good = script(
      `export default async function ({ tools, ctx, assert, effects }) {
  const result = await tools.skill_topla_iki({ a: 2, b: 2 });
  assert.equal(result.data.sum, 4);
  await ctx.notify({ title: 'deneme' });
  assert.equal(effects.length, 1);
  await ctx.storage.set('k', 1);
  assert.equal(await ctx.storage.get('k'), 1);
}`,
      'selftest.mjs',
    );
    expect(await host.selftest({ skillId: 'topla', script: index, selftestScript: good, spec })).toEqual({
      ok: true,
      error: null,
      called: ['skill_topla_iki'],
      effects: 1,
    });
    expect(validated).toEqual([{ tool: 'skill_topla_iki', input: { a: 2, b: 2 } }]);

    const failing = script(`export default async function ({ tools, assert }) {\n  const r = await tools.skill_topla_iki({ a: 2, b: 2 });\n  assert.equal(r.data.sum, 5, 'toplam yanlış');\n}`, 'selftest.mjs');
    const failed = await host.selftest({ skillId: 'topla', script: index, selftestScript: failing, spec });
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/toplam yanlış/);
    expect(failed.error).toMatch(/selftest\.mjs satır 3/);

    const schema = script(`export default async function ({ tools }) {\n  await tools.skill_topla_iki({ a: 'iki', b: 2 });\n}`, 'selftest.mjs');
    expect((await host.selftest({ skillId: 'topla', script: index, selftestScript: schema, spec })).error).toMatch(/inputSchema/);

    const lazy = script(`export default async function ({ assert }) {\n  assert(true);\n}`, 'selftest.mjs');
    expect((await host.selftest({ skillId: 'topla', script: index, selftestScript: lazy, spec })).error).toMatch(/hiç çağırmadı: skill_topla_iki/);

    const mismatch = await host.selftest({ skillId: 'topla', script: index, selftestScript: good, spec: { declared: ['skill_topla_uc'], mustCall: [] } });
    expect(mismatch.error).toMatch(/manifestte olup index\.mjs içinde olmayan araç: skill_topla_uc/);

    // Öz-sınama canlı bağlama dokunmaz.
    await expect(host.call('topla', 'skill_topla_iki', { a: 1, b: 1 })).rejects.toThrow(/yüklü değil/);
  });

  it('sonsuz döngülü öz-sınama zaman aşımına düşer', async () => {
    const host = start();
    const spec = { declared: ['skill_topla_iki'], mustCall: [] };
    const hang = script(`export default async function () {\n  for (;;) {}\n}`, 'selftest.mjs');
    await expect(host.selftest({ skillId: 'topla', script: ADD, selftestScript: hang, spec }, { timeoutMs: 500 })).rejects.toBeInstanceOf(
      HostTimeoutError,
    );
  }, 15_000);

  it('isteme gömülü örnek yetenek konakta öz-sınamadan ağa çıkmadan geçer (mockFetch)', async () => {
    const fetches: BridgeCall[] = [];
    const host = start({
      bridge: async (call) => {
        // Ana süreçteki köprü gibi: öz-sınamada ağ kapalı.
        if (call.method === 'fetch') {
          fetches.push(call);
          throw new Error(SELFTEST_NET_CLOSED);
        }
        return null;
      },
    });
    const outcome = await host.selftest({
      skillId: EXAMPLE_SKILL.id,
      script: script(EXAMPLE_SKILL.index),
      selftestScript: script(EXAMPLE_SKILL.selftest, 'selftest.mjs'),
      spec: { declared: ['skill_doviz_kuru_cevir'], mustCall: ['skill_doviz_kuru_cevir'] },
    });
    expect(outcome).toMatchObject({ ok: true, error: null });
    expect(fetches).toEqual([]);
  });

  it('mockFetch vermeyen öz-sınamada ctx.fetch köprüde reddedilir; canlıda mockFetch yok sayılır', async () => {
    const host = start({
      bridge: async (call) => {
        if (call.method === 'fetch') {
          if (call.mode === 'selftest') throw new Error(SELFTEST_NET_CLOSED);
          return { ok: true, status: 200, statusText: 'OK', url: '', headers: {}, body: '{"n":1}', truncated: false };
        }
        return null;
      },
    });
    const index = script(`export const tools = {
  async skill_net_al(input, ctx) {
    try {
      const response = await ctx.fetch('https://api.example.com/x');
      return { ok: true, text: 'n=' + (await response.json()).n };
    } catch (error) {
      return { ok: false, text: error.message };
    }
  },
};`);
    const noMock = script(`export default async function ({ tools, assert }) {
  const result = await tools.skill_net_al({});
  assert(!result.ok, 'ağ kapalı olmalıydı');
  assert.includes(result.text, 'öz-sınama sırasında ağ kapalı');
}`, 'selftest.mjs');
    const spec = { declared: ['skill_net_al'], mustCall: ['skill_net_al'] };
    expect(await host.selftest({ skillId: 'net', script: index, selftestScript: noMock, spec })).toMatchObject({ ok: true });
    const withMock = script(`export default async function ({ tools, assert, mockFetch }) {
  mockFetch(function () { return { body: { n: 42 } }; });
  assert.equal((await tools.skill_net_al({})).text, 'n=42');
}`, 'selftest.mjs');
    expect(await host.selftest({ skillId: 'net', script: index, selftestScript: withMock, spec })).toMatchObject({ ok: true });
    await host.load('net', index);
    expect((await host.call('net', 'skill_net_al', {})).text).toBe('n=1');
  });
});
