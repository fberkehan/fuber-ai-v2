// E-posta deposu (modülün kendi tabloları, `mail_` önekli). Parola yalnız `mail_accounts.secret` sütununda ve yalnız
// işletim sisteminin şifreli deposuyla şifrelenmiş hâlde durur (`secrets.ts`); bu dosya onu hiç çözmez.
import { foldForSearch, ftsQuery, FTS_TOKENIZER, newId, type Id, type IsoDateTime, type Migration, type ScopedDb } from '@fuber/shared';
import type { MailAccountView, MailProviderId, MailQuery, MailQueryHit, MailSummary } from './types';

export const MAIL_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'hesaplar, iletiler, taslaklar, kişiler',
    up: `
    CREATE TABLE mail_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      username TEXT NOT NULL,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL,
      -- İşletim sisteminin şifreli deposuyla (safeStorage) şifrelenmiş parola, base64. Düz metin hiçbir zaman.
      secret TEXT,
      uid_validity TEXT,
      last_uid INTEGER NOT NULL DEFAULT 0,
      -- İlk eşitleme bitti mi: ilk eşitlemenin eski iletileri bildirim üretmez.
      initial_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_sync_at TEXT,
      last_error TEXT
    );
    CREATE UNIQUE INDEX mail_accounts_address ON mail_accounts (address);

    CREATE TABLE mail_messages (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      account_id TEXT NOT NULL,
      uid INTEGER NOT NULL,
      message_id TEXT,
      from_name TEXT NOT NULL,
      from_address TEXT NOT NULL,
      from_norm TEXT NOT NULL,
      reply_to TEXT,
      to_text TEXT NOT NULL,
      cc_text TEXT NOT NULL,
      subject TEXT NOT NULL,
      subject_norm TEXT NOT NULL,
      date TEXT NOT NULL,
      received_at TEXT NOT NULL,
      snippet TEXT NOT NULL,
      body TEXT NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0,
      seen INTEGER NOT NULL DEFAULT 0,
      -- Toplu gönderim (bülten, reklam, otomatik bildirim): önem puanı 2'yi geçemez.
      bulk INTEGER NOT NULL DEFAULT 0,
      importance INTEGER,
      reason TEXT,
      scored_by TEXT,
      notified INTEGER NOT NULL DEFAULT 0,
      attachments TEXT NOT NULL DEFAULT '[]',
      refs TEXT,
      UNIQUE (account_id, uid)
    );
    CREATE INDEX mail_messages_date ON mail_messages (date);
    CREATE INDEX mail_messages_account ON mail_messages (account_id, uid);
    CREATE VIRTUAL TABLE mail_messages_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");

    CREATE TABLE mail_drafts (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      account_id TEXT NOT NULL,
      to_text TEXT NOT NULL,
      cc_text TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      in_reply_to TEXT,
      refs TEXT,
      reply_to_message TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      sent_message_id TEXT
    );

    -- Kullanıcının yazıştığı kişiler (gönderdiği adresler): önem puanında "tanıdık" işareti.
    CREATE TABLE mail_contacts (
      address TEXT PRIMARY KEY,
      sent INTEGER NOT NULL DEFAULT 0,
      last_at TEXT NOT NULL
    );`,
  },
  {
    id: 2,
    name: 'yerel Thunderbird kaynağı: hesap türü + mbox imleçleri',
    up: `
    -- Hesap türü: 'imap' (varsayılan, parolalı IMAP/SMTP) ya da 'thunderbird' (parolasız yerel mbox kaynağı; eşitleme koşmaz).
    ALTER TABLE mail_accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'imap';

    -- Thunderbird'ün yerel klasöründen (indirdiği mbox dosyaları) okuma imleci: her dosya için nerede kaldık.
    CREATE TABLE mail_local_boxes (
      path TEXT PRIMARY KEY,        -- profil köküne göre göreli mbox yolu
      account TEXT NOT NULL,        -- üst klasör (hesap/sunucu) adı
      mailbox TEXT NOT NULL,        -- kutu adı (INBOX, Sent…)
      size INTEGER NOT NULL DEFAULT 0,
      mtime_ms REAL NOT NULL DEFAULT 0,
      last_offset INTEGER NOT NULL DEFAULT 0,
      last_message_id TEXT,
      updated_at TEXT NOT NULL
    );

    -- Yerel kaynağın isteğe bağlı özel profil kökü (otomatik bulunamazsa kullanıcı klasör seçerse).
    CREATE TABLE mail_local_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      root TEXT
    );`,
  },
];

