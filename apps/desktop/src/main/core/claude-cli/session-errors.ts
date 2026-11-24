/**
 * Claude Code hatalarını kullanıcıya TEK CÜMLE + EYLEM olarak anlatmak (v1 `shared/cc-hata.ts`'ten taşındı).
 * Gerçek hatalar İngilizce, ham JSON ("API Error: 401 {…,"request_id":"req_…"}"), sistem kodu (ECONNREFUSED) ya da yığın izi
 * taşır; süreç çökünce hata çıktısının son satırları da öyle. Hiçbiri olduğu gibi gösterilmez: ham metin sınıflanır, her sınıfın
 * bir Türkçe cümlesi ve bir eylemi vardır. Sınıflanamayan hata JSON/yığın/yollardan arındırılıp kısaltılır.
 */
import { t } from '@fuber/shared';

export type CliErrorClass = 'auth' | 'billing' | 'limit' | 'network' | 'missing' | 'overloaded' | 'model' | 'context' | 'generic';

export interface CliErrorInfo {
  class: CliErrorClass;
  /** Türkçe tek cümle + eylem. */
  text: string;
}

type KnownClass = Exclude<CliErrorClass, 'generic'>;

const str = (value: unknown): string => String(value ?? '');
const DETAIL_MAX = 140;
const shorten = (text: string): string => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text);

/** Metindeki ham öğeleri atar: ANSI, JSON bloğu, yığın satırları, istek kimlikleri; boşlukları tek satıra indirir. */
export function cleanRawError(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let text = str(raw).replace(/\u001b\[[0-9;]*m/g, '');
  text = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*at\s+\S+/.test(line) && !/^\s*\^+\s*$/.test(line))
    .join(' ');
  // JSON bloğu: içinde "message" varsa yalnız o kalır.
  text = text.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, (block) => {
    const inner = /"message"\s*:\s*"([^"]{1,200})"/.exec(block);
    return inner ? inner[1]! : '';
  });
  text = text.replace(/\breq_[0-9A-Za-z]{6,}\b/g, '').replace(/\b(?:node:)?internal\/[\w/.:-]+/g, '');
  text = text.replace(/\(\s*\)/g, '');
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

/** Sıra önemlidir: ilk eşleşen sınıf geçerlidir ("401" hem girişte hem başka iletilerde geçebilir). */
const RULES: Array<{ class: KnownClass; pattern: RegExp }> = [
  { class: 'missing', pattern: /native binary not found|not found at|\bENOENT\b|spawn .* (?:ENOENT|EINVAL)|is not recognized|cannot find the (?:file|path)|bulunamad|claude-yok/i },
  { class: 'billing', pattern: /credit balance|billing|payment required|\b402\b|insufficient (?:funds|credit|quota)|out of credits|extra usage|spend limit/i },
  { class: 'limit', pattern: /hit your (?:usage )?limit|usage limit|rate.?limit|\b429\b|too many requests|quota exceeded|limit reached|resets? (?:at )?\d/i },
  {
    class: 'auth',
    pattern:
      /invalid api key|please run \/login|not logged in|\/login|authentication[_ ]?(?:error|failed)|invalid x-api-key|oauth token (?:has )?expired|token (?:has )?expired|\b401\b|unauthorized|org(?:anization)? (?:disabled|not allowed)/i,
  },
  {
    class: 'network',
    pattern:
      /unable to connect|connection ?refused|econnrefused|econnreset|enotfound|etimedout|eai_again|getaddrinfo|network (?:error|is unreachable)|fetch failed|socket hang up|timed? ?out|connection error|certificate|\bssl\b|\bproxy\b|offline/i,
  },
  { class: 'overloaded', pattern: /overloaded|\b529\b|\b503\b|service unavailable|temporarily unavailable/i },
  { class: 'model', pattern: /model[_ ]not[_ ]found|\b404\b.*model|model .*(?:not (?:found|available)|does not exist)|invalid model/i },
  { class: 'context', pattern: /prompt is too long|context (?:length|window)|too many tokens|max_output_tokens|maximum context/i },
];

/** Claude Code'un asistan hata kodları (`assistant.error`). */
const CODE_CLASS: Partial<Record<string, KnownClass>> = {
  authentication_failed: 'auth',
  oauth_org_not_allowed: 'auth',
  billing_error: 'billing',
  rate_limit: 'limit',
  overloaded: 'overloaded',
  model_not_found: 'model',
  max_output_tokens: 'context',
};

const sentence = (kind: KnownClass): string => t(`claude.error.${kind}`);

/** "resets 5pm (Europe/Istanbul)" gibi sıfırlanma bilgisi (varsa). */
function resetInfo(raw: string): string {
  const match = /resets?\s+(?:at\s+)?([^·\n]{2,40}?)(?:\s*·|\s*\.|$)/i.exec(raw);
  return match ? match[1]!.trim() : '';
}

/**
 * Ham hata metni (+ varsa asistan hata kodu: `authentication_failed`, `billing_error`, `rate_limit`…) → tek cümle + eylem.
 * `raw` boşsa ve kod da yoksa genel bir cümle döner.
 */
export function describeCliError(raw: unknown, code?: unknown): CliErrorInfo {
  const text = str(raw);
  const codeText = str(code);
  const kind: KnownClass | undefined = CODE_CLASS[codeText] ?? RULES.find((rule) => rule.pattern.test(text))?.class;
  if (kind) {
    if (kind === 'limit') {
      const when = resetInfo(text);
      if (when) return { class: kind, text: t('claude.error.limitResets', { when }) };
    }
    return { class: kind, text: sentence(kind) };
  }
  if (codeText === 'account_on_hold') return { class: 'billing', text: t('claude.error.accountOnHold') };
  if (codeText === 'verification_required') return { class: 'auth', text: t('claude.error.verificationRequired') };
  const clean = cleanRawError(text);
  if (!clean) return { class: 'generic', text: t('claude.error.genericEmpty') };
  return { class: 'generic', text: t('claude.error.generic', { detail: shorten(clean) }) };
}

/**
 * Süreç çökmesi: çıkış kodu / sinyal + hata çıktısının son satırları. Sınıflanırsa o cümle; değilse "kapandı" cümlesi
 * (yığın izi ve yollar olmadan).
 */
export function describeCliCrash(cause: { code?: string | number | null; signal?: string | null; message?: string }, stderr: string): CliErrorInfo {
  const combined = `${str(cause.message)}\n${str(stderr)}`;
  const kind = RULES.find((rule) => rule.pattern.test(combined))?.class;
  if (kind) return { class: kind, text: sentence(kind) };
  const clean = cleanRawError(str(stderr).split(/\r?\n/).filter(Boolean).slice(-8).join('\n'));
  const hasCode = cause.code !== undefined && cause.code !== null && cause.code !== '';
  const reason = hasCode ? t('claude.error.crashCode', { code: String(cause.code) }) : cause.signal ? t('claude.error.crashSignal', { signal: cause.signal }) : '';
  const detail = clean ? `: ${shorten(clean)}` : '';
  return { class: 'generic', text: t('claude.error.crash', { reason, detail }) };
}
