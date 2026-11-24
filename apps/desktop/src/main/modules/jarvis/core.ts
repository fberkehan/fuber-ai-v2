// CORE: bu bilgisayarın gerçek yükü. CPU: `os.cpus()` zaman sayaçlarının iki okuma arasındaki farkı (çekirdek başına ve
// toplam). RAM: `os.totalmem/freemem`. GPU/VRAM/sıcaklık: `nvidia-smi` (varsa; yoksa null: sahte sayı yok).
// Sıcaklık: ekran kartınınki (Windows'ta işlemci sıcaklığı yönetici izni ister; okunamıyor).
import { execFile } from 'node:child_process';
import os from 'node:os';
import type { HudCore } from './types';

export const CORE_SERIES = 60;
const GPU_EVERY_MS = 2000;
const GPU_RETRY_MS = 60_000;

export interface GpuReading {
  name: string;
  util: number;
  vramUsedMb: number;
  vramTotalMb: number;
  tempC: number | null;
}

/** `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits` satırı. */
export function parseNvidiaSmi(out: string): GpuReading | null {
  const line = out.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 4) return null;
  const [name, util, used, total, temp] = parts;
  const u = Number(util);
  const m = Number(used);
  const mt = Number(total);
  if (!Number.isFinite(u) || !Number.isFinite(m) || !Number.isFinite(mt) || mt <= 0) return null;
  const t = Number(temp);
  return { name: name || 'GPU', util: u, vramUsedMb: m, vramTotalMb: mt, tempC: Number.isFinite(t) ? t : null };
}

export type RunFile = (file: string, args: string[]) => Promise<string>;

export const runFile: RunFile = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });

interface CpuTimes {
  idle: number;
  total: number;
}

const times = (): CpuTimes[] =>
  os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });

export interface CoreSourceDeps {
  now?: () => number;
  run?: RunFile;
  cpus?: () => CpuTimes[];
  totalmem?: () => number;
  freemem?: () => number;
  uptime?: () => number;
}

export interface CoreSource {
  /** Zaman sayaçlarını okur (hemen), ekran kartını gerekirse arka planda tazeler. */
  sample(): HudCore;
  /** Ekran kartı okumasını hemen yap (sınama). */
  pollGpu(): Promise<void>;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function createCoreSource(deps: CoreSourceDeps = {}): CoreSource {
  const now = deps.now ?? Date.now;
  const run = deps.run ?? runFile;
  const readCpus = deps.cpus ?? times;
  const total = deps.totalmem ?? os.totalmem;
  const free = deps.freemem ?? os.freemem;
  const uptime = deps.uptime ?? os.uptime;

  let prev: CpuTimes[] = readCpus();
  let cores: number[] = prev.map(() => 0);
  let cpu = 0;
  const cpuS: number[] = [];
  const gpuS: number[] = [];
  const ramS: number[] = [];
  let gpu: GpuReading | null = null;
  let gpuAt = 0;
  let gpuFailedAt = 0;
  let polling: Promise<void> | null = null;

  const push = (arr: number[], v: number) => {
    arr.push(Math.round(v));
    if (arr.length > CORE_SERIES) arr.shift();
  };

  async function pollGpu(): Promise<void> {
    if (polling) return polling;
    polling = (async () => {
      try {
        const out = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits']);
        gpu = parseNvidiaSmi(out);
        gpuAt = now();
        if (!gpu) gpuFailedAt = now();
      } catch {
        gpu = null;
        gpuFailedAt = now();
      } finally {
        polling = null;
      }
    })();
    return polling;
  }

  return {
    pollGpu,
    sample() {
      const cur = readCpus();
      const next = cur.map((c, i) => {
        const p = prev[i];
        if (!p) return 0;
        const dt = c.total - p.total;
        const di = c.idle - p.idle;
        return dt > 0 ? clamp(((dt - di) / dt) * 100) : 0;
      });
      prev = cur;
      cores = next;
      cpu = next.length ? next.reduce((a, b) => a + b, 0) / next.length : 0;

      // Ekran kartı: her 2 sn'de bir (hata sonrası 60 sn'de bir) arka planda.
      const t = now();
      const due = gpu ? t - gpuAt >= GPU_EVERY_MS : t - gpuFailedAt >= GPU_RETRY_MS || (gpuAt === 0 && gpuFailedAt === 0);
      if (due && !polling) void pollGpu();

      const totalB = total();
      const usedB = Math.max(0, totalB - free());
      const ram = totalB > 0 ? (usedB / totalB) * 100 : 0;
      push(cpuS, cpu);
      push(ramS, ram);
      if (gpu) push(gpuS, gpu.util);
      else gpuS.length = 0;
      const g = gpu;
      const subParts = [g ? `GPU ${Math.round(g.util)}%` : 'GPU YOK', `RAM ${Math.round(ram)}%`];
      return {
        label: 'ÇEKİRDEK YÜKÜ',
        value: String(Math.round(cpu)),
        unit: '%',
        sub: subParts.join(' · '),
        cpu: Math.round(cpu * 10) / 10,
        gpu: g ? g.util : null,
        ram: Math.round(ram * 10) / 10,
        vram: g ? round1((g.vramUsedMb / g.vramTotalMb) * 100) : null,
        tempC: g?.tempC ?? null,
        tempSource: g?.tempC != null ? 'gpu' : null,
        gpuName: g?.name ?? null,
        cpuSeries: [...cpuS],
        gpuSeries: [...gpuS],
        ramSeries: [...ramS],
        ramUsedGb: round1(usedB / 2 ** 30),
        ramTotalGb: round1(totalB / 2 ** 30),
        vramUsedGb: g ? round1(g.vramUsedMb / 1024) : null,
        vramTotalGb: g ? round1(g.vramTotalMb / 1024) : null,
        cores: cores.map((c) => Math.round(c)),
        uptimeSec: Math.round(uptime()),
      };
    },
  };
}
