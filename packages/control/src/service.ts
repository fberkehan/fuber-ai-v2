/**
 * Kontrol servisi (KURGU §11.2): politika, cihazlar, kullanım, anahtar kasası, denetim kaydı.
 * Aynı iş kuralları iki kapıdan açılır: HTTP (`app`, cihazlar ve ileride uzaktan yönetim) ve
 * süreç içi `admin` cephesi (Yönetim ana süreci IPC'den doğrudan çağırır; port dolu olsa bile çalışır).
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createAdaptorServer, type HttpBindings } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  addDays,
  APP_VERSION,
  CONTROL_HOST,
  CONTROL_SERVICE_NAME,
  type UsageTotals,
  CONTROL_ROUTES,
  DEFAULT_POLICY,
  KEY_PROVIDERS,
  localDay,
  parsePolicy,
  clientUnderstandsPolicyV2,
  policyForLegacyClient,
  POLICY_SCHEMA_VERSION,
  policySchemaVersion,
  PolicySchema,
  type AdminUsageDay,
  type AdminUsageResponse,
  type AuditAction,
  type AuditEntry,
  type ControlErrorBody,
  type ControlErrorCode,
  type DeviceRecord,
  type DeviceStatus,
  type HealthResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type KeyProvider,
  type KeyStatus,
  type Policy,
  type PolicyEnvelope,
  type PolicyPatch,
  type PolicyRevisionRecord,
  type RegisterDeviceRequest,
  type RegisterDeviceResponse,
  type UsageEvent,
  type UsageKind,
} from '@fuber/shared';
import { CLOUD_KEY_IDS, endpointForKey, findEndpoint, policyLinkProblems, type CloudModelInfo, type CloudPreset } from '@fuber/shared';
import { openControlDatabase } from './db';
import {
  listAnthropicModels,
  listCloudModels,
  listElevenLabsVoices,
  PROVIDER_LABELS,
  synthesizeElevenLabs,
  testProviderKey,
  type FetchLike,
  type ProviderModel,
  type ProviderVoice,
  type SynthesisResult,
} from './providers';
import { createSqliteStore, type ControlStore, type DeviceRow, type StoredRevision } from './store';
import {
  ControlServiceError,
  ControlStartError,
  silentLogger,
  type ControlLogger,
  type KeyTestOutcome,
  type SecretsDriver,
} from './types';

export { CONTROL_SERVICE_NAME };
const MAX_WAIT_SECONDS = 30;
const MAX_USAGE_EVENTS = 500;

/** Eski adlar: sözleşme genişletildi, bunlar artık sözleşme tiplerinin takma adıdır. */
export type DevicePolicyEnvelope = PolicyEnvelope;
export type ControlHealth = HealthResponse;
export type AdminUsageDayDetail = AdminUsageDay;
export type AdminUsageDetail = AdminUsageResponse;

export type ControlChange =
  | { type: 'policy'; revision: number }
  | { type: 'devices'; ids: string[] }
  | { type: 'keys'; provider: KeyProvider }
  | { type: 'audit'; entry: AuditEntry };

/** Yönetim işlemleri. HTTP `/v1/admin/*` uçları ve Yönetim IPC'si bunları çağırır. */
export interface ControlAdmin {
  getPolicy(): Promise<Policy>;
  updatePolicy(request: { baseRevision: number; patch: PolicyPatch; note: string }): Promise<Policy>;
  policyHistory(limit: number): Promise<PolicyRevisionRecord[]>;
  rollbackPolicy(revision: number): Promise<Policy>;
  setKillSwitch(active: boolean, message?: string): Promise<Policy>;

  listDevices(): Promise<DeviceRecord[]>;
  approveDevice(id: string): Promise<DeviceRecord>;
  revokeDevice(id: string): Promise<DeviceRecord>;
  deleteDevice(id: string): Promise<void>;

  usageSummary(days: number): Promise<AdminUsageDetail>;

  listKeys(): Promise<KeyStatus[]>;
  setKey(provider: KeyProvider, value: string): Promise<KeyStatus>;
  deleteKey(provider: KeyProvider): Promise<KeyStatus>;
  /** `value` verilirse kasaya yazmadan o değeri sınar; yoksa kasadakini sınar ve sonucu kaydeder. */
  testKey(provider: KeyProvider, value?: string): Promise<KeyTestOutcome>;

  listAudit(limit: number, before?: number): Promise<AuditEntry[]>;

  /** Kasadaki Anthropic anahtarıyla `GET /v1/models`. */
  listModels(): Promise<ProviderModel[]>;
  /** Kasadaki ElevenLabs anahtarıyla `GET /v1/voices`. */
  listVoices(): Promise<ProviderVoice[]>;
  /**
   * OpenAI uyumlu sağlayıcı kaydının model listesi (kasadaki anahtarıyla). `draft` verilirse kaydedilmemiş adres/hazır
   * ayar denenir (Yönetim'de "Kaydet"ten önce liste çekmek için).
   */
  listCloudModels(endpointId: string, draft?: { baseUrl?: string; preset?: CloudPreset; keyId?: KeyProvider }): Promise<CloudModelInfo[]>;
  previewVoice(request: { text: string; voiceId?: string; model?: string }): Promise<SynthesisResult>;
}

export interface ControlServiceOptions {
  /** SQLite dosyası (`:memory:` sınamalar için). */
  dbPath: string;
  secrets: SecretsDriver;
  /** `/v1/admin/*` için Bearer belirteci. */
  adminToken: string;
  log?: ControlLogger;
  /** Sağlayıcı çağrıları için (sınamalarda sahte). */
  fetch?: FetchLike;
  /** Sağlayıcı zaman aşımı (ms); varsayılan 10 sn. */
  providerTimeoutMs?: number;
}

