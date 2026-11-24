/**
 * Derin beynin Anthropic API sağlayıcısı: beynin kendi döngüsünü (`BrainApi`) kullanır. Dosya araçları yalnız işin
 * çalışma klasöründe çalışır; web araçları Anthropic'in sunucu araçlarıdır. Kişilik ve hafıza kuyruğu eklenmez.
 */
import fs from 'node:fs';
import path from 'node:path';
import { defineTool, t, type BrainResponse, type ModuleContext, type ServerTool, type ToolDef, type ToolOrigin } from '@fuber/shared';
import { z } from 'zod';
import { listWorkDir, loadImage, resolveInWorkDir } from './files';
import type { DeepAskRequest, DeepStop, DeepTaskRequest, DeepTaskResult } from './types';

const ORIGIN: ToolOrigin = { channel: 'job', speakerVerified: null };
const MAX_FILE_BYTES = 400_000;
const DEFAULT_ASK_SECONDS = 120;

export interface AnthropicRun extends Omit<DeepTaskResult, 'provider'> {
  /** Bulut hiç yanıt üretemeden düştü (anahtar, kredi, ağ): çağıran başka sağlayıcıya geçebilir. */
  cloudFailure: boolean;
}

function fileTools(workDir: string, canWrite: boolean): ToolDef[] {
  const inside = (file: string) => resolveInWorkDir(workDir, file);
  const tools: ToolDef[] = [
    defineTool({
      name: 'deep_read_file',
      description: 'Çalışma klasöründeki bir dosyanın içeriğini döndürür. Yol klasöre göredir.',
      input: z.object({ path: z.string().describe('Klasöre göre dosya yolu') }),
      risk: 'read',
      async run({ path: file }) {
        const target = inside(file);
        if (!target) return { ok: false, text: 'Yol çalışma klasörünün dışında ya da geçersiz.' };
        try {
          const stat = fs.statSync(target);
          if (!stat.isFile()) return { ok: false, text: `${file} bir dosya değil.` };
          if (stat.size > MAX_FILE_BYTES) return { ok: false, text: `${file} çok büyük.` };
          return { ok: true, text: fs.readFileSync(target, 'utf8') };
        } catch {
          return { ok: false, text: `${file} yok.` };
        }
      },
    }),
    defineTool({
      name: 'deep_list_files',
      description: 'Çalışma klasöründeki dosyaları listeler.',
      input: z.object({}),
      risk: 'read',
      async run() {
        const files = listWorkDir(workDir);
        return { ok: true, text: files.length ? files.join('\n') : 'Klasör boş.' };
      },
    }),
  ];
  if (canWrite) {
    tools.push(
      defineTool({
        name: 'deep_write_file',
        description: 'Çalışma klasörüne bir dosya yazar (varsa üstüne yazar). Dosyanın TAM içeriğini ver.',
        input: z.object({ path: z.string().describe('Klasöre göre dosya yolu'), content: z.string().describe('Dosyanın tam içeriği') }),
        risk: 'write',
        async run({ path: file, content }) {
          const target = inside(file);
          if (!target) return { ok: false, text: 'Yol çalışma klasörünün dışında ya da geçersiz.' };
          if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return { ok: false, text: `${file} çok büyük.` };
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, 'utf8');
          return { ok: true, text: `${file} yazıldı.` };
        },
      }),
    );
  }
  return tools;
}

