/**
 * Cihaz onayı: Güvenlik › Cihazlar ve Genel bakış › Onay bekleyenler aynı işlemi çağırır (aynı ileti, aynı yenileme).
 */
import { useState } from 'react';
import { t, type DeviceRecord } from '@fuber/shared';
import { toast } from '@fuber/ui';
import { errorMessage } from '../lib/ipc';
import { useLive } from './live-store';

export type DeviceAction = 'approve' | 'revoke' | 'delete';

export function useDeviceActions() {
  const { devices } = useLive();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (device: DeviceRecord, action: DeviceAction): Promise<boolean> => {
    setBusy(device.id);
    try {
      if (action === 'approve') await window.fuber.invoke('devices.approve', { id: device.id });
      else if (action === 'revoke') await window.fuber.invoke('devices.revoke', { id: device.id });
      else await window.fuber.invoke('devices.delete', { id: device.id });
      toast.success(t(`admin.devices.done.${action}`, { name: device.name }));
      await devices.reload();
      return true;
    } catch (reason) {
      toast.error(t('admin.devices.failed'), { description: errorMessage(reason) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  return { act, busy };
}
