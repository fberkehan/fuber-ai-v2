// Ana pencerenin veri yardımcıları: tek seferlik okuma + olayla sessiz yenileme, olay aboneliği, hata metni.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Events } from '@fuber/shared';
import { toast } from '@fuber/ui';

export type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export const errorText = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  // Electron köprüsü iletiyi "Error invoking remote method…" ile sarabilir; kullanıcıya yalnız asıl cümle.
  return raw.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
};

/** Olayı dinler; dinleyici her çizimde değişse de abonelik bir kez kurulur. */
export function useEvent<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => window.fuber.on(name, (payload) => ref.current(payload)), [name]);
}

/**
 * Okumayı yükler; `events` içindeki olaylardan biri gelince iskeletsiz, sessizce yeniler (yoklama yok).
 * Art arda gelen olaylar tek okumaya katlanır (aynı karede).
 */
export function useLive<T>(
  read: () => Promise<T>,
  events: ReadonlyArray<keyof Events>,
  deps: unknown[] = [],
): { state: Load<T>; reload: () => void; data: T | null } {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const readRef = useRef(read);
  readRef.current = read;
  const seq = useRef(0);
  const pending = useRef(false);

  const reload = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    queueMicrotask(() => {
      pending.current = false;
      const mine = ++seq.current;
      readRef.current().then(
        (data) => mine === seq.current && setState({ status: 'ready', data }),
        (error: unknown) => mine === seq.current && setState({ status: 'error', message: errorText(error) }),
      );
    });
  }, []);

  useEffect(() => {
    setState({ status: 'loading' });
    reload();
    const offs = events.map((name) => window.fuber.on(name, () => reload()));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { state, reload, data: state.status === 'ready' ? state.data : null };
}

/** Bir eylemi çalıştırır; hata olursa sakin bir toast gösterir ve `null` döner. */
export async function attempt<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    toast.error(errorText(error));
    return null;
  }
}

/** Kısayol dizgesini (`Control+Alt+J`) KeyHint tuşlarına çevirir. */
export function acceleratorKeys(accelerator: string): string[] {
  return accelerator
    .split('+')
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => (key === 'Control' || key === 'CommandOrControl' || key === 'CmdOrCtrl' ? 'Ctrl' : key));
}
