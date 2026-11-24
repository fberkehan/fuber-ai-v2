// Başlat menüsü kısayolları ve bilinen uygulamalar arasında ad eşleştirme.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

export interface AppEntry {
  name: string;
  /** Açılacak hedef: `.lnk` yolu, `shell:AppsFolder\<AppID>`, `ms-settings:` ya da çalıştırılabilir dosya adı. */
  target: string;
  kind: 'shortcut' | 'uwp' | 'uri' | 'exe';
  /** Eşleşmeye yardımcı ek adlar (Türkçe söyleyişler). */
  aliases?: string[];
}

/** Kısayolu olmayan ya da Türkçe adıyla söylenen yaygın uygulamalar. */
export const KNOWN_APPS: AppEntry[] = [
  { name: 'Hesap Makinesi', target: 'calc.exe', kind: 'exe', aliases: ['calculator', 'hesap makinasi', 'calc'] },
  { name: 'Not Defteri', target: 'notepad.exe', kind: 'exe', aliases: ['notepad'] },
  { name: 'Dosya Gezgini', target: 'explorer.exe', kind: 'exe', aliases: ['explorer', 'gezgin', 'klasorler', 'dosyalar'] },
  { name: 'Ayarlar', target: 'ms-settings:', kind: 'uri', aliases: ['windows ayarlari', 'settings'] },
  { name: 'Görev Yöneticisi', target: 'taskmgr.exe', kind: 'exe', aliases: ['task manager', 'gorev yoneticisi'] },
  { name: 'Paint', target: 'mspaint.exe', kind: 'exe', aliases: ['boya'] },
  { name: 'Komut İstemi', target: 'cmd.exe', kind: 'exe', aliases: ['cmd', 'komut satiri'] },
  { name: 'Windows Terminal', target: 'wt.exe', kind: 'exe', aliases: ['terminal', 'konsol'] },
  { name: 'Ekran Alıntısı Aracı', target: 'ms-screenclip:', kind: 'uri', aliases: ['snipping tool', 'ekran goruntusu'] },
];

async function walkShortcuts(dir: string, out: AppEntry[], depth = 0): Promise<void> {
  if (depth > 3) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkShortcuts(full, out, depth + 1);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
      const name = entry.name.slice(0, -4);
      // Kaldırma ve yardım kısayolları uygulama değildir.
      if (/uninstall|kald[ıi]r|readme|help|yard[ıi]m|website|documentation/i.test(name)) continue;
      out.push({ name, target: full, kind: 'shortcut' });
    }
  }
}

/** Başlat menüsündeki `.lnk` kısayolları (kullanıcı + bütün kullanıcılar). */
export async function startMenuShortcuts(env: NodeJS.ProcessEnv = process.env): Promise<AppEntry[]> {
  const dirs = [
    env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter((dir): dir is string => !!dir);
  const out: AppEntry[] = [];
  for (const dir of dirs) await walkShortcuts(dir, out);
  return out;
}

/** Mağaza (UWP) uygulamaları: `Get-StartApps`. Kısayolu olmayanları (Hesap Makinesi, WhatsApp…) da kapsar. */
export function storeApps(timeoutMs = 8000): Promise<AppEntry[]> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve([]);
    }, timeoutMs);
    child.stdout.on('data', (data: Buffer) => (output += data.toString('utf8')));
    child.on('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed: unknown = JSON.parse(output || '[]');
        const list = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ Name?: string; AppID?: string }>;
        resolve(
          list
            .filter((app) => app.Name && app.AppID && app.AppID.includes('!'))
            .map((app) => ({ name: app.Name!, target: `shell:AppsFolder\\${app.AppID}`, kind: 'uwp' as const })),
        );
      } catch {
        resolve([]);
      }
    });
  });
}

/** Aynı adlı girdilerden birini tutar: kısayol > UWP > bilinen. */
export function mergeApps(...lists: AppEntry[][]): AppEntry[] {
  const byName = new Map<string, AppEntry>();
  for (const list of lists) {
    for (const app of list) {
      const key = app.name.toLocaleLowerCase('tr');
      if (!byName.has(key)) byName.set(key, app);
    }
  }
  return [...byName.values()];
}
