/**
 * Oynatma: işçiden gelen PCM parçaları sıralı ve boşluksuz çalınır. Mikrofonla aynı pencerede olması şarttır:
 * Chromium'un yankı engellemesi bu sayfanın çaldığı sesi referans alır.
 *
 * Her parça kendi örnekleme hızında bir AudioBuffer olur ve bir öncekinin bittiği ana zamanlanır; bağlam
 * çıkış hızına kendisi çevirir. Durdurma anlıktır: zamanlanmış bütün kaynaklar kesilir.
 */

import type { AudioReport } from '@fuber/shared';
import type { EarconKind } from '../../worker/protocol';

/** İlk parçanın çalınmasından önceki pay: sonraki parça yolda gecikirse boşluk duyulmasın. */
const JITTER_LEAD_S = 0.03;
/** Aygıtın bildirdiği çıkış gecikmesinin kabul edilen üst sınırı (bozuk sürücü saniyeler bildirirse bitiş raporu asılı kalmasın). */
const MAX_OUTPUT_LATENCY_S = 0.5;
const LEVEL_INTERVAL_MS = 40;

interface Scheduled {
  source: AudioBufferSourceNode;
  start: number;
  duration: number;
}

interface Stream {
  id: string;
  scheduled: Scheduled[];
  /** İşçi "başka ses yok" dedi. */
  ended: boolean;
  startedReported: boolean;
  startTimer: number | null;
}

export class Playback {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  /** Bütün konuşma sesi bu kazançtan geçer (kısma); yankı gidericinin referansı da buradan sonra alınır. */
  private master: GainNode | null = null;
  private readonly streams = new Map<string, Stream>();
  /** Bir sonraki parçanın başlayacağı bağlam zamanı. */
  private nextTime = 0;
  private levelTimer: number | null = null;
  private sinkId: string | null = null;

