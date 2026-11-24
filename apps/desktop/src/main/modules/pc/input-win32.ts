/**
 * GERÇEK fare/klavye sürücüsü (koffi + user32). Bu dosyadaki `send*`, `moveCursor`, `mouseButton`, `wheel`,
 * `activateWindow`, `showWindow`, `closeWindow` kullanıcının bilgisayarında gerçekten bir şey yapar: birim ve uçtan
 * uca sınamalar bunu YÜKLEMEZ (sahte sürücü: `input-fake.ts`). Gerçek sınama: `scripts/e2e/pc-control-real.mjs`.
 *
 * Yapılar ham arabellekle kurulur (koffi'de yapı adları süreç genelinde tektir; `core/presence-win32.ts` ile aynı
 * gerekçe). Yalnız x64 yerleşimi. Koordinatlar FİZİKSEL pikseldir: süreç ekran başına DPI farkındadır (Electron ana
 * süreci zaten öyledir; düz Node'da burada açılır), UIA yardımcısı da aynı kipte çalışır.
 */
import { VK } from './keys';
import type { InputDriver, MouseButton, Point, Rect } from './types';

const INPUT_SIZE = 40;
const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const KEYEVENTF_UNICODE = 0x4;
const MOUSEEVENTF_WHEEL = 0x800;
const MOUSEEVENTF_HWHEEL = 0x1000;
const WHEEL_DELTA = 120;
const SW_MAXIMIZE = 3;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const WM_CLOSE = 0x10;
const GA_ROOT = 2;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const MONITOR_DEFAULTTONEAREST = 2;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_LAYERED = 0x80000;
const GW_HWNDNEXT = 2;
/** Kendi ürettiğimiz girdinin işareti (`dwExtraInfo`): "FUB2". İleride kanca tabanlı ayrım gerekirse hazır. */
const EXTRA_INFO = 0x46554232n;

const BUTTON_FLAGS: Record<MouseButton, { down: number; up: number }> = {
  left: { down: 0x2, up: 0x4 },
  right: { down: 0x8, up: 0x10 },
  middle: { down: 0x20, up: 0x40 },
};

/** Genişletilmiş tuşlar: ok tuşları, gezinme kümesi, Windows tuşu, sağ değiştiriciler, medya tuşları. */
const EXTENDED = new Set<number>([
  VK.LEFT, VK.UP, VK.RIGHT, VK.DOWN, VK.INSERT, VK.DELETE, VK.HOME, VK.END, VK.PRIOR, VK.NEXT, VK.LWIN, VK.RWIN, VK.APPS, VK.RCONTROL, VK.RMENU, VK.SNAPSHOT,
  VK.VOLUME_MUTE, VK.VOLUME_DOWN, VK.VOLUME_UP, VK.MEDIA_NEXT, VK.MEDIA_PREV, VK.MEDIA_STOP, VK.MEDIA_PLAY_PAUSE,
]);

/** Gerçek sürücü + tanı amaçlı SALT OKUYAN ek: pencerenin görünmeyen kenar payı (ölçüm betiği bununla FFI imzalarını doğrular). */
export type Win32Input = InputDriver & { frameInset(hwnd: number): { left: number; top: number; right: number; bottom: number } };

