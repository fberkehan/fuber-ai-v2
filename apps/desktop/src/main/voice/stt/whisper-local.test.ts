import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Logger } from '@fuber/shared';
import { SttError, type SttStatus } from './types';
import {
  MAX_START_ATTEMPTS,
  backendFromLog,
  buildInitialPrompt,
  createWhisperLocal,
  type ServerProcess,
  type WhisperIo,
} from './whisper-local';

const CUDA_LOG = [
  'ggml_cuda_init: found 1 CUDA devices (Total VRAM: 16375 MiB):',
  'whisper_init_with_params_no_state: use gpu    = 1',
  'whisper_backend_init_gpu: device 0: CUDA0 (type: 1)',
  'whisper_backend_init_gpu: using CUDA0 backend',
].join('\n');
const CPU_LOG = ['whisper_init_with_params_no_state: use gpu    = 1', 'whisper_backend_init_gpu: no GPU found'].join('\n');

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };

class FakeServer extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    if (!this.killed) {
      this.killed = true;
      queueMicrotask(() => this.emit('exit', null));
    }
    return true;
  }
}

/** Sahte ortam: `plan` her başlatma denemesinin nasıl sonuçlanacağını söyler. */
function setup(plan: Array<'cuda' | 'cpu' | 'exit'>) {
  const spawned: FakeServer[] = [];
  const sleeps: number[] = [];
  const requests: Array<{ url: string; form: FormData | null }> = [];
  let inference: () => Response | Promise<Response> = () =>
    Response.json({ text: ' Yarın saat onda hatırlat.\n', segments: [{ no_speech_prob: 0.01 }], language_probabilities: { tr: 0.9 } });

  const io: WhisperIo = {
    spawn: (_exe, args, cwd) => {
      const server = new FakeServer();
      const outcome = plan[spawned.length] ?? 'cuda';
      spawned.push(server);
      Object.assign(server, { args, cwd, outcome });
      queueMicrotask(() => {
        if (outcome === 'exit') server.emit('exit', 3221226505);
        else server.stderr.emit('data', Buffer.from(outcome === 'cuda' ? CUDA_LOG : CPU_LOG));
      });
      return server as unknown as ServerProcess;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const server = spawned.at(-1);
      if (!server || server.killed || (server as unknown as { outcome: string }).outcome === 'exit') throw new Error('ECONNREFUSED');
      if (url.endsWith('/inference')) {
        requests.push({ url, form: init?.body as FormData });
        return inference();
      }
      requests.push({ url, form: null });
      return new Response('ok');
    }) as typeof fetch,
    freePort: async () => 50_000 + spawned.length,
    sleep: async (ms) => {
      sleeps.push(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
  const engine = createWhisperLocal({
    serverExe: 'C:\\Kullanıcı Şükrü\\models\\whisper\\v1.9.2-cuda\\whisper-server.exe',
    modelFile: 'C:\\Kullanıcı Şükrü\\models\\whisper\\ggml-large-v3-turbo-q5_0.bin',
    language: 'tr',
    assistantName: 'Jarvis',
    log,
    io,
  });
  const history: SttStatus['state'][] = [];
  engine.onStatus((status) => {
    if (history.at(-1) !== status.state) history.push(status.state);
  });
  const waitFor = async (state: SttStatus['state']) => {
    for (let i = 0; i < 500 && engine.status().state !== state; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(engine.status().state).toBe(state);
  };
  return { engine, spawned, sleeps, requests, history, waitFor, setInference: (fn: typeof inference) => (inference = fn) };
}

const speech = (() => {
  const pcm = new Int16Array(16_000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 10) * 8000);
  return pcm;
})();

describe('sunucu günlüğünden donanım', () => {
  it('CUDA kullanımını ve işlemciye düşüşü ayırır', () => {
    expect(backendFromLog(CUDA_LOG)).toBe('cuda');
    expect(backendFromLog(CPU_LOG)).toBe('cpu');
    // Kart bulundu ama arka uç yüklenemedi: kanıt yoksa "bilinmiyor".
    expect(backendFromLog('ggml_cuda_init: found 1 CUDA devices')).toBeNull();
    expect(backendFromLog('whisper_backend_init_gpu: device 0: CPU (type: 0)')).toBe('cpu');
  });
});

describe('whisper-local yaşam döngüsü', () => {
  it('modeli yalnız dosya adıyla ve modelin klasöründen başlatır (Türkçe harfli yol sorunu)', async () => {
    const h = setup(['cuda']);
    await h.engine.start();
    expect(h.engine.status()).toMatchObject({ state: 'ready', gpu: true, crashes: 0 });
    const server = h.spawned[0] as unknown as { args: string[]; cwd: string };
    expect(server.cwd).toBe('C:\\Kullanıcı Şükrü\\models\\whisper');
    expect(server.args.slice(0, 2)).toEqual(['-m', 'ggml-large-v3-turbo-q5_0.bin']);
    // Argümanlarda ASCII dışı karakter yok.
    expect(server.args.join(' ')).toMatch(/^[\x20-\x7e]+$/);
    expect(server.args).toContain('127.0.0.1');
    expect(server.args[server.args.indexOf('-l') + 1]).toBe('tr');
  });

  it('ekran kartı kullanılmıyorsa hazır saymaz, işlemcide sessizce çalışmaz, yeniden de denemez', async () => {
    const h = setup(['cpu']);
    await h.engine.start();
    expect(h.engine.status().state).toBe('failed');
    expect(h.engine.status().gpu).toBe(false);
    expect(h.engine.status().reason).toMatch(/ekran kartı/i);
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0]?.killed).toBe(true);
    await expect(h.engine.transcribe(speech)).rejects.toMatchObject({ code: 'not_ready' });
  });

  it('üç kez üst üste başlatılamazsa açık "kullanılamıyor" durumuna geçer; beklemeler üsteldir', async () => {
    const h = setup(['exit', 'exit', 'exit']);
    await h.engine.start();
    expect(h.spawned).toHaveLength(MAX_START_ATTEMPTS);
    expect(h.engine.status().state).toBe('failed');
    expect(h.engine.status().reason).toBeTruthy();
    expect(h.sleeps.filter((ms) => ms >= 500)).toEqual([2000, 8000]);
    expect(h.history).toEqual(['starting', 'restarting', 'failed']);
  });

  it('ilk deneme boşa çıkıp ikincisi tutarsa hazır olur', async () => {
    const h = setup(['exit', 'cuda']);
    await h.engine.start();
    expect(h.engine.status().state).toBe('ready');
    expect(h.spawned).toHaveLength(2);
  });

  it('çalışırken çökerse kendiliğinden yeniden başlar', async () => {
    const h = setup(['cuda', 'cuda']);
    await h.engine.start();
    h.spawned[0]?.emit('exit', 1);
    expect(h.engine.status()).toMatchObject({ state: 'restarting', crashes: 1 });
    await h.waitFor('ready');
    expect(h.spawned).toHaveLength(2);
    expect((await h.engine.transcribe(speech)).text).toBe('Yarın saat onda hatırlat.');
  });

  it('çöktükten sonra üç deneme de boşa çıkarsa kalıcı hata verir', async () => {
    const h = setup(['cuda', 'exit', 'exit', 'exit']);
    await h.engine.start();
    h.spawned[0]?.emit('exit', 1);
    await h.waitFor('failed');
    expect(h.spawned).toHaveLength(1 + MAX_START_ATTEMPTS);
    expect(h.sleeps.filter((ms) => ms >= 500)).toEqual([500, 2000, 8000]);
  });

  it('durdurulunca süreci kapatır ve yeniden başlatmaz', async () => {
    const h = setup(['cuda']);
    await h.engine.start();
    await h.engine.stop();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.spawned[0]?.killed).toBe(true);
    expect(h.engine.status().state).toBe('stopped');
    expect(h.spawned).toHaveLength(1);
  });
});

