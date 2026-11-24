import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, type Logger, type PresenceState, type Settings, type SettingsApi } from '@fuber/shared';
import { createBus } from './bus';
import {
  AWAY_AFTER_SECONDS,
  createPresence,
  derivePresence,
  isOwnApp,
  presenceDiagnostics,
  type PresenceReadings,
} from './presence';
import { QUNS, type ForegroundInfo, type Win32Probe } from './presence-win32';

const OWN = 'C:\\Users\\ayse\\AppData\\Local\\Programs\\fuber2\\Fuber AI 2.exe';
const noon = new Date(2026, 10, 16, 12, 0, 0);
const base: Settings = defaultSettings('C:/projeler');

const readings = (patch: Partial<PresenceReadings> = {}): PresenceReadings => ({
  notificationState: QUNS.acceptsNotifications,
  foregroundFullscreen: false,
  idleSeconds: 3,
  cameraUsers: [],
  micUsers: [],
  locked: false,
  ...patch,
});
const derive = (patch: Partial<PresenceReadings> = {}, settings: Settings = base, now: Date = noon) =>
  derivePresence(readings(patch), settings, now, OWN);

describe('derivePresence', () => {
  it('olağan durumda uygun', () => {
    expect(derive()).toEqual({
      mode: 'normal',
      fullscreen: false,
      meeting: false,
      cameraInUse: false,
      micInUseByOther: false,
      quiet: false,
      idleSeconds: 3,
    });
  });

  it.each([QUNS.busy, QUNS.d3dFullScreen, QUNS.presentation])('bildirim durumu %i tam ekran sayılır', (state) => {
    expect(derive({ notificationState: state })).toMatchObject({ mode: 'fullscreen', fullscreen: true });
  });

  it('ön pencere monitörü başlıksız kaplıyorsa tam ekran; kilitli oturumda değil', () => {
    expect(derive({ foregroundFullscreen: true }).mode).toBe('fullscreen');
    expect(derive({ foregroundFullscreen: true, locked: true })).toMatchObject({ mode: 'away', fullscreen: false });
    expect(derive({ foregroundFullscreen: true, notificationState: QUNS.notPresent })).toMatchObject({ mode: 'away', fullscreen: false });
  });

  it('kamera ya da mikrofon başka uygulamadaysa toplantı; kendi uygulamamız ve v1 sayılmaz', () => {
    expect(derive({ micUsers: ['C:\\Program Files\\Zoom\\bin\\Zoom.exe'] })).toMatchObject({ mode: 'meeting', meeting: true, micInUseByOther: true, cameraInUse: false });
    expect(derive({ cameraUsers: ['MSTeams_8wekyb3d8bbwe'] })).toMatchObject({ mode: 'meeting', cameraInUse: true, micInUseByOther: false });
    expect(derive({ micUsers: [OWN.toLowerCase(), 'C:\\Users\\ayse\\AppData\\Local\\Programs\\Fuber AI\\Fuber AI.exe'] })).toMatchObject({
      mode: 'normal',
      meeting: false,
      micInUseByOther: false,
    });
    expect(isOwnApp('D:\\baska\\Fuber AI 2.exe', OWN)).toBe(true);
    expect(isOwnApp('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', OWN)).toBe(false);
  });

  it('rahatsız etme, süreli rahatsız etme ve sessiz saatler', () => {
    expect(derive({}, { ...base, dnd: true }).mode).toBe('quiet');
    const later = new Date(noon.getTime() + 60_000).toISOString();
    const earlier = new Date(noon.getTime() - 60_000).toISOString();
    expect(derive({}, { ...base, dnd: true, dndUntil: later }).quiet).toBe(true);
    expect(derive({}, { ...base, dnd: true, dndUntil: earlier }).quiet).toBe(false);

    const night: Settings = { ...base, quietHours: { enabled: true, from: '23:00', to: '08:00' } };
    expect(derive({}, night, noon).quiet).toBe(false);
    expect(derive({}, night, new Date(2026, 10, 16, 23, 30)).mode).toBe('quiet');
    expect(derive({}, night, new Date(2026, 10, 17, 7, 59)).mode).toBe('quiet');
    expect(derive({}, { ...night, quietHours: { ...night.quietHours, enabled: false } }, new Date(2026, 10, 16, 23, 30)).quiet).toBe(false);
    expect(derive({ notificationState: QUNS.quietTime }).mode).toBe('quiet');
  });

  it('girdi yoksa ya da oturum kilitliyse uzakta', () => {
    expect(derive({ idleSeconds: AWAY_AFTER_SECONDS - 1 }).mode).toBe('normal');
    expect(derive({ idleSeconds: AWAY_AFTER_SECONDS }).mode).toBe('away');
    expect(derive({ locked: true }).mode).toBe('away');
  });

  it('öncelik: tam ekran > toplantı > sessiz > uzakta', () => {
    const all = { foregroundFullscreen: true, micUsers: ['zoom.exe'], idleSeconds: 999 };
    const dnd = { ...base, dnd: true };
    expect(derive(all, dnd)).toMatchObject({ mode: 'fullscreen', meeting: true, quiet: true });
    expect(derive({ ...all, foregroundFullscreen: false }, dnd).mode).toBe('meeting');
    expect(derive({ idleSeconds: 999 }, dnd).mode).toBe('quiet');
  });

  it('ölçüm okunamadıysa (bildirim durumu yok) uygun kabul edilir', () => {
    expect(derive({ notificationState: null }).mode).toBe('normal');
  });
});

