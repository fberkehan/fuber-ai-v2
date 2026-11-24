// Ayarlar › Gizlilik: asistanın kendi tarayıcısı. İzin anahtarı (kapalıyken araçları kayıtlı değil), pencereyi açma
// (kullanıcı bir siteye kendisi giriş yapar) ve bu tarayıcının bütün oturumlarını silme.
// Kutu ve satırlar `kit.tsx`'in yapı taşlarıdır: arama bu satırları da bulur.
import { useState } from 'react';
import { AppWindow, Trash } from '@phosphor-icons/react';
import { t, type Settings } from '@fuber/shared';
import { Button, Switch, toast } from '@fuber/ui';
import { attempt } from '../../shell/live';
import { ConfirmDialog } from '../../shell/parts';
import { Group, SettingRow } from './kit';
// Kanal tipleri modül klasöründeki genişletmededir (`jbrowser.show`, `jbrowser.clearData`).
import type {} from '../../../../main/modules/browser/types';

export function JarvisBrowserPrivacy({ settings, name }: { settings: Settings; name: string }) {
  const [confirm, setConfirm] = useState(false);
  const allowed = settings.jbrowserAllowed !== false;
  const toggle = (jbrowserAllowed: boolean) => void attempt(() => window.fuber.invoke('settings.update', { patch: { jbrowserAllowed } }));
  const clear = async () => {
    setConfirm(false);
    const done = await attempt(() => window.fuber.invoke('jbrowser.clearData'));
    if (done) toast.success(t('jbrowser.settings.cleared'));
  };
  return (
    <Group title={t('jbrowser.settings.title', { name })} description={t('jbrowser.settings.hint', { name })} keywords={t('settings.kw.jbrowser')} testId="settings-jbrowser">
      <SettingRow label={t('jbrowser.settings.allow', { name })} description={t('jbrowser.settings.allowHint', { name })}>
        <Switch checked={allowed} onCheckedChange={toggle} aria-label={t('jbrowser.settings.allow', { name })} data-testid="settings-jbrowser-allow" />
      </SettingRow>
      <SettingRow label={t('jbrowser.settings.window')} description={t('jbrowser.settings.windowHint')}>
        <Button size="sm" icon={<AppWindow />} disabled={!allowed} onClick={() => void attempt(() => window.fuber.invoke('jbrowser.show'))} data-testid="settings-jbrowser-open">
          {t('jbrowser.settings.open')}
        </Button>
      </SettingRow>
      <SettingRow label={t('jbrowser.settings.sessions')} description={t('jbrowser.settings.sessionsHint')}>
        <Button size="sm" icon={<Trash />} onClick={() => setConfirm(true)} data-testid="settings-jbrowser-clear">
          {t('jbrowser.settings.clear')}
        </Button>
      </SettingRow>
      <ConfirmDialog
        open={confirm}
        title={t('jbrowser.settings.clear')}
        body={t('jbrowser.settings.sessionsHint')}
        confirmLabel={t('jbrowser.settings.clear')}
        onOpenChange={setConfirm}
        onConfirm={clear}
      />
    </Group>
  );
}
