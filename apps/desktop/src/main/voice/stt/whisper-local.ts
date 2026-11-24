/**
 * Yerel Whisper: `whisper-server.exe` (whisper.cpp, CUDA) alt süreci. Yalnız 127.0.0.1'de, rastgele boş
 * portta dinler; ses bu bilgisayardan çıkmaz ve diske yazılmaz.
 *
 * v1'den alınan dersler (kod değil):
 * - Sunucu ekran kartını bulamazsa SESSİZCE işlemciye düşer ve her istek ~11 sn sürer. Burada günlükte
 *   "using CUDA backend" satırı görülmeden motor hazır sayılmaz; görülmezse açık hata verilir.
 * - Sunucu `-m` yolunu dar karakterle okur; Türkçe harfli yolda açılışta çöker (0xC0000409). Çalışma dizini
 *   modelin klasörü yapılır ve yol olarak yalnız dosya adı verilir; böylece kullanıcı adında "ş/ğ/İ" olsa da çalışır.
 * - Çıktı okunmazsa boru dolar ve sunucu asılır; `error` olayı dinlenmezse ana süreç düşer.
 */

import { spawn as nodeSpawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AUDIO_SAMPLE_RATE, t, type Logger, type Unsubscribe } from '@fuber/shared';
import { removeFile } from '../model-files';
import { encodeWav } from '../wav';
import { filterTranscript, joinSegments, languageConfidence, likelyLanguage, preFilter, type RawTranscript } from './hallucination';
import { SttError, type SttEngine, type SttResult, type SttStatus } from './types';

/** Üst üste bu kadar başlatma denemesi boşa çıkarsa motor `failed` olur. */
export const MAX_START_ATTEMPTS = 3;
/** Denemeler arası bekleme (ms): üstel. */
export const RESTART_BACKOFF_MS = [500, 2000, 8000];
const READY_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 150;
const REQUEST_TIMEOUT_MS = 15_000;
const LOG_TAIL_BYTES = 16_384;
const PROMPT_MAX_CHARS = 600;

/** Alt sürecin bu dosyanın kullandığı kadarı (sınamada sahte süreç verilebilsin diye). */
export interface ServerProcess {
  pid?: number;
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): void } | null;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  kill(): boolean;
}

export interface WhisperIo {
  spawn(exe: string, args: string[], cwd: string): ServerProcess;
  fetch: typeof fetch;
  freePort(): Promise<number>;
  sleep(ms: number): Promise<void>;
}

export interface WhisperLocalOptions {
  /** `whisper-server.exe` mutlak yolu. */
  serverExe: string;
  /** GGML model dosyasının mutlak yolu. */
  modelFile: string;
  language: 'tr' | 'en';
  log: Logger;
  /** Asistanın adı; ilk istemde geçer ki Whisper adı tanısın ve cümlenin başından atmasın. */
  assistantName: string;
  /** Önceki oturumdan kalan süreci bulmak için PID dosyası; verilmezse artık süreç aranmaz. */
  pidFile?: string;
  io?: Partial<WhisperIo>;
}

/**
 * Whisper'ın ilk istemi. Ölçüm (16 Kas 2026, sekiz sentetik cümle): istem yalnız "Jarvis" iken model baştaki adı
 * bir cümlede tümüyle attı ("Carvis, bana uzun bir hikaye anlat" → "bana uzun bir hikaye anlat"); bu betimleyici
 * cümleyle sekizinde de "Jarvis, …" yazdı ve listedeki özel adları ("KDV") doğru çıkardı.
 * Cümle bilerek adla BAŞLAMAZ: model gürültüde istemi yankılarsa döküm uyandırma sözü gibi görünmez.
 */
/**
 * Kısa bölütün dur-sözcüğü okuması (d6): `voice.mjs dur-hizli` koşusunda temiz "Dur." (0,76 sn) olağan istemle
 * "Gördüğünüz gibi." yazıldı ve Jarvis susmadı. Cümleler üç sözcükten kısa olduğu için istem yankısı süzgeci
 * (`isPromptEcho`) bunları yakalamaz; sonuç yalnız dur-sözcüğüyse kullanılır (`session.ts` › `stopRecheck`).
 */
