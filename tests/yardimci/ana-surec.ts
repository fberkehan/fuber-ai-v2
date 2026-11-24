// Ana süreç modüllerini (ipc.ts, kopru.ts, ajan araçları) Electron'suz sınamak için ortak sahne (tests/ipc-kurulum.test.ts'teki kalıp):
// Electron sahtelenir (node:module registerHooks), kaynaklar esbuild'le bellekte JS'e çevrilir, veri klasörü ve ev geçici (FUBER_VERI,
// USERPROFILE/HOME; gerçek ~/.claude YOK), FUBER_SIR_* silinir. Ağ bekçisi: genel fetch hep reddeder; Electron net.fetch YALNIZ
// 127.0.0.1'e (testin kendi sahte sunucusu) gider. Dosya *.test.ts değildir: `npm test` onu tek başına çalıştırmaz.
// Sahte safeStorage şifrelemesi varsayılan KAPALI (sirYaz reddeder); `globalThis.__sifreleme = true` ile açılır (sır = düz base64).
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function anaSurecSahnesi(ad: string, ayar: Record<string, unknown>): { klasor: string; agIstekleri: string[] } {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), `fuber-${ad}-`));
  const ev = path.join(klasor, 'ev');
  fs.mkdirSync(path.join(ev, '.claude'), { recursive: true });
  for (const k of Object.keys(process.env)) if (/^FUBER_SIR_/.test(k)) delete process.env[k];
  Object.assign(process.env, { FUBER_VERI: klasor, FUBER_BELGELER: path.join(klasor, 'belgeler'), USERPROFILE: ev, HOME: ev, FUBER_CLAUDE_DIZIN: path.join(ev, '.claude') });
  fs.writeFileSync(path.join(klasor, 'ayarlar.json'), JSON.stringify(ayar));
  const agIstekleri: string[] = [];
  const gercek = globalThis.fetch;
  const g = globalThis as Record<string, unknown>;
  g.__yerelFetch = (u: string, i?: RequestInit) => {
    if (!/^https?:\/\/127\.0\.0\.1[:/]/.test(String(u))) { agIstekleri.push(String(u)); return Promise.reject(new Error('test: ağ yok')); }
    return gercek(u, i);
  };
  globalThis.fetch = (async (u: unknown) => { agIstekleri.push(String((u as { url?: string })?.url ?? u)); throw new Error('test: ağ yok'); }) as typeof fetch;
  after(() => assert.deepEqual(agIstekleri, [], 'yerel olmayan ağ isteği yapıldı'));
  g.__ipcIsleyiciler = new Map<string, (...a: unknown[]) => unknown>();
  g.__ipcKlasor = klasor;
  const ELECTRON = `
const h = globalThis.__ipcIsleyiciler;
const bos = () => undefined;
export const ipcMain = { handle: (k, f) => h.set(k, f), on: bos, removeHandler: (k) => h.delete(k), once: bos };
const appOlay = (o, f) => { (globalThis.__appOlaylari ??= []).push([o, f]); };
export const app = { getVersion: () => '0.0.0-test', getPath: () => globalThis.__ipcKlasor, isPackaged: false, getAppPath: () => process.cwd(), on: appOlay, once: appOlay, whenReady: () => Promise.resolve(), setLoginItemSettings: bos, quit: bos, getLocale: () => 'tr', requestSingleInstanceLock: () => true };
export class BrowserWindow { static getAllWindows() { return []; } static getFocusedWindow() { return null; } static fromWebContents() { return null; } }
export const shell = { openPath: async () => '', openExternal: async () => undefined, showItemInFolder: bos, trashItem: async () => undefined };
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
export const safeStorage = { isEncryptionAvailable: () => Boolean(globalThis.__sifreleme), encryptString: (s) => Buffer.from(s), decryptString: (b) => Buffer.from(b).toString() };
export const nativeTheme = { shouldUseDarkColors: true, on: bos, themeSource: 'system' };
const ekran = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
export const screen = { getPrimaryDisplay: () => ekran, getAllDisplays: () => [ekran], on: bos, getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ekran, getDisplayMatching: () => ekran };
export class Notification { static isSupported() { return false; } show() {} on() {} }
export class Tray { setToolTip() {} setContextMenu() {} on() {} }
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: bos };
const resim = { isEmpty: () => true, resize() { return resim; }, toPNG: () => Buffer.alloc(0), setTemplateImage: bos };
export const nativeImage = { createFromPath: () => resim, createEmpty: () => resim, createFromBuffer: () => resim, createFromDataURL: () => resim };
export const clipboard = { readText: () => '', writeText: bos };
export const globalShortcut = { register: () => true, unregister: bos, isRegistered: () => false, unregisterAll: bos };
export const net = { fetch: (u, i) => globalThis.__yerelFetch(u, i) };
export const powerMonitor = { on: bos, getSystemIdleTime: () => 0, isOnBatteryPower: () => false, getSystemIdleState: () => 'active' };
export const protocol = { handle: bos, registerSchemesAsPrivileged: bos };
export const session = { defaultSession: { setPermissionRequestHandler: bos, setPermissionCheckHandler: bos, preconnect: bos, webRequest: { onBeforeRequest: bos } }, fromPartition: () => session.defaultSession };
export class WebContentsView {}
export const Display = undefined, NativeImage = undefined, WebContents = undefined;
export default { ipcMain, app, BrowserWindow, shell, dialog, safeStorage, nativeTheme, screen, Notification, Tray, Menu, nativeImage, clipboard, globalShortcut, net, powerMonitor, protocol, session, WebContentsView };
`;
  const veri = (kod: string) => `data:text/javascript,${encodeURIComponent(kod)}`;
  // `ozel/`: isteğe bağlı modüller (bu depoda yok); kaynağı src/ gibi derlenir.
  const kaynakKokleri = ['src', 'ozel'].map((k) => path.resolve(import.meta.dirname, '..', '..', k) + path.sep);
  let donustur: ((k: string, o: object) => { code: string }) | null = null;
  const kanca = registerHooks({
    load(url, baglam, sonraki) {
      // Sorgu dizgesi (`kopru.ts?yeniden`) aynı kaynağın TAZE bir modül örneğidir: testler "yeniden başlatma"yı böyle sınar.
      const temiz = url.split('?')[0];
      if (url.startsWith('file:') && temiz.endsWith('.ts')) {
        const dosya = fileURLToPath(temiz);
        if (kaynakKokleri.some((k) => dosya.startsWith(k)) && donustur) {
          const { code } = donustur(fs.readFileSync(dosya, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2023', sourcefile: dosya });
          return { format: 'module', source: code, shortCircuit: true };
        }
      }
      return sonraki(url, baglam);
    },
    resolve(belirtec, baglam, sonraki) {
      if (belirtec === 'electron') return { url: veri(ELECTRON), shortCircuit: true };
      if (belirtec.startsWith('.') && belirtec.endsWith('.js') && baglam.parentURL?.startsWith('file:')) {
        const ts = new URL(belirtec.replace(/\.js$/, '.ts'), baglam.parentURL);
        if (fs.existsSync(fileURLToPath(ts))) return sonraki(ts.href, baglam);
      }
      return sonraki(belirtec, baglam);
    },
  });
  // esbuild eşzamanlı dönüştürücüsü (paketlemenin kendi derleyicisi); kanca kurulmadan önce yüklenir.
  g.__esbuildHazir = import('esbuild').then((m) => { donustur = m.transformSync as never; });
  after(() => {
    kanca.deregister();
    try { fs.rmSync(klasor, { recursive: true, force: true }); } catch { /* veritabanı açık kalabilir */ }
  });
  return { klasor, agIstekleri };
}

export const esbuildHazir = (): Promise<void> => (globalThis as Record<string, unknown>).__esbuildHazir as Promise<void>;
export const ipcIsleyicileri = (): Map<string, (...a: unknown[]) => unknown> => (globalThis as Record<string, unknown>).__ipcIsleyiciler as Map<string, (...a: unknown[]) => unknown>;

/** ipc.ts işleyicilerini kurar (pencere kontrolü boş). */
export async function ipcKurBos(): Promise<void> {
  await esbuildHazir();
  const { ipcKur } = await import('../../src/main/ipc.ts');
  const bos = () => undefined;
  ipcKur({
    asistanGoster: bos, asistanGizle: bos, anaGoster: bos, kulakYenile: bos, kisayollariKaydet: () => true,
    kisayolDurumu: () => ({ asistan: { alindi: true, tus: '' }, acil: { alindi: true, tus: '' } }) as never,
    kulakOlay: bos, kulakKomut: () => false, adaFare: bos, asistanKisayolu: bos, acilDurdur: bos, yenidenAc: bos, kapat: bos,
  });
}
