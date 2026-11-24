/**
 * OpenAI Realtime API (konuşmadan konuşmaya) WebSocket istemcisi. Cascade'in Whisper → beyin → TTS üçlüsünü TEK sokete
 * indirir: ses girişi (`input_audio_buffer.append`/`commit`) → OpenAI, OpenAI sesi (`response.output_audio.delta`) →
 * oynatma, ara metin olay akışından (`response.output_audio_transcript.delta`).
 *
 * Bu modül SAF'tır: Electron'a, gerçek sokete ve gerçek anahtara dokunmaz. Taşıma katmanı (`RealtimeTransport`) ve ses
 * kancaları (`RealtimeHooks`) dışarıdan verilir; böylece sahte bir WebSocket'le birim olarak sınanır. Gerçek soket
 * `index.ts`'te `ws` paketiyle kurulur.
 *
 * Protokol (17 Kas 2026, resmi belge — developers.openai.com/api/docs/guides/realtime* ve voice-websockets):
 *   • Uç: `wss://api.openai.com/v1/realtime?model=<model>`; başlık `Authorization: Bearer <key>`.
 *   • GA arayüzü: eski `OpenAI-Beta: realtime=v1` başlığı KALDIRILDI; güncel model `gpt-realtime-2.1`.
 *   • Oturum (`session.update`): `type:'realtime'`, `output_modalities:['audio']`, `instructions`, ve `audio` altında
 *     giriş/çıkış `format:{type:'audio/pcm',rate:24000}`, `audio.output.voice`, `audio.input.turn_detection`.
 *   • Sunucu `response.output_audio.delta` (ses), `response.output_audio_transcript.delta` (metin) döndürür; eski
 *     `response.audio.delta`/`response.audio_transcript.delta` DEĞİL.
 */

/** Dışarıdan verilen WebSocket benzeri soket (yalnız gerekli yüzey; `ws` ve sahte soket ikisi de uyar). */
export interface RealtimeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open', cb: () => void): void;
  on(event: 'message', cb: (data: string) => void): void;
  on(event: 'close', cb: (code: number, reason?: string) => void): void;
  on(event: 'error', cb: (error: Error) => void): void;
}

/** `url` ve `headers` ile soket açar (gerçek: `new WebSocket(url, { headers })`). */
export type RealtimeTransport = (url: string, headers: Record<string, string>) => RealtimeSocket;

export interface RealtimeConfig {
  /** Gerçek zamanlı model; resmi örneklerde `gpt-realtime-2.1`. */
  model: string;
  /** OpenAI gerçek zamanlı sesi (alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar). */
  voice: string;
  /** Sistem istemi (persona): aynı "Jarvis" gibi konuşması için oturum ayarına verilir. */
  instructions: string;
  /** Güvenlik kimliği (isteğe bağlı; gizliliği koruyan kararlı kimlik). */
  safetyIdentifier?: string;
}

export interface RealtimeHooks {
  /** Çıkış sesi parçası (24 kHz mono PCM16): oynatma yoluna verilir. */
  onAudio(pcm: Int16Array): void;
  /** Yanıtın sesi bitti (`response.output_audio.done`). */
  onAudioDone(): void;
  /** Asistanın ara/son metni (ada/sohbet için); `final` yanıt metninin tamamlandığını bildirir. */
  onAssistantText(text: string, final: boolean): void;
  /** Kullanıcının söylediğinin dökümü (giriş sesi yazıya çevrildiyse; her zaman gelmez). */
  onUserTranscript?(text: string, final: boolean): void;
  /** Sunucu VAD'ı: kullanıcı konuşmaya başladı (araya girme — çağıran modelin sesini keser). */
  onSpeechStarted?(): void;
  onSpeechStopped?(): void;
  /** Bir yanıt tamamlandı (`response.done`; `cancelled` ise araya girildi). */
  onResponseDone(cancelled: boolean): void;
  /** Hata; `fatal` ise yeniden bağlanılmaz (anahtar geçersiz gibi). */
  onError(error: { code: string; message: string; fatal: boolean }): void;
  /** Oturum kuruldu ve ayar uygulandı (ses göndermeye hazır). */
  onReady?(): void;
  /** Bağlantı kapandı (yeniden bağlanma başlıyorsa `reconnecting` doğru). */
  onClose?(reconnecting: boolean): void;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
/** Yeniden bağlanma bekleme süreleri (ms); son değer yinelenir. */
const RECONNECT_BACKOFF_MS = [500, 1500, 4000, 10_000];
const MAX_RECONNECTS = 6;
/** OpenAI gerçek zamanlı giriş/çıkış sesinin örnekleme hızı (belge: 24 kHz mono). */
export const REALTIME_SAMPLE_RATE = 24_000;

type Timer = ReturnType<typeof setTimeout>;

/** PCM16'yı base64'e (olay akışı ses alanı). */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Buffer.from(bytes).toString('base64');
}

