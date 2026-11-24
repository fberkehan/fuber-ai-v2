// `modules.*` kanalları ve araç kaydının tanı kanalı (`tools.recent`).
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, services) => {
  const { modules, tools } = services;

  ipc.handle('modules.list', () => modules.list());
  // Politikanın kapattığı modül açılamaz: kayıt `UserError` fırlatır, arayüz iletisini gösterir.
  ipc.handle('modules.setEnabled', ({ id, enabled }) => modules.setEnabled(id, enabled));
  // Modül kapalıyken de: kullanıcı kendi verisini her zaman silebilir.
  ipc.handle('modules.purgeData', async ({ id }) => {
    await modules.purgeData(id);
    return { ok: true as const };
  });

  ipc.handle('tools.recent', ({ limit }) => tools.recentCalls(Math.min(Math.max(1, limit), 500)));
};
