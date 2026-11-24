/**
 * Ses konağının (ekran kartında çalışan motorlar; `tts-host/`) ses işçisindeki ucu. Konak ayrı süreçtir; cümle metni
 * MessagePort ile gider, ses örnekleri aynı porttan gelir. Yönlendirici (`tts-router.ts`) bunu "yerel ses" olarak
 * kullanır: konak yanıt vermezse ya da hata döndürürse O CÜMLE Piper ile okunur.
 *
 * Port her an kopabilir (konak çöktü, yeniden başlıyor): bekleyen iş reddedilir ve yönlendirici alt halkaya düşer.
 */

import type { TtsDevice, TtsHostEngineId } from '@fuber/shared';
import type { SynthReply, SynthRequest } from '../tts-host/protocol';
import type { SynthChunk } from './tts-router';

/** İlk ses parçası bu sürede gelmezse konak asılı sayılır (ekran kartında bir cümle ≤ 0,3 sn sürer). */
export const HOST_FIRST_CHUNK_TIMEOUT_MS = 4000;
/** Parçalar arasında en çok bu kadar beklenir (uzun metin: parça başına bir pencere ya da cümle). */
const HOST_STALL_TIMEOUT_MS = 6000;

/** `MessagePortMain`'in burada kullanılan kadarı (sınamada sahte port verilebilsin diye). */
export interface HostPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
}

export interface HostInfo {
  engine: TtsHostEngineId;
  voice: string;
  device: TtsDevice;
  sampleRate: number;
}

/**
 * Konaktan gelen hatanın türü. `engine`: istenen motor yüklenemedi (dosyası yok, model okunamadı); konak SAĞLAMDIR,
 * yeniden başlatılmaz. `synth`: üretim sırasında hata. `hang`: yanıt gelmedi. `closed`: bağlantı koptu.
 */
export type HostFailureKind = 'engine' | 'synth' | 'hang' | 'closed';

interface Job {
  onChunk(chunk: SynthChunk): void;
  resolve(result: { samples: number; firstChunkMs: number | null }): void;
  reject(error: Error): void;
  samples: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class HostSynth {
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly port: HostPort,
    /** Konağın yüklü birincil motoru; `tts.config` ile güncellenir. */
    public info: HostInfo,
    private readonly options: { firstChunkTimeoutMs?: number } = {},
  ) {
    port.on('message', (event) => this.onReply(event.data as SynthReply));
    port.on('close', () => this.fail('ses konağıyla bağlantı koptu'));
    port.start?.();
  }

  get sampleRate(): number {
    return this.info.sampleRate;
  }

  get usable(): boolean {
    return !this.closed;
  }

  private arm(id: number, job: Job, ms: number): void {
    if (job.timer) clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      if (!this.jobs.delete(id)) return;
      // Asılı kalan üretim atılır; sonraki cümle temiz başlasın.
      this.post({ type: 'cancel' });
      job.reject(Object.assign(new Error('ses konağı yanıt vermedi'), { samples: job.samples, kind: 'hang' as HostFailureKind }));
    }, ms);
  }

  private post(message: SynthRequest): void {
    try {
      this.port.postMessage(message);
    } catch {
      this.fail('ses konağına ileti gönderilemedi');
    }
  }

  private onReply(reply: SynthReply): void {
    const job = this.jobs.get(reply.id);
    if (!job) return;
    if (reply.type === 'chunk') {
      job.samples += reply.pcm.length;
      this.arm(reply.id, job, HOST_STALL_TIMEOUT_MS);
      job.onChunk({ pcm: reply.pcm instanceof Int16Array ? reply.pcm : new Int16Array(reply.pcm as ArrayBuffer), sampleRate: reply.sampleRate });
      return;
    }
    this.jobs.delete(reply.id);
    if (job.timer) clearTimeout(job.timer);
    if (reply.type === 'done') job.resolve({ samples: reply.cancelled ? 0 : reply.samples, firstChunkMs: reply.firstChunkMs });
    else job.reject(Object.assign(new Error(reply.message), { samples: job.samples, kind: (reply.engine ? 'engine' : 'synth') as HostFailureKind }));
  }

  /** Bekleyen bütün işleri reddeder ve ucu kullanılamaz yapar. */
  private fail(message: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, job] of [...this.jobs]) {
      this.jobs.delete(id);
      if (job.timer) clearTimeout(job.timer);
      job.reject(Object.assign(new Error(message), { samples: job.samples, kind: 'closed' as HostFailureKind }));
    }
  }

  /**
   * Cümleyi konakta seslendirir. `override`: yüklü birincil motor yerine başka bir motor ya da ses ("Dinle").
   * Hata (konak çöktü, yanıt yok, model hatası) fırlatılır; `samples` o ana dek çalınan örnek sayısıdır.
   */
  speak(
    text: string,
    onChunk: (chunk: SynthChunk) => void,
    language: 'tr' | 'en' = 'tr',
    override: { engine?: TtsHostEngineId; voice?: string } = {},
  ): Promise<{ samples: number; firstChunkMs: number | null }> {
    if (this.closed) return Promise.reject(Object.assign(new Error('ses konağı bağlı değil'), { samples: 0, kind: 'closed' as HostFailureKind }));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const job: Job = { onChunk, resolve, reject, samples: 0, timer: null };
      this.jobs.set(id, job);
      // Başka bir motor ilk kez isteniyorsa o an yüklenir; süre buna göre uzun tutulur.
      const loading = override.engine !== undefined && override.engine !== this.info.engine;
      this.arm(id, job, loading ? 30_000 : (this.options.firstChunkTimeoutMs ?? HOST_FIRST_CHUNK_TIMEOUT_MS));
      this.post({ type: 'speak', id, engine: override.engine ?? this.info.engine, voice: override.voice ?? this.info.voice, text, language });
    });
  }

  /** Bekleyen ve süren üretimi atar; işler "üretilmedi" diye çözülür. */
  cancel(): void {
    if (this.closed) return;
    for (const [id, job] of [...this.jobs]) {
      this.jobs.delete(id);
      if (job.timer) clearTimeout(job.timer);
      job.resolve({ samples: 0, firstChunkMs: null });
    }
    this.post({ type: 'cancel' });
  }

  close(): void {
    this.fail('ses konağı kapatıldı');
    try {
      this.port.close?.();
    } catch {
      // Zaten kapanmış.
    }
  }
}
