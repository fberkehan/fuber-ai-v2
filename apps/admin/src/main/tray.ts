/** Tepsi simgesi: Yönetim pencere kapalıyken burada yaşar. */

import { Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import path from 'node:path';
import { t } from '@fuber/shared';

export interface TrayDeps {
  openWindow(): void;
  quit(): void;
  killSwitchActive(): Promise<boolean | null>;
  setKillSwitch(active: boolean): Promise<void>;
  openAtLogin(): boolean;
  /** `null`: bu kipte (geliştirme/sınama) sisteme kayıt yazılmaz, seçenek gösterilmez. */
  setOpenAtLogin: ((value: boolean) => void) | null;
  /** `tray-dark.ico` (beyaz, koyu görev çubuğu için) ve `tray-light.ico` buradadır. */
  iconsDir: string;
}

function themedIcon(iconsDir: string): NativeImage | null {
  const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;
  const image = nativeImage.createFromPath(path.join(iconsDir, dark ? 'tray-dark.ico' : 'tray-light.ico'));
  return image.isEmpty() ? null : image;
}

/** Servis hatasında (ya da simge dosyası yoksa) çizilen simge: koyu halka, hata varsa kırmızı nokta. 32×32 BGRA. */
function drawIcon(error: boolean): NativeImage {
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      let rgba: [number, number, number, number] = [0, 0, 0, 0];
      if (d <= 15.5) rgba = [10, 10, 11, 255];
      if (d >= 8.5 && d <= 12) rgba = [255, 255, 255, 255];
      if (d <= 4) rgba = error ? [255, 77, 77, 255] : [14, 89, 239, 255];
      buffer[i] = rgba[2];
      buffer[i + 1] = rgba[1];
      buffer[i + 2] = rgba[0];
      buffer[i + 3] = rgba[3];
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

export function createAdminTray(deps: TrayDeps) {
  let error: string | null = null;
  const iconFor = () => (error ? drawIcon(true) : (themedIcon(deps.iconsDir) ?? drawIcon(false)));
  const tray = new Tray(iconFor());
  const onTheme = () => {
    if (!tray.isDestroyed()) tray.setImage(iconFor());
  };
  nativeTheme.on('updated', onTheme);
  tray.setToolTip(t('admin.main.tray.tooltip'));
  tray.on('click', () => deps.openWindow());

  async function rebuild(): Promise<void> {
    const killSwitch = await deps.killSwitchActive().catch(() => null);
    const template: MenuItemConstructorOptions[] = [
      { label: t('admin.main.tray.open'), click: () => deps.openWindow() },
      { type: 'separator' },
      {
        label: t('admin.main.tray.killSwitch'),
        type: 'checkbox',
        checked: killSwitch === true,
        enabled: killSwitch !== null,
        click: (item) => void deps.setKillSwitch(item.checked).finally(() => void rebuild()),
      },
    ];
    if (deps.setOpenAtLogin) {
      const set = deps.setOpenAtLogin;
      template.push({
        label: t('admin.main.tray.openAtLogin'),
        type: 'checkbox',
        checked: deps.openAtLogin(),
        click: (item) => set(item.checked),
      });
    }
    template.push({ type: 'separator' }, { label: t('admin.main.tray.quit'), click: () => deps.quit() });
    if (!tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  void rebuild();
  return {
    rebuild,
    setError(next: string | null) {
      error = next;
      if (tray.isDestroyed()) return;
      tray.setImage(iconFor());
      tray.setToolTip(error ? `${t('admin.main.tray.tooltipError')}\n${error}` : t('admin.main.tray.tooltip'));
    },
    destroy() {
      nativeTheme.off('updated', onTheme);
      tray.destroy();
    },
  };
}
