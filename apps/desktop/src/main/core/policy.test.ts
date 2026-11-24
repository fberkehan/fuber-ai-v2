import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  defaultSettings,
  mergePolicy,
  type Bus,
  type BusEvents,
  type DeepPartial,
  type DeviceStatus,
  type Logger,
  type Paths,
  type Policy,
  type Settings,
  type SettingsApi,
  type Store,
  type UsageRecord,
  type UsageSummary,
} from '@fuber/shared';
import { createBus } from './bus';
import { controlLinkOf, createPolicy, type PolicyCipher, type PolicyOptions } from './policy';
import { createStore } from './store';

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
const SECRET = 'sk-' + 'ant-gizli-anahtar-123';

/** Sahte şifreleyici: düz metni dosyada aranabilir bırakmaz, çözerken kendi önekini ister. */
const cipher: PolicyCipher = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`kasa:${plain}`).toString('base64'),
  decrypt: (encoded) => {
    const text = Buffer.from(encoded, 'base64').toString();
    if (!text.startsWith('kasa:')) throw new Error('çözülemedi');
    return text.slice(5);
  },
};
const noCipher: PolicyCipher = {
  available: () => false,
  encrypt: () => {
    throw new Error('şifreleme yok');
  },
  decrypt: () => {
    throw new Error('şifreleme yok');
  },
};

