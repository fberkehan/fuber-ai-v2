// Sahibi: T2. Sağlayıcıdan bağımsız tur yüzü: döngü (araç turu, cümle, iptal, adım sınırı) bunu konuşur.
import type { BrainImage } from '@fuber/shared';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  input: unknown;
  /** Girdi çözülemediyse (bozuk JSON) neden; döngü aracı çalıştırmaz, hata sonucu verir. */
  inputError?: string;
}

export interface ToolResultMessage {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

export type ConvMessage =
  | { role: 'user'; text: string; images?: BrainImage[] }
  /** `native`: sağlayıcının kendi blokları (Anthropic düşünme blokları gibi); geri aynen gönderilir. */
  | { role: 'assistant'; text: string; toolCalls: ToolCallRequest[]; native?: unknown }
  | { role: 'tool'; results: ToolResultMessage[] };

export type ProviderStop = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause';

export interface ProviderUsage {
  /** `anthropic`, `local`, `claude-code` (abonelik; dolar karşılığı yok) ya da OpenAI uyumlu sağlayıcı kaydının kimliği (`openrouter`, `moonshot`…). */
  provider: 'anthropic' | 'local' | 'claude-code' | (string & {});
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Verilmezse kullanım servisi fiyat tablosundan hesaplar; `null`: fiyat bilinmiyor (0 sayılmaz, işaretlenir). */
  costUsd?: number | null;
}

export interface ProviderTurnRequest {
  /** Önbelleklenen değişmez istem ve her turda değişen kuyruk. */
  system: { stable: string; tail: string } | null;
  messages: ConvMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  voice: boolean;
  /** Araç turundan sonra: istem önbelleğine son iletiyi de kat. */
  cacheLoop: boolean;
  /**
   * Bu adımda model bir araç çağırmak ZORUNDA (yalnız yerel sağlayıcı uygular). Döngü bunu, model aracı çağırmadan
   * "yaptım" dediği için uyarıldıktan sonraki tek yeniden denemede ister.
   */
  requireTool?: boolean;
  signal?: AbortSignal;
  /** Kullanıcıya görünür metin parçası (düşünme etiketleri ayıklanmış). */
  onText(delta: string): void;
}

export interface ProviderTurnResult {
  text: string;
  toolCalls: ToolCallRequest[];
  stop: ProviderStop;
  native?: unknown;
  usage: ProviderUsage;
}

export interface BrainProvider {
  readonly id: 'anthropic' | 'local' | 'openai-compatible' | 'claude-code';
  turn(request: ProviderTurnRequest): Promise<ProviderTurnResult>;
}

/** Yerel sağlayıcının hata türü; döngü bunu Türkçe cümleye çevirir. */
export class LocalBrainError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'network' | 'context' | 'server',
    message: string,
  ) {
    super(message);
    this.name = 'LocalBrainError';
  }
}
