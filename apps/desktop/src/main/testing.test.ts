import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLICY,
  defaultSettings,
  type Bus,
  type PolicyApi,
  type PresenceApi,
  type PresenceState,
  type SettingsApi,
} from '@fuber/shared';

/** `testing.ts` ortamı modül yüklenirken okur; her sınama kendi ortamıyla taze bir kopya yükler. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const name of [
    'FUBER2_TEST',
    'FUBER2_DATA',
    'ANTHROPIC_API_KEY',
    'ELEVENLABS_API_KEY',
    'FUBER2_ELEVENLABS_URL',
    'FUBER2_ELEVENLABS_BUDGET',
    'FUBER2_CONTROL_URL',
    'FUBER2_HOTKEYS',
    'FUBER2_SINGLE_INSTANCE',
    'FUBER2_SHOW_HUD',
    'FUBER2_TRAY',
  ]) {
    vi.stubEnv(name, env[name] ?? '');
  }
  return (await import('./testing')).testing;
}

function fakePolicy(): PolicyApi {
  return {
    start() {},
    stop() {},
    get: () => DEFAULT_POLICY,
    status: () => ({
      state: 'offline',
      url: '',
      deviceId: null,
      policyRevision: 0,
      policySource: 'embedded',
      lastSyncAt: null,
      lastError: null,
    }),
    connect: async () => fakePolicy().status(),
    refresh: async () => fakePolicy().status(),
    moduleAllowed: (id) => id === 'planner',
    moduleConfig: () => ({}),
    killSwitchActive: () => false,
    updateRequired: () => false,
    networkAllowed: () => true,
  };
}

function fakeSettings(): SettingsApi {
  const value = defaultSettings('C:/projeler');
  return { get: () => value, update: () => value };
}

function fakePresence(mode: PresenceState['mode']): PresenceApi {
  const state = { mode, fullscreen: mode === 'fullscreen' } as PresenceState;
  return { start() {}, stop() {}, get: () => state, refresh: () => state };
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __fuber2Test?: unknown }).__fuber2Test;
});

describe('testing sınırı', () => {
  it('sınama kipi dışında hiçbir şeyi değiştirmez', async () => {
    const testing = await load({ ANTHROPIC_API_KEY: 'sk-gizli', FUBER2_CONTROL_URL: 'http://127.0.0.1:1', FUBER2_HOTKEYS: '0' });
    expect(testing.enabled).toBe(false);
    expect(testing.hotkeys).toBe(true);
    expect(testing.singleInstanceLock).toBe(true);
    expect(testing.controlUrl).toBeNull();
    expect(testing.wrapPolicy(fakePolicy()).get().keys.anthropic).toBeUndefined();
    expect(testing.wrapSettings(fakeSettings()).get().controlUrl).toBe(defaultSettings('x').controlUrl);
  });

  it('sınama kipi dışında tepsi ve sistem kaydı açık, HUD zorlaması ve denetim nesnesi yok', async () => {
    const testing = await load({ FUBER2_SHOW_HUD: '1', FUBER2_TRAY: '0' });
    expect(testing.tray).toBe(true);
    expect(testing.systemIntegration).toBe(true);
    expect(testing.showHud).toBe(false);
    const real = fakePresence('fullscreen');
    expect(testing.wrapPresence(real, {} as Bus)).toBe(real);
    testing.expose({ gizli: 1 });
    expect((globalThis as { __fuber2Test?: unknown }).__fuber2Test).toBeUndefined();
  });

  it('sınamada sisteme kayıt yazılmaz, tepsi ve HUD gösterimi yalnız istenirse açılır', async () => {
    const defaults = await load({ FUBER2_TEST: '1' });
    expect(defaults.systemIntegration).toBe(false);
    expect(defaults.tray).toBe(false);
    expect(defaults.showHud).toBe(false);
    const custom = await load({ FUBER2_TEST: '1', FUBER2_SHOW_HUD: '1', FUBER2_TRAY: '1' });
    expect(custom.systemIntegration).toBe(false);
    expect(custom.tray).toBe(true);
    expect(custom.showHud).toBe(true);
  });

  it('sınamada varlık durumu makineye bakmaz; denetim nesnesinden değiştirilir', async () => {
    const testing = await load({ FUBER2_TEST: '1' });
    const emitted: PresenceState[] = [];
    const bus = { emit: (_type: string, payload: PresenceState) => void emitted.push(payload) } as unknown as Bus;
    const real = fakePresence('fullscreen');
    const presence = testing.wrapPresence(real, bus);
    expect(presence.get()).toMatchObject({ mode: 'normal', fullscreen: false });

    const hooks = (globalThis as unknown as { __fuber2Test: Record<string, (patch: Partial<PresenceState> | null) => PresenceState> }).__fuber2Test;
    expect(hooks.realPresence).toBe(real);
    hooks.setPresence!({ mode: 'fullscreen', fullscreen: true });
    expect(presence.get()).toMatchObject({ mode: 'fullscreen', fullscreen: true });
    expect(presence.refresh().fullscreen).toBe(true);
    expect(emitted).toHaveLength(1);
    hooks.setPresence!(null);
    expect(presence.get().mode).toBe('normal');

    testing.expose({ services: 'x' });
    expect((hooks as Record<string, unknown>).services).toBe('x');
  });

  it('sınamada ortamdaki anahtarı yalnız politikanın içine koyar', async () => {
    const testing = await load({ FUBER2_TEST: '1', ANTHROPIC_API_KEY: 'sk-gizli' });
    const policy = testing.wrapPolicy(fakePolicy());
    expect(policy.get().keys.anthropic).toBe('sk-gizli');
    expect(policy.get().persona.name).toBe('Jarvis');
    expect(policy.moduleAllowed('planner')).toBe(true);
    expect(DEFAULT_POLICY.keys.anthropic).toBeUndefined();
    expect(JSON.stringify(testing)).not.toContain('sk-gizli');
  });

  it('ElevenLabs anahtarı da yalnız sınamada ve yalnız politikanın içinde görünür', async () => {
    const off = await load({ ELEVENLABS_API_KEY: 'el-gizli' });
    const inner = fakePolicy();
    expect(off.wrapPolicy(inner)).toBe(inner);
    expect(off.voiceOptions).toEqual({});

    const testing = await load({ FUBER2_TEST: '1', ELEVENLABS_API_KEY: 'el-gizli' });
    const policy = testing.wrapPolicy(fakePolicy());
    expect(policy.get().keys).toEqual({ elevenlabs: 'el-gizli' });
    expect(JSON.stringify(testing)).not.toContain('el-gizli');
    // Gerçek servise (sahte adres yok) üst sınır her zaman vardır: sınama kotayı bitiremez.
    expect(testing.voiceOptions).toEqual({ elevenLabsCharBudget: 300 });

    const both = await load({ FUBER2_TEST: '1', ANTHROPIC_API_KEY: 'sk-gizli', ELEVENLABS_API_KEY: 'el-gizli', FUBER2_ELEVENLABS_BUDGET: '120' });
    expect(both.wrapPolicy(fakePolicy()).get().keys).toEqual({ anthropic: 'sk-gizli', elevenlabs: 'el-gizli' });
    expect(both.voiceOptions).toEqual({ elevenLabsCharBudget: 120 });
  });

  it('sahte ElevenLabs sunucusu: adres ortamdan gelir, karakter sınırı zorunlu değildir', async () => {
    const testing = await load({ FUBER2_TEST: '1', ELEVENLABS_API_KEY: 'sahte', FUBER2_ELEVENLABS_URL: 'http://127.0.0.1:5999' });
    expect(testing.voiceOptions).toEqual({ elevenLabsBaseUrl: 'http://127.0.0.1:5999' });
    const none = await load({ FUBER2_TEST: '1' });
    expect(none.voiceOptions).toEqual({});
  });

  it('sınamada anahtar yoksa politikaya dokunmaz', async () => {
    const testing = await load({ FUBER2_TEST: '1' });
    const inner = fakePolicy();
    expect(testing.wrapPolicy(inner)).toBe(inner);
  });

  it('kontrol adresi, kısayol ve tek örnek kilidi ortamdan yönetilir', async () => {
    const defaults = await load({ FUBER2_TEST: '1', FUBER2_DATA: ' C:/tmp/veri ' });
    expect(defaults.dataDir).toBe('C:/tmp/veri');
    // Adres verilmeyen sınama gerçek Yönetim'in portuna gitmez.
    expect(defaults.wrapSettings(fakeSettings()).get().controlUrl).toBe('http://127.0.0.1:9');
    expect(defaults.hotkeys).toBe(false);
    expect(defaults.singleInstanceLock).toBe(true);

    const custom = await load({
      FUBER2_TEST: '1',
      FUBER2_CONTROL_URL: 'http://127.0.0.1:47999',
      FUBER2_HOTKEYS: '1',
      FUBER2_SINGLE_INSTANCE: '0',
    });
    expect(custom.hotkeys).toBe(true);
    expect(custom.singleInstanceLock).toBe(false);
    expect(custom.wrapSettings(fakeSettings()).get().controlUrl).toBe('http://127.0.0.1:47999');
    expect(custom.wrapSettings(fakeSettings()).get().uiLanguage).toBe('tr');
  });
});
