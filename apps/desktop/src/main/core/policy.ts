/**
 * Politika istemcisi (KURGU §11): cihazı kontrol servisine kaydeder, politikayı ETag + uzun yoklamayla izler,
 * son geçerli politikayı diske önbellekler (anahtarlar `safeStorage` ile şifreli) ve değişimi olay yoluna duyurur.
 * Bağlantı yoksa önbellek, o da yoksa gömülü `DEFAULT_POLICY` yürürlüktedir. Açılış ağı beklemez:
 * `start()` yalnız önbelleği okur, bağlantı arka planda denenir.
 *
 * Sınama anahtarı burada okunmaz: bootstrap bu servisi `testing.wrapPolicy` ile sarar.
 */

import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import {
  APP_VERSION,
  CONTROL_LONG_POLL_SECONDS,
  DEFAULT_POLICY,
  isUpdateRequired,
  nowIso,
  parsePolicy,
  type ControlStatus,
  type HeartbeatResponse,
  type IsoDateTime,
  type JsonObject,
  type Policy,
  type PolicyApi,
  type PolicyKeys,
  type ServiceDeps,
  type Unsubscribe,
  type UsageEvent,
  type UsageRecord,
} from '@fuber/shared';
import { ControlError, createFetchControlClient, type ControlClientLike } from './policy-client';
import type { UsageUploadQueue } from './usage';

// Sözleşmede acil durdurma ve sürüm kapısı için ayrı olay yok (`policy.changed` yalnız değişen alan adını taşır).
// Kapının açılıp kapandığı an ayrıca bu iki olayla duyurulur; ana süreçte kalırlar, pencerelere gitmezler.
declare module '@fuber/shared' {
  interface BusEvents {
    'app.killSwitch': { active: boolean; message: string | null };
    'app.updateRequired': { required: boolean; minVersion: string; downloadUrl: string | null };
  }
}

