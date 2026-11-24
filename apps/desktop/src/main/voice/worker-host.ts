/**
 * Ses işçisinin (`utilityProcess`) yaşam döngüsü: başlatma, ses penceresine port teslimi, çökünce yeniden
 * başlatma. İşçi yerel kitaplık (sherpa-onnx) taşır; orada olan bir çökme ana süreci düşürmez.
 */

import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import type { Logger } from '@fuber/shared';
import type { WorkerCommand, WorkerConfig, WorkerEvent } from '../../worker/protocol';

const RESTART_BACKOFF_MS = [500, 2000, 8000, 30_000];

export interface WorkerHostOptions {
  /** `dist/worker/index.js`. */
  path: string;
  log: Logger;
  onEvent(event: WorkerEvent): void;
  /** Yeni portun ses penceresi ucunu teslim eder. Pencere hazır değilse fırlatabilir. */
  deliverPort(port: MessagePortMain): void;
  /** İşçi beklenmedik biçimde kapandı (yeniden başlatma planlandı). */
  onCrash(): void;
}

export class WorkerHost {
  private child: UtilityProcess | null = null;
  private config: WorkerConfig | null = null;
  private stopping = false;
  private crashes = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: WorkerHostOptions) {}

  get restarts(): number {
    return this.crashes;
  }

  start(config: WorkerConfig): void {
    this.config = config;
    this.stopping = false;
    this.spawn();
  }

  /** Yapılandırma değişti (uyandırma sözü): işçi yeni ayarla baştan başlar. */
  restart(config: WorkerConfig): void {
    this.config = config;
    this.kill();
    this.spawn();
  }

  /** Ses penceresi yeniden yüklendi: yeni bir kanal açılır, iki uç yeniden teslim edilir. */
  renewPort(): void {
    if (!this.child) return;
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ type: 'port' } satisfies WorkerCommand, [port1]);
    this.options.deliverPort(port2);
  }

  /** `ports`: komutla birlikte teslim edilen portlar (ör. ses konağının kanalı). */
  send(command: WorkerCommand, ports?: MessagePortMain[]): void {
    this.child?.postMessage(command, ports);
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.postMessage({ type: 'shutdown' } satisfies WorkerCommand);
    // Nazikçe kapanmazsa (yerel kitaplık takıldı) süreç sonlandırılır.
    setTimeout(() => child.kill(), 500).unref();
  }

  private kill(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  private spawn(): void {
    const { log } = this.options;
    const config = this.config;
    if (!config) return;
    const child = utilityProcess.fork(this.options.path, [], { serviceName: 'Fuber AI 2 ses', stdio: 'pipe' });
    this.child = child;

    // sherpa-onnx ve Piper uyarılarını stderr'e yazar; okunmazsa boru dolar.
    child.stdout?.on('data', (chunk: Buffer) => log.debug(`işçi: ${chunk.toString('utf8').trim()}`));
    child.stderr?.on('data', (chunk: Buffer) => log.debug(`işçi: ${chunk.toString('utf8').trim()}`));

    child.on('message', (event: WorkerEvent) => {
      if (this.child !== child) return;
      if (event.type === 'hello') {
        try {
          const { port1, port2 } = new MessageChannelMain();
          child.postMessage({ type: 'init', config } satisfies WorkerCommand, [port1]);
          this.options.deliverPort(port2);
        } catch (error) {
          log.error('ses işçisine port teslim edilemedi', error);
        }
        return;
      }
      if (event.type === 'ready') this.crashes = 0;
      this.options.onEvent(event);
    });

    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopping) return;
      const delay = RESTART_BACKOFF_MS[Math.min(this.crashes, RESTART_BACKOFF_MS.length - 1)] ?? 30_000;
      this.crashes++;
      log.warn(`ses işçisi kapandı (kod ${code}); ${delay} ms sonra yeniden başlatılacak`);
      this.options.onCrash();
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (!this.stopping) this.spawn();
      }, delay);
    });
  }
}
