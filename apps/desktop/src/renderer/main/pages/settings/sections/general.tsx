// Ayarlar › Genel: yetki düzeyi (birincil kutu), size nasıl seslenildiği, uygulamanın davranışı.
import { Check, Circle } from '@phosphor-icons/react';
import { t, type AuthorityLevel, type Settings } from '@fuber/shared';
import { Badge, Button, Segmented, Select, Switch } from '@fuber/ui';
import { useAuthority } from '../../../shell/authority';
import { useShell } from '../../../shell/context';
import { attempt } from '../../../shell/live';
import { DeveloperGroup } from './developer-group';
import { LifecyclePrefsRows } from '../LifecyclePrefs';
import { Column, CommitInput, Group, SectionGrid, SettingRow, updateSettings } from '../kit';

const LEVELS: AuthorityLevel[] = ['ask', 'smart', 'full'];
const RANK: Record<AuthorityLevel, number> = { ask: 0, smart: 1, full: 2 };

/** Yetki düzeyi: Jarvis hangi adımlarda onay istesin; geçici Tam yetki; sesli ilerleme. */
function Authority({ settings }: { settings: Settings }) {
  const { state, reload } = useAuthority();
  const set = async (request: { level?: AuthorityLevel; minutes?: number; task?: boolean; clearGrant?: boolean }) => {
    const result = await attempt(() => window.fuber.invoke('authority.set', request));
    if (result) reload();
  };
  const base = state?.base ?? settings.authorityLevel;
  const max = state?.max ?? 'full';
  const capped = RANK[max] < RANK.full;
  const grant = state?.grant ?? null;
  const grantUntil = grant?.scope === 'time' && grant.until ? new Date(grant.until).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : null;
  const grantNote = grant ? (grant.scope === 'time' ? t('authority.grant.activeTime', { time: grantUntil ?? '' }) : t('authority.grant.activeTask')) : null;
  const canGrant = RANK[max] >= RANK.full;
  return (
    <Group tone="lead" span="lead" title={t('authority.title')} description={t('authority.intro')} keywords={t('authority.level.ask')} testId="settings-authority">
      {LEVELS.map((level) => {
        const selected = base === level;
        const disabled = RANK[level] > RANK[max];
        return (
          <SettingRow
            key={level}
            label={
              <span className="flex flex-wrap items-center gap-2">
                {t(`authority.level.${level}`)}
                {level === 'smart' ? <Badge tone="accent">{t('authority.recommended')}</Badge> : null}
              </span>
            }
            description={t(`authority.level.${level}.desc`)}
          >
            <Button
              size="sm"
              variant={selected ? 'primary' : 'secondary'}
              role="radio"
              aria-checked={selected}
              aria-label={t(`authority.level.${level}`)}
              disabled={disabled}
              icon={selected ? <Check weight="bold" /> : <Circle />}
              onClick={() => !selected && void set({ level })}
              data-testid={`authority-level-${level}`}
              data-selected={selected ? '' : undefined}
            />
          </SettingRow>
        );
      })}
      {capped ? <p className="st-row-note px-1 pt-2" data-tone="warning" role="status">{t('authority.capped', { level: t(`authority.level.${max}`) })}</p> : null}
      <SettingRow
        layout="stack"
        label={t('authority.grant.title')}
        note={grantNote}
        noteTone="warning"
        testId="authority-grant-status"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!canGrant} onClick={() => void set({ minutes: 60 })} data-testid="authority-grant-hour">
              {t('authority.grant.hour')}
            </Button>
            <Button size="sm" disabled={!canGrant} onClick={() => void set({ task: true })} data-testid="authority-grant-task">
              {t('authority.grant.task')}
            </Button>
            {grant ? (
              <Button size="sm" variant="ghost" onClick={() => void set({ clearGrant: true })} data-testid="authority-grant-clear">
                {t('authority.grant.clear')}
              </Button>
            ) : null}
          </div>
        }
      />
      <SettingRow label={t('authority.progress.title')} description={t('authority.progress.desc')}>
        <Switch checked={settings.spokenProgress} onCheckedChange={(spokenProgress) => void updateSettings({ spokenProgress })} aria-label={t('authority.progress.title')} data-testid="settings-spoken-progress" />
      </SettingRow>
    </Group>
  );
}

export function General({ settings }: { settings: Settings }) {
  const shell = useShell();
  return (
    <SectionGrid>
      <Authority settings={settings} />
      <Column span="rest">
        <Group fill title={t('settings.general.you')} description={t('settings.general.youHint', { name: shell.name })}>
          <SettingRow layout="stack" label={t('settings.general.name')} description={t('settings.general.nameHint')}>
            <CommitInput
              value={settings.userName ?? ''}
              placeholder={t('settings.general.namePlaceholder')}
              aria-label={t('settings.general.name')}
              onCommit={(value) => void updateSettings({ userName: value || null })}
              frameClassName="w-full"
              testId="settings-name"
            />
          </SettingRow>
          <SettingRow layout="stack" label={t('settings.general.address')} description={t('settings.general.addressHint', { address: shell.policy?.persona.address ?? '' })}>
            <CommitInput
              value={settings.userAddress ?? ''}
              placeholder={shell.policy?.persona.address ?? ''}
              aria-label={t('settings.general.address')}
              onCommit={(value) => void updateSettings({ userAddress: value || null })}
              frameClassName="w-full"
              testId="settings-address"
            />
          </SettingRow>
        </Group>
        <Group fill title={t('settings.general.app')}>
          <SettingRow label={t('settings.general.autostart')} description={t('settings.general.autostartHint')} keywords={t('settings.kw.autostart')}>
            <Switch checked={settings.launchAtLogin} onCheckedChange={(launchAtLogin) => void updateSettings({ launchAtLogin })} aria-label={t('settings.general.autostart')} data-testid="settings-autostart" />
          </SettingRow>
          <LifecyclePrefsRows />
          <SettingRow label={t('settings.general.language')} description={t('settings.general.languageHint')}>
            <Select<Settings['uiLanguage']>
              value={settings.uiLanguage}
              onChange={(uiLanguage) => void updateSettings({ uiLanguage })}
              options={[
                { value: 'tr', label: 'Türkçe' },
                { value: 'en', label: 'English' },
              ]}
              aria-label={t('settings.general.language')}
              className="w-36"
            />
          </SettingRow>
          <SettingRow label={t('settings.general.motion')} description={t('settings.general.motionHint')} keywords={t('settings.kw.motion')}>
            <Segmented<Settings['reducedMotion']>
              size="sm"
              value={settings.reducedMotion}
              onChange={(reducedMotion) => void updateSettings({ reducedMotion })}
              options={[
                { value: 'system', label: t('settings.general.motion.system') },
                { value: 'on', label: t('settings.general.motion.on') },
                { value: 'off', label: t('settings.general.motion.off') },
              ]}
              aria-label={t('settings.general.motion')}
              data-testid="settings-motion"
            />
          </SettingRow>
        </Group>
        <DeveloperGroup settings={settings} />
      </Column>
    </SectionGrid>
  );
}