function toRun(response: BrainResponse, started: number, timedOut: boolean, maxSeconds: number): AnthropicRun {
  const base = { text: response.text.trim(), turns: response.toolCalls.length, durationMs: Date.now() - started, denials: 0 };
  const fail = (stop: DeepStop, error: string, cloudFailure = false): AnthropicRun => ({ ...base, ok: false, stop, error, cloudFailure });
  switch (response.stopReason) {
    case 'end':
      return base.text ? { ...base, ok: true, stop: 'end', error: null, cloudFailure: false } : fail('error', t('deep.error.empty'));
    case 'aborted':
      return timedOut ? fail('timeout', t('deep.error.timeout', { seconds: maxSeconds })) : fail('aborted', t('deep.error.aborted'));
    case 'refusal':
      return fail('refusal', response.error ?? t('deep.error.refusal'));
    case 'max_steps':
    case 'max_tokens':
      return fail('max_turns', response.error ?? t('deep.error.maxTurns'));
    case 'no_key':
      return fail('unavailable', response.error ?? t('deep.api.noKey'), true);
    case 'kill_switch':
    case 'budget':
      return fail('unavailable', response.error ?? t('brain.error.unknown'));
    default:
      // Hiç metin ve araç turu yokken gelen hata bulutun kullanılamadığını gösterir (kredi, anahtar, ağ).
      return fail('error', response.error ?? t('brain.error.unknown'), response.toolCalls.length === 0 && !base.text);
  }
}

/** Çağıranın sinyalini süre sınırıyla birleştirir. */
function withTimeout(signal: AbortSignal | undefined, seconds: number) {
  const controller = new AbortController();
  let timedOut = false;
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, seconds * 1000);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

export function createAnthropicProvider(ctx: ModuleContext) {
  return {
    async ask(request: DeepAskRequest): Promise<AnthropicRun> {
      const started = Date.now();
      const seconds = request.maxSeconds ?? DEFAULT_ASK_SECONDS;
      const images = await Promise.all((request.images ?? []).map(loadImage));
      const guard = withTimeout(request.signal, seconds);
      try {
        const response = await ctx.brain.respond({
          // Görüntülü soru `vision` rolünün modeliyle, düz soru `deep` rolüyle yanıtlanır.
          role: images.length ? 'vision' : 'deep',
          tools: 'none',
          persona: false,
          instructions: request.system,
          origin: ORIGIN,
          signal: guard.signal,
          messages: [{ role: 'user', text: request.prompt, ...(images.length ? { images } : {}) }],
        });
        return toRun(response, started, guard.timedOut(), seconds);
      } finally {
        guard.done();
      }
    },

    async runTask(request: DeepTaskRequest): Promise<AnthropicRun> {
      const started = Date.now();
      const groups = new Set(request.allowedTools);
      const tools = groups.has('read') || groups.has('write') ? fileTools(request.workDir, groups.has('write')) : [];
      const serverTools: ServerTool[] = groups.has('web') ? ['web_search', 'web_fetch'] : [];
      const guard = withTimeout(request.signal, request.maxSeconds);
      request.onEvent?.({ type: 'started', provider: 'anthropic', model: ctx.policy.get().models.deep.model });
      try {
        const response = await ctx.brain.runTask({
          role: 'deep',
          goal: request.prompt,
          instructions: request.system,
          // Kayıtlı araçların hiçbiri verilmez: derin iş kullanıcının hafızasına, hatırlatıcılarına, bilgisayarına dokunamaz.
          tools: 'none',
          ...(tools.length ? { extraTools: { context: ctx, tools } } : {}),
          ...(serverTools.length ? { serverTools } : {}),
          persona: false,
          origin: ORIGIN,
          signal: guard.signal,
          onStep: ({ text, toolNames }) => {
            if (text.trim()) request.onEvent?.({ type: 'text', text });
            // Sunucu araçları (web) istemci tarafında görünmez; her model turu bir "web" adımı olarak bildirilir.
            if (toolNames.length === 0 && serverTools.length) request.onEvent?.({ type: 'tool', phase: 'start', name: 'web', detail: null });
          },
          onToolCall: (event) => {
            if (event.phase === 'start') {
              const input = event.input as { path?: unknown } | null;
              request.onEvent?.({ type: 'tool', phase: 'start', name: event.name, detail: typeof input?.path === 'string' ? input.path : null });
            } else if (event.phase === 'end') {
              request.onEvent?.({ type: 'tool', phase: 'end', name: event.name, detail: null, ok: event.ok });
            }
          },
        });
        return toRun(response, started, guard.timedOut(), request.maxSeconds);
      } finally {
        guard.done();
      }
    },
  };
}

export type AnthropicProvider = ReturnType<typeof createAnthropicProvider>;
