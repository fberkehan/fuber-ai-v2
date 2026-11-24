import { describe, expect, it } from 'vitest';
import { DEFAULT_HOTKEYS, defaultSettings, type Logger, type Settings, type SettingsApi } from '@fuber/shared';
import { createBus } from './bus';
import { createHotkeys } from './hotkeys';

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };

/** Başka uygulamaların tuttuğu tuşları reddeden sahte `globalShortcut`. */
function fakeShortcuts(taken: string[]) {
  const registered = new Map<string, () => void>();
  return {
    registered,
    register(accelerator: string, callback: () => void) {
      if (taken.includes(accelerator) || registered.has(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    },
    unregister(accelerator: string) {
      registered.delete(accelerator);
    },
  };
}

function harness(taken: string[], initial: Partial<Settings['hotkeys']> = {}) {
  const bus = createBus({ log });
  let current: Settings = { ...defaultSettings('C:/x'), hotkeys: { ...DEFAULT_HOTKEYS, ...initial } };
  const settings: SettingsApi = {
    get: () => current,
    update(patch) {
      const changedKeys = (Object.keys(patch) as Array<keyof Settings>).filter((key) => JSON.stringify(patch[key]) !== JSON.stringify(current[key]));
      if (changedKeys.length === 0) return current;
      current = { ...current, ...patch };
      bus.emit('settings.changed', { settings: current, changedKeys });
      return current;
    },
  };
  const shortcuts = fakeShortcuts(taken);
  const hotkeys = createHotkeys({ settings, bus, log }, { shortcuts });
  const pressed: string[] = [];
  bus.on('hotkey.pressed', ({ id }) => pressed.push(id));
  return { bus, settings, shortcuts, hotkeys, pressed };
}

describe('genel kısayollar', () => {
  it('tuşlar boşsa varsayılanları kaydeder ve basılınca olay yayınlar', () => {
    const h = harness([]);
    h.hotkeys.start();
    expect(h.hotkeys.status()).toEqual([
      { id: 'talk', accelerator: 'Control+Alt+J', registered: true },
      { id: 'mute', accelerator: 'Control+Alt+M', registered: true },
      { id: 'panic', accelerator: 'Control+Alt+Q', registered: true },
      { id: 'meeting', accelerator: 'Control+Alt+T', registered: true },
    ]);
    h.shortcuts.registered.get('Control+Alt+M')!();
    expect(h.pressed).toEqual(['mute']);
  });

  it('tuş başka uygulamadaysa yedeği kaydeder ve GERÇEKTE kaydedileni ayara yazar', () => {
    const h = harness(['Control+Alt+M']);
    h.hotkeys.start();
    expect(h.settings.get().hotkeys.mute).toBe('Control+Alt+K');
    expect(h.hotkeys.status().find((item) => item.id === 'mute')).toEqual({ id: 'mute', accelerator: 'Control+Alt+K', registered: true });
    expect(h.shortcuts.registered.has('Control+Alt+K')).toBe(true);
    // Diğer kısayollar etkilenmez.
    expect(h.settings.get().hotkeys.talk).toBe('Control+Alt+J');
    h.shortcuts.registered.get('Control+Alt+K')!();
    expect(h.pressed).toEqual(['mute']);
  });

  it('ilk yedek de tutulmuşsa sıradakine geçer', () => {
    const h = harness(['Control+Alt+M', 'Control+Alt+K']);
    h.hotkeys.start();
    expect(h.settings.get().hotkeys.mute).toBe('Control+Shift+Alt+M');
  });

  it('hiçbiri alınamazsa ayar boş kalır, durum kayıtsız görünür ve uygulama sürer', () => {
    const h = harness(['Control+Alt+M', 'Control+Alt+K', 'Control+Shift+Alt+M']);
    h.hotkeys.start();
    expect(h.settings.get().hotkeys.mute).toBe('');
    expect(h.hotkeys.status().find((item) => item.id === 'mute')).toEqual({ id: 'mute', accelerator: '', registered: false });
    expect(h.hotkeys.status().find((item) => item.id === 'talk')?.registered).toBe(true);
  });

  it('boş ayarla açılışta varsayılan yeniden denenir (tuş artık boşsa geri gelir)', () => {
    const h = harness([], { mute: '' });
    h.hotkeys.start();
    expect(h.settings.get().hotkeys.mute).toBe('Control+Alt+M');
    expect(h.hotkeys.status().find((item) => item.id === 'mute')?.registered).toBe(true);
  });

  it('iki işe aynı tuş verilmez', () => {
    const h = harness([], { mute: 'Control+Alt+J' });
    h.hotkeys.start();
    // `talk` Control+Alt+J'yi aldı; `mute` kendi yedeğine düşer.
    expect(h.settings.get().hotkeys).toMatchObject({ talk: 'Control+Alt+J', mute: 'Control+Alt+K' });
  });

  it('durdurunca bütün kayıtları bırakır', () => {
    const h = harness([]);
    h.hotkeys.start();
    h.hotkeys.stop();
    expect(h.shortcuts.registered.size).toBe(0);
  });
});
