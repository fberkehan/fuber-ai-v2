/**
 * Ses konağının (`utilityProcess`; ekran kartında çalışan seslendirme motorları) yaşam döngüsü ve DÜŞÜŞ ZİNCİRİ.
 *
 * İstenen motor için cihazlar sırayla denenir (`TTS_ENGINES[motor].devices`: CUDA → DirectML → işlemci). Her deneme
 * ayrı bir süreçtir: süreç başına tek `onnxruntime.dll` yüklenebilir ve CUDA'nın açılamaması ancak süreç içinde
 * anlaşılır. Deneme `ready` derse konak hazırdır ve ses işçisine bir port teslim edilir; `failed` derse, hazır olmadan
 * kapanırsa ya da süresi dolarsa neden kaydedilir ve sıradaki cihaza geçilir. Hiçbiri açılmazsa durum `failed` olur:
 * ses işçisi cümleleri Piper ile okur ve neden tanıda görünür (`attempts`).
 *
 * Hazırken çöken konak aynı cihazla yeniden başlatılır (bekleme süresi artarak); kısa sürede ikinci kez çökerse o
 * cihaz bırakılır ve zincirde bir alta inilir. Uygulama kapanınca süreç `stop()` ile kapatılır; `utilityProcess`
 * olduğu için ana süreç ölürse de yaşamaz.
 *
 * Electron'a dokunan tek yer `defaultSpawn`'dır; sınamada sahte süreç verilir.
 */

import { TTS_ENGINES, TTS_HOST_ENGINE_IDS, type Logger, type TtsDevice, type TtsHostEngineId } from '@fuber/shared';
import type { TtsHostCommand, TtsHostConfig, TtsHostEvent } from '../../tts-host/protocol';
import type { TtsHostInfo } from '../../worker/protocol';

/** Bir cihaz denemesinin en çok süreceği süre (model yükleme + ısınma; soğuk diskte CUDA kitaplıkları ≈1,3 GB). */
const START_TIMEOUT_MS = 90_000;
const RESTART_BACKOFF_MS = [500, 2000, 8000];
/** Hazır olduktan sonra bu süre içinde çöken cihaz "tutmuyor" sayılır (iki kez olursa zincirde alta inilir). */
const UNSTABLE_WINDOW_MS = 60_000;
/**
 * Geçici bir sıkışma (ör. yerel beyin ekran belleğini aldı) yüzünden zincirde alta inildiyse, daha önce AÇILABİLMİŞ
 * (kanıtlı) üst cihaza geri dönmek için beklenecek süreler. Artan bekleme: ekran kartı hâlâ doluysa boşuna açıp kapama
 * savaşına girilmez. İlk deneme bir dakika sonra, sonra beş dakika, sonra yarım saatte bir.
 */
const RECLIMB_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

/** Port çifti (Electron `MessageChannelMain`); sınamada sahte. */
export interface HostChannel<Port> {
  host: Port;
  worker: Port;
}

