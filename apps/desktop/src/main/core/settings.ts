import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { RETIRED_SETTING_KEYS, defaultSettings, type ServiceDeps, type Settings, type SettingsApi } from '@fuber/shared';

/**
 * Kullanıcının ev klasörü. Ayar servisi çekirdektir ve açılışı düşürmemelidir: `getPath` fırlatırsa işletim sistemi değerine düşülür.
 */
function homeDir(): string {
  try {
    return app.getPath('home');
  } catch {
    return os.homedir();
  }
}

export function createSettings(deps: ServiceDeps['settings']): SettingsApi {
  const kv = deps.store.kv('settings');
  const defaults = defaultSettings(path.join(homeDir(), 'Projects'));
  // Kayıtlı ayara sonradan eklenen alanlar varsayılandan tamamlanır; kaldırılmış alanlar (eski görünüm seçimi) atılır.
  const saved: Record<string, unknown> = { ...(kv.get<Partial<Settings>>('value') ?? {}) };
  const retired = RETIRED_SETTING_KEYS.filter((key) => key in saved);
  for (const key of retired) delete saved[key];
  let current: Settings = { ...defaults, ...saved } as Settings;
  if (retired.length > 0) kv.set('value', current as never);

  return {
    get: () => current,
    update(patch) {
      const changedKeys = (Object.keys(patch) as Array<keyof Settings>).filter(
        (key) => JSON.stringify(patch[key]) !== JSON.stringify(current[key]),
      );
      if (changedKeys.length === 0) return current;
      current = { ...current, ...patch };
      kv.set('value', current as never);
      deps.bus.emit('settings.changed', { settings: current, changedKeys });
      return current;
    },
  };
}
