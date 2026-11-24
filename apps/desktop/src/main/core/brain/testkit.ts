// Sahibi: T2. Birim testleri için sahte servisler ve sahte Claude akışı. Uygulama demetine girmez (yalnız testler içe aktarır).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  DEFAULT_POLICY,
  defaultSettings,
  newId,
  nowIso,
  type ApprovalDecision,
  type AuthorityState,
  type Bus,
  type Logger,
  type ModuleContext,
  type ModuleDef,
  type Paths,
  type Policy,
  type PolicyApi,
  type PresenceApi,
  type PresenceState,
  type Settings,
  type SettingsApi,
  type Store,
  type ToolCallOptions,
  type ToolDef,
  type ToolRegistry,
  type ToolResult,
  type VoiceApi,
  type VoiceStatus,
} from '@fuber/shared';
import { z } from 'zod';
import { createBus } from '../bus';
import { createStore } from '../store';
import type { CallOptions, MessagesClient, MessageStreamLike } from './client';

export const silentLog: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silentLog };

export function tempStore(): { store: Store; dir: string; close(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-t2-'));
  const store = createStore({ paths: { db: path.join(dir, 'test.db') } as Paths, log: silentLog });
  return {
    store,
    dir,
    close() {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function testBus(): Bus {
  return createBus({ log: silentLog });
}

export function fakePolicy(overrides: Partial<Policy> = {}, options: { killSwitch?: boolean } = {}): PolicyApi & { set(p: Partial<Policy>): void } {
  let policy: Policy = { ...DEFAULT_POLICY, keys: { anthropic: 'test-key' }, ...overrides };
  return {
    start() {},
    stop() {},
    get: () => policy,
    set(patch) {
      policy = { ...policy, ...patch };
    },
    status: () => ({
      state: 'offline',
      url: '',
      deviceId: null,
      policyRevision: 0,
      policySource: 'embedded',
      lastSyncAt: null,
      lastError: null,
    }),
    connect: async () => fakePolicy().status(),
    refresh: async () => fakePolicy().status(),
    moduleAllowed: () => true,
    moduleConfig: (id) => policy.modules[id]?.config ?? {},
    killSwitchActive: () => options.killSwitch ?? policy.killSwitch.active,
    updateRequired: () => false,
    networkAllowed: () => true,
  };
}

export function fakePresence(initial: Partial<PresenceState> = {}): PresenceApi & { set(p: Partial<PresenceState>): void } {
  let state: PresenceState = {
    mode: 'normal',
    fullscreen: false,
    meeting: false,
    cameraInUse: false,
    micInUseByOther: false,
    quiet: false,
    idleSeconds: 0,
    since: nowIso(),
    ...initial,
  };
  return {
    start() {},
    stop() {},
    get: () => state,
    refresh: () => state,
    set(patch) {
      state = { ...state, ...patch };
    },
  };
}

export function fakeSettings(bus: Bus, patch: Partial<Settings> = {}): SettingsApi {
  let current: Settings = { ...defaultSettings('C:/tmp'), ...patch };
  return {
    get: () => current,
    update(change) {
      current = { ...current, ...change };
      bus.emit('settings.changed', { settings: current, changedKeys: Object.keys(change) as Array<keyof Settings> });
      return current;
    },
  };
}

export function fakeVoice(): VoiceApi & { calls: string[] } {
  const calls: string[] = [];
  const status: VoiceStatus = {
    state: 'idle',
    ready: true,
    notReadyReason: null,
    engine: 'cascade',
    micMuted: false,
    micMutedUntil: null,
    wakePausedUntil: null,
    quiet: false,
    conversation: false,
    bargeIn: 'voice',
    inputDeviceLabel: null,
    lastError: null,
  };
  const record = (name: string) => () => void calls.push(name);
  return {
    calls,
    start() {},
    stop() {},
    status: () => ({ ...status }),
    startListening: record('startListening'),
    stopSpeaking: record('stopSpeaking'),
    cancelTurn: record('cancelTurn'),
    muteMic(options) {
      calls.push(`muteMic:${options?.minutes ?? ''}`);
      status.micMuted = true;
    },
    unmuteMic() {
      status.micMuted = false;
    },
    pauseWake(minutes) {
      calls.push(`pauseWake:${minutes}`);
      status.wakePausedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    },
    resumeWake: record('resumeWake'),
    setQuiet(on) {
      calls.push(`setQuiet:${on}`);
      status.quiet = on;
    },
    startConversation: () => true,
    endConversation: record('endConversation'),
    speak: async () => ({ spoken: true }),
    testMic: async () => {
      throw new Error('yok');
    },
    testWake: async () => ({ detected: false, score: 0 }),
    calibrateWake: async () => {
      throw new Error('yok');
    },
    echoTest: async () => {
      throw new Error('yok');
    },
  };
}

/**
 * Asgari araç kaydı: zod doğrulaması + çalıştırma. Gerçek kayıt (T1) onay, acil durdurma, politika kapılarını da uygular;
 * beyin ve modül testleri yalnız sözleşmedeki yüzü kullanır.
 */
export function miniTools(): ToolRegistry & {
  bind(ctx: ModuleContext, defs: ToolDef[]): void;
  approvals: ApprovalDecision[];
  authorityState: AuthorityState;
  grants: Array<{ minutes: number } | { task: true } | null>;
} {
  const entries = new Map<string, { def: ToolDef; ctx: ModuleContext }>();
  const approvals: ApprovalDecision[] = [];
  const registry = {
    approvals,
    bind(ctx: ModuleContext, defs: ToolDef[]) {
      for (const def of defs) entries.set(def.name, { def, ctx });
    },
    register(ctx: ModuleContext, defs: ToolDef[]) {
      for (const def of defs) entries.set(def.name, { def, ctx });
      return () => defs.forEach((def) => entries.delete(def.name));
    },
    registerExternal: () => () => {},
    unregister: (name: string) => entries.delete(name),
    unregisterModule() {},
    list: () =>
      [...entries.values()].map(({ def, ctx }) => ({ name: def.name, description: def.description, risk: def.risk, moduleId: ctx.moduleId, ...(def.group ? { group: def.group } : {}) })),
    has: (name: string) => entries.has(name),
    contextHints: (names: string[]) =>
      names.flatMap((name) => {
        const hint = entries.get(name)?.def.contextHint?.();
        return hint ? [hint] : [];
      }),
    schemas: (names?: string[]) =>
      [...entries.values()]
        .filter(({ def }) => !names || names.includes(def.name))
        .map(({ def }) => ({
          name: def.name,
          description: def.description,
          inputSchema: z.toJSONSchema(def.input) as unknown as Record<string, never>,
        })),
    async run(name: string, input: unknown, options: ToolCallOptions): Promise<ToolResult> {
      const entry = entries.get(name);
      if (!entry) return { ok: false, text: `“${name}” adında bir araç yok.` };
      const parsed = entry.def.input.safeParse(input);
      if (!parsed.success) return { ok: false, text: `Araç girdisi geçersiz: ${parsed.error.message}` };
      try {
        return await entry.def.run(parsed.data, {
          ...entry.ctx,
          callId: options.callId ?? newId(),
          origin: options.origin,
          signal: options.signal ?? new AbortController().signal,
          report: (step) => options.onReport?.(step),
        });
      } catch (error) {
        return { ok: false, text: `Araç hata verdi: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    async requestApproval() {
      const decision = approvals.shift() ?? 'denied';
      return decision;
    },
    resolveApproval: () => false,
    resolveApprovalFromSpeech: () => 'unclear' as const,
    pendingApprovals: () => [],
    recentCalls: () => [],
    cancelAll() {},
    // Yetki düzeyi (`core/authority.ts`): sınama `authorityState`'i değiştirir, verilen geçici yükseltmeler `grants`'te birikir.
    authorityState: { level: 'smart', base: 'smart', max: 'full', grant: null } as AuthorityState,
    grants: [] as Array<{ minutes: number } | { task: true } | null>,
    authority: (): AuthorityState => registry.authorityState,
    grantAuthority(grant: { minutes: number } | { task: true } | null) {
      registry.grants.push(grant);
      return true;
    },
    endTask() {},
  };
  return registry as unknown as ToolRegistry & {
    bind(ctx: ModuleContext, defs: ToolDef[]): void;
    approvals: ApprovalDecision[];
    authorityState: AuthorityState;
    grants: Array<{ minutes: number } | { task: true } | null>;
  };
}

/** Modül bağlamı: verilen servislerle, eksikler sahte. */
export function moduleContext(moduleId: string, services: Partial<ModuleContext> & Pick<ModuleContext, 'bus'>, store?: Store): ModuleContext {
  const missing = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (typeof prop === 'symbol' || prop === 'then' ? undefined : () => { throw new Error(`testte yok: ${name}.${String(prop)}`); }) });
  return {
    moduleId,
    db: store ? store.scoped(moduleId) : (missing('db') as ModuleContext['db']),
    log: silentLog,
    paths: missing('paths') as Paths,
    memory: missing('memory') as ModuleContext['memory'],
    scheduler: missing('scheduler') as ModuleContext['scheduler'],
    attention: missing('attention') as ModuleContext['attention'],
    brain: missing('brain') as ModuleContext['brain'],
    policy: fakePolicy(),
    jobs: missing('jobs') as ModuleContext['jobs'],
    voice: fakeVoice(),
    stage: missing('stage') as ModuleContext['stage'],
    presence: fakePresence(),
    conversation: missing('conversation') as ModuleContext['conversation'],
    settings: fakeSettings(services.bus),
    usage: missing('usage') as ModuleContext['usage'],
    tools: miniTools(),
    ...services,
  };
}

/** Modülü testte yükler: göç + araç kaydı + setup. */
export async function loadModule(def: ModuleDef, ctx: ModuleContext, store: Store, tools?: ReturnType<typeof miniTools>) {
  store.migrate(def.id, def.migrations ?? []);
  tools?.bind(ctx, def.tools ?? []);
  await def.setup?.(ctx);
}

// ───────────────────────── sahte Claude ─────────────────────────

export type ScriptBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown; id?: string };

export interface ScriptTurn {
  blocks: ScriptBlock[];
  stop?: BetaMessage['stop_reason'];
  /** Metin parçaları arasında bekleme (ms); iptal sınaması için. */
  delayMs?: number;
  /** `finalMessage` bu hatayla reddeder (SDK'nın araç JSON hatası gibi). */
  finalError?: Error;
  /** İstek bu hatayla başarısız olur. */
  error?: Error;
  usage?: Partial<BetaMessage['usage']>;
}

export interface RecordedCall {
  params: Record<string, unknown>;
  options: CallOptions;
  kind: 'stream' | 'create';
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Anthropic.APIUserAbortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Anthropic.APIUserAbortError());
    });
  });

export function fakeClient(script: ScriptTurn[]): MessagesClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const next = () => {
    const turn = script[index++];
    if (!turn) throw new Error('sahte Claude: senaryo bitti');
    return turn;
  };
  const toMessage = (turn: ScriptTurn): BetaMessage => {
    const content = turn.blocks.map((block) =>
      block.type === 'text'
        ? { type: 'text' as const, text: block.text, citations: null }
        : { type: 'tool_use' as const, id: block.id ?? `toolu_${newId()}`, name: block.name, input: block.input },
    );
    const hasTool = turn.blocks.some((block) => block.type === 'tool_use');
    return {
      id: `msg_${newId()}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content,
      stop_reason: turn.stop ?? (hasTool ? 'tool_use' : 'end_turn'),
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...turn.usage },
    } as unknown as BetaMessage;
  };
  return {
    calls,
    stream(params, options) {
      calls.push({ params: structuredClone(params) as unknown as Record<string, unknown>, options, kind: 'stream' });
      const turn = next();
      const message = toMessage(turn);
      let finished: Promise<BetaMessage> | null = null;
      const iterate = async function* (): AsyncGenerator<BetaRawMessageStreamEvent> {
        if (turn.error) throw turn.error;
        for (const [blockIndex, block] of turn.blocks.entries()) {
          if (block.type !== 'text') continue;
          const pieces = block.text.match(/.{1,6}/gs) ?? [];
          for (const piece of pieces) {
            if (turn.delayMs) await sleep(turn.delayMs, options.signal);
            if (options.signal?.aborted) throw new Anthropic.APIUserAbortError();
            yield { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: piece } } as BetaRawMessageStreamEvent;
          }
        }
      };
      const stream: MessageStreamLike = {
        [Symbol.asyncIterator]: () => {
          const generator = iterate();
          finished = (async () => {
            return message;
          })();
          return generator;
        },
        async finalMessage() {
          if (turn.error) throw turn.error;
          if (turn.finalError) throw turn.finalError;
          return finished ?? message;
        },
        abort() {},
      };
      return stream;
    },
    async create(params, options) {
      calls.push({ params: structuredClone(params) as unknown as Record<string, unknown>, options, kind: 'create' });
      const turn = next();
      if (turn.error) throw turn.error;
      return toMessage(turn);
    },
  };
}

/** Sahte HTTP yanıtı olan SDK hatası (`APIError.generate` ile gerçek sınıf seçilir). */
export function apiError(status: number, message = 'hata'): Error {
  return Anthropic.APIError.generate(status, { error: { type: 'x', message } }, message, new Headers());
}
