// SINAMA İÇİN sahte IMAP ve SMTP sunucuları (yalnız 127.0.0.1, şifresiz). Birim testleri (vitest) ve uçtan uca sınama
// (`scripts/e2e/mail.mjs`, Node'un tip ayıklamasıyla doğrudan) kullanır; uygulama demetine girmez. Gerçek bir e-posta
// hesabına hiç bağlanılmaz. IMAP tarafı imapflow'un konuştuğu alt kümeyi uygular (CAPABILITY, LOGIN, EXAMINE/SELECT,
// FETCH/UID FETCH: UID, FLAGS, RFC822.SIZE, BODY.PEEK[], BODY.PEEK[HEADER]; LOGOUT) ve gerçek sunucuların bir tuzağını da
// taklit eder: `UID FETCH n:*` hiç yeni ileti yokken en büyük UID'li iletiyi döndürür.
import net from 'node:net';

export interface FakeImapMessage {
  uid: number;
  raw: string;
  seen: boolean;
}

export interface FakeImap {
  host: string;
  port: number;
  messages: FakeImapMessage[];
  /** Kutuya ileti ekler; UID döner. */
  add(raw: string, options?: { seen?: boolean }): number;
  setSeen(uid: number, seen: boolean): void;
  /** UIDVALIDITY'yi değiştirir (kutu yeniden kurulmuş gibi). */
  setUidValidity(value: number): void;
  logins: { ok: number; failed: number };
  /** Gelen komutların adları (LOGIN argümanları KAYDEDİLMEZ). */
  commands: string[];
  close(): Promise<void>;
}

export interface FakeSmtpMail {
  from: string;
  to: string[];
  data: string;
}

export interface FakeSmtp {
  host: string;
  port: number;
  received: FakeSmtpMail[];
  auths: { ok: number; failed: number };
  close(): Promise<void>;
}

const CRLF = '\r\n';

/** IMAP argümanları: atom, "tırnaklı", {n} değişmez (önceden çözülmüş), (liste) düz metin olarak. */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === ' ') {
      i++;
      continue;
    }
    if (ch === '"') {
      let value = '';
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') i++;
        value += line[i] ?? '';
        i++;
      }
      i++;
      out.push(value);
      continue;
    }
    if (ch === '(' || ch === '[') {
      const close = ch === '(' ? ')' : ']';
      let depth = 0;
      let j = i;
      for (; j < line.length; j++) {
        if (line[j] === ch) depth++;
        else if (line[j] === close && --depth === 0) break;
      }
      out.push(line.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let j = i;
    let depth = 0;
    while (j < line.length && (line[j] !== ' ' || depth > 0)) {
      if (line[j] === '[' || line[j] === '(') depth++;
      if (line[j] === ']' || line[j] === ')') depth--;
      j++;
    }
    out.push(line.slice(i, j));
    i = j;
  }
  return out;
}

function parseSet(set: string, max: number): (n: number) => boolean {
  const ranges = set.split(',').map((part) => {
    const [a, b] = part.split(':');
    const value = (text: string | undefined) => (text === '*' ? max : Number(text));
    const from = value(a);
    const to = b === undefined ? from : value(b);
    return [Math.min(from, to), Math.max(from, to)] as const;
  });
  return (n) => ranges.some(([from, to]) => n >= from && n <= to);
}