/** base64'ü PCM16'ya (küçük-endian; parça 2'ye bölünmeyen bir uzunlukta gelirse son yarım örnek atılır). */
export function base64ToPcm(data: string): Int16Array {
  const buffer = Buffer.from(data, 'base64');
  const usable = buffer.byteLength - (buffer.byteLength % 2);
  const out = new Int16Array(usable / 2);
  for (let i = 0; i < out.length; i++) out[i] = buffer.readInt16LE(i * 2);
  return out;
}

/** Doğrusal yeniden örnekleme (mikrofon 16 kHz → OpenAI 24 kHz). Hızlar eşitse kopya döner. */
export function resamplePcm(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || pcm.length === 0) return pcm.slice();
  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.round(pcm.length * ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i / ratio;
    const low = Math.floor(src);
    const high = Math.min(pcm.length - 1, low + 1);
    const frac = src - low;
    out[i] = Math.round((pcm[low] ?? 0) * (1 - frac) + (pcm[high] ?? 0) * frac);
  }
  return out;
}

/**
 * Gerçek zamanlı oturum. Yaşam döngüsü: `start()` (anahtar yoksa `onError('no_key', fatal)` ve bağlanmaz) → oturum
 * ayarı → `appendAudio`/`commit`/`createResponse` ya da `sendUserText` → `interrupt` (araya girme/sustur) → `stop()`.
 * Hiçbir hata yolu askıda bırakmaz: kapanma beklenmedikse yeniden bağlanır, anahtar/yetki hatasında durur.
 */
export class RealtimeSession {
  private socket: RealtimeSocket | null = null;
  private ready = false;
  private stopped = false;
  private reconnects = 0;
  private reconnectTimer: Timer | null = null;
  /** Oturum hazır olana dek biriken ses: hazır olunca sırayla gönderilir. */
  private readonly pendingAudio: string[] = [];
  /** Hazır olunca gönderilecek bekleyen eylemler (commit, response.create, kullanıcı metni). */
  private pendingActions: Array<() => void> = [];
  /** Süren bir yanıt var mı (araya girmede `response.cancel` yalnız o zaman gönderilir). */
  private responseActive = false;

  constructor(
    private readonly transport: RealtimeTransport,
    private readonly getKey: () => string | null | undefined,
    private readonly config: () => RealtimeConfig,
    private readonly hooks: RealtimeHooks,
  ) {}

  /** Bağlantıyı açar. Anahtar yoksa bağlanmaz ve ölümcül `no_key` hatası verir. */
  start(): void {
    this.stopped = false;
    const key = this.getKey()?.trim();
    if (!key) {
      this.hooks.onError({ code: 'no_key', message: 'OpenAI anahtarı yok', fatal: true });
      return;
    }
    this.connect(key);
  }

