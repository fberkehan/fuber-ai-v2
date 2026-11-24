// Ayarlar › Kısayollar: her yerden çalışan genel kısayollar (birincil kutu) ve yalnız bu pencerede çalışanlar.
import { Warning } from '@phosphor-icons/react';
import { t, type HotkeyId, type Settings } from '@fuber/shared';
import { Badge, KeyHint, Skeleton } from '@fuber/ui';
import { acceleratorKeys, useLive } from '../../../shell/live';
import { ErrorPanel } from '../../../shell/parts';
import { Column, Group, Rows, SectionGrid, SettingRow } from '../kit';

export function Hotkeys({ settings }: { settings: Settings }) {
  const hotkeys = useLive(() => window.fuber.invoke('settings.hotkeys'), ['settings.changed']);
  // Kayıt durumu yalnız denenen kısayollar için gelir; ayardaki her kısayol gösterilir, durumu yoksa "kaydedilemedi".
  const status = hotkeys.data ?? [];
  const list = (Object.entries(settings.hotkeys) as Array<[HotkeyId, string]>).map(
    ([id, accelerator]) => status.find((hotkey) => hotkey.id === id) ?? { id, accelerator, registered: false },
  );
  for (const hotkey of status) if (!list.some((item) => item.id === hotkey.id)) list.push(hotkey);
  const loading = hotkeys.state.status === 'loading';
  const failed = loading ? [] : list.filter((hotkey) => !hotkey.registered);
  return (
    <SectionGrid>
      <Group tone="lead" span="lead" title={t('settings.hotkeys.title')} description={t('settings.hotkeys.hint')} keywords={t('settings.kw.hotkeys')}>
        {hotkeys.state.status === 'error' ? (
          <ErrorPanel message={hotkeys.state.message} onRetry={hotkeys.reload} />
        ) : (
          <Rows columns={180}>
            {list.map((hotkey) => (
              <SettingRow
                key={hotkey.id}
                layout="stack"
                label={t(`settings.hotkeys.${hotkey.id as HotkeyId}`)}
                description={t(`settings.hotkeys.${hotkey.id as HotkeyId}Hint`)}
                testId={`hotkey-${hotkey.id}`}
              >
                {loading ? <Skeleton className="h-6 w-24" /> : <KeyHint keys={acceleratorKeys(hotkey.accelerator)} />}
                {!loading && !hotkey.registered && (
                  <Badge tone="warning" dot>
                    {t('settings.hotkeys.notRegistered')}
                  </Badge>
                )}
              </SettingRow>
            ))}
          </Rows>
        )}
        {failed.length > 0 && (
          <p className="flex items-start gap-2.5 pt-4 text-sm text-fg-muted" role="status" data-testid="settings-hotkey-warning">
            <Warning weight="fill" className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {t('settings.hotkeys.failed', { count: failed.length })}
          </p>
        )}
      </Group>
      <Column span="rest">
        <Group columns={180} title={t('settings.hotkeys.window')} description={t('settings.hotkeys.windowHint')}>
          <SettingRow layout="stack" label={t('settings.hotkeys.pages')} description={t('settings.hotkeys.pagesHint')}>
            <span className="flex items-center gap-1.5">
              <KeyHint keys={['Ctrl', '1']} />
              <span className="text-sm leading-none text-fg-faint" aria-hidden>
                ile
              </span>
              <KeyHint keys={['Ctrl', '8']} />
            </span>
          </SettingRow>
          <SettingRow layout="stack" label={t('settings.hotkeys.search')} description={t('settings.hotkeys.searchHint')}>
            <KeyHint keys={['Ctrl', 'F']} />
          </SettingRow>
        </Group>
      </Column>
    </SectionGrid>
  );
}
