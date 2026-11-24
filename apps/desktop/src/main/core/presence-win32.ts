/**
 * Varlık algısının Windows ölçümleri (koffi; yerel derleme gerekmez). Yapılar ham arabellekle okunur:
 * koffi'de yapı adları süreç genelinde tektir ve aynı süreçteki başka bir kullanıcıyla çakışmasın diye
 * burada adlı tip tanımlanmaz. Yalnız x64 yerleşimi varsayılır (uygulama yalnız x64 paketlenir).
 */

const QUNS = {
  notPresent: 1,
  busy: 2,
  d3dFullScreen: 3,
  presentation: 4,
  acceptsNotifications: 5,
  quietTime: 6,
  app: 7,
} as const;
export { QUNS };

export interface ForegroundInfo {
  /** Pencere tutamacı (sayı olarak); ön pencere yoksa `null`. */
  hwnd: number | null;
  className: string;
  /** Pencerenin sahibi süreç. */
  pid: number;
  rect: { left: number; top: number; right: number; bottom: number } | null;
  monitor: { left: number; top: number; right: number; bottom: number } | null;
  /** `WS_CAPTION` taşıyor mu (başlıklı sıradan pencere). */
  captioned: boolean;
  /** Pencere, bulunduğu monitörün tamamını kaplıyor ve başlıksız: tam ekran oyun/video/sunum. */
  fullscreen: boolean;
}

export interface Win32Probe {
  /** `SHQueryUserNotificationState`; çağrı başarısızsa `null`. */
  notificationState(): number | null;
  foreground(): ForegroundInfo;
  /** Son klavye/fare girdisinden bu yana geçen süre. */
  idleSeconds(): number;
  /**
   * Kamerayı/mikrofonu ŞU AN kullanan uygulamalar (`ConsentStore` içinde `LastUsedTimeStop == 0`).
   * Paketli uygulamalarda paket adı, diğerlerinde exe yolu (`\` ayraçlı) döner. Çökmüş bir uygulamanın
   * geride bıraktığı kayıt sayılmasın diye exe'si çalışmayan kayıtlar atlanır.
   */
  mediaUsers(kind: 'webcam' | 'microphone'): string[];
}

const HKEY_CURRENT_USER = 0xffffffff80000001n;
const KEY_READ = 0x20019;
const RRF_RT_REG_QWORD = 0x40;
const ERROR_SUCCESS = 0;
const WS_CAPTION = 0x00c00000;
const GWL_STYLE = -16;
const MONITOR_DEFAULTTONEAREST = 2;
const TH32CS_SNAPPROCESS = 2;
const PROCESSENTRY32W_SIZE = 568;
const PROCESSENTRY32W_EXE_OFFSET = 44;
const CONSENT_STORE = 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';
// Masaüstü ve kabuk pencereleri (kilit ekranı, Başlat, arama: üst düzey `CoreWindow`) monitörü kaplar ama
// "tam ekran uygulama" değildir. Mağaza uygulamalarının tam ekranı `ApplicationFrameWindow` içinde durur.
const SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'XamlExplorerHostIslandWindow',
  'LockScreenBackstopFrame',
  'Windows.UI.Core.CoreWindow',
]);

const utf16 = (buffer: Buffer, chars?: number) => {
  const text = buffer.toString('utf16le', 0, chars === undefined ? buffer.length : chars * 2);
  const end = text.indexOf('\0');
  return end === -1 ? text : text.slice(0, end);
};

const readRect = (buffer: Buffer, offset: number) => ({
  left: buffer.readInt32LE(offset),
  top: buffer.readInt32LE(offset + 4),
  right: buffer.readInt32LE(offset + 8),
  bottom: buffer.readInt32LE(offset + 12),
});

