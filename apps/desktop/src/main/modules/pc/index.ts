// Bilgisayar modülü (KURGU §10): uygulama ve adres açma; pencereleri, sekmeleri ve ekranı OKUMA; fare, klavye,
// pencere ve tarayıcıyı KULLANMA.
//
// İzin modeli (cihaz düzeyinde, Ayarlar › Gizlilik ve veri):
//   `Settings.pcReadAllowed`    → okuma araçları (pc_windows, pc_read_window, browser_tabs, browser_read, screen_look)
//   `Settings.pcControlAllowed` → kullanma araçları (pc_type, pc_keys, pc_click, pc_drag, pc_scroll, pc_focus_window,
//                                 pc_window_action, pc_media, browser_search, browser_navigate)
// Kapalı iznin araçları KAYITLI DEĞİLDİR: model onları göremez, çağıramaz. Ayar değişince kayıt canlı güncellenir.
// Ad eşleştirme ve süreç başlatma yardımcıları projeler modülüyle aynı saf işlevlerdir (çalışma anı bağı yok).
//
// d3 ("bu bilgisayardaki neredeyse her şey"): aynı iki izin şu araçları da kapsar.
//   okuma   → pc_find, pc_screens, file_find, system_info, process_list, network_status, app_list, clipboard_read
//   kullanma→ pc_window_arrange, pc_selftest; dosya (file_copy/move/delete/open/reveal, folder_create); komut ve süreç
//             (pc_run_command, app_close, process_kill); pano ve sistem (clipboard_write, system_brightness, system_lock,
//             system_power, system_power_cancel, screenshot_save, notify_show)
// Fare/klavye dışındaki araçlar `gate.ts` kapısından geçer: adadaki "Durdur" ve acil dur onları da keser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineModule, defineTool, nowIso, t, type Logger, type ModuleContext, type ModuleDef, type ToolResult, type Unsubscribe } from '@fuber/shared';
import { createActivityEmitter } from './activity';
import { z } from 'zod';
import { deepBrainFor } from '../../core/brain/deep';
import { testing } from '../../testing';
import type { AccessConfig } from '../documents/access';
import { documentsAccess } from '../documents/index';
import { launch } from '../projects/launch';
import { decisive, rankCandidates } from '../projects/match';
import { KNOWN_APPS, mergeApps, startMenuShortcuts, storeApps, type AppEntry } from './apps';
import { createPcControl, type ControlActivity, type PcControl } from './control';
import { createFakeClipboard, createFakeDeviceDriver, deviceControlTools, deviceReadTools, type DeviceDriver } from './device';
import { fileControlTools, fileReadTools } from './files';
import { createPcGate } from './gate';
import { sensitiveWindow } from './guard';
import { observe } from './observe';
import { createPcOverlay, formatAccelerator, type OverlayHost, type PcOverlay } from './overlay';
import { clip, matchWindow } from './read';
import { createShotMemory, lookAtScreen, type Capture } from './screen';
import { runSelftest, selftestTool } from './selftest';
import { stopAllBackground, systemControlTools, systemReadTools } from './system';
import { controlTools, readTools } from './tools';
import type { ClipboardPort, DeepBrain, InputDriver, PcAction, PcActivity, ScreenInfo, SelftestReport, SelftestStep, UiaProvider, WindowInfo } from './types';

export { TOOL_GROUPS } from './tools';
export type { PcActivity } from './types';

