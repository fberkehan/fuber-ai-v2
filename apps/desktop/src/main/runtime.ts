/**
 * Çalışma ortamının yolları: derlenmiş dosyalar, kaynaklar, veri kökü ve renderer adresleri.
 * Paketli ve geliştirme kipinin farkı yalnız burada bilinir.
 */

import { app } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DESKTOP_APP_NAME, type RendererEntry } from '@fuber/shared';
import { testing } from './testing';

/** `dist/` klasörü. Bu dosya `dist/main/main.js` içine demetlenir. */
const distDir = path.resolve(import.meta.dirname, '..');

/** Geliştirmede Vite sunucusunun adresi (`--dev-server=http://localhost:5173`); paketli uygulamada yok sayılır. */
function readDevServerUrl(): string | null {
  if (app.isPackaged) return null;
  const value = app.commandLine.getSwitchValue('dev-server');
  return value ? value.replace(/\/$/, '') : null;
}

export const runtime = {
  distDir,
  preloadPath: path.join(distDir, 'preload', 'preload.cjs'),
  /** `utilityProcess.fork` ile başlatılacak ses işçisi. */
  workerPath: path.join(distDir, 'worker', 'index.js'),
  /** `utilityProcess.fork` ile başlatılacak ses konağı (ekran kartında çalışan seslendirme motorları). */
  ttsHostPath: path.join(distDir, 'tts-host', 'index.js'),
  /** Ayrı süreçte başlatılacak yetenek konağı. */
  skillHostPath: path.join(distDir, 'skill-host', 'index.js'),
  /** Uygulamayla gelen salt okunur kaynaklar. Paketli uygulamada asar dışındadır (alt süreçler okuyabilsin diye). */
  resourcesDir: app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.resolve(distDir, '..', 'resources'),
  /** Veri kökü: `%APPDATA%\Fuber AI 2`; sınamada yalıtılmış klasör. */
  dataDir: testing.dataDir ?? path.join(app.getPath('appData'), DESKTOP_APP_NAME),
  devServerUrl: readDevServerUrl(),
} as const;

/** Bir renderer girişinin adresi. `query`: `{ surface: 'island' }` → `?surface=island`. */
export function rendererUrl(entry: RendererEntry, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(query).toString();
  const base = runtime.devServerUrl
    ? `${runtime.devServerUrl}/${entry}/index.html`
    : pathToFileURL(path.join(runtime.distDir, 'renderer', entry, 'index.html')).toString();
  return search ? `${base}?${search}` : base;
}

/** Adres bizim renderer'larımızdan birine mi ait (IPC gönderen denetimi için). */
export function isAppUrl(url: string): boolean {
  if (runtime.devServerUrl) return url.startsWith(`${runtime.devServerUrl}/`);
  const root = pathToFileURL(path.join(runtime.distDir, 'renderer')).toString();
  return url.startsWith(`${root}/`);
}
