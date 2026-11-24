/**
 * Veri erişimi. Servis yalnız `ControlStore` arayüzünü bilir; bugünkü sürücü `node:sqlite`.
 * Arayüz Promise döner ki ileride eşzamansız bir sürücü de aynı yere takılabilsin.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { AuditAction, AuditEntry, DeviceStatus, KeyProvider, UsageEvent } from '@fuber/shared';
import type { KeyTestOutcome } from './types';

export interface StoredRevision {
  revision: number;
  updatedAt: string;
  note: string;
  changedKeys: string[];
  /** Anahtarsız politika JSON'u (çözümlenmemiş; şema değişmiş olabilir). */
  policy: unknown;
  actor: string;
}

export interface DeviceRow {
  id: string;
  installId: string;
  name: string;
  platform: string;
  arch: string;
  appVersion: string;
  status: DeviceStatus;
  tokenHash: string;
  registeredAt: string;
  approvedAt: string | null;
  lastSeenAt: string | null;
  policyRevision: number | null;
  voiceReady: boolean | null;
  uptimeSeconds: number | null;
  modules: string[] | null;
  remoteAddress: string | null;
}

export interface SecretRow {
  provider: KeyProvider;
  ciphertext: Buffer;
  hint: string;
  updatedAt: string;
  lastTest: KeyTestOutcome | null;
}

/** Gün × tür × sağlayıcı × model × cihaz kırılımında toplam. */
export interface UsageAggregateRow {
  day: string;
  kind: string;
  provider: string;
  model: string;
  deviceId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  audioSeconds: number;
  costUsd: number;
  /** Fiyatı bilinmeyen çağrılar (`costUsd`'ye girmez). */
  unpricedCalls: number;
}

export interface ControlStore {
  latestRevision(): Promise<StoredRevision | null>;
  getRevision(revision: number): Promise<StoredRevision | null>;
  listRevisions(limit: number): Promise<StoredRevision[]>;
  /** `expectedLatest` güncel son sürüm değilse yazmaz ve `false` döner (iyimser kilit). */
  appendRevision(expectedLatest: number | null, record: StoredRevision): Promise<boolean>;

  getDevice(id: string): Promise<DeviceRow | null>;
  findDeviceByInstallId(installId: string): Promise<DeviceRow | null>;
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRow | null>;
  listDevices(): Promise<DeviceRow[]>;
  insertDevice(row: DeviceRow): Promise<void>;
  updateDevice(id: string, patch: Partial<Omit<DeviceRow, 'id' | 'installId'>>): Promise<void>;
  deleteDevice(id: string): Promise<boolean>;

  /** Yinelenen (aynı cihaz + aynı olay kimliği) olaylar yok sayılır; yeni eklenen sayısını döner. */
  insertUsage(deviceId: string, events: Array<UsageEvent & { day: string }>, receivedAt: string): Promise<number>;
  usageSince(firstDay: string): Promise<UsageAggregateRow[]>;

  getSecret(provider: KeyProvider): Promise<SecretRow | null>;
  listSecrets(): Promise<SecretRow[]>;
  putSecret(row: Omit<SecretRow, 'lastTest'>): Promise<void>;
  setSecretTest(provider: KeyProvider, test: KeyTestOutcome): Promise<void>;
  deleteSecret(provider: KeyProvider): Promise<boolean>;

  addAudit(entry: Omit<AuditEntry, 'id'>): Promise<AuditEntry>;
  listAudit(limit: number, before?: number): Promise<AuditEntry[]>;

  close(): void;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRevision(r: Row): StoredRevision {
  return {
    revision: Number(r.revision),
    updatedAt: str(r.updated_at),
    note: str(r.note),
    changedKeys: JSON.parse(str(r.changed_keys)) as string[],
    policy: JSON.parse(str(r.policy)) as unknown,
    actor: str(r.actor),
  };
}

function toDevice(r: Row): DeviceRow {
  return {
    id: str(r.id),
    installId: str(r.install_id),
    name: str(r.name),
    platform: str(r.platform),
    arch: str(r.arch),
    appVersion: str(r.app_version),
    status: str(r.status) as DeviceStatus,
    tokenHash: str(r.token_hash),
    registeredAt: str(r.registered_at),
    approvedAt: strOrNull(r.approved_at),
    lastSeenAt: strOrNull(r.last_seen_at),
    policyRevision: numOrNull(r.policy_revision),
    voiceReady: r.voice_ready === null || r.voice_ready === undefined ? null : Number(r.voice_ready) === 1,
    uptimeSeconds: numOrNull(r.uptime_seconds),
    modules: r.modules ? (JSON.parse(str(r.modules)) as string[]) : null,
    remoteAddress: strOrNull(r.remote_address),
  };
}

function toSecret(r: Row): SecretRow {
  const blob = r.ciphertext as Uint8Array;
  return {
    provider: str(r.provider) as KeyProvider,
    ciphertext: Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength),
    hint: str(r.hint),
    updatedAt: str(r.updated_at),
    lastTest: r.last_test ? (JSON.parse(str(r.last_test)) as KeyTestOutcome) : null,
  };
}

