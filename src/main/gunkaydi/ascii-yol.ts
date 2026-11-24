// ── Windows: ASCII dışı yolu kısa (8.3) ASCII yola çevirir (Electron'suz; tests/whisper-tani.test.ts) ──────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ASCII_DISI } from '../../shared/whisper-tani.ts';

/** whisper-server `-m` yolunu dar (ANSI) karakterlerle okur: yolda sistem kod sayfasında olmayan harf (Türkçe harfli kullanıcı adı ya da klasör: "İ", "ş", "ğ"…) varsa model
 *  yolu bozulur ve sunucu açılışta çöker (0xC0000409; paketli ortamda yeniden üretildi). Windows 8.3 kısa yolu (ASCII) kullanılır; üretilemezse (8.3 kapalı) yol aynen kalır. */
export function asciiYol(p: string): string {
  if (!ASCII_DISI.test(p) || process.platform !== 'win32') return p;
  try {
    const o = String(spawnSync('cmd.exe', ['/d', '/c', 'for', '%I', 'in', `("${p}")`, 'do', '@echo', '%~sI'], { windowsHide: true, encoding: 'utf8', windowsVerbatimArguments: true, timeout: 5000 }).stdout ?? '').trim();
    return o && !ASCII_DISI.test(o) && fs.existsSync(o) ? o : p;
  } catch { return p; }
}
