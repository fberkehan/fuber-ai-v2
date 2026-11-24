import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { layerStack, nextLayerId, type DismissReason, type LayerKind } from './stack';

/**
 * Tek portal kökü: bütün yüzen katmanlar `<body>` sonundaki tek `[data-fuber-layers]` düğümüne çizilir.
 * Sayfa içindeki `overflow:hidden` ya da `transform` taşıyan kaplar katmanı kırpamaz.
 */
let portalRoot: HTMLElement | null = null;
export function getLayerRoot(): HTMLElement {
  if (portalRoot && portalRoot.isConnected) return portalRoot;
  const existing = document.querySelector<HTMLElement>('[data-fuber-layers]');
  portalRoot = existing ?? document.createElement('div');
  if (!existing) {
    portalRoot.setAttribute('data-fuber-layers', '');
    document.body.appendChild(portalRoot);
  }
  return portalRoot;
}

/** Belge düzeyindeki tek Esc ve dış basış dinleyicisi; ilk katman açılınca bir kez kurulur. */
let listening = false;
function ensureGlobalListeners() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (layerStack.escape()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      layerStack.pointerDownOutside(event.target);
    },
    true,
  );
}

const nodeContains = (ref: RefObject<HTMLElement | null>) => (target: unknown) =>
  target instanceof Node && !!ref.current?.contains(target);

/** İçinde bulunulan katmanın kimliği: iç içe katman ebeveynini bilir. */
export const LayerParentContext = createContext<string | undefined>(undefined);

export interface UseLayerOptions {
  open: boolean;
  kind: LayerKind;
  modal?: boolean;
  dismissOnEscape?: boolean;
  dismissOnOutside?: boolean;
  onDismiss?: (reason: DismissReason) => void;
  /** Katmanın DOM alanı (dış basış hesabı için). */
  containerRef: RefObject<HTMLElement | null>;
  /** Dışarıda sayılmayacak öğe (ör. tetikleyici düğme). */
  ignoreRef?: RefObject<HTMLElement | null>;
}

/** Katmanı yığına kaydeder; z-index'i ve en üstte olup olmadığını döndürür. */
export function useLayer(options: UseLayerOptions): { id: string; zIndex: string; isTop: boolean } {
  const { open, kind, modal = false, dismissOnEscape = true, dismissOnOutside = true, containerRef, ignoreRef } =
    options;
  const [id] = useState(() => nextLayerId(kind));
  const parent = useContext(LayerParentContext);
  const onDismissRef = useRef(options.onDismiss);
  onDismissRef.current = options.onDismiss;

  useLayoutEffect(() => {
    if (!open) return;
    ensureGlobalListeners();
    return layerStack.push({
      id,
      kind,
      modal,
      dismissOnEscape,
      dismissOnOutside,
      onDismiss: (reason) => onDismissRef.current?.(reason),
      contains: nodeContains(containerRef),
      ignore: ignoreRef ? nodeContains(ignoreRef) : undefined,
      parent,
    });
  }, [open, id, kind, modal, dismissOnEscape, dismissOnOutside, containerRef, ignoreRef, parent]);

  const snapshot = useSyncExternalStore(
    layerStack.subscribe,
    () => `${layerStack.zIndex(id)}|${layerStack.isTop(id)}`,
    () => 'var(--z-layer)|false',
  );
  const [zIndex = 'var(--z-layer)', top] = snapshot.split('|');
  return { id, zIndex, isTop: top === 'true' };
}

export interface LayerPortalProps {
  children: ReactNode;
}

/** Çocukları tek portal köküne taşır. */
export function LayerPortal({ children }: LayerPortalProps) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setRoot(getLayerRoot()), []);
  return root ? createPortal(children, root) : null;
}

const TABBABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function getTabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) => !element.hasAttribute('inert') && element.getClientRects().length > 0,
  );
}

/**
 * Odak tuzağı: açılınca içeri odaklanır, Tab içeride döner, kapanınca odak açanı geri bulur.
 * Yalnız `active` (yığının en üstü) iken çalışır; iç içe menü açıkken diyalog odağı geri çekmez.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  active: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const target = initialFocusRef?.current ?? getTabbables(container)[0] ?? container;
      target.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      const restore = restoreRef.current;
      if (restore && restore.isConnected) restore.focus({ preventScroll: true });
    };
  }, [open, containerRef, initialFocusRef]);

  useEffect(() => {
    if (!open || !active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const items = getTabbables(container);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const container = containerRef.current;
      if (!container || !(event.target instanceof Node)) return;
      // Toast ve tooltip portal kökünde ama diyalog dışında: onlara odak gitmesi serbest.
      if (container.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[data-layer-free]')) return;
      (getTabbables(container)[0] ?? container).focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, active, containerRef]);
}
