import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION, DEFAULT_POLICY, type AuditEntry, type RegisterDeviceRequest, type UsageEvent } from '@fuber/shared';
import { createControlClient, ControlClientError } from './client';
import { createControlService, type ControlService } from './service';
import { ControlStartError } from './types';
import { ADMIN_TOKEN, fakeSecrets, memoryLogger, tempDir } from './test-helpers';

const SECRET = 'sk-' + 'ant-test-SECRET-value-9f8e7d6c5b4a';

/** Güncel masaüstü. Eski masaüstü (`appVersion` demo.2 ve öncesi) politikanın eski görünümünü alır (aşağıda ayrı sınanır). */
const device = (installId = 'install-0001', appVersion: string = APP_VERSION): RegisterDeviceRequest => ({
  name: 'Masaüstü',
  platform: 'win32',
  arch: 'x64',
  appVersion,
  installId,
});

function usage(id: string, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id,
    at: new Date().toISOString(),
    kind: 'voice',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    audioSeconds: 0,
    costUsd: 0.01,
    durationMs: 800,
    ...overrides,
  };
}

let tmp: ReturnType<typeof tempDir>;
let service: ControlService;
let baseUrl: string;
let log: ReturnType<typeof memoryLogger>;

async function startService(dbFile = 'control.db', secrets = fakeSecrets()) {
  log = memoryLogger();
  service = createControlService({ dbPath: path.join(tmp.dir, dbFile), secrets, adminToken: ADMIN_TOKEN, log });
  const { url } = await service.start(0);
  baseUrl = url;
}

const adminFetch = (p: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${p}`, {
    ...init,
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json', ...init.headers },
  });

beforeEach(async () => {
  tmp = tempDir();
  await startService();
});

afterEach(async () => {
  await service.close();
  tmp.cleanup();
});

describe('cihaz kaydı', () => {
  it('geri döngüden gelen kayıt kendiliğinden onaylı; aynı kurulum yeniden kaydolunca kayıt çoğalmaz', async () => {
    const client = createControlClient({ baseUrl });
    const first = await client.register(device());
    expect(first.status).toBe('approved');
    const oldToken = first.token;

    const second = await client.register({ ...device(), name: 'Yeni ad' });
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.token).not.toBe(oldToken);

    const devices = await service.admin.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe('Yeni ad');

    // Eski belirteç artık geçmez.
    const stale = createControlClient({ baseUrl, deviceToken: oldToken });
    await expect(stale.getPolicy()).rejects.toMatchObject({ kind: 'http', status: 401, code: 'unauthorized' });
  });

  it('geçersiz kayıt gövdesi 422', async () => {
    const response = await fetch(`${baseUrl}/v1/devices/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe('invalid_request');
  });
});

describe('yetki', () => {
  it('belirteçsiz ve yanlış belirteçle 401; cihaz belirteci yönetim uçlarını açmaz', async () => {
    expect((await fetch(`${baseUrl}/v1/policy`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/v1/policy`, { headers: { authorization: 'Bearer yanlis' } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/v1/admin/policy`)).status).toBe(401);

    const client = createControlClient({ baseUrl });
    const { token } = await client.register(device());
    const asDevice = await fetch(`${baseUrl}/v1/admin/policy`, { headers: { authorization: `Bearer ${token}` } });
    expect(asDevice.status).toBe(401);
    expect((await adminFetch('/v1/admin/policy')).status).toBe(200);
  });

  it('yetkisi alınan cihaz kullanım gönderemez (403) ve anahtarsız politika alır', async () => {
    await service.admin.setKey('anthropic', SECRET);
    const client = createControlClient({ baseUrl });
    const { deviceId } = await client.register(device());
    await service.admin.revokeDevice(deviceId);

    await expect(client.sendUsage([usage('u1')])).rejects.toMatchObject({ status: 403, code: 'device_revoked' });
    const result = await client.getPolicy();
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.status).toBe('revoked');
    expect(result.envelope.policy.keys).toEqual({});
  });

  it('geri döngü dışından gelen kayıt onay bekler; onaysız cihaza anahtarsız politika, onaylıya anahtarlı', async () => {
    await service.admin.setKey('anthropic', SECRET);
    // Uzak adres gerçek ağ olmadan yalnız Hono'nun ortam parametresiyle taklit edilebilir.
    const remoteEnv = { incoming: { socket: { remoteAddress: '192.168.1.40' } } } as never;
    const reg = await service.app.request(
      '/v1/devices/register',
      {
        method: 'POST',
        headers: { host: `127.0.0.1:${service.listening()!.port}`, 'content-type': 'application/json' },
        body: JSON.stringify(device('remote-0001')),
      },
      remoteEnv,
    );
    const { token, status, deviceId } = (await reg.json()) as { token: string; status: string; deviceId: string };
    expect(status).toBe('pending');

    const client = createControlClient({ baseUrl, deviceToken: token });
    const pending = await client.getPolicy();
    expect(pending.changed && pending.status).toBe('pending');
    expect(pending.changed && pending.envelope.policy.keys).toEqual({});
    await expect(client.sendUsage([usage('u1')])).rejects.toMatchObject({ status: 403, code: 'device_pending' });

    await service.admin.approveDevice(deviceId);
    const approved = await client.getPolicy({ etag: pending.changed ? pending.etag : null });
    expect(approved.changed).toBe(true);
    expect(approved.changed && approved.envelope.policy.keys.anthropic).toBe(SECRET);
  });
});