/** Anahtarları ve cihaz belirtecini diske yazmadan önce şifreleyen katman. */
export interface PolicyCipher {
  available(): boolean;
  /** Şifreli metni base64 olarak döndürür. */
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

const electronCipher: PolicyCipher = {
  available() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
};

export interface PolicyTimings {
  longPollSeconds: number;
  /** Bağlantı hatasında ilk bekleme; her hatada ikiye katlanır. */
  backoffMinMs: number;
  backoffMaxMs: number;
  /** Cihaz onay beklerken yeniden deneme aralığı. */
  pendingRetryMs: number;
  heartbeatMs: number;
  /** Kullanım olayları bu kadar biriktirilip tek istekte gönderilir. */
  usageFlushMs: number;
}

const DEFAULT_TIMINGS: PolicyTimings = {
  longPollSeconds: CONTROL_LONG_POLL_SECONDS,
  backoffMinMs: 1000,
  backoffMaxMs: 30_000,
  pendingRetryMs: 5000,
  heartbeatMs: 60_000,
  usageFlushMs: 5000,
};

export interface PolicyOptions {
  /** Verilen adrese bağlanan istemci. Varsayılan: `@fuber/control/client` üstündeki uyarlayıcı. */
  createClient?(url: string): ControlClientLike;
  cipher?: PolicyCipher;
  timings?: Partial<PolicyTimings>;
}

/**
 * Politika servisinin kontrol servisine giden ek ucu. Kullanım kayıtlarının TEK kaynağı `usage` servisinin kalıcı
 * kuyruğudur (`usage_records.synced_at`): bellekte ayrı bir sıra tutulmaz, böylece çevrimdışıyken ya da uygulama
 * kapanırken gönderilemeyen kayıt kaybolmaz. `usage.recorded` olayı yalnız "gönderilecek bir şey var" işaretidir.
 */
export interface ControlLink {
  /** Kalıcı kuyruğu bağlar. `usage` servisi `policy`'den sonra kurulduğu için bootstrap bir kez çağırır. */
  attachUsageQueue(queue: UsageUploadQueue): void;
  /** Kalp atışını hemen gönderir. Bağlı değilse `null`. */
  heartbeat(): Promise<HeartbeatResponse | null>;
}

export function controlLinkOf(policy: PolicyApi): ControlLink | null {
  return 'attachUsageQueue' in policy && 'heartbeat' in policy ? (policy as PolicyApi & ControlLink) : null;
}

interface CacheFile {
  v: 1;
  savedAt: IsoDateTime;
  /** Politikanın alındığı kontrol servisi; `etag` yalnız aynı adres için geçerlidir. */
  url: string;
  etag: string | null;
  /** Anahtarsız politika. */
  policy: unknown;
  /** Şifreli anahtarlar (base64); şifreleme yoksa ya da anahtar yoksa `null`. */
  keys: string | null;
}

interface DeviceRecord {
  url: string;
  id: string;
  /** Şifreli cihaz belirteci; şifreleme yoksa `null` (her açılışta yeniden kayıt olunur). */
  token: string | null;
}

type Outcome = 'synced' | 'pending' | 'revoked' | 'offline' | 'aborted';

/** Kontrol servisi tek istekte en çok bu kadar olay kabul eder. */
const USAGE_BATCH = 500;

const hasKeys = (keys: PolicyKeys) => Object.values(keys).some((value) => typeof value === 'string' && value !== '');

function diffKeys(a: Policy, b: Policy): string[] {
  return (Object.keys(b) as Array<keyof Policy>).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

function toUsageEvent(record: UsageRecord): UsageEvent {
  const { sessionId: _sessionId, ...event } = record;
  return event;
}

export function createPolicy(deps: ServiceDeps['policy'], options: PolicyOptions = {}): PolicyApi & ControlLink {
  const { paths, settings, bus } = deps;
  const log = deps.log.child('policy');
  const kv = deps.store.kv('policy');
  const cipher = options.cipher ?? electronCipher;
  const timings = { ...DEFAULT_TIMINGS, ...options.timings };
  const makeClient = options.createClient ?? ((url: string) => createFetchControlClient(url));

  let policy: Policy = DEFAULT_POLICY;
  let source: ControlStatus['policySource'] = 'embedded';
  let etag: string | null = null;
  let loaded = false;

  let state: ControlStatus['state'] = 'unregistered';
  let deviceId: string | null = null;
  let token: string | null = null;
  let lastSyncAt: IsoDateTime | null = null;
  let lastError: string | null = null;
  let announced = '';

  let boundUrl: string | null = null;
  let client: ControlClientLike | null = null;

  let running = false;
  let stopped = false;
  let forceImmediate = false;
  let inFlight: AbortController | null = null;
  let wake: (() => void) | null = null;
  const waiters: Array<(status: ControlStatus) => void> = [];
  const subscriptions: Unsubscribe[] = [];
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let flushTimer: NodeJS.Timeout | null = null;
  const startedAt = Date.now();

  let usageQueue: UsageUploadQueue | null = null;
  let flushing = false;
  let voiceReady = false;
  const loadedModules = new Set<string>();

  const status = (): ControlStatus => ({
    state,
    url: settings.get().controlUrl,
    deviceId,
    policyRevision: policy.revision,
    policySource: source,
    lastSyncAt,
    lastError,
  });

  const announce = () => {
    const current = status();
    const fingerprint = JSON.stringify(current);
    if (fingerprint === announced) return;
    announced = fingerprint;
    bus.emit('control.status', current);
  };

  // ── önbellek ──

  const saveCache = () => {
    const { keys, ...rest } = policy;
    const secret = hasKeys(keys);
    const canEncrypt = cipher.available();
    const file: CacheFile = {
      v: 1,
      savedAt: nowIso(),
      url: boundUrl ?? settings.get().controlUrl,
      // Anahtarlar yazılamadıysa özet de saklanmaz: yoksa sunucu "değişmedi" der ve anahtarlar hiç gelmez.
      etag: !secret || canEncrypt ? etag : null,
      policy: { ...rest, keys: {} },
      keys: secret && canEncrypt ? cipher.encrypt(JSON.stringify(keys)) : null,
    };
    try {
      const temp = `${paths.policyCache}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(file));
      fs.renameSync(temp, paths.policyCache);
    } catch (error) {
      log.warn('politika önbelleği yazılamadı', error);
    }
  };

  const loadCache = (): { policy: Policy; etag: string | null } | null => {
    let raw: Partial<CacheFile>;
    try {
      raw = JSON.parse(fs.readFileSync(paths.policyCache, 'utf8')) as Partial<CacheFile>;
    } catch {
      return null;
    }
    const cached = parsePolicy(raw.policy);
    if (!cached) {
      log.warn('politika önbelleği okunamadı; gömülü varsayılan kullanılıyor');
      return null;
    }
    let keys: PolicyKeys = {};
    let keysOk = raw.keys == null;
    if (typeof raw.keys === 'string' && cipher.available()) {
      try {
        keys = JSON.parse(cipher.decrypt(raw.keys)) as PolicyKeys;
        keysOk = true;
      } catch (error) {
        log.warn('önbellekteki anahtarlar çözülemedi; kontrol servisinden yeniden alınacak', error);
      }
    }
    const sameServer = raw.url === settings.get().controlUrl;
    return { policy: { ...cached, keys }, etag: keysOk && sameServer && typeof raw.etag === 'string' ? raw.etag : null };
  };

  const loadDevice = () => {
    const record = kv.get<JsonObject>('device') as Partial<DeviceRecord> | undefined;
    if (!record || record.url !== settings.get().controlUrl || typeof record.id !== 'string') return;
    deviceId = record.id;
    if (typeof record.token === 'string' && cipher.available()) {
      try {
        token = cipher.decrypt(record.token);
      } catch {
        token = null;
      }
    }
    // Kayıtlı ama henüz bu oturumda ulaşılamadı: ilk yanıt gelene kadar "çevrimdışı".
    state = token ? 'offline' : 'unregistered';
  };

  const saveDevice = () => {
    if (!deviceId || !boundUrl) return kv.delete('device');
    kv.set('device', {
      url: boundUrl,
      id: deviceId,
      token: token && cipher.available() ? cipher.encrypt(token) : null,
    });
  };

  const installId = (): string => {
    let id = kv.get<string>('installId');
    if (!id) {
      id = randomUUID();
      kv.set('installId', id);
    }
    return id;
  };

  // ── politika uygulama ──

  const apply = (next: Policy, from: ControlStatus['policySource']) => {
    const previous = policy;
    const changedKeys = diffKeys(previous, next);
    const sourceChanged = source !== from;
    policy = next;
    source = from;
    if (changedKeys.length === 0 && !sourceChanged) return;
    bus.emit('policy.changed', { revision: next.revision, source: from, changedKeys });

    if (previous.killSwitch.active !== next.killSwitch.active || previous.killSwitch.message !== next.killSwitch.message) {
      log.warn(next.killSwitch.active ? 'acil durdurma etkin' : 'acil durdurma kalktı');
      bus.emit('app.killSwitch', { active: next.killSwitch.active, message: next.killSwitch.message ?? null });
    }
    const required = isUpdateRequired(next);
    if (isUpdateRequired(previous) !== required) {
      log.warn(required ? `zorunlu güncelleme: en az ${next.release.minVersion}` : 'zorunlu güncelleme kalktı');
      bus.emit('app.updateRequired', {
        required,
        minVersion: next.release.minVersion,
        downloadUrl: next.release.downloadUrl ?? null,
      });
    }
  };

  const ensureLoaded = () => {
    if (loaded) return;
    loaded = true;
    loadDevice();
    const cached = loadCache();
    if (cached) {
      etag = cached.etag;
      apply(cached.policy, 'cache');
    }
  };

  // ── kontrol servisiyle konuşma ──

  const bind = (url: string) => {
    if (url === boundUrl && client) return client;
    if (boundUrl !== null) {
      // Belirteç ve özet başka bir servise aittir.
      deviceId = null;
      token = null;
      etag = null;
      state = 'unregistered';
      kv.delete('device');
    }
    boundUrl = url;
    client = makeClient(url);
    return client;
  };

  const dropKeys = () => {
    if (!hasKeys(policy.keys)) return;
    apply({ ...policy, keys: {} }, source);
    etag = null;
    saveCache();
  };

  const cycle = async (waitSeconds: number, signal: AbortSignal): Promise<Outcome> => {
    ensureLoaded();
    const api = bind(settings.get().controlUrl);
    try {
      if (!token) {
        const registered = await api.registerDevice(
          { name: os.hostname(), platform: process.platform, arch: process.arch, appVersion: APP_VERSION, installId: installId() },
          signal,
        );
        deviceId = registered.deviceId;
        token = registered.token;
        state = registered.status;
        etag = null;
        saveDevice();
        log.info(`cihaz kaydedildi (${registered.status})`);
      }
      const envelope = await api.fetchPolicy({ token, etag, waitSeconds, signal });
      state = 'approved';
      lastSyncAt = nowIso();
      lastError = null;
      if (envelope) {
        const next = parsePolicy(envelope.policy);
        if (!next) throw new ControlError('bad_response', 'kontrol servisinden gelen politika geçersiz');
        if (next.revision < policy.revision && source !== 'embedded') {
          log.warn(`kontrol servisi daha eski bir politika sürümü gönderdi (${policy.revision} → ${next.revision}); uygulanıyor`);
        }
        etag = envelope.etag || null;
        apply(next, 'remote');
        saveCache();
        log.info(`politika alındı: sürüm ${next.revision}`);
      } else if (source !== 'remote') {
        // 304: önbellekteki politika sunucudakiyle aynı.
        apply(policy, 'remote');
      }
      announce();
      flushSoon(0);
      return 'synced';
    } catch (error) {
      const failure = error instanceof ControlError ? error : new ControlError('network', String((error as Error)?.message ?? error));
      if (failure.code === 'aborted') return 'aborted';
      let outcome: Outcome = 'offline';
      if (failure.code === 'device_pending') {
        state = 'pending';
        outcome = 'pending';
      } else if (failure.code === 'device_revoked') {
        state = 'revoked';
        outcome = 'revoked';
        // Yetkisi alınan cihaz sağlayıcı anahtarlarını tutmaz.
        dropKeys();
      } else if (failure.code === 'unauthorized') {
        // Belirteç tanınmıyor (servis sıfırlanmış olabilir): bir sonraki turda yeniden kayıt olunur.
        token = null;
        etag = null;
        state = 'unregistered';
        saveDevice();
      } else {
        state = 'offline';
      }
      if (lastError !== failure.message) log.warn(`kontrol servisi: ${failure.message}`);
      lastError = failure.message;
      announce();
      return outcome;
    }
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
      wake = done;
    });

  const loop = async () => {
    let failures = 0;
    let first = true;
    while (!stopped) {
      const immediate = first || forceImmediate;
      first = false;
      forceImmediate = false;
      const waiting = immediate ? waiters.splice(0) : [];
      inFlight = new AbortController();
      const began = Date.now();
      const outcome = await cycle(immediate ? 0 : timings.longPollSeconds, inFlight.signal);
      inFlight = null;
      for (const resolve of waiting) resolve(status());
      if (stopped) break;
      if (outcome === 'aborted' || forceImmediate) continue;

      let delay = 0;
      if (outcome === 'synced') {
        failures = 0;
        // Uzun yoklamayı desteklemeyen (hemen dönen) sunucuya karşı boşa dönmeyi önler.
        if (!immediate && Date.now() - began < 1000) delay = timings.backoffMinMs;
      } else if (outcome === 'pending') {
        delay = timings.pendingRetryMs;
      } else if (outcome === 'revoked') {
        delay = timings.backoffMaxMs;
      } else {
        delay = Math.min(timings.backoffMaxMs, timings.backoffMinMs * 2 ** failures);
        failures++;
      }
      if (delay > 0) await sleep(delay);
    }
    running = false;
    for (const resolve of waiters.splice(0)) resolve(status());
  };

  const kick = (): Promise<ControlStatus> => {
    if (!running) {
      // Döngü çalışmıyorken (başlatılmadan ya da durduktan sonra) tek seferlik eşitleme.
      if (stopped) return Promise.resolve(status());
      return cycle(0, new AbortController().signal).then(status);
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
      forceImmediate = true;
      inFlight?.abort();
      wake?.();
    });
  };

  // ── kullanım ve kalp atışı ──

  const flush = async () => {
    flushTimer = null;
    if (flushing || !usageQueue || state !== 'approved' || !token || !client) return;
    flushing = true;
    try {
      const batch = usageQueue.pendingUpload(USAGE_BATCH);
      if (batch.length === 0) return;
      // Kimlik cihazda üretilmiştir; sunucu yineleneni kimlikten ayıklar, bu yüzden yeniden gönderim zararsızdır.
      await client.reportUsage(token, { events: batch.map(toUsageEvent) });
      usageQueue.markUploaded(batch.map((record) => record.id));
      if (batch.length === USAGE_BATCH) flushSoon(0);
    } catch (error) {
      // Kayıtlar kuyrukta (veritabanında) kalır; bir sonraki başarılı eşitlemede yeniden denenir.
      log.debug('kullanım gönderilemedi', error);
    } finally {
      flushing = false;
    }
  };

  function flushSoon(delayMs: number = timings.usageFlushMs) {
    if (flushTimer || stopped || !usageQueue) return;
    flushTimer = setTimeout(() => void flush(), delayMs);
    flushTimer.unref?.();
  }

  const heartbeat = async (): Promise<HeartbeatResponse | null> => {
    if (state !== 'approved' || !token || !client) return null;
    try {
      const response = await client.heartbeat(token, {
        appVersion: APP_VERSION,
        policyRevision: policy.revision,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        voiceReady,
        modules: [...loadedModules].sort(),
      });
      if (response.policyRevision > policy.revision || response.status !== 'approved') void kick();
      return response;
    } catch (error) {
      log.debug('kalp atışı gönderilemedi', error);
      return null;
    }
  };

  const api: PolicyApi & ControlLink = {
    start() {
      if (running || stopped) return;
      ensureLoaded();
      announce();
      // Kapılar açılışta zaten kapalıysa dinleyenler ilk andan bilsin.
      if (policy.killSwitch.active) {
        bus.emit('app.killSwitch', { active: true, message: policy.killSwitch.message ?? null });
      }
      if (isUpdateRequired(policy)) {
        bus.emit('app.updateRequired', {
          required: true,
          minVersion: policy.release.minVersion,
          downloadUrl: policy.release.downloadUrl ?? null,
        });
      }
      subscriptions.push(
        bus.on('settings.changed', ({ changedKeys }) => {
          if (changedKeys.includes('controlUrl')) void kick();
        }),
        bus.on('usage.recorded', () => flushSoon()),
        bus.on('voice.status', (voice) => {
          voiceReady = voice.ready;
        }),
        bus.on('module.changed', ({ id, enabled }) => {
          if (enabled) loadedModules.add(id);
          else loadedModules.delete(id);
        }),
      );
      heartbeatTimer = setInterval(() => void heartbeat(), timings.heartbeatMs);
      heartbeatTimer.unref?.();
      running = true;
      void loop();
    },
    stop() {
      stopped = true;
      for (const off of subscriptions.splice(0)) off();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (flushTimer) clearTimeout(flushTimer);
      heartbeatTimer = null;
      flushTimer = null;
      inFlight?.abort();
      wake?.();
    },
    get() {
      ensureLoaded();
      return policy;
    },
    status() {
      ensureLoaded();
      return status();
    },
    async connect(url) {
      const target = url?.trim().replace(/\/+$/, '');
      if (target && target !== settings.get().controlUrl) settings.update({ controlUrl: target });
      return kick();
    },
    refresh: () => kick(),
    moduleAllowed: (moduleId) => api.get().modules[moduleId]?.enabled === true,
    moduleConfig: (moduleId) => api.get().modules[moduleId]?.config ?? {},
    killSwitchActive: () => api.get().killSwitch.active,
    updateRequired: () => isUpdateRequired(api.get()),
    networkAllowed: () => settings.get().privacyMode === 'cloud',
    attachUsageQueue(queue) {
      usageQueue = queue;
      flushSoon(0);
    },
    heartbeat,
  };
  return api;
}
