/**
 * Dosya erişim kapısı. Okuma yalnız izinli klasörlerde (kullanıcının Ayarlar'da yönettiği liste + başka modüllerin izin
 * verdiği klasörler + Belgeler/Masaüstü/İndirilenler varsayılanı) serbesttir; dışı kullanıcı onayı ister. Yazma yalnız
 * kullanıcının seçtiği çıktı klasörüne yapılır. Sistem klasörleri, uygulama verisi (AppData), `.ssh` gibi gizli
 * anahtar klasörleri, tarayıcı profilleri ve parola/anahtar dosyaları onayla da AÇILMAZ.
 *
 * Kapı önce yazıya bakar (ağ yolu, aygıt yolu, alternatif veri akışı, sondaki nokta/boşluk, göreli yol), sonra
 * `..` çözülmüş yola, sonra dosya sisteminin GERÇEK yoluna (`realpath.native`: sembolik bağ, bağlantı noktası ve
 * 8.3 kısa ad çözülür). Karar gerçek yola göre verilir: Masaüstündeki bir bağ `C:\Windows`'a gidiyorsa engellenir.
 * v1'de izinli klasör listesi kodda sabitti (`iceaktar.ts` › `izinliKokler`); burada yapılandırmadan gelir.
 */
import fs from 'node:fs';
import nodePath from 'node:path';

export interface AccessConfig {
  platform: NodeJS.Platform;
  /** Kullanıcı profili (`C:\Users\ad`). */
  home: string;
  /** Okumanın serbest olduğu klasörler. */
  readRoots(): string[];
  /** Ek engelli kökler (uygulamanın kendi veri klasörü). */
  extraBlocked?: string[];
  /** Ortam değişkenleri (sistem klasörlerini bulmak için). */
  env?: Record<string, string | undefined>;
}

export type AccessDecision =
  | { kind: 'allow'; path: string }
  /** İzinli klasör dışında: kullanıcı onaylarsa okunur. */
  | { kind: 'ask'; path: string }
  | { kind: 'deny'; reason: string };

