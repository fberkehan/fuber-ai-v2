// SAHTE girdi sürücüsü: hiçbir tuş basmaz, imleci oynatmaz; olanı kaydeder. Birim sınamaları ve sınama kipindeki
// uygulama (FUBER2_TEST) bunu kullanır: bir sınama geliştiricinin ekranına ASLA gerçek girdi üretemez.
import type { InputDriver, MouseButton, Point, Rect } from './types';

export type InputEvent =
  | { type: 'text'; text: string; hwnd: number | null }
  | { type: 'keys'; keys: Array<{ vk: number; down: boolean }>; hwnd: number | null }
  | { type: 'move'; x: number; y: number }
  | { type: 'button'; button: MouseButton; down: boolean; x: number; y: number }
  | { type: 'wheel'; notches: number; horizontal: boolean; x: number; y: number }
  | { type: 'activate'; hwnd: number }
  | { type: 'show'; hwnd: number; action: 'minimize' | 'maximize' | 'restore' }
  | { type: 'close'; hwnd: number }
  | { type: 'place'; hwnd: number; rect: Rect };

export interface FakeWindow {
  minimized: boolean;
  maximized: boolean;
  rect: Rect;
}

export interface FakeInput extends InputDriver {
  events: InputEvent[];
  /** Pencere başına yazılan metin (doğrulama sınamaları için). */
  typed: Map<number, string>;
  windows: Map<number, FakeWindow>;
  state: {
    foreground: number | null;
    cursor: Point;
    /** Kullanıcının "bastığı" tuşlar (sınama koyar). */
    down: Set<number>;
    time: number;
    lastInput: number;
    /** `activateWindow` gerçekten öne getirsin mi (odak alınamama yolunu sınamak için kapatılır). */
    activateWorks: boolean;
    /** `closeWindow` pencereyi gerçekten kapatsın mı ("kaydedilsin mi?" sorusunda kalan pencere için kapatılır). */
    closeWorks: boolean;
    /** `setWindowRect` pencereyi gerçekten taşısın mı (taşınamayan pencere yolunu sınamak için kapatılır). */
    placeWorks: boolean;
    /** Sahte ekran: `monitorOf` bunu döndürür (`null` = ekran bulunamadı). */
    monitor: { full: Rect; work: Rect } | null;
  };
  /** Her kaydedilen olaydan SONRA çağrılır: sınama burada "kullanıcı fareyi oynattı" gibi araya girer. */
  onEvent: ((event: InputEvent, index: number) => void) | null;
  /** Sahte saati ilerletir (`sleep` yerine). */
  advance(ms: number): void;
  /** Kullanıcının kendi girdisi: son girdi anı şimdiye çekilir. */
  userInput(): void;
}

