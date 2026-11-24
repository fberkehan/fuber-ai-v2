// E-posta hesap formu: doğrulama, kırpma, "aynı bağlantı mı" ve sınama sonucunun metni (saf).
// Fuber AI 1'den (`src/shared/eposta-formu.ts`) alındı; tanımlayıcılar İngilizceye çevrildi, metinler sözlükten.
import { t } from '@fuber/shared';

/** Basit biçim denetimi: boşluksuz yerel kısım, "@", en az bir nokta içeren alan adı. */
export const MAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export interface AccountFormInput {
  address: string;
  password?: string | undefined;
  imapHost?: string | undefined;
  smtpHost?: string | undefined;
  imapPort?: number | undefined;
  smtpPort?: number | undefined;
}

const validPort = (port: unknown) => typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536;

/**
 * Formdaki ilk eksik/yanlış (bağlanmadan önce); tamamsa `null`. `needsPassword`: yeni hesap ya da bağlantısı değişen
 * hesap (kayıtlı parola yeni sunucuya gönderilmez). v1'de biçimsiz adres ve boş sunucu adıyla "Bağla ve sına" açıktı.
 */
export function accountFormProblem(input: AccountFormInput, needsPassword: boolean): string | null {
  const address = input.address.trim();
  if (!address) return t('mail.form.needAddress');
  if (!MAIL_ADDRESS_PATTERN.test(address)) return t('mail.form.badAddress');
  if (needsPassword && !input.password) return t('mail.form.needPassword');
  if (!input.imapHost?.trim() || !input.smtpHost?.trim()) return t('mail.form.needHosts');
  if (!validPort(input.imapPort) || !validPort(input.smtpPort)) return t('mail.form.badPort');
  return null;
}

const TRIMMED = ['label', 'address', 'username', 'imapHost', 'smtpHost'] as const;

/** Ad, adres, kullanıcı ve sunucu adları kırpılır (v1: " imap.ornek.com " boşluğuyla kaydediliyordu). Parola olduğu gibi kalır. */
export function trimAccountInput<T extends Partial<Record<(typeof TRIMMED)[number], string | undefined>>>(input: T): T {
  const copy = { ...input };
  for (const key of TRIMMED) if (typeof copy[key] === 'string') (copy as Record<string, unknown>)[key] = (copy[key] as string).trim();
  return copy;
}

/** Hesabın bağlantı alanları. */
export interface ConnectionFields {
  address?: string | undefined;
  username?: string | undefined;
  imapHost?: string | undefined;
  imapPort?: number | undefined;
  smtpHost?: string | undefined;
  smtpPort?: number | undefined;
}

/**
 * Kayıtlı parola YALNIZ kaydedildiği bağlantıyla kullanılır (v1 son incelemesi, C1 kardeşi): sunucu, port ya da kullanıcı
 * adı değiştiyse aynı bağlantı değildir; parola yeniden yazılmalıdır. Karşılaştırma büyük/küçük harf ve boşluk duyarsız;
 * kullanıcı adı boşsa adres (bağlanırken kullanılan ad).
 */
export function sameConnection(a: ConnectionFields, b: ConnectionFields): boolean {
  const user = (x: ConnectionFields) => String(x.username || x.address || '').trim().toLowerCase();
  const host = (value: unknown) => String(value ?? '').trim().toLowerCase();
  return (
    host(a.imapHost) === host(b.imapHost) &&
    Number(a.imapPort) === Number(b.imapPort) &&
    host(a.smtpHost) === host(b.smtpHost) &&
    Number(a.smtpPort) === Number(b.smtpPort) &&
    user(a) === user(b)
  );
}

/** Sınama sonucu tek satır: "Okuma ✓ · Gönderim ✕ — neden". */
export function testResultText(result: { imap: boolean; smtp: boolean; error: string | null }): string {
  const mark = (ok: boolean) => (ok ? '✓' : '✕');
  const head = t('mail.test.line', { imap: mark(result.imap), smtp: mark(result.smtp) });
  return result.error ? `${head} — ${result.error}` : head;
}