describe('createPresence', () => {
  const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
  const window = (patch: Partial<ForegroundInfo> = {}): ForegroundInfo => ({
    hwnd: 100,
    className: 'Chrome_WidgetWin_1',
    pid: 4242,
    rect: null,
    monitor: null,
    captioned: true,
    fullscreen: false,
    ...patch,
  });

  function setup() {
    const world = { state: QUNS.acceptsNotifications as number | null, foreground: window(), idle: 1, mic: [] as string[], mediaReads: 0 };
    const probe: Win32Probe = {
      notificationState: () => world.state,
      foreground: () => world.foreground,
      idleSeconds: () => world.idle,
      mediaUsers(kind) {
        world.mediaReads++;
        return kind === 'microphone' ? world.mic : [];
      },
    };
    const bus = createBus({ log });
    const emitted: PresenceState[] = [];
    bus.on('presence.changed', (state) => void emitted.push(state));
    let value = defaultSettings('C:/projeler');
    const settings: SettingsApi = {
      get: () => value,
      update(patch) {
        value = { ...value, ...patch };
        bus.emit('settings.changed', { settings: value, changedKeys: Object.keys(patch) as Array<keyof Settings> });
        return value;
      },
    };
    const listeners = new Map<string, () => void>();
    const power = {
      on: (event: string, listener: () => void) => void listeners.set(event, listener),
      off: (event: string) => void listeners.delete(event),
    };
    const presence = createPresence({ settings, bus, log }, { loadProbe: async () => probe, power, pollMs: 2000 });
    return { world, bus, emitted, settings, presence, listeners };
  }

  afterEach(() => vi.useRealTimers());

  it('2 saniyede bir yoklar ve yalnız durum değişince olay yayınlar', async () => {
    vi.useFakeTimers();
    const { world, emitted, presence } = setup();
    await presence.start();
    expect(presence.get().mode).toBe('normal');
    expect(emitted).toHaveLength(0);

    world.idle = 30;
    await vi.advanceTimersByTimeAsync(6000);
    // Boşta süresi değişti ama durum aynı: olay yok, değer güncel.
    expect(emitted).toHaveLength(0);
    expect(presence.get().idleSeconds).toBe(30);

    world.foreground = window({ fullscreen: true, captioned: false });
    await vi.advanceTimersByTimeAsync(1999);
    expect(emitted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ mode: 'fullscreen', fullscreen: true });
    const since = emitted[0]!.since;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(emitted).toHaveLength(1);
    expect(presence.get().since).toBe(since);

    world.foreground = window();
    await vi.advanceTimersByTimeAsync(2000);
    expect(emitted.at(-1)).toMatchObject({ mode: 'normal', fullscreen: false });
    presence.stop();
    world.foreground = window({ fullscreen: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(emitted).toHaveLength(2);
  });

  it('kamera/mikrofon kaydı daha seyrek okunur; refresh hemen okur', async () => {
    vi.useFakeTimers();
    const { world, emitted, presence } = setup();
    await presence.start();
    const afterStart = world.mediaReads;
    world.mic = ['C:\\Program Files\\Zoom\\bin\\Zoom.exe'];
    await vi.advanceTimersByTimeAsync(4000);
    expect(world.mediaReads).toBe(afterStart);
    expect(presence.get().meeting).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(world.mediaReads).toBe(afterStart + 2);
    expect(emitted.at(-1)).toMatchObject({ mode: 'meeting', micInUseByOther: true });

    world.mic = [];
    expect(presence.refresh().mode).toBe('normal');
    expect(emitted.at(-1)!.mode).toBe('normal');
    presence.stop();
  });

  it('kendi büyütülmüş penceremiz tam ekran sayılmaz; kilit ve ayar değişimi hemen yansır', async () => {
    const { world, emitted, settings, presence, listeners } = setup();
    world.foreground = window({ fullscreen: true, captioned: false, pid: process.pid });
    await presence.start();
    expect(presence.get().fullscreen).toBe(false);

    listeners.get('lock-screen')!();
    expect(emitted.at(-1)!.mode).toBe('away');
    listeners.get('unlock-screen')!();
    expect(emitted.at(-1)!.mode).toBe('normal');

    settings.update({ dnd: true });
    expect(emitted.at(-1)).toMatchObject({ mode: 'quiet', quiet: true });
    // Süresi dolmuş "rahatsız etme" ayarı da kapatır.
    settings.update({ dnd: true, dndUntil: new Date(Date.now() - 1000).toISOString() });
    expect(settings.get().dnd).toBe(false);
    expect(presence.get().quiet).toBe(false);
    expect(presenceDiagnostics(presence)?.foreground.hwnd).toBe(100);
    presence.stop();
    expect(listeners.size).toBe(0);
  });

  it('ölçüm yüklenemezse çökmez; durum uygun kalır', async () => {
    const bus = createBus({ log });
    const settings: SettingsApi = { get: () => defaultSettings('x'), update: () => defaultSettings('x') };
    const presence = createPresence(
      { settings, bus, log },
      {
        loadProbe: async () => {
          throw new Error('koffi yok');
        },
        power: { on() {}, off() {} },
      },
    );
    await presence.start();
    expect(presence.refresh().mode).toBe('normal');
    expect(presenceDiagnostics(presence)).toBeNull();
    presence.stop();
  });
});
