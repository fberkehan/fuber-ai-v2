/**
 * Politika servisinin kontrol servisine bakan yüzü. HTTP konuşan TEK istemci `@fuber/control/client`'tır
 * (`createControlClient`); bu dosya yalnız onu politika servisinin beklediği dar arayüze (`ControlClientLike`)
 * uyarlar ve hatalarını tek bir `ControlError` koduna çevirir. Burada `fetch` çağrısı yoktur.
 */

import { ControlClientError, createControlClient, type FetchFn } from '@fuber/control/client';
import type {
  ControlErrorCode,
  HeartbeatRequest,
  HeartbeatResponse,
  PolicyEnvelope,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  UsageReportRequest,
  UsageReportResponse,
} from '@fuber/shared';

/** Servisin bildirdiği hata kodları + bağlantı düzeyindeki nedenler. */
export type ControlFailure = ControlErrorCode | 'network' | 'timeout' | 'aborted' | 'bad_response';

export class ControlError extends Error {
  constructor(
    readonly code: ControlFailure,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ControlError';
  }
}

export interface ControlClientLike {
  registerDevice(request: RegisterDeviceRequest, signal?: AbortSignal): Promise<RegisterDeviceResponse>;
  /**
   * `GET /v1/policy`. `etag` verilirse `If-None-Match` olarak gider; `waitSeconds > 0` uzun yoklamadır.
   * Politika değişmediyse (304) `null` döner.
   */
  fetchPolicy(options: {
    token: string;
    etag: string | null;
    waitSeconds: number;
    signal?: AbortSignal;
  }): Promise<PolicyEnvelope | null>;
  reportUsage(token: string, request: UsageReportRequest, signal?: AbortSignal): Promise<UsageReportResponse>;
  heartbeat(token: string, request: HeartbeatRequest, signal?: AbortSignal): Promise<HeartbeatResponse>;
}

export interface ControlAdapterOptions {
  fetch?: FetchFn;
  /** Uzun yoklama dışındaki isteklerin zaman aşımı (ms). */
  requestTimeoutMs?: number;
}

function toControlError(error: unknown): ControlError {
  if (error instanceof ControlError) return error;
  if (!(error instanceof ControlClientError)) {
    return new ControlError('network', String((error as Error)?.message ?? error));
  }
  if (error.kind === 'http') {
    const fallback: ControlErrorCode = error.status === 401 ? 'unauthorized' : error.status === 404 ? 'not_found' : 'internal';
    return new ControlError(error.code ?? fallback, error.message, error.status);
  }
  return new ControlError(error.kind, error.message, error.status);
}

/** `@fuber/control/client` üstünde `ControlClientLike`. Belirteci politika servisi saklar; her çağrıda istemciye verilir. */
export function createFetchControlClient(baseUrl: string, options: ControlAdapterOptions = {}): ControlClientLike {
  const client = createControlClient({
    baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.requestTimeoutMs !== undefined ? { timeoutMs: options.requestTimeoutMs } : {}),
  });
  const guarded = async <T>(token: string | null, work: () => Promise<T>): Promise<T> => {
    if (token !== null) client.setDeviceToken(token);
    try {
      return await work();
    } catch (error) {
      throw toControlError(error);
    }
  };

  return {
    registerDevice: (request, signal) => guarded(null, () => client.register(request, { ...(signal ? { signal } : {}) })),
    fetchPolicy: ({ token, etag, waitSeconds, signal }) =>
      guarded(token, async () => {
        const result = await client.getPolicy({ etag, waitSeconds, ...(signal ? { signal } : {}) });
        // ETag anahtar değişimini de kapsar; "değişmedi" yanıtında önbellekteki politika ve anahtarlar geçerlidir.
        return result.changed ? { ...result.envelope, etag: result.etag } : null;
      }),
    reportUsage: (token, request, signal) =>
      guarded(token, () => client.sendUsage(request.events, { ...(signal ? { signal } : {}) })),
    heartbeat: (token, request, signal) => guarded(token, () => client.heartbeat(request, { ...(signal ? { signal } : {}) })),
  };
}