export interface ControlService {
  app: Hono<{ Bindings: HttpBindings }>;
  admin: ControlAdmin;
  /** Dinlemeye başlar; `port: 0` boş bir port seçer. Dönen adres gerçek porttur. */
  start(port: number, host?: string): Promise<{ url: string; port: number }>;
  /** HTTP'yi durdurur (bekleyen uzun yoklamalar 304 ile kapanır); veritabanı açık kalır. */
  stop(): Promise<void>;
  /** HTTP'yi durdurur ve veritabanını kapatır. */
  close(): Promise<void>;
  /** Değişiklik bildirimi (arayüze yayın için); dönen işlev aboneliği kaldırır. */
  onChange(listener: (change: ControlChange) => void): () => void;
  listening(): { url: string; port: number } | null;
  /** Bozuk veritabanı kenara alındıysa yedeğin yolu. */
  recoveredFrom: string | null;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopbackAddress = (address: string | null | undefined): boolean =>
  !!address && LOOPBACK.has(address);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a), 'hex');
  const y = Buffer.from(sha256(b), 'hex');
  return timingSafeEqual(x, y);
}

const nowIso = () => new Date().toISOString();

// ───────────────────────────── Doğrulama şemaları ─────────────────────────────

const registerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(50),
  arch: z.string().trim().min(1).max(50),
  appVersion: z.string().trim().min(1).max(100),
  installId: z.string().trim().min(8).max(200),
}) satisfies z.ZodType<RegisterDeviceRequest>;

const count = z.number().finite().nonnegative();
const usageEventSchema = z.object({
  id: z.string().min(1).max(200),
  at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'geçersiz tarih'),
  kind: z.string().min(1).max(40),
  provider: z.string().min(1).max(60),
  model: z.string().max(200),
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  audioSeconds: count,
  costUsd: count,
  costKnown: z.boolean().optional(),
  durationMs: count,
});
const usageSchema = z.object({ events: z.array(usageEventSchema).max(MAX_USAGE_EVENTS) });

const heartbeatSchema = z.object({
  appVersion: z.string().min(1).max(100),
  policyRevision: z.number().int().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
  voiceReady: z.boolean(),
  modules: z.array(z.string().max(100)).max(200),
}) satisfies z.ZodType<HeartbeatRequest>;

const updatePolicySchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  patch: z.record(z.string(), z.unknown()),
  note: z.string().max(500).default(''),
});

const providerSchema = z.enum(KEY_PROVIDERS);
const keyValueSchema = z
  .string()
  .trim()
  .min(8, 'Anahtar çok kısa.')
  .max(1000, 'Anahtar çok uzun.')
  .refine((v) => !/\s/.test(v), 'Anahtar boşluk içeremez.');

function zodMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    .join('; ');
}

function invalid(message: string): ControlServiceError {
  return new ControlServiceError('invalid_request', message);
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid(`İstek geçersiz: ${zodMessage(result.error)}`);
  return result.data;
}

// ───────────────────────────── Politika yardımcıları ─────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** İki politika arasında değişen yaprak alan yolları (`persona.name`); diziler bütün sayılır. */
export function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const out: string[] = [];
    for (const key of [...keys].sort()) {
      if (prefix === '' && (key === 'revision' || key === 'updatedAt' || key === 'keys')) continue;
      out.push(...changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
    }
    return out;
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix || '(kök)'];
}

/** Yamadaki `null` yaprakların yolları. */
function nullPaths(patch: unknown, prefix: string[] = []): string[][] {
  if (!isPlainObject(patch)) return [];
  const out: string[][] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) out.push([...prefix, key]);
    else out.push(...nullPaths(value, [...prefix, key]));
  }
  return out;
}

/** `base`'i bozmadan derin birleştirir; `undefined` "değişmedi", diziler bütün olarak değişir. */
function mergeRaw(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = mergeRaw(base[key], value);
  return out;
}

/**
 * Yamayı politikaya uygular. Yamadaki `null`, alan şemada `null` alabiliyorsa değerdir (ör. modelin `effort`'u:
 * "modelin varsayılanı"); alamıyorsa "isteğe bağlı alanı kaldır" demektir (ör. `voice.tts.voiceId`: sağlayıcının
 * varsayılan sesine dön). Zorunlu alana `null` gelirse kaldırılır ve şema "zorunlu" diye reddeder.
 * Sonuç doğrulanmaz; çağıran `PolicySchema` ile doğrular.
 */
export function mergeWithRemovals(base: Policy, patch: Record<string, unknown>): unknown {
  const merged = mergeRaw(base, patch);
  const nulls = nullPaths(patch);
  if (nulls.length === 0) return merged;
  const first = PolicySchema.safeParse(merged);
  if (first.success) return merged;
  const rejected = new Set(first.error.issues.map((issue) => issue.path.join('.')));
  for (const path of nulls) {
    if (!rejected.has(path.join('.'))) continue;
    // Yamadaki yol boyunca nesneler `mergeRaw`'ın yeni kopyalarıdır; `base` değişmez.
    let node: unknown = merged;
    for (const key of path.slice(0, -1)) node = isPlainObject(node) ? node[key] : undefined;
    if (isPlainObject(node)) delete node[path[path.length - 1]!];
  }
  return merged;
}

const topLevel = (paths: string[]) => [...new Set(paths.map((p) => p.split('.')[0]!))];

function describePaths(paths: string[]): string {
  if (paths.length === 0) return 'değişiklik yok';
  const shown = paths.slice(0, 8).join(', ');
  return paths.length > 8 ? `${shown} ve ${paths.length - 8} alan daha` : shown;
}

function revisionToPolicy(stored: StoredRevision, log: ControlLogger): Policy {
  const parsed = parsePolicy(stored.policy);
  if (!parsed) {
    log.error('control: kayıtlı politika şemaya uymuyor; varsayılan kullanılıyor', { revision: stored.revision });
  }
  return { ...(parsed ?? DEFAULT_POLICY), keys: {}, revision: stored.revision, updatedAt: stored.updatedAt };
}

function toDeviceRecord(d: DeviceRow): DeviceRecord {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    arch: d.arch,
    appVersion: d.appVersion,
    status: d.status,
    registeredAt: d.registeredAt,
    approvedAt: d.approvedAt,
    lastSeenAt: d.lastSeenAt,
    policyRevision: d.policyRevision,
    voiceReady: d.voiceReady,
  };
}

