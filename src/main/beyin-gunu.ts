// ── Beyin sayfasının "bugün"ü diskte (Görev 25 düzeltme 1) ───────────────────────────────────────────────────────────
// Bugünün bölge/motor sayaçları ve son olaylar yalnız bellekteydi: uygulama her açılışta Beyin sayfasını sıfırdan ("0 işlem", boş
// Akış) gösteriyordu. Küçük bir JSON (veri klasöründe beyin-gunu.json) bugünü tutar; yerel gece yarısı yeni gün başlar, eski günün
// kaydı okunmaz (gün değişince bellekte de silinir). Saf modül (electron yok): birim testli (tests/beyin-gunu.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { BeyinOlayi, BolgeId, MotorId } from '../shared/beyin.js';

export const GUNLUK_SURUM = 1;
/** Diskte tutulan son olay sayısı. */
export const GUNLUK_OLAY = 50;

export interface BeyinGunu {
  surum: typeof GUNLUK_SURUM;
  /** Yerel tarih (YYYY-AA-GG). */
  gun: string;
  bugun: Partial<Record<BolgeId, number>>;
  motorBugun: Partial<Record<MotorId, number>>;
  sonZaman: Partial<Record<BolgeId, string>>;
  olaylar: BeyinOlayi[];
}

/** Yerel takvim günü (gece yarısı yerel saatle döner; UTC değil). */
export function yerelGun(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const sayiHaritasi = (v: unknown): Record<string, number> => {
  const r: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n) && n >= 0) r[k] = Math.floor(n);
  return r;
};

/** Bugünün kaydını okur; dosya yoksa, bozuksa ya da başka bir günün kaydıysa null. */
export function gunuOku(yol: string, gun: string = yerelGun()): BeyinGunu | null {
  try {
    const v = JSON.parse(fs.readFileSync(yol, 'utf8')) as Partial<BeyinGunu>;
    if (v?.surum !== GUNLUK_SURUM || v.gun !== gun) return null;
    const olaylar = Array.isArray(v.olaylar) ? v.olaylar.filter((o) => o && typeof o.id === 'number' && typeof o.zaman === 'string' && typeof o.bolge === 'string') : [];
    const sonZaman: Record<string, string> = {};
    if (v.sonZaman && typeof v.sonZaman === 'object') for (const [k, z] of Object.entries(v.sonZaman)) if (typeof z === 'string') sonZaman[k] = z;
    return { surum: GUNLUK_SURUM, gun, bugun: sayiHaritasi(v.bugun), motorBugun: sayiHaritasi(v.motorBugun), sonZaman, olaylar: olaylar.slice(-GUNLUK_OLAY) };
  } catch {
    return null;
  }
}

const icerik = (g: BeyinGunu) => JSON.stringify({ ...g, olaylar: g.olaylar.slice(-GUNLUK_OLAY) });

let geciciSira = 0;
/** Atomik, EŞZAMANLI yazım (geçici dosya + yeniden adlandırma): yarım dosya kalmaz. Tek yazım yolu budur (ertelenmiş yazım da çıkış da):
 *  eşzamansız bir yazım uçuştayken çıkıştaki yazımın üstüne eski içeriği adlandırması (düzeltme 3) olamaz. Dosya küçük (≤ 50 olay). */
export function gunuYazHemen(yol: string, g: BeyinGunu): void {
  const gecici = `${yol}.${process.pid}.${++geciciSira}.tmp`;
  try {
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    fs.writeFileSync(gecici, icerik(g), 'utf8');
    fs.renameSync(gecici, yol);
  } catch {
    try { fs.rmSync(gecici, { force: true }); } catch { /* yok */ }
    /* yazılamadıysa bir sonraki değişiklik yine yazar */
  }
}
