// IMAP okuma (imapflow) ve SMTP gönderim (nodemailer). Gelen kutusu SALT OKUNUR açılır (EXAMINE): Fuber iletiyi okundu
// yapmaz, silmez, taşımaz. Gövde yalnız veritabanında olmayan iletiler için iner (v1: son 30 iletinin tam gövdesi her 5 dk'da
// yeniden iniyordu). Parola bu dosyada yalnız bellekte durur; hata metinlerinden de ayıklanır (`scrub`).
import { ImapFlow, type FetchMessageObject, type ImapFlowOptions } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import { t } from '@fuber/shared';
import { transportSecurity } from './presets';
import type { Attachment, NewMessage } from './repo';
import { htmlToText } from './text';

export interface Endpoint {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** İlk eşitlemede inen en çok ileti (en yeniler). */
export const INITIAL_COUNT = 30;
/** Bir eşitlemede inen en çok yeni ileti (fazlası sonraki eşitlemede). */
export const BATCH_LIMIT = 50;
/** Kaynağı bundan büyük ileti için yalnız başlık iner. */
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
/** Saklanan gövde (karakter). */
export const MAX_BODY_CHARS = 50_000;
/** Okundu bayrağı tazelenen son ileti sayısı. */
const SEEN_WINDOW = 200;

const TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000 } as const;

/** Hata metnini kullanıcıya gösterilecek kısa Türkçe nedene çevirir; parola hiçbir koşulda geçmez. */
export function friendlyError(error: unknown, endpoint: Pick<Endpoint, 'host' | 'password'>, kind: 'imap' | 'smtp'): string {
  const raw = error as { code?: string; message?: string; authenticationFailed?: boolean; responseCode?: number; serverResponseCode?: string; responseText?: string } | null;
  const code = String(raw?.code ?? '');
  const message = String(raw?.message ?? error ?? '');
  const scrub = (text: string) => (endpoint.password ? text.split(endpoint.password).join('***') : text).slice(0, 160);
  if (raw?.authenticationFailed || code === 'EAUTH' || /auth|login|credentials|invalid.*password|\b535\b/i.test(`${message} ${raw?.responseText ?? ''}`))
    return t('mail.error.auth');
  if (/STARTTLS/i.test(message) || code === 'ETLS') return t('mail.error.starttls', { host: endpoint.host });
  if (/certificate|self.signed|CERT_|TLS|SSL/i.test(`${code} ${message}`)) return t('mail.error.tls', { host: endpoint.host });
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) || /ECONNREFUSED|ENOTFOUND|getaddrinfo/.test(message))
    return t('mail.error.connect', { host: endpoint.host });
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT' || code === 'ECONNECTION' || /timed? ?out/i.test(message)) return t('mail.error.timeout', { host: endpoint.host });
  return t(kind === 'imap' ? 'mail.error.imap' : 'mail.error.smtp', { detail: scrub(message) });
}

/**
 * Hatanın türü (içe aktarmanın hesap başına sonucu için): `auth` kullanıcı adı/parola · `unreachable` sunucuya ulaşılamadı
 * (DNS, ret, zaman aşımı, TLS/STARTTLS) · `other` başka. `friendlyError` ile aynı işaretlere bakar.
 */
export function errorKind(error: unknown): 'auth' | 'unreachable' | 'other' {
  const raw = error as { code?: string; message?: string; authenticationFailed?: boolean; responseText?: string } | null;
  const code = String(raw?.code ?? '');
  const message = String(raw?.message ?? error ?? '');
  if (raw?.authenticationFailed || code === 'EAUTH' || /auth|login|credentials|invalid.*password|\b535\b/i.test(`${message} ${raw?.responseText ?? ''}`)) return 'auth';
  if (/STARTTLS/i.test(message) || code === 'ETLS' || /certificate|self.signed|CERT_|TLS|SSL/i.test(`${code} ${message}`)) return 'unreachable';
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ETIMEOUT', 'ECONNECTION', 'ECONNRESET'].includes(code)) return 'unreachable';
  if (/ECONNREFUSED|ENOTFOUND|getaddrinfo|timed? ?out/i.test(message)) return 'unreachable';
  return 'other';
}

