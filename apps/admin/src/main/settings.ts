/** Yönetim uygulamasının kendi küçük ayarları (politikadan ayrı; yalnız bu bilgisayara özgü). */

import fs from 'node:fs';
import path from 'node:path';

export interface AdminSettings {
  /** Windows açılınca gizli başla. */
  openAtLogin: boolean;
}

const DEFAULTS: AdminSettings = { openAtLogin: true };
const FILE = 'admin-settings.json';

export function createAdminSettings(dataDir: string) {
  const file = path.join(dataDir, FILE);
  let current: AdminSettings = { ...DEFAULTS };
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && typeof (raw as AdminSettings).openAtLogin === 'boolean') {
      current = { ...DEFAULTS, openAtLogin: (raw as AdminSettings).openAtLogin };
    }
  } catch {
    // ilk açılış ya da bozuk dosya: varsayılanlar
  }
  return {
    get: (): AdminSettings => ({ ...current }),
    update(patch: Partial<AdminSettings>): AdminSettings {
      current = { ...current, ...patch };
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(current, null, 2));
      fs.renameSync(temp, file);
      return { ...current };
    },
  };
}

export type AdminSettingsStore = ReturnType<typeof createAdminSettings>;
