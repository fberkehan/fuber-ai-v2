// Sahibi: T2. Model fiyatlarının tek yeri ($ / milyon token). Yeni model ya da fiyat değişikliği yalnız buraya yazılır.

export interface ModelPrice {
  input: number;
  output: number;
  /** Önbellekten okuma. */
  cacheRead: number;
  /** 5 dakikalık önbelleğe yazma (girdi fiyatının 1,25 katı). */
  cacheWrite: number;
}

interface PriceEntry {
  /** Model kimliğinin başı; tarih eki ya da sağlayıcı öneki olsa da eşleşsin diye önekle aranır. */
  prefix: string;
  price: ModelPrice;
  /** Bu kadar girdi tokenını aşan istem pahalı fiyat kartıyla faturalanır (Haiku 5.5: 100 bin). */
  longPrompt?: { aboveTokens: number; price: ModelPrice };
}

const per = (input: number, output: number, cacheReadRatio: number): ModelPrice => ({
  input,
  output,
  cacheRead: input * cacheReadRatio,
  cacheWrite: input * 1.25,
});

const PRICES: PriceEntry[] = [
  { prefix: 'claude-fable-5-2', price: per(8, 40, 0.025) },
  { prefix: 'claude-mythos-5-2', price: per(8, 40, 0.025) },
  { prefix: 'claude-opus-5-5', price: per(4, 20, 0.05) },
  { prefix: 'claude-sonnet-5-5', price: per(2, 10, 0.05) },
  {
    prefix: 'claude-haiku-5-5',
    price: per(0.1, 0.5, 0.1),
    longPrompt: { aboveTokens: 100_000, price: per(0.5, 2.5, 0.1) },
  },
];

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Bilinen modelin fiyatı; bilinmiyorsa `null`. */
export function priceFor(model: string, promptTokens = 0): ModelPrice | null {
  const id = model.replace(/^anthropic\./, '');
  const entry = PRICES.find((candidate) => id.startsWith(candidate.prefix));
  if (!entry) return null;
  if (entry.longPrompt && promptTokens > entry.longPrompt.aboveTokens) return entry.longPrompt.price;
  return entry.price;
}

/** Dolar karşılığı; fiyatı bilinmeyen model için `null`. */
export function costUsd(model: string, tokens: TokenCounts): number | null {
  const prompt = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
  const price = priceFor(model, prompt);
  if (!price) return null;
  const total =
    tokens.inputTokens * price.input +
    tokens.outputTokens * price.output +
    tokens.cacheReadTokens * price.cacheRead +
    tokens.cacheWriteTokens * price.cacheWrite;
  return total / 1_000_000;
}