describe('whisper-local döküm', () => {
  it('Türkçe ister, sözcük listesini ilk istem olarak yollar, dökümü süzer', async () => {
    const h = setup(['cuda']);
    h.engine.setVocabulary(['Jarvis', 'ATLAS', 'Jarvis', ' ']);
    await h.engine.start();
    const result = await h.engine.transcribe(speech);
    expect(result).toMatchObject({ text: 'Yarın saat onda hatırlat.', dropped: null, languageConfidence: 0.9 });
    const form = h.requests.at(-1)?.form;
    expect(form?.get('language')).toBe('tr');
    expect(form?.get('prompt')).toBe('Bu, Jarvis adlı asistanla yapılan bir konuşmadır. Geçen adlar: Jarvis, ATLAS.');
    expect(form?.get('response_format')).toBe('verbose_json');
    expect((form?.get('file') as Blob).size).toBe(44 + speech.length * 2);
  });

  it('ilk istem asistanın adını taşır ama adla başlamaz; sözcük listesi olmadan da kurulur', () => {
    expect(buildInitialPrompt('tr', 'Jarvis', [])).toBe('Bu, Jarvis adlı asistanla yapılan bir konuşmadır. Geçen adlar: Jarvis.');
    expect(buildInitialPrompt('tr', 'Jarvis', ['KDV', 'ATLAS'])).toContain('Geçen adlar: Jarvis, KDV, ATLAS.');
    expect(buildInitialPrompt('en', 'Jarvis', [])).toMatch(/^This is a conversation/);
    expect(buildInitialPrompt('tr', 'Jarvis', Array.from({ length: 400 }, (_, i) => `Şirket${i}`)).length).toBeLessThanOrEqual(600);
  });

  it('modelin geri yazdığı ilk istemi (yankı) boş döküme çevirir', async () => {
    const h = setup(['cuda']);
    await h.engine.start();
    h.setInference(() => Response.json({ text: ' Bu, Jarvis adlı asistanla yapılan bir konuşmadır.' }));
    expect(await h.engine.transcribe(speech)).toMatchObject({ text: '', dropped: 'pattern' });
    h.setInference(() => Response.json({ text: ' Geçen adlar: Jarvis.' }));
    expect(await h.engine.transcribe(speech)).toMatchObject({ text: '', dropped: 'pattern' });
    // İstemde geçen ad tek başına söylenmişse yankı değildir.
    h.setInference(() => Response.json({ text: ' Jarvis.' }));
    expect(await h.engine.transcribe(speech)).toMatchObject({ text: 'Jarvis.', dropped: null });
  });

  it('sessiz ya da çok kısa bölütü sunucuya hiç göndermez', async () => {
    const h = setup(['cuda']);
    await h.engine.start();
    const before = h.requests.length;
    expect(await h.engine.transcribe(new Int16Array(16_000))).toMatchObject({ text: '', dropped: 'too_quiet', durationMs: 0 });
    expect(await h.engine.transcribe(speech.subarray(0, 1600))).toMatchObject({ text: '', dropped: 'too_short' });
    expect(h.requests).toHaveLength(before);
  });

  it('halüsinasyon kalıbını boş döküme çevirir', async () => {
    const h = setup(['cuda']);
    await h.engine.start();
    h.setInference(() => Response.json({ text: ' Altyazı M.K.\n', segments: [{ no_speech_prob: 1e-10 }] }));
    expect(await h.engine.transcribe(speech)).toMatchObject({ text: '', raw: 'Altyazı M.K.', dropped: 'pattern' });
  });

  it('hazır değilken ve sunucu hata verince SttError fırlatır', async () => {
    const h = setup(['cuda']);
    await expect(h.engine.transcribe(speech)).rejects.toBeInstanceOf(SttError);
    await h.engine.start();
    h.setInference(() => new Response('boom', { status: 500 }));
    await expect(h.engine.transcribe(speech)).rejects.toMatchObject({ code: 'failed' });
  });

  it('iptal edilen istek "aborted" olarak döner', async () => {
    const h = setup(['cuda']);
    await h.engine.start();
    const controller = new AbortController();
    h.setInference(() => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(h.engine.transcribe(speech, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
  });
});
