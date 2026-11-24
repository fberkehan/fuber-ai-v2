/**
 * Etkileşimli Claude Code oturumunun kanalı: uzun yaşayan bir `claude` süreci, akış girdisi/çıktısı (stream-json) ve
 * denetim protokolü. v1 bunu resmi Agent SDK ile yapıyordu; burada SDK'nın tel biçimi (0.3.310 `sdk.d.ts` tipleri:
 * `control_request` / `control_response` / `control_cancel_request`) doğrudan konuşulur ki yeni bağımlılık gerekmesin.
 * Biçim 2.1.325 ile gerçek süreçte doğrulandı (`initialize`, `can_use_tool`, `interrupt`, `set_permission_mode`).
 *
 * Bayraklar SDK'nın kurduğu sırayla aynıdır (`-p` verilmez: akış girdisi başsız kipi kendisi açar). Sistem istemi
 * VERİLMEZ: Claude Code kendi tam istemini, kullanıcının becerilerini, MCP sunucularını ve CLAUDE.md'sini kullanır
 * (v1'in kök nedeni boş sistem istemiydi; KURGU §1).
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { killTree, spawnCli, type CliCommand } from './process';
import { isRecord, type EffortLevel, type PermissionMode } from './session-events';

export interface SessionArgsInput {
  mode: PermissionMode;
  /** Sürdürülecek Claude Code oturum kimliği. */
  resume?: string;
  /** `resume` ile: yeni kimlikle çatalla. */
  fork?: boolean;
  model?: string;
  effort?: EffortLevel;
  /** Süreç "Tam yetki"ye geçebilsin mi (`--allow-dangerously-skip-permissions`). Kip bundan bağımsızdır. */
  allowBypass: boolean;
  /** `false`: klasörün kendi ayarları yüklenmez (yalnız kullanıcı kaynağı). */
  folderSettings: boolean;
  /** Klasörün `.mcp.json` sunucuları da başlamasın (`folderSettings: false` iken). */
  strictMcp?: boolean;
}

/** Etkileşimli oturumun bayrakları. Her izin isteği bu kanala (`stdio`) gelir. */
export function buildSessionArgs(input: SessionArgsInput): string[] {
  return [
    '--output-format',
    'stream-json',
    '--verbose',
    '--input-format',
    'stream-json',
    ...(input.effort ? ['--effort', input.effort] : []),
    ...(input.model ? ['--model', input.model] : []),
    '--permission-prompt-tool=stdio',
    ...(input.resume ? ['--resume', input.resume] : []),
    // Ayar kaynakları AÇIKÇA verilir (v1 bunu SDK varsayılanına bırakıyordu): güvenilen klasörde terminaldeki CLI ile aynı
    // üç kaynak; güvenilmeyende yalnız kullanıcının kendi ayarları.
    '--setting-sources',
    input.folderSettings ? 'user,project,local' : 'user',
    ...(!input.folderSettings && input.strictMcp ? ['--strict-mcp-config'] : []),
    '--permission-mode',
    input.mode,
    ...(input.allowBypass ? ['--allow-dangerously-skip-permissions'] : []),
    '--include-partial-messages',
    ...(input.resume && input.fork ? ['--fork-session'] : []),
  ];
}

/**
 * KULLANICI OTURUMUNUN ortamı: YASAK LİSTESİ. Derin beynin yalıtılmış koşusundan (`isolatedCliEnv`, izin listesi;
 * `process.ts`) farklı olarak oturum kullanıcının kendi ortamıyla çalışır (MCP sunucuları ve kabuk komutları onun PATH'ine,
 * belirteçlerine dayanır); yalnız şunlar çıkarılır: sınama sınırı, Electron kipi, iç içe oturum işaretleri ve abonelik
 * yerine kredisiz anahtara yönelten `ANTHROPIC_API_KEY`. İkisi bilerek ayrıdır: yalıtılmış koşuya kullanıcının
 * belirteçleri sızmamalı, kullanıcının oturumu da kendi araçlarını kaybetmemeli.
 */
const PRIVATE_ENV = /^(FUBER2_|ELECTRON_RUN_AS_NODE$|ELECTRON_NO_ATTACH_CONSOLE$|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|CLAUDE_CODE_SSE_PORT$|ANTHROPIC_API_KEY$|NODE_OPTIONS$)/i;

export function userSessionEnv(extra: Record<string, string> = {}, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) if (value !== undefined && !PRIVATE_ENV.test(key)) env[key] = value;
  // SDK'nın kendi girişiyle aynı işaret: CLI başsız konak davranışını buna göre seçer.
  env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts';
  return { ...env, ...extra };
}

