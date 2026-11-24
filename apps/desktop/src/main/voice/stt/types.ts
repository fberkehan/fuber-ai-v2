/**
 * Yazıya çevirme motoru arayüzü. Demo 1'de tek uygulama `whisper-local`; `elevenlabs-scribe` aynı arayüze takılır.
 */

import type { Unsubscribe } from '@fuber/shared';

export type SttState =
  | 'stopped'
  /** Süreç başlatıldı, model yükleniyor. */
  | 'starting'
  | 'ready'
  /** Süreç düştü; bekleme süresinden sonra yeniden başlatılacak. */
  | 'restarting'
  /** Üst üste başlatılamadı ya da ekran kartı kullanılamıyor; kendiliğinden yeniden denenmez. */
  | 'failed';

export interface SttStatus {
  state: SttState;
  /** `failed`/`restarting` ise kullanıcıya gösterilebilir Türkçe neden. */
  reason: string | null;
  /** Hesaplama ekran kartında mı; henüz bilinmiyorsa `null`. */
  gpu: boolean | null;
  /** Bu oturumda sürecin beklenmedik kapanma sayısı. */
  crashes: number;
}

/** Dökümün neden boş döndüğü (tanı ve sınama için). */
export type DropReason = 'too_short' | 'too_quiet' | 'empty' | 'pattern' | 'no_speech' | 'language';

export interface SttResult {
  /** Süzgeçten geçmiş döküm; söz yoksa boş. */
  text: string;
  /** Motorun süzülmemiş çıktısı. */
  raw: string;
  dropped: DropReason | null;
  /** İsteğin süresi (ms); bölüt hiç gönderilmediyse 0. */
  durationMs: number;
  /** Motorun sesin Türkçe ya da İngilizce olduğuna verdiği olasılık (0–1); motor vermiyorsa `null`. */
  languageConfidence: number | null;
  /** Motorun en olası bulduğu dil (ISO 639-1); motor vermiyorsa yok. Toplantının "Karşı taraf" kaynağı kullanır. */
  detectedLanguage?: string | null;
}

/**
 * Yazıya çevirmenin dili. Verilmezse motorun kendi dili (`persona.language`). `auto`: motor sezer; başka bir kod
 * (`de`, `fr`…) o dilde yazıya çevirir. Toplantının "Karşı taraf" kaynağı içindir; sesli turlar dili hiç vermez.
 */
export type SttLanguage = string;

export class SttError extends Error {
  readonly code: 'not_ready' | 'crashed' | 'timeout' | 'aborted' | 'failed';
  constructor(code: SttError['code'], message: string) {
    super(message);
    this.name = 'SttError';
    this.code = code;
  }
}

export interface SttEngine {
  readonly id: string;
  /** Motoru başlatır; hazır olunca ya da kalıcı olarak başarısız olunca çözülür (fırlatmaz, durum `status()`'tadır). */
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): SttStatus;
  onStatus(listener: (status: SttStatus) => void): Unsubscribe;
  /**
   * Tanımada öncelik verilecek özel adlar (şirket ve proje adları, kısaltmalar). Motor bunları asistanın
   * adıyla birlikte ilk isteme (`initial_prompt`) koyar.
   */
  setVocabulary(words: string[]): void;
  /** 16 kHz mono Int16 bölütü yazıya çevirir. Motor hazır değilse ya da istek başarısızsa `SttError` fırlatır. */
  /**
   * `hint: 'stop'`: kısa dur-sözcüğü bekleniyor; ilk istem dur-sözcüklerini sayar (yalnız kısa bölütün ikinci
   * okumasında kullanılır: tek heceli "Dur." olağan istemle "Gördüğünüz gibi." diye yazılabiliyor).
   */
  transcribe(pcm: Int16Array, options?: { signal?: AbortSignal; language?: SttLanguage; hint?: 'stop' }): Promise<SttResult>;
}
