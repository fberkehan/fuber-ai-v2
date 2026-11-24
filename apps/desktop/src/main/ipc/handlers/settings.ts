// `settings.*` kanalları: yerel ayarlar, politikanın anahtarsız kopyası, kısayollar, veri klasörü.
import { shell } from 'electron';
import { defaultSettings, redactPolicy, UserError, type Ok, type Settings } from '@fuber/shared';
import { testing } from '../../testing';
import type { RegisterHandlers } from '../router';

const OK: Ok = { ok: true };
const KNOWN_KEYS = new Set(Object.keys(defaultSettings('')));

export const register: RegisterHandlers = (ipc, services) => {
  const { settings, policy, hotkeys, paths } = services;

  ipc.handle('settings.get', () => settings.get());

  ipc.handle('settings.update', ({ patch }) => {
    // Pencereden gelen yamada yalnız bilinen ayar alanları kabul edilir.
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => KNOWN_KEYS.has(key))) as Partial<Settings>;
    return settings.update(clean);
  });

  // Anahtarlar ana süreçten çıkmaz: arayüze politikanın anahtarsız kopyası gider.
  ipc.handle('settings.policy', () => redactPolicy(policy.get()));

  ipc.handle('settings.hotkeys', () => hotkeys.status());
  ipc.handle('settings.rebindHotkey', ({ id, accelerator }) => hotkeys.rebind(id, accelerator));

  ipc.handle('settings.openDataDir', async () => {
    // Sınamada Dosya Gezgini açılmaz.
    if (testing.enabled) return OK;
    const error = await shell.openPath(paths.data);
    if (error) throw new UserError(error);
    return OK;
  });

  ipc.handle('settings.openLogsDir', async () => {
    if (testing.enabled) return OK;
    const error = await shell.openPath(paths.logs);
    if (error) throw new UserError(error);
    return OK;
  });
};