export async function loadWin32Input(): Promise<Win32Input> {
  const koffi = (await import('koffi')).default;
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const std = '__stdcall';
  const P = 'void *';
  const H = 'uintptr_t';

  const SendInput = user32.func(std, 'SendInput', 'uint32', ['uint32', P, 'int']);
  const GetForegroundWindow = user32.func(std, 'GetForegroundWindow', H, []);
  const SetForegroundWindow = user32.func(std, 'SetForegroundWindow', 'bool', [H]);
  const BringWindowToTop = user32.func(std, 'BringWindowToTop', 'bool', [H]);
  const ShowWindow = user32.func(std, 'ShowWindow', 'bool', [H, 'int']);
  const IsWindow = user32.func(std, 'IsWindow', 'bool', [H]);
  const IsIconic = user32.func(std, 'IsIconic', 'bool', [H]);
  const IsZoomed = user32.func(std, 'IsZoomed', 'bool', [H]);
  const PostMessageW = user32.func(std, 'PostMessageW', 'bool', [H, 'uint32', 'uintptr_t', 'intptr_t']);
  const GetCursorPos = user32.func(std, 'GetCursorPos', 'bool', [P]);
  const SetCursorPos = user32.func(std, 'SetCursorPos', 'bool', ['int', 'int']);
  const GetAsyncKeyState = user32.func(std, 'GetAsyncKeyState', 'int16', ['int']);
  const GetWindowThreadProcessId = user32.func(std, 'GetWindowThreadProcessId', 'uint32', [H, P]);
  const AttachThreadInput = user32.func(std, 'AttachThreadInput', 'bool', ['uint32', 'uint32', 'bool']);
  // POINT değerle geçer: x64'te 8 baytlık yapı tek yazmaçta, düşük 32 bit x, yüksek 32 bit y.
  const WindowFromPoint = user32.func(std, 'WindowFromPoint', H, ['int64']);
  const GetAncestor = user32.func(std, 'GetAncestor', H, [H, 'uint32']);
  const GetWindow = user32.func(std, 'GetWindow', H, [H, 'uint32']);
  const GetWindowLongPtrW = user32.func(std, 'GetWindowLongPtrW', 'intptr_t', [H, 'int']);
  const IsWindowVisible = user32.func(std, 'IsWindowVisible', 'bool', [H]);
  const GetWindowRect = user32.func(std, 'GetWindowRect', 'bool', [H, P]);
  const VkKeyScanW = user32.func(std, 'VkKeyScanW', 'int16', ['uint16']);
  const MapVirtualKeyW = user32.func(std, 'MapVirtualKeyW', 'uint32', ['uint32', 'uint32']);
  const GetLastInputInfo = user32.func(std, 'GetLastInputInfo', 'bool', [P]);
  const SetProcessDpiAwarenessContext = user32.func(std, 'SetProcessDpiAwarenessContext', 'bool', ['intptr_t']);
  const SetWindowPos = user32.func(std, 'SetWindowPos', 'bool', [H, H, 'int', 'int', 'int', 'int', 'uint32']);
  const MonitorFromWindow = user32.func(std, 'MonitorFromWindow', H, [H, 'uint32']);
  const GetMonitorInfoW = user32.func(std, 'GetMonitorInfoW', 'bool', [H, P]);
  // Görünen çerçeve: Windows 10/11'de pencere dikdörtgeni görünmeyen yeniden boyutlandırma kenarlarını da kapsar.
  type DwmAttribute = (hwnd: number, attribute: number, buffer: Buffer, size: number) => number;
  const loadDwm = (): DwmAttribute | null => {
    try {
      return koffi.load('dwmapi.dll').func(std, 'DwmGetWindowAttribute', 'int32', [H, 'uint32', P, 'uint32']) as unknown as DwmAttribute;
    } catch {
      // dwmapi yoksa kenar düzeltmesi yapılmaz
      return null;
    }
  };
  const DwmGetWindowAttribute = loadDwm();
  const GetTickCount = kernel32.func(std, 'GetTickCount', 'uint32', []);
  const GetCurrentThreadId = kernel32.func(std, 'GetCurrentThreadId', 'uint32', []);

  // Ekran başına DPI farkındalığı (v2). Süreç zaten farkındaysa çağrı başarısız döner; zararsızdır.
  try {
    SetProcessDpiAwarenessContext(-4);
  } catch {
    // eski Windows: koordinatlar yine tutarlıdır (yardımcı da aynı kipe düşer)
  }

  /**
   * Girdi sisteme GERÇEKTEN girdi mi: SendInput eklenen olay sayısını döner. Sıfırsa (yükseltilmiş pencere, kilitli
   * oturum, başka bir yazılımın engeli) sessizce devam edilmez; araç "yapıldı" diyemesin diye fırlatılır.
   */
  const send = (count: number, buffer: Buffer) => {
    const inserted = SendInput(count, buffer, INPUT_SIZE) as number;
    if (inserted !== count) throw new Error('Windows girdiyi kabul etmedi (' + inserted + '/' + count + '); pencere yönetici yetkisiyle çalışıyor olabilir.');
  };

  const keyboardInput = (buffer: Buffer, index: number, vk: number, scan: number, flags: number) => {
    const at = index * INPUT_SIZE;
    buffer.writeUInt32LE(INPUT_KEYBOARD, at);
    buffer.writeUInt16LE(vk, at + 8);
    buffer.writeUInt16LE(scan, at + 10);
    buffer.writeUInt32LE(flags, at + 12);
    buffer.writeBigUInt64LE(EXTRA_INFO, at + 24);
  };

  const mouseInput = (flags: number, data = 0) => {
    const buffer = Buffer.alloc(INPUT_SIZE);
    buffer.writeUInt32LE(INPUT_MOUSE, 0);
    buffer.writeInt32LE(data, 16);
    buffer.writeUInt32LE(flags, 20);
    buffer.writeBigUInt64LE(EXTRA_INFO, 32);
    send(1, buffer);
  };

  const cursor = (): Point => {
    const buffer = Buffer.alloc(8);
    GetCursorPos(buffer);
    return { x: buffer.readInt32LE(0), y: buffer.readInt32LE(4) };
  };

  const foregroundWindow = (): number | null => Number(GetForegroundWindow()) || null;

  /**
   * Görünmeyen kenar payı: pencere dikdörtgeni ile görünen çerçevenin farkı (yoksa sıfır). Windows 10/11'de pencere
   * dikdörtgeni yeniden boyutlandırma kenarlarını da kapsar; yarım ekrana oturtulan pencere boşluk bırakmasın. Salt okur.
   */
  const frameInset = (hwnd: number) => {
    const inset = { left: 0, top: 0, right: 0, bottom: 0 };
    const outer = Buffer.alloc(16);
    const frame = Buffer.alloc(16);
    if (DwmGetWindowAttribute && GetWindowRect(hwnd, outer) && DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, frame, 16) === 0) {
      const clamp = (value: number) => Math.max(0, Math.min(20, value));
      inset.left = clamp(frame.readInt32LE(0) - outer.readInt32LE(0));
      inset.top = clamp(frame.readInt32LE(4) - outer.readInt32LE(4));
      inset.right = clamp(outer.readInt32LE(8) - frame.readInt32LE(8));
      inset.bottom = clamp(outer.readInt32LE(12) - frame.readInt32LE(12));
    }
    return inset;
  };

  /**
   * Tıklamayı geçiren katman penceresi (WS_EX_LAYERED + WS_EX_TRANSPARENT): bizim ekran katmanımız ("Jarvis bilgisayarı
   * kullanıyor") ve başka uygulamaların benzer örtüleri. Fare olayı bunların ALTINDAKİ pencereye gider.
   */
  const passThrough = (hwnd: number): boolean => {
    const style = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    return (style & WS_EX_TRANSPARENT) !== 0 && (style & WS_EX_LAYERED) !== 0;
  };
  const cloaked = (hwnd: number): boolean => {
    if (!DwmGetWindowAttribute) return false;
    const value = Buffer.alloc(4);
    return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, value, 4) === 0 && value.readInt32LE(0) !== 0;
  };
  const covers = (hwnd: number, x: number, y: number): boolean => {
    const rect = Buffer.alloc(16);
    if (!GetWindowRect(hwnd, rect)) return false;
    return x >= rect.readInt32LE(0) && y >= rect.readInt32LE(4) && x < rect.readInt32LE(8) && y < rect.readInt32LE(12);
  };

  return {
    foregroundWindow,
    frameInset,

    windowAt(point) {
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      const packed = BigInt.asIntN(64, (BigInt(y) << 32n) | (BigInt(x) & 0xffffffffn));
      const hwnd = Number(WindowFromPoint(packed));
      if (!hwnd) return null;
      let root = Number(GetAncestor(hwnd, GA_ROOT)) || hwnd;
      // Windows tıklamayı geçiren katmanı çoğunlukla zaten atlar; atlamadığı durumda (ekran katmanımız en üstte ve tam
      // ekrandır) "tıklanacak noktanın üstünde başka pencere var" diye durmamak için z-sırasında altına bakılır.
      for (let guard = 0; guard < 8 && passThrough(root); guard++) {
        let below = Number(GetWindow(root, GW_HWNDNEXT));
        for (let steps = 0; below && steps < 400; steps++) {
          if (IsWindowVisible(below) && !IsIconic(below) && !cloaked(below) && covers(below, x, y) && !passThrough(below)) break;
          below = Number(GetWindow(below, GW_HWNDNEXT));
        }
        if (!below) return null;
        root = Number(GetAncestor(below, GA_ROOT)) || below;
      }
      return root;
    },

    windowState(hwnd) {
      if (!IsWindow(hwnd)) return { exists: false, minimized: false, maximized: false, rect: null };
      const buffer = Buffer.alloc(16);
      const rect: Rect | null = GetWindowRect(hwnd, buffer)
        ? { left: buffer.readInt32LE(0), top: buffer.readInt32LE(4), right: buffer.readInt32LE(8), bottom: buffer.readInt32LE(12) }
        : null;
      return { exists: true, minimized: !!IsIconic(hwnd), maximized: !!IsZoomed(hwnd), rect };
    },

    activateWindow(hwnd) {
      if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
      const foreground = Number(GetForegroundWindow());
      if (foreground === hwnd) return;
      // Windows arka plandaki sürecin pencere öne getirmesini kısıtlar; öndeki pencerenin iş parçacığına bağlanınca izin verir.
      const me = GetCurrentThreadId() as number;
      const other = foreground ? (GetWindowThreadProcessId(foreground, null) as number) : 0;
      const attached = other !== 0 && other !== me && !!AttachThreadInput(me, other, true);
      try {
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
      } finally {
        if (attached) AttachThreadInput(me, other, false);
      }
    },

    showWindow(hwnd, action) {
      ShowWindow(hwnd, action === 'minimize' ? SW_MINIMIZE : action === 'maximize' ? SW_MAXIMIZE : SW_RESTORE);
    },

    closeWindow(hwnd) {
      PostMessageW(hwnd, WM_CLOSE, 0, 0);
    },

    setWindowRect(hwnd, rect) {
      // Büyütülmüş ya da simge durumundaki pencere önce olağan haline döner; yoksa konum bir sonraki geri yüklemeye kadar görünmez.
      if (IsIconic(hwnd) || IsZoomed(hwnd)) ShowWindow(hwnd, SW_RESTORE);
      const inset = frameInset(hwnd);
      const left = Math.round(rect.left) - inset.left;
      const top = Math.round(rect.top) - inset.top;
      const width = Math.round(rect.right - rect.left) + inset.left + inset.right;
      const height = Math.round(rect.bottom - rect.top) + inset.top + inset.bottom;
      SetWindowPos(hwnd, 0, left, top, width, height, SWP_NOZORDER | SWP_NOACTIVATE);
    },

    monitorOf(hwnd) {
      if (!IsWindow(hwnd)) return null;
      const monitor = Number(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST));
      if (!monitor) return null;
      // MONITORINFO: cbSize(4) rcMonitor(16) rcWork(16) dwFlags(4) = 40 bayt.
      const info = Buffer.alloc(40);
      info.writeUInt32LE(40, 0);
      if (!GetMonitorInfoW(monitor, info)) return null;
      const read = (at: number): Rect => ({ left: info.readInt32LE(at), top: info.readInt32LE(at + 4), right: info.readInt32LE(at + 8), bottom: info.readInt32LE(at + 12) });
      return { full: read(4), work: read(20) };
    },

    sendText(text) {
      const units = text.length;
      if (units === 0) return;
      const buffer = Buffer.alloc(INPUT_SIZE * units * 2);
      for (let i = 0; i < units; i++) {
        const unit = text.charCodeAt(i);
        keyboardInput(buffer, i * 2, 0, unit, KEYEVENTF_UNICODE);
        keyboardInput(buffer, i * 2 + 1, 0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
      }
      send(units * 2, buffer);
    },

    sendKeys(events) {
      if (events.length === 0) return;
      const buffer = Buffer.alloc(INPUT_SIZE * events.length);
      events.forEach((event, index) => {
        const flags = (event.down ? 0 : KEYEVENTF_KEYUP) | (EXTENDED.has(event.vk) ? KEYEVENTF_EXTENDEDKEY : 0);
        keyboardInput(buffer, index, event.vk, MapVirtualKeyW(event.vk, 0) as number, flags);
      });
      try {
        send(events.length, buffer);
      } catch (error) {
        // Dizi yarıda kaldıysa değiştirici tuş basılı kalmasın: basılan her tuş için bırakma olayı ayrıca gönderilir.
        for (const event of events.filter((item) => item.down)) {
          const up = Buffer.alloc(INPUT_SIZE);
          keyboardInput(up, 0, event.vk, MapVirtualKeyW(event.vk, 0) as number, KEYEVENTF_KEYUP | (EXTENDED.has(event.vk) ? KEYEVENTF_EXTENDEDKEY : 0));
          SendInput(1, up, INPUT_SIZE);
        }
        throw error;
      }
    },

    keyForChar(char) {
      const result = VkKeyScanW(char.charCodeAt(0)) as number;
      if (result === -1) return null;
      const state = (result >> 8) & 0xff;
      // Ctrl ya da Alt gerektiren karakter (AltGr) kısayol tuşu olarak kullanılamaz.
      if (state & 0x6) return null;
      return { vk: result & 0xff, shift: (state & 1) === 1 };
    },

    cursor,

    moveCursor(point) {
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      SetCursorPos(x, y);
      // Ölçeği farklı ekrana geçişte ilk çağrı yanlış yere düşebiliyor; ikinci çağrı düzeltir.
      const now = cursor();
      if (now.x !== x || now.y !== y) SetCursorPos(x, y);
    },

    mouseButton(button, down) {
      const flags = BUTTON_FLAGS[button];
      mouseInput(down ? flags.down : flags.up);
    },

    wheel(notches, horizontal = false) {
      mouseInput(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, Math.round(notches * WHEEL_DELTA));
    },

    downKeys() {
      const down: number[] = [];
      for (let vk = 1; vk < 0xff; vk++) {
        if (vk === VK.PACKET) continue;
        if ((GetAsyncKeyState(vk) as number) & 0x8000) down.push(vk);
      }
      return down;
    },

    lastInputTick() {
      const info = Buffer.alloc(8);
      info.writeUInt32LE(8, 0);
      return GetLastInputInfo(info) ? info.readUInt32LE(4) : 0;
    },

    tick: () => GetTickCount() as number,
  };
}