  private connect(key: string): void {
    this.clearReconnect();
    const config = this.config();
    const url = `${REALTIME_URL}?model=${encodeURIComponent(config.model)}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (config.safetyIdentifier) headers['OpenAI-Safety-Identifier'] = config.safetyIdentifier;
    let socket: RealtimeSocket;
    try {
      socket = this.transport(url, headers);
    } catch (error) {
      this.log('error', `gerçek zamanlı soket açılamadı: ${String(error)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.ready = false;
    this.responseActive = false;
    socket.on('open', () => this.onOpen());
    socket.on('message', (data) => this.onMessage(data));
    socket.on('close', (code, reason) => this.onCloseEvent(code, reason));
    socket.on('error', (error) => this.log('warn', `gerçek zamanlı soket hatası: ${error.message}`));
  }

  private onOpen(): void {
    this.reconnects = 0;
    const config = this.config();
    // Oturumu yapılandır: GA arayüzü, yalnız ses çıkışı, persona istemi, 24 kHz PCM giriş/çıkış, ses. Yerel VAD bölütleri
    // gönderdiğimiz için sunucu VAD'ı KAPALIDIR (bas-konuş): araya girme yerel işçiden gelir.
    this.sendRaw({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: config.model,
        output_modalities: ['audio'],
        instructions: config.instructions,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE },
            turn_detection: null,
          },
          output: {
            format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE },
            voice: config.voice,
          },
        },
      },
    });
  }

  private onMessage(data: string): void {
    let event: { type?: string; [key: string]: unknown };
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      this.log('warn', 'gerçek zamanlı olay ayrıştırılamadı');
      return;
    }
    switch (event.type) {
      case 'session.created':
        // İlk oturum; ayarımız (`session.update`) henüz uygulanmadı, `session.updated` beklenir.
        break;
      case 'session.updated':
        if (!this.ready) {
          this.ready = true;
          this.flushPending();
          this.hooks.onReady?.();
        }
        break;
      case 'input_audio_buffer.speech_started':
        this.hooks.onSpeechStarted?.();
        break;
      case 'input_audio_buffer.speech_stopped':
        this.hooks.onSpeechStopped?.();
        break;
      case 'response.created':
        this.responseActive = true;
        break;
      case 'response.output_audio.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) this.hooks.onAudio(base64ToPcm(delta));
        break;
      }
      case 'response.output_audio.done':
        this.hooks.onAudioDone();
        break;
      case 'response.output_audio_transcript.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) this.hooks.onAssistantText(delta, false);
        break;
      }
      case 'response.output_audio_transcript.done': {
        const transcript = typeof event.transcript === 'string' ? event.transcript : '';
        this.hooks.onAssistantText(transcript, true);
        break;
      }
      case 'response.output_text.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) this.hooks.onAssistantText(delta, false);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = typeof event.transcript === 'string' ? event.transcript : '';
        if (transcript) this.hooks.onUserTranscript?.(transcript, true);
        break;
      }
      case 'response.done': {
        this.responseActive = false;
        const status = (event.response as { status?: string } | undefined)?.status;
        this.hooks.onResponseDone(status === 'cancelled');
        break;
      }
      case 'error': {
        const detail = (event.error ?? {}) as { code?: string; message?: string; type?: string };
        const code = detail.code ?? detail.type ?? 'error';
        const fatal = /auth|invalid_api_key|insufficient|forbidden|unauthorized/i.test(`${code} ${detail.type ?? ''}`);
        this.hooks.onError({ code, message: detail.message ?? 'Gerçek zamanlı hata', fatal });
        if (fatal) this.stop();
        break;
      }
      default:
        break;
    }
  }

  private onCloseEvent(code: number, reason?: string): void {
    this.ready = false;
    this.responseActive = false;
    this.socket = null;
    if (this.stopped) {
      this.hooks.onClose?.(false);
      return;
    }
    this.log('info', `gerçek zamanlı bağlantı kapandı (${code}${reason ? ` ${reason}` : ''}); yeniden bağlanılıyor`);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.hooks.onClose?.(true);
    if (this.reconnects >= MAX_RECONNECTS) {
      this.hooks.onError({ code: 'unreachable', message: 'Gerçek zamanlı bağlantı yeniden kurulamadı', fatal: true });
      this.stopped = true;
      return;
    }
    const wait = RECONNECT_BACKOFF_MS[Math.min(this.reconnects, RECONNECT_BACKOFF_MS.length - 1)] ?? 10_000;
    this.reconnects++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const key = this.getKey()?.trim();
      if (!key || this.stopped) return;
      this.connect(key);
    }, wait);
    this.reconnectTimer.unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Hazır mı (ses göndermeye uygun). */
  isReady(): boolean {
    return this.ready;
  }

  /** Mikrofon PCM'ini (24 kHz mono) giriş tamponuna ekler; hazır değilse sıraya alır. */
  appendAudio(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const base64 = pcmToBase64(pcm);
    if (!this.ready) {
      this.pendingAudio.push(base64);
      return;
    }
    this.sendRaw({ type: 'input_audio_buffer.append', audio: base64 });
  }

  /** Giriş tamponunu bir kullanıcı iletisi olarak kapatır (yerel VAD bölüt sonu). */
  commit(): void {
    this.whenReady(() => this.sendRaw({ type: 'input_audio_buffer.commit' }));
  }

  /** Model yanıtı üretsin (bölüt sonu + yanıt iste). */
  createResponse(): void {
    this.whenReady(() => this.sendRaw({ type: 'response.create' }));
  }

  /** Metin kullanıcı iletisi (ses yoluna alternatif): öğe oluştur + yanıt iste. */
  sendUserText(text: string): void {
    this.whenReady(() => {
      this.sendRaw({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
      this.sendRaw({ type: 'response.create' });
    });
  }

  /** Araya girme / sustur: süren yanıtı iptal eder ve bekleyen giriş sesini atar. Çağıran yerel oynatmayı ayrıca keser. */
  interrupt(): void {
    this.pendingAudio.length = 0;
    this.pendingActions = [];
    if (!this.ready) return;
    if (this.responseActive) this.sendRaw({ type: 'response.cancel' });
    this.sendRaw({ type: 'input_audio_buffer.clear' });
  }

  /** Bağlantıyı kapatır; yeniden bağlanma durur. */
  stop(): void {
    this.stopped = true;
    this.ready = false;
    this.clearReconnect();
    this.pendingAudio.length = 0;
    this.pendingActions = [];
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, 'client stop');
      } catch {
        // Zaten kapanmış.
      }
    }
  }

  private whenReady(action: () => void): void {
    if (this.ready) action();
    else this.pendingActions.push(action);
  }

  private flushPending(): void {
    for (const base64 of this.pendingAudio.splice(0)) this.sendRaw({ type: 'input_audio_buffer.append', audio: base64 });
    const actions = this.pendingActions;
    this.pendingActions = [];
    for (const action of actions) action();
  }

  private sendRaw(payload: unknown): void {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (error) {
      this.log('warn', `gerçek zamanlı gönderim başarısız: ${String(error)}`);
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.hooks.log?.(level, message);
  }
}
