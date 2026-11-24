// Yazma kutusu (v1 `Yazici.tsx`): Enter gönderir, Shift+Enter satır açar; tur sürerken yazılan ileti sıraya girer (sıradakiler
// görünür ve tek tek kaldırılır); "/" komut paleti, "@" dosya önerisi, görsel yapıştırma/ekleme; Esc süren turu durdurur.
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '@fuber/shared';
import { Button, IconButton, Textarea, cn } from '@fuber/ui';
import { File as FileIcon, Image as ImageIcon, PaperPlaneRight, Command, Stop, X } from '@phosphor-icons/react';
import type { LiveCommand, LiveImage, LiveOpResult } from '../../../../../main/modules/projects/claude/types';
import { errorText } from '../shared';
import { completeTrigger, filterCommands, findTrigger, type Trigger } from './format';

const MEDIA_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 10;
/** base64 uzunluğu sınırı (ana süreçteki sınırla aynı). */
const MAX_IMAGE_CHARS = 6 * 1024 * 1024;

interface Attachment extends LiveImage {
  name: string;
}

/** Oturum başına taslak: oturum değiştirilip dönülünce yazılan kaybolmasın. */
const drafts = new Map<string, { text: string; images: Attachment[] }>();
export const clearDraft = (key: string) => void drafts.delete(key);

function readImage(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    if (!MEDIA_TYPES.has(file.type)) return resolve(null);
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      const data = url.slice(url.indexOf(',') + 1);
      resolve(data && data.length <= MAX_IMAGE_CHARS ? { mediaType: file.type as LiveImage['mediaType'], data, name: file.name || file.type } : null);
    };
    reader.readAsDataURL(file);
  });
}

interface Suggestion {
  value: string;
  label: string;
  hint?: string;
  description?: string;
}

export interface ComposerProps {
  /** Taslak anahtarı (oturum kimliği). */
  draftKey: string;
  onSend(text: string, images: LiveImage[]): Promise<LiveOpResult>;
  /** Tur sürüyor: Esc ve durdur düğmesi görünür; gönderilen ileti sıraya girer. */
  busy?: boolean;
  onStop?(): void;
  commands?: readonly LiveCommand[];
  /** "@" dosya önerisi; verilmezse öneri yok. */
  searchFiles?(query: string): Promise<string[]>;
  queue?: ReadonlyArray<{ id: string; text: string; images: number }>;
  onRemoveQueued?(messageId: string): void;
  placeholder?: string;
  inputTestId?: string;
  sendTestId?: string;
  /** Kutunun altındaki satırın solu (kip/model seçimi). */
  footer?: ReactNode;
  disabled?: boolean;
  /** Dar yerde: kutu tek satırdan başlar. */
  compact?: boolean;
  /** Kutu, dökümün ortalı sütunuyla aynı genişlikte durur (geniş bölmede bir uçtan öbürüne gerilmez). */
  column?: boolean;
}

