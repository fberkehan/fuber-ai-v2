/**
 * Kapanış denetleyicisi: pencerenin X'i, tepsideki "Çık" ve `app.quit` TEK yerden karar alır (`closeRoute`).
 * Electron'a bağlı değildir; bağımlılıklar parametreyle gelir (birim testli: `lifecycle.test.ts`).
 *
 * - Diyalog gerekiyorsa ana pencere öne gelir ve `app.closeRequested` gider. Pencere diyaloğu `CLOSE_ACK_TIMEOUT_MS`
 *   içinde almazsa (gizli, çökmüş, yüklenmemiş) düşüş yolu uygulanır: X → tepsiye in, çıkış → düz çık. Çıkış kilitlenmez.
 * - Çıkış kararı veda örtüsüyle olur: pencere görünürse `app.farewell` gider, örtü süresi kadar beklenir; sınamada ve
 *   pencere gizliyken beklenmez. Asıl çıkış `quit()` ile (servis kapanışı `before-quit`te, olduğu gibi).
 * - Sınama kipinde "sor" ayarı, açıkça istenmedikçe (`askInTest`) "tepsiye in" gibi davranır: eski sınamalar ana
 *   pencereyi kapatınca gizlenmesini bekler.
 */

import {
  CLOSE_ACK_TIMEOUT_MS,
  closeFallback,
  closeRoute,
  FAREWELL_MS,
  type BusyItem,
  type CloseAction,
  type CloseChoice,
  type CloseRequest,
  type CloseSource,
  type LifecyclePrefs,
  type Logger,
  type WindowEvents,
} from '@fuber/shared';

export interface CloseControllerDeps {
  prefs(): LifecyclePrefs;
  setPrefs(patch: Partial<LifecyclePrefs>): void;
  /** Süren işler (sorgulanabilenler). Hata ya da gecikme kapanışı engellemez. */
  busy(): Promise<BusyItem[]>;
  mainVisible(): boolean;
  showMain(): Promise<void>;
  hideMain(): void;
  send<K extends 'app.closeRequested' | 'app.farewell'>(event: K, payload: WindowEvents[K]): void;
  /** Gerçek çıkış (`app.quit`). */
  quit(): void;
  testMode: boolean;
  /** Sınamada da "sor" ayarı diyalog açsın. */
  askInTest: boolean;
  log: Pick<Logger, 'info' | 'warn'>;
  ackTimeoutMs?: number;
  farewellMs?: number;
  /** Süren iş sorgusunun üst sınırı (ms). */
  busyTimeoutMs?: number;
  newId?: () => string;
}

export interface CloseController {
  request(source: CloseSource): Promise<'hide' | 'ask' | 'quit'>;
  ack(id: string): void;
  decide(id: string, choice: CloseChoice, remember?: boolean): void;
  /** Bekleyen diyalog (sınama ve tanı). */
  pending(): CloseRequest | null;
  /** Çıkış başladı mı. */
  quitting(): boolean;
}

export function createCloseController(deps: CloseControllerDeps): CloseController {
  const ackTimeout = deps.ackTimeoutMs ?? CLOSE_ACK_TIMEOUT_MS;
  const farewell = deps.testMode ? 0 : (deps.farewellMs ?? FAREWELL_MS);
  const busyTimeout = deps.busyTimeoutMs ?? 1500;
  let seq = 0;
  const newId = deps.newId ?? (() => `close-${Date.now().toString(36)}-${++seq}`);
  let current: { request: CloseRequest; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let leaving = false;

  const effectiveAction = (): CloseAction => {
    const action = deps.prefs().closeAction;
    return deps.testMode && !deps.askInTest && action === 'ask' ? 'background' : action;
  };

  const readBusy = async (): Promise<BusyItem[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        deps.busy().catch(() => [] as BusyItem[]),
        new Promise<BusyItem[]>((resolve) => {
          timer = setTimeout(() => resolve([]), busyTimeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const clear = () => {
    if (current?.timer) clearTimeout(current.timer);
    current = null;
  };

  const quit = () => {
    if (leaving) return;
    leaving = true;
    clear();
    const wait = deps.mainVisible() ? farewell : 0;
    deps.send('app.farewell', { ms: wait });
    deps.log.info(`çıkış: veda ${wait} ms`);
    if (wait <= 0) deps.quit();
    else setTimeout(() => deps.quit(), wait);
  };

  const hide = () => {
    clear();
    deps.hideMain();
  };

  const ask = async (source: CloseSource, busy: BusyItem[]) => {
    if (current) {
      // Diyalog zaten açık: yeni istek onu öne getirir; iş listesi tazelenir, çıkış isteği X'in yerine geçer.
      current.request = { ...current.request, busy, source: source === 'window' ? current.request.source : source };
    } else {
      current = { request: { id: newId(), source, busy }, timer: null };
    }
    const mine = current;
    await deps.showMain().catch(() => {});
    if (current !== mine) return;
    deps.send('app.closeRequested', mine.request);
    if (mine.timer) clearTimeout(mine.timer);
    mine.timer = setTimeout(() => {
      if (current !== mine) return;
      const fallback = closeFallback(mine.request.source);
      deps.log.warn(`kapanış diyaloğu ${ackTimeout} ms içinde açılmadı; ${fallback === 'quit' ? 'çıkılıyor' : 'tepsiye iniliyor'}`);
      if (fallback === 'quit') quit();
      else hide();
    }, ackTimeout);
  };

  return {
    async request(source) {
      if (leaving) return 'quit';
      const action = effectiveAction();
      // Arka plana inmek için iş sorgusu beklenmez (X anında tepki versin).
      const busy = source === 'window' && action === 'background' ? [] : await readBusy();
      const route = closeRoute(source, action, busy);
      if (route === 'hide') hide();
      else if (route === 'quit') quit();
      else await ask(source, busy);
      return route;
    },

    ack(id) {
      if (!current || current.request.id !== id) return;
      if (current.timer) clearTimeout(current.timer);
      current.timer = null;
    },

    decide(id, choice, remember) {
      if (!current || current.request.id !== id) return;
      if (remember && choice !== 'cancel') deps.setPrefs({ closeAction: choice });
      if (choice === 'quit') quit();
      else if (choice === 'background') hide();
      else clear();
    },

    pending: () => current?.request ?? null,
    quitting: () => leaving,
  };
}
