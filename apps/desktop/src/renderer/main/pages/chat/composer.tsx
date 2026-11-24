// Yazı alanı: ek, yazı, mikrofon, gönder; iş sürerken "Durdur". Tuş ipucu yer tutucunun yanında rozetle durur.
// İki yerleşim: `inline` (varsayılan; tek satır, Bugün sayfası da bunu kullanır) ve `stacked` (Sohbet: üstte yazı,
// altta araç şeridi). Dışa aktarımın adı ve zorunlu prop'ları sabittir; yeni prop'lar isteğe bağlıdır.
import type { ClipboardEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import { ArrowUp, Microphone, SpeakerSlash, Stop } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, IconButton, KeyHint, Textarea, cn } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt } from '../../shell/live';
import { stopVoice, voiceBusy } from '../../shell/voice-stop';
import { AttachButton, PendingChips, type Attachments } from './attachments';
import './chat.css';

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  inputRef,
  attachments,
  localBrain,
  variant = 'inline',
  note,
}: {
  attachments: Attachments;
  localBrain: boolean;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** `stacked`: Sohbet sayfasının iki satırlı kutusu (yazı üstte, araçlar altta). */
  variant?: 'inline' | 'stacked';
  /** Yalnız `stacked`: araç şeridinin ortasında tek satır sakin not (beyin durumu). */
  note?: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!streaming && !attachments.reading) onSend();
  };
  const canSend = (value.trim().length > 0 || attachments.ready.length > 0) && !attachments.reading;
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) {
      event.preventDefault();
      void attachments.addFiles(files);
    }
  };
  // Asistan sesle konuşuyor ya da çalışıyorsa mikrofon düğmesi aynı yerde "Sustur / Durdur" olur (demo.5).
  const voiceState = useShell().voice?.state;
  const mic = voiceBusy(voiceState) ? (
    <IconButton
      icon={voiceState === 'speaking' ? <SpeakerSlash weight="fill" /> : <Stop weight="fill" />}
      label={voiceState === 'speaking' ? t('voice.action.stop') : t('turn.stop')}
      size="sm"
      variant="danger"
      shortcut={['Esc']}
      onClick={stopVoice}
      data-testid="chat-voice-stop"
    />
  ) : (
    <IconButton
      icon={<Microphone />}
      label={t('chat.voice')}
      size="sm"
      onClick={() => void attempt(() => window.fuber.invoke('voice.listen'))}
      data-testid="chat-mic"
    />
  );
  const sendOrStop = streaming ? (
    <Button size="sm" variant="secondary" icon={<Stop weight="fill" />} onClick={onStop} data-testid="chat-stop">
      {t('chat.stop')}
    </Button>
  ) : (
    <IconButton icon={<ArrowUp weight="bold" />} label={t('chat.send')} variant="primary" size="sm" disabled={!canSend} onClick={onSend} data-testid="chat-send" />
  );

  if (variant === 'stacked') {
    return (
      <div className="flex flex-col gap-2">
        <PendingChips attachments={attachments} localBrain={localBrain} />
        <div className="chat-composer">
          <div className="chat-composer-field relative">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder={streaming ? t('chat.placeholderStreaming') : t('chat.placeholder')}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              aria-label={t('chat.placeholder')}
              data-testid="chat-input"
            />
          </div>
          <div className="chat-composer-tools flex items-center gap-2 px-2 pt-1 pb-2">
            <AttachButton onPick={() => void attachments.pick()} disabled={streaming} />
            <div className="chat-composer-note min-w-0 flex-1 truncate text-xs text-fg-faint">{note}</div>
            {!streaming && (
              <span aria-hidden className="chat-hint hidden shrink-0 items-center gap-1.5 pr-1 text-xs text-fg-faint @min-[560px]/workspace:flex" data-testid="chat-hint">
                <KeyHint keys={['Enter']} size="sm" />
                {t('chat.enterHint')}
              </span>
            )}
            {mic}
            {sendOrStop}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <PendingChips attachments={attachments} localBrain={localBrain} />
      <div className="relative">
        <div className="absolute bottom-2 left-2 z-(--z-raised)">
          <AttachButton onPick={() => void attachments.pick()} disabled={streaming} />
        </div>
        {value.length === 0 && !streaming && (
          <span aria-hidden className="pointer-events-none absolute top-0 left-12 flex h-11 items-center gap-2 text-base text-fg-faint" data-testid="chat-hint">
            {t('chat.placeholder')}
            <KeyHint keys={['Enter']} size="sm" />
            <span className="text-sm">{t('chat.enterHint')}</span>
          </span>
        )}
        <Textarea
          ref={inputRef}
          minRows={1}
          maxRows={8}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-label={t('chat.placeholder')}
          className={cn(
            'rounded-md py-3 pl-12 focus:border-line-strong focus:shadow-[0_0_0_3px_rgb(255_255_255/0.05)]',
            streaming ? 'pr-44' : 'pr-24',
          )}
          data-testid="chat-input"
        />
        <div className="absolute right-2 bottom-2 flex items-center gap-1">
          {mic}
          {sendOrStop}
        </div>
      </div>
    </div>
  );
}
