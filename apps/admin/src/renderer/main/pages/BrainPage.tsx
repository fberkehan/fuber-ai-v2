import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowCounterClockwise, Brain, ClockCounterClockwise, Cpu, Eye, Key, Lightning, Microphone } from '@phosphor-icons/react';
import { DEFAULT_POLICY, EFFORT_LEVELS, t, type DeepProviderSetting, type LocalModel, type ModelRef, type PolicyRevisionRecord, type ProviderModelInfo } from '@fuber/shared';
import { Badge, Button, Dialog, Input, List, Row, Select, Skeleton, Switch, Textarea, toast, type SelectOption } from '@fuber/ui';
import { useLive } from '../app/live-store';
import { usePolicy, useField } from '../app/policy-store';
import { ChipInput } from '../components/ChipInput';
import { Block, ErrorPanel, Fields, IconBox, InlineEmpty, ListSkeleton, Notice, Page, PanelSkeleton, SettingRow, StatusDot, Steps, SummaryStrip, type StatProps, type StepItem } from '../components/layout';
import { roleModelLabel, roleProviderLabel, roleTone } from '../lib/status';
import { formatBytes, fromNow, formatDateTime } from '../lib/format';
import { NumberInput } from './VoicePage';
import { ClaudeCodeBlock, ClaudeCodeRoleSettings } from './ClaudeCodeBrain';
import { ChatModelRow, CloudProvidersBlock, CloudRoleSettings, providerSwitch } from './CloudProviders';
import { errorMessage, useAdminEvent, useResource } from '../lib/ipc';
import { modelNote, modelTier, ROLES, type Role } from '../lib/models';
import type { PageProps } from './types';

export function BrainPage({ go }: PageProps) {
  const { draft, loading } = usePolicy();
  const ready = !loading && !!draft;
  return (
    <Page
      title={t('admin.brain.title')}
      description={t('admin.brain.description')}
      summary={ready ? <BrainSummary /> : undefined}
      asideWidth={400}
      aside={
        ready ? (
          <>
            <SelectedModelsBlock onOpen={() => go('brain', 'brain-models')} />
            <HowBlock onOpenKeys={() => go('voice', 'keys')} />
          </>
        ) : (
          <PanelSkeleton rows={2} />
        )
      }
      below={
        ready ? (
          <>
            <ModelsBlock onOpenKeys={() => go('voice', 'keys')} />
            <div className="ad-pair">
              <LocalBrainBlock />
              <DeepBrainBlock />
            </div>
            <ClaudeCodeBlock index={3} />
            <CloudProvidersBlock index={4} onOpenKeys={() => go('voice', 'keys')} />
            <HistoryBlock />
          </>
        ) : undefined
      }
    >
      {ready ? (
        <>
          <IdentityBlock />
          <PromptBlock />
        </>
      ) : (
        <>
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={2} />
        </>
      )}
    </Page>
  );
}

// ───────────────────────── Bir bakışta ─────────────────────────

const ROLE_ICONS: Record<Role, React.JSX.Element> = { voice: <Microphone />, deep: <Brain />, memory: <ClockCounterClockwise />, vision: <Eye /> };

function BrainSummary() {
  const { draft } = usePolicy();
  if (!draft) return null;
  const voice = draft.models.voice;
  const deep = draft.models.deep;
  const fallback = draft.brain.localFallback === 'auto';
  const wake = draft.persona.wakePhrases;
  const items: StatProps[] = [
    { label: t('admin.brain.stat.voice'), icon: <Microphone />, value: roleModelLabel(voice, draft), note: roleProviderLabel(voice, draft), testId: 'stat-brain-voice' },
    { label: t('admin.brain.stat.deep'), icon: <Brain />, value: roleModelLabel(deep, draft), note: roleProviderLabel(deep, draft) },
    {
      label: t('admin.brain.stat.local'),
      icon: <Cpu />,
      value: fallback ? t('admin.brain.stat.localOn') : t('admin.brain.stat.localOff'),
      note: draft.brain.local.modelId,
    },
    {
      label: t('admin.brain.stat.wake'),
      icon: <Lightning />,
      value: wake[0] ?? '–',
      note: wake.length > 1 ? t('admin.brain.stat.wakeMore', { count: wake.length - 1 }) : t('admin.brain.stat.wakeNote', { name: draft.persona.name }),
    },
  ];
  return <SummaryStrip items={items} testId="brain-summary" />;
}