export const STOP_HINT_PROMPT = 'Dur. Sus. Yeter. Bir dakika. Bekle. Kes.';

export function buildInitialPrompt(language: 'tr' | 'en', assistantName: string, vocabulary: string[]): string {
  const name = assistantName.trim();
  const names = [...new Set([name, ...vocabulary.map((word) => word.trim())].filter(Boolean))];
  const prompt =
    language === 'tr'
      ? `Bu, ${name} adlı asistanla yapılan bir konuşmadır. Geçen adlar: ${names.join(', ')}.`
      : `This is a conversation with an assistant named ${name}. Names mentioned: ${names.join(', ')}.`;
  return prompt.slice(0, PROMPT_MAX_CHARS);
}

/** Sunucu günlüğünden hesaplamanın nerede yapıldığı: `cuda`, `cpu` (ekran kartı bulunamadı) ya da henüz belli değil. */
export function backendFromLog(log: string): 'cuda' | 'cpu' | null {
  if (/no GPU found/i.test(log) || /whisper_backend_init_gpu: device \d+: CPU/i.test(log)) return 'cpu';
  if (/whisper_backend_init_gpu: using CUDA\d* backend/i.test(log)) return 'cuda';
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

const defaultIo: WhisperIo = {
  spawn: (exe, args, cwd) => nodeSpawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }),
  fetch: (...args) => fetch(...args),
  freePort,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Önceki oturum düzgün kapanmadıysa sunucusu ekran kartı belleğini tutmaya devam eder. PID dosyasındaki süreç
 * hâlâ yaşıyor VE çalıştırılabilir yolu bizimkiyle aynıysa kapatılır; başka uygulamanın (Fuber AI 1) sunucusuna dokunulmaz.
 */
