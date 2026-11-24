// Çekirdek sayfaların paylaştığı küçük parçalar: sayfa gövdesi, iskelet, hata paneli, onay diyaloğu.
import { useRef, useState, type ReactNode } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, Dialog, EmptyState, Skeleton, Surface, cn } from '@fuber/ui';

/**
 * Sayfanın tek sütunu: bütün sayfalar aynı genişlikte (1120 px + 40 px yan boşluk) ve ortalıdır; sayfa değiştirince
 * başlık ve içerik yatayda yer değiştirmez. Başlık (`PageHeader`) da bu sütunun içindedir. `wide`: iki bölmeli
 * çalışma yüzeyleri (canlı oturum, proje listesi) için geniş sütun.
 */
export function PageBody({ className, children, wide }: { className?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('mx-auto w-full px-10', wide ? 'max-w-[1520px]' : 'max-w-[1200px] min-[2200px]:max-w-[1400px]', className)}>
      {children}
    </div>
  );
}

export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy aria-label={t('common.loading')}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 px-3">
          <Skeleton className="size-9 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5 rounded-full" />
            <Skeleton className="h-3 w-1/4 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorPanel({ message, onRetry, title }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <Surface level={1}>
      <EmptyState
        size="sm"
        icon={<WarningCircle />}
        title={title ?? t('common.loadFailed')}
        description={message}
        actions={
          onRetry && (
            <Button size="sm" icon={<ArrowClockwise />} onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )
        }
      />
    </Surface>
  );
}

/** Yıkıcı onay: odak "Vazgeç"te başlar; onay düğmesi iş sürerken bekler. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onOpenChange,
  onConfirm,
  children,
  confirmDisabled,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={body}
      size="sm"
      role="alertdialog"
      initialFocusRef={cancelRef}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={() => onOpenChange(false)} data-testid="confirm-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={confirmDisabled}
            data-testid="confirm-ok"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
