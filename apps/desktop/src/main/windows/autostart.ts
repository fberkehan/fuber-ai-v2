/**
 * Windows'la başlama: `Settings.launchAtLogin` ayarını oturum açılış kaydına yansıtır. Açılışta başlayan
 * uygulama `--hidden` ile gelir ve yalnız tepside yaşar (ana pencere açılmaz).
 */

import { app } from 'electron';
import type { Bus, Logger, SettingsApi, Unsubscribe } from '@fuber/shared';
import { testing } from '../testing';

export const HIDDEN_ARG = '--hidden';

/** Uygulama oturum açılışında gizli başlatıldı mı. */
export function launchedHidden(argv: string[] = process.argv): boolean {
  return argv.includes(HIDDEN_ARG);
}

export function watchAutostart(deps: { settings: SettingsApi; bus: Bus; log: Logger }): Unsubscribe {
  // Sınamada ve geliştirme kipinde sisteme kayıt yazılmaz: geliştirmede kayıt çıplak electron.exe'yi gösterirdi.
  if (!testing.systemIntegration || !app.isPackaged) return () => {};

  const apply = () => {
    const wanted = deps.settings.get().launchAtLogin;
    try {
      if (app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin === wanted) return;
      app.setLoginItemSettings({ openAtLogin: wanted, args: [HIDDEN_ARG] });
      deps.log.info(`Windows'la başlama ${wanted ? 'açıldı' : 'kapatıldı'}`);
    } catch (error) {
      deps.log.warn("Windows'la başlama kaydı güncellenemedi", error);
    }
  };

  apply();
  return deps.bus.on('settings.changed', ({ changedKeys }) => {
    if (changedKeys.includes('launchAtLogin')) apply();
  });
}
