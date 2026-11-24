/**
 * Çalışma ortamının yolları. Paketli ve geliştirme kipinin farkı yalnız burada bilinir.
 */

import { app } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADMIN_APP_NAME } from '@fuber/shared';
import { testing } from './testing';

/** `dist/` klasörü. Bu dosya `dist/main/main.js` içine demetlenir. */
const distDir = path.resolve(import.meta.dirname, '..');

function readDevServerUrl(): string | null {
  if (app.isPackaged) return null;
  const value = app.commandLine.getSwitchValue('dev-server');
  return value ? value.replace(/\/$/, '') : null;
}

export const runtime = {
  distDir,
  preloadPath: path.join(distDir, 'preload', 'preload.cjs'),
  resourcesDir: app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.resolve(distDir, '..', 'resources'),
  /** Veri kökü: `%APPDATA%\Fuber Yönetim 2` (kontrol veritabanı burada); sınamada yalıtılmış klasör. */
  dataDir: testing.dataDir ?? path.join(app.getPath('appData'), ADMIN_APP_NAME),
  devServerUrl: readDevServerUrl(),
} as const;

/** Renderer sayfasının adresi. */
export function rendererUrl(): string {
  return runtime.devServerUrl
    ? `${runtime.devServerUrl}/main/index.html`
    : pathToFileURL(path.join(runtime.distDir, 'renderer', 'main', 'index.html')).toString();
}

/** Adres bizim renderer'ımıza mı ait (IPC gönderen denetimi için). */
export function isAppUrl(url: string): boolean {
  if (runtime.devServerUrl) return url.startsWith(`${runtime.devServerUrl}/`);
  return url.startsWith(`${pathToFileURL(path.join(runtime.distDir, 'renderer')).toString()}/`);
}
