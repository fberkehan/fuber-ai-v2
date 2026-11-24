/**
 * Beyin ve Kişilik › OpenAI uyumlu bulut sağlayıcıları (G8): sağlayıcı kayıtları (hazır ayarlar + özel adres), rol
 * kartındaki "Bulut (OpenAI uyumlu)" ayarı (sağlayıcı, model, fiyat) ve yazılı sohbetin ayrı modeli. Anahtarlar burada
 * girilmez: Ses ve Anahtarlar ekranındaki kasa kartları kullanılır (masaüstü anahtar istemez).
 */
import { useEffect, useMemo, useState } from 'react';
import { Key, Plus, Trash } from '@phosphor-icons/react';
import {
  CLOUD_PRESET_INFO,
  DEFAULT_POLICY,
  EFFORT_LEVELS,
  t,
  type CloudEndpoint,
  type CloudModelInfo,
  type KeyStatus,
  type ModelRef,
  type Policy,
} from '@fuber/shared';
import { Badge, Button, Input, Panel as Box, Select, Switch, type SelectOption } from '@fuber/ui';
import { useLive } from '../app/live-store';
import { usePolicy, useField } from '../app/policy-store';
import { Block, Fields, Notice, SettingRow } from '../components/layout';
import { errorMessage } from '../lib/ipc';
import { keyState, NumberInput } from './VoicePage';

type RoleKey = keyof Policy['models'];

/** Bir rolün "nerede" seçimi değişince alanları tutarlı tutar (Claude modeli OpenAI uyumlu uca, ya da tersi gitmesin). */
export function providerSwitch(draft: Policy, role: RoleKey, next: ModelRef['provider'], keys: KeyStatus[] | null): ModelRef {
  const current = draft.models[role] ?? draft.models.deep;
  const fallbackRole: Exclude<RoleKey, 'chat'> = role === 'chat' ? 'deep' : role;
  if (next === 'openai-compatible') {
    const withKey = draft.providers.find((endpoint) => keys?.some((key) => key.provider === endpoint.keyId && key.present)) ?? draft.providers[0];
    const { price: _price, ...rest } = current;
    return { ...rest, provider: 'openai-compatible', endpoint: withKey?.id ?? 'openrouter', model: withKey?.model ?? 'moonshotai/kimi-k2' };
  }
  const { endpoint: _endpoint, price: _price, ...rest } = current;
  // Claude Code (abonelik): CLI'nin model takma adı; ses hızlı eforda, öteki roller orta eforda başlar.
  if (next === 'claude-code') return { ...rest, provider: 'claude-code', model: 'sonnet', effort: role === 'voice' ? 'low' : 'medium' };
  if (next === 'anthropic') return { ...rest, provider: 'anthropic', model: current.provider === 'anthropic' ? current.model : DEFAULT_POLICY.models[fallbackRole].model };
  return { ...rest, provider: 'local' };
}

function keyOf(keys: KeyStatus[] | null, endpoint: CloudEndpoint): KeyStatus | null {
  return keys?.find((key) => key.provider === endpoint.keyId) ?? null;
}

function rolesUsing(policy: Policy, id: string): string[] {
  return (Object.entries(policy.models) as Array<[RoleKey, ModelRef | undefined]>)
    .filter(([, ref]) => ref?.provider === 'openai-compatible' && ref.endpoint === id)
    .map(([role]) => (role === 'chat' ? t('admin.field.models.chat') : t(`admin.brain.role.${role}.name`)));
}

// ───────────────────────────── Sağlayıcı kayıtları ─────────────────────────────

