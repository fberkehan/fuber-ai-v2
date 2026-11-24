import { Check } from '@phosphor-icons/react';
import { t, type MessageKey } from '@fuber/shared';
import { Button, cn, Spinner, Surface } from '@fuber/ui';
import type { BuildPhase, BuildProgress } from '../../../../main/modules/workshop/types';

const PHASES: Array<{ id: BuildPhase; key: MessageKey }> = [
  { id: 'planning', key: 'skills.phase.planning' },
  { id: 'writing', key: 'skills.phase.writing' },
  { id: 'testing', key: 'skills.phase.testing' },
  { id: 'approval', key: 'skills.phase.approval' },
];

export interface BuildCardProps {
  build: BuildProgress;
  cancelling: boolean;
  onCancel(): void;
}

/**
 * Süren yapım: dört aşamalı gerçek bir sıra (planla → yaz → sına → onay). Geçilen aşama işaretli, süren aşamada
 * dönen gösterge; altında o an yapılan iş cümlesi. Aşamalar arası çizgi ilerledikçe dolar.
 */
export function BuildCard({ build, cancelling, onCancel }: BuildCardProps) {
  const current = PHASES.findIndex((phase) => phase.id === build.phase);
  return (
    <Surface level={1} radius="md" className="flex flex-col gap-5 p-5" data-testid={`skills-build-${build.skillId}`}>
      <div className="flex items-start justify-between gap-6">
        <p className="min-w-0 max-w-[68ch] text-base text-fg">{build.goal}</p>
        <Button variant="ghost" size="sm" loading={cancelling} onClick={onCancel}>
          {t('skills.building.cancel')}
        </Button>
      </div>

      <ol className="grid grid-cols-4" aria-label={t('skills.building.title')}>
        {PHASES.map((phase, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={phase.id} className="relative flex flex-col gap-2.5" aria-current={active ? 'step' : undefined}>
              {index < PHASES.length - 1 && (
                <span aria-hidden className="absolute top-3 right-0 left-6 h-px -translate-y-1/2 overflow-hidden bg-line-strong">
                  <span
                    className={cn(
                      'block h-full origin-left bg-accent-fg transition-transform duration-(--duration-slow) ease-out',
                      done ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                </span>
              )}
              <span
                className={cn(
                  'relative flex size-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors duration-(--duration-fast) ease-out',
                  done && 'bg-accent text-fg [&_svg]:size-3.5',
                  active && 'bg-surface-3 text-accent-fg',
                  !done && !active && 'bg-surface-4 text-fg-faint',
                )}
              >
                {done ? <Check weight="bold" /> : active ? <Spinner size={18} label={null} /> : index + 1}
              </span>
              <span className={cn('pr-3 text-sm', active ? 'font-medium text-fg' : done ? 'text-fg-muted' : 'text-fg-faint')}>{t(phase.key)}</span>
            </li>
          );
        })}
      </ol>

      <p className="text-sm text-fg-muted" aria-live="polite">
        {build.step}
      </p>
    </Surface>
  );
}
