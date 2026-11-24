// Birim sınamaları için sahte ekran: sahte girdi sürücüsü + sahte UI Automation sağlayıcısı. Uygulama demetine girmez.
import { foldForSearch } from '@fuber/shared';
import { createPcControl, type ApprovalKind, type ControlActivity, type ControlCall } from './control';
import { createFakeInput, type FakeInput, type InputEvent } from './input-fake';
import type { BrowserWindowInfo, DocumentText, ElementAt, FocusedInfo, FoundElement, SurveyItem, UiaNode, UiaProvider, WindowInfo } from './types';

export function win(hwnd: number, title: string, exe: string, app: string, extra: Partial<WindowInfo> = {}): WindowInfo {
  return {
    hwnd,
    title,
    exe,
    app,
    path: `C:\\Program Files\\${app}\\${exe}.exe`,
    pid: hwnd * 10,
    minimized: false,
    maximized: false,
    focused: false,
    own: false,
    className: exe === 'chrome' || exe === 'msedge' ? 'Chrome_WidgetWin_1' : 'Window',
    rect: { left: 100, top: 100, right: 1100, bottom: 800 },
    ...extra,
  };
}

export function element(ref: number, name: string, role = 'Button', extra: Partial<FoundElement> = {}): FoundElement {
  return { ref, role, name, score: 115, rect: { left: 300, top: 300, right: 400, bottom: 340 }, point: { x: 350, y: 320 }, onscreen: true, enabled: true, password: false, patterns: ['invoke'], ...extra };
}

export interface FakeUia extends UiaProvider {
  state: {
    windows: WindowInfo[];
    locked: boolean;
    /** Odaktaki alan; verilmezse "yazılabilir, parola değil, değeri = o pencereye yazılanlar". */
    focused: Partial<FocusedInfo> | null;
    focusedFails: boolean;
    nodes: Map<number, UiaNode[]>;
    elements: Map<number, FoundElement[]>;
    at: Partial<ElementAt>;
    browsers: BrowserWindowInfo[];
    /** `document` çağrılarının sırayla döndürecekleri (son eleman yinelenir). */
    documents: DocumentText[];
    invokeOk: boolean;
    fails: boolean;
    /** `survey` yanıtı (pencere başına); verilmezse o pencerenin `elements` listesinden türetilir. */
    survey: Map<number, SurveyItem[]>;
    /** Her `find` çağrısından önce çağrılır (sınama "öğe sonradan belirdi" durumunu kurar). */
    onFind: ((hwnd: number, count: number) => void) | null;
  };
  calls: string[];
  invoked: number[];
}