export function CloudProvidersBlock({ index, onOpenKeys }: { index: number; onOpenKeys: () => void }) {
  const { draft, edit } = usePolicy();
  const { keys } = useLive();
  if (!draft) return null;
  const providers = draft.providers;
  const setProviders = (next: CloudEndpoint[]) => edit(['providers'], next);
  const addCustom = () => {
    let n = 1;
    while (providers.some((endpoint) => endpoint.id === (n === 1 ? 'ozel' : `ozel-${n}`))) n++;
    const id = n === 1 ? 'ozel' : `ozel-${n}`;
    setProviders([
      ...providers,
      { id, preset: 'custom', name: n === 1 ? t('admin.cloud.customName') : `${t('admin.cloud.customName')} ${n}`, baseUrl: 'http://127.0.0.1:1234/v1', keyId: 'custom', model: 'model-adi', caps: { tools: true, vision: false, stream: true } },
    ]);
  };
  return (
    <Block
      index={index}
      id="cloud-providers"
      tone="quiet"
      title={t('admin.cloud.title')}
      description={t('admin.cloud.description')}
      action={
        <Button size="sm" icon={<Plus />} onClick={addCustom} data-testid="cloud-add-custom">
          {t('admin.cloud.addCustom')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="cloud-providers">
        {providers.map((endpoint, position) => (
          <EndpointCard
            key={endpoint.id}
            endpoint={endpoint}
            keyStatus={keyOf(keys.data, endpoint)}
            usedBy={rolesUsing(draft, endpoint.id)}
            onChange={(next) => setProviders(providers.map((item, i) => (i === position ? next : item)))}
            onRemove={endpoint.preset === 'custom' ? () => setProviders(providers.filter((_, i) => i !== position)) : null}
            onOpenKeys={onOpenKeys}
          />
        ))}
      </div>
    </Block>
  );
}

function EndpointCard({
  endpoint,
  keyStatus,
  usedBy,
  onChange,
  onRemove,
  onOpenKeys,
}: {
  endpoint: CloudEndpoint;
  keyStatus: KeyStatus | null;
  usedBy: string[];
  onChange: (next: CloudEndpoint) => void;
  onRemove: (() => void) | null;
  onOpenKeys: () => void;
}) {
  const state = keyState(keyStatus);
  const urlValid = /^https?:\/\/\S+$/i.test(endpoint.baseUrl.trim());
  const set = <K extends keyof CloudEndpoint>(key: K, value: CloudEndpoint[K]) => onChange({ ...endpoint, [key]: value });
  return (
    <Box>
      <div className="flex flex-col gap-4" data-testid={`cloud-endpoint-${endpoint.id}`}>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {endpoint.preset === 'custom' ? (
              <Input size="sm" value={endpoint.name} onChange={(e) => set('name', e.target.value)} aria-label={t('admin.cloud.customName')} maxLength={60} />
            ) : (
              <h3 className="text-lg text-fg">{endpoint.name}</h3>
            )}
            <p className="text-sm text-fg-muted">{t(`admin.cloud.notes.${endpoint.preset}`)}</p>
          </div>
          <Badge tone={state.tone} dot data-testid={`cloud-key-${endpoint.id}`} data-status={state.kind}>
            {keyStatus?.present ? state.label : t('admin.cloud.key.missing')}
          </Badge>
        </div>
        <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
          <label className="text-sm text-fg-muted" htmlFor={`cloud-url-${endpoint.id}`}>
            {t('admin.cloud.baseUrl')}
          </label>
          <Input
            id={`cloud-url-${endpoint.id}`}
            size="sm"
            value={endpoint.baseUrl}
            invalid={!urlValid}
            spellCheck={false}
            className="font-mono text-sm"
            onChange={(e) => set('baseUrl', e.target.value.trim())}
            data-testid={`cloud-url-input-${endpoint.id}`}
          />
          <label className="text-sm text-fg-muted" htmlFor={`cloud-model-${endpoint.id}`}>
            {t('admin.cloud.defaultModel')}
          </label>
          <Input id={`cloud-model-${endpoint.id}`} size="sm" value={endpoint.model} spellCheck={false} className="font-mono text-sm" onChange={(e) => set('model', e.target.value)} />
          <span className="text-sm text-fg-muted">{t('admin.cloud.caps')}</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {(['tools', 'vision', 'stream'] as const).map((cap) => (
              <label key={cap} className="flex items-center gap-2 text-sm text-fg">
                <Switch size="sm" checked={endpoint.caps[cap]} onCheckedChange={(on) => set('caps', { ...endpoint.caps, [cap]: on })} aria-label={t(`admin.cloud.caps.${cap}`)} />
                {t(`admin.cloud.caps.${cap}`)}
              </label>
            ))}
          </div>
        </div>
        {endpoint.baseUrl.startsWith('http://') && <p className="text-xs text-warning">{t('admin.cloud.baseUrlHint')}</p>}
        <div className="flex items-center gap-2 border-t border-line pt-4">
          {!keyStatus?.present && (
            <Button size="sm" icon={<Key />} onClick={onOpenKeys}>
              {t('admin.cloud.key.add')}
            </Button>
          )}
          <span className="flex-1 text-sm text-fg-faint">{usedBy.length > 0 ? t('admin.cloud.inUse', { roles: usedBy.join(', ') }) : ''}</span>
          {onRemove && (
            <Button size="sm" variant="ghost" icon={<Trash />} onClick={onRemove} disabled={usedBy.length > 0}>
              {t('admin.cloud.removeCustom')}
            </Button>
          )}
        </div>
      </div>
    </Box>
  );
}

// ───────────────────────────── Rol kartı: OpenAI uyumlu ayar ─────────────────────────────

const LIST_LIMIT = 60;

/** Sağlayıcının model listesi (kasadaki anahtarla, taslaktaki adresle). */
function useCloudModels(endpoint: CloudEndpoint | null, hasKey: boolean) {
  const [state, setState] = useState<{ data: CloudModelInfo[] | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  const signature = endpoint ? `${endpoint.id}|${endpoint.preset}|${endpoint.baseUrl}|${endpoint.keyId}|${hasKey}` : '';
  useEffect(() => {
    if (!endpoint || !hasKey) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    window.fuber
      .invoke('providers.models', { endpointId: endpoint.id, baseUrl: endpoint.baseUrl, preset: endpoint.preset, keyId: endpoint.keyId })
      .then(
        (data) => live && setState({ data, error: null, loading: false }),
        (reason: unknown) => live && setState({ data: null, error: errorMessage(reason), loading: false }),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- imza adres, hazır ayar ve anahtarı kapsar
  }, [signature]);
  return state;
}

export function CloudRoleSettings({ path, roleName }: { path: ['models', RoleKey]; roleName: string }) {
  const { draft } = usePolicy();
  const [ref, setRef] = useField<ModelRef>(path);
  const { keys } = useLive();
  const endpoint = draft?.providers.find((item) => item.id === ref.endpoint) ?? null;
  const keyStatus = endpoint ? keyOf(keys.data, endpoint) : null;
  const hasKey = !!keyStatus?.present;
  const list = useCloudModels(endpoint, hasKey);
  const selected = list.data?.find((model) => model.id === ref.model) ?? null;

  const endpointOptions: SelectOption[] = (draft?.providers ?? []).map((item) => {
    const status = keyOf(keys.data, item);
    return { value: item.id, label: item.name, description: status?.present ? t('admin.cloud.key.ready') : t('admin.cloud.key.missing') };
  });
  const matches = useMemo(() => {
    const query = ref.model.trim().toLowerCase();
    const all = list.data ?? [];
    const found = query && !all.some((model) => model.id.toLowerCase() === query) ? all.filter((model) => model.id.toLowerCase().includes(query) || model.displayName.toLowerCase().includes(query)) : all;
    return { shown: found.slice(0, LIST_LIMIT), more: Math.max(0, found.length - LIST_LIMIT) };
  }, [list.data, ref.model]);
  const modelOptions: SelectOption[] = matches.shown.map((model) => ({
    value: model.id,
    label: model.displayName,
    description: [
      model.id,
      model.price ? t('admin.cloud.role.priceValue', { input: model.price.input, output: model.price.output }) : null,
      model.tools ? t('admin.cloud.role.tools') : null,
      model.vision ? t('admin.cloud.role.vision') : null,
      model.contextTokens ? t('admin.cloud.role.context', { tokens: model.contextTokens.toLocaleString('tr-TR') }) : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }));

  const pickModel = (id: string) => {
    const info = list.data?.find((model) => model.id === id);
    const { price: _old, ...rest } = ref;
    // Fiyat sağlayıcının listesinden gelir; listede yoksa yazılmaz ("bilinmiyor"), uydurulmaz.
    setRef({ ...rest, model: id, ...(info?.price ? { price: info.price } : {}) });
  };
  const setPrice = (key: 'input' | 'output', value: number) => {
    const current = ref.price ?? { input: Number.NaN, output: Number.NaN };
    const next = { ...current, [key]: value };
    const { price: _old, ...rest } = ref;
    setRef(Number.isFinite(next.input) && Number.isFinite(next.output) && next.input >= 0 && next.output >= 0 ? { ...rest, price: next } : rest);
  };
  const effortOptions: SelectOption[] = [{ value: 'default', label: t('admin.brain.effort.default') }, ...EFFORT_LEVELS.map((level) => ({ value: level, label: t(`admin.brain.effort.${level}`) }))];

  const id = path[1];
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={`cloud-role-${id}`}>
      <Fields min={200}>
        <SettingRow label={t('admin.cloud.role.provider')}>
          <Select
            size="sm"
            aria-label={`${roleName}: ${t('admin.cloud.role.provider')}`}
            value={ref.endpoint ?? null}
            onChange={(next) => {
              const found = draft?.providers.find((item) => item.id === next);
              const { price: _old, ...rest } = ref;
              setRef({ ...rest, endpoint: next, model: found?.model ?? ref.model });
            }}
            options={endpointOptions}
          />
        </SettingRow>
        <SettingRow label={t('admin.cloud.role.model')} htmlFor={`cloud-role-model-${id}`}>
          <Input
            id={`cloud-role-model-${id}`}
            size="sm"
            value={ref.model}
            spellCheck={false}
            className="font-mono text-sm"
            placeholder={t('admin.cloud.role.modelPlaceholder')}
            onChange={(e) => {
              const { price: _old, ...rest } = ref;
              setRef({ ...rest, model: e.target.value, ...(ref.price ? { price: ref.price } : {}) });
            }}
            data-testid={`cloud-role-model-${id}`}
          />
          {hasKey &&
            (list.loading ? (
              <p className="text-sm text-fg-faint">{t('admin.cloud.role.listLoading')}</p>
            ) : list.error ? (
              <p className="text-sm text-warning" data-testid={`cloud-role-${id}-listerror`}>
                {t('admin.cloud.role.listFailed', { message: list.error })}
              </p>
            ) : (list.data ?? []).length === 0 ? (
              <p className="text-sm text-fg-faint">{t('admin.cloud.role.listEmpty')}</p>
            ) : (
              <>
                <Select size="sm" aria-label={t('admin.cloud.role.list')} placeholder={t('admin.cloud.role.list')} value={selected ? selected.id : null} onChange={pickModel} options={modelOptions} />
                {matches.more > 0 && <p className="text-xs text-fg-faint">{t('admin.cloud.role.listMore', { count: matches.more })}</p>}
              </>
            ))}
        </SettingRow>
        <SettingRow label={t('admin.brain.effort.label')}>
          <Select
            size="sm"
            aria-label={`${roleName}: ${t('admin.brain.effort.label')}`}
            value={ref.effort ?? 'default'}
            onChange={(v) => setRef({ ...ref, effort: v === 'default' ? null : (v as ModelRef['effort']) })}
            options={effortOptions}
          />
        </SettingRow>
        <SettingRow label={t('admin.cloud.role.price')}>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput value={ref.price?.input ?? Number.NaN} onChange={(v) => setPrice('input', v)} unit="$ girdi" min={0} step={0.01} testId={`cloud-role-${id}-price-in`} />
            <NumberInput value={ref.price?.output ?? Number.NaN} onChange={(v) => setPrice('output', v)} unit="$ çıktı" min={0} step={0.01} testId={`cloud-role-${id}-price-out`} />
          </div>
        </SettingRow>
      </Fields>
      {endpoint && !hasKey && (
        <Notice tone="warning" icon={<Key weight="fill" />} testId={`cloud-role-${id}-nokey`}>
          {t('admin.cloud.role.noKey', { provider: endpoint.name })}
        </Notice>
      )}
      {selected?.tools === false && <p className="text-sm text-warning">{t('admin.cloud.role.noTools')}</p>}
      <p className="text-xs text-fg-faint" data-testid={`cloud-role-${id}-price`}>
        {ref.price
          ? `${t('admin.cloud.role.priceValue', { input: ref.price.input, output: ref.price.output })}${selected?.price ? `. ${t('admin.cloud.role.priceFromList')}` : ''}`
          : `${t('admin.cloud.role.price')}: ${t('admin.cloud.role.priceUnknown')}.`}{' '}
        {t('admin.cloud.role.effortNote')}
      </p>
    </div>
  );
}

// ───────────────────────────── Yazılı sohbetin modeli ─────────────────────────────

export function ChatModelRow() {
  const { draft, edit } = usePolicy();
  const { keys } = useLive();
  if (!draft) return null;
  const chat = draft.models.chat;
  const on = !!chat;
  const roleName = t('admin.field.models.chat');
  return (
    <SettingRow label={t('admin.cloud.chat.title')} description={t('admin.cloud.chat.hint')} testId="brain-chat-model">
      <div className="flex flex-col gap-3">
        <div className="flex min-h-10 items-center gap-3">
          <Switch
            checked={on}
            aria-label={t('admin.cloud.chat.separate')}
            onCheckedChange={(next) => edit(['models', 'chat'], next ? providerSwitch(draft, 'chat', 'openai-compatible', keys.data) : undefined)}
            data-testid="brain-chat-toggle"
          />
          <span className="text-sm text-fg-muted">{on ? t('admin.cloud.chat.separate') : t('admin.cloud.chat.same')}</span>
        </div>
        {chat && (
          <>
            <Select
              size="sm"
              aria-label={`${roleName}: ${t('admin2.brain.where.label')}`}
              value={chat.provider === 'local' ? 'anthropic' : chat.provider}
              onChange={(v) => edit(['models', 'chat'], providerSwitch(draft, 'chat', v as ModelRef['provider'], keys.data))}
              options={[
                { value: 'anthropic', label: t('admin2.brain.where.cloud'), description: t('admin2.brain.where.cloudHint') },
                { value: 'openai-compatible', label: t('admin.cloud.where.option'), description: t('admin.cloud.where.optionHint') },
                { value: 'claude-code', label: t('ccbrain.admin.where.option'), description: t('ccbrain.admin.where.optionHint') },
              ]}
            />
            {chat.provider === 'openai-compatible' ? (
              <CloudRoleSettings path={['models', 'chat']} roleName={roleName} />
            ) : (
              <Input value={chat.model} spellCheck={false} className="font-mono text-sm" aria-label={roleName} onChange={(e) => edit(['models', 'chat', 'model'], e.target.value)} />
            )}
          </>
        )}
      </div>
    </SettingRow>
  );
}
