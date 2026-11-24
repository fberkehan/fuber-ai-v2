import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@fuber/shared';
import { Input, Select, Skeleton, Switch, toast } from '@fuber/ui';
import type { PluginSettingValue } from '../../../main/modules/workshop/types';
import { errorText, useLive } from '../shell/live';
import { ErrorPanel } from '../shell/parts';

type Value = string | number | boolean;

/** Metin ve sayı alanı: yazarken yerel taslak, Enter ya da odak çıkınca kaydedilir (her tuşta IPC çağrısı yok). */
function TextControl({ setting, onCommit, testId }: { setting: PluginSettingValue; onCommit: (value: Value) => Promise<void>; testId: string }) {
  const [draft, setDraft] = useState(String(setting.value));
  const dirty = useRef(false);
  // Dışarıdan (kaydetme sonrası, başka pencere) gelen değer, kullanıcı yazmıyorsa taslağı günceller.
  useEffect(() => {
    if (!dirty.current) setDraft(String(setting.value));
  }, [setting.value]);
  const number = setting.type === 'number';
  const parsed = number ? Number(draft) : null;
  const invalid = number && (draft.trim() === '' || !Number.isFinite(parsed));

  const commit = async () => {
    if (!dirty.current) return;
    if (invalid) {
      dirty.current = false;
      setDraft(String(setting.value));
      return;
    }
    const next: Value = number ? (parsed as number) : draft;
    dirty.current = false;
    if (next === setting.value) return;
    await onCommit(next);
  };

  return (
    <Input
      size="sm"
      type={number ? 'number' : 'text'}
      inputMode={number ? 'decimal' : undefined}
      value={draft}
      invalid={invalid}
      onChange={(event) => {
        dirty.current = true;
        setDraft(event.target.value);
      }}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        }
      }}
      className={number ? 'text-right tabular-nums' : undefined}
      aria-label={setting.label}
      data-testid={testId}
    />
  );
}

function SettingRow({ setting, onChange }: { setting: PluginSettingValue; onChange: (key: string, value: Value) => Promise<void> }) {
  const id = useId();
  const testId = `plugin-setting-${setting.key}`;
  const commit = (value: Value) => onChange(setting.key, value);
  const inline = setting.type === 'boolean';
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,13rem)] items-center gap-x-5 gap-y-1 py-3.5 first:pt-1 last:pb-1" data-testid="plugin-setting-row">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label id={`${id}-label`} htmlFor={id} className="text-base text-fg">
          {setting.label}
        </label>
        {setting.description && <p className="text-sm text-fg-muted">{setting.description}</p>}
      </div>
      <div className={inline ? 'flex justify-end' : 'min-w-0'}>
        {setting.type === 'boolean' ? (
          <Switch id={id} checked={setting.value === true} onCheckedChange={(next) => void commit(next)} aria-labelledby={`${id}-label`} data-testid={testId} />
        ) : setting.type === 'select' ? (
          <Select
            id={id}
            size="sm"
            value={String(setting.value)}
            onChange={(next) => void commit(next)}
            options={(setting.options ?? []).map((option) => ({ value: option, label: option }))}
            aria-label={setting.label}
          />
        ) : (
          <TextControl setting={setting} onCommit={commit} testId={testId} />
        )}
      </div>
    </li>
  );
}

/**
 * Eklentinin ayarları: alan türüne göre metin, sayı, anahtar ya da seçim. Değer değişince hemen kaydedilir
 * (`plugins.setSetting`); dönen liste ekranın tek kaynağıdır. Ayarı olmayan eklentide hiçbir şey çizilmez
 * (`onEmpty` ile üst bileşen bölümü gizleyebilir).
 */
export function PluginSettings({ skillId, onEmpty }: { skillId: string; onEmpty?: (empty: boolean) => void }) {
  const { state, reload, data } = useLive(() => window.fuber.invoke('plugins.settings', { skillId }), ['plugins.changed'], [skillId]);
  const [local, setLocal] = useState<PluginSettingValue[] | null>(null);
  // `plugins.changed` yeni listeyi getirince yerel kopya bırakılır.
  useEffect(() => setLocal(null), [data]);
  const list = local ?? data;

  useEffect(() => {
    if (list) onEmpty?.(list.length === 0);
  }, [list, onEmpty]);

  const change = async (key: string, value: Value) => {
    try {
      setLocal(await window.fuber.invoke('plugins.setSetting', { skillId, key, value }));
    } catch (error) {
      toast.error(errorText(error));
      reload();
    }
  };

  if (state.status === 'loading' && !list) {
    return (
      <div className="flex flex-col gap-4" aria-busy aria-label={t('common.loading')}>
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    );
  }
  if (state.status === 'error' && !list) return <ErrorPanel message={state.message} onRetry={reload} />;
  if (!list || list.length === 0) return <p className="text-sm text-fg-muted">{t('pluginsUi.settings.empty')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line" data-testid="plugin-settings" data-skill={skillId}>
      {list.map((setting) => (
        <SettingRow key={setting.key} setting={setting} onChange={change} />
      ))}
    </ul>
  );
}
