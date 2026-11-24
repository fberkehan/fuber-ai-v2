import {
  AppWindow,
  Bell,
  Binoculars,
  FolderSimple,
  GlobeSimple,
  LockSimple,
  Microphone,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  SpeakerHigh,
  SquaresFour,
  Timer,
  Warning,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { t, type MessageKey } from '@fuber/shared';
import { Skeleton, cn } from '@fuber/ui';
import type { PluginPreview } from '../../../main/modules/workshop/types';
import { useLive } from '../shell/live';
import { ErrorPanel } from '../shell/parts';
import { classifyAdd, classifyPermission, isLocalHost, permissionValues, type AddKind, type PermissionKind } from './preview-logic';

export const ADD_ICONS: Record<AddKind | 'other', Icon> = {
  tools: Wrench,
  cards: SquaresFour,
  jobs: Timer,
  watches: Binoculars,
  pages: AppWindow,
  settings: SlidersHorizontal,
  voice: Microphone,
  other: Plus,
};

export const ADD_LABELS: Record<AddKind, MessageKey> = {
  tools: 'pluginsUi.add.tools',
  cards: 'pluginsUi.add.cards',
  jobs: 'pluginsUi.add.jobs',
  watches: 'pluginsUi.add.watches',
  pages: 'pluginsUi.add.pages',
  settings: 'pluginsUi.add.settings',
  voice: 'pluginsUi.add.voice',
};

const PERMISSION_ICONS: Record<PermissionKind, Icon> = {
  net: GlobeSimple,
  files: FolderSimple,
  tools: Wrench,
  speak: SpeakerHigh,
  notify: Bell,
  other: ShieldCheck,
};

/** Önizleme (kurulu sürüm ya da bekleyen güncelleme). Hata ya da henüz işleyici yoksa `data` boş kalır. */
export function usePreview(id: string, staged: boolean) {
  return useLive<PluginPreview>(() => window.fuber.invoke('workshop.preview', { id, staged }), ['skills.changed', 'plugins.changed'], [id, staged]);
}

function Row({ icon: IconComponent, tone, children, highlight }: { icon: Icon; tone?: 'warning'; children: ReactNode; highlight?: boolean }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-4',
          highlight ? 'bg-accent-soft text-accent-fg' : 'bg-surface-4',
          !highlight && (tone === 'warning' ? 'text-warning' : 'text-fg-muted'),
        )}
      >
        <IconComponent aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-fg">{children}</div>
    </li>
  );
}

function AddsColumn({ preview, highlighted }: { preview: PluginPreview; highlighted: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="plugin-preview-adds">
      <h4 className="text-sm font-medium text-fg-muted">{t('pluginsUi.preview.adds')}</h4>
      {preview.adds.length === 0 ? (
        <p className="text-sm text-fg-faint">{t('pluginsUi.preview.addsNone')}</p>
      ) : (
        <ul className="plg-add-list">
          {preview.adds.map((line) => (
            <Row key={line} icon={ADD_ICONS[classifyAdd(line)]} highlight={highlighted}>
              <span>{line}</span>
            </Row>
          ))}
        </ul>
      )}
    </div>
  );
}

function PermissionsColumn({ preview }: { preview: PluginPreview }) {
  const seen = new Set<PermissionKind>();
  const local = preview.hosts.some(isLocalHost);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="plugin-preview-permissions">
      <h4 className="text-sm font-medium text-fg-muted">{t('pluginsUi.preview.permissions')}</h4>
      <ul className="plg-perm-list">
        {preview.permissions.length === 0 ? (
          <Row icon={ShieldCheck}>
            <span>{t('pluginsUi.preview.permissionsNone')}</span>
          </Row>
        ) : (
          preview.permissions.map((line) => {
            const kind = classifyPermission(line, preview);
            const first = !seen.has(kind);
            seen.add(kind);
            const values = first ? permissionValues(kind, preview).filter((value) => !line.toLowerCase().includes(value.toLowerCase())) : [];
            const warn = kind === 'net' && local;
            return (
              <Row key={line} icon={warn ? Warning : PERMISSION_ICONS[kind]} tone={warn ? 'warning' : undefined}>
                <span>{line}</span>
                {values.length > 0 && (
                  <span className="flex flex-wrap gap-1.5">
                    {values.map((value) => (
                      <code key={value} className="plg-chip" data-selectable>
                        {value}
                      </code>
                    ))}
                  </span>
                )}
                {warn && <span className="text-warning">{t('skills.permission.net.local')}</span>}
              </Row>
            );
          })
        )}
        <li className="flex items-center gap-3 text-sm text-fg-faint">
          <span className="flex size-7 shrink-0 items-center justify-center [&_svg]:size-4">
            <LockSimple aria-hidden />
          </span>
          {t('skills.permission.always')}
        </li>
      </ul>
    </div>
  );
}

/**
 * "Ne ekleyecek" ve "Hangi izinler": iki sütun. Veri `workshop.preview` ile gelir; yüklenirken iskelet, hata olursa
 * sakin bir hata paneli (`fallback` verilmişse onun yerine yedek görünüm).
 */
export function PreviewColumns({ id, staged = false, fallback }: { id: string; staged?: boolean; fallback?: ReactNode }) {
  const { state, data, reload } = usePreview(id, staged);
  if (!data) {
    if (state.status === 'error') return fallback ? <>{fallback}</> : <ErrorPanel message={state.message} onRetry={reload} />;
    return (
      <div className="grid gap-6 md:grid-cols-2" aria-busy aria-label={t('common.loading')}>
        <Skeleton shape="text" lines={4} />
        <Skeleton shape="text" lines={4} />
      </div>
    );
  }
  return (
    <div className="plg-two-wrap">
      <div className="plg-two">
        <AddsColumn preview={data} highlighted={false} />
        <PermissionsColumn preview={data} />
      </div>
    </div>
  );
}

/** Güncelleme önizlemesinin gövdesi: önce farklar (vurgulu), sonra iki sütun. */
export function ChangesBlock({ preview }: { preview: PluginPreview }) {
  if (preview.changes.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-sm bg-surface-3 p-4" data-testid="plugin-update-changes">
      <h4 className="text-sm font-medium text-fg">{t('pluginsUi.update.changes')}</h4>
      <ul className="plg-add-list">
        {preview.changes.map((line) => (
          <Row key={line} icon={ADD_ICONS[classifyAdd(line)]} highlight>
            <span>{line}</span>
          </Row>
        ))}
      </ul>
    </div>
  );
}

export function PreviewBody({ preview }: { preview: PluginPreview }) {
  return (
    <div className="plg-two-wrap">
      <div className="plg-two">
        <AddsColumn preview={preview} highlighted={false} />
        <PermissionsColumn preview={preview} />
      </div>
    </div>
  );
}
