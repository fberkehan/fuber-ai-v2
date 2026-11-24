import { AppWindow, ArrowClockwise, CloudSlash, SquaresFour, Timer, Wrench, type Icon } from '@phosphor-icons/react';
import { useId, useState, type KeyboardEvent, type RefObject } from 'react';
import { t, type MessageKey } from '@fuber/shared';
import { Button, Panel, Textarea } from '@fuber/ui';
import type { CloudStatus } from '../../../../main/modules/workshop/types';
import '../../plugins/plugins.css';

/** Eklenti türleri: her biri bir örnek istekle gelir; basınca istek kutusuna yazılır. */
const KINDS: Array<{ id: string; icon: Icon; title: MessageKey; example: MessageKey }> = [
  { id: 'card', icon: SquaresFour, title: 'pluginsUi.kind.card', example: 'pluginsUi.example.card' },
  { id: 'job', icon: Timer, title: 'pluginsUi.kind.job', example: 'pluginsUi.example.job' },
  { id: 'page', icon: AppWindow, title: 'pluginsUi.kind.page', example: 'pluginsUi.example.page' },
  { id: 'tool', icon: Wrench, title: 'pluginsUi.kind.tool', example: 'skills.example.fx' },
];
const MIN_CHARS = 8;

export interface ComposerProps {
  /** Bulut beyninin durumu; `null` = henüz bilinmiyor. */
  cloud: CloudStatus | null;
  probing: boolean;
  /** Onay bekleyen yetenek varken ekrandaki birincil eylem onaydır; bu düğme ikincil kalır. */
  quiet: boolean;
  onBuild(goal: string): Promise<void>;
  onRetryCloud(): void;
  /** İstek alanı (boş durumdaki "ilk yeteneği geliştir" buraya odaklar). */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

/**
 * Yetenek geliştirme alanı: sayfanın birincil kutusu. İstek kutusu, altında örnek istekler ve "Geliştir".
 * Derin beyin yokken düğme kapalıdır; nedeni kutunun altında sakin bir satırda yazar (uyarı rengi yalnız ikonda).
 */
export function Composer({ cloud, probing, quiet, onBuild, onRetryCloud, inputRef }: ComposerProps) {
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const down = cloud !== null && !cloud.ok;
  const ready = goal.trim().length >= MIN_CHARS && !down;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onBuild(goal.trim());
      setGoal('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    // İç boşluk öbür kutularla aynı (20 px): alt alta duran kutuların sol metin kenarı tek çizgide.
    <Panel tone="lead" padding="none" className="gap-4 p-5" aria-labelledby={`${id}-label`} data-testid="skills-composer">
      {/* Engel en üstte: kullanıcı yazmadan önce neden çalışmayacağını görür. Uyarı rengi yalnız ikonda. */}
      {down && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm bg-surface-3 py-2 pr-2 pl-3.5" aria-live="polite" data-testid="skills-cloud-down">
          <CloudSlash className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 basis-64 text-sm text-fg-muted">
            <span className="text-fg">{t('skills.new.cloudDown')}</span>
            {cloud?.reason ? ` ${cloud.reason}` : null}
          </p>
          <Button variant="ghost" size="sm" icon={<ArrowClockwise />} loading={probing} onClick={onRetryCloud}>
            {t('skills.new.cloudRetry')}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-fg">
          <label id={`${id}-label`} htmlFor={id}>
            {t('pluginsUi.new.label')}
          </label>
        </h2>
        <p id={`${id}-hint`} className="max-w-[72ch] text-sm text-fg-muted">
          {t('pluginsUi.new.hint')}
        </p>
      </div>
      {/* İstek kutusu tek satır başlar, yazdıkça büyür; "Geliştir" kutunun yanında, aynı satırda. Geniş kapta ölçü sınırlıdır. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <Textarea
              ref={inputRef}
              id={id}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('pluginsUi.new.placeholder')}
              minRows={1}
              maxRows={8}
              maxLength={2000}
              disabled={down}
              aria-describedby={`${id}-hint`}
              invalid={error !== null}
              data-testid="skills-goal"
            />
          </div>
          <Button
            variant={quiet ? 'secondary' : 'primary'}
            // Devre dışı hâl okunur kalır: koyu zeminde silik gri değil, açık yüzey + okunur yazı.
            className="shrink-0 disabled:bg-surface-5 disabled:text-fg-muted"
            disabled={!ready}
            loading={busy}
            onClick={() => void submit()}
            data-testid="skills-build"
          >
            {t('skills.new.submit')}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {!down && (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg-muted">{t('pluginsUi.new.kindsLabel')}</span>
            <div className="plg-kinds" data-testid="skills-kinds">
              {KINDS.map(({ id: kind, icon: KindIcon, title, example }) => (
                <button key={kind} type="button" className="plg-kind" onClick={() => setGoal(t(example))} data-testid="skills-example" data-kind={kind}>
                  <span className="plg-kind-head">
                    <KindIcon aria-hidden />
                    {t(title)}
                  </span>
                  <span className="plg-kind-example">{t(example)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
