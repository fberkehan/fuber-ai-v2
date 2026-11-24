// Panonun verisi: ilk okuma, `dashboard.changed` olayıyla sessiz yenileme ve dakika başına kurulan zincirli saat.
// Yoklama yoktur: saat yalnız bir sonraki dakika başına kurulur; pano ancak görünümün eskidiği bildirilen andan
// (`validUntil`) ya da gün döndükten sonra yeniden okunur.
import { useCallback, useEffect, useRef, useState } from 'react';
import { localDay, type DashboardSnapshot } from '@fuber/shared';
import { errorText, useEvent } from '../../shell/live';

export interface DashboardState {
  snapshot: DashboardSnapshot | null;
  error: string | null;
  /** Dakikada bir yenilenen saat. */
  now: Date;
  /** Yapay zekânın az önce eklediği ya da güncellediği kart (ışık bir kez süpürür). */
  arrived: string | null;
  /** İşlem yanıtındaki (sırala, boyutlandır, kaldır) yeni görünümü hemen uygular. */
  apply(next: DashboardSnapshot): void;
  reload(): void;
}

export function useDashboard(): DashboardState {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [arrived, setArrived] = useState<string | null>(null);
  const seq = useRef(0);
  const latest = useRef<DashboardSnapshot | null>(null);

  const apply = useCallback((next: DashboardSnapshot) => {
    // Eski bir okuma yenisinin üstüne yazmasın.
    if (latest.current && next.revision < latest.current.revision) return;
    latest.current = next;
    setSnapshot(next);
    setError(null);
  }, []);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    window.fuber.invoke('dashboard.get').then(
      (next) => mine === seq.current && apply(next),
      (cause: unknown) => mine === seq.current && latest.current === null && setError(errorText(cause)),
    );
  }, [apply]);

  useEffect(reload, [reload]);

  useEvent('dashboard.changed', (event) => {
    if (event.reason === 'card' && event.by === 'ai' && event.cardId) setArrived(event.cardId);
    reload();
  });
  // Modül açılıp kapanınca (Kokpit'in kendisi dahil) yeniden denenir.
  useEvent('module.changed', (event) => event.id === 'dashboard' && reload());

  useEffect(() => {
    if (!arrived) return;
    const id = window.setTimeout(() => setArrived(null), 2400);
    return () => window.clearTimeout(id);
  }, [arrived]);

  // Zincirli saat: her seferinde yalnız bir sonraki dakika başına kurulur.
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(
        () => {
          const next = new Date();
          const current = latest.current;
          const expired = current?.validUntil ? Date.parse(current.validUntil) <= next.getTime() : false;
          const dayTurned = current ? localDay(current.generatedAt) !== localDay(next) : false;
          setNow(next);
          if (expired || dayTurned) reload();
          arm();
        },
        60_000 - (Date.now() % 60_000) + 40,
      );
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [reload]);

  return { snapshot, error, now, arrived, apply, reload };
}