/** Bağlam sütunu: dört işin seçili modeli; satıra basınca model tablosuna kayar. */
function SelectedModelsBlock({ onOpen }: { onOpen: () => void }) {
  const { draft } = usePolicy();
  const { keys } = useLive();
  if (!draft) return null;
  return (
    <Block index={2} title={t('admin.brain.selected.title')} description={t('admin.brain.selected.description')} testId="brain-selected">
      <div className="ad-rows">
        {ROLES.map((role) => {
          const ref = draft.models[role];
          return (
            <button key={role} type="button" className="ad-row" onClick={onOpen} data-testid={`selected-${role}`}>
              <IconBox size={36}>{ROLE_ICONS[role]}</IconBox>
              <span className="ad-row-text">
                <span className="ad-row-title">{t(`admin.brain.role.${role}.name`)}</span>
                <span className="ad-row-sub">{roleModelLabel(ref, draft)}</span>
              </span>
              <span className="ad-row-end">
                <StatusDot tone={roleTone(ref, draft, keys.data)}>{roleProviderLabel(ref, draft)}</StatusDot>
              </span>
            </button>
          );
        })}
      </div>
    </Block>
  );
}

/** "Nasıl işler": ayarların masaüstüne yolculuğu; her adımın durumu taslaktan ve anahtar kasasından. */
function HowBlock({ onOpenKeys }: { onOpenKeys: () => void }) {
  const { draft, base, paths } = usePolicy();
  const { keys } = useLive();
  if (!draft) return null;
  const identity = !!draft.persona.name.trim() && draft.persona.wakePhrases.length > 0;
  const prompt = draft.persona.systemPrompt.trim().length > 0;
  const missing = ROLES.filter((role) => roleTone(draft.models[role], draft, keys.data) !== 'success');
  const steps: StepItem[] = [
    { title: t('admin.brain.how.identity'), body: t('admin.brain.how.identityBody', { name: draft.persona.name || '–' }), state: identity ? 'done' : 'pending' },
    { title: t('admin.brain.how.prompt'), body: t('admin.brain.how.promptBody'), state: prompt ? 'done' : 'pending' },
    {
      title: t('admin.brain.how.models'),
      body: missing.length ? t('admin.brain.how.modelsMissing', { roles: missing.map((r) => t(`admin.brain.role.${r}.name`)).join(', ') }) : t('admin.brain.how.modelsBody'),
      state: missing.length ? 'pending' : 'done',
    },
    {
      title: t('admin.brain.how.save'),
      body: paths.length ? t('admin.brain.how.saveDirty', { count: paths.length }) : t('admin.brain.how.saveClean', { revision: base?.revision ?? 1 }),
      state: paths.length ? 'pending' : 'done',
    },
  ];
  return (
    <Block
      index={3}
      title={t('admin.brain.how.title')}
      testId="brain-how"
      action={
        missing.length ? (
          <Button size="sm" variant="ghost" icon={<Key />} onClick={onOpenKeys}>
            {t('admin.brain.models.openKeys')}
          </Button>
        ) : undefined
      }
    >
      <Steps items={steps} testId="brain-steps" />
    </Block>
  );
}

