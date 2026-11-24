// Sır gibi görünen metin: aktarılmaz, yalnız sayısı bildirilir. Basit ve tutucu desenler: kaçırmaktansa fazla
// yakalamak yeğdir (yakalanan kayıt v1'de durmaya devam eder, kullanıcı isterse elle ekler).

const PATTERNS: RegExp[] = [
  // Sağlayıcı anahtarları ve belirteçler
  /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{16,}/,
  /\b(?:rk|pk|sk)_(?:live|test)_[A-Za-z0-9]{12,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/, // JWT
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  // "şifre: …", "parola = …", "password …", "api key: …", "pin: 1234"
  // (`\b` Türkçe harfin önünde çalışmaz; harf/rakam olmayan bir öncül aranır.)
  /(?<![\p{L}\p{N}])(?:şifre(?:si|m|miz)?|sifre(?:si|m)?|parola(?:sı|m)?|password|passwd|pwd|api[\s_-]?(?:key|anahtar[ıi]?)|secret|token|pin(?:\s?kodu)?)\s*[:=]\s*\S{3,}/iu,
  /(?<![\p{L}\p{N}])(?:şifre(?:si|m|miz)?|sifre(?:si|m)?|parola(?:sı|m)?|password)\s+(?:olarak\s+)?["'`]?(?=[^\s"'`]*\d)[^\s"'`]{6,}/iu,
  // Bağlantı dizgisinde parola: scheme://kullanıcı:parola@
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@/i,
];

/** Luhn'dan geçen 13–19 haneli kart numarası. */
function hasCardNumber(text: string): boolean {
  for (const match of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

export function looksSecret(...parts: Array<string | null | undefined>): boolean {
  const text = parts.filter(Boolean).join('\n');
  if (!text) return false;
  return PATTERNS.some((pattern) => pattern.test(text)) || hasCardNumber(text);
}