  constructor(
    private readonly report: (report: AudioReport) => void,
    private readonly onLevel: (rms: number, peak: number) => void,
  ) {}

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.context.destination);
      this.master = this.context.createGain();
      this.master.connect(this.analyser);
      this.nextTime = 0;
      if (this.sinkId !== null) void this.applySink();
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  private async applySink(): Promise<void> {
    const context = this.context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    try {
      await context?.setSinkId?.(this.sinkId ?? '');
    } catch {
      // Aygıt yoksa varsayılan çıkışta kalınır.
    }
  }

  setOutput(deviceId: string | null): void {
    this.sinkId = deviceId ?? '';
    void this.applySink();
  }

  enqueue(streamId: string, sampleRate: number, pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const context = this.ensureContext();
    const stream = this.stream(streamId);

    const buffer = context.createBuffer(1, pcm.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 32768;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master ?? this.analyser ?? context.destination);
    const start = Math.max(this.nextTime, context.currentTime + JITTER_LEAD_S);
    source.start(start);
    this.nextTime = start + buffer.duration;

    const item: Scheduled = { source, start, duration: buffer.duration };
    stream.scheduled.push(item);
    source.onended = () => this.onSourceEnded(stream, item);

    if (!stream.startedReported && stream.startTimer === null) {
      const delay = Math.max(0, (start - context.currentTime) * 1000);
      stream.startTimer = window.setTimeout(() => {
        stream.startTimer = null;
        if (!this.streams.has(stream.id)) return;
        stream.startedReported = true;
        this.report({ type: 'playback.started', streamId: stream.id });
      }, delay);
    }
    this.startLevels();
  }

  /** Akışa başka ses gelmeyecek: son parça bitince (ya da hiç ses yoksa hemen) "bitti" bildirilir. */
  end(streamId: string): void {
    const stream = this.stream(streamId);
    stream.ended = true;
    this.finishIfDone(stream);
  }

  /** Çalmayı hemen keser, kuyruğu boşaltır; açık her akış için "kesildi" bildirir. */
  stop(): void {
    const now = this.context?.currentTime ?? 0;
    for (const stream of [...this.streams.values()]) {
      if (stream.startTimer !== null) window.clearTimeout(stream.startTimer);
      let played = 0;
      for (const item of stream.scheduled) {
        played += Math.max(0, Math.min(item.duration, now - item.start));
        item.source.onended = null;
        try {
          item.source.stop();
        } catch {
          // Henüz başlamamış ya da bitmiş kaynak.
        }
        item.source.disconnect();
      }
      this.streams.delete(stream.id);
      this.report({
        type: 'playback.ended',
        streamId: stream.id,
        playedMs: Math.round(played * 1000),
        interrupted: true,
      });
    }
    this.nextTime = 0;
    this.stopLevels();
    this.duck(1, 0);
  }

  /** Çalınan sesi `rampMs` içinde `gain` düzeyine getirir (1 = olağan). Çalma kesilince kendiliğinden 1'e döner. */
  duck(gain: number, rampMs: number): void {
    const master = this.master;
    const context = this.context;
    if (!master || !context) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(Math.min(1, Math.max(0, gain)), now + Math.max(0.005, rampMs / 1000));
  }

  /** Kısa uyarı sesi: dosya yok, iki sinüs notası sentezlenir. */
  earcon(kind: EarconKind): void {
    const context = this.ensureContext();
    const notes: Array<[frequency: number, startMs: number, durationMs: number]> =
      kind === 'heard'
        ? [
            [880, 0, 55],
            [1320, 60, 70],
          ]
        : kind === 'wake'
          ? [[660, 0, 80]]
          : [
              [330, 0, 90],
              [220, 100, 120],
            ];
    for (const [frequency, startMs, durationMs] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + startMs / 1000;
      const end = start + durationMs / 1000;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      // Tıkırtı olmasın diye kısa giriş ve çıkış rampası.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.09, start + 0.008);
      gain.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    }
  }

  /** Çalınan sesin kopyası (sınamada mikrofona geri beslemek için; `Capture.setLoopback`). */
  tap(): MediaStream {
    const context = this.ensureContext();
    const destination = context.createMediaStreamDestination();
    (this.analyser ?? context.destination).connect(destination);
    return destination.stream;
  }

  snapshot(): { playing: boolean; streams: string[]; contextState: string | null } {
    return {
      playing: this.streams.size > 0,
      streams: [...this.streams.keys()],
      contextState: this.context?.state ?? null,
    };
  }

  /**
   * Bağlam saatinde "çalındı" olan örnek hoparlörden bu kadar sonra çıkar (aygıt tamponu). "Bitti" raporu bu kadar
   * geciktirilir: ana süreç mikrofonu Jarvis'in son hecesi hâlâ çalarken kullanıcıya açmasın. Bluetooth'un kendi
   * gecikmesi burada görünmez; onu ana süreçteki koruma süresi karşılar.
   */
  private outputLatency(): number {
    const reported = this.context?.outputLatency ?? 0;
    return Number.isFinite(reported) ? Math.min(MAX_OUTPUT_LATENCY_S, Math.max(0, reported)) : 0;
  }

  private stream(id: string): Stream {
    let stream = this.streams.get(id);
    if (!stream) {
      stream = { id, scheduled: [], ended: false, startedReported: false, startTimer: null };
      this.streams.set(id, stream);
    }
    return stream;
  }

  private onSourceEnded(stream: Stream, item: Scheduled): void {
    item.source.disconnect();
    this.finishIfDone(stream);
  }

  private finishIfDone(stream: Stream): void {
    if (!stream.ended || !this.streams.has(stream.id)) return;
    const context = this.context;
    const last = stream.scheduled.at(-1);
    if (context && last) {
      const remaining = last.start + last.duration + this.outputLatency() - context.currentTime;
      // `onended` son örnekten bir işlem bloğu önce gelebilir; kalan süre kadar sonra yeniden bakılır.
      if (remaining > 0.005) {
        window.setTimeout(() => this.finishIfDone(stream), remaining * 1000 + 10);
        return;
      }
    }
    this.streams.delete(stream.id);
    if (stream.startTimer !== null) window.clearTimeout(stream.startTimer);
    if (last && !stream.startedReported) this.report({ type: 'playback.started', streamId: stream.id });
    const played = stream.scheduled.reduce((sum, item) => sum + item.duration, 0);
    this.report({
      type: 'playback.ended',
      streamId: stream.id,
      playedMs: Math.round(played * 1000),
      interrupted: false,
      outputLatencyMs: Math.round(this.outputLatency() * 1000),
    });
    if (this.streams.size === 0) this.stopLevels();
  }

  private startLevels(): void {
    if (this.levelTimer !== null) return;
    const data = new Float32Array(1024);
    this.levelTimer = window.setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      for (const value of data) {
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
      }
      this.onLevel(Math.sqrt(sum / data.length), peak);
    }, LEVEL_INTERVAL_MS);
  }

  private stopLevels(): void {
    if (this.levelTimer === null) return;
    window.clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.onLevel(0, 0);
  }
}
