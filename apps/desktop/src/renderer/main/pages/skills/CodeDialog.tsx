import { useEffect, useId, useMemo, useState } from 'react';
import { t, type SkillDetail } from '@fuber/shared';
import { Dialog, Skeleton, TabPanel, Tabs } from '@fuber/ui';
import type { SkillSource } from '../../../../main/modules/workshop/types';

const SELFTEST = '::selftest';

/** Tek renkli, satır numaralı, salt okunur kod görünümü. */
function CodeView({ text }: { text: string }) {
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text]);
  return (
    <div className="max-h-[56vh] overflow-auto rounded-sm border border-line bg-surface-1" data-testid="skills-code-view">
      <table className="w-full table-fixed border-collapse font-mono text-xs leading-5">
        <tbody>
          {lines.map((line, index) => (
            // Satırlar sabit sıradadır; içerik değişince tablo baştan kurulur.
            <tr key={index}>
              <td className="w-12 border-r border-line px-3 text-right align-top text-fg-faint tabular-nums select-none">{index + 1}</td>
              <td className="px-4 align-top break-words whitespace-pre-wrap text-fg" data-selectable>
                {line || ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface CodeDialogProps {
  /** Açık olan yeteneğin kimliği; `null` kapalı. */
  skillId: string | null;
  name: string;
  onClose(): void;
}

/** "Kodu göster": yeteneğin dosyaları ve son öz-sınama çıktısı. Dosya içeriği sekme açıldıkça okunur. */
export function CodeDialog({ skillId, name, onClose }: CodeDialogProps) {
  const tabsId = useId();
  const [detail, setDetail] = useState<Pick<SkillDetail, 'selftestLog' | 'files'> | null>(null);
  const [tab, setTab] = useState<string>('index.mjs');
  const [sources, setSources] = useState<Record<string, SkillSource | { error: string }>>({});

  useEffect(() => {
    setDetail(null);
    setSources({});
    if (!skillId) return;
    let cancelled = false;
    window.fuber.invoke('skills.get', { id: skillId }).then(
      (next) => {
        if (cancelled) return;
        setDetail(next);
        const names = next.files.map((file) => file.path);
        setTab(names.includes('index.mjs') ? 'index.mjs' : (names[0] ?? SELFTEST));
      },
      () => !cancelled && setDetail({ selftestLog: '', files: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  useEffect(() => {
    if (!skillId || !detail || tab === SELFTEST || sources[tab]) return;
    let cancelled = false;
    window.fuber.invoke('workshop.source', { id: skillId, path: tab }).then(
      (source) => !cancelled && setSources((current) => ({ ...current, [tab]: source })),
      (error: unknown) =>
        !cancelled && setSources((current) => ({ ...current, [tab]: { error: error instanceof Error ? error.message : t('skills.code.error') } })),
    );
    return () => {
      cancelled = true;
    };
  }, [skillId, detail, tab, sources]);

  const items = [
    ...(detail?.files ?? []).map((file) => ({ value: file.path, label: file.path })),
    { value: SELFTEST, label: t('skills.code.selftest') },
  ];
  const source = sources[tab];

  return (
    <Dialog
      open={skillId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('skills.code.title', { name })}
      description={t('skills.code.description')}
      size="lg"
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        {detail ? <Tabs id={tabsId} items={items} value={tab} onChange={setTab} size="sm" /> : <Skeleton className="h-8 w-80" />}
        <TabPanel tabsId={tabsId} value={tab}>
          {!detail ? (
            <Skeleton className="h-64 w-full" />
          ) : tab === SELFTEST ? (
            detail.selftestLog.trim() ? (
              <CodeView text={detail.selftestLog} />
            ) : (
              <p className="py-6 text-sm text-fg-muted">{t('skills.code.selftest.empty')}</p>
            )
          ) : !source ? (
            <Skeleton className="h-64 w-full" />
          ) : 'error' in source ? (
            <p className="py-6 text-sm text-danger">{source.error}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <CodeView text={source.content} />
              {source.truncated && <p className="text-xs text-fg-faint">{t('skills.code.truncated')}</p>}
            </div>
          )}
        </TabPanel>
      </div>
    </Dialog>
  );
}
