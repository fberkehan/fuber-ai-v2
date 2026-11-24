// Oturum yöneticisi sınamalarının ortak düzeneği: sahte Claude Code CLI (v1'den alınan fikstür) ile gerçek süreç,
// gerçek denetim protokolü. Uygulama demetine girmez (yalnız sınamalar içe aktarır).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliCommand } from '../../../core/claude-cli/process';
import type { PermissionRequestEvent } from '../../../core/claude-cli/session-events';
import { createSessionManager, type SessionManager, type SessionManagerDeps, type TurnEndInfo } from './manager';
import type { FolderTrustState, LiveConfig, LiveEnvelope, LiveEvent, LiveSessionSummary } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Etkileşimli sahte CLI (denetim protokolünü konuşur). */
export const FAKE_SESSION_CLI = path.resolve(here, '..', '..', '..', '..', '..', '..', '..', 'scripts', 'e2e', 'projects', 'fake-claude-session.mjs');

export function fakeSessionCli(env: Record<string, string> = {}): CliCommand {
  return { command: process.execPath, prefixArgs: [FAKE_SESSION_CLI], env };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Koşul sağlanana dek yoklar; sağlanmazsa `label` ile fırlatır. */
export async function waitFor<T>(probe: () => T | undefined | null | false, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`zaman aşımı: ${label}`);
    await sleep(15);
  }
}

export interface Harness {
  manager: SessionManager;
  /** Geçici proje klasörü (Türkçe harfli). */
  dir: string;
  config: LiveConfig;
  events: LiveEnvelope[];
  permissions: Array<{ summary: LiveSessionSummary; request: PermissionRequestEvent }>;
  turnEnds: Array<{ summary: LiveSessionSummary; info: TurnEndInfo }>;
  errors: Array<{ summary: LiveSessionSummary; error: string; chatSessionId?: string }>;
  /** Sahte CLI'nin ortamı; süreç açılmadan önce değiştirilebilir. */
  env: Record<string, string>;
  trust: Map<string, Partial<FolderTrustState>>;
  elsewhere: Set<string>;
  /** Bir oturumun (ya da hepsinin) olayları, türe göre. */
  of<K extends LiveEvent['type']>(type: K, session?: string): Array<Extract<LiveEvent, { type: K }>>;
  /** Oturumun dökümündeki bütün asistan metni. */
  text(session: string): string;
  status(session: string): LiveSessionSummary['status'] | undefined;
  waitStatus(session: string, status: LiveSessionSummary['status'], timeoutMs?: number): Promise<void>;
  cleanup(): Promise<void>;
}

export function createHarness(options: { config?: Partial<LiveConfig>; deps?: Partial<SessionManagerDeps>; env?: Record<string, string>; cli?: () => CliCommand | null } = {}): Harness {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-cc-')));
  // Türkçe harfli proje yolu: süreç başlatma, `cwd` ve yol karşılaştırmaları bununla da çalışmalı.
  const dir = path.join(root, 'Şirket İşleri ğü');
  fs.mkdirSync(dir, { recursive: true });
  const config: LiveConfig = { fullAccess: false, defaultMode: 'default', defaultModel: '', maxConcurrent: 4, ...options.config };
  const events: LiveEnvelope[] = [];
  const permissions: Harness['permissions'] = [];
  const turnEnds: Harness['turnEnds'] = [];
  const errors: Harness['errors'] = [];
  const env: Record<string, string> = { ...options.env };
  const trust = new Map<string, Partial<FolderTrustState>>();
  const elsewhere = new Set<string>();
  const manager = createSessionManager({
    command: options.cli ?? (() => fakeSessionCli(env)),
    config: () => config,
    emit: (envelope) => events.push(envelope),
    knownFolder: (cwd) => ({ projectId: 'proje-1', projectName: path.basename(cwd) }),
    trust: (cwd) => ({ cwd, required: false, decision: null, decidedBy: null, files: [], hooks: false, mcp: false, ...trust.get(cwd) }),
    protectedFolder: (cwd) => ({ reason: null, path: cwd }),
    guardEdit: () => null,
    openElsewhere: async (sessionId) => elsewhere.has(sessionId),
    onPermission: (summary, request) => permissions.push({ summary, request }),
    onTurnEnd: (summary, info) => turnEnds.push({ summary, info }),
    onError: (summary, error, chatSessionId) => errors.push({ summary, error, ...(chatSessionId !== undefined ? { chatSessionId } : {}) }),
    log: { warn: () => undefined },
    settleMs: 0,
    deltaIntervalMs: 5,
    interruptGraceMs: 600,
    closeGraceMs: 600,
    shutdownMs: 1500,
    ...options.deps,
  });
  const of: Harness['of'] = (type, session) =>
    events.filter((envelope) => envelope.event.type === type && (!session || envelope.session === session)).map((envelope) => envelope.event) as never;
  const status = (session: string) => manager.summary(session)?.status;
  return {
    manager,
    dir,
    config,
    events,
    permissions,
    turnEnds,
    errors,
    env,
    trust,
    elsewhere,
    of,
    text: (session) =>
      (manager.detail(session)?.events ?? [])
        .map((envelope) => (envelope.event.type === 'text' || envelope.event.type === 'text_delta' ? envelope.event.text : ''))
        .join(''),
    status,
    waitStatus: async (session, wanted, timeoutMs) => {
      await waitFor(() => status(session) === wanted, `durum ${wanted} (şimdi: ${status(session)})`, timeoutMs);
    },
    async cleanup() {
      await manager.shutdown();
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
