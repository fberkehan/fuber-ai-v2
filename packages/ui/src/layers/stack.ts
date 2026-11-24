/**
 * Katman yığını: Dialog, Menu (ve Select), Tooltip, Toast için TEK kayıt. DOM'a dokunmaz; saf ve sınanır.
 *
 * Neden: v1'de her yüzen öğe kendi z-index'ini ve kendi Esc/dış tıklama dinleyicisini taşıyordu; iç içe
 * açılınca yanlış öğe kapanıyor, menü diyalogun altında kalıyordu. Burada sıra tek yerde tutulur:
 * - "Yığılan" türler (dialog, menu) açılış sırasıyla `--z-layer + sıra` alır; sonra açılan hep üsttedir.
 * - Tooltip ve toast yığının dışında, sabit ve daha yüksek düzeydedir.
 * - Esc ve dış tıklama yalnız en üstteki uygun katmanı kapatır; alttakine ulaşmaz.
 */

export type LayerKind = 'dialog' | 'menu' | 'tooltip' | 'toast';
export type DismissReason = 'escape' | 'outside';

/** Bir DOM düğümünün katmanın içinde olup olmadığını söyler (sınamada sahte işlev verilir). */
export type ContainsFn = (target: unknown) => boolean;

export interface LayerEntry {
  id: string;
  kind: LayerKind;
  /** Odak tuzağı kurar, arkayı etkisiz sayar. */
  modal: boolean;
  dismissOnEscape: boolean;
  dismissOnOutside: boolean;
  onDismiss?: (reason: DismissReason) => void;
  /** Katmanın kendi DOM alanı. */
  contains?: ContainsFn;
  /** Dışarıda sayılmayacak alanlar (ör. menüyü açan düğme: yoksa basınca kapanıp yeniden açılır). */
  ignore?: ContainsFn;
  /** İçinde açıldığı katman. Aynı anda bağlanınca (React çocuk etkisini önce koşar) ebeveyn yine altta kalır. */
  parent?: string;
}

const STACKED: ReadonlySet<LayerKind> = new Set(['dialog', 'menu']);

export function isStacked(kind: LayerKind): boolean {
  return STACKED.has(kind);
}

export interface LayerStack {
  push(entry: LayerEntry): () => void;
  update(id: string, patch: Partial<Omit<LayerEntry, 'id' | 'kind'>>): void;
  remove(id: string): void;
  list(): readonly LayerEntry[];
  /** CSS z-index değeri: `calc(var(--z-layer) + n)` ya da sabit düzey. */
  zIndex(id: string): string;
  /** Yığılan katmanlar içinde en üstteki mi? (odak tuzağı yalnız en üstte çalışır) */
  isTop(id: string): boolean;
  /** Esc: en üstteki Esc'e duyarlı katmanı kapatır. İşlendiyse true. */
  escape(): boolean;
  /** Dış basış: en üstteki yığılan katmanın dışındaysa onu kapatır. İşlendiyse true. */
  pointerDownOutside(target: unknown): boolean;
  subscribe(listener: () => void): () => void;
}

export function createLayerStack(): LayerStack {
  let entries: LayerEntry[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  const remove = (id: string) => {
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return;
    entries = next;
    emit();
  };

  const stacked = () => entries.filter((entry) => isStacked(entry.kind));

  return {
    push(entry) {
      const rest = entries.filter((existing) => existing.id !== entry.id);
      const childIndex = rest.findIndex((existing) => existing.parent === entry.id);
      entries = childIndex === -1 ? [...rest, entry] : [...rest.slice(0, childIndex), entry, ...rest.slice(childIndex)];
      emit();
      return () => remove(entry.id);
    },
    update(id, patch) {
      entries = entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
    },
    remove,
    list: () => entries,
    zIndex(id) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return 'var(--z-layer)';
      if (entry.kind === 'tooltip') return 'var(--z-tooltip)';
      if (entry.kind === 'toast') return 'var(--z-toast)';
      const order = stacked().findIndex((candidate) => candidate.id === id);
      return `calc(var(--z-layer) + ${order * 2})`;
    },
    isTop(id) {
      const list = stacked();
      return list.length > 0 && list[list.length - 1]?.id === id;
    },
    escape() {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!entry || !entry.dismissOnEscape) continue;
        entry.onDismiss?.('escape');
        return true;
      }
      return false;
    },
    pointerDownOutside(target) {
      const list = stacked();
      const top = list[list.length - 1];
      if (!top) return false;
      if (top.contains?.(target) || top.ignore?.(target)) return false;
      // Toast ya da tooltip üstüne basmak, altındaki menüyü kapatmamalı.
      for (const entry of entries) {
        if (!isStacked(entry.kind) && entry.contains?.(target)) return false;
      }
      if (!top.dismissOnOutside) return false;
      top.onDismiss?.('outside');
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Uygulama genelinde tek yığın. */
export const layerStack = createLayerStack();

let counter = 0;
export function nextLayerId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
