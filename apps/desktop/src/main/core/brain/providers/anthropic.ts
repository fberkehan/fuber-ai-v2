// Sahibi: T2. Anthropic sağlayıcısı: akışlı Messages API (beta uç: sunucu tarafı ret yedeği için).
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Logger } from '@fuber/shared';
import type { MessagesClient } from '../client';
import type { BrainProvider, ConvMessage, ProviderStop, ProviderTurnRequest, ProviderTurnResult } from './types';

/** Akışı çözülemeyen araç girdisi yüzünden aynı adımın en çok kaç kez yeniden isteneceği. */
const MAX_JSON_RETRIES = 2;

export type AnthropicBase = Omit<BetaMessageStreamParams, 'messages' | 'max_tokens' | 'system'>;

function userBlocks(message: Extract<ConvMessage, { role: 'user' }>): BetaContentBlockParam[] {
  return [
    ...(message.images ?? []).map((image) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mediaType as 'image/png', data: image.data },
    })),
    ...(message.text.trim() ? [{ type: 'text' as const, text: message.text.trim() }] : []),
  ];
}

/**
 * Ara yedek (fallback) geçişinden önceki düşünme ve araç blokları geri gönderilmez; `fallback` bloğu yerinde kalır
 * (API onun konumuyla düşünme bloklarını doğrular).
 */
export function echoContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const lastFallback = content.map((block) => block.type).lastIndexOf('fallback' as BetaContentBlock['type']);
  if (lastFallback === -1) return content as unknown as BetaContentBlockParam[];
  return content.filter((block, index) => {
    if (index >= lastFallback) return true;
    return block.type !== 'thinking' && block.type !== 'redacted_thinking' && block.type !== 'tool_use';
  }) as unknown as BetaContentBlockParam[];
}

export function toAnthropicMessages(messages: ConvMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const message of messages) {
    let param: BetaMessageParam | null = null;
    if (message.role === 'user') {
      const blocks = userBlocks(message);
      if (blocks.length) param = { role: 'user', content: blocks };
    } else if (message.role === 'assistant') {
      const blocks: BetaContentBlockParam[] = message.native
        ? (message.native as BetaContentBlockParam[])
        : [
            ...(message.text.trim() ? [{ type: 'text' as const, text: message.text.trim() }] : []),
            ...message.toolCalls.map((call) => ({ type: 'tool_use' as const, id: call.id, name: call.name, input: call.input })),
          ];
      if (blocks.length) param = { role: 'assistant', content: blocks };
    } else {
      param = {
        role: 'user',
        // Paralel çağrıların bütün sonuçları tek kullanıcı iletisinde döner.
        content: message.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      };
    }
    if (!param) continue;
    const last = out.at(-1);
    // Ardışık aynı rol (ör. yanıtsız kalmış tur) tek iletide birleşir; API sıranın değişmesini ister.
    if (last && last.role === param.role && Array.isArray(last.content) && Array.isArray(param.content)) {
      last.content.push(...(param.content as BetaContentBlockParam[]));
    } else {
      out.push(param);
    }
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

/** Araç turundan sonra son iletiye önbellek kırılma noktası koyar (yalnız bu istekte; geçmiş değişmez). */
function withMessageBreakpoint(messages: BetaMessageParam[]): BetaMessageParam[] {
  const last = messages.at(-1);
  if (!last || !Array.isArray(last.content) || last.content.length === 0) return messages;
  const blocks = [...last.content];
  const tail = blocks.at(-1) as BetaContentBlockParam;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } } as BetaContentBlockParam;
  return [...messages.slice(0, -1), { ...last, content: blocks } as BetaMessageParam];
}

const STOP: Record<string, ProviderStop> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
  pause_turn: 'pause',
};

export function anthropicProvider(client: MessagesClient, base: AnthropicBase, log: Logger): BrainProvider {
  return {
    id: 'anthropic',
    async turn(request: ProviderTurnRequest): Promise<ProviderTurnResult> {
      const messages = toAnthropicMessages(request.messages);
      const system = request.system
        ? [
            { type: 'text' as const, text: request.system.stable, cache_control: { type: 'ephemeral' as const } },
            { type: 'text' as const, text: request.system.tail },
          ]
        : undefined;
      for (let attempt = 0; ; attempt++) {
        const params: BetaMessageStreamParams = {
          ...base,
          ...(system ? { system } : {}),
          max_tokens: request.maxTokens,
          messages: request.cacheLoop ? withMessageBreakpoint(messages) : messages,
        };
        const stream = client.stream(params, {
          ...(request.signal ? { signal: request.signal } : {}),
          timeout: request.voice ? 30_000 : 600_000,
          maxRetries: request.voice ? 1 : 2,
        });
        let text = '';
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              text += event.delta.text;
              request.onText(event.delta.text);
            }
          }
          const message: BetaMessage = await stream.finalMessage();
          const toolCalls = message.content
            .filter((block): block is BetaToolUseBlock => block.type === 'tool_use')
            .map((block) => {
              const valid = typeof block.input === 'object' && block.input !== null && !Array.isArray(block.input);
              return {
                id: block.id,
                name: block.name,
                input: block.input,
                ...(valid ? {} : { inputError: JSON.stringify(block.input) }),
              };
            });
          const usage = message.usage;
          return {
            text,
            toolCalls,
            stop: STOP[message.stop_reason ?? 'end_turn'] ?? 'end',
            native: echoContent(message.content),
            usage: {
              provider: 'anthropic',
              model: message.model,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheReadTokens: usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
            },
          };
        } catch (error) {
          // Akışlı araç girdisi çözülemediyse (SDK'nın JSON hatası) adım yeniden istenir; API hataları yeniden fırlar.
          const isApiError = error instanceof Anthropic.APIError;
          if (request.signal?.aborted || isApiError || attempt >= MAX_JSON_RETRIES || text !== '') throw error;
          log.warn('araç girdisi çözülemedi, adım yeniden isteniyor', error);
        }
      }
    },
  };
}
