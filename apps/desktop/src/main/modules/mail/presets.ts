// Hazır sağlayıcı ayarları (Fuber AI 1'in dört hazır ayarı + iCloud) ve bağlantı güvenliği kuralı.
import type { MailPreset, MailProviderId } from './types';

export const MAIL_PRESETS: readonly MailPreset[] = [
  { id: 'gmail', label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, noteKey: 'mail.preset.gmailNote' },
  { id: 'outlook', label: 'Outlook / Microsoft 365', imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587, noteKey: 'mail.preset.outlookNote' },
  { id: 'yandex', label: 'Yandex', imapHost: 'imap.yandex.com', imapPort: 993, smtpHost: 'smtp.yandex.com', smtpPort: 465, noteKey: 'mail.preset.yandexNote' },
  { id: 'icloud', label: 'iCloud', imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587, noteKey: 'mail.preset.icloudNote' },
  // Görünen adı sözlükten (`mail.preset.custom`).
  { id: 'custom', label: '', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465, noteKey: 'mail.preset.customNote' },
];

export function presetOf(id: MailProviderId): MailPreset {
  return MAIL_PRESETS.find((preset) => preset.id === id) ?? MAIL_PRESETS[MAIL_PRESETS.length - 1]!;
}

/** Bu bilgisayarın kendisi (sınamadaki sahte sunucu). Şifresiz bağlantıya yalnız burada izin verilir. */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '::1' || /^127(\.\d{1,3}){3}$/.test(value);
}

/**
 * Bağlantının şifreleme kipi. 993/465: baştan TLS · başka port: STARTTLS ZORUNLU (sunucu sunmazsa bağlanılmaz; parola
 * düz metin gitmez) · yalnız geri döngüde (127.0.0.1) şifresiz bağlantı kabul edilir.
 */
export function transportSecurity(host: string, port: number, kind: 'imap' | 'smtp'): 'tls' | 'starttls' | 'plain' {
  if ((kind === 'imap' && port === 993) || (kind === 'smtp' && port === 465)) return 'tls';
  return isLoopbackHost(host) ? 'plain' : 'starttls';
}
