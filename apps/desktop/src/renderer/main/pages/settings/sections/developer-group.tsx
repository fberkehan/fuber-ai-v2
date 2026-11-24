// Ayarlar › Genel › Geliştirici kipi (Katman 2): anahtar + kaynak klasörü seçici. Yönetim kapalı tutuyorsa anahtar kilitlidir
// ve nedeni yazılır. Sesle AÇILMAZ: yalnız bu sayfadan (`brain/local-settings.ts` › LOCAL_ONLY_SETTINGS).
import { useEffect, useState } from 'react';
import { FolderOpen } from '@phosphor-icons/react';
import { t, type Settings } from '@fuber/shared';
import { Button, Switch } from '@fuber/ui';
import { useShell } from '../../../shell/context';
import { Group, SettingRow, updateSettings } from '../kit';

export function DeveloperGroup({ settings }: { settings: Settings }) {
  const shell = useShell();
  const policyOn = shell.policy?.modules?.selfdev?.enabled !== false;
  const [check, setCheck] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const path = settings.developerRepoPath;
  useEffect(() => {
    if (!path) return setCheck(null);
    let live = true;
    window.fuber.invoke('selfdev.checkRepo', { path }).then(
      (result) => live && setCheck(result),
      () => live && setCheck(null),
    );
    return () => {
      live = false;
    };
  }, [path]);
  const pick = async () => {
    const result = await window.fuber.invoke('app.pickFile', { title: t('selfdev.settings.pickTitle'), directory: true });
    if (result.path) await updateSettings({ developerRepoPath: result.path });
  };
  return (
    <Group fill title={t('selfdev.settings.title')} description={t('selfdev.settings.description')}>
      <SettingRow label={t('selfdev.settings.switch')} description={policyOn ? undefined : t('selfdev.settings.policyOff')}>
        <Switch checked={settings.developerMode} disabled={!policyOn} onCheckedChange={(developerMode) => void updateSettings({ developerMode })} aria-label={t('selfdev.settings.switch')} data-testid="settings-developer" />
      </SettingRow>
      <SettingRow layout="stack" label={t('selfdev.settings.repo')} description={check ? (check.ok ? t('selfdev.settings.repoOk') : (check.reason ?? '')) : undefined}>
        <div className="flex w-full items-center gap-3">
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg-muted" title={path ?? ''} data-testid="settings-developer-repo">
            {path ?? t('selfdev.settings.repoNone')}
          </span>
          <Button size="sm" icon={<FolderOpen />} onClick={() => void pick()} data-testid="settings-developer-pick">
            {t('selfdev.settings.pick')}
          </Button>
        </div>
      </SettingRow>
    </Group>
  );
}
