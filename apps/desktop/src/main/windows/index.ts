/**
 * Pencere yöneticisi (KURGU §9). Kurallar:
 * - Ana pencere istenince açılır; kapatınca gizlenir, uygulama tepside yaşar.
 * - Ses penceresi hiç gösterilmez; mikrofon izni yalnız ona verilir.
 * - HUD yüzeyleri (ada, toast, sahne) çerçevesiz saydam pencerelerdir; dikdörtgenleri içeriğin bildirdiği
 *   boyuta eşittir, odak almazlar (`focusable: false`, yalnız `showInactive`), içerik yokken gizlidirler ve
 *   tam ekran uygulama algılanınca ada ile toast gizlenir. Büyük saydam pencere + tıklama geçirme YOKTUR.
 * - Ada ile ana pencerenin çentiği aynı anda görünmez: ana pencere görünür, küçültülmemiş ve ODAKTAYKEN yüzen ada
 *   gizlenir ve durumu ana pencerenin kendi çentiği gösterir (`hud.owner`). Odak gidince, pencere küçültülünce ya da
 *   kapanınca ada üst ortaya geri gelir (içeriği gizliyken de canlıdır: geri gelişte boş kare olmaz).
 */

import { app, screen, type BrowserWindow, type BrowserWindowConstructorOptions, type Display, type MessagePortMain, type WebContents } from 'electron';
import path from 'node:path';
import {
  DESKTOP_APP_NAME,
  HUD_SURFACES,
  IPC_EVENT_CHANNEL,
  PORT_CHANNEL,
  type BusEvents,
  type HudSurface,
  type RendererEntry,
  type ServiceDeps,
  type Unsubscribe,
  type WindowKind,
  type WindowsApi,
} from '@fuber/shared';
import { createWindow, reveal } from '../create-window';
import { testing } from '../testing';
import { watchAutostart } from './autostart';
import { ISLAND_POINTER_MS, islandPointer, passthroughGate, placeHud } from './hud';
import { installPermissionPolicy } from './permissions';
import { createTray, type TrayHandle, type TrayStatus } from './tray';

type WindowOptions = Omit<BrowserWindowConstructorOptions, 'webPreferences' | 'show'>;

interface Slot {
  kind: WindowKind;
  win: BrowserWindow;
  loaded: Promise<void>;
  /** Sayfa olay dinlemeye hazır. Hazır olana dek gelen olaylar `queue`'da bekler. */
  ready: boolean;
  queue: Array<{ event: string; payload: unknown }>;
  /** Mantıksal görünürlük; sınama kipinde pencere ekrana çıkmasa da izlenir. */
  shown: boolean;
}

interface HudState {
  /** İçeriğin bildirdiği boyut; `null` = gösterilecek bir şey yok. */
  size: { width: number; height: number } | null;
  /** Yüzeyin göründüğü ekran; görünür kaldıkça değişmez (imleç gezerken ada ekran değiştirmesin). */
  displayId: number | null;
  /** Kullanıcı sahneyi sürükledi: yeniden boyutlanırken yeri korunur. */
  moved: boolean;
}

/** Pencere katmanının `WindowsApi` dışında kalan, Electron'a bağlı yüzü (bootstrap ve IPC işleyicileri kullanır). */
export interface WindowsRuntime {
  /** Tepsiyi kurar, izin politikasını uygular, ada ve toast pencerelerini hazırlar. */
  start(): void;
  /** Tepsiyi ve bütün pencereleri kapatır. */
  stop(): void;
  /** `hud.resize`: yüzey kendi içerik boyutunu bildirir. Yalnız o yüzeyin kendi penceresinden kabul edilir. */
  resizeHud(sender: WebContents, surface: HudSurface, width: number, height: number): void;
  /** `hud.focus`: sahnenin içine tıklandı; pencere odak alabilir hale gelir. */
  focusHud(sender: WebContents, surface: HudSurface): void;
  /** `hud.passthrough`: imleç adanın biçiminin dışında; pencere tıklamayı alttaki uygulamaya geçirir (içindeyken alır). */
  passthroughHud(sender: WebContents, surface: HudSurface, on: boolean): void;
  /** Bir pencerenin türü; bizim pencerelerimizden değilse `null`. */
  kindOf(win: BrowserWindow | null): WindowKind | null;
  trayStatus(): TrayStatus | null;
  /** Tepsi simgesinin o anki ipucu metni; tepsi yoksa `null`. */
  trayTooltip(): string | null;
  /**
   * Kapanış kararını veren işleyici (yaşam döngüsü denetleyicisi): ana pencerenin X'i ve tepsideki "Çık" ona gider.
   * İşleyici yokken eski davranış: X tepsiye indirir, "Çık" doğrudan çıkar.
   */
  setCloseHandler(handler: ((source: 'window' | 'tray') => void) | null): void;
}