/** Alt sürecin burada kullanılan kadarı. */
export interface HostChild<Port> {
  postMessage(message: TtsHostCommand, ports?: Port[]): void;
  onMessage(listener: (event: TtsHostEvent) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export interface HostWant {
  engine: TtsHostEngineId;
  voice: string;
}

export interface HostState {
  /** İstenen (ya da çalışan) motor; konak hiç istenmediyse `null`. */
  engine: TtsHostEngineId | null;
  voice: string | null;
  /** `off`: istenmiyor · `starting`: deneniyor · `ready`: konuşabilir · `failed`: hiçbir cihazda açılamadı. */
  phase: 'off' | 'starting' | 'ready' | 'failed';
  /** Çalıştığı (hazırken) ya da o an denenen cihaz. */
  device: TtsDevice | null;
  /** `failed` iken kısa neden (Türkçe). */
  reason: string | null;
  /** Bu istek için denenip açılamayan cihazlar. */
  attempts: Array<{ device: TtsDevice; error: string }>;
  /** Dosyalar eksik olduğu için mi açılamadı (dosyalar gelince yeniden denenir). */
  missingFiles: boolean;
  sampleRate: number | null;
  runtime: string | null;
  loadMs: number | null;
  warmMs: number | null;
  restarts: number;
}

export interface TtsHostOptions<Port> {
  log: Logger;
  /** Cihazın ONNX çalışma zamanı klasörü (mutlak); dosyaları hazır değilse `null`. */
  runtimeDir(device: TtsDevice): string | null;
  /** Motorun model klasörü (mutlak); dosyaları hazır değilse `null`. */
  engineDir(engine: TtsHostEngineId): string | null;
  sentenceSilence: number;
  /** Yalnız sınamada: bu cihazlar açılamamış sayılır. */
  failDevices?: TtsDevice[];
  spawn(): HostChild<Port>;
  channel(): HostChannel<Port>;
  /** Konak hazır (ya da ses işçisi için yeni port açıldı): port ses işçisine teslim edilir. */
  onPort(port: Port, info: TtsHostInfo): void;
  /** Durum değişti (hazır, düştü, motor değişti, kapandı). */
  onState(state: HostState): void;
  /**
   * Çalışan konak istenen motora GEÇEMEDİ (model yüklenemedi ya da dosyaları hazır değil). Konak eski motorla
   * konuşmayı sürdürür; çağıran nedeni kullanıcıya gösterir ve "yeniden dene"yi sunar. Sessizce yutulmaz.
   */
  onSelectFailed?(want: HostWant, message: string): void;
  startTimeoutMs?: number;
  backoffMs?: number[];
}

const OFF: HostState = {
  engine: null,
  voice: null,
  phase: 'off',
  device: null,
  reason: null,
  attempts: [],
  missingFiles: false,
  sampleRate: null,
  runtime: null,
  loadMs: null,
  warmMs: null,
  restarts: 0,
};

export class TtsHost<Port> {
  private want: HostWant | null = null;
  private current: HostState = { ...OFF };
  private child: HostChild<Port> | null = null;
  /** `want` ya da `stop` her çağrıda artar; eski bir denemenin olayları bununla ayıklanır. */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bu istekte denenecek cihazlar ve sıradaki. */
  private devices: TtsDevice[] = [];
  private deviceIndex = 0;
  private readyAt = 0;
  private unstable = 0;
  private stopped = false;
  /** Çalışan konağa yollanmış ve yanıtı beklenen motor / ses değişimi. */
  private selecting: HostWant | null = null;
  /** Bu çalıştırmada en az bir kez HAZIR olmuş cihazlar: donanım gerçekten açılabiliyor, geri dönmeye değer. */
  private proven = new Set<TtsDevice>();
  /** Üst (kanıtlı) cihaza geri dönmeyi bekleyen zamanlayıcı. */
  private climbTimer: ReturnType<typeof setTimeout> | null = null;
  /** Art arda başarısız geri dönüşler: bekleme bununla uzar (ekran kartı hâlâ doluysa savaşa girilmez). */
  private climbTries = 0;

  constructor(private readonly options: TtsHostOptions<Port>) {}

  state(): HostState {
    return { ...this.current, attempts: [...this.current.attempts] };
  }

  /** Hazırsa ses işçisine verilecek bilgi. */
  info(): TtsHostInfo | null {
    const { phase, engine, voice, device, sampleRate } = this.current;
    return phase === 'ready' && engine && voice && device && sampleRate ? { engine, voice, device, sampleRate } : null;
  }

  private publish(patch: Partial<HostState>): void {
    this.current = { ...this.current, ...patch };
    this.options.onState(this.state());
  }

  /**
   * İstenen motoru ve sesi bildirir. `null`: konak istenmiyor (kapatılır). Aynı istek yinelenirse bir şey olmaz;
   * motor ya da ses değiştiyse çalışan konak öbür motoru yükler (süreç yeniden başlamaz).
   */
  request(next: HostWant | null): void {
    if (this.stopped) return;
    const same = next?.engine === this.want?.engine && next?.voice === this.want?.voice;
    if (same && (next === null || this.current.phase === 'starting' || this.current.phase === 'ready')) return;
    // Aynı istek ve durum `failed`: yeniden denemek `retry()`nin işidir (dosyalar geldi); burada döngüye girilmez.
    if (same && this.current.phase === 'failed') return;
    if (!next) {
      this.want = null;
      return this.shutdown();
    }
    if (this.child && this.current.phase === 'ready') {
      // Çalışan konak: öbür motoru / sesi yükle. Yeni motor hazır olana dek eskisi konuşmayı sürdürür.
      if (this.options.engineDir(next.engine) === null) {
        // Dosyaları (henüz) yok: konağa hiç sorulmaz, istek değişmez; dosyalar gelince çağıran yeniden ister.
        this.options.log.warn(`ses konağı: ${next.engine} seçilemedi (model dosyaları hazır değil); ${this.current.engine ?? '?'} konuşmayı sürdürüyor`);
        this.options.onSelectFailed?.(next, 'model dosyaları hazır değil');
        return;
      }
      this.want = next;
      this.select(next);
      return;
    }
    this.want = next;
    this.begin(next);
  }

  /**
   * Konağa motorların güncel model klasörlerini bildirir. Konak, klasörleri BAŞLARKEN alır; sonradan hazır olan bir
   * motoru (indirme bitti; açılışta dosyalar konaktan birkaç ms sonra yerleşti) ancak bu iletiyle tanır.
   */
  enginesChanged(): void {
    if (!this.child || this.current.phase !== 'ready') return;
    const engines: Partial<Record<TtsHostEngineId, { dir: string } | null>> = {};
    for (const id of TTS_HOST_ENGINE_IDS) {
      const dir = this.options.engineDir(id);
      engines[id] = dir === null ? null : { dir };
    }
    this.child.postMessage({ type: 'engines', engines });
  }

  private select(want: HostWant): void {
    if (!this.child) return;
    this.enginesChanged();
    this.selecting = want;
    this.child.postMessage({ type: 'select', engine: want.engine, voice: want.voice });
  }

  /** Dosyalar hazır oldu (indirildi) ya da kullanıcı yeniden denemek istedi: başarısız istek baştan denenir. */
  retry(): void {
    if (this.stopped || !this.want) return;
    if (this.current.phase === 'failed') return this.begin(this.want);
    // Konak çalışıyor: yeni hazır olan motorların klasörleri bildirilir ("Dinle" ve sonraki seçim görsün).
    this.enginesChanged();
  }

  /** Zinciri baştan kurar (ör. CUDA çalışma zamanı sonradan indi; konak daha alt bir cihazda çalışıyor). */
  restart(): void {
    if (this.stopped || !this.want) return;
    this.begin(this.want);
  }

  /** İstenen motoru yeniden seçtirir: "Dinle" için fazladan yüklenen öteki motor bırakılır. */
  reselect(): void {
    if (this.stopped || !this.want || !this.child || this.current.phase !== 'ready') return;
    this.select(this.want);
  }

  /** Ses işçisi konağın bir cümleyi üretemediğini bildirdi: süreç asılıdır; kapatılıp yeniden başlatılır. */
  reportFailure(message: string): void {
    if (this.stopped || !this.want || this.current.phase !== 'ready') return;
    this.options.log.warn(`ses konağı yanıt vermedi (${message}); yeniden başlatılıyor`);
    const child = this.child;
    this.child = null;
    child?.kill();
    this.crashed(this.generation, 'yanıt vermedi');
  }

  /** Ses işçisi yeniden başladı: çalışan konağa yeni bir kanal açılır. */
  renewPort(): void {
    const info = this.info();
    if (!this.child || !info) return;
    const channel = this.options.channel();
    this.child.postMessage({ type: 'port' }, [channel.host]);
    this.options.onPort(channel.worker, info);
  }

  stop(): void {
    this.stopped = true;
    this.want = null;
    this.shutdown();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearClimb(): void {
    if (this.climbTimer) clearTimeout(this.climbTimer);
    this.climbTimer = null;
  }

  /** O an zincirde, geçerli cihazın ÜSTÜNDE daha önce açılmış (kanıtlı) bir cihaz var mı? */
  private provenAbove(): boolean {
    return this.devices.slice(0, this.deviceIndex).some((device) => this.proven.has(device));
  }

  /**
   * Hazırız ama alt bir cihazdayız (geçici sıkışma zincirde aşağı itti). Üstte daha önce açılabilmiş bir cihaz varsa,
   * bir süre sonra kullanıcının SEÇTİĞİ cihaza geri dönmeyi dener. En üstteyken ya da üstte kanıtlı cihaz yokken geri
   * dönüş kurulmaz (bekleme sıfırlanır): kalıcı olarak CPU'da kalınmaz, boşuna da uğraşılmaz.
   */
  private scheduleClimb(): void {
    this.clearClimb();
    if (this.stopped || !this.want || this.current.phase !== 'ready') return;
    if (!this.provenAbove()) {
      this.climbTries = 0;
      return;
    }
    const delay = RECLIMB_BACKOFF_MS[Math.min(this.climbTries, RECLIMB_BACKOFF_MS.length - 1)] ?? RECLIMB_BACKOFF_MS[0]!;
    this.climbTimer = setTimeout(() => this.climb(), delay);
    this.climbTimer.unref?.();
  }

  /** Geri dönüş zamanı geldi: zinciri baştan (en üst cihazdan) kurar; seçilen motor ve ses (`this.want`) korunur. */
  private climb(): void {
    this.climbTimer = null;
    if (this.stopped || !this.want || this.current.phase !== 'ready' || this.deviceIndex === 0) return;
    if (!this.provenAbove()) return;
    this.climbTries++;
    this.options.log.info(`ses konağı: seçilen cihaza geri dönülüyor (şu an ${this.current.device}); zincir baştan kuruluyor`);
    this.begin(this.want);
  }

  private shutdown(): void {
    this.generation++;
    this.clearTimer();
    this.clearClimb();
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.postMessage({ type: 'shutdown' });
      } catch {
        // Süreç zaten kapanmış.
      }
      // Nazikçe kapanmazsa (ekran kartı sürücüsü takıldı) süreç sonlandırılır.
      setTimeout(() => child.kill(), 500).unref?.();
    }
    if (this.current.phase !== 'off' || this.current.engine !== null) this.publish({ ...OFF, restarts: this.current.restarts });
  }

  /** İstek için cihaz zincirini kurar ve ilk denemeyi başlatır. */
  private begin(want: HostWant): void {
    this.generation++;
    this.selecting = null;
    this.clearTimer();
    this.clearClimb();
    const old = this.child;
    this.child = null;
    old?.kill();
    this.unstable = 0;
    const base = { engine: want.engine, voice: want.voice, sampleRate: null, runtime: null, loadMs: null, warmMs: null };
    if (this.options.engineDir(want.engine) === null) {
      this.publish({ ...base, phase: 'failed', device: null, attempts: [], missingFiles: true, reason: 'model dosyaları hazır değil' });
      return;
    }
    // Çalışma zamanı dosyaları hazır olan cihazlar, katalog sırasıyla.
    this.devices = TTS_ENGINES[want.engine].devices.filter((device): device is TtsDevice => device !== 'cloud' && this.options.runtimeDir(device) !== null);
    this.deviceIndex = 0;
    if (this.devices.length === 0) {
      this.publish({ ...base, phase: 'failed', device: null, attempts: [], missingFiles: true, reason: 'ONNX çalışma zamanı dosyaları hazır değil' });
      return;
    }
    this.publish({ ...base, phase: 'starting', device: this.devices[0] ?? null, attempts: [], missingFiles: false, reason: null });
    this.attempt(this.generation);
  }

  private attempt(generation: number): void {
    const want = this.want;
    const device = this.devices[this.deviceIndex];
    if (!want || generation !== this.generation) return;
    if (!device) {
      const attempts = this.current.attempts;
      const reason = attempts.length > 0 ? attempts.map((item) => `${item.device}: ${item.error}`).join(' · ') : 'ses konağı açılamadı';
      this.options.log.warn(`ses konağı hiçbir cihazda açılamadı (${reason})`);
      this.publish({ phase: 'failed', device: null, reason });
      return;
    }
    const runtimeDir = this.options.runtimeDir(device);
    if (runtimeDir === null) return this.failAttempt(generation, device, 'çalışma zamanı dosyaları hazır değil');

    const engines: TtsHostConfig['engines'] = {};
    for (const id of TTS_HOST_ENGINE_IDS) {
      const dir = this.options.engineDir(id);
      if (dir !== null) engines[id] = { dir };
    }
    const config: TtsHostConfig = {
      device,
      runtimeDir,
      engines,
      primary: { engine: want.engine, voice: want.voice },
      sentenceSilence: this.options.sentenceSilence,
      ...(this.options.failDevices?.length ? { failDevices: this.options.failDevices } : {}),
    };

    let child: HostChild<Port>;
    try {
      child = this.options.spawn();
    } catch (error) {
      return this.failAttempt(generation, device, `süreç başlatılamadı: ${(error as Error).message}`);
    }
    this.child = child;
    this.publish({ phase: 'starting', device });
    let workerPort: Port | null = null;
    let settled = false;

    this.clearTimer();
    this.timer = setTimeout(() => {
      if (settled || generation !== this.generation) return;
      settled = true;
      child.kill();
      this.failAttempt(generation, device, 'zaman aşımı');
    }, this.options.startTimeoutMs ?? START_TIMEOUT_MS);
    this.timer.unref?.();

    child.onMessage((event) => {
      if (generation !== this.generation || this.child !== child) return;
      switch (event.type) {
        case 'hello': {
          const channel = this.options.channel();
          workerPort = channel.worker;
          child.postMessage({ type: 'init', config }, [channel.host]);
          break;
        }
        case 'ready': {
          if (settled) return;
          settled = true;
          this.clearTimer();
          this.readyAt = Date.now();
          this.options.log.info(
            `ses konağı hazır: ${event.engine} / ${event.voice}, ${event.device} (ONNX Runtime ${event.runtime}; yükleme ${event.loadMs} ms, ısınma ${event.warmMs} ms)`,
          );
          this.publish({ phase: 'ready', engine: event.engine, voice: event.voice, device: event.device, sampleRate: event.sampleRate, runtime: event.runtime, loadMs: event.loadMs, warmMs: event.warmMs, reason: null });
          this.proven.add(event.device);
          const info = this.info();
          if (workerPort && info) this.options.onPort(workerPort, info);
          // Alt bir cihazdaysak ve üstte daha önce açılmış bir cihaz varsa, ekran belleği boşalınca geri dönmeyi dene.
          this.scheduleClimb();
          break;
        }
        case 'selected':
          this.selecting = null;
          this.options.log.info(`ses konağı: motor ${event.engine} / ${event.voice} (yükleme ${event.loadMs} ms, ısınma ${event.warmMs} ms)`);
          this.publish({ engine: event.engine, voice: event.voice, sampleRate: event.sampleRate, loadMs: event.loadMs, warmMs: event.warmMs });
          break;
        case 'failed':
          if (event.stage === 'select') {
            // Öbür motor yüklenemedi: çalışan motor konuşmayı sürdürür; istek o motora geri alınır ve çağırana
            // AÇIKÇA bildirilir (arayüz "seçildi" demesin; kullanıcı nedeni görsün, yeniden deneyebilsin).
            const failedWant = this.selecting ?? this.want;
            this.selecting = null;
            this.options.log.warn(`ses konağı: motor değiştirilemedi (${event.message}); ${this.current.engine ?? '?'} konuşmayı sürdürüyor`);
            if (this.current.engine && this.current.voice) this.want = { engine: this.current.engine, voice: this.current.voice };
            if (failedWant) this.options.onSelectFailed?.(failedWant, event.message);
            break;
          }
          if (settled) return;
          settled = true;
          this.clearTimer();
          child.kill();
          this.failAttempt(generation, device, event.message);
          break;
        case 'log':
          this.options.log[event.level](`ses konağı: ${event.message}`);
          break;
        default:
          break;
      }
    });

    child.onExit((code) => {
      if (generation !== this.generation || this.child !== child) return;
      this.child = null;
      if (!settled) {
        settled = true;
        this.clearTimer();
        this.failAttempt(generation, device, `hazır olmadan kapandı (kod ${code ?? '?'})`);
        return;
      }
      if (this.current.phase === 'ready') this.crashed(generation, `kapandı (kod ${code ?? '?'})`);
    });
  }

  /** Bu cihaz açılamadı: nedeni kaydet, sıradaki cihazı dene. */
  private failAttempt(generation: number, device: TtsDevice, error: string): void {
    if (generation !== this.generation) return;
    this.child = null;
    this.options.log.warn(`ses konağı ${device} ile açılamadı: ${error}`);
    this.publish({ attempts: [...this.current.attempts, { device, error }] });
    this.deviceIndex++;
    this.attempt(generation);
  }

  /** Hazırken düştü: aynı cihazla yeniden başlat; kısa sürede yinelenirse zincirde alta in. */
  private crashed(generation: number, detail: string): void {
    if (generation !== this.generation) return;
    const device = this.devices[this.deviceIndex];
    const quick = Date.now() - this.readyAt < UNSTABLE_WINDOW_MS;
    this.unstable = quick ? this.unstable + 1 : 0;
    const restarts = this.current.restarts + 1;
    this.options.log.warn(`ses konağı ${detail}; yeniden başlatılacak`);
    if (this.unstable >= 2 && device) {
      this.unstable = 0;
      this.publish({ phase: 'starting', restarts, attempts: [...this.current.attempts, { device, error: `art arda çöktü (${detail})` }] });
      this.deviceIndex++;
    } else {
      this.publish({ phase: 'starting', restarts });
    }
    const backoff = this.options.backoffMs ?? RESTART_BACKOFF_MS;
    const delay = backoff[Math.min(this.unstable, backoff.length - 1)] ?? 500;
    this.clearTimer();
    this.timer = setTimeout(() => this.attempt(generation), delay);
    this.timer.unref?.();
  }
}
