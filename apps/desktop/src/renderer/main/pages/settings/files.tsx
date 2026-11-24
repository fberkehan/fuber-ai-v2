// Ayarlar › Gizlilik › Dosya erişimi: okuma izinli klasörler ve üretilen belgelerin klasörü (belge modülü).
import type { ReactNode } from 'react';
import { FolderOpen, FolderPlus, FolderSimple } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Badge, Button } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt, useLive } from '../../shell/live';
import { ErrorPanel, SkeletonRows } from '../../shell/parts';
import type { FolderEntry, FoldersView } from '../../../../main/modules/documents/types';
import { Group as KitGroup, PathText } from './kit';

function FolderRow({ entry, action }: { entry: FolderEntry; action?: { label: string; onPress: () => void } }) {
  return (
    <div className="st-row" data-st-row="" data-testid="settings-folder" data-source={entry.source}>
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
        <FolderSimple className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-medium text-fg">
            {entry.label}
            <Badge size="sm" tone={entry.source === 'external' ? 'accent' : 'neutral'}>
              {t(`documents.settings.source.${entry.source}`)}
            </Badge>
            {!entry.exists && (
              <Badge size="sm" tone="warning">
                {t('documents.settings.missing')}
              </Badge>
            )}
          </span>
          <PathText path={entry.path} className="text-sm text-fg-muted" />
        </div>
      </div>
      {action && (
        <Button size="sm" variant="ghost" onClick={action.onPress}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

type GroupComponent = (props: { title: string; description?: string; children: ReactNode }) => ReactNode;

/**
 * İki kutu döner: "Dosya erişimi" ve "Üretilen belgeler". Bir sütunun (`Column`) içine konur. `Group` verilmezse
 * Ayarlar'ın kutusu kullanılır (eski çağrı biçimi `FileAccess Group={Group}` de çalışır).
 */
export function FileAccess({ Group = KitGroup }: { Group?: GroupComponent }) {
  const shell = useShell();
  const folders = useLive<FoldersView>(() => window.fuber.invoke('documents.folders'), []);
  if (folders.state.status === 'loading') {
    return (
      <Group title={t('documents.settings.title')} description={t('documents.settings.body', { name: shell.name })}>
        <SkeletonRows count={3} />
      </Group>
    );
  }
  if (folders.state.status === 'error') return <ErrorPanel message={folders.state.message} onRetry={folders.reload} />;
  const view = folders.state.data;
  const change = (run: () => Promise<FoldersView>) => async () => {
    if (await attempt(run)) folders.reload();
  };
  const own = view.read.filter((entry) => entry.source !== 'external');
  const external = view.read.filter((entry) => entry.source === 'external');
  return (
    <>
      <Group title={t('documents.settings.title')} description={t('documents.settings.body', { name: shell.name })}>
        <div className="flex items-center justify-between gap-4 pb-1">
          <span className="text-sm font-medium text-fg-muted">{t('documents.settings.read')}</span>
          <Button size="sm" icon={<FolderPlus />} onClick={change(() => window.fuber.invoke('documents.addFolder', {}))} data-testid="settings-folder-add">
            {t('documents.settings.add')}
          </Button>
        </div>
        {own.map((entry) => (
          <FolderRow key={entry.path} entry={entry} action={{ label: t('documents.settings.remove'), onPress: change(() => window.fuber.invoke('documents.removeFolder', { path: entry.path })) }} />
        ))}
        {external.length > 0 && <p className="pt-3 pb-1 text-sm text-fg-muted">{t('documents.settings.externalHint')}</p>}
        {external.map((entry) => (
          <FolderRow key={entry.path} entry={entry} />
        ))}
        {view.disabledDefaults.length > 0 && <p className="pt-3 pb-1 text-sm font-medium text-fg-muted">{t('documents.settings.disabled')}</p>}
        {view.disabledDefaults.map((entry) => (
          <FolderRow key={entry.path} entry={entry} action={{ label: t('documents.settings.restore'), onPress: change(() => window.fuber.invoke('documents.restoreFolder', { path: entry.path })) }} />
        ))}
      </Group>
      <Group title={t('documents.settings.output')} description={t('documents.settings.outputBody', { name: shell.name })}>
        <div className="st-row" data-st-row="" data-testid="settings-output">
          <span className="min-w-0 flex-1 basis-56 text-sm text-fg">
            <PathText path={view.output} />
            {view.outputIsDefault && <span className="ml-2 font-sans text-fg-muted">({t('documents.settings.default')})</span>}
          </span>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={() => void attempt(() => window.fuber.invoke('documents.openOutput'))}>
              {t('documents.settings.open')}
            </Button>
            {!view.outputIsDefault && (
              <Button size="sm" variant="ghost" onClick={change(() => window.fuber.invoke('documents.setOutput', { reset: true }))}>
                {t('documents.settings.reset')}
              </Button>
            )}
            <Button size="sm" onClick={change(() => window.fuber.invoke('documents.setOutput', {}))} data-testid="settings-output-change">
              {t('documents.settings.change')}
            </Button>
          </div>
        </div>
      </Group>
    </>
  );
}
