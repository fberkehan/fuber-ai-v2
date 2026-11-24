import { describe, expect, it, vi } from 'vitest';
import {
  base64ToPcm,
  pcmToBase64,
  RealtimeSession,
  resamplePcm,
  type RealtimeConfig,
  type RealtimeHooks,
  type RealtimeSocket,
} from './realtime';

/** Sahte WebSocket: gönderilenleri toplar, sunucu olaylarını elle besler. Gerçek ağ YOK. */
class FakeSocket implements RealtimeSocket {
  sent: Array<Record<string, unknown>> = [];
  closed: { code?: number; reason?: string } | null = null;
  private handlers: { open?: () => void; message?: (d: string) => void; close?: (c: number, r?: string) => void; error?: (e: Error) => void } = {};

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  on(event: 'open' | 'message' | 'close' | 'error', cb: never): void {
    (this.handlers as Record<string, unknown>)[event] = cb;
  }
  // ── sunucu benzetimi ──
  open(): void {
    this.handlers.open?.();
  }
  emit(event: Record<string, unknown>): void {
    this.handlers.message?.(JSON.stringify(event));
  }
  serverClose(code = 1006, reason?: string): void {
    this.handlers.close?.(code, reason);
  }
  error(message: string): void {
    this.handlers.error?.(new Error(message));
  }
  sentTypes(): string[] {
    return this.sent.map((item) => String(item.type));
  }
  lastOf(type: string): Record<string, unknown> | undefined {
    return [...this.sent].reverse().find((item) => item.type === type);
  }
}

const CONFIG: RealtimeConfig = { model: 'gpt-realtime-2.1', voice: 'marin', instructions: 'Sen Jarvis\'sin.' };

function make(options: { key?: string | null; config?: Partial<RealtimeConfig> } = {}) {
  const sockets: FakeSocket[] = [];
  const transport = vi.fn((_url: string, _headers: Record<string, string>) => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const hooks: RealtimeHooks & { audio: Int16Array[]; assistant: Array<{ text: string; final: boolean }>; errors: Array<{ code: string; fatal: boolean }>; ready: number; done: boolean[] } = {
    audio: [],
    assistant: [],
    errors: [],
    ready: 0,
    done: [],
    onAudio: (pcm) => hooks.audio.push(pcm),
    onAudioDone: () => {},
    onAssistantText: (text, final) => hooks.assistant.push({ text, final }),
    onResponseDone: (cancelled) => hooks.done.push(cancelled),
    onError: (error) => hooks.errors.push({ code: error.code, fatal: error.fatal }),
    onReady: () => (hooks.ready += 1),
  };
  const session = new RealtimeSession(
    transport as never,
    () => (options.key === undefined ? 'sk-test' : options.key),
    () => ({ ...CONFIG, ...options.config }),
    hooks,
  );
  return { session, sockets, transport, hooks };
}

/** Oturumu hazır duruma getirir (aç → session.created → session.updated). */
function bringReady(socket: FakeSocket): void {
  socket.open();
  socket.emit({ type: 'session.created' });
  socket.emit({ type: 'session.updated' });
}

describe('PCM yardımcıları', () => {
  it('base64 gidiş-dönüşü örnekleri korur', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
    expect([...base64ToPcm(pcmToBase64(pcm))]).toEqual([...pcm]);
  });

  it('16 kHz → 24 kHz yeniden örnekleme uzunluğu 1,5 katına çıkarır', () => {
    const pcm = new Int16Array(160); // 10 ms @ 16 kHz
    expect(resamplePcm(pcm, 16_000, 24_000).length).toBe(240); // 10 ms @ 24 kHz
    expect(resamplePcm(pcm, 24_000, 24_000).length).toBe(160);
  });
});

