// Seçilen yeteneğin ayrıntısı: bağlam sütununda (geniş kap) ya da diyalogda (dar kap) aynı içerik.
import { Code, Trash } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { hasMessage, t, type ModuleInfo, type SkillInfo } from '@fuber/shared';
import { Badge, Button, Switch, TabPanel, Tabs, type TabItem } from '@fuber/ui';
import type { WorkshopStatus } from '../../../../main/modules/workshop/types';
import { AddsPanel } from '../../plugins/AddsPanel';
import { PluginSettings } from '../../plugins/PluginSettings';
import { UpdateForm } from '../../plugins/UpdateForm';
import { VersionsPanel } from '../../plugins/VersionsPanel';
import { PreviewColumns } from '../../plugins/PreviewColumns';
import { PermissionList, StatusBadge, ToolList } from './parts';

export type Selection = { kind: 'module'; id: string } | { kind: 'skill'; id: string };

export const moduleName = (module: ModuleInfo) => (hasMessage(module.nameKey) ? t(module.nameKey) : module.id);
export const moduleDescription = (module: ModuleInfo) => (hasMessage(module.descriptionKey) ? t(module.descriptionKey) : '');

/** Yerleşik yeteneğin durumu: açık, kapalı ya da Yönetim'in kapattığı. */
export function moduleState(module: ModuleInfo): 'on' | 'off' | 'blocked' {
  return module.enabled ? 'on' : module.allowed ? 'off' : 'blocked';
}

export function ModuleStateBadge({ module }: { module: ModuleInfo }) {
  const state = moduleState(module);
  return (
    <Badge tone={state === 'on' ? 'success' : state === 'blocked' ? 'warning' : 'neutral'} dot>
      {t(`skills.builtin.${state}`)}
    </Badge>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h4 className="text-sm font-medium text-fg-muted">{title}</h4>
      {children}
    </div>
  );
}

/** Yerleşik yetenek: ne yaptığı, durumu (ve kimin belirlediği), kayda soktuğu araçlar. */
export function ModuleDetail({ module, bare }: { module: ModuleInfo; bare?: boolean }) {
  const state = moduleState(module);
  return (
    <div className="flex flex-col gap-4" data-testid="skills-detail" data-kind="module" data-id={module.id}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* Diyalogda ad başlıkta yazar; burada yinelenmez. */}
          {!bare && <h3 className="text-xl font-semibold tracking-tight text-fg">{moduleName(module)}</h3>}
          <ModuleStateBadge module={module} />
        </div>
        <p className="text-base text-fg-muted">{moduleDescription(module)}</p>
      </div>
      <p className="text-sm text-fg-faint">{module.error ? module.error : t(`skills.detail.state.${state}`)}</p>
      {module.tools.length > 0 && (
        <Block title={t('skills.detail.tools', { count: module.tools.length })}>
          <ToolList tools={module.tools} />
        </Block>
      )}
    </div>
  );
}

type SkillTab = 'general' | 'adds' | 'settings' | 'versions' | 'update';

export interface SkillDetailProps {
  skill: SkillInfo;
  hosts: string[];
  /** `workshop.status.skills[id]`: sürüm sayısı, ne eklediği, onay durumu. */
  meta?: WorkshopStatus['skills'][string];
  /** Bu eklentinin bir güncellemesi şu an hazırlanıyor (BuildCard sayfada görünür). */
  updating?: boolean;
  /** Güncelleme istenemiyorsa nedeni (derin beyin yok gibi). */
  updateBlocked?: string | null;
  onShowCode: () => void;
  onToggle?: (enabled: boolean) => Promise<void>;
  onRemove?: () => void;
  bare?: boolean;
}

/**
 * Kendi geliştirilen eklenti: sekmeli ayrıntı. Genel (durum, açma/kapama, izinler, araçlar, kod, kaldır), Ekledikleri
 * (sayfalar, işler, takipler, kartlar, sesli komutlar), Ayarlar (ayarı yoksa çıkmaz), Sürümler, Güncelle.
 */