/** `control-api.ts` cihaz uçlarının yerel sahte sunucusu. */
class FakeControl {
  policy: Policy = mergePolicy(DEFAULT_POLICY, { revision: 1, keys: { anthropic: SECRET } });
  devices = new Map<string, DeviceStatus>();
  registerStatus: DeviceStatus = 'approved';
  /** `true`: bağlantıyı kabul eder ama hiç yanıt vermez. */
  blackHole = false;
  hits = { register: 0, ok: 0, notModified: 0, usage: 0, heartbeat: 0 };
  waits: number[] = [];
  seenEtags: Array<string | undefined> = [];
  usageIds: string[] = [];
  heartbeats: unknown[] = [];
  private server: http.Server | null = null;
  private parked = new Set<() => void>();
  port = 0;

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }
  get etag() {
    return `r${this.policy.revision}-${Object.values(this.policy.keys).join('|').length}`;
  }

  update(patch: DeepPartial<Policy>) {
    this.policy = mergePolicy(this.policy, { ...patch, revision: this.policy.revision + 1 });
    for (const release of [...this.parked]) release();
  }

  async start(port = 0) {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop() {
    for (const release of [...this.parked]) release();
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (this.blackHole) return;
    const url = new URL(req.url ?? '/', this.url);
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const body = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      return JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
    };

    if (req.method === 'POST' && url.pathname === '/v1/devices/register') {
      this.hits.register++;
      const request = await body();
      const token = `tok-${this.hits.register}`;
      this.devices.set(token, this.registerStatus);
      return send(200, { deviceId: `dev-${String(request.installId).slice(0, 8)}`, token, status: this.registerStatus });
    }

    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const device = this.devices.get(token);
    if (!device) return send(401, { error: 'unauthorized', message: 'Belirteç tanınmıyor' });
    if (device === 'pending') return send(403, { error: 'device_pending', message: 'Cihaz onay bekliyor' });
    if (device === 'revoked') return send(403, { error: 'device_revoked', message: 'Cihazın yetkisi alındı' });

    if (req.method === 'GET' && url.pathname === '/v1/policy') {
      const wait = Number(url.searchParams.get('wait') ?? 0);
      const seen = req.headers['if-none-match'];
      this.waits.push(wait);
      this.seenEtags.push(seen);
      if (seen === this.etag && wait > 0) {
        await new Promise<void>((resolve) => {
          const release = () => {
            clearTimeout(timer);
            this.parked.delete(release);
            resolve();
          };
          const timer = setTimeout(release, wait * 1000);
          this.parked.add(release);
        });
      }
      if (seen === this.etag) {
        this.hits.notModified++;
        return send(304);
      }
      this.hits.ok++;
      return send(200, { policy: this.policy, etag: this.etag, serverTime: new Date().toISOString() }, { etag: `"${this.etag}"` });
    }
    if (req.method === 'POST' && url.pathname === '/v1/usage') {
      this.hits.usage++;
      const events = ((await body()).events ?? []) as Array<{ id: string }>;
      this.usageIds.push(...events.map((event) => event.id));
      return send(200, { accepted: events.length });
    }
    if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
      this.hits.heartbeat++;
      this.heartbeats.push(await body());
      return send(200, { serverTime: new Date().toISOString(), policyRevision: this.policy.revision, status: 'approved' });
    }
    return send(404, { error: 'not_found', message: 'Yok' });
  }
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function until(check: () => boolean, label: string, timeoutMs = 4000) {
  const began = Date.now();
  while (!check()) {
    if (Date.now() - began > timeoutMs) throw new Error(`zaman aşımı: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const TIMINGS: PolicyOptions['timings'] = {
  longPollSeconds: 1,
  backoffMinMs: 20,
  backoffMaxMs: 80,
  pendingRetryMs: 30,
  heartbeatMs: 60_000,
  usageFlushMs: 10,
};

let dir: string;
let store: Store;
let bus: Bus;
let control: FakeControl;
let settingsValue: Settings;
let settings: SettingsApi;
let events: Array<{ type: keyof BusEvents; payload: unknown }>;
const instances: Array<ReturnType<typeof createPolicy>> = [];

function make(options: PolicyOptions = {}) {
  const policy = createPolicy(
    { paths: { policyCache: path.join(dir, 'policy.json') } as Paths, store, settings, bus, log },
    { cipher, timings: TIMINGS, ...options },
  );
  instances.push(policy);
  return policy;
}

const emitted = <K extends keyof BusEvents>(type: K) =>
  events.filter((event) => event.type === type).map((event) => event.payload as BusEvents[K]);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-policy-'));
  store = createStore({ paths: { db: path.join(dir, 'test.db') } as Paths, log });
  bus = createBus({ log });
  events = [];
  bus.onAny((type, payload) => void events.push({ type, payload }));
  control = new FakeControl();
  await control.start();
  settingsValue = { ...defaultSettings('C:/projeler'), controlUrl: control.url };
  settings = {
    get: () => settingsValue,
    update(patch) {
      const changedKeys = Object.keys(patch) as Array<keyof Settings>;
      settingsValue = { ...settingsValue, ...patch };
      bus.emit('settings.changed', { settings: settingsValue, changedKeys });
      return settingsValue;
    },
  };
});

afterEach(async () => {
  for (const policy of instances.splice(0)) policy.stop();
  await control.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('kontrol servisi yokken', () => {
  it('açılış ağı beklemez ve gömülü varsayılanla çalışır', async () => {
    settingsValue.controlUrl = `http://127.0.0.1:${await freePort()}`;
    const policy = make();
    const began = performance.now();
    await policy.start();
    const elapsed = performance.now() - began;
    expect(elapsed).toBeLessThan(200);
    expect(policy.get()).toEqual(DEFAULT_POLICY);
    expect(policy.status().policySource).toBe('embedded');
    await until(() => policy.status().state === 'offline', 'çevrimdışı durumu');
    expect(policy.status().lastError).toContain('ulaşılamadı');
    expect(policy.moduleAllowed('planner')).toBe(true);
    expect(policy.moduleAllowed('ambient')).toBe(false);
    expect(policy.killSwitchActive()).toBe(false);
  });

  it('yanıt vermeyen servis de açılışı tutmaz; durdurma askıdaki isteği keser', async () => {
    control.blackHole = true;
    const policy = make();
    const began = performance.now();
    await policy.start();
    expect(performance.now() - began).toBeLessThan(200);
    expect(policy.get().persona.name).toBe('Jarvis');
    policy.stop();
    expect(await policy.refresh()).toMatchObject({ policySource: 'embedded' });
  });

  it('servis sonradan gelirse üstel beklemeyle kendiliğinden bağlanır', async () => {
    const port = await freePort();
    settingsValue.controlUrl = `http://127.0.0.1:${port}`;
    const policy = make();
    await policy.start();
    await until(() => policy.status().state === 'offline', 'çevrimdışı');
    await control.stop();
    await control.start(port);
    await until(() => policy.get().revision === 1, 'yeniden bağlanma');
    expect(policy.status()).toMatchObject({ state: 'approved', policySource: 'remote', lastError: null });
    expect(policy.get().keys.anthropic).toBe(SECRET);
  });
});

