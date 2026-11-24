// ── claude.exe'yi bulmak (13 Kas 2026; paketli onarım) ───────────────────────────────────────────────────────────────────────────
// Kullanıcı Claude Code'u kendi terminalinden kullanır; KURULU Fuber AI ise Başlat menüsü / masaüstü kısayolu / kurulum başlatıcısından açılır ve
// o sürecin PATH'i Explorer'ın OTURUM AÇILIŞINDA aldığı kopyadır: Claude Code sonradan kurulduysa (ya da kullanıcı PATH'e sonradan eklediyse)
// uygulama onu GÖRMEZ. Eski arama yalnız `where claude` çıktısındaki ".exe" satırına ve ~/.local/bin'e bakıyor, bulamayınca da "yok"u sonsuza
// dek önbelleğe alıyordu. Yeni sıra (hepsi yalnız arar, çalıştırmaz):
//   1. Sürecin kendi PATH'i (where) — ".exe" doğrudan; ".cmd"/uzantısız npm kabuğu ise yanındaki paketin gerçek ikilisine çözülür
//      (npm -g: <klasör>\node_modules\@anthropic-ai\claude-code\bin\claude.exe). .cmd başlatılamaz (EINVAL); ikilinin kendisi başlatılır.
//   2. Bilinen yerler: ~/.local/bin (resmi yükleyici), %APPDATA%\npm (npm -g), %LOCALAPPDATA%\Programs\claude, ~/.claude/local.
//   3. Kayıt defterindeki GÜNCEL kullanıcı + makine PATH'i (Explorer'ın bayat kopyası değil).
// Saf: ortam (env, home, dosya var mı, where, kayıt PATH'i) dışarıdan verilir → birim testli (tests/cc-claude-ara.test.ts).
import path from 'node:path';

export interface AramaOrtami {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  /** Dosya var mı. */
  var: (p: string) => boolean;
  /** `where claude` / `which claude` çıktısı (satırlar). */
  where: () => string[];
  /** Kayıt defterinden (HKCU + HKLM) GÜNCEL PATH girdileri (genişletilmiş). */
  kayitPath: () => string[];
}

const NPM_IKILI = ['node_modules', '@anthropic-ai', 'claude-code', 'bin'];

/** Bir klasörde claude ikilisi: doğrudan claude.exe ya da yanındaki npm paketinin ikilisi. */
function klasordeBul(dizin: string, o: AramaOrtami): string | null {
  const ad = o.platform === 'win32' ? 'claude.exe' : 'claude';
  const dogrudan = path.join(dizin, ad);
  if (o.var(dogrudan)) return dogrudan;
  const npm = path.join(dizin, ...NPM_IKILI, ad);
  if (o.var(npm)) return npm;
  return null;
}

/** %VAR% genişletmesi (kayıttaki REG_EXPAND_SZ). */
export function ortamGenislet(s: string, env: Record<string, string | undefined>): string {
  return s.replace(/%([^%]+)%/g, (t, ad: string) => {
    const k = Object.keys(env).find((x) => x.toLowerCase() === ad.toLowerCase());
    return k && env[k] ? (env[k] as string) : t;
  });
}

/** `reg query` çıktısından Path değeri (REG_SZ / REG_EXPAND_SZ). */
export function regPathCoz(cikti: string, env: Record<string, string | undefined>): string[] {
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(cikti);
  if (!m) return [];
  return ortamGenislet(m[1].trim(), env).split(';').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

export function claudeAra(o: AramaOrtami): string | null {
  const win = o.platform === 'win32';
  // 1. süreç PATH'i
  let satirlar: string[] = [];
  try { satirlar = o.where().map((s) => s.trim()).filter(Boolean); } catch { /* where çalışmadı */ }
  const exe = satirlar.find((s) => /\.exe$/i.test(s) || (!win && path.isAbsolute(s)));
  if (exe && o.var(exe)) return exe;
  for (const s of satirlar) { const b = klasordeBul(path.dirname(s), o); if (b) return b; } // .cmd / uzantısız npm kabuğu → gerçek ikili
  // 2. bilinen yerler
  const bilinen = [
    path.join(o.home, '.local', 'bin'),
    ...(o.env.APPDATA ? [path.join(o.env.APPDATA, 'npm')] : []),
    ...(o.env.LOCALAPPDATA ? [path.join(o.env.LOCALAPPDATA, 'Programs', 'claude'), path.join(o.env.LOCALAPPDATA, 'Programs', 'claude-code')] : []),
    path.join(o.home, '.claude', 'local'),
    path.join(o.home, 'AppData', 'Roaming', 'npm'),
  ];
  for (const d of bilinen) { const b = klasordeBul(d, o); if (b) return b; }
  // 3. kayıt defterindeki güncel PATH (yalnız Windows)
  if (win) {
    let girdiler: string[] = [];
    try { girdiler = o.kayitPath(); } catch { /* kayıt okunamadı */ }
    for (const d of girdiler) { const b = klasordeBul(d, o); if (b) return b; }
  }
  return null;
}