function IdentityBlock() {
  const [name, setName, nameError] = useField<string>(['persona', 'name']);
  const [wake, setWake, wakeError] = useField<string[]>(['persona', 'wakePhrases']);
  const [address, setAddress] = useField<string>(['persona', 'address']);
  const [language, setLanguage] = useField<'tr' | 'en'>(['persona', 'language']);
  return (
    <Block index={0} tone="lead" title={t('admin.brain.identity.title')} description={t('admin.brain.identity.description')}>
      <Fields min={180}>
        <SettingRow label={t('admin.brain.name.label')} description={t('admin.brain.name.hint')} htmlFor="persona-name" error={nameError}>
          <Input id="persona-name" value={name} invalid={!!nameError} onChange={(e) => setName(e.target.value)} data-testid="persona-name" maxLength={40} />
        </SettingRow>
        <SettingRow label={t('admin.brain.address.label')} description={t('admin.brain.address.hint')} htmlFor="persona-address">
          <Input id="persona-address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={40} />
        </SettingRow>
        <SettingRow label={t('admin.brain.language.label')} description={t('admin.brain.language.hint')}>
          <Select
            aria-label={t('admin.brain.language.label')}
            value={language}
            onChange={setLanguage}
            options={[
              { value: 'tr', label: t('admin.brain.language.tr') },
              { value: 'en', label: t('admin.brain.language.en') },
            ]}
          />
        </SettingRow>
        <SettingRow wide label={t('admin.brain.wake.label')} description={t('admin.brain.wake.hint')} htmlFor="persona-wake" error={wakeError}>
          <ChipInput id="persona-wake" values={wake} onChange={setWake} invalid={!!wakeError} placeholder={t('admin.brain.wake.placeholder')} />
        </SettingRow>
      </Fields>
    </Block>
  );
}

function PromptBlock() {
  const [prompt, setPrompt, promptError] = useField<string>(['persona', 'systemPrompt']);
  const isDefault = prompt === DEFAULT_POLICY.persona.systemPrompt;
  return (
    <Block
      index={1}
      title={t('admin.brain.prompt.title')}
      description={t('admin.brain.prompt.description')}
      action={
        <Button size="sm" variant="ghost" icon={<ArrowCounterClockwise />} disabled={isDefault} onClick={() => setPrompt(DEFAULT_POLICY.persona.systemPrompt)}>
          {t('admin.brain.prompt.reset')}
        </Button>
      }
    >
      <Fields>
        <SettingRow
          wide
          label={t('admin.brain.prompt.label')}
          description={t('admin.brain.prompt.hint')}
          htmlFor="persona-prompt"
          aside={t('admin.brain.prompt.count', { count: prompt.length.toLocaleString('tr-TR') })}
          error={promptError}
        >
          <Textarea
            id="persona-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            minRows={8}
            maxRows={22}
            spellCheck={false}
            className="text-sm leading-6"
            invalid={!!promptError}
          />
        </SettingRow>
      </Fields>
    </Block>
  );
}

function ModelsBlock({ onOpenKeys }: { onOpenKeys: () => void }) {
  const models = useResource(() => window.fuber.invoke('models.list'));
  // Anahtar eklenince ya da sınanınca liste yeniden denenir.
  useAdminEvent('keys.changed', ({ provider }) => provider === 'anthropic' && void models.reload());
  return (
    <Block index={2} id="brain-models" title={t('admin.brain.models.title')} description={t('admin.brain.models.description')}>
      {models.error && (
        <Notice
          tone="warning"
          icon={<Key />}
          title={t('admin.brain.models.noListTitle')}
          action={
            <Button size="sm" onClick={onOpenKeys}>
              {t('admin.brain.models.openKeys')}
            </Button>
          }
          testId="models-unavailable"
        >
          {t('admin.brain.models.noListBody')}
        </Notice>
      )}
      {/* Tablo: satır iş, sütun ayar. Dört işin aynı beş ayarı bir bakışta karşılaştırılır; dar kapta satır üç sıraya iner. */}
      <div className="ad-models" role="table" aria-label={t('admin.brain.models.title')}>
        <div className="ad-models-head" role="row">
          <span role="columnheader">{t('admin2.brain.models.role')}</span>
          <span role="columnheader">{t('admin2.brain.where.label')}</span>
          <span role="columnheader">{t('admin2.brain.models.model')}</span>
          <span role="columnheader">{t('admin.brain.effort.label')}</span>
          <span role="columnheader">{t('admin.brain.thinking.label')}</span>
          <span role="columnheader">{t('admin.brain.speed.label')}</span>
        </div>
        {ROLES.map((role) => (
          <RoleRow key={role} role={role} models={models.data} loadingList={models.loading} />
        ))}
      </div>
      {/* Yazılı sohbetin ayrı modeli : tablonun altında. */}
      <div className="border-t border-line pt-5">
        <Fields max={2}>
          <ChatModelRow />
        </Fields>
      </div>
    </Block>
  );
}

