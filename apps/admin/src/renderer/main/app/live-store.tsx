/**
 * Birden çok yerde görünen canlı veriler: servis durumu, cihazlar, anahtarlar, bugünkü harcama.
 * Durum şeridi ve ekranlar aynı kopyayı okur; `service.status`, `devices.changed`, `keys.changed` olayları
 * gelince yenilenir. Kullanım için ayrı olay yok: kısa aralıkla ve politika değişince yeniden okunur.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AdminUsageResponse, ControlServiceStatus, DeviceRecord, KeyStatus } from '@fuber/shared';
import { useAdminEvent, useResource, type Resource } from '../lib/ipc';

export interface LiveStore {
  service: Resource<ControlServiceStatus>;
  devices: Resource<DeviceRecord[]>;
  keys: Resource<KeyStatus[]>;
  usage: Resource<AdminUsageResponse>;
  /** Saniyede bir değil, dakikada bir artar: "3 dakika önce" metinleri tazelensin diye. */
  now: number;
}

const LiveContext = createContext<LiveStore | null>(null);

export function useLive(): LiveStore {
  const store = useContext(LiveContext);
  if (!store) throw new Error('LiveProvider eksik');
  return store;
}

const USAGE_DAYS = 7;
const USAGE_REFRESH_MS = 30_000;

export function LiveProvider({ children }: { children: ReactNode }) {
  const service = useResource(() => window.fuber.invoke('service.status'));
  const devices = useResource(() => window.fuber.invoke('devices.list'));
  const keys = useResource(() => window.fuber.invoke('keys.list'));
  const usage = useResource(() => window.fuber.invoke('usage.summary', { days: USAGE_DAYS }));
  const [now, setNow] = useState(() => Date.now());

  useAdminEvent('service.status', (status) => service.setData(status));
  // Kullanımı bildiren de cihazdır: kalp atışı ve kayıt geldiğinde harcama da tazelenir.
  useAdminEvent('devices.changed', () => {
    void devices.reload();
    void usage.reload();
  });
  useAdminEvent('keys.changed', () => void keys.reload());
  useAdminEvent('policy.changed', () => void usage.reload());

  const reloadUsage = usage.reload;
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void reloadUsage();
    }, USAGE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reloadUsage]);

  const value = useMemo(() => ({ service, devices, keys, usage, now }), [service, devices, keys, usage, now]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
