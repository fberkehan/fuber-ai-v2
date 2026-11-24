/**
 * Kontrol düzleminin masaüstündeki ucu: kurulu Fuber Yönetim 2'yi bulur ve başlatır ("Yönetim'i aç" düğmesi).
 * Yönetim, kullanıcı başına kurulur; önce varsayılan kurulum klasörüne, bulunamazsa kayıt defterine bakılır.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_APP_NAME, t, type LaunchResult } from '@fuber/shared';

const ADMIN_EXE = `${ADMIN_APP_NAME}.exe`;

/** Dış dünyaya dokunan işlemler; sınamada sahtesi verilir. */
export interface AdminLauncherIo {
  env: Record<string, string | undefined>;
  isFile(file: string): boolean;
  /** Klasörün alt klasör adları; klasör yoksa boş. */
  subdirectories(dir: string): string[];
  /** Kayıt defterindeki kurulum izleri: `App Paths` değeri ve Uninstall anahtarlarının `InstallLocation` / `DisplayIcon` değerleri. */
  registryHints(): Promise<string[]>;
  isRunning(): Promise<boolean>;
  /** Süreci bağımsız başlatır. Sonuç: süreç `graceMs` sonunda ayakta mı, değilse çıkış kodu. */
  start(exe: string, graceMs: number): Promise<{ alive: boolean; exitCode: number | null; error: string | null }>;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (_error, stdout) => resolve(stdout ?? ''));
  });
}

// PowerShell kayıt defterini Unicode okur; reg.exe çıktısı konsol kod sayfasındadır ve "ö" bozulur.
const REGISTRY_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$name = '${ADMIN_APP_NAME}'
$roots = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion'
foreach ($root in $roots) {
  $appPath = Get-ItemProperty -Path "$root\\App Paths\\$name.exe" -ErrorAction SilentlyContinue
  if ($appPath) { $appPath.'(default)' }
  Get-ItemProperty -Path "$root\\Uninstall\\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "$name*" } |
    ForEach-Object { $_.InstallLocation; $_.DisplayIcon }
}`;

export const defaultAdminIo: AdminLauncherIo = {
  env: process.env,
  isFile(file) {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  },
  subdirectories(dir) {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  },
  async registryHints() {
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', REGISTRY_SCRIPT]);
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  },
  async isRunning() {
    // Çıktı konsol kod sayfasındadır; yalnız adın ASCII başına bakılır.
    const output = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${ADMIN_EXE}`, '/FO', 'CSV', '/NH']);
    return output.includes('"Fuber Y');
  },
  start(exe, graceMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { alive: boolean; exitCode: number | null; error: string | null }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      try {
        const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
        child.once('error', (error) => finish({ alive: false, exitCode: null, error: error.message }));
        child.once('exit', (code) => finish({ alive: false, exitCode: code, error: null }));
        child.unref();
        setTimeout(() => finish({ alive: true, exitCode: null, error: null }), graceMs);
      } catch (error) {
        finish({ alive: false, exitCode: null, error: (error as Error).message });
      }
    });
  },
};

/** Kayıt defteri izinden exe yolunu çıkarır: klasör, exe yolu ya da `"…exe",0` biçimli simge yolu olabilir. */
function exeFromHint(hint: string): string {
  const cleaned = hint.replace(/,-?\d+$/, '').replace(/^"|"$/g, '');
  return cleaned.toLowerCase().endsWith('.exe') ? path.join(path.dirname(cleaned), ADMIN_EXE) : path.join(cleaned, ADMIN_EXE);
}

/** Kurulu Fuber Yönetim 2'nin exe yolu; kurulu değilse `null`. */
export async function findAdminExe(io: AdminLauncherIo = defaultAdminIo): Promise<string | null> {
  // electron-builder'ın kullanıcı başına kurulum yeri: %LOCALAPPDATA%\Programs\<klasör>\. Klasör adı paket
  // adından türediği için sabit yazılmaz; alt klasörler taranır.
  const local = io.env.LOCALAPPDATA;
  if (local) {
    const programs = path.join(local, 'Programs');
    for (const dir of io.subdirectories(programs)) {
      const candidate = path.join(programs, dir, ADMIN_EXE);
      if (io.isFile(candidate)) return candidate;
    }
  }
  for (const hint of await io.registryHints()) {
    const candidate = exeFromHint(hint);
    if (io.isFile(candidate)) return candidate;
  }
  return null;
}

/** Yönetim'i başlatır. `ok` yalnız süreç gerçekten ayaktaysa `true` olur. */
export async function launchAdmin(io: AdminLauncherIo = defaultAdminIo, graceMs = 2000): Promise<LaunchResult> {
  const exe = await findAdminExe(io);
  if (!exe) return { ok: false, message: t('control.admin.notFound') };
  const wasRunning = await io.isRunning();
  // Zaten açıksa da başlatılır: Yönetim tek örnektir, ikinci açılış penceresini öne getirip çıkar.
  const started = await io.start(exe, graceMs);
  if (started.error) return { ok: false, message: t('control.admin.failed', { detail: started.error }) };
  if (started.alive) return { ok: true, message: t('control.admin.launched') };
  if (wasRunning || (await io.isRunning())) return { ok: true, message: t('control.admin.alreadyRunning') };
  return { ok: false, message: t('control.admin.failed', { detail: `çıkış kodu ${started.exitCode ?? 'bilinmiyor'}` }) };
}
