/**
 * Beyin › Claude Code (abonelik): konuşan beynin (sesli ve yazılı sohbet) masaüstünün kurulu olduğu bilgisayardaki
 * Claude Code üzerinden yürümesi. Sıra (`brain.claudeCode.use`), ses ve sohbet modelleri ve Yönetim'in bu bilgisayarda
 * gördüğü CLI durumu. Kesin durum (kullanım sınırı, o anki beyin) masaüstündedir: Ayarlar › Tanı.
 */
import { EFFORT_LEVELS, t, type ClaudeCodeRoleModel, type ClaudeCodeUse, type Effort, type ModelRef } from '@fuber/shared';
import { Select, type SelectOption } from '@fuber/ui';
import { useField } from '../app/policy-store';
import { Block, Fields, SettingRow } from '../components/layout';
import { useResource } from '../lib/ipc';

/** CLI'nin model takma adları (2.1.325 el sıkışmasındaki liste: sonnet, haiku, opus, fable). */
const ALIASES = ['sonnet', 'haiku', 'opus', 'fable'] as const;

function modelOptions(current: string): SelectOption[] {
  const options: SelectOption[] = ALIASES.map((alias) => ({ value: alias, label: t(`ccbrain.admin.model.${alias}`), description: alias }));
  if (current && !ALIASES.includes(current as (typeof ALIASES)[number])) options.unshift({ value: current, label: current, description: t('ccbrain.admin.model.custom') });
  return options;
}

const effortOptions = (): SelectOption[] => [
  { value: 'default', label: t('admin.brain.effort.default') },
  ...EFFORT_LEVELS.map((level) => ({ value: level, label: t(`admin.brain.effort.${level}`) })),
];

function ModelAndEffort({ model, effort, onModel, onEffort, label }: { model: string; effort: Effort | null; onModel(value: string): void; onEffort(value: Effort | null): void; label: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
      <Select aria-label={label} value={model} onChange={(value) => onModel(String(value))} options={modelOptions(model)} />
      <Select
        aria-label={`${label}: ${t('ccbrain.admin.effort')}`}
        value={effort ?? 'default'}
        onChange={(value) => onEffort(value === 'default' ? null : (value as Effort))}
        options={effortOptions()}
      />
    </div>
  );
}

/**
 * Model tablosunda "Claude Code (abonelik)" seçili satırın hücreleri: model ve efor kendi sütunlarında; düşünme ve
 * hızlı çıktı CLI'de ayarlanmaz, o iki sütunu rolün notu kaplar.
 */
export function ClaudeCodeRoleSettings({ refValue, roleName, memory, set }: { refValue: ModelRef; roleName: string; memory: boolean; set: (key: keyof ModelRef, value: unknown) => void }) {
  return (
    <>
      <div className="ad-model-cell" role="cell" data-testid="role-claude-code">
        <span className="ad-cell-label">{t('admin2.brain.models.model')}</span>
        <Select size="sm" aria-label={roleName} value={refValue.model} onChange={(value) => set('model', String(value))} options={modelOptions(refValue.model)} />
      </div>
      <div className="ad-model-cell" role="cell">
        <span className="ad-cell-label">{t('ccbrain.admin.effort')}</span>
        <Select
          size="sm"
          aria-label={`${roleName}: ${t('ccbrain.admin.effort')}`}
          value={refValue.effort ?? 'default'}
          onChange={(value) => set('effort', value === 'default' ? null : (value as Effort))}
          options={effortOptions()}
        />
      </div>
      <p className="ad-model-note" role="cell">
        <span className="text-fg-muted">{t('ccbrain.admin.where.note')}</span>
        {memory && <span className="text-warning"> {t('ccbrain.admin.where.memoryNote')}</span>}
      </p>
    </>
  );
}

export function ClaudeCodeBlock({ index }: { index: number }) {
  const [use, setUse] = useField<ClaudeCodeUse | undefined>(['brain', 'claudeCode', 'use']);
  const [voice, setVoice] = useField<ClaudeCodeRoleModel | undefined>(['brain', 'claudeCode', 'voice']);
  const [chat, setChat] = useField<ClaudeCodeRoleModel | undefined>(['brain', 'claudeCode', 'chat']);
  const cli = useResource(() => window.fuber.invoke('deep.claudeCode'));
  const voiceModel = voice ?? { model: 'sonnet', effort: 'low' as const };
  const chatModel = chat ?? { model: 'sonnet', effort: 'medium' as const };
  const version = cli.data?.version ?? '';
  const status = cli.loading
    ? t('ccbrain.admin.status.checking')
    : !cli.data?.installed
      ? t('ccbrain.admin.status.missing')
      : cli.data.loggedIn === false
        ? t('ccbrain.admin.status.loggedOut', { version })
        : cli.data.loggedIn === null
          ? t('ccbrain.admin.status.unknown', { version })
          : t('ccbrain.admin.status.ready', { version });
  const ready = !!cli.data?.installed && cli.data.loggedIn !== false;
  const off = (use ?? 'prefer') === 'off';
  return (
    <Block index={index} id="claude-code" title={t('ccbrain.admin.title')} description={t('ccbrain.admin.description')}>
      <Fields min={240}>
        <SettingRow label={t('ccbrain.admin.use.label')} description={t('ccbrain.admin.use.hint')} testId="brain-claude-code-use">
          <div className="flex flex-col gap-3">
            <Select
              aria-label={t('ccbrain.admin.use.label')}
              value={use ?? 'prefer'}
              onChange={(value) => setUse(value as ClaudeCodeUse)}
              options={[
                { value: 'prefer', label: t('ccbrain.admin.use.prefer'), description: t('ccbrain.admin.use.preferHint') },
                { value: 'fallback', label: t('ccbrain.admin.use.fallback'), description: t('ccbrain.admin.use.fallbackHint') },
                { value: 'off', label: t('ccbrain.admin.use.off'), description: t('ccbrain.admin.use.offHint') },
              ]}
            />
            <div className="flex flex-col gap-1" data-testid="brain-claude-code-status" data-ready={String(ready)}>
              <p className={ready || cli.loading ? 'text-sm text-fg' : 'text-sm text-warning'}>{status}</p>
              <p className="text-sm text-fg-muted">{t('ccbrain.admin.status.note')}</p>
            </div>
          </div>
        </SettingRow>
        {!off && (
          <>
            <SettingRow label={t('ccbrain.admin.voice.label')} description={t('ccbrain.admin.voice.hint')} testId="brain-claude-code-voice">
              <ModelAndEffort
                model={voiceModel.model}
                effort={voiceModel.effort}
                onModel={(model) => setVoice({ ...voiceModel, model })}
                onEffort={(effort) => setVoice({ ...voiceModel, effort })}
                label={t('ccbrain.admin.voice.label')}
              />
            </SettingRow>
            <SettingRow label={t('ccbrain.admin.chat.label')} description={t('ccbrain.admin.chat.hint')} testId="brain-claude-code-chat">
              <ModelAndEffort
                model={chatModel.model}
                effort={chatModel.effort}
                onModel={(model) => setChat({ ...chatModel, model })}
                onEffort={(effort) => setChat({ ...chatModel, effort })}
                label={t('ccbrain.admin.chat.label')}
              />
            </SettingRow>
          </>
        )}
      </Fields>
    </Block>
  );
}