// ── denetim protokolü ──

/** Claude Code'un izin isteği (`can_use_tool`). */
export interface CanUseToolRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions: unknown[];
  title?: string;
  displayName?: string;
  description?: string;
  decisionReason?: string;
  suppressAlwaysAllow?: boolean;
  defaultToNo?: boolean;
  toolUseId?: string;
  agentId?: string;
}

/** İzin yanıtı (SDK `PermissionResult`). */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export interface PreToolUseInput {
  toolName: string;
  toolInput: unknown;
}
/** Dönen metin: "kullanıcıya sor" nedeni; `null`: karışma. */
export type PreToolUseHook = (input: PreToolUseInput) => string | null;

export interface InitializeInfo {
  commands: Array<{ name: string; description: string; argumentHint: string }>;
  models: Array<{ value: string; label: string; description: string }>;
  account: { email?: string; plan?: string } | null;
  version: string | null;
  permissionMode: string | null;
  pid: number | null;
}

export interface SessionExit {
  code: number | null;
  signal: string | null;
  /** Süreç hiç başlatılamadıysa hata iletisi. */
  spawnError: string | null;
  /** Hata çıktısının sonu (en çok 4000 karakter); günlüğe yazılmaz, yalnız hata sınıflaması için. */
  stderr: string;
}

export interface SessionChannelOptions {
  command: CliCommand;
  args: string[];
  cwd: string;
  /** `CLAUDE_AGENT_SDK_CLIENT_APP` (User-Agent). */
  clientApp?: string;
  /**
   * Verilirse süreç ortamı OLDUĞU GİBİ budur (kullanıcı ortamı hiç eklenmez). Konuşan beynin yalıtılmış kalıcı süreci
   * `isolatedCliEnv(...)` sonucunu verir (`core/brain/claude-code/process.ts`). Verilmezse kullanıcının oturum ortamı
   * (`userSessionEnv`) kurulur. İki ortam bilerek ayrıdır.
   */
  env?: Record<string, string>;
  preToolUse?: PreToolUseHook;
  /** Denetim iletileri dışındaki her çıktı iletisi (ham JSON nesnesi). */
  onMessage(message: Record<string, unknown>): void;
  onPermission(request: CanUseToolRequest): void;
  /** Claude Code bekleyen izin isteğini geri çekti. */
  onPermissionCancelled(requestId: string): void;
  onExit(exit: SessionExit): void;
  /** Denetim isteği zaman aşımı (ms). */
  requestTimeoutMs?: number;
}

export interface UserMessageInput {
  id: string;
  text: string;
  images?: Array<{ mediaType: string; data: string }>;
}

export interface SessionChannel {
  readonly pid: number | undefined;
  alive(): boolean;
  /** El sıkışma: komut/model listesi ve hesap. Model çağrısı yapmaz. */
  initialize(timeoutMs?: number): Promise<InitializeInfo>;
  sendUser(message: UserMessageInput): boolean;
  respondPermission(requestId: string, result: PermissionResult, toolUseId?: string): void;
  /** Süren turu keser. `cancelQueued`: tur sürerken yazılmış ama henüz işlenmemiş iletiler de iptal edilir. */
  interrupt(options?: { cancelQueued?: boolean }): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model: string | null): Promise<void>;
  setEffort(effort: EffortLevel | null): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  /** Ön plandaki işi arka plana alır; `false`: iş artık ön planda değil. */
  backgroundTask(toolUseId: string): Promise<boolean>;
  /** Girdiyi kapatır, `graceMs` bekler, kalan süreci ağacıyla öldürür. */
  close(graceMs?: number): Promise<void>;
}

const MAX_LINE_CHARS = 32 * 1024 * 1024;
const MAX_STDERR_CHARS = 4000;
const HOOK_ID = 'pre_tool_use';
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

