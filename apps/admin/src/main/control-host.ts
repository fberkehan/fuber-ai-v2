/**
 * Gömülü kontrol servisinin yaşam döngüsü: veritabanını açar, portu dinler, durumu raporlar.
 * Port doluysa ya da veritabanı açılamazsa uygulama çökmez; durum `error` taşır ve arayüz bunu gösterir.
 * Veritabanı açıksa yönetim işlemleri port dolu olsa bile süreç içinden çalışır.
 */

import path from 'node:path';
import {
  ControlStartError,
  createControlService,
  type ControlAdmin,
  type ControlChange,
  type ControlLogger,
  type ControlService,
  type FetchLike,
  type SecretsDriver,
} from '@fuber/control';
import { CONTROL_DB_FILE, CONTROL_HOST, UserError, t, type ControlServiceStatus } from '@fuber/shared';

export interface ControlHostOptions {
  dataDir: string;
  port: number;
  secrets: SecretsDriver;
  adminToken: string;
  log: ControlLogger;
  onChange(change: ControlChange): void;
  onStatus(status: ControlServiceStatus): void;
  /** Sağlayıcı çağrıları için (sınamada sahte sunucuya yönelten `fetch`). */
  providerFetch?: FetchLike;
}

export interface ControlHost {
  status(): ControlServiceStatus;
  /** Servis açılamadıysa `UserError` fırlatır (arayüze Türkçe neden gider). */
  admin(): ControlAdmin;
  /** Veritabanı hiç açılamadıysa `null`. */
  service(): ControlService | null;
  start(): Promise<ControlServiceStatus>;
  restart(): Promise<ControlServiceStatus>;
  close(): Promise<void>;
}

export function createControlHost(options: ControlHostOptions): ControlHost {
  const dbPath = path.join(options.dataDir, CONTROL_DB_FILE);
  let service: ControlService | null = null;
  let unsubscribe: (() => void) | null = null;
  let startedAt: string | null = null;
  let error: string | null = null;

  const status = (): ControlServiceStatus => {
    const listening = service?.listening() ?? null;
    const port = listening?.port ?? options.port;
    return {
      running: !!listening,
      url: listening?.url ?? `http://${CONTROL_HOST}:${port}`,
      port,
      startedAt: listening ? startedAt : null,
      dbPath,
      encryptionAvailable: safeAvailable(options.secrets),
      error,
    };
  };

  function ensureService(): ControlService {
    if (service) return service;
    service = createControlService({
      dbPath,
      secrets: options.secrets,
      adminToken: options.adminToken,
      log: options.log,
      ...(options.providerFetch ? { fetch: options.providerFetch } : {}),
    });
    unsubscribe = service.onChange(options.onChange);
    if (service.recoveredFrom) {
      options.log.warn(t('admin.main.service.dbRecovered', { file: path.basename(service.recoveredFrom) }));
    }
    return service;
  }

  async function start(): Promise<ControlServiceStatus> {
    try {
      const svc = ensureService();
      await svc.start(options.port, CONTROL_HOST);
      startedAt = new Date().toISOString();
      error = null;
    } catch (cause) {
      error = cause instanceof ControlStartError ? cause.message : `Kontrol servisi başlatılamadı: ${String(cause)}`;
      options.log.error('admin: kontrol servisi başlatılamadı', { error });
    }
    const current = status();
    options.onStatus(current);
    return current;
  }

  return {
    status,
    admin() {
      if (!service) throw new UserError(t('admin.main.service.unavailable', { reason: error ?? '—' }));
      return service.admin;
    },
    service: () => service,
    start,
    async restart() {
      await service?.stop();
      return start();
    },
    async close() {
      unsubscribe?.();
      unsubscribe = null;
      const closing = service;
      service = null;
      await closing?.close();
    },
  };
}

function safeAvailable(secrets: SecretsDriver): boolean {
  try {
    return secrets.isAvailable ? secrets.isAvailable() : true;
  } catch {
    return false;
  }
}
