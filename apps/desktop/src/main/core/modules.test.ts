import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultSettings,
  defineModule,
  defineTool,
  type Bus,
  type BusEvents,
  type IpcHandlers,
  type IpcRegistrar,
  type Logger,
  type ModuleContext,
  type ModuleDef,
  type ModuleRegistry,
  type Paths,
  type PolicyApi,
  type ServiceDeps,
  type Settings,
  type SettingsApi,
  type StageApi,
  type Store,
  type ToolRegistry,
  type WindowsApi,
} from '@fuber/shared';
import { z } from 'zod';
import { createBus } from './bus';
import { createModules } from './modules';
import { createStore } from './store';
import { createTools } from './tools';

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
const voice = { channel: 'voice', speakerVerified: null } as const;

let dir: string;
let store: Store;
let bus: Bus;
let tools: ToolRegistry;
let modules: ModuleRegistry;
let policyModules: Record<string, boolean>;
let settingsValue: Settings;
let channels: Set<string>;
let broadcasts: Array<{ event: string; payload: unknown }>;
let changes: Array<BusEvents['module.changed']>;
let trail: string[];

/** Araç, göç, IPC kanalı ve pencere olayı olan sıradan bir modül. */
function sample(id: string, extra: Partial<ModuleDef> = {}): ModuleDef {
  const table = `${id.replace(/-/g, '_')}_items`;
  return defineModule({
    id,
    version: '1.0.0',
    nameKey: `module.${id}.name`,
    descriptionKey: `module.${id}.description`,
    permissions: ['notify'],
    migrations: [{ id: 1, name: 'tablo', up: `CREATE TABLE ${table} (n INTEGER)` }],
    tools: [
      defineTool({
        name: `${id.replace(/-/g, '_')}_ping`,
        description: 'Yanıt verir.',
        input: z.object({}),
        risk: 'read',
        async run(_input, ctx) {
          ctx.db.run(`INSERT INTO ${table} VALUES (1)`);
          return { ok: true, text: `${ctx.moduleId} burada` };
        },
      }),
    ],
    ipc: () => ({ [`${id}.list`]: () => [] }) as IpcHandlers,
    windowEvents: [`${id}.changed` as never],
    setup: () => void trail.push(`setup:${id}`),
    teardown: () => void trail.push(`teardown:${id}`),
    ...extra,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-modules-'));
  store = createStore({ paths: { db: path.join(dir, 'test.db') } as Paths, log });
  bus = createBus({ log });
  changes = [];
  bus.on('module.changed', (change) => void changes.push(change));
  trail = [];
  channels = new Set();
  broadcasts = [];
  policyModules = { planner: true, memory: true, broken: true, workshop: true };
  settingsValue = defaultSettings('C:/projeler');

  const policy = {
    moduleAllowed: (id: string) => policyModules[id] === true,
    killSwitchActive: () => false,
    updateRequired: () => false,
    networkAllowed: () => true,
  } as PolicyApi;
  const settings: SettingsApi = {
    get: () => settingsValue,
    update(patch) {
      settingsValue = { ...settingsValue, ...patch };
      bus.emit('settings.changed', { settings: settingsValue, changedKeys: Object.keys(patch) as Array<keyof Settings> });
      return settingsValue;
    },
  };
  const ipc: IpcRegistrar = {
    register(handlers) {
      const names = Object.keys(handlers);
      for (const name of names) {
        if (channels.has(name)) throw new Error(`IPC kanalı iki kez kaydedildi: ${name}`);
      }
      for (const name of names) channels.add(name);
      return () => names.forEach((name) => channels.delete(name));
    },
  };
  const windows = {
    broadcast: (event: string, payload: unknown) => void broadcasts.push({ event, payload }),
  } as unknown as WindowsApi;
  tools = createTools({ store, policy, stage: {} as StageApi, bus, log });
  modules = createModules({ store, bus, log, policy, settings, tools, ipc, windows, paths: {} as Paths } as ServiceDeps['modules']);
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('yükleme', () => {
  it('izinli modülü yükler: göç, araç, IPC, pencere olayı, setup', async () => {
    await modules.loadBuiltins([sample('planner'), sample('ambient')]);
    expect(trail).toEqual(['setup:planner']);
    expect(modules.list().map((module) => [module.id, module.allowed, module.enabled])).toEqual([
      ['planner', true, true],
      ['ambient', false, false],
    ]);
    expect(modules.get('planner')).toMatchObject({
      kind: 'builtin',
      version: '1.0.0',
      permissions: ['notify'],
      error: null,
      page: null,
      tools: [{ name: 'planner_ping', risk: 'read', moduleId: 'planner' }],
    });
    expect(modules.get('ambient')!.tools.map((tool) => tool.name)).toEqual(['ambient_ping']);
    expect(modules.get('yok')).toBeNull();

    expect(await tools.run('planner_ping', {}, { origin: voice })).toEqual({ ok: true, text: 'planner burada' });
    expect(store.scoped('planner').all('SELECT n FROM planner_items')).toHaveLength(1);
    expect(tools.has('ambient_ping')).toBe(false);
    expect([...channels]).toEqual(['planner.list']);

    bus.emit('planner.changed' as never, { ids: ['a'] } as never);
    expect(broadcasts).toEqual([{ event: 'planner.changed', payload: { ids: ['a'] } }]);
    expect(changes).toEqual([{ id: 'planner', enabled: true, reason: 'policy' }]);
  });

  it('hata veren modül diğerlerini düşürmez; hatası ModuleInfo içinde görünür', async () => {
    const broken = sample('broken', {
      setup: () => {
        throw new Error('ayar dosyası okunamadı');
      },
    });
    const badMigration = sample('memory', { migrations: [{ id: 1, name: 'bozuk', up: 'CREATE TABLO yanlış' }] });
    await modules.loadBuiltins([broken, badMigration, sample('planner')]);

    expect(modules.get('broken')).toMatchObject({ enabled: false, allowed: true, error: 'Modül yüklenemedi: ayar dosyası okunamadı' });
    expect(modules.get('memory')!.enabled).toBe(false);
    expect(modules.get('memory')!.error).toContain('Modül yüklenemedi');
    expect(modules.get('planner')).toMatchObject({ enabled: true, error: null });
    // Yarım yüklenen modülden geriye araç, kanal ya da olay aboneliği kalmaz.
    expect(tools.list().map((tool) => tool.name)).toEqual(['planner_ping']);
    expect([...channels]).toEqual(['planner.list']);
    expect(trail).toEqual(['teardown:broken', 'teardown:memory', 'setup:planner']);
    expect(changes.filter((change) => change.reason === 'error').map((change) => change.id)).toEqual(['broken', 'memory']);
  });

  it('aynı kimlikli ikinci modül atlanır', async () => {
    await modules.loadBuiltins([sample('planner'), sample('planner')]);
    expect(modules.list()).toHaveLength(1);
    expect(modules.get('planner')!.enabled).toBe(true);
  });
});

describe('canlı aç/kapa', () => {
  it('politika kapatınca modül kapanır, araçları ve kanalı düşer; açınca geri gelir', async () => {
    await modules.loadBuiltins([sample('planner'), sample('memory')]);
    expect(tools.list()).toHaveLength(2);

    policyModules.planner = false;
    await modules.sync();
    expect(modules.get('planner')).toMatchObject({ allowed: false, enabled: false });
    expect(tools.has('planner_ping')).toBe(false);
    expect(tools.has('memory_ping')).toBe(true);
    expect(channels.has('planner.list')).toBe(false);
    expect(trail).toContain('teardown:planner');
    bus.emit('planner.changed' as never, {} as never);
    expect(broadcasts).toEqual([]);
    expect(changes.at(-1)).toEqual({ id: 'planner', enabled: false, reason: 'policy' });

    policyModules.planner = true;
    await modules.sync();
    expect(modules.get('planner')!.enabled).toBe(true);
    expect((await tools.run('planner_ping', {}, { origin: voice })).ok).toBe(true);
    expect(trail.filter((step) => step === 'setup:planner')).toHaveLength(2);
  });

  it('kullanıcı yerelde kapatıp açabilir; politikanın kapattığını açamaz', async () => {
    await modules.loadBuiltins([sample('planner'), sample('ambient')]);
    expect(await modules.setEnabled('planner', false)).toMatchObject({ enabled: false, allowed: true });
    expect(settingsValue.disabledModules).toEqual(['planner']);
    expect(tools.has('planner_ping')).toBe(false);
    await modules.sync();
    expect(modules.get('planner')!.enabled).toBe(false);

    expect(await modules.setEnabled('planner', true)).toMatchObject({ enabled: true });
    expect(settingsValue.disabledModules).toEqual([]);
    await expect(modules.setEnabled('ambient', true)).rejects.toThrow('Fuber Yönetim tarafından kapatılmış');
    await expect(modules.setEnabled('yok', true)).rejects.toThrow('adında bir modül yok');
    expect(changes.filter((change) => change.reason === 'user')).toEqual([
      { id: 'planner', enabled: false, reason: 'user' },
      { id: 'planner', enabled: true, reason: 'user' },
    ]);
  });

  it('hata veren modül her politika değişiminde yeniden denenmez; kullanıcı açınca denenir', async () => {
    let attempts = 0;
    let fail = true;
    const flaky = sample('broken', {
      setup: () => {
        attempts++;
        if (fail) throw new Error('henüz olmadı');
      },
    });
    await modules.loadBuiltins([flaky]);
    await modules.sync();
    await modules.sync();
    expect(attempts).toBe(1);
    fail = false;
    expect(await modules.setEnabled('broken', true)).toMatchObject({ enabled: true, error: null });
    expect(attempts).toBe(2);
  });

  it('art arda gelen eşitlemeler birbirine girmez', async () => {
    const slow = sample('planner', { setup: () => new Promise<void>((resolve) => setTimeout(resolve, 20)) });
    const loading = modules.loadBuiltins([slow]);
    policyModules.planner = false;
    const first = modules.sync();
    policyModules.planner = true;
    const second = modules.sync();
    await Promise.all([loading, first, second]);
    expect(modules.get('planner')!.enabled).toBe(true);
    expect(tools.list().map((tool) => tool.name)).toEqual(['planner_ping']);
  });
});

describe('kullanıcı verisini silme', () => {
  it('kapalı modülün verisi de silinir: tablo kurulur, modülün `purge`ı kendi bağlamıyla çağrılır; modül yüklenmez', async () => {
    const purged: string[] = [];
    const withPurge = sample('planner', {
      purge(ctx) {
        ctx.db.run('DELETE FROM planner_items');
        purged.push(ctx.moduleId);
      },
    });
    // Açıkken veri birikir.
    await modules.loadBuiltins([withPurge, sample('memory')]);
    await tools.run('planner_ping', {}, { origin: voice });
    const rows = () => store.scoped('planner').get<{ n: number }>('SELECT COUNT(*) AS n FROM planner_items')!.n;
    expect(rows()).toBe(1);
    // Yönetim modülü kapatır: veri durur, kullanıcı yine silebilir.
    policyModules.planner = false;
    await modules.sync();
    expect(rows()).toBe(1);
    await modules.purgeData('planner');
    expect(rows()).toBe(0);
    expect(purged).toEqual(['planner']);
    expect(modules.get('planner')).toMatchObject({ enabled: false });
    expect(trail.filter((step) => step === 'setup:planner')).toHaveLength(1);
    // Silme tanımlamayan ya da bilinmeyen modül: açık hata.
    await expect(modules.purgeData('memory')).rejects.toThrow(/silinecek kullanıcı verisi yok/);
    await expect(modules.purgeData('yok')).rejects.toThrow();
  });

  it('hiç yüklenmemiş modülde silme tabloyu kurar ve hata vermez', async () => {
    policyModules.planner = false;
    let called = 0;
    await modules.loadBuiltins([sample('planner', { purge: (ctx) => void (ctx.db.run('DELETE FROM planner_items'), called++) })]);
    await modules.purgeData('planner');
    expect(called).toBe(1);
  });
});

describe('yetenekler ve kapanış', () => {
  it('çalışma anında yetenek eklenir, Atölye iznine bağlıdır ve kaldırılabilir', async () => {
    const skill = sample('skill-kur');
    expect(await modules.add(skill, 'skill')).toMatchObject({ id: 'skill-kur', kind: 'skill', enabled: true, allowed: true });
    expect((await tools.run('skill_kur_ping', {}, { origin: voice })).ok).toBe(true);
    await expect(modules.add(skill, 'skill')).rejects.toThrow('zaten var');

    policyModules.workshop = false;
    await modules.sync();
    expect(modules.get('skill-kur')).toMatchObject({ enabled: false, allowed: false });

    await modules.remove('skill-kur');
    expect(modules.get('skill-kur')).toBeNull();
    expect(changes.at(-1)).toEqual({ id: 'skill-kur', enabled: false, reason: 'removed' });
  });

  it('modülün çalışma anında eklediği araçlar da modülle birlikte düşer', async () => {
    let ctxSeen: ModuleContext | null = null;
    await modules.loadBuiltins([sample('planner', { setup: (ctx) => void (ctxSeen = ctx) })]);
    ctxSeen!.tools.register(ctxSeen!, [
      defineTool({ name: 'planner_extra', description: '', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: '' }) }),
    ]);
    expect(modules.get('planner')!.tools.map((tool) => tool.name)).toEqual(['planner_ping', 'planner_extra']);
    await modules.setEnabled('planner', false);
    expect(tools.list()).toEqual([]);
  });

  it('stopAll bütün modülleri ters sırada kapatır; teardown hatası kapanışı durdurmaz', async () => {
    await modules.loadBuiltins([
      sample('planner'),
      sample('memory', {
        teardown: () => {
          trail.push('teardown:memory');
          throw new Error('kapanamadı');
        },
      }),
    ]);
    trail.length = 0;
    await modules.stopAll();
    expect(trail).toEqual(['teardown:memory', 'teardown:planner']);
    expect(tools.list()).toEqual([]);
    expect(channels.size).toBe(0);
  });
});