describe('politika biçimi yükseltmesi (eski Yönetim\'in kayıtlı belgesi)', () => {
  /** Kayıtlı son politikayı demo.2 biçimine çevirir: sürüm alanı yok, listede yerel ses modelleri yok. */
  async function rewriteAsLegacy(tts: Record<string, unknown>): Promise<void> {
    await service.close();
    const db = new DatabaseSync(path.join(tmp.dir, 'control.db'));
    const row = db.prepare('SELECT revision, policy FROM policy_revisions ORDER BY revision DESC LIMIT 1').get() as { revision: number; policy: string };
    const policy = JSON.parse(row.policy) as Record<string, unknown> & { voice: Record<string, unknown>; localModels: Array<{ id: string }> };
    delete policy.schemaVersion;
    policy.voice = { ...policy.voice, tts };
    policy.localModels = policy.localModels.filter((model) => !/^(supertonic|ema-lightning|onnxruntime)/.test(model.id));
    db.prepare('UPDATE policy_revisions SET policy = ? WHERE revision = ?').run(JSON.stringify(policy), row.revision);
    db.close();
    await startService();
  }

  it('eski varsayılan (ElevenLabs Daniel) yerel sese alınır: yeni sürüm, not, denetim kaydı; ikinci açılışta yinelenmez', async () => {
    await rewriteAsLegacy({ provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5' });
    const policy = await service.admin.getPolicy();
    expect(policy.revision).toBe(2);
    expect(policy.schemaVersion).toBe(2);
    expect(policy.voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
    expect(policy.localModels.map((model) => model.id)).toEqual(expect.arrayContaining(['supertonic-3-onnx', 'onnxruntime-1.32.0-cuda13', 'onnxruntime-1.24.4-directml', 'ema-lightning-onnx-1.0']));
    const history = await service.admin.policyHistory(5);
    expect(history[0]).toMatchObject({ revision: 2, changedKeys: ['schemaVersion', 'voice', 'localModels'] });
    expect(history[0]!.note).toContain('yerel ekran kartı sesine');
    const audit: AuditEntry[] = await service.admin.listAudit(5);
    expect(audit.some((entry) => entry.action === 'policy.update' && entry.actor === 'system' && entry.target === 'policy:2')).toBe(true);
    // Cihaz yükseltilmiş belgeyi alır.
    const client = createControlClient({ baseUrl });
    await client.register(device());
    const fetched = await client.getPolicy();
    expect(fetched.changed && fetched.envelope.policy.voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
    // Yeniden açılış: belge artık güncel, yeni sürüm yazılmaz.
    await service.close();
    await startService();
    expect((await service.admin.getPolicy()).revision).toBe(2);
  });

  it('bilerek seçilmiş ses korunur; yalnız model listesi tamamlanır', async () => {
    const chosen = { provider: 'elevenlabs', voiceId: 'libVoice123', model: 'eleven_v3' };
    await rewriteAsLegacy(chosen);
    const policy = await service.admin.getPolicy();
    expect(policy.revision).toBe(2);
    expect(policy.voice.tts).toEqual(chosen);
    expect(policy.localModels.some((model) => model.id === 'supertonic-3-onnx')).toBe(true);
    const history = await service.admin.policyHistory(1);
    expect(history[0]!.changedKeys).toEqual(['schemaVersion', 'localModels']);
    expect(history[0]!.note).toContain('seçili ses korundu');
  });

  it('yükseltmeden sonra Yönetim ElevenLabs Daniel seçerse seçim kalıcıdır (yeniden çevrilmez)', async () => {
    await rewriteAsLegacy({ provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5' });
    const base = await service.admin.getPolicy();
    const daniel = { provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5' } as const;
    const chosen = await service.admin.updatePolicy({ baseRevision: base.revision, patch: { voice: { tts: daniel } }, note: 'bulut sesi' });
    expect(chosen.voice.tts).toEqual(daniel);
    await service.close();
    await startService();
    const after = await service.admin.getPolicy();
    expect(after.revision).toBe(chosen.revision);
    expect(after.voice.tts).toEqual(daniel);
  });
});

describe('kurulum sırası: ESKİ masaüstü (demo.2) + YENİ Yönetim', () => {
  const KIMI = { provider: 'openai-compatible', endpoint: 'openrouter', model: 'moonshotai/kimi-k2', effort: 'low', thinking: 'off', speed: 'standard' } as const;

  it('eski masaüstü politikanın eski görünümünü alır (tanımadığı değer yok); anahtarları yine alır', async () => {
    await service.admin.setKey('anthropic', SECRET);
    const base = await service.admin.getPolicy();
    await service.admin.updatePolicy({ baseRevision: base.revision, patch: { models: { voice: KIMI, chat: KIMI } }, note: 'Kimi' });
    const old = createControlClient({ baseUrl });
    await old.register(device('install-eski', '2.0.0-demo.2'));
    const fetched = await old.getPolicy();
    expect(fetched.changed).toBe(true);
    const policy = (fetched.changed ? fetched.envelope.policy : null) as unknown as Record<string, unknown> & {
      voice: { tts: Record<string, unknown> };
      models: Record<string, { provider: string; model: string }>;
      localModels: Array<{ id: string }>;
      keys: Record<string, string>;
    };
    // demo.2 masaüstünün bildiği değerler: seslendirme ElevenLabs / Piper, rol sağlayıcısı Anthropic / yerel.
    expect(policy.voice.tts).toEqual({ provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5' });
    expect(policy.models.voice).toMatchObject({ provider: 'anthropic', model: DEFAULT_POLICY.models.voice.model });
    expect(Object.keys(policy.models).sort()).toEqual(['deep', 'memory', 'vision', 'voice']);
    expect(policy.schemaVersion).toBeUndefined();
    expect(policy.providers).toBeUndefined();
    expect(policy.localModels.some((model) => /^(supertonic|ema-lightning|onnxruntime)/.test(model.id))).toBe(false);
    expect(policy.localModels.length).toBeGreaterThan(0);
    expect(policy.keys.anthropic).toBe(SECRET);
    // Kayıtlı politika DEĞİŞMEZ: yalnız o cihaza giden kopya uyarlanır.
    expect((await service.admin.getPolicy()).voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
    expect((await service.admin.getPolicy()).models.voice.provider).toBe('openai-compatible');
  });

  it('aynı anda güncel masaüstü tam belgeyi alır; etiketleri farklıdır', async () => {
    const old = createControlClient({ baseUrl });
    await old.register(device('install-eski', '2.0.0-demo.2'));
    const current = createControlClient({ baseUrl });
    await current.register(device('install-yeni'));
    const [a, b] = [await old.getPolicy(), await current.getPolicy()];
    expect(a.changed && b.changed).toBe(true);
    if (!a.changed || !b.changed) return;
    expect(b.envelope.policy.voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
    expect(b.envelope.policy.schemaVersion).toBe(2);
    expect(b.envelope.policy.providers.length).toBeGreaterThan(0);
    expect(a.envelope.etag).not.toBe(b.envelope.etag);
  });

  it('masaüstü güncellenip yeni sürümünü bildirince (nabız) bekleyen yoklama tam belgeyle döner', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device('install-eski', '2.0.0-demo.2'));
    const first = await client.getPolicy();
    expect(first.changed).toBe(true);
    if (!first.changed) return;
    const waiting = client.getPolicy({ etag: first.envelope.etag, waitSeconds: 10 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await client.heartbeat({ appVersion: APP_VERSION, policyRevision: 1, uptimeSeconds: 5, voiceReady: true, modules: [] });
    const next = await waiting;
    expect(next.changed).toBe(true);
    if (!next.changed) return;
    expect(next.envelope.policy.voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
    expect(next.envelope.policy.schemaVersion).toBe(2);
  });
});

describe('politika', () => {
  it('ilk açılışta varsayılan politika (sürüm 1)', async () => {
    const policy = await service.admin.getPolicy();
    expect(policy.revision).toBe(1);
    expect(policy.persona.name).toBe(DEFAULT_POLICY.persona.name);
    expect(policy.localModels).toEqual(DEFAULT_POLICY.localModels);
  });

  it('ETag ile değişmeyen politika 304', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device());
    const first = await client.getPolicy();
    expect(first.changed).toBe(true);
    const etag = first.changed ? first.etag : null;
    const response = await fetch(`${baseUrl}/v1/policy`, {
      headers: { authorization: `Bearer ${client.deviceToken()}`, 'if-none-match': etag! },
    });
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe(etag);
    const again = await client.getPolicy({ etag });
    expect(again.changed).toBe(false);
  });

  it('uzun yoklama politika değişince erken döner', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device());
    const first = await client.getPolicy();
    if (!first.changed) throw new Error('ilk çekim değişmiş olmalı');

    const started = Date.now();
    const waiting = client.getPolicy({ etag: first.etag, waitSeconds: 20 });
    setTimeout(() => {
      void service.admin.updatePolicy({ baseRevision: first.envelope.policy.revision, patch: { persona: { name: 'Friday' } }, note: 'ad' });
    }, 300);
    const result = await waiting;
    const elapsed = Date.now() - started;
    expect(result.changed).toBe(true);
    expect(result.changed && result.envelope.policy.persona.name).toBe('Friday');
    expect(elapsed).toBeLessThan(3000);
  });

  it('uzun yoklama değişiklik yoksa süre dolunca 304', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device());
    const first = await client.getPolicy();
    const started = Date.now();
    const result = await client.getPolicy({ etag: first.changed ? first.etag : null, waitSeconds: 1 });
    expect(result.changed).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('anahtar değişince de uzun yoklama uyanır (ETag anahtar özetini içerir)', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device());
    const first = await client.getPolicy();
    const waiting = client.getPolicy({ etag: first.changed ? first.etag : null, waitSeconds: 20 });
    setTimeout(() => void service.admin.setKey('anthropic', SECRET), 200);
    const result = await waiting;
    expect(result.changed && result.envelope.policy.keys.anthropic).toBe(SECRET);
  });

  it('uzun yoklama istemci tarafından iptal edilebilir', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device());
    const first = await client.getPolicy();
    const controller = new AbortController();
    const waiting = client.getPolicy({ etag: first.changed ? first.etag : null, waitSeconds: 20, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(waiting).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('geçersiz politika yazımı reddedilir; eski sürüm üstüne yazım 409', async () => {
    const bad = await adminFetch('/v1/admin/policy', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision: 1, patch: { persona: { name: '' } }, note: '' }),
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { message: string }).message).toMatch(/persona\.name/);

    await expect(
      service.admin.updatePolicy({ baseRevision: 1, patch: { voice: { followUpSeconds: 9999 } }, note: '' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      service.admin.updatePolicy({ baseRevision: 1, patch: { models: { voice: { provider: 'nope' } } } as never, note: '' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    await service.admin.updatePolicy({ baseRevision: 1, patch: { persona: { address: 'patron' } }, note: '' });
    const stale = await adminFetch('/v1/admin/policy', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision: 1, patch: { persona: { address: 'efendim' } }, note: '' }),
    });
    expect(stale.status).toBe(409);
    expect((await service.admin.getPolicy()).revision).toBe(2);
  });

  it('yamada null: isteğe bağlı alan politikadan kalkar; null alabilen alan (effort) null olur; zorunlu alan reddedilir', async () => {
    const chosen = await service.admin.updatePolicy({
      baseRevision: 1,
      patch: { voice: { tts: { provider: 'elevenlabs', voiceId: 'libVoice123', model: 'eleven_v3' } } },
      note: 'ses seçildi',
    });
    expect(chosen.voice.tts).toEqual({ provider: 'elevenlabs', voiceId: 'libVoice123', model: 'eleven_v3' });

    const cleared = await service.admin.updatePolicy({
      baseRevision: chosen.revision,
      patch: { voice: { tts: { voiceId: null, model: null } }, models: { voice: { effort: null } } } as never,
      note: 'varsayılana dön',
    });
    expect(cleared.revision).toBe(chosen.revision + 1);
    expect(cleared.voice.tts).toEqual({ provider: 'elevenlabs' });
    expect('voiceId' in cleared.voice.tts).toBe(false);
    expect(cleared.models.voice.effort).toBeNull();
    // Kayıtlı sürümde de alan yok (yeniden okununca geri gelmez).
    expect((await service.admin.getPolicy()).voice.tts).toEqual({ provider: 'elevenlabs' });
    // Önceki sürüm değişmedi: geçmişte seçili ses durur.
    const history = await service.admin.policyHistory(5);
    expect(history.find((h) => h.revision === chosen.revision)!.policy.voice.tts.voiceId).toBe('libVoice123');

    await expect(
      service.admin.updatePolicy({ baseRevision: cleared.revision, patch: { persona: { name: null } } as never, note: '' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('yeni politika alanları (yerel beyin) yamayla değişir', async () => {
    const next = await service.admin.updatePolicy({
      baseRevision: 1,
      patch: { brain: { localFallback: 'off', local: { contextTokens: 16384 } }, models: { memory: { provider: 'local' } } },
      note: '',
    });
    expect(next.brain).toEqual({
      localFallback: 'off',
      local: { modelId: 'qwen3.5-4b-q4km', contextTokens: 16384 },
      deep: { provider: 'auto', claudeCodeModel: 'sonnet' },
      // Konuşan beyin olarak Claude Code: yamada yok, varsayılanıyla gelir.
      claudeCode: { use: 'prefer', voice: { model: 'sonnet', effort: 'low' }, chat: { model: 'sonnet', effort: 'medium' } },
    });
    expect(next.models.memory.provider).toBe('local');
  });

  it('yama anahtar ve sürüm alanlarını değiştiremez', async () => {
    const next = await service.admin.updatePolicy({
      baseRevision: 1,
      patch: { keys: { anthropic: 'sızdırılmış' }, revision: 99, persona: { name: 'Edith' } } as never,
      note: '',
    });
    expect(next.revision).toBe(2);
    expect(next.keys).toEqual({});
    expect((await service.admin.listKeys()).find((k) => k.provider === 'anthropic')!.present).toBe(false);
  });

  it('sürümleme ve geri alma', async () => {
    const r2 = await service.admin.updatePolicy({ baseRevision: 1, patch: { persona: { name: 'Friday' } }, note: 'ad değişti' });
    const r3 = await service.admin.updatePolicy({
      baseRevision: r2.revision,
      patch: { limits: { dailyBudgetUsd: 3 }, modules: { web: { enabled: false } } },
      note: '',
    });
    expect(r3.revision).toBe(3);
    expect(r3.modules.web?.enabled).toBe(false);
    expect(r3.modules.memory?.enabled).toBe(true);

    const history = await service.admin.policyHistory(10);
    expect(history.map((h) => h.revision)).toEqual([3, 2, 1]);
    expect(history[1]!.note).toBe('ad değişti');
    expect(history[1]!.changedKeys).toEqual(['persona']);
    expect(history[0]!.changedKeys.sort()).toEqual(['limits', 'modules']);

    const rolled = await adminFetch('/v1/admin/policy/rollback', { method: 'POST', body: JSON.stringify({ revision: 1 }) });
    expect(rolled.status).toBe(200);
    const policy = ((await rolled.json()) as { policy: typeof r3 }).policy;
    expect(policy.revision).toBe(4);
    expect(policy.persona.name).toBe('Jarvis');
    expect(policy.limits.dailyBudgetUsd).toBe(DEFAULT_POLICY.limits.dailyBudgetUsd);

    const audit = await service.admin.listAudit(20);
    expect(audit.some((a) => a.action === 'policy.rollback' && a.target === 'policy:4')).toBe(true);
  });

  it('acil durdurma ayrıca denetim kaydına düşer', async () => {
    const on = await service.admin.setKillSwitch(true, 'Bakım');
    expect(on.killSwitch).toEqual({ active: true, message: 'Bakım' });
    const off = await service.admin.setKillSwitch(false);
    expect(off.killSwitch.active).toBe(false);
    const actions = (await service.admin.listAudit(10)).map((a) => a.action);
    expect(actions).toContain('killswitch.on');
    expect(actions).toContain('killswitch.off');
  });
});

describe('kullanım', () => {
  it('olaylar toplanır, yinelenen olay tek sayılır; gün/tür/model/cihaz kırılımı', async () => {
    const client = createControlClient({ baseUrl });
    const { deviceId } = await client.register(device());
    const first = await client.sendUsage([
      usage('a'),
      usage('b', { kind: 'deep', model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 500, costUsd: 0.5 }),
      usage('c', { kind: 'tts', provider: 'elevenlabs', model: 'eleven_flash_v2_5', inputTokens: 0, outputTokens: 0, audioSeconds: 4, costUsd: 0.02 }),
    ]);
    expect(first.accepted).toBe(3);
    const second = await client.sendUsage([usage('a'), usage('d')]);
    expect(second.accepted).toBe(1);

    const summary = await service.admin.usageSummary(7);
    expect(summary.days).toHaveLength(7);
    const today = summary.days[0]!;
    expect(today.calls).toBe(4);
    expect(today.costUsd).toBeCloseTo(0.54, 6);
    expect(today.inputTokens).toBe(1200);
    expect(today.byKind.voice).toMatchObject({ calls: 2, costUsd: 0.02 });
    expect(today.byKind.deep).toMatchObject({ calls: 1, costUsd: 0.5 });
    expect(today.byDevice).toEqual([{ deviceId, calls: 4, costUsd: expect.closeTo(0.54, 6) }]);
    expect(today.byModel.find((m) => m.model === 'claude-opus-5-5')).toMatchObject({ outputTokens: 500 });
    expect(summary.today).toEqual({ costUsd: expect.closeTo(0.54, 6), budgetUsd: DEFAULT_POLICY.limits.dailyBudgetUsd });
  });

  it('500 üstü ya da bozuk olay 422', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device());
    await expect(client.sendUsage(Array.from({ length: 501 }, (_, i) => usage(`x${i}`)))).rejects.toMatchObject({ status: 422 });
    await expect(client.sendUsage([{ ...usage('y'), costUsd: -1 }])).rejects.toMatchObject({ status: 422 });
  });

  it('kalp atışı cihaz kaydına yazılır', async () => {
    const client = createControlClient({ baseUrl });
    const { deviceId } = await client.register(device());
    const beat = await client.heartbeat({ appVersion: '2.0.0-demo.1', policyRevision: 1, uptimeSeconds: 61, voiceReady: true, modules: ['memory'] });
    expect(beat).toMatchObject({ policyRevision: 1, status: 'approved' });
    const record = (await service.admin.listDevices()).find((d) => d.id === deviceId)!;
    expect(record.voiceReady).toBe(true);
    expect(record.policyRevision).toBe(1);
  });
});

describe('anahtar kasası', () => {
  it('anahtar şifreli durur; arayüze yalnız ipucu döner; denetim kaydında ve günlükte sır yok', async () => {
    const status = await service.admin.setKey('anthropic', SECRET);
    expect(status).toMatchObject({ provider: 'anthropic', present: true, hint: `…${SECRET.slice(-4)}` });
    expect(JSON.stringify(await service.admin.listKeys())).not.toContain(SECRET);

    const viaHttp = await adminFetch('/v1/admin/keys/elevenlabs', { method: 'PUT', body: JSON.stringify({ value: 'xi-SECRET-eleven-123456' }) });
    expect(viaHttp.status).toBe(200);
    expect(await viaHttp.text()).not.toContain('xi-SECRET-eleven-123456');

    await service.admin.updatePolicy({ baseRevision: 1, patch: { persona: { name: 'Friday' } }, note: 'not' });
    await service.admin.deleteKey('elevenlabs');

    const audit: AuditEntry[] = await service.admin.listAudit(100);
    const auditText = JSON.stringify(audit);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['key.set', 'key.delete', 'policy.update']));
    expect(auditText).not.toContain(SECRET);
    expect(auditText).not.toContain('xi-SECRET-eleven-123456');
    expect(auditText).not.toContain(SECRET.slice(-4));
    expect(log.lines.join('\n')).not.toContain(SECRET);

    const history = JSON.stringify(await service.admin.policyHistory(10));
    expect(history).not.toContain(SECRET);

    await service.close();
    const bytes = fs.readFileSync(path.join(tmp.dir, 'control.db'));
    const wal = fs.existsSync(path.join(tmp.dir, 'control.db-wal')) ? fs.readFileSync(path.join(tmp.dir, 'control.db-wal')) : Buffer.alloc(0);
    expect(bytes.includes(Buffer.from(SECRET))).toBe(false);
    expect(wal.includes(Buffer.from(SECRET))).toBe(false);
    await startService();
    expect((await service.admin.listKeys()).find((k) => k.provider === 'anthropic')!.present).toBe(true);
  });

  it('şifreleme yoksa anahtar kaydı reddedilir, düz metin yazılmaz', async () => {
    await service.close();
    await startService('noenc.db', fakeSecrets(false));
    await expect(service.admin.setKey('anthropic', SECRET)).rejects.toMatchObject({ code: 'encryption_unavailable' });
    expect((await service.admin.listKeys()).every((k) => !k.present)).toBe(true);
    const response = await adminFetch('/v1/admin/keys/anthropic', { method: 'PUT', body: JSON.stringify({ value: SECRET }) });
    expect(response.status).toBe(503);
  });

  it('kasada anahtar yoksa sınama "missing" döner', async () => {
    const result = await service.admin.testKey('gemini');
    expect(result).toMatchObject({ ok: false, status: 'missing' });
  });

  it('geçersiz anahtar biçimi 422', async () => {
    await expect(service.admin.setKey('anthropic', 'kısa')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.admin.setKey('anthropic', 'boşluk içeren anahtar 123')).rejects.toMatchObject({ code: 'invalid_request' });
    const unknown = await adminFetch('/v1/admin/keys/nope', { method: 'PUT', body: JSON.stringify({ value: SECRET }) });
    expect(unknown.status).toBe(422);
  });
});

describe('dayanıklılık', () => {
  it('veritabanı dosyası bozuksa yedeklenip temiz açılır', async () => {
    await service.close();
    const file = path.join(tmp.dir, 'bozuk.db');
    fs.writeFileSync(file, Buffer.from('bu bir sqlite dosyası değil '.repeat(200)));
    await startService('bozuk.db');
    expect(service.recoveredFrom).toMatch(/bozuk\.db\.corrupt-/);
    expect(fs.existsSync(service.recoveredFrom!)).toBe(true);
    expect((await service.admin.getPolicy()).revision).toBe(1);
    expect(log.lines.some((l) => l.includes('bozuk'))).toBe(true);
  });

  it('veritabanı başka bağlantıca kilitliyse bozuk sayılmaz, açık hata verir', async () => {
    await service.close();
    const file = path.join(tmp.dir, 'control.db');
    const holder = new DatabaseSync(file);
    holder.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;');
    try {
      expect(() =>
        createControlService({ dbPath: file, secrets: fakeSecrets(), adminToken: ADMIN_TOKEN }),
      ).toThrow(expect.objectContaining({ code: 'database_locked' }) as never);
      expect(fs.readdirSync(tmp.dir).some((f) => f.includes('corrupt'))).toBe(false);
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
    await startService();
    expect((await service.admin.getPolicy()).revision).toBe(1);
  }, 20_000);

  it('port doluysa: başka kontrol servisi mi yabancı süreç mi ayırt eder', async () => {
    const port = service.listening()!.port;
    const other = createControlService({ dbPath: path.join(tmp.dir, 'other.db'), secrets: fakeSecrets(), adminToken: ADMIN_TOKEN });
    try {
      await expect(other.start(port)).rejects.toMatchObject({ code: 'port_in_use', detail: { occupant: 'fuber-control' } });

      const foreign = net.createServer((socket) => socket.end('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nhi'));
      await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', resolve));
      const foreignPort = (foreign.address() as net.AddressInfo).port;
      try {
        const error = await other.start(foreignPort).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ControlStartError);
        expect(error).toMatchObject({ code: 'port_in_use', detail: { occupant: 'foreign' } });
      } finally {
        foreign.close();
      }
    } finally {
      await other.close();
    }
  });

  it('yalnız geri döngüde dinler', async () => {
    const other = createControlService({ dbPath: ':memory:', secrets: fakeSecrets(), adminToken: ADMIN_TOKEN });
    await expect(other.start(0, '0.0.0.0')).rejects.toMatchObject({ code: 'listen_failed' });
    await other.close();
  });

  it('servis kapalıyken istemci "network" hatası verir; durdurma bekleyen yoklamayı kapatır', async () => {
    const client = createControlClient({ baseUrl });
    await client.register(device());
    const first = await client.getPolicy();
    const waiting = client.getPolicy({ etag: first.changed ? first.etag : null, waitSeconds: 20 });
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    await service.stop();
    const result = await waiting.catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(3000);
    // Durdurma sırasında yanıt ya 304 olarak yazılır ya da bağlantı kapanır; ikisi de çökme değildir.
    if (result instanceof ControlClientError) expect(result.offline).toBe(true);
    else expect(result).toMatchObject({ changed: false });

    const offline = await client.health().catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(ControlClientError);
    expect((offline as ControlClientError).kind).toBe('network');
    expect((offline as ControlClientError).offline).toBe(true);
  });

  it('sağlık ucu servis adını bildirir', async () => {
    const health = await createControlClient({ baseUrl }).health();
    expect(health).toMatchObject({ ok: true, service: 'fuber-control' });
  });
});

describe('tarayıcı kapısı (DNS rebinding / basit istek)', () => {
  /** Ham HTTP isteği: `fetch` bazı başlıkları kendisi yazar; burada her başlık elle verilir. */
  function raw(
    method: string,
    p: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: string }> {
    const url = new URL(`${baseUrl}${p}`);
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: url.hostname, port: url.port, path: url.pathname, method, headers, setHost: false },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  const hostOk = () => `127.0.0.1:${service.listening()!.port}`;

  it('yabancı Host (rebinding) her uçta 403; anahtar sızmaz', async () => {
    await service.admin.setKey('anthropic', SECRET);
    const evil = await raw('POST', '/v1/devices/register', { host: `evil.example:${service.listening()!.port}`, 'content-type': 'application/json' }, JSON.stringify(device('evil-0001')));
    expect(evil.status).toBe(403);
    expect(evil.body).not.toContain(SECRET);
    expect(await service.admin.listDevices()).toHaveLength(0);
    expect((await raw('GET', '/v1/health', { host: 'evil.example' })).status).toBe(403);
    // Doğru ad, yanlış port da reddedilir.
    expect((await raw('GET', '/v1/health', { host: '127.0.0.1:1' })).status).toBe(403);
    // Host'suz HTTP/1.1 isteğini Node sunucusu zaten 400 ile keser.
    expect([400, 403]).toContain((await raw('GET', '/v1/health', {})).status);
    // Geri döngü adlarının üçü de kabul edilir.
    const port = service.listening()!.port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
      expect((await raw('GET', '/v1/health', { host })).status).toBe(200);
    }
  });

  it('Origin ya da Sec-Fetch-Site (none dışı) başlıklı istek 403', async () => {
    await service.admin.setKey('anthropic', SECRET);
    const reg = (headers: Record<string, string>) =>
      raw('POST', '/v1/devices/register', { host: hostOk(), 'content-type': 'application/json', ...headers }, JSON.stringify(device('browser-0001')));
    expect((await reg({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await reg({ origin: 'null' })).status).toBe(403);
    expect((await reg({ origin: `http://${hostOk()}` })).status).toBe(403);
    expect((await reg({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await reg({ 'sec-fetch-site': 'same-origin' })).status).toBe(403);
    expect(await service.admin.listDevices()).toHaveLength(0);
    // Adres çubuğuna yazılan adres (`none`) ve başlıksız Node isteği geçer.
    expect((await raw('GET', '/v1/health', { host: hostOk(), 'sec-fetch-site': 'none' })).status).toBe(200);
    expect((await reg({})).status).toBe(200);
  });

  it('text/plain ve türsüz gövde 415; kayıt yapılmaz', async () => {
    const body = JSON.stringify(device('plain-0001'));
    expect((await raw('POST', '/v1/devices/register', { host: hostOk(), 'content-type': 'text/plain' }, body)).status).toBe(415);
    expect((await raw('POST', '/v1/devices/register', { host: hostOk(), 'content-type': 'application/x-www-form-urlencoded' }, body)).status).toBe(415);
    expect((await raw('POST', '/v1/devices/register', { host: hostOk() }, body)).status).toBe(415);
    expect(await service.admin.listDevices()).toHaveLength(0);
    // Tarayıcının basit isteği gibi (fetch, text/plain, no-cors): Node fetch ile de aynı sonuç.
    const simple = await fetch(`${baseUrl}/v1/devices/register`, { method: 'POST', body });
    expect(simple.status).toBe(415);
    expect((await raw('POST', '/v1/devices/register', { host: hostOk(), 'content-type': 'application/json; charset=utf-8' }, body)).status).toBe(200);
  });

  it('normal istemci akışı aynen çalışır: kayıt → politika → uzun yoklama → kullanım → kalp atışı', async () => {
    await service.admin.setKey('anthropic', SECRET);
    const client = createControlClient({ baseUrl });
    const reg = await client.register(device('flow-0001'));
    expect(reg.status).toBe('approved');
    const first = await client.getPolicy();
    expect(first.changed && first.envelope.policy.keys.anthropic).toBe(SECRET);
    const waiting = client.getPolicy({ etag: first.changed ? first.etag : null, waitSeconds: 10 });
    setTimeout(() => void service.admin.setKillSwitch(true, 'dur'), 200);
    const woke = await waiting;
    expect(woke.changed && woke.envelope.policy.killSwitch.active).toBe(true);
    expect((await client.sendUsage([usage('flow-u1')])).accepted).toBe(1);
    const beat = await client.heartbeat({ appVersion: 'x', policyRevision: 2, uptimeSeconds: 1, voiceReady: true, modules: [] });
    expect(beat.status).toBe('approved');
    // Yönetim HTTP uçları da (Bearer + JSON) geçer.
    expect((await adminFetch('/v1/admin/policy')).status).toBe(200);
    expect((await adminFetch(`/v1/admin/devices/${reg.deviceId}/revoke`, { method: 'POST' })).status).toBe(200);
  });
});