function toAudit(r: Row): AuditEntry {
  return {
    id: Number(r.id),
    at: str(r.at),
    action: str(r.action) as AuditAction,
    actor: str(r.actor),
    target: str(r.target),
    summary: str(r.summary),
  };
}

const DEVICE_COLUMNS: Record<keyof Omit<DeviceRow, 'id' | 'installId'>, string> = {
  name: 'name',
  platform: 'platform',
  arch: 'arch',
  appVersion: 'app_version',
  status: 'status',
  tokenHash: 'token_hash',
  registeredAt: 'registered_at',
  approvedAt: 'approved_at',
  lastSeenAt: 'last_seen_at',
  policyRevision: 'policy_revision',
  voiceReady: 'voice_ready',
  uptimeSeconds: 'uptime_seconds',
  modules: 'modules',
  remoteAddress: 'remote_address',
};

type SqlValue = string | number | null | Uint8Array;

function deviceValue(key: keyof typeof DEVICE_COLUMNS, value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (key === 'voiceReady') return value ? 1 : 0;
  if (key === 'modules') return JSON.stringify(value);
  return value as string | number;
}

export function createSqliteStore(db: DatabaseSync): ControlStore {
  const all = (sql: string, ...params: SqlValue[]): Row[] => db.prepare(sql).all(...params) as Row[];
  const one = (sql: string, ...params: SqlValue[]): Row | undefined => db.prepare(sql).get(...params) as Row | undefined;
  const run = (sql: string, ...params: SqlValue[]) => db.prepare(sql).run(...params);

  return {
    async latestRevision() {
      const r = one('SELECT * FROM policy_revisions ORDER BY revision DESC LIMIT 1');
      return r ? toRevision(r) : null;
    },
    async getRevision(revision) {
      const r = one('SELECT * FROM policy_revisions WHERE revision = ?', revision);
      return r ? toRevision(r) : null;
    },
    async listRevisions(limit) {
      return all('SELECT * FROM policy_revisions ORDER BY revision DESC LIMIT ?', limit).map(toRevision);
    },
    async appendRevision(expectedLatest, record) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = one('SELECT MAX(revision) AS rev FROM policy_revisions');
        const latest = r?.rev === null || r?.rev === undefined ? null : Number(r.rev);
        if (latest !== expectedLatest) {
          db.exec('ROLLBACK');
          return false;
        }
        run(
          'INSERT INTO policy_revisions (revision, updated_at, note, changed_keys, policy, actor) VALUES (?, ?, ?, ?, ?, ?)',
          record.revision,
          record.updatedAt,
          record.note,
          JSON.stringify(record.changedKeys),
          JSON.stringify(record.policy),
          record.actor,
        );
        db.exec('COMMIT');
        return true;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async getDevice(id) {
      const r = one('SELECT * FROM devices WHERE id = ?', id);
      return r ? toDevice(r) : null;
    },
    async findDeviceByInstallId(installId) {
      const r = one('SELECT * FROM devices WHERE install_id = ?', installId);
      return r ? toDevice(r) : null;
    },
    async findDeviceByTokenHash(tokenHash) {
      const r = one('SELECT * FROM devices WHERE token_hash = ?', tokenHash);
      return r ? toDevice(r) : null;
    },
    async listDevices() {
      return all('SELECT * FROM devices ORDER BY registered_at DESC').map(toDevice);
    },
    async insertDevice(d) {
      run(
        `INSERT INTO devices (id, install_id, name, platform, arch, app_version, status, token_hash, registered_at,
           approved_at, last_seen_at, policy_revision, voice_ready, uptime_seconds, modules, remote_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.id,
        d.installId,
        d.name,
        d.platform,
        d.arch,
        d.appVersion,
        d.status,
        d.tokenHash,
        d.registeredAt,
        d.approvedAt,
        d.lastSeenAt,
        d.policyRevision,
        deviceValue('voiceReady', d.voiceReady),
        d.uptimeSeconds,
        deviceValue('modules', d.modules),
        d.remoteAddress,
      );
    },
    async updateDevice(id, patch) {
      const sets: string[] = [];
      const values: SqlValue[] = [];
      for (const [key, value] of Object.entries(patch)) {
        const column = DEVICE_COLUMNS[key as keyof typeof DEVICE_COLUMNS];
        if (!column || value === undefined) continue;
        sets.push(`${column} = ?`);
        values.push(deviceValue(key as keyof typeof DEVICE_COLUMNS, value));
      }
      if (sets.length === 0) return;
      run(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
    },
    async deleteDevice(id) {
      return Number(run('DELETE FROM devices WHERE id = ?', id).changes) > 0;
    },

    async insertUsage(deviceId, events, receivedAt) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO usage_events (device_id, id, at, day, kind, provider, model, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, audio_seconds, cost_usd, duration_ms, received_at, cost_known)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let accepted = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const e of events) {
          const result = stmt.run(
            deviceId,
            e.id,
            e.at,
            e.day,
            e.kind,
            e.provider,
            e.model,
            e.inputTokens,
            e.outputTokens,
            e.cacheReadTokens,
            e.cacheWriteTokens,
            e.audioSeconds,
            e.costUsd,
            e.durationMs,
            receivedAt,
            e.costKnown === false ? 0 : 1,
          );
          accepted += Number(result.changes);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return accepted;
    },
    async usageSince(firstDay) {
      return all(
        `SELECT day, kind, provider, model, device_id,
                COUNT(*) AS calls,
                SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
                SUM(audio_seconds) AS audio_seconds, SUM(cost_usd) AS cost_usd,
                SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpriced
           FROM usage_events WHERE day >= ?
          GROUP BY day, kind, provider, model, device_id
          ORDER BY day DESC`,
        firstDay,
      ).map((r) => ({
        day: str(r.day),
        kind: str(r.kind),
        provider: str(r.provider),
        model: str(r.model),
        deviceId: str(r.device_id),
        calls: Number(r.calls),
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        cacheReadTokens: Number(r.cache_read_tokens),
        cacheWriteTokens: Number(r.cache_write_tokens),
        audioSeconds: Number(r.audio_seconds),
        costUsd: Number(r.cost_usd),
        unpricedCalls: Number(r.unpriced ?? 0),
      }));
    },

    async getSecret(provider) {
      const r = one('SELECT * FROM secrets WHERE provider = ?', provider);
      return r ? toSecret(r) : null;
    },
    async listSecrets() {
      return all('SELECT * FROM secrets').map(toSecret);
    },
    async putSecret(row) {
      // Yeni anahtar yazılınca eski sınama sonucu artık bu anahtara ait değildir.
      run(
        `INSERT INTO secrets (provider, ciphertext, hint, updated_at, last_test) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT (provider) DO UPDATE SET ciphertext = excluded.ciphertext, hint = excluded.hint,
           updated_at = excluded.updated_at, last_test = NULL`,
        row.provider,
        new Uint8Array(row.ciphertext),
        row.hint,
        row.updatedAt,
      );
    },
    async setSecretTest(provider, test) {
      run('UPDATE secrets SET last_test = ? WHERE provider = ?', JSON.stringify(test), provider);
    },
    async deleteSecret(provider) {
      return Number(run('DELETE FROM secrets WHERE provider = ?', provider).changes) > 0;
    },

    async addAudit(entry) {
      const result = run(
        'INSERT INTO audit_log (at, action, actor, target, summary) VALUES (?, ?, ?, ?, ?)',
        entry.at,
        entry.action,
        entry.actor,
        entry.target,
        entry.summary,
      );
      return { id: Number(result.lastInsertRowid), ...entry };
    },
    async listAudit(limit, before) {
      const rows =
        before === undefined
          ? all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit)
          : all('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit);
      return rows.map(toAudit);
    },

    close() {
      db.close();
    },
  };
}
