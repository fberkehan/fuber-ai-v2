/**
 * Konuşan beynin Claude Code sağlayıcısı: sesli ve yazılı sohbet, bu bilgisayarda kurulu Claude Code CLI üzerinden
 * (kullanıcının aboneliğiyle) yürür. Öteki sağlayıcılardan farkı: araç döngüsünü CLI'nin kendisi yürütür; Jarvis'in
 * araçları ona uygulama içi MCP sunucusuyla verilir (`claude-code/mcp-server.ts`) ve her çağrı çağıranın verdiği
 * işleyiciden (araç kapısı) geçer.
 *
 * Süreç yaşam döngüsü:
 *  - Sıcak süreç: tür başına (`voice`, `chat`) bir oturuma BAĞLI süreç ve en çok bir BOŞ yedek. Isıtma (`prewarm`)
 *    yedeği önceden açar: el sıkışma ve MCP bağlantısı tur başlamadan biter. Model çağrısı yapılmaz, kota harcanmaz.
 *  - Bağlama: oturumun ilk turu yedeği alır (yoksa açar) ve uygulamanın geçmişini önsöz olarak verir; sonraki turlarda
 *    yalnız yeni söz gider (konuşma CLI'nin bağlamındadır).
 *  - Yenileme: istem, araç kümesi ya da model değiştiyse; bağlam çok büyüdüyse; süreç izini kaybettiyse; tur hatayla
 *    bittiyse süreç kapatılır, sonraki tur yenisini geçmişle açar.
 *  - Boşta kapanma: kullanılmayan süreç `idleMs` sonra kapanır. Çöken süreç bir sonraki turda yeniden açılır.
 *  - Kapanış: `dispose()` hepsini kapatır; ayrıca her süreç ortak izleme kümesindedir (`claude-cli/process.ts`) ve
 *    uygulama nasıl çıkarsa çıksın ağacıyla öldürülür.
 *
 * Bu dosya `BrainProvider` yüzünü (`turn`) de verir; beyin döngüsü araç turunu kendisi yürütmez (araçlar tur İÇİNDE,
 * MCP üzerinden çalışır), bu yüzden dönen sonuçta `toolCalls` her zaman boştur.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { t, type BrainCloudIssue, type Effort, type Logger, type Unsubscribe } from '@fuber/shared';
import { locateClaudeCli, MIN_CLI_VERSION, probeClaudeCli, type CliCommand, type CliProbe } from '../../claude-cli';
import { planHistory, renderHistoryBlock, renderMissedBlock, type SeenState } from '../claude-code/history';
import { createToolMcpServer, type McpCallResult, type McpSession, type ToolMcpServer } from '../claude-code/mcp-server';
import { startBrainProcess, type BrainProcess, type TurnOutcome, type TurnStop } from '../claude-code/process';
import type { BrainProvider, ConvMessage, ProviderTurnRequest, ProviderTurnResult, ToolSpec } from './types';

export type ClaudeCodeKind = 'voice' | 'chat' | 'task';

/** Sürecin kimliği: bunlardan biri değişirse süreç yeniden açılır. */
export interface ClaudeCodeSpec {
  kind: ClaudeCodeKind;
  /** CLI'nin model takma adı ya da tam kimlik. */
  model: string;
  effort: Effort | null;
  system: string;
  tools: ToolSpec[];
  /** Bir kullanıcı turundaki en çok model adımı. */
  maxTurns: number;
}

export interface ClaudeCodeToolCall {
  name: string;
  input: unknown;
  toolUseId: string | null;
}

export interface ClaudeCodeTurnRequest extends ClaudeCodeSpec {
  /** Konuşmanın oturumu: süreç buna bağlanır. `null`: tek kullanımlık süreç (tur bitince kapanır). */
  sessionKey: string | null;
  /** Geçmiş + en sonda yeni kullanıcı sözü. */
  messages: ConvMessage[];
  /** Süreklilik denetiminde aranan söz (kullanıcının kendi sözü; gömülü ek metni olmadan). */
  userKey: string;
  /** Önsözde asistanın adı ("Jarvis"). */
  assistantName: string;
  /**
   * Yeni sözün başına konacak güncel durum (saat, hafıza, öz-durum). `memo` sürece özgüdür: çağıran, değişmeyen kısmı
   * her turda yeniden göndermemek için kullanır. `fresh`: sürecin bu konuşmadaki ilk turu.
   */
  compose(state: { fresh: boolean; memo: Map<string, string> }): string;
  /** Araç çağrısı: araç kapısından geçirir. Fırlatmamalı. */
  runTool(call: ClaudeCodeToolCall): Promise<McpCallResult>;
  signal?: AbortSignal;
  onText(delta: string, boundary: boolean): void;
  onActivity?(kind: 'thinking' | 'tool', name?: string): void;
  firstOutputTimeoutMs: number;
  totalTimeoutMs: number;
}

