// Detay paneli › "Ekledikleri": sayfalar, işler ve takipler (son çalışma, sonraki zaman, "Şimdi çalıştır"), kartlar, sesli komutlar.
import { ArrowRight, Binoculars, CheckCircle, Play, SquaresFour, Timer, WarningCircle } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { relativeTime, t } from '@fuber/shared';
import { Badge, Button, Skeleton, toast } from '@fuber/ui';
import { pluginPageRoute, type PluginActivity, type PluginPreview } from '../../../main/modules/workshop/types';
import { useShell } from '../shell/context';
import { errorText, useLive } from '../shell/live';
import { PluginIcon } from './PluginIcon';

type Kind = PluginActivity['kind'];
const KIND_ICON = { job: Timer, watch: Binoculars, card: SquaresFour } as const;

/** Etkinlik kaydı yoksa (işleyici henüz yok ya da hiç çalışmadı) önizlemedeki katkıdan boş bir satır kurulur. */
function rowsFrom(skillId: string, skillName: string, activity: PluginActivity[] | null, preview: PluginPreview | null): PluginActivity[] {
  const rows = [...(activity ?? [])];
  const has = (kind: Kind, id: string) => rows.some((row) => row.kind === kind && row.id === id);
  const blank = (kind: Kind, id: string, title: string, schedule: string): PluginActivity => ({
    skillId,
    skillName,
    kind,
    id,
    title,
    schedule,
    announce: null,
    lastRunAt: null,
    lastOk: null,
    lastText: null,
    nextRunAt: null,
  });
  for (const job of preview?.jobs ?? []) if (!has('job', job.id)) rows.push(blank('job', job.id, job.title, ''));
  for (const watch of preview?.watches ?? []) if (!has('watch', watch.id)) rows.push(blank('watch', watch.id, watch.title, t('pluginsUi.activity.every', { minutes: watch.everyMinutes })));
  for (const card of preview?.cards ?? []) if (!has('card', card.id)) rows.push(blank('card', card.id, card.title, t('pluginsUi.activity.every', { minutes: card.refreshMinutes })));
  const order: Record<Kind, number> = { job: 0, watch: 1, card: 2 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]);
}

function ActivityRow({ row, enabled, onRun }: { row: PluginActivity; enabled: boolean; onRun: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const Icon = KIND_ICON[row.kind];
  const run = async () => {
    setBusy(true);
    try {
      await onRun();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-2 rounded-sm bg-surface-3 px-3.5 py-3" data-testid={`plugin-activity-${row.kind}-${row.id}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-4 text-fg-muted [&_svg]:size-4">
          <Icon aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base text-fg">{row.title}</span>
            <Badge size="sm" tone="neutral">
              {t(`pluginsUi.activity.kind.${row.kind}`)}
            </Badge>
          </div>
          {row.schedule && <span className="text-sm text-fg-muted">{row.schedule}</span>}
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Play weight="fill" />}
          loading={busy}
          disabled={!enabled}
          onClick={() => void run()}
          data-testid={`plugin-run-${row.kind}-${row.id}`}
        >
          {row.kind === 'card' ? t('pluginsUi.activity.refreshNow') : t('pluginsUi.activity.runNow')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-sm text-fg-faint">
        {row.lastRunAt ? (
          <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">
            {row.lastOk === false ? <WarningCircle weight="fill" className="text-danger" aria-hidden /> : <CheckCircle weight="fill" className="text-success" aria-hidden />}
            {t('pluginsUi.activity.last', { when: relativeTime(row.lastRunAt) })}
          </span>
        ) : (
          <span>{t('pluginsUi.activity.never')}</span>
        )}
        {row.nextRunAt && <span>{t('pluginsUi.activity.next', { when: relativeTime(row.nextRunAt) })}</span>}
      </div>
      {row.lastText && (
        <p className="plg-result pl-10 text-sm text-fg-muted" data-selectable>
          {row.lastText}
        </p>
      )}
    </li>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="flex items-baseline gap-2 text-sm font-medium text-fg-muted">
        {title}
        {count !== undefined && <span className="text-xs text-fg-faint tabular-nums">{count}</span>}
      </h4>
      {children}
    </section>
  );
}

export function AddsPanel({ skillId, skillName, enabled }: { skillId: string; skillName: string; enabled: boolean }) {
  const { navigate } = useShell();
  const preview = useLive(() => window.fuber.invoke('workshop.preview', { id: skillId, staged: false }), ['skills.changed'], [skillId]);
  const activity = useLive(() => window.fuber.invoke('plugins.activity', { skillId }), ['plugins.changed', 'skills.changed'], [skillId]);

  const loading = preview.state.status === 'loading' && activity.state.status === 'loading';
  if (loading) return <Skeleton shape="text" lines={4} />;

  const info = preview.data;
  const rows = rowsFrom(skillId, skillName, activity.data, info);
  const pages = info?.pages ?? [];
  const voice = info?.voice ?? [];

  const run = async (row: PluginActivity) => {
    try {
      const result = await window.fuber.invoke('plugins.runNow', { skillId, kind: row.kind, id: row.id });
      if (result.ok) toast.success(result.text || t('pluginsUi.activity.ran'));
      else toast.error(result.text || t('pluginsUi.activity.runFailed'));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      activity.reload();
    }
  };

  if (pages.length === 0 && rows.length === 0 && voice.length === 0) {
    return <p className="text-sm text-fg-muted" data-testid="plugin-adds-empty">{t('pluginsUi.adds.toolsOnly')}</p>;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="plugin-adds" data-skill={skillId}>
      {pages.length > 0 && (
        <Section title={t('pluginsUi.adds.pages')} count={pages.length}>
          <ul className="flex flex-col gap-2">
            {pages.map((page) => (
              <li key={page.id} className="flex items-center gap-3 rounded-sm bg-surface-3 px-3.5 py-3" data-testid={`plugin-adds-page-${page.id}`}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-4 text-fg-muted [&_svg]:size-4">
                  <PluginIcon name={page.icon} />
                </span>
                <span className="min-w-0 flex-1 truncate text-base text-fg">{page.title}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  trailing={<ArrowRight />}
                  disabled={!enabled}
                  onClick={() => navigate(pluginPageRoute(skillId, page.id))}
                  data-testid={`plugin-open-${skillId}-${page.id}`}
                >
                  {t('pluginsUi.adds.open')}
                </Button>
              </li>
            ))}
          </ul>
          {!enabled && <p className="text-sm text-fg-faint">{t('pluginsUi.adds.enableToOpen')}</p>}
        </Section>
      )}

      {rows.length > 0 && (
        <Section title={t('pluginsUi.adds.activity')} count={rows.length}>
          <ul className="flex flex-col gap-2" data-testid="plugin-activity">
            {rows.map((row) => (
              <ActivityRow key={`${row.kind}:${row.id}`} row={row} enabled={enabled} onRun={() => run(row)} />
            ))}
          </ul>
          {!enabled && <p className="text-sm text-fg-faint">{t('pluginsUi.adds.enableToRun')}</p>}
        </Section>
      )}

      {voice.length > 0 && (
        <Section title={t('pluginsUi.adds.voice')} count={voice.reduce((sum, entry) => sum + entry.phrases.length, 0)}>
          <div className="flex flex-wrap gap-2" data-testid="plugin-voice-phrases">
            {voice.flatMap((entry) => entry.phrases).map((phrase) => (
              <span key={phrase} className="rounded-full bg-surface-3 px-3 py-1 text-sm text-fg">
                {`“${phrase}”`}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
