import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  AppWindow,
  Binoculars,
  Brain,
  ClockCounterClockwise,
  FloppyDisk,
  CalendarCheck,
  Desktop,
  DownloadSimple,
  Ear,
  EnvelopeSimple,
  FileText,
  FolderSimple,
  Gauge,
  Globe,
  Hammer,
  MicrophoneSlash,
  PresentationChart,
  PuzzlePiece,
  UsersThree,
  Warning,
} from '@phosphor-icons/react';
import { hasMessage, t, type Policy } from '@fuber/shared';
import { Select, Switch, cn, enter, stagger, useMotionPreset } from '@fuber/ui';
import { usePolicy, useField } from '../app/policy-store';
import { Block, Fields, Notice, Page, PanelSkeleton, SettingRow, Steps, SummaryStrip, type StatProps } from '../components/layout';
import { ambientOn, moduleCounts, moduleIds } from '../lib/status';
import { NumberInput } from './VoicePage';
import type { PageProps } from './types';

const ICONS: Record<string, ReactNode> = {
  'voice-control': <MicrophoneSlash />,
  memory: <Brain />,
  planner: <CalendarCheck />,
  stage: <PresentationChart />,
  projects: <FolderSimple />,
  web: <Globe />,
  pc: <Desktop />,
  workshop: <Hammer />,
  documents: <FileText />,
  'import-v1': <DownloadSimple />,
  meeting: <UsersThree />,
  // demo.3 bütünleştirmesi: masaüstündeki sayfa ve ayar simgeleriyle aynı (İşler: dürbün, kendi tarayıcısı: pencere).
  watch: <Binoculars />,
  browser: <AppWindow />,
  mail: <EnvelopeSimple />,
  // Kokpit (Bugün panosu): gösterge.
  dashboard: <Gauge />,
};

export function ModulesPage(_: PageProps) {
  const { draft, loading } = usePolicy();
  const ready = !loading && !!draft;
  return (
    <Page
      title={t('admin.modules.title')}
      description={t('admin.modules.description')}
      summary={ready ? <ModulesSummary /> : undefined}
      aside={
        ready ? (
          <>
            <AmbientBlock />
            <AfterSaveBlock />
          </>
        ) : (
          <PanelSkeleton rows={2} />
        )
      }
    >
      {ready ? <ModuleList modules={draft.modules} /> : <PanelSkeleton rows={6} />}
    </Page>
  );
}

// ───────────────────────── Bir bakışta ─────────────────────────

function ModulesSummary() {
  const { draft, base, paths } = usePolicy();
  if (!draft) return null;
  const { on, total } = moduleCounts(draft);
  const ambient = ambientOn(draft);
  const pending = paths.filter((path) => path[0] === 'modules' || path[0] === 'ambient').length;
  const items: StatProps[] = [
    { label: t('admin.modules.stat.on'), icon: <PuzzlePiece />, value: on, unit: `/ ${total}`, note: t('admin.modules.stat.onNote', { off: total - on }), testId: 'stat-modules-on' },
    {
      label: t('admin.modules.ambient.title'),
      icon: <Ear />,
      value: ambient ? t('admin.modules.ambient.allowed') : t('admin.modules.ambient.blocked'),
      note: ambient ? t('admin.modules.stat.ambientOnNote') : t('admin.modules.stat.ambientOffNote'),
      tone: ambient ? 'warning' : undefined,
    },
    { label: t('admin.modules.stat.pending'), icon: <FloppyDisk />, value: pending, note: pending ? t('admin.modules.stat.pendingNote') : t('admin.modules.stat.pendingNone') },
    { label: t('admin.overview.stat.revision'), icon: <ClockCounterClockwise />, value: base?.revision ?? null, note: t('admin.modules.stat.revisionNote') },
  ];
  return <SummaryStrip items={items} testId="modules-summary" />;
}

/** "Kaydedince ne olur": modül değişikliğinin masaüstüne yolculuğu (taslak durumuyla). */
function AfterSaveBlock() {
  const { paths } = usePolicy();
  const dirty = paths.some((path) => path[0] === 'modules' || path[0] === 'ambient');
  return (
    <Block index={2} title={t('admin.modules.after.title')} testId="modules-after">
      <Steps
        testId="modules-steps"
        items={[
          { title: t('admin.modules.after.toggle'), body: t('admin.modules.after.toggleBody'), state: dirty ? 'done' : 'idle' },
          { title: t('admin.modules.after.save'), body: t('admin.modules.after.saveBody'), state: dirty ? 'pending' : 'idle' },
          { title: t('admin.modules.after.desktop'), body: t('admin.modules.after.desktopBody') },
        ]}
      />
    </Block>
  );
}

