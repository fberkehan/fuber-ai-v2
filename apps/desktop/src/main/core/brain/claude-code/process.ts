/**
 * Konuşan beynin KALICI Claude Code süreci: bir kez açılır, el sıkışır, MCP sunucusuna bağlanır ve ardından turları
 * tek tek yürütür (soğuk açılış her turda ödenmez). Derin beynin tek koşuluk yalıtılmış çağrısının (`claude-cli/headless.ts`)
 * kalıcı ve akışlı karşılığıdır; süreç, kanal ve izleme `core/claude-cli`'den gelir (ikinci kopya yoktur).
 *
 * Yalıtım (2.1.325 ile gerçek süreçte doğrulandı; `docs/TUZAKLAR.md`):
 *  - `--system-prompt-file`: yalnız kendi istemimiz. `--tools ""`: Claude Code'un yerleşik araçlarının HİÇBİRİ yok.
 *    `--strict-mcp-config` + `--mcp-config`: yalnız uygulamanın MCP sunucusu. `--allowedTools mcp__fuber` +
 *    `--permission-mode dontAsk` + `--permission-prompts none`: sunucumuzun araçları sormadan çalışır, başka her şey reddedilir.
 *  - `--restricted` + `--setting-sources ""`: kullanıcının/projenin ayar dosyaları (kancalar, izinler, eklentiler) okunmaz.
 *    `--disable-slash-commands`: beceri ve komut yok. `--no-session-persistence`: konuşma diske yazılmaz.
 *  - `--safe-mode` KULLANILMAZ: `--mcp-config` ile verilen sunucuyu da kapatır (ölçüldü). Onun kapattıkları tek tek
 *    kapatılır: `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (CLAUDE.md ve hafıza dosyaları), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`,
 *    `ENABLE_CLAUDEAI_MCP_SERVERS=false` (hesabın claude.ai bağlayıcıları), yukarıdaki bayraklar.
 *  - Ortam izin listesinden kurulur (`isolatedCliEnv`): `ANTHROPIC_API_KEY`, `CLAUDE_*`, `FUBER2_*` geçmez.
 *  - Süreç her turun başında `system/init` yayınlar; orada sunucumuz dışında bir araç ya da MCP sunucusu görülürse
 *    tur BAŞLAMADAN süreç öldürülür (yalıtım ihlali sessiz geçilmez).
 */
import { randomUUID } from 'node:crypto';
import type { Effort, Logger } from '@fuber/shared';
import { classifyFailure, isolatedCliEnv, type CliCommand } from '../../claude-cli';
import { openSessionChannel, type SessionChannel } from '../../claude-cli/session-channel';
import { MCP_SERVER_NAME, MCP_TOKEN_ENV, MCP_TOOL_PREFIX } from './mcp-server';

export interface BrainProcessOptions {
  command: CliCommand;
  /** Sürecin çalışma klasörü (boş, uygulamanın geçici alanında). */
  cwd: string;
  systemPromptFile: string;
  /** CLI'nin model takma adı ya da tam kimlik. */
  model: string;
  effort: Effort | null;
  mcp: { url: string; token: string };
  /** Bir kullanıcı turundaki en çok model adımı. */
  maxTurns: number;
  log: Logger;
  /** El sıkışma süresi (ms). */
  initTimeoutMs?: number;
}

/**
 * `end` yanıt bitti · `aborted` iptal edildi · `limit` abonelik kullanım sınırı · `auth` oturum sorunu ·
 * `max_turns` adım sınırı · `refusal` model geri çevirdi · `timeout` süre doldu · `crash` süreç kapandı ·
 * `isolation` beklenmeyen araç/sunucu yüklendi · `error` diğer.
 */
export type TurnStop = 'end' | 'aborted' | 'limit' | 'auth' | 'max_turns' | 'refusal' | 'timeout' | 'crash' | 'isolation' | 'error';

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TurnOutcome {
  stop: TurnStop;
  /** Bu turda kullanıcıya akan metin. */
  text: string;
  /** Günlük için kısa teknik özet (kullanıcı içeriği taşımaz). */
  detail: string;
  model: string | null;
  usage: TurnUsage | null;
  /** Model adımı sayısı. */
  turns: number;
  /** Sınır dolduysa açılacağı an (epoch saniye); bilinmiyorsa `null`. */
  resetsAt: number | null;
  /** İleti gönderildikten ilk metin parçasına kadar (ms); metin gelmediyse `null`. */
  firstTextMs: number | null;
  /** Son model isteğinin girdi boyu (token): bağlamın ne kadar büyüdüğü. */
  contextTokens: number;
}

