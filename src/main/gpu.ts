// ── Ekran kartı yoklaması: NVIDIA var mı, belleği ne kadar? ─────────────────────────────────────────────────────────────
// Yerel beyin (llama.cpp CUDA), Whisper (gün kaydı) ve kurulumun sistem kontrolü aynı yoklamayı kullanır. `nvidia-smi -L` sürücüyle
// gelir; yoksa ya da kart yoksa hata verir. Bellek (model seçicinin "Rahat çalışır / Zorlanır / Çalışmaz" hesabı) aynı araçla
// sorulur. Sonuçlar süreç boyunca değişmez: bir kez sorulur (en çok 8 sn), sonra önbellekten.
import { execFile } from 'node:child_process';
import { ekranKartiBellegi } from '../shared/sistem-kontrol.js';

let yoklama: Promise<boolean> | null = null;
let bellek: Promise<number | undefined> | null = null;

export function nvidiaVarMi(): Promise<boolean> {
  yoklama ??= new Promise<boolean>((coz) => {
    try { execFile('nvidia-smi', ['-L'], { windowsHide: true, timeout: 8000 }, (h, c) => coz(!h && /GPU/.test(String(c)))); } catch { coz(false); }
  });
  return yoklama;
}

/** NVIDIA ekran kartının belleği (GB; birden çok kartta en büyüğü). Kart yoksa ya da okunamazsa undefined. */
export function ekranKartiBellegiGB(): Promise<number | undefined> {
  bellek ??= nvidiaVarMi().then((var_) => (!var_ ? undefined : new Promise<number | undefined>((coz) => {
    try {
      execFile('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 }, (h, c) => coz(h ? undefined : ekranKartiBellegi(String(c))));
    } catch { coz(undefined); }
  })));
  return bellek;
}
