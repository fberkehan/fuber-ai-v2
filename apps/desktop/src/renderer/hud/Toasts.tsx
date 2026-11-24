import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from '@phosphor-icons/react';
import { LIMITS, t, type Notification } from '@fuber/shared';
import { Button, IconButton, cn, spring, useMotionPreset, useMotionTransition, type MotionPreset } from '@fuber/ui';
import { isEmpty, useEnvelope, useMeasure, usePausableTimer, ZERO } from './envelope';
import { moduleIcon } from './parts';
import { quiet, useEvent, useReportSize } from './use-hud';

const TOAST_MS = 6_000;
const TOAST_WITH_ACTIONS_MS = 12_000;
/** Çıkış (180 ms) + kalanların yerine kayması (yay) + pay. */
const SETTLE_MS = 520;
/** Gölge payı: `.toasts-anchor` sağdan 12, alttan 16; üstte 10. */
const PAD = { right: 12, left: 12, top: 10, bottom: 16 } as const;

/** Alttan doğar (pencere zaten büyümüş olur), yerinde söner; kırpılmasın diye kısa mesafe. */
const toastMotion: MotionPreset = {
  initial: { opacity: 0, transform: 'translateY(14px) scale(0.98)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)' },
  exit: { opacity: 0, transform: 'translateY(0px) scale(0.96)', transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } },
  transition: spring.gentle,
};

/**
 * Toast yığını (sağ alt): en çok üç kart; yeni kart alttan girer, eskiler yukarı kayar; her kart süresi dolunca
 * kalkar (üstüne gelince süre durur). Odak almaz. Boşken pencere gizlidir.
 */
export function Toasts() {
  const reportRef = useReportSize('toasts');
  const [toasts, setToasts] = useState<Notification[]>([]);
  const preset = useMotionPreset(toastMotion);
  const layoutTransition = useMotionTransition(spring.gentle);

  const remove = (id: string) => setToasts((list) => list.filter((item) => item.id !== id));

  useEvent('attention.notify', ({ notification, channel }) => {
    if (channel !== 'toast') return;
    // Yığın doluysa en eski kart yerini yenisine bırakır.
    setToasts((list) => [...list.filter((item) => item.id !== notification.id), notification].slice(-LIMITS.maxToasts));
  });
  useEvent('attention.dismiss', ({ id }) => remove(id));

  const [stackRef, stack] = useMeasure<HTMLDivElement>();
  const natural = isEmpty(stack) ? ZERO : { width: stack.width + PAD.left + PAD.right, height: stack.height + PAD.top + PAD.bottom };
  const envelope = useEnvelope(natural, SETTLE_MS);

  return (
    <div ref={reportRef} className="hud-content" data-testid="hud-content" style={{ width: envelope.width, height: envelope.height }}>
      <div className="toasts-anchor">
        <div ref={stackRef} className="flex w-[340px] flex-col gap-2.5" data-count={toasts.length}>
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                layout="position"
                initial={preset.initial}
                animate={preset.animate}
                exit={preset.exit}
                transition={{ ...preset.transition, layout: layoutTransition }}
                style={{ transformOrigin: '100% 100%' }}
              >
                <Toast
                  toast={toast}
                  onExpire={() => remove(toast.id)}
                  onDismiss={() => {
                    remove(toast.id);
                    void quiet(window.fuber.invoke('attention.dismiss', { id: toast.id }));
                  }}
                  onAct={(actionId) => {
                    remove(toast.id);
                    void quiet(window.fuber.invoke('attention.act', { id: toast.id, actionId }));
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Toast(props: { toast: Notification; onExpire(): void; onDismiss(): void; onAct(actionId: string): void }) {
  const { toast } = props;
  const action = toast.actions[0];
  const timer = usePausableTimer(true, action ? TOAST_WITH_ACTIONS_MS : TOAST_MS, props.onExpire, toast.id);
  const urgent = toast.priority === 'urgent';

  return (
    <section
      className="flex items-start gap-3 rounded-md bg-stage py-3 pr-2.5 pl-3.5 text-fg shadow-[var(--hud-shadow)]"
      data-testid="toast"
      role="status"
      onMouseEnter={timer.pause}
      onMouseLeave={timer.resume}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5',
          urgent ? 'bg-danger-soft text-danger' : 'bg-surface-4 text-fg-muted',
        )}
        aria-hidden
      >
        {moduleIcon(toast.moduleId)}
      </span>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.body ? <p className="line-clamp-2 text-sm text-fg-muted">{toast.body}</p> : null}
        {action ? (
          <div className="mt-2 flex">
            <Button size="sm" variant={action.kind === 'danger' ? 'danger' : 'secondary'} className="rounded-full" onClick={() => props.onAct(action.id)}>
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>
      <IconButton size="sm" icon={<X weight="bold" />} label={t('hud.toast.dismiss')} tooltip={false} className="rounded-full" onClick={props.onDismiss} />
    </section>
  );
}
