import { useState } from 'react';
import { t } from '@fuber/shared';
import { toast } from '@fuber/ui';
import { errorMessage } from '../lib/ipc';
import { usePolicy } from './policy-store';

/**
 * Acil durdurma: kaydet çubuğundan geçmez, anında yayınlanır (`policy.setKillSwitch`). Taslaktaki öteki
 * değişiklikler korunur (yeni sürümün üstüne yeniden kurulur).
 */
export function useKillSwitch() {
  const { base, accept } = usePolicy();
  const [busy, setBusy] = useState(false);
  const active = !!base?.killSwitch.active;

  const set = async (next: boolean, message?: string) => {
    setBusy(true);
    try {
      const policy = await window.fuber.invoke('policy.setKillSwitch', { active: next, message: message?.trim() || undefined });
      accept(policy);
      // Açılınca ayrıca bildirim çıkmaz: durum şeridi ve acil durdurma kutusu zaten bunu söyler.
      if (!next) toast.success(t('admin.kill.offToast'));
      return true;
    } catch (reason) {
      toast.error(t('admin.kill.failed'), { description: errorMessage(reason) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { active, message: base?.killSwitch.message ?? '', busy, set };
}
