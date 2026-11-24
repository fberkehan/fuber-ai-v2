// Sahibi: T2. `memory.*` kanalları: Hafıza sayfası.
import { UserError } from '@fuber/shared';
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, { memory }) => {
  ipc.handleAll({
    'memory.search': ({ query, kinds, limit }) => memory.search({ text: query, limit, ...(kinds ? { kinds } : {}) }),
    'memory.list': (filter) => memory.list(filter),
    'memory.save': ({ kind, text, subject, tags, pinned }) => {
      if (!text.trim()) throw new UserError('Boş kayıt eklenemez.');
      return memory.save({
        kind,
        text,
        subject: subject ?? null,
        ...(tags ? { tags } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
        source: 'user',
        confidence: 1,
      });
    },
    'memory.update': ({ id, patch }) => {
      const item = memory.update(id, patch);
      if (!item) throw new UserError('Kayıt bulunamadı.');
      return item;
    },
    'memory.forget': ({ id }) => {
      if (!memory.forget(id)) throw new UserError('Kayıt bulunamadı.');
      return { ok: true };
    },
    'memory.stats': () => memory.stats(),
  });
};
