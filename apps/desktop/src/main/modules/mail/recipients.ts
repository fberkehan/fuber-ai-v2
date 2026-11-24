// E-posta alıcıları: gönderimin GERÇEKTEN gideceği adresler. Fuber AI 1'den (`src/main/entegrasyon/eposta-alicilari.ts`).
//
// Gönderici `to` ve `cc`yi nodemailer'a verir; nodemailer alıcıları kendi RFC ayrıştırıcısıyla çıkarır ve grupları açar.
// Onay kartında gösterilen adresler AYNI ayrıştırıcının sonucudur: v1'de bir düzenli ifade `a@x.com, "evil"@attacker.com`
// içinde yalnız a@x.com'u görüyordu, nodemailer ikisine de gönderiyordu. Kural (kuşkuda gönderim YOK): alan dize değilse,
// ayrıştırıcı hata verirse, bir giriş adres taşımıyorsa ya da grup sözdizimi ("Ad: a@x.com;") varsa sonuç `null`.
import addressparser from 'nodemailer/lib/addressparser';
import { MAIL_ADDRESS_PATTERN } from './form';

/** Bir alıcı alanının (to / cc / bcc) gönderimde gideceği adresler (küçük harf). Alan yoksa ya da boşsa []; belirsizse null. */
export function fieldRecipients(value: unknown): string[] | null {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string') return null;
  let list: ReturnType<typeof addressparser>;
  try {
    list = addressparser(value);
  } catch {
    return null;
  }
  const out: string[] = [];
  for (const entry of Array.isArray(list) ? list : [list]) {
    if ('group' in entry && entry.group !== undefined) return null; // grup: üyeleri nodemailer açar ve gönderir
    const address = typeof entry.address === 'string' ? entry.address.trim() : '';
    if (!address || !MAIL_ADDRESS_PATTERN.test(address)) return null; // adressiz ya da biçimsiz parça: ne olduğu belirsiz
    out.push(address.toLowerCase());
  }
  return out;
}

/** Gönderimin BÜTÜN alıcıları (to + cc). Biri belirsizse ya da hiç alıcı yoksa null. */
export function allRecipients(fields: { to: unknown; cc?: unknown }): { to: string[]; cc: string[] } | null {
  const to = fieldRecipients(fields.to);
  const cc = fieldRecipients(fields.cc);
  if (to === null || cc === null || to.length === 0) return null;
  return { to, cc };
}