export function Composer({
  draftKey,
  onSend,
  busy = false,
  onStop,
  commands,
  searchFiles,
  queue,
  onRemoveQueued,
  placeholder,
  inputTestId = 'live-composer-input',
  sendTestId = 'live-send',
  footer,
  disabled,
  compact = false,
  column = false,
}: ComposerProps) {
  const initial = drafts.get(draftKey);
  const [text, setText] = useState(initial?.text ?? '');
  const [images, setImages] = useState<Attachment[]>(initial?.images ?? []);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fileQuery = useRef(0);

  useEffect(() => {
    const draft = drafts.get(draftKey);
    setText(draft?.text ?? '');
    setImages(draft?.images ?? []);
    setError('');
    setTrigger(null);
  }, [draftKey]);

  useEffect(() => {
    if (text || images.length) drafts.set(draftKey, { text, images });
    else drafts.delete(draftKey);
  }, [draftKey, text, images]);

  // "@" önerisi: yazarken her tuşta değil, kısa bir duraksamadan sonra sorulur; eski yanıt yenisini ezmez.
  useEffect(() => {
    if (trigger?.kind !== 'file' || !searchFiles) {
      setFiles([]);
      return;
    }
    const request = ++fileQuery.current;
    const timer = setTimeout(() => {
      void searchFiles(trigger.query)
        .then((list) => request === fileQuery.current && setFiles(list))
        .catch(() => request === fileQuery.current && setFiles([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [trigger?.kind, trigger?.query, searchFiles]);

  const suggestions: Suggestion[] =
    trigger?.kind === 'command'
      ? filterCommands(commands ?? [], trigger.query, 30).map((command) => ({
          value: command.name,
          label: `/${command.name}`,
          ...(command.argumentHint ? { hint: command.argumentHint } : {}),
          ...(command.description ? { description: command.description } : {}),
        }))
      : trigger?.kind === 'file'
        ? files.map((file) => ({ value: file, label: file }))
        : [];
  const open = suggestions.length > 0;

  useEffect(() => setActive(0), [trigger?.kind, trigger?.query]);

  const syncTrigger = (value: string, cursor: number | null) => setTrigger(findTrigger(value, cursor ?? value.length));

  const choose = (suggestion: Suggestion) => {
    if (!trigger) return;
    const next = completeTrigger(text, trigger, suggestion.value);
    setText(next.text);
    setTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const addFiles = useCallback(async (list: Iterable<File>) => {
    const read = (await Promise.all([...list].map(readImage))).filter((item): item is Attachment => item !== null);
    if (read.length === 0) {
      setError(t('projects.live.composer.badImage'));
      return;
    }
    setError('');
    setImages((current) => [...current, ...read].slice(0, MAX_IMAGES));
  }, []);

  const send = async () => {
    const value = text.trim();
    if ((!value && images.length === 0) || sending || disabled) return;
    setSending(true);
    setError('');
    try {
      const result = await onSend(text, images.map(({ mediaType, data }) => ({ mediaType, data })));
      if (result.ok) {
        setText('');
        setImages([]);
        setTrigger(null);
        drafts.delete(draftKey);
      } else {
        // İleti gitmediyse kutudaki metin korunur.
        setError(result.error ?? '');
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const picked = suggestions[active];
        if (picked) choose(picked);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === 'Escape' && busy && onStop) {
      event.preventDefault();
      onStop();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (pasted.length === 0) return;
    event.preventDefault();
    void addFiles(pasted);
  };

  return (
    <div className="shrink-0 border-t border-line px-5 py-3">
    <div className={cn('flex flex-col gap-2', column && 'mx-auto w-full max-w-3xl')}>
      {queue && queue.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t('projects.live.composer.queue')}>
          {queue.map((message, index) => (
            <li key={message.id} data-testid="live-queue-item" className="flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-1.5 text-xs text-fg-muted">
              <span className="shrink-0 text-fg-faint tabular-nums">{t('projects.live.composer.queued', { n: index + 1 })}</span>
              <span className="min-w-0 flex-1 truncate">{message.text || t('projects.live.images', { n: message.images })}</span>
              {onRemoveQueued && <IconButton size="sm" label={t('projects.live.composer.removeQueued')} icon={<X />} onClick={() => onRemoveQueued(message.id)} />}
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('projects.live.composer.attachments')}>
          {images.map((image, index) => (
            <li key={index} className="flex items-center gap-1.5 rounded-sm bg-surface-3 py-1 pr-1 pl-2 text-xs text-fg-muted">
              <ImageIcon className="size-3.5" aria-hidden />
              <span className="max-w-40 truncate">{image.name}</span>
              <IconButton size="sm" label={t('projects.live.composer.removeImage')} icon={<X />} onClick={() => setImages((current) => current.filter((_, at) => at !== index))} />
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        {open && (
          <ul
            role="listbox"
            aria-label={trigger?.kind === 'command' ? t('projects.live.composer.commands') : t('projects.live.composer.files')}
            data-testid="live-suggestions"
            className="absolute right-0 bottom-full left-0 z-(--z-raised) mb-1 max-h-64 overflow-y-auto rounded-sm border border-line bg-surface-3 p-1 shadow-raise"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.value}
                role="option"
                aria-selected={index === active}
                data-value={suggestion.value}
                onMouseDown={(event) => {
                  // Kutunun odağı kaybolmasın.
                  event.preventDefault();
                  choose(suggestion);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn('flex cursor-pointer items-baseline gap-2 rounded-xs px-2.5 py-1.5 text-sm', index === active ? 'bg-surface-5 text-fg' : 'text-fg-muted')}
              >
                {trigger?.kind === 'command' ? <Command className="size-3.5 shrink-0 self-center text-fg-faint" aria-hidden /> : <FileIcon className="size-3.5 shrink-0 self-center text-fg-faint" aria-hidden />}
                <span className="shrink-0 font-mono text-xs text-fg">{suggestion.label}</span>
                {suggestion.hint && <span className="shrink-0 font-mono text-xs text-fg-faint">{suggestion.hint}</span>}
                {suggestion.description && <span className="min-w-0 truncate text-xs text-fg-faint">{suggestion.description}</span>}
              </li>
            ))}
          </ul>
        )}
        <Textarea
          ref={inputRef}
          data-testid={inputTestId}
          minRows={compact ? 1 : 2}
          maxRows={compact ? 6 : 10}
          value={text}
          disabled={disabled}
          placeholder={placeholder ?? (busy ? t('projects.live.composer.placeholderBusy') : t('projects.live.composer.placeholder'))}
          aria-label={t('projects.live.composer.label')}
          onChange={(event) => {
            setText(event.target.value);
            syncTrigger(event.target.value, event.target.selectionStart);
          }}
          onSelect={(event) => syncTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setTrigger(null)}
        />
      </div>
      {error && (
        <p role="alert" data-testid="live-composer-error" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {footer && <div className="flex min-w-0 flex-1 basis-72 items-center gap-2 [&>*]:max-w-52">{footer}</div>}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <IconButton size="sm" label={t('projects.live.composer.attach')} icon={<ImageIcon />} disabled={disabled || images.length >= MAX_IMAGES} onClick={() => fileRef.current?.click()} />
        {busy && onStop && (
          <Button size="sm" variant="secondary" icon={<Stop weight="fill" />} data-testid="live-stop" onClick={onStop}>
            {t('projects.live.stop')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          icon={<PaperPlaneRight />}
          loading={sending}
          disabled={disabled || (!text.trim() && images.length === 0)}
          data-testid={sendTestId}
          onClick={() => void send()}
        >
          {busy ? t('projects.live.composer.queueSend') : t('projects.live.composer.send')}
        </Button>
      </div>
    </div>
    </div>
  );
}
