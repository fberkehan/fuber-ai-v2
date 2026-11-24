// ── Kurulumun sistem kontrolü: bilgisayarın bilgisi (ana süreç) ─────────────────────────────────────────────────────
// `sistem:kontrol` (telefondan kapalı): işletim sistemi sürümü, takılı bellek tahmini, veri klasörünün sürücüsündeki boş yer ve
// NVIDIA ekran kartı (ve belleği: model seçicinin yerel uygunluğu). Mikrofonu arayüz sayar (navigator.mediaDevices); değerlendirme
// src/shared/sistem-kontrol.ts'te. Salt okur.
import fs from 'node:fs';
import os from 'node:os';
import { yollar } from './yollar.js';
import { nvidiaVarMi, ekranKartiBellegiGB } from './gpu.js';
import { bellekGB, type SistemBilgisi } from '../shared/sistem-kontrol.js';

/** Veri klasörünün sürücüsündeki boş yer (GB, bir ondalık); okunamazsa NaN ("ölçülemedi"; kurulum yine sürer). */
function bosDisk(): number {
  try {
    const s = fs.statfsSync(yollar.veri());
    return Math.floor(((s.bavail * s.bsize) / 2 ** 30) * 10) / 10;
  } catch {
    return Number.NaN;
  }
}

export async function sistemBilgisi(): Promise<Omit<SistemBilgisi, 'mikrofon'>> {
  const nvidia = await nvidiaVarMi().catch(() => false);
  const vramGB = nvidia ? await ekranKartiBellegiGB().catch(() => undefined) : undefined;
  return {
    platform: process.platform,
    surum: os.release(),
    ramGB: bellekGB(os.totalmem()),
    bosDiskGB: bosDisk(),
    nvidia,
    ...(vramGB !== undefined ? { vramGB } : {}),
  };
}
