// Sahibi: T2. `chat.*` kanalları: yazılı sohbet. Yanıt `chat.stream` olaylarıyla akar.
import { CHAT_ROLE, t, UserError, type ChatStreamEvent, type Id } from '@fuber/shared';
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, services) => {
  const { conversation, bus, log } = services;
  /** Oturum başına süren yanıtın iptal anahtarı. */
  const running = new Map<Id, AbortController>();
  /**
   * Sohbet açıldı: konuşan beyin Claude Code ise yazılı sohbetin süreci önceden ısıtılır (el sıkışma + MCP; model
   * çağrısı ve kota harcaması yok), ilk ileti soğuk açılışı ödemesin. Başka beyinde bir şey yapılmaz.
   */
  const warmChat = () => {
    try {
      if (services.brain.status().cloud?.provider === 'claude-code') void services.brain.prewarm(CHAT_ROLE).catch(() => undefined);
    } catch {
      // beyin hazır değilse ısıtma atlanır
    }
  };

  ipc.handleAll({
    'chat.send': ({ sessionId, text, attachmentIds }) => {
      const message = text.trim();
      const attachments = Array.isArray(attachmentIds) ? attachmentIds.filter((id) => typeof id === 'string' && id).slice(0, 6) : [];
      if (!message && attachments.length === 0) throw new UserError('Boş ileti gönderilemez.');
      const session = sessionId ? sessionId : conversation.createSession('chat').id;
      running.get(session)?.abort();
      const controller = new AbortController();
      running.set(session, controller);

      let started: Extract<ChatStreamEvent, { kind: 'start' }> | null = null;
      const off = bus.on('chat.stream', (event) => {
        if (event.kind === 'start' && event.sessionId === session && !started) started = event;
      });
      // `turn` kullanıcı iletisini kaydedip `start`'ı ilk beklemeden önce eşzamanlı yayınlar.
      const turn = conversation.turn({
        sessionId: session,
        channel: 'chat',
        text: message,
        ...(attachments.length ? { attachmentIds: attachments } : {}),
        signal: controller.signal,
      });
      off();
      void turn
        .catch((error: unknown) => log.error('yazılı tur düştü', error))
        .finally(() => {
          if (running.get(session) === controller) running.delete(session);
        });
      const start = started as Extract<ChatStreamEvent, { kind: 'start' }> | null;
      if (!start) throw new UserError(t('common.unknownError'));
      return { sessionId: start.sessionId, userMessage: start.userMessage, messageId: start.messageId };
    },
    'chat.cancel': ({ sessionId }) => {
      running.get(sessionId)?.abort();
      return { ok: true };
    },
    'chat.sessions': ({ query, limit, offset }) =>
      conversation.sessions({ limit, ...(query ? { query } : {}), ...(offset ? { offset } : {}) }),
    'chat.history': ({ sessionId, limit, beforeId }) => {
      warmChat();
      return conversation.messages(sessionId, { limit, ...(beforeId ? { beforeId } : {}) });
    },
    'chat.search': ({ query, limit }) => conversation.search(query, limit),
    'chat.renameSession': ({ sessionId, title }) => {
      const session = conversation.renameSession(sessionId, title);
      if (!session) throw new UserError('Sohbet bulunamadı.');
      return session;
    },
    'chat.deleteSession': ({ sessionId }) => {
      running.get(sessionId)?.abort();
      if (!conversation.deleteSession(sessionId)) throw new UserError('Sohbet bulunamadı.');
      return { ok: true };
    },
  });
};