const runtimes = new WeakMap<WindowsApi, WindowsRuntime>();

export function windowsRuntime(windows: WindowsApi): WindowsRuntime {
  const found = runtimes.get(windows);
  if (!found) throw new Error('pencere yöneticisi bu süreçte kurulmadı');
  return found;
}

const isHud = (kind: WindowKind): kind is HudSurface => (HUD_SURFACES as readonly string[]).includes(kind);

/** Açılışta hazır tutulan yüzeyler: olay geldiği an gösterebilsinler diye sayfaları önceden yüklenir (gizli). */
const PREPARED: WindowKind[] = ['island', 'toasts'];
/** HUD sayfası boyut bildirmezse (hata) olay kuyruğu bu süre sonunda yine de boşaltılır. */
const READY_FALLBACK_MS = 3000;
const MAX_QUEUE = 200;

export function createWindows(deps: ServiceDeps['windows']): WindowsApi {
  const { bus, settings, presence } = deps;
  const log = deps.log.child('windows');
  const slots = new Map<WindowKind, Slot>();
  const huds: Record<HudSurface, HudState> = {
    island: { size: null, displayId: null, moved: false },
    toasts: { size: null, displayId: null, moved: false },
    stage: { size: null, displayId: null, moved: false },
  };
  let quitting = false;
  let permissionsInstalled = false;
  let tray: TrayHandle | null = null;
  let closeHandler: ((source: 'window' | 'tray') => void) | null = null;
  const subscriptions: Unsubscribe[] = [];

  const hudOptions = (title: string, extra: WindowOptions = {}): WindowOptions => ({
    title,
    width: 320,
    height: 64,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    ...extra,
  });

  const spec = (kind: WindowKind): { entry: RendererEntry; query?: Record<string, string>; window: WindowOptions } => {
    const icon = path.join(deps.paths.resources, 'icons', 'icon.ico');
    switch (kind) {
      case 'main':
        // Çerçevesiz: başlık şeridini sayfa çizer (çentik orada durur); küçült/büyüt/kapat işletim sisteminin katmanında.
        return {
          entry: 'main',
          window: {
            width: 1240,
            height: 800,
            minWidth: 960,
            minHeight: 600,
            title: DESKTOP_APP_NAME,
            icon,
            titleBarStyle: 'hidden',
            titleBarOverlay: { color: '#000000', symbolColor: '#b4b4bc', height: 40 },
            // Windows 11 gizli başlıklı pencereye kendiliğinden Mica verir; sahne simsiyah kalmalı.
            backgroundMaterial: 'none',
          },
        };
      case 'setup':
        // Kurulum: solda soru, sağda canlı önizleme. Ana pencere gibi çerçevesiz; üst şeridi (FUBER, ilerleme) sayfa
        // çizer, küçült/büyüt/kapat işletim sisteminin katmanında. Yeniden boyutlanır; düzen 1100×720'den 4K'ya akar.
        return {
          entry: 'setup',
          window: {
            width: 1240,
            height: 800,
            minWidth: 1100,
            minHeight: 720,
            title: DESKTOP_APP_NAME,
            icon,
            titleBarStyle: 'hidden',
            titleBarOverlay: { color: '#000000', symbolColor: '#b4b4bc', height: 48 },
            backgroundMaterial: 'none',
          },
        };
      case 'audio':
        return { entry: 'audio', window: { width: 320, height: 200, skipTaskbar: true, focusable: false, title: `${DESKTOP_APP_NAME} · ses` } };
      case 'island':
        return { entry: 'hud', query: { surface: kind }, window: hudOptions(`${DESKTOP_APP_NAME} · ada`) };
      case 'toasts':
        return { entry: 'hud', query: { surface: kind }, window: hudOptions(`${DESKTOP_APP_NAME} · bildirimler`) };
      case 'stage':
        return { entry: 'hud', query: { surface: kind }, window: hudOptions(`${DESKTOP_APP_NAME} · sahne`, { movable: true }) };
    }
  };

  const live = (kind: WindowKind): Slot | null => {
    const slot = slots.get(kind);
    return slot && !slot.win.isDestroyed() ? slot : null;
  };

  // ── ada: imleç ──
  // Ada yalnız olay varken görünür; imleç de yalnız o sürede yoklanır (boşta zamanlayıcı yok). Konum değişmedikçe
  // ileti gitmez. Sınamada gerçek imlece bakılmaz (bilgisayarın başındaki kişinin faresi sınamayı etkilemesin);
  // sınama konumu `sendTo('island', 'hud.pointer', …)` ile kendisi verir.
  let pointerTimer: ReturnType<typeof setInterval> | null = null;
  let lastPointer = '';
  // Sınamada gösterilen yüzey zaten gerçek fareye kapalıdır (`reveal`); o ayar bozulmaz.
  const islandPassthrough = passthroughGate<BrowserWindow>((win, on) => {
    if (testing.enabled) return;
    if (on) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  });
  const stopPointer = () => {
    if (pointerTimer) clearInterval(pointerTimer);
    pointerTimer = null;
    lastPointer = '';
  };
  const pollPointer = () => {
    const slot = live('island');
    if (!slot || !slot.shown) {
      stopPointer();
      return;
    }
    const { x, y } = islandPointer(screen.getCursorScreenPoint(), slot.win.getBounds());
    const key = `${x},${y}`;
    if (key === lastPointer) return;
    lastPointer = key;
    deliver(slot, 'hud.pointer', { surface: 'island', x, y });
  };
  const setIslandPassthrough = (slot: Slot, on: boolean) => {
    if (slot.win.isDestroyed()) return;
    islandPassthrough.set(slot.win, on);
  };

  // ── ada ↔ ana pencere: durumu kim gösterir ──
  // Sınamada pencereler ekrana çıkmadığı için gerçek odak yoktur; betik `__fuber2Test.setMainFocus(true|false)` ile verir.
  let mainOwns = false;
  let testMainFocus = false;
  const computeMainOwns = (): boolean => {
    const slot = live('main');
    if (!slot || !slot.shown) return false;
    if (testing.enabled) return testMainFocus;
    return slot.win.isVisible() && !slot.win.isMinimized() && slot.win.isFocused();
  };
  const refreshOwner = () => {
    const next = computeMainOwns();
    if (next === mainOwns) return;
    mainOwns = next;
    bus.emit('hud.owner', { owner: next ? 'main' : 'island' });
    applyHud('island');
  };
  testing.expose({
    setMainFocus: (on: boolean) => {
      testMainFocus = on;
      refreshOwner();
      return mainOwns;
    },
    hudOwner: () => (mainOwns ? 'main' : 'island'),
  });

  const setShown = (slot: Slot, shown: boolean) => {
    if (slot.shown === shown) return;
    slot.shown = shown;
    if (!slot.win.isDestroyed()) {
      if (shown) reveal(slot.win, isHud(slot.kind) ? 'inactive' : 'focus');
      else slot.win.hide();
    }
    if (slot.kind === 'island') {
      if (shown && !testing.enabled && !pointerTimer) pointerTimer = setInterval(pollPointer, ISLAND_POINTER_MS);
      if (shown) {
        // Ada penceresi (sahne) gövdeden büyük ve saydamdır: görünür görünmez tıklamayı GEÇİRİR; sayfa, imleç gövdenin
        // üstüne gelince (`hud.passthrough` on:false) tıklamayı alır.
        setIslandPassthrough(slot, true);
      } else {
        stopPointer();
        // Gizlenen ada varsayılana döner; bir sonraki görünüşünde yeniden "geçir" ile başlar.
        setIslandPassthrough(slot, false);
      }
    }
    bus.emit('window.changed', { kind: slot.kind, open: shown });
    if (slot.kind === 'main') refreshOwner();
  };

  const markReady = (slot: Slot) => {
    if (slot.ready) return;
    slot.ready = true;
    for (const { event, payload } of slot.queue.splice(0)) {
      if (!slot.win.isDestroyed()) slot.win.webContents.send(IPC_EVENT_CHANNEL, event, payload);
    }
  };

  const deliver = (slot: Slot, event: string, payload: unknown) => {
    if (slot.win.isDestroyed()) return;
    if (slot.ready) {
      slot.win.webContents.send(IPC_EVENT_CHANNEL, event, payload);
    } else if (event !== 'voice.level' && slot.queue.length < MAX_QUEUE) {
      slot.queue.push({ event, payload });
    }
  };

  const create = (kind: WindowKind): Slot => {
    if (!permissionsInstalled) {
      // İlk pencereden önce: hiçbir sayfa varsayılan (her şeye izin veren) politikayla açılmasın.
      permissionsInstalled = true;
      installPermissionPolicy(() => live('audio')?.win.webContents ?? null);
    }
    const { win, loaded } = createWindow(spec(kind));
    const slot: Slot = { kind, win, loaded, ready: false, queue: [], shown: false };
    slots.set(kind, slot);
    // Gizlenen ana pencere boşuna kare üretmesin (tepside yaşarken animasyonlar dursun). Sınamada pencereler
    // hiç gösterilmediği için kısıtlama açılmaz; yoksa gizli pencere çizmez ve görüntüsü alınamaz.
    if ((kind === 'main' || kind === 'setup') && !testing.enabled) win.webContents.setBackgroundThrottling(true);
    if (isHud(kind)) {
      // `floating`: sıradan pencerelerin üstünde, ama ekran koruyucu ve sistem katmanlarının altında.
      win.setAlwaysOnTop(true, 'floating');
      // `will-move` yalnız kullanıcı sürüklediğinde gelir (programlı `setBounds` tetiklemez).
      win.on('will-move', () => {
        huds[kind].moved = true;
      });
    }

    if (kind === 'main') {
      // Odak, küçültme ve görünürlük değişince adanın sahibi yeniden hesaplanır (olaylar aynı turda bir kez yayınlanır).
      for (const event of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide'] as const) win.on(event as 'focus', refreshOwner);
      win.on('close', (event) => {
        if (quitting) return;
        // Ana pencere kapanmaz: karar yaşam döngüsü denetleyicisinindir (sor / tepsiye in / çık); yoksa gizlenir.
        event.preventDefault();
        if (closeHandler) closeHandler('window');
        else setShown(slot, false);
      });
    }
    win.on('closed', () => {
      if (slots.get(kind) === slot) slots.delete(kind);
      if (isHud(kind)) huds[kind] = { size: null, displayId: null, moved: false };
      // Ses penceresi hiç gösterilmez ama var olduğu sürece "açık" sayılır (`isOpen`): kapanması (çökme) da duyurulur
      // ki ses servisi pencereyi yeniden açıp işçiye yeni port versin.
      if (slot.shown || kind === 'audio') {
        slot.shown = false;
        bus.emit('window.changed', { kind, open: false });
      }
      if (kind === 'main') refreshOwner();
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`${kind} penceresinin süreci sonlandı (${details.reason})`);
      if (!win.isDestroyed()) win.destroy();
      if (!quitting && PREPARED.includes(kind)) setTimeout(() => void ensure(kind).catch(() => {}), 1000).unref();
    });

    loaded.then(
      () => {
        // HUD sayfası ilk boyut bildirimini yapınca hazırdır; diğerleri yüklenince.
        if (!isHud(kind)) markReady(slot);
        else setTimeout(() => markReady(slot), READY_FALLBACK_MS).unref();
      },
      (error: unknown) => log.error(`${kind} penceresi yüklenemedi`, error),
    );
    return slot;
  };

  const ensure = async (kind: WindowKind): Promise<Slot> => {
    const slot = live(kind) ?? create(kind);
    await slot.loaded;
    return slot;
  };

  // ── HUD: boyut, konum, görünürlük ──

  const pickDisplay = (): Display =>
    settings.get().islandDisplay === 'primary'
      ? screen.getPrimaryDisplay()
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const applyHud = (surface: HudSurface) => {
    const slot = live(surface);
    if (!slot) return;
    const hud = huds[surface];
    // Tam ekran oyun/videonun üstüne çıkılmaz; sahne yalnız kullanıcı istediğinde açıldığı için kapsam dışıdır.
    // Ana pencere odaktayken ada gizlidir: durumu pencerenin kendi çentiği gösterir (`hud.owner`).
    const suppressed = (surface !== 'stage' && presence.get().fullscreen) || (surface === 'island' && mainOwns);
    if (!hud.size || suppressed) {
      hud.displayId = null;
      hud.moved = false;
      setShown(slot, false);
      return;
    }
    const display = screen.getAllDisplays().find((candidate) => candidate.id === hud.displayId) ?? pickDisplay();
    hud.displayId = display.id;
    const bounds = placeHud(surface, hud.size, display.workArea);
    if (hud.moved && slot.shown) {
      const current = slot.win.getBounds();
      bounds.x = current.x;
      bounds.y = current.y;
    }
    slot.win.setBounds(bounds);
    // Farklı ölçekli ekrana geçişte ilk çağrı eski ölçekle uygulanabilir; ikinci çağrı düzeltir. Kesirli ölçekte
    // 1 DIP'lik yuvarlama farkı olağandır ve yeniden denenmez (her deneme kenarı bir piksel oynatır).
    const actual = slot.win.getBounds();
    const off = (key: 'x' | 'y' | 'width' | 'height') => Math.abs(actual[key] - bounds[key]) > 1;
    if (off('x') || off('y') || off('width') || off('height')) slot.win.setBounds(bounds);
    setShown(slot, true);
  };

  const applyAllHuds = () => {
    for (const surface of HUD_SURFACES) applyHud(surface);
  };

  /**
   * Gezinme isteği (`app.navigate`: bildirimdeki "Oturumu aç", onaylanan sorunun oturumu) ana pencere kapalıyken ya da
   * tepsiye gizliyken de karşılık bulur: pencere açılır/öne gelir ve istek sayfaya ulaşır. Olay yayınlandığı an pencere
   * yoksa olağan yayın (`broadcast`) ona ulaşamaz; o durumda istek pencere yüklenince buradan teslim edilir.
   * Yalnız `showMain`'in açabildiği pencereyi açar: kurulum bitmeden (ana pencere yokken) kurulumun önüne geçmez.
   */
  const openForNavigation = async (target: BusEvents['app.navigate']) => {
    if (live('setup')) return;
    const missed = live('main') === null;
    const slot = await ensure('main');
    if (slot.shown) reveal(slot.win, 'focus');
    else setShown(slot, true);
    if (missed) deliver(slot, 'app.navigate', target);
  };

  const api: WindowsApi = {
    ensure: async (kind) => void (await ensure(kind)),

    async showMain(page) {
      const slot = await ensure('main');
      if (slot.shown) reveal(slot.win, 'focus');
      else setShown(slot, true);
      if (page) deliver(slot, 'app.navigate', { page });
    },

    async show(kind) {
      if (kind === 'main') return api.showMain();
      const slot = await ensure(kind);
      if (isHud(kind)) applyHud(kind);
      else if (kind === 'setup') setShown(slot, true);
      // Ses penceresi hiç gösterilmez.
    },

    hide(kind) {
      const slot = live(kind);
      if (!slot) return;
      // Kurulum tek seferliktir: gizlenmez, kapanır.
      if (kind === 'setup') slot.win.destroy();
      else if (kind !== 'audio') setShown(slot, false);
    },

    isOpen: (kind) => {
      const slot = live(kind);
      return slot !== null && (kind === 'audio' || slot.shown);
    },

    broadcast(event, payload) {
      for (const slot of slots.values()) {
        // Genlik saniyede ~30 kez gelir; yalnız onu çizen yüzeylere gider (kurulumda mikrofon çubuğu ve Öz).
        if (event === 'voice.level' && slot.kind !== 'main' && slot.kind !== 'island' && slot.kind !== 'setup') continue;
        if (event === 'audio.command' && slot.kind !== 'audio') continue;
        deliver(slot, event, payload);
      }
    },

    sendTo(kind, event, payload) {
      const slot = live(kind);
      if (slot) deliver(slot, event, payload);
    },

    postPort(kind, name, port) {
      const slot = live(kind);
      if (!slot) throw new Error(`pencere açık değil: ${kind}`);
      slot.win.webContents.postMessage(PORT_CHANNEL, name, [port as MessagePortMain]);
    },
  };

  runtimes.set(api, {
    start() {
      subscriptions.push(
        bus.on('presence.changed', applyAllHuds),
        // Sahne ilk kart gelince açılır; olay, sayfa yüklenene kadar kuyrukta bekler.
        bus.on('stage.show', () => void ensure('stage').catch((error: unknown) => log.error('sahne açılamadı', error))),
        bus.on('app.navigate', (target) => void openForNavigation(target).catch((error: unknown) => log.error('ana pencere açılamadı', error))),
        watchAutostart({ settings, bus, log }),
      );
      const onDisplays = () => applyAllHuds();
      screen.on('display-metrics-changed', onDisplays);
      screen.on('display-added', onDisplays);
      screen.on('display-removed', onDisplays);
      const onQuit = () => {
        quitting = true;
      };
      app.on('before-quit', onQuit);
      subscriptions.push(() => {
        screen.off('display-metrics-changed', onDisplays);
        screen.off('display-added', onDisplays);
        screen.off('display-removed', onDisplays);
        app.off('before-quit', onQuit);
      });
      if (testing.tray) {
        tray = createTray({
          paths: deps.paths,
          settings,
          bus,
          log,
          openMain: () => void api.showMain().catch((error: unknown) => log.error('ana pencere açılamadı', error)),
          quit: () => (closeHandler ? closeHandler('tray') : app.quit()),
        });
      }
      for (const kind of PREPARED) void ensure(kind).catch(() => {});
    },

    stop() {
      quitting = true;
      stopPointer();
      for (const off of subscriptions.splice(0)) off();
      tray?.destroy();
      tray = null;
      for (const slot of [...slots.values()]) {
        if (!slot.win.isDestroyed()) slot.win.destroy();
      }
    },

    resizeHud(sender, surface, width, height) {
      const slot = live(surface);
      if (!slot || slot.win.webContents !== sender) throw new Error(`hud.resize: ${surface} yüzeyinin kendi penceresinden gelmedi`);
      markReady(slot);
      const size = { width: Math.ceil(width), height: Math.ceil(height) };
      huds[surface].size = Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0 ? size : null;
      applyHud(surface);
    },

    focusHud(sender, surface) {
      const slot = live(surface);
      // Odak alabilen tek yüzey sahnedir (içine tıklanınca); ada ve toast hiçbir koşulda odak almaz.
      if (surface !== 'stage' || !slot || slot.win.webContents !== sender) return;
      slot.win.setFocusable(true);
      reveal(slot.win, 'focus');
      slot.win.once('blur', () => {
        if (!slot.win.isDestroyed()) slot.win.setFocusable(false);
      });
    },

    passthroughHud(sender, surface, on) {
      const slot = live(surface);
      // Tıklamayı geçiren tek yüzey adadır ve yalnız kendi isteğiyle.
      if (surface !== 'island' || !slot || slot.win.webContents !== sender) return;
      setIslandPassthrough(slot, on);
    },

    kindOf(win) {
      if (!win) return null;
      for (const slot of slots.values()) {
        if (slot.win === win) return slot.kind;
      }
      return null;
    },

    trayStatus: () => tray?.status() ?? null,
    trayTooltip: () => tray?.tooltip() ?? null,
    setCloseHandler(handler) {
      closeHandler = handler;
    },
  });

  return api;
}
