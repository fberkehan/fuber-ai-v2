// Bilgisayarın donanımı (`self_status` aracı için): ekran kartı `nvidia-smi`'den, o yoksa WMI'dan; işlemci ve RAM
// işletim sisteminden. Yalnız okur. Kullanıcı "ekran kartımı görebiliyor musun?" diye sorduğunda model "okuyamıyorum"
// deyip ardından donanım hakkında uydurmuştu; bu dosya soruyu gerçek değerle yanıtlatır.
import { execFile } from 'node:child_process';
import os from 'node:os';

export interface GpuInfo {
  name: string;
  /** Toplam ve boş ekran belleği (MiB); ölçülemezse `null` (WMI 4 GB üstünü doğru bildirmez, o yoldan bellek okunmaz). */
  totalMiB: number | null;
  freeMiB: number | null;
}

export interface HardwareInfo {
  gpus: GpuInfo[];
  cpu: { model: string; threads: number } | null;
  ram: { totalGB: number; freeGB: number };
}

export type Exec = (file: string, args: string[]) => Promise<string>;

const run: Exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  );

/** `nvidia-smi` çıktısı: satır başına "ad, toplam, boş" (MiB). */
export function parseNvidiaSmi(out: string): GpuInfo[] {
  return out
    .split(/\r?\n/)
    .map((line) => line.split(',').map((part) => part.trim()))
    .filter((parts) => parts.length >= 3 && parts[0])
    .map(([name, total, free]) => {
      const totalMiB = Number.parseInt(total ?? '', 10);
      const freeMiB = Number.parseInt(free ?? '', 10);
      return { name: name!, totalMiB: Number.isFinite(totalMiB) ? totalMiB : null, freeMiB: Number.isFinite(freeMiB) ? freeMiB : null };
    });
}

/** WMI çıktısı (`ConvertTo-Json`): tek nesne ya da dizi; yalnız adlar alınır. */
export function parseWmiGpus(out: string): GpuInfo[] {
  try {
    const parsed = JSON.parse(out) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((item) => (typeof item === 'object' && item !== null ? String((item as { Name?: unknown }).Name ?? '').trim() : ''))
      .filter(Boolean)
      .map((name) => ({ name, totalMiB: null, freeMiB: null }));
  } catch {
    return [];
  }
}

async function readGpus(exec: Exec): Promise<GpuInfo[]> {
  try {
    const gpus = parseNvidiaSmi(await exec('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits']));
    if (gpus.length) return gpus;
  } catch {
    // NVIDIA sürücüsü yok: WMI denenir.
  }
  if (process.platform !== 'win32') return [];
  try {
    return parseWmiGpus(
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress']),
    );
  } catch {
    return [];
  }
}

const GB = 1024 ** 3;

export async function readHardware(exec: Exec = run): Promise<HardwareInfo> {
  const cpus = os.cpus();
  return {
    gpus: await readGpus(exec),
    cpu: cpus[0] ? { model: cpus[0].model.replace(/\s+/g, ' ').trim(), threads: cpus.length } : null,
    ram: { totalGB: Math.round(os.totalmem() / GB), freeGB: Math.round(os.freemem() / GB) },
  };
}

/** MiB → "16" ya da "3,9" (tam sayıya çok yakınsa ondalıksız: 16.376 MiB "16 GB"tır). */
const gb = (mib: number) => {
  const value = mib / 1024;
  return Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
};

/** Modele giden tek satırlık donanım özeti. Okunamayan parça "okunamadı" diye yazılır. */
export function describeHardware(info: HardwareInfo): string {
  const gpu = info.gpus.length
    ? info.gpus
        .map((item) => (item.totalMiB !== null ? `${item.name} (${gb(item.totalMiB)} GB ekran belleği${item.freeMiB !== null ? `, şu an ${gb(item.freeMiB)} GB boş` : ''})` : item.name))
        .join('; ')
    : 'okunamadı';
  const cpu = info.cpu ? `${info.cpu.model} (${info.cpu.threads} iş parçacığı)` : 'okunamadı';
  return `Bu bilgisayarın donanımı: ekran kartı ${gpu}. İşlemci ${cpu}. RAM ${info.ram.totalGB} GB (şu an ${info.ram.freeGB} GB boş).`;
}
