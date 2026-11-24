/**
 * Derin beynin Claude Code sağlayıcısı: her iş için CLI'yi bir kez, başsız ve yalıtılmış çalıştırır.
 * Sistem istemi çalışma klasörünün DIŞINDA geçici bir dosyadan verilir (model onu okuyamaz, değiştiremez).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t, type Logger } from '@fuber/shared';
import {
  buildCliArgs,
  classifyFailure,
  createLimiter,
  runClaudeCli,
  userMessageLine,
  type CliCommand,
  type CliContentBlock,
  type CliEvent,
  type CliRunOutcome,
} from '../../claude-cli';
import { loadImage } from './files';
import type { DeepAskRequest, DeepStop, DeepTaskEvent, DeepTaskRequest, DeepTaskResult, DeepToolGroup } from './types';

export interface ClaudeCodeDeps {
  command(): CliCommand | null;
  /** `sonnet`, `opus`, `haiku` ya da tam model kimliği. */
  model(): string;
  log: Logger;
  /** Çağrı oturum hatasıyla bittiyse (oturum kapanmış) yoklama önbelleği bozulsun diye. */
  onAuthFailure?(): void;
  /** Her çağrıdan sonra: kullanım kaydı için. */
  onUsage?(usage: { model: string; inputTokens: number; outputTokens: number; durationMs: number }): void;
  /** Aynı anda koşan CLI; varsayılan 2. */
  maxConcurrent?: number;
}

export interface ClaudeCodeRun {
  ok: boolean;
  text: string;
  stop: DeepStop;
  error: string | null;
  turns: number;
  durationMs: number;
  denials: number;
}

const TOOLS: Record<DeepToolGroup, string[]> = {
  read: ['Read', 'Glob', 'Grep'],
  write: ['Write', 'Edit'],
  web: ['WebSearch', 'WebFetch'],
};
/** Araçlı işte en çok model turu; süre sınırıyla birlikte ikinci emniyettir. */
const TASK_MAX_TURNS = 60;
const DEFAULT_ASK_SECONDS = 120;

/** Araç girdisinden kullanıcıya gösterilebilecek kısa ayrıntı (dosya adı, sorgu, alan adı). */
function toolDetail(name: string, input: Record<string, unknown>): string | null {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : null);
  if (name === 'Write' || name === 'Edit' || name === 'Read') {
    const file = text('file_path');
    return file ? path.basename(file) : null;
  }
  if (name === 'WebSearch') return text('query')?.slice(0, 120) ?? null;
  if (name === 'WebFetch') {
    const url = text('url');
    if (!url) return null;
    try {
      return new URL(url).hostname;
    } catch {
      return url.slice(0, 80);
    }
  }
  if (name === 'Glob' || name === 'Grep') return text('pattern')?.slice(0, 80) ?? null;
  return null;
}

const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text);