export function createFakeInput(record?: (event: InputEvent) => void): FakeInput {
  const events: InputEvent[] = [];
  const typed = new Map<number, string>();
  const windows = new Map<number, FakeWindow>();
  const state: FakeInput['state'] = {
    foreground: null,
    cursor: { x: 0, y: 0 },
    down: new Set<number>(),
    time: 1_000_000,
    lastInput: 0,
    activateWorks: true,
    closeWorks: true,
    placeWorks: true,
    monitor: { full: { left: 0, top: 0, right: 1920, bottom: 1080 }, work: { left: 0, top: 0, right: 1920, bottom: 1040 } },
  };
  const fake: FakeInput = {
    events,
    typed,
    windows,
    state,
    onEvent: null,
    advance(ms) {
      state.time += ms;
    },
    userInput() {
      state.lastInput = state.time;
    },

    foregroundWindow: () => state.foreground,
    windowAt(point) {
      // z-sırası bilinmez; öndeki pencere noktayı kapsıyorsa odur, değilse kapsayan ilk pencere.
      const inside = (rect: Rect) => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
      const front = state.foreground === null ? undefined : windows.get(state.foreground);
      if (front && !front.minimized && inside(front.rect)) return state.foreground;
      for (const [hwnd, window] of windows) if (!window.minimized && inside(window.rect)) return hwnd;
      return null;
    },
    windowState(hwnd) {
      const window = windows.get(hwnd);
      return window ? { exists: true, minimized: window.minimized, maximized: window.maximized, rect: window.rect } : { exists: false, minimized: false, maximized: false, rect: null };
    },
    activateWindow(hwnd) {
      push({ type: 'activate', hwnd });
      const window = windows.get(hwnd);
      if (!window || !state.activateWorks) return;
      window.minimized = false;
      state.foreground = hwnd;
    },
    showWindow(hwnd, action) {
      push({ type: 'show', hwnd, action });
      const window = windows.get(hwnd);
      if (!window) return;
      window.minimized = action === 'minimize';
      window.maximized = action === 'maximize';
      if (action === 'minimize' && state.foreground === hwnd) state.foreground = null;
    },
    closeWindow(hwnd) {
      push({ type: 'close', hwnd });
      if (!state.closeWorks) return;
      windows.delete(hwnd);
      if (state.foreground === hwnd) state.foreground = null;
    },
    setWindowRect(hwnd, rect) {
      push({ type: 'place', hwnd, rect: { ...rect } });
      const window = windows.get(hwnd);
      if (!window || !state.placeWorks) return;
      window.rect = { ...rect };
      window.maximized = false;
      window.minimized = false;
    },
    monitorOf: (hwnd) => (windows.has(hwnd) ? state.monitor : null),
    sendText(text) {
      state.lastInput = state.time;
      if (state.foreground !== null) typed.set(state.foreground, (typed.get(state.foreground) ?? '') + text);
      push({ type: 'text', text, hwnd: state.foreground });
    },
    sendKeys(keys) {
      state.lastInput = state.time;
      push({ type: 'keys', keys: keys.map((key) => ({ ...key })), hwnd: state.foreground });
    },
    keyForChar: () => null,
    cursor: () => ({ ...state.cursor }),
    moveCursor(point) {
      state.cursor = { x: Math.round(point.x), y: Math.round(point.y) };
      push({ type: 'move', x: state.cursor.x, y: state.cursor.y });
    },
    mouseButton(button, down) {
      state.lastInput = state.time;
      push({ type: 'button', button, down, x: state.cursor.x, y: state.cursor.y });
    },
    wheel(notches, horizontal = false) {
      state.lastInput = state.time;
      push({ type: 'wheel', notches, horizontal, x: state.cursor.x, y: state.cursor.y });
    },
    downKeys: () => [...state.down],
    lastInputTick: () => state.lastInput,
    tick: () => state.time,
  };
  function push(event: InputEvent): void {
    events.push(event);
    record?.(event);
    fake.onEvent?.(event, events.length - 1);
  }
  return fake;
}

/**
 * Sınama kipindeki uygulama için: OKUYAN çağrılar gerçek sisteme sorulur (öndeki pencere, imleç), YAPAN çağrılar
 * yalnız kaydedilir. Pencere öne gelmediği için hedefi önde olmayan eylem dürüstçe "odak alınamadı" döner.
 */
export function createRecordingInput(real: InputDriver, record: (event: InputEvent) => void): InputDriver {
  return {
    foregroundWindow: () => real.foregroundWindow(),
    windowAt: (point) => real.windowAt(point),
    windowState: (hwnd) => real.windowState(hwnd),
    keyForChar: (char) => real.keyForChar(char),
    cursor: () => real.cursor(),
    downKeys: () => real.downKeys(),
    lastInputTick: () => real.lastInputTick(),
    tick: () => real.tick(),
    activateWindow: (hwnd) => record({ type: 'activate', hwnd }),
    showWindow: (hwnd, action) => record({ type: 'show', hwnd, action }),
    closeWindow: (hwnd) => record({ type: 'close', hwnd }),
    setWindowRect: (hwnd, rect) => record({ type: 'place', hwnd, rect: { ...rect } }),
    monitorOf: (hwnd) => real.monitorOf(hwnd),
    sendText: (text) => record({ type: 'text', text, hwnd: real.foregroundWindow() }),
    sendKeys: (keys) => record({ type: 'keys', keys: keys.map((key) => ({ ...key })), hwnd: real.foregroundWindow() }),
    moveCursor: (point) => record({ type: 'move', x: Math.round(point.x), y: Math.round(point.y) }),
    mouseButton: (button, down) => record({ type: 'button', button, down, ...real.cursor() }),
    wheel: (notches, horizontal = false) => record({ type: 'wheel', notches, horizontal, ...real.cursor() }),
  };
}
