// Sahibi: T2. Sağlayıcı hatalarını kısa, doğru, Türkçe kullanıcı cümlesine çevirir (Review Focus 3).
import Anthropic from '@anthropic-ai/sdk';
import { t, type BrainCloudIssue, type BrainStopReason } from '@fuber/shared';
import { CloudProviderError } from './providers/openai-compatible';

/** Bulut beyninin "şu an kullanılamaz" sayıldığı hatalar ve nedeni. */
const CLOUD_DOWN: Record<string, BrainCloudIssue> = {
  'brain.error.timeout': 'network',
  'brain.error.timeoutAnthropic': 'network',
  'brain.error.network': 'network',
  'brain.error.auth': 'auth',
  'brain.error.billing': 'billing',
};

export interface MappedError {
  stopReason: Extract<BrainStopReason, 'aborted' | 'error'>;
  /** Kullanıcıya söylenecek Türkçe cümle. */
  message: string;
  /** Günlük için kısa teknik özet (anahtar içermez). */
  detail: string;
  /**
   * Bulut beyni şu an kullanılamaz (anahtar geçersiz, ödeme/kredi, ağ, zaman aşımı): tur yerel modele düşebilir
   * ve bir süre doğrudan yerelden başlanır.
   */
  cloudDown: boolean;
  /** `cloudDown` ise nedeni (kredi/ödeme, anahtar, ağ); değilse `null`. */
  cloudIssue: BrainCloudIssue | null;
  /**
   * Bulut kalıcı olarak düşük değil ama BU tur yürümedi (OpenAI uyumlu sağlayıcıda hız sınırı, 5xx, model yok, akış
   * metin akmadan koptu): tur yerelde yeniden denenebilir, uzun süre "düşük" sayılmaz. Nedeni duyuru cümlesini seçer.
   */
  localRetry?: 'busy' | 'model' | 'forbidden' | null;
}

/** OpenAI uyumlu sağlayıcı hatası (`providers/openai-compatible.ts`): adı geçen, kısa Türkçe cümle. */
function mapCloudError(error: CloudProviderError, detail: string): MappedError {
  const provider = error.provider || t('cloud.provider.generic');
  const out = (key: Parameters<typeof t>[0], cloudIssue: BrainCloudIssue | null, localRetry: MappedError['localRetry'] = null): MappedError => ({
    stopReason: 'error',
    message: t(key, { provider }),
    detail,
    cloudDown: cloudIssue !== null,
    cloudIssue,
    localRetry: error.partial ? null : localRetry,
  });
  switch (error.kind) {
    case 'auth':
      return out('cloud.error.auth', 'auth');
    case 'billing':
      return out('cloud.error.billing', 'billing');
    case 'network':
    case 'timeout':
      return out('cloud.error.network', 'network');
    case 'rate_limit':
      return out('cloud.error.rateLimit', null, 'busy');
    case 'server':
      return out('cloud.error.server', null, 'busy');
    case 'model':
      return out('cloud.error.model', null, 'model');
    case 'context':
      return out('brain.error.tooLong', null);
    case 'forbidden':
      return out('cloud.error.forbidden', null, 'forbidden');
    case 'stream_cut':
      return out('cloud.error.cut', null, 'busy');
    default:
      return out('cloud.error.badRequest', null);
  }
}

/** Sırayla en özelden en genele: `APIConnectionError` de bir `APIError` alt sınıfıdır. */
export function mapBrainError(error: unknown, aborted: boolean): MappedError {
  const detail = describe(error);
  if (aborted || error instanceof Anthropic.APIUserAbortError || (error instanceof Error && error.name === 'AbortError')) {
    return { stopReason: 'aborted', message: '', detail, cloudDown: false, cloudIssue: null };
  }
  if (error instanceof CloudProviderError) return mapCloudError(error, detail);
  const fail = (key: Parameters<typeof t>[0]): MappedError => ({
    stopReason: 'error',
    message: t(key),
    detail,
    cloudDown: (key as string) in CLOUD_DOWN,
    cloudIssue: CLOUD_DOWN[key as string] ?? null,
  });
  if (error instanceof Anthropic.APIConnectionTimeoutError) return fail('brain.error.timeoutAnthropic');
  if (error instanceof Anthropic.APIConnectionError) return fail('brain.error.network');
  if (error instanceof Anthropic.AuthenticationError) return fail('brain.error.auth');
  if (error instanceof Anthropic.PermissionDeniedError) return fail('brain.error.permission');
  if (error instanceof Anthropic.NotFoundError) return fail('brain.error.model');
  if (error instanceof Anthropic.RateLimitError) return fail('brain.error.busy');
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    // Kredisi biten hesap 400 döner; kullanıcıya "teknik sorun" değil, ödeme sorunu olarak söylenmeli.
    if (status === 402 || /credit balance|billing/i.test(error.message)) return fail('brain.error.billing');
    if (status === 413) return fail('brain.error.tooLong');
    if (status === 408 || status === 504) return fail('brain.error.timeoutAnthropic');
    if (status === 529 || status >= 500) return fail('brain.error.busy');
    if (status === 400) return fail('brain.error.badRequest');
  }
  return fail('brain.error.unknown');
}

function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    const type = (error as { type?: string }).type ?? '';
    return `${error.constructor.name} ${error.status ?? ''} ${type} ${error.message}`.trim();
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
