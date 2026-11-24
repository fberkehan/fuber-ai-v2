/**
 * Ses konağının girişi (`dist/tts-host/index.js`): ekran kartında çalışan seslendirme motorlarının süreci.
 * Electron'da `utilityProcess` (ana süreç `main/voice/tts-host.ts` ile yönetir, ses örnekleri MessagePort üzerinden
 * doğrudan ses işçisine gider); ölçüm ve sınama betiklerinde düz Node alt süreci (iletiler IPC kanalından).
 *
 * Yaşam döngüsü: `hello` → `init` (çalışma zamanı + birincil motor yüklenir, ısınır) → `ready`. Açılamazsa `failed`
 * bildirilir ve süreç kapanır; ana süreç zincirdeki sıradaki cihazla (CUDA → DirectML → işlemci) yenisini başlatır.
 *
 * Sıra tektir: cümleler geliş sırasıyla üretilir. `cancel` gelince bekleyenler atılır; süren üretim bir sonraki adım
 * arasında bırakılır (adımlar ≤ ~30 ms; ONNX çağrısı sürerken ileti işlenemez).
 */

import { createRequire } from 'node:module';
import { TTS_HOST_ENGINE_IDS, type TtsHostEngineId } from '@fuber/shared';
import type { HostEngine } from './engine';
import { HOST_ENGINES } from './engines/index';
import { loadOrt, type Ort } from './ort';
import type { SynthReply, SynthRequest, TtsHostCommand, TtsHostConfig, TtsHostEvent } from './protocol';

interface PortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
}

type ParentMessage = { data: TtsHostCommand; ports?: PortLike[] };

const utilityParent = (process as unknown as { parentPort?: { on(event: 'message', listener: (event: ParentMessage) => void): void; postMessage(message: unknown): void } }).parentPort;

const toParent = (event: TtsHostEvent): void => {
  if (utilityParent) utilityParent.postMessage(event);
  else process.send?.(event);
};
const log = (level: 'info' | 'warn' | 'error', message: string): void => toParent({ type: 'log', level, message });

let config: TtsHostConfig | null = null;
let ort: Ort | null = null;
const engines = new Map<TtsHostEngineId, HostEngine>();
/** Ses işçisine giden port; yoksa (sınama) yanıtlar ana kanaldan gider. */
let port: PortLike | null = null;
/** `cancel` her çağrıda artar; eski işler kendini bununla tanıyıp ses yollamaz. */
let epoch = 0;
let chain: Promise<void> = Promise.resolve();

const reply = (message: SynthReply): void => {
  if (port) port.postMessage(message);
  else toParent(message);
};

const breathe = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function toPcm(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = Math.round(value * 32767);
  }
  return pcm;
}

/** Sağlayıcı kitaplığı sürece gerçekten yüklendi mi (yalnız Windows): "ekran kartında" sözü buna dayanır. */
function moduleLoaded(name: string): boolean {
  if (process.platform !== 'win32') return true;
  try {
    const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi');
    const handle = koffi.load('kernel32.dll').func('void* GetModuleHandleW(const char16_t*)')(name);
    return handle !== null && handle !== undefined;
  } catch {
    return true;
  }
}

async function engineFor(id: TtsHostEngineId): Promise<HostEngine> {
  const existing = engines.get(id);
  if (existing) return existing;
  if (!config || !ort) throw new Error('ses konağı kurulmadı');
  const files = config.engines[id];
  if (!files) throw new Error('motorun model dosyaları bu bilgisayarda hazır değil');
  const engine = HOST_ENGINES[id]({ ort, device: config.device, dir: files.dir, log });
  try {
    await engine.load();
  } catch (error) {
    engine.dispose();
    throw error;
  }
  engines.set(id, engine);
  return engine;
}

const shortError = (error: unknown): string => String((error as Error)?.message ?? error).replace(/\s+/g, ' ').slice(0, 300);

async function init(next: TtsHostConfig): Promise<void> {
  config = next;
  const started = performance.now();
  const fail = (stage: 'runtime' | 'model' | 'warmup', message: string): void => {
    toParent({ type: 'failed', stage, message });
    // Yarım kurulmuş çalışma zamanıyla devam edilmez: süreç kapanır, ana süreç sıradaki cihazı dener.
    setTimeout(() => process.exit(3), 50);
  };
  if (next.failDevices?.includes(next.device)) return fail('runtime', `sınama: ${next.device} açılamamış sayıldı`);
  try {
    ort = loadOrt({ runtimeDir: next.runtimeDir, device: next.device });
  } catch (error) {
    return fail('runtime', shortError(error));
  }
  let engine: HostEngine;
  try {
    engine = await engineFor(next.primary.engine);
    if (next.device === 'cuda' && !moduleLoaded('onnxruntime_providers_cuda.dll')) throw new Error('CUDA sağlayıcısı yüklenmedi');
    if (next.device === 'directml' && !moduleLoaded('DirectML.dll')) throw new Error('DirectML yüklenmedi');
  } catch (error) {
    return fail('model', shortError(error));
  }
  const loaded = performance.now();
  try {
    await engine.warm(next.primary.voice);
  } catch (error) {
    return fail('warmup', shortError(error));
  }
  toParent({
    type: 'ready',
    engine: next.primary.engine,
    voice: next.primary.voice,
    device: next.device,
    runtime: ort.version,
    sampleRate: engine.sampleRate,
    loadMs: Math.round(loaded - started),
    warmMs: Math.round(performance.now() - loaded),
  });
  settleLater(next.primary.engine, engine, next.primary.voice);
}