export interface PcDeps {
  openPath(target: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  /** Uygulama listesi (Başlat menüsü + mağaza + bilinenler). */
  listApps(): Promise<AppEntry[]>;
  /** İmlecin bulunduğu (ya da numarası verilen) ekranın görüntüsü; diske yazılmaz, bellekten doğrudan beyne gider. */
  captureScreen(screen?: number): Promise<Capture>;
  launchExe(file: string, args?: string[]): Promise<{ ok: boolean; error: string | null }>;
  /** Pencere/sekme/metin okuyucusu (UI Automation). Yoksa okuma ve kullanma araçları sunulmaz. */
  uia?: UiaProvider;
  /** Fare/klavye sürücüsü. Yoksa kullanma araçları sunulmaz. */
  input?: InputDriver;
  /** Görüntü anlayan derin beyin (köprü). Yoksa `screen_look` bulut `vision` rolüne, o da yoksa ekrandaki yazıya düşer. */
  deepBrain?: DeepBrain;
  sleep?(ms: number): Promise<void>;
  /** Bağlı ekranlar (çoklu ekran, DPI). */
  screens?(): ScreenInfo[];
  /** Pano. Sınama kipinde SAHTE: geliştiricinin panosu okunmaz, değiştirilmez. */
  clipboard?: ClipboardPort;
  /** Ses düzeyi, parlaklık, kilit, güç. Sınama kipinde SAHTE: hiçbir şey gerçekten değişmez. */
  device?: DeviceDriver;
  /** Ekran görüntüsü, PNG (`screenshot_save`); `screen` 0'dan başlar. */
  capturePng?(screen?: number): Promise<{ png: Buffer; width: number; height: number; dark?: boolean }>;
  screenshotDir?(): string;
  notify?(title: string, body: string): boolean;
  /** Geri Dönüşüm Kutusu. */
  trash?(target: string): Promise<void>;
  /** Gezgin'de göster. */
  reveal?(target: string): void;
  /** Fare ve klavye sınamasının geçici dosyaları için klasör. */
  tempDir?(): string;
  /** `app_open`: açılan uygulamanın penceresi en çok bu kadar beklenir (ms). Varsayılan 8000; sınama kipinde 600. */
  openWaitMs?: number;
  /**
   * Ekran katmanının pencereleri (kenar ışığı, Jarvis'in imleci; `overlay-host.ts`). Yoksa katman kurulmaz (birim
   * sınamaları). Sınama kipinde pencere açılır ama ekrana ÇIKMAZ.
   */
  overlayHost?: OverlayHost;
}

/** Claude'un görsel girdisinde önerilen uzun kenar. */
const MAX_IMAGE_EDGE = 1568;
const APP_CACHE_MS = 10 * 60_000;
/** Son eylemden sonra "bilgisayarı kullanıyor" durumu bu kadar daha açık kalır (ardışık eylemlerde yanıp sönmesin). */
const ACTIVITY_LINGER_MS = 1500;
/** `app_open`: pencere görünene dek yoklama aralığı ve üst sınır. */
const OPEN_POLL_MS = 200;
const OPEN_WAIT_MS = 8000;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 1×1 saydam PNG: sınama kipinde `screenshot_save` geliştiricinin gerçek ekranını diske yazmasın. */
const TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64');

/** Görüntü neredeyse tamamen siyah mı (ekran uykuda, içerik korumalı): seyrek örnekleme, BGRA. */
function isDark(bitmap: Buffer, width: number, height: number): boolean {
  if (width <= 0 || height <= 0 || bitmap.length < width * height * 4) return false;
  let total = 0;
  let count = 0;
  const stepY = Math.max(1, Math.floor(height / 24));
  const stepX = Math.max(1, Math.floor(width / 40));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const at = (y * width + x) * 4;
      total += bitmap[at]! + bitmap[at + 1]! + bitmap[at + 2]!;
      count += 1;
    }
  }
  return count > 0 && total / (3 * count) < 3;
}

