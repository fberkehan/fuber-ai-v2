// Ayarlar › Gizlilik ve veri: bilgisayarı kullanma izinleri ve fare-klavye sınaması (birincil kutu), kendi tarayıcısı,
// verilerin yeri, dosya erişimi, ortam dinleme, Gizli kip, eski sürümden aktarma.
import { FolderOpen } from '@phosphor-icons/react';
import { t, type Settings } from '@fuber/shared';
import { Button, Switch } from '@fuber/ui';
import { useShell } from '../../../shell/context';
import { attempt } from '../../../shell/live';
import { AmbientPrivacy } from '../AmbientPrivacy';
import { DataLifecycle } from '../DataLifecycle';
import { JarvisBrowserPrivacy } from '../JarvisBrowser';
import { PcSelftest } from '../pc-selftest';
import { FileAccess } from '../files';
import { ImportV1Section } from '../import-v1';
import { Column, Fact, Facts, Group, ManagedNote, PathText, SectionGrid, SettingRow, updateSettings } from '../kit';

/** Cihaz düzeyindeki iki izin: kapalı iznin araçları modele hiç sunulmaz (bilgisayar modülü kaydı canlı günceller). */
function ComputerUse({ settings, name }: { settings: Settings; name: string }) {
  const stop = settings.hotkeys.panic ? ` ${t('pc.settings.controlStop', { hotkey: settings.hotkeys.panic.replace(/Control/g, 'Ctrl') })}` : '';
  return (
    <Group tone="lead" columns={300} title={t('pc.settings.title')} description={t('pc.settings.hint', { name })} keywords={t('settings.kw.pc')}>
      <SettingRow label={t('pc.settings.control', { name })} description={`${t('pc.settings.controlHint')}${stop}`}>
        <Switch
          checked={settings.pcControlAllowed}
          onCheckedChange={(pcControlAllowed) => void updateSettings({ pcControlAllowed })}
          aria-label={t('pc.settings.control', { name })}
          data-testid="settings-pc-control"
        />
      </SettingRow>
      <SettingRow label={t('pc.settings.read', { name })} description={t('pc.settings.readHint')}>
        <Switch
          checked={settings.pcReadAllowed}
          onCheckedChange={(pcReadAllowed) => void updateSettings({ pcReadAllowed })}
          aria-label={t('pc.settings.read', { name })}
          data-testid="settings-pc-read"
        />
      </SettingRow>
      <PcSelftest enabled={settings.pcControlAllowed} />
    </Group>
  );
}

export function Privacy() {
  const shell = useShell();
  const documentsOn = shell.modules?.some((module) => module.id === 'documents' && module.enabled) !== false;
  // Kendi tarayıcısı modülü Yönetim'den kapatılınca izin kutusu da kalkar.
  const browserOn = shell.modules?.some((module) => module.id === 'browser' && module.enabled) !== false;
  return (
    <SectionGrid>
      <Column span="main">
        {shell.settings && <ComputerUse settings={shell.settings} name={shell.name} />}
        {shell.settings && browserOn && <JarvisBrowserPrivacy settings={shell.settings} name={shell.name} />}
        {documentsOn && <FileAccess />}
        <AmbientPrivacy />
        <DataLifecycle />
      </Column>
      <Column span="side">
        <Group title={t('settings.privacy.where')} keywords={t('settings.kw.data')}>
          <SettingRow
            label={t('settings.privacy.dataDir')}
            description={
              <PathText path={shell.info?.dataDir ?? '…'} className="block text-fg" />
            }
          >
            <Button size="sm" icon={<FolderOpen />} onClick={() => void attempt(() => window.fuber.invoke('settings.openDataDir'))} data-testid="settings-open-data">
              {t('settings.privacy.open')}
            </Button>
          </SettingRow>
          <Facts min={190} className="pt-4">
            <Fact label={t('settings.privacy.audio')}>
              <span className="text-sm text-fg-muted">{t('settings.privacy.audioBody')}</span>
            </Fact>
            <Fact label={t('settings.privacy.memory')}>
              <span className="text-sm text-fg-muted">{t('settings.privacy.memoryBody', { name: shell.name })}</span>
            </Fact>
            <Fact label={t('settings.privacy.keys')}>
              <span className="text-sm text-fg-muted">{t('settings.privacy.keysBody')}</span>
            </Fact>
          </Facts>
        </Group>
        <Group title={t('settings.privacy.mode')} action={<ManagedNote />} keywords={t('settings.kw.private')}>
          <SettingRow label={shell.settings?.privacyMode === 'private' ? t('settings.privacy.private') : t('settings.privacy.cloud')} description={t('settings.privacy.modeBody')} />
        </Group>
        <ImportV1Section />
      </Column>
    </SectionGrid>
  );
}