export interface ClaudeCodeTurnResult extends TurnOutcome {
  /** Tur Claude Code yüzünden yürümediyse (sınır, oturum, çökme, süre) nedeni; yanıt verildiyse `null`. */
  failure: { issue: BrainCloudIssue; reason: string } | null;
  /** Süreç bu tur için yeni mi açıldı (soğuk açılış). */
  cold: boolean;
}

export type ClaudeCodeState = 'ready' | 'checking' | 'missing' | 'old' | 'logged_out' | 'limit' | 'error';

export interface ClaudeCodeAvailability {
  ok: boolean;
  state: ClaudeCodeState;
  /** `ok: false` iken kullanıcıya söylenebilecek Türkçe neden. */
  reason: string | null;
  /** Yerele düşüş duyurusunu ve durum rozetini seçen neden; hazırsa `null`. */
  issue: BrainCloudIssue | 'missing' | null;
  /** Sınır dolduysa açılacağı an (epoch ms); bilinmiyorsa `null`. */
  resetsAt: number | null;
  version: string | null;
}

export interface ClaudeCodeBrainOptions {
  /** `auto`: bilinen yerlerde aranır · `null`: Claude Code yok sayılır · komut: o çalıştırılır (sınamada sahte CLI). */
  cli?: 'auto' | CliCommand | null;
  /** Sistem istemi dosyalarının ve süreçlerin çalışma klasörünün kökü (uygulamanın geçici alanında). */
  workDir: string;
  /** Yoklamanın (sürüm, oturum) geçerlilik süresi; hazır değilken daha sık yoklanır. */
  probeTtlMs?: number;
  /** Kullanılmayan sürecin kapanma süresi. */
  idleMs?: number;
  /** Art arda hatadan sonra Claude Code'un denenmediği süre. */
  errorDownMs?: number;
  /** Sınır doldu ama açılma anı bilinmiyorsa denenmeyen süre. */
  limitDownMs?: number;
  /** Bağlam bu kadar token'ı aşınca süreç yenilenir (geçmiş uygulamadan yeniden kurulur). */
  maxContextTokens?: number;
}

export interface ClaudeCodeBrain extends BrainProvider {
  /** Eşzamanlı, önbellekten: şu an tur yürütülebilir mi. Bayatsa arka planda yoklama başlatır. */
  availability(): ClaudeCodeAvailability;
  /** Yoklamayı (kurulu mu, sürüm, oturum) gerekirse tazeler. Model çağrısı yoktur. */
  refresh(force?: boolean): Promise<ClaudeCodeAvailability>;
  /** İlk yoklama sürüyorsa bitmesini (en çok `maxMs`) bekler. */
  settle(maxMs: number): Promise<void>;
  /** Tür için sıcak bir süreç hazırlar (model çağrısı yok). Hiç fırlatmaz. */
  prewarm(spec: ClaudeCodeSpec): Promise<void>;
  run(request: ClaudeCodeTurnRequest): Promise<ClaudeCodeTurnResult>;
  /** Durum değişince (yoklama bitti, sınır doldu/açıldı). */
  onChange(listener: () => void): Unsubscribe;
  /** Politika ya da araç kümesi değişti: boş yedekler kapatılır, bağlı süreçler bir sonraki turda denetlenir. */
  recycle(): void;
  snapshot(): { warm: number; lastFirstTextMs: number | null; processes: number; mcpCalls: number; mcpRejected: number };
  /** Yaşayan süreçlerin kimlikleri (sınama: artık süreç kalmadığını doğrulamak için). */
  pids(): number[];
  dispose(): Promise<void>;
}

