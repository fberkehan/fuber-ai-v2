// Jarvis'in kendi tarayıcısı (Electron'a bağlı parça). Pencere, araç çubuğu, sekmeler, oturum sertleştirmesi ve ağ kalkanının
// bağlantısı burada; karar kuralları saf dosyalardadır (`classify.ts`, `shield.ts`, `urls.ts`, `page.ts`).
//
// Yalıtım:
//   - Sayfalar uygulamanın oturumundan AYRI, kalıcı bir oturum bölümündedir (`persist:fuber-jarvis-browser`): kullanıcı bir kez
//     giriş yapar, oturum kalır; uygulamanın kendi çerezleri, depolaması ve izinleri sayfalara açık değildir.
//   - Sayfa görünümlerinde preload YOK; `nodeIntegration` kapalı, `contextIsolation` ve `sandbox` açık; `webviewTag` kapalı.
//     Uygulamanın `window.fuber` köprüsü bu sayfalarda hiç yoktur (uçtan uca sınama kanıtlar).
//   - Bütün izin istekleri (kamera, mikrofon, konum, bildirim, pano, USB, dış uygulama açma …) reddedilir.
//   - İndirme: yalnız Jarvis'in onaylı indirme aracı; çalıştırılabilir dosya HİÇBİR koşulda inmez. Sayfanın başlattığı indirme
//     reddedilir.
//   - Adres: yalnız http(s), iç ağ ve bu bilgisayar kapalı (`urls.ts`), ad çözümlemesi de denetlenir.
//   - Açılır pencere (`window.open`) pencere olarak açılmaz; yakın zamanda tıklama varsa yeni SEKMEDE açılır.
//
// Sınama kipinde sayfa görünümleri ekran dışı çizilir (`offscreen`): pencere ekrana HİÇ çıkmaz ama girdi olayları
// (`sendInputEvent`) gerçek tarayıcıdaki gibi işler. Gizli (çizilmeyen) pencerede girdi olayları sayfaya ulaşmıyor
// (ölçüldü, Electron 45); bu yüzden üretimde Jarvis kullanırken pencere görünür olur (odak çalmadan).
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { t, type Logger } from '@fuber/shared';
import type { BrowserWindow, Session, WebContents, WebContentsView } from 'electron';
import { type KeyStep } from './classify';
import { focusFieldScript, focusScript, hasTextScript, ISOLATED_WORLD, markScript, probeScript, scrollScript, selectScript, valueScript, type PageSnapshot, type Probe } from './page';
import { TabShield, type Decision, type NetworkCard } from './shield';
import { CONTROL_SCHEME, parseToolbarUrl, TOOLBAR_HEIGHT, toolbarHtml, type ToolbarAction, type ToolbarState } from './toolbar';
import { addressBlock, cleanUserAgent, dangerousDownload, downloadFileName, MAX_TABS, resolveAddress, resolvedAllowed, shortAddress, type BlockReason } from './urls';

export const PARTITION = 'persist:fuber-jarvis-browser';
const UI_PARTITION = 'fuber-jarvis-browser-ui';
const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 350;
const POPUP_AFTER_INPUT_MS = 3000;
const DOWNLOAD_APPROVAL_MS = 15_000;
const MAX_BODY = 64_000;
const DNS_CACHE_MS = 60_000;

type ElectronModule = typeof import('electron');

export interface TabInfo {
  no: number;
  title: string;
  url: string;
  active: boolean;
  loading: boolean;
}

export interface NavOutcome {
  ok: boolean;
  url: string;
  title: string;
  /** Adres kurala takıldı. */
  blocked?: BlockReason;
  /** Sayfa açılamadı (ağ hatası kodu ve açıklaması). */
  error?: string;
}

interface Tab {
  no: number;
  view: WebContentsView;
  wc: WebContents;
  shield: TabShield;
  /** Bir sonraki ana çerçeve belgesi tarayıcının (Jarvis'in aracı ya da kullanıcının araç çubuğu) isteğiyle açılıyor. */
  expectNav: boolean;
  lastInputAt: number;
  lastAgentClickAt: number;
  lastBlocked: BlockReason | null;
  lastError: string | null;
  /** Bekletilen istek sayısı (araç dönmeden önce boşalması beklenir). */
  holding: number;
  /** Kalkanın ya da adres kuralının durdurduğu son ana çerçeve gezinimi: an ve o sırada açık olan sayfa. */
  cancelledNav: { at: number; from: string } | null;
}

export interface BrowserOptions {
  log: Logger;
  /** Sınama kipi: pencere ekrana çıkmaz, görünümler ekran dışı çizilir. */
  test: boolean;
  /** Sınamada açılabilen geri döngü adresleri (`host:port`). */
  allow: readonly string[];
  /** Onaylı indirmelerin klasörü. */
  downloadsDir: string;
  /** Jarvis'in eylemi başladı/bitti (ada: "Bilgisayarı kullanıyor · Jarvis'in tarayıcısı"). */
  onBusy(busy: boolean, step: string): void;
  /** Kullanıcı araç çubuğunda "Durdur"a bastı. */
  onStop(): void;
  now?(): number;
}

