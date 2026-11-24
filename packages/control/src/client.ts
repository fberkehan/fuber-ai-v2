/**
 * Masaüstünün kontrol servisi istemcisi (cihaz uçları). Electron'a ve SQLite'a bağımlı değildir;
 * `@fuber/control/client` yolundan sunucu kodu çekmeden içe aktarılabilir.
 */

import {
  CONTROL_LONG_POLL_SECONDS,
  CONTROL_ROUTES,
  type ControlErrorBody,
  type ControlErrorCode,
  type DeviceStatus,
  type HealthResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type PolicyEnvelope,
  type RegisterDeviceRequest,
  type RegisterDeviceResponse,
  type UsageEvent,
  type UsageReportResponse,
} from '@fuber/shared';

export type ControlClientErrorKind =
  /** Servis yanıt vermedi (kapalı, port yanlış, bağlantı reddedildi). */
  | 'network'
  /** İstek süresinde bitmedi. */
  | 'timeout'
  /** Çağıran iptal etti (`signal`). */
  | 'aborted'
  /** Servis hata gövdesiyle yanıt verdi (`code` dolu). */
  | 'http'
  /** Yanıt beklenen biçimde değil. */
  | 'bad_response';

export class ControlClientError extends Error {
  constructor(
    readonly kind: ControlClientErrorKind,
    message: string,
    /** HTTP hatasında sunucunun kodu (`unauthorized`, `device_revoked` …). */
    readonly code: ControlErrorCode | null = null,
    readonly status: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ControlClientError';
  }

  /** Servise hiç ulaşılamadı: önbellekteki politikayla devam edilmeli. */
  get offline(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ControlClientOptions {
  /** `http://127.0.0.1:47820` */
  baseUrl: string;
  deviceToken?: string | null;
  fetch?: FetchFn;
  /** Uzun yoklama dışındaki isteklerin zaman aşımı (ms); varsayılan 8000. */
  timeoutMs?: number;
}

/** `getPolicy` sonucu: yeni zarf ya da "değişmedi". */
export type PolicyFetchResult =
  | { changed: true; envelope: PolicyEnvelope; etag: string; status: DeviceStatus }
  | { changed: false; etag: string | null; status: DeviceStatus | null };

export interface ControlClient {
  readonly baseUrl: string;
  deviceToken(): string | null;
  setDeviceToken(token: string | null): void;
  health(options?: { signal?: AbortSignal }): Promise<HealthResponse>;
  /** Kaydolur ve dönen belirteci istemciye yerleştirir. */
  register(request: RegisterDeviceRequest, options?: { signal?: AbortSignal }): Promise<RegisterDeviceResponse>;
  /**
   * Politikayı çeker. `etag` verilip politika değişmemişse `changed: false`.
   * `waitSeconds` > 0: uzun yoklama; değişiklik olunca hemen döner. `signal` ile iptal edilebilir.
   */
  getPolicy(options?: { etag?: string | null; waitSeconds?: number; signal?: AbortSignal }): Promise<PolicyFetchResult>;
  sendUsage(events: UsageEvent[], options?: { signal?: AbortSignal }): Promise<UsageReportResponse>;
  heartbeat(request: HeartbeatRequest, options?: { signal?: AbortSignal }): Promise<HeartbeatResponse>;
}

class TimeoutSignal extends Error {}

export function createControlClient(options: ControlClientOptions): ControlClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch: FetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const defaultTimeout = options.timeoutMs ?? 8000;
  let token = options.deviceToken ?? null;

  async function request(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; timeoutMs: number; signal?: AbortSignal; auth: boolean },
  ): Promise<Response> {
    if (init.auth && !token) throw new ControlClientError('http', 'Cihaz kayıtlı değil.', 'unauthorized', 401);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TimeoutSignal()), init.timeoutMs);
    const onAbort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) onAbort();
    else init.signal?.addEventListener('abort', onAbort, { once: true });
    const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
    if (init.auth && token) headers.authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.reason instanceof TimeoutSignal) {
        throw new ControlClientError('timeout', 'Kontrol servisi zamanında yanıt vermedi.', null, null, { cause: error });
      }
      if (init.signal?.aborted) {
        throw new ControlClientError('aborted', 'İstek iptal edildi.', null, null, { cause: error });
      }
      throw new ControlClientError('network', 'Kontrol servisine ulaşılamadı.', null, null, { cause: error });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function failure(response: Response): Promise<ControlClientError> {
    let body: Partial<ControlErrorBody> = {};
    try {
      body = (await response.json()) as Partial<ControlErrorBody>;
    } catch {
      // gövdesiz hata
    }
    return new ControlClientError(
      'http',
      body.message || `Kontrol servisi hata verdi (${response.status}).`,
      body.error ?? null,
      response.status,
    );
  }

  async function json<T>(response: Response): Promise<T> {
    if (!response.ok) throw await failure(response);
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ControlClientError('bad_response', 'Kontrol servisinin yanıtı okunamadı.', null, response.status, {
        cause: error,
      });
    }
  }

  return {
    baseUrl,
    deviceToken: () => token,
    setDeviceToken(next) {
      token = next;
    },

    async health(opts = {}) {
      const response = await request('GET', CONTROL_ROUTES.health, { timeoutMs: defaultTimeout, signal: opts.signal, auth: false });
      return json<HealthResponse>(response);
    },

    async register(body, opts = {}) {
      const response = await request('POST', CONTROL_ROUTES.registerDevice, {
        body,
        timeoutMs: defaultTimeout,
        signal: opts.signal,
        auth: false,
      });
      const result = await json<RegisterDeviceResponse>(response);
      token = result.token;
      return result;
    },

    async getPolicy(opts = {}) {
      const waitSeconds = Math.max(0, Math.min(opts.waitSeconds ?? 0, 30));
      const query = waitSeconds > 0 ? `?wait=${waitSeconds}` : '';
      const headers: Record<string, string> = {};
      if (opts.etag) headers['if-none-match'] = opts.etag;
      const response = await request('GET', `${CONTROL_ROUTES.policy}${query}`, {
        headers,
        // Sunucu en geç `wait` sonunda yanıtlar; ağ payı ayrıca eklenir.
        timeoutMs: waitSeconds * 1000 + defaultTimeout,
        signal: opts.signal,
        auth: true,
      });
      const status = (response.headers.get('x-device-status') as DeviceStatus | null) ?? null;
      if (response.status === 304) {
        return { changed: false, etag: response.headers.get('etag') ?? opts.etag ?? null, status };
      }
      const envelope = await json<PolicyEnvelope & { status?: DeviceStatus }>(response);
      if (!envelope?.policy || typeof envelope.etag !== 'string') {
        throw new ControlClientError('bad_response', 'Politika zarfı eksik.', null, response.status);
      }
      return { changed: true, envelope, etag: envelope.etag, status: envelope.status ?? status ?? 'approved' };
    },

    async sendUsage(events, opts = {}) {
      const response = await request('POST', CONTROL_ROUTES.usage, {
        body: { events },
        timeoutMs: defaultTimeout,
        signal: opts.signal,
        auth: true,
      });
      return json<UsageReportResponse>(response);
    },

    async heartbeat(body, opts = {}) {
      const response = await request('POST', CONTROL_ROUTES.heartbeat, {
        body,
        timeoutMs: defaultTimeout,
        signal: opts.signal,
        auth: true,
      });
      return json<HeartbeatResponse>(response);
    },
  };
}

/** Masaüstü için varsayılan uzun yoklama süresi (saniye). */
export const DEFAULT_LONG_POLL_SECONDS = CONTROL_LONG_POLL_SECONDS;