/**
 * Derin işlerin sağlayıcısı ve Yönetim'in bu bilgisayarda gördüğü durum. Kesin karar masaüstünde verilir (API çağrı
 * anında düşerse `Kendiliğinden` kipte Claude Code'a geçer); buradaki yazı aynı kuralın anahtar kasası ve bu
 * bilgisayardaki Claude Code üzerinden okunuşudur.
 */
function DeepBrainBlock() {
  const [provider, setProvider] = useField<DeepProviderSetting>(['brain', 'deep', 'provider']);
  const { keys } = useLive();
  const cli = useResource(() => window.fuber.invoke('deep.claudeCode'));
  const anthropic = keys.data?.find((key) => key.provider === 'anthropic') ?? null;
  const apiFailed = !!anthropic?.present && anthropic.lastTest !== null && !anthropic.lastTest.ok;
  const apiReady = !!anthropic?.present && !apiFailed;
  const cliReady = !!cli.data?.installed && cli.data.loggedIn !== false;
  const active =
    provider === 'anthropic' ? (apiReady ? 'api' : 'none') : provider === 'claude-code' ? (cliReady ? 'cli' : 'none') : apiReady ? 'api' : cliReady ? 'cli' : 'none';
  const apiLine = !anthropic?.present
    ? t('admin2.brain.deep.api.missing')
    : apiFailed
      ? t('admin2.brain.deep.api.failed', { message: anthropic.lastTest?.message ?? '' })
      : t('admin2.brain.deep.api.ready');
  const version = cli.data?.version ?? '';
  const cliLine = !cli.data?.installed
    ? t('admin2.brain.deep.cli.missing')
    : cli.data.loggedIn === false
      ? t('admin2.brain.deep.cli.loggedOut', { version })
      : cli.data.loggedIn === null
        ? t('admin2.brain.deep.cli.unknown', { version })
        : t('admin2.brain.deep.cli.ready', { version });
  const pending = keys.loading || cli.loading;
  return (
    <Block index={4} title={t('admin2.brain.deep.label')} description={t('admin2.brain.deep.hint')} testId="brain-deep">
      <Select
        aria-label={t('admin2.brain.deep.label')}
        value={provider}
        onChange={setProvider}
        options={[
          { value: 'auto', label: t('admin2.brain.deep.auto'), description: t('admin2.brain.deep.autoHint') },
          { value: 'anthropic', label: t('admin2.brain.deep.anthropic'), description: t('admin2.brain.deep.anthropicHint') },
          { value: 'claude-code', label: t('admin2.brain.deep.claudeCode'), description: t('admin2.brain.deep.claudeCodeHint') },
        ]}
      />
      {pending ? (
        <p className="text-sm text-fg-faint">{t('admin2.brain.deep.checking')}</p>
      ) : (
        <div className="flex flex-col gap-1" data-testid="brain-deep-status" data-active={active}>
          <p className={active === 'none' ? 'text-sm text-warning' : 'text-sm text-fg'}>{t('admin2.brain.deep.now', { active: t(`admin2.brain.deep.now.${active}`) })}</p>
          <p className="text-sm text-fg-muted">
            {apiLine} {cliLine}
          </p>
        </div>
      )}
    </Block>
  );
}

/** Derin işler ve görme yerel modelle yapılmaz (KURGU §6 "Yerel beyin"); seçenek kapalı gösterilir. */
const LOCAL_CAPABLE: readonly Role[] = ['voice', 'memory'];

