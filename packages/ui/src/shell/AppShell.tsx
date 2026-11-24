import type { ComponentPropsWithRef, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../cn';
import { spring, useMotionTransition } from '../motion';

export interface AppShellProps extends ComponentPropsWithRef<'div'> {
  /** Sol ray (NavRail). */
  rail?: ReactNode;
  /** Sağ denetçi; `null`/`undefined` iken kapalı. Açılıp kapanırken genişliği yaylanır. */
  inspector?: ReactNode;
  /** Pencere üst şeridi (çerçevesiz pencerede sürükleme alanı); içeriğin üstünde, rayın yanında. */
  topbar?: ReactNode;
  /** İçerik kaydırılabilir kap içindedir; kaydırmayı sayfa kendisi yönetecekse false. */
  scroll?: boolean;
  /**
   * Çerçevesiz pencere (başlık çubuğu gizli, pencere düğmeleri işletim sisteminin katmanında): üst şerit pencereyi
   * taşır ve sağında pencere düğmelerine yer bırakır. Çerçeveli pencerede (Yönetim) verilmez.
   */
  frameless?: boolean;
  /** Pencerenin üst ortasındaki canlı çentik (boşta küçük işaret; pencere odaktayken adanın durumu). */
  notch?: ReactNode;
  /** Sahnenin arkası (yıldızlı gökyüzü). */
  backdrop?: ReactNode;
}

/** Pencere düğmeleri katmanının (küçült, büyüt, kapat) genişliği + pay; `titleBarOverlay` ile aynı. */
const WINDOW_CONTROLS = 146;

/** tokens.css `--size-inspector` ile aynı. */
const INSPECTOR = 360;

/**
 * Ana pencere kabuğu: sol ray · içerik · isteğe bağlı sağ denetçi (KURGU §12). Zemin saf siyah. İçeriğin durduğu
 * yüzey ("pano") `appearance.css`'ten gelir: masaüstünde görünmez (içerik yıldızlı sahnede), yönetimde düz yüzey.
 */
export function AppShell({ rail, inspector, topbar, scroll = true, frameless = false, notch, backdrop, className, children, ...rest }: AppShellProps) {
  const transition = useMotionTransition(spring.smooth);
  const open = inspector !== null && inspector !== undefined && inspector !== false;
  return (
    <div className={cn('ui-shell flex h-full w-full overflow-hidden bg-stage text-fg', className)} data-frameless={frameless || undefined} {...rest}>
      {backdrop}
      {rail}
      <div className={cn('flex min-w-0 flex-1 flex-col pr-2 pb-2', !frameless && 'pt-2')}>
        {frameless ? (
          <div className="ui-drag shrink-0" style={{ paddingRight: WINDOW_CONTROLS }} data-testid="titlebar">
            {topbar}
          </div>
        ) : (
          topbar
        )}
        <div className="ui-pano flex min-h-0 flex-1 overflow-hidden">
          <main className={cn('relative min-w-0 flex-1', scroll ? 'ui-scroll overflow-y-auto' : 'overflow-hidden')}>{children}</main>
          <AnimatePresence initial={false}>
            {open && (
              <motion.aside
                key="inspector"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: INSPECTOR, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={transition}
                className="shrink-0 overflow-hidden border-l border-line"
              >
                <div className="h-full overflow-y-auto" style={{ width: INSPECTOR }}>
                  {inspector}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>
      {notch}
    </div>
  );
}