export interface TurnInput {
  text: string;
  images?: Array<{ mediaType: string; data: string }>;
  signal?: AbortSignal;
  /** İlk çıktıya (metin ya da araç çağrısı) kadar en çok bekleme (ms). */
  firstOutputTimeoutMs: number;
  /** Turun tamamı için süre (ms). */
  totalTimeoutMs: number;
  /** `boundary`: yeni bir model iletisinin ilk parçası (araç turundan sonra metin bitişik gelmesin diye). */
  onText(delta: string, boundary: boolean): void;
  /** Model düşünmeye ya da bir araç çağırmaya başladı. */
  onActivity?(kind: 'thinking' | 'tool', name?: string): void;
}

export interface BrainProcess {
  readonly pid: number | undefined;
  /** El sıkışma bitti mi; başarısızsa neden (süreç o durumda kapatılmıştır). */
  readonly ready: Promise<{ ok: true } | { ok: false; stop: TurnStop; detail: string }>;
  alive(): boolean;
  /** Tur sürüyor ya da kesilen turun kapanması bekleniyor. */
  busy(): boolean;
  /** Bir tur şu an sürüyor (kesilen turun kısa kapanışı sayılmaz). */
  active(): boolean;
  turn(input: TurnInput): Promise<TurnOutcome>;
  /**
   * Uygulamadaki bir araç çağrısı başladı (`true`) / bitti (`false`): araç çalışırken (onay bekleme dahil) turun süre
   * sınırı işlemez; bitince baştan başlar.
   */
  holdTimeout(on: boolean): void;
  /** Girdiyi kapatır, kısa süre bekler, kalanı ağacıyla öldürür. */
  close(graceMs?: number): Promise<void>;
  /** Son `system/init`'te görülen model ve sürüm. */
  info(): { model: string | null; version: string | null; tools: number };
  /** Süreç kendiliğinden kapandığında (çökme) bir kez çağrılır. */
  onExit(listener: () => void): void;
}

/**
 * Yalıtılmış kalıcı sürecin bayrakları. MCP belirteci argümanda DEĞİL, ortamdadır (`${FUBER_MCP_TOKEN}` genişler):
 * komut satırını okuyabilen başka bir süreç belirteci göremez.
 */
export function buildBrainArgs(input: { systemPromptFile: string; model: string; effort: Effort | null; mcpUrl: string; maxTurns: number }): string[] {
  const mcpConfig = JSON.stringify({
    mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: input.mcpUrl, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } } },
  });
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file',
    input.systemPromptFile,
    '--model',
    input.model,
    ...(input.effort ? ['--effort', input.effort] : []),
    '--restricted',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--disable-slash-commands',
    '--no-session-persistence',
    '--tools',
    '',
    '--allowedTools',
    `mcp__${MCP_SERVER_NAME}`,
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--max-turns',
    String(input.maxTurns),
  ];
}