function reapStaleServer(pidFile: string, serverExe: string, log: Logger): void {
  let pid: number;
  try {
    pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    removeFile(pidFile);
  } catch {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0 || process.platform !== 'win32') return;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`],
    { windowsHide: true, timeout: 10_000 },
    (error, stdout) => {
      if (error) return;
      if (path.resolve(stdout.trim()).toLowerCase() !== path.resolve(serverExe).toLowerCase()) return;
      try {
        process.kill(pid);
        log.warn(`önceki oturumdan kalan whisper-server kapatıldı (pid ${pid})`);
      } catch {
        // Bu arada kendiliğinden kapanmış.
      }
    },
  );
}

export function createWhisperLocal(options: WhisperLocalOptions): SttEngine {
  const io: WhisperIo = { ...defaultIo, ...options.io };
  const log = options.log;
  const listeners = new Set<(status: SttStatus) => void>();

  let status: SttStatus = { state: 'stopped', reason: null, gpu: null, crashes: 0 };
  let child: ServerProcess | null = null;
  let baseUrl: string | null = null;
  let vocabulary: string[] = [];
  /** `start()`/`stop()` her çağrıda artar; eski bir başlatma döngüsü kendini bununla tanıyıp bırakır. */
  let epoch = 0;
  let running: Promise<void> | null = null;

  const setStatus = (patch: Partial<SttStatus>): void => {
    status = { ...status, ...patch };
    for (const listener of [...listeners]) listener(status);
  };

  const killChild = (): void => {
    const current = child;
    child = null;
    baseUrl = null;
    try {
      current?.kill();
    } catch {
      // Zaten kapanmış.
    }
    if (options.pidFile) removeFile(options.pidFile);
  };

  /** Tek başlatma denemesi. `ready`: çalışıyor · `retry`: geçici sorun · `fatal`: yeniden denemek anlamsız. */
  const launchOnce = async (myEpoch: number): Promise<{ result: 'ready' | 'retry' | 'fatal'; reason: string }> => {
    const port = await io.freePort();
    const threads = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)));
    const args = [
      '-m',
      path.basename(options.modelFile),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-l',
      options.language,
      '-t',
      String(threads),
      // Konuşma dışı simgeleri ("[Müzik]", "♪") bastırır; halüsinasyon süzgecinin ilk katmanı.
      '-sns',
    ];
    let serverLog = '';
    let exited = false;
    let spawned: ServerProcess;
    try {
      spawned = io.spawn(options.serverExe, args, path.dirname(options.modelFile));
    } catch (error) {
      log.error('whisper-server başlatılamadı', error);
      return { result: 'retry', reason: t('voice.stt.spawnFailed') };
    }
    child = spawned;
    if (options.pidFile && spawned.pid) {
      try {
        fs.writeFileSync(options.pidFile, String(spawned.pid));
      } catch {
        // PID dosyası yalnız artık süreç temizliği içindir.
      }
    }
    const collect = (chunk: Buffer) => {
      serverLog = (serverLog + chunk.toString('utf8')).slice(-LOG_TAIL_BYTES);
    };
    spawned.stdout?.on('data', collect);
    spawned.stderr?.on('data', collect);
    spawned.on('error', (error) => {
      exited = true;
      log.error('whisper-server süreç hatası', error);
    });
    spawned.on('exit', (code) => {
      exited = true;
      if (child !== spawned) return;
      // Hazırken kapandıysa çökmedir: yeniden başlatma döngüsü devreye girer.
      child = null;
      baseUrl = null;
      if (status.state === 'ready' && myEpoch === epoch) {
        log.warn(`whisper-server beklenmedik biçimde kapandı (kod ${code ?? '?'})`);
        setStatus({ state: 'restarting', reason: t('voice.stt.crashed'), crashes: status.crashes + 1 });
        running = supervise(myEpoch, true);
      }
    });

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (myEpoch !== epoch) return { result: 'fatal', reason: '' };
      if (exited) {
        log.warn('whisper-server hazır olmadan kapandı', serverLog.slice(-600));
        return { result: 'retry', reason: t('voice.stt.exitedEarly') };
      }
      try {
        const response = await io.fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          const backend = backendFromLog(serverLog);
          if (backend !== 'cuda') {
            log.error('whisper-server ekran kartını kullanmıyor', serverLog.slice(-600));
            setStatus({ gpu: false });
            return { result: 'fatal', reason: t('voice.stt.noGpu') };
          }
          baseUrl = url;
          return { result: 'ready', reason: '' };
        }
      } catch {
        // Model yüklenene kadar bağlantı reddedilir.
      }
      await io.sleep(HEALTH_POLL_MS);
    }
    return { result: 'retry', reason: t('voice.stt.startTimeout') };
  };

  /** Hazır olana ya da deneme hakkı bitene kadar başlatır. `afterCrash`: ilk denemeden önce de beklenir. */
  const supervise = async (myEpoch: number, afterCrash: boolean): Promise<void> => {
    for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt++) {
      if (attempt > 0 || afterCrash) {
        await io.sleep(RESTART_BACKOFF_MS[Math.min(attempt, RESTART_BACKOFF_MS.length - 1)] ?? 500);
      }
      if (myEpoch !== epoch) return;
      const { result, reason } = await launchOnce(myEpoch);
      if (myEpoch !== epoch) return;
      // Sağlık denetimi geçtikten hemen sonra kapanan süreç hazır sayılmaz.
      if (result === 'ready' && child) {
        setStatus({ state: 'ready', reason: null, gpu: true });
        log.info(`whisper-server hazır (ekran kartında, deneme ${attempt + 1})`);
        return;
      }
      killChild();
      if (result === 'fatal') {
        setStatus({ state: 'failed', reason });
        return;
      }
      if (attempt + 1 < MAX_START_ATTEMPTS) setStatus({ state: 'restarting', reason });
      else setStatus({ state: 'failed', reason: t('voice.stt.unavailable') });
    }
  };

  const buildPrompt = (): string => buildInitialPrompt(options.language, options.assistantName, vocabulary);

  const parse = (body: unknown): RawTranscript => {
    const json = (body ?? {}) as {
      text?: unknown;
      segments?: Array<{ no_speech_prob?: unknown; text?: unknown }>;
      language_probabilities?: Record<string, unknown>;
    };
    // Sunucunun `text` alanı bölütleri satır sonuyla birleştirir ve sözcüğü ortasından böler; bölütlerden kurulur.
    const pieces = (json.segments ?? []).map((segment) => segment.text).filter((piece): piece is string => typeof piece === 'string');
    const whole = typeof json.text === 'string' ? json.text : '';
    const probs = (json.segments ?? [])
      .map((segment) => segment.no_speech_prob)
      .filter((value): value is number => typeof value === 'number');
    const languages: Record<string, number> = {};
    for (const [code, value] of Object.entries(json.language_probabilities ?? {})) {
      if (typeof value === 'number') languages[code] = value;
    }
    return {
      text: joinSegments(pieces.length > 0 ? pieces : whole.split(/\r?\n/)),
      noSpeechProb: probs.length > 0 ? Math.max(...probs) : null,
      languageProbabilities: Object.keys(languages).length > 0 ? languages : null,
    };
  };

  return {
    id: 'whisper-local',

    start() {
      if (status.state === 'ready' || status.state === 'starting' || status.state === 'restarting') {
        return running ?? Promise.resolve();
      }
      if (options.pidFile) reapStaleServer(options.pidFile, options.serverExe, log);
      const myEpoch = ++epoch;
      setStatus({ state: 'starting', reason: null, gpu: null });
      running = supervise(myEpoch, false);
      return running;
    },

    async stop() {
      epoch++;
      killChild();
      setStatus({ state: 'stopped', reason: null });
    },

    status: () => status,

    onStatus(listener): Unsubscribe {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    setVocabulary(words) {
      vocabulary = words;
    },

    async transcribe(pcm, request = {}): Promise<SttResult> {
      const skipped = preFilter(pcm);
      if (skipped) return { text: '', raw: '', dropped: skipped, durationMs: 0, languageConfidence: null };

      // Yeniden başlatma sürüyorsa kısa bir süre beklenir; söz boşa gitmesin.
      if ((status.state === 'starting' || status.state === 'restarting') && running) {
        await Promise.race([running, io.sleep(10_000)]);
      }
      const url = baseUrl;
      if (status.state !== 'ready' || !url) {
        throw new SttError('not_ready', status.reason ?? t('voice.stt.unavailable'));
      }

      const form = new FormData();
      form.append('file', new Blob([encodeWav(pcm, AUDIO_SAMPLE_RATE)], { type: 'audio/wav' }), 'speech.wav');
      form.append('temperature', '0.0');
      form.append('temperature_inc', '0.2');
      form.append('response_format', 'verbose_json');
      const language = request.language ?? options.language;
      form.append('language', language);
      // Türkçe istem başka dildeki sesi Türkçeye çekebilir: istem yalnız istemin kendi dilinde verilir.
      const prompt =
        request.hint === 'stop' && language === 'tr'
          ? STOP_HINT_PROMPT
          : language === options.language
            ? buildPrompt()
            : language === 'en'
              ? buildInitialPrompt('en', options.assistantName, vocabulary)
              : '';
      if (prompt) form.append('prompt', prompt);

      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const started = performance.now();
      let body: unknown;
      try {
        const response = await io.fetch(`${url}/inference`, { method: 'POST', body: form, signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = await response.json();
      } catch (error) {
        if (request.signal?.aborted) throw new SttError('aborted', t('voice.stt.aborted'));
        if (timeout.aborted) throw new SttError('timeout', t('voice.stt.timeout'));
        if (!child) throw new SttError('crashed', t('voice.stt.crashed'));
        log.warn('whisper isteği başarısız', error);
        throw new SttError('failed', t('voice.stt.requestFailed'));
      }
      const raw = parse(body);
      const custom = request.language !== undefined && request.language !== options.language;
      const filtered = filterTranscript(raw, (pcm.length / AUDIO_SAMPLE_RATE) * 1000, prompt, custom ? request.language : undefined);
      return {
        text: filtered.text,
        raw: raw.text.trim(),
        dropped: filtered.dropped,
        durationMs: Math.round(performance.now() - started),
        languageConfidence: languageConfidence(raw, custom ? request.language : undefined),
        detectedLanguage: likelyLanguage(raw),
      };
    },
  };
}
