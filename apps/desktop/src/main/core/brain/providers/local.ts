// Sahibi: T2. Yerel sağlayıcı: llama-server'ın OpenAI uyumlu `/v1/chat/completions` ucu, akışlı (SSE), araç çağrılı.
// Bağımlılık yok: `fetch`. Küçük modelin kusurlarına karşı: düşünme etiketi ayıklama, metne yazılmış araç çağrısı,
// bozuk araç JSON'unu bir kez onarma.
import { newId } from '@fuber/shared';
import { ChatCompletionAccumulator, parseToolArguments, repairJson, sseEvents } from './openai-stream';
import { LocalBrainError, type BrainProvider, type ConvMessage, type ProviderStop, type ProviderTurnRequest, type ProviderTurnResult, type ToolCallRequest } from './types';

/** Etiket içindeki metni kullanıcıya/sese sızdırmayan akış süzgeci; `<tool_call>` içeriğini ayrıca toplar. */
export class TagFilter {
  private buffer = '';
  private inside: 'think' | 'tool_call' | null = null;
  private captured = '';
  readonly toolCalls: string[] = [];
  private started = false;

  push(delta: string): string {
    this.buffer += delta;
    let out = '';
    for (;;) {
      if (this.inside) {
        const close = `</${this.inside}>`;
        const end = this.buffer.indexOf(close);
        if (end === -1) {
          // Kapanış etiketi parçalı gelebilir: son birkaç karakter tutulur.
          const keep = Math.min(this.buffer.length, close.length - 1);
          this.captured += this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          break;
        }
        this.captured += this.buffer.slice(0, end);
        if (this.inside === 'tool_call') this.toolCalls.push(this.captured.trim());
        this.captured = '';
        this.buffer = this.buffer.slice(end + close.length);
        this.inside = null;
        continue;
      }
      const open = this.buffer.search(/<(think|tool_call)>/);
      if (open === -1) {
        // Açılış etiketinin başı olabilecek kuyruk (`<thi`) bekletilir.
        const lt = this.buffer.lastIndexOf('<');
        const safe = lt !== -1 && this.buffer.length - lt < 12 ? lt : this.buffer.length;
        out += this.buffer.slice(0, safe);
        this.buffer = this.buffer.slice(safe);
        break;
      }
      out += this.buffer.slice(0, open);
      const tag = /<(think|tool_call)>/.exec(this.buffer.slice(open))!;
      this.inside = tag[1] as 'think' | 'tool_call';
      this.buffer = this.buffer.slice(open + tag[0].length);
    }
    return this.emit(out);
  }

  flush(): string {
    const rest = this.inside ? '' : this.buffer;
    if (this.inside === 'tool_call' && this.captured) this.toolCalls.push(this.captured.trim());
    this.buffer = '';
    this.inside = null;
    return this.emit(rest);
  }

  private emit(text: string): string {
    if (!this.started) {
      text = text.replace(/^\s+/, '');
      if (text) this.started = true;
    }
    return text;
  }
}

// Akış ayrıştırması ve JSON onarımı bulut sağlayıcılarıyla ortaktır (`openai-stream.ts`).
export { repairJson };
const parseArguments = parseToolArguments;

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAiMessages(system: ProviderTurnRequest['system'], messages: ConvMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  // Yerelde değişken bilgi (saat, hafıza) son kullanıcı iletisindedir; kuyruk boştur ve sistem istemi tur tur aynıdır.
  if (system) out.push({ role: 'system', content: system.tail ? `${system.stable}\n\n${system.tail}` : system.stable });
  for (const message of messages) {
    if (message.role === 'user') {
      // Yerel modelde görsel yok; görsel gelmişse bunu modele açıkça söyleriz ki uydurmasın.
      const note = message.images?.length ? '\n(Bu iletiye eklenen görseli göremiyorsun.)' : '';
      const last = out.at(-1);
      if (last?.role === 'user') last.content += `\n${message.text}${note}`;
      else out.push({ role: 'user', content: `${message.text}${note}` });
    } else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.text || null,
        ...(message.toolCalls.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: typeof call.input === 'string' ? call.input : JSON.stringify(call.input) },
              })),
            }
          : {}),
      });
    } else {
      for (const result of message.results) {
        out.push({ role: 'tool', tool_call_id: result.id, content: result.isError ? `HATA: ${result.content}` : result.content });
      }
    }
  }
  return out;
}

