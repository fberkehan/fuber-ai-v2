// `jobs.*` kanalları: arka plan işlerinin listesi ve iptali (araştırma, yetenek geliştirme, proje görevi).
import { t, UserError } from '@fuber/shared';
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, services) => {
  const { jobs } = services;

  ipc.handle('jobs.list', ({ status, limit }) => jobs.list({ ...(status ? { status } : {}), limit: Math.min(Math.max(1, limit), 200) }));

  ipc.handle('jobs.activity', () => jobs.activity?.() ?? { current: null, running: 0, queued: 0, finished: null });

  ipc.handle('jobs.cancel', ({ id }) => {
    // Bitmiş ya da bilinmeyen iş iptal edilemez; arayüz nedenini gösterir.
    if (!jobs.cancel(id)) throw new UserError(t('job.cancel.notRunning'));
    return { ok: true as const };
  });
};