describe('RealtimeSession', () => {
  it('anahtar yoksa bağlanmaz ve ölümcül no_key verir', () => {
    const { session, transport, hooks } = make({ key: null });
    session.start();
    expect(transport).not.toHaveBeenCalled();
    expect(hooks.errors).toEqual([{ code: 'no_key', fatal: true }]);
  });

  it('bağlanınca doğru başlık ve oturum ayarını (GA, 24 kHz, ses, persona) gönderir', () => {
    const { session, sockets, transport } = make();
    session.start();
    const [url, headers] = transport.mock.calls[0]!;
    expect(url).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1');
    expect(headers).toEqual({ Authorization: 'Bearer sk-test' });
    // Eski beta başlığı KULLANILMAZ.
    expect(headers).not.toHaveProperty('OpenAI-Beta');

    const socket = sockets[0]!;
    socket.open();
    const update = socket.lastOf('session.update');
    expect(update).toBeDefined();
    const s = update!.session as Record<string, unknown>;
    expect(s.type).toBe('realtime');
    expect(s.output_modalities).toEqual(['audio']);
    expect(s.instructions).toBe("Sen Jarvis'sin.");
    const audio = s.audio as { input: Record<string, unknown>; output: Record<string, unknown> };
    expect(audio.input.format).toEqual({ type: 'audio/pcm', rate: 24_000 });
    expect(audio.input.turn_detection).toBeNull();
    expect(audio.output).toEqual({ format: { type: 'audio/pcm', rate: 24_000 }, voice: 'marin' });
  });

  it('hazır olmadan eklenen mikrofon sesini oturum kurulunca append eder', () => {
    const { session, sockets, hooks } = make();
    session.start();
    const socket = sockets[0]!;
    socket.open();
    // Henüz session.updated gelmedi: ses sıraya girer, gönderilmez.
    session.appendAudio(new Int16Array([1, 2, 3]));
    expect(socket.sentTypes()).not.toContain('input_audio_buffer.append');
    socket.emit({ type: 'session.created' });
    socket.emit({ type: 'session.updated' });
    expect(hooks.ready).toBe(1);
    const append = socket.lastOf('input_audio_buffer.append');
    expect(append).toBeDefined();
    expect(base64ToPcm(String(append!.audio))).toEqual(new Int16Array([1, 2, 3]));
  });

  it('dönen ses deltasını çözüp çalma yoluna verir', () => {
    const { session, sockets, hooks } = make();
    session.start();
    const socket = sockets[0]!;
    bringReady(socket);
    const chunk = new Int16Array([100, -200, 300]);
    socket.emit({ type: 'response.created' });
    socket.emit({ type: 'response.output_audio.delta', delta: pcmToBase64(chunk) });
    expect(hooks.audio).toHaveLength(1);
    expect(hooks.audio[0]).toEqual(chunk);
  });

  it('araya girme süren yanıtı iptal eder ve giriş tamponunu temizler', () => {
    const { session, sockets } = make();
    session.start();
    const socket = sockets[0]!;
    bringReady(socket);
    socket.emit({ type: 'response.created' });
    socket.emit({ type: 'response.output_audio.delta', delta: pcmToBase64(new Int16Array([1])) });
    socket.sent = [];
    session.interrupt();
    expect(socket.sentTypes()).toEqual(['response.cancel', 'input_audio_buffer.clear']);
  });

  it('süren yanıt yokken araya girme response.cancel GÖNDERMEZ', () => {
    const { session, sockets } = make();
    session.start();
    const socket = sockets[0]!;
    bringReady(socket);
    socket.sent = [];
    session.interrupt();
    expect(socket.sentTypes()).toEqual(['input_audio_buffer.clear']);
  });

  it('tam bir "merhaba → yanıt" turu: ses + metin + bitiş', () => {
    const { session, sockets, hooks } = make();
    session.start();
    const socket = sockets[0]!;
    bringReady(socket);

    // Kullanıcı sesi → append + commit + response.create
    session.appendAudio(resamplePcm(new Int16Array(160).fill(500), 16_000, 24_000));
    session.commit();
    session.createResponse();
    expect(socket.sentTypes()).toContain('input_audio_buffer.append');
    expect(socket.sentTypes()).toContain('input_audio_buffer.commit');
    expect(socket.sentTypes()).toContain('response.create');

    // Sunucu yanıtı
    socket.emit({ type: 'response.created' });
    socket.emit({ type: 'response.output_audio_transcript.delta', delta: 'Merhaba' });
    socket.emit({ type: 'response.output_audio.delta', delta: pcmToBase64(new Int16Array([7, 8])) });
    socket.emit({ type: 'response.output_audio_transcript.done', transcript: 'Merhaba efendim.' });
    socket.emit({ type: 'response.output_audio.done' });
    socket.emit({ type: 'response.done', response: { status: 'completed' } });

    expect(hooks.audio).toHaveLength(1);
    expect(hooks.assistant).toContainEqual({ text: 'Merhaba', final: false });
    expect(hooks.assistant).toContainEqual({ text: 'Merhaba efendim.', final: true });
    expect(hooks.done).toEqual([false]);
  });

  it('metin yolu: conversation.item.create + response.create', () => {
    const { session, sockets } = make();
    session.start();
    const socket = sockets[0]!;
    bringReady(socket);
    socket.sent = [];
    session.sendUserText('Saat kaç?');
    expect(socket.sentTypes()).toEqual(['conversation.item.create', 'response.create']);
    const item = socket.lastOf('conversation.item.create')!.item as { content: Array<{ text: string }> };
    expect(item.content[0]!.text).toBe('Saat kaç?');
  });

  it('beklenmedik kapanmada yeniden bağlanır', () => {
    vi.useFakeTimers();
    try {
      const { session, sockets, transport } = make();
      session.start();
      bringReady(sockets[0]!);
      sockets[0]!.serverClose(1006);
      expect(transport).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(600);
      expect(transport).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() sonrası kapanmada yeniden bağlanmaz', () => {
    vi.useFakeTimers();
    try {
      const { session, sockets, transport } = make();
      session.start();
      bringReady(sockets[0]!);
      session.stop();
      expect(sockets[0]!.closed).toEqual({ code: 1000, reason: 'client stop' });
      sockets[0]!.serverClose(1000);
      vi.advanceTimersByTime(20_000);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('yetki hatası ölümcüldür: durur, yeniden bağlanmaz', () => {
    vi.useFakeTimers();
    try {
      const { session, sockets, transport, hooks } = make();
      session.start();
      bringReady(sockets[0]!);
      sockets[0]!.emit({ type: 'error', error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'bad key' } });
      expect(hooks.errors.at(-1)).toEqual({ code: 'invalid_api_key', fatal: true });
      sockets[0]!.serverClose(1000);
      vi.advanceTimersByTime(20_000);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('kullanıcı konuşmaya başlayınca (sunucu VAD) araya girme kancası çağrılır', () => {
    const started = vi.fn();
    const socket = new FakeSocket();
    const hooks: RealtimeHooks = {
      onAudio: () => {},
      onAudioDone: () => {},
      onAssistantText: () => {},
      onResponseDone: () => {},
      onError: () => {},
      onSpeechStarted: started,
    };
    const session = new RealtimeSession(() => socket, () => 'sk-test', () => CONFIG, hooks);
    session.start();
    bringReady(socket);
    socket.emit({ type: 'input_audio_buffer.speech_started' });
    expect(started).toHaveBeenCalledTimes(1);
  });
});