/** Hesap türü: `imap` parolalı IMAP/SMTP · `thunderbird` parolasız yerel mbox kaynağı (eşitleme ve gönderim koşmaz). */
export type MailAccountKind = 'imap' | 'thunderbird';

export interface AccountRow {
  id: Id;
  provider: MailProviderId;
  kind: MailAccountKind;
  label: string;
  address: string;
  username: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  secret: string | null;
  uid_validity: string | null;
  last_uid: number;
  initial_done: number;
  created_at: IsoDateTime;
  last_sync_at: IsoDateTime | null;
  last_error: string | null;
}

/** Yerel Thunderbird kaynağı hesabının (tek satır) ayrılmış adresi; gerçek bir e-posta adresi değildir. */
export const LOCAL_ADDRESS = 'thunderbird-yerel';

export interface LocalBoxRow {
  path: string;
  account: string;
  mailbox: string;
  size: number;
  mtime_ms: number;
  last_offset: number;
  last_message_id: string | null;
  updated_at: IsoDateTime;
}

export interface Attachment {
  index: number;
  name: string;
  contentType: string;
  bytes: number;
}

export interface MessageRow {
  rid: number;
  id: Id;
  account_id: Id;
  uid: number;
  message_id: string | null;
  from_name: string;
  from_address: string;
  reply_to: string | null;
  to_text: string;
  cc_text: string;
  subject: string;
  date: IsoDateTime;
  received_at: IsoDateTime;
  snippet: string;
  body: string;
  truncated: number;
  seen: number;
  bulk: number;
  importance: number | null;
  reason: string | null;
  scored_by: string | null;
  notified: number;
  attachments: string;
  refs: string | null;
}

export interface DraftRow {
  rid: number;
  id: Id;
  account_id: Id;
  to_text: string;
  cc_text: string;
  subject: string;
  body: string;
  in_reply_to: string | null;
  refs: string | null;
  reply_to_message: Id | null;
  status: 'draft' | 'sent' | 'discarded';
  created_at: IsoDateTime;
  sent_at: IsoDateTime | null;
  sent_message_id: string | null;
}

export interface NewMessage {
  uid: number;
  messageId: string | null;
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
  to: string;
  cc: string;
  subject: string;
  date: IsoDateTime;
  body: string;
  truncated: boolean;
  seen: boolean;
  bulk: boolean;
  attachments: Attachment[];
  refs: string | null;
}

export const fromLabel = (row: Pick<MessageRow, 'from_name' | 'from_address'>) =>
  row.from_name && row.from_name !== row.from_address ? `${row.from_name} <${row.from_address}>` : row.from_address;

export const attachmentsOf = (row: Pick<MessageRow, 'attachments'>): Attachment[] => {
  try {
    const parsed = JSON.parse(row.attachments) as unknown;
    return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
  } catch {
    return [];
  }
};

export function toSummary(row: MessageRow): MailSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    from: fromLabel(row),
    fromAddress: row.from_address,
    subject: row.subject,
    date: row.date,
    snippet: row.snippet,
    seen: row.seen === 1,
    importance: row.importance,
    reason: row.reason,
    attachments: attachmentsOf(row).length,
  };
}

export function toHit(row: MessageRow): MailQueryHit {
  return {
    id: row.id,
    accountId: row.account_id,
    from: fromLabel(row),
    fromAddress: row.from_address,
    subject: row.subject,
    date: row.date,
    receivedAt: row.received_at,
    seen: row.seen === 1,
    importance: row.importance,
  };
}

export interface ListFilter {
  accountId?: Id | undefined;
  unreadOnly?: boolean | undefined;
  from?: string | undefined;
  subject?: string | undefined;
  text?: string | undefined;
  /** Bu andan sonra (ileti tarihi ya da görülme anı). */
  since?: IsoDateTime | undefined;
  /** Bu andan önce (ileti tarihi). */
  until?: IsoDateTime | undefined;
  minImportance?: number | undefined;
  limit?: number | undefined;
}

export type MailRepo = ReturnType<typeof createMailRepo>;