export function createClaudeCodeProvider(deps: ClaudeCodeDeps) {
  const limiter = createLimiter(deps.maxConcurrent ?? 2);
  const active = new Set<AbortController>();

  const run = async (input: {
    kind: string;
    system: string;
    content: CliContentBlock[];
    /** Verilmezse boş bir geçici klasörde koşar. */
    workDir: string | null;
    tools: string[];
    maxTurns: number;
    maxSeconds: number;
    signal?: AbortSignal;
    onEvent?(event: DeepTaskEvent): void;
  }): Promise<ClaudeCodeRun> => {
    const started = Date.now();
    const fail = (stop: DeepStop, error: string, text = '', turns = 0, denials = 0): ClaudeCodeRun => ({
      ok: false,
      text,
      stop,
      error,
      turns,
      durationMs: Date.now() - started,
      denials,
    });
    const command = deps.command();
    if (!command) return fail('unavailable', t('deep.cli.missing'));
    if (!input.system.trim()) return fail('error', t('deep.error.system'));
    if (input.workDir && !fs.existsSync(input.workDir)) return fail('error', t('deep.error.workDir', { dir: input.workDir }));

    // Çağıranın iptali ile kapanıştaki toplu iptal tek sinyalde birleşir.
    const controller = new AbortController();
    const forward = () => controller.abort();
    if (input.signal?.aborted) return fail('aborted', t('deep.error.aborted'));
    input.signal?.addEventListener('abort', forward, { once: true });
    active.add(controller);

    const release = await limiter.acquire(controller.signal);
    if (!release) {
      active.delete(controller);
      input.signal?.removeEventListener('abort', forward);
      return fail('aborted', t('deep.error.aborted'));
    }

    let scratch: string | null = null;
    let outcome: CliRunOutcome;
    let streamed = '';
    let lastRateLimit: string | null = null;
    let resetsAt: number | null = null;
    let model = deps.model();
    const toolNames = new Map<string, { name: string; detail: string | null }>();
    const emit = (event: DeepTaskEvent) => {
      try {
        input.onEvent?.(event);
      } catch (error) {
        deps.log.warn('derin iş olayı işlenemedi', error);
      }
    };
    const onEvent = (event: CliEvent) => {
      switch (event.type) {
        case 'init':
          if (event.model) model = event.model;
          emit({ type: 'started', provider: 'claude-code', model: event.model });
          // Yalıtımın bozulduğunu (beklenmeyen MCP sunucusu ya da beceri) sessizce geçme.
          if (event.mcpServers.length > 0 || event.skills.length > 0) {
            deps.log.warn(`claude-code: beklenmeyen eklenti yüklendi (mcp: ${event.mcpServers.join(', ') || 'yok'}; beceri: ${event.skills.length})`);
          }
          break;
        case 'text':
          streamed += (streamed ? '\n' : '') + event.text;
          emit({ type: 'text', text: event.text });
          break;
        case 'tool_use': {
          const detail = toolDetail(event.name, event.input);
          toolNames.set(event.id, { name: event.name, detail });
          emit({ type: 'tool', phase: 'start', name: event.name, detail });
          break;
        }
        case 'tool_result': {
          const tool = toolNames.get(event.id);
          if (tool) emit({ type: 'tool', phase: 'end', name: tool.name, detail: tool.detail, ok: event.ok });
          break;
        }
        case 'denied':
          emit({ type: 'denied', tool: event.tool, reason: event.reason });
          break;
        case 'rate_limit':
          lastRateLimit = event.status;
          resetsAt = event.resetsAt;
          if (event.status === 'rejected' || event.status === 'allowed_warning') {
            emit({
              type: 'limit',
              status: event.status === 'rejected' ? 'rejected' : 'warning',
              resetsAt: event.resetsAt ? new Date(event.resetsAt * 1000).toISOString() : null,
            });
          }
          break;
        case 'retry':
          emit({ type: 'retry', attempt: event.attempt, error: event.error });
          break;
        default:
          break;
      }
    };

    try {
      scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuber2-deep-'));
      const systemPromptFile = path.join(scratch, 'system.txt');
      await fs.promises.writeFile(systemPromptFile, input.system, 'utf8');
      let cwd = input.workDir;
      if (!cwd) {
        cwd = path.join(scratch, 'work');
        await fs.promises.mkdir(cwd);
      }
      outcome = await runClaudeCli({
        command,
        cwd,
        args: buildCliArgs({ systemPromptFile, model: deps.model(), tools: input.tools, maxTurns: input.maxTurns }),
        stdin: userMessageLine(input.content),
        timeoutMs: input.maxSeconds * 1000,
        signal: controller.signal,
        onEvent,
      });
    } catch (error) {
      return fail('error', t('deep.error.spawn', { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      release();
      active.delete(controller);
      input.signal?.removeEventListener('abort', forward);
      // `fs.rmSync` Türkçe harfli yolda sessizce silmiyor (TUZAKLAR §7); söz veren sürüm kullanılır.
      if (scratch) await fs.promises.rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    }

    const result = outcome.result;
    const turns = result?.turns ?? 0;
    const denials = result?.denials ?? 0;
    const text = (result?.text || streamed).trim();
    if (result) {
      try {
        deps.onUsage?.({ model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs: Date.now() - started });
      } catch (error) {
        deps.log.warn('kullanım kaydedilemedi', error);
      }
    }
    const done = (stop: DeepStop, error: string | null): ClaudeCodeRun => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      deps.log.info(`claude-code ${input.kind}: ${stop}, ${turns} tur, ${seconds} sn${denials ? `, ${denials} ret` : ''}${outcome.garbage ? `, ${outcome.garbage} bozuk satır` : ''}`);
      return { ok: stop === 'end', text, stop, error, turns, durationMs: Date.now() - started, denials };
    };

    if (outcome.killed === 'abort') return done('aborted', t('deep.error.aborted'));
    if (outcome.killed === 'timeout') return done('timeout', t('deep.error.timeout', { seconds: input.maxSeconds }));
    if (outcome.spawnError) return done('error', t('deep.error.spawn', { detail: outcome.spawnError }));
    if (result?.ok) return text ? done('end', null) : done('error', t('deep.error.empty'));

    // Sonuç olayı yoksa (bozuk çıktı, çökme) elde yalnız hata çıktısı vardır; sınıflandırma ona bakar.
    const failure = classifyFailure(
      result ?? { subtype: 'missing', text: outcome.stderr, apiErrorStatus: null, stopReason: null },
      lastRateLimit,
    );
    const limitReset = resetsAt as number | null;
    switch (failure) {
      case 'limit':
        return done(
          'limit',
          t('deep.error.limit', {
            reset: limitReset ? t('deep.error.limitReset', { time: new Date(limitReset * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }) : '',
          }),
        );
      case 'auth':
        deps.onAuthFailure?.();
        return done('auth', t('deep.error.auth'));
      case 'max_turns':
        return done('max_turns', t('deep.error.maxTurns'));
      case 'refusal':
        return done('refusal', t('deep.error.refusal'));
      default: {
        if (!result) {
          const detail = outcome.stderr.trim() ? `: ${tail(outcome.stderr.trim(), 300)}` : outcome.exitCode !== null ? ` (çıkış kodu ${outcome.exitCode})` : '';
          return done('error', t('deep.error.noResult', { detail }));
        }
        return done('error', t('deep.error.failed', { detail: tail(result.text.trim() || result.subtype, 300) }));
      }
    }
  };

  return {
    /** Araçsız tek yanıt; görüntüler ileti içinde base64 olarak gider (model dosya okumaz). */
    async ask(request: DeepAskRequest): Promise<ClaudeCodeRun> {
      const content: CliContentBlock[] = [];
      for (const image of request.images ?? []) {
        const loaded = await loadImage(image);
        content.push({ type: 'image', source: { type: 'base64', media_type: loaded.mediaType, data: loaded.data } });
      }
      content.push({ type: 'text', text: request.prompt });
      return run({
        kind: request.images?.length ? 'ask+image' : 'ask',
        system: request.system,
        content,
        workDir: null,
        tools: [],
        maxTurns: 1,
        maxSeconds: request.maxSeconds ?? DEFAULT_ASK_SECONDS,
        ...(request.signal ? { signal: request.signal } : {}),
      });
    },

    async runTask(request: DeepTaskRequest): Promise<DeepTaskResult> {
      const tools = [...new Set(request.allowedTools.flatMap((group) => TOOLS[group] ?? []))];
      const outcome = await run({
        kind: request.kind,
        system: request.system,
        content: [{ type: 'text', text: request.prompt }],
        workDir: request.workDir,
        tools,
        maxTurns: Math.min(Math.max(request.maxTurns ?? TASK_MAX_TURNS, 1), 400),
        maxSeconds: request.maxSeconds,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.onEvent ? { onEvent: request.onEvent } : {}),
      });
      return { ...outcome, provider: 'claude-code' };
    },

    /** Koşan bütün CLI süreçlerini öldürür (uygulama kapanışı, acil durdurma). */
    abortAll(): void {
      for (const controller of [...active]) controller.abort();
    },
    activeCount: () => active.size,
  };
}

export type ClaudeCodeProvider = ReturnType<typeof createClaudeCodeProvider>;
