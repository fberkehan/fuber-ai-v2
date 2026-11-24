import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAdminExe, launchAdmin, type AdminLauncherIo } from './policy-admin';

const LOCAL = 'C:\\Users\\ayse\\AppData\\Local';
const DEFAULT_EXE = path.join(LOCAL, 'Programs', '@fuberadmin', 'Fuber Yönetim 2.exe');

function fakeIo(patch: Partial<AdminLauncherIo> & { files?: string[]; dirs?: Record<string, string[]> } = {}): AdminLauncherIo & { started: string[] } {
  const files = new Set((patch.files ?? []).map((file) => file.toLowerCase()));
  const started: string[] = [];
  return {
    env: { LOCALAPPDATA: LOCAL },
    isFile: (file) => files.has(file.toLowerCase()),
    subdirectories: (dir) => patch.dirs?.[dir] ?? [],
    registryHints: async () => [],
    isRunning: async () => false,
    start: async (exe) => {
      started.push(exe);
      return { alive: true, exitCode: null, error: null };
    },
    ...patch,
    started,
  };
}

describe('findAdminExe', () => {
  it('kullanıcı başına kurulumun varsayılan klasörünü bulur (klasör adı ne olursa olsun)', async () => {
    const io = fakeIo({ files: [DEFAULT_EXE], dirs: { [path.join(LOCAL, 'Programs')]: ['Fuber AI', '@fuberadmin'] } });
    expect(await findAdminExe(io)).toBe(DEFAULT_EXE);
  });

  it('varsayılan yerde yoksa kayıt defteri izlerine bakar', async () => {
    const custom = 'D:\\Uygulamalar\\Yonetim\\Fuber Yönetim 2.exe';
    for (const hint of ['D:\\Uygulamalar\\Yonetim', 'D:\\Uygulamalar\\Yonetim\\', '"D:\\Uygulamalar\\Yonetim\\uninstallerIcon.exe",0', custom]) {
      expect(await findAdminExe(fakeIo({ files: [custom], registryHints: async () => ['C:\\silinmis\\yer', hint] }))).toBe(custom);
    }
  });

  it('kurulu değilse null döner', async () => {
    expect(await findAdminExe(fakeIo({ registryHints: async () => ['C:\\silinmis\\yer'] }))).toBeNull();
    expect(await findAdminExe(fakeIo({ env: {} }))).toBeNull();
  });
});

describe('launchAdmin', () => {
  const installed = { files: [DEFAULT_EXE], dirs: { [path.join(LOCAL, 'Programs')]: ['@fuberadmin'] } };

  it('kurulu değilse nedenini söyler ve hiçbir şey başlatmaz', async () => {
    const io = fakeIo();
    expect(await launchAdmin(io)).toEqual({
      ok: false,
      message: 'Fuber Yönetim 2 bu bilgisayarda kurulu değil. Önce Fuber Yönetim 2 kurulumunu çalıştırın.',
    });
    expect(io.started).toEqual([]);
  });

  it('süreç ayakta kaldıysa açıldı der', async () => {
    const io = fakeIo(installed);
    expect(await launchAdmin(io)).toEqual({ ok: true, message: 'Fuber Yönetim 2 açıldı.' });
    expect(io.started).toEqual([DEFAULT_EXE]);
  });

  it('zaten açıksa ikinci örnek çıkar; yine başarı sayılır', async () => {
    const io = fakeIo({ ...installed, isRunning: async () => true, start: async () => ({ alive: false, exitCode: 0, error: null }) });
    expect(await launchAdmin(io)).toEqual({ ok: true, message: 'Fuber Yönetim 2 zaten açık.' });
  });

  it('süreç hemen ölürse ya da başlatılamazsa açıldı demez', async () => {
    const died = fakeIo({ ...installed, start: async () => ({ alive: false, exitCode: 1, error: null }) });
    expect(await launchAdmin(died)).toEqual({ ok: false, message: 'Fuber Yönetim 2 başlatılamadı: çıkış kodu 1' });
    const denied = fakeIo({ ...installed, start: async () => ({ alive: false, exitCode: null, error: 'EACCES' }) });
    expect(await launchAdmin(denied)).toEqual({ ok: false, message: 'Fuber Yönetim 2 başlatılamadı: EACCES' });
  });
});