const lib = (platform: NodeJS.Platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix);
const norm = (value: string, platform: NodeJS.Platform) => {
  const resolved = lib(platform).resolve(value).replace(/[\\/]+$/, '');
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** `child` `root`un kendisi ya da içinde mi (ayırıcı sınırında: "Desktop" kökü "DesktopEski"yi kapsamaz). */
export function isInside(child: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  const c = norm(child, platform);
  const r = norm(root, platform);
  if (!r) return false;
  const sep = lib(platform).sep;
  // Sürücü kökü ("c:") ayırıcıyla biter: "c:\" + "x".
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** Yolun herhangi bir bileşeni bu adlardan biriyse engellenir (büyük/küçük harf duyarsız). */
const BLOCKED_COMPONENTS = new Set([
  '.ssh',
  '.gnupg',
  '.gpg',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.claude',
  '.codex',
  '.config',
  '.password-store',
  '.mozilla',
  '.thunderbird',
  '.vault-token',
  'appdata',
  '$recycle.bin',
  'system volume information',
  'windowsapps',
]);

/** Ardışık bileşenler: tarayıcı profilleri (AppData dışına taşınmış olsa bile). */
const BLOCKED_SEQUENCES: string[][] = [
  ['user data'],
  ['firefox', 'profiles'],
  ['thunderbird', 'profiles'],
  ['microsoft', 'credentials'],
  ['microsoft', 'protect'],
];

/** Parola, anahtar, sertifika ve oturum dosyaları: adına ya da uzantısına göre. */
const BLOCKED_EXTENSIONS = new Set(['pem', 'key', 'pfx', 'p12', 'p8', 'jks', 'keystore', 'kdbx', 'kdb', 'ppk', 'gpg', 'pgp', 'ovpn', 'wallet', 'cer', 'crt', 'der', 'sqlite', 'db', 'ldb']);
const BLOCKED_NAMES = /^(id_(rsa|dsa|ecdsa|ed25519)\b.*|known_hosts|authorized_keys|\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|\.gitconfig|credentials(\.json)?|wallet\.dat|login data|cookies|web data|key[34]\.db|logins\.json|ntuser\.dat.*|local state)$/i;
const SECRET_WORDS = /(^|[^\p{L}])(passwords?|passwd|parolalar?|parolam|şifreler|sifreler|şifrelerim|sifrelerim|şifrem|sifrem|secrets?|private[ _-]?key|recovery[ _-]?codes?|kurtarma[ _-]?kod)/iu;

/** Yalnız dosya adına bakan engel (yolu bilinmeyen sürüklenmiş dosya için). */
export function blockedName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (BLOCKED_NAMES.test(base) || BLOCKED_EXTENSIONS.has(extension) || SECRET_WORDS.test(base)) {
    return 'parola, anahtar ya da oturum dosyası gibi görünüyor (güvenlik için okunmaz)';
  }
  return null;
}

export function blockedReason(target: string, config: AccessConfig): string | null {
  const { platform } = config;
  const p = lib(platform);
  const lower = platform === 'win32' ? target.toLowerCase() : target;
  const components = lower.split(/[\\/]+/).filter(Boolean);
  for (const component of components) {
    if (BLOCKED_COMPONENTS.has(component)) return 'sistem ya da uygulama verisi klasörü (güvenlik için açılmaz)';
  }
  for (const sequence of BLOCKED_SEQUENCES) {
    for (let i = 0; i + sequence.length <= components.length; i++) {
      if (sequence.every((part, k) => components[i + k] === part)) return 'tarayıcı profili ya da kimlik bilgisi klasörü (güvenlik için açılmaz)';
    }
  }
  for (const root of systemRoots(config)) {
    if (isInside(target, root, platform)) return 'sistem klasörü (güvenlik için açılmaz)';
  }
  return blockedName(p.basename(target));
}

function systemRoots(config: AccessConfig): string[] {
  const env = config.env ?? process.env;
  if (config.platform !== 'win32') return ['/etc', '/proc', '/sys', '/dev', '/boot', '/root', '/var/lib', ...(config.extraBlocked ?? [])];
  const drive = (env.SystemDrive ?? 'C:').replace(/[\\/]+$/, '');
  return [
    env.SystemRoot ?? `${drive}\\Windows`,
    env.ProgramFiles ?? `${drive}\\Program Files`,
    env['ProgramFiles(x86)'] ?? `${drive}\\Program Files (x86)`,
    env.ProgramData ?? `${drive}\\ProgramData`,
    `${drive}\\Recovery`,
    `${drive}\\Config.Msi`,
    `${drive}\\PerfLogs`,
    nodePath.win32.join(config.home, 'AppData'),
    ...(config.extraBlocked ?? []),
  ].filter(Boolean);
}

/** Yalnız yazıya bakan denetim; dosya sistemine dokunmaz (ağ yolu diske/ağa gidilmeden elenir). */
export function checkPathText(raw: string, platform: NodeJS.Platform): { ok: true; path: string } | { ok: false; reason: string } {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  if (!value) return { ok: false, reason: 'Dosya yolu boş.' };
  if (/[\u0000-\u001f]/.test(value)) return { ok: false, reason: 'Dosya yolunda geçersiz karakter var.' };
  if (platform === 'win32') {
    const slashed = value.replace(/\//g, '\\');
    if (slashed.startsWith('\\\\') || slashed.startsWith('\\??\\')) {
      return { ok: false, reason: 'Ağ yolu ya da aygıt yolu okunmaz; dosyayı bu bilgisayardaki bir klasöre koyun.' };
    }
    if (!/^[A-Za-z]:\\/.test(slashed)) return { ok: false, reason: 'Tam yol gerekli (örnek: C:\\Users\\...\\belge.pdf) ya da "Masaüstü", "Belgeler" gibi bir klasör adı.' };
    // Sürücü harfinden sonraki ":" alternatif veri akışıdır ("rapor.pdf:gizli").
    if (slashed.indexOf(':', 2) !== -1) return { ok: false, reason: 'Dosya yolunda geçersiz karakter var (":").' };
    if (/[<>"|?*]/.test(slashed.slice(2))) return { ok: false, reason: 'Dosya yolunda geçersiz karakter var.' };
    // Windows sondaki nokta ve boşluğu yok sayar: "a.pem." aslında "a.pem"dir; denetimi atlatmasın.
    if (slashed.split('\\').some((part) => part !== '.' && part !== '..' && /[. ]$/.test(part))) {
      return { ok: false, reason: 'Yol bileşeni nokta ya da boşlukla bitemez.' };
    }
    return { ok: true, path: nodePath.win32.resolve(slashed) };
  }
  if (!nodePath.posix.isAbsolute(value)) return { ok: false, reason: 'Tam yol gerekli.' };
  return { ok: true, path: nodePath.posix.resolve(value) };
}

/**
 * Okuma ya da listeleme kararı. `kind: 'file' | 'dir'` hedefin türünü doğrular. Gerçek yol çözülemezse (yok) `deny`.
 */
export function checkAccess(raw: string, kind: 'file' | 'dir', config: AccessConfig): AccessDecision {
  const text = checkPathText(raw, config.platform);
  if (!text.ok) return { kind: 'deny', reason: text.reason };
  const lexical = text.path;
  const lexicalBlock = blockedReason(lexical, config);
  if (lexicalBlock) return { kind: 'deny', reason: `Bu yol açılmaz: ${lexicalBlock}.` };
  let real: string;
  try {
    real = fs.realpathSync.native(lexical);
  } catch {
    return { kind: 'deny', reason: `Bu yolda ${kind === 'dir' ? 'bir klasör' : 'bir dosya'} yok: ${lexical}` };
  }
  const realText = checkPathText(real, config.platform);
  if (!realText.ok) return { kind: 'deny', reason: `Dosyanın gerçek yeri kabul edilmiyor: ${realText.reason}` };
  const realBlock = blockedReason(realText.path, config);
  if (realBlock) return { kind: 'deny', reason: `Bu yol açılmaz (gerçek yeri: ${realText.path}): ${realBlock}.` };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realText.path);
  } catch {
    return { kind: 'deny', reason: `Bu yol okunamadı: ${lexical}` };
  }
  if (kind === 'file' && !stat.isFile()) return { kind: 'deny', reason: 'Bu yol bir dosya değil.' };
  if (kind === 'dir' && !stat.isDirectory()) return { kind: 'deny', reason: 'Bu yol bir klasör değil.' };
  const allowed = config.readRoots().some((root) => isInside(realText.path, root, config.platform));
  return allowed ? { kind: 'allow', path: realText.path } : { kind: 'ask', path: realText.path };
}

/** Kullanıcının eklemek istediği izinli klasör ya da çıktı klasörü uygun mu (sistem/uygulama verisi ve sürücü kökü olmaz). */
export function checkFolderChoice(raw: string, config: AccessConfig): { ok: true; path: string } | { ok: false; reason: string } {
  const text = checkPathText(raw, config.platform);
  if (!text.ok) return text;
  let real: string;
  try {
    real = fs.realpathSync.native(text.path);
    if (!fs.statSync(real).isDirectory()) return { ok: false, reason: 'Bu yol bir klasör değil.' };
  } catch {
    return { ok: false, reason: `Bu klasör yok: ${text.path}` };
  }
  const p = lib(config.platform);
  if (p.parse(real).root.replace(/[\\/]+$/, '').toLowerCase() === real.replace(/[\\/]+$/, '').toLowerCase()) {
    return { ok: false, reason: 'Bütün bir sürücü izinli klasör olamaz; içinden bir klasör seçin.' };
  }
  if (norm(real, config.platform) === norm(config.home, config.platform)) {
    return { ok: false, reason: 'Kullanıcı klasörünün tamamı izinli olamaz (içinde uygulama verisi ve anahtarlar var); içinden bir klasör seçin.' };
  }
  const blocked = blockedReason(real, config) ?? blockedReason(text.path, config);
  if (blocked) return { ok: false, reason: `Bu klasör seçilemez: ${blocked}.` };
  return { ok: true, path: real };
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Modelin verdiği dosya adını güvenli bir ada çevirir; klasör ayırıcısı ve uzantı atılır, uzantıyı biçim belirler. */
export function safeFileName(raw: string, extension: string): string {
  let base = raw
    .replace(/[\\/]+/g, ' ')
    .replace(/[<>:"|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  base = base.replace(new RegExp(`\\.${extension}$`, 'i'), '').replace(/[. ]+$/g, '').replace(/^[. ]+/g, '');
  if (!base || RESERVED.test(base)) base = `Belge ${base}`.trim();
  if (base.length > 120) base = base.slice(0, 120).trim();
  return `${base}.${extension}`;
}

/** `folder/name` varsa "name (2).ext", "name (3).ext"… (üzerine yazılmaz). */
export function uniquePath(folder: string, name: string, exists: (file: string) => boolean = fs.existsSync, platform: NodeJS.Platform = process.platform): string {
  const p = lib(platform);
  const extension = p.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = p.join(folder, name);
  for (let n = 2; exists(candidate) && n < 1000; n++) candidate = p.join(folder, `${stem} (${n})${extension}`);
  return candidate;
}
