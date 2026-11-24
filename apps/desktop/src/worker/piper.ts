/**
 * Yerel TTS: Piper'ın kendi çalıştırıcısı, sürekli açık bir alt süreç olarak.
 *
 * Neden sherpa-onnx değil: 2.x sürümü espeak-ng'yi çıkardı; Piper sesleri espeak fonemleriyle eğitildi ve
 * Türkçe için elle yazılmış bir fonem çevirici (sayılar, kısaltmalar, vurgu) espeak'i tutturamıyor.
 *
 * Protokol: stdin'e satır başına bir JSON (`{"text": …}`), stdout'tan ham 16 bit PCM. Cümlenin bittiği,
 * stderr'deki "Real-time factor" satırından anlaşılır; o satır ses yazıldıktan sonra basılır.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import { piperSafeText } from './piper-safe';
import type { WorkerConfig } from './protocol';
import { speakableText } from './tts-router';

/** Bitiş satırından sonra borularda kalmış olabilecek son ses parçası için beklenen süre. */
const SETTLE_MS = 20;
const DONE_LINE = /Real-time factor/;

export interface PiperChunk {
  pcm: Int16Array;
  sampleRate: number;
}

interface Job {
  text: string;
  onChunk(chunk: PiperChunk): void;
  resolve(result: { samples: number; firstChunkMs: number | null }): void;
  reject(error: Error): void;
  startedAt: number;
  samples: number;
  firstChunkMs: number | null;
  /** İptal edildi: süreç cümleyi bitirene kadar beklenir ama sesi atılır. */
  discarded: boolean;
}

export class Piper {
  readonly sampleRate: number;
  private child: ChildProcessWithoutNullStreams | null = null;
  private current: Job | null = null;
  private readonly queue: Job[] = [];
  private stderrBuffer = '';
  /** Tek baytlık artık: boru parçaları örnek sınırında bölünmeyebilir. */
  private carry: Buffer | null = null;
  private stopped = false;

  constructor(
    private readonly config: NonNullable<WorkerConfig['piper']>,
    private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void,
  ) {
    const voiceConfig = JSON.parse(fs.readFileSync(`${config.voice}.json`, 'utf8')) as {
      audio?: { sample_rate?: number };
    };
    this.sampleRate = voiceConfig.audio?.sample_rate ?? 22_050;
    this.spawn();
  }

  private spawn(): void {
    const child = spawn(
      this.config.exe,
      [
        '--model',
        this.config.voice,
        '--espeak_data',
        this.config.espeakData,
        '--output-raw',
        '--json-input',
        '--sentence_silence',
        String(this.config.sentenceSilence),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child = child;
    this.stderrBuffer = '';
    this.carry = null;

    child.stdout.on('data', (data: Buffer) => this.onAudio(data));
    child.stderr.on('data', (data: Buffer) => this.onLog(data));
    child.stdin.on('error', () => {
      // Süreç kapanırken yazma hatası `exit` ile birlikte ele alınır.
    });
    child.on('error', (error) => this.onExit(`başlatılamadı: ${error.message}`));
    child.on('exit', (code) => this.onExit(`kapandı (kod ${code ?? '?'})`));
  }

  private onAudio(data: Buffer): void {
    const job = this.current;
    let bytes = this.carry ? Buffer.concat([this.carry, data]) : data;
    this.carry = null;
    if (bytes.length % 2 === 1) {
      this.carry = bytes.subarray(bytes.length - 1);
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    if (!job || job.discarded || bytes.length === 0) return;
    // Kopya: boru tamponu yeniden kullanılır ve hizası Int16 için garanti değildir.
    const pcm = new Int16Array(bytes.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
    if (job.firstChunkMs === null) job.firstChunkMs = Math.round(performance.now() - job.startedAt);
    job.samples += pcm.length;
    job.onChunk({ pcm, sampleRate: this.sampleRate });
  }

  private onLog(data: Buffer): void {
    this.stderrBuffer += data.toString('utf8');
    let newline: number;
    while ((newline = this.stderrBuffer.indexOf('\n')) >= 0) {
      const line = this.stderrBuffer.slice(0, newline);
      this.stderrBuffer = this.stderrBuffer.slice(newline + 1);
      if (DONE_LINE.test(line)) {
        const job = this.current;
        setTimeout(() => this.finish(job), SETTLE_MS);
      } else if (/\[error\]/i.test(line)) {
        this.log('error', `piper: ${line.trim().slice(0, 300)}`);
      }
    }
  }

  private finish(job: Job | null): void {
    if (!job || this.current !== job) return;
    this.current = null;
    this.carry = null;
    job.resolve({ samples: job.discarded ? 0 : job.samples, firstChunkMs: job.firstChunkMs });
    this.pump();
  }

  private onExit(reason: string): void {
    if (!this.child) return;
    this.child = null;
    const failed = [this.current, ...this.queue.splice(0)];
    this.current = null;
    if (!this.stopped) this.log('warn', `piper ${reason}`);
    for (const job of failed) job?.reject(new Error(`piper ${reason}`));
  }

  private pump(): void {
    if (this.current || this.stopped) return;
    const job = this.queue.shift();
    if (!job) return;
    if (!this.child) this.spawn();
    this.current = job;
    job.startedAt = performance.now();
    this.child?.stdin.write(`${JSON.stringify({ text: job.text })}\n`, 'utf8');
  }

  /**
   * Metni seslendirir; ses parçaları üretildikçe `onChunk` ile verilir. Çözülen değer üretilen toplam örnek
   * sayısıdır (iptal edildiyse 0). Okunacak bir şey yoksa süreç çağrılmadan 0 döner.
   */
  speak(text: string, onChunk: (chunk: PiperChunk) => void): Promise<{ samples: number; firstChunkMs: number | null }> {
    // Son süzgeç: Piper bazı simgelerde (oklar…) erişim ihlaliyle çöküyor; yalnız güvenli küme gider (`piper-safe.ts`).
    const speakable = piperSafeText(speakableText(text));
    if (!speakable) return Promise.resolve({ samples: 0, firstChunkMs: null });
    return new Promise((resolve, reject) => {
      this.queue.push({
        text: speakable,
        onChunk,
        resolve,
        reject,
        startedAt: 0,
        samples: 0,
        firstChunkMs: null,
        discarded: false,
      });
      this.pump();
    });
  }

  /** Bekleyenleri atar; süren cümlenin kalan sesi yutulur. */
  cancel(): void {
    for (const job of this.queue.splice(0)) job.resolve({ samples: 0, firstChunkMs: null });
    if (this.current) this.current.discarded = true;
  }

  stop(): void {
    this.stopped = true;
    this.cancel();
    const child = this.child;
    this.child = null;
    try {
      child?.stdin.end();
      child?.kill();
    } catch {
      // Zaten kapanmış.
    }
  }
}