/** Tablonun bir satırı: iş · nerede · model · efor · düşünme · hızlı çıktı. Yerelde çalışan işte son dört hücre tek nottur. */
function RoleRow({ role, models, loadingList }: { role: Role; models: ProviderModelInfo[] | null; loadingList: boolean }) {
  const [ref, setRef] = useField<ModelRef>(['models', role]);
  const [localModelId] = useField<string>(['brain', 'local', 'modelId']);
  const { edit, draft } = usePolicy();
  const { keys } = useLive();
  const set = (key: keyof ModelRef, value: unknown) => edit(['models', role, key], value);
  const local = ref.provider === 'local';
  const roleName = t(`admin.brain.role.${role}.name`);

  const options = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = (models ?? []).map((m) => ({ value: m.id, label: m.displayName || m.id, description: m.id }));
    if (!list.some((option) => option.value === ref.model)) {
      list.unshift({ value: ref.model, label: ref.model, description: t('admin.brain.models.current') });
    }
    return list;
  }, [models, ref.model]);
  const effortOptions: SelectOption[] = [
    { value: 'default', label: t('admin.brain.effort.default') },
    ...EFFORT_LEVELS.map((level) => ({ value: level, label: t(`admin.brain.effort.${level}`) })),
  ];
  const claude = ref.provider === 'anthropic';
  const thinkingCaveat = claude && ref.thinking === 'off' && modelTier(ref.model) !== 'haiku';
  const speedCaveat = claude && ref.speed === 'fast';

  return (
    <div className="ad-model" role="row" data-testid={`role-${role}`} data-local={local || undefined}>
      <span className="ad-model-name" role="cell">
        {roleName}
      </span>
      <div className="ad-model-cell" role="cell">
        <span className="ad-cell-label">{t('admin2.brain.where.label')}</span>
        <Select
          size="sm"
          aria-label={`${roleName}: ${t('admin2.brain.where.label')}`}
          value={ref.provider}
          onChange={(v) => (draft ? setRef(providerSwitch(draft, role, v as ModelRef['provider'], keys.data)) : set('provider', v))}
          options={[
            { value: 'anthropic', label: t('admin2.brain.where.cloud'), description: t('admin2.brain.where.cloudHint') },
            { value: 'openai-compatible', label: t('admin.cloud.where.option'), description: t('admin.cloud.where.optionHint') },
            { value: 'claude-code', label: t('ccbrain.admin.where.option'), description: t('ccbrain.admin.where.optionHint') },
            {
              value: 'local',
              label: t('admin2.brain.where.local'),
              description: LOCAL_CAPABLE.includes(role) ? t('admin2.brain.where.localHint') : t('admin2.brain.where.localDisabled'),
              disabled: !LOCAL_CAPABLE.includes(role) && !local,
            },
          ]}
        />
      </div>
      {local ? (
        <p className="ad-model-local text-sm text-fg-muted" role="cell" data-testid={`role-${role}-local`}>
          {t('admin2.brain.where.localNote', { model: localModelId })}
        </p>
      ) : ref.provider === 'openai-compatible' ? (
        <div className="ad-model-wide" role="cell">
          <CloudRoleSettings path={['models', role]} roleName={roleName} />
        </div>
      ) : ref.provider === 'claude-code' ? (
        <ClaudeCodeRoleSettings refValue={ref} roleName={roleName} memory={role === 'memory'} set={set} />
      ) : (
        <>
          <div className="ad-model-cell" role="cell">
            <span className="ad-cell-label">{t('admin2.brain.models.model')}</span>
            {loadingList ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <Select size="sm" aria-label={t('admin.brain.models.modelLabel', { role: roleName })} value={ref.model} onChange={(v) => set('model', v)} options={options} />
            )}
          </div>
          <div className="ad-model-cell" role="cell">
            <span className="ad-cell-label">{t('admin.brain.effort.label')}</span>
            <Select
              size="sm"
              aria-label={`${roleName}: ${t('admin.brain.effort.label')}`}
              value={ref.effort ?? 'default'}
              onChange={(v) => set('effort', v === 'default' ? null : v)}
              options={effortOptions}
            />
          </div>
          <label className="ad-model-switch ad-model-thinking" role="cell">
            <span className="ad-cell-label">{t('admin.brain.thinking.label')}</span>
            <Switch aria-label={`${roleName}: ${t('admin.brain.thinking.label')}`} checked={ref.thinking === 'adaptive'} onCheckedChange={(on) => set('thinking', on ? 'adaptive' : 'off')} />
          </label>
          <label className="ad-model-switch ad-model-speed" role="cell">
            <span className="ad-cell-label">{t('admin.brain.speed.label')}</span>
            <Switch aria-label={`${roleName}: ${t('admin.brain.speed.label')}`} checked={ref.speed === 'fast'} onCheckedChange={(on) => set('speed', on ? 'fast' : 'standard')} />
          </label>
        </>
      )}
      {/* Satırın altında tek satır: işin ne olduğu ve seçili modelin notu. */}
      <p className="ad-model-note" role="cell">
        <span className="text-fg-muted">{t(`admin.brain.role.${role}.purpose`)}</span>
        {claude && ` ${modelNote(ref.model)}`}
        {thinkingCaveat && ` ${t('admin.brain.thinking.caveat')}`}
        {speedCaveat && ` ${t('admin.brain.speed.caveat')}`}
      </p>
    </div>
  );
}

