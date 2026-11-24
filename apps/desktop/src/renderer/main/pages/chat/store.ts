// Sohbet akış deposu: pencere açıkken bütün `chat.stream` olaylarını toplar. Sayfa değişip geri gelindiğinde
// süren yanıt kaybolmasın diye React'in dışında, pencere başına tek kopya.
import type { ChatMessage, ChatStreamEvent, Id } from '@fuber/shared';

export interface ToolChip {
  callId: Id;
  name: string;
  phase: 'start' | 'report' | 'end';
  ok?: boolean;
  step?: string;
}

/** Süren (ya da az önce biten) asistan yanıtı. */
export interface Draft {
  messageId: Id;
  sessionId: Id;
  text: string;
  tools: ToolChip[];
  error: string | null;
}

interface State {
  /** Oturum başına, bu pencere açıkken gelen iletiler (geçmişin üstüne eklenir). */
  appended: Map<Id, ChatMessage[]>;
  drafts: Map<Id, Draft>;
  /** Hata turu olan asistan iletileri (sözleşmedeki `ChatMessage` hatayı taşımaz; raporda). */
  failed: Map<Id, string>;
  version: number;
}

const state: State = { appended: new Map(), drafts: new Map(), failed: new Map(), version: 0 };
const listeners = new Set<() => void>();

function emit() {
  state.version++;
  for (const listener of listeners) listener();
}

function push(sessionId: Id, message: ChatMessage) {
  const list = state.appended.get(sessionId) ?? [];
  if (list.some((item) => item.id === message.id)) {
    state.appended.set(sessionId, list.map((item) => (item.id === message.id ? message : item)));
  } else {
    state.appended.set(sessionId, [...list, message]);
  }
}

export function handleStream(event: ChatStreamEvent) {
  switch (event.kind) {
    case 'start':
      push(event.sessionId, event.userMessage);
      state.drafts.set(event.sessionId, { messageId: event.messageId, sessionId: event.sessionId, text: '', tools: [], error: null });
      break;
    case 'text': {
      const draft = state.drafts.get(event.sessionId);
      if (!draft || draft.messageId !== event.messageId) return;
      state.drafts.set(event.sessionId, { ...draft, text: draft.text + event.delta });
      break;
    }
    case 'tool': {
      const draft = state.drafts.get(event.sessionId);
      if (!draft || draft.messageId !== event.messageId) return;
      const chip: ToolChip = {
        callId: event.callId,
        name: event.name,
        phase: event.phase,
        ...(event.ok !== undefined ? { ok: event.ok } : {}),
        ...(event.step ? { step: event.step } : {}),
      };
      const exists = draft.tools.some((tool) => tool.callId === event.callId);
      state.drafts.set(event.sessionId, {
        ...draft,
        tools: exists ? draft.tools.map((tool) => (tool.callId === event.callId ? { ...tool, ...chip } : tool)) : [...draft.tools, chip],
      });
      break;
    }
    case 'error': {
      state.failed.set(event.messageId, event.error);
      const draft = state.drafts.get(event.sessionId);
      if (draft && draft.messageId === event.messageId) state.drafts.set(event.sessionId, { ...draft, error: event.error });
      break;
    }
    case 'done':
      push(event.sessionId, event.message);
      if (state.drafts.get(event.sessionId)?.messageId === event.messageId) state.drafts.delete(event.sessionId);
      break;
  }
  emit();
}

let subscribed = false;
/** Pencere başına bir kez abone olunur (sayfa ilk kez açılmadan önce de gelen akışı kaçırmamak için kabuk açılışında). */
export function ensureChatSubscription() {
  if (subscribed || typeof window === 'undefined' || !window.fuber) return;
  subscribed = true;
  window.fuber.on('chat.stream', handleStream);
}

export const chatStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  version: () => state.version,
  appended: (sessionId: Id | null) => (sessionId ? (state.appended.get(sessionId) ?? []) : []),
  draft: (sessionId: Id | null) => (sessionId ? (state.drafts.get(sessionId) ?? null) : null),
  failure: (messageId: Id) => state.failed.get(messageId) ?? null,
  /** Geçmiş yeniden yüklenince eklenenler geçmişin içinde gelir; çift görünmesin. */
  settle(sessionId: Id, loaded: ChatMessage[]) {
    const ids = new Set(loaded.map((message) => message.id));
    const list = state.appended.get(sessionId);
    if (!list) return;
    const rest = list.filter((message) => !ids.has(message.id));
    if (rest.length !== list.length) {
      state.appended.set(sessionId, rest);
      emit();
    }
  },
  forget(sessionId: Id) {
    state.appended.delete(sessionId);
    state.drafts.delete(sessionId);
    emit();
  },
};

ensureChatSubscription();
