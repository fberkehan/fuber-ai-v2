/**
 * Uygulama içi toast kuyruğu (saf; DOM yok, sınanır). Ekranda en yeni `max` (3) kart görünür (KURGU §9);
 * daha eskiler silinmez, geride bekler ve yeniler kapandıkça yeniden görünür: bir hata mesajı sessizce düşmez.
 * Süre sayacı yalnız görünürken işler (bkz. Toaster); geride bekleyen kartın süresi azalmaz.
 */

export type ToastTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Aynı kimlikle yeniden çağrılırsa kart yerinde güncellenir (ör. "Kaydediliyor" → "Kaydedildi"). */
  id?: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms; `Infinity` kullanıcı kapatana dek kalır. Varsayılan 5000, eylemli kartta 8000. */
  duration?: number;
  action?: ToastAction;
}

export interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  duration: number;
  action?: ToastAction;
  createdAt: number;
  /** Yerinde güncelleme sayacı: değişince süre baştan sayılır. */
  revision: number;
}

export interface ToastStore {
  add(options: ToastOptions): string;
  dismiss(id: string): void;
  clear(): void;
  /** Bütün kuyruk, eskiden yeniye. */
  list(): readonly ToastRecord[];
  /** Ekranda olanlar, yeniden eskiye (ilk eleman öndeki kart). */
  visible(): readonly ToastRecord[];
  subscribe(listener: () => void): () => void;
}

export const DEFAULT_DURATION = 5000;
export const ACTION_DURATION = 8000;

export function createToastStore(max = 3, now: () => number = () => Date.now()): ToastStore {
  let records: ToastRecord[] = [];
  let visibleCache: ToastRecord[] = [];
  let counter = 0;
  const listeners = new Set<() => void>();

  const commit = (next: ToastRecord[]) => {
    records = next;
    visibleCache = records.slice(-max).reverse();
    for (const listener of listeners) listener();
  };

  return {
    add(options) {
      const existing = options.id ? records.find((record) => record.id === options.id) : undefined;
      const duration = options.duration ?? (options.action ? ACTION_DURATION : DEFAULT_DURATION);
      if (existing) {
        commit(
          records.map((record) =>
            record.id === existing.id
              ? {
                  ...record,
                  title: options.title,
                  description: options.description,
                  tone: options.tone ?? record.tone,
                  duration,
                  action: options.action,
                  revision: record.revision + 1,
                }
              : record,
          ),
        );
        return existing.id;
      }
      counter += 1;
      const id = options.id ?? `toast-${counter}`;
      commit([
        ...records,
        {
          id,
          title: options.title,
          description: options.description,
          tone: options.tone ?? 'neutral',
          duration,
          action: options.action,
          createdAt: now(),
          revision: 0,
        },
      ]);
      return id;
    },
    dismiss(id) {
      if (!records.some((record) => record.id === id)) return;
      commit(records.filter((record) => record.id !== id));
    },
    clear() {
      if (records.length) commit([]);
    },
    list: () => records,
    visible: () => visibleCache,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