/** Bir Jarvis eyleminin sonucu (ağ kalkanının bu eylemdeki işi). */
export interface ActionReport {
  /** Bu eylem sırasında ya da önceki eylemden beri durdurulan istek sayısı. */
  blocked: number;
  /** Eylem sırasında açılan ağ kartının sonucu (`null`: kart açılmadı). */
  card: boolean | null;
}

export class JarvisBrowser {
  private electron: ElectronModule | null = null;
  private win: BrowserWindow | null = null;
  private toolbar: WebContentsView | null = null;
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private nextNo = 1;
  private session: Session | null = null;
  private busy = false;
  private step = '';
  private disposed = false;
  private dnsCache = new Map<string, { ok: boolean; at: number }>();
  private pendingDownload: { url: string; until: number; resolve: (result: { ok: boolean; file?: string; error?: string }) => void } | null = null;
  private stopEpoch = 0;
  /** Kalkanın son kararları (tanı ve sınama için; adresin yalnız ana makine + yolu, gövde yok). */
  readonly decisions: Array<{ at: number; method: string; type: string; target: string; verdict: string; busy: boolean }> = [];
  private stopWaiters = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly options: BrowserOptions) {
    this.now = options.now ?? Date.now;
  }

  // ───────────── yaşam döngüsü ─────────────

  private async electronApi(): Promise<ElectronModule> {
    this.electron ??= await import('electron');
    return this.electron;
  }

  /** Pencere ve oturum hazır (ilk çağrıda kurulur). Pencere gösterilmez. */
  async ensure(): Promise<void> {
    if (this.disposed) throw new Error('kapatıldı');
    if (this.win && !this.win.isDestroyed()) return;
    const electron = await this.electronApi();
    const { BrowserWindow: Window, WebContentsView: View, session } = electron;
    if (!this.session) {
      this.session = session.fromPartition(PARTITION);
      this.hardenSession(this.session);
    }
    const ui = session.fromPartition(UI_PARTITION);
    ui.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ui.setPermissionCheckHandler(() => false);
    // Araç çubuğunun ağı yok: yalnız kendi `data:` sayfası.
    ui.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));

    const win = new Window({
      show: false,
      width: 1280,
      height: 860,
      minWidth: 640,
      minHeight: 420,
      title: t('jbrowser.window.title'),
      backgroundColor: '#0A0A0B',
      autoHideMenuBar: true,
      webPreferences: { partition: UI_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, ...(this.options.test ? { offscreen: true } : {}) },
    });
    win.removeMenu();
    // Kullanıcı kapatınca pencere gizlenir: sekmeler ve oturum kalır. Uygulama kapanırken `dispose` gerçekten kapatır.
    win.on('close', (event) => {
      if (this.disposed) return;
      event.preventDefault();
      win.hide();
    });
    win.on('resize', () => this.layout());
    const toolbar = new View({
      webPreferences: { partition: UI_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, ...(this.options.test ? { offscreen: true } : {}) },
    });
    toolbar.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      const action = parseToolbarUrl(url);
      if (action) void this.onToolbar(action);
    });
    toolbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.contentView.addChildView(toolbar);
    this.win = win;
    this.toolbar = toolbar;
    await toolbar.webContents.loadURL(toolbarHtml());
    this.layout();
    this.renderToolbar();
  }

  dispose(): void {
    this.disposed = true;
    this.wakeStopWaiters();
    for (const tab of this.tabs) {
      tab.shield.close();
      try {
        tab.wc.close();
      } catch {
        // zaten kapalı
      }
    }
    this.tabs = [];
    this.active = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.toolbar = null;
  }

  /** Pencereyi gösterir. `focus`: öne getirir (kullanıcının bir şey girmesi gerekiyor); değilse odak çalınmaz. */
  async show(focus = false): Promise<void> {
    await this.ensure();
    if (this.options.test || !this.win) return;
    if (this.win.isMinimized()) this.win.restore();
    if (focus) {
      this.win.show();
      this.win.focus();
    } else if (!this.win.isVisible()) {
      this.win.showInactive();
    }
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }

  // ───────────── oturum sertleştirmesi ve ağ kalkanı ─────────────

  private hardenSession(ses: Session): void {
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    ses.setSpellCheckerEnabled(false);
    ses.on('will-download', (event, item) => {
      const pending = this.pendingDownload;
      const url = item.getURL();
      const name = item.getFilename();
      if (!pending || this.now() > pending.until || pending.url !== url) {
        event.preventDefault();
        this.options.log.info('sayfanın başlattığı indirme reddedildi');
        return;
      }
      this.pendingDownload = null;
      if (dangerousDownload(name)) {
        event.preventDefault();
        pending.resolve({ ok: false, error: 'dangerous' });
        return;
      }
      fs.mkdirSync(this.options.downloadsDir, { recursive: true });
      const file = path.join(this.options.downloadsDir, downloadFileName(name, url, (candidate) => fs.existsSync(path.join(this.options.downloadsDir, candidate))));
      item.setSavePath(file);
      item.once('done', (_e, state) => pending.resolve(state === 'completed' ? { ok: true, file } : { ok: false, error: state }));
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
      void this.onRequest(details).then(
        (cancel) => callback({ cancel }),
        () => callback({ cancel: true }),
      );
    });
  }

  private tabOf(webContentsId: number | undefined): Tab | null {
    if (webContentsId === undefined) return null;
    return this.tabs.find((tab) => !tab.wc.isDestroyed() && tab.wc.id === webContentsId) ?? null;
  }

  /** Bir isteğin kararı: `true` = iptal. */
  private async onRequest(details: Electron.OnBeforeRequestListenerDetails): Promise<boolean> {
    const mainFrame = details.resourceType === 'mainFrame';
    const tab = this.tabOf(details.webContentsId);
    const block = addressBlock(details.url, { mainFrame, rules: { allow: this.options.allow } });
    if (block) {
      if (tab && mainFrame) {
        tab.lastBlocked = block;
        tab.cancelledNav = { at: this.now(), from: tab.wc.getURL() };
      }
      return true;
    }
    if (!(await this.hostAllowed(details.url))) {
      if (tab && mainFrame) tab.lastBlocked = 'private';
      return true;
    }
    const body = bodyText(details.uploadData);
    let decision: Decision;
    if (tab) {
      decision = tab.shield.decide({ method: details.method, resourceType: details.resourceType, url: details.url, body, pageUrl: tab.wc.getURL() });
    } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(details.method.toUpperCase()) && details.resourceType !== 'cspReport') {
      // Sekmesi bilinmeyen değiştirici istek (service worker): bir sekme bile korumadaysa geçmez.
      decision = this.tabs.some((other) => other.shield.guarded()) ? { verdict: 'cancel', reason: 'unknown_tab' } : { verdict: 'pass' };
    } else {
      decision = { verdict: 'pass' };
    }
    if (decision.verdict !== 'pass' || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(details.method.toUpperCase())) {
      this.decisions.push({ at: this.now(), method: details.method, type: details.resourceType, target: shortAddress(details.url), verdict: decision.verdict === 'cancel' ? `cancel:${decision.reason}` : decision.verdict, busy: this.busy });
      if (this.decisions.length > 50) this.decisions.shift();
    }
    if (decision.verdict === 'pass') return false;
    if (decision.verdict === 'cancel') {
      if (tab && mainFrame) tab.cancelledNav = { at: this.now(), from: tab.wc.getURL() };
      this.options.log.info(`gönderim kalkanı: ${details.method} isteği durduruldu (${decision.reason}, ${details.resourceType})`);
      return true;
    }
    if (tab) tab.holding += 1;
    try {
      const approved = await decision.answer;
      this.options.log.info(`gönderim kalkanı: bekletilen ${details.method} isteği ${approved ? 'onaylandı' : 'reddedildi'}`);
      if (!approved && tab && mainFrame) tab.cancelledNav = { at: this.now(), from: tab.wc.getURL() };
      return !approved;
    } finally {
      if (tab) tab.holding -= 1;
    }
  }

  /** Ad çözümlemesi: çözülen adreslerden biri bile iç ağdaysa `false`. Önbellekli. */
  private async hostAllowed(raw: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return true; // about:, blob:, data: (addressBlock karar verdi)
    }
    if (!/^(https?|wss?):$/.test(url.protocol)) return true;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) return true; // IP adresi addressBlock'ta denetlendi
    const port = url.port || (/^(https|wss):$/.test(url.protocol) ? '443' : '80');
    if (this.options.allow.includes(`${host}:${port}`)) return true;
    const cached = this.dnsCache.get(host);
    if (cached && this.now() - cached.at < DNS_CACHE_MS) return cached.ok;
    let ok = true;
    try {
      const addresses = await dns.lookup(host, { all: true });
      ok = resolvedAllowed(addresses.map((entry) => entry.address));
    } catch {
      ok = true; // çözülemeyen ad: Chromium zaten bağlanamaz
    }
    this.dnsCache.set(host, { ok, at: this.now() });
    return ok;
  }

  // ───────────── sekmeler ─────────────

  private async createTab(): Promise<Tab> {
    await this.ensure();
    const { WebContentsView: View } = await this.electronApi();
    const view = new View({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        safeDialogs: true,
        spellcheck: false,
        navigateOnDragDrop: false,
        autoplayPolicy: 'user-gesture-required',
        ...(this.options.test ? { offscreen: true } : {}),
      },
    });
    const wc = view.webContents;
    const no = this.nextNo++;
    const tab: Tab = {
      no,
      view,
      wc,
      shield: null as unknown as TabShield,
      expectNav: false,
      lastInputAt: 0,
      lastAgentClickAt: 0,
      lastBlocked: null,
      lastError: null,
      holding: 0,
      cancelledNav: null,
    };
    tab.shield = new TabShield({ now: this.now }, () => ({ url: wc.isDestroyed() ? '' : wc.getURL(), title: wc.isDestroyed() ? '' : wc.getTitle() }));
    wc.setAudioMuted(this.options.test);
    // Açılır pencere: pencere olarak açılmaz. Yakın zamanda tıklama (kullanıcının ya da Jarvis'in) varsa yeni sekmede açılır.
    wc.setWindowOpenHandler(({ url }) => {
      const recent = Math.max(tab.lastInputAt, tab.lastAgentClickAt);
      if (this.now() - recent <= POPUP_AFTER_INPUT_MS && this.tabs.length < MAX_TABS && !addressBlock(url, { mainFrame: true, rules: { allow: this.options.allow } })) {
        tab.lastAgentClickAt = 0;
        tab.lastInputAt = 0;
        void this.openInNewTab(url);
      }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (addressBlock(url, { mainFrame: true, rules: { allow: this.options.allow } })) event.preventDefault();
    });
    wc.on('will-attach-webview', (event) => event.preventDefault());
    const userInput = () => {
      tab.lastInputAt = this.now();
      tab.shield.userInput();
    };
    wc.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' || input.type === 'rawKeyDown') userInput();
    });
    wc.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type === 'mouseDown') userInput();
    });
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        tab.lastError = null;
      }
    });
    wc.on('did-navigate', () => {
      // Yeni belge Jarvis'in aracıyla ya da kullanıcının araç çubuğuyla açıldıysa Jarvis'in yazdığı veri sayfada değildir.
      // Sayfanın KENDİ gezinimi kiri silmez (veriyi saklayıp yeni belgede gönderebilirdi).
      if (tab.expectNav) tab.shield.documentChanged();
      tab.expectNav = false;
      this.renderToolbar();
    });
    wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) tab.lastError = `${description || 'hata'} (${code})`;
      // Durdurulan gönderim Chromium'da hata sayfası olarak açılır: kullanıcının (ve Jarvis'in) formu kaybolmasın diye
      // önceki sayfaya dönülür (geri-ileri önbelleği formu yazılanla birlikte geri getirebilir). Bu dönüş kiri silmez.
      const cancelled = tab.cancelledNav;
      if (isMainFrame && code === -20 && cancelled && this.now() - cancelled.at < 5000) {
        tab.cancelledNav = null;
        setTimeout(() => this.restoreAfterCancel(tab, cancelled.from), 50);
      }
    });
    wc.on('page-title-updated', () => {
      this.renderToolbar();
      this.updateTitle();
    });
    wc.on('did-start-loading', () => this.renderToolbar());
    wc.on('did-stop-loading', () => this.renderToolbar());
    wc.on('render-process-gone', () => {
      tab.lastError = t('jbrowser.error.crashed');
    });
    this.tabs.push(tab);
    this.activate(tab);
    return tab;
  }

  private restoreAfterCancel(tab: Tab, from: string): void {
    if (tab.wc.isDestroyed() || !from || from === 'about:blank' || tab.wc.getURL() === from) return;
    const history = tab.wc.navigationHistory;
    const index = history.getActiveIndex();
    const previous = index > 0 ? history.getEntryAtIndex(index - 1) : null;
    tab.expectNav = false;
    if (previous?.url === from) history.goBack();
    else void tab.wc.loadURL(from).catch(() => {});
  }

  private activate(tab: Tab): void {
    if (!this.win || this.win.isDestroyed()) return;
    for (const other of this.tabs) {
      if (other !== tab) {
        try {
          this.win.contentView.removeChildView(other.view);
        } catch {
          // takılı değildi
        }
      }
    }
    this.win.contentView.addChildView(tab.view);
    this.active = tab;
    this.layout();
    this.renderToolbar();
    this.updateTitle();
  }

  private layout(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize() as [number, number];
    this.toolbar?.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
    this.active?.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  }

  private updateTitle(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const title = this.active && !this.active.wc.isDestroyed() ? this.active.wc.getTitle() : '';
    this.win.setTitle(title ? `${t('jbrowser.window.title')} · ${title.slice(0, 80)}` : t('jbrowser.window.title'));
  }

  private renderToolbar(): void {
    const toolbar = this.toolbar;
    if (!toolbar || toolbar.webContents.isDestroyed() || toolbar.webContents.isLoading()) return;
    const tab = this.active && !this.active.wc.isDestroyed() ? this.active : null;
    const state: ToolbarState = {
      url: tab ? tab.wc.getURL().replace(/^about:blank$/, '') : '',
      canBack: Boolean(tab?.wc.navigationHistory.canGoBack()),
      canForward: Boolean(tab?.wc.navigationHistory.canGoForward()),
      loading: Boolean(tab?.wc.isLoading()),
      busy: this.busy,
      step: this.step,
      tabs: this.tabs.filter((item) => !item.wc.isDestroyed()).map((item) => ({ no: item.no, title: item.wc.getTitle() || item.wc.getURL(), active: item === tab })),
      full: this.tabs.length >= MAX_TABS,
      labels: {
        back: t('jbrowser.toolbar.back'),
        forward: t('jbrowser.toolbar.forward'),
        reload: t('jbrowser.toolbar.reload'),
        hide: t('jbrowser.toolbar.hide'),
        newTab: t('jbrowser.toolbar.newTab'),
        closeTab: t('jbrowser.toolbar.closeTab'),
        stop: t('jbrowser.toolbar.stop'),
        busy: t('jbrowser.toolbar.busy'),
        address: t('jbrowser.toolbar.address'),
      },
    };
    void toolbar.webContents.executeJavaScript(`window.render && window.render(${JSON.stringify(state)})`).catch(() => {});
  }

  /** Kullanıcının araç çubuğundaki eylemi: kullanıcının kendi gezinimidir (kalkan için "tarayıcının isteği"). */
  private async onToolbar(action: ToolbarAction): Promise<void> {
    const tab = this.active;
    switch (action.kind) {
      case 'stop':
        this.options.onStop();
        return;
      case 'hide':
        this.hide();
        return;
      case 'new_tab':
        if (this.tabs.length < MAX_TABS) await this.createTab();
        return;
      case 'tab': {
        const target = this.tabs.find((item) => item.no === action.no);
        if (target) this.activate(target);
        return;
      }
      case 'close_tab':
        this.closeTab(action.no);
        return;
      case 'go': {
        const url = resolveAddress(action.input);
        if (!url) return;
        const target = tab ?? (await this.createTab());
        target.shield.userInput();
        target.expectNav = true;
        void target.wc.loadURL(url).catch(() => {});
        return;
      }
      default:
        if (!tab) return;
        tab.shield.userInput();
        tab.expectNav = true;
        if (action.kind === 'back' && tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack();
        else if (action.kind === 'forward' && tab.wc.navigationHistory.canGoForward()) tab.wc.navigationHistory.goForward();
        else if (action.kind === 'reload') tab.wc.reload();
        else tab.expectNav = false;
    }
  }

  private async openInNewTab(url: string): Promise<void> {
    const tab = await this.createTab();
    tab.expectNav = true;
    await tab.wc.loadURL(url).catch(() => {});
  }

  listTabs(): TabInfo[] {
    return this.tabs
      .filter((tab) => !tab.wc.isDestroyed())
      .map((tab) => ({ no: tab.no, title: tab.wc.getTitle(), url: tab.wc.getURL(), active: tab === this.active, loading: tab.wc.isLoading() }));
  }

  /** Sekme yoksa boş bir sekme açar (kullanıcı pencereyi Ayarlar'dan açınca adres çubuğu kullanılabilsin). */
  async ensureTab(): Promise<void> {
    if (!this.hasTab()) await this.createTab();
  }

  hasTab(): boolean {
    return Boolean(this.active && !this.active.wc.isDestroyed());
  }

  switchTab(no: number): boolean {
    const tab = this.tabs.find((item) => item.no === no && !item.wc.isDestroyed());
    if (!tab) return false;
    this.activate(tab);
    return true;
  }

  closeTab(no: number): boolean {
    const index = this.tabs.findIndex((item) => item.no === no);
    if (index === -1) return false;
    const [tab] = this.tabs.splice(index, 1);
    tab!.shield.close();
    try {
      this.win?.contentView.removeChildView(tab!.view);
    } catch {
      // takılı değildi
    }
    try {
      tab!.wc.close();
    } catch {
      // zaten kapalı
    }
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[index] ?? this.tabs[index - 1] ?? null;
      if (next) this.activate(next);
    }
    this.renderToolbar();
    this.updateTitle();
    return true;
  }

  /** Bütün sekmeleri kapatır, pencereyi gizler (oturum ve çerezler kalır). */
  closeAll(): void {
    for (const tab of [...this.tabs]) this.closeTab(tab.no);
    this.hide();
  }

  /** "Oturumları sil": çerezler, depolama ve önbellek (yalnız bu bölüm). */
  async clearData(): Promise<void> {
    const { session } = await this.electronApi();
    const ses = this.session ?? session.fromPartition(PARTITION);
    this.closeAll();
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
  }

  // ───────────── Jarvis eylemi (kalkanla) ─────────────

  /**
   * Bir Jarvis eylemini kalkanla sarar: etkin sekmenin kalkanı eylem boyunca "Jarvis çalışıyor" bilir ve ağ kartını bu
   * eylemin onay akışıyla sorar. Eylem bittikten sonra açık kart yanıtlanana dek ve ağ sakinleşene dek beklenir (araç kart
   * yanıtlanmadan dönmez). `interactive`: etkileşimli eylem (tık, yazma, tuş, seçim): sekmeyi kirletir.
   */
  async act<T>(
    step: string,
    ask: (card: NetworkCard) => Promise<boolean>,
    work: () => Promise<T>,
    options: { interactive?: { approved: boolean }; needsTab?: boolean } = {},
  ): Promise<{ value: T; report: ActionReport }> {
    await this.ensure();
    const epoch = this.stopEpoch;
    const halted = this.haltPromise();
    const guardedAsk = (card: NetworkCard) => Promise.race([ask(card), halted.promise.then(() => false)]);
    let tab = this.active && !this.active.wc.isDestroyed() ? this.active : null;
    this.setBusy(true, step);
    if (!this.options.test) await this.show(false);
    const touched = new Set<Tab>();
    const begin = (target: Tab) => {
      if (touched.has(target)) return;
      touched.add(target);
      target.shield.agentBegin(guardedAsk);
    };
    if (tab) begin(tab);
    if (tab && options.interactive) tab.shield.interaction(options.interactive.approved);
    let cardSeen: boolean | null = null;
    try {
      const value = await work();
      // Eylem yeni sekme açtıysa onu da kalkana bağla.
      tab = this.active && !this.active.wc.isDestroyed() ? this.active : tab;
      if (tab) begin(tab);
      // Geç gelen istekler (tıklamadan sonra betikle gönderim) eylemin içinde sayılsın: kısa bekleme + açık kart.
      await sleep(SETTLE_MS);
      for (let round = 0; round < 50; round++) {
        if (this.stopEpoch !== epoch) break;
        const open = [...touched].map((item) => item.shield.openCard()).filter((card): card is Promise<boolean> => card !== null);
        if (open.length === 0 && [...touched].every((item) => item.holding === 0)) break;
        await Promise.all(open);
        if (open.length === 0) await sleep(100);
      }
      for (const item of touched) {
        const outcome = item.shield.takeCardOutcome();
        if (outcome !== null) cardSeen = cardSeen === false ? false : outcome;
      }
      const blocked = [...touched].reduce((sum, item) => sum + item.shield.takeBlocked(), 0);
      this.decisions.push({ at: this.now(), method: 'ARAÇ', type: step, target: [...touched].map((item) => item.no).join(','), verdict: `bitti: ${blocked} durduruldu`, busy: true });
      return { value, report: { blocked, card: cardSeen } };
    } finally {
      for (const item of touched) item.shield.agentEnd();
      halted.dispose();
      this.setBusy(false, '');
    }
  }

  /** Etkin sekmenin kalkanı yakın zamanda gönderim durdurduysa sıradaki etkileşim onaya zorlanır. */
  mustConfirm(): boolean {
    return Boolean(this.active?.shield.mustConfirm());
  }

  consumeForce(): void {
    this.active?.shield.consumeForce();
  }

  private setBusy(busy: boolean, step: string): void {
    this.busy = busy;
    this.step = step;
    this.options.onBusy(busy, step);
    this.renderToolbar();
  }

  // ───────────── durdurma ─────────────

  /** Durdur / acil dur: bekleyen kartlar reddedilir, süren beklemeler kesilir, sayfalar yüklemeyi bırakır. */
  halt(): void {
    this.stopEpoch += 1;
    this.wakeStopWaiters();
    for (const tab of this.tabs) {
      if (!tab.wc.isDestroyed()) tab.wc.stop();
    }
    this.pendingDownload?.resolve({ ok: false, error: 'stopped' });
    this.pendingDownload = null;
  }

  private wakeStopWaiters(): void {
    for (const wake of this.stopWaiters) wake();
    this.stopWaiters.clear();
  }

  private haltPromise(): { promise: Promise<void>; dispose(): void } {
    let wake: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      wake = resolve;
      this.stopWaiters.add(resolve);
    });
    return { promise, dispose: () => this.stopWaiters.delete(wake) };
  }

  // ───────────── gezinme ve okuma ─────────────

  /** Adrese gider (etkin sekmede ya da yeni sekmede). Kurala takılırsa açmaz. */
  async navigate(raw: string, newTab: boolean): Promise<NavOutcome> {
    const url = resolveAddress(raw);
    if (!url) return { ok: false, url: raw, title: '', blocked: 'scheme' };
    const block = addressBlock(url, { mainFrame: true, rules: { allow: this.options.allow } });
    if (block) return { ok: false, url, title: '', blocked: block };
    if (!(await this.hostAllowed(url))) return { ok: false, url, title: '', blocked: 'private' };
    let tab = !newTab && this.active && !this.active.wc.isDestroyed() ? this.active : null;
    if (!tab) {
      if (this.tabs.length >= MAX_TABS) return { ok: false, url, title: '', error: t('jbrowser.error.tooManyTabs', { max: MAX_TABS }) };
      tab = await this.createTab();
    }
    tab.lastBlocked = null;
    tab.lastError = null;
    tab.expectNav = true;
    await tab.wc.loadURL(url).catch(() => {});
    await this.waitLoaded(tab);
    return this.outcome(tab, url);
  }

  async history(direction: 'back' | 'forward' | 'reload'): Promise<NavOutcome | null> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return null;
    const history = tab.wc.navigationHistory;
    if (direction === 'back' && !history.canGoBack()) return null;
    if (direction === 'forward' && !history.canGoForward()) return null;
    tab.expectNav = true;
    tab.lastError = null;
    tab.lastBlocked = null;
    if (direction === 'back') history.goBack();
    else if (direction === 'forward') history.goForward();
    else tab.wc.reload();
    await sleep(80);
    await this.waitLoaded(tab);
    return this.outcome(tab, tab.wc.getURL());
  }

  private outcome(tab: Tab, requested: string): NavOutcome {
    const url = tab.wc.getURL();
    if (tab.lastBlocked) return { ok: false, url: requested, title: '', blocked: tab.lastBlocked };
    if (tab.lastError) return { ok: false, url: requested, title: tab.wc.getTitle(), error: tab.lastError };
    return { ok: true, url, title: tab.wc.getTitle() };
  }

  private async waitLoaded(tab: Tab, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
    const until = this.now() + timeoutMs;
    await sleep(30);
    while (!tab.wc.isDestroyed() && tab.wc.isLoading() && this.now() < until) await sleep(60);
    await sleep(120);
  }

  private async isolated<T>(tab: Tab, code: string): Promise<T> {
    return (await tab.wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }])) as T;
  }

  async read(maxChars: number): Promise<PageSnapshot | null> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return null;
    await this.waitLoaded(tab);
    if (tab.wc.getURL() === 'about:blank' || !tab.wc.getURL()) return { title: '', url: '', text: '', items: [], more: 0 };
    return this.isolated<PageSnapshot>(tab, markScript(maxChars));
  }

  async probe(no: number): Promise<(Probe & { stale?: boolean; missing?: boolean }) | null> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return null;
    return this.isolated(tab, probeScript(no));
  }

  async probeFocus(): Promise<Probe | null> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return null;
    return this.isolated(tab, focusScript());
  }

  pageInfo(): { url: string; title: string } {
    const tab = this.active;
    return tab && !tab.wc.isDestroyed() ? { url: tab.wc.getURL(), title: tab.wc.getTitle() } : { url: '', title: '' };
  }

  // ───────────── etkileşim ─────────────

  /** Öğenin merkezine gerçek fare tıklaması (sayfa içinde; işletim sisteminin imleci oynamaz). */
  async click(point: { x: number; y: number }): Promise<void> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return;
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    tab.lastAgentClickAt = this.now();
    tab.wc.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(30);
    tab.wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    tab.wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await this.afterInput(tab);
  }

  async focusField(no: number, selectAll: boolean): Promise<{ ok: boolean; why: string | null }> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return { ok: false, why: 'no_tab' };
    return this.isolated(tab, focusFieldScript(no, selectAll));
  }

  /** Odaktaki alana metin girer (IME onayı gibi; tuş olayı üretmez: Enter'a basılmış sayılmaz). */
  async insertText(text: string): Promise<void> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return;
    if (text) await tab.wc.insertText(text);
    else {
      tab.wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      tab.wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    }
    await sleep(60);
  }

  async fieldValue(no: number): Promise<string | null> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return null;
    return this.isolated(tab, valueScript(no));
  }

  async pressKey(step: KeyStep): Promise<void> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return;
    const modifiers = step.modifiers.map((modifier) => (modifier === 'control' ? 'control' : modifier)) as Array<'control' | 'shift' | 'alt' | 'meta'>;
    tab.wc.sendInputEvent({ type: 'keyDown', keyCode: step.keyCode, modifiers });
    if (step.char !== undefined) tab.wc.sendInputEvent({ type: 'char', keyCode: step.char, modifiers });
    else if (step.enter) tab.wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    tab.wc.sendInputEvent({ type: 'keyUp', keyCode: step.keyCode, modifiers });
    await sleep(40);
  }

  async afterKeys(): Promise<void> {
    const tab = this.active;
    if (tab) await this.afterInput(tab);
  }

  async select(no: number, choice: string): Promise<{ ok: boolean; why?: string; chosen?: string; options?: string[] }> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return { ok: false, why: 'no_tab' };
    const result = await this.isolated<{ ok: boolean; why?: string; chosen?: string; options?: string[] }>(tab, selectScript(no, choice));
    await this.afterInput(tab);
    return result;
  }

  async scroll(direction: 'down' | 'up' | 'top' | 'bottom', no?: number): Promise<{ ok: boolean; y?: number; max?: number }> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return { ok: false };
    return this.isolated(tab, scrollScript(direction, no));
  }

  /** Girdiden sonra: gezinme başladıysa yüklenmesini, başlamadıysa kısa bir sakinleşmeyi bekler. */
  private async afterInput(tab: Tab): Promise<void> {
    await sleep(150);
    if (tab.wc.isDestroyed()) return;
    if (tab.wc.isLoading()) await this.waitLoaded(tab, 10_000);
  }

  /** Metin görünene ya da süre dolana dek bekler; Durdur keser. */
  async waitForText(text: string, seconds: number, signal: AbortSignal): Promise<boolean> {
    const until = this.now() + seconds * 1000;
    const epoch = this.stopEpoch;
    while (this.now() < until && !signal.aborted && this.stopEpoch === epoch) {
      const tab = this.active;
      if (tab && !tab.wc.isDestroyed() && !tab.wc.isLoading()) {
        const found = await this.isolated<boolean>(tab, hasTextScript(text)).catch(() => false);
        if (found) return true;
      }
      await sleep(250);
    }
    return false;
  }

  /**
   * Kullanıcının işini bitirmesini bekler (parola girişi gibi): kullanıcı sayfada bir şey yaptıktan sonra 6 sn hiç girdi
   * gelmezse ya da sayfa değişirse biter. En çok `seconds`.
   */
  async waitForUser(seconds: number, signal: AbortSignal): Promise<'done' | 'timeout' | 'stopped'> {
    const tab = this.active;
    if (!tab) return 'timeout';
    const started = this.now();
    const startUrl = tab.wc.getURL();
    const epoch = this.stopEpoch;
    while (this.now() - started < seconds * 1000) {
      if (signal.aborted || this.stopEpoch !== epoch || tab.wc.isDestroyed()) return 'stopped';
      const touched = tab.lastInputAt > started;
      if (touched && (this.now() - tab.lastInputAt > 6000 || tab.wc.getURL() !== startUrl)) return 'done';
      await sleep(250);
    }
    return 'timeout';
  }

  async sleepFor(seconds: number, signal: AbortSignal): Promise<void> {
    const until = this.now() + seconds * 1000;
    const epoch = this.stopEpoch;
    while (this.now() < until && !signal.aborted && this.stopEpoch === epoch) await sleep(100);
  }

  /** Etkin sekmenin görüntüsü (bellekte; diske yazılmaz). Uzun kenar en çok `maxEdge`. */
  async screenshot(maxEdge = 1568): Promise<{ mediaType: 'image/jpeg'; data: string; width: number; height: number } | null> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return null;
    let image = await tab.wc.capturePage(undefined, { stayHidden: true });
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
    if (scale < 1) image = image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'good' });
    const out = image.getSize();
    return { mediaType: 'image/jpeg', data: image.toJPEG(80).toString('base64'), width: out.width, height: out.height };
  }

  /** Onaylanmış tek indirme: yalnız bu adres, 15 sn içinde başlarsa kabul edilir. */
  async download(url: string): Promise<{ ok: boolean; file?: string; error?: string }> {
    const tab = this.active;
    if (!tab || tab.wc.isDestroyed()) return { ok: false, error: 'no_tab' };
    const block = addressBlock(url, { mainFrame: true, rules: { allow: this.options.allow } });
    if (block) return { ok: false, error: `blocked:${block}` };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingDownload?.url === url) this.pendingDownload = null;
        resolve({ ok: false, error: 'timeout' });
      }, 120_000);
      this.pendingDownload = {
        url,
        until: this.now() + DOWNLOAD_APPROVAL_MS,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      };
      tab.wc.downloadURL(url);
    });
  }

  /** Sınama: sekmelerin web tercihleri ve köprü yokluğunun kanıtı için etkin sekmenin webContents'i. */
  activeContents(): WebContents | null {
    return this.active && !this.active.wc.isDestroyed() ? this.active.wc : null;
  }

  sessionPath(): string | null {
    return this.session?.getStoragePath() ?? null;
  }
}

function bodyText(upload: Electron.UploadData[] | undefined): string | null {
  const first = upload?.find((part) => part.bytes);
  if (!first?.bytes) return null;
  return first.bytes.subarray(0, MAX_BODY).toString('utf8');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export { CONTROL_SCHEME };
