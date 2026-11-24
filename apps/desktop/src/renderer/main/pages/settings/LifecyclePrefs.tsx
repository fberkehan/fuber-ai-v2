// Ayarlar › Genel › Uygulama: pencereyi kapatınca ne olsun (sor / arka planda / çık) ve açılış sesi.
// Tercihler `lifecycle.prefs` kanalındadır (yerel ayar nesnesine eklenmez); kapanış diyaloğundaki "Bir daha sorma" da buraya yazar.
import { useEffect, useState } from 'react';
import { t, type CloseAction, type LifecyclePrefs } from '@fuber/shared';
import { Segmented, Switch, toast } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt } from '../../shell/live';
import { SettingRow } from './kit';

export function LifecyclePrefsRows() {
  const shell = useShell();
  const [prefs, setPrefs] = useState<LifecyclePrefs | null>(null);
  useEffect(() => {
    void window.fuber.invoke('lifecycle.prefs').then(setPrefs, () => {});
  }, []);
  const save = async (patch: Partial<LifecyclePrefs>) => {
    const next = await attempt(() => window.fuber.invoke('lifecycle.setPrefs', { patch }));
    if (next) {
      setPrefs(next);
      toast.success(t('settings.saved'));
    }
  };
  if (!prefs) return null;
  return (
    <>
      <SettingRow label={t('lifecycle.prefs.close')} description={t('lifecycle.prefs.closeHint', { name: shell.name })} testId="settings-close-row">
        <Segmented<CloseAction>
          size="sm"
          value={prefs.closeAction}
          onChange={(closeAction) => void save({ closeAction })}
          options={[
            { value: 'ask', label: t('lifecycle.prefs.close.ask') },
            { value: 'background', label: t('lifecycle.prefs.close.background') },
            { value: 'quit', label: t('lifecycle.prefs.close.quit') },
          ]}
          aria-label={t('lifecycle.prefs.close')}
          data-testid="settings-close-action"
        />
      </SettingRow>
      <SettingRow label={t('lifecycle.prefs.chime')} description={t('lifecycle.prefs.chimeHint')}>
        <Switch
          checked={prefs.startupSound}
          onCheckedChange={(startupSound) => void save({ startupSound })}
          aria-label={t('lifecycle.prefs.chime')}
          data-testid="settings-startup-sound"
        />
      </SettingRow>
    </>
  );
}
