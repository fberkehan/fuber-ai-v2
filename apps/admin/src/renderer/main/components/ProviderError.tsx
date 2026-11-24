/**
 * Sağlayıcı hatasının sade gösterimi: başlık + bir cümle; sağlayıcının ham yanıtı yalnız "Ayrıntı" altında,
 * küçük ve kopyalanabilir.
 */
import { Copy, Key, PlugsConnected, WarningCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { IconButton, toast } from '@fuber/ui';
import { classifyProviderError, type ProviderErrorKind } from '../lib/provider-error';
import { Notice } from './layout';

const TONE: Record<ProviderErrorKind, 'neutral' | 'warning' | 'danger'> = {
  missing: 'neutral',
  network: 'warning',
  quota: 'warning',
  credit: 'warning',
  plan: 'warning',
  invalid: 'danger',
  unknown: 'warning',
};

export function ProviderError({ message, httpStatus = null, testId }: { message: string; httpStatus?: number | null; testId?: string }) {
  const kind = classifyProviderError(message, httpStatus);
  const icon = kind === 'missing' ? <Key /> : kind === 'network' ? <PlugsConnected /> : <WarningCircle weight="fill" />;
  return (
    <Notice tone={TONE[kind]} icon={icon} title={t(`admin2.err.${kind}.title`)} testId={testId} className="items-start">
      <span data-kind={kind} data-testid={testId ? `${testId}-body` : undefined}>
        {t(`admin2.err.${kind}.body`)}
      </span>
      {kind !== 'missing' && message.trim() !== '' && <RawDetails raw={message} />}
    </Notice>
  );
}

function RawDetails({ raw }: { raw: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      toast.success(t('admin2.err.copied'));
    } catch {
      // Pano erişilemezse metin zaten seçilebilir.
    }
  };
  return (
    <details className="group mt-1.5 text-xs text-fg-faint" data-testid="provider-error-details">
      <summary className="w-fit cursor-pointer select-none rounded-xs text-fg-muted underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent flex list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block size-1.5 rotate-[-45deg] border-r border-b border-current transition-transform duration-(--duration-fast) group-open:rotate-45" />
        {t('admin2.err.details')}
      </summary>
      <div className="mt-1.5 flex items-start gap-2 rounded-xs bg-surface-1 p-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap text-fg-muted" data-selectable data-testid="provider-error-raw">
          {raw}
        </code>
        <IconButton size="sm" icon={<Copy />} label={t('admin2.err.copy')} onClick={() => void copy()} />
      </div>
    </details>
  );
}
