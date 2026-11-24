import { useRef, type ComponentPropsWithRef, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../cn';
import { enter, useMotionPreset } from '../motion';
import { useAnchoredPosition, type Placement } from './anchor';
import { LayerParentContext, LayerPortal, useLayer } from './Layer';

export interface FloatingPanelProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> {
  open: boolean;
  onDismiss: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: Placement;
  /** Tetikleyici genişliğinden dar olmasın (Select). */
  matchAnchorWidth?: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/**
 * Menu ve Select'in ortak açılır yüzeyi: tek portal, tek yığın, tetikleyiciden büyüyen giriş.
 * Esc ve dış basış yığın üzerinden gelir; tetikleyiciye basmak "dışarı" sayılmaz.
 */
export function FloatingPanel({
  open,
  onDismiss,
  anchorRef,
  placement = 'bottom-start',
  matchAnchorWidth,
  panelRef: externalRef,
  className,
  style,
  children,
  ...rest
}: FloatingPanelProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = externalRef ?? innerRef;
  const preset = useMotionPreset(enter.pop);
  const { id: layerId, zIndex } = useLayer({
    open,
    kind: 'menu',
    onDismiss,
    containerRef: panelRef,
    ignoreRef: anchorRef,
  });
  const position = useAnchoredPosition(anchorRef, panelRef, open, placement, 6);
  const minWidth = matchAnchorWidth ? anchorRef.current?.offsetWidth : undefined;

  return (
    <LayerPortal>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            {...preset}
            exit={{ ...preset.exit, transition: { duration: 0.12 } }}
            style={{
              position: 'fixed',
              left: position?.x ?? -9999,
              top: position?.y ?? -9999,
              zIndex,
              minWidth,
              transformOrigin: position?.origin,
              ...style,
            }}
            className={cn(
              'max-h-[min(420px,calc(100vh-32px))] overflow-y-auto rounded-md bg-surface-3 p-1.5 shadow-float outline-none',
              className,
            )}
            {...rest}
          >
            <LayerParentContext.Provider value={layerId}>{children}</LayerParentContext.Provider>
          </motion.div>
        )}
      </AnimatePresence>
    </LayerPortal>
  );
}