async function electronDeps(env: { log: Logger }): Promise<PcDeps> {
  const electron = await import('electron');
  let cache: { at: number; apps: AppEntry[] } | null = null;

  let uia: UiaProvider | undefined;
  let input: InputDriver | undefined;
  if (process.platform === 'win32') {
    if (testing.pcUia) {
      const [{ createUiaHelper }, { runtime }] = await Promise.all([import('./uia'), import('../../runtime')]);
      const helper = createUiaHelper({ script: path.join(runtime.resourcesDir, 'pc', 'uia-helper.ps1'), ownerPid: process.pid, log: env.log });
      // Sınama sınırı: UIA deseniyle etkinleştirme de GERÇEK bir tıklamadır; sınama kipinde yapılmaz, kaydedilir.
      uia = testing.fakeInput
        ? {
            ...helper,
            async invoke(ref) {
              testing.recordInput({ type: 'invoke', ref });
              return { ok: false, error: 'sınama kipi' };
            },
          }
        : helper;
    }
    try {
      const real = await (await import('./input-win32')).loadWin32Input();
      // Sınama sınırı: sınama kipinde gerçek girdi üretilmez; okuyan çağrılar gerçek, yapan çağrılar kayıttır.
      input = testing.fakeInput ? (await import('./input-fake')).createRecordingInput(real, testing.recordInput) : real;
    } catch (error) {
      env.log.warn('fare/klavye sürücüsü yüklenemedi; bilgisayarı kullanma araçları sunulmayacak', error);
    }
  }

  /** Ekranlar soldan sağa, yukarıdan aşağıya; dikdörtgenler fiziksel piksel (girdi sürücüsüyle aynı ölçü). */
  const displays = () => {
    const { screen } = electron;
    return screen
      .getAllDisplays()
      .map((display) => ({ display, bounds: screen.dipToScreenRect(null, display.bounds), work: screen.dipToScreenRect(null, display.workArea) }))
      .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  };
  const displayFor = (index?: number) => {
    const { screen } = electron;
    const listed = index === undefined ? undefined : displays()[index - 1]?.display;
    if (index !== undefined && !listed) throw new Error(t('pc.fail.no_screen'));
    return listed ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  };
  const toRect = (box: { x: number; y: number; width: number; height: number }) => ({ left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height });

  // Sınama sınırı: pano, ses/parlaklık/kilit/güç, Geri Dönüşüm Kutusu ve bildirim sınama kipinde SAHTEDİR (kayıt düşer).
  let clipboard: ClipboardPort;
  let device: DeviceDriver;
  if (testing.enabled) {
    clipboard = createFakeClipboard();
    device = createFakeDeviceDriver(testing.recordInput);
  } else {
    const [{ createPsDeviceDriver }, { runtime }] = await Promise.all([import('./device'), import('../../runtime')]);
    device = createPsDeviceDriver({ script: path.join(runtime.resourcesDir, 'pc', 'system-helper.ps1') });
    clipboard = {
      readText: () => electron.clipboard.readText(),
      writeText: (text) => electron.clipboard.writeText(text),
      async hasNonText() {
        try {
          const types = (await electron.clipboard.read()).flatMap((item) => item.types);
          return types.length > 0 && !types.some((type) => type.startsWith('text/'));
        } catch {
          // Pano okunamadı: içinde ne olduğu bilinmiyor; bozmamak için "metin dışı var" sayılır (uzun metin tuş tuş yazılır).
          return true;
        }
      },
    };
  }

  const { createElectronOverlayHost } = await import('./overlay-host');

  return {
    overlayHost: createElectronOverlayHost(),
    screens() {
      const { screen } = electron;
      const current = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
      return displays().map((item, index) => ({
        index: index + 1,
        bounds: toRect(item.bounds),
        work: toRect(item.work),
        scale: item.display.scaleFactor,
        primary: item.display.id === screen.getPrimaryDisplay().id,
        current: item.display.id === current,
      }));
    },
    clipboard,
    device,
    async capturePng(index) {
      if (testing.enabled) return { png: TEST_PNG, width: 1, height: 1 };
      const { desktopCapturer } = electron;
      const display = displayFor(index === undefined ? undefined : index + 1);
      const width = Math.round(display.size.width * display.scaleFactor);
      const height = Math.round(display.size.height * display.scaleFactor);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
      if (!source || source.thumbnail.isEmpty()) throw new Error(t('projects.pc.captureFailed'));
      const size = source.thumbnail.getSize();
      return { png: source.thumbnail.toPNG(), width: size.width, height: size.height, dark: isDark(source.thumbnail.toBitmap(), size.width, size.height) };
    },
    screenshotDir: () => (testing.enabled ? path.join(os.tmpdir(), 'fuber2-test-screenshots') : path.join(electron.app.getPath('pictures'), 'Fuber AI 2')),
    notify(title, body) {
      if (testing.enabled) {
        testing.recordInput({ type: 'notify', title: title.length, body: body.length });
        return true;
      }
      if (!electron.Notification.isSupported()) return false;
      new electron.Notification({ title, body, silent: true }).show();
      return true;
    },
    async trash(target) {
      if (testing.enabled) {
        // Geliştiricinin Geri Dönüşüm Kutusu'na sınama çöpü düşmesin: dosya yalıtılmış bir klasöre taşınır.
        const bin = path.join(os.tmpdir(), 'fuber2-test-trash');
        fs.mkdirSync(bin, { recursive: true });
        fs.renameSync(target, path.join(bin, `${Date.now()}-${path.basename(target)}`));
        testing.recordInput({ type: 'trash' });
        return;
      }
      await electron.shell.trashItem(target);
    },
    reveal(target) {
      if (testing.fakeLaunch || testing.enabled) void testing.fakeShell.openPath(target);
      else electron.shell.showItemInFolder(target);
    },
    tempDir: () => electron.app.getPath('temp'),
    // Sınama sınırı (sahte başlatıcı): uygulama, klasör ve adres gerçekten açılmaz; kaydedilir.
    openPath: (target) => (testing.fakeLaunch ? testing.fakeShell.openPath(target) : electron.shell.openPath(target)),
    openExternal: (url) => (testing.fakeLaunch ? testing.fakeShell.openExternal(url) : electron.shell.openExternal(url)),
    async listApps() {
      if (cache && Date.now() - cache.at < APP_CACHE_MS) return cache.apps;
      const [shortcuts, store] = await Promise.all([startMenuShortcuts(), storeApps()]);
      const apps = mergeApps(shortcuts, store, KNOWN_APPS);
      cache = { at: Date.now(), apps };
      return apps;
    },
    async captureScreen(index) {
      const { desktopCapturer, screen } = electron;
      const display = displayFor(index);
      const width = display.size.width * display.scaleFactor;
      const height = display.size.height * display.scaleFactor;
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
      });
      const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
      if (!source || source.thumbnail.isEmpty()) throw new Error(t('projects.pc.captureFailed'));
      const size = source.thumbnail.getSize();
      // Fiziksel piksel: koordinatla tıklama aynı ölçüde çalışır (ölçekli ve çoklu ekranda kayma olmasın).
      const bounds = screen.dipToScreenRect(null, display.bounds);
      return {
        mediaType: 'image/jpeg',
        data: source.thumbnail.toJPEG(80).toString('base64'),
        geometry: {
          screen: { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height },
          width: size.width,
          height: size.height,
        },
        dark: isDark(source.thumbnail.toBitmap(), size.width, size.height),
      };
    },
    async launchExe(file, args = []) {
      const outcome = await launch({ file, args }, testing.fakeLaunch ? { spawn: testing.fakeSpawn, waitMs: 50 } : args.length > 0 ? { waitMs: 600 } : {});
      return { ok: outcome.ok, error: outcome.error };
    },
    ...(uia ? { uia } : {}),
    ...(input ? { input } : {}),
  };
}

