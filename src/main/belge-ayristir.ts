// ── Belge ayrıştırma: ayrı süreçte, süre ve bellek sınırıyla (inceleme I1) ───────────────────────────────────────────────────────────
// PDF / Word / Excel / PowerPoint / e-posta ana süreçte açılmaz: belge-isci.ts Electron'da `utilityProcess` (asar içinden de açılır;
// --max-old-space-size), Electron dışında (testler) `worker_threads` (resourceLimits) olarak çalışır. Kesin süre (varsayılan 45 sn) dolunca ya da
// bellek sınırı aşılınca işçi öldürülür; çağıran tek satırlık hata alır. Ana süreç hiçbir durumda donmaz ya da bellek dolarak çökmez.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { IsciIstegi, IsciYaniti } from './belge-isci.js';

export type { IsciYaniti } from './belge-isci.js';
export const BELGE_SURE_MS = 45_000;
export const BELGE_BELLEK_MB = 512;

/** İşçi betiği: derlenmiş (dist/main/belge-isci.js) ya da kaynak (testte .ts; Node tür ayıklamasıyla). */
function isciYolu(): string {
  const dizin = path.dirname(fileURLToPath(import.meta.url));
  const js = path.join(dizin, 'belge-isci.js');
  return fs.existsSync(js) ? js : path.join(dizin, 'belge-isci.ts');
}

type Sonuc = IsciYaniti | { hata: string; kod: 'zaman' | 'bellek' | 'coktu' };

export async function belgeAyristir(yol: string, o: { azamiKarakter: number; sureMs?: number; bellekMb?: number; zip?: IsciIstegi['zip']; xlsx?: IsciIstegi['xlsx'] }): Promise<Sonuc> {
  const istek: IsciIstegi = { yol, azamiKarakter: o.azamiKarakter, ...(o.zip ? { zip: o.zip } : {}), ...(o.xlsx ? { xlsx: o.xlsx } : {}) };
  const sure = o.sureMs ?? BELGE_SURE_MS;
  const bellek = o.bellekMb ?? BELGE_BELLEK_MB;
  if (process.versions.electron) {
    const { utilityProcess } = await import('electron');
    if (utilityProcess?.fork) return utilityIle(istek, sure, bellek, utilityProcess.fork);
  }
  return isParcacigiIle(istek, sure, bellek);
}

function utilityIle(istek: IsciIstegi, sure: number, bellek: number, fork: typeof import('electron').utilityProcess.fork): Promise<Sonuc> {
  return new Promise((coz) => {
    let bitti = false;
    const c = fork(isciYolu(), [], { execArgv: [`--max-old-space-size=${bellek}`], serviceName: 'Fuber belge okuyucu', stdio: 'ignore' });
    const son = (r: Sonuc) => { if (bitti) return; bitti = true; clearTimeout(saat); try { c.kill(); } catch { /* çıktı */ } coz(r); };
    const saat = setTimeout(() => son({ hata: 'zaman', kod: 'zaman' }), sure);
    c.once('message', (m: IsciYaniti) => son(m));
    c.once('exit', (kod) => son({ hata: `işçi kapandı (${kod})`, kod: kod === 134 || kod === 3 || kod === -1073741571 ? 'bellek' : 'coktu' }));
    c.postMessage(istek);
  });
}

function isParcacigiIle(istek: IsciIstegi, sure: number, bellek: number): Promise<Sonuc> {
  return new Promise((coz) => {
    let bitti = false;
    const w = new Worker(isciYolu(), { resourceLimits: { maxOldGenerationSizeMb: bellek, maxYoungGenerationSizeMb: 32 }, stdout: true, stderr: true });
    const son = (r: Sonuc) => { if (bitti) return; bitti = true; clearTimeout(saat); void w.terminate(); coz(r); };
    const saat = setTimeout(() => son({ hata: 'zaman', kod: 'zaman' }), sure);
    w.once('message', (m: IsciYaniti) => son(m));
    w.once('error', (e: NodeJS.ErrnoException) => son({ hata: String(e?.message ?? e), kod: e?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'bellek' : 'coktu' }));
    w.once('exit', (kod) => son({ hata: `işçi kapandı (${kod})`, kod: 'coktu' }));
    w.postMessage(istek);
  });
}

/** İşçi sonucunu kullanıcıya gidecek tek satıra çevirir (hata yoksa null). */
export function ayristirmaHatasi(ad: string, r: Sonuc): string | null {
  if (!('hata' in r)) return null;
  if (r.kod === 'zaman') return `${ad} okunamadı: ${Math.round(BELGE_SURE_MS / 1000)} sn içinde bitmedi (çok büyük ya da bozuk olabilir).`;
  if (r.kod === 'bellek') return `${ad} okunamadı: okumak için gereken bellek sınırı aştı (çok büyük).`;
  if (r.kod === 'sinir') return `${ad} okunamadı: ${r.hata} (sınır: 100 MB açılmış içerik; sıkıştırma bombası olabilir).`;
  return `${ad} okunamadı: ${r.hata}`;
}
