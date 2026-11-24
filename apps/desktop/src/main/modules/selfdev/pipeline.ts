// Koşunun durum makinesi: SAF (elektron, disk, süreç yok). Hangi durumdan hangisine geçilebileceğini söyler; sıra dışı
// geçiş kodla yapılamaz. Orkestrasyon `engine.ts`'tedir.
import type { RunStatus } from './types';

/** Her durumdan geçilebilecek durumlar. */
export const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['planning', 'failed', 'cancelled'],
  planning: ['implementing', 'failed', 'cancelled'],
  implementing: ['verifying', 'failed', 'cancelled'],
  verifying: ['fixing', 'packaging', 'failed', 'cancelled'],
  fixing: ['verifying', 'failed', 'cancelled'],
  packaging: ['ready', 'failed', 'cancelled'],
  // Hazır: kullanıcı kurar ya da vazgeçer.
  ready: ['installing', 'cancelled', 'failed'],
  installing: ['restarting', 'failed'],
  // Yeniden başlatma: yeni sürüm sağlıklıysa kuruldu; kurulum tutmadıysa ya da geri alındıysa terminal durumlar.
  restarting: ['installed', 'failed', 'rolled_back'],
  // Kurulmuş sürüm sonradan geri alınabilir.
  installed: ['rolled_back'],
  failed: [],
  cancelled: [],
  rolled_back: [],
};

/** Terminal durum: koşu bitti (kurulmuş olan geri alınabilir ama koşu sürmüyor). */
export const TERMINAL: ReadonlySet<RunStatus> = new Set(['installed', 'failed', 'cancelled', 'rolled_back']);

/** Boru hattı çalışıyor (iş koşuyor; kullanıcı bekleniyor değil). */
export const WORKING: ReadonlySet<RunStatus> = new Set(['queued', 'planning', 'implementing', 'verifying', 'fixing', 'packaging']);

/** Yeni bir koşu başlamasını engelleyen durumlar: çalışan ya da kurulum/yeniden başlatma süren koşu; `ready` de (önce kur ya da vazgeç). */
export const BLOCKING: ReadonlySet<RunStatus> = new Set([...WORKING, 'ready', 'installing', 'restarting']);

export const canTransition = (from: RunStatus, to: RunStatus): boolean => TRANSITIONS[from].includes(to);
export const isTerminal = (status: RunStatus): boolean => TERMINAL.has(status);
export const isWorking = (status: RunStatus): boolean => WORKING.has(status);
export const isBlocking = (status: RunStatus): boolean => BLOCKING.has(status);

/** Sayfadaki aşama çizgisi: plan → uygulama → sınama → paket → hazır. */
export const STAGES = ['planning', 'implementing', 'verifying', 'packaging', 'ready'] as const;
export type Stage = (typeof STAGES)[number];

/** Durumun aşama çizgisindeki yeri (0-4); çizgiye girmeyen durumlarda `null`. `fixing` sınama aşamasındadır. */
export function stageIndex(status: RunStatus): number | null {
  if (status === 'fixing') return STAGES.indexOf('verifying');
  if (status === 'installing' || status === 'restarting' || status === 'installed' || status === 'rolled_back') return STAGES.length - 1;
  const index = (STAGES as readonly string[]).indexOf(status);
  return index === -1 ? null : index;
}

/** Aşamaya göre kabaca ilerleme (0-1); iş çubuğu içindir. */
export function stageProgress(status: RunStatus): number {
  switch (status) {
    case 'queued':
      return 0.02;
    case 'planning':
      return 0.1;
    case 'implementing':
      return 0.35;
    case 'verifying':
      return 0.65;
    case 'fixing':
      return 0.6;
    case 'packaging':
      return 0.85;
    default:
      return 1;
  }
}

export class IllegalTransition extends Error {
  constructor(
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`geçersiz durum geçişi: ${from} → ${to}`);
    this.name = 'IllegalTransition';
  }
}

/** Geçişi doğrular; geçersizse fırlatır. */
export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransition(from, to);
}
