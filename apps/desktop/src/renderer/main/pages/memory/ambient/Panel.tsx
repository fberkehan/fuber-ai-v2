// Hafıza sayfasının ortam dinleme sekmeleri: Notlar, Meseleler, Raporlar. Modül kapalıyken hiçbir `ambient.*` kanalı
// çağrılmaz; yalnız kapı gösterilir.
import { ListChecks, Notepad, FileText, Brain, IdentificationCard } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import type { TabItem } from '@fuber/ui';
import { AmbientGate } from './Gate';
import { IssuesTab } from './IssuesTab';
import { NotesTab } from './NotesTab';
import { ReportsTab } from './ReportsTab';
import { useAmbientStatus } from './data';

// `profile`: "Beni nasıl tanıyorsun" (hafıza modülünün profil katmanı, `../profile`); ortam sekmesi değildir.
export type MemoryTab = 'memory' | 'profile' | 'notes' | 'issues' | 'reports';
export type AmbientTab = Exclude<MemoryTab, 'memory' | 'profile'>;

/** `Tabs` bileşenine verilen ortak kimlik: sekme düğmeleri `#memory-tabs-tab-<değer>` olur. */
export const MEMORY_TABS_ID = 'memory-tabs';

export function memoryTabs(): TabItem<MemoryTab>[] {
  return [
    { value: 'memory', label: t('memory.tab.records'), icon: <Brain /> },
    { value: 'profile', label: t('profileUi.tab'), icon: <IdentificationCard /> },
    { value: 'notes', label: t('ambient.ui.tab.notes'), icon: <Notepad /> },
    { value: 'issues', label: t('ambient.ui.tab.issues'), icon: <ListChecks /> },
    { value: 'reports', label: t('ambient.ui.tab.reports'), icon: <FileText /> },
  ];
}

export function AmbientPanel({ tab }: { tab: AmbientTab }) {
  const { moduleOn, status, state } = useAmbientStatus();
  if (!moduleOn) {
    return (
      <div data-testid={`ambient-${tab}`}>
        <AmbientGate state="module_off" status={null} variant="full" />
      </div>
    );
  }
  if (tab === 'notes') return <NotesTab state={state} status={status} />;
  if (tab === 'issues') return <IssuesTab state={state} status={status} />;
  return <ReportsTab state={state} status={status} />;
}
