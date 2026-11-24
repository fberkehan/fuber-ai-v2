// Erişim kapısı: izinli klasör, onay, engel; yol gezinmesi, sembolik bağ/bağlantı noktası, UNC, alternatif veri akışı,
// sondaki nokta, 8.3 kısa ad. Bütün dosyalar sentetik ve depo içindeki geçici klasörde.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import nodePath from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockedName, checkAccess, checkFolderChoice, checkPathText, isInside, safeFileName, uniquePath, type AccessConfig } from './access';
import { scratchDir } from './testkit';

const win = process.platform === 'win32';
let home: string;
let outside: string;
let cleanup: () => Promise<void>;
let config: AccessConfig;

beforeAll(() => {
  const scratch = scratchDir('access');
  cleanup = scratch.cleanup;
  home = nodePath.join(scratch.dir, 'home');
  outside = nodePath.join(scratch.dir, 'baska');
  for (const folder of ['Desktop', 'Documents', 'AppData/Roaming/Fuber AI 2', '.ssh', 'Uzun Klasor Adi Burada']) fs.mkdirSync(nodePath.join(home, folder), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(nodePath.join(home, 'Desktop', 'beyan.pdf'), 'x');
  fs.writeFileSync(nodePath.join(home, 'Desktop', 'id_rsa'), 'x');
  fs.writeFileSync(nodePath.join(home, 'Desktop', 'şifrelerim.txt'), 'x');
  fs.writeFileSync(nodePath.join(home, 'Desktop', 'Passwords.xlsx'), 'x');
  fs.writeFileSync(nodePath.join(home, 'AppData', 'Roaming', 'Fuber AI 2', 'fuber.db.pdf'), 'x');
  fs.writeFileSync(nodePath.join(home, '.ssh', 'notlar.txt'), 'x');
  fs.writeFileSync(nodePath.join(outside, 'rapor.pdf'), 'x');
  fs.writeFileSync(nodePath.join(home, 'Uzun Klasor Adi Burada', 'belge.txt'), 'x');
  config = {
    platform: process.platform,
    home,
    readRoots: () => [nodePath.join(home, 'Desktop'), nodePath.join(home, 'Documents')],
    env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramData: 'C:\\ProgramData', SystemDrive: 'C:' },
  };
});
afterAll(() => cleanup());

describe('izinli klasör ve onay', () => {
  it('izinli klasördeki dosya geçer, dışındaki onay ister', () => {
    expect(checkAccess(nodePath.join(home, 'Desktop', 'beyan.pdf'), 'file', config)).toMatchObject({ kind: 'allow' });
    expect(checkAccess(nodePath.join(outside, 'rapor.pdf'), 'file', config)).toMatchObject({ kind: 'ask' });
  });

  it('kök sınırı: "Desktop" kökü "DesktopEski"yi kapsamaz', () => {
    expect(isInside('C:\\Users\\a\\DesktopEski\\x.pdf', 'C:\\Users\\a\\Desktop', 'win32')).toBe(false);
    expect(isInside('C:\\Users\\a\\desktop\\x.pdf', 'C:\\Users\\a\\Desktop', 'win32')).toBe(true);
  });

  it('dosya yok, tür yanlış', () => {
    expect(checkAccess(nodePath.join(home, 'Desktop', 'yok.pdf'), 'file', config)).toMatchObject({ kind: 'deny' });
    expect(checkAccess(nodePath.join(home, 'Desktop'), 'file', config)).toMatchObject({ kind: 'deny' });
  });
});