export async function startFakeImap(options: { user: string; password: string; uidValidity?: number }): Promise<FakeImap> {
  const messages: FakeImapMessage[] = [];
  let uidValidity = options.uidValidity ?? 1700000000;
  let nextUid = 1;
  const logins = { ok: 0, failed: 0 };
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let authed = false;
    let buffer = Buffer.alloc(0);
    let pending: { line: string; need: number; parts: string[] } | null = null;
    const write = (text: string | Buffer) => {
      if (!socket.destroyed) socket.write(text);
    };
    write(`* OK [CAPABILITY IMAP4rev1 UIDPLUS] Sahte IMAP hazir${CRLF}`);

    const handle = (line: string) => {
      const [tag = '*', rawCommand = '', ...args] = tokenize(line);
      let command = rawCommand.toUpperCase();
      let uidMode = false;
      if (command === 'UID') {
        uidMode = true;
        command = `${(args.shift() ?? '').toUpperCase()}`;
      }
      commands.push(uidMode ? `UID ${command}` : command);
      const ok = (text = 'tamam') => write(`${tag} OK ${text}${CRLF}`);
      switch (command) {
        case 'CAPABILITY':
          write(`* CAPABILITY IMAP4rev1 UIDPLUS${CRLF}`);
          return ok();
        case 'NOOP':
        case 'CHECK':
          return ok();
        case 'ID':
          write(`* ID NIL${CRLF}`);
          return ok();
        case 'LOGIN': {
          if (args[0] === options.user && args[1] === options.password) {
            authed = true;
            logins.ok++;
            return ok('[CAPABILITY IMAP4rev1 UIDPLUS] giris tamam');
          }
          logins.failed++;
          return write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials${CRLF}`);
        }
        case 'LOGOUT':
          write(`* BYE gule gule${CRLF}`);
          ok();
          socket.end();
          return;
        case 'LIST':
        case 'LSUB':
          if (!authed) return write(`${tag} NO giris yok${CRLF}`);
          if (args[1] === '' || args[1] === '""') write(`* ${command} (\\Noselect) "/" ""${CRLF}`);
          else write(`* ${command} (\\HasNoChildren) "/" INBOX${CRLF}`);
          return ok();
        case 'SELECT':
        case 'EXAMINE': {
          if (!authed) return write(`${tag} NO giris yok${CRLF}`);
          if (String(args[0]).toUpperCase() !== 'INBOX') return write(`${tag} NO kutu yok${CRLF}`);
          write(`* ${messages.length} EXISTS${CRLF}* 0 RECENT${CRLF}* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)${CRLF}`);
          write(`* OK [PERMANENTFLAGS ()] salt okunur${CRLF}* OK [UIDVALIDITY ${uidValidity}] uid${CRLF}* OK [UIDNEXT ${nextUid}] sonraki${CRLF}`);
          return ok(command === 'EXAMINE' ? '[READ-ONLY] tamam' : '[READ-WRITE] tamam');
        }
        case 'CLOSE':
        case 'UNSELECT':
          return ok();
        case 'FETCH': {
          if (!authed) return write(`${tag} NO giris yok${CRLF}`);
          const set = args[0] ?? '';
          const items = (args.slice(1).join(' ') || '').toUpperCase();
          const maxUid = messages.length ? messages[messages.length - 1]!.uid : 0;
          const inSet = parseSet(set, uidMode ? maxUid : messages.length);
          messages.forEach((message, index) => {
            const seq = index + 1;
            if (!(uidMode ? inSet(message.uid) : inSet(seq))) return;
            const parts: Array<string | Buffer> = [`UID ${message.uid}`];
            if (items.includes('FLAGS')) parts.push(`FLAGS (${message.seen ? '\\Seen' : ''})`);
            if (items.includes('RFC822.SIZE')) parts.push(`RFC822.SIZE ${Buffer.byteLength(message.raw)}`);
            if (items.includes('INTERNALDATE')) parts.push(`INTERNALDATE "01-Jan-2026 00:00:00 +0000"`);
            const literal = (name: string, body: string) => {
              const bytes = Buffer.from(body, 'utf8');
              return Buffer.concat([Buffer.from(`${name} {${bytes.length}}${CRLF}`), bytes]);
            };
            if (items.includes('BODY.PEEK[HEADER]') || items.includes('BODY[HEADER]')) {
              const end = message.raw.indexOf('\r\n\r\n');
              parts.push(literal('BODY[HEADER]', end >= 0 ? message.raw.slice(0, end + 4) : message.raw));
            } else if (items.includes('BODY.PEEK[]') || items.includes('BODY[]') || items.includes('RFC822')) {
              parts.push(literal('BODY[]', message.raw));
            }
            const chunks: Buffer[] = [Buffer.from(`* ${seq} FETCH (`)];
            parts.forEach((part, i) => {
              if (i) chunks.push(Buffer.from(' '));
              chunks.push(typeof part === 'string' ? Buffer.from(part) : part);
            });
            chunks.push(Buffer.from(`)${CRLF}`));
            write(Buffer.concat(chunks));
          });
          return ok('fetch tamam');
        }
        case 'SEARCH':
          write(`* SEARCH${CRLF}`);
          return ok();
        default:
          return write(`${tag} BAD bilinmeyen komut${CRLF}`);
      }
    };

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      for (;;) {
        if (pending && pending.need > 0) {
          if (buffer.length < pending.need) return;
          pending.parts.push(`"${buffer.subarray(0, pending.need).toString('utf8').replace(/["\\]/g, (ch) => `\\${ch}`)}"`);
          buffer = buffer.subarray(pending.need);
          pending.need = 0;
          // Değişmezden sonra satırın devamı gelir.
        }
        const end = buffer.indexOf(CRLF);
        if (end < 0) return;
        const line = buffer.subarray(0, end).toString('utf8');
        buffer = buffer.subarray(end + 2);
        const literal = /\{(\d+)\+?\}$/.exec(line);
        const head = literal ? line.slice(0, literal.index) : line;
        if (pending) {
          pending.parts.push(head);
          if (literal) {
            pending.need = Number(literal[1]);
            if (!literal[0].includes('+')) write(`+ devam${CRLF}`);
            continue;
          }
          const full = pending.parts.join('');
          pending = null;
          handle(full);
          continue;
        }
        if (literal) {
          pending = { line, need: Number(literal[1]), parts: [head] };
          if (!literal[0].includes('+')) write(`+ devam${CRLF}`);
          continue;
        }
        handle(line);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    host: '127.0.0.1',
    port,
    messages,
    add(raw, opts = {}) {
      const uid = nextUid++;
      messages.push({ uid, raw: raw.replace(/\r?\n/g, CRLF), seen: Boolean(opts.seen) });
      return uid;
    },
    setSeen(uid, seen) {
      const message = messages.find((item) => item.uid === uid);
      if (message) message.seen = seen;
    },
    setUidValidity(value) {
      uidValidity = value;
    },
    logins,
    commands,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