/** Politikadaki dil modelleri: yalnız model dosyası (GGUF) taşıyanlar; çalıştırıcı (llama-server) değil. */
function localLanguageModels(models: LocalModel[]): LocalModel[] {
  return models.filter((m) => m.role === 'llm' && m.files.some((f) => /\.gguf$/i.test(f.path)));
}

function LocalBrainBlock() {
  const { draft } = usePolicy();
  const [fallback, setFallback] = useField<'auto' | 'off'>(['brain', 'localFallback']);
  const [modelId, setModelId, modelError] = useField<string>(['brain', 'local', 'modelId']);
  const [context, setContext, contextError] = useField<number>(['brain', 'local', 'contextTokens']);
  const candidates = localLanguageModels(draft?.localModels ?? []);
  const options: SelectOption[] = candidates.map((m) => ({
    value: m.id,
    label: m.id,
    description: formatBytes(m.files.reduce((sum, f) => sum + f.bytes, 0)),
  }));
  if (modelId && !options.some((o) => o.value === modelId)) {
    options.unshift({ value: modelId, label: modelId, description: t('admin2.brain.localModel.unlisted') });
  }
  return (
    <Block index={3} id="local-brain" title={t('admin2.brain.local.title')} description={t('admin2.brain.local.description')}>
      <Fields>
        <SettingRow
          wide
          inline
          label={t('admin2.brain.fallback.label')}
          description={`${fallback === 'auto' ? t('admin2.brain.fallback.on') : t('admin2.brain.fallback.off')} ${t('admin2.brain.fallback.hint')}`}
          testId="brain-fallback"
        >
          <Switch checked={fallback === 'auto'} onCheckedChange={(on) => setFallback(on ? 'auto' : 'off')} aria-label={t('admin2.brain.fallback.label')} />
        </SettingRow>
        <SettingRow label={t('admin2.brain.localModel.label')} description={t('admin2.brain.localModel.hint')} error={modelError}>
          <Select aria-label={t('admin2.brain.localModel.label')} value={modelId} onChange={setModelId} options={options} invalid={!!modelError} />
        </SettingRow>
        <SettingRow label={t('admin2.brain.context.label')} description={t('admin2.brain.context.hint')} htmlFor="brain-context" error={contextError}>
          <NumberInput id="brain-context" value={context} onChange={setContext} unit={t('admin2.brain.context.unit')} min={2048} max={131_072} step={1024} invalid={!!contextError} testId="brain-context" />
        </SettingRow>
      </Fields>
    </Block>
  );
}