function readInitialize(response: unknown): InitializeInfo {
  const data = isRecord(response) ? response : {};
  const commands = (Array.isArray(data.commands) ? data.commands : []).filter(isRecord).slice(0, 600);
  const models = (Array.isArray(data.models) ? data.models : []).filter(isRecord).slice(0, 60);
  const account = isRecord(data.account) ? data.account : null;
  const email = account ? str(account.email) : undefined;
  const plan = account ? str(account.subscriptionType) : undefined;
  return {
    commands: commands
      .filter((item) => typeof item.name === 'string')
      .map((item) => ({ name: String(item.name), description: str(item.description)?.slice(0, 300) ?? '', argumentHint: str(item.argumentHint)?.slice(0, 120) ?? '' })),
    models: models
      .filter((item) => typeof item.value === 'string')
      .map((item) => ({ value: String(item.value), label: str(item.displayName)?.slice(0, 80) ?? String(item.value), description: str(item.description)?.slice(0, 300) ?? '' })),
    // Hesaptan YALNIZ e-posta ve plan alınır; kuruluş ve sağlayıcı bilgisi tutulmaz.
    account: email || plan ? { ...(email ? { email: email.slice(0, 200) } : {}), ...(plan ? { plan: plan.slice(0, 40) } : {}) } : null,
    version: str(data.claude_code_version) ?? null,
    permissionMode: str(data.current_permission_mode) ?? null,
    pid: typeof data.pid === 'number' ? data.pid : null,
  };
}

