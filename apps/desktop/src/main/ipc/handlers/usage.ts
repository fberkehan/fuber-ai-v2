// Sahibi: T2. `usage.*` kanalları: harcama ve bütçe.
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, { usage }) => {
  ipc.handleAll({
    'usage.today': () => usage.today(),
    'usage.summary': ({ days }) => usage.summary(Math.min(90, Math.max(1, days))),
    'usage.recent': ({ limit }) => usage.recent(Math.min(500, Math.max(1, limit))),
  });
};
