// UI Automation yardımcı sürecinin istemcisi. Yardımcı (`resources/pc/uia-helper.ps1`) kalıcıdır: soğuk başlatma
// (~1,5 sn, C# derlemesi) bir kez ödenir, sonraki istekler satır başına bir JSON ile milisaniyeler sürer.
// Bu dosya Electron'a bağlı değildir (ölçüm ve gerçek girdi betikleri düz Node'da koşar).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import type { BrowserWindowInfo, DocumentText, ElementAt, FocusedInfo, FoundElement, ReadResult, Rect, SurveyItem, SurveyResult, UiaNode, UiaProvider, WindowInfo, WindowList } from './types';

export interface UiaHelperOptions {
  /** `uia-helper.ps1` dosyasının tam yolu. */
  script: string;
  /** Kendi pencerelerimizi işaretlemek için ana sürecin kimliği. */
  ownerPid?: number;
  log?: { warn(message: string, data?: unknown): void; info(message: string, data?: unknown): void };
  /** İlk "hazır" satırı için süre (C# derlemesi dahil). */
  startTimeoutMs?: number;
}

type Raw = Record<string, unknown>;

interface Pending {
  resolve(value: Raw): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** Yardımcı yanıt vermezse (asılı bir uygulamaya takılmış olabilir) süreç öldürülür; sonraki istek yenisini başlatır. */
const REQUEST_SLACK_MS = 1500;

const rect = (value: unknown): Rect => {
  const [left = 0, top = 0, right = 0, bottom = 0] = Array.isArray(value) ? (value as number[]) : [];
  return { left, top, right, bottom };
};

function toWindow(raw: Raw): WindowInfo {
  return {
    hwnd: Number(raw.hwnd),
    title: String(raw.title ?? ''),
    exe: String(raw.exe ?? ''),
    app: String(raw.app ?? ''),
    path: String(raw.path ?? ''),
    pid: Number(raw.pid ?? 0),
    minimized: raw.minimized === true,
    maximized: raw.maximized === true,
    focused: raw.focused === true,
    own: raw.own === true,
    className: String(raw.className ?? ''),
    rect: rect(raw.rect),
    ...(raw.shell === true ? { shell: true } : {}),
  };
}

export function createUiaHelper(options: UiaHelperOptions): UiaProvider {
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 1;
  let stopped = false;
  const pending = new Map<number, Pending>();

  const failAll = (error: Error) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      pending.delete(id);
    }
  };

  const kill = (reason: string) => {
    const current = child;
    child = null;
    ready = null;
    if (current) {
      try {
        current.kill();
      } catch {
        // zaten çıkmış
      }
    }
    failAll(new Error(reason));
  };

  const start = (): Promise<void> => {
    if (ready) return ready;
    ready = new Promise<void>((resolve, reject) => {
      // PATH'teki sahte bir powershell.exe'ye güvenilmez: sistem klasöründeki çağrılır.
      const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const proc = spawn(
        powershell,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', options.script, '-OwnerPid', String(options.ownerPid ?? 0)],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      child = proc;
      let stderr = '';
      let greeted = false;
      const timer = setTimeout(() => {
        if (!greeted) {
          kill('uia yardımcısı zamanında başlamadı');
          reject(new Error('uia yardımcısı zamanında başlamadı'));
        }
      }, options.startTimeoutMs ?? 20_000);
      proc.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 2000) stderr += chunk.toString('utf8');
      });
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        let message: Raw;
        try {
          message = JSON.parse(line) as Raw;
        } catch {
          return;
        }
        if (message.hello === true) {
          greeted = true;
          clearTimeout(timer);
          options.log?.info(`uia yardımcısı hazır (${String(message.ms)} ms, dpi: ${String(message.dpiAware)})`);
          resolve();
          return;
        }
        const entry = pending.get(Number(message.id));
        if (!entry) return;
        pending.delete(Number(message.id));
        clearTimeout(entry.timer);
        if (message.ok === false) entry.reject(new Error(String(message.error ?? 'uia hatası')));
        else entry.resolve(message);
      });
      const gone = (why: string) => {
        clearTimeout(timer);
        if (child === proc) {
          child = null;
          ready = null;
        }
        const detail = stderr.trim().split('\n')[0] ?? '';
        if (!greeted) reject(new Error(`uia yardımcısı başlatılamadı: ${why}${detail ? ` (${detail})` : ''}`));
        failAll(new Error(`uia yardımcısı kapandı: ${why}`));
        if (!stopped && why !== 'durduruldu') options.log?.warn(`uia yardımcısı kapandı: ${why}`, detail);
      };
      proc.on('error', (error) => gone(error.message));
      proc.on('exit', (code) => gone(`çıkış ${String(code)}`));
      // Kapalı boruya yazım (yardımcı öldüyse) süreci düşürmesin.
      proc.stdin.on('error', () => {});
    });
    // Başlatma hatası bir sonraki istekte yeniden denensin.
    ready.catch(() => {
      ready = null;
    });
    return ready;
  };

  const call = async (op: string, params: Raw, hardMs: number): Promise<Raw> => {
    if (stopped) throw new Error('uia yardımcısı durduruldu');
    await start();
    const proc = child;
    if (!proc) throw new Error('uia yardımcısı çalışmıyor');
    return new Promise<Raw>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error('uia yardımcısı yanıt vermedi'));
        kill('yanıt vermedi');
      }, hardMs + REQUEST_SLACK_MS);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ id, op, hardMs, ...params })}\n`);
    });
  };

  /**
   * Chromium/Electron penceresi bu çağrıda "uyandırıldıysa" (`woke`) ve sonuç boş/cılızsa sayfa ağacı henüz yayınlanmamış
   * olabilir: kısa aralıkla en çok iki kez yeniden sorulur. Uyanmış pencerede ek maliyeti yoktur.
   */
  const callAwake = async (op: string, params: Raw, hardMs: number, thin: (raw: Raw) => boolean): Promise<Raw> => {
    let raw = await call(op, params, hardMs);
    for (let attempt = 0; attempt < 2 && typeof raw.woke === 'number' && thin(raw); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const again = await call(op, params, hardMs);
      raw = { ...again, woke: thin(again) ? raw.woke : undefined };
    }
    return raw;
  };
  const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

  return {
    async windows(): Promise<WindowList> {
      const raw = await call('windows', {}, 1500);
      const windows = ((raw.windows as Raw[] | undefined) ?? []).map(toWindow);
      const listed = windows.find((window) => window.focused) ?? null;
      const extra = raw.foregroundWindow ? toWindow(raw.foregroundWindow as Raw) : null;
      return { windows, foreground: listed ?? extra, locked: raw.locked === true };
    },

    async read(hwnd, opts = {}): Promise<ReadResult> {
      const budgetMs = opts.budgetMs ?? 400;
      const raw = await callAwake('read', { hwnd, maxNodes: opts.maxNodes ?? 600, budgetMs, maxText: opts.maxText ?? 4000 }, budgetMs + 1800, (res) => count(res.nodes) < 20);
      const nodes = ((raw.nodes as Raw[] | undefined) ?? []).map((node): UiaNode => ({
        depth: Number(node.d ?? 0),
        role: String(node.r ?? ''),
        name: String(node.n ?? ''),
        ...(typeof node.v === 'string' && node.pw !== true ? { value: node.v } : {}),
        ...(typeof node.f === 'string' ? { flags: node.f } : {}),
        ...(node.pw === true ? { password: true } : {}),
      }));
      return { nodes, truncated: raw.truncated === true };
    },

    async focused(): Promise<FocusedInfo> {
      const raw = await call('focused', { maxText: 2000 }, 1500);
      const password = raw.password === true;
      return {
        hwnd: raw.hwnd === null || raw.hwnd === undefined ? null : Number(raw.hwnd),
        known: raw.known === true,
        role: String(raw.role ?? ''),
        name: String(raw.name ?? ''),
        className: String(raw.className ?? ''),
        password,
        editable: raw.editable === true,
        value: !password && typeof raw.value === 'string' ? raw.value : null,
        rect: Array.isArray(raw.rect) ? rect(raw.rect) : null,
      };
    },

    async survey(hwnd, opts = {}): Promise<SurveyResult> {
      const budgetMs = opts.budgetMs ?? 250;
      // Chromium penceresinde ilk çağrı sayfa ağacını uyandırır (en çok ~0,7 sn bekler): süre payı ona göre.
      const raw = await callAwake('survey', { hwnd, max: opts.max ?? 40, budgetMs }, budgetMs + 1800, (res) => count(res.items) < 6);
      const items = ((raw.items as Raw[] | undefined) ?? []).map((item): SurveyItem => ({
        role: String(item.r ?? ''),
        name: String(item.n ?? ''),
        ...(typeof item.f === 'string' ? { flags: item.f } : {}),
        ...(item.pw === true ? { password: true } : {}),
      }));
      return { items, more: Number(raw.more ?? 0), truncated: raw.truncated === true };
    },

    async at(point): Promise<ElementAt> {
      const raw = await call('at', { x: Math.round(point.x), y: Math.round(point.y) }, 1500);
      return {
        known: raw.known === true,
        role: String(raw.role ?? ''),
        name: String(raw.name ?? ''),
        className: String(raw.className ?? ''),
        password: raw.password === true,
        parentRole: String(raw.parentRole ?? ''),
        parentName: String(raw.parentName ?? ''),
      };
    },

    async find(hwnd, query) {
      const raw = await callAwake('find', { hwnd, terms: query.terms, role: query.role ?? '', max: query.max ?? 6, budgetMs: 1500 }, 3500, (res) => count(res.matches) === 0);
      const matches = ((raw.matches as Raw[] | undefined) ?? [])
        .filter((item) => item.stale !== true)
        .map((item): FoundElement => {
          const point = Array.isArray(item.point) ? (item.point as number[]) : null;
          return {
            ref: Number(item.ref),
            role: String(item.role ?? ''),
            name: String(item.name ?? ''),
            score: Number(item.score ?? 0),
            rect: Array.isArray(item.rect) ? rect(item.rect) : null,
            point: point ? { x: point[0] ?? 0, y: point[1] ?? 0 } : null,
            onscreen: item.onscreen === true,
            enabled: item.enabled !== false,
            password: item.password === true,
            patterns: Array.isArray(item.patterns) ? (item.patterns as string[]) : [],
          };
        });
      return { matches, total: Number(raw.total ?? matches.length) };
    },

    async invoke(ref) {
      try {
        const raw = await call('invoke', { ref }, 2500);
        return { ok: true, pattern: String(raw.pattern ?? '') };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async browsers(): Promise<BrowserWindowInfo[]> {
      const raw = await call('browsers', { budgetMs: 700 }, 6000);
      return ((raw.browsers as Raw[] | undefined) ?? []).map((item) => ({
        ...toWindow(item),
        tabs: ((item.tabs as Raw[] | undefined) ?? []).map((tab) => ({ title: String(tab.title ?? ''), active: tab.active === true })),
        url: typeof item.url === 'string' && item.url.trim() ? item.url.trim() : null,
      }));
    },

    async document(hwnd, opts = {}): Promise<DocumentText> {
      const raw = await call('document', { hwnd, maxChars: opts.maxChars ?? 8000, budgetMs: 1200 }, 3000);
      const method = raw.method === 'text' || raw.method === 'tree' ? raw.method : 'none';
      return { found: raw.found === true, method, text: String(raw.text ?? ''), truncated: raw.truncated === true };
    },

    warm() {
      if (stopped) return;
      void start().catch((error: unknown) => options.log?.warn('uia yardımcısı başlatılamadı', error));
    },

    stop() {
      stopped = true;
      kill('durduruldu');
    },
  };
}
