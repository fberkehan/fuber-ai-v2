import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminEvents } from '@fuber/shared';

/** Ana süreçten gelen hata zaten Türkçe ve gösterilebilir (`ipc-admin.ts`). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Olaya abone olur; geri çağrı her çizimde değişse de abonelik bir kez kurulur. */
export function useAdminEvent<K extends keyof AdminEvents>(event: K, listener: (payload: AdminEvents[K]) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => window.fuber.on(event, (payload) => ref.current(payload)), [event]);
}

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** İlk yükleme sürüyor (veri henüz yok). */
  loading: boolean;
  /** Arka planda yenileniyor (eski veri ekranda kalır). */
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: (next: T | ((prev: T | null) => T)) => void;
}

/**
 * Tek bir IPC okumasının durumu. Yenilemede eski veri ekranda kalır: canlı olaylarla gelen her yenileme
 * iskelete düşüp ekranı titretmesin diye.
 */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setRefreshing(true);
    try {
      const next = await loadRef.current();
      if (id !== seq.current) return;
      setDataState(next);
      setError(null);
    } catch (reason) {
      if (id !== seq.current) return;
      setError(errorMessage(reason));
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setData = useCallback((next: T | ((prev: T | null) => T)) => {
    setDataState((prev) => (typeof next === 'function' ? (next as (p: T | null) => T)(prev) : next));
  }, []);

  return { data, error, loading: loading && data === null, refreshing, reload, setData };
}
