/**
 * Sağlayıcı hatasını (anahtar sınaması, ses listesi, "Sesi dene") sade bir duruma çevirir. Ham yanıt atılmaz:
 * arayüz onu "Ayrıntı" altında gösterir. Saf işlev; birim sınaması `provider-error.test.ts`.
 *
 * Girdi, kontrol servisinin Türkçe iletisidir; içinde HTTP durumu ("(401)") ve sağlayıcının kısaltılmış
 * gövdesi bulunur. Sıra önemlidir: ElevenLabs kota dolunca 401 + `quota_exceeded` döner (anahtar geçersiz
 * değildir); Anthropic kredisiz hesapta 400 + "credit balance is too low" döner.
 */
export type ProviderErrorKind = 'network' | 'missing' | 'quota' | 'credit' | 'plan' | 'invalid' | 'unknown';

export function classifyProviderError(raw: string, httpStatus: number | null = null): ProviderErrorKind {
  const text = raw ?? '';
  if (/kasada .* anahtarı yok/i.test(text)) return 'missing';
  if (/quota_exceeded|insufficient_quota|kota doldu|exceeds your quota/i.test(text)) return 'quota';
  if (/credit balance|kredi yok|purchase credits/i.test(text)) return 'credit';
  const status = httpStatus ?? statusFrom(text);
  if (status === 429) return 'quota';
  if (status === 402 || /payment_required|paid_plan_required|plan yetersiz|subscription/i.test(text)) return 'plan';
  if (status === 401 || status === 403 || /invalid_api_key|authentication_error|anahtar reddedildi|api key not valid/i.test(text)) return 'invalid';
  if (
    status === null &&
    /ulaşılamadı|yanıt gelmedi|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(text)
  ) {
    return 'network';
  }
  if (status !== null && status >= 500) return 'network';
  return 'unknown';
}

/** İletideki ilk "(NNN)" ya da "HTTP NNN" durum kodu. */
function statusFrom(text: string): number | null {
  const match = /\((\d{3})\)|HTTP (\d{3})/.exec(text);
  const code = match ? Number(match[1] ?? match[2]) : NaN;
  return Number.isFinite(code) ? code : null;
}
