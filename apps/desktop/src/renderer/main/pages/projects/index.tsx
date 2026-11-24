import { useEffect, useState } from 'react';
import { t } from '@fuber/shared';
import { TabPanel, Tabs, Workspace, WorkspaceHeader } from '@fuber/ui';
import { ChatsCircle, FolderSimple } from '@phosphor-icons/react';
import type { IndexStatus } from '../../../../main/modules/projects/types';
import { definePage } from '../page';
import { onNavigation, takeNavigation } from './live/navigate';
import { ProjectsTab } from './ProjectsTab';
import { SessionsTab } from './SessionsTab';
import { fuber, when } from './shared';

type TabId = 'projects' | 'sessions';
const TABS_ID = 'projects-tabs';

function ProjectsPage() {
  // Sayfa açılmadan önce gelmiş gezinme isteği (bildirimdeki "Oturumu aç") ilk durumu belirler.
  const [initial] = useState(() => takeNavigation());
  const [tab, setTab] = useState<TabId>(() => {
    if (initial?.tab) return initial.tab;
    const params = new URLSearchParams(location.search);
    return initial?.live || params.get('tab') === 'sessions' || params.get('live') ? 'sessions' : 'projects';
  });
  const [liveTarget, setLiveTarget] = useState<{ id: string; at: number } | null>(() => (initial?.live ? { id: initial.live, at: Date.now() } : null));
  /** Canlı oturum açıkken sayfa başlığı ve sekmeler gizlenir: döküm ekranın büyük kısmını alır. */
  const [focused, setFocused] = useState(false);
  /** Oturumlar sekmesinin eylemleri ("Yeni oturum", ayarlar) sayfa başının eylem yuvasına çizilir. */
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [projectCount, setProjectCount] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<IndexStatus | null>(null);

  useEffect(() => {
    const refresh = () => void fuber().invoke('projects.listDetailed', {}).then((list) => setProjectCount(list.length)).catch(() => {});
    refresh();
    void fuber().invoke('projects.indexStatus').then(setStatus).catch(() => {});
    const offProgress = fuber().on('projects.indexProgress', setStatus);
    const offChanged = fuber().on('projects.changed', ({ entity }) => entity === 'project' && refresh());
    const offNavigation = onNavigation((target) => {
      if (target.live) {
        setTab('sessions');
        setLiveTarget({ id: target.live, at: Date.now() });
      } else if (target.tab) setTab(target.tab);
    });
    return () => {
      offProgress();
      offChanged();
      offNavigation();
    };
  }, []);

  const description =
    status?.state === 'indexing'
      ? t('projects.page.statusIndexing', { done: status.filesDone, total: status.filesTotal })
      : status?.state === 'error'
        ? t('projects.page.statusError', { error: status.error ?? '' })
        : status?.lastIndexedAt
          ? t('projects.page.statusReady', { sessions: status.sessions, when: when(status.lastIndexedAt) })
          : t('projects.page.statusIdle');

  // Projeler sekmesi sayfayla birlikte kayar (ana alan + bağlam sütunu); oturumlar sekmesi pencereyi doldurur (üç bölme
  // kendi içinde kayar). Canlı oturum açıkken başlık gizlenir: döküm ekranın büyük kısmını alır.
  const fill = tab === 'sessions';
  return (
    <Workspace fill={fill} data-tab={tab}>
      {
        <WorkspaceHeader
          title={t('nav.projects')}
          status={description}
          hidden={fill && focused}
          actions={<div ref={setActionsSlot} className="flex items-center gap-2" data-testid="projects-actions" />}
        >
          <Tabs<TabId>
            id={TABS_ID}
            value={tab}
            onChange={setTab}
            aria-label={t('nav.projects')}
            items={[
              { value: 'projects', label: t('projects.page.tabProjects'), icon: <FolderSimple />, ...(projectCount !== undefined ? { count: projectCount } : {}) },
              { value: 'sessions', label: t('projects.page.tabSessions'), icon: <ChatsCircle />, ...(status ? { count: status.sessions } : {}) },
            ]}
          />
        </WorkspaceHeader>
      }
      <TabPanel tabsId={TABS_ID} value="projects" hidden={tab !== 'projects'} className="outline-none">
        <ProjectsTab active={tab === 'projects'} status={status} />
      </TabPanel>
      <TabPanel tabsId={TABS_ID} value="sessions" hidden={tab !== 'sessions'} className="flex min-h-0 flex-1 flex-col outline-none">
        <SessionsTab active={tab === 'sessions'} liveTarget={liveTarget} onFocusChange={setFocused} actionsSlot={actionsSlot} />
      </TabPanel>
    </Workspace>
  );
}

export default definePage({
  id: 'projects',
  titleKey: 'nav.projects',
  icon: FolderSimple,
  order: 60,
  moduleId: 'projects',
  Component: ProjectsPage,
});