/** Süreci başlatır ve kanalı döndürür. Hiç fırlatmaz: başlatma hatası `onExit` ile (`spawnError`) bildirilir. */
export function openSessionChannel(options: SessionChannelOptions): SessionChannel {
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let stderr = '';
  let exited = false;
  let buffer = '';
  let overflow = false;
  const decoder = new StringDecoder('utf8');

  let child: ChildProcessWithoutNullStreams | null = null;
  let spawnError: string | null = null;
  try {
    // Süreç ortak izleme kümesine girer (`process.ts`): uygulama kapanırken başsız koşularla birlikte ölür.
    child = spawnCli(options.command, options.args, {
      cwd: options.cwd,
      env: options.env ?? userSessionEnv({ ...(options.clientApp ? { CLAUDE_AGENT_SDK_CLIENT_APP: options.clientApp } : {}), ...(options.command.env ?? {}) }),
    });
  } catch (error) {
    spawnError = error instanceof Error ? error.message : String(error);
  }
  const pid = child?.pid;

  const finish = (code: number | null, signal: string | null, error: string | null) => {
    if (exited) return;
    exited = true;
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('closed'));
    }
    pending.clear();
    if (buffer.trim() && !overflow) handleLine(buffer);
    buffer = '';
    options.onExit({ code, signal, spawnError: error, stderr });
  };

  const write = (payload: unknown): boolean => {
    if (!child || exited || child.stdin.destroyed || !child.stdin.writable) return false;
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    } catch {
      return false;
    }
  };

  const request = (body: Record<string, unknown>, timeoutMs = requestTimeoutMs): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('timeout'));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      if (!write({ type: 'control_request', request_id: id, request: body })) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error('closed'));
      }
    });

  const respond = (requestId: string, response: Record<string, unknown>) =>
    write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  const respondError = (requestId: string, error: string) => write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } });

  function handleControlRequest(message: Record<string, unknown>): void {
    const requestId = str(message.request_id);
    const body = isRecord(message.request) ? message.request : null;
    if (!requestId || !body) return;
    if (body.subtype === 'can_use_tool') {
      options.onPermission({
        requestId,
        toolName: str(body.tool_name) ?? '',
        input: isRecord(body.input) ? body.input : {},
        suggestions: Array.isArray(body.permission_suggestions) ? body.permission_suggestions : [],
        ...(str(body.title) ? { title: str(body.title)! } : {}),
        ...(str(body.display_name) ? { displayName: str(body.display_name)! } : {}),
        ...(str(body.description) ? { description: str(body.description)! } : {}),
        ...(str(body.decision_reason) ? { decisionReason: str(body.decision_reason)! } : {}),
        ...(body.suppress_always_allow_rule === true ? { suppressAlwaysAllow: true } : {}),
        ...(body.default_to_no === true ? { defaultToNo: true } : {}),
        ...(str(body.tool_use_id) ? { toolUseId: str(body.tool_use_id)! } : {}),
        ...(str(body.agent_id) ? { agentId: str(body.agent_id)! } : {}),
      });
      return;
    }
    if (body.subtype === 'hook_callback') {
      const input = isRecord(body.input) ? body.input : {};
      let reason: string | null = null;
      if (body.callback_id === HOOK_ID && input.hook_event_name === 'PreToolUse' && options.preToolUse) {
        try {
          reason = options.preToolUse({ toolName: str(input.tool_name) ?? '', toolInput: input.tool_input });
        } catch {
          reason = null;
        }
      }
      respond(requestId, reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } } : {});
      return;
    }
    // Bildirmediğimiz bir diyalog türüne yanıt verilmez (SDK sözleşmesi: yanıt "kullanıcı kapattı" sayılır).
    if (body.subtype === 'request_user_dialog') return;
    respondError(requestId, `unsupported control request: ${String(body.subtype)}`);
  }

  function handleLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'control_response': {
        const response = isRecord(message.response) ? message.response : {};
        const entry = pending.get(str(response.request_id) ?? '');
        if (!entry) return;
        pending.delete(str(response.request_id)!);
        clearTimeout(entry.timer);
        if (response.subtype === 'success') entry.resolve(response.response);
        else entry.reject(new Error(str(response.error) ?? 'control request failed'));
        return;
      }
      case 'control_request':
        handleControlRequest(message);
        return;
      case 'control_cancel_request': {
        const requestId = str(message.request_id);
        if (requestId) options.onPermissionCancelled(requestId);
        return;
      }
      case 'keep_alive':
        return;
      default:
        try {
          options.onMessage(message);
        } catch {
          // dinleyicinin hatası akışı bozmaz
        }
    }
  }

  const feed = (text: string) => {
    buffer += text;
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (overflow) {
        overflow = false;
        continue;
      }
      handleLine(line);
    }
    if (buffer.length > MAX_LINE_CHARS) {
      buffer = '';
      overflow = true;
    }
  };

  if (child) {
    child.stdout.on('data', (chunk: Buffer) => feed(decoder.write(chunk)));
    // Hata çıktısı okunmazsa boru dolar ve süreç kilitlenir; yalnız sonu tutulur.
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_CHARS);
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => finish(null, null, error.message));
    child.on('close', (code, signal) => {
      feed(decoder.end());
      finish(code, signal, null);
    });
  } else {
    queueMicrotask(() => finish(null, null, spawnError ?? 'spawn failed'));
  }

  const alive = () => !exited && child !== null;

  return {
    pid,
    alive,
    async initialize(timeoutMs = 60_000) {
      const hooks = options.preToolUse ? { PreToolUse: [{ hookCallbackIds: [HOOK_ID] }] } : {};
      // `systemPrompt` alanı BİLEREK yok: SDK seçenek verilmeyince buraya boş dizgi koyuyordu (v1'in "skill/MCP yok"
      // şikâyetinin kökü); alan olmayınca Claude Code kendi ön ayarlı sistem istemini kullanır.
      return readInitialize(await request({ subtype: 'initialize', hooks }, timeoutMs));
    },
    sendUser(message) {
      const content: unknown[] = [];
      if (message.text.trim()) content.push({ type: 'text', text: message.text });
      for (const image of message.images ?? []) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
      return write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid: message.id });
    },
    respondPermission(requestId, result, toolUseId) {
      respond(requestId, { ...result, ...(toolUseId ? { toolUseID: toolUseId } : {}) });
    },
    async interrupt(interruptOptions = {}) {
      // `cancel_queued` (SDK `SDKControlInterruptRequest`): süren turla birlikte CLI'nin sırasındaki iletiler de iptal
      // edilir; alanı tanımayan eski CLI yok sayar.
      await request({ subtype: 'interrupt', ...(interruptOptions.cancelQueued ? { cancel_queued: true } : {}) });
    },
    async setPermissionMode(mode) {
      await request({ subtype: 'set_permission_mode', mode });
    },
    async setModel(model) {
      await request({ subtype: 'set_model', ...(model ? { model } : {}) });
    },
    async setEffort(effort) {
      await request({ subtype: 'apply_flag_settings', settings: { effortLevel: effort } });
    },
    async stopTask(taskId) {
      await request({ subtype: 'stop_task', task_id: taskId });
    },
    async backgroundTask(toolUseId) {
      const response = await request({ subtype: 'background_tasks', tool_use_id: toolUseId });
      return !(isRecord(response) && response.backgrounded === false);
    },
    async close(graceMs = 2500) {
      if (!child || exited) return;
      try {
        child.stdin.end();
      } catch {
        // zaten kapalı
      }
      const deadline = Date.now() + graceMs;
      while (!exited && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 40));
      if (!exited) killTree(pid);
      const hardDeadline = Date.now() + 3000;
      while (!exited && Date.now() < hardDeadline) await new Promise((resolve) => setTimeout(resolve, 40));
      // Ağaç öldürülemese bile çağıran sonsuza dek beklemesin; çıkış olayı gelirse yine işlenir.
    },
  };
}
