// Sahibi: T2. `stage.*` kanalları: sahnedeki kartlar ve mini uygulamalar.
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, { stage, bus }) => {
  ipc.handleAll({
    'stage.items': () => stage.items(),
    'stage.close': ({ id }) => {
      stage.close(id ?? undefined);
      return { ok: true };
    },
    'stage.action': ({ itemId, actionId }) => {
      const item = stage.items().find((candidate) => candidate.id === itemId);
      if (item) bus.emit('stage.action', { itemId, moduleId: item.moduleId, actionId });
      return { ok: true };
    },
  });
};
