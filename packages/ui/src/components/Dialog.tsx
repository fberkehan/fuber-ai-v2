import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from '@phosphor-icons/react';
import { cn } from '../cn';
import { LayerParentContext, LayerPortal, useFocusTrap, useLayer } from '../layers/Layer';
import { enter, fade, useMotionPreset } from '../motion';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Alt eylemler: sağa yaslı; birincil en sağda. */
  footer?: ReactNode;
  /** sm 400 · md 520 · lg 680 px. */
  size?: 'sm' | 'md' | 'lg';
  /** false: Esc ve arka plan tıklaması kapatmaz (onay bekleyen kritik iş). Kapat düğmesi de gizlenir. */
  dismissible?: boolean;
  /** Açılınca odaklanacak öğe (varsayılan: ilk odaklanabilir). Yıkıcı onayda "Vazgeç" verilir. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  /** `alertdialog`: yanıt bekleyen onay. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

const widths = { sm: 'max-w-100', md: 'max-w-130', lg: 'max-w-170' } as const;

/**
 * Kipli diyalog. Tek portal kökünde, ortak yığında; odak içeride döner, kapanınca açan öğeye döner.
 * Esc ve arka plan yalnız en üstteki katmanı kapatır (içinde açık menü varsa önce menü kapanır).
 * Giriş merkezden hafif ölçek + yukarı; çıkış daha kısa.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  initialFocusRef,
  closeLabel = 'Kapat',
  role = 'dialog',
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const preset = useMotionPreset(enter.dialog);
  const { id: layerId, zIndex, isTop } = useLayer({
    open,
    kind: 'dialog',
    modal: true,
    dismissOnEscape: dismissible,
    dismissOnOutside: dismissible,
    onDismiss: () => onOpenChange(false),
    containerRef: panelRef,
  });
  useFocusTrap(panelRef, open, isTop, initialFocusRef);

  return (
    <LayerPortal>
      <LayerParentContext.Provider value={layerId}>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex }}>
            <motion.div
              aria-hidden
              className="absolute inset-0 bg-scrim backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            />
            <motion.div
              ref={panelRef}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descriptionId : undefined}
              tabIndex={-1}
              {...preset}
              exit={{ ...preset.exit, transition: { duration: 0.14 } }}
              className={cn(
                'relative flex max-h-full w-full flex-col overflow-hidden rounded-lg bg-surface-2 shadow-float outline-none',
                widths[size],
                className,
              )}
            >
              <div className="flex items-start gap-4 px-6 pt-6">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <h2 id={titleId} className="text-xl text-fg">
                    {title}
                  </h2>
                  {description && (
                    <p id={descriptionId} className="text-sm text-fg-muted">
                      {description}
                    </p>
                  )}
                </div>
                {dismissible && (
                  <IconButton
                    icon={<X weight="bold" />}
                    label={closeLabel}
                    size="sm"
                    tooltip={false}
                    onClick={() => onOpenChange(false)}
                    className="-mt-1 -mr-2"
                  />
                )}
              </div>
              {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">{children}</div>}
              {!children && <div className="h-6" />}
              {footer && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-1/60 px-6 py-4">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </LayerParentContext.Provider>
    </LayerPortal>
  );
}
