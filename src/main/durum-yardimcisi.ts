// ── Satır satır konuşan yerel yardımcı süreç (0.14 T22) ─────────────────────────────────────────────────────────────────────────────
// Olay yardımcısı (resources/bin/fuber-olay.exe; main/olay-yardimcisi.ts) stdout'a satır başına bir JSON yazar, stdin'den komut satırı okur. Bu dosya
// yalnız süreci pencere açmadan başlatır ve satırlara böler; protokol, hâl ve yeniden başlatma olay-yardimcisi.ts'te. (Eski tam ekran soru-yanıt
// yardımcısı, 5 sn'lik yoklaması ve freni 0.14 T22'de kalktı: tam ekran ve sistem olayları artık olay güdümlü gelir.)
// Electron'suz: tests/olay-yardimcisi.test.ts sahte yardımcıyla (scripts/dev/sahte-olay.mjs) gerçek alt süreç açar.
import { spawn } from 'node:child_process';

/** Satır satır konuşan yardımcı süreç (testte sahte). */
export interface SatirSureci {
  /** Bir komut satırı yazar (satır sonu eklenir). */
  yaz(satir: string): void;
  oldur(): void;
  /** stdin'i kapatır: yardımcı kendiliğinden çıkmalı (çıkmazsa çağıran süre sonunda öldürür). */
  kapat(): void;
  /** Yardımcının her çıktı satırı. */
  satirda(f: (satir: string) => void): void;
  /** Süreç kapandı ya da çalışamadı (bir kez). */
  bitince(f: (neden: string) => void): void;
}

/** Gerçek süreç: pencere açmadan başlatılır; stdout satırlara bölünür; çıkış/başlatma hatası/yazma hatası bir kez bildirilir. */
export function satirSureci(komut: string, argumanlar: string[]): SatirSureci {
  const p = spawn(komut, argumanlar, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let tampon = '';
  let satirF: ((s: string) => void) | null = null;
  let bitF: ((n: string) => void) | null = null;
  let bitti = false;
  const bit = (neden: string) => { if (bitti) return; bitti = true; bitF?.(neden); };
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d: string) => {
    tampon += d;
    let i: number;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const satir = tampon.slice(0, i).trim();
      tampon = tampon.slice(i + 1);
      if (satir) satirF?.(satir);
    }
  });
  // Dinleyicisiz 'error' ana süreci düşürürdü (ör. güvenlik yazılımı başlatmayı engelledi).
  p.on('error', (e) => bit(e.message));
  p.stdin.on('error', (e) => bit(e.message));
  p.on('exit', (kod) => bit(`çıkış kodu ${kod}`));
  return {
    yaz: (satir) => { if (!bitti && p.stdin.writable) p.stdin.write(`${satir}\n`); },
    oldur: () => { try { p.kill(); } catch { /* zaten kapalı */ } },
    kapat: () => { try { p.stdin.end(); } catch { /* zaten kapalı */ } },
    satirda: (f) => { satirF = f; },
    bitince: (f) => { bitF = f; },
  };
}