describe('engeller (onayla da açılmaz)', () => {
  it('uygulama verisi (AppData), .ssh, sistem klasörleri', () => {
    expect(checkAccess(nodePath.join(home, 'AppData', 'Roaming', 'Fuber AI 2', 'fuber.db.pdf'), 'file', config)).toMatchObject({ kind: 'deny' });
    expect(checkAccess(nodePath.join(home, '.ssh', 'notlar.txt'), 'file', config)).toMatchObject({ kind: 'deny' });
    if (win) {
      expect(checkAccess('C:\\Windows\\win.ini', 'file', config)).toMatchObject({ kind: 'deny' });
      expect(checkAccess('C:\\Windows\\System32\\drivers\\etc\\hosts', 'file', config)).toMatchObject({ kind: 'deny' });
    }
  });

  it('parola, anahtar ve oturum dosyaları adından tanınır', () => {
    expect(checkAccess(nodePath.join(home, 'Desktop', 'id_rsa'), 'file', config)).toMatchObject({ kind: 'deny' });
    expect(checkAccess(nodePath.join(home, 'Desktop', 'şifrelerim.txt'), 'file', config)).toMatchObject({ kind: 'deny' });
    expect(checkAccess(nodePath.join(home, 'Desktop', 'Passwords.xlsx'), 'file', config)).toMatchObject({ kind: 'deny' });
    for (const name of ['anahtar.pem', 'sertifika.pfx', 'kasa.kdbx', '.env', 'Login Data', 'cookies', 'wallet.dat', 'id_ed25519.pub']) {
      expect(blockedName(name), name).not.toBeNull();
    }
    for (const name of ['beyanname.pdf', 'Şifre başvuru kılavuzu.pdf', 'KDV.xlsx']) expect(blockedName(name), name).toBeNull();
  });

  it('yol gezinmesi: izinli klasörden ".." ile AppData\'ya kaçış', () => {
    const sneaky = `${nodePath.join(home, 'Desktop')}${nodePath.sep}..${nodePath.sep}AppData${nodePath.sep}Roaming${nodePath.sep}Fuber AI 2${nodePath.sep}fuber.db.pdf`;
    expect(checkAccess(sneaky, 'file', config)).toMatchObject({ kind: 'deny' });
  });

  it.runIf(win)('UNC, aygıt yolu, alternatif veri akışı, sondaki nokta/boşluk, göreli yol', () => {
    for (const raw of ['\\\\sunucu\\paylasim\\a.pdf', '//sunucu/paylasim/a.pdf', '\\\\?\\C:\\Users\\a.pdf', '\\\\.\\PhysicalDrive0', '\\??\\C:\\a.pdf']) {
      expect(checkPathText(raw, 'win32'), raw).toMatchObject({ ok: false });
    }
    expect(checkPathText('C:\\Users\\a\\rapor.pdf:gizli', 'win32')).toMatchObject({ ok: false });
    expect(checkPathText('C:\\Users\\a\\id_rsa.', 'win32')).toMatchObject({ ok: false });
    expect(checkPathText('C:\\Users\\a\\klasor \\x.pdf', 'win32')).toMatchObject({ ok: false });
    expect(checkPathText('rapor.pdf', 'win32')).toMatchObject({ ok: false });
    expect(checkPathText('C:\\Users\\a\\..\\b\\x.pdf', 'win32')).toMatchObject({ ok: true, path: 'C:\\Users\\b\\x.pdf' });
  });

  it.runIf(win)('bağlantı noktası (junction) izinli klasörden engelli yere gidiyorsa engellenir; dışarıya gidiyorsa onay', () => {
    const toAppData = nodePath.join(home, 'Desktop', 'kisayol-appdata');
    const toOutside = nodePath.join(home, 'Desktop', 'kisayol-baska');
    fs.symlinkSync(nodePath.join(home, 'AppData', 'Roaming'), toAppData, 'junction');
    fs.symlinkSync(outside, toOutside, 'junction');
    expect(checkAccess(nodePath.join(toAppData, 'Fuber AI 2', 'fuber.db.pdf'), 'file', config)).toMatchObject({ kind: 'deny' });
    const viaLink = checkAccess(nodePath.join(toOutside, 'rapor.pdf'), 'file', config);
    expect(viaLink.kind).toBe('ask');
    expect(viaLink.kind === 'ask' && viaLink.path.toLowerCase()).toBe(nodePath.join(outside, 'rapor.pdf').toLowerCase());
  });

  it.runIf(win)('8.3 kısa ad gerçek uzun yola çözülür (yoksa sınanamaz: birim kısa ad üretmiyor)', () => {
    const long = nodePath.join(home, 'Uzun Klasor Adi Burada', 'belge.txt');
    let short = '';
    try {
      short = execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${long}") do @echo %~sI`], { encoding: 'utf8' }).trim();
    } catch {
      short = '';
    }
    if (!short || short.toLowerCase() === long.toLowerCase() || !short.includes('~')) return;
    const decision = checkAccess(short, 'file', { ...config, readRoots: () => [nodePath.join(home, 'Uzun Klasor Adi Burada')] });
    expect(decision).toMatchObject({ kind: 'allow' });
    expect(decision.kind === 'allow' && decision.path.toLowerCase()).toBe(long.toLowerCase());
  });
});

describe('klasör seçimi ve dosya adı', () => {
  it('sürücü kökü, kullanıcı klasörünün tamamı ve AppData seçilemez', () => {
    expect(checkFolderChoice(nodePath.parse(home).root, config)).toMatchObject({ ok: false });
    expect(checkFolderChoice(home, config)).toMatchObject({ ok: false });
    expect(checkFolderChoice(nodePath.join(home, 'AppData', 'Roaming'), config)).toMatchObject({ ok: false });
    expect(checkFolderChoice(outside, config)).toMatchObject({ ok: true });
  });

  it('güvenli dosya adı: ayırıcı, uzantı, ayrılmış ad; üzerine yazmaz', () => {
    expect(safeFileName('..\\..\\Windows\\evil', 'docx')).toBe('Windows evil.docx');
    expect(safeFileName('rapor.docx', 'docx')).toBe('rapor.docx');
    expect(safeFileName('CON', 'pdf')).toBe('Belge CON.pdf');
    expect(safeFileName('a:b*c?', 'xlsx')).toBe('a b c.xlsx');
    const taken = new Set([nodePath.join(outside, 'rapor.pdf')]);
    expect(uniquePath(outside, 'rapor.pdf', (file) => taken.has(file))).toBe(nodePath.join(outside, 'rapor (2).pdf'));
  });
});