function appNames(app: AppEntry): string[] {
  return [app.name, ...(app.aliases ?? [])];
}

export interface PcModuleOptions {
  lingerMs?: number;
  /** `PcDeps.deepBrain` verilmemişse görüntü anlayan beyin buradan alınır (uygulamada çekirdeğin derin beyni). */
  deepBrain?(ctx: ModuleContext): DeepBrain;
}

export function createPcModule(factory: (env: { log: Logger }) => Promise<PcDeps> = electronDeps, options: PcModuleOptions = {}): ModuleDef {
  let deps: Promise<PcDeps> | null = null;
  let log: Logger | null = null;
  const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => quiet };
  const get = () => (deps ??= factory({ log: log ?? quiet }));
  const shots = createShotMemory();
  let teardown: Array<() => void> = [];
  /** Adadaki "Durdur" düğmesinin karşılığı; modül kurulunca bağlanır. */
  let stopControl: (() => void) | null = null;
  /** Fare ve klavye sınaması; modül kurulunca bağlanır (IPC ve araç aynısını çağırır). */
  let selftest: (() => Promise<SelftestReport>) | null = null;

  /**
   * Açılan uygulamanın penceresi görünene dek bekler (tek adım: aç + hazır olunca dön). "Hazır": açmadan önce olmayan
   * yeni bir pencere (adı uygulamayla eşleşen öne geçer) ya da uygulama zaten açıksa öne gelen penceresi.
   * Girdi üretmez; yalnız pencere listesini yoklar. Süre dolarsa "pencere görmedim" diye dürüstçe döner.
   */
  const waitForWindow = async (app: AppEntry, pc: PcDeps, before: ReadonlySet<number>): Promise<{ window: WindowInfo | null; front: boolean; ms: number }> => {
    const uia = pc.uia!;
    const sleep = pc.sleep ?? realSleep;
    const limit = pc.openWaitMs ?? (testing.enabled ? 600 : OPEN_WAIT_MS);
    let waited = 0;
    for (;;) {
      await sleep(OPEN_POLL_MS);
      waited += OPEN_POLL_MS;
      try {
        const list = await uia.windows();
        const others = list.windows.filter((window) => !window.own);
        const fresh = others.filter((window) => !before.has(window.hwnd));
        const names = appNames(app);
        const named = (pool: WindowInfo[]): WindowInfo | null => {
          for (const name of names) {
            const hit = matchWindow(name, pool);
            if (hit) return hit;
          }
          return null;
        };
        // Yeni pencere: adı uyan; uyan yoksa tek yeni pencere (başlığı uygulama adını taşımayan uygulamalar).
        let pick = named(fresh) ?? (fresh.length === 1 ? fresh[0]! : null);
        // Uygulama zaten açıktı: var olan penceresi öne geldiyse o.
        if (!pick && list.foreground && !list.foreground.own && named([list.foreground])) pick = list.foreground;
        if (pick) return { window: pick, front: list.foreground?.hwnd === pick.hwnd, ms: waited };
      } catch {
        // okuyucu yanıt vermedi: süre dolana dek yeniden denenir
      }
      if (waited >= limit) return { window: null, front: false, ms: waited };
    }
  };

  const openApp = async (app: AppEntry, pc: PcDeps, readAllowed = false): Promise<ToolResult> => {
    let before: Set<number> | null = null;
    if (pc.uia && readAllowed) {
      try {
        before = new Set((await pc.uia.windows()).windows.map((window) => window.hwnd));
      } catch {
        before = null;
      }
    }
    let error: string | null = null;
    if (app.kind === 'shortcut') error = (await pc.openPath(app.target)) || null;
    else if (app.kind === 'exe') error = (await pc.launchExe(app.target)).error;
    else {
      try {
        await pc.openExternal(app.target);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    if (error) return { ok: false, text: t('projects.pc.appFailed', { name: app.name, error }) };
    const opened = t('projects.pc.appOpened', { name: app.name });
    if (!before || !pc.uia) return { ok: true, text: opened };
    const ready = await waitForWindow(app, pc, before);
    const seconds = (ready.ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
    if (!ready.window) return { ok: true, text: opened + t('pc.open.noWindow', { seconds }), data: { windowReady: false } };
    const label = `${clip(ready.window.title, 60) || ready.window.app} [${ready.window.app}]`;
    // Pencerede ne var: model ara kutusunu, düğmeleri ayrı bir bakış turu olmadan görür.
    const scene = sensitiveWindow(ready.window) ? '' : (await observe(pc.uia, { hwnd: ready.window.hwnd, delayMs: 150, sleep: pc.sleep ?? realSleep })).text;
    return {
      ok: true,
      text: opened + t(ready.front ? 'pc.open.ready' : 'pc.open.readyBehind', { window: label, seconds }) + scene.replace(t('pc.after', { window: `“${label}”` }), ''),
      data: { windowReady: true, windowId: ready.window.hwnd, front: ready.front, untrusted: true },
    };
  };

  const tools = [
    defineTool({
      name: 'app_open',
      group: 'open',
      description:
        'Bilgisayardaki bir uygulamayı adıyla açar (Başlat menüsündeki uygulamalar, "hesap makinesi", "not defteri", "ayarlar"). ' +
        'Ad yaklaşık olabilir; birden çok aday çıkarsa açmaz, seçenekleri döndürür. Penceresi görünene dek bekler ve pencerede görünen alan/düğmeleri de söyler: ' +
        'ardından ayrıca beklemek ya da ekrana bakmak gerekmez. Açıldığını yalnız araç başarılı dönerse söyle. Kullanıcı bir uygulamayı açmanı istediğinde kullan; asistanın kendi sayfaları için app_navigate, web adresi için url_open.',
      input: z.object({ name: z.string().min(1).describe('Uygulamanın adı') }),
      risk: 'write',
      async run({ name }, ctx) {
        const pc = await get();
        const apps = await pc.listApps();
        const ranked = rankCandidates(name, apps.map((app) => ({ item: app, names: appNames(app) })));
        if (ranked.length === 0) return { ok: false, text: t('projects.pc.appNotFound', { name }) };
        const winner = decisive(ranked);
        if (!winner) {
          const names = ranked.slice(0, 5).map((item) => item.item.name);
          return { ok: false, text: t('projects.pc.appAmbiguous', { names: names.join(', ') }), data: names };
        }
        ctx.report(t('pc.do.step.open', { app: clip(winner.name, 40) }));
        return openApp(winner, pc, ctx.settings.get().pcReadAllowed !== false);
      },
    }),
    defineTool({
      name: 'url_open',
      group: 'open',
      description:
        'Bir web adresini varsayılan tarayıcıda açar. Yalnız http ve https adresleri. Yalnız kullanıcı bir siteyi ya da adresi ' +
        'AÇMANI açıkça isterse kullan ("example.com sitesini aç"); bilgi sorusunu yanıtlamak ya da araştırma yapmak için KULLANMA.',
      input: z.object({ url: z.string().min(4).describe('Tam adres: https://…') }),
      risk: 'write',
      async run({ url }) {
        let parsed: URL;
        try {
          parsed = new URL(url.includes('://') ? url : `https://${url}`);
        } catch {
          return { ok: false, text: t('projects.pc.badUrl', { url }) };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, text: t('projects.pc.badUrl', { url }) };
        try {
          await (await get()).openExternal(parsed.toString());
          return { ok: true, text: t('projects.pc.urlOpened', { url: parsed.toString() }) };
        } catch (error) {
          return { ok: false, text: t('projects.pc.urlFailed', { error: error instanceof Error ? error.message : String(error) }) };
        }
      },
    }),
  ];

  return defineModule({
    id: 'pc',
    version: '1.1.0',
    nameKey: 'module.pc.name',
    descriptionKey: 'module.pc.description',
    permissions: ['shell', 'screen'],
    tools,
    // Ada "Bilgisayarı kullanıyor" durumunu bu olaydan gösterir.
    windowEvents: ['pc.activity', 'pc.selftest.progress'],
    ipc: (ctx) => ({
      'pc.stop': () => {
        stopControl?.();
        ctx.bus.emit('pc.stopRequested', { at: nowIso() });
        return { ok: true as const };
      },
      'pc.selftest.run': async () => (selftest ? selftest() : { ok: false, stopped: null, unavailable: t('pc.selftest.unavailable'), steps: [], ms: 0 }),
    }),

    async setup(ctx: ModuleContext) {
      log = ctx.log;
      const pc = await get();
      const sleep = pc.sleep ?? realSleep;
      const { uia, input } = pc;
      const deepBrain = pc.deepBrain ?? options.deepBrain?.(ctx);

      // ── adada görünür durum ──
      let active = false;
      let lingering: NodeJS.Timeout | null = null;
      // Kanal ortaktır (asistanın tarayıcısı da yayınlar): başkasının süren satırını kaldıracak "bitti" yayınlanmaz.
      const channel = createActivityEmitter(ctx.bus, 'pc');
      const emit = (activity: Omit<PcActivity, 'at' | 'source'>) => {
        active = activity.active;
        channel.emit(activity);
      };
      const settle = () => {
        if (lingering) clearTimeout(lingering);
        lingering = setTimeout(() => {
          lingering = null;
          if (active) emit({ active: false, action: null, app: null, interrupted: null, point: null });
        }, options.lingerMs ?? ACTIVITY_LINGER_MS);
      };
      // Süren eylemin kimliği: görsel olaylar (`fx`) ve onay beklemesi aynı satırı günceller.
      let last: { action: PcAction; app: string | null; step: string | null } | null = null;
      let waiting = false;
      /** Toplu eylemin (`pc_do`) o anki adımı; adım metni bundan gelir. */
      let batchStep: { index: number; total: number; text: string } | null = null;
      const stepText = (event: ControlActivity): string | null => {
        switch (event.action) {
          case 'click':
            return event.detail ? t('pc.step.click', { name: clip(event.detail, 40) }) : t('pc.step.clickPoint');
          case 'type':
            return event.detail ? t('pc.step.type', { count: event.detail }) : null;
          case 'keys':
            return event.detail ? t('pc.step.keys', { keys: clip(event.detail, 30) }) : null;
          case 'focus':
            return event.window ? t('pc.step.focus', { app: event.window.app }) : null;
          default:
            return null;
        }
      };
      const onActivity = (event: ControlActivity) => {
        if (event.state === 'start' || event.state === 'point' || event.state === 'fx' || event.state === 'waiting') {
          if (lingering) clearTimeout(lingering);
          lingering = null;
          if (event.state === 'start' || !last) last = { action: event.action, app: event.window?.app ?? null, step: stepText(event) };
          if (event.state === 'waiting') waiting = event.on === true;
          emit({
            active: true,
            action: last.action,
            app: last.app ?? event.window?.app ?? null,
            interrupted: null,
            point: event.point ?? null,
            // Onay beklerken adım metni değişmez: ada onay kartını, katman "Onayınızı bekliyorum" durumunu kendi gösterir.
            step: batchStep?.text ?? last.step,
            progress: batchStep ? { index: batchStep.index, total: batchStep.total } : null,
            waiting: waiting ? 'approval' : null,
            fx: event.fx ?? null,
          });
        } else if (event.state === 'interrupted') {
          if (lingering) clearTimeout(lingering);
          lingering = null;
          last = null;
          waiting = false;
          emit({ active: false, action: event.action, app: event.window?.app ?? null, interrupted: event.reason ?? 'user', point: null });
        } else {
          last = null;
          waiting = false;
          if (active) settle();
        }
      };
      /** `pc_do` adımı: fare/klavye olmayan adımlarda da (aç, bekle, oku) adada ve katmanda ilerleme görünür. */
      const onBatchStep = (progress: { index: number; total: number; text: string } | null) => {
        batchStep = progress;
        if (!progress) {
          if (active) settle();
          return;
        }
        if (lingering) clearTimeout(lingering);
        lingering = null;
        emit({ active: true, action: last?.action ?? 'click', app: last?.app ?? null, interrupted: null, point: null, step: progress.text, progress: { index: progress.index, total: progress.total }, waiting: null, fx: null });
      };

      const control: PcControl | null = uia && input ? createPcControl({ input, uia, sleep, onActivity, ...(pc.clipboard ? { clipboard: pc.clipboard } : {}) }) : null;

      // ── ekran katmanı: "bu bilgisayarı şu an Jarvis kullanıyor" (kenar ışığı, imleç, tıklama dalgası, hedef vurgusu) ──
      // Kanalı dinler (`pc.activity`): asistanın kendi tarayıcısının yayınları da katmanda görünür. Pencereler ilk
      // etkinlikte açılır, boşta pencere yoktur; odak almaz, tıklamayı geçirir, ekran görüntüsüne girmez.
      let overlay: PcOverlay | null = null;
      let offOverlay: Unsubscribe | null = null;
      if (pc.overlayHost) {
        overlay = createPcOverlay({
          host: pc.overlayHost,
          reducedMotion: () => ctx.settings.get().reducedMotion,
          assistantName: () => ctx.policy.get().persona.name,
          stopKeys: () => formatAccelerator(ctx.settings.get().hotkeys.panic),
        });
        offOverlay = ctx.bus.on('pc.activity', (activity) => overlay?.handle(activity));
      }

      // ── fare/klavye dışındaki araçların kapısı (dosya, komut, pano, sistem): Durdur onları da keser ──
      const gate = createPcGate({
        inputHalted: () => control?.haltedBy() ?? null,
        onActivity(event) {
          if (event.state === 'start') {
            if (lingering) clearTimeout(lingering);
            lingering = null;
            emit({ active: true, action: event.action, app: event.label, interrupted: null, point: null });
          } else if (active) settle();
        },
      });

      // ── dosya erişim kuralları: belgeler modülününkiler; o kapalıysa yalnız Belgeler/Masaüstü/İndirilenler ──
      const home = testing.enabled ? (testing.documentsHome ?? path.join(ctx.paths.data, 'test-home')) : os.homedir();
      const fallbackAccess: AccessConfig = {
        platform: process.platform,
        home,
        readRoots: () => ['Documents', 'Desktop', 'Downloads'].map((name) => path.join(home, name)),
        extraBlocked: [ctx.paths.data],
      };
      const access = (): AccessConfig => documentsAccess()?.config() ?? fallbackAccess;
      const expand = (raw: string): string => documentsAccess()?.expand(raw) ?? raw.trim().replace(/^["']|["']$/g, '');
      const fileEnv = {
        gate,
        access,
        expand,
        trash: (target: string) => (pc.trash ? pc.trash(target) : Promise.reject(new Error(t('pc.fail.noTrash')))),
        openPath: (target: string) => pc.openPath(target),
        reveal: (target: string) => pc.reveal?.(target),
      };
      const systemEnv = {
        gate,
        access,
        expand,
        defaultCwd: () => documentsAccess()?.known().documents ?? path.join(home, 'Documents'),
        ownPid: process.pid,
        sleep,
        ...(uia ? { uia } : {}),
        ...(input ? { input } : {}),
      };
      const deviceEnv =
        pc.clipboard && pc.device && pc.capturePng && pc.screenshotDir && pc.notify
          ? {
              gate,
              clipboard: pc.clipboard,
              device: pc.device,
              capturePng: pc.capturePng,
              screenshotDir: pc.screenshotDir,
              notify: pc.notify,
              async sensitiveForeground() {
                if (!uia) return null;
                try {
                  const front = (await uia.windows()).foreground;
                  const kind = front ? sensitiveWindow(front) : null;
                  return kind ? t(`pc.sensitive.${kind}`) : null;
                } catch {
                  return null;
                }
              },
            }
          : null;

      // ── fare ve klavye sınaması (yalnız kullanıcı başlatır; GERÇEK girdi) ──
      let selftestRunning: Promise<SelftestReport> | null = null;
      const unavailable = (reason: string): SelftestReport => ({ ok: false, stopped: null, unavailable: reason, steps: [], ms: 0 });
      const runSelf = (signal?: AbortSignal): Promise<SelftestReport> => {
        if (ctx.settings.get().pcControlAllowed === false) return Promise.resolve(unavailable(t('pc.selftest.needPermission')));
        if (!control || !uia || !input) return Promise.resolve(unavailable(t('pc.selftest.noDriver')));
        if (selftestRunning) return Promise.resolve(unavailable(t('pc.selftest.running')));
        const abort = new AbortController();
        const offStop = gate.onStop(() => abort.abort());
        signal?.addEventListener('abort', () => abort.abort(), { once: true });
        const folder = path.join(pc.tempDir?.() ?? os.tmpdir(), 'Fuber AI 2 sinama');
        const run = gate
          .busy('selftest', null, () =>
            runSelftest({
              control,
              uia,
              input,
              sleep,
              signal: abort.signal,
              async createFile(name) {
                await fs.promises.mkdir(folder, { recursive: true });
                const file = path.join(folder, name);
                await fs.promises.writeFile(file, '');
                return file;
              },
              removeFile: (file) => fs.promises.rm(file, { force: true }),
              // Sınama sınırı: sınama kipinde Not Defteri AÇILMAZ (kaydedilir); sınama "pencere görünmedi" diye dürüstçe durur.
              launchNotepad: (file) =>
                testing.enabled
                  ? (testing.fakeSpawn('notepad.exe', [file], {}), Promise.resolve({ ok: true, error: null }))
                  : pc.launchExe(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe'), [file]),
              onStep: (step: SelftestStep, index: number) => ctx.bus.emit('pc.selftest.progress', { index, step }),
              ...(testing.enabled ? { openTimeoutMs: 1500 } : {}),
            }),
          )
          .finally(() => {
            offStop();
            selftestRunning = null;
          });
        selftestRunning = run;
        return run;
      };
      selftest = () => runSelf();
      const selftestDef = selftestTool((signal) => runSelf(signal));

      // ── izinlere göre araç kaydı ──
      let offRead: Unsubscribe | null = null;
      let offControl: Unsubscribe | null = null;
      const sync = () => {
        const settings = ctx.settings.get();
        const wantRead = settings.pcReadAllowed !== false;
        const wantControl = settings.pcControlAllowed !== false;
        if (wantRead && !offRead) {
          offRead = ctx.tools.register(ctx, [
            ...readTools({
              captureScreen: (screen) => pc.captureScreen(screen),
              shots,
              sleep,
              ...(uia ? { uia } : {}),
              ...(deepBrain ? { deepBrain } : {}),
              ...(pc.screens ? { screens: () => pc.screens!() } : {}),
            }),
            ...fileReadTools(fileEnv),
            ...systemReadTools(systemEnv),
            ...(deviceEnv ? deviceReadTools(deviceEnv) : []),
          ]);
        } else if (!wantRead && offRead) {
          offRead();
          offRead = null;
        }
        if (wantControl && !offControl) {
          // Fare/klavye araçları sürücü ve okuyucu ister; dosya, komut, pano ve sistem araçları onlarsız da çalışır.
          const inputTools =
            control && uia
              ? [
                  ...controlTools({
                    control,
                    uia,
                    shots,
                    sleep,
                    // Sınama sınırı: sınama kipinde tarayıcıda sekme AÇILMAZ (sahte başlatıcı istenmemiş olsa da), kaydedilir.
                    launchExe: (file, args) =>
                      testing.fakeInput ? (testing.fakeSpawn(file, args ?? [], {}), Promise.resolve({ ok: true, error: null })) : pc.launchExe(file, args),
                    openExternal: (url) => (testing.fakeInput ? testing.fakeShell.openExternal(url) : pc.openExternal(url)),
                    onBrowser: (on) => onActivity({ state: on ? 'start' : 'end', action: 'browser', window: null }),
                    onStep: onBatchStep,
                    ...(pc.screens ? { screens: () => pc.screens!() } : {}),
                    ...(pc.device ? { volume: pc.device } : {}),
                  }),
                  selftestDef,
                ]
              : [];
          offControl = ctx.tools.register(ctx, [...inputTools, ...fileControlTools(fileEnv), ...systemControlTools(systemEnv), ...(deviceEnv ? deviceControlTools(deviceEnv) : [])]);
        } else if (!wantControl && offControl) {
          offControl();
          offControl = null;
          // İzin kapatıldı: sürmekte olan dizi (ve süren komut) de dursun.
          control?.halt('panic');
          gate.stop();
        }
        // Okuyucu yalnız gerektiğinde ayakta: soğuk başlatma ilk sesli isteğe kalmasın diye önceden ısıtılır.
        if (wantRead || wantControl) uia?.warm();
      };
      sync();

      const offSettings = ctx.bus.on('settings.changed', ({ changedKeys }) => {
        if (changedKeys.includes('pcReadAllowed') || changedKeys.includes('pcControlAllowed')) sync();
      });
      // Acil dur: araç servisi çağrıları iptal eder; burada ayrıca yeni eylem bir süre başlamaz ve basılı düğme bırakılır.
      const stopNow = () => {
        control?.halt('panic');
        // Süren komut öldürülür, dosya döngüsü kesilir, bekleyen kapatma iptal edilir; yeni iş bir süre başlamaz.
        gate.stop();
        if (lingering) clearTimeout(lingering);
        lingering = null;
        if (active) emit({ active: false, action: null, app: null, interrupted: 'panic', point: null });
      };
      const offPanic = ctx.bus.on('app.panic', stopNow);
      stopControl = stopNow;

      teardown = [
        offSettings,
        offPanic,
        () => {
          selftest = null;
        },
        // Modül kapanınca arka planda başlattığımız komutlar da kapanır (uygulama çıkışında ayrıca çıkış kancası öldürür).
        () => void stopAllBackground().catch(() => undefined),
        () => offRead?.(),
        () => offControl?.(),
        () => {
          if (lingering) clearTimeout(lingering);
        },
        () => channel.dispose(),
        () => offOverlay?.(),
        () => overlay?.dispose(),
        () => uia?.stop(),
      ];
    },

    teardown() {
      for (const off of teardown.reverse()) {
        try {
          off();
        } catch {
          // kapanışta kalan parça diğerlerini engellemesin
        }
      }
      teardown = [];
      stopControl = null;
      deps = null;
    },
  });
}

/** Eski imza (sınamalar ve dış çağıranlar): ekrana bakma tek başına. */
export { lookAtScreen };

// Uygulamada `screen_look` çekirdeğin derin beynine bağlıdır (Anthropic API ya da bu bilgisayardaki Claude Code).
export default createPcModule(electronDeps, { deepBrain: deepBrainFor });