const PROBE_TTL_MS = 10 * 60_000;
const PROBE_RETRY_MS = 30_000;
const IDLE_MS = 10 * 60_000;
const ERROR_DOWN_MS = 2 * 60_000;
const LIMIT_DOWN_MS = 15 * 60_000;
const MAX_CONTEXT_TOKENS = 80_000;
/** Art arda bu kadar başarısız turdan sonra kısa süre denenmez. */
const FAILURES_BEFORE_DOWN = 2;

interface Slot {
  id: number;
  kind: ClaudeCodeKind;
  signature: string;
  process: BrainProcess;
  mcp: McpSession;
  tools: ToolSpec[];
  /** Bağlı oturum; `null`: boş yedek. */
  sessionKey: string | null;
  seen: SeenState | null;
  memo: Map<string, string>;
  contextTokens: number;
  /** O an süren turun araç işleyicisi; tur yokken gelen araç çağrısı reddedilir. */
  runTool: ClaudeCodeTurnRequest['runTool'] | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

const signatureOf = (spec: ClaudeCodeSpec): string =>
  createHash('sha256')
    .update(JSON.stringify([spec.kind, spec.model, spec.effort, spec.maxTurns, spec.system, spec.tools.map((tool) => [tool.name, tool.description, tool.inputSchema])]))
    .digest('hex');

const ISSUE_OF: Record<Exclude<ClaudeCodeState, 'ready'>, BrainCloudIssue | 'missing'> = {
  checking: 'network',
  missing: 'missing',
  old: 'missing',
  logged_out: 'auth',
  limit: 'limit',
  error: 'network',
};

const formatReset = (at: number) => new Date(at).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function createClaudeCodeBrain(deps: { log: Logger }, options: ClaudeCodeBrainOptions): ClaudeCodeBrain {
  const log = deps.log.child('claude-code');
  const choice = options.cli === undefined ? 'auto' : options.cli;
  const probeTtlMs = options.probeTtlMs ?? PROBE_TTL_MS;
  const idleMs = options.idleMs ?? IDLE_MS;
  const errorDownMs = options.errorDownMs ?? ERROR_DOWN_MS;
  const limitDownMs = options.limitDownMs ?? LIMIT_DOWN_MS;
  const maxContextTokens = options.maxContextTokens ?? MAX_CONTEXT_TOKENS;

  const mcp: ToolMcpServer = createToolMcpServer(log);
  const slots = new Set<Slot>();
  /** Süren süreç kapanışları. */
  const closings = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  let nextSlotId = 1;
  let command: CliCommand | null = choice === 'auto' ? null : choice;
  let probe: CliProbe = { installed: false, path: null, version: null, loggedIn: null, supported: false, checkedAt: 0 };
  let probing: Promise<void> | null = null;
  let down: { state: 'limit' | 'error'; until: number; resetsAt: number | null } | null = null;
  let failures = 0;
  let lastFirstTextMs: number | null = null;
  let disposed = false;
  let lastSignature = '';

  /** Dinleyenler bir sonraki mikro görevde çağrılır: durum sorgusunun içinden yeniden girilmez. */
  const notify = () => {
    queueMicrotask(() => {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          log.warn('durum dinleyicisi hata verdi', error);
        }
      }
    });
  };

  const compute = (): ClaudeCodeAvailability => {
    const version = probe.version;
    const not = (state: Exclude<ClaudeCodeState, 'ready'>, reason: string, resetsAt: number | null = null): ClaudeCodeAvailability => ({
      ok: false,
      state,
      reason,
      issue: ISSUE_OF[state],
      resetsAt,
      version,
    });
    if (choice === null) return not('missing', t('deep.cli.missing'));
    if (probe.checkedAt === 0) return not('checking', t('deep.cli.checking'));
    if (!command || !probe.installed) return not('missing', t(command ? 'deep.cli.broken' : 'deep.cli.missing'));
    if (!probe.supported) return not('old', t('deep.cli.old', { version: probe.version ?? '?', min: MIN_CLI_VERSION }));
    if (probe.loggedIn === false) return not('logged_out', t('deep.cli.loggedOut'));
    if (down && Date.now() < down.until) {
      if (down.state === 'limit') {
        return not('limit', t('deep.error.limit', { reset: down.resetsAt ? t('deep.error.limitReset', { time: formatReset(down.resetsAt) }) : '' }), down.resetsAt);
      }
      return not('error', t('ccbrain.error.unreachable'));
    }
    return { ok: true, state: 'ready', reason: null, issue: null, resetsAt: null, version };
  };

  /** Durum değiştiyse dinleyenlere bildirir. */
  const publish = (): ClaudeCodeAvailability => {
    if (down && Date.now() >= down.until) down = null;
    const availability = compute();
    const signature = `${availability.state}|${availability.resetsAt ?? ''}|${availability.version ?? ''}`;
    if (signature !== lastSignature) {
      const first = lastSignature === '';
      lastSignature = signature;
      if (!first || availability.ok) log.info(`konuşan beyin olarak Claude Code: ${availability.state}${availability.reason ? ` (${availability.reason})` : ''}`);
      if (!first) notify();
    }
    return availability;
  };

  const resolveCommand = (): CliCommand | null => {
    if (choice === null) return null;
    if (choice !== 'auto') return choice;
    const found = locateClaudeCli();
    return found ? { command: found, prefixArgs: [] } : null;
  };

  const refresh: ClaudeCodeBrain['refresh'] = async (force = false) => {
    if (disposed || choice === null) return publish();
    const ttl = probe.installed && probe.supported && probe.loggedIn !== false ? probeTtlMs : Math.min(probeTtlMs, PROBE_RETRY_MS);
    if (force || probe.checkedAt === 0 || Date.now() - probe.checkedAt > ttl) {
      probing ??= (async () => {
        command = resolveCommand();
        try {
          probe = await probeClaudeCli(command);
        } catch (error) {
          log.warn('Claude Code yoklanamadı', error);
          probe = { installed: false, path: command?.command ?? null, version: null, loggedIn: null, supported: false, checkedAt: Date.now() };
        }
      })().finally(() => {
        probing = null;
      });
      await probing;
    }
    return publish();
  };

  const closeSlot = (slot: Slot, why: string) => {
    if (slot.closed) return;
    slot.closed = true;
    slots.delete(slot);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.mcp.close();
    log.debug(`süreç kapatılıyor (${slot.kind}, ${why})`);
    // Kapanış izlenir: `dispose()` süren kapanışları da bekler (uygulama çıkarken yarım kalan süreç olmasın).
    const closing = slot.process
      .close()
      .catch(() => undefined)
      .finally(() => void closings.delete(closing));
    closings.add(closing);
  };

  const touch = (slot: Slot) => {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(() => {
      if (!slot.process.busy()) closeSlot(slot, 'boşta');
      else touch(slot);
    }, idleMs);
    slot.idleTimer.unref?.();
  };

  /** Sistem istemi içerik özetiyle adlandırılır: aynı istem aynı dosyayı kullanır. Dosya çalışma klasörünün DIŞINDADIR. */
  const systemFile = async (system: string): Promise<string> => {
    const dir = path.join(options.workDir, 'istem');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${createHash('sha256').update(system).digest('hex').slice(0, 24)}.txt`);
    try {
      await fs.promises.access(file);
    } catch {
      await fs.promises.writeFile(file, system, 'utf8');
    }
    return file;
  };

  const spawnSlot = async (spec: ClaudeCodeSpec): Promise<Slot | null> => {
    if (!command || disposed) return null;
    await mcp.start();
    const cwd = path.join(options.workDir, 'calisma');
    await fs.promises.mkdir(cwd, { recursive: true });
    const file = await systemFile(spec.system);
    const slot = {
      id: nextSlotId++,
      kind: spec.kind,
      signature: signatureOf(spec),
      tools: spec.tools,
      sessionKey: null,
      seen: null,
      memo: new Map<string, string>(),
      contextTokens: 0,
      runTool: null,
      idleTimer: null,
      closed: false,
    } as unknown as Slot;
    slot.mcp = mcp.open({
      tools: () => slot.tools,
      call: (name, input, meta) => {
        const run = slot.runTool;
        // Tur dışında (kesildikten sonra, boştayken) gelen çağrı çalıştırılmaz.
        if (!run || slot.closed) return Promise.resolve({ text: t('tool.error.aborted'), isError: true });
        // Araç çalışırken (onay beklerken de) sürecin süre sınırı işlemez: uzun iş "tur bitmedi" diye kesilmez.
        slot.process?.holdTimeout(true);
        return run({ name, input, toolUseId: meta.toolUseId }).finally(() => slot.process?.holdTimeout(false));
      },
    });
    slot.process = startBrainProcess({ command, cwd, systemPromptFile: file, model: spec.model, effort: spec.effort, mcp: { url: slot.mcp.url, token: slot.mcp.token }, maxTurns: spec.maxTurns, log });
    slot.process.onExit(() => closeSlot(slot, 'süreç kapandı'));
    slots.add(slot);
    touch(slot);
    return slot;
  };

  const usable = (slot: Slot, signature: string) => !slot.closed && slot.process.alive() && slot.signature === signature;

  /**
   * Tur için süreç: oturuma bağlı olan, yoksa yedek, o da yoksa yenisi. `ephemeral`: süreç tur bitince kapanır
   * (oturumsuz çağrı ya da aynı oturumun süreci o an başka bir turla meşgul).
   */
  const acquire = async (request: ClaudeCodeTurnRequest): Promise<{ slot: Slot; cold: boolean; ephemeral: boolean } | null> => {
    const signature = signatureOf(request);
    if (request.sessionKey === null) {
      const slot = await spawnSlot(request);
      return slot ? { slot, cold: true, ephemeral: true } : null;
    }
    for (const slot of [...slots]) {
      if (slot.kind !== request.kind || slot.sessionKey === null) continue;
      if (slot.sessionKey === request.sessionKey) {
        // Aynı oturumun süreci başka bir turu yürütüyor (olağan değil): ona dokunulmaz, bu tur ayrı bir süreçte yürür.
        if (slot.process.active()) {
          const extra = await spawnSlot(request);
          return extra ? { slot: extra, cold: true, ephemeral: true } : null;
        }
        if (usable(slot, signature) && slot.contextTokens < maxContextTokens && planHistory(request.messages, slot.seen).mode === 'continue') {
          return { slot, cold: false, ephemeral: false };
        }
        // İstem/araç/model değişmiş, bağlam çok büyümüş ya da süreç izini kaybetmiş: yenilenir.
        closeSlot(slot, 'yenileniyor');
      } else if (!slot.process.busy()) {
        closeSlot(slot, 'oturum değişti');
      }
    }
    for (const slot of slots) {
      if (slot.kind === request.kind && slot.sessionKey === null && usable(slot, signature)) {
        slot.sessionKey = request.sessionKey;
        return { slot, cold: false, ephemeral: false };
      }
    }
    const slot = await spawnSlot(request);
    if (!slot) return null;
    slot.sessionKey = request.sessionKey;
    return { slot, cold: true, ephemeral: false };
  };

  const failureOf = (stop: TurnStop, outcome: TurnOutcome): ClaudeCodeTurnResult['failure'] => {
    switch (stop) {
      case 'limit': {
        const resetsAt = outcome.resetsAt ? outcome.resetsAt * 1000 : null;
        return { issue: 'limit', reason: t('deep.error.limit', { reset: resetsAt ? t('deep.error.limitReset', { time: formatReset(resetsAt) }) : '' }) };
      }
      case 'auth':
        return { issue: 'auth', reason: t('deep.error.auth') };
      case 'timeout':
        return { issue: 'network', reason: t('brain.error.timeout') };
      case 'crash':
      case 'isolation':
      case 'error':
        return { issue: 'network', reason: t('ccbrain.error.unreachable') };
      default:
        return null;
    }
  };

  /** Turun sonucuna göre "şu an kullanılamaz" durumunu günceller. */
  const noteOutcome = (outcome: TurnOutcome) => {
    if (outcome.stop === 'end' || outcome.stop === 'max_turns' || outcome.stop === 'refusal') {
      failures = 0;
      if (down?.state === 'error') down = null;
    } else if (outcome.stop === 'limit') {
      const resetsAt = outcome.resetsAt ? outcome.resetsAt * 1000 : null;
      const until = resetsAt && resetsAt > Date.now() ? resetsAt : Date.now() + limitDownMs;
      down = { state: 'limit', until, resetsAt: resetsAt && resetsAt > Date.now() ? resetsAt : null };
    } else if (outcome.stop === 'auth') {
      probe = { ...probe, loggedIn: false, checkedAt: Date.now() };
    } else if (outcome.stop !== 'aborted') {
      failures++;
      if (failures >= FAILURES_BEFORE_DOWN) down = { state: 'error', until: Date.now() + errorDownMs, resetsAt: null };
    }
    publish();
  };

  const run: ClaudeCodeBrain['run'] = async (request) => {
    const failed = (stop: TurnStop, detail: string, failure: ClaudeCodeTurnResult['failure']): ClaudeCodeTurnResult => ({
      stop,
      text: '',
      detail,
      model: null,
      usage: null,
      turns: 0,
      resetsAt: null,
      firstTextMs: null,
      contextTokens: 0,
      failure,
      cold: false,
    });
    const availability = await refresh();
    if (!availability.ok) return failed('error', availability.state, { issue: availability.issue === 'missing' || availability.issue === null ? 'network' : availability.issue, reason: availability.reason ?? t('ccbrain.error.unreachable') });
    if (request.signal?.aborted) return failed('aborted', 'kesildi', null);

    let acquired: { slot: Slot; cold: boolean; ephemeral: boolean } | null;
    try {
      acquired = await acquire(request);
    } catch (error) {
      log.warn('Claude Code süreci açılamadı', error);
      acquired = null;
    }
    if (!acquired) {
      const outcome = failed('crash', 'süreç açılamadı', { issue: 'network', reason: t('ccbrain.error.unreachable') });
      noteOutcome(outcome);
      return outcome;
    }
    const { slot, cold, ephemeral } = acquired;
    const plan = planHistory(request.messages, slot.seen);
    const fresh = slot.seen === null;
    const last = request.messages.at(-1);
    const userText = last?.role === 'user' ? last.text : '';
    const images = last?.role === 'user' ? last.images : undefined;
    const preface = plan.mode === 'fresh' ? renderHistoryBlock(plan.history, request.assistantName) : renderMissedBlock(plan.missed, request.assistantName);
    let context = '';
    try {
      context = request.compose({ fresh, memo: slot.memo });
    } catch (error) {
      log.warn('bağlam bloğu üretilemedi', error);
    }
    const text = [preface, context, userText].filter((part) => part.trim()).join('\n');

    slot.runTool = request.runTool;
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    let outcome: TurnOutcome;
    try {
      outcome = await slot.process.turn({
        text,
        ...(images?.length ? { images } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        firstOutputTimeoutMs: request.firstOutputTimeoutMs,
        totalTimeoutMs: request.totalTimeoutMs,
        onText: request.onText,
        ...(request.onActivity ? { onActivity: request.onActivity } : {}),
      });
    } finally {
      slot.runTool = null;
    }
    slot.contextTokens = outcome.contextTokens || slot.contextTokens;
    const failure = failureOf(outcome.stop, outcome);
    if (outcome.stop === 'end' || outcome.stop === 'aborted' || outcome.stop === 'max_turns' || outcome.stop === 'refusal') {
      // Süreç bu sözü gördü (kesilen yanıtın söylenen kısmı da bağlamındadır).
      slot.seen = { lastUser: request.userKey, lastReply: outcome.text };
      if (outcome.firstTextMs !== null && outcome.stop === 'end') lastFirstTextMs = outcome.firstTextMs;
      if (ephemeral) closeSlot(slot, 'tek kullanımlık');
      else if (!slot.closed) touch(slot);
    } else {
      // Hatalı tur: sürecin bağlamı belirsiz; kapatılır, sonraki tur geçmişle yenisini açar.
      closeSlot(slot, outcome.stop);
    }
    noteOutcome(outcome);
    log.debug(`tur (${request.kind}${cold ? ', soğuk' : ''}): ${outcome.stop}${outcome.firstTextMs !== null ? `, ilk metin ${outcome.firstTextMs} ms` : ''}${outcome.stop === 'end' ? '' : `, ${outcome.detail}`}`);
    return { ...outcome, failure, cold };
  };

  const prewarm: ClaudeCodeBrain['prewarm'] = async (spec) => {
    try {
      const availability = await refresh();
      if (!availability.ok || disposed) return;
      const signature = signatureOf(spec);
      let ready = false;
      for (const slot of [...slots]) {
        if (slot.kind !== spec.kind) continue;
        if (usable(slot, signature)) ready = true;
        // İstem ya da araç kümesi değişmiş boş yedek işe yaramaz.
        else if (slot.sessionKey === null && !slot.process.busy()) closeSlot(slot, 'bayat yedek');
      }
      if (ready) return;
      const slot = await spawnSlot(spec);
      const state = await slot?.process.ready;
      if (slot && state && !state.ok) {
        log.debug(`ısıtma başarısız: ${state.detail}`);
        closeSlot(slot, 'ısıtma başarısız');
        if (state.stop === 'auth') {
          probe = { ...probe, loggedIn: false, checkedAt: Date.now() };
          publish();
        }
      }
    } catch (error) {
      log.debug(`ısıtma başarısız: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    id: 'claude-code',
    /**
     * `BrainProvider` yüzü: sağlayıcıdan bağımsız döngünün konuştuğu biçim. Konuşan beyin bu yolu kullanmaz (oturuma
     * bağlı süreç, bağlam ve araç işleyicisi `run` ile verilir); burada tek kullanımlık, araçsız bir tur yürür.
     */
    async turn(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
      const outcome = await run({
        kind: 'task',
        model: 'sonnet',
        effort: null,
        system: [request.system?.stable, request.system?.tail].filter(Boolean).join('\n\n') || t('ccbrain.system.plain'),
        tools: [],
        maxTurns: 1,
        sessionKey: null,
        messages: request.messages,
        userKey: '',
        assistantName: 'Asistan',
        compose: () => '',
        runTool: () => Promise.resolve({ text: t('tool.error.aborted'), isError: true }),
        ...(request.signal ? { signal: request.signal } : {}),
        onText: (delta) => request.onText(delta),
        firstOutputTimeoutMs: request.voice ? 12_000 : 60_000,
        totalTimeoutMs: request.voice ? 120_000 : 600_000,
      });
      if (outcome.stop !== 'end' && outcome.stop !== 'refusal') throw new ClaudeCodeError(outcome.stop, outcome.failure?.reason ?? outcome.detail);
      return {
        text: outcome.text,
        toolCalls: [],
        stop: outcome.stop === 'refusal' ? 'refusal' : 'end',
        usage: {
          provider: 'claude-code',
          model: outcome.model ?? 'claude-code',
          inputTokens: outcome.usage?.inputTokens ?? 0,
          outputTokens: outcome.usage?.outputTokens ?? 0,
          cacheReadTokens: outcome.usage?.cacheReadTokens ?? 0,
          cacheWriteTokens: outcome.usage?.cacheWriteTokens ?? 0,
          costUsd: null,
        },
      };
    },

    availability() {
      // Bayat yoklama arka planda tazelenir: oturum sonradan açıldıysa bir sonraki soruda görünür.
      const ttl = probe.installed && probe.supported && probe.loggedIn !== false ? probeTtlMs : Math.min(probeTtlMs, PROBE_RETRY_MS);
      if (!disposed && choice !== null && !probing && (probe.checkedAt === 0 || Date.now() - probe.checkedAt > ttl)) {
        void refresh().catch((error: unknown) => log.debug(`yoklama başarısız: ${String(error)}`));
      }
      return publish();
    },
    refresh,
    async settle(maxMs) {
      if (choice === null || probe.checkedAt !== 0) return;
      const wait = refresh().then(
        () => undefined,
        () => undefined,
      );
      await Promise.race([wait, new Promise<void>((resolve) => setTimeout(resolve, maxMs))]);
    },
    prewarm,
    run,
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    recycle() {
      for (const slot of [...slots]) if (slot.sessionKey === null && !slot.process.busy()) closeSlot(slot, 'politika değişti');
    },
    snapshot: () => ({
      warm: [...slots].filter((slot) => !slot.closed && slot.process.alive()).length,
      lastFirstTextMs,
      processes: slots.size,
      mcpCalls: mcp.stats().calls,
      mcpRejected: mcp.stats().rejected,
    }),
    pids: () => [...slots].map((slot) => slot.process.pid).filter((pid): pid is number => pid !== undefined),
    async dispose() {
      disposed = true;
      listeners.clear();
      const closing = [...slots].map((slot) => {
        slot.closed = true;
        if (slot.idleTimer) clearTimeout(slot.idleTimer);
        slot.mcp.close();
        return slot.process.close(300).catch(() => undefined);
      });
      slots.clear();
      await Promise.all([...closing, ...closings]);
      await mcp.stop();
    },
  };
}

/** `BrainProvider.turn` yüzünün hatası; beyin döngüsü Türkçe iletiyi kullanıcıya aktarır. */
export class ClaudeCodeError extends Error {
  constructor(
    readonly stop: TurnStop,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeCodeError';
  }
}
