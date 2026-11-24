// `control.*` kanalları: kontrol servisi bağlantısı ve Fuber Yönetim 2'nin başlatılması.
import { t } from '@fuber/shared';
import { findAdminExe, launchAdmin } from '../../core/policy-admin';
import { testing } from '../../testing';
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, services) => {
  const { policy } = services;

  ipc.handle('control.status', () => policy.status());
  ipc.handle('control.connect', ({ url }) => policy.connect(url));
  ipc.handle('control.refresh', () => policy.refresh());

  // Kurulu değilse ya da süreç ayakta kalmadıysa `ok: false` ve nedeni döner (sözleşme: `LaunchResult`).
  ipc.handle('control.launchAdmin', async () => {
    // Sınamada gerçek uygulama başlatılmaz (kullanıcının ekranına pencere açardı); yalnız kurulu mu diye bakılır.
    if (testing.enabled) {
      const exe = await findAdminExe();
      return { ok: false, message: exe ? t('control.admin.testMode') : t('control.admin.notFound') };
    }
    return launchAdmin();
  });
};
