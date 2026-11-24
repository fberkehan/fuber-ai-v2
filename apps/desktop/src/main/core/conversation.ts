// Sahibi: T2. Sesli ve yazılı turun ortak omurgası: oturumlar, kalıcı ve aranabilir döküm, bağlam penceresi, özet.
import {
  CHAT_EFFORT,
  CHAT_ROLE,
  foldForSearch,
  FTS_TOKENIZER,
  ftsQuery,
  makeSnippet,
  newId,
  nowIso,
  type AttachmentResolver,
  type BrainImage,
  type BrainMessage,
  type BrainResponse,
  type Channel,
  type ChatAttachment,
  type ChatMessage,
  type ChatSearchHit,
  type ChatSession,
  type ConversationApi,
  type Id,
  type Migration,
  type ServiceDeps,
  type SqlValue,
  type ToolCallSummary,
  type TurnRequest,
  type TurnResult,
} from '@fuber/shared';
import { z } from 'zod';
import { openTagStart, stripExpressionTags, stripKnownExpressionTags } from '../../worker/speech-tags';
import { asksRecentDetail, recallIntent } from './brain/local-intents';
import { dayLabel, doneNote, SUMMARY_OPEN } from './brain/prompt';

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'oturumlar ve döküm',
    up: `CREATE TABLE conversation_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      -- Pencereden düşen eski iletilerin özeti ve özetin kapsadığı son iletinin sırası.
      summary TEXT,
      summary_upto INTEGER
    );
    CREATE INDEX conversation_sessions_last ON conversation_sessions (channel, last_at);
    CREATE TABLE conversation_messages (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      channel TEXT NOT NULL,
      at TEXT NOT NULL,
      interrupted INTEGER NOT NULL DEFAULT 0,
      tool_calls TEXT NOT NULL DEFAULT '[]',
      -- Yanıt yerine hata cümlesi kaydedildiyse 1: kullanıcıya görünür ama modele geçmiş olarak gitmez.
      failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX conversation_messages_session ON conversation_messages (session_id, rid);
    CREATE VIRTUAL TABLE conversation_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");`,
  },
  {
    id: 2,
    name: 'ileti ekleri',
    // Kullanıcı iletisine eklenen dosyaların özeti (ChatAttachment[]); içerikleri belge modülündedir.
    up: `ALTER TABLE conversation_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`,
  },
];

/** Modele giden geçmiş: son bu kadar ileti; daha eskisi oturum özetiyle temsil edilir. */
export const HISTORY_WINDOW = 12;
/** Pencere dışına bu kadar yeni ileti taşınca özet yenilenir. */
const SUMMARY_STEP = 8;
/** Sesli oturum bu kadar sessizlikten sonra kapanır; sonraki söz yeni oturum açar. */
const VOICE_SESSION_GAP_MS = 30 * 60_000;
const CHAT_SESSION_GAP_MS = 6 * 60 * 60_000;
/**
 * Yeni açılmış bir oturumun İLK sözü "az önce ne söylemiştim?" ise yanıt bir önceki oturumdadır (sesli oturum 30 dk
 * sessizlikte kapanır; kullanıcı için konuşma aynı konuşmadır). Bir önceki oturum bu kadar yakınsa son iletileri o tura
 * geçmiş olarak verilir; daha eskisi "az önce" değildir.
 */
const RECENT_SESSION_MS = 3 * 60 * 60_000;
const RECENT_SESSION_TAIL = 4;

interface SessionRow {
  id: string;
  title: string;
  channel: string;
  started_at: string;
  last_at: string;
  message_count: number;
  summary: string | null;
  summary_upto: number | null;
}

interface MessageRow {
  rid: number;
  id: string;
  session_id: string;
  role: string;
  text: string;
  channel: string;
  at: string;
  interrupted: number;
  tool_calls: string;
  failed: number;
  attachments: string;
}