function imapClient(endpoint: Endpoint): ImapFlow {
  const security = transportSecurity(endpoint.host, endpoint.port, 'imap');
  const options: ImapFlowOptions & { doSTARTTLS?: boolean } = {
    host: endpoint.host,
    port: endpoint.port,
    secure: security === 'tls',
    // STARTTLS'siz sunucuya parola düz metin gitmez; yalnız geri döngü (sahte sunucu) şifresiz konuşur.
    doSTARTTLS: security === 'starttls' ? true : security === 'plain' ? false : undefined,
    auth: { user: endpoint.username, pass: endpoint.password },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    clientInfo: { name: 'Fuber AI 2' },
    ...TIMEOUTS,
  };
  const client = new ImapFlow(options);
  // Dinleyicisi olmayan 'error' olayı (soket koptu, zaman aşımı) ana süreci düşürür; komut hataları ayrıca yakalanır.
  client.on('error', () => undefined);
  return client;
}

/** Oturumu her durumda kapatır (v1: boş kutuda `continue` LOGOUT'u atlıyor, bağlantı açık kalıyordu). */
async function closeClient(client: ImapFlow): Promise<void> {
  try {
    if (client.usable) await client.logout();
  } catch {
    // sunucu zaten kapattı
  }
  try {
    client.close();
  } catch {
    // kapalı
  }
}

function smtpTransport(endpoint: Endpoint) {
  const security = transportSecurity(endpoint.host, endpoint.port, 'smtp');
  return nodemailer.createTransport({
    host: endpoint.host,
    port: endpoint.port,
    secure: security === 'tls',
    requireTLS: security === 'starttls',
    ignoreTLS: security === 'plain',
    auth: { user: endpoint.username, pass: endpoint.password },
    logger: false,
    debug: false,
    ...TIMEOUTS,
  });
}

export async function verifyImap(endpoint: Endpoint): Promise<void> {
  const client = imapClient(endpoint);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    lock.release();
  } finally {
    await closeClient(client);
  }
}

export async function verifySmtp(endpoint: Endpoint): Promise<void> {
  const transport = smtpTransport(endpoint);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export interface OutgoingMail {
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string | null;
}

/** Gönderir; sunucunun verdiği Message-ID döner. Alıcılar zaten ayrıştırılmış ve kullanıcıya gösterilmiş adreslerdir. */
export async function sendMail(endpoint: Endpoint, mail: OutgoingMail): Promise<{ messageId: string; accepted: string[] }> {
  const transport = smtpTransport(endpoint);
  try {
    const info = await transport.sendMail({
      from: { name: mail.from.name, address: mail.from.address },
      to: mail.to,
      ...(mail.cc.length ? { cc: mail.cc } : {}),
      subject: mail.subject,
      text: mail.text,
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      ...(mail.references ? { references: mail.references } : {}),
    });
    const accepted = ((info.accepted ?? []) as Array<string | { address: string }>).map((entry) => (typeof entry === 'string' ? entry : entry.address));
    return { messageId: String(info.messageId ?? ''), accepted };
  } finally {
    transport.close();
  }
}

// ───────────── ayrıştırma ─────────────

const firstAddress = (value: AddressObject | AddressObject[] | undefined): { name: string; address: string } => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  for (const group of list) for (const entry of group.value) if (entry.address) return { name: entry.name ?? '', address: entry.address.toLowerCase() };
  return { name: '', address: '' };
};
const addressText = (value: AddressObject | AddressObject[] | undefined): string => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((group) => group.value)
    .map((entry) => entry.address?.toLowerCase())
    .filter(Boolean)
    .join(', ');
};