const HISTORY_PAGE = 8;

function HistoryBlock() {
  const { base, accept } = usePolicy();
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const history = useResource(() => window.fuber.invoke('policy.history', { limit }));
  const actors = useResource(async () => {
    const entries = await window.fuber.invoke('audit.list', { limit: 200 });
    const map = new Map<number, string>();
    for (const entry of entries) {
      const match = /^policy:(\d+)$/.exec(entry.target);
      if (match && (entry.action === 'policy.update' || entry.action === 'policy.rollback')) map.set(Number(match[1]), entry.actor);
    }
    return map;
  });
  useAdminEvent('policy.changed', () => {
    void history.reload();
    void actors.reload();
  });
  const reloadHistory = history.reload;
  useEffect(() => {
    if (limit !== HISTORY_PAGE) void reloadHistory();
  }, [limit, reloadHistory]);
  const [target, setTarget] = useState<PolicyRevisionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const rollback = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const next = await window.fuber.invoke('policy.rollback', { revision: target.revision });
      accept(next);
      toast.success(t('admin.brain.history.rolledBack', { revision: target.revision }), { description: t('admin.save.sentDetail', { revision: next.revision }) });
      setTarget(null);
    } catch (reason) {
      toast.error(t('admin.brain.history.rollbackFailed'), { description: errorMessage(reason) });
    } finally {
      setBusy(false);
    }
  };

  const actorLabel = (revision: number) => {
    const actor = actors.data?.get(revision);
    if (!actor || actor === 'admin') return t('admin.actor.admin');
    return t('admin.actor.device', { id: actor.slice(0, 8) });
  };

  return (
    <Block index={4} title={t('admin.brain.history.title')} description={t('admin.brain.history.description')}>
      {history.error ? (
        <ErrorPanel message={history.error} onRetry={() => void history.reload()} />
      ) : history.loading ? (
        <ListSkeleton rows={3} />
      ) : (history.data ?? []).length === 0 ? (
        <InlineEmpty icon={<ClockCounterClockwise />} title={t('admin.brain.history.empty')} />
      ) : (
        <div className="-mx-3 -my-1">
          <List data-testid="history-list">
            {(history.data ?? []).map((record, index) => {
              const current = record.revision === base?.revision;
              return (
                <Row
                  key={record.revision}
                  index={index}
                  icon={<span className="text-sm font-semibold tabular-nums">{record.revision}</span>}
                  iconTone={current ? 'accent' : 'neutral'}
                  title={
                    <span className="flex items-center gap-2">
                      <span className="truncate">{record.note || t('admin.brain.history.noNote')}</span>
                      {current && (
                        <Badge size="sm" tone="accent">
                          {t('admin.brain.history.current')}
                        </Badge>
                      )}
                    </span>
                  }
                  subtitle={
                    <span title={formatDateTime(record.updatedAt)}>
                      {t('admin.brain.history.meta', { actor: actorLabel(record.revision), when: fromNow(record.updatedAt) })}
                    </span>
                  }
                  density="compact"
                  trailing={
                    !current && (
                      <Button size="sm" variant="ghost" icon={<ArrowCounterClockwise />} onClick={() => setTarget(record)}>
                        {t('admin.brain.history.restore')}
                      </Button>
                    )
                  }
                />
              );
            })}
          </List>
          {(history.data ?? []).length >= limit && (
            <div className="flex justify-center border-t border-line pt-2">
              <Button
                size="sm"
                variant="ghost"
                loading={history.refreshing}
                onClick={() => setLimit((value) => value + 30)}
              >
                {t('admin.brain.history.more')}
              </Button>
            </div>
          )}
        </div>
      )}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && !busy && setTarget(null)}
        role="alertdialog"
        title={t('admin.brain.history.confirmTitle', { revision: target?.revision ?? '' })}
        description={t('admin.brain.history.confirmBody')}
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void rollback()}>
              {t('admin.brain.history.confirm')}
            </Button>
          </>
        }
      />
    </Block>
  );
}
