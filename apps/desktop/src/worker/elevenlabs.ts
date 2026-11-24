/**
 * ElevenLabs akışlı seslendirme (bulut TTS). Cümle başına bir HTTP isteği: `POST /v1/text-to-speech/{ses}/stream`,
 * yanıt ham 16 bit PCM olarak parça parça gelir ve geldikçe ses penceresine verilir.
 *
 * Neden HTTP akışı (WebSocket girdi akışı değil): ölçüm (17 Kas 2026, Türkiye, "Tamam efendim.", flash v2.5):
 *   bağlantı soğuk   HTTP 602–777 ms · WebSocket 780–812 ms (ilk ses parçası)
 *   bağlantı sıcak   HTTP 172–185 ms · WebSocket 267–279 ms
 * Gecikmenin büyük kısmı TLS el sıkışmasıdır. Bu yüzden bağlantı açık tutulur (`keepAlive`) ve uyanma anında
 * önceden açılır (`prewarm`); cümle isteği hazır soketten gider. Ölçüm betiği: `scripts/voice/elevenlabs-probe.mjs`.
 *
 * Hata sınıfları geri düşme kararını belirler (`tts-router.ts`): hangi nedenle ne kadar süre yerel sese geçileceği
 * burada değil orada yazılıdır. Anahtar hiçbir günlük satırına ya da hata iletisine girmez.
 */

import http from 'node:http';
import https from 'node:https';

export type ElevenFailure =
  /** Politikada anahtar yok. */
  | 'no_key'
  /** 401: anahtar geçersiz ya da yetkisi yok. */
  | 'unauthorized'
  /** 402: plan bu sese/modele izin vermiyor (ücretsiz planda kütüphane sesi). */
  | 'payment'
  /** 429: eşzamanlı istek sınırı ya da servis yoğun. */
  | 'rate_limit'
  /** Aylık karakter kotası doldu. */
  | 'quota'
  /** Bağlantı kurulamadı ya da koptu (yanıt başlamadan). */
  | 'network'
  /** İlk ses parçası süresinde gelmedi. */
  | 'timeout'
  /** Ses başladıktan sonra akış koptu ya da durdu. */
  | 'interrupted'
  /** 4xx/5xx: ses bulunamadı, geçersiz istek, sunucu hatası. */
  | 'server'
  /** Sınama koşusunun karakter sınırı doldu (yalnız sınamada verilir). */
  | 'budget';

export class ElevenLabsError extends Error {
  constructor(
    readonly reason: ElevenFailure,
    readonly status: number | null,
    /** Hata anına kadar pencereye verilmiş örnek sayısı (0 değilse cümlenin başı çalındı). */
    readonly samples: number,
    detail: string,
  ) {
    super(detail);
    this.name = 'ElevenLabsError';
  }
}

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  model: string;
  /** ISO 639-1; yalnız destekleyen modellerde gönderilir. */
  languageCode: string | null;
  /** Varsayılan `https://api.elevenlabs.io`; sınamada sahte sunucu. */
  baseUrl: string;
  /** İstek başından ilk ses parçasına kadar tanınan süre. */
  firstChunkTimeoutMs: number;
  /** Ses başladıktan sonra iki parça arasında tanınan en uzun sessizlik. */
  stallTimeoutMs: number;
  /** Bu süreçte harcanabilecek en çok karakter; `null` = sınırsız. Sınamalar geliştiricinin kotasını bununla korur. */
  charBudget: number | null;
}

export interface ElevenChunk {
  pcm: Int16Array;
  sampleRate: number;
}

export const ELEVEN_SAMPLE_RATE = 24_000;
/** İlk parça beklemeden verilir; sonrakiler bu kadar örnek birikince (≈40 ms): çok küçük parçalar zamanlamayı yorar. */
const MIN_CHUNK_SAMPLES = Math.round(ELEVEN_SAMPLE_RATE * 0.04);
/** `language_code` parametresini kabul eden modeller; diğerlerinde parametre 400 döndürür. */
const LANGUAGE_CODE_MODELS = /^eleven_(flash|turbo)_v2_5$|^eleven_v3/;

interface Attempt {
  req: http.ClientRequest;
  aborted: boolean;
}

export class ElevenLabs {
  readonly sampleRate = ELEVEN_SAMPLE_RATE;
  private readonly agent: http.Agent | https.Agent;
  private readonly transport: typeof http | typeof https;
  private readonly url: URL;
  private current: Attempt | null = null;
  private warming = false;
  /** Model `language_code`'u reddettiyse bir daha gönderilmez. */
  private languageRejected = false;
  /** Bu süreçte sunucunun kabul ettiği karakter sayısı. */
  spentChars = 0;