/** koffi'yi ve gereken sistem kitaplıklarını yükler. Yüklenemezse fırlatır; çağıran ölçümsüz devam eder. */
export async function loadWin32Probe(): Promise<Win32Probe> {
  const koffi = (await import('koffi')).default;
  const user32 = koffi.load('user32.dll');
  const shell32 = koffi.load('shell32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  const std = '__stdcall';
  const P = 'void *';
  const H = 'uintptr_t';

  const SHQueryUserNotificationState = shell32.func(std, 'SHQueryUserNotificationState', 'long', [P]);
  const GetForegroundWindow = user32.func(std, 'GetForegroundWindow', H, []);
  const GetWindowRect = user32.func(std, 'GetWindowRect', 'bool', [H, P]);
  const MonitorFromWindow = user32.func(std, 'MonitorFromWindow', H, [H, 'uint32']);
  const GetMonitorInfoW = user32.func(std, 'GetMonitorInfoW', 'bool', [H, P]);
  const GetWindowLongW = user32.func(std, 'GetWindowLongW', 'long', [H, 'int']);
  const GetClassNameW = user32.func(std, 'GetClassNameW', 'int', [H, P, 'int']);
  const GetWindowThreadProcessId = user32.func(std, 'GetWindowThreadProcessId', 'uint32', [H, P]);
  const GetLastInputInfo = user32.func(std, 'GetLastInputInfo', 'bool', [P]);
  const GetTickCount = kernel32.func(std, 'GetTickCount', 'uint32', []);
  const CreateToolhelp32Snapshot = kernel32.func(std, 'CreateToolhelp32Snapshot', H, ['uint32', 'uint32']);
  const Process32FirstW = kernel32.func(std, 'Process32FirstW', 'bool', [H, P]);
  const Process32NextW = kernel32.func(std, 'Process32NextW', 'bool', [H, P]);
  const CloseHandle = kernel32.func(std, 'CloseHandle', 'bool', [H]);
  const RegOpenKeyExW = advapi32.func(std, 'RegOpenKeyExW', 'long', [H, 'str16', 'uint32', 'uint32', P]);
  const RegEnumKeyExW = advapi32.func(std, 'RegEnumKeyExW', 'long', [H, 'uint32', P, P, P, P, P, P]);
  const RegGetValueW = advapi32.func(std, 'RegGetValueW', 'long', [H, 'str16', 'str16', 'uint32', P, P, P]);
  const RegCloseKey = advapi32.func(std, 'RegCloseKey', 'long', [H]);

  const openKey = (parent: bigint, subKey: string): bigint | null => {
    const out = Buffer.alloc(8);
    return RegOpenKeyExW(parent, subKey, 0, KEY_READ, out) === ERROR_SUCCESS ? out.readBigUInt64LE(0) : null;
  };

  const subKeys = (key: bigint): string[] => {
    const names: string[] = [];
    const name = Buffer.alloc(1024);
    const length = Buffer.alloc(4);
    for (let index = 0; index < 4096; index++) {
      length.writeUInt32LE(name.length / 2, 0);
      if (RegEnumKeyExW(key, index, name, length, null, null, null, null) !== ERROR_SUCCESS) break;
      names.push(utf16(name, length.readUInt32LE(0)));
    }
    return names;
  };

  const qword = (key: bigint, subKey: string, value: string): bigint | null => {
    const data = Buffer.alloc(8);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(8, 0);
    return RegGetValueW(key, subKey, value, RRF_RT_REG_QWORD, null, data, size) === ERROR_SUCCESS ? data.readBigUInt64LE(0) : null;
  };

  /** Bu anahtarın altında "şu an kullanılıyor" görünen alt anahtar adları. */
  const inUse = (key: bigint): string[] =>
    subKeys(key).filter((name) => {
      const start = qword(key, name, 'LastUsedTimeStart');
      return start !== null && start !== 0n && qword(key, name, 'LastUsedTimeStop') === 0n;
    });

  const runningExeNames = (): Set<string> => {
    const names = new Set<string>();
    const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) as number | bigint;
    if (BigInt(snapshot) === 0xffffffffffffffffn) return names;
    try {
      const entry = Buffer.alloc(PROCESSENTRY32W_SIZE);
      entry.writeUInt32LE(PROCESSENTRY32W_SIZE, 0);
      let more = Process32FirstW(snapshot, entry) as boolean;
      while (more) {
        names.add(utf16(entry.subarray(PROCESSENTRY32W_EXE_OFFSET)).toLowerCase());
        more = Process32NextW(snapshot, entry) as boolean;
      }
    } finally {
      CloseHandle(snapshot);
    }
    return names;
  };

  return {
    notificationState() {
      const out = Buffer.alloc(4);
      return SHQueryUserNotificationState(out) === 0 ? out.readInt32LE(0) : null;
    },

    foreground() {
      const none: ForegroundInfo = { hwnd: null, className: '', pid: 0, rect: null, monitor: null, captioned: false, fullscreen: false };
      const hwnd = Number(GetForegroundWindow());
      if (!hwnd) return none;
      const classBuffer = Buffer.alloc(512);
      const className = utf16(classBuffer, GetClassNameW(hwnd, classBuffer, 256) as number);
      const pidBuffer = Buffer.alloc(4);
      GetWindowThreadProcessId(hwnd, pidBuffer);
      const pid = pidBuffer.readUInt32LE(0);
      const rectBuffer = Buffer.alloc(16);
      const monitorInfo = Buffer.alloc(40);
      monitorInfo.writeUInt32LE(40, 0);
      const monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) as number | bigint;
      if (!GetWindowRect(hwnd, rectBuffer) || !monitor || !GetMonitorInfoW(monitor, monitorInfo)) {
        return { ...none, hwnd, className, pid };
      }
      const rect = readRect(rectBuffer, 0);
      const bounds = readRect(monitorInfo, 4);
      const captioned = ((GetWindowLongW(hwnd, GWL_STYLE) as number) & WS_CAPTION) === WS_CAPTION;
      const covers = rect.left <= bounds.left && rect.top <= bounds.top && rect.right >= bounds.right && rect.bottom >= bounds.bottom;
      // Büyütülmüş başlıklı pencere (görev çubuğu gizliyken monitörü kaplasa da) tam ekran sayılmaz.
      const fullscreen = covers && !captioned && !SHELL_CLASSES.has(className);
      return { hwnd, className, pid, rect, monitor: bounds, captioned, fullscreen };
    },

    idleSeconds() {
      const info = Buffer.alloc(8);
      info.writeUInt32LE(8, 0);
      if (!GetLastInputInfo(info)) return 0;
      // İkisi de 32 bit milisaniye sayacıdır; fark 49 günde bir taşmaya dayanıklı alınır.
      return (((GetTickCount() as number) - info.readUInt32LE(4)) >>> 0) / 1000;
    },

    mediaUsers(kind) {
      const users: string[] = [];
      const root = openKey(HKEY_CURRENT_USER, `${CONSENT_STORE}\\${kind}`);
      if (root === null) return users;
      try {
        users.push(...inUse(root).filter((name) => name !== 'NonPackaged'));
        const nonPackaged = openKey(root, 'NonPackaged');
        if (nonPackaged !== null) {
          try {
            const candidates = inUse(nonPackaged).map((name) => name.replaceAll('#', '\\'));
            if (candidates.length > 0) {
              const alive = runningExeNames();
              users.push(...candidates.filter((exe) => alive.has(exe.slice(exe.lastIndexOf('\\') + 1).toLowerCase())));
            }
          } finally {
            RegCloseKey(nonPackaged);
          }
        }
      } finally {
        RegCloseKey(root);
      }
      return users;
    },
  };
}