describe('eşitleme', () => {
  it('cihazı kaydeder, politikayı çeker ve değişimi duyurur', async () => {
    const policy = make();
    const status = await policy.refresh();
    expect(status).toMatchObject({ state: 'approved', policyRevision: 1, policySource: 'remote', lastError: null });
    expect(status.deviceId).toMatch(/^dev-/);
    expect(policy.get().keys.anthropic).toBe(SECRET);
    expect(control.hits).toMatchObject({ register: 1, ok: 1 });
    const changed = emitted('policy.changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ revision: 1, source: 'remote' });
    expect(changed[0]!.changedKeys).toEqual(expect.arrayContaining(['revision', 'keys']));
    expect(emitted('control.status').at(-1)).toMatchObject({ state: 'approved' });
  });

  it('ikinci istekte ETag gönderir ve 304 alır; yeniden kayıt olmaz', async () => {
    const policy = make();
    await policy.refresh();
    await policy.refresh();
    expect(control.seenEtags).toEqual([undefined, control.etag]);
    expect(control.hits).toMatchObject({ register: 1, ok: 1, notModified: 1 });
    expect(emitted('policy.changed')).toHaveLength(1);
  });

  it('uzun yoklama: sunucudaki değişiklik yenileme istemeden gelir', async () => {
    const policy = make();
    await policy.start();
    await until(() => policy.get().revision === 1, 'ilk eşitleme');
    await until(() => control.waits.includes(1), 'uzun yoklama isteği');
    const began = Date.now();
    control.update({ persona: { name: 'Friday' } });
    await until(() => policy.get().persona.name === 'Friday', 'değişikliğin gelmesi');
    expect(Date.now() - began).toBeLessThan(500);
    expect(control.waits[0]).toBe(0);
    expect(emitted('policy.changed').at(-1)).toMatchObject({ revision: 2, source: 'remote', changedKeys: ['revision', 'persona'] });
  });

  it('acil durdurma ve sürüm kapısı ayrı olaylarla duyurulur', async () => {
    const policy = make();
    await policy.start();
    await until(() => policy.get().revision === 1, 'ilk eşitleme');
    control.update({ killSwitch: { active: true, message: 'Bakım var' } });
    await until(() => policy.killSwitchActive(), 'acil durdurma');
    expect(emitted('app.killSwitch')).toEqual([{ active: true, message: 'Bakım var' }]);

    control.update({ killSwitch: { active: false }, release: { force: true, minVersion: '9.0.0', downloadUrl: 'https://ornek.test/kur' } });
    await until(() => policy.updateRequired(), 'sürüm kapısı');
    expect(policy.killSwitchActive()).toBe(false);
    expect(emitted('app.killSwitch').at(-1)).toMatchObject({ active: false });
    expect(emitted('app.updateRequired')).toEqual([{ required: true, minVersion: '9.0.0', downloadUrl: 'https://ornek.test/kur' }]);
  });

  it('belirteç tanınmazsa yeniden kayıt olur', async () => {
    const policy = make();
    await policy.start();
    await until(() => policy.status().state === 'approved', 'ilk eşitleme');
    control.devices.clear();
    control.policy = mergePolicy(control.policy, { revision: 2, persona: { address: 'hocam' } });
    expect((await policy.refresh()).state).toBe('unregistered');
    await until(() => policy.get().persona.address === 'hocam', 'yeniden kayıt sonrası politika');
    expect(control.hits.register).toBe(2);
    expect(policy.status().state).toBe('approved');
  });

  it('onay bekleyen cihaz onaylanınca politikayı alır', async () => {
    control.registerStatus = 'pending';
    const policy = make();
    await policy.start();
    await until(() => policy.status().state === 'pending', 'onay bekleme');
    expect(policy.get().keys.anthropic).toBeUndefined();
    for (const token of control.devices.keys()) control.devices.set(token, 'approved');
    await until(() => policy.status().state === 'approved', 'onay');
    expect(policy.get().keys.anthropic).toBe(SECRET);
  });

  it('yetkisi alınan cihaz anahtarları bırakır', async () => {
    const policy = make();
    await policy.start();
    await until(() => policy.get().keys.anthropic === SECRET, 'ilk eşitleme');
    for (const token of control.devices.keys()) control.devices.set(token, 'revoked');
    control.update({ persona: { name: 'X' } });
    await until(() => policy.status().state === 'revoked', 'yetki kaldırma');
    expect(policy.get().keys).toEqual({});
    expect(fs.readFileSync(path.join(dir, 'policy.json'), 'utf8')).not.toContain('"keys":"');
  });

  it('adres değişince yeni servise kaydolur', async () => {
    const other = new FakeControl();
    other.policy = mergePolicy(DEFAULT_POLICY, { revision: 7, persona: { name: 'Öteki' } });
    await other.start();
    try {
      const policy = make();
      await policy.refresh();
      const status = await policy.connect(`${other.url}/`);
      expect(status).toMatchObject({ state: 'approved', url: other.url, policyRevision: 7 });
      expect(policy.get().persona.name).toBe('Öteki');
      expect(other.hits.register).toBe(1);
      expect(other.seenEtags).toEqual([undefined]);
    } finally {
      await other.stop();
    }
  });
});

describe('disk önbelleği', () => {
  it('anahtarları şifreli yazar; servis yokken önbellekten açılır', async () => {
    await make().refresh();
    const raw = fs.readFileSync(path.join(dir, 'policy.json'), 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(JSON.stringify(store.kv('policy').get('device'))).not.toContain('tok-1');
    expect(JSON.parse(raw)).toMatchObject({ v: 1, etag: control.etag, policy: { revision: 1, keys: {} } });

    await control.stop();
    const offline = make();
    await offline.start();
    expect(offline.get().revision).toBe(1);
    expect(offline.get().keys.anthropic).toBe(SECRET);
    expect(offline.status()).toMatchObject({ policySource: 'cache', policyRevision: 1 });
    expect(emitted('policy.changed').at(-1)).toMatchObject({ source: 'cache' });
    await until(() => offline.status().state === 'offline', 'çevrimdışı');
  });

  it('önbellekten açılan cihaz kayıtlı belirteç ve ETag ile sürer', async () => {
    await make().refresh();
    const second = make();
    await second.refresh();
    expect(control.hits).toMatchObject({ register: 1, ok: 1, notModified: 1 });
    expect(second.status()).toMatchObject({ state: 'approved', policySource: 'remote' });
  });

  it('şifreleme yoksa anahtar ve belirteç diske yazılmaz; sonraki açılış onları sunucudan alır', async () => {
    await make({ cipher: noCipher }).refresh();
    const raw = fs.readFileSync(path.join(dir, 'policy.json'), 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw)).toMatchObject({ keys: null, etag: null, policy: { revision: 1 } });
    expect(store.kv('policy').get('device')).toMatchObject({ token: null });

    const second = make({ cipher: noCipher });
    expect(second.get().revision).toBe(1);
    expect(second.get().keys).toEqual({});
    await second.refresh();
    expect(second.get().keys.anthropic).toBe(SECRET);
    expect(control.hits).toMatchObject({ register: 2, ok: 2, notModified: 0 });
  });

  it('bozuk önbellek dosyası gömülü varsayılana düşürür', async () => {
    fs.writeFileSync(path.join(dir, 'policy.json'), '{ yarım');
    await control.stop();
    const policy = make();
    await policy.start();
    expect(policy.get()).toEqual(DEFAULT_POLICY);
    expect(policy.status().policySource).toBe('embedded');
  });
});

describe('kullanım ve kalp atışı ucu', () => {
  const record = (id: string): UsageRecord => ({
    id,
    at: new Date().toISOString(),
    kind: 'voice',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    audioSeconds: 0,
    costUsd: 0.001,
    durationMs: 300,
    sessionId: 'oturum',
  });
  const today = { day: '2026-11-16', costUsd: 0, budgetUsd: 10, overBudget: false, calls: 1, byKind: {} } satisfies UsageSummary;

  /** `usage` servisinin kalıcı kuyruğunun yerine geçen bellek kuyruğu. */
  const queue = () => {
    const rows = new Map<string, { record: UsageRecord; uploaded: boolean }>();
    return {
      add: (id: string) => {
        rows.set(id, { record: record(id), uploaded: false });
        bus.emit('usage.recorded', { record: record(id), today });
      },
      pendingUpload: (limit: number) => [...rows.values()].filter((row) => !row.uploaded).slice(0, limit).map((row) => row.record),
      markUploaded: (ids: string[]) => ids.forEach((id) => (rows.get(id)!.uploaded = true)),
      pending: () => [...rows.values()].filter((row) => !row.uploaded).length,
    };
  };

  it('kalıcı kuyruktaki kayıtları toplu gönderir ve gönderileni işaretler; bağlantı yokken kuyrukta kalır', async () => {
    const policy = make();
    const usage = queue();
    usage.add('eski'); // önceki oturumdan kalmış, gönderilmemiş kayıt
    controlLinkOf(policy)!.attachUsageQueue(usage);
    await policy.start();
    usage.add('u1');
    await until(() => policy.status().state === 'approved', 'ilk eşitleme');
    usage.add('u2');
    await until(() => control.usageIds.length === 3, 'kullanım gönderimi');
    expect(control.usageIds.sort()).toEqual(['eski', 'u1', 'u2']);
    await until(() => usage.pending() === 0, 'gönderilenlerin işaretlenmesi');
  });

  it('kontrol servisi kapalıyken kayıt kaybolmaz: kuyrukta bekler', async () => {
    await control.stop();
    const policy = make();
    const usage = queue();
    controlLinkOf(policy)!.attachUsageQueue(usage);
    await policy.start();
    usage.add('u1');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(usage.pending()).toBe(1);
  });

  it('kalp atışı sürümü ve yüklü modülleri bildirir', async () => {
    const policy = make();
    await policy.start();
    await until(() => policy.status().state === 'approved', 'ilk eşitleme');
    bus.emit('module.changed', { id: 'planner', enabled: true, reason: 'policy' });
    bus.emit('module.changed', { id: 'memory', enabled: true, reason: 'policy' });
    bus.emit('module.changed', { id: 'memory', enabled: false, reason: 'user' });
    const response = await controlLinkOf(policy)!.heartbeat();
    expect(response).toMatchObject({ policyRevision: 1, status: 'approved' });
    // Yük altında önceki sınamaların politikaları da aynı sahte sunucuya kalp atışı gönderebilir: bizimki aranır.
    expect(control.heartbeats).toContainEqual(expect.objectContaining({ appVersion: '2.0.0-demo.16', policyRevision: 1, voiceReady: false, modules: ['planner'] }));
  });
});