  constructor(private readonly config: ElevenLabsConfig) {
    this.url = new URL(config.baseUrl);
    this.transport = this.url.protocol === 'http:' ? http : https;
    // Soket açık kalır: sonraki cümle ve sonraki tur TLS el sıkışması beklemez.
    this.agent = new this.transport.Agent({ keepAlive: true, keepAliveMsecs: 10_000, maxSockets: 2, maxFreeSockets: 1 });
  }

  private options(method: string, path: string, headers: Record<string, string | number>): http.RequestOptions {
    return {
      host: this.url.hostname,
      port: this.url.port || undefined,
      path: `${this.url.pathname.replace(/\/$/, '')}${path}`,
      method,
      agent: this.agent,
      headers: { 'xi-api-key': this.config.apiKey, ...headers },
    };
  }

  /** Boşta hazır soket yoksa bir tane açar (küçük bir istekle). Hata önemsizdir: cümle isteği kendi bağlantısını kurar. */
  prewarm(): void {
    if (this.warming || !this.config.apiKey) return;
    const free = Object.values(this.agent.freeSockets).some((list) => (list?.length ?? 0) > 0);
    if (free) return;
    this.warming = true;
    const done = (): void => {
      this.warming = false;
    };
    const req = this.transport.request(this.options('HEAD', '/v1/models', {}), (res) => {
      res.resume();
      res.on('end', done);
      res.on('error', done);
    });
    req.setTimeout(5000, () => req.destroy());
    req.on('error', done);
    req.on('close', done);
    req.end();
  }

  /** Süren isteği keser (söz kesme, iptal). `speak` sıfır örnekle çözülür. */
  cancel(): void {
    const attempt = this.current;
    if (!attempt) return;
    attempt.aborted = true;
    attempt.req.destroy();
  }

  stop(): void {
    this.cancel();
    this.agent.destroy();
  }

  /**
   * Metni seslendirir; parçalar geldikçe `onChunk` ile verilir. İptal edilirse `{ cancelled: true }` döner.
   * Ses hiç başlamadan ya da ortasında bir sorun çıkarsa `ElevenLabsError` fırlatır (`samples` ne kadarının
   * verildiğini söyler).
   */
  async speak(
    text: string,
    onChunk: (chunk: ElevenChunk) => void,
  ): Promise<{ samples: number; firstChunkMs: number | null; chars: number; cancelled: boolean }> {
    if (!this.config.apiKey) throw new ElevenLabsError('no_key', null, 0, 'anahtar yok');
    const chars = text.length;
    if (this.config.charBudget !== null && this.spentChars + chars > this.config.charBudget) {
      throw new ElevenLabsError('budget', null, 0, `sınama karakter sınırı (${this.config.charBudget}) doldu`);
    }
    try {
      return await this.request(text, onChunk, true);
    } catch (error) {
      // Model `language_code` kabul etmiyorsa parametresiz bir kez daha denenir ve hatırlanır.
      if (
        error instanceof ElevenLabsError &&
        error.status === 400 &&
        !this.languageRejected &&
        this.sendsLanguage() &&
        /language/i.test(error.message)
      ) {
        this.languageRejected = true;
        return this.request(text, onChunk, true);
      }
      throw error;
    }
  }

  private sendsLanguage(): boolean {
    return this.config.languageCode !== null && !this.languageRejected && LANGUAGE_CODE_MODELS.test(this.config.model);
  }

