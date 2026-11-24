/**
 * Derin beyin sözleşmesi: yetenek geliştirme, araştırma ve görüntü anlama gibi arka plan işlerinin tek arayüzü.
 * İki sağlayıcı vardır: `anthropic` (API anahtarı; beynin kendi döngüsü) ve `claude-code` (bu bilgisayardaki
 * Claude Code CLI, kullanıcının aboneliğiyle). Hangisinin koşacağını politika belirler (`Policy.brain.deep.provider`);
 * çağıran bilmez. Hızlı sesli turlar buradan GEÇMEZ.
 *
 * Sağlayıcının ürettiği her şey (metin, dosya) güvenilmez veridir: yazılan kod Atölye'nin doğrulama, öz-sınama ve
 * onay kapılarından geçmeden yüklenmez; araştırma metni talimat sayılmaz.
 */
import { UserError, type BrainImage, type DeepBrainStatus } from '@fuber/shared';

export type DeepProviderId = 'anthropic' | 'claude-code';

export interface DeepAvailability {
  ok: boolean;
  /** Bu an bir iş verilse koşacak sağlayıcı; yoksa `null`. */
  provider: DeepProviderId | null;
  /** `ok: false` iken kullanıcıya söylenebilecek Türkçe neden. */
  reason?: string;
}

/** Dosya yolu (png, jpg, webp, gif) ya da bellekteki görüntü. Ekran görüntüsü diske yazılmadan verilebilir. */
export type DeepImage = string | BrainImage;

export interface DeepAskRequest {
  /** Bu çağrının tam sistem istemi. Boş bırakılamaz: sağlayıcının varsayılan istemi kullanılmaz. */
  system: string;
  prompt: string;
  images?: DeepImage[];
  /** Varsayılan 120. */
  maxSeconds?: number;
  signal?: AbortSignal;
}

export interface DeepAskResult {
  text: string;
  provider: DeepProviderId;
}

/**
 * İşin kullanabileceği araç grupları. `read`/`write` yalnız `workDir` içindeki dosyalar; `web` arama ve sayfa okuma.
 * Kabuk, kod çalıştırma, MCP ve çalışma klasörü dışındaki dosyalar hiçbir grupta yoktur.
 */
export type DeepToolGroup = 'read' | 'write' | 'web';

export type DeepTaskEvent =
  | { type: 'started'; provider: DeepProviderId; model: string | null }
  | { type: 'text'; text: string }
  /** `detail`: dosya adı, arama sorgusu ya da adres (araca göre); gösterilecek bir şey yoksa `null`. */
  | { type: 'tool'; phase: 'start' | 'end'; name: string; detail: string | null; ok?: boolean }
  /** İzin kapısı bir aracı geri çevirdi (çalışma klasörü dışı yol, izinsiz araç). */
  | { type: 'denied'; tool: string; reason: string }
  /** Abonelik sınırı: `warning` yaklaşıldı, `rejected` doldu. `resetsAt`: sınırın açılacağı an. */
  | { type: 'limit'; status: 'warning' | 'rejected'; resetsAt: string | null }
  | { type: 'retry'; attempt: number; error: string };

export interface DeepTaskRequest {
  /** İşin türü (günlük ve tanı için): `skill_build`, `skill_repair`, `research`… */
  kind: string;
  system: string;
  prompt: string;
  /** İşin kendi klasörü: dosya araçları yalnız burada çalışır. Var olmalıdır. */
  workDir: string;
  allowedTools: DeepToolGroup[];
  maxSeconds: number;
  /** Model turu üst sınırı (yalnız Claude Code; varsayılan 60). Büyük işler (çekirdek geliştirme) daha yüksek ister. */
  maxTurns?: number;
  onEvent?(event: DeepTaskEvent): void;
  signal?: AbortSignal;
}

/**
 * `end` iş bitti · `aborted` iptal edildi · `timeout` süre doldu · `limit` abonelik/kota sınırı · `auth` oturum ya da
 * anahtar sorunu · `max_turns` adım sınırı · `refusal` model geri çevirdi · `unavailable` derin beyin yok · `error` diğer.
 */
export type DeepStop = 'end' | 'aborted' | 'timeout' | 'limit' | 'auth' | 'max_turns' | 'refusal' | 'unavailable' | 'error';

export interface DeepTaskResult {
  ok: boolean;
  /** Modelin son yanıtı (iş başarısızsa o ana kadarki metin). */
  text: string;
  provider: DeepProviderId | null;
  stop: DeepStop;
  /** `ok: false` iken kullanıcıya söylenebilecek Türkçe açıklama. */
  error: string | null;
  turns: number;
  durationMs: number;
  /** İzin kapısının geri çevirdiği araç çağrısı sayısı. */
  denials: number;
}

/** `ask` başarısız olduğunda fırlatılır; iletisi kullanıcıya söylenebilir Türkçe metindir. */
export class DeepBrainError extends UserError {
  constructor(
    readonly stop: Exclude<DeepStop, 'end'>,
    message: string,
  ) {
    super(message);
    this.name = 'DeepBrainError';
  }
}

export interface DeepBrain {
  /** Eşzamanlı, önbellekten: şu an derin iş yapılabilir mi ve hangi sağlayıcıyla. */
  available(): DeepAvailability;
  /** Claude Code yoklamasını (kurulu mu, sürüm, oturum) gerekirse tazeleyip güncel durumu döndürür. */
  refresh(force?: boolean): Promise<DeepAvailability>;
  /** `BrainStatus.deep` olarak yayınlanan ayrıntılı durum. */
  status(): DeepBrainStatus;
  /**
   * Çağıran, Anthropic API'nin kullanılamadığını kendi yoklamasıyla gördüyse bildirir: API bir süre denenmez ve
   * `auto` kipte Claude Code'a geçilir. Güncel durumu döndürür.
   */
  reportApiFailure(reason: string): DeepAvailability;
  /** Araçsız, tek yanıt (görüntü anlama dahil). Başarısızsa `DeepBrainError` fırlatır. */
  ask(request: DeepAskRequest): Promise<DeepAskResult>;
  /** Çok adımlı iş. Hiç fırlatmaz; sorun `stop` ve `error` ile bildirilir. */
  runTask(request: DeepTaskRequest): Promise<DeepTaskResult>;
}
