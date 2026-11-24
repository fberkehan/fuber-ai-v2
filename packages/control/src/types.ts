/**
 * Kontrol servisinin dışarıdan verilen bağımlılıkları ve kendi hata/sonuç tipleri.
 * HTTP sözleşmesi `@fuber/shared` içindeki `control-api.ts` dosyasındadır; burada yalnız servise özgü olanlar var.
 */

import type { KeyTestResult, KeyTestStatus as SharedKeyTestStatus } from '@fuber/shared';

/**
 * Anahtar kasasının şifreleme sürücüsü. Yönetim ana süreci Electron `safeStorage` ile verir;
 * sınamalar sahte bir sürücü verir. Şifreleme kullanılamıyorsa `encrypt` fırlatmalıdır.
 */
export interface SecretsDriver {
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
  /** Verilmezse kullanılabilir sayılır. `false` iken kasa yazmayı reddeder (düz metin yazılmaz). */
  isAvailable?(): boolean;
}

export interface ControlLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export const silentLogger: ControlLogger = { info() {}, warn() {}, error() {} };

/** Sözleşmedeki adlarla aynı; eski içe aktarımlar kırılmasın diye takma ad. */
export type KeyTestStatus = SharedKeyTestStatus;
export type KeyTestOutcome = KeyTestResult;

/** Kontrol servisinin beklenen hataları; HTTP katmanı bunları `ControlErrorBody`'ye çevirir. */
export type ServiceErrorCode =
  | 'unauthorized'
  | 'device_pending'
  | 'device_revoked'
  | 'not_found'
  | 'conflict'
  | 'invalid_request'
  | 'encryption_unavailable'
  | 'internal';

export class ControlServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly httpStatus: number = defaultStatus(code),
  ) {
    super(message);
    this.name = 'ControlServiceError';
  }
}

function defaultStatus(code: ServiceErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'device_pending':
    case 'device_revoked':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'invalid_request':
      return 422;
    case 'encryption_unavailable':
      return 503;
    case 'internal':
      return 500;
  }
}

/** Servisin başlatılamaması: port dolu, veritabanı kilitli vb. */
export class ControlStartError extends Error {
  constructor(
    readonly code: 'port_in_use' | 'database_locked' | 'database_unavailable' | 'listen_failed',
    message: string,
    readonly detail?: { port?: number; occupant?: 'fuber-control' | 'foreign' | 'unknown' },
  ) {
    super(message);
    this.name = 'ControlStartError';
  }
}