  private request(
    text: string,
    onChunk: (chunk: ElevenChunk) => void,
    mayRetry: boolean,
  ): Promise<{ samples: number; firstChunkMs: number | null; chars: number; cancelled: boolean }> {
    const body = JSON.stringify({
      text,
      model_id: this.config.model,
      ...(this.sendsLanguage() ? { language_code: this.config.languageCode } : {}),
    });
    const startedAt = performance.now();
    const chars = text.length;

    return new Promise((resolve, reject) => {
      let settled = false;
      let samples = 0;
      let firstChunkMs: number | null = null;
      let carry: Buffer | null = null;
      let pending: Buffer[] = [];
      let pendingBytes = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let counted = false;

      const arm = (ms: number, reason: ElevenFailure, detail: string): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fail(new ElevenLabsError(reason, null, samples, detail)), ms);
      };
      const finish = (cancelled: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.current === attempt) this.current = null;
        resolve({ samples, firstChunkMs, chars, cancelled });
      };
      const fail = (error: ElevenLabsError): void => {
        if (settled) return;
        if (attempt.aborted) return finish(true);
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.current === attempt) this.current = null;
        attempt.req.destroy();
        reject(error);
      };
      const flush = (force: boolean): void => {
        if (pendingBytes === 0) return;
        if (!force && firstChunkMs !== null && pendingBytes < MIN_CHUNK_SAMPLES * 2) return;
        let bytes = pending.length === 1 ? (pending[0] as Buffer) : Buffer.concat(pending);
        pending = [];
        pendingBytes = 0;
        if (carry) {
          bytes = Buffer.concat([carry, bytes]);
          carry = null;
        }
        if (bytes.length % 2 === 1) {
          carry = bytes.subarray(bytes.length - 1);
          bytes = bytes.subarray(0, bytes.length - 1);
        }
        if (bytes.length === 0) return;
        // Kopya: ağ tamponunun hizası Int16 için garanti değildir.
        const pcm = new Int16Array(bytes.length / 2);
        for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
        if (firstChunkMs === null) firstChunkMs = Math.round(performance.now() - startedAt);
        samples += pcm.length;
        onChunk({ pcm, sampleRate: ELEVEN_SAMPLE_RATE });
      };

      const req = this.transport.request(
        this.options('POST', `/v1/text-to-speech/${encodeURIComponent(this.config.voiceId)}/stream?output_format=pcm_${ELEVEN_SAMPLE_RATE}`, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          accept: 'audio/pcm',
        }),
        (res) => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            const parts: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              if (size < 4096) parts.push(chunk);
              size += chunk.length;
            });
            res.on('end', () => fail(classify(status, Buffer.concat(parts).toString('utf8'))));
            res.on('error', () => fail(classify(status, '')));
            return;
          }
          res.on('data', (chunk: Buffer) => {
            if (settled || attempt.aborted) return;
            if (!counted) {
              // Sunucu isteği kabul etti ve ses üretiyor: karakterler kotadan düşmüştür.
              counted = true;
              this.spentChars += chars;
            }
            pending.push(chunk);
            pendingBytes += chunk.length;
            flush(false);
            arm(this.config.stallTimeoutMs, 'interrupted', 'ses akışı durdu');
          });
          res.on('end', () => {
            if (attempt.aborted) return finish(true);
            flush(true);
            if (samples === 0) return fail(new ElevenLabsError('server', status, 0, 'boş ses yanıtı'));
            finish(false);
          });
          res.on('error', (error: Error) => fail(new ElevenLabsError(samples > 0 ? 'interrupted' : 'network', null, samples, error.message)));
          res.on('aborted', () => fail(new ElevenLabsError(samples > 0 ? 'interrupted' : 'network', null, samples, 'bağlantı koptu')));
        },
      );
      const attempt: Attempt = { req, aborted: false };
      this.current = attempt;

      req.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) return;
        if (attempt.aborted) return finish(true);
        // Boşta bekleyen soketi sunucu kapatmış olabilir: yeni bağlantıyla bir kez daha denenir.
        if (mayRetry && req.reusedSocket && samples === 0 && (error.code === 'ECONNRESET' || error.code === 'EPIPE')) {
          settled = true;
          if (timer) clearTimeout(timer);
          this.request(text, onChunk, false).then(resolve, reject);
          return;
        }
        fail(new ElevenLabsError(samples > 0 ? 'interrupted' : 'network', null, samples, error.code ?? error.message));
      });
      req.on('close', () => {
        if (!settled && attempt.aborted) finish(true);
      });
      arm(this.config.firstChunkTimeoutMs, 'timeout', `ilk ses ${this.config.firstChunkTimeoutMs} ms içinde gelmedi`);
      req.end(body);
    });
  }
}

/** HTTP durumunu ve ElevenLabs hata gövdesini (`{ detail: { status, message } }`) geri düşme nedenine çevirir. */
export function classify(status: number, body: string): ElevenLabsError {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as { detail?: { status?: string; message?: string } | string };
    if (typeof parsed.detail === 'string') message = parsed.detail;
    else {
      code = parsed.detail?.status ?? '';
      message = parsed.detail?.message ?? '';
    }
  } catch {
    message = body.slice(0, 200);
  }
  const detail = `HTTP ${status}${code ? ` ${code}` : ''}${message ? `: ${message.slice(0, 200)}` : ''}`;
  let reason: ElevenFailure = 'server';
  if (/quota/i.test(code)) reason = 'quota';
  else if (status === 401 || status === 403) reason = 'unauthorized';
  else if (status === 402 || /payment|paid_plan|subscription/i.test(code)) reason = 'payment';
  else if (status === 429) reason = 'rate_limit';
  return new ElevenLabsError(reason, status, 0, detail);
}
