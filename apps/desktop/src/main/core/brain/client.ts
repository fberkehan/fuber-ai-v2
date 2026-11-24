// Sahibi: T2. Anthropic SDK'sının beyinde kullanılan dar yüzü; birim testleri bunun sahte uygulamasını verir.
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

export interface CallOptions {
  signal?: AbortSignal;
  /** ms */
  timeout?: number;
  maxRetries?: number;
}

/** Akış: olaylar gezilir, sonra `finalMessage()` bütün iletiyi verir (araç girdisi çözülemezse reddeder). */
export interface MessageStreamLike extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
  abort(): void;
}

export interface MessagesClient {
  stream(params: BetaMessageStreamParams, options: CallOptions): MessageStreamLike;
  create(params: MessageCreateParamsNonStreaming, options: CallOptions): Promise<BetaMessage>;
}

export type ClientFactory = (apiKey: string) => MessagesClient;

export const createAnthropicClient: ClientFactory = (apiKey) => {
  const client = new Anthropic({ apiKey });
  return {
    stream: (params, options) => client.beta.messages.stream(params, options) as unknown as MessageStreamLike,
    create: (params, options) => client.beta.messages.create(params, options),
  };
};
