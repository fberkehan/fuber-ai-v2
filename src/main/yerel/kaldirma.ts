// ── Yerel beyni güvenle kaldırma ───────────────────────────────────────────────────────────────────────────────────────
// Görev 20b (K2 + G13/G11): eski yol indirmeyi durdurup sunucuyu "kill" ettikten HEMEN sonra klasörü siliyordu. Windows'ta yarım
// dosyanın yazıcısı henüz kapanmamış, llama-server.exe/piper.exe henüz çıkmamışken silme EBUSY/EPERM/ENOTEMPTY verebilir; ya da
// klasör yarım silinir. Sıra artık: (1) süren indirme durdurulur ve İŞİ BİTENE dek beklenir (indir() yazıcıyı kapatıp yarım dosyayı
// siler), (2) yerel sunucu ve ses süreçleri kapatılıp çıkışları beklenir, (3) klasör, kısa geçici kilitlere karşı yeniden
// denenerek silinir. Bağımlılıklar parametreyle gelir (birim testi; Electron yok).
import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';

export interface KaldirmaAdimlari {
  /** Süren indirme (yoksa null): `durdur` iptal eder, `is` indirmenin sözü (reddi beklenir, yutulur). */
  suren: { durdur: () => void; is: Promise<unknown> } | null;
  /** Sunucu ve ses süreçlerini kapatır; çıkışları beklenir. */
  surecleriKapat: () => Promise<void>;
  /** Klasörü siler. */
  sil: () => Promise<void>;
}

export async function siraylaKaldir(a: KaldirmaAdimlari): Promise<void> {
  if (a.suren) {
    a.suren.durdur();
    await a.suren.is.catch(() => undefined); // durdurma da, disk hatası da kaldırmayı engellemez
  }
  await a.surecleriKapat();
  await a.sil();
}

/** Klasörü siler; Windows'un kısa süreli kilitlerinde (EBUSY, EPERM, ENOTEMPTY…) artan aralıkla yeniden dener. */
export function klasoruSil(yol: string): Promise<void> {
  return fs.promises.rm(yol, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Süreci kapatır ve çıkışını bekler (en çok `ms`; sonra zorla). Zaten çıkmışsa hemen döner. */
export function sureciKapat(p: ChildProcess | null | undefined, ms = 5000): Promise<void> {
  if (!p || p.exitCode !== null || p.signalCode !== null) return Promise.resolve();
  return new Promise<void>((coz) => {
    let bitti = false;
    const son = () => { if (bitti) return; bitti = true; clearTimeout(zaman); coz(); };
    const zaman = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* kapalı */ } setTimeout(son, 500); }, ms);
    p.once('exit', son);
    try { p.kill(); } catch { son(); }
  });
}
