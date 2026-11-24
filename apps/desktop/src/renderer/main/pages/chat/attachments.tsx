// Sohbet ekleri: ek düğmesi, sürükle-bırak ve yapıştırma, yazma kutusundaki çipler ve gönderilen iletideki ek gösterimi.
// Dosya ana süreçte (belge modülü) okunur; arayüz yalnız kimlik ve özet tutar.
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { FilePdf, FileText, Image as ImageIcon, Paperclip, Table, UploadSimple, WarningCircle, Presentation, EnvelopeSimple } from '@phosphor-icons/react';
import { t, type ChatAttachment } from '@fuber/shared';
import { Chip, IconButton, Spinner, cn, toast } from '@fuber/ui';
import { errorText } from '../../shell/live';
import type { AttachResult } from '../../../../main/modules/documents/types';

/** İleti başına en çok ek (belge modülündeki `MAX_ATTACHMENTS` ile aynı). */
export const MAX_ATTACHMENTS = 6;
/** Okunmaya gönderilecek en büyük dosya (belge 25 MB; büyüğü IPC'ye hiç gönderilmez). */
const MAX_DROP_BYTES = 25 * 1024 * 1024;

export interface PendingAttachment {
  key: string;
  name: string;
  state: 'reading' | 'ready';
  attachment?: ChatAttachment;
}

function iconFor(name: string, kind?: ChatAttachment['kind']): ReactNode {
  if (kind === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(name)) return <ImageIcon aria-hidden />;
  if (/\.pdf$/i.test(name)) return <FilePdf aria-hidden />;
  if (/\.(xlsx|xlsm|csv|tsv)$/i.test(name)) return <Table aria-hidden />;
  if (/\.(pptx|pptm)$/i.test(name)) return <Presentation aria-hidden />;
  if (/\.eml$/i.test(name)) return <EnvelopeSimple aria-hidden />;
  return <FileText aria-hidden />;
}

let counter = 0;

/** Yazma kutusunun ek durumu. */
export function useAttachments() {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const apply = (keys: string[], result: AttachResult) => {
    setItems((current) => {
      const rest = current.filter((item) => !keys.includes(item.key));
      const ready = result.attachments.map((attachment): PendingAttachment => ({ key: attachment.id, name: attachment.name, state: 'ready', attachment }));
      return [...rest, ...ready];
    });
    for (const rejected of result.rejected) toast.error(t('documents.rejected', { name: rejected.name, reason: rejected.reason }));
  };

  const room = () => MAX_ATTACHMENTS - itemsRef.current.length;

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const free = room();
    if (free <= 0) {
      toast.error(t('documents.tooMany', { count: MAX_ATTACHMENTS }));
      return;
    }
    if (files.length > free) toast.error(t('documents.tooMany', { count: MAX_ATTACHMENTS }));
    const chosen = files.slice(0, free);
    const keys = chosen.map((file) => `reading-${++counter}-${file.name}`);
    setItems((current) => [...current, ...chosen.map((file, index): PendingAttachment => ({ key: keys[index]!, name: file.name, state: 'reading' }))]);
    try {
      const payload = await Promise.all(
        chosen.map(async (file) => ({
          name: file.name,
          type: file.type,
          // Çok büyük dosya baytları IPC'ye taşınmaz: ana süreç boş içerikle değil, boyut kuralıyla reddetsin diye tek bayt.
          data: file.size > MAX_DROP_BYTES ? new Uint8Array(0) : new Uint8Array(await file.arrayBuffer()),
          tooBig: file.size > MAX_DROP_BYTES,
        })),
      );
      const oversized = payload.filter((file) => file.tooBig);
      for (const file of oversized) toast.error(t('documents.rejected', { name: file.name, reason: '25 MB’tan büyük' }));
      const sendable = payload.filter((file) => !file.tooBig).map(({ name, type, data }) => ({ name, type, data }));
      const result = sendable.length ? await window.fuber.invoke('documents.attachFiles', { files: sendable }) : { attachments: [], rejected: [] };
      apply(keys, result);
    } catch (error) {
      setItems((current) => current.filter((item) => !keys.includes(item.key)));
      toast.error(errorText(error));
    }
  }, []);

  const pick = useCallback(async () => {
    const key = `picking-${++counter}`;
    try {
      const result = await window.fuber.invoke('documents.pickAttachments');
      const free = room();
      if (result.attachments.length > free) toast.error(t('documents.tooMany', { count: MAX_ATTACHMENTS }));
      apply([key], { attachments: result.attachments.slice(0, Math.max(0, free)), rejected: result.rejected });
    } catch (error) {
      toast.error(errorText(error));
    }
  }, []);

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((entry) => entry.key === key);
    setItems((current) => current.filter((entry) => entry.key !== key));
    if (item?.attachment) void window.fuber.invoke('documents.discardAttachment', { id: item.attachment.id }).catch(() => undefined);
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const ready = items.filter((item) => item.state === 'ready' && item.attachment).map((item) => item.attachment!);
  const reading = items.some((item) => item.state === 'reading');
  return { items, ready, reading, addFiles, pick, remove, clear };
}

export type Attachments = ReturnType<typeof useAttachments>;