function quoteEtag(value: string): string {
  return `"${value}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .some((part) => part === etag || part === '*');
}

// ───────────────────────────── Servis ─────────────────────────────

export function createControlService(options: ControlServiceOptions): ControlService {
  const log = options.log ?? silentLogger;
  if (!options.adminToken || options.adminToken.length < 16) {
    throw new Error('createControlService: yönetici belirteci en az 16 karakter olmalı');
  }
  const opened = openControlDatabase(options.dbPath, log);
  const store: ControlStore = createSqliteStore(opened.db);
  const providerOptions = { fetch: options.fetch, timeoutMs: options.providerTimeoutMs };

  // ── Değişiklik bildirimi: uzun yoklamalar ve arayüz yayını ──
  const listeners = new Set<(change: ControlChange) => void>();
  let waiters = new Set<() => void>();
  let shuttingDown = false;

  function wakeWaiters(): void {
    const current = waiters;
    waiters = new Set();
    for (const wake of current) wake();
  }

  function emit(change: ControlChange): void {
    if (change.type !== 'audit') wakeWaiters();
    for (const listener of listeners) {
      try {
        listener(change);
      } catch (error) {
        log.error('control: değişiklik dinleyicisi hata verdi', { error: String(error) });
      }
    }
  }

  /** Değişiklik, süre dolması ya da istemcinin bağlantıyı kesmesinden hangisi önce olursa. */
  function waitForChange(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        waiters.delete(done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      if (shuttingDown || signal?.aborted) return resolve();
      timer = setTimeout(done, Math.max(0, ms));
      waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  async function audit(action: AuditAction, actor: string, target: string, summary: string): Promise<AuditEntry> {
    const entry = await store.addAudit({ at: nowIso(), action, actor, target, summary });
    emit({ type: 'audit', entry });
    return entry;
  }

  // ── Politika ──
  const ready = (async () => {
    if (await store.latestRevision()) return;
    const seeded = await store.appendRevision(null, {
      revision: 1,
      updatedAt: nowIso(),
      note: 'İlk açılış: varsayılan politika',
      changedKeys: [],
      policy: { ...DEFAULT_POLICY, keys: {}, revision: 1 },
      actor: 'system',
    });
    if (seeded) log.info('control: varsayılan politika yazıldı (sürüm 1)');
  })().then(upgradeStoredPolicy);

  /**
   * Kayıtlı politika eski biçimdeyse (önceki bir Fuber Yönetim sürümü yazmış) yükseltilmiş hali YENİ BİR SÜRÜM olarak
   * yazılır: değişiklik geçmişte ve denetim kaydında görünür, cihazlar onu olağan yoldan alır. Yükseltmenin kendisi
   * `upgradePolicyDocument`'tadır (masaüstü de aynı işlevi kullanır): varsayılan bulut sesi yerel ekran kartı sesine
   * çevrilir, yerel ses modelleri listeye eklenir. Bilerek seçilmiş ses (başka bir ElevenLabs sesi, Piper) korunur.
   */
  async function upgradeStoredPolicy(): Promise<void> {
    const latest = await store.latestRevision();
    if (!latest || policySchemaVersion(latest.policy) >= POLICY_SCHEMA_VERSION) return;
    const upgraded = parsePolicy(latest.policy);
    if (!upgraded) return;
    const raw = (isPlainObject(latest.policy) ? latest.policy : {}) as Record<string, unknown>;
    const rawTts = isPlainObject(raw.voice) ? raw.voice.tts : undefined;
    const voiceChanged = JSON.stringify(rawTts) !== JSON.stringify(upgraded.voice.tts);
    const modelsChanged = !Array.isArray(raw.localModels) || raw.localModels.length !== upgraded.localModels.length;
    const revision = latest.revision + 1;
    const updatedAt = nowIso();
    const note = voiceChanged
      ? 'Sürüm yükseltmesi: varsayılan ses yerel ekran kartı sesine (Supertonic 3) alındı; yerel ses modelleri listeye eklendi'
      : 'Sürüm yükseltmesi: yerel ses modelleri listeye eklendi (seçili ses korundu)';
    const ok = await store.appendRevision(latest.revision, {
      revision,
      updatedAt,
      note,
      changedKeys: ['schemaVersion', ...(voiceChanged ? ['voice'] : []), ...(modelsChanged ? ['localModels'] : [])],
      policy: { ...upgraded, keys: {}, revision, updatedAt },
      actor: 'system',
    });
    if (!ok) return;
    log.info(`control: politika biçimi yükseltildi (sürüm ${revision})`, { voiceChanged, modelsChanged });
    await audit('policy.update', 'system', `policy:${revision}`, `Politika sürüm ${revision} yayınlandı: ${note}.`);
    emit({ type: 'policy', revision });
  }

  async function currentRevision(): Promise<StoredRevision> {
    await ready;
    const latest = await store.latestRevision();
    if (!latest) throw new ControlServiceError('internal', 'Politika bulunamadı.');
    return latest;
  }

  async function currentPolicy(): Promise<Policy> {
    return revisionToPolicy(await currentRevision(), log);
  }

  async function publish(
    base: Policy,
    next: Policy,
    note: string,
    action: 'policy.update' | 'policy.rollback',
    actor: string,
  ): Promise<Policy> {
    const paths = changedPaths(base, next);
    const revision = base.revision + 1;
    const updatedAt = nowIso();
    const record: StoredRevision = {
      revision,
      updatedAt,
      note,
      changedKeys: topLevel(paths),
      policy: { ...next, keys: {}, revision, updatedAt },
      actor,
    };
    const ok = await store.appendRevision(base.revision, record);
    if (!ok) {
      throw new ControlServiceError('conflict', 'Politika bu arada değişti; yeniden yükleyip tekrar deneyin.');
    }
    const published = revisionToPolicy(record, log);
    await audit(
      action,
      actor,
      `policy:${revision}`,
      `${action === 'policy.rollback' ? 'Geri alma' : 'Politika'} sürüm ${revision} yayınlandı: ${describePaths(paths)}${note ? ` (not: ${note})` : ''}`,
    );
    if (base.killSwitch.active !== published.killSwitch.active) {
      await audit(
        published.killSwitch.active ? 'killswitch.on' : 'killswitch.off',
        actor,
        `policy:${revision}`,
        published.killSwitch.active ? 'Acil durdurma AÇILDI.' : 'Acil durdurma kapatıldı.',
      );
    }
    emit({ type: 'policy', revision });
    return published;
  }

  function applyPatch(base: Policy, patch: unknown): Policy {
    if (!isPlainObject(patch)) throw invalid('Yama bir nesne olmalı.');
    // Sürüm alanları servisçe, anahtarlar kasa uçlarıyla yönetilir; yamada gelirse yok sayılır.
    const { revision: _r, updatedAt: _u, keys: _k, ...rest } = patch;
    const result = PolicySchema.safeParse(mergeWithRemovals(base, rest));
    if (!result.success) throw invalid(`Politika geçersiz: ${zodMessage(result.error)}`);
    return result.data;
  }

  // ── Anahtar kasası ──
  function encryptionAvailable(): boolean {
    try {
      return options.secrets.isAvailable ? options.secrets.isAvailable() : true;
    } catch {
      return false;
    }
  }

  async function decryptKey(provider: KeyProvider): Promise<string | null> {
    const row = await store.getSecret(provider);
    if (!row) return null;
    try {
      return options.secrets.decrypt(row.ciphertext);
    } catch (error) {
      log.warn('control: kasadaki anahtar çözülemedi', { provider, error: (error as Error).name });
      return null;
    }
  }

  async function decryptedKeys(): Promise<Policy['keys']> {
    const keys: Policy['keys'] = {};
    for (const provider of KEY_PROVIDERS) {
      const value = await decryptKey(provider);
      if (value) keys[provider] = value;
    }
    return keys;
  }

  async function keysFingerprint(): Promise<string> {
    const rows = await store.listSecrets();
    return rows
      .map((r) => `${r.provider}@${r.updatedAt}`)
      .sort()
      .join(',');
  }

  async function keyStatus(provider: KeyProvider): Promise<KeyStatus> {
    const row = await store.getSecret(provider);
    return {
      provider,
      present: !!row,
      hint: row?.hint ?? null,
      updatedAt: row?.updatedAt ?? null,
      lastTest: row?.lastTest ?? null,
    };
  }

  // ── Cihazlar ──
  async function deviceOr404(id: string): Promise<DeviceRow> {
    const device = await store.getDevice(id);
    if (!device) throw new ControlServiceError('not_found', 'Cihaz bulunamadı.');
    return device;
  }

  async function setDeviceStatus(id: string, status: DeviceStatus): Promise<DeviceRecord> {
    const device = await deviceOr404(id);
    const patch: Partial<DeviceRow> = { status };
    if (status === 'approved') patch.approvedAt = nowIso();
    await store.updateDevice(id, patch);
    const updated = await deviceOr404(id);
    await audit(
      status === 'approved' ? 'device.approve' : 'device.revoke',
      'admin',
      id,
      `${device.name} ${status === 'approved' ? 'onaylandı' : 'yetkisi alındı'}.`,
    );
    emit({ type: 'devices', ids: [id] });
    return toDeviceRecord(updated);
  }

  async function register(body: unknown, remoteAddress: string | null): Promise<RegisterDeviceResponse> {
    await ready;
    const request = parseOrThrow(registerSchema, body);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const now = nowIso();
    const existing = await store.findDeviceByInstallId(request.installId);
    if (existing) {
      // Aynı kurulum yeniden kaydolursa kayıt çoğalmaz: belirteç yenilenir, onay durumu korunur.
      await store.updateDevice(existing.id, {
        name: request.name,
        platform: request.platform,
        arch: request.arch,
        appVersion: request.appVersion,
        tokenHash,
        lastSeenAt: now,
        remoteAddress,
      });
      emit({ type: 'devices', ids: [existing.id] });
      return { deviceId: existing.id, token, status: existing.status };
    }
    // Geri döngüden gelen kayıt bu bilgisayardandır: yerel kişisel kullanımda ayrıca onay istenmez.
    const status: DeviceStatus = isLoopbackAddress(remoteAddress) ? 'approved' : 'pending';
    const id = randomUUID();
    await store.insertDevice({
      id,
      installId: request.installId,
      name: request.name,
      platform: request.platform,
      arch: request.arch,
      appVersion: request.appVersion,
      status,
      tokenHash,
      registeredAt: now,
      approvedAt: status === 'approved' ? now : null,
      lastSeenAt: now,
      policyRevision: null,
      voiceReady: null,
      uptimeSeconds: null,
      modules: null,
      remoteAddress,
    });
    await audit(
      'device.register',
      id,
      id,
      `${request.name} kaydoldu (${status === 'approved' ? 'bu bilgisayardan, kendiliğinden onaylı' : 'onay bekliyor'}).`,
    );
    emit({ type: 'devices', ids: [id] });
    return { deviceId: id, token, status };
  }

  async function deviceFromToken(authorization: string | undefined): Promise<DeviceRow> {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
    if (!token) throw new ControlServiceError('unauthorized', 'Cihaz belirteci gerekli.');
    const device = await store.findDeviceByTokenHash(sha256(token));
    if (!device) throw new ControlServiceError('unauthorized', 'Cihaz belirteci tanınmıyor; yeniden kaydolun.');
    return device;
  }

  async function envelopeFor(device: DeviceRow): Promise<DevicePolicyEnvelope> {
    const policy = await currentPolicy();
    const fingerprint = await keysFingerprint();
    // Eski masaüstü (biçim sürümü 2'yi tanımayan: demo.1, demo.2) belgedeki yeni değerleri görünce belgeyi geçersiz sayar.
    // O cihaza eski biçimdeki görünüm gider (`policyForLegacyClient`): kurulum sırası önemsizdir. Cihaz güncellenip yeni
    // sürümünü bildirince (nabız) etiket değişir ve tam belgeyi alır.
    const legacy = !clientUnderstandsPolicyV2(device.appVersion);
    const etag = quoteEtag(sha256(`${policy.revision}|${device.status}|${fingerprint}${legacy ? '|v1' : ''}`).slice(0, 32));
    // Yerel kişisel kullanım aşamasının bilinçli kararı: onaylı cihaz anahtarları çözülmüş alır
    // (KURGU §13: ticari sürüm öncesi anahtarlar istemciye inmeyecek; kısa ömürlü belirteç / vekil).
    const keys = device.status === 'approved' ? await decryptedKeys() : {};
    const body = legacy ? ({ ...policyForLegacyClient(policy), keys } as unknown as Policy) : { ...policy, keys };
    return { policy: body, etag, serverTime: nowIso(), status: device.status };
  }

  // ── Kullanım ──
  async function usageSummary(daysRequested: number): Promise<AdminUsageDetail> {
    const days = Math.min(Math.max(Math.trunc(daysRequested) || 1, 1), 366);
    const today = localDay();
    const firstDay = addDays(today, -(days - 1));
    const rows = await store.usageSince(firstDay);
    const byDay = new Map<string, AdminUsageDayDetail>();
    for (let i = 0; i < days; i++) {
      const day = addDays(today, -i);
      byDay.set(day, { day, costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0, byKind: {}, byDevice: [], byModel: [] });
    }
    for (const row of rows) {
      const day = byDay.get(row.day);
      if (!day) continue;
      day.costUsd += row.costUsd;
      day.calls += row.calls;
      day.inputTokens += row.inputTokens;
      day.outputTokens += row.outputTokens;
      if (row.unpricedCalls) day.unpricedCalls = (day.unpricedCalls ?? 0) + row.unpricedCalls;
      const kind = row.kind as UsageKind;
      let k = day.byKind[kind] as UsageTotals | undefined;
      if (!k) {
        k = { costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
        day.byKind[kind] = k;
      }
      k.costUsd += row.costUsd;
      k.calls += row.calls;
      k.inputTokens += row.inputTokens;
      k.outputTokens += row.outputTokens;
      if (row.unpricedCalls) k.unpricedCalls = (k.unpricedCalls ?? 0) + row.unpricedCalls;
      let dev = day.byDevice.find((d) => d.deviceId === row.deviceId);
      if (!dev) day.byDevice.push((dev = { deviceId: row.deviceId, costUsd: 0, calls: 0 }));
      dev.costUsd += row.costUsd;
      dev.calls += row.calls;
      let model = day.byModel.find((m) => m.provider === row.provider && m.model === row.model);
      if (!model) {
        day.byModel.push(
          (model = { provider: row.provider, model: row.model, costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 }),
        );
      }
      model.costUsd += row.costUsd;
      model.calls += row.calls;
      model.inputTokens += row.inputTokens;
      model.outputTokens += row.outputTokens;
      if (row.unpricedCalls) model.unpricedCalls = (model.unpricedCalls ?? 0) + row.unpricedCalls;
    }
    const policy = await currentPolicy();
    const list = [...byDay.values()];
    return { days: list, today: { costUsd: list[0]?.costUsd ?? 0, budgetUsd: policy.limits.dailyBudgetUsd } };
  }

  async function requireKey(provider: KeyProvider): Promise<string> {
    const key = await decryptKey(provider);
    if (!key) throw new ControlServiceError('not_found', `Kasada ${PROVIDER_LABELS[provider]} anahtarı yok.`);
    return key;
  }

  // ── Yönetim cephesi ──
  const admin: ControlAdmin = {
    getPolicy: currentPolicy,

    async updatePolicy(request) {
      const { baseRevision, patch, note } = parseOrThrow(updatePolicySchema, request);
      const base = await currentPolicy();
      if (base.revision !== baseRevision) {
        throw new ControlServiceError('conflict', 'Politika bu arada değişti; yeniden yükleyip tekrar deneyin.');
      }
      const next = applyPatch(base, patch);
      if (changedPaths(base, next).length === 0) return base;
      // OpenAI uyumlu rol var olan bir sağlayıcı kaydına bağlı olmalı (yoksa masaüstü o rolde beyinsiz kalır).
      const links = policyLinkProblems(next);
      if (links.length > 0) throw invalid(`Politika geçersiz: ${links.join('; ')}`);
      return publish(base, next, note.trim(), 'policy.update', 'admin');
    },

    async policyHistory(limit) {
      const rows = await store.listRevisions(Math.min(Math.max(Math.trunc(limit) || 20, 1), 500));
      return rows.map((r) => ({
        revision: r.revision,
        updatedAt: r.updatedAt,
        note: r.note,
        changedKeys: r.changedKeys,
        policy: revisionToPolicy(r, log),
      }));
    },

    async rollbackPolicy(revision) {
      if (!Number.isInteger(revision) || revision < 1) throw invalid('Geçersiz sürüm numarası.');
      const target = await store.getRevision(revision);
      if (!target) throw new ControlServiceError('not_found', `Sürüm ${revision} bulunamadı.`);
      const base = await currentPolicy();
      const next = revisionToPolicy(target, log);
      return publish(base, { ...next, revision: base.revision }, `Sürüm ${revision} geri yüklendi`, 'policy.rollback', 'admin');
    },

    async setKillSwitch(active, message) {
      const base = await currentPolicy();
      const killSwitch = { active, ...(message?.trim() ? { message: message.trim() } : {}) };
      if (base.killSwitch.active === active && base.killSwitch.message === killSwitch.message) return base;
      const next = PolicySchema.parse({ ...base, killSwitch });
      return publish(base, next, active ? 'Acil durdurma' : 'Acil durdurma kaldırıldı', 'policy.update', 'admin');
    },

    async listDevices() {
      await ready;
      return (await store.listDevices()).map(toDeviceRecord);
    },
    approveDevice: (id) => setDeviceStatus(id, 'approved'),
    revokeDevice: (id) => setDeviceStatus(id, 'revoked'),
    async deleteDevice(id) {
      const device = await deviceOr404(id);
      await store.deleteDevice(id);
      await audit('device.delete', 'admin', id, `${device.name} silindi.`);
      emit({ type: 'devices', ids: [id] });
    },

    usageSummary,

    async listKeys() {
      await ready;
      return Promise.all(KEY_PROVIDERS.map(keyStatus));
    },

    async setKey(provider, value) {
      await ready;
      parseOrThrow(providerSchema, provider);
      const key = parseOrThrow(keyValueSchema, value);
      if (!encryptionAvailable()) {
        throw new ControlServiceError(
          'encryption_unavailable',
          'Bu bilgisayarda şifreleme kullanılamıyor; anahtar kaydedilmedi (düz metin yazılmaz).',
        );
      }
      let ciphertext: Buffer;
      try {
        ciphertext = options.secrets.encrypt(key);
      } catch {
        throw new ControlServiceError('encryption_unavailable', 'Anahtar şifrelenemedi; kaydedilmedi.');
      }
      await store.putSecret({ provider, ciphertext, hint: `…${key.slice(-4)}`, updatedAt: nowIso() });
      await audit('key.set', 'admin', provider, `${PROVIDER_LABELS[provider]} anahtarı kasaya yazıldı.`);
      emit({ type: 'keys', provider });
      return keyStatus(provider);
    },

    async deleteKey(provider) {
      await ready;
      parseOrThrow(providerSchema, provider);
      if (await store.deleteSecret(provider)) {
        await audit('key.delete', 'admin', provider, `${PROVIDER_LABELS[provider]} anahtarı kasadan silindi.`);
        emit({ type: 'keys', provider });
      }
      return keyStatus(provider);
    },

    async testKey(provider, value) {
      await ready;
      parseOrThrow(providerSchema, provider);
      const fromVault = value === undefined;
      const key = fromVault ? await decryptKey(provider) : parseOrThrow(keyValueSchema, value);
      const at = nowIso();
      if (!key) {
        return {
          provider,
          ok: false,
          status: 'missing',
          message: `Kasada ${PROVIDER_LABELS[provider]} anahtarı yok.`,
          latencyMs: 0,
          at,
          httpStatus: null,
        };
      }
      let elevenLabs: { voiceId?: string; model?: string } | undefined;
      if (provider === 'elevenlabs') {
        const tts = (await currentPolicy()).voice.tts;
        if (tts.provider === 'elevenlabs') elevenLabs = { voiceId: tts.voiceId, model: tts.model };
      }
      // OpenAI uyumlu sağlayıcı anahtarı: politikadaki kaydın adresiyle (özel adres dahil) sınanır.
      const endpoint = CLOUD_KEY_IDS.includes(provider) ? endpointForKey(await currentPolicy(), provider) : null;
      const result = await testProviderKey(provider, key, { ...providerOptions, elevenLabs, endpoint });
      const outcome: KeyTestOutcome = {
        provider,
        ok: result.status === 'valid',
        status: result.status,
        message: result.message,
        latencyMs: result.latencyMs,
        at,
        httpStatus: result.httpStatus,
      };
      if (fromVault) {
        await store.setSecretTest(provider, outcome);
        emit({ type: 'keys', provider });
      }
      await audit(
        'key.test',
        'admin',
        provider,
        `${PROVIDER_LABELS[provider]} anahtarı sınandı${fromVault ? '' : ' (kaydedilmemiş değer)'}: ${result.status}${result.httpStatus ? ` (${result.httpStatus})` : ''}.`,
      );
      return outcome;
    },

    async listAudit(limit, before) {
      await ready;
      return store.listAudit(Math.min(Math.max(Math.trunc(limit) || 50, 1), 500), before);
    },

    async listModels() {
      return listAnthropicModels(await requireKey('anthropic'), providerOptions);
    },
    async listVoices() {
      return listElevenLabsVoices(await requireKey('elevenlabs'), providerOptions);
    },
    async listCloudModels(endpointId, draft) {
      const policy = await currentPolicy();
      const saved = findEndpoint(policy, endpointId);
      const preset = draft?.preset ?? saved?.preset;
      const keyId = draft?.keyId ?? saved?.keyId;
      const baseUrl = draft?.baseUrl ?? saved?.baseUrl;
      if (!preset || !keyId || !baseUrl) throw new ControlServiceError('not_found', `"${endpointId}" adlı sağlayıcı kaydı yok.`);
      if (!/^https?:\/\//i.test(baseUrl.trim())) throw invalid('Sağlayıcı adresi http(s) ile başlamalı.');
      const endpoint = { ...(saved ?? { id: endpointId, name: endpointId, model: '-', caps: { tools: true, vision: false, stream: true } }), preset, keyId, baseUrl };
      return listCloudModels(endpoint, await requireKey(keyId), providerOptions);
    },
    async previewVoice(request) {
      const text = request.text.trim().slice(0, 300);
      if (!text) throw invalid('Denenecek metin boş.');
      return synthesizeElevenLabs(await requireKey('elevenlabs'), { ...request, text }, providerOptions);
    },
  };

  // ───────────────────────────── HTTP ─────────────────────────────

  const app = new Hono<{ Bindings: HttpBindings }>();

  const fail = (c: Context, status: number, error: ControlErrorCode, message: string) =>
    c.json({ error, message } satisfies ControlErrorBody, status as 400);

  app.onError((error, c) => {
    if (error instanceof ControlServiceError) {
      const code: ControlErrorCode = error.code === 'encryption_unavailable' ? 'internal' : error.code;
      return fail(c, error.httpStatus, code, error.message);
    }
    log.error('control: istek işlenemedi', { path: c.req.path, error: String(error) });
    return fail(c, 500, 'internal', 'Kontrol servisinde beklenmeyen bir hata oluştu.');
  });
  app.notFound((c) => fail(c, 404, 'not_found', 'Böyle bir uç yok.'));

  // ── Tarayıcı kapısı: bütün uçlardan önce ──
  // Servis yalnız bu bilgisayardaki uygulamalara (Node `fetch`) hizmet eder. Tarayıcıdaki bir sayfa geri
  // döngüye istek atabilir (DNS rebinding, "basit" CORS isteği); onu üç işaretle keseriz:
  //   1. `Host` dinlenen gerçek port üstünde bir geri döngü adı değilse (rebinding'de saldırganın alan adıdır),
  //   2. `Origin` başlığı varsa ya da `Sec-Fetch-Site` `none` dışında bir değerse (tarayıcı kaynaklı istek),
  //   3. gövdeli istekte `Content-Type` `application/json` değilse (ön uçuşsuz `text/plain` gövdesi).
  // Uygulamaların Node `fetch`'i `Origin` / `Sec-Fetch-Site` göndermez, `Host`'u adresten yazar.
  app.use('*', async (c, next) => {
    const port = address?.port;
    const host = (c.req.header('host') ?? '').trim().toLowerCase();
    const allowedHosts = port === undefined ? [] : [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!allowedHosts.includes(host)) {
      return fail(c, 403, 'unauthorized', 'Kontrol servisi yalnız bu bilgisayardaki uygulamalara açıktır (Host reddedildi).');
    }
    const fetchSite = c.req.header('sec-fetch-site');
    if (c.req.header('origin') !== undefined || (fetchSite !== undefined && fetchSite.trim().toLowerCase() !== 'none')) {
      return fail(c, 403, 'unauthorized', 'Tarayıcıdan gelen istekler kontrol servisine kabul edilmez.');
    }
    const hasBody =
      c.req.header('transfer-encoding') !== undefined || Number(c.req.header('content-length') ?? 0) > 0;
    if (hasBody || (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('content-type') !== undefined)) {
      const mediaType = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (mediaType !== 'application/json') {
        return fail(c, 415, 'invalid_request', 'Gövde `Content-Type: application/json` olmalı.');
      }
    }
    await next();
  });

  async function jsonBody(c: Context): Promise<unknown> {
    // Hono `c.req.json()` `Content-Type`'a bakmaz; kapıdan kaçan bir yol olmasın diye burada da denetlenir.
    if ((c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase() !== 'application/json') {
      throw new ControlServiceError('invalid_request', 'Gövde `Content-Type: application/json` olmalı.', 415);
    }
    try {
      return await c.req.json();
    } catch {
      throw invalid('Gövde geçerli JSON değil.');
    }
  }

  const remoteAddress = (c: Context<{ Bindings: HttpBindings }>): string | null =>
    c.env?.incoming?.socket?.remoteAddress ?? null;

  app.get(CONTROL_ROUTES.health, (c) =>
    c.json({ ok: true, version: APP_VERSION, time: nowIso(), service: CONTROL_SERVICE_NAME } satisfies ControlHealth),
  );

  app.post(CONTROL_ROUTES.registerDevice, async (c) => {
    const result = await register(await jsonBody(c), remoteAddress(c));
    return c.json(result satisfies RegisterDeviceResponse);
  });

  app.get(CONTROL_ROUTES.policy, async (c) => {
    let device = await deviceFromToken(c.req.header('authorization'));
    const waitParam = Number(c.req.query('wait') ?? 0);
    const waitSeconds = Number.isFinite(waitParam) ? Math.min(Math.max(waitParam, 0), MAX_WAIT_SECONDS) : 0;
    const ifNoneMatch = c.req.header('if-none-match');
    const deadline = Date.now() + waitSeconds * 1000;
    const signal = c.req.raw.signal;
    await store.updateDevice(device.id, { lastSeenAt: nowIso() });
    for (;;) {
      const envelope = await envelopeFor(device);
      if (!etagMatches(ifNoneMatch, envelope.etag)) {
        c.header('ETag', envelope.etag);
        c.header('Cache-Control', 'no-store');
        c.header('X-Device-Status', envelope.status);
        return c.json(envelope satisfies DevicePolicyEnvelope);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0 || shuttingDown || signal.aborted) {
        c.header('ETag', envelope.etag);
        c.header('X-Device-Status', envelope.status);
        return c.body(null, 304);
      }
      await waitForChange(remaining, signal);
      const refreshed = await store.getDevice(device.id);
      if (!refreshed) throw new ControlServiceError('unauthorized', 'Cihaz kaydı silindi; yeniden kaydolun.');
      device = refreshed;
    }
  });

  app.post(CONTROL_ROUTES.usage, async (c) => {
    const device = await deviceFromToken(c.req.header('authorization'));
    if (device.status === 'revoked') throw new ControlServiceError('device_revoked', 'Bu cihazın yetkisi alındı.');
    if (device.status === 'pending') throw new ControlServiceError('device_pending', 'Cihaz henüz onaylanmadı.');
    const { events } = parseOrThrow(usageSchema, await jsonBody(c));
    const accepted = await store.insertUsage(
      device.id,
      events.map((e) => ({ ...(e as UsageEvent), day: localDay(e.at) })),
      nowIso(),
    );
    await store.updateDevice(device.id, { lastSeenAt: nowIso() });
    return c.json({ accepted });
  });

  app.post(CONTROL_ROUTES.heartbeat, async (c) => {
    const device = await deviceFromToken(c.req.header('authorization'));
    const beat = parseOrThrow(heartbeatSchema, await jsonBody(c));
    await store.updateDevice(device.id, {
      appVersion: beat.appVersion,
      policyRevision: beat.policyRevision,
      uptimeSeconds: Math.round(beat.uptimeSeconds),
      voiceReady: beat.voiceReady,
      modules: beat.modules,
      lastSeenAt: nowIso(),
    });
    emit({ type: 'devices', ids: [device.id] });
    const policy = await currentPolicy();
    return c.json({ serverTime: nowIso(), policyRevision: policy.revision, status: device.status } satisfies HeartbeatResponse);
  });

  // ── /v1/admin/* ──
  app.use('/v1/admin/*', async (c, next) => {
    const token = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1]?.trim();
    if (!token) return fail(c, 401, 'unauthorized', 'Yönetici belirteci gerekli.');
    if (!safeEqual(token, options.adminToken)) return fail(c, 401, 'unauthorized', 'Yönetici belirteci tanınmıyor.');
    await next();
  });

  const intQuery = (c: Context, name: string, fallback: number): number => {
    const value = Number(c.req.query(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const providerParam = (c: Context): KeyProvider => parseOrThrow(providerSchema, c.req.param('provider'));

  app.get(CONTROL_ROUTES.admin.policy, async (c) => c.json({ policy: await admin.getPolicy() }));
  app.put(CONTROL_ROUTES.admin.policy, async (c) => {
    const body = (await jsonBody(c)) as { baseRevision: number; patch: PolicyPatch; note: string };
    return c.json({ policy: await admin.updatePolicy(body) });
  });
  app.get(CONTROL_ROUTES.admin.policyHistory, async (c) => c.json(await admin.policyHistory(intQuery(c, 'limit', 20))));
  app.post(CONTROL_ROUTES.admin.policyRollback, async (c) => {
    const body = (await jsonBody(c)) as { revision?: unknown };
    return c.json({ policy: await admin.rollbackPolicy(Number(body?.revision)) });
  });
  app.get(CONTROL_ROUTES.admin.devices, async (c) => c.json(await admin.listDevices()));
  app.post('/v1/admin/devices/:id/approve', async (c) => c.json(await admin.approveDevice(c.req.param('id'))));
  app.post('/v1/admin/devices/:id/revoke', async (c) => c.json(await admin.revokeDevice(c.req.param('id'))));
  app.delete('/v1/admin/devices/:id', async (c) => {
    await admin.deleteDevice(c.req.param('id'));
    return c.json({ ok: true as const });
  });
  app.get(CONTROL_ROUTES.admin.usage, async (c) => c.json(await admin.usageSummary(intQuery(c, 'days', 14))));
  app.get(CONTROL_ROUTES.admin.keys, async (c) => c.json(await admin.listKeys()));
  app.put('/v1/admin/keys/:provider', async (c) => {
    const body = (await jsonBody(c)) as { value?: unknown };
    return c.json(await admin.setKey(providerParam(c), String(body?.value ?? '')));
  });
  app.delete('/v1/admin/keys/:provider', async (c) => c.json(await admin.deleteKey(providerParam(c))));
  app.post('/v1/admin/keys/:provider/test', async (c) => {
    const raw = await c.req.text();
    let value: string | undefined;
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as { value?: unknown };
        if (typeof parsed?.value === 'string') value = parsed.value;
      } catch {
        throw invalid('Gövde geçerli JSON değil.');
      }
    }
    return c.json(await admin.testKey(providerParam(c), value));
  });
  app.get(CONTROL_ROUTES.admin.audit, async (c) => {
    const before = c.req.query('before');
    return c.json(await admin.listAudit(intQuery(c, 'limit', 50), before ? Number(before) : undefined));
  });
  app.get('/v1/admin/providers/anthropic/models', async (c) => c.json(await admin.listModels()));
  app.get('/v1/admin/providers/elevenlabs/voices', async (c) => c.json(await admin.listVoices()));
  app.get('/v1/admin/providers/cloud/:id/models', async (c) => c.json(await admin.listCloudModels(c.req.param('id'))));

  // ───────────────────────────── Dinleme ─────────────────────────────

  let server: http.Server | null = null;
  let address: { url: string; port: number } | null = null;

  async function probeOccupant(host: string, port: number): Promise<'fuber-control' | 'foreign'> {
    try {
      const response = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${port}${CONTROL_ROUTES.health}`, {
        signal: AbortSignal.timeout(1500),
      });
      const body = (await response.json()) as { service?: unknown };
      return body?.service === CONTROL_SERVICE_NAME ? 'fuber-control' : 'foreign';
    } catch {
      return 'foreign';
    }
  }

  async function start(port: number, host: string = CONTROL_HOST) {
    if (server && address) return address;
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
      // Gece yarısı internete bir şey yayınlanmaz (KURGU §3); uzaktan yönetim ayrı bir karar.
      throw new ControlStartError('listen_failed', `Kontrol servisi yalnız geri döngüde dinler (istenen: ${host}).`);
    }
    await ready;
    shuttingDown = false;
    const candidate = createAdaptorServer({ fetch: app.fetch, hostname: host }) as http.Server;
    try {
      await new Promise<void>((resolve, reject) => {
        candidate.once('error', reject);
        candidate.listen(port, host, () => {
          candidate.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      candidate.close();
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        const occupant = await probeOccupant(host, port);
        throw new ControlStartError(
          'port_in_use',
          occupant === 'fuber-control'
            ? `${port} numaralı portta başka bir Fuber Yönetim kontrol servisi çalışıyor.`
            : `${port} numaralı port başka bir uygulama tarafından kullanılıyor.`,
          { port, occupant },
        );
      }
      throw new ControlStartError('listen_failed', `Kontrol servisi dinlemeye başlayamadı: ${String(error)}`, { port });
    }
    candidate.on('error', (error) => log.error('control: HTTP sunucu hatası', { error: String(error) }));
    server = candidate;
    const actual = (candidate.address() as AddressInfo).port;
    address = { url: `http://${host.includes(':') ? `[${host}]` : host}:${actual}`, port: actual };
    log.info('control: dinliyor', { url: address.url });
    return address;
  }

  async function stop(): Promise<void> {
    if (!server) return;
    const closing = server;
    server = null;
    address = null;
    shuttingDown = true;
    wakeWaiters();
    await new Promise<void>((resolve) => {
      closing.close(() => resolve());
      closing.closeIdleConnections();
      // Yanıtı yazılmakta olan uzun yoklamalara kısa bir pay; sonra hepsi kapatılır.
      setTimeout(() => closing.closeAllConnections(), 250).unref();
    });
  }

  return {
    app,
    admin,
    start,
    stop,
    async close() {
      await stop();
      await ready.catch(() => {});
      store.close();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listening: () => address,
    recoveredFrom: opened.recoveredFrom,
  };
}