export function createFakeUia(input: FakeInput): FakeUia {
  const state: FakeUia['state'] = {
    windows: [],
    locked: false,
    focused: null,
    focusedFails: false,
    nodes: new Map(),
    elements: new Map(),
    at: {},
    browsers: [],
    documents: [],
    invokeOk: true,
    fails: false,
    survey: new Map(),
    onFind: null,
  };
  let finds = 0;
  const calls: string[] = [];
  const invoked: number[] = [];
  let documentIndex = 0;
  const guard = (name: string) => {
    calls.push(name);
    if (state.fails) throw new Error('sahte: yardımcı yok');
  };
  return {
    state,
    calls,
    invoked,
    async windows() {
      guard('windows');
      const front = input.state.foreground;
      // z-sırası: öndeki pencere listenin başında.
      const ordered = [...state.windows].sort((a, b) => Number(b.hwnd === front) - Number(a.hwnd === front));
      const windows = ordered.map((window) => ({ ...window, focused: window.hwnd === front, minimized: input.windows.get(window.hwnd)?.minimized ?? window.minimized }));
      return { windows, foreground: windows.find((window) => window.focused) ?? null, locked: state.locked };
    },
    async read(hwnd) {
      guard('read');
      return { nodes: state.nodes.get(hwnd) ?? [], truncated: false };
    },
    async focused() {
      guard('focused');
      if (state.focusedFails) throw new Error('sahte: odak okunamadı');
      const front = input.state.foreground;
      return {
        hwnd: front,
        known: true,
        role: 'Edit',
        name: 'Metin',
        className: 'Edit',
        password: false,
        editable: true,
        value: front === null ? null : (input.typed.get(front) ?? ''),
        ...state.focused,
      };
    },
    async at() {
      guard('at');
      return { known: true, role: 'Button', name: 'Düğme', className: '', password: false, parentRole: 'Pane', parentName: '', ...state.at };
    },
    async find(hwnd, query) {
      guard('find');
      finds += 1;
      state.onFind?.(hwnd, finds);
      const all = state.elements.get(hwnd) ?? [];
      const matches = all.filter((item) => query.terms.every((term) => foldForSearch(item.name).includes(term)) && (!query.role || item.role === query.role));
      return { matches: matches.sort((a, b) => b.score - a.score), total: matches.length };
    },
    async survey(hwnd) {
      guard('survey');
      const items = state.survey.get(hwnd) ?? (state.elements.get(hwnd) ?? []).filter((item) => item.onscreen).map((item) => ({ role: item.role, name: item.name }));
      return { items, more: 0, truncated: false };
    },
    async invoke(ref) {
      guard('invoke');
      if (!state.invokeOk) return { ok: false, error: 'no_pattern' };
      invoked.push(ref);
      return { ok: true, pattern: 'invoke' };
    },
    async browsers() {
      guard('browsers');
      return state.browsers.map((window) => ({ ...window, focused: window.hwnd === input.state.foreground }));
    },
    async document() {
      guard('document');
      const result = state.documents[Math.min(documentIndex, state.documents.length - 1)] ?? { found: false, method: 'none' as const, text: '', truncated: false };
      documentIndex += 1;
      return result;
    },
    warm() {
      calls.push('warm');
    },
    stop() {
      calls.push('stop');
    },
  };
}

export interface Scene {
  input: FakeInput;
  uia: FakeUia;
  control: ReturnType<typeof createPcControl>;
  activity: ControlActivity[];
  approvals: Array<{ kind: ApprovalKind; detail: string }>;
  /** Sıradaki onay sorularına verilecek yanıtlar (boşsa ret). */
  answers: boolean[];
  abort: AbortController;
  call: ControlCall;
  /** Sürücüye giden olayların türleri. */
  kinds(): string[];
  text(): string;
  /** Sahte `sleep`: saati ilerletir; `whileSleeping` verilirse her beklemede çağrılır (kullanıcı girdisi benzetimi). */
  whileSleeping: (() => void) | null;
  sleep(ms: number): Promise<void>;
}

/** Pencereleri hem sürücüye hem okuyucuya tanıtır; ilki öndedir. */
export function scene(windows: WindowInfo[]): Scene {
  const input = createFakeInput();
  const uia = createFakeUia(input);
  uia.state.windows = windows;
  for (const window of windows) input.windows.set(window.hwnd, { minimized: window.minimized, maximized: window.maximized, rect: window.rect });
  input.state.foreground = windows[0]?.hwnd ?? null;
  input.state.cursor = { x: 600, y: 400 };
  const activity: ControlActivity[] = [];
  const approvals: Scene['approvals'] = [];
  const answers: boolean[] = [];
  const abort = new AbortController();
  const self: Scene = {
    input,
    uia,
    activity,
    approvals,
    answers,
    abort,
    whileSleeping: null,
    async sleep(ms) {
      input.advance(ms);
      self.whileSleeping?.();
    },
    control: undefined as unknown as Scene['control'],
    call: {
      signal: abort.signal,
      async approve(request) {
        approvals.push({ kind: request.kind, detail: request.detail });
        return answers.shift() ?? false;
      },
    },
    kinds: () => input.events.map((event: InputEvent) => event.type),
    text: () =>
      input.events
        .filter((event): event is Extract<InputEvent, { type: 'text' }> => event.type === 'text')
        .map((event) => event.text)
        .join(''),
  };
  self.control = createPcControl({ input, uia, sleep: (ms) => self.sleep(ms), onActivity: (event) => activity.push(event) });
  return self;
}