const toSession = (row: SessionRow): ChatSession => ({
  id: row.id,
  title: row.title,
  channel: row.channel as Channel,
  startedAt: row.started_at,
  lastAt: row.last_at,
  messageCount: row.message_count,
});

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role as ChatMessage['role'],
  text: row.text,
  channel: row.channel as Channel,
  at: row.at,
  interrupted: row.interrupted === 1,
  ...(row.failed === 1 ? { failed: true } : {}),
  toolCalls: JSON.parse(row.tool_calls) as ToolCallSummary[],
  ...attachmentsOf(row),
});

function parseAttachments(row: Pick<MessageRow, 'attachments'>): ChatAttachment[] {
  if (!row.attachments || row.attachments === '[]') return [];
  try {
    const list = JSON.parse(row.attachments) as ChatAttachment[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const attachmentsOf = (row: MessageRow): { attachments?: ChatAttachment[] } => {
  const list = parseAttachments(row);
  return list.length ? { attachments: list } : {};
};

/** Geçmişte eki olan ileti: içeriği yeniden gönderilmez, kimliğiyle anılır (model gerekirse belge aracıyla yeniden okur). */
function attachmentNote(list: ChatAttachment[]): string {
  if (!list.length) return '';
  return `\n(Bu iletiye eklenen dosyalar: ${list.map((item) => `${item.name} [attachment_id: ${item.id}]`).join(', ')})`;
}

/** Geçmiş penceresine giren ileti: metni ya da eki olan. */
const keepInHistory = (row: MessageRow) => Boolean(row.text.trim()) || parseAttachments(row).length > 0;

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || 'Yeni sohbet';
}

const SummarySchema = z.object({ summary: z.string() });

/** Bir turda BAŞARIYLA çalışan araçların adları (kayıttaki JSON'dan; bozuksa boş). */
function toolNamesDone(raw: string): string[] {
  try {
    const calls = JSON.parse(raw) as ToolCallSummary[];
    return [...new Set(calls.filter((call) => call.ok).map((call) => call.name))];
  } catch {
    return [];
  }
}

export function createConversation(deps: ServiceDeps['conversation']): ConversationApi {
  const log = deps.log.child('conversation');
  const db = deps.store.scoped('conversation');
  let ready = false;
  const summarizing = new Set<Id>();

  const ensure = () => {
    if (ready) return;
    deps.store.migrate('conversation', MIGRATIONS);
    ready = true;
  };

  const sessionRow = (id: Id) => db.get<SessionRow>('SELECT * FROM conversation_sessions WHERE id = ?', [id]);
  const messageRow = (id: Id) => db.get<MessageRow>('SELECT * FROM conversation_messages WHERE id = ?', [id]);

  const createSession = (channel: Channel, title?: string): ChatSession => {
    ensure();
    const at = nowIso();
    const id = newId();
    db.run(
      'INSERT INTO conversation_sessions (id, title, channel, started_at, last_at, message_count) VALUES (?, ?, ?, ?, ?, 0)',
      [id, title?.trim() || 'Yeni sohbet', channel, at, at],
    );
    deps.bus.emit('chat.changed', { entity: 'session', op: 'created', ids: [id] });
    return toSession(sessionRow(id)!);
  };

  /**
   * Ekrana ve döküme giden asistan metni: ifade etiketleri (`<laugh>`, `[laughs]`…) görünmez. Sesli turda bütün
   * yönergeler atılır (adadaki yazıyla aynı ayıklayıcı); yazılı sohbette yalnız tanınan ifadeler (Markdown korunur).
   * Seslendirme bundan etkilenmez: ses hattı cümleleri beyinden ham alır ve motoruna göre kendisi çevirir.
   */
  const displayText = (text: string, channel: Channel): string => (channel === 'voice' ? stripExpressionTags(text) : stripKnownExpressionTags(text));

  /**
   * Akışta parça parça gelen metni ekrana giden temiz parçalara çevirir. Yarım kalmış yönerge ("<lau") kapanana dek
   * tutulur; temizlenmiş metin öncekinin devamı değilse (ayıklama boşlukları birleştirdi) parça atlanır: tur bitince
   * giden tam ileti ekrandaki metnin yerini alır.
   */
  const cleanStream = (channel: Channel) => {
    let raw = '';
    let sent = '';
    return (delta: string): string => {
      raw += delta;
      const open = openTagStart(raw);
      const clean = displayText(open === -1 ? raw : raw.slice(0, open), channel).trimEnd();
      if (clean.length <= sent.length || !clean.startsWith(sent)) return '';
      const out = clean.slice(sent.length);
      sent = clean;
      return out;
    };
  };

  const insertMessage = (input: {
    sessionId: Id;
    role: 'user' | 'assistant';
    text: string;
    channel: Channel;
    interrupted?: boolean;
    toolCalls?: ToolCallSummary[];
    failed?: boolean;
    attachments?: ChatAttachment[];
    id?: Id;
  }): ChatMessage => {
    const id = input.id ?? newId();
    const at = nowIso();
    db.transaction(() => {
      const { lastInsertRowid } = db.run(
        `INSERT INTO conversation_messages (id, session_id, role, text, channel, at, interrupted, tool_calls, failed, attachments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.sessionId,
          input.role,
          input.text,
          input.channel,
          at,
          input.interrupted ? 1 : 0,
          JSON.stringify(input.toolCalls ?? []),
          input.failed ? 1 : 0,
          JSON.stringify(input.attachments ?? []),
        ],
      );
      db.run('INSERT INTO conversation_fts (rowid, norm) VALUES (?, ?)', [lastInsertRowid, foldForSearch(input.text)]);
      const session = sessionRow(input.sessionId);
      const title =
        session && session.message_count === 0 && input.role === 'user' && session.title === 'Yeni sohbet'
          ? titleFrom(input.text)
          : (session?.title ?? 'Yeni sohbet');
      db.run(
        'UPDATE conversation_sessions SET last_at = ?, message_count = message_count + 1, title = ? WHERE id = ?',
        [at, title, input.sessionId],
      );
    });
    // Oturumun ileti sayısı, son anı ve (ilk iletide) adı değişti: liste yenilensin.
    deps.bus.emit('chat.changed', { entity: 'session', op: 'updated', ids: [input.sessionId] });
    return toMessage(messageRow(id)!);
  };

  const currentSession = (channel: Channel): ChatSession => {
    ensure();
    const row = db.get<SessionRow>(
      'SELECT * FROM conversation_sessions WHERE channel = ? ORDER BY last_at DESC LIMIT 1',
      [channel],
    );
    const gap = channel === 'voice' ? VOICE_SESSION_GAP_MS : CHAT_SESSION_GAP_MS;
    if (row && Date.now() - Date.parse(row.last_at) < gap) return toSession(row);
    return createSession(channel);
  };

  /** Kayıtlı iletileri modele giden geçmişe çevirir; eskiye günü etiketlenir ki "dün yazılan yarın" doğru anlaşılsın. */
  const toHistory = (rows: MessageRow[]): BrainMessage[] => {
    const now = new Date();
    const history: BrainMessage[] = rows
      .filter(keepInHistory)
      .map((row) => {
        const label = row.role === 'user' ? dayLabel(new Date(row.at), now) : null;
        const suffix = row.interrupted === 1 ? ' (yanıt burada yarıda kesildi)' : '';
        // Geçmiş yalnız metindir; o turda hangi işin gerçekten yapıldığı notla taşınır ki model sonraki bir sözde
        // ("anlamadım", "tamam") aynı işi yeniden yapmasın (sınamada aynı hatırlatıcı üç kez kuruldu).
        const done = row.role === 'assistant' ? doneNote(toolNamesDone(row.tool_calls)) : '';
        return { role: row.role as 'user' | 'assistant', text: `${label ? `${label} ` : ''}${row.text}${suffix}${done}` };
      });
    rows.filter(keepInHistory).forEach((row, index) => {
      const note = attachmentNote(parseAttachments(row));
      if (note && history[index]) history[index].text += note;
    });
    return history;
  };

  /** Pencereye giren geçmiş (son `HISTORY_WINDOW` ileti + varsa oturum özeti). */
  const historyFor = (sessionId: Id, beforeRid: number): BrainMessage[] => {
    const session = sessionRow(sessionId);
    const history = toHistory(
      db
        .all<MessageRow>('SELECT * FROM conversation_messages WHERE session_id = ? AND rid < ? AND failed = 0 ORDER BY rid DESC LIMIT ?', [
          sessionId,
          beforeRid,
          HISTORY_WINDOW,
        ])
        .reverse(),
    );
    if (session?.summary) {
      // Özet tek paragraftır (içinde boş satır yok): beyin geçmişi kırparken paragrafı bütün olarak korur.
      const intro = `${SUMMARY_OPEN}${session.summary.replace(/\s*\n\s*/g, ' ')})`;
      const first = history[0];
      if (first?.role === 'user') first.text = `${intro}\n\n${first.text}`;
      else history.unshift({ role: 'user', text: intro });
    }
    return history;
  };

  /**
   * Bir önceki oturumun son iletileri (yakınsa): yeni oturumun ilk sözü az önce söyleneni soruyorsa geçmiş olarak
   * verilir. Aynı kanal yeğlenir (sesli soru sesli konuşmayı sorar); yoksa en son konuşulan oturum.
   */
  const previousSessionTail = (sessionId: Id, channel: Channel): BrainMessage[] => {
    const cutoff = new Date(Date.now() - RECENT_SESSION_MS).toISOString();
    const previous =
      db.get<SessionRow>('SELECT * FROM conversation_sessions WHERE id != ? AND channel = ? AND message_count > 0 AND last_at >= ? ORDER BY last_at DESC LIMIT 1', [sessionId, channel, cutoff]) ??
      db.get<SessionRow>('SELECT * FROM conversation_sessions WHERE id != ? AND message_count > 0 AND last_at >= ? ORDER BY last_at DESC LIMIT 1', [sessionId, cutoff]);
    if (!previous) return [];
    const rows = db
      .all<MessageRow>('SELECT * FROM conversation_messages WHERE session_id = ? AND failed = 0 ORDER BY rid DESC LIMIT ?', [previous.id, RECENT_SESSION_TAIL])
      .reverse();
    const history = toHistory(rows);
    // Geçmiş kullanıcı iletisiyle başlamalı (beyin baştaki asistan iletilerini atar).
    while (history[0] && history[0].role !== 'user') history.shift();
    return history;
  };

  /** Pencereden düşen iletileri `memory` rolüyle özetler; tur bittikten sonra arka planda koşar. */
  const maybeSummarize = async (sessionId: Id) => {
    if (summarizing.has(sessionId)) return;
    const session = sessionRow(sessionId);
    if (!session) return;
    const window = db.all<{ rid: number }>(
      'SELECT rid FROM conversation_messages WHERE session_id = ? AND failed = 0 ORDER BY rid DESC LIMIT ?',
      [sessionId, HISTORY_WINDOW + 1],
    );
    if (window.length <= HISTORY_WINDOW) return;
    const boundary = window[HISTORY_WINDOW - 1]!.rid;
    const covered = session.summary_upto ?? 0;
    const pending = db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM conversation_messages WHERE session_id = ? AND rid > ? AND rid < ? AND failed = 0',
      [sessionId, covered, boundary],
    )!.n;
    if (pending < SUMMARY_STEP && session.summary) return;
    summarizing.add(sessionId);
    try {
      const rows = db.all<MessageRow>(
        'SELECT * FROM conversation_messages WHERE session_id = ? AND rid > ? AND rid < ? AND failed = 0 ORDER BY rid',
        [sessionId, covered, boundary],
      );
      if (rows.length === 0) return;
      const transcript = rows.map((row) => `${row.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${row.text}`).join('\n');
      const result = await deps.brain.extract({
        role: 'memory',
        instructions:
          'Bir sohbetin eski kısmını, konuşma devam ederken bağlam olarak kullanılacak biçimde özetle. Kararları, verilen bilgileri, ' +
          'açık kalan işleri ve kullanıcının tercihlerini koru; selamlaşma ve tekrarları at. Türkçe, en çok 120 sözcük.',
        input: `${session.summary ? `Önceki özet: ${session.summary}\n\n` : ''}Yeni kısım:\n${transcript}`,
        schema: SummarySchema,
      });
      if (!result?.summary.trim()) return;
      const last = rows.at(-1)!;
      db.run('UPDATE conversation_sessions SET summary = ?, summary_upto = ? WHERE id = ?', [
        result.summary.trim(),
        last.rid,
        sessionId,
      ]);
    } catch (error) {
      log.warn('oturum özeti çıkarılamadı', error);
    } finally {
      summarizing.delete(sessionId);
    }
  };

  let attachmentResolver: AttachmentResolver | null = null;

  /** Eşzamanlı: iletiye yazılacak ek özetleri. Çözücü yoksa (belge modülü kapalı) ekler "okunamadı" olur. */
  const describeAttachments = (ids: Id[]): ChatAttachment[] => {
    const unreadable = (note: string) => ids.map((id): ChatAttachment => ({ id, name: 'ek', kind: 'document', bytes: 0, status: 'failed', note }));
    if (!attachmentResolver) return unreadable('Belge modülü kapalı.');
    try {
      return attachmentResolver.describe(ids);
    } catch (error) {
      log.warn('ekler okunamadı', error);
      return unreadable('Ek bilgisi okunamadı.');
    }
  };

  /** Modele gidecek ek metni; hata turu düşürmez, modele "okunamadı" diye söylenir. */
  const prepareAttachments = async (ids: Id[], request: TurnRequest, described: ChatAttachment[]) => {
    const failed = `(Kullanıcı ${ids.length} dosya ekledi ama okunamadı: ${described.map((item) => item.note ?? item.name).join('; ')} Bunu kullanıcıya açıkça söyle.)`;
    if (!attachmentResolver) return { text: failed, images: [] };
    try {
      return await attachmentResolver.prepare(ids, { text: request.text, channel: request.channel, ...(request.signal ? { signal: request.signal } : {}) });
    } catch (error) {
      log.warn('ekler hazırlanamadı', error);
      return { text: failed, images: [] };
    }
  };

  const api: ConversationApi = {
    useAttachmentResolver(resolver) {
      attachmentResolver = resolver;
      return () => {
        if (attachmentResolver === resolver) attachmentResolver = null;
      };
    },

    async turn(request) {
      ensure();
      const attachmentIds = [...new Set(request.attachmentIds ?? [])];
      const attachments = attachmentIds.length ? describeAttachments(attachmentIds) : [];
      let session: ChatSession;
      if (request.sessionId) {
        const row = sessionRow(request.sessionId);
        session = row ? toSession(row) : createSession(request.channel);
      } else {
        session = currentSession(request.channel);
      }
      const userMessage = insertMessage({
        sessionId: session.id,
        role: 'user',
        text: request.text,
        channel: request.channel,
        ...(attachments.length ? { attachments } : {}),
      });
      const messageId = newId();
      // `start` eşzamanlı yayınlanır: `chat.send` işleyicisi iletiyi buradan yakalayıp hemen döner.
      deps.bus.emit('chat.stream', { kind: 'start', sessionId: session.id, messageId, userMessage });

      let history = historyFor(session.id, messageRowRid(userMessage.id));
      // Oturumun ilk sözü "az önce ne söylemiştim / ne dedin?" ise bakılacak yer bir önceki (yakın) oturumdur.
      if (history.length === 0 && (recallIntent(request.text) !== null || asksRecentDetail(request.text))) {
        history = previousSessionTail(session.id, request.channel);
      }
      const role = request.role ?? (request.channel === 'voice' ? 'voice' : CHAT_ROLE);
      const effort = request.effort ?? (request.channel === 'chat' ? CHAT_EFFORT : undefined);
      const prepared = attachmentIds.length ? await prepareAttachments(attachmentIds, request, attachments) : null;

      const streamFilter = cleanStream(request.channel);
      let response: BrainResponse;
      try {
        response = await deps.brain.respond({
          role,
          ...(effort ? { effort } : {}),
          messages: [...history, userTurn(request.text, request.images, prepared)],
          origin: {
            channel: request.channel,
            sessionId: session.id,
            speakerVerified: request.speakerVerified ?? null,
          },
          ...(request.signal ? { signal: request.signal } : {}),
          onText(delta) {
            const shown = streamFilter(delta);
            if (shown) deps.bus.emit('chat.stream', { kind: 'text', sessionId: session.id, messageId, delta: shown });
            request.onText?.(delta);
          },
          onSentence: (sentence) => request.onSentence?.(sentence),
          onToolCall(event) {
            deps.bus.emit('chat.stream', {
              kind: 'tool',
              sessionId: session.id,
              messageId,
              callId: event.callId,
              name: event.name,
              phase: event.phase,
              ...(event.phase === 'end' ? { ok: event.ok } : {}),
              ...(event.phase === 'report' ? { step: event.step } : {}),
            });
            request.onToolCall?.(event);
          },
        });
      } catch (error) {
        // `respond` fırlatmaz; yine de bir hata turu yarım bırakmasın.
        log.error('tur beklenmedik biçimde düştü', error);
        response = {
          text: '',
          stopReason: 'error',
          error: 'Beklenmeyen bir sorun oluştu.',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 },
        };
      }

      const interrupted = response.stopReason === 'aborted';
      const failed = !response.text && response.stopReason !== 'aborted' && response.stopReason !== 'end';
      const assistantMessage = insertMessage({
        id: messageId,
        sessionId: session.id,
        role: 'assistant',
        text: failed ? (response.error ?? '') : displayText(response.text, request.channel),
        channel: request.channel,
        interrupted,
        toolCalls: response.toolCalls,
        failed,
      });
      if (failed) {
        deps.bus.emit('chat.stream', {
          kind: 'error',
          sessionId: session.id,
          messageId,
          error: response.error ?? 'Beklenmeyen bir sorun oluştu.',
        });
      }
      deps.bus.emit('chat.stream', { kind: 'done', sessionId: session.id, messageId, message: assistantMessage });
      deps.bus.emit('conversation.turn', {
        sessionId: session.id,
        channel: request.channel,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        interrupted,
      });
      void maybeSummarize(session.id);
      const result: TurnResult = { sessionId: session.id, userMessage, assistantMessage, response };
      return result;
    },

    amendMessage(id, patch) {
      ensure();
      const row = messageRow(id);
      if (!row) return null;
      const sets: string[] = [];
      const values: SqlValue[] = [];
      // Düzeltilen asistan metni (yarıda kesilen sesli yanıtın söylenen kısmı) de etiketsiz saklanır.
      const text = patch.text === undefined ? undefined : row.role === 'assistant' ? displayText(patch.text, row.channel as Channel) : patch.text;
      if (text !== undefined) {
        sets.push('text = ?');
        values.push(text);
      }
      if (patch.interrupted !== undefined) {
        sets.push('interrupted = ?');
        values.push(patch.interrupted ? 1 : 0);
      }
      if (sets.length === 0) return toMessage(row);
      db.transaction(() => {
        db.run(`UPDATE conversation_messages SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
        if (text !== undefined) {
          db.run('DELETE FROM conversation_fts WHERE rowid = ?', [row.rid]);
          db.run('INSERT INTO conversation_fts (rowid, norm) VALUES (?, ?)', [row.rid, foldForSearch(text)]);
        }
      });
      return toMessage(messageRow(id)!);
    },

    appendMessage(input) {
      ensure();
      return insertMessage(input);
    },

    createSession,
    currentSession,

    sessions(filter) {
      ensure();
      const conditions: string[] = [];
      const params: SqlValue[] = [];
      if (filter.channel) {
        conditions.push('channel = ?');
        params.push(filter.channel);
      }
      if (filter.query?.trim()) {
        conditions.push('title LIKE ?');
        params.push(`%${filter.query.trim()}%`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return db
        .all<SessionRow>(`SELECT * FROM conversation_sessions ${where} ORDER BY last_at DESC LIMIT ? OFFSET ?`, [
          ...params,
          filter.limit,
          filter.offset ?? 0,
        ])
        .map(toSession);
    },

    renameSession(id, title) {
      ensure();
      if (!sessionRow(id)) return null;
      db.run('UPDATE conversation_sessions SET title = ? WHERE id = ?', [titleFrom(title), id]);
      deps.bus.emit('chat.changed', { entity: 'session', op: 'updated', ids: [id] });
      return toSession(sessionRow(id)!);
    },

    deleteSession(id) {
      ensure();
      if (!sessionRow(id)) return false;
      db.transaction(() => {
        db.run(
          'DELETE FROM conversation_fts WHERE rowid IN (SELECT rid FROM conversation_messages WHERE session_id = ?)',
          [id],
        );
        db.run('DELETE FROM conversation_messages WHERE session_id = ?', [id]);
        db.run('DELETE FROM conversation_sessions WHERE id = ?', [id]);
      });
      deps.bus.emit('chat.changed', { entity: 'session', op: 'deleted', ids: [id] });
      return true;
    },

    messages(sessionId, options) {
      ensure();
      const before = options.beforeId ? messageRow(options.beforeId)?.rid : undefined;
      const rows = before
        ? db.all<MessageRow>(
            'SELECT * FROM conversation_messages WHERE session_id = ? AND rid < ? ORDER BY rid DESC LIMIT ?',
            [sessionId, before, options.limit],
          )
        : db.all<MessageRow>('SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY rid DESC LIMIT ?', [
            sessionId,
            options.limit,
          ]);
      return rows.reverse().map(toMessage);
    },

    search(query, limit) {
      ensure();
      const match = ftsQuery(query);
      if (!match) return [];
      const rows = db.all<MessageRow & { session_title: string }>(
        `SELECT m.*, s.title AS session_title FROM conversation_fts
           JOIN conversation_messages m ON m.rid = conversation_fts.rowid
           JOIN conversation_sessions s ON s.id = m.session_id
          WHERE conversation_fts MATCH ? ORDER BY bm25(conversation_fts), m.rid DESC LIMIT ?`,
        [match, limit],
      );
      return rows.map(
        (row): ChatSearchHit => ({
          message: toMessage(row),
          sessionTitle: row.session_title,
          snippet: makeSnippet(row.text, query),
        }),
      );
    },

    purge(olderThanDays) {
      ensure();
      const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
      return db.transaction(() => {
        db.run('DELETE FROM conversation_fts WHERE rowid IN (SELECT rid FROM conversation_messages WHERE at < ?)', [cutoff]);
        const { changes } = db.run('DELETE FROM conversation_messages WHERE at < ?', [cutoff]);
        db.run(
          `DELETE FROM conversation_sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM conversation_messages)`,
        );
        return changes;
      });
    },
  };

  function userTurn(text: string, images: TurnRequest['images'], prepared: { text: string; images: BrainImage[] } | null): BrainMessage {
    if (!prepared) return { role: 'user', text, ...(images ? { images } : {}) };
    const all = [...(images ?? []), ...prepared.images];
    const asked = text.trim() || '(Kullanıcı yalnız dosya ekledi, soru yazmadı: eklerin ne olduğunu kısaca söyle ve ne istediğini sor.)';
    const body = prepared.text ? `${asked}\n\n${prepared.text}` : asked;
    return { role: 'user', text: body, ...(all.length ? { images: all } : {}) };
  }

  function messageRowRid(id: Id): number {
    return messageRow(id)?.rid ?? Number.MAX_SAFE_INTEGER;
  }

  return api;
}