export async function startFakeSmtp(options: { user: string; password: string }): Promise<FakeSmtp> {
  const received: FakeSmtpMail[] = [];
  const auths = { ok: 0, failed: 0 };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let authed = false;
    let state: 'cmd' | 'data' | 'authPlain' | 'authUser' | 'authPass' = 'cmd';
    let loginUser = '';
    let from = '';
    let to: string[] = [];
    let data: string[] = [];
    let buffer = '';
    const reply = (text: string) => {
      if (!socket.destroyed) socket.write(`${text}${CRLF}`);
    };
    const checkAuth = (user: string, pass: string) => {
      if (user === options.user && pass === options.password) {
        authed = true;
        auths.ok++;
        reply('235 2.7.0 giris tamam');
      } else {
        auths.failed++;
        reply('535 5.7.8 Authentication credentials invalid');
      }
      state = 'cmd';
    };
    const b64 = (text: string) => Buffer.from(text, 'base64').toString('utf8');
    reply('220 sahte.local ESMTP hazir');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end: number;
      while ((end = buffer.indexOf(CRLF)) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (state === 'data') {
          if (line === '.') {
            received.push({ from, to, data: data.join(CRLF) });
            from = '';
            to = [];
            data = [];
            state = 'cmd';
            reply(`250 2.0.0 Ok: kuyrukta ${received.length}`);
          } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        if (state === 'authPlain') {
          const [, user = '', pass = ''] = b64(line).split('\u0000');
          checkAuth(user, pass);
          continue;
        }
        if (state === 'authUser') {
          loginUser = b64(line);
          state = 'authPass';
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (state === 'authPass') {
          checkAuth(loginUser, b64(line));
          continue;
        }
        const [verb = '', ...rest] = line.split(' ');
        switch (verb.toUpperCase()) {
          case 'EHLO':
            reply('250-sahte.local merhaba');
            reply('250-AUTH PLAIN LOGIN');
            reply('250-8BITMIME');
            reply('250 SMTPUTF8');
            break;
          case 'HELO':
            reply('250 sahte.local');
            break;
          case 'AUTH': {
            const mechanism = (rest[0] ?? '').toUpperCase();
            if (mechanism === 'PLAIN') {
              if (rest[1]) {
                const [, user = '', pass = ''] = b64(rest[1]).split('\u0000');
                checkAuth(user, pass);
              } else {
                state = 'authPlain';
                reply('334 ');
              }
            } else if (mechanism === 'LOGIN') {
              if (rest[1]) {
                loginUser = b64(rest[1]);
                state = 'authPass';
                reply('334 UGFzc3dvcmQ6');
              } else {
                state = 'authUser';
                reply('334 VXNlcm5hbWU6');
              }
            } else reply('504 desteklenmiyor');
            break;
          }
          case 'MAIL':
            if (!authed) {
              reply('530 5.7.0 Authentication required');
              break;
            }
            from = /<([^>]*)>/.exec(line)?.[1] ?? '';
            reply('250 2.1.0 Ok');
            break;
          case 'RCPT':
            to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
            reply('250 2.1.5 Ok');
            break;
          case 'DATA':
            state = 'data';
            reply('354 bitirmek icin <CR><LF>.<CR><LF>');
            break;
          case 'RSET':
            from = '';
            to = [];
            reply('250 Ok');
            break;
          case 'NOOP':
            reply('250 Ok');
            break;
          case 'QUIT':
            reply('221 gule gule');
            socket.end();
            break;
          default:
            reply('502 bilinmeyen komut');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    host: '127.0.0.1',
    port,
    received,
    auths,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Sınama iletisi (RFC 5322, düz metin; isteğe bağlı başlıklar ve tek ek). */
export function buildRaw(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  date?: Date;
  messageId?: string;
  headers?: Record<string, string>;
  attachment?: { name: string; contentType: string; content: string };
}): string {
  const date = (input.date ?? new Date()).toUTCString().replace('GMT', '+0000');
  const encodedSubject = /[^\x20-\x7e]/.test(input.subject) ? `=?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=` : input.subject;
  const head = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    `Date: ${date}`,
    `Message-ID: ${input.messageId ?? `<${Math.random().toString(36).slice(2)}@sahte.local>`}`,
    'MIME-Version: 1.0',
    ...Object.entries(input.headers ?? {}).map(([key, value]) => `${key}: ${value}`),
  ];
  const text = Buffer.from(input.body, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  if (!input.attachment) {
    return [...head, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', text, ''].join('\r\n');
  }
  const boundary = `sinir-${Math.random().toString(36).slice(2)}`;
  const file = Buffer.from(input.attachment.content, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    text,
    `--${boundary}`,
    `Content-Type: ${input.attachment.contentType}; name="${input.attachment.name}"`,
    `Content-Disposition: attachment; filename="${input.attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    file,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