/**
 * Isınmanın devamını sıranın dışında, sıra boşken koşturur: her adımdan önce o an sırada bekleyen işler (cümleler)
 * beklenir, sonra tek bir kısa adım atılır. Motor bırakıldıysa (başka motor seçildi) kesilir.
 */
function settleLater(id: TtsHostEngineId, engine: HostEngine, voice: string): void {
  if (!engine.settle) return;
  const pause = async (): Promise<boolean> => {
    // Sıranın o anki kuyruğu bitene dek bekle; beklerken eklenenler de bitsin diye kuyruk değişmeyene dek yinele.
    for (let tail = chain; ; tail = chain) {
      await tail;
      await breathe();
      if (tail === chain) break;
    }
    return engines.get(id) === engine;
  };
  void engine.settle(voice, pause).catch((error) => log('warn', `arka plan ısınması yarıda kaldı: ${shortError(error)}`));
}

function speak(request: Extract<SynthRequest, { type: 'speak' }>): void {
  const mine = epoch;
  chain = chain.then(async () => {
    if (mine !== epoch) return reply({ type: 'done', id: request.id, samples: 0, firstChunkMs: null, cancelled: true });
    const started = performance.now();
    let samples = 0;
    let firstChunkMs: number | null = null;
    try {
      const engine = await engineFor(request.engine);
      const sampleRate = engine.sampleRate;
      await engine.synth({
        text: request.text,
        voice: request.voice,
        language: request.language,
        cancelled: () => mine !== epoch,
        breathe,
        emit(chunk) {
          if (mine !== epoch || chunk.length === 0) return;
          if (firstChunkMs === null) firstChunkMs = Math.round(performance.now() - started);
          samples += chunk.length;
          reply({ type: 'chunk', id: request.id, pcm: toPcm(chunk), sampleRate });
        },
      });
      const cancelled = mine !== epoch;
      if (!cancelled && samples > 0 && config && config.sentenceSilence > 0) {
        const silence = new Int16Array(Math.round(config.sentenceSilence * sampleRate));
        samples += silence.length;
        reply({ type: 'chunk', id: request.id, pcm: silence, sampleRate });
      }
      reply({ type: 'done', id: request.id, samples: cancelled ? 0 : samples, firstChunkMs, cancelled });
    } catch (error) {
      // İstenen motor hiç yüklenemediyse (dosyası yok, model okunamadı) hata motora özgüdür: konak sağlamdır.
      reply({ type: 'error', id: request.id, message: shortError(error), ...(engines.has(request.engine) ? {} : { engine: true }) });
    }
  });
}

function select(engineId: TtsHostEngineId, voice: string): void {
  chain = chain.then(async () => {
    const started = performance.now();
    try {
      const engine = await engineFor(engineId);
      const loaded = performance.now();
      await engine.warm(voice);
      // Seçilmeyen motorlar bırakılır: ekran belleği yalnız konuşan motor kadar dolu kalır.
      for (const [id, other] of engines) {
        if (id === engineId) continue;
        other.dispose();
        engines.delete(id);
      }
      toParent({ type: 'selected', engine: engineId, voice, sampleRate: engine.sampleRate, loadMs: Math.round(loaded - started), warmMs: Math.round(performance.now() - loaded) });
      // Yeni yüklenen motorun kalan girdi boyları da arka planda ısınır (zaten yüklüyse yalnız ses değişmiştir).
      if (loaded - started > 50) settleLater(engineId, engine, voice);
    } catch (error) {
      toParent({ type: 'failed', stage: 'select', message: shortError(error) });
    }
  });
}

function attachPort(next: PortLike): void {
  port?.close?.();
  port = next;
  next.on('message', (event) => handleSynth(event.data as SynthRequest));
  next.start?.();
}

function handleSynth(request: SynthRequest): void {
  if (request.type === 'speak') {
    if (!(TTS_HOST_ENGINE_IDS as readonly string[]).includes(request.engine)) return reply({ type: 'error', id: request.id, message: `bilinmeyen motor: ${String(request.engine)}` });
    speak(request);
  } else if (request.type === 'cancel') {
    epoch++;
  }
}

function handle(command: TtsHostCommand, ports: PortLike[] = []): void {
  switch (command.type) {
    case 'init':
      if (ports[0]) attachPort(ports[0]);
      chain = chain.then(() => init(command.config));
      break;
    case 'port':
      if (ports[0]) attachPort(ports[0]);
      break;
    case 'engines':
      // Sıraya girer: ardından gelen `select` / `speak` yeni klasörü görür.
      chain = chain.then(() => {
        if (!config) return;
        for (const [id, entry] of Object.entries(command.engines) as Array<[TtsHostEngineId, { dir: string } | null]>) {
          if (entry) config.engines[id] = entry;
          else delete config.engines[id];
        }
      });
      break;
    case 'select':
      select(command.engine, command.voice);
      break;
    case 'shutdown':
      epoch++;
      for (const engine of engines.values()) engine.dispose();
      engines.clear();
      process.exit(0);
      break;
    default:
      handleSynth(command);
  }
}

const guard = (run: () => void): void => {
  try {
    run();
  } catch (error) {
    log('error', `ses konağı: ${shortError(error)}`);
  }
};

if (utilityParent) {
  utilityParent.on('message', (event) => guard(() => handle(event.data, event.ports)));
} else if (process.send) {
  process.on('message', (message) => guard(() => handle(message as TtsHostCommand)));
  // Üst süreç kapanırsa (ölçüm betiği kesildi) artık süreç kalmasın.
  process.on('disconnect', () => process.exit(0));
}

toParent({ type: 'hello' });