function ModuleList({ modules }: { modules: Policy['modules'] }) {
  const { edit } = usePolicy();
  const ids = moduleIds(modules);
  const enabledCount = ids.filter((id) => modules[id]?.enabled).length;
  const preset = useMotionPreset(enter.fadeUp);
  return (
    <Block
      index={0}
      tone="lead"
      title={t('admin.modules.list.title')}
      description={t('admin.modules.list.description')}
      action={
        <span className="text-sm whitespace-nowrap text-fg-muted tabular-nums" data-testid="modules-on">
          {t('admin2.modules.onCount', { on: enabledCount, total: ids.length })}
        </span>
      }
    >
      {/* Modüller yan yana, eşit boylu satırlarda: ikon + ad + bir cümle + anahtar (satırın ortasında, sağda). */}
      <div className="ad-modules">
        {ids.map((id, index) => {
          const on = modules[id]?.enabled ?? false;
          const name = hasMessage(`module.${id}.name`) ? t(`module.${id}.name`) : id;
          const description = hasMessage(`module.${id}.description`) ? t(`module.${id}.description`) : t('admin.modules.custom');
          return (
            <motion.label key={id} initial={preset.initial} animate={preset.animate} transition={stagger(index, preset.transition)} className="ad-module" data-testid={`module-${id}`}>
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-sm transition-colors duration-(--duration-base) [&_svg]:size-4.5',
                  on ? 'bg-surface-5 text-fg' : 'bg-surface-3 text-fg-faint',
                )}
              >
                {ICONS[id] ?? <PuzzlePiece />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('text-base font-medium transition-colors duration-(--duration-base)', on ? 'text-fg' : 'text-fg-muted')}>{name}</span>
                <span className="text-sm text-fg-muted">{description}</span>
              </span>
              <Switch checked={on} onCheckedChange={(next) => edit(['modules', id, 'enabled'], next)} aria-label={name} />
            </motion.label>
          );
        })}
      </div>
    </Block>
  );
}

function AmbientBlock() {
  const { editMany, draft } = usePolicy();
  const [perHour, setPerHour, perHourError] = useField<number>(['ambient', 'maxInterjectionsPerHour']);
  const [gap, setGap, gapError] = useField<number>(['ambient', 'minGapSeconds']);
  const [retention, setRetention, retentionError] = useField<number>(['ambient', 'retentionDays']);
  const [interjections, setInterjections] = useField<Policy['ambient']['interjections']>(['ambient', 'interjections']);
  const allowed = !!draft?.ambient.allowed && !!draft.modules.ambient?.enabled;
  return (
    <Block index={1} id="ambient" alert={allowed ? 'warning' : undefined} title={t('admin.modules.ambient.title')} description={t('admin.modules.ambient.description')}>
      <div>
      <SettingRow inline label={t('admin.modules.ambient.allow')} description={t('admin.modules.ambient.allowHint')} testId="ambient-allow">
        <span className={cn('flex items-center gap-1.5 text-sm', allowed ? 'text-warning' : 'text-fg-faint')}>
          <Ear aria-hidden className="size-4" />
          {allowed ? t('admin.modules.ambient.allowed') : t('admin.modules.ambient.blocked')}
        </span>
        <Switch
          checked={allowed}
          aria-label={t('admin.modules.ambient.allow')}
          onCheckedChange={(on) =>
            editMany([
              [['ambient', 'allowed'], on],
              [['modules', 'ambient', 'enabled'], on],
            ])
          }
        />
      </SettingRow>
      </div>
      {/* Sınırlar yalnız izin açıkken anlamlıdır: kapalıyken gizlenir, açılınca uyarıyla birlikte görünür. */}
      {allowed && (
        <>
          <Notice tone="warning" icon={<Warning weight="fill" />} title={t('admin.modules.ambient.warnTitle')}>
            {t('admin.modules.ambient.warnBody')}
          </Notice>
          <Fields min={220}>
        <SettingRow label={t('admin.modules.ambient.perHour')} description={t('admin.modules.ambient.perHourHint')} htmlFor="ambient-per-hour" error={perHourError}>
          <NumberInput id="ambient-per-hour" value={perHour} onChange={setPerHour} unit={t('admin.modules.ambient.perHourUnit')} min={0} step={1} invalid={!!perHourError} />
        </SettingRow>
        <SettingRow label={t('admin.modules.ambient.gap')} description={t('admin.modules.ambient.gapHint')} htmlFor="ambient-gap" error={gapError}>
          <NumberInput id="ambient-gap" value={gap} onChange={setGap} unit={t('admin.common.seconds')} min={0} step={30} invalid={!!gapError} />
        </SettingRow>
        <SettingRow label={t('admin.modules.ambient.interjections')} description={t('admin.modules.ambient.interjectionsHint')} testId="ambient-interjections">
          <Select
            aria-label={t('admin.modules.ambient.interjections')}
            value={interjections}
            onChange={setInterjections}
            options={(['off', 'cloud-only', 'on'] as const).map((value) => ({
              value,
              label: t(`admin.modules.ambient.interjections.${value}`),
              description: t(`admin.modules.ambient.interjections.${value}Hint`),
            }))}
          />
        </SettingRow>
        <SettingRow
          label={t('admin.modules.ambient.retention')}
          description={t('admin.modules.ambient.retentionHint')}
          htmlFor="ambient-retention"
          error={retentionError}
          testId="ambient-retention"
        >
          <NumberInput
            id="ambient-retention"
            value={retention}
            onChange={setRetention}
            unit={t('admin.modules.ambient.retentionUnit')}
            min={1}
            max={7}
            step={1}
            invalid={!!retentionError}
          />
        </SettingRow>
          </Fields>
        </>
      )}
    </Block>
  );
}