export function createMailRepo(db: ScopedDb, now: () => Date = () => new Date()) {
  const accountView = (row: AccountRow): MailAccountView => {
    const counts = db.get<{ total: number; unread: number }>(
      'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END), 0) AS unread FROM mail_messages WHERE account_id = ?',
      [row.id],
    ) ?? { total: 0, unread: 0 };
    return {
      id: row.id,
      provider: row.provider,
      kind: row.kind,
      label: row.label,
      address: row.address,
      username: row.username,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      hasPassword: Boolean(row.secret),
      createdAt: row.created_at,
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
      messageCount: Number(counts.total),
      unreadCount: Number(counts.unread),
    };
  };

  const deleteMessages = (where: string, params: Array<string | number>) => {
    const rows = db.all<{ rid: number }>(`SELECT rid FROM mail_messages WHERE ${where}`, params);
    for (const row of rows) db.run('DELETE FROM mail_messages_fts WHERE rowid = ?', [row.rid]);
    db.run(`DELETE FROM mail_messages WHERE ${where}`, params);
    return rows.length;
  };

  return {
    accounts: (): AccountRow[] => db.all<AccountRow>('SELECT * FROM mail_accounts ORDER BY created_at'),
    account: (id: Id): AccountRow | undefined => db.get<AccountRow>('SELECT * FROM mail_accounts WHERE id = ?', [id]),
    accountByAddress: (address: string): AccountRow | undefined =>
      db.get<AccountRow>('SELECT * FROM mail_accounts WHERE address = ?', [address.trim().toLowerCase()]),
    accountView,
    views: (): MailAccountView[] => db.all<AccountRow>('SELECT * FROM mail_accounts ORDER BY created_at').map(accountView),

    /** Hesabı ekler ya da günceller. `secret`: `undefined` dokunma · `null` sil · dize yeni şifreli değer. */
    upsertAccount(input: {
      id?: Id | undefined;
      provider: MailProviderId;
      label: string;
      address: string;
      username: string;
      imapHost: string;
      imapPort: number;
      smtpHost: string;
      smtpPort: number;
      secret: string | null | undefined;
    }): AccountRow {
      const id = input.id ?? newId();
      const existing = db.get<AccountRow>('SELECT * FROM mail_accounts WHERE id = ?', [id]);
      const address = input.address.trim().toLowerCase();
      if (existing) {
        db.run(
          `UPDATE mail_accounts SET provider = ?, label = ?, address = ?, username = ?, imap_host = ?, imap_port = ?, smtp_host = ?, smtp_port = ?,
             secret = CASE WHEN ? = 1 THEN ? ELSE secret END WHERE id = ?`,
          [input.provider, input.label, address, input.username, input.imapHost, input.imapPort, input.smtpHost, input.smtpPort, input.secret === undefined ? 0 : 1, input.secret ?? null, id],
        );
        // Sunucu değiştiyse eski UID'ler anlamsızdır: baştan ve bildirimsiz eşitlenir.
        if (existing.imap_host !== input.imapHost || existing.imap_port !== input.imapPort || existing.username !== input.username) {
          deleteMessages('account_id = ?', [id]);
          db.run('UPDATE mail_accounts SET uid_validity = NULL, last_uid = 0, initial_done = 0, last_sync_at = NULL, last_error = NULL WHERE id = ?', [id]);
        }
      } else {
        db.run(
          `INSERT INTO mail_accounts (id, provider, label, address, username, imap_host, imap_port, smtp_host, smtp_port, secret, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, input.provider, input.label, address, input.username, input.imapHost, input.imapPort, input.smtpHost, input.smtpPort, input.secret ?? null, now().toISOString()],
        );
      }
      return db.get<AccountRow>('SELECT * FROM mail_accounts WHERE id = ?', [id])!;
    },

    removeAccount(id: Id): void {
      db.transaction(() => {
        deleteMessages('account_id = ?', [id]);
        db.run('DELETE FROM mail_drafts WHERE account_id = ?', [id]);
        db.run('DELETE FROM mail_accounts WHERE id = ?', [id]);
      });
    },

    syncState(id: Id, state: { uidValidity?: string | null; lastUid?: number; initialDone?: boolean; lastSyncAt?: IsoDateTime; lastError?: string | null }): void {
      const sets: string[] = [];
      const params: Array<string | number | null> = [];
      if (state.uidValidity !== undefined) (sets.push('uid_validity = ?'), params.push(state.uidValidity));
      if (state.lastUid !== undefined) (sets.push('last_uid = ?'), params.push(state.lastUid));
      if (state.initialDone !== undefined) (sets.push('initial_done = ?'), params.push(state.initialDone ? 1 : 0));
      if (state.lastSyncAt !== undefined) (sets.push('last_sync_at = ?'), params.push(state.lastSyncAt));
      if (state.lastError !== undefined) (sets.push('last_error = ?'), params.push(state.lastError));
      if (!sets.length) return;
      db.run(`UPDATE mail_accounts SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    },

    /** UIDVALIDITY değişti: hesabın iletileri gider, sonraki eşitleme bildirimsiz baştan yapılır. */
    resetMailbox(id: Id, uidValidity: string): void {
      db.transaction(() => {
        deleteMessages('account_id = ?', [id]);
        db.run('UPDATE mail_accounts SET uid_validity = ?, last_uid = 0, initial_done = 0 WHERE id = ?', [uidValidity, id]);
      });
    },

    /** Yeni iletileri yazar; zaten olanı (aynı hesap + UID) atlar. Yazılanların satırları döner. */
    insertMessages(accountId: Id, messages: NewMessage[], snippetOf: (body: string) => string): MessageRow[] {
      const inserted: MessageRow[] = [];
      const receivedAt = now().toISOString();
      db.transaction(() => {
        for (const message of messages) {
          const id = newId();
          const result = db.run(
            `INSERT OR IGNORE INTO mail_messages (id, account_id, uid, message_id, from_name, from_address, from_norm, reply_to, to_text, cc_text,
               subject, subject_norm, date, received_at, snippet, body, truncated, seen, bulk, attachments, refs)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              accountId,
              message.uid,
              message.messageId,
              message.fromName,
              message.fromAddress,
              foldForSearch(`${message.fromName} ${message.fromAddress}`),
              message.replyTo,
              message.to,
              message.cc,
              message.subject,
              foldForSearch(message.subject),
              message.date,
              receivedAt,
              snippetOf(message.body),
              message.body,
              message.truncated ? 1 : 0,
              message.seen ? 1 : 0,
              message.bulk ? 1 : 0,
              JSON.stringify(message.attachments),
              message.refs,
            ],
          );
          if (!result.changes) continue;
          db.run('INSERT INTO mail_messages_fts (rowid, norm) VALUES (?, ?)', [
            result.lastInsertRowid,
            foldForSearch(`${message.fromName} ${message.fromAddress} ${message.subject} ${message.body.slice(0, 20_000)}`),
          ]);
          inserted.push(db.get<MessageRow>('SELECT * FROM mail_messages WHERE id = ?', [id])!);
        }
      });
      return inserted;
    },

    /** Sunucudaki okundu bayrakları (yalnız değişenler yazılır). */
    updateSeen(accountId: Id, seen: Map<number, boolean>): number {
      let changed = 0;
      db.transaction(() => {
        for (const [uid, value] of seen) changed += db.run('UPDATE mail_messages SET seen = ? WHERE account_id = ? AND uid = ? AND seen != ?', [value ? 1 : 0, accountId, uid, value ? 1 : 0]).changes;
      });
      return changed;
    },

    setImportance(id: Id, importance: number, reason: string, by: 'rules' | 'model'): void {
      db.run('UPDATE mail_messages SET importance = ?, reason = ?, scored_by = ? WHERE id = ?', [importance, reason, by, id]);
    },
    markNotified(ids: Id[]): void {
      for (const id of ids) db.run('UPDATE mail_messages SET notified = 1 WHERE id = ?', [id]);
    },

    message: (id: Id): MessageRow | undefined => db.get<MessageRow>('SELECT * FROM mail_messages WHERE id = ?', [id]),

    /** Liste ve gözcü sorgusu: verilen süzgeçler VE ile bağlanır, yeniden eskiye. */
    list(filter: ListFilter): MessageRow[] {
      const where: string[] = ['1 = 1'];
      const params: Array<string | number> = [];
      if (filter.accountId) (where.push('m.account_id = ?'), params.push(filter.accountId));
      if (filter.unreadOnly) where.push('m.seen = 0');
      if (filter.from?.trim()) (where.push("m.from_norm LIKE ? ESCAPE '\\'"), params.push(`%${likeEscape(foldForSearch(filter.from.trim()))}%`));
      if (filter.subject?.trim()) (where.push("m.subject_norm LIKE ? ESCAPE '\\'"), params.push(`%${likeEscape(foldForSearch(filter.subject.trim()))}%`));
      if (filter.since) (where.push('(m.date > ? OR m.received_at > ?)'), params.push(filter.since, filter.since));
      if (filter.until) (where.push('m.date < ?'), params.push(filter.until));
      if (filter.minImportance !== undefined) (where.push('m.importance >= ?'), params.push(filter.minImportance));
      const limit = Math.min(Math.max(1, filter.limit ?? 20), 200);
      const match = filter.text?.trim() ? ftsQuery(filter.text) : null;
      if (filter.text?.trim() && !match) return [];
      if (match) {
        return db.all<MessageRow>(
          `SELECT m.* FROM mail_messages_fts f JOIN mail_messages m ON m.rid = f.rowid
           WHERE mail_messages_fts MATCH ? AND ${where.join(' AND ')} ORDER BY m.date DESC LIMIT ?`,
          [match, ...params, limit],
        );
      }
      return db.all<MessageRow>(`SELECT m.* FROM mail_messages m WHERE ${where.join(' AND ')} ORDER BY m.date DESC LIMIT ?`, [...params, limit]);
    },

    /** Son `days` günün okunmamış önemli iletileri (Bugün kartı, sabah özeti). */
    important(limit: number, days: number): MessageRow[] {
      const since = new Date(now().getTime() - days * 86_400_000).toISOString();
      return db.all<MessageRow>(
        'SELECT * FROM mail_messages WHERE seen = 0 AND importance >= 4 AND (date > ? OR received_at > ?) ORDER BY importance DESC, date DESC LIMIT ?',
        [since, since, limit],
      );
    },

    /** Bilinen kişi: kullanıcının daha önce e-posta gönderdiği adres. */
    isContact: (address: string): boolean => Boolean(db.get('SELECT 1 FROM mail_contacts WHERE address = ? AND sent > 0', [address.toLowerCase()])),
    addContacts(addresses: string[]): void {
      const at = now().toISOString();
      for (const address of addresses) {
        db.run('INSERT INTO mail_contacts (address, sent, last_at) VALUES (?, 1, ?) ON CONFLICT(address) DO UPDATE SET sent = sent + 1, last_at = excluded.last_at', [address.toLowerCase(), at]);
      }
    },

    createDraft(input: Omit<DraftRow, 'rid' | 'id' | 'status' | 'created_at' | 'sent_at' | 'sent_message_id'>): DraftRow {
      const id = newId();
      db.run(
        `INSERT INTO mail_drafts (id, account_id, to_text, cc_text, subject, body, in_reply_to, refs, reply_to_message, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [id, input.account_id, input.to_text, input.cc_text, input.subject, input.body, input.in_reply_to, input.refs, input.reply_to_message, now().toISOString()],
      );
      return db.get<DraftRow>('SELECT * FROM mail_drafts WHERE id = ?', [id])!;
    },
    draft: (id: Id): DraftRow | undefined => db.get<DraftRow>('SELECT * FROM mail_drafts WHERE id = ?', [id]),
    draftByNumber: (rid: number): DraftRow | undefined => db.get<DraftRow>('SELECT * FROM mail_drafts WHERE rid = ?', [rid]),
    messageByNumber: (rid: number): MessageRow | undefined => db.get<MessageRow>('SELECT * FROM mail_messages WHERE rid = ?', [rid]),
    /** Aynı iletiye kısa süre önce açılmış ve gönderilmemiş taslak (yineleme isteğinde ikinci taslak açılmasın). */
    recentDraftFor(messageId: Id, withinMs: number): DraftRow | undefined {
      const since = new Date(now().getTime() - withinMs).toISOString();
      return db.get<DraftRow>("SELECT * FROM mail_drafts WHERE reply_to_message = ? AND status = 'draft' AND created_at > ? ORDER BY created_at DESC LIMIT 1", [messageId, since]);
    },
    updateDraftBody(id: Id, body: string, subject?: string): void {
      if (subject !== undefined) db.run('UPDATE mail_drafts SET body = ?, subject = ? WHERE id = ?', [body, subject, id]);
      else db.run('UPDATE mail_drafts SET body = ? WHERE id = ?', [body, id]);
    },
    markDraftSent(id: Id, messageId: string): void {
      db.run("UPDATE mail_drafts SET status = 'sent', sent_at = ?, sent_message_id = ? WHERE id = ?", [now().toISOString(), messageId, id]);
    },

    // ───────────── yerel Thunderbird kaynağı ─────────────

    /** Yerel mbox kaynağının hesap satırı (kind = 'thunderbird'); yoksa undefined. */
    localAccount: (): AccountRow | undefined => db.get<AccountRow>("SELECT * FROM mail_accounts WHERE kind = 'thunderbird' LIMIT 1"),

    /** Yerel kaynak hesabını oluşturur (parolasız, sunucusuz); zaten varsa onu döner. */
    ensureLocalAccount(label: string): AccountRow {
      const existing = db.get<AccountRow>("SELECT * FROM mail_accounts WHERE kind = 'thunderbird' LIMIT 1");
      if (existing) return existing;
      const id = newId();
      db.run(
        `INSERT INTO mail_accounts (id, provider, kind, label, address, username, imap_host, imap_port, smtp_host, smtp_port, secret, created_at)
         VALUES (?, 'custom', 'thunderbird', ?, ?, '', '', 0, '', 0, NULL, ?)`,
        [id, label, LOCAL_ADDRESS, now().toISOString()],
      );
      return db.get<AccountRow>('SELECT * FROM mail_accounts WHERE id = ?', [id])!;
    },

    /** Yerel kaynağı tümüyle kaldırır: hesap, iletileri, taslakları ve mbox imleçleri. */
    removeLocalAccount(): void {
      const row = db.get<AccountRow>("SELECT * FROM mail_accounts WHERE kind = 'thunderbird' LIMIT 1");
      db.transaction(() => {
        if (row) {
          deleteMessages('account_id = ?', [row.id]);
          db.run('DELETE FROM mail_drafts WHERE account_id = ?', [row.id]);
          db.run('DELETE FROM mail_accounts WHERE id = ?', [row.id]);
        }
        db.run('DELETE FROM mail_local_boxes');
      });
    },

    localCursor: (path: string): LocalBoxRow | undefined => db.get<LocalBoxRow>('SELECT * FROM mail_local_boxes WHERE path = ?', [path]),
    saveLocalCursor(path: string, account: string, mailbox: string, cursor: { size: number; mtimeMs: number; lastOffset: number; lastMessageId: string | null }): void {
      db.run(
        `INSERT INTO mail_local_boxes (path, account, mailbox, size, mtime_ms, last_offset, last_message_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET account = excluded.account, mailbox = excluded.mailbox, size = excluded.size,
           mtime_ms = excluded.mtime_ms, last_offset = excluded.last_offset, last_message_id = excluded.last_message_id, updated_at = excluded.updated_at`,
        [path, account, mailbox, cursor.size, cursor.mtimeMs, cursor.lastOffset, cursor.lastMessageId, now().toISOString()],
      );
    },

    /** Kullanıcının seçtiği özel profil kökü (otomatik bulunamazsa); yoksa null. */
    localRoot: (): string | null => db.get<{ root: string | null }>('SELECT root FROM mail_local_config WHERE id = 1')?.root ?? null,
    setLocalRoot(root: string | null): void {
      db.run('INSERT INTO mail_local_config (id, root) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET root = excluded.root', [root]);
    },

    /** Saklama: en çok `keepDays` gün ve hesap başına `keepCount` ileti. Yerel (Thunderbird) arşiv iletileri tarihe göre SİLİNMEZ. */
    prune(keepDays: number, keepCount: number): number {
      const before = new Date(now().getTime() - keepDays * 86_400_000).toISOString();
      let removed = deleteMessages(
        "date < ? AND received_at < ? AND account_id NOT IN (SELECT id FROM mail_accounts WHERE kind = 'thunderbird')",
        [before, before],
      );
      for (const account of db.all<{ id: Id }>('SELECT id FROM mail_accounts')) {
        const cut = db.get<{ date: string }>('SELECT date FROM mail_messages WHERE account_id = ? ORDER BY date DESC LIMIT 1 OFFSET ?', [account.id, keepCount]);
        if (cut) removed += deleteMessages('account_id = ? AND date <= ?', [account.id, cut.date]);
      }
      db.run("DELETE FROM mail_drafts WHERE status != 'draft' AND created_at < ?", [before]);
      return removed;
    },

    /** Bütün veri (modül "verimi sil"). */
    purgeAll(): void {
      db.transaction(() => {
        db.run('DELETE FROM mail_messages_fts');
        db.run('DELETE FROM mail_messages');
        db.run('DELETE FROM mail_drafts');
        db.run('DELETE FROM mail_contacts');
        db.run('DELETE FROM mail_accounts');
      });
    },
  };
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Gözcü sorgusu → liste süzgeci. */
export function queryFilter(query: MailQuery): ListFilter {
  return {
    accountId: query.accountId,
    unreadOnly: query.unreadOnly,
    from: query.from,
    subject: query.subject,
    text: query.text,
    since: query.since,
    minImportance: query.minImportance,
    limit: Math.min(Math.max(1, query.limit ?? 20), 50),
  };
}
