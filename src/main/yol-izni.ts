// ── İzinli klasör denetimi (saf modül: Electron'suz, testlerde doğrudan çalışır) ──────────────────────────────
import path from 'node:path';

/** `yol` izinli köklerden birinin KENDİSİ ya da İÇİNDE mi (büyük/küçük harf duyarsız; Windows yolları).
 *  Ayırıcısız startsWith, "…\Desktop" kökünü "…\DesktopGizli" ya da "…\Documents-eski" için de geçiriyordu. */
export function kokIcindeMi(yol: string, kokler: string[], p: typeof path = path): boolean {
  const y = p.resolve(yol).toLowerCase();
  return kokler.some((kok) => {
    const k = p.resolve(kok).toLowerCase().replace(/[\\/]+$/, '');
    return y === k || y.startsWith(k + p.sep);
  });
}