export function SkillDetail({ skill, hosts, meta, updating, updateBlocked, onShowCode, onToggle, onRemove, bare }: SkillDetailProps) {
  const tabsId = useId();
  const [tab, setTab] = useState<SkillTab>('general');
  const [busy, setBusy] = useState(false);
  const settingsCount = meta?.adds?.settings ?? 0;
  const versionCount = Math.max(meta?.versions ?? 0, skill.version > 1 ? skill.version - 1 : 0);
  const workable = skill.status === 'enabled' || skill.status === 'disabled';
  const toggleable = !!onToggle && (meta?.approved ?? false) && workable;

  const items: TabItem<SkillTab>[] = [
    { value: 'general', label: t('pluginsUi.tab.general') },
    { value: 'adds', label: t('pluginsUi.tab.adds') },
    ...(settingsCount > 0 ? [{ value: 'settings' as const, label: t('pluginsUi.tab.settings') }] : []),
    ...(versionCount > 0 || updating ? [{ value: 'versions' as const, label: t('pluginsUi.tab.versions'), count: versionCount + 1 }] : []),
    ...(workable ? [{ value: 'update' as const, label: t('pluginsUi.tab.update') }] : []),
  ];
  // Seçili sekme kalktıysa (ayar kalmadı, güncelleme bitti) Genel'e dön.
  const active = items.some((item) => item.value === tab) ? tab : 'general';

  return (
    <div className="flex flex-col gap-4" data-testid="skills-detail" data-kind="skill" data-id={skill.id}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {!bare && <h3 className="text-xl font-semibold tracking-tight text-fg">{skill.name}</h3>}
          <StatusBadge status={skill.status} />
          <span className="font-mono text-xs text-fg-faint tabular-nums">{`v${skill.version}`}</span>
          {toggleable && (
            <Switch
              checked={skill.status === 'enabled'}
              disabled={busy}
              onCheckedChange={(next) => {
                setBusy(true);
                void onToggle(next).finally(() => setBusy(false));
              }}
              aria-label={t('skills.card.toggle', { name: skill.name })}
              className="ml-auto"
              data-testid="plugin-detail-toggle"
            />
          )}
        </div>
        {skill.description && <p className="text-base text-fg-muted">{skill.description}</p>}
      </div>

      <div className="plg-tabs-scroll">
        <Tabs id={tabsId} size="sm" items={items} value={active} onChange={setTab} aria-label={t('pluginsUi.tab.label')} />
      </div>

      <TabPanel tabsId={tabsId} value={active} className="flex flex-col gap-4">
        {active === 'general' && (
          <>
            {skill.status === 'failed' && skill.lastError && (
              <pre className="max-h-40 overflow-auto rounded-sm bg-danger-soft px-3 py-2.5 font-sans text-sm whitespace-pre-wrap text-fg" data-selectable>
                {skill.lastError}
              </pre>
            )}
            {/* Ne ekliyor ve hangi izinler: onay kartıyla aynı kaynak (`workshop.preview`). Sesli duyuru, dosya kökü ve
                çağırdığı Jarvis araçları yalnız burada görünür; önizleme alınamazsa eski izin listesine düşülür. */}
            <PreviewColumns
              id={skill.id}
              fallback={
                <Block title={t('skills.pending.permissions')}>
                  <PermissionList permissions={skill.permissions} hosts={hosts} />
                </Block>
              }
            />
            {skill.tools.length > 0 && (
              <Block title={t('skills.detail.tools', { count: skill.tools.length })}>
                <ToolList tools={skill.tools} />
              </Block>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon={<Code />} onClick={onShowCode} data-testid={`skills-code-${skill.id}`}>
                {t('skills.card.showCode')}
              </Button>
              {onRemove && (
                <Button variant="ghost" size="sm" icon={<Trash />} onClick={onRemove} data-testid={`skills-remove-${skill.id}`}>
                  {t('skills.card.remove')}
                </Button>
              )}
            </div>
          </>
        )}
        {active === 'adds' && <AddsPanel skillId={skill.id} skillName={skill.name} enabled={skill.status === 'enabled'} />}
        {active === 'settings' && <PluginSettings skillId={skill.id} />}
        {active === 'versions' && <VersionsPanel skillId={skill.id} skillName={skill.name} />}
        {active === 'update' && <UpdateForm skillId={skill.id} skillName={skill.name} busyUpdating={!!updating || !!meta?.update} blocked={updateBlocked ?? null} />}
      </TabPanel>
    </div>
  );
}
