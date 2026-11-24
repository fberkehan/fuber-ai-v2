// Yeni oturum (v1 `Projeler.tsx` taslak ekranı): proje seçilir, ilk ileti, izin kipi, model ve efor verilir.
import { useEffect, useMemo, useState } from 'react';
import { foldForSearch, t } from '@fuber/shared';
import { Button, Dialog, Field, Input, Textarea } from '@fuber/ui';
import { MagnifyingGlass, Play } from '@phosphor-icons/react';
import type { EffortLevel, LiveEnvironment, LiveSessionSummary, PermissionMode } from '../../../../../main/modules/projects/claude/types';
import type { ProjectDetail } from '../../../../../main/modules/projects/types';
import { tidyPath } from '../shared';
import { effortOptions, modeOptions, modelOptions, PickSelect } from './controls';
import { StartPrompts, useStarter } from './start';

function recency(project: ProjectDetail): number {
  return Math.max(...[project.lastOpenedAt, project.lastSessionAt, project.modifiedAt].map((value) => (value ? Date.parse(value) : 0)));
}

export function NewSessionDialog({
  open,
  onClose,
  onStarted,
  projects,
  environment,
  initialProjectId,
}: {
  open: boolean;
  onClose(): void;
  onStarted(session: LiveSessionSummary): void;
  projects: readonly ProjectDetail[];
  environment: LiveEnvironment | null;
  initialProjectId?: string | undefined;
}) {
  const config = environment?.config;
  const [filter, setFilter] = useState('');
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<PermissionMode>('default');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const starter = useStarter((session) => {
    setPrompt('');
    onStarted(session);
    onClose();
  });

  const sorted = useMemo(() => [...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || recency(b) - recency(a)), [projects]);
  const shown = useMemo(() => {
    const query = foldForSearch(filter).trim();
    if (!query) return sorted;
    return sorted.filter((project) => [project.name, ...project.aliases, project.path].some((value) => foldForSearch(value).includes(query)));
  }, [sorted, filter]);

  // Açılışta varsayılanlar: ayardaki kip ve model, önerilen (ya da en son çalışılan) proje.
  useEffect(() => {
    if (!open) return;
    starter.reset();
    setFilter('');
    setMode(config?.defaultMode ?? 'default');
    setModel(config?.defaultModel ?? '');
    setEffort('');
    setProjectId((current) => initialProjectId ?? (current && projects.some((project) => project.id === current) ? current : (sorted[0]?.id ?? '')));
    // Yalnız açılış anında.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Süzgeç seçili projeyi dışarıda bıraktıysa ilk eşleşen seçilir.
  useEffect(() => {
    if (shown.length > 0 && !shown.some((project) => project.id === projectId)) setProjectId(shown[0]!.id);
  }, [shown, projectId]);

  const selected = projects.find((project) => project.id === projectId) ?? null;
  const fullAccess = config?.fullAccess ?? false;

  const start = () => {
    if (!selected) return;
    void starter.start({
      projectId: selected.id,
      ...(prompt.trim() ? { prompt } : {}),
      mode,
      model: model || null,
      effort: (effort || null) as EffortLevel | null,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="lg"
      title={t('projects.live.new.title')}
      description={t('projects.live.new.description')}
      footer={
        <>
          <Button variant="primary" icon={<Play weight="fill" />} loading={starter.pending} disabled={!selected || environment?.installed === false} data-testid="live-new-start" onClick={start}>
            {t('projects.live.new.start')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('projects.page.cancel')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {environment && !environment.installed && (
          <p role="alert" className="text-sm text-danger">
            {t('projects.live.env.notInstalled')}
          </p>
        )}
        <Field label={t('projects.live.new.project')} hint={selected ? tidyPath(selected.path) : undefined}>
          <div className="flex flex-col gap-2">
            <Input size="sm" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('projects.live.new.filter')} aria-label={t('projects.live.new.filter')} leading={<MagnifyingGlass />} />
            <PickSelect
              size="md"
              className="w-full"
              data-testid="live-new-project"
              aria-label={t('projects.live.new.project')}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              options={shown.length ? shown.map((project) => ({ value: project.id, label: project.name })) : [{ value: '', label: t('projects.live.new.noProject'), disabled: true }]}
            />
          </div>
        </Field>
        <Field label={t('projects.live.new.prompt')} hint={t('projects.live.new.promptHint')}>
          <Textarea
            data-testid="live-new-prompt"
            minRows={3}
            maxRows={10}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) start();
            }}
            placeholder={t('projects.live.new.promptPlaceholder')}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('projects.live.mode.label')}>
            <PickSelect size="md" className="w-full" data-testid="live-new-mode" value={mode} onChange={(event) => setMode(event.target.value as PermissionMode)} options={modeOptions(fullAccess, mode)} />
          </Field>
          <Field label={t('projects.live.model.label')}>
            <PickSelect size="md" className="w-full" data-testid="live-new-model" value={model} onChange={(event) => setModel(event.target.value)} options={modelOptions(environment?.models ?? [], model)} />
          </Field>
          <Field label={t('projects.live.effort.label')}>
            <PickSelect size="md" className="w-full" data-testid="live-new-effort" value={effort} onChange={(event) => setEffort(event.target.value)} options={effortOptions()} />
          </Field>
        </div>
        <p className="text-xs text-fg-faint">{t(`projects.live.mode.hint.${mode}`)}</p>
        <StartPrompts starter={starter} />
      </div>
    </Dialog>
  );
}