/** Yazma kutusunun ek düğmesi. */
export function AttachButton({ onPick, disabled }: { onPick: () => void; disabled?: boolean }) {
  return (
    <IconButton
      icon={<Paperclip />}
      label={t('documents.attachHint', { count: MAX_ATTACHMENTS })}
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onPick}
      data-testid="chat-attach"
    />
  );
}

/** Gönderilmemiş ekler: okunuyor / hazır / okunamadı. */
export function PendingChips({ attachments, localBrain }: { attachments: Attachments; localBrain: boolean }) {
  if (attachments.items.length === 0) return null;
  const hasImage = attachments.ready.some((item) => item.kind === 'image');
  return (
    <div className="flex flex-col gap-1.5" data-testid="chat-attachments">
      <div className="flex flex-wrap gap-1.5">
        {attachments.items.map((item) =>
          item.state === 'reading' ? (
            <span key={item.key} className="inline-flex h-8 items-center gap-2 rounded-full bg-surface-3 px-3 text-sm text-fg-muted" data-testid="chat-attachment" data-state="reading">
              <Spinner size={12} label={null} />
              {t('documents.reading', { name: item.name })}
            </span>
          ) : (
            <AttachmentChip key={item.key} attachment={item.attachment!} onRemove={() => attachments.remove(item.key)} />
          ),
        )}
      </div>
      {hasImage && localBrain && (
        <p className="flex items-center gap-1.5 text-sm text-fg-muted" data-testid="chat-attachment-local-note">
          <WarningCircle className="size-4 shrink-0 text-warning" weight="fill" aria-hidden />
          {t('documents.localImageNote')}
        </p>
      )}
    </div>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: ChatAttachment; onRemove?: () => void }) {
  const failed = attachment.status !== 'ok';
  return (
    <span title={attachment.note ?? attachment.name} data-testid="chat-attachment" data-state={attachment.status}>
      <Chip
        icon={failed ? <WarningCircle weight="fill" className="text-warning" aria-hidden /> : iconFor(attachment.name, attachment.kind)}
        {...(onRemove ? { onRemove, removeLabel: t('documents.remove', { name: attachment.name }) } : {})}
        className={cn('max-w-[280px]', failed && 'text-fg-muted')}
      >
        <span className="truncate">{attachment.name}</span>
        {failed && <span className="shrink-0 text-xs text-warning">{attachment.status === 'no_text' ? t('documents.status.noText') : t('documents.status.failed')}</span>}
      </Chip>
    </span>
  );
}

/** Dosya boyutu: "184 KB", "2,4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}

/** Ekin tek satır özeti: belge modülünün notu ("PDF · 12 sayfa") ve boyut; okunamadıysa nedeni. */
export function attachmentSummary(attachment: ChatAttachment): string {
  if (attachment.status === 'no_text') return attachment.note ?? t('documents.status.noText');
  if (attachment.status === 'failed') return attachment.note ?? t('documents.status.failed');
  return [attachment.note, formatBytes(attachment.bytes)].filter(Boolean).join(', ');
}

/** Ek önizlemesi: tür işareti, ad ve tek satır özet. Gönderilmiş iletide ve bağlam sütununda kullanılır. */
export function AttachmentCard({ attachment, className }: { attachment: ChatAttachment; className?: string }) {
  const failed = attachment.status !== 'ok';
  return (
    <span
      title={attachment.name}
      data-testid="chat-attachment"
      data-state={attachment.status}
      className={cn('flex max-w-full min-w-0 items-center gap-3 rounded-sm border border-line bg-surface-1 py-2 pr-3.5 pl-2', className)}
    >
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xs [&_svg]:size-4.5', failed ? 'bg-warning-soft text-warning' : 'bg-surface-4 text-fg-muted')}>
        {failed ? <WarningCircle weight="fill" aria-hidden /> : iconFor(attachment.name, attachment.kind)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-fg">{attachment.name}</span>
        <span className={cn('truncate text-xs', failed ? 'text-warning' : 'text-fg-muted')}>{attachmentSummary(attachment)}</span>
      </span>
    </span>
  );
}

/** Gönderilmiş iletideki ekler (salt okunur). */
export function MessageAttachments({ attachments }: { attachments: readonly ChatAttachment[] | undefined }) {
  if (!attachments?.length) return null;
  return (
    <div className="flex max-w-full flex-col items-end gap-1.5" data-testid="msg-attachments">
      {attachments.map((attachment) => (
        <AttachmentCard key={attachment.id} attachment={attachment} className="w-[min(100%,300px)]" />
      ))}
    </div>
  );
}

/** Sürükle-bırak alanı: dosya üstüne gelince sakin bir kaplama, bırakınca ekler. */
export function useDropZone(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  return {
    over,
    handlers: {
      onDragEnter(event: DragEvent) {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current++;
        setOver(true);
      },
      onDragOver(event: DragEvent) {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave(event: DragEvent) {
        if (!hasFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop(event: DragEvent) {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
}

export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none absolute inset-3 z-(--z-raised) flex flex-col items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface-1/90 text-center',
        'transition-opacity duration-(--duration-fast) ease-out',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      data-testid="chat-drop"
      data-visible={visible}
    >
      <UploadSimple className="size-8 text-accent-fg" aria-hidden />
      <p className="text-lg text-fg">{t('documents.dropHere')}</p>
      <p className="max-w-[46ch] text-sm text-fg-muted">{t('documents.dropBody')}</p>
    </div>
  );
}