/** Yalıtılmış sürecin ortamı: izin listesi + belirteç + `--safe-mode` yerine geçen kapatmalar. */
export function brainProcessEnv(command: CliCommand, token: string): Record<string, string> {
  return isolatedCliEnv({
    ...(command.env ?? {}),
    [MCP_TOKEN_ENV]: token,
    // Kullanıcının CLAUDE.md'si, proje/otomatik hafıza dosyaları bağlama girmez.
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    // Hesabın claude.ai bağlayıcıları (takvim, e-posta…) bu sürece yüklenmez.
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    // Araç tanımları baştan yüklenir: ertelenirse model önce "araç ara" turu atar (gecikme).
    ENABLE_TOOL_SEARCH: 'false',
    // İlk tur, sunucumuz bağlanmadan başlamasın.
    MCP_CONNECTION_NONBLOCKING: '0',
    // Onay bekleyen araç çağrısı 60 sn'lik HTTP sınırına takılmasın.
    MCP_TOOL_TIMEOUT: '900000',
    // Arka planda kendini güncellemesin, arka plan işi başlatmasın.
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    CLAUDE_CODE_DISABLE_CRON: '1',
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: '1',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
  });
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

interface ActiveTurn {
  input: TurnInput;
  startedAt: number;
  text: string;
  /** Son `assistant` olayından beri parça (delta) geldi mi; gelmediyse metin olayın kendisinden alınır. */
  deltaSeen: boolean;
  boundary: boolean;
  firstOutput: boolean;
  firstTextMs: number | null;
  model: string | null;
  contextTokens: number;
  /** CLI'nin kendi ürettiği (model dışı) hata iletisi: sınır, oturum, API hatası. Kullanıcıya AKTARILMAZ. */
  synthetic: string;
  rateLimit: { status: string; resetsAt: number | null } | null;
  interrupted: boolean;
  settle(outcome: TurnOutcome): void;
  done: boolean;
  /** CLI'den çıktı geldi: süre sınırı baştan başlar (sınır "çıktısız geçen süre"dir, turun toplam süresi değil). */
  progress(): void;
  /** Uygulamadaki bir araç çalışıyor (onay bekleme dahil): bu sürede süre sınırı işlemez. */
  hold(on: boolean): void;
}

export function startBrainProcess(options: BrainProcessOptions): BrainProcess {
  const { log } = options;
  let active: ActiveTurn | null = null;
  /** Kesilen turun `result` olayı gelene dek süreç yeni tur almaz. */
  let settling: Promise<void> | null = null;
  let releaseSettling: (() => void) | null = null;
  /** Daraltmayı aşmak için: bekleyişten sonra değer değişmiş olabilir. */
  const stillSettling = () => settling !== null;
  let exited = false;
  let closing = false;
  let lastInit: { model: string | null; version: string | null; tools: number } = { model: null, version: null, tools: 0 };
  let exitInfo = { code: null as number | null, stderr: '', spawnError: null as string | null };
  const exitListeners: Array<() => void> = [];

  const outcome = (turn: ActiveTurn | null, stop: TurnStop, detail: string, extra: Partial<TurnOutcome> = {}): TurnOutcome => ({
    stop,
    text: turn?.text ?? '',
    detail,
    model: turn?.model ?? lastInit.model,
    usage: null,
    turns: 0,
    resetsAt: turn?.rateLimit?.resetsAt ?? null,
    firstTextMs: turn?.firstTextMs ?? null,
    contextTokens: turn?.contextTokens ?? 0,
    ...extra,
  });

  const finishTurn = (result: TurnOutcome) => {
    const turn = active;
    if (!turn || turn.done) return;
    turn.done = true;
    active = null;
    turn.settle(result);
  };

  const emitText = (turn: ActiveTurn, text: string) => {
    if (!text || turn.done || turn.interrupted) return;
    if (turn.firstTextMs === null) turn.firstTextMs = Date.now() - turn.startedAt;
    turn.firstOutput = true;
    const boundary = turn.boundary;
    turn.boundary = false;
    turn.text += text;
    try {
      turn.input.onText(text, boundary);
    } catch (error) {
      log.warn('claude-code: metin dinleyicisi hata verdi', error);
    }
  };

  const activity = (turn: ActiveTurn, kind: 'thinking' | 'tool', name?: string) => {
    if (turn.done || turn.interrupted) return;
    if (kind === 'tool') turn.firstOutput = true;
    try {
      turn.input.onActivity?.(kind, name);
    } catch {
      // dinleyicinin hatası turu bozmaz
    }
  };

  /** Yalıtım denetimi: sunucumuzun araçları dışında bir araç ya da başka bir MCP sunucusu varsa süreç öldürülür. */
  const checkInit = (message: Json) => {
    const tools = (Array.isArray(message.tools) ? message.tools : []).filter((item): item is string => typeof item === 'string');
    const servers = (Array.isArray(message.mcp_servers) ? message.mcp_servers : []).filter(isObject);
    lastInit = { model: str(message.model), version: str(message.claude_code_version), tools: tools.length };
    const foreignTools = tools.filter((name) => !name.startsWith(MCP_TOOL_PREFIX));
    const foreignServers = servers.map((server) => str(server.name) ?? '?').filter((name) => name !== MCP_SERVER_NAME);
    const skills = Array.isArray(message.skills) ? message.skills.length : 0;
    if (foreignTools.length > 0 || foreignServers.length > 0 || skills > 0) {
      log.error(`claude-code: yalıtım ihlali; süreç kapatılıyor (araç: ${foreignTools.slice(0, 5).join(', ') || 'yok'}; sunucu: ${foreignServers.join(', ') || 'yok'}; beceri: ${skills})`);
      finishTurn(outcome(active, 'isolation', 'beklenmeyen araç ya da MCP sunucusu yüklendi'));
      void close(0);
      return;
    }
    const own = servers.find((server) => str(server.name) === MCP_SERVER_NAME);
    if (own && str(own.status) !== 'connected') {
      log.warn(`claude-code: MCP sunucusuna bağlanılamadı (${str(own.status) ?? 'bilinmiyor'})`);
      finishTurn(outcome(active, 'error', `mcp ${str(own.status) ?? 'bağlanamadı'}`));
      void close(0);
    }
  };

  const onStreamEvent = (turn: ActiveTurn, event: Json) => {
    turn.progress();
    switch (event.type) {
      case 'message_start': {
        const message = isObject(event.message) ? event.message : {};
        const usage = isObject(message.usage) ? message.usage : {};
        turn.model = str(message.model) ?? turn.model;
        turn.contextTokens = num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
        turn.boundary = turn.text !== '';
        break;
      }
      case 'content_block_start': {
        const block = isObject(event.content_block) ? event.content_block : {};
        if (block.type === 'tool_use') activity(turn, 'tool', (str(block.name) ?? '').replace(MCP_TOOL_PREFIX, ''));
        else if (block.type === 'thinking') activity(turn, 'thinking');
        break;
      }
      case 'content_block_delta': {
        const delta = isObject(event.delta) ? event.delta : {};
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          turn.deltaSeen = true;
          emitText(turn, delta.text);
        }
        break;
      }
      default:
        break;
    }
  };

  const onAssistant = (turn: ActiveTurn, message: Json) => {
    turn.progress();
    const inner = isObject(message.message) ? message.message : {};
    const blocks = (Array.isArray(inner.content) ? inner.content : []).filter(isObject);
    const text = blocks
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');
    // CLI'nin kendi iletisi (sınır doldu, oturum yok, API hatası): modelin sözü değildir, kullanıcıya okunmaz.
    if (inner.model === '<synthetic>' || message.error !== undefined || message.isApiErrorMessage === true) {
      turn.synthetic += text;
      return;
    }
    turn.model = str(inner.model) ?? turn.model;
    if (text) {
      // Parça akışı yoksa (eski CLI) metin bütün olarak buradan alınır.
      if (!turn.deltaSeen) {
        turn.boundary = turn.text !== '';
        emitText(turn, text);
      }
      turn.deltaSeen = false;
    }
    for (const block of blocks) {
      if (block.type === 'tool_use' && !turn.firstOutput) activity(turn, 'tool', (str(block.name) ?? '').replace(MCP_TOOL_PREFIX, ''));
    }
  };

  const onResult = (turn: ActiveTurn, message: Json) => {
    const usageRaw = isObject(message.usage) ? message.usage : {};
    const usage: TurnUsage = {
      inputTokens: num(usageRaw.input_tokens),
      outputTokens: num(usageRaw.output_tokens),
      cacheReadTokens: num(usageRaw.cache_read_input_tokens),
      cacheWriteTokens: num(usageRaw.cache_creation_input_tokens),
    };
    const subtype = str(message.subtype) ?? 'unknown';
    const resultText = str(message.result) ?? '';
    const base = { usage, turns: num(message.num_turns) };
    if (turn.interrupted) return finishTurn(outcome(turn, 'aborted', 'kesildi', base));
    if (subtype === 'success' && message.is_error !== true) {
      // Parça akışı da `assistant` olayı da gelmediyse (beklenmez) sonuç metni kullanılır.
      if (!turn.text && resultText) emitText(turn, resultText);
      return finishTurn(outcome(turn, 'end', 'tamam', base));
    }
    const failure = classifyFailure(
      { subtype, text: `${resultText} ${turn.synthetic}`, apiErrorStatus: typeof message.api_error_status === 'number' ? message.api_error_status : null, stopReason: str(message.stop_reason) },
      turn.rateLimit?.status ?? null,
    );
    const stop: TurnStop = failure === 'limit' ? 'limit' : failure === 'auth' ? 'auth' : failure === 'max_turns' ? 'max_turns' : failure === 'refusal' ? 'refusal' : 'error';
    // Ayrıntı günlüğe gider: CLI'nin kendi hata metni (kullanıcı içeriği değildir), kısaltılmış.
    finishTurn(outcome(turn, stop, `${subtype}: ${(resultText || turn.synthetic).replace(/\s+/g, ' ').slice(0, 200)}`, base));
  };

  const onMessage = (message: Json) => {
    const turn = active;
    if (message.type === 'system' && message.subtype === 'init') {
      checkInit(message);
      return;
    }
    if (!turn) {
      // Kesilen turun kuyruğu: sonucu geldiyse süreç yeniden kullanılabilir.
      if (message.type === 'result' && releaseSettling) {
        releaseSettling();
        releaseSettling = null;
        settling = null;
      }
      return;
    }
    switch (message.type) {
      case 'stream_event':
        if (!message.parent_tool_use_id && isObject(message.event)) onStreamEvent(turn, message.event);
        break;
      case 'assistant':
        if (!message.parent_tool_use_id) onAssistant(turn, message);
        break;
      case 'rate_limit_event': {
        const info = isObject(message.rate_limit_info) ? message.rate_limit_info : {};
        turn.rateLimit = { status: str(info.status) ?? 'unknown', resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : null };
        break;
      }
      case 'result':
        onResult(turn, message);
        break;
      default:
        break;
    }
  };

  const channel: SessionChannel = openSessionChannel({
    command: options.command,
    args: buildBrainArgs({ systemPromptFile: options.systemPromptFile, model: options.model, effort: options.effort, mcpUrl: options.mcp.url, maxTurns: options.maxTurns }),
    cwd: options.cwd,
    env: brainProcessEnv(options.command, options.mcp.token),
    onMessage,
    // `dontAsk` + `--permission-prompts none`: izin isteği gelmemeli; gelirse reddedilir.
    onPermission(request) {
      log.warn(`claude-code: beklenmeyen izin isteği reddedildi (${request.toolName})`);
      channel.respondPermission(request.requestId, { behavior: 'deny', message: 'Bu araç bu oturumda kullanılamaz.' }, request.toolUseId);
    },
    onPermissionCancelled() {},
    onExit(exit) {
      exited = true;
      exitInfo = { code: exit.code, stderr: exit.stderr, spawnError: exit.spawnError };
      releaseSettling?.();
      releaseSettling = null;
      settling = null;
      const turn = active;
      if (turn) {
        if (turn.interrupted) finishTurn(outcome(turn, 'aborted', 'kesildi'));
        else {
          const failure = classifyFailure({ subtype: 'missing', text: `${exit.stderr} ${turn.synthetic}`, apiErrorStatus: null, stopReason: null }, turn.rateLimit?.status ?? null);
          const stop: TurnStop = failure === 'limit' ? 'limit' : failure === 'auth' ? 'auth' : 'crash';
          finishTurn(outcome(turn, stop, exit.spawnError ? `başlatılamadı: ${exit.spawnError}` : `süreç kapandı (kod ${exit.code ?? '?'})`));
        }
      }
      if (!closing) {
        log.warn(`claude-code: süreç kendiliğinden kapandı (kod ${exit.code ?? '?'}${exit.spawnError ? `; ${exit.spawnError}` : ''})`);
        for (const listener of exitListeners.splice(0)) {
          try {
            listener();
          } catch {
            // dinleyicinin hatası önemsiz
          }
        }
      }
    },
  });

  async function close(graceMs = 1500): Promise<void> {
    if (closing && exited) return;
    closing = true;
    await channel.close(graceMs);
  }

  const ready: BrainProcess['ready'] = (async () => {
    try {
      await channel.initialize(options.initTimeoutMs ?? 30_000);
      return { ok: true as const };
    } catch (error) {
      const detail = exitInfo.spawnError ?? (exited ? `süreç kapandı (kod ${exitInfo.code ?? '?'})` : error instanceof Error ? error.message : String(error));
      const failure = exited ? classifyFailure({ subtype: 'missing', text: exitInfo.stderr, apiErrorStatus: null, stopReason: null }, null) : 'error';
      void close(0);
      return { ok: false as const, stop: (failure === 'auth' ? 'auth' : failure === 'limit' ? 'limit' : 'crash') as TurnStop, detail };
    }
  })();

  return {
    pid: channel.pid,
    ready,
    alive: () => !exited && !closing && channel.alive(),
    busy: () => active !== null || settling !== null,
    active: () => active !== null,
    holdTimeout: (on) => active?.hold(on),
    info: () => lastInit,
    onExit(listener) {
      exitListeners.push(listener);
    },
    close,

    async turn(input) {
      const state = await ready;
      if (!state.ok) return outcome(null, state.stop, state.detail);
      // Bir önceki (kesilen) turun sonucu gelmeden yeni tur yazılmaz; gelmiyorsa süreç kullanılamaz sayılır.
      if (settling) {
        await Promise.race([settling, new Promise((resolve) => setTimeout(resolve, 1500))]);
        if (stillSettling()) {
          void close(0);
          return outcome(null, 'crash', 'kesilen tur kapanmadı');
        }
      }
      if (exited || closing) return outcome(null, 'crash', 'süreç kapalı');
      if (active) return outcome(null, 'error', 'süreç meşgul');
      if (input.signal?.aborted) return outcome(null, 'aborted', 'kesildi');

      return new Promise<TurnOutcome>((resolve) => {
        let firstTimer: ReturnType<typeof setTimeout> | null = null;
        let totalTimer: ReturnType<typeof setTimeout> | null = null;
        /** Çalışan araç sayısı (uygulamadaki MCP çağrıları): sıfırdan büyükken süre sınırı durur. */
        let holds = 0;
        // Süre sınırı ETKİNLİĞE dayalıdır: çok adımlı iş (araçlar, onay beklemeleri) toplamda sınırı aşsa da kesilmez;
        // yalnız CLI `totalTimeoutMs` boyunca hiçbir çıktı vermezse (API yeniden denemelerinde asılı) tur kesilir.
        // Eski davranış (turun TOPLAM süresi 180 sn) uzun bilgisayar işini ortasında öldürüyordu.
        const armTotal = () => {
          if (totalTimer) clearTimeout(totalTimer);
          totalTimer = setTimeout(() => cut('timeout', `tur ${input.totalTimeoutMs} ms boyunca çıktı vermedi`), input.totalTimeoutMs);
          totalTimer.unref?.();
        };
        const turn: ActiveTurn = {
          input,
          startedAt: Date.now(),
          text: '',
          deltaSeen: false,
          boundary: false,
          firstOutput: false,
          firstTextMs: null,
          model: null,
          contextTokens: 0,
          synthetic: '',
          rateLimit: null,
          interrupted: false,
          done: false,
          progress() {
            if (!turn.done && holds === 0) armTotal();
          },
          hold(on) {
            holds = Math.max(0, holds + (on ? 1 : -1));
            if (turn.done) return;
            if (holds > 0) {
              if (totalTimer) clearTimeout(totalTimer);
              totalTimer = null;
            } else {
              armTotal();
            }
          },
          settle(result) {
            if (firstTimer) clearTimeout(firstTimer);
            if (totalTimer) clearTimeout(totalTimer);
            input.signal?.removeEventListener('abort', onAbort);
            resolve(result);
          },
        };

        /** Turu keser: çağırana hemen döner; süreç, kesilen turun sonucu gelene dek yeni tur almaz. */
        const cut = (stop: TurnStop, detail: string) => {
          if (turn.done) return;
          turn.interrupted = true;
          settling = new Promise<void>((release) => {
            releaseSettling = release;
          });
          finishTurn(outcome(turn, stop, detail));
          // Süre aşımında süreç büyük olasılıkla API yeniden denemelerinde asılıdır: yeniden kullanılmaz, kapatılır.
          if (stop === 'timeout') {
            void close(0);
            return;
          }
          void channel.interrupt({ cancelQueued: true }).catch(() => {
            // Kesme isteği yanıtlanmadıysa süreç güvenilmez: kapatılır, bir sonraki tur yenisini açar.
            void close(0);
          });
        };
        function onAbort() {
          cut('aborted', 'kesildi');
        }

        active = turn;
        input.signal?.addEventListener('abort', onAbort, { once: true });
        firstTimer = setTimeout(() => {
          if (!turn.firstOutput) cut('timeout', `ilk çıktı ${input.firstOutputTimeoutMs} ms içinde gelmedi`);
        }, input.firstOutputTimeoutMs);
        armTotal();
        firstTimer.unref?.();

        const sent = channel.sendUser({ id: randomUUID(), text: input.text, ...(input.images?.length ? { images: input.images } : {}) });
        if (!sent) finishTurn(outcome(turn, 'crash', 'ileti yazılamadı'));
      });
    },
  };
}
