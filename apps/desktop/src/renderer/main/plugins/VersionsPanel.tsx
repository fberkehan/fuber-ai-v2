// Detay paneli › "Sürümler": saklanan sürümler (yeniden eskiye), kurulu olan işaretli, "Bu sürüme dön" onaylı.
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useState } from 'react';
import { t } from '@fuber/shared';
import { Badge, Button, Dialog, Skeleton, toast } from '@fuber/ui';
import type { SkillVersionInfo } from '../../../main/modules/workshop/types';
import { errorText, useLive } from '../shell/live';
import { ErrorPanel } from '../shell/parts';

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function VersionsPanel({ skillId, skillName }: { skillId: string; skillName: string }) {
  const { state, data, reload } = useLive(() => window.fuber.invoke('workshop.versions', { id: skillId }), ['skills.changed'], [skillId]);
  const [target, setTarget] = useState<SkillVersionInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const rollback = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await window.fuber.invoke('workshop.rollback', { id: skillId, version: target.version });
      toast.success(t('pluginsUi.versions.rolledBack', { name: skillName, version: target.version }));
      setTarget(null);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
      reload();
    }
  };

  if (!data) {
    if (state.status === 'error') return <ErrorPanel message={state.message} onRetry={reload} />;
    return <Skeleton shape="text" lines={3} />;
  }
  if (data.length === 0) return <p className="text-sm text-fg-muted">{t('pluginsUi.versions.empty')}</p>;

  return (
    <>
      <ul className="flex flex-col gap-2" data-testid="plugin-versions" data-skill={skillId}>
        {data.map((entry) => (
          <li key={entry.version} className="plg-version" data-current={entry.current || undefined} data-testid={`plugin-version-${entry.version}`}>
            <span className="font-mono text-sm text-fg tabular-nums">{`v${entry.version}`}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-fg">{entry.note || t('pluginsUi.versions.noNote')}</span>
              <span className="text-xs text-fg-faint">{formatDate(entry.createdAt)}</span>
            </div>
            {entry.current ? (
              <Badge tone="success" dot size="sm">
                {t('pluginsUi.versions.current')}
              </Badge>
            ) : (
              <Button size="sm" variant="secondary" icon={<ArrowCounterClockwise />} onClick={() => setTarget(entry)} data-testid={`plugin-rollback-${entry.version}`}>
                {t('pluginsUi.versions.rollback')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        role="alertdialog"
        size="sm"
        title={t('pluginsUi.versions.confirmTitle', { name: skillName, version: target?.version ?? 0 })}
        description={t('pluginsUi.versions.confirmBody')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void rollback()} data-testid="plugin-rollback-confirm">
              {t('pluginsUi.versions.rollbackConfirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
