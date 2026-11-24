// Detay paneli › "Güncelle": "Şunu da ekle…" isteği. İş arka planda yürür; hazır olunca onay kartı çıkar.
import { useId, useState } from 'react';
import { t } from '@fuber/shared';
import { Button, Textarea, toast } from '@fuber/ui';
import { errorText } from '../shell/live';

const MIN_CHARS = 6;

export function UpdateForm({ skillId, skillName, busyUpdating, blocked }: { skillId: string; skillName: string; busyUpdating: boolean; blocked: string | null }) {
  const id = useId();
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = change.trim().length >= MIN_CHARS && !blocked && !busyUpdating;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.fuber.invoke('workshop.update', { id: skillId, change: change.trim() });
      setChange('');
      toast.success(t('pluginsUi.updateForm.started', { name: skillName }));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="plugin-update-form">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {t('pluginsUi.updateForm.label')}
        </label>
        <p className="text-sm text-fg-muted">{t('pluginsUi.updateForm.hint')}</p>
      </div>
      <Textarea
        id={id}
        value={change}
        onChange={(event) => setChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={t('pluginsUi.updateForm.placeholder')}
        minRows={2}
        maxRows={8}
        maxLength={2000}
        disabled={!!blocked || busyUpdating}
        invalid={error !== null}
        data-testid="plugin-update-input"
      />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {(blocked || busyUpdating) && <p className="text-sm text-fg-faint">{blocked ?? t('pluginsUi.updateForm.inProgress')}</p>}
      <Button variant="primary" size="sm" className="self-start" disabled={!ready} loading={busy} onClick={() => void submit()} data-testid="plugin-update-submit">
        {t('pluginsUi.updateForm.submit')}
      </Button>
    </div>
  );
}