const BULK_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|newsletter|bulten|bülten|news|marketing|kampanya|promo|notifications?|bildirim|mailer-daemon|postmaster|bounce)([._+-]|@)/i;

/** Toplu gönderim (bülten, reklam, otomatik bildirim) işaretleri: başlıklar ve gönderen adı. */
export function isBulk(headers: Map<string, unknown>, fromAddress: string): boolean {
  const header = (name: string) => {
    const value = headers.get(name);
    return typeof value === 'string' ? value : value && typeof value === 'object' && 'value' in value ? String((value as { value: unknown }).value) : value ? String(value) : '';
  };
  if (headers.has('list-unsubscribe') || headers.has('list-id')) return true;
  if (/bulk|list|junk/i.test(header('precedence'))) return true;
  const auto = header('auto-submitted');
  if (auto && !/^no$/i.test(auto.trim())) return true;
  return BULK_SENDER.test(fromAddress);
}

/** Ham iletiyi depoya girecek biçime çevirir. Ek içerikleri saklanmaz; yalnız ad, tür, boyut. */
export function toNewMessage(uid: number, parsed: ParsedMail, seen: boolean, truncatedSource = false): NewMessage {
  const from = firstAddress(parsed.from);
  const replyTo = firstAddress(parsed.replyTo);
  const text = parsed.text?.trim() ? parsed.text : parsed.html ? htmlToText(String(parsed.html)) : '';
  const body = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
  const attachments: Attachment[] = (parsed.attachments ?? [])
    .filter((attachment) => attachment.contentDisposition !== 'inline' || attachment.filename)
    .map((attachment, index) => ({ index: index + 1, name: attachment.filename || `ek-${index + 1}`, contentType: attachment.contentType || 'application/octet-stream', bytes: attachment.size ?? attachment.content?.length ?? 0 }));
  const references = Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references ?? null);
  return {
    uid,
    messageId: parsed.messageId ?? null,
    fromName: (from.name || '').trim(),
    fromAddress: from.address,
    replyTo: replyTo.address && replyTo.address !== from.address ? replyTo.address : null,
    to: addressText(parsed.to),
    cc: addressText(parsed.cc),
    subject: (parsed.subject ?? '').trim(),
    date: (parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : new Date()).toISOString(),
    body: body.slice(0, MAX_BODY_CHARS),
    truncated: truncatedSource || body.length > MAX_BODY_CHARS,
    seen,
    bulk: isBulk(parsed.headers, from.address),
    attachments,
    refs: [references, parsed.messageId].filter(Boolean).join(' ') || null,
  };
}

// ───────────── eşitleme ─────────────

export interface MailboxState {
  uidValidity: string | null;
  lastUid: number;
}

export interface FetchResult {
  uidValidity: string;
  /** Saklanan UIDVALIDITY farklıydı: eski UID'ler geçersiz, iletiler baştan (ilk eşitleme gibi) indi. */
  reset: boolean;
  messages: NewMessage[];
  /** Bilinen son iletilerin sunucudaki okundu bayrağı. */
  seen: Map<number, boolean>;
  /** Bu eşitlemede görülen en büyük UID (yeni ileti yoksa saklanan değer). */
  highestUid: number;
  /** Sınır yüzünden inmeyen yeni ileti kaldı mı. */
  more: boolean;
}

const sizeOf = (message: FetchMessageObject) => Number(message.size ?? 0);

