import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusyItem, LifecyclePrefs } from '@fuber/shared';
import { createCloseController, type CloseControllerDeps } from './lifecycle';

function harness(options: { action?: LifecyclePrefs['closeAction']; busy?: BusyItem[]; visible?: boolean; testMode?: boolean; askInTest?: boolean } = {}) {
  let prefs: LifecyclePrefs = { closeAction: options.action ?? 'ask', startupSound: true };
  const calls = { quit: 0, hide: 0, show: 0, sent: [] as Array<[string, unknown]> };
  const deps: CloseControllerDeps = {
    prefs: () => prefs,
    setPrefs: (patch) => {
      prefs = { ...prefs, ...patch };
    },
    busy: async () => options.busy ?? [],
    mainVisible: () => options.visible ?? true,
    showMain: async () => {
      calls.show++;
    },
    hideMain: () => {
      calls.hide++;
    },
    send: (event, payload) => void calls.sent.push([event, payload]),
    quit: () => {
      calls.quit++;
    },
    testMode: options.testMode ?? false,
    askInTest: options.askInTest ?? false,
    log: { info() {}, warn() {} },
    farewellMs: 600,
    ackTimeoutMs: 1000,
    newId: () => 'c1',
  };
  return { controller: createCloseController(deps), calls, prefs: () => prefs };
}

describe('kapanış denetleyicisi', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('X + "sor": ana pencere öne gelir, diyalog gider; "arka planda" ve "bir daha sorma" ayarı yazar', async () => {
    const { controller, calls, prefs } = harness();
    expect(await controller.request('window')).toBe('ask');
    expect(calls.show).toBe(1);
    expect(calls.sent[0]).toEqual(['app.closeRequested', { id: 'c1', source: 'window', busy: [] }]);
    controller.ack('c1');
    controller.decide('c1', 'background', true);
    expect(calls.hide).toBe(1);
    expect(prefs().closeAction).toBe('background');
    expect(controller.pending()).toBeNull();
    // Artık sormadan tepsiye iner.
    expect(await controller.request('window')).toBe('hide');
    expect(calls.hide).toBe(2);
  });

  it('"tamamen çık": veda örtüsü gider, örtü süresi kadar sonra çıkılır', async () => {
    const { controller, calls } = harness();
    await controller.request('window');
    controller.ack('c1');
    controller.decide('c1', 'quit');
    expect(calls.sent.at(-1)).toEqual(['app.farewell', { ms: 600 }]);
    expect(calls.quit).toBe(0);
    vi.advanceTimersByTime(600);
    expect(calls.quit).toBe(1);
    expect(controller.quitting()).toBe(true);
  });

  it('pencere gizliyken veda beklenmez', async () => {
    const { controller, calls } = harness({ visible: false });
    await controller.request('tray');
    expect(calls.sent.at(-1)).toEqual(['app.farewell', { ms: 0 }]);
    expect(calls.quit).toBe(1);
  });

  it('tepsi çıkışı, süren iş varken diyalog açar; "vazgeç" hiçbir şey yapmaz', async () => {
    const busy: BusyItem[] = [{ kind: 'meeting', count: 1, title: null }];
    const { controller, calls } = harness({ busy });
    expect(await controller.request('tray')).toBe('ask');
    expect(calls.sent[0]).toEqual(['app.closeRequested', { id: 'c1', source: 'tray', busy }]);
    controller.ack('c1');
    controller.decide('c1', 'cancel', true);
    expect(calls.quit + calls.hide).toBe(0);
  });

  it('pencere diyaloğu almazsa: çıkış isteği zaman aşımıyla düz çıkar, X tepsiye iner', async () => {
    const quit = harness({ busy: [{ kind: 'jobs', count: 2, title: null }] });
    await quit.controller.request('app');
    vi.advanceTimersByTime(999);
    expect(quit.calls.quit).toBe(0);
    vi.advanceTimersByTime(700);
    expect(quit.calls.quit).toBe(1);

    const hide = harness();
    await hide.controller.request('window');
    vi.advanceTimersByTime(1000);
    expect(hide.calls.hide).toBe(1);
    expect(hide.calls.quit).toBe(0);
  });

  it('diyalog alındıysa (ack) zaman aşımı düşmez', async () => {
    const { controller, calls } = harness();
    await controller.request('window');
    controller.ack('c1');
    vi.advanceTimersByTime(10_000);
    expect(calls.hide + calls.quit).toBe(0);
  });

  it('sınamada "sor" açıkça istenmedikçe eskisi gibi tepsiye iner', async () => {
    const quiet = harness({ testMode: true });
    expect(await quiet.controller.request('window')).toBe('hide');
    const asking = harness({ testMode: true, askInTest: true });
    expect(await asking.controller.request('window')).toBe('ask');
    // Sınamada veda beklenmez.
    asking.controller.decide('c1', 'quit');
    expect(asking.calls.quit).toBe(1);
  });

  it('süren iş sorgusu takılırsa kapanış beklemez', async () => {
    const { controller, calls } = harness();
    const stuck = createCloseController({
      prefs: () => ({ closeAction: 'ask', startupSound: true }),
      setPrefs() {},
      busy: () => new Promise(() => {}),
      mainVisible: () => false,
      showMain: async () => {},
      hideMain() {},
      send() {},
      quit: () => void (calls.quit += 10),
      testMode: false,
      askInTest: false,
      log: { info() {}, warn() {} },
      busyTimeoutMs: 200,
    });
    const route = stuck.request('tray');
    await vi.advanceTimersByTimeAsync(200);
    expect(await route).toBe('quit');
    expect(calls.quit).toBe(10);
    void controller;
  });
});