export interface LocalProviderOptions {
  baseUrl: string;
  modelId: string;
  /** Sınamada sahte `fetch`. */
  fetchFn?: typeof fetch;
  temperature?: number;
}

export function localProvider(options: LocalProviderOptions): BrainProvider {
  const doFetch = options.fetchFn ?? fetch;
  return {
    id: 'local',
    async turn(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
      const body = {
        messages: toOpenAiMessages(request.system, request.messages),
        ...(request.tools.length
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
              })),
              tool_choice: request.requireTool ? 'required' : 'auto',
              // Küçük model paralel çağrıda ilgisiz ek araçlar (ör. voice_stop_speaking) ekliyordu; adım başına tek çağrı.
              parallel_tool_calls: false,
            }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: request.maxTokens,
        temperature: options.temperature ?? 0.3,
        // Düşünme kapalı: hem gecikme hem de düşünmenin söze sızma riski.
        chat_template_kwargs: { enable_thinking: false },
      };
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          ...(request.signal ? { signal: request.signal } : {}),
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        throw new LocalBrainError('network', `yerel sunucuya bağlanılamadı: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        const kind = /context|n_ctx|too long|exceeds/i.test(detail) ? 'context' : 'server';
        throw new LocalBrainError(kind, `yerel sunucu ${response.status}: ${detail.slice(0, 300)}`);
      }

      const filter = new TagFilter();
      let text = '';
      const emit = (piece: string) => {
        if (!piece) return;
        text += piece;
        request.onText(piece);
      };
      const stream = new ChatCompletionAccumulator((piece) => emit(filter.push(piece)));
      for await (const event of sseEvents(response.body)) stream.push(event.data.trim());
      emit(filter.flush());
      const finish = stream.finish;
      const usage = { input: stream.usage?.input ?? 0, output: stream.usage?.output ?? 0 };

      const toolCalls: ToolCallRequest[] = stream.toolCalls();
      // Şablonun ayrıştıramadığı, metne yazılmış çağrılar: `<tool_call>{"name":…,"arguments":{…}}</tool_call>`.
      for (const raw of filter.toolCalls) {
        const value = repairJson(raw) as { name?: string; arguments?: unknown } | null;
        if (!value?.name) continue;
        const args = typeof value.arguments === 'string' ? parseArguments(value.arguments) : { input: value.arguments ?? {} };
        toolCalls.push({ id: `call_${newId()}`, name: value.name, input: args.input, ...('error' in args && args.error ? { inputError: args.error } : {}) });
      }

      let stop: ProviderStop = 'end';
      if (toolCalls.length) stop = 'tool_use';
      else if (finish === 'length') stop = 'max_tokens';
      return {
        text,
        toolCalls,
        stop,
        usage: {
          provider: 'local',
          model: options.modelId,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      };
    },
  };
}

/** Yerel yapılandırılmış çıkarım: dilbilgisiyle kısıtlı JSON (`response_format.json_schema`). */
export async function localExtract(
  options: LocalProviderOptions & { system: string; input: string; schema: Record<string, unknown>; maxTokens: number; signal?: AbortSignal },
): Promise<{ raw: string; inputTokens: number; outputTokens: number }> {
  const doFetch = options.fetchFn ?? fetch;
  const response = await doFetch(`${options.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.input },
      ],
      stream: false,
      max_tokens: options.maxTokens,
      temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_schema', json_schema: { name: 'output', schema: options.schema } },
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new LocalBrainError('server', `yerel çıkarım ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    raw: json.choices?.[0]?.message?.content ?? '',
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}