export async function fetchMailbox(endpoint: Endpoint, state: MailboxState, signal?: AbortSignal): Promise<FetchResult> {
  const client = imapClient(endpoint);
  const abort = () => void closeClient(client);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const mailbox = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null;
      const uidValidity = String(mailbox?.uidValidity ?? '0');
      const exists = Number(mailbox?.exists ?? 0);
      const reset = state.uidValidity !== null && state.uidValidity !== uidValidity;
      const lastUid = reset ? 0 : state.lastUid;
      const result: FetchResult = { uidValidity, reset, messages: [], seen: new Map(), highestUid: lastUid, more: false };
      if (!exists) return result;

      // 1) Yalnız UID, bayrak, boyut. İlk eşitlemede son INITIAL_COUNT ileti (sıra numarasıyla); sonra yalnız yeni UID'ler.
      //    `UID FETCH n:*` hiç yeni ileti yokken de en büyük UID'li iletiyi döndürür (IMAP kuralı): `> lastUid` süzgeci şart.
      const fresh: FetchMessageObject[] = [];
      if (lastUid === 0) {
        for await (const message of client.fetch(`${Math.max(1, exists - INITIAL_COUNT + 1)}:*`, { uid: true, flags: true, size: true })) fresh.push(message);
      } else {
        for await (const message of client.fetch(`${lastUid + 1}:*`, { uid: true, flags: true, size: true }, { uid: true })) if (message.uid > lastUid) fresh.push(message);
        for await (const message of client.fetch(`${Math.max(1, lastUid - SEEN_WINDOW)}:${lastUid}`, { uid: true, flags: true }, { uid: true })) {
          result.seen.set(message.uid, Boolean(message.flags?.has('\\Seen')));
        }
      }
      fresh.sort((a, b) => a.uid - b.uid);
      // Sınır: en eski yeni iletilerden başlanır ki `lastUid` boşluk bırakmadan ilerlesin; kalan sonraki eşitlemede.
      const take = fresh.slice(0, BATCH_LIMIT);
      result.more = fresh.length > take.length;
      if (!take.length) return result;
      result.highestUid = take[take.length - 1]!.uid;

      // 2) Kaynak yalnız yeni iletiler için (ilk döngü bittikten sonra: imapflow'da fetch sürerken başka komut bekler).
      const small = take.filter((message) => sizeOf(message) <= MAX_SOURCE_BYTES).map((message) => message.uid);
      const large = take.filter((message) => sizeOf(message) > MAX_SOURCE_BYTES).map((message) => message.uid);
      const sources = new Map<number, Buffer>();
      if (small.length) for await (const message of client.fetch(small.join(','), { uid: true, source: true }, { uid: true })) if (message.source) sources.set(message.uid, message.source);
      if (large.length) for await (const message of client.fetch(large.join(','), { uid: true, headers: true }, { uid: true })) if (message.headers) sources.set(message.uid, message.headers);
      for (const message of take) {
        if (signal?.aborted) break;
        const source = sources.get(message.uid);
        if (!source) continue;
        try {
          const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
          result.messages.push(toNewMessage(message.uid, parsed, Boolean(message.flags?.has('\\Seen')), large.includes(message.uid)));
        } catch {
          // Ayrıştırılamayan ileti atlanır; UID yine ilerler (her eşitlemede yeniden denenmesin).
        }
      }
      return result;
    } finally {
      lock.release();
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await closeClient(client);
  }
}

/** Bir iletinin `index`. ekini (1'den) indirir. */
export async function fetchAttachment(endpoint: Endpoint, uid: number, index: number): Promise<{ name: string; contentType: string; data: Buffer } | null> {
  const client = imapClient(endpoint);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    let source: Buffer | undefined;
    try {
      for await (const message of client.fetch(String(uid), { uid: true, source: true }, { uid: true })) if (message.uid === uid) source = message.source;
    } finally {
      lock.release();
    }
    if (!source) return null;
    const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
    const list = (parsed.attachments ?? []).filter((attachment) => attachment.contentDisposition !== 'inline' || attachment.filename);
    const attachment = list[index - 1];
    if (!attachment) return null;
    return { name: attachment.filename || `ek-${index}`, contentType: attachment.contentType || 'application/octet-stream', data: attachment.content };
  } finally {
    await closeClient(client);
  }
}
